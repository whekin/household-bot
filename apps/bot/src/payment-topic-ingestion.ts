import type { PaymentConfirmationService } from '@household/application'
import { instantFromEpochSeconds, type Instant } from '@household/domain'
import type { Bot, Context } from 'grammy'
import type { Logger } from '@household/observability'
import type {
  HouseholdConfigurationRepository,
  HouseholdTopicBindingRecord
} from '@household/ports'

import { getBotTranslations, type BotLocale } from './i18n'

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
      return t.savedForReview
  }
}

async function replyToPaymentMessage(ctx: Context, text: string): Promise<void> {
  const message = ctx.msg
  if (!message) {
    return
  }

  await ctx.reply(text, {
    reply_parameters: {
      message_id: message.message_id
    }
  })
}

export function registerConfiguredPaymentTopicIngestion(
  bot: Bot,
  householdConfigurationRepository: HouseholdConfigurationRepository,
  paymentServiceForHousehold: (householdId: string) => PaymentConfirmationService,
  options: {
    logger?: Logger
  } = {}
): void {
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
      const result = await paymentServiceForHousehold(record.householdId).submit({
        senderTelegramUserId: record.senderTelegramUserId,
        rawText: record.rawText,
        telegramChatId: record.chatId,
        telegramMessageId: record.messageId,
        telegramThreadId: record.threadId,
        telegramUpdateId: String(record.updateId),
        attachmentCount: record.attachmentCount,
        messageSentAt: record.messageSentAt
      })
      const householdChat = await householdConfigurationRepository.getHouseholdChatByHouseholdId(
        record.householdId
      )
      const locale = householdChat?.defaultLocale ?? 'en'
      const acknowledgement = buildPaymentAcknowledgement(
        locale,
        result.status === 'recorded'
          ? {
              status: 'recorded',
              kind: result.kind,
              amountMajor: result.amount.toMajorString(),
              currency: result.amount.currency
            }
          : result
      )

      if (acknowledgement) {
        await replyToPaymentMessage(ctx, acknowledgement)
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
