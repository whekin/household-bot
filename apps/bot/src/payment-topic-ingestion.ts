import type { FinanceCommandService, PaymentConfirmationService } from '@household/application'
import { Money } from '@household/domain'
import { instantFromEpochSeconds, nowInstant, type Instant } from '@household/domain'
import type { Bot, Context } from 'grammy'
import type { Logger } from '@household/observability'
import type {
  HouseholdConfigurationRepository,
  HouseholdTopicBindingRecord,
  TelegramPendingActionRepository
} from '@household/ports'

import { getBotTranslations, type BotLocale } from './i18n'
import {
  maybeCreatePaymentProposal,
  parsePaymentProposalPayload,
  synthesizePaymentConfirmationText
} from './payment-proposals'

const PAYMENT_TOPIC_CONFIRM_CALLBACK_PREFIX = 'payment_topic:confirm:'
const PAYMENT_TOPIC_CANCEL_CALLBACK_PREFIX = 'payment_topic:cancel:'
const PAYMENT_TOPIC_CLARIFICATION_ACTION = 'payment_topic_clarification' as const
const PAYMENT_TOPIC_CONFIRMATION_ACTION = 'payment_topic_confirmation' as const
const PAYMENT_TOPIC_ACTION_TTL_MS = 30 * 60_000

export interface PaymentTopicCandidate {
  updateId: number
  chatId: string
  messageId: string
  threadId: string
  senderTelegramUserId: string
  rawText: string
  attachmentCount: number
  messageSentAt: Instant
}

export interface PaymentTopicRecord extends PaymentTopicCandidate {
  householdId: string
}

interface PaymentTopicClarificationPayload {
  threadId: string
  rawText: string
}

interface PaymentTopicConfirmationPayload {
  proposalId: string
  householdId: string
  memberId: string
  kind: 'rent' | 'utilities'
  amountMinor: string
  currency: 'GEL' | 'USD'
  rawText: string
  senderTelegramUserId: string
  telegramChatId: string
  telegramMessageId: string
  telegramThreadId: string
  telegramUpdateId: string
  attachmentCount: number
  messageSentAt: Instant | null
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

function attachmentCount(ctx: Context): number {
  const message = ctx.message
  if (!message) {
    return 0
  }

  if ('photo' in message && Array.isArray(message.photo)) {
    return message.photo.length
  }

  if ('document' in message && message.document) {
    return 1
  }

  return 0
}

function toCandidateFromContext(ctx: Context): PaymentTopicCandidate | null {
  const message = ctx.message
  const rawText = readMessageText(ctx)
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
    updateId: ctx.update.update_id,
    chatId: message.chat.id.toString(),
    messageId: message.message_id.toString(),
    threadId: message.message_thread_id.toString(),
    senderTelegramUserId,
    rawText,
    attachmentCount: attachmentCount(ctx),
    messageSentAt: instantFromEpochSeconds(message.date)
  }
}

export function resolveConfiguredPaymentTopicRecord(
  value: PaymentTopicCandidate,
  binding: HouseholdTopicBindingRecord
): PaymentTopicRecord | null {
  const normalizedText = value.rawText.trim()
  if (normalizedText.length === 0) {
    return null
  }

  if (normalizedText.startsWith('/')) {
    return null
  }

  if (binding.role !== 'payments') {
    return null
  }

  return {
    ...value,
    rawText: normalizedText,
    householdId: binding.householdId
  }
}

export function buildPaymentAcknowledgement(
  locale: BotLocale,
  result:
    | { status: 'duplicate' }
    | {
        status: 'recorded'
        kind: 'rent' | 'utilities'
        amountMajor: string
        currency: 'USD' | 'GEL'
      }
    | { status: 'needs_review' }
): string | null {
  const t = getBotTranslations(locale).payments

  switch (result.status) {
    case 'duplicate':
      return null
    case 'recorded':
      return t.recorded(result.kind, result.amountMajor, result.currency)
    case 'needs_review':
      return null
  }
}

function parsePaymentClarificationPayload(
  payload: Record<string, unknown>
): PaymentTopicClarificationPayload | null {
  if (typeof payload.threadId !== 'string' || typeof payload.rawText !== 'string') {
    return null
  }

  return {
    threadId: payload.threadId,
    rawText: payload.rawText
  }
}

function parsePaymentTopicConfirmationPayload(
  payload: Record<string, unknown>
): PaymentTopicConfirmationPayload | null {
  const proposal = parsePaymentProposalPayload(payload)
  if (
    !proposal ||
    typeof payload.rawText !== 'string' ||
    typeof payload.senderTelegramUserId !== 'string' ||
    typeof payload.telegramChatId !== 'string' ||
    typeof payload.telegramMessageId !== 'string' ||
    typeof payload.telegramThreadId !== 'string' ||
    typeof payload.telegramUpdateId !== 'string' ||
    typeof payload.attachmentCount !== 'number'
  ) {
    return null
  }

  return {
    ...proposal,
    rawText: payload.rawText,
    senderTelegramUserId: payload.senderTelegramUserId,
    telegramChatId: payload.telegramChatId,
    telegramMessageId: payload.telegramMessageId,
    telegramThreadId: payload.telegramThreadId,
    telegramUpdateId: payload.telegramUpdateId,
    attachmentCount: payload.attachmentCount,
    messageSentAt: null
  }
}

