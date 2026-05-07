import { desc, eq } from 'drizzle-orm'

import { createDbClient, schema } from '@household/db'
import { instantFromDatabaseValue, instantToDate, nowInstant } from '@household/domain'
import type {
  HouseholdAuditEventRecord,
  HouseholdAuditNotificationRepository,
  HouseholdNotificationSettingsRecord
} from '@household/ports'

function parseMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return value as Record<string, unknown>
}

function settingsSelect() {
  return {
    householdId: schema.householdNotificationSettings.householdId,
    periodEvents: schema.householdNotificationSettings.periodEvents,
    planEvents: schema.householdNotificationSettings.planEvents,
    purchaseEvents: schema.householdNotificationSettings.purchaseEvents,
    paymentEvents: schema.householdNotificationSettings.paymentEvents,
    createdAt: schema.householdNotificationSettings.createdAt,
    updatedAt: schema.householdNotificationSettings.updatedAt
  }
}

function eventSelect() {
  return {
    id: schema.householdAuditEvents.id,
    householdId: schema.householdAuditEvents.householdId,
    actorMemberId: schema.householdAuditEvents.actorMemberId,
    actorDisplayName: schema.householdAuditEvents.actorDisplayName,
    eventType: schema.householdAuditEvents.eventType,
    category: schema.householdAuditEvents.category,
    summaryText: schema.householdAuditEvents.summaryText,
    metadata: schema.householdAuditEvents.metadata,
    deliveryStatus: schema.householdAuditEvents.deliveryStatus,
    deliveredTelegramChatId: schema.householdAuditEvents.deliveredTelegramChatId,
    deliveredTelegramThreadId: schema.householdAuditEvents.deliveredTelegramThreadId,
    deliveredTelegramMessageId: schema.householdAuditEvents.deliveredTelegramMessageId,
    deliveryError: schema.householdAuditEvents.deliveryError,
    createdAt: schema.householdAuditEvents.createdAt
  }
}

function mapSettings(row: {
  householdId: string
  periodEvents: number
  planEvents: number
  purchaseEvents: number
  paymentEvents: number
  createdAt: Date | string
  updatedAt: Date | string
}): HouseholdNotificationSettingsRecord {
  return {
    householdId: row.householdId,
    periodEvents: row.periodEvents === 1,
    planEvents: row.planEvents === 1,
    purchaseEvents: row.purchaseEvents === 1,
    paymentEvents: row.paymentEvents === 1,
    createdAt: instantFromDatabaseValue(row.createdAt)!,
    updatedAt: instantFromDatabaseValue(row.updatedAt)!
  }
}

function mapEvent(row: {
  id: string
  householdId: string
  actorMemberId: string | null
  actorDisplayName: string
  eventType: string
  category: string
  summaryText: string
  metadata: unknown
  deliveryStatus: string
  deliveredTelegramChatId: string | null
  deliveredTelegramThreadId: string | null
  deliveredTelegramMessageId: string | null
  deliveryError: string | null
  createdAt: Date | string
}): HouseholdAuditEventRecord {
  return {
    id: row.id,
    householdId: row.householdId,
    actorMemberId: row.actorMemberId,
    actorDisplayName: row.actorDisplayName,
    eventType: row.eventType,
    category: row.category as HouseholdAuditEventRecord['category'],
    summaryText: row.summaryText,
    metadata: parseMetadata(row.metadata),
    deliveryStatus: row.deliveryStatus as HouseholdAuditEventRecord['deliveryStatus'],
    deliveredTelegramChatId: row.deliveredTelegramChatId,
    deliveredTelegramThreadId: row.deliveredTelegramThreadId,
    deliveredTelegramMessageId: row.deliveredTelegramMessageId,
    deliveryError: row.deliveryError,
    createdAt: instantFromDatabaseValue(row.createdAt)!
  }
}

