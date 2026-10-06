import { expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import {
  createFinanceCommandService,
  type FinanceDashboard,
  createPaymentConfirmationService
} from '@household/application'
import { createDbClient, schema } from '@household/db'
import { nowInstant, paymentFundingRevision } from '@household/domain'
import type { FinanceRepository } from '@household/ports'
import { createDbFinanceRepository } from './finance-repository'
import { createDbHouseholdConfigurationRepository } from './household-config-repository'

const databaseUrl = process.env.UTILITY_IMPORT_TEST_DATABASE_URL
const integration = databaseUrl ? test : test.skip

async function fixture(rateMicros = 1000000n) {
  const client = createDbClient(databaseUrl!)
  const config = createDbHouseholdConfigurationRepository(databaseUrl!)
  const householdId = crypto.randomUUID()
  const ids = {
    ion: crypto.randomUUID(),
    dima: crypto.randomUUID(),
    alisa: crypto.randomUUID(),
    stas: crypto.randomUUID()
  }
  const date = nowInstant().toZonedDateTimeISO('Asia/Tbilisi')
  const period = `${date.year}-${String(date.month).padStart(2, '0')}`
  const finance = createDbFinanceRepository(databaseUrl!, householdId)
  await client.db
    .insert(schema.households)
    .values({ id: householdId, name: 'Financial consistency regression' })
  await client.db.insert(schema.householdBillingSettings).values({
    householdId,
    settlementCurrency: 'GEL',
    rentCurrency: 'GEL',
    rentAmountMinor: 0n,
    paymentBalanceAdjustmentPolicy: 'utilities'
  })
  await client.db.insert(schema.members).values(
    Object.entries(ids).map(([name, id]) => ({
      id,
      householdId,
      telegramUserId: `audit-${name}-${householdId}`,
      displayName: name,
      isAdmin: name === 'stas' ? 1 : 0
    }))
  )
  await client.db.insert(schema.householdUtilityCategories).values(
    ['Gas', 'Electricity', 'Cleaning', 'Internet'].map((name) => ({
      householdId,
      slug: name.toLowerCase(),
      name
    }))
  )
  const service = createFinanceCommandService({
    householdId,
    repository: finance.repository,
    householdConfigurationRepository: config.repository,
    exchangeRateProvider: {
      getRate: async (input) => ({
        ...input,
        rateMicros: input.baseCurrency === input.quoteCurrency ? 1000000n : rateMicros,
        source: 'nbg'
      })
    }
  })
  const confirmations = createPaymentConfirmationService({
    householdId,
    repository: finance.repository,
    householdConfigurationRepository: config.repository,
    financeService: service,
    exchangeRateProvider: {
      getRate: async (input) => ({
        ...input,
        rateMicros: input.baseCurrency === input.quoteCurrency ? 1000000n : rateMicros,
        source: 'nbg'
      })
    }
  })
  await service.ensureExpectedCycle()
  return {
    client,
    config,
    finance,
    householdId,
    ids,
    period,
    service,
    confirmations,
    async cleanup() {
      await client.db
        .delete(schema.billingCycles)
        .where(eq(schema.billingCycles.householdId, householdId))
      await client.db
        .delete(schema.purchaseMessages)
        .where(eq(schema.purchaseMessages.householdId, householdId))
      await client.db.delete(schema.households).where(eq(schema.households.id, householdId))
      await Promise.all([client.close(), finance.close(), config.close()])
    }
  }
}

integration(
  'paid contributions carried into a late-bill plan keep issued amounts stable when purchases change',
  async () => {
    const f = await fixture()
    try {
      await f.service.addUtilityBills(
        [
          { billName: 'Gas', amountMajor: '72.30' },
          { billName: 'Electricity', amountMajor: '44.02' },
          { billName: 'Cleaning', amountMajor: '2.50' }
        ],
        f.ids.stas,
        'GEL',
        f.period
      )
      await f.service.closePaymentPeriod({
        kind: 'utilities',
        periodArg: f.period,
        memberIds: [f.ids.ion],
        actorMemberId: f.ids.ion
      })
      await f.service.addUtilityBill('Internet', '61.39', f.ids.stas, 'GEL', f.period)
      const before = (await f.service.generateDashboard(f.period))!
      await f.service.addPurchase('Later groceries', '4.00', f.ids.alisa, 'GEL')
      const after = (await f.service.generateDashboard(f.period))!
      expect(after.utilityBillingPlan!.version).toBe(before.utilityBillingPlan!.version)
      expect(after.utilityBillingPlan!.categories).toEqual(before.utilityBillingPlan!.categories)
      expect(after.paymentPeriods).toEqual(before.paymentPeriods)
      expect((await f.service.generateDashboard(f.period))!.utilityBillingPlan!.version).toBe(
        before.utilityBillingPlan!.version
      )
    } finally {
      await f.cleanup()
    }
  }
)

integration(
  'a confirmed 4 GEL electricity payment updates its provider and member once, then closes only the remainder',
  async () => {
    const f = await fixture()
    try {
      await f.service.addUtilityBill('Electricity', '40.00', f.ids.stas, 'GEL', f.period)
      const cycle = (await f.finance.repository.getCycleByPeriod(f.period))!
      const bill = (await f.finance.repository.listUtilityBillsForCycle(cycle.id))[0]!
      const confirmations = f.confirmations
      const message = {
        memberId: f.ids.ion,
        utilityBillId: bill.id,
        period: f.period,
        senderTelegramUserId: `audit-ion-${f.householdId}`,
        rawText: 'оплатил электричество 4 лари',
        telegramChatId: '-100audit',
        telegramMessageId: '400',
        telegramThreadId: '1',
        telegramUpdateId: '400',
        attachmentCount: 0,
        messageSentAt: nowInstant()
      }
      expect((await confirmations.submit(message)).status).toBe('recorded')
      expect(
        (await f.finance.repository.listPaymentRecordsForCycle(cycle.id)).map((p) => p.amountMinor)
      ).toEqual([400n])
      expect(
        (await f.finance.repository.listUtilityVendorPaymentFactsForCycle(cycle.id)).map(
          (p) => p.amountMinor
        )
      ).toEqual([400n])
      const dashboard = (await f.service.generateDashboard(f.period))!
      expect(
        dashboard.utilityBillingPlan!.categories.find((c) => c.assignedMemberId === f.ids.ion)!
          .remainingAmount.amountMinor
      ).toBe(600n)
      expect(
        dashboard
          .paymentPeriods![0]!.kinds.find((k) => k.kind === 'utilities')!
          .unresolvedMembers.find((m) => m.memberId === f.ids.ion)!.remaining.amountMinor
      ).toBe(600n)
      expect((await confirmations.submit(message)).status).toBe('duplicate')
      await f.service.closePaymentPeriod({
        kind: 'utilities',
        periodArg: f.period,
        memberIds: [f.ids.ion],
        actorMemberId: f.ids.ion
      })
      expect(
        (await f.finance.repository.listUtilityVendorPaymentFactsForCycle(cycle.id))
          .filter((p) => p.payerMemberId === f.ids.ion)
          .reduce((n, p) => n + p.amountMinor, 0n)
      ).toBe(1000n)
      expect(
        (await f.finance.repository.listPaymentRecordsForCycle(cycle.id))
          .filter((p) => p.memberId === f.ids.ion)
          .reduce((n, p) => n + p.amountMinor, 0n)
      ).toBe(1000n)
    } finally {
      await f.cleanup()
    }
  }
)

integration(
  'named utility confirmations serialize retries, reject overfunding, and keep edits and both deletion paths synchronized',
  async () => {
    const f = await fixture()
    try {
      await f.service.addUtilityBill('Electricity', '40.00', f.ids.stas, 'GEL', f.period)
      const cycle = (await f.finance.repository.getCycleByPeriod(f.period))!
      const bill = (await f.finance.repository.listUtilityBillsForCycle(cycle.id))[0]!
      const confirmations = f.confirmations
      const message = {
        memberId: f.ids.ion,
        utilityBillId: bill.id,
        period: f.period,
        senderTelegramUserId: `audit-ion-${f.householdId}`,
        rawText: 'оплатил электричество 4 лари',
        telegramChatId: '-100audit',
        telegramMessageId: '410',
        telegramThreadId: '1',
        telegramUpdateId: '410',
        attachmentCount: 0,
        messageSentAt: nowInstant()
      }
      const results = await Promise.all([
        confirmations.submit(message),
        confirmations.submit(message)
      ])
      expect(results.map((r) => r.status).sort()).toEqual(['duplicate', 'recorded'])
      const payment = (await f.finance.repository.listPaymentRecordsForCycle(cycle.id))[0]!
      await expect(
        confirmations.submit({
          ...message,
          telegramMessageId: '411',
          rawText: 'оплатил электричество 40 лари'
        })
      ).rejects.toThrow('remaining supplier balance')
      expect(
        await f.service.updatePayment(payment.id, f.ids.ion, 'utilities', '6.00', 'GEL', f.ids.ion)
      ).not.toBeNull()
      expect(
        (await f.finance.repository.listUtilityVendorPaymentFactsForCycle(cycle.id)).map(
          (p) => p.amountMinor
        )
      ).toEqual([600n])
      await expect(
        f.service.updatePayment(payment.id, f.ids.dima, 'utilities', '6.00', 'GEL', f.ids.ion)
      ).rejects.toThrow('administrator')
      expect(
        (await f.finance.repository.listPaymentRecordsForCycle(cycle.id)).map((p) => p.memberId)
      ).toEqual([f.ids.ion])
      const fact = (await f.finance.repository.listUtilityVendorPaymentFactsForCycle(cycle.id))[0]!
      expect(await f.finance.repository.deleteUtilityVendorPaymentFact(fact.id)).toBe(true)
      expect(await f.finance.repository.listPaymentRecordsForCycle(cycle.id)).toEqual([])
      expect(await f.finance.repository.listUtilityVendorPaymentFactsForCycle(cycle.id)).toEqual([])
      await confirmations.submit({ ...message, telegramMessageId: '412' })
      const again = (await f.finance.repository.listPaymentRecordsForCycle(cycle.id))[0]!
      expect(await f.service.deletePayment(again.id)).toBe(true)
      expect(await f.finance.repository.listUtilityVendorPaymentFactsForCycle(cycle.id)).toEqual([])
      expect(await f.finance.repository.listPaymentRecordsForCycle(cycle.id)).toEqual([])
      const dashboard = (await f.service.generateDashboard(f.period))!
      expect(
        dashboard.paymentPeriods![0]!.kinds.find((k) => k.kind === 'utilities')!.totalRemaining
          .amountMinor
      ).toBe(4000n)
      expect(
        dashboard.utilityBillingPlan!.categories.reduce(
          (n, c) => n + c.remainingAmount.amountMinor,
          0n
        )
      ).toBe(4000n)
    } finally {
      await f.cleanup()
    }
  },
  30000
)

integration(
  'partial utility installments clear only purchase debt funded by cumulative real payments',
  async () => {
    const f = await fixture()
    try {
      await f.service.ensureExpectedCycle()
      await f.service.addPurchase('Shared goods', '40.00', f.ids.stas, 'GEL')
      await f.service.addUtilityBill('Electricity', '80.00', f.ids.stas, 'GEL', f.period)
      const cycle = (await f.finance.repository.getCycleByPeriod(f.period))!
      const bill = (await f.finance.repository.listUtilityBillsForCycle(cycle.id))[0]!
      const confirmations = f.confirmations
      const message = {
        memberId: f.ids.ion,
        utilityBillId: bill.id,
        period: f.period,
        senderTelegramUserId: `audit-ion-${f.householdId}`,
        rawText: 'оплатил электричество 25 лари',
        telegramChatId: '-100audit',
        telegramMessageId: '420',
        telegramThreadId: '1',
        telegramUpdateId: '420',
        attachmentCount: 0,
        messageSentAt: nowInstant()
      }
      await confirmations.submit(message)
      expect(
        (await f.service.generateDashboard(f.period))!.members.find(
          (m) => m.memberId === f.ids.ion
        )!.purchaseOffset.amountMinor
      ).toBe(500n)
      await confirmations.submit({
        ...message,
        telegramMessageId: '421',
        rawText: 'доплатил электричество 3 лари'
      })
      expect(
        (await f.service.generateDashboard(f.period))!.members.find(
          (m) => m.memberId === f.ids.ion
        )!.purchaseOffset.amountMinor
      ).toBe(200n)
      const allocations = await f.finance.repository.listPaymentPurchaseAllocations()
      expect(
        allocations.filter((a) => a.memberId === f.ids.ion).reduce((n, a) => n + a.amountMinor, 0n)
      ).toBe(800n)
      const fundingRecords = (
        await f.finance.repository.listPaymentRecordsForCycle(cycle.id)
      ).filter((p) => p.memberId === f.ids.ion)
      const last = fundingRecords.at(-1)!
      await expect(
        f.finance.repository.replacePaymentPurchaseAllocations({
          paymentRecordId: last.id,
          cycleId: cycle.id,
          replaceRecordIds: fundingRecords.map((p) => p.id),
          expectedPaymentRevision: paymentFundingRevision([]),
          resolutionMethod: 'utilities_plan',
          allocations: []
        })
      ).rejects.toThrow('Payment funding changed')
      expect(
        (await f.finance.repository.listPaymentPurchaseAllocations())
          .filter((a) => a.memberId === f.ids.ion)
          .reduce((n, a) => n + a.amountMinor, 0n)
      ).toBe(800n)
      const first = (await f.finance.repository.listPaymentRecordsForCycle(cycle.id)).find(
        (p) => p.amountMinor === 2500n
      )!
      await f.service.updatePayment(first.id, f.ids.ion, 'utilities', '15.00', 'GEL', f.ids.ion)
      expect(
        (await f.service.generateDashboard(f.period))!.members.find(
          (m) => m.memberId === f.ids.ion
        )!.purchaseOffset.amountMinor
      ).toBe(1000n)
      expect(
        (await f.finance.repository.listPaymentPurchaseAllocations()).filter(
          (a) => a.memberId === f.ids.ion
        )
      ).toEqual([])
      await f.service.updatePayment(first.id, f.ids.ion, 'utilities', '25.00', 'GEL', f.ids.ion)
      expect(
        (await f.service.generateDashboard(f.period))!.members.find(
          (m) => m.memberId === f.ids.ion
        )!.purchaseOffset.amountMinor
      ).toBe(200n)
      await f.service.deletePayment(first.id)
      expect(
        (await f.service.generateDashboard(f.period))!.members.find(
          (m) => m.memberId === f.ids.ion
        )!.purchaseOffset.amountMinor
      ).toBe(1000n)
    } finally {
      await f.cleanup()
    }
  }
)

integration(
  'named utility payments honor fixed FX and reject a closed period without writing',
  async () => {
    const f = await fixture(2700000n)
    try {
      await f.service.addUtilityBill('Electricity', '40.00', f.ids.stas, 'USD', f.period)
      const cycle = (await f.finance.repository.getCycleByPeriod(f.period))!
      const bill = (await f.finance.repository.listUtilityBillsForCycle(cycle.id))[0]!
      const message = {
        memberId: f.ids.ion,
        utilityBillId: bill.id,
        period: f.period,
        senderTelegramUserId: `audit-ion-${f.householdId}`,
        rawText: 'оплатил электричество 4 лари',
        telegramChatId: '-100audit',
        telegramMessageId: '430',
        telegramThreadId: '1',
        telegramUpdateId: '430',
        attachmentCount: 0,
        messageSentAt: nowInstant()
      }
      expect((await f.confirmations.submit(message)).status).toBe('recorded')
      const payment = (await f.finance.repository.listPaymentRecordsForCycle(cycle.id))[0]!
      expect(
        (await f.finance.repository.listUtilityVendorPaymentFactsForCycle(cycle.id)).map((p) => [
          p.amountMinor,
          p.currency
        ])
      ).toEqual([[400n, 'GEL']])
      expect(
        (await f.service.generateDashboard(f.period))!.utilityBillingPlan!.categories.reduce(
          (n, c) => n + c.remainingAmount.amountMinor,
          0n
        )
      ).toBe(10400n)
      await f.service.updatePayment(payment.id, f.ids.ion, 'utilities', '6.00', 'GEL', f.ids.ion)
      expect(
        (await f.finance.repository.listUtilityVendorPaymentFactsForCycle(cycle.id)).map(
          (p) => p.amountMinor
        )
      ).toEqual([600n])
      await f.service.closeCycle(f.period)
      await expect(
        f.finance.repository.savePaymentConfirmation({
          ...message,
          telegramMessageId: '431',
          normalizedText: message.rawText,
          status: 'recorded',
          cycleId: cycle.id,
          memberId: f.ids.ion,
          kind: 'utilities',
          amountMinor: 100n,
          currency: 'GEL',
          explicitAmountMinor: 100n,
          explicitCurrency: 'GEL',
          recordedAt: nowInstant()
        })
      ).rejects.toThrow('closed')
      expect(
        (await f.finance.repository.listPaymentRecordsForCycle(cycle.id)).map((p) => p.amountMinor)
      ).toEqual([600n])
    } finally {
      await f.cleanup()
    }
  }
)

integration(
  'late bills cannot reprice purchase funding already established by earlier receipts',
  async () => {
    const f = await fixture()
    try {
      await f.service.ensureExpectedCycle()
      await f.service.addPurchase('Shared goods', '40.00', f.ids.stas, 'GEL')
      await f.service.addUtilityBill('Electricity', '80.00', f.ids.stas, 'GEL', f.period)
      const cycle = (await f.finance.repository.getCycleByPeriod(f.period))!
      const bill = (await f.finance.repository.listUtilityBillsForCycle(cycle.id))[0]!
      const message = {
        memberId: f.ids.ion,
        utilityBillId: bill.id,
        period: f.period,
        senderTelegramUserId: `audit-ion-${f.householdId}`,
        rawText: 'оплатил электричество 25 лари',
        telegramChatId: '-100audit',
        telegramMessageId: '440',
        telegramThreadId: '1',
        telegramUpdateId: '440',
        attachmentCount: 0,
        messageSentAt: nowInstant()
      }
      await f.confirmations.submit(message)
      await f.service.addUtilityBill('Internet', '80.00', f.ids.stas, 'GEL', f.period)
      expect(
        (await f.service.generateDashboard(f.period))!.members.find(
          (m) => m.memberId === f.ids.ion
        )!.purchaseOffset.amountMinor
      ).toBe(500n)
      await f.confirmations.submit({
        ...message,
        telegramMessageId: '441',
        rawText: 'доплатил электричество 3 лари',
        messageSentAt: nowInstant().subtract({ hours: 2 })
      })
      expect(
        (await f.service.generateDashboard(f.period))!.members.find(
          (m) => m.memberId === f.ids.ion
        )!.purchaseOffset.amountMinor
      ).toBe(500n)
      const records = await f.finance.repository.listPaymentRecordsForCycle(cycle.id)
      const first = records.find((p) => p.amountMinor === 2500n)!
      const lastFact = (
        await f.finance.repository.listUtilityVendorPaymentFactsForCycle(cycle.id)
      ).find((p) => p.amountMinor === 300n)!
      expect(records.find((p) => p.amountMinor === 300n)!.fundingPhase! > first.fundingPhase!).toBe(
        true
      )
      await f.service.updatePayment(first.id, f.ids.ion, 'utilities', '24.00', 'GEL', f.ids.ion)
      expect(
        (await f.service.generateDashboard(f.period))!.members.find(
          (m) => m.memberId === f.ids.ion
        )!.purchaseOffset.amountMinor
      ).toBe(600n)
      await f.service.deleteUtilityVendorPaymentFact(lastFact.id)
      expect(
        (await f.service.generateDashboard(f.period))!.members.find(
          (m) => m.memberId === f.ids.ion
        )!.purchaseOffset.amountMinor
      ).toBe(600n)
      await f.service.deletePayment(first.id)
      expect(
        (await f.service.generateDashboard(f.period))!.members.find(
          (m) => m.memberId === f.ids.ion
        )!.purchaseOffset.amountMinor
      ).toBe(1000n)
    } finally {
      await f.cleanup()
    }
  }
)

integration(
  'a saved receipt survives reconciliation failure and retries repair balances without another payment',
  async () => {
    const f = await fixture()
    try {
      await f.service.ensureExpectedCycle()
      await f.service.addPurchase('Shared goods', '40.00', f.ids.stas, 'GEL')
      await f.service.addUtilityBill('Electricity', '80.00', f.ids.stas, 'GEL', f.period)
      const cycle = (await f.finance.repository.getCycleByPeriod(f.period))!
      const bill = (await f.finance.repository.listUtilityBillsForCycle(cycle.id))[0]!
      let fail = true
      const service = createPaymentConfirmationService({
        householdId: f.householdId,
        repository: f.finance.repository,
        householdConfigurationRepository: f.config.repository,
        financeService: {
          ...f.service,
          reconcilePaymentPurchaseAllocations: async (id) => {
            if (fail) throw new Error('temporary derived-state failure')
            await f.service.reconcilePaymentPurchaseAllocations(id)
          }
        },
        exchangeRateProvider: {
          getRate: async (input) => ({ ...input, rateMicros: 1000000n, source: 'nbg' })
        }
      })
      const message = {
        memberId: f.ids.ion,
        utilityBillId: bill.id,
        period: f.period,
        senderTelegramUserId: `audit-ion-${f.householdId}`,
        rawText: 'оплатил электричество 25 лари',
        telegramChatId: '-100audit',
        telegramMessageId: '450',
        telegramThreadId: '1',
        telegramUpdateId: '450',
        attachmentCount: 0,
        messageSentAt: nowInstant()
      }
      expect(await service.submit(message)).toMatchObject({
        status: 'recorded',
        balanceUpdatePending: true
      })
      expect(await f.finance.repository.listPendingPaymentReconciliations(cycle.id)).toHaveLength(1)
      fail = false
      expect(await service.submit(message)).toMatchObject({ status: 'duplicate' })
      expect(
        (await f.finance.repository.listPaymentRecordsForCycle(cycle.id)).map((p) => p.amountMinor)
      ).toEqual([2500n])
      expect(await f.finance.repository.listPendingPaymentReconciliations(cycle.id)).toEqual([])
      expect(
        (await f.service.generateDashboard(f.period))!.members.find(
          (m) => m.memberId === f.ids.ion
        )!.purchaseOffset.amountMinor
      ).toBe(500n)
    } finally {
      await f.cleanup()
    }
  }
)

integration(
  'generic confirmations link derived provider coverage so deleting the receipt reopens both ledgers',
  async () => {
    const f = await fixture()
    try {
      await f.service.addUtilityBill('Electricity', '80', f.ids.stas, 'GEL', f.period)
      const cycle = (await f.finance.repository.getCycleByPeriod(f.period))!
      const result = await f.confirmations.submit({
        memberId: f.ids.ion,
        period: f.period,
        senderTelegramUserId: `audit-ion-${f.householdId}`,
        rawText: 'paid utilities 30 GEL',
        telegramChatId: '-100audit',
        telegramMessageId: 'generic',
        telegramThreadId: '1',
        telegramUpdateId: 'generic',
        attachmentCount: 0,
        messageSentAt: nowInstant()
      })
      expect(result.status).toBe('recorded')
      await f.service.resolveUtilityBillAsPlanned({
        memberId: f.ids.ion,
        periodArg: f.period,
        actorMemberId: f.ids.ion
      })
      const records = await f.finance.repository.listPaymentRecordsForCycle(cycle.id)
      expect(records).toHaveLength(1)
      const facts = await f.finance.repository.listUtilityVendorPaymentFactsForCycle(cycle.id)
      expect(facts.length).toBeGreaterThan(0)
      expect(facts.every((fact) => fact.paymentRecordId === records[0]!.id)).toBe(true)
      await expect(
        f.service.updatePayment(records[0]!.id, f.ids.ion, 'utilities', '10', 'GEL', f.ids.ion)
      ).rejects.toThrow('provider distribution')
      expect(
        (await f.finance.repository.listPaymentRecordsForCycle(cycle.id))[0]!.amountMinor
      ).toBe(3000n)
      await expect(f.service.deleteUtilityVendorPaymentFact(facts[0]!.id)).rejects.toThrow(
        'entire receipt'
      )
      await f.service.deletePayment(records[0]!.id)
      expect(await f.finance.repository.listUtilityVendorPaymentFactsForCycle(cycle.id)).toEqual([])
      expect(
        (await f.service.generateDashboard(f.period))!
          .utilityBillingPlan!.categories.filter((c) => c.assignedMemberId === f.ids.ion)
          .reduce((n, c) => n + c.remainingAmount.amountMinor, 0n)
      ).toBe(2000n)
    } finally {
      await f.cleanup()
    }
  }
)
integration(
  'a lost plan race retries all dashboard inputs, including bill shares and ledger totals',
  async () => {
    const f = await fixture()
    try {
      await f.service.addUtilityBill('Electricity', '80', f.ids.stas, 'GEL', f.period)
      await f.service.generateDashboard(f.period)
      await f.service.addUtilityBill('Gas', '20', f.ids.stas, 'GEL', f.period)
      let winner: FinanceDashboard | null = null
      let injected = false
      const repo = new Proxy(f.finance.repository, {
        get(target, prop) {
          if (prop === 'replaceCurrentUtilityBillingPlan')
            return async (
              input: Parameters<FinanceRepository['replaceCurrentUtilityBillingPlan']>[0]
            ) => {
              if (!injected) {
                injected = true
                await f.service.addUtilityBill('Internet', '40', f.ids.stas, 'GEL', f.period)
                winner = await f.service.generateDashboard(f.period)
              }
              return target.replaceCurrentUtilityBillingPlan(input)
            }
          const value = Reflect.get(target, prop)
          return typeof value === 'function' ? value.bind(target) : value
        }
      })
      const raced = createFinanceCommandService({
        householdId: f.householdId,
        repository: repo,
        householdConfigurationRepository: f.config.repository,
        exchangeRateProvider: {
          getRate: async (input) => ({ ...input, rateMicros: 1000000n, source: 'nbg' })
        }
      })
      const returned = (await raced.generateDashboard(f.period))!
      expect(injected).toBe(true)
      expect(returned.utilityBillingPlan).toEqual(winner!.utilityBillingPlan)
      expect(returned.members.map((m) => m.utilityShare.amountMinor)).toEqual([
        3500n,
        3500n,
        3500n,
        3500n
      ])
      expect(
        returned.ledger
          .filter((e) => e.kind === 'utility')
          .reduce((n, e) => n + e.displayAmount.amountMinor, 0n)
      ).toBe(14000n)
      expect(returned.totalDue.amountMinor).toBe(14000n)
    } finally {
      await f.cleanup()
    }
  }
)
integration(
  'closed periods reject receipt edits, receipt deletions, and provider fact deletions without changing money',
  async () => {
    const f = await fixture()
    try {
      await f.service.addUtilityBill('Electricity', '40', f.ids.stas, 'GEL', f.period)
      await f.service.closePaymentPeriod({
        kind: 'utilities',
        periodArg: f.period,
        memberIds: [f.ids.ion],
        actorMemberId: f.ids.ion
      })
      const cycle = (await f.finance.repository.getCycleByPeriod(f.period))!
      const record = (await f.finance.repository.listPaymentRecordsForCycle(cycle.id))[0]!
      const fact = (await f.finance.repository.listUtilityVendorPaymentFactsForCycle(cycle.id))[0]!
      await f.finance.repository.closeCycle(cycle.id, nowInstant())
      await expect(
        f.finance.repository.updatePaymentRecord({
          paymentId: record.id,
          memberId: f.ids.ion,
          kind: 'utilities',
          amountMinor: 600n,
          currency: 'GEL',
          actorMemberId: f.ids.ion
        })
      ).rejects.toThrow('Closed')
      await expect(f.finance.repository.deletePaymentRecord(record.id)).rejects.toThrow('Closed')
      await expect(f.finance.repository.deleteUtilityVendorPaymentFact(fact.id)).rejects.toThrow(
        'Closed'
      )
      expect(
        (await f.finance.repository.listPaymentRecordsForCycle(cycle.id))[0]!.amountMinor
      ).toBe(record.amountMinor)
      expect(
        (await f.finance.repository.listUtilityVendorPaymentFactsForCycle(cycle.id))[0]!.amountMinor
      ).toBe(fact.amountMinor)
    } finally {
      await f.cleanup()
    }
  }
)

integration(
  'planned supplier coverage uses fixed FX when an existing receipt was paid in another currency',
  async () => {
    const f = await fixture(2700000n)
    try {
      await f.service.addUtilityBill('Electricity', '80', f.ids.stas, 'USD', f.period)
      await f.service.addPayment(f.ids.ion, 'utilities', '20', 'USD', f.period)
      await f.service.resolveUtilityBillAsPlanned({
        memberId: f.ids.ion,
        actorMemberId: f.ids.ion,
        periodArg: f.period
      })
      const cycle = (await f.finance.repository.getCycleByPeriod(f.period))!
      const records = await f.finance.repository.listPaymentRecordsForCycle(cycle.id)
      expect(records.map((r) => [r.amountMinor, r.currency])).toEqual([[2000n, 'USD']])
      expect(
        (await f.finance.repository.listUtilityVendorPaymentFactsForCycle(cycle.id)).reduce(
          (n, fact) => n + fact.amountMinor,
          0n
        )
      ).toBe(5400n)
    } finally {
      await f.cleanup()
    }
  }
)

function auditMessage(
  f: Awaited<ReturnType<typeof fixture>>,
  memberId: string,
  billId: string,
  amount: string,
  key: string
) {
  return {
    memberId,
    utilityBillId: billId,
    period: f.period,
    senderTelegramUserId: `audit-${memberId === f.ids.ion ? 'ion' : 'stas'}-${f.householdId}`,
    rawText: `paid electricity ${amount} GEL`,
    telegramChatId: '-100audit',
    telegramMessageId: key,
    telegramThreadId: '1',
    telegramUpdateId: key,
    attachmentCount: 0,
    messageSentAt: nowInstant()
  }
}

integration(
  'a historical confirmation retry preserves closed purchase funding and archived totals',
  async () => {
    const f = await fixture()
    try {
      await f.service.addPurchase('Groceries', '40', f.ids.stas, 'GEL')
      await f.service.addUtilityBill('Electricity', '80', f.ids.stas, 'GEL', f.period)
      const cycle = (await f.finance.repository.getCycleByPeriod(f.period))!
      const bill = (await f.finance.repository.listUtilityBillsForCycle(cycle.id))[0]!
      const message = auditMessage(f, f.ids.ion, bill.id, '25', 'historical-retry')
      expect((await f.confirmations.submit(message)).status).toBe('recorded')
      const allocations = await f.finance.repository.listPaymentPurchaseAllocations()
      expect(allocations.reduce((n, a) => n + a.amountMinor, 0n)).toBe(500n)
      await f.service.closeCycle(f.period)
      const archive = await f.service.listCycleHistory()
      expect((await f.confirmations.submit(message)).status).toBe('duplicate')
      expect(await f.finance.repository.listPaymentPurchaseAllocations()).toEqual(allocations)
      expect(await f.service.listCycleHistory()).toEqual(archive)
    } finally {
      await f.cleanup()
    }
  }
)

integration(
  'manual purchase resolutions survive later real receipts from their purchase payer',
  async () => {
    const f = await fixture()
    try {
      const purchase = (await f.service.addPurchase('Groceries', '40', f.ids.stas, 'GEL'))!
      await f.service.manuallyResolvePurchase({
        purchaseId: purchase.purchaseId,
        allocations: [{ memberId: f.ids.ion, amountMajor: '10' }]
      })
      const manual = (await f.finance.repository.listPaymentPurchaseAllocations()).filter(
        (a) => a.resolutionMethod === 'manual'
      )
      expect(manual).toHaveLength(1)
      await f.service.addUtilityBill('Electricity', '80', f.ids.stas, 'GEL', f.period)
      const cycle = (await f.finance.repository.getCycleByPeriod(f.period))!
      const bill = (await f.finance.repository.listUtilityBillsForCycle(cycle.id))[0]!
      expect(
        (
          await f.confirmations.submit(
            auditMessage(f, f.ids.stas, bill.id, '25', 'manual-preserved')
          )
        ).status
      ).toBe('recorded')
      expect(
        (await f.finance.repository.listPaymentPurchaseAllocations()).filter(
          (a) => a.resolutionMethod === 'manual'
        )
      ).toEqual(manual)
      expect(
        (await f.service.generateDashboard(f.period))!.ledger
          .find((e) => e.id === purchase.purchaseId)!
          .outstandingByMember?.find((m) => m.memberId === f.ids.ion)
      ).toBeUndefined()
    } finally {
      await f.cleanup()
    }
  }
)

integration(
  'purchase corrections redistribute funded capacity within actual current shares',
  async () => {
    const f = await fixture()
    try {
      const first = (await f.service.addPurchase(
        'First',
        '40',
        f.ids.stas,
        'GEL',
        undefined,
        `${f.period}-01`
      ))!
      const second = (await f.service.addPurchase(
        'Second',
        '40',
        f.ids.stas,
        'GEL',
        undefined,
        `${f.period}-02`
      ))!
      await f.service.addUtilityBill('Electricity', '80', f.ids.stas, 'GEL', f.period)
      const cycle = (await f.finance.repository.getCycleByPeriod(f.period))!
      const bill = (await f.finance.repository.listUtilityBillsForCycle(cycle.id))[0]!
      await f.confirmations.submit(auditMessage(f, f.ids.ion, bill.id, '35', 'purchase-correction'))
      const before = (await f.finance.repository.listPaymentPurchaseAllocations()).filter(
        (a) => a.memberId === f.ids.ion
      )
      expect(before.find((a) => a.purchaseId === first.purchaseId)!.amountMinor).toBe(1000n)
      expect(before.find((a) => a.purchaseId === second.purchaseId)!.amountMinor).toBe(500n)
      await f.service.updatePurchase(first.purchaseId, 'First corrected', '20', 'GEL')
      const allocations = (await f.finance.repository.listPaymentPurchaseAllocations()).filter(
        (a) => a.memberId === f.ids.ion
      )
      expect(allocations.find((a) => a.purchaseId === first.purchaseId)!.amountMinor).toBe(500n)
      expect(allocations.find((a) => a.purchaseId === second.purchaseId)!.amountMinor).toBe(1000n)
      expect(
        (await f.service.generateDashboard(f.period))!.members.reduce(
          (n, m) => n + m.purchaseOffset.amountMinor,
          0n
        )
      ).toBe(0n)
    } finally {
      await f.cleanup()
    }
  }
)

integration(
  'bill changes between pricing and save roll back and recapture without duplicate cash',
  async () => {
    const f = await fixture()
    try {
      await f.service.addPurchase('Groceries', '40', f.ids.stas, 'GEL')
      await f.service.addUtilityBill('Electricity', '80', f.ids.stas, 'GEL', f.period)
      const cycle = (await f.finance.repository.getCycleByPeriod(f.period))!
      const bill = (await f.finance.repository.listUtilityBillsForCycle(cycle.id))[0]!
      let injected = false
      const repo = new Proxy(f.finance.repository, {
        get(target, prop) {
          if (prop === 'savePaymentConfirmation')
            return async (input: Parameters<FinanceRepository['savePaymentConfirmation']>[0]) => {
              if (!injected) {
                injected = true
                await f.service.addUtilityBill('Internet', '80', f.ids.stas, 'GEL', f.period)
              }
              return target.savePaymentConfirmation(input)
            }
          const value = Reflect.get(target, prop)
          return typeof value === 'function' ? value.bind(target) : value
        }
      })
      const confirmations = createPaymentConfirmationService({
        householdId: f.householdId,
        repository: repo,
        householdConfigurationRepository: f.config.repository,
        financeService: f.service,
        exchangeRateProvider: {
          getRate: async (input) => ({ ...input, rateMicros: 1000000n, source: 'nbg' })
        }
      })
      expect(
        (await confirmations.submit(auditMessage(f, f.ids.ion, bill.id, '25', 'pricing-race')))
          .status
      ).toBe('recorded')
      const records = await f.finance.repository.listPaymentRecordsForCycle(cycle.id)
      expect(records).toHaveLength(1)
      expect(records[0]!.purchaseFundingContext!.baseMinor).toBe('4000')
      expect(await f.finance.repository.listPaymentPurchaseAllocations()).toEqual([])
    } finally {
      await f.cleanup()
    }
  }
)

integration(
  'period closure recovers pending balances and refuses to freeze a persistent failure',
  async () => {
    const f = await fixture()
    try {
      await f.service.addPurchase('Groceries', '40', f.ids.stas, 'GEL')
      await f.service.addUtilityBill('Electricity', '80', f.ids.stas, 'GEL', f.period)
      const cycle = (await f.finance.repository.getCycleByPeriod(f.period))!
      const bill = (await f.finance.repository.listUtilityBillsForCycle(cycle.id))[0]!
      let fail = true
      const repo = new Proxy(f.finance.repository, {
        get(target, prop) {
          if (prop === 'replacePaymentPurchaseAllocations')
            return async (
              input: Parameters<FinanceRepository['replacePaymentPurchaseAllocations']>[0]
            ) => {
              if (fail) throw new Error('temporary failure')
              return target.replacePaymentPurchaseAllocations(input)
            }
          const value = Reflect.get(target, prop)
          return typeof value === 'function' ? value.bind(target) : value
        }
      })
      const service = createFinanceCommandService({
        householdId: f.householdId,
        repository: repo,
        householdConfigurationRepository: f.config.repository,
        exchangeRateProvider: {
          getRate: async (input) => ({ ...input, rateMicros: 1000000n, source: 'nbg' })
        }
      })
      const confirmations = createPaymentConfirmationService({
        householdId: f.householdId,
        repository: repo,
        householdConfigurationRepository: f.config.repository,
        financeService: service,
        exchangeRateProvider: {
          getRate: async (input) => ({ ...input, rateMicros: 1000000n, source: 'nbg' })
        }
      })
      expect(
        await confirmations.submit(auditMessage(f, f.ids.ion, bill.id, '25', 'closure-pending'))
      ).toMatchObject({ status: 'recorded', balanceUpdatePending: true })
      expect((await service.generateDashboard(f.period))!.balanceUpdatePending).toBe(true)
      await expect(service.closeCycle(f.period)).rejects.toThrow('temporary failure')
      expect((await f.finance.repository.getCycleByPeriod(f.period))!.closedAt).toBeNull()
      await expect(
        f.finance.repository.closeCyclesBeforePeriod('2999-01', nowInstant())
      ).rejects.toThrow('Pending balance')
      fail = false
      await service.closeCycle(f.period)
      expect(
        (await f.finance.repository.listPaymentPurchaseAllocations()).reduce(
          (n, a) => n + a.amountMinor,
          0n
        )
      ).toBe(500n)
      expect((await f.finance.repository.getCycleByPeriod(f.period))!.closedAt).not.toBeNull()
    } finally {
      await f.cleanup()
    }
  }
)

integration(
  'prepared future rent receipts fund purchases and use fixed FX across dashboard, instructions and history',
  async () => {
    const f = await fixture(2700000n)
    try {
      const purchase = (await f.service.addPurchase('Groceries', '40', f.ids.stas, 'GEL'))!
      await f.client.db
        .update(schema.householdBillingSettings)
        .set({ paymentBalanceAdjustmentPolicy: 'rent' })
        .where(eq(schema.householdBillingSettings.householdId, f.householdId))
      const date = nowInstant().toZonedDateTimeISO('Asia/Tbilisi').add({ months: 1 })
      const future = `${date.year}-${String(date.month).padStart(2, '0')}`
      await f.finance.repository.openCycle(future, 'GEL')
      await f.finance.repository.saveRentRule(future, 10000n, 'USD')
      await f.service.addPayment(f.ids.ion, 'rent', '35', 'USD', future)
      const allocations = await f.finance.repository.listPaymentPurchaseAllocations()
      expect(
        allocations.find((a) => a.purchaseId === purchase.purchaseId && a.memberId === f.ids.ion)!
          .amountMinor
      ).toBe(1000n)
      const dashboard = (await f.service.generateDashboard(future))!
      expect(dashboard.members.find((m) => m.memberId === f.ids.ion)!.paid.amountMinor).toBe(9450n)
      expect(
        dashboard.rentBillingState.memberSummaries.find((m) => m.memberId === f.ids.ion)!.paid
          .amountMinor
      ).toBe(9450n)
      expect(dashboard.ledger.find((e) => e.kind === 'payment')!.displayAmount.amountMinor).toBe(
        9450n
      )
      await f.service.closeCycle(future)
      expect(
        (await f.service.listCycleHistory()).find((h) => h.period === future)!.totalPaid.amountMinor
      ).toBe(9450n)
    } finally {
      await f.cleanup()
    }
  }
)

integration(
  'a concurrent purchase correction cannot be overwritten by stale allocation replacement',
  async () => {
    const f = await fixture()
    try {
      const first = (await f.service.addPurchase(
        'First',
        '40',
        f.ids.stas,
        'GEL',
        undefined,
        `${f.period}-01`
      ))!
      const second = (await f.service.addPurchase(
        'Second',
        '40',
        f.ids.stas,
        'GEL',
        undefined,
        `${f.period}-02`
      ))!
      await f.service.addUtilityBill('Electricity', '80', f.ids.stas, 'GEL', f.period)
      const cycle = (await f.finance.repository.getCycleByPeriod(f.period))!
      const bill = (await f.finance.repository.listUtilityBillsForCycle(cycle.id))[0]!
      await f.confirmations.submit(auditMessage(f, f.ids.ion, bill.id, '35', 'allocation-race'))
      const record = (await f.finance.repository.listPaymentRecordsForCycle(cycle.id))[0]!
      let injected = false
      const repo = new Proxy(f.finance.repository, {
        get(target, prop) {
          if (prop === 'replacePaymentPurchaseAllocations')
            return async (
              input: Parameters<FinanceRepository['replacePaymentPurchaseAllocations']>[0]
            ) => {
              if (!injected) {
                injected = true
                await f.service.updatePurchase(first.purchaseId, 'First corrected', '20', 'GEL')
              }
              return target.replacePaymentPurchaseAllocations(input)
            }
          const value = Reflect.get(target, prop)
          return typeof value === 'function' ? value.bind(target) : value
        }
      })
      const service = createFinanceCommandService({
        householdId: f.householdId,
        repository: repo,
        householdConfigurationRepository: f.config.repository,
        exchangeRateProvider: {
          getRate: async (input) => ({ ...input, rateMicros: 1000000n, source: 'nbg' })
        }
      })
      await service.reconcilePaymentPurchaseAllocations(record.id)
      const allocations = (await f.finance.repository.listPaymentPurchaseAllocations()).filter(
        (a) => a.memberId === f.ids.ion
      )
      expect(injected).toBe(true)
      expect(allocations.find((a) => a.purchaseId === first.purchaseId)!.amountMinor).toBe(500n)
      expect(allocations.find((a) => a.purchaseId === second.purchaseId)!.amountMinor).toBe(1000n)
      expect(
        (await service.generateDashboard(f.period))!.members.find((m) => m.memberId === f.ids.ion)!
          .purchaseOffset.amountMinor
      ).toBe(0n)
    } finally {
      await f.cleanup()
    }
  }
)

integration(
  'manual resolution rejects excess and closed-period mutations without partial writes',
  async () => {
    const f = await fixture()
    try {
      const purchase = (await f.service.addPurchase('Groceries', '40', f.ids.stas, 'GEL'))!
      const cycle = (await f.finance.repository.getCycleByPeriod(f.period))!
      await expect(
        f.service.manuallyResolvePurchase({
          purchaseId: purchase.purchaseId,
          allocations: [{ memberId: f.ids.ion, amountMajor: '11' }]
        })
      ).rejects.toThrow('exceeds')
      expect(await f.finance.repository.listPaymentPurchaseAllocations()).toEqual([])
      await f.service.closeCycle(f.period)
      await expect(
        f.finance.repository.createManualPurchaseAllocations({
          cycleId: cycle.id,
          purchaseId: purchase.purchaseId,
          allocations: [{ memberId: f.ids.ion, amountMinor: 1000n }],
          recordedAt: nowInstant()
        })
      ).rejects.toThrow('Closed')
      expect(await f.finance.repository.listPaymentRecordsForCycle(cycle.id)).toEqual([])
    } finally {
      await f.cleanup()
    }
  }
)

integration(
  'a manual allocation committed at fingerprint capture replaces stale cached purchase capacity',
  async () => {
    const f = await fixture()
    try {
      const purchase = (await f.service.addPurchase('Groceries', '40', f.ids.stas, 'GEL'))!
      await f.service.addUtilityBill('Electricity', '80', f.ids.stas, 'GEL', f.period)
      const cycle = (await f.finance.repository.getCycleByPeriod(f.period))!
      const bill = (await f.finance.repository.listUtilityBillsForCycle(cycle.id))[0]!
      const confirmations = createPaymentConfirmationService({
        householdId: f.householdId,
        repository: f.finance.repository,
        householdConfigurationRepository: f.config.repository,
        financeService: {
          ...f.service,
          reconcilePaymentPurchaseAllocations: async () => {
            throw new Error('temporary failure')
          }
        },
        exchangeRateProvider: {
          getRate: async (input) => ({ ...input, rateMicros: 1000000n, source: 'nbg' })
        }
      })
      expect(
        await confirmations.submit(
          auditMessage(f, f.ids.ion, bill.id, '25', 'cached-capacity-race')
        )
      ).toMatchObject({ status: 'recorded', balanceUpdatePending: true })
      const record = (await f.finance.repository.listPaymentRecordsForCycle(cycle.id))[0]!
      let injected = false
      const repo = new Proxy(f.finance.repository, {
        get(target, prop) {
          if (prop === 'getPaymentPricingRevision')
            return async (cycleId: string) => {
              if (!injected) {
                injected = true
                await target.createManualPurchaseAllocations({
                  cycleId,
                  purchaseId: purchase.purchaseId,
                  allocations: [{ memberId: f.ids.ion, amountMinor: 1000n }],
                  recordedAt: nowInstant()
                })
              }
              return target.getPaymentPricingRevision(cycleId)
            }
          const value = Reflect.get(target, prop)
          return typeof value === 'function' ? value.bind(target) : value
        }
      })
      const service = createFinanceCommandService({
        householdId: f.householdId,
        repository: repo,
        householdConfigurationRepository: f.config.repository,
        exchangeRateProvider: {
          getRate: async (input) => ({ ...input, rateMicros: 1000000n, source: 'nbg' })
        }
      })
      await service.reconcilePaymentPurchaseAllocations(record.id)
      const allocations = (await f.finance.repository.listPaymentPurchaseAllocations()).filter(
        (a) => a.memberId === f.ids.ion
      )
      expect(injected).toBe(true)
      expect(allocations.map((a) => [a.resolutionMethod, a.amountMinor])).toEqual([
        ['manual', 1000n]
      ])
      expect(await f.finance.repository.listPendingPaymentReconciliations(cycle.id)).toEqual([])
    } finally {
      await f.cleanup()
    }
  }
)

integration(
  'legacy receipts without pricing are preserved before purchase deletion and remaining debt is repaired',
  async () => {
    const f = await fixture()
    try {
      const first = (await f.service.addPurchase(
        'First',
        '40',
        f.ids.stas,
        'GEL',
        undefined,
        `${f.period}-01`
      ))!
      const second = (await f.service.addPurchase(
        'Second',
        '40',
        f.ids.stas,
        'GEL',
        undefined,
        `${f.period}-02`
      ))!
      await f.service.addUtilityBill('Electricity', '80', f.ids.stas, 'GEL', f.period)
      const cycle = (await f.finance.repository.getCycleByPeriod(f.period))!
      const bill = (await f.finance.repository.listUtilityBillsForCycle(cycle.id))[0]!
      await f.confirmations.submit(
        auditMessage(f, f.ids.ion, bill.id, '35', 'legacy-purchase-delete')
      )
      const record = (await f.finance.repository.listPaymentRecordsForCycle(cycle.id))[0]!
      await f.client.db
        .update(schema.paymentRecords)
        .set({ purchaseFundingContext: null, purchaseReconciliationPending: 0 })
        .where(eq(schema.paymentRecords.id, record.id))
      expect(await f.service.deletePurchase(first.purchaseId)).toBe(true)
      expect(await f.finance.repository.listPendingPaymentReconciliations(cycle.id)).toHaveLength(1)
      await f.service.generateDashboard(f.period)
      const allocations = (await f.finance.repository.listPaymentPurchaseAllocations()).filter(
        (a) => a.memberId === f.ids.ion
      )
      expect(allocations).toHaveLength(1)
      expect(allocations[0]!.purchaseId).toBe(second.purchaseId)
      expect(allocations[0]!.amountMinor).toBe(1000n)
      expect(
        (await f.finance.repository.getPaymentRecord(record.id))!.purchaseFundingContext
      ).toBeDefined()
    } finally {
      await f.cleanup()
    }
  }
)

integration(
  'refreshing an explicit prepared period recovers its pending receipts and later purchase corrections',
  async () => {
    const f = await fixture()
    try {
      const purchase = (await f.service.addPurchase('Groceries', '40', f.ids.stas, 'GEL'))!
      await f.client.db
        .update(schema.householdBillingSettings)
        .set({ paymentBalanceAdjustmentPolicy: 'rent' })
        .where(eq(schema.householdBillingSettings.householdId, f.householdId))
      const date = nowInstant().toZonedDateTimeISO('Asia/Tbilisi').add({ months: 1 })
      const future = `${date.year}-${String(date.month).padStart(2, '0')}`
      await f.finance.repository.openCycle(future, 'GEL')
      await f.finance.repository.saveRentRule(future, 10000n, 'GEL')
      const cycle = (await f.finance.repository.getCycleByPeriod(future))!
      let fail = true
      const repo = new Proxy(f.finance.repository, {
        get(target, prop) {
          if (prop === 'replacePaymentPurchaseAllocations')
            return async (
              input: Parameters<FinanceRepository['replacePaymentPurchaseAllocations']>[0]
            ) => {
              if (fail) throw new Error('temporary failure')
              return target.replacePaymentPurchaseAllocations(input)
            }
          const value = Reflect.get(target, prop)
          return typeof value === 'function' ? value.bind(target) : value
        }
      })
      const service = createFinanceCommandService({
        householdId: f.householdId,
        repository: repo,
        householdConfigurationRepository: f.config.repository,
        exchangeRateProvider: {
          getRate: async (input) => ({ ...input, rateMicros: 1000000n, source: 'nbg' })
        }
      })
      await service.addPayment(f.ids.ion, 'rent', '35', 'GEL', future)
      expect(await f.finance.repository.listPendingPaymentReconciliations(cycle.id)).toHaveLength(1)
      fail = false
      expect((await service.generateDashboard(future))!.balanceUpdatePending).not.toBe(true)
      expect((await f.finance.repository.listPaymentPurchaseAllocations())[0]!.amountMinor).toBe(
        1000n
      )
      await f.service.updatePurchase(purchase.purchaseId, 'Groceries corrected', '20', 'GEL')
      expect(await f.finance.repository.listPendingPaymentReconciliations(cycle.id)).toHaveLength(1)
      expect((await service.ensureDashboardMaterialized(future))!.balanceUpdatePending).not.toBe(
        true
      )
      expect((await f.finance.repository.listPaymentPurchaseAllocations())[0]!.amountMinor).toBe(
        500n
      )
      expect(await f.finance.repository.listPendingPaymentReconciliations(cycle.id)).toEqual([])
    } finally {
      await f.cleanup()
    }
  }
)

integration(
  'successive named installments use the issued remainder once and keep a valid top-up on the same plan',
  async () => {
    const f = await fixture()
    try {
      await f.service.addUtilityBill('Electricity', '40', f.ids.stas, 'GEL', f.period)
      const cycle = (await f.finance.repository.getCycleByPeriod(f.period))!
      const bill = (await f.finance.repository.listUtilityBillsForCycle(cycle.id))[0]!
      const before = (await f.service.generateDashboard(f.period))!.utilityBillingPlan!
      const issued = before.categories.find((c) => c.assignedMemberId === f.ids.ion)!
      expect(issued.remainingAmount.amountMinor).toBe(1000n)
      await f.confirmations.submit(auditMessage(f, f.ids.ion, bill.id, '4', 'installment-first'))
      const afterFirst = (await f.service.generateDashboard(f.period))!.utilityBillingPlan!
      expect(
        afterFirst.categories.find((c) => c.assignedMemberId === f.ids.ion)!.remainingAmount
          .amountMinor
      ).toBe(600n)
      const stored = (await f.finance.repository.listUtilityBillingPlansForCycle(cycle.id)).find(
        (p) => p.id === before.id
      )!
      expect(
        stored.payload.categories.find((c) => c.assignedMemberId === f.ids.ion)!
          .remainingAmountMinor
      ).toBe('1000')
      await f.confirmations.submit(auditMessage(f, f.ids.ion, bill.id, '6', 'installment-final'))
      const facts = await f.finance.repository.listUtilityVendorPaymentFactsForCycle(cycle.id)
      expect(
        facts
          .filter((p) => p.payerMemberId === f.ids.ion)
          .every((p) => p.matchedPlan && p.planId === before.id)
      ).toBe(true)
      const after = (await f.service.generateDashboard(f.period))!.utilityBillingPlan!
      expect(after.id).toBe(before.id)
      expect(after.version).toBe(before.version)
      expect(
        after.categories.find((c) => c.assignedMemberId === f.ids.ion)!.remainingAmount.amountMinor
      ).toBe(0n)
    } finally {
      await f.cleanup()
    }
  }
)
