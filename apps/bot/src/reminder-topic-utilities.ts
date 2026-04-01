import type { FinanceCommandService } from '@household/application'
import { nowInstant } from '@household/domain'
import type { Logger } from '@household/observability'
import type {
  HouseholdConfigurationRepository,
  TelegramPendingActionRepository
} from '@household/ports'
import type { Bot, Context } from 'grammy'
import type { InlineKeyboardMarkup } from 'grammy/types'

import { getBotTranslations, type BotLocale } from './i18n'
import { resolveReplyLocale } from './bot-locale'
import { buildBotStartDeepLink } from './telegram-deep-links'

export const REMINDER_UTILITY_GUIDED_CALLBACK = 'reminder_util:guided'
export const REMINDER_UTILITY_TEMPLATE_CALLBACK = 'reminder_util:template'
const REMINDER_UTILITY_CONFIRM_CALLBACK_PREFIX = 'reminder_util:confirm:'
const REMINDER_UTILITY_CANCEL_CALLBACK_PREFIX = 'reminder_util:cancel:'
export const REMINDER_UTILITY_ACTION = 'reminder_utility_entry' as const
export const REMINDER_UTILITY_ACTION_TTL_MS = 30 * 60_000

type ReminderUtilityEntryPayload =
  | {
      stage: 'guided'
      householdId: string
      threadId: string
      period: string
      currency: 'GEL' | 'USD'
      memberId: string
      categories: readonly string[]
      currentIndex: number
      entries: readonly UtilityDraftEntry[]
    }
  | {
      stage: 'template'
      householdId: string
      threadId: string
      period: string
      currency: 'GEL' | 'USD'
      memberId: string
      categories: readonly string[]
    }
  | {
      stage: 'confirm'
      proposalId: string
      householdId: string
      threadId: string
      period: string
      currency: 'GEL' | 'USD'
      memberId: string
      entries: readonly UtilityDraftEntry[]
    }

type ReminderUtilityConfirmPayload = Extract<ReminderUtilityEntryPayload, { stage: 'confirm' }>

interface UtilityDraftEntry {
  billName: string
  amountMajor: string
}

interface ReminderTopicCandidate {
  chatId: string
  threadId: string
  senderTelegramUserId: string
  messageId: number
  rawText: string
}

function readMessageText(ctx: Context): string | null {
  const message = ctx.message
  if (!message) {
    return null
  }

  if ('text' in message && typeof message.text === 'string') {
    return message.text
  }

  if ('caption' in message && typeof message.caption === 'string') {
    return message.caption
  }

  return null
}

function toReminderTopicCandidate(ctx: Context): ReminderTopicCandidate | null {
  const message = ctx.message
  const rawText = readMessageText(ctx)?.trim()
  if (!message || !rawText) {
    return null
  }

  if (!('is_topic_message' in message) || message.is_topic_message !== true) {
    return null
  }

  if (!('message_thread_id' in message) || message.message_thread_id === undefined) {
    return null
  }

  const senderTelegramUserId = ctx.from?.id?.toString()
  if (!senderTelegramUserId) {
    return null
  }

  return {
    chatId: message.chat.id.toString(),
    threadId: message.message_thread_id.toString(),
    senderTelegramUserId,
    messageId: message.message_id,
    rawText
  }
}

function normalizeDraftAmount(raw: string): string | null {
  const match = raw.replace(',', '.').match(/\d+(?:\.\d{1,2})?/)
  if (!match) {
    return null
  }

  const parsed = Number(match[0])
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null
  }

  return parsed.toFixed(2)
}

function isSkipValue(raw: string): boolean {
  const normalized = raw.trim().toLowerCase()
  return (
    normalized === '0' ||
    normalized === 'skip' ||
    normalized === 'пропуск' ||
    normalized === 'нет' ||
    normalized === '-'
  )
}

