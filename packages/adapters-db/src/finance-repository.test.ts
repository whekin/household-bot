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

  testIfDatabase('addPaymentRecordIfNew is idempotent by key', async () => {
    const { db, queryClient } = createDbClient(databaseUrl!, {
      max: 1,
      prepare: false
    })
    const householdId = randomUUID()
    const cycleId = randomUUID()
    const memberId = randomUUID()
    const idempotencyKey = `close-payment-period:${householdId}:${cycleId}:rent:${memberId}`

    createdHouseholdIds.push(householdId)

    await db.insert(schema.households).values({
      id: householdId,
      name: `Idempotent Payment Household ${randomUUID()}`
    })
    await db.insert(schema.members).values({
      id: memberId,
      householdId,
      telegramUserId: '30003',
      displayName: 'Ion'
    })
    await db.insert(schema.billingCycles).values({
      id: cycleId,
      householdId,
      period: '2026-05',
      currency: 'GEL'
    })

    const financeClient = createDbFinanceRepository(databaseUrl!, householdId)
    const input = {
      cycleId,
      memberId,
      kind: 'rent' as const,
      amountMinor: 46900n,
      currency: 'GEL' as const,
      idempotencyKey,
      recordedAt: instantFromIso('2026-05-18T16:33:08.848Z')
    }

    const first = await financeClient.repository.addPaymentRecordIfNew(input)
    const duplicate = await financeClient.repository.addPaymentRecordIfNew(input)

    expect(first).toMatchObject({
      cycleId,
      memberId,
      kind: 'rent',
      amountMinor: 46900n,
      currency: 'GEL'
    })
    expect(duplicate).toBeNull()

    const rows = await db
      .select({
        id: schema.paymentRecords.id,
        idempotencyKey: schema.paymentRecords.idempotencyKey
      })
      .from(schema.paymentRecords)
      .where(eq(schema.paymentRecords.idempotencyKey, idempotencyKey))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe(first?.id)

    await financeClient.close()
    await queryClient.end({ timeout: 5 })
  })

  testIfDatabase('keeps purchase author unchanged when the payer changes', async () => {
    const { db, queryClient } = createDbClient(databaseUrl!, {
      max: 1,
      prepare: false
    })
    const householdId = randomUUID()
    const cycleId = randomUUID()
    const authorMemberId = randomUUID()
    const nextPayerMemberId = randomUUID()

    createdHouseholdIds.push(householdId)

    await db.insert(schema.households).values({
      id: householdId,
      name: `Purchase Author Household ${randomUUID()}`
    })
    await db.insert(schema.members).values([
      {
        id: authorMemberId,
        householdId,
        telegramUserId: '40004',
        displayName: 'Author'
      },
      {
        id: nextPayerMemberId,
        householdId,
        telegramUserId: '50005',
        displayName: 'Next payer'
      }
    ])
    await db.insert(schema.billingCycles).values({
      id: cycleId,
      householdId,
      period: '2026-07',
      currency: 'GEL'
    })

    const financeClient = createDbFinanceRepository(databaseUrl!, householdId)
    const created = await financeClient.repository.addParsedPurchase({
      cycleId,
      createdByMemberId: authorMemberId,
      payerMemberId: authorMemberId,
      amountMinor: 3000n,
      currency: 'GEL',
      description: 'Kettle',
      occurredAt: instantFromIso('2026-07-12T12:00:00.000Z')
    })
    const updated = await financeClient.repository.updateParsedPurchase({
      purchaseId: created.id,
      payerMemberId: nextPayerMemberId,
      amountMinor: 3000n,
      currency: 'GEL',
      description: 'Kettle'
    })

    expect(updated).toMatchObject({
      createdByMemberId: authorMemberId,
      payerMemberId: nextPayerMemberId
    })

    const rows = await db
      .select({
        senderMemberId: schema.purchaseMessages.senderMemberId,
        payerMemberId: schema.purchaseMessages.payerMemberId
      })
      .from(schema.purchaseMessages)
      .where(eq(schema.purchaseMessages.id, created.id))
    expect(rows[0]).toEqual({
      senderMemberId: authorMemberId,
      payerMemberId: nextPayerMemberId
    })

    await financeClient.close()
    await queryClient.end({ timeout: 5 })
  })

  testIfDatabase('reads a complete settlement snapshot with archive metadata', async () => {
    const { db, queryClient } = createDbClient(databaseUrl!, {
      max: 1,
      prepare: false
    })
    const householdId = randomUUID()
    const cycleId = randomUUID()
    const memberId = randomUUID()

    createdHouseholdIds.push(householdId)

    await db.insert(schema.households).values({
      id: householdId,
      name: `History Snapshot Household ${randomUUID()}`
    })
    await db.insert(schema.members).values({
      id: memberId,
      householdId,
      telegramUserId: '60006',
      displayName: 'Archive member'
    })
    await db.insert(schema.billingCycles).values({
      id: cycleId,
      householdId,
      period: '2026-06',
      currency: 'GEL'
    })

    const financeClient = createDbFinanceRepository(databaseUrl!, householdId)
    await financeClient.repository.replaceSettlementSnapshot({
      cycleId,
      inputHash: 'history-snapshot',
      totalDueMinor: 75_000n,
      currency: 'GEL',
      metadata: {
        cycleHistoryArchive: {
          version: 1,
          period: '2026-06'
        }
      },
      lines: [
        {
          memberId,
          rentShareMinor: 60_000n,
          utilityShareMinor: 15_000n,
          purchaseOffsetMinor: 0n,
          netDueMinor: 75_000n,
          explanations: ['Frozen at cycle close']
        }
      ]
    })

    const snapshot = await financeClient.repository.getSettlementSnapshot(cycleId)

    expect(snapshot).toEqual({
      cycleId,
      inputHash: 'history-snapshot',
      totalDueMinor: 75_000n,
      currency: 'GEL',
      metadata: {
        cycleHistoryArchive: {
          version: 1,
          period: '2026-06'
        }
      },
      lines: [
        {
          memberId,
          rentShareMinor: 60_000n,
          utilityShareMinor: 15_000n,
          purchaseOffsetMinor: 0n,
          netDueMinor: 75_000n,
          explanations: ['Frozen at cycle close']
        }
      ]
    })

    await financeClient.close()
    await queryClient.end({ timeout: 5 })
  })
})