function paymentProposalReplyMarkup(locale: BotLocale, proposalId: string) {
  const t = getBotTranslations(locale).payments

  return {
    inline_keyboard: [
      [
        {
          text: t.confirmButton,
          callback_data: `${PAYMENT_TOPIC_CONFIRM_CALLBACK_PREFIX}${proposalId}`
        },
        {
          text: t.cancelButton,
          callback_data: `${PAYMENT_TOPIC_CANCEL_CALLBACK_PREFIX}${proposalId}`
        }
      ]
    ]
  }
}

async function replyToPaymentMessage(
  ctx: Context,
  text: string,
  replyMarkup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }
): Promise<void> {
  const message = ctx.msg
  if (!message) {
    return
  }

  await ctx.reply(text, {
    reply_parameters: {
      message_id: message.message_id
    },
    ...(replyMarkup
      ? {
          reply_markup: replyMarkup
        }
      : {})
  })
}

export function registerConfiguredPaymentTopicIngestion(
  bot: Bot,
  householdConfigurationRepository: HouseholdConfigurationRepository,
  promptRepository: TelegramPendingActionRepository,
  financeServiceForHousehold: (householdId: string) => FinanceCommandService,
  paymentServiceForHousehold: (householdId: string) => PaymentConfirmationService,
  options: {
    logger?: Logger
  } = {}
): void {
  bot.callbackQuery(
    new RegExp(`^${PAYMENT_TOPIC_CONFIRM_CALLBACK_PREFIX}([^:]+)$`),
    async (ctx) => {
      if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') {
        return
      }

      const actorTelegramUserId = ctx.from?.id?.toString()
      const proposalId = ctx.match[1]
      if (!actorTelegramUserId || !proposalId) {
        return
      }

      const locale = await resolveTopicLocale(ctx, householdConfigurationRepository)
      const t = getBotTranslations(locale).payments

      const pending = await promptRepository.getPendingAction(
        ctx.chat.id.toString(),
        actorTelegramUserId
      )
      const payload =
        pending?.action === PAYMENT_TOPIC_CONFIRMATION_ACTION
          ? parsePaymentTopicConfirmationPayload(pending.payload)
          : null

      if (!payload || payload.proposalId !== proposalId) {
        await ctx.answerCallbackQuery({
          text: t.proposalUnavailable,
          show_alert: true
        })
        return
      }

      if (payload.senderTelegramUserId !== actorTelegramUserId) {
        await ctx.answerCallbackQuery({
          text: t.notYourProposal,
          show_alert: true
        })
        return
      }

      const paymentService = paymentServiceForHousehold(payload.householdId)
      const result = await paymentService.submit({
        ...payload,
        rawText: synthesizePaymentConfirmationText(payload)
      })

      await promptRepository.clearPendingAction(ctx.chat.id.toString(), actorTelegramUserId)

      if (result.status !== 'recorded') {
        await ctx.answerCallbackQuery({
          text: t.proposalUnavailable,
          show_alert: true
        })
        return
      }

      const recordedText = t.recorded(
        result.kind,
        result.amount.toMajorString(),
        result.amount.currency
      )
      await ctx.answerCallbackQuery({
        text: recordedText
      })

      if (ctx.msg) {
        await ctx.editMessageText(recordedText, {
          reply_markup: {
            inline_keyboard: []
          }
        })
      }
    }
  )

  bot.callbackQuery(new RegExp(`^${PAYMENT_TOPIC_CANCEL_CALLBACK_PREFIX}([^:]+)$`), async (ctx) => {
    if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') {
      return
    }

    const actorTelegramUserId = ctx.from?.id?.toString()
    const proposalId = ctx.match[1]
    if (!actorTelegramUserId || !proposalId) {
      return
    }

    const locale = await resolveTopicLocale(ctx, householdConfigurationRepository)
    const t = getBotTranslations(locale).payments

    const pending = await promptRepository.getPendingAction(
      ctx.chat.id.toString(),
      actorTelegramUserId
    )
    const payload =
      pending?.action === PAYMENT_TOPIC_CONFIRMATION_ACTION
        ? parsePaymentTopicConfirmationPayload(pending.payload)
        : null

    if (!payload || payload.proposalId !== proposalId) {
      await ctx.answerCallbackQuery({
        text: t.proposalUnavailable,
        show_alert: true
      })
      return
    }

    if (payload.senderTelegramUserId !== actorTelegramUserId) {
      await ctx.answerCallbackQuery({
        text: t.notYourProposal,
        show_alert: true
      })
      return
    }

    await promptRepository.clearPendingAction(ctx.chat.id.toString(), actorTelegramUserId)
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
  })

  bot.on('message', async (ctx, next) => {
    const candidate = toCandidateFromContext(ctx)
    if (!candidate) {
      await next()
      return
    }

    const binding = await householdConfigurationRepository.findHouseholdTopicByTelegramContext({
      telegramChatId: candidate.chatId,
      telegramThreadId: candidate.threadId
    })

    if (!binding) {
      await next()
      return
    }

    const record = resolveConfiguredPaymentTopicRecord(candidate, binding)
    if (!record) {
      await next()
      return
    }

    try {
      const locale = await resolveTopicLocale(ctx, householdConfigurationRepository)
      const t = getBotTranslations(locale).payments
      const financeService = financeServiceForHousehold(record.householdId)
      const member = await financeService.getMemberByTelegramUserId(record.senderTelegramUserId)
      const pending = await promptRepository.getPendingAction(
        record.chatId,
        record.senderTelegramUserId
      )
      const clarificationPayload =
        pending?.action === PAYMENT_TOPIC_CLARIFICATION_ACTION
          ? parsePaymentClarificationPayload(pending.payload)
          : null
      const combinedText =
        clarificationPayload && clarificationPayload.threadId === record.threadId
          ? `${clarificationPayload.rawText}\n${record.rawText}`
          : record.rawText

      if (!member) {
        await next()
        return
      }

      const proposal = await maybeCreatePaymentProposal({
        rawText: combinedText,
        householdId: record.householdId,
        memberId: member.id,
        financeService,
        householdConfigurationRepository
      })

      if (proposal.status === 'no_intent') {
        await next()
        return
      }

      if (proposal.status === 'clarification') {
        await promptRepository.upsertPendingAction({
          telegramUserId: record.senderTelegramUserId,
          telegramChatId: record.chatId,
          action: PAYMENT_TOPIC_CLARIFICATION_ACTION,
          payload: {
            threadId: record.threadId,
            rawText: combinedText
          },
          expiresAt: nowInstant().add({ milliseconds: PAYMENT_TOPIC_ACTION_TTL_MS })
        })

        await replyToPaymentMessage(ctx, t.clarification)
        return
      }

      await promptRepository.clearPendingAction(record.chatId, record.senderTelegramUserId)

      if (proposal.status === 'unsupported_currency') {
        await replyToPaymentMessage(ctx, t.unsupportedCurrency)
        return
      }

      if (proposal.status === 'no_balance') {
        await replyToPaymentMessage(ctx, t.noBalance)
        return
      }

      if (proposal.status === 'proposal') {
        const amount = Money.fromMinor(
          BigInt(proposal.payload.amountMinor),
          proposal.payload.currency
        )
        await promptRepository.upsertPendingAction({
          telegramUserId: record.senderTelegramUserId,
          telegramChatId: record.chatId,
          action: PAYMENT_TOPIC_CONFIRMATION_ACTION,
          payload: {
            ...proposal.payload,
            senderTelegramUserId: record.senderTelegramUserId,
            rawText: combinedText,
            telegramChatId: record.chatId,
            telegramMessageId: record.messageId,
            telegramThreadId: record.threadId,
            telegramUpdateId: String(record.updateId),
            attachmentCount: record.attachmentCount
          },
          expiresAt: nowInstant().add({ milliseconds: PAYMENT_TOPIC_ACTION_TTL_MS })
        })

        await replyToPaymentMessage(
          ctx,
          t.proposal(proposal.payload.kind, amount.toMajorString(), amount.currency),
          paymentProposalReplyMarkup(locale, proposal.payload.proposalId)
        )
      }
    } catch (error) {
      options.logger?.error(
        {
          event: 'payment.ingest_failed',
          chatId: record.chatId,
          threadId: record.threadId,
          messageId: record.messageId,
          updateId: record.updateId,
          error
        },
        'Failed to ingest payment confirmation'
      )
    }
  })
}

async function resolveTopicLocale(
  ctx: Context,
  householdConfigurationRepository: HouseholdConfigurationRepository
): Promise<BotLocale> {
  const binding =
    ctx.chat && ctx.msg && 'message_thread_id' in ctx.msg && ctx.msg.message_thread_id !== undefined
      ? await householdConfigurationRepository.findHouseholdTopicByTelegramContext({
          telegramChatId: ctx.chat.id.toString(),
          telegramThreadId: ctx.msg.message_thread_id.toString()
        })
      : null

  if (!binding) {
    return 'en'
  }

  const householdChat = await householdConfigurationRepository.getHouseholdChatByHouseholdId(
    binding.householdId
  )

  return householdChat?.defaultLocale ?? 'en'
}