function parseTemplateEntries(
  rawText: string,
  categories: readonly string[]
): readonly UtilityDraftEntry[] | null {
  const categoryByKey = new Map(
    categories.map((category) => [category.trim().toLowerCase(), category])
  )
  const entries: UtilityDraftEntry[] = []

  for (const line of rawText.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) {
      continue
    }

    const separatorIndex = trimmed.indexOf(':')
    if (separatorIndex <= 0) {
      continue
    }

    const rawCategory = trimmed.slice(0, separatorIndex).trim().toLowerCase()
    const category = categoryByKey.get(rawCategory)
    if (!category) {
      continue
    }

    const rawValue = trimmed.slice(separatorIndex + 1).trim()
    if (rawValue.length === 0 || isSkipValue(rawValue)) {
      continue
    }

    const amountMajor = normalizeDraftAmount(rawValue)
    if (!amountMajor || amountMajor === '0.00') {
      continue
    }

    entries.push({
      billName: category,
      amountMajor
    })
  }

  return entries.length > 0 ? entries : null
}

function escapeHtml(raw: string): string {
  return raw.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export function buildTemplateText(
  locale: BotLocale,
  currency: 'GEL' | 'USD',
  categories: readonly string[]
): {
  text: string
  parseMode: 'HTML'
} {
  const t = getBotTranslations(locale).reminders

  const templateLines = categories.map((category) => `${category}: `).join('\n')

  return {
    text: [
      escapeHtml(t.templateIntro(currency)),
      '',
      escapeHtml(
        locale === 'ru'
          ? 'Ответьте в этот топик, по одной строке на категорию.'
          : 'Reply in this topic with one line per category.'
      ),
      '',
      `<pre>${escapeHtml(templateLines)}</pre>`,
      '',
      escapeHtml(t.templateInstruction)
    ].join('\n'),
    parseMode: 'HTML'
  }
}

function reminderUtilitySummaryText(
  locale: BotLocale,
  period: string,
  currency: 'GEL' | 'USD',
  entries: readonly UtilityDraftEntry[]
): string {
  const t = getBotTranslations(locale).reminders

  return [
    t.summaryTitle(period),
    '',
    ...entries.map((entry) => t.summaryLine(entry.billName, entry.amountMajor, currency)),
    '',
    t.confirmPrompt
  ].join('\n')
}

function reminderUtilityReplyMarkup(locale: BotLocale) {
  const t = getBotTranslations(locale).reminders

  return (proposalId: string): InlineKeyboardMarkup => ({
    inline_keyboard: [
      [
        {
          text: t.confirmButton,
          callback_data: `${REMINDER_UTILITY_CONFIRM_CALLBACK_PREFIX}${proposalId}`
        },
        {
          text: t.cancelButton,
          callback_data: `${REMINDER_UTILITY_CANCEL_CALLBACK_PREFIX}${proposalId}`
        }
      ]
    ]
  })
}

function createReminderUtilityProposalId(): string {
  return crypto.randomUUID().slice(0, 8)
}

function buildReminderConfirmationPayload(input: {
  householdId: string
  threadId: string
  period: string
  currency: 'GEL' | 'USD'
  memberId: string
  entries: readonly UtilityDraftEntry[]
}): ReminderUtilityConfirmPayload {
  return {
    stage: 'confirm',
    proposalId: createReminderUtilityProposalId(),
    householdId: input.householdId,
    threadId: input.threadId,
    period: input.period,
    currency: input.currency,
    memberId: input.memberId,
    entries: input.entries
  }
}

async function replyInTopic(
  ctx: Context,
  text: string,
  replyMarkup?: InlineKeyboardMarkup,
  options?: {
    parseMode?: 'HTML'
  }
): Promise<void> {
  const message = ctx.msg
  if (!ctx.chat || !message) {
    return
  }

  const threadId =
    'message_thread_id' in message && message.message_thread_id !== undefined
      ? message.message_thread_id
      : undefined

  await ctx.api.sendMessage(ctx.chat.id, text, {
    ...(threadId !== undefined
      ? {
          message_thread_id: threadId
        }
      : {}),
    reply_parameters: {
      message_id: message.message_id
    },
    ...(replyMarkup
      ? {
          reply_markup: replyMarkup as InlineKeyboardMarkup
        }
      : {}),
    ...(options?.parseMode
      ? {
          parse_mode: options.parseMode
        }
      : {})
  })
}

async function resolveReminderContext(
  ctx: Context,
  householdConfigurationRepository: HouseholdConfigurationRepository,
  financeServiceForHousehold: (householdId: string) => FinanceCommandService
): Promise<{
  locale: BotLocale
  householdId: string
  threadId: string
  memberId: string
  categories: readonly string[]
  currency: 'GEL' | 'USD'
  period: string
} | null> {
  const threadId =
    ctx.msg && 'message_thread_id' in ctx.msg && ctx.msg.message_thread_id !== undefined
      ? ctx.msg.message_thread_id.toString()
      : null

  if (!ctx.chat || !threadId) {
    return null
  }

  const binding = await householdConfigurationRepository.findHouseholdTopicByTelegramContext({
    telegramChatId: ctx.chat.id.toString(),
    telegramThreadId: threadId
  })

  if (!binding || binding.role !== 'reminders') {
    return null
  }

  const telegramUserId = ctx.from?.id?.toString()
  if (!telegramUserId) {
    return null
  }

  const financeService = financeServiceForHousehold(binding.householdId)
  const [locale, member, settings, categories, cycle] = await Promise.all([
    resolveReplyLocale({
      ctx,
      repository: householdConfigurationRepository,
      householdId: binding.householdId
    }),
    financeService.getMemberByTelegramUserId(telegramUserId),
    householdConfigurationRepository.getHouseholdBillingSettings(binding.householdId),
    householdConfigurationRepository.listHouseholdUtilityCategories(binding.householdId),
    financeService.ensureExpectedCycle()
  ])

  if (!member) {
    return null
  }

  return {
    locale,
    householdId: binding.householdId,
    threadId,
    memberId: member.id,
    categories: categories
      .filter((category) => category.isActive)
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((category) => category.name),
    currency: settings.settlementCurrency,
    period: cycle.period
  }
}

export function buildUtilitiesReminderReplyMarkup(
  locale: BotLocale,
  options?: {
    miniAppUrl?: string
    botUsername?: string
  }
): InlineKeyboardMarkup {
  const t = getBotTranslations(locale).reminders
  const dashboardUrl = buildBotStartDeepLink(options?.botUsername, 'dashboard')

  return {
    inline_keyboard: [
      [
        {
          text: t.guidedEntryButton,
          callback_data: REMINDER_UTILITY_GUIDED_CALLBACK
        },
        {
          text: t.copyTemplateButton,
          callback_data: REMINDER_UTILITY_TEMPLATE_CALLBACK
        }
      ],
      ...(dashboardUrl
        ? [
            [
              {
                text: t.openDashboardButton,
                url: dashboardUrl
              }
            ]
          ]
        : [])
    ]
  }
}

export function registerReminderTopicUtilities(options: {
  bot: Bot
  householdConfigurationRepository: HouseholdConfigurationRepository
  promptRepository: TelegramPendingActionRepository
  financeServiceForHousehold: (householdId: string) => FinanceCommandService
  logger?: Logger
}): void {
  async function startFlow(ctx: Context, stage: 'guided' | 'template') {
    if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') {
      return
    }

    const reminderContext = await resolveReminderContext(
      ctx,
      options.householdConfigurationRepository,
      options.financeServiceForHousehold
    )

    if (!reminderContext) {
      return
    }

    const t = getBotTranslations(reminderContext.locale).reminders
    const actorTelegramUserId = ctx.from?.id?.toString()
    if (!actorTelegramUserId) {
      return
    }

    if (reminderContext.categories.length === 0) {
      await ctx.answerCallbackQuery({
        text: t.noActiveCategories,
        show_alert: true
      })
      return
    }

    if (stage === 'guided') {
      await options.promptRepository.upsertPendingAction({
        telegramUserId: actorTelegramUserId,
        telegramChatId: ctx.chat.id.toString(),
        action: REMINDER_UTILITY_ACTION,
        payload: {
          stage: 'guided',
          householdId: reminderContext.householdId,
          threadId: reminderContext.threadId,
          period: reminderContext.period,
          currency: reminderContext.currency,
          memberId: reminderContext.memberId,
          categories: reminderContext.categories,
          currentIndex: 0,
          entries: []
        } satisfies ReminderUtilityEntryPayload,
        expiresAt: nowInstant().add({ milliseconds: REMINDER_UTILITY_ACTION_TTL_MS })
      })

      await ctx.answerCallbackQuery({
        text: t.startToast
      })
      await replyInTopic(
        ctx,
        t.promptAmount(
          reminderContext.categories[0]!,
          reminderContext.currency,
          reminderContext.categories.length - 1
        )
      )
      return
    }

    await options.promptRepository.upsertPendingAction({
      telegramUserId: actorTelegramUserId,
      telegramChatId: ctx.chat.id.toString(),
      action: REMINDER_UTILITY_ACTION,
      payload: {
        stage: 'template',
        householdId: reminderContext.householdId,
        threadId: reminderContext.threadId,
        period: reminderContext.period,
        currency: reminderContext.currency,
        memberId: reminderContext.memberId,
        categories: reminderContext.categories
      } satisfies ReminderUtilityEntryPayload,
      expiresAt: nowInstant().add({ milliseconds: REMINDER_UTILITY_ACTION_TTL_MS })
    })

    await ctx.answerCallbackQuery({
      text: t.templateToast
    })
    const template = buildTemplateText(
      reminderContext.locale,
      reminderContext.currency,
      reminderContext.categories
    )
    await replyInTopic(ctx, template.text, undefined, {
      parseMode: template.parseMode
    })
  }

  options.bot.callbackQuery(REMINDER_UTILITY_GUIDED_CALLBACK, async (ctx) => {
    await startFlow(ctx, 'guided')
  })

  options.bot.callbackQuery(REMINDER_UTILITY_TEMPLATE_CALLBACK, async (ctx) => {
    await startFlow(ctx, 'template')
  })

  const handleReminderUtilityConfirm = async (ctx: Context, proposalId: string) => {
    const messageChat =
      ctx.callbackQuery && 'message' in ctx.callbackQuery
        ? ctx.callbackQuery.message?.chat
        : undefined
    if (messageChat?.type !== 'group' && messageChat?.type !== 'supergroup') {
      return
    }

    const actorTelegramUserId = ctx.from?.id?.toString()
    if (!actorTelegramUserId || !messageChat || !proposalId) {
      return
    }

    const locale = await resolveReplyLocale({
      ctx,
      repository: options.householdConfigurationRepository
    })
    const t = getBotTranslations(locale).reminders
    const pending = await options.promptRepository.getPendingAction(
      messageChat.id.toString(),
      actorTelegramUserId
    )
    const payload =
      pending?.action === REMINDER_UTILITY_ACTION
        ? (pending.payload as Partial<ReminderUtilityEntryPayload>)
        : null

    if (
      !payload ||
      payload.stage !== 'confirm' ||
      !Array.isArray(payload.entries) ||
      payload.proposalId !== proposalId
    ) {
      await ctx.answerCallbackQuery({
        text: t.proposalUnavailable,
        show_alert: true
      })
      return
    }

    const financeService = options.financeServiceForHousehold(payload.householdId!)
    for (const entry of payload.entries) {
      await financeService.addUtilityBill(
        entry.billName,
        entry.amountMajor,
        payload.memberId!,
        payload.currency
      )
    }

    await options.promptRepository.clearPendingAction(
      messageChat.id.toString(),
      actorTelegramUserId
    )
    await ctx.answerCallbackQuery({
      text: t.saved(payload.entries.length, payload.period!)
    })

    if (ctx.msg) {
      await ctx.editMessageText(t.saved(payload.entries.length, payload.period!), {
        reply_markup: {
          inline_keyboard: []
        }
      })
    }
  }

  const handleReminderUtilityCancel = async (ctx: Context, proposalId: string) => {
    const messageChat =
      ctx.callbackQuery && 'message' in ctx.callbackQuery
        ? ctx.callbackQuery.message?.chat
        : undefined
    if (messageChat?.type !== 'group' && messageChat?.type !== 'supergroup') {
      return
    }

    const actorTelegramUserId = ctx.from?.id?.toString()
    if (!actorTelegramUserId || !messageChat || !proposalId) {
      return
    }

    const locale = await resolveReplyLocale({
      ctx,
      repository: options.householdConfigurationRepository
    })
    const t = getBotTranslations(locale).reminders
    const pending = await options.promptRepository.getPendingAction(
      messageChat.id.toString(),
      actorTelegramUserId
    )
    const payload =
      pending?.action === REMINDER_UTILITY_ACTION
        ? (pending.payload as Partial<ReminderUtilityEntryPayload>)
        : null

    if (!payload || payload.stage !== 'confirm' || payload.proposalId !== proposalId) {
      await ctx.answerCallbackQuery({
        text: t.proposalUnavailable,
        show_alert: true
      })
      return
    }

    await options.promptRepository.clearPendingAction(
      messageChat.id.toString(),
      actorTelegramUserId
    )
    await ctx.answerCallbackQuery({
      text: t.cancelled
    })

    if (ctx.msg) {
      await ctx.editMessageText(t.cancelled, {
        reply_markup: {
          inline_keyboard: []
        }
      })
    }
  }

  options.bot.on('callback_query:data', async (ctx, next) => {
    const data = typeof ctx.callbackQuery?.data === 'string' ? ctx.callbackQuery.data : null
    if (!data) {
      await next()
      return
    }

    if (data.startsWith(REMINDER_UTILITY_CONFIRM_CALLBACK_PREFIX)) {
      await handleReminderUtilityConfirm(
        ctx,
        data.slice(REMINDER_UTILITY_CONFIRM_CALLBACK_PREFIX.length)
      )
      return
    }

    if (data.startsWith(REMINDER_UTILITY_CANCEL_CALLBACK_PREFIX)) {
      await handleReminderUtilityCancel(
        ctx,
        data.slice(REMINDER_UTILITY_CANCEL_CALLBACK_PREFIX.length)
      )
      return
    }

    await next()
  })

  options.bot.on('message', async (ctx, next) => {
    const candidate = toReminderTopicCandidate(ctx)
    if (!candidate || candidate.rawText.startsWith('/')) {
      await next()
      return
    }

    const pending = await options.promptRepository.getPendingAction(
      candidate.chatId,
      candidate.senderTelegramUserId
    )
    const payload =
      pending?.action === REMINDER_UTILITY_ACTION
        ? (pending.payload as Partial<ReminderUtilityEntryPayload>)
        : null

    if (!payload || payload.threadId !== candidate.threadId) {
      await next()
      return
    }

    const localeOptions = payload.householdId
      ? {
          ctx,
          repository: options.householdConfigurationRepository,
          householdId: payload.householdId
        }
      : {
          ctx,
          repository: options.householdConfigurationRepository
        }
    const locale = await resolveReplyLocale(localeOptions)
    const t = getBotTranslations(locale).reminders

    try {
      if (payload.stage === 'guided' && Array.isArray(payload.categories)) {
        if (isSkipValue(candidate.rawText)) {
          const nextPayload: ReminderUtilityEntryPayload = {
            stage: 'guided',
            householdId: payload.householdId!,
            threadId: payload.threadId!,
            period: payload.period!,
            currency: payload.currency!,
            memberId: payload.memberId!,
            categories: payload.categories,
            currentIndex: (payload.currentIndex ?? 0) + 1,
            entries: payload.entries ?? []
          }
          const nextIndex = (payload.currentIndex ?? 0) + 1
          const nextCategory = payload.categories[nextIndex]
          if (!nextCategory) {
            const confirmationPayload = buildReminderConfirmationPayload({
              householdId: payload.householdId!,
              threadId: payload.threadId!,
              period: payload.period!,
              currency: payload.currency!,
              memberId: payload.memberId!,
              entries: payload.entries ?? []
            })
            await options.promptRepository.upsertPendingAction({
              telegramUserId: candidate.senderTelegramUserId,
              telegramChatId: candidate.chatId,
              action: REMINDER_UTILITY_ACTION,
              payload: confirmationPayload,
              expiresAt: nowInstant().add({ milliseconds: REMINDER_UTILITY_ACTION_TTL_MS })
            })

            if ((payload.entries?.length ?? 0) === 0) {
              await options.promptRepository.clearPendingAction(
                candidate.chatId,
                candidate.senderTelegramUserId
              )
              await replyInTopic(ctx, t.cancelled)
              return
            }

            await replyInTopic(
              ctx,
              reminderUtilitySummaryText(
                locale,
                payload.period!,
                payload.currency!,
                payload.entries ?? []
              ),
              reminderUtilityReplyMarkup(locale)(confirmationPayload.proposalId)
            )
            return
          }

          await options.promptRepository.upsertPendingAction({
            telegramUserId: candidate.senderTelegramUserId,
            telegramChatId: candidate.chatId,
            action: REMINDER_UTILITY_ACTION,
            payload: nextPayload,
            expiresAt: nowInstant().add({ milliseconds: REMINDER_UTILITY_ACTION_TTL_MS })
          })

          await replyInTopic(
            ctx,
            t.promptAmount(
              nextCategory,
              payload.currency!,
              payload.categories.length - nextIndex - 1
            )
          )
          return
        }

        const amountMajor = normalizeDraftAmount(candidate.rawText)
        const currentIndex = payload.currentIndex ?? 0
        const currentCategory = payload.categories[currentIndex]
        if (!amountMajor || !currentCategory) {
          await replyInTopic(
            ctx,
            t.invalidAmount(
              currentCategory ?? payload.categories[0] ?? 'utility',
              payload.currency ?? 'GEL'
            )
          )
          return
        }

        const nextEntries = [...(payload.entries ?? []), { billName: currentCategory, amountMajor }]
        const nextIndex = currentIndex + 1
        const nextCategory = payload.categories[nextIndex]

        if (!nextCategory) {
          const confirmationPayload = buildReminderConfirmationPayload({
            householdId: payload.householdId!,
            threadId: payload.threadId!,
            period: payload.period!,
            currency: payload.currency!,
            memberId: payload.memberId!,
            entries: nextEntries
          })
          await options.promptRepository.upsertPendingAction({
            telegramUserId: candidate.senderTelegramUserId,
            telegramChatId: candidate.chatId,
            action: REMINDER_UTILITY_ACTION,
            payload: confirmationPayload,
            expiresAt: nowInstant().add({ milliseconds: REMINDER_UTILITY_ACTION_TTL_MS })
          })

          await replyInTopic(
            ctx,
            reminderUtilitySummaryText(locale, payload.period!, payload.currency!, nextEntries),
            reminderUtilityReplyMarkup(locale)(confirmationPayload.proposalId)
          )
          return
        }

        await options.promptRepository.upsertPendingAction({
          telegramUserId: candidate.senderTelegramUserId,
          telegramChatId: candidate.chatId,
          action: REMINDER_UTILITY_ACTION,
          payload: {
            stage: 'guided',
            householdId: payload.householdId!,
            threadId: payload.threadId!,
            period: payload.period!,
            currency: payload.currency!,
            memberId: payload.memberId!,
            categories: payload.categories,
            currentIndex: nextIndex,
            entries: nextEntries
          } as ReminderUtilityEntryPayload,
          expiresAt: nowInstant().add({ milliseconds: REMINDER_UTILITY_ACTION_TTL_MS })
        })

        await replyInTopic(
          ctx,
          t.promptAmount(nextCategory, payload.currency!, payload.categories.length - nextIndex - 1)
        )
        return
      }

      if (payload.stage === 'template' && Array.isArray(payload.categories)) {
        if (isSkipValue(candidate.rawText) || candidate.rawText.trim().toLowerCase() === 'cancel') {
          await options.promptRepository.clearPendingAction(
            candidate.chatId,
            candidate.senderTelegramUserId
          )
          await replyInTopic(ctx, t.cancelled)
          return
        }

        const entries = parseTemplateEntries(candidate.rawText, payload.categories)
        if (!entries) {
          await replyInTopic(ctx, t.templateInvalid)
          return
        }

        const confirmationPayload = buildReminderConfirmationPayload({
          householdId: payload.householdId!,
          threadId: payload.threadId!,
          period: payload.period!,
          currency: payload.currency!,
          memberId: payload.memberId!,
          entries
        })
        await options.promptRepository.upsertPendingAction({
          telegramUserId: candidate.senderTelegramUserId,
          telegramChatId: candidate.chatId,
          action: REMINDER_UTILITY_ACTION,
          payload: confirmationPayload,
          expiresAt: nowInstant().add({ milliseconds: REMINDER_UTILITY_ACTION_TTL_MS })
        })

        await replyInTopic(
          ctx,
          reminderUtilitySummaryText(locale, payload.period!, payload.currency!, entries),
          reminderUtilityReplyMarkup(locale)(confirmationPayload.proposalId)
        )
        return
      }

      await next()
    } catch (error) {
      options.logger?.error(
        {
          event: 'reminder.utility_entry_failed',
          chatId: candidate.chatId,
          threadId: candidate.threadId,
          messageId: candidate.messageId,
          error
        },
        'Failed to process reminder utility entry'
      )
    }
  })
}
