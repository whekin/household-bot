import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, test } from 'bun:test'
import { eq, inArray } from 'drizzle-orm'

import { createDbClient, schema } from '@household/db'
import { instantFromIso } from '@household/domain'

import { createDbFinanceRepository } from './finance-repository'

const databaseUrl = process.env.DATABASE_URL
const runDbIntegrationTests = process.env.RUN_DB_INTEGRATION_TESTS === '1'
const testIfDatabase = databaseUrl && runDbIntegrationTests ? test : test.skip

describe('createDbFinanceRepository', () => {
  const createdHouseholdIds: string[] = []

  afterAll(async () => {
    if (!databaseUrl || !runDbIntegrationTests || createdHouseholdIds.length === 0) {
      return
    }

    const { db, queryClient } = createDbClient(databaseUrl, {
      max: 1,
      prepare: false
    })

    await db.delete(schema.households).where(inArray(schema.households.id, createdHouseholdIds))
    await queryClient.end({ timeout: 5 })
  })

  testIfDatabase(
    'uses sourceKey idempotency while preserving original Telegram provenance',
    async () => {
      const { db, queryClient } = createDbClient(databaseUrl!, {
        max: 1,
        prepare: false
      })
      const householdId = randomUUID()
      const cycleId = randomUUID()
      const memberAId = randomUUID()
      const memberBId = randomUUID()

      createdHouseholdIds.push(householdId)

      await db.insert(schema.households).values({
        id: householdId,
        name: `Source Key Household ${randomUUID()}`
      })
      await db.insert(schema.members).values([
        {
          id: memberAId,
          householdId,
          telegramUserId: '10002',
          displayName: 'Stas'
        },
        {
          id: memberBId,
          householdId,
          telegramUserId: '20002',
          displayName: 'Dima'
        }
      ])
      await db.insert(schema.billingCycles).values({
        id: cycleId,
        householdId,
        period: '2026-05',
        currency: 'GEL'
      })

      const financeClient = createDbFinanceRepository(databaseUrl!, householdId)
      const baseConfirmation = {
        status: 'recorded' as const,
        cycleId,
        kind: 'rent' as const,
        amountMinor: 46900n,
        currency: 'GEL' as const,
        explicitAmountMinor: null,
        explicitCurrency: null,
        recordedAt: instantFromIso('2026-05-16T15:12:00.000Z'),
        senderTelegramUserId: '10002',
        rawText: 'Перевел за себя и Диму',
        normalizedText: 'перевел за себя и диму',
        telegramChatId: '-10012345',
        telegramMessageId: '55',
        telegramThreadId: '888',
        telegramUpdateId: '1001',
        attachmentCount: 0,
        messageSentAt: instantFromIso('2026-05-16T15:12:00.000Z')
      }

      const first = await financeClient.repository.savePaymentConfirmation({
        ...baseConfirmation,
        memberId: memberAId,
        sourceKey: '55:proposal-1:member-a'
      })
      const second = await financeClient.repository.savePaymentConfirmation({
        ...baseConfirmation,
        memberId: memberBId,
        sourceKey: '55:proposal-1:member-b'
      })
      const duplicate = await financeClient.repository.savePaymentConfirmation({
        ...baseConfirmation,
        memberId: memberBId,
        sourceKey: '55:proposal-1:member-b'
      })

      expect(first.status).toBe('recorded')
      expect(second.status).toBe('recorded')
      expect(duplicate.status).toBe('duplicate')

      const rows = await db
        .select({
          sourceKey: schema.paymentConfirmations.sourceKey,
          telegramMessageId: schema.paymentConfirmations.telegramMessageId,
          telegramUpdateId: schema.paymentConfirmations.telegramUpdateId
        })
        .from(schema.paymentConfirmations)
        .where(eq(schema.paymentConfirmations.householdId, householdId))
      expect(rows.map((row) => row.sourceKey).sort()).toEqual([
        '55:proposal-1:member-a',
        '55:proposal-1:member-b'
      ])
      expect(new Set(rows.map((row) => row.telegramMessageId))).toEqual(new Set(['55']))
      expect(new Set(rows.map((row) => row.telegramUpdateId))).toEqual(new Set(['1001']))

      await financeClient.close()
      await queryClient.end({ timeout: 5 })
    },
    10000
  )
})
