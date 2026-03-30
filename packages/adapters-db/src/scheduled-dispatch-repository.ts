import { and, asc, eq, lte } from 'drizzle-orm'

import { createDbClient, schema } from '@household/db'
import { instantFromDatabaseValue, instantToDate, nowInstant } from '@household/domain'
import type {
  ClaimScheduledDispatchDeliveryResult,
  ScheduledDispatchRecord,
  ScheduledDispatchRepository
} from '@household/ports'

const DELIVERY_CLAIM_SOURCE = 'scheduled-dispatch'

function scheduledDispatchSelect() {
  return {
    id: schema.scheduledDispatches.id,
    householdId: schema.scheduledDispatches.householdId,
    kind: schema.scheduledDispatches.kind,
    dueAt: schema.scheduledDispatches.dueAt,
    timezone: schema.scheduledDispatches.timezone,
    status: schema.scheduledDispatches.status,
    provider: schema.scheduledDispatches.provider,
    providerDispatchId: schema.scheduledDispatches.providerDispatchId,
    adHocNotificationId: schema.scheduledDispatches.adHocNotificationId,
    period: schema.scheduledDispatches.period,
    sentAt: schema.scheduledDispatches.sentAt,
    cancelledAt: schema.scheduledDispatches.cancelledAt,
    createdAt: schema.scheduledDispatches.createdAt,
    updatedAt: schema.scheduledDispatches.updatedAt
  }
}

function mapScheduledDispatch(row: {
  id: string
  householdId: string
  kind: string
  dueAt: Date | string
  timezone: string
  status: string
  provider: string
  providerDispatchId: string | null
  adHocNotificationId: string | null
  period: string | null
  sentAt: Date | string | null
  cancelledAt: Date | string | null
  createdAt: Date | string
  updatedAt: Date | string
}): ScheduledDispatchRecord {
  return {
    id: row.id,
    householdId: row.householdId,
    kind: row.kind as ScheduledDispatchRecord['kind'],
    dueAt: instantFromDatabaseValue(row.dueAt)!,
    timezone: row.timezone,
    status: row.status as ScheduledDispatchRecord['status'],
    provider: row.provider as ScheduledDispatchRecord['provider'],
    providerDispatchId: row.providerDispatchId,
    adHocNotificationId: row.adHocNotificationId,
    period: row.period,
    sentAt: instantFromDatabaseValue(row.sentAt),
    cancelledAt: instantFromDatabaseValue(row.cancelledAt),
    createdAt: instantFromDatabaseValue(row.createdAt)!,
    updatedAt: instantFromDatabaseValue(row.updatedAt)!
  }
}

