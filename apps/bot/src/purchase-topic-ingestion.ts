import { parsePurchaseMessage, type PurchaseParserLlmFallback } from '@household/application'
import { and, eq } from 'drizzle-orm'
import type { Bot, Context } from 'grammy'
import type { Logger } from '@household/observability'

import { createDbClient, schema } from '@household/db'

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
  messageSentAt: Date
}

export interface PurchaseTopicRecord extends PurchaseTopicCandidate {
  householdId: string
}

export interface PurchaseMessageIngestionRepository {
  save(
    record: PurchaseTopicRecord,
    llmFallback?: PurchaseParserLlmFallback
  ): Promise<'created' | 'duplicate'>
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
          messageSentAt: record.messageSentAt,
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

      return inserted.length > 0 ? 'created' : 'duplicate'
    }
  }

  return {
    repository,
    close: async () => {
      await queryClient.end({ timeout: 5 })
    }
  }
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
    messageSentAt: new Date(message.date * 1000)
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

      if (status === 'created') {
        options.logger?.info(
          {
            event: 'purchase.ingested',
            chatId: record.chatId,
            threadId: record.threadId,
            messageId: record.messageId,
            updateId: record.updateId,
            senderTelegramUserId: record.senderTelegramUserId
          },
          'Purchase topic message ingested'
        )
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
