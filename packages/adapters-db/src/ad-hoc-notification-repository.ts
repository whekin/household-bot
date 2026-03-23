import { and, asc, eq, lte } from 'drizzle-orm'

import { createDbClient, schema } from '@household/db'
import { instantFromDatabaseValue, instantToDate, nowInstant } from '@household/domain'
import type {
  AdHocNotificationRecord,
  AdHocNotificationRepository,
  ClaimAdHocNotificationDeliveryResult
} from '@household/ports'

const DELIVERY_CLAIM_SOURCE = 'ad-hoc-notification'

function parseMemberIds(raw: unknown): readonly string[] {
  if (!Array.isArray(raw)) {
    return []
  }

  return raw.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
}

function mapNotification(row: {
  id: string
  householdId: string
  creatorMemberId: string
  assigneeMemberId: string | null
  originalRequestText: string
  notificationText: string
  timezone: string
  scheduledFor: Date | string
  timePrecision: string
  deliveryMode: string
  dmRecipientMemberIds: unknown
  friendlyTagAssignee: number
  status: string
  sourceTelegramChatId: string | null
  sourceTelegramThreadId: string | null
  sentAt: Date | string | null
  cancelledAt: Date | string | null
  cancelledByMemberId: string | null
  createdAt: Date | string
  updatedAt: Date | string
}): AdHocNotificationRecord {
  return {
    id: row.id,
    householdId: row.householdId,
    creatorMemberId: row.creatorMemberId,
    assigneeMemberId: row.assigneeMemberId,
    originalRequestText: row.originalRequestText,
    notificationText: row.notificationText,
    timezone: row.timezone,
    scheduledFor: instantFromDatabaseValue(row.scheduledFor)!,
    timePrecision: row.timePrecision as AdHocNotificationRecord['timePrecision'],
    deliveryMode: row.deliveryMode as AdHocNotificationRecord['deliveryMode'],
    dmRecipientMemberIds: parseMemberIds(row.dmRecipientMemberIds),
    friendlyTagAssignee: row.friendlyTagAssignee === 1,
    status: row.status as AdHocNotificationRecord['status'],
    sourceTelegramChatId: row.sourceTelegramChatId,
    sourceTelegramThreadId: row.sourceTelegramThreadId,
    sentAt: instantFromDatabaseValue(row.sentAt),
    cancelledAt: instantFromDatabaseValue(row.cancelledAt),
    cancelledByMemberId: row.cancelledByMemberId,
    createdAt: instantFromDatabaseValue(row.createdAt)!,
    updatedAt: instantFromDatabaseValue(row.updatedAt)!
  }
}

function notificationSelect() {
  return {
    id: schema.adHocNotifications.id,
    householdId: schema.adHocNotifications.householdId,
    creatorMemberId: schema.adHocNotifications.creatorMemberId,
    assigneeMemberId: schema.adHocNotifications.assigneeMemberId,
    originalRequestText: schema.adHocNotifications.originalRequestText,
    notificationText: schema.adHocNotifications.notificationText,
    timezone: schema.adHocNotifications.timezone,
    scheduledFor: schema.adHocNotifications.scheduledFor,
    timePrecision: schema.adHocNotifications.timePrecision,
    deliveryMode: schema.adHocNotifications.deliveryMode,
    dmRecipientMemberIds: schema.adHocNotifications.dmRecipientMemberIds,
    friendlyTagAssignee: schema.adHocNotifications.friendlyTagAssignee,
    status: schema.adHocNotifications.status,
    sourceTelegramChatId: schema.adHocNotifications.sourceTelegramChatId,
    sourceTelegramThreadId: schema.adHocNotifications.sourceTelegramThreadId,
    sentAt: schema.adHocNotifications.sentAt,
    cancelledAt: schema.adHocNotifications.cancelledAt,
    cancelledByMemberId: schema.adHocNotifications.cancelledByMemberId,
    createdAt: schema.adHocNotifications.createdAt,
    updatedAt: schema.adHocNotifications.updatedAt
  }
}

