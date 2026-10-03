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
