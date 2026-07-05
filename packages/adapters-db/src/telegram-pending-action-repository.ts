import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm'

import { createDbClient, schema } from '@household/db'
import { instantFromDatabaseValue, instantToDate, nowInstant, Temporal } from '@household/domain'
import {
  TELEGRAM_PENDING_ACTION_TYPES,
  type TelegramPendingActionRecord,
  type TelegramPendingActionRepository,
  type TelegramPendingActionType
} from '@household/ports'

function parsePendingActionType(raw: string): TelegramPendingActionType {
  if ((TELEGRAM_PENDING_ACTION_TYPES as readonly string[]).includes(raw)) {
    return raw as TelegramPendingActionType
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
            schema.telegramPendingActions.telegramUserId,
            schema.telegramPendingActions.action
          ],
          set: {
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

    async getPendingAction(telegramChatId, telegramUserId, action) {
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
            eq(schema.telegramPendingActions.telegramUserId, telegramUserId),
            ...(action ? [eq(schema.telegramPendingActions.action, action)] : [])
          )
        )
        .orderBy(desc(schema.telegramPendingActions.updatedAt))
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
              eq(schema.telegramPendingActions.telegramUserId, telegramUserId),
              eq(schema.telegramPendingActions.action, row.action)
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

    async consumePendingActionByPayloadValue(telegramChatId, telegramUserId, action, key, value) {
      const rows = await db
        .delete(schema.telegramPendingActions)
        .where(
          and(
            eq(schema.telegramPendingActions.telegramChatId, telegramChatId),
            eq(schema.telegramPendingActions.telegramUserId, telegramUserId),
            eq(schema.telegramPendingActions.action, action),
            sql`${schema.telegramPendingActions.payload}->>${key} = ${value}`,
            // Use drizzle operators (not a raw sql template) so the timestamptz
            // codec binds the Date; a raw template passes it unmapped and the
            // postgres.js driver throws on a Date parameter.
            or(
              isNull(schema.telegramPendingActions.expiresAt),
              gt(schema.telegramPendingActions.expiresAt, instantToDate(nowInstant()))
            )
          )
        )
        .returning({
          telegramUserId: schema.telegramPendingActions.telegramUserId,
          telegramChatId: schema.telegramPendingActions.telegramChatId,
          action: schema.telegramPendingActions.action,
          payload: schema.telegramPendingActions.payload,
          expiresAt: schema.telegramPendingActions.expiresAt
        })

      const row = rows[0]
      return row ? mapPendingAction(row) : null
    },

    async findPendingActionByPayloadValue(telegramChatId, action, key, value) {
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
            eq(schema.telegramPendingActions.action, action),
            sql`${schema.telegramPendingActions.payload}->>${key} = ${value}`
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
              eq(schema.telegramPendingActions.telegramChatId, row.telegramChatId),
              eq(schema.telegramPendingActions.telegramUserId, row.telegramUserId)
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

    async clearPendingAction(telegramChatId, telegramUserId, action) {
      await db
        .delete(schema.telegramPendingActions)
        .where(
          and(
            eq(schema.telegramPendingActions.telegramChatId, telegramChatId),
            eq(schema.telegramPendingActions.telegramUserId, telegramUserId),
            ...(action ? [eq(schema.telegramPendingActions.action, action)] : [])
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
