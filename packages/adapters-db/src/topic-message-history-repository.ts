import { and, desc, eq, gte, isNotNull } from 'drizzle-orm'

import { instantFromDatabaseValue, instantToDate } from '@household/domain'
import { createDbClient, schema } from '@household/db'
import type { TopicMessageHistoryRepository } from '@household/ports'

export function createDbTopicMessageHistoryRepository(databaseUrl: string): {
  repository: TopicMessageHistoryRepository
  close: () => Promise<void>
} {
  const { db, queryClient } = createDbClient(databaseUrl, {
    max: 3,
    prepare: false
  })

  const repository: TopicMessageHistoryRepository = {
    async saveMessage(input) {
      await db
        .insert(schema.topicMessages)
        .values({
          householdId: input.householdId,
          telegramChatId: input.telegramChatId,
          telegramThreadId: input.telegramThreadId,
          telegramMessageId: input.telegramMessageId,
          telegramUpdateId: input.telegramUpdateId,
          senderTelegramUserId: input.senderTelegramUserId,
          senderDisplayName: input.senderDisplayName,
          isBot: input.isBot ? 1 : 0,
          rawText: input.rawText,
          messageSentAt: input.messageSentAt ? instantToDate(input.messageSentAt) : null
        })
        .onConflictDoNothing()
    },

    async listRecentThreadMessages(input) {
      const rows = await db
        .select()
        .from(schema.topicMessages)
        .where(
          and(
            eq(schema.topicMessages.householdId, input.householdId),
            eq(schema.topicMessages.telegramChatId, input.telegramChatId),
            eq(schema.topicMessages.telegramThreadId, input.telegramThreadId)
          )
        )
        .orderBy(desc(schema.topicMessages.messageSentAt), desc(schema.topicMessages.createdAt))
        .limit(input.limit)

      return rows.reverse().map((row) => ({
        householdId: row.householdId,
        telegramChatId: row.telegramChatId,
        telegramThreadId: row.telegramThreadId,
        telegramMessageId: row.telegramMessageId,
        telegramUpdateId: row.telegramUpdateId,
        senderTelegramUserId: row.senderTelegramUserId,
        senderDisplayName: row.senderDisplayName,
        isBot: row.isBot === 1,
        rawText: row.rawText,
        messageSentAt: instantFromDatabaseValue(row.messageSentAt)
      }))
    },

    async listRecentChatMessages(input) {
      const rows = await db
        .select()
        .from(schema.topicMessages)
        .where(
          and(
            eq(schema.topicMessages.householdId, input.householdId),
            eq(schema.topicMessages.telegramChatId, input.telegramChatId),
            isNotNull(schema.topicMessages.messageSentAt),
            gte(schema.topicMessages.messageSentAt, instantToDate(input.sentAtOrAfter))
          )
        )
        .orderBy(desc(schema.topicMessages.messageSentAt), desc(schema.topicMessages.createdAt))
        .limit(input.limit)

      return rows.reverse().map((row) => ({
        householdId: row.householdId,
        telegramChatId: row.telegramChatId,
        telegramThreadId: row.telegramThreadId,
        telegramMessageId: row.telegramMessageId,
        telegramUpdateId: row.telegramUpdateId,
        senderTelegramUserId: row.senderTelegramUserId,
        senderDisplayName: row.senderDisplayName,
        isBot: row.isBot === 1,
        rawText: row.rawText,
        messageSentAt: instantFromDatabaseValue(row.messageSentAt)
      }))
    }
  }

  return {
    repository,
    close: async () => {
      await queryClient.end({ timeout: 5 })
    }
  }
}
