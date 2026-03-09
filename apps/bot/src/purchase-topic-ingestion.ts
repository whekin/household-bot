import { parsePurchaseMessage, type PurchaseParserLlmFallback } from '@household/application'
import { instantFromEpochSeconds, instantToDate, Money, type Instant } from '@household/domain'
import { and, eq } from 'drizzle-orm'
import type { Bot, Context } from 'grammy'
import type { Logger } from '@household/observability'
import type {
  HouseholdConfigurationRepository,
  HouseholdTopicBindingRecord
} from '@household/ports'

import { createDbClient, schema } from '@household/db'
import { botLocaleFromContext, getBotTranslations, type BotLocale } from './i18n'

export interface PurchaseTopicIngestionConfig {
  householdId: string
  householdChatId: string
  purchaseTopicId: number
}

export interface PurchaseTopicCandidate {
  updateId: number
  chatId: string
  messageId: string
  threadId: string
  senderTelegramUserId: string
  senderDisplayName?: string
  rawText: string
  messageSentAt: Instant
}

export interface PurchaseTopicRecord extends PurchaseTopicCandidate {
  householdId: string
}

export type PurchaseMessageProcessingStatus = 'parsed' | 'needs_review' | 'parse_failed'

export type PurchaseMessageIngestionResult =
  | {
      status: 'duplicate'
    }
  | {
      status: 'created'
      processingStatus: PurchaseMessageProcessingStatus
      parsedAmountMinor: bigint | null
      parsedCurrency: 'GEL' | 'USD' | null
      parsedItemDescription: string | null
      parserConfidence: number | null
      parserMode: 'rules' | 'llm' | null
    }

export interface PurchaseMessageIngestionRepository {
  save(
    record: PurchaseTopicRecord,
    llmFallback?: PurchaseParserLlmFallback
  ): Promise<PurchaseMessageIngestionResult>
}

export function extractPurchaseTopicCandidate(
  value: PurchaseTopicCandidate,
  config: PurchaseTopicIngestionConfig
): PurchaseTopicRecord | null {
  if (value.rawText.trim().startsWith('/')) {
    return null
  }

  if (value.chatId !== config.householdChatId) {
    return null
  }

  if (value.threadId !== String(config.purchaseTopicId)) {
    return null
  }

  const normalizedText = value.rawText.trim()
  if (normalizedText.length === 0) {
    return null
  }

  return {
    ...value,
    rawText: normalizedText,
    householdId: config.householdId
  }
}

export function resolveConfiguredPurchaseTopicRecord(
  value: PurchaseTopicCandidate,
  binding: HouseholdTopicBindingRecord
): PurchaseTopicRecord | null {
  if (value.rawText.trim().startsWith('/')) {
    return null
  }

  if (binding.role !== 'purchase') {
    return null
  }

  const normalizedText = value.rawText.trim()
  if (normalizedText.length === 0) {
    return null
  }

  return {
    ...value,
    rawText: normalizedText,
    householdId: binding.householdId
  }
}

function needsReviewAsInt(value: boolean): number {
  return value ? 1 : 0
}

export function createPurchaseMessageRepository(databaseUrl: string): {
  repository: PurchaseMessageIngestionRepository
  close: () => Promise<void>
} {
  const { db, queryClient } = createDbClient(databaseUrl, {
    max: 5,
    prepare: false
  })

  const repository: PurchaseMessageIngestionRepository = {
    async save(record, llmFallback) {
      const matchedMember = await db
        .select({ id: schema.members.id })
        .from(schema.members)
        .where(
          and(
            eq(schema.members.householdId, record.householdId),
            eq(schema.members.telegramUserId, record.senderTelegramUserId)
          )
        )
        .limit(1)

      const senderMemberId = matchedMember[0]?.id ?? null
      let parserError: string | null = null

      const parsed = await parsePurchaseMessage(
        {
          rawText: record.rawText
        },
        llmFallback
          ? {
              llmFallback
            }
          : {}
      ).catch((error) => {
        parserError = error instanceof Error ? error.message : 'Unknown parser error'
        return null
      })

      const processingStatus =
        parserError !== null
          ? 'parse_failed'
          : parsed === null
            ? 'needs_review'
            : parsed.needsReview
              ? 'needs_review'
              : 'parsed'

      const inserted = await db
        .insert(schema.purchaseMessages)
        .values({
          householdId: record.householdId,
          senderMemberId,
          senderTelegramUserId: record.senderTelegramUserId,
          senderDisplayName: record.senderDisplayName,
          rawText: record.rawText,
          telegramChatId: record.chatId,
          telegramMessageId: record.messageId,
          telegramThreadId: record.threadId,
          telegramUpdateId: String(record.updateId),
          messageSentAt: instantToDate(record.messageSentAt),
          parsedAmountMinor: parsed?.amountMinor,
          parsedCurrency: parsed?.currency,
          parsedItemDescription: parsed?.itemDescription,
          parserMode: parsed?.parserMode,
          parserConfidence: parsed?.confidence,
          needsReview: needsReviewAsInt(parsed?.needsReview ?? true),
          parserError,
          processingStatus
        })
        .onConflictDoNothing({
          target: [
            schema.purchaseMessages.householdId,
            schema.purchaseMessages.telegramChatId,
            schema.purchaseMessages.telegramMessageId
          ]
        })
        .returning({ id: schema.purchaseMessages.id })

      if (inserted.length === 0) {
        return {
          status: 'duplicate'
        }
      }

      return {
        status: 'created',
        processingStatus,
        parsedAmountMinor: parsed?.amountMinor ?? null,
        parsedCurrency: parsed?.currency ?? null,
        parsedItemDescription: parsed?.itemDescription ?? null,
        parserConfidence: parsed?.confidence ?? null,
        parserMode: parsed?.parserMode ?? null
      }
    }
  }

  return {
    repository,
    close: async () => {
      await queryClient.end({ timeout: 5 })
    }
  }
}

