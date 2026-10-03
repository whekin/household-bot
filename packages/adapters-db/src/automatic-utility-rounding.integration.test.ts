import { expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { createUtilityBillImportService } from '@household/application'
import { createDbClient, schema } from '@household/db'
import { createUtilityBillImportRepository } from './utility-bill-import-repository'

const databaseUrl = process.env.UTILITY_IMPORT_TEST_DATABASE_URL
const integration = databaseUrl ? test : test.skip

integration(
  'ordinary screenshot Save automatically reconciles cents once with recorded contributors',
  async () => {
    const client = createDbClient(databaseUrl!)
    const householdId = crypto.randomUUID(),
      ion = crypto.randomUUID(),
      stas = crypto.randomUUID(),
      cycle = crypto.randomUUID()
    try {
      await client.db
        .insert(schema.households)
        .values({ id: householdId, name: 'Automatic cents regression' })
      await client.db.insert(schema.members).values([
        { id: ion, householdId, telegramUserId: 'auto-ion', displayName: 'Ion' },
        { id: stas, householdId, telegramUserId: 'auto-stas', displayName: 'Stas' }
      ])
      await client.db
        .insert(schema.billingCycles)
        .values({ id: cycle, householdId, period: '2026-10', currency: 'GEL' })
      await client.db.insert(schema.householdUtilityCategories).values([
        { householdId, slug: 'gas', name: 'Gas' },
        { householdId, slug: 'internet', name: 'Internet' }
      ])
      const [gas] = await client.db
        .insert(schema.utilityBills)
        .values({
          householdId,
          cycleId: cycle,
          billName: 'Gas',
          amountMinor: 7230n,
          currency: 'GEL',
          source: 'test',
          createdByMemberId: stas
        })
        .returning()
      await client.db.insert(schema.utilityVendorPaymentFacts).values({
        householdId,
        cycleId: cycle,
        utilityBillId: gas!.id,
        billName: 'Gas',
        payerMemberId: ion,
        amountMinor: 5193n,
        currency: 'GEL',
        recordedAt: new Date()
      })
      const repository = createUtilityBillImportRepository(client.db, householdId)
      const service = createUtilityBillImportService(repository)
      const entries = [
        { billName: 'Gas', amountMajor: '20.30' },
        { billName: 'Internet', amountMajor: '61.39' }
      ]
      const preview = await service.preview('2026-10', entries)
      expect(preview.automaticPayments).toMatchObject([{ payerMemberId: ion, amountMinor: '7' }])
      // Stas is not an admin: bounded deterministic attribution needs no payer picker.
      const results = await Promise.all([
        service.confirm(preview, stas),
        service.confirm(preview, stas)
      ])
      expect(results.filter((result) => result === 'applied')).toHaveLength(1)
      const snapshot = await repository.getSnapshot('2026-10')
      expect(snapshot.paidByBillId[gas!.id]).toBe('5200')
      expect(snapshot.bills.find((bill) => bill.id === gas!.id)?.amountMinor).toBe('7230')
      expect(snapshot.bills.filter((bill) => bill.billName === 'Internet')).toHaveLength(1)
      const payments = await client.db
        .select()
        .from(schema.paymentRecords)
        .where(eq(schema.paymentRecords.householdId, householdId))
      expect(payments).toHaveLength(1)
      expect(payments[0]).toMatchObject({ memberId: ion, amountMinor: 7n })
      expect(await service.confirm(await service.preview('2026-10', entries), stas)).toBe(
        'unchanged'
      )
      const beforeOwnerChange = await service.preview('2026-10', [
        { billName: 'Gas', amountMajor: '20.23' }
      ])
      const [rounding] = await client.db
        .select()
        .from(schema.utilityVendorPaymentFacts)
        .where(eq(schema.utilityVendorPaymentFacts.paymentRecordId, payments[0]!.id))
      await client.db
        .update(schema.utilityVendorPaymentFacts)
        .set({ payerMemberId: stas })
        .where(eq(schema.utilityVendorPaymentFacts.id, rounding!.id))
      expect(await service.confirm(beforeOwnerChange, stas)).toBe('stale')
      expect(
        await client.db
          .select()
          .from(schema.paymentRecords)
          .where(eq(schema.paymentRecords.householdId, householdId))
      ).toHaveLength(1)
      // A separate bill has two known contributors: a9-tetri difference splits6/3.
      await client.db
        .insert(schema.householdUtilityCategories)
        .values({ householdId, slug: 'water', name: 'Water' })
      const [water] = await client.db
        .insert(schema.utilityBills)
        .values({
          householdId,
          cycleId: cycle,
          billName: 'Water',
          amountMinor: 1000n,
          currency: 'GEL',
          source: 'test',
          createdByMemberId: stas
        })
        .returning()
      await client.db.insert(schema.utilityVendorPaymentFacts).values([
        {
          householdId,
          cycleId: cycle,
          utilityBillId: water!.id,
          billName: 'Water',
          payerMemberId: ion,
          amountMinor: 200n,
          currency: 'GEL',
          recordedAt: new Date()
        },
        {
          householdId,
          cycleId: cycle,
          utilityBillId: water!.id,
          billName: 'Water',
          payerMemberId: stas,
          amountMinor: 100n,
          currency: 'GEL',
          recordedAt: new Date()
        }
      ])
      const weighted = await service.preview('2026-10', [
        { billName: 'Water', amountMajor: '6.91' }
      ])
      expect(await service.confirm(weighted, stas)).toBe('applied')
      const waterFacts = await client.db
        .select()
        .from(schema.utilityVendorPaymentFacts)
        .where(eq(schema.utilityVendorPaymentFacts.utilityBillId, water!.id))
      expect(
        waterFacts
          .filter((fact) => fact.payerMemberId === ion)
          .reduce((sum, fact) => sum + fact.amountMinor, 0n)
      ).toBe(206n)
      expect(
        waterFacts
          .filter((fact) => fact.payerMemberId === stas)
          .reduce((sum, fact) => sum + fact.amountMinor, 0n)
      ).toBe(103n)
      const budgetSnapshot = await repository.getSnapshot('2026-10')
      await expect(
        repository.apply({
          period: '2026-10',
          expectedRevision: budgetSnapshot.revision,
          createdByMemberId: stas,
          changes: [],
          automaticRoundingBalances: [
            { utilityBillId: gas!.id, observedMinor: '2000' },
            { utilityBillId: water!.id, observedMinor: '661' }
          ]
        })
      ).rejects.toThrow('total limit')
      expect((await repository.getSnapshot('2026-10')).paidByBillId[water!.id]).toBe('309')
    } finally {
      await client.db
        .delete(schema.billingCycles)
        .where(eq(schema.billingCycles.householdId, householdId))
      await client.db.delete(schema.households).where(eq(schema.households.id, householdId))
      await client.close()
    }
  },
  15000
)