export function createDbAdHocNotificationRepository(databaseUrl: string): {
  repository: AdHocNotificationRepository
  close: () => Promise<void>
} {
  const { db, queryClient } = createDbClient(databaseUrl, {
    max: 3,
    prepare: false
  })

  const repository: AdHocNotificationRepository = {
    async createNotification(input) {
      const timestamp = instantToDate(nowInstant())
      const rows = await db
        .insert(schema.adHocNotifications)
        .values({
          householdId: input.householdId,
          creatorMemberId: input.creatorMemberId,
          assigneeMemberId: input.assigneeMemberId ?? null,
          originalRequestText: input.originalRequestText,
          notificationText: input.notificationText,
          timezone: input.timezone,
          scheduledFor: instantToDate(input.scheduledFor),
          timePrecision: input.timePrecision,
          deliveryMode: input.deliveryMode,
          dmRecipientMemberIds: input.dmRecipientMemberIds ?? [],
          friendlyTagAssignee: input.friendlyTagAssignee ? 1 : 0,
          status: 'scheduled',
          sourceTelegramChatId: input.sourceTelegramChatId ?? null,
          sourceTelegramThreadId: input.sourceTelegramThreadId ?? null,
          updatedAt: timestamp
        })
        .returning(notificationSelect())

      const row = rows[0]
      if (!row) {
        throw new Error('Notification insert did not return a row')
      }

      return mapNotification(row)
    },

    async getNotificationById(notificationId) {
      const rows = await db
        .select(notificationSelect())
        .from(schema.adHocNotifications)
        .where(eq(schema.adHocNotifications.id, notificationId))
        .limit(1)

      return rows[0] ? mapNotification(rows[0]) : null
    },

    async listUpcomingNotificationsForHousehold(householdId, asOf) {
      const rows = await db
        .select(notificationSelect())
        .from(schema.adHocNotifications)
        .where(
          and(
            eq(schema.adHocNotifications.householdId, householdId),
            eq(schema.adHocNotifications.status, 'scheduled'),
            lte(schema.adHocNotifications.createdAt, instantToDate(asOf))
          )
        )
        .orderBy(
          asc(schema.adHocNotifications.scheduledFor),
          asc(schema.adHocNotifications.createdAt)
        )

      return rows
        .map(mapNotification)
        .filter((record) => record.scheduledFor.epochMilliseconds >= asOf.epochMilliseconds)
    },

    async cancelNotification(input) {
      const rows = await db
        .update(schema.adHocNotifications)
        .set({
          status: 'cancelled',
          cancelledAt: instantToDate(input.cancelledAt),
          cancelledByMemberId: input.cancelledByMemberId,
          updatedAt: instantToDate(nowInstant())
        })
        .where(
          and(
            eq(schema.adHocNotifications.id, input.notificationId),
            eq(schema.adHocNotifications.status, 'scheduled')
          )
        )
        .returning(notificationSelect())

      return rows[0] ? mapNotification(rows[0]) : null
    },

    async updateNotification(input) {
      const updates: Record<string, unknown> = {
        updatedAt: instantToDate(input.updatedAt)
      }

      if (input.scheduledFor) {
        updates.scheduledFor = instantToDate(input.scheduledFor)
      }
      if (input.timePrecision) {
        updates.timePrecision = input.timePrecision
      }
      if (input.deliveryMode) {
        updates.deliveryMode = input.deliveryMode
      }
      if (input.dmRecipientMemberIds) {
        updates.dmRecipientMemberIds = input.dmRecipientMemberIds
      }

      const rows = await db
        .update(schema.adHocNotifications)
        .set(updates)
        .where(
          and(
            eq(schema.adHocNotifications.id, input.notificationId),
            eq(schema.adHocNotifications.status, 'scheduled')
          )
        )
        .returning(notificationSelect())

      return rows[0] ? mapNotification(rows[0]) : null
    },

    async listDueNotifications(asOf) {
      const rows = await db
        .select(notificationSelect())
        .from(schema.adHocNotifications)
        .where(
          and(
            eq(schema.adHocNotifications.status, 'scheduled'),
            lte(schema.adHocNotifications.scheduledFor, instantToDate(asOf))
          )
        )
        .orderBy(
          asc(schema.adHocNotifications.scheduledFor),
          asc(schema.adHocNotifications.createdAt)
        )

      return rows.map(mapNotification)
    },

    async markNotificationSent(notificationId, sentAt) {
      const rows = await db
        .update(schema.adHocNotifications)
        .set({
          status: 'sent',
          sentAt: instantToDate(sentAt),
          updatedAt: instantToDate(nowInstant())
        })
        .where(
          and(
            eq(schema.adHocNotifications.id, notificationId),
            eq(schema.adHocNotifications.status, 'scheduled')
          )
        )
        .returning(notificationSelect())

      return rows[0] ? mapNotification(rows[0]) : null
    },

    async claimNotificationDelivery(notificationId) {
      const notification = await repository.getNotificationById(notificationId)
      if (!notification) {
        return {
          notificationId,
          claimed: false
        } satisfies ClaimAdHocNotificationDeliveryResult
      }

      const rows = await db
        .insert(schema.processedBotMessages)
        .values({
          householdId: notification.householdId,
          source: DELIVERY_CLAIM_SOURCE,
          sourceMessageKey: notificationId
        })
        .onConflictDoNothing({
          target: [
            schema.processedBotMessages.householdId,
            schema.processedBotMessages.source,
            schema.processedBotMessages.sourceMessageKey
          ]
        })
        .returning({ id: schema.processedBotMessages.id })

      return {
        notificationId,
        claimed: rows.length > 0
      }
    },

    async releaseNotificationDelivery(notificationId) {
      const notification = await repository.getNotificationById(notificationId)
      if (!notification) {
        return
      }

      await db
        .delete(schema.processedBotMessages)
        .where(
          and(
            eq(schema.processedBotMessages.householdId, notification.householdId),
            eq(schema.processedBotMessages.source, DELIVERY_CLAIM_SOURCE),
            eq(schema.processedBotMessages.sourceMessageKey, notificationId)
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
