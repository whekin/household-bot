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
  'real PostgreSQL: Ion pays, screenshot adds late internet, only the top-up is recorded once',
  async () => {
    const client = createDbClient(databaseUrl!)
    const configuration = createDbHouseholdConfigurationRepository(databaseUrl!)
    for (const allPaidBefore of [false, true]) {
      const householdId = crypto.randomUUID()
      const ionId = crypto.randomUUID()
      const stasId = crypto.randomUUID()
      const cycleId = crypto.randomUUID()
      const local = nowInstant().toZonedDateTimeISO('Asia/Tbilisi')
      const period = `${local.year}-${String(local.month).padStart(2, '0')}`
      const finance = createDbFinanceRepository(databaseUrl!, householdId)
      try {
        await client.db
          .insert(schema.households)
          .values({ id: householdId, name: 'Late bill integration' })
        await client.db.insert(schema.householdBillingSettings).values({
          householdId,
          settlementCurrency: 'GEL',
          rentCurrency: 'GEL',
          rentAmountMinor: 0n,
          paymentBalanceAdjustmentPolicy: 'utilities'
        })
        await client.db.insert(schema.members).values([
          { id: ionId, householdId, telegramUserId: 'ion-test', displayName: 'Ion' },
          { id: stasId, householdId, telegramUserId: 'stas-test', displayName: 'Stas', isAdmin: 1 }
        ])
        await client.db.insert(schema.householdUtilityCategories).values([
          { householdId, slug: 'electricity', name: 'Electricity' },
          { householdId, slug: 'gas', name: 'Gas' },
          { householdId, slug: 'internet', name: 'Internet' }
        ])
        await client.db
          .insert(schema.billingCycles)
          .values({ id: cycleId, householdId, period, currency: 'GEL' })
        const service = createFinanceCommandService({
          householdId,
          repository: finance.repository,
          householdConfigurationRepository: configuration.repository,
          exchangeRateProvider: {
            getRate: async (input) => ({ ...input, rateMicros: 1000000n, source: 'nbg' })
          }
        })
        await service.addUtilityBills(
          [
            { billName: 'Electricity', amountMajor: '30.00' },
            { billName: 'Gas', amountMajor: '30.00' }
          ],
          stasId,
          'GEL',
          period
        )
        const before = await service.generateDashboard(period)
        const originalIonBill = before!.utilityBillingPlan!.categories.find(
          (row) => row.assignedMemberId === ionId
        )!
        const paid = await service.closePaymentPeriod({
          kind: 'utilities',
          periodArg: period,
          memberIds: [ionId],
          actorMemberId: ionId
        })
        expect(paid!.closedMembers[0]!.amount.amountMinor).toBe(3000n)
        if (allPaidBefore) {
          await service.closePaymentPeriod({
            kind: 'utilities',
            periodArg: period,
            memberIds: [stasId],
            actorMemberId: stasId
          })
          expect((await service.generateDashboard(period))!.utilityBillingPlan!.status).toBe(
            'settled'
          )
        }
        const imports = createUtilityBillImportService(finance.utilityBillImports)
        const preview = await imports.preview(period, [
          { billName: originalIonBill.billName, amountMajor: '0.00' },
          { billName: 'Internet', amountMajor: '20.00' }
        ])
        expect(preview.blocked).toBeNull()
        expect(preview.preservedPaidBills).toContain(originalIonBill.billName)
        expect(await imports.confirm(preview, stasId)).toBe('applied')
        const updated = (await service.generateDashboard(period))!
        const ion = updated.utilityBillingPlan!.memberSummaries.find(
          (row) => row.memberId === ionId
        )!
        expect(ion.vendorPaid.amountMinor).toBe(3000n)
        expect(ion.assignedThisCycle.amountMinor).toBe(1000n)
        expect(
          updated.utilityBillingPlan!.categories.find(
            (row) => row.utilityBillId === originalIonBill.utilityBillId
          )!.remainingAmount.amountMinor
        ).toBe(0n)
        expect(updated.utilityBillingPlan!.status).toBe('active')
        const topup = await service.closePaymentPeriod({
          kind: 'utilities',
          periodArg: period,
          memberIds: [ionId],
          actorMemberId: ionId
        })
        expect(topup!.closedMembers[0]!.amount.amountMinor).toBe(1000n)
        await service.closePaymentPeriod({
          kind: 'utilities',
          periodArg: period,
          memberIds: [ionId],
          actorMemberId: ionId
        })
        const records = await finance.repository.listPaymentRecordsForCycle(cycleId)
        expect(
          records
            .filter((row) => row.memberId === ionId)
            .map((row) => row.amountMinor)
            .sort((a, b) => (a < b ? -1 : 1))
        ).toEqual([1000n, 3000n])
        expect(
          (await finance.repository.listUtilityBillsForCycle(cycleId)).find(
            (bill) => bill.id === originalIonBill.utilityBillId
          )!.amountMinor
        ).toBe(3000n)
        const facts = await finance.repository.listUtilityVendorPaymentFactsForCycle(cycleId)
        expect(
          facts
            .filter((fact) => fact.utilityBillId === originalIonBill.utilityBillId)
            .reduce((sum, fact) => sum + fact.amountMinor, 0n)
        ).toBe(3000n)
        expect(
          (await imports.preview(period, [{ billName: 'Internet', amountMajor: '20.00' }])).changes
        ).toEqual([])
      } finally {
        await client.db
          .delete(schema.billingCycles)
          .where(eq(schema.billingCycles.householdId, householdId))
        await client.db.delete(schema.households).where(eq(schema.households.id, householdId))
        await finance.close()
      }
    }
    await configuration.close()
    await client.close()
  },
  30000
)