export function createDbAuditNotificationRepository(databaseUrl: string): {
  repository: HouseholdAuditNotificationRepository
  close: () => Promise<void>
} {
  const { db, queryClient } = createDbClient(databaseUrl, {
    max: 3,
    prepare: false
  })

  const repository: HouseholdAuditNotificationRepository = {
    async createAuditEvent(input) {
      const rows = await db
        .insert(schema.householdAuditEvents)
        .values({
          householdId: input.householdId,
          actorMemberId: input.actorMemberId ?? null,
          actorDisplayName: input.actorDisplayName,
          eventType: input.eventType,
          category: input.category,
          summaryText: input.summaryText,
          metadata: input.metadata ?? {},
          deliveryStatus: input.deliveryStatus ?? 'pending',
          createdAt: instantToDate(input.createdAt)
        })
        .returning(eventSelect())

      const row = rows[0]
      if (!row) {
        throw new Error('Audit event insert did not return a row')
      }

      return mapEvent(row)
    },

    async getNotificationSettings(householdId) {
      const existingRows = await db
        .select(settingsSelect())
        .from(schema.householdNotificationSettings)
        .where(eq(schema.householdNotificationSettings.householdId, householdId))
        .limit(1)

      const existing = existingRows[0]
      if (existing) {
        return mapSettings(existing)
      }

      const timestamp = instantToDate(nowInstant())
      const rows = await db
        .insert(schema.householdNotificationSettings)
        .values({
          householdId,
          updatedAt: timestamp
        })
        .returning(settingsSelect())

      const row = rows[0]
      if (!row) {
        throw new Error('Notification settings upsert did not return a row')
      }

      return mapSettings(row)
    },

    async updateNotificationSettings(input) {
      await repository.getNotificationSettings(input.householdId)

      const rows = await db
        .update(schema.householdNotificationSettings)
        .set({
          ...(input.periodEvents !== undefined
            ? {
                periodEvents: input.periodEvents ? 1 : 0
              }
            : {}),
          ...(input.planEvents !== undefined
            ? {
                planEvents: input.planEvents ? 1 : 0
              }
            : {}),
          ...(input.purchaseEvents !== undefined
            ? {
                purchaseEvents: input.purchaseEvents ? 1 : 0
              }
            : {}),
          ...(input.paymentEvents !== undefined
            ? {
                paymentEvents: input.paymentEvents ? 1 : 0
              }
            : {}),
          updatedAt: instantToDate(input.updatedAt)
        })
        .where(eq(schema.householdNotificationSettings.householdId, input.householdId))
        .returning(settingsSelect())

      const row = rows[0]
      if (!row) {
        throw new Error('Notification settings update did not return a row')
      }

      return mapSettings(row)
    },

    async updateAuditEventDelivery(input) {
      const rows = await db
        .update(schema.householdAuditEvents)
        .set({
          deliveryStatus: input.deliveryStatus,
          ...(input.deliveredTelegramChatId !== undefined
            ? {
                deliveredTelegramChatId: input.deliveredTelegramChatId
              }
            : {}),
          ...(input.deliveredTelegramThreadId !== undefined
            ? {
                deliveredTelegramThreadId: input.deliveredTelegramThreadId
              }
            : {}),
          ...(input.deliveredTelegramMessageId !== undefined
            ? {
                deliveredTelegramMessageId: input.deliveredTelegramMessageId
              }
            : {}),
          ...(input.deliveryError !== undefined
            ? {
                deliveryError: input.deliveryError
              }
            : {})
        })
        .where(eq(schema.householdAuditEvents.id, input.eventId))
        .returning(eventSelect())

      return rows[0] ? mapEvent(rows[0]) : null
    },

    async listAuditEventsForHousehold(householdId, limit) {
      const rows = await db
        .select(eventSelect())
        .from(schema.householdAuditEvents)
        .where(eq(schema.householdAuditEvents.householdId, householdId))
        .orderBy(desc(schema.householdAuditEvents.createdAt))
        .limit(limit)

      return rows.map(mapEvent)
    }
  }

  return {
    repository,
    close: () => queryClient.end()
  }
}
