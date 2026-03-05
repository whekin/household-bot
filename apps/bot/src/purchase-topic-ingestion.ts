import { and, eq } from 'drizzle-orm'
import type { Bot, Context } from 'grammy'

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
  save(record: PurchaseTopicRecord): Promise<'created' | 'duplicate'>
}

export function extractPurchaseTopicCandidate(
  value: PurchaseTopicCandidate,
  config: PurchaseTopicIngestionConfig
): PurchaseTopicRecord | null {
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

export function createPurchaseMessageRepository(databaseUrl: string): {
  repository: PurchaseMessageIngestionRepository
  close: () => Promise<void>
} {
  const { db, queryClient } = createDbClient(databaseUrl, {
    max: 5,
    prepare: false
  })

  const repository: PurchaseMessageIngestionRepository = {
    async save(record) {
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
          processingStatus: 'pending'
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
  repository: PurchaseMessageIngestionRepository
): void {
  bot.on('message:text', async (ctx) => {
    const candidate = toCandidateFromContext(ctx)
    if (!candidate) {
      return
    }

    const record = extractPurchaseTopicCandidate(candidate, config)
    if (!record) {
      return
    }

    try {
      const status = await repository.save(record)

      if (status === 'created') {
        console.log(
          `purchase topic message ingested chat=${record.chatId} thread=${record.threadId} message=${record.messageId}`
        )
      }
    } catch (error) {
      console.error('Failed to ingest purchase topic message', error)
    }
  })
}
