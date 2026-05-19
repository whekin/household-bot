import type { Bot, Context } from 'grammy'

import type { FinanceCommandService } from '@household/application'
import { Money, type CurrencyCode, type SupportedLocale } from '@household/domain'
import type { Logger } from '@household/observability'
import type {
  FinanceParsedPurchaseRecord,
  FinanceRepository,
  HouseholdConfigurationRepository,
  HouseholdMemberRecord
} from '@household/ports'

import { getBotTranslations, type BotLocale } from './i18n'
import { formatUserFacingMoney } from './i18n/money'

const PURCHASE_NOTICE_PARTICIPANT_CALLBACK_PREFIX = 'purchase_saved:part:'

type InlineKeyboardMarkup = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>
}

export interface RenderedPurchaseTopicNotice {
  text: string
  replyMarkup?: InlineKeyboardMarkup
}

export interface PurchaseTopicNoticeService {
  publishPurchase(input: { householdId: string; purchaseId: string }): Promise<void>
  syncPurchase(input: { householdId: string; purchaseId: string }): Promise<void>
  markPurchaseDeleted(input: { householdId: string; purchaseId: string }): Promise<void>
  replaceExistingPurchaseMessage(input: {
    householdId: string
    purchaseId: string
    telegramChatId: string
    telegramThreadId: string
    telegramMessageId: string
  }): Promise<boolean>
}

function asBotLocale(locale: SupportedLocale): BotLocale {
  return locale === 'ru' ? 'ru' : 'en'
}

function moneyText(amountMinor: bigint, currency: CurrencyCode): string {
  return formatUserFacingMoney(Money.fromMinor(amountMinor, currency).toMajorString(), currency)
}

function memberName(
  members: readonly HouseholdMemberRecord[],
  memberId: string | null | undefined
): string | null {
  if (!memberId) {
    return null
  }
  return members.find((member) => member.id === memberId)?.displayName ?? null
}

function splitLabel(locale: BotLocale, splitMode: string | null | undefined): string {
  if (splitMode === 'custom_amounts') {
    return locale === 'ru' ? 'индивидуальные суммы' : 'custom amounts'
  }
  return locale === 'ru' ? 'поровну' : 'equal'
}

function renderParticipantLines(input: {
  locale: BotLocale
  purchase: FinanceParsedPurchaseRecord
  members: readonly HouseholdMemberRecord[]
}): string | null {
  const participants = input.purchase.participants ?? []
  if (participants.length === 0) {
    return null
  }

  const t = getBotTranslations(input.locale).purchase
  const lines = participants.map((participant) => {
    const displayName = memberName(input.members, participant.memberId) ?? participant.memberId
    const share =
      participant.shareAmountMinor !== null
        ? ` ${moneyText(participant.shareAmountMinor, input.purchase.currency)}`
        : ''
    return participant.included === false
      ? t.participantExcluded(displayName)
      : `${t.participantIncluded(displayName)}${share}`
  })

  return `${t.participantsHeading}\n${lines.join('\n')}`
}

function purchaseSummary(purchase: FinanceParsedPurchaseRecord): string {
  const description = purchase.description?.trim() || 'shared purchase'
  return `${description} ${moneyText(purchase.amountMinor, purchase.currency)}`
}

