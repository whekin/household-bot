import { and, eq } from 'drizzle-orm'

import { createDbClient, schema } from '@household/db'
import { instantFromDatabaseValue, instantToDate, nowInstant, Temporal } from '@household/domain'
import type {
  TelegramPendingActionRecord,
  TelegramPendingActionRepository,
  TelegramPendingActionType
} from '@household/ports'

function parsePendingActionType(raw: string): TelegramPendingActionType {
  if (raw === 'anonymous_feedback') {
    return raw
  }

  if (raw === 'assistant_payment_confirmation') {
    return raw
  }

  if (raw === 'household_group_invite') {
    return raw
  }

  if (raw === 'payment_topic_clarification') {
    return raw
  }

  if (raw === 'payment_topic_confirmation') {
    return raw
  }

  if (raw === 'setup_topic_binding') {
    return raw
  }

  throw new Error(`Unexpected telegram pending action type: ${raw}`)
}

function mapPendingAction(row: {
  telegramUserId: string
  telegramChatId: string
  action: string
  payload: unknown
  expiresAt: Date | string | null
}): TelegramPendingActionRecord {
  return {
    telegramUserId: row.telegramUserId,
    telegramChatId: row.telegramChatId,
    action: parsePendingActionType(row.action),
    payload:
      row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
        ? (row.payload as Record<string, unknown>)
        : {},
    expiresAt: instantFromDatabaseValue(row.expiresAt)
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
          expiresAt: input.expiresAt ? instantToDate(input.expiresAt) : null,
          updatedAt: instantToDate(nowInstant())
        })
        .onConflictDoUpdate({
          target: [
            schema.telegramPendingActions.telegramChatId,
            schema.telegramPendingActions.telegramUserId
          ],
          set: {
            action: input.action,
            payload: input.payload,
            expiresAt: input.expiresAt ? instantToDate(input.expiresAt) : null,
            updatedAt: instantToDate(nowInstant())
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
      const now = nowInstant()
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

      const expiresAt = instantFromDatabaseValue(row.expiresAt)
      if (expiresAt && Temporal.Instant.compare(expiresAt, now) <= 0) {
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

      return {
        telegramUserId: row.telegramUserId,
        telegramChatId: row.telegramChatId,
        action: parsePendingActionType(row.action),
        payload:
          row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
            ? (row.payload as Record<string, unknown>)
            : {},
        expiresAt
      }
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
    },

    async clearPendingActionsForChat(telegramChatId, action) {
      await db
        .delete(schema.telegramPendingActions)
        .where(
          action
            ? and(
                eq(schema.telegramPendingActions.telegramChatId, telegramChatId),
                eq(schema.telegramPendingActions.action, action)
              )
            : eq(schema.telegramPendingActions.telegramChatId, telegramChatId)
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