export function createDbScheduledDispatchRepository(databaseUrl: string): {
  repository: ScheduledDispatchRepository
  close: () => Promise<void>
} {
  const { db, queryClient } = createDbClient(databaseUrl, {
    max: 3,
    prepare: false
  })

  const repository: ScheduledDispatchRepository = {
    async createScheduledDispatch(input) {
      const timestamp = instantToDate(nowInstant())
      const rows = await db
        .insert(schema.scheduledDispatches)
        .values({
          householdId: input.householdId,
          kind: input.kind,
          dueAt: instantToDate(input.dueAt),
          timezone: input.timezone,
          status: 'scheduled',
          provider: input.provider,
          providerDispatchId: input.providerDispatchId ?? null,
          adHocNotificationId: input.adHocNotificationId ?? null,
          period: input.period ?? null,
          updatedAt: timestamp
        })
        .returning(scheduledDispatchSelect())

      const row = rows[0]
      if (!row) {
        throw new Error('Scheduled dispatch insert did not return a row')
      }

      return mapScheduledDispatch(row)
    },

    async getScheduledDispatchById(dispatchId) {
      const rows = await db
        .select(scheduledDispatchSelect())
        .from(schema.scheduledDispatches)
        .where(eq(schema.scheduledDispatches.id, dispatchId))
        .limit(1)

      return rows[0] ? mapScheduledDispatch(rows[0]) : null
    },

    async getScheduledDispatchByAdHocNotificationId(notificationId) {
      const rows = await db
        .select(scheduledDispatchSelect())
        .from(schema.scheduledDispatches)
        .where(eq(schema.scheduledDispatches.adHocNotificationId, notificationId))
        .limit(1)

      return rows[0] ? mapScheduledDispatch(rows[0]) : null
    },

    async listScheduledDispatchesForHousehold(householdId) {
      const rows = await db
        .select(scheduledDispatchSelect())
        .from(schema.scheduledDispatches)
        .where(eq(schema.scheduledDispatches.householdId, householdId))
        .orderBy(asc(schema.scheduledDispatches.dueAt), asc(schema.scheduledDispatches.createdAt))

      return rows.map(mapScheduledDispatch)
    },

    async listDueScheduledDispatches(input) {
      const filters = [
        eq(schema.scheduledDispatches.status, 'scheduled'),
        lte(schema.scheduledDispatches.dueAt, instantToDate(input.dueBefore))
      ]

      if (input.provider) {
        filters.push(eq(schema.scheduledDispatches.provider, input.provider))
      }

      const rows = await db
        .select(scheduledDispatchSelect())
        .from(schema.scheduledDispatches)
        .where(and(...filters))
        .orderBy(asc(schema.scheduledDispatches.dueAt), asc(schema.scheduledDispatches.createdAt))
        .limit(input.limit)

      return rows.map(mapScheduledDispatch)
    },

    async updateScheduledDispatch(input) {
      const updates: Record<string, unknown> = {
        updatedAt: instantToDate(input.updatedAt)
      }

      if (input.dueAt) {
        updates.dueAt = instantToDate(input.dueAt)
      }
      if (input.timezone) {
        updates.timezone = input.timezone
      }
      if (input.providerDispatchId !== undefined) {
        updates.providerDispatchId = input.providerDispatchId
      }
      if (input.period !== undefined) {
        updates.period = input.period
      }

      const rows = await db
        .update(schema.scheduledDispatches)
        .set(updates)
        .where(eq(schema.scheduledDispatches.id, input.dispatchId))
        .returning(scheduledDispatchSelect())

      return rows[0] ? mapScheduledDispatch(rows[0]) : null
    },

    async cancelScheduledDispatch(dispatchId, cancelledAt) {
      const rows = await db
        .update(schema.scheduledDispatches)
        .set({
          status: 'cancelled',
          cancelledAt: instantToDate(cancelledAt),
          updatedAt: instantToDate(nowInstant())
        })
        .where(
          and(
            eq(schema.scheduledDispatches.id, dispatchId),
            eq(schema.scheduledDispatches.status, 'scheduled')
          )
        )
        .returning(scheduledDispatchSelect())

      return rows[0] ? mapScheduledDispatch(rows[0]) : null
    },

    async markScheduledDispatchSent(dispatchId, sentAt) {
      const rows = await db
        .update(schema.scheduledDispatches)
        .set({
          status: 'sent',
          sentAt: instantToDate(sentAt),
          updatedAt: instantToDate(nowInstant())
        })
        .where(
          and(
            eq(schema.scheduledDispatches.id, dispatchId),
            eq(schema.scheduledDispatches.status, 'scheduled')
          )
        )
        .returning(scheduledDispatchSelect())

      return rows[0] ? mapScheduledDispatch(rows[0]) : null
    },

    async claimScheduledDispatchDelivery(dispatchId) {
      const dispatch = await repository.getScheduledDispatchById(dispatchId)
      if (!dispatch) {
        return {
          dispatchId,
          claimed: false
        } satisfies ClaimScheduledDispatchDeliveryResult
      }

      const rows = await db
        .insert(schema.processedBotMessages)
        .values({
          householdId: dispatch.householdId,
          source: DELIVERY_CLAIM_SOURCE,
          sourceMessageKey: dispatchId
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
        dispatchId,
        claimed: rows.length > 0
      }
    },

    async releaseScheduledDispatchDelivery(dispatchId) {
      const dispatch = await repository.getScheduledDispatchById(dispatchId)
      if (!dispatch) {
        return
      }

      await db
        .delete(schema.processedBotMessages)
        .where(
          and(
            eq(schema.processedBotMessages.householdId, dispatch.householdId),
            eq(schema.processedBotMessages.source, DELIVERY_CLAIM_SOURCE),
            eq(schema.processedBotMessages.sourceMessageKey, dispatchId)
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