export function renderPurchaseTopicNotice(input: {
  locale: BotLocale
  purchase: FinanceParsedPurchaseRecord
  members: readonly HouseholdMemberRecord[]
}): RenderedPurchaseTopicNotice {
  const payer =
    memberName(input.members, input.purchase.payerMemberId) ?? input.purchase.payerMemberId
  const participants = renderParticipantLines(input)
  const summary = purchaseSummary(input.purchase)
  const lines =
    input.locale === 'ru'
      ? [
          `Покупка: ${summary}`,
          `Плательщик: ${payer}`,
          `Разделение: ${splitLabel(input.locale, input.purchase.splitMode)}`,
          participants
        ]
      : [
          `Purchase: ${summary}`,
          `Paid by: ${payer}`,
          `Split: ${splitLabel(input.locale, input.purchase.splitMode)}`,
          participants
        ]

  const participantButtons =
    input.purchase.splitMode !== 'custom_amounts'
      ? (input.purchase.participants ?? [])
          .filter((participant) => participant.id)
          .map((participant) => {
            const displayName =
              memberName(input.members, participant.memberId) ?? participant.memberId
            return [
              {
                text:
                  participant.included === false
                    ? getBotTranslations(input.locale).purchase.participantToggleExcluded(
                        displayName
                      )
                    : getBotTranslations(input.locale).purchase.participantToggleIncluded(
                        displayName
                      ),
                callback_data: `${PURCHASE_NOTICE_PARTICIPANT_CALLBACK_PREFIX}${participant.id}`
              }
            ]
          })
      : []

  return {
    text: lines.filter((line): line is string => Boolean(line)).join('\n'),
    ...(participantButtons.length > 0
      ? {
          replyMarkup: {
            inline_keyboard: participantButtons
          }
        }
      : {})
  }
}

export function renderDeletedPurchaseTopicNotice(locale: BotLocale): string {
  return locale === 'ru' ? 'Покупка удалена.' : 'Purchase removed.'
}

function emptyInlineKeyboard(): InlineKeyboardMarkup {
  return { inline_keyboard: [] }
}

function telegramThreadId(value: string | null | undefined): number | undefined {
  if (!value) {
    return undefined
  }
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : undefined
}

function messageContext(ctx: Context): {
  chatId: string
  threadId: string
  messageId: string
} | null {
  const message = ctx.callbackQuery?.message
  if (!message) {
    return null
  }

  return {
    chatId: String(message.chat.id),
    threadId: message.message_thread_id !== undefined ? String(message.message_thread_id) : '',
    messageId: String(message.message_id)
  }
}

