import { expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { createFinanceCommandService, createUtilityBillImportService } from '@household/application'
import { createDbClient, schema } from '@household/db'
import { nowInstant } from '@household/domain'
import { createDbFinanceRepository } from './finance-repository'
import { createDbHouseholdConfigurationRepository } from './household-config-repository'

const databaseUrl = process.env.UTILITY_IMPORT_TEST_DATABASE_URL
const integration = databaseUrl ? test : test.skip

integration(
  'PostgreSQL rounded/unreported payments require attribution and credit the chosen payer once',
  async () => {
    const client = createDbClient(databaseUrl!)
    const configuration = createDbHouseholdConfigurationRepository(databaseUrl!)
    const householdId = crypto.randomUUID()
    const ionId = crypto.randomUUID()
    const stasId = crypto.randomUUID()
    const finance = createDbFinanceRepository(databaseUrl!, householdId)
    const local = nowInstant().toZonedDateTimeISO('Asia/Tbilisi')
    const period = `${local.year}-${String(local.month).padStart(2, '0')}`
    try {
      await client.db
        .insert(schema.households)
        .values({ id: householdId, name: 'Rounding regression' })
      await client.db.insert(schema.householdBillingSettings).values({
        householdId,
        settlementCurrency: 'GEL',
        rentCurrency: 'GEL',
        rentAmountMinor: 0n,
        paymentBalanceAdjustmentPolicy: 'utilities'
      })
      await client.db.insert(schema.members).values([
        { id: ionId, householdId, telegramUserId: 'round-ion', displayName: 'Ion' },
        { id: stasId, householdId, telegramUserId: 'round-stas', displayName: 'Stas', isAdmin: 1 }
      ])
      await client.db.insert(schema.householdUtilityCategories).values([
        { householdId, slug: 'gas', name: 'Gas' },
        { householdId, slug: 'internet', name: 'Internet' }
      ])
      const service = createFinanceCommandService({
        householdId,
        repository: finance.repository,
        householdConfigurationRepository: configuration.repository,
        exchangeRateProvider: {
          getRate: async (input) => ({ ...input, rateMicros: 1000000n, source: 'nbg' })
        }
      })
      await service.addUtilityBills(
        [{ billName: 'Gas', amountMajor: '72.30' }],
        stasId,
        'GEL',
        period
      )
      const cycle = (await finance.repository.getCycleByPeriod(period))!
      const gas = (await finance.repository.listUtilityBillsForCycle(cycle.id))[0]!
      await service.recordUtilityVendorPayment({
        utilityBillId: gas.id,
        payerMemberId: ionId,
        actorMemberId: stasId,
        amountArg: '51.93',
        periodArg: period
      })
      await client.db.insert(schema.paymentRecords).values({
        householdId,
        cycleId: cycle.id,
        memberId: ionId,
        kind: 'utilities',
        amountMinor: 5193n,
        currency: 'GEL',
        recordedAt: new Date()
      })
      await service.generateDashboard(period)
      const imports = createUtilityBillImportService(finance.utilityBillImports)
      const entries = [
        { billName: 'Gas', amountMajor: '20.30' },
        { billName: 'Internet', amountMajor: '61.39' }
      ]
      const initial = await imports.preview(period, entries)
      expect(initial.blocked).toBeNull()
      expect(await imports.confirm(initial, stasId)).toBe('applied')
      expect(await finance.repository.listUtilityVendorPaymentFactsForCycle(cycle.id)).toHaveLength(
        1
      )
      const before = (await service.generateDashboard(period))!
      const ionBefore = before.utilityBillingPlan!.memberSummaries.find(
        (member) => member.memberId === ionId
      )!
      const stasBefore = before.utilityBillingPlan!.memberSummaries.find(
        (member) => member.memberId === stasId
      )!
      expect(ionBefore.vendorPaid.amountMinor).toBe(5193n)
      const preview = await imports.preview(period, entries)
      await expect(imports.confirmRoundingPayment(preview, gas.id, stasId, ionId)).rejects.toThrow(
        'administrator'
      )
      expect(await finance.repository.listUtilityVendorPaymentFactsForCycle(cycle.id)).toHaveLength(
        1
      )
      const results = await Promise.all([
        imports.confirmRoundingPayment(preview, gas.id, ionId, stasId),
        imports.confirmRoundingPayment(preview, gas.id, ionId, stasId)
      ])
      expect(results.filter((result) => result === 'applied')).toHaveLength(1)
      const after = (await service.generateDashboard(period))!
      const ionAfter = after.utilityBillingPlan!.memberSummaries.find(
        (member) => member.memberId === ionId
      )!
      const stasAfter = after.utilityBillingPlan!.memberSummaries.find(
        (member) => member.memberId === stasId
      )!
      expect(ionAfter.vendorPaid.amountMinor).toBe(5200n)
      expect(ionAfter.assignedThisCycle.amountMinor).toBe(
        ionBefore.assignedThisCycle.amountMinor - 7n
      )
      expect(stasAfter.vendorPaid.amountMinor).toBe(0n)
      expect(stasAfter.assignedThisCycle.amountMinor).toBe(stasBefore.assignedThisCycle.amountMinor)
      const facts = await finance.repository.listUtilityVendorPaymentFactsForCycle(cycle.id)
      const records = await finance.repository.listPaymentRecordsForCycle(cycle.id)
      expect(facts.map((fact) => fact.amountMinor).sort()).toEqual([5193n, 7n].sort())
      expect(records.reduce((sum, record) => sum + record.amountMinor, 0n)).toBe(5200n)
      expect(facts.find((fact) => fact.amountMinor === 7n)?.paymentRecordId).toBe(
        records.find((record) => record.amountMinor === 7n)?.id
      )
      expect(
        (await finance.repository.listUtilityBillsForCycle(cycle.id)).find(
          (bill) => bill.id === gas.id
        )?.amountMinor
      ).toBe(7230n)
      expect(await imports.confirmRoundingPayment(preview, gas.id, ionId, stasId)).toBe('stale')
      const changedRoles = await imports.preview(period, [
        { billName: 'Gas', amountMajor: '20.23' }
      ])
      await client.db
        .update(schema.members)
        .set({ isAdmin: 0 })
        .where(eq(schema.members.id, stasId))
      await expect(
        imports.confirmRoundingPayment(changedRoles, gas.id, ionId, stasId)
      ).rejects.toThrow('administrator')
      expect(await finance.repository.listUtilityVendorPaymentFactsForCycle(cycle.id)).toHaveLength(
        2
      )
      expect(await finance.repository.listPaymentRecordsForCycle(cycle.id)).toHaveLength(2)
      // The next small difference may be an unreported payment by somebody else.
      // Explicit attribution to that member must credit them, not the prior payer.
      expect(await imports.confirmRoundingPayment(changedRoles, gas.id, stasId, stasId)).toBe(
        'applied'
      )
      const otherPayer = (await service.generateDashboard(period))!.utilityBillingPlan!
      expect(
        otherPayer.memberSummaries.find((member) => member.memberId === ionId)?.vendorPaid
          .amountMinor
      ).toBe(5200n)
      expect(
        otherPayer.memberSummaries.find((member) => member.memberId === stasId)?.vendorPaid
          .amountMinor
      ).toBe(7n)
      expect(
        otherPayer.memberSummaries.find((member) => member.memberId === stasId)?.assignedThisCycle
          .amountMinor
      ).toBe(stasAfter.assignedThisCycle.amountMinor - 7n)
      await client.db
        .update(schema.members)
        .set({ lifecycleStatus: 'away' })
        .where(eq(schema.members.id, stasId))
      const away = await imports.preview(period, [{ billName: 'Gas', amountMajor: '20.16' }])
      expect(await imports.confirmRoundingPayment(away, gas.id, stasId, stasId)).toBe('applied')
      const departed = await imports.preview(period, [{ billName: 'Gas', amountMajor: '20.09' }])
      await client.db
        .update(schema.members)
        .set({ lifecycleStatus: 'left' })
        .where(eq(schema.members.id, stasId))
      await expect(
        imports.confirmRoundingPayment(departed, gas.id, stasId, stasId)
      ).rejects.toThrow('administrator')
      expect(
        (await finance.repository.listUtilityVendorPaymentFactsForCycle(cycle.id)).reduce(
          (sum, fact) => sum + fact.amountMinor,
          0n
        )
      ).toBe(5214n)
      await client.db
        .update(schema.members)
        .set({ lifecycleStatus: 'active', isAdmin: 1 })
        .where(eq(schema.members.id, stasId))
      const roundingRecord = records.find((record) => record.amountMinor === 7n)!
      const roundingFact = facts.find((fact) => fact.amountMinor === 7n)!
      await service.updatePayment(roundingRecord.id, ionId, 'utilities', '0.10', 'GEL')
      expect(
        (await finance.repository.getUtilityVendorPaymentFact(roundingFact.id))?.amountMinor
      ).toBe(10n)
      await expect(
        service.updatePayment(roundingRecord.id, ionId, 'utilities', '100.00', 'GEL')
      ).rejects.toThrow('exceeds')
      expect(
        (await finance.repository.getUtilityVendorPaymentFact(roundingFact.id))?.amountMinor
      ).toBe(10n)
      expect((await finance.repository.getPaymentRecord(roundingRecord.id))?.amountMinor).toBe(10n)
      expect((await finance.repository.getPaymentRecord(roundingRecord.id))?.amountMinor).toBe(10n)
      await expect(
        service.updatePayment(roundingRecord.id, stasId, 'utilities', '0.12', 'GEL', ionId)
      ).rejects.toThrow('administrator')
      expect(
        (await finance.repository.getUtilityVendorPaymentFact(roundingFact.id))?.payerMemberId
      ).toBe(ionId)
      await service.updatePayment(roundingRecord.id, stasId, 'utilities', '0.12', 'GEL', stasId)
      expect(await finance.repository.getUtilityVendorPaymentFact(roundingFact.id)).toMatchObject({
        payerMemberId: stasId,
        amountMinor: 12n,
        matchedPlan: false
      })
      expect(await finance.repository.getPaymentRecord(roundingRecord.id)).toMatchObject({
        memberId: stasId,
        amountMinor: 12n
      })
      await expect(
        service.updatePayment(roundingRecord.id, stasId, 'rent', '0.12', 'GEL')
      ).rejects.toThrow('must remain')
      await expect(
        service.updatePayment(roundingRecord.id, stasId, 'utilities', '0.12', 'USD')
      ).rejects.toThrow('must remain')
      expect(
        (await finance.repository.getUtilityVendorPaymentFact(roundingFact.id))?.amountMinor
      ).toBe(12n)
      const moved = (await service.generateDashboard(period))!.utilityBillingPlan!
      expect(
        moved.memberSummaries.find((member) => member.memberId === ionId)?.vendorPaid.amountMinor
      ).toBe(5193n)
      expect(
        moved.memberSummaries.find((member) => member.memberId === stasId)?.vendorPaid.amountMinor
      ).toBe(26n)
      expect(await service.deleteUtilityVendorPaymentFact(roundingFact.id)).toBe(true)
      expect(await finance.repository.getUtilityVendorPaymentFact(roundingFact.id)).toBeNull()
      expect(await finance.repository.getPaymentRecord(roundingRecord.id)).toBeNull()
      const directDelete = (await finance.repository.listPaymentRecordsForCycle(cycle.id)).find(
        (record) => record.amountMinor === 7n
      )!
      expect(await service.deletePayment(directDelete.id)).toBe(true)
      expect(
        (await finance.repository.listUtilityVendorPaymentFactsForCycle(cycle.id)).reduce(
          (sum, fact) => sum + fact.amountMinor,
          0n
        )
      ).toBe(5200n)

      expect(
        (await finance.repository.listPaymentRecordsForCycle(cycle.id)).reduce(
          (sum, record) => sum + record.amountMinor,
          0n
        )
      ).toBe(5200n)
      await client.db
        .insert(schema.householdUtilityCategories)
        .values({ householdId, slug: 'cleaning', name: 'Cleaning' })
      await service.addUtilityBills(
        [{ billName: 'Cleaning', amountMajor: '2.50' }],
        stasId,
        'GEL',
        period
      )
      const cleaning = (await finance.repository.listUtilityBillsForCycle(cycle.id)).find(
        (bill) => bill.billName === 'Cleaning'
      )!
      await service.recordUtilityVendorPayment({
        utilityBillId: cleaning.id,
        payerMemberId: ionId,
        actorMemberId: stasId,
        amountArg: '2.43',
        periodArg: period
      })
      const cleaningPreview = await imports.preview(period, [
        { billName: 'Cleaning', amountMajor: '0.00' }
      ])
      expect(
        await imports.confirmRoundingPayment(cleaningPreview, cleaning.id, ionId, stasId)
      ).toBe('applied')
      const cleaningFact = (
        await finance.repository.listUtilityVendorPaymentFactsForCycle(cycle.id)
      ).find((fact) => fact.utilityBillId === cleaning.id && fact.paymentRecordId)!
      await expect(
        service.updatePayment(cleaningFact.paymentRecordId!, ionId, 'utilities', '0.10', 'GEL')
      ).rejects.toThrow('exceeds')
      expect(
        (await finance.repository.getUtilityVendorPaymentFact(cleaningFact.id))?.amountMinor
      ).toBe(7n)
      expect(
        (await finance.repository.getPaymentRecord(cleaningFact.paymentRecordId!))?.amountMinor
      ).toBe(7n)
      await client.db
        .insert(schema.householdUtilityCategories)
        .values({ householdId, slug: 'water', name: 'Water' })
      await service.addUtilityBills(
        [{ billName: 'Water', amountMajor: '1.00' }],
        stasId,
        'GEL',
        period
      )
      const water = (await finance.repository.listUtilityBillsForCycle(cycle.id)).find(
        (bill) => bill.billName === 'Water'
      )!
      const claim = {
        cycleId: cycle.id,
        utilityBillId: water.id,
        billName: 'Water',
        amountMinor: 70n,
        currency: 'GEL' as const,
        matchedPlan: false,
        recordedAt: nowInstant()
      }
      const claims = await Promise.allSettled([
        finance.repository.addUtilityVendorPaymentFactIfNew({
          ...claim,
          payerMemberId: ionId,
          idempotencyKey: `race-ion:${householdId}`
        }),
        finance.repository.addUtilityVendorPaymentFactIfNew({
          ...claim,
          payerMemberId: stasId,
          idempotencyKey: `race-stas:${householdId}`
        })
      ])
      expect(claims.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      const waterFacts = (
        await finance.repository.listUtilityVendorPaymentFactsForCycle(cycle.id)
      ).filter((fact) => fact.utilityBillId === water.id)
      expect(waterFacts).toHaveLength(1)
      expect(waterFacts[0]?.amountMinor).toBe(70n)
      expect(
        await finance.repository.addUtilityVendorPaymentFactIfNew({
          ...claim,
          payerMemberId: waterFacts[0]!.payerMemberId,
          idempotencyKey: `${waterFacts[0]!.payerMemberId === ionId ? 'race-ion' : 'race-stas'}:${householdId}`
        })
      ).toBeNull()
      await client.db
        .update(schema.billingCycles)
        .set({ closedAt: new Date() })
        .where(eq(schema.billingCycles.id, cycle.id))
      const replay = {
        ...claim,
        payerMemberId: waterFacts[0]!.payerMemberId,
        idempotencyKey: `${waterFacts[0]!.payerMemberId === ionId ? 'race-ion' : 'race-stas'}:${householdId}`
      }
      expect(await finance.repository.addUtilityVendorPaymentFactIfNew(replay)).toBeNull()
      await expect(
        finance.repository.addUtilityVendorPaymentFactIfNew({
          ...replay,
          amountMinor: 1n,
          idempotencyKey: `new-closed:${householdId}`
        })
      ).rejects.toThrow('closed')
    } finally {
      await client.db
        .delete(schema.billingCycles)
        .where(eq(schema.billingCycles.householdId, householdId))
      await client.db.delete(schema.households).where(eq(schema.households.id, householdId))
      await finance.close()
      await configuration.close()
      await client.close()
    }
  },
  30000
)
