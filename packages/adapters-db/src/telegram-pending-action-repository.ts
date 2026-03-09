import { and, eq } from 'drizzle-orm'

import { createDbClient, schema } from '@household/db'
import type {
  TelegramPendingActionRecord,
  TelegramPendingActionRepository,
  TelegramPendingActionType
} from '@household/ports'

function parsePendingActionType(raw: string): TelegramPendingActionType {
  if (raw === 'anonymous_feedback') {
    return raw
  }

  throw new Error(`Unexpected telegram pending action type: ${raw}`)
}

function mapPendingAction(row: {
  telegramUserId: string
  telegramChatId: string
  action: string
  payload: unknown
  expiresAt: Date | null
}): TelegramPendingActionRecord {
  return {
    telegramUserId: row.telegramUserId,
    telegramChatId: row.telegramChatId,
    action: parsePendingActionType(row.action),
    payload:
      row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
        ? (row.payload as Record<string, unknown>)
        : {},
    expiresAt: row.expiresAt
  }
}

export function createDbTelegramPendingActionRepository(databaseUrl: string): {
  repository: TelegramPendingActionRepository
  close: () => Promise<void>
} {
  const { db, queryClient } = createDbClient(databaseUrl, {
    max: 5,
    prepare: false
  })

  const repository: TelegramPendingActionRepository = {
    async upsertPendingAction(input) {
      const rows = await db
        .insert(schema.telegramPendingActions)
        .values({
          telegramUserId: input.telegramUserId,
          telegramChatId: input.telegramChatId,
          action: input.action,
          payload: input.payload,
          expiresAt: input.expiresAt,
          updatedAt: new Date()
        })
        .onConflictDoUpdate({
          target: [
            schema.telegramPendingActions.telegramChatId,
            schema.telegramPendingActions.telegramUserId
          ],
          set: {
            action: input.action,
            payload: input.payload,
            expiresAt: input.expiresAt,
            updatedAt: new Date()
          }
        })
        .returning({
          telegramUserId: schema.telegramPendingActions.telegramUserId,
          telegramChatId: schema.telegramPendingActions.telegramChatId,
          action: schema.telegramPendingActions.action,
          payload: schema.telegramPendingActions.payload,
          expiresAt: schema.telegramPendingActions.expiresAt
        })

      const row = rows[0]
      if (!row) {
        throw new Error('Pending action upsert did not return a row')
      }

      return mapPendingAction(row)
    },

    async getPendingAction(telegramChatId, telegramUserId) {
      const now = new Date()
      const rows = await db
        .select({
          telegramUserId: schema.telegramPendingActions.telegramUserId,
          telegramChatId: schema.telegramPendingActions.telegramChatId,
          action: schema.telegramPendingActions.action,
          payload: schema.telegramPendingActions.payload,
          expiresAt: schema.telegramPendingActions.expiresAt
        })
        .from(schema.telegramPendingActions)
        .where(
          and(
            eq(schema.telegramPendingActions.telegramChatId, telegramChatId),
            eq(schema.telegramPendingActions.telegramUserId, telegramUserId)
          )
        )
        .limit(1)

      const row = rows[0]
      if (!row) {
        return null
      }

      if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) {
        await db
          .delete(schema.telegramPendingActions)
          .where(
            and(
              eq(schema.telegramPendingActions.telegramChatId, telegramChatId),
              eq(schema.telegramPendingActions.telegramUserId, telegramUserId)
            )
          )

        return null
      }

      return mapPendingAction(row)
    },

    async clearPendingAction(telegramChatId, telegramUserId) {
      await db
        .delete(schema.telegramPendingActions)
        .where(
          and(
            eq(schema.telegramPendingActions.telegramChatId, telegramChatId),
            eq(schema.telegramPendingActions.telegramUserId, telegramUserId)
          )
        )
    }
  }

  return {
    repository,
    close: async () => {
      await queryClient.end({ timeout: 5 })
    }
  }
}
