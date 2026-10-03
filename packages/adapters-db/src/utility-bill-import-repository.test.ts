import { expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { createUtilityBillImportService } from '@household/application'
import { createDbClient, schema } from '@household/db'
import { createUtilityBillImportRepository } from './utility-bill-import-repository'

// Never use the application's DATABASE_URL for this suite.
const databaseUrl = process.env.UTILITY_IMPORT_TEST_DATABASE_URL
const integration = databaseUrl ? test : test.skip

integration(
  'PostgreSQL imports are atomic, concurrent confirmations cannot duplicate and stale/paid/closed cycles cannot change',
  async () => {
    const client = createDbClient(databaseUrl!)
    const householdId = crypto.randomUUID()
    const memberId = crypto.randomUUID()
    try {
      await client.db
        .insert(schema.households)
        .values({ id: householdId, name: 'Utility screenshot test' })
      await client.db.insert(schema.members).values({
        id: memberId,
        householdId,
        telegramUserId: 'utility-test',
        displayName: 'Test member'
      })
      await client.db.insert(schema.householdUtilityCategories).values([
        { householdId, slug: 'electricity', name: 'Electricity' },
        { householdId, slug: 'cleaning', name: 'Cleaning' }
      ])
      const repository = createUtilityBillImportRepository(client.db, householdId)
      const service = createUtilityBillImportService(repository)
      const entries = [
        { billName: 'Electricity', amountMajor: '44.02' },
        { billName: 'Cleaning', amountMajor: '2.50' }
      ]
      const preview = await service.preview('2026-10', entries)
      const outcomes = await Promise.all([
        service.confirm(preview, memberId),
        service.confirm(preview, memberId)
      ])
      expect(outcomes.filter((outcome) => outcome === 'applied')).toHaveLength(1)
      expect(outcomes.every((outcome) => ['applied', 'stale', 'unchanged'].includes(outcome))).toBe(
        true
      )
      const bills = await client.db
        .select()
        .from(schema.utilityBills)
        .where(eq(schema.utilityBills.householdId, householdId))
      expect(bills).toHaveLength(2)
      expect(bills.every((bill) => bill.source === 'bank_screenshot')).toBe(true)
      expect(await service.confirm(await service.preview('2026-10', entries), memberId)).toBe(
        'unchanged'
      )

      // A failing second entry rolls back the first entry and the new cycle.
      const rollback = await service.preview('2026-11', entries)
      await expect(
        repository.apply({
          period: '2026-11',
          expectedRevision: rollback.revision,
          createdByMemberId: memberId,
          changes: [
            { billId: null, billName: 'Electricity', amountMinor: '4402' },
            { billId: null, billName: 'Cleaning', amountMinor: '99999999999999999999999999' }
          ]
        })
      ).rejects.toThrow()
      expect((await repository.getSnapshot('2026-11')).bills).toEqual([])
      expect(
        await client.db
          .select()
          .from(schema.billingCycles)
          .where(eq(schema.billingCycles.period, '2026-11'))
      ).toEqual([])

      const revised = await service.preview('2026-10', [
        { billName: 'Electricity', amountMajor: '45.00' }
      ])
      await client.db
        .update(schema.utilityBills)
        .set({ amountMinor: 4600n })
        .where(
          eq(schema.utilityBills.id, bills.find((bill) => bill.billName === 'Electricity')!.id)
        )
      expect(await service.confirm(revised, memberId)).toBe('stale')

      const [cycle] = await client.db
        .select()
        .from(schema.billingCycles)
        .where(eq(schema.billingCycles.householdId, householdId))
      const beforePayment = await service.preview('2026-10', [
        { billName: 'Electricity', amountMajor: '45.00' }
      ])
      await client.db.insert(schema.paymentRecords).values({
        householdId,
        cycleId: cycle!.id,
        memberId,
        kind: 'utilities',
        amountMinor: 100n,
        currency: 'GEL',
        recordedAt: new Date()
      })
      expect(await service.confirm(beforePayment, memberId)).toBe('stale')
      expect(
        await repository.apply({
          period: '2026-10',
          expectedRevision: beforePayment.revision,
          changes: beforePayment.changes,
          createdByMemberId: memberId
        })
      ).toBe('stale')
      await client.db
        .update(schema.billingCycles)
        .set({ closedAt: new Date() })
        .where(eq(schema.billingCycles.id, cycle!.id))
      expect(await service.confirm(beforePayment, memberId)).toBe('closed')
    } finally {
      await client.db.delete(schema.households).where(eq(schema.households.id, householdId))
      await client.close()
    }
  },
  15000
)