function formatPurchaseSummary(
  locale: BotLocale,
  result: Extract<PurchaseMessageIngestionResult, { status: 'created' }>
): string {
  if (
    result.parsedAmountMinor === null ||
    result.parsedCurrency === null ||
    result.parsedItemDescription === null
  ) {
    return getBotTranslations(locale).purchase.sharedPurchaseFallback
  }

  const amount = Money.fromMinor(result.parsedAmountMinor, result.parsedCurrency)
  return `${result.parsedItemDescription} - ${amount.toMajorString()} ${result.parsedCurrency}`
}

export function buildPurchaseAcknowledgement(
  result: PurchaseMessageIngestionResult,
  locale: BotLocale = 'en'
): string | null {
  if (result.status === 'duplicate') {
    return null
  }

  const t = getBotTranslations(locale).purchase

  switch (result.processingStatus) {
    case 'parsed':
      return t.recorded(formatPurchaseSummary(locale, result))
    case 'needs_review':
      return t.savedForReview(formatPurchaseSummary(locale, result))
    case 'parse_failed':
      return t.parseFailed
  }
}

async function replyToPurchaseMessage(ctx: Context, text: string): Promise<void> {
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

function toCandidateFromContext(ctx: Context): PurchaseTopicCandidate | null {
  const message = ctx.message
  if (!message || !('text' in message)) {
    return null
  }

  if (!message.is_topic_message || message.message_thread_id === undefined) {
    return null
  }

  const senderTelegramUserId = ctx.from?.id?.toString()
  if (!senderTelegramUserId) {
    return null
  }

  const senderDisplayName = [ctx.from?.first_name, ctx.from?.last_name]
    .filter((part) => !!part && part.trim().length > 0)
    .join(' ')

  const candidate: PurchaseTopicCandidate = {
    updateId: ctx.update.update_id,
    chatId: message.chat.id.toString(),
    messageId: message.message_id.toString(),
    threadId: message.message_thread_id.toString(),
    senderTelegramUserId,
    rawText: message.text,
    messageSentAt: instantFromEpochSeconds(message.date)
  }

  if (senderDisplayName.length > 0) {
    candidate.senderDisplayName = senderDisplayName
  }

  return candidate
}

export function registerPurchaseTopicIngestion(
  bot: Bot,
  config: PurchaseTopicIngestionConfig,
  repository: PurchaseMessageIngestionRepository,
  options: {
    llmFallback?: PurchaseParserLlmFallback
    logger?: Logger
  } = {}
): void {
  bot.on('message:text', async (ctx, next) => {
    const candidate = toCandidateFromContext(ctx)
    if (!candidate) {
      await next()
      return
    }

    const record = extractPurchaseTopicCandidate(candidate, config)
    if (!record) {
      await next()
      return
    }

    try {
      const status = await repository.save(record, options.llmFallback)
      const acknowledgement = buildPurchaseAcknowledgement(status, botLocaleFromContext(ctx))

      if (status.status === 'created') {
        options.logger?.info(
          {
            event: 'purchase.ingested',
            processingStatus: status.processingStatus,
            chatId: record.chatId,
            threadId: record.threadId,
            messageId: record.messageId,
            updateId: record.updateId,
            senderTelegramUserId: record.senderTelegramUserId
          },
          'Purchase topic message ingested'
        )
      }

      if (acknowledgement) {
        await replyToPurchaseMessage(ctx, acknowledgement)
      }
    } catch (error) {
      options.logger?.error(
        {
          event: 'purchase.ingest_failed',
          chatId: record.chatId,
          threadId: record.threadId,
          messageId: record.messageId,
          updateId: record.updateId,
          error
        },
        'Failed to ingest purchase topic message'
      )
    }
  })
}

export function registerConfiguredPurchaseTopicIngestion(
  bot: Bot,
  householdConfigurationRepository: HouseholdConfigurationRepository,
  repository: PurchaseMessageIngestionRepository,
  options: {
    llmFallback?: PurchaseParserLlmFallback
    logger?: Logger
  } = {}
): void {
  bot.on('message:text', async (ctx, next) => {
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

    const record = resolveConfiguredPurchaseTopicRecord(candidate, binding)
    if (!record) {
      await next()
      return
    }

    try {
      const status = await repository.save(record, options.llmFallback)
      const acknowledgement = buildPurchaseAcknowledgement(status, botLocaleFromContext(ctx))

      if (status.status === 'created') {
        options.logger?.info(
          {
            event: 'purchase.ingested',
            householdId: record.householdId,
            processingStatus: status.processingStatus,
            chatId: record.chatId,
            threadId: record.threadId,
            messageId: record.messageId,
            updateId: record.updateId,
            senderTelegramUserId: record.senderTelegramUserId
          },
          'Purchase topic message ingested'
        )
      }

      if (acknowledgement) {
        await replyToPurchaseMessage(ctx, acknowledgement)
      }
    } catch (error) {
      options.logger?.error(
        {
          event: 'purchase.ingest_failed',
          householdId: record.householdId,
          chatId: record.chatId,
          threadId: record.threadId,
          messageId: record.messageId,
          updateId: record.updateId,
          error
        },
        'Failed to ingest purchase topic message'
      )
    }
  })
}