export function createPurchaseTopicNoticeService(input: {
  bot: Bot
  householdConfigurationRepository: Pick<
    HouseholdConfigurationRepository,
    | 'findHouseholdTopicByTelegramContext'
    | 'getHouseholdChatByHouseholdId'
    | 'getHouseholdTopicBinding'
    | 'getHouseholdMember'
    | 'listHouseholdMembers'
  >
  financeRepositoryForHousehold: (householdId: string) => FinanceRepository
  financeServiceForHousehold: (householdId: string) => FinanceCommandService
  logger?: Logger
}): PurchaseTopicNoticeService {
  async function localeForHousehold(householdId: string): Promise<BotLocale> {
    const household = await input.householdConfigurationRepository
      .getHouseholdChatByHouseholdId(householdId)
      .catch(() => null)
    return asBotLocale(household?.defaultLocale ?? 'en')
  }

  async function renderForPurchase(
    householdId: string,
    purchaseId: string
  ): Promise<RenderedPurchaseTopicNotice | null> {
    const repository = input.financeRepositoryForHousehold(householdId)
    const purchase = repository.ensureEqualPurchaseParticipants
      ? await repository.ensureEqualPurchaseParticipants(purchaseId)
      : await repository.getParsedPurchase?.(purchaseId)
    if (!purchase) {
      return null
    }

    const [locale, members] = await Promise.all([
      localeForHousehold(householdId),
      input.householdConfigurationRepository.listHouseholdMembers(householdId)
    ])
    return renderPurchaseTopicNotice({ locale, purchase, members })
  }

  async function recordFailedMapping(inputValue: {
    householdId: string
    purchaseId: string
    mapping?: {
      telegramChatId: string
      telegramThreadId: string
      telegramMessageId: string
    } | null
    error: unknown
  }) {
    if (!inputValue.mapping) {
      return
    }
    const repository = input.financeRepositoryForHousehold(inputValue.householdId)
    if (!repository.upsertPurchaseTopicMessage) {
      return
    }
    await repository
      .upsertPurchaseTopicMessage({
        purchaseMessageId: inputValue.purchaseId,
        telegramChatId: inputValue.mapping.telegramChatId,
        telegramThreadId: inputValue.mapping.telegramThreadId,
        telegramMessageId: inputValue.mapping.telegramMessageId,
        status: 'failed',
        lastError:
          inputValue.error instanceof Error ? inputValue.error.message : String(inputValue.error)
      })
      .catch(() => undefined)
  }

  async function syncExisting(inputValue: {
    householdId: string
    purchaseId: string
    mapping: {
      telegramChatId: string
      telegramThreadId: string
      telegramMessageId: string
    }
  }): Promise<boolean> {
    const rendered = await renderForPurchase(inputValue.householdId, inputValue.purchaseId)
    if (!rendered) {
      return false
    }

    try {
      await input.bot.api.editMessageText(
        inputValue.mapping.telegramChatId,
        Number(inputValue.mapping.telegramMessageId),
        rendered.text,
        rendered.replyMarkup ? { reply_markup: rendered.replyMarkup } : {}
      )
      const repository = input.financeRepositoryForHousehold(inputValue.householdId)
      await repository.upsertPurchaseTopicMessage?.({
        purchaseMessageId: inputValue.purchaseId,
        telegramChatId: inputValue.mapping.telegramChatId,
        telegramThreadId: inputValue.mapping.telegramThreadId,
        telegramMessageId: inputValue.mapping.telegramMessageId,
        status: 'sent',
        lastError: null
      })
      return true
    } catch (error) {
      input.logger?.warn(
        {
          event: 'purchase_topic_notice.edit_failed',
          householdId: inputValue.householdId,
          purchaseId: inputValue.purchaseId,
          error: error instanceof Error ? error.message : String(error)
        },
        'Failed to edit purchase topic notice'
      )
      await recordFailedMapping({ ...inputValue, error })
      return false
    }
  }

  const service: PurchaseTopicNoticeService = {
    async publishPurchase({ householdId, purchaseId }) {
      const rendered = await renderForPurchase(householdId, purchaseId).catch((error) => {
        input.logger?.warn(
          {
            event: 'purchase_topic_notice.render_failed',
            householdId,
            purchaseId,
            error: error instanceof Error ? error.message : String(error)
          },
          'Failed to render purchase topic notice'
        )
        return null
      })
      if (!rendered) {
        return
      }

      const [chat, topic] = await Promise.all([
        input.householdConfigurationRepository.getHouseholdChatByHouseholdId(householdId),
        input.householdConfigurationRepository.getHouseholdTopicBinding(householdId, 'purchase')
      ]).catch(() => [null, null] as const)
      if (!chat || !topic) {
        return
      }

      try {
        const threadId = telegramThreadId(topic.telegramThreadId)
        const message = await input.bot.api.sendMessage(chat.telegramChatId, rendered.text, {
          ...(threadId !== undefined
            ? {
                message_thread_id: threadId
              }
            : {}),
          ...(rendered.replyMarkup ? { reply_markup: rendered.replyMarkup } : {})
        })
        await input.financeRepositoryForHousehold(householdId).upsertPurchaseTopicMessage?.({
          purchaseMessageId: purchaseId,
          telegramChatId: chat.telegramChatId,
          telegramThreadId: topic.telegramThreadId,
          telegramMessageId: String(message.message_id),
          status: 'sent',
          lastError: null
        })
      } catch (error) {
        input.logger?.warn(
          {
            event: 'purchase_topic_notice.send_failed',
            householdId,
            purchaseId,
            error: error instanceof Error ? error.message : String(error)
          },
          'Failed to send purchase topic notice'
        )
      }
    },

    async syncPurchase({ householdId, purchaseId }) {
      const repository = input.financeRepositoryForHousehold(householdId)
      const mapping = repository.getPurchaseTopicMessage
        ? await repository.getPurchaseTopicMessage(purchaseId).catch(() => null)
        : null
      if (!mapping) {
        return
      }

      await syncExisting({
        householdId,
        purchaseId,
        mapping
      })
    },

    async markPurchaseDeleted({ householdId, purchaseId }) {
      const repository = input.financeRepositoryForHousehold(householdId)
      const mapping = repository.getPurchaseTopicMessage
        ? await repository.getPurchaseTopicMessage(purchaseId).catch(() => null)
        : null
      if (!mapping) {
        return
      }

      const locale = await localeForHousehold(householdId)
      try {
        await input.bot.api.editMessageText(
          mapping.telegramChatId,
          Number(mapping.telegramMessageId),
          renderDeletedPurchaseTopicNotice(locale),
          { reply_markup: emptyInlineKeyboard() }
        )
        await repository.upsertPurchaseTopicMessage?.({
          purchaseMessageId: purchaseId,
          telegramChatId: mapping.telegramChatId,
          telegramThreadId: mapping.telegramThreadId,
          telegramMessageId: mapping.telegramMessageId,
          status: 'deleted',
          lastError: null
        })
      } catch (error) {
        input.logger?.warn(
          {
            event: 'purchase_topic_notice.delete_edit_failed',
            householdId,
            purchaseId,
            error: error instanceof Error ? error.message : String(error)
          },
          'Failed to mark purchase topic notice deleted'
        )
        await recordFailedMapping({ householdId, purchaseId, mapping, error })
      }
    },

    async replaceExistingPurchaseMessage(inputValue) {
      return syncExisting({
        householdId: inputValue.householdId,
        purchaseId: inputValue.purchaseId,
        mapping: {
          telegramChatId: inputValue.telegramChatId,
          telegramThreadId: inputValue.telegramThreadId,
          telegramMessageId: inputValue.telegramMessageId
        }
      })
    }
  }

  input.bot.callbackQuery(
    new RegExp(`^${PURCHASE_NOTICE_PARTICIPANT_CALLBACK_PREFIX}([^:]+)$`),
    async (ctx) => {
      const participantId = ctx.match[1]
      const actorTelegramUserId = ctx.from?.id?.toString()
      const context = messageContext(ctx)
      if (!participantId || !actorTelegramUserId || !context) {
        await ctx.answerCallbackQuery()
        return
      }

      const binding =
        await input.householdConfigurationRepository.findHouseholdTopicByTelegramContext({
          telegramChatId: context.chatId,
          telegramThreadId: context.threadId
        })
      if (!binding || binding.role !== 'purchase') {
        await ctx.answerCallbackQuery()
        return
      }

      const locale = await localeForHousehold(binding.householdId)
      const t = getBotTranslations(locale).purchase
      const financeService = input.financeServiceForHousehold(binding.householdId)
      const result = financeService.togglePurchaseParticipant
        ? await financeService.togglePurchaseParticipant(participantId, actorTelegramUserId)
        : null

      if (!result || result.status === 'forbidden') {
        await ctx.answerCallbackQuery({ text: t.notYourProposal, show_alert: true })
        return
      }
      if (result.status !== 'updated') {
        await ctx.answerCallbackQuery({
          text:
            result.status === 'at_least_one_required'
              ? t.atLeastOneParticipant
              : t.proposalUnavailable,
          show_alert: true
        })
        return
      }

      const repository = input.financeRepositoryForHousehold(binding.householdId)
      const mapping = repository.getPurchaseTopicMessage
        ? await repository.getPurchaseTopicMessage(result.purchase.id)
        : null
      if (
        !mapping ||
        mapping.telegramChatId !== context.chatId ||
        mapping.telegramThreadId !== context.threadId ||
        mapping.telegramMessageId !== context.messageId
      ) {
        input.logger?.warn(
          {
            event: 'purchase_topic_notice.callback_mismatch',
            householdId: binding.householdId,
            purchaseId: result.purchase.id,
            callbackContext: context,
            mapping
          },
          'Rejected purchase topic notice callback for a mismatched message'
        )
        await ctx.answerCallbackQuery()
        return
      }

      const members = await input.householdConfigurationRepository.listHouseholdMembers(
        binding.householdId
      )
      const rendered = renderPurchaseTopicNotice({ locale, purchase: result.purchase, members })
      await ctx.editMessageText(
        rendered.text,
        rendered.replyMarkup ? { reply_markup: rendered.replyMarkup } : {}
      )
      await ctx.answerCallbackQuery()
    }
  )

  return service
}
