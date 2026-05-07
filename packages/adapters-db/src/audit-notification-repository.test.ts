import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, test } from 'bun:test'
import { inArray } from 'drizzle-orm'

import { createDbClient, schema } from '@household/db'
import { Temporal } from '@household/domain'

import { createDbAuditNotificationRepository } from './audit-notification-repository'

const databaseUrl = process.env.DATABASE_URL
const runDbIntegration =
  process.env.RUN_DB_INTEGRATION_TESTS === '1' || process.env.RUN_DB_INTEGRATION_TESTS === 'true'
const testIfDatabase = databaseUrl && runDbIntegration ? test : test.skip

describe('createDbAuditNotificationRepository', () => {
  const createdHouseholdIds: string[] = []

  afterAll(async () => {
    if (!databaseUrl || createdHouseholdIds.length === 0) {
      return
    }

    const { db, queryClient } = createDbClient(databaseUrl, {
      max: 1,
      prepare: false
    })

    await db.delete(schema.households).where(inArray(schema.households.id, createdHouseholdIds))
    await queryClient.end({ timeout: 5 })
  })

  testIfDatabase('stores notification settings and audit events', async () => {
    const dbClient = createDbClient(databaseUrl!, {
      max: 1,
      prepare: false
    })
    const householdRows = await dbClient.db
      .insert(schema.households)
      .values({
        name: `Audit Integration ${randomUUID()}`
      })
      .returning({ id: schema.households.id })
    await dbClient.queryClient.end({ timeout: 5 })

    const householdId = householdRows[0]?.id
    expect(householdId).toBeTruthy()
    createdHouseholdIds.push(householdId!)

    const repositoryClient = createDbAuditNotificationRepository(databaseUrl!)

    const defaults = await repositoryClient.repository.getNotificationSettings(householdId!)
    expect(defaults).toMatchObject({
      householdId,
      periodEvents: true,
      planEvents: true,
      purchaseEvents: true,
      paymentEvents: true
    })

    const updated = await repositoryClient.repository.updateNotificationSettings({
      householdId: householdId!,
      purchaseEvents: false,
      paymentEvents: false,
      updatedAt: Temporal.Instant.from('2026-03-24T00:00:00Z')
    })
    expect(updated).toMatchObject({
      purchaseEvents: false,
      paymentEvents: false
    })

    const event = await repositoryClient.repository.createAuditEvent({
      householdId: householdId!,
      actorMemberId: null,
      actorDisplayName: 'Alex',
      eventType: 'purchase.added',
      category: 'purchase_events',
      summaryText: 'Alex added purchase: groceries 42 GEL',
      metadata: {
        purchaseId: 'purchase-1'
      },
      createdAt: Temporal.Instant.from('2026-03-24T12:00:00Z')
    })
    expect(event).toMatchObject({
      householdId,
      actorMemberId: null,
      actorDisplayName: 'Alex',
      eventType: 'purchase.added',
      category: 'purchase_events',
      summaryText: 'Alex added purchase: groceries 42 GEL',
      metadata: {
        purchaseId: 'purchase-1'
      },
      deliveryStatus: 'pending'
    })
    await expect(repositoryClient.repository.getAuditEventById(event.id)).resolves.toMatchObject({
      id: event.id,
      summaryText: 'Alex added purchase: groceries 42 GEL'
    })

    const delivered = await repositoryClient.repository.updateAuditEventDelivery({
      eventId: event.id,
      deliveryStatus: 'sent',
      deliveredTelegramChatId: '-100123',
      deliveredTelegramThreadId: '501',
      deliveredTelegramMessageId: '9001',
      deliveryError: null
    })
    expect(delivered).toMatchObject({
      id: event.id,
      deliveryStatus: 'sent',
      deliveredTelegramThreadId: '501',
      deliveredTelegramMessageId: '9001'
    })

    const events = await repositoryClient.repository.listAuditEventsForHousehold(householdId!, 10)
    expect(events.map((event) => event.id)).toEqual([event.id])

    await repositoryClient.close()
  })
})
