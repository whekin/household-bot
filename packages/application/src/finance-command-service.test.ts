import { describe, expect, test } from 'bun:test'

import { instantFromIso, Money, type Instant } from '@household/domain'
import type {
  ExchangeRateProvider,
  FinanceCycleExchangeRateRecord,
  FinanceCycleRecord,
  FinanceMemberRecord,
  FinanceParsedPurchaseRecord,
  FinanceRentRuleRecord,
  FinanceRepository,
  HouseholdBillingSettingsRecord,
  HouseholdConfigurationRepository,
  SettlementSnapshotRecord
} from '@household/ports'

import { createFinanceCommandService } from './finance-command-service'

function expectedCurrentCyclePeriod(timezone: string, rentDueDay: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date())
  const year = Number(parts.find((part) => part.type === 'year')?.value ?? '0')
  const month = Number(parts.find((part) => part.type === 'month')?.value ?? '1')
  const day = Number(parts.find((part) => part.type === 'day')?.value ?? '1')
  const carryMonth = day > rentDueDay ? month + 1 : month
  const normalizedYear = carryMonth > 12 ? year + 1 : year
  const normalizedMonth = carryMonth > 12 ? 1 : carryMonth

  return `${normalizedYear}-${String(normalizedMonth).padStart(2, '0')}`
}

class FinanceRepositoryStub implements FinanceRepository {
  householdId = 'household-1'
  member: FinanceMemberRecord | null = null
  members: readonly FinanceMemberRecord[] = []
  memberStatuses = new Map<string, 'active' | 'away' | 'left'>()
  memberAbsencePolicies: readonly {
    memberId: string
    effectiveFromPeriod: string
    policy: 'resident' | 'away_rent_and_utilities' | 'away_rent_only' | 'inactive'
  }[] = []
  openCycleRecord: FinanceCycleRecord | null = null
  cycleByPeriodRecord: FinanceCycleRecord | null = null
  latestCycleRecord: FinanceCycleRecord | null = null
  cycles: readonly FinanceCycleRecord[] = []
  rentRule: FinanceRentRuleRecord | null = null
  purchases: readonly FinanceParsedPurchaseRecord[] = []
  utilityBills: readonly {
    id: string
    cycleId?: string
    billName: string
    amountMinor: bigint
    currency: 'USD' | 'GEL'
    createdByMemberId: string | null
    createdAt: Instant
  }[] = []
  utilityBillingPlans: Array<Parameters<FinanceRepository['saveUtilityBillingPlan']>[0]> = []
  billingSettingsOverride: Partial<
    Awaited<ReturnType<HouseholdConfigurationRepository['getHouseholdBillingSettings']>>
  > | null = null
  utilityVendorPaymentFacts: Array<
    Awaited<ReturnType<FinanceRepository['listUtilityVendorPaymentFactsForCycle']>>[number]
  > = []
  utilityReimbursementFacts: Array<
    Awaited<ReturnType<FinanceRepository['listUtilityReimbursementFactsForCycle']>>[number]
  > = []
  paymentRecords: readonly {
    id: string
    cycleId: string
    cyclePeriod?: string | null
    memberId: string
    kind: 'rent' | 'utilities'
    amountMinor: bigint
    currency: 'USD' | 'GEL'
    recordedAt: Instant
  }[] = []
  lastSavedRentRule: {
    period: string
    amountMinor: bigint
    currency: 'USD' | 'GEL'
  } | null = null
  lastUtilityBill: {
    cycleId: string
    billName: string
    amountMinor: bigint
    currency: 'USD' | 'GEL'
    createdByMemberId: string
  } | null = null
  replacedSnapshot: SettlementSnapshotRecord | null = null
  cycleExchangeRates = new Map<string, FinanceCycleExchangeRateRecord>()
  lastUpdatedPurchaseInput: Parameters<FinanceRepository['updateParsedPurchase']>[0] | null = null
  lastAddedPurchaseInput: Parameters<FinanceRepository['addParsedPurchase']>[0] | null = null
  lastReplacedPaymentPurchaseAllocations:
    | Parameters<FinanceRepository['replacePaymentPurchaseAllocations']>[0]
    | null = null
  addedPaymentRecords: Parameters<FinanceRepository['addPaymentRecord']>[0][] = []

  async getMemberByTelegramUserId(): Promise<FinanceMemberRecord | null> {
    return this.member
  }

  async listMembers(): Promise<readonly FinanceMemberRecord[]> {
    return this.members
  }

  async listCycles(): Promise<readonly FinanceCycleRecord[]> {
    if (this.cycles.length > 0) {
      return this.cycles
    }

    return [this.openCycleRecord ?? this.cycleByPeriodRecord ?? this.latestCycleRecord].filter(
      (cycle): cycle is FinanceCycleRecord => Boolean(cycle)
    )
  }

  async getOpenCycle(): Promise<FinanceCycleRecord | null> {
    return this.openCycleRecord
  }

  async getCycleByPeriod(period: string): Promise<FinanceCycleRecord | null> {
    return (
      this.cycles.find((cycle) => cycle.period === period) ??
      (this.cycleByPeriodRecord?.period === period ? this.cycleByPeriodRecord : null) ??
      (this.openCycleRecord?.period === period ? this.openCycleRecord : null) ??
      (this.latestCycleRecord?.period === period ? this.latestCycleRecord : null)
    )
  }

  async getLatestCycle(): Promise<FinanceCycleRecord | null> {
    return this.latestCycleRecord
  }

  async openCycle(period: string, currency: 'USD' | 'GEL'): Promise<void> {
    const cycle = {
      id: 'opened-cycle',
      period,
      currency
    }
    this.openCycleRecord = cycle
    this.cycleByPeriodRecord = cycle
    this.latestCycleRecord = cycle
  }

  async closeCycle(): Promise<void> {}

  async saveRentRule(period: string, amountMinor: bigint, currency: 'USD' | 'GEL'): Promise<void> {
    this.lastSavedRentRule = {
      period,
      amountMinor,
      currency
    }
  }

  async getCycleExchangeRate(
    cycleId: string,
    sourceCurrency: 'USD' | 'GEL',
    targetCurrency: 'USD' | 'GEL'
  ): Promise<FinanceCycleExchangeRateRecord | null> {
    return this.cycleExchangeRates.get(`${cycleId}:${sourceCurrency}:${targetCurrency}`) ?? null
  }

  async saveCycleExchangeRate(
    input: FinanceCycleExchangeRateRecord
  ): Promise<FinanceCycleExchangeRateRecord> {
    this.cycleExchangeRates.set(
      `${input.cycleId}:${input.sourceCurrency}:${input.targetCurrency}`,
      input
    )
    return input
  }

  async addUtilityBill(input: {
    cycleId: string
    billName: string
    amountMinor: bigint
    currency: 'USD' | 'GEL'
    createdByMemberId: string
  }): Promise<void> {
    this.lastUtilityBill = input
  }

  async addParsedPurchase(input: Parameters<FinanceRepository['addParsedPurchase']>[0]) {
    this.lastAddedPurchaseInput = input
    return {
      id: 'purchase-1',
      cycleId: input.cycleId,
      cyclePeriod: null,
      payerMemberId: input.payerMemberId,
      amountMinor: input.amountMinor,
      currency: input.currency,
      description: input.description,
      occurredAt: input.occurredAt,
      splitMode: input.splitMode ?? 'equal',
      participants: (input.participants ?? []).map((p) => ({
        memberId: p.memberId,
        included: p.included ?? true,
        shareAmountMinor: p.shareAmountMinor
      }))
    }
  }

  async updateUtilityBill() {
    return null
  }

  async deleteUtilityBill() {
    return false
  }

  async updateParsedPurchase(input: Parameters<FinanceRepository['updateParsedPurchase']>[0]) {
    this.lastUpdatedPurchaseInput = input
    return {
      id: input.purchaseId,
      cycleId: null,
      cyclePeriod: null,
      payerMemberId: 'alice',
      amountMinor: input.amountMinor,
      currency: input.currency,
      description: input.description,
      occurredAt: instantFromIso('2026-03-12T11:00:00.000Z'),
      splitMode: input.splitMode ?? 'equal',
      ...(input.participants
        ? {
            participants: input.participants.map((participant, index) => ({
              id: `participant-${index + 1}`,
              memberId: participant.memberId,
              included: participant.included !== false,
              shareAmountMinor: participant.shareAmountMinor
            }))
          }
        : {})
    }
  }

  async deleteParsedPurchase() {
    return false
  }

  async addPaymentRecord(input: {
    cycleId: string
    memberId: string
    kind: 'rent' | 'utilities'
    amountMinor: bigint
    currency: 'USD' | 'GEL'
    recordedAt: Instant
  }) {
    this.addedPaymentRecords.push(input)

    return {
      id: `payment-record-${this.addedPaymentRecords.length}`,
      cycleId: input.cycleId,
      cyclePeriod:
        this.cycles.find((cycle) => cycle.id === input.cycleId)?.period ??
        this.openCycleRecord?.period ??
        null,
      memberId: input.memberId,
      kind: input.kind,
      amountMinor: input.amountMinor,
      currency: input.currency,
      recordedAt: input.recordedAt
    }
  }

  async getPaymentRecord(paymentId: string) {
    return {
      id: paymentId,
      cycleId: this.openCycleRecord?.id ?? 'cycle-1',
      cyclePeriod: this.openCycleRecord?.period ?? '2026-03',
      memberId: 'alice',
      kind: 'utilities' as const,
      amountMinor: 0n,
      currency: 'GEL' as const,
      recordedAt: instantFromIso('2026-03-20T10:00:00.000Z')
    }
  }

  async replacePaymentPurchaseAllocations(
    input: Parameters<FinanceRepository['replacePaymentPurchaseAllocations']>[0]
  ) {
    this.lastReplacedPaymentPurchaseAllocations = input
  }

  async updatePaymentRecord() {
    return null
  }

  async deletePaymentRecord() {
    return false
  }

  async getRentRuleForPeriod(): Promise<FinanceRentRuleRecord | null> {
    return this.rentRule
  }

  async getUtilityTotalForCycle(): Promise<bigint> {
    return this.utilityBills.reduce((sum, bill) => sum + bill.amountMinor, 0n)
  }

  async listUtilityBillsForCycle(cycleId: string) {
    return this.utilityBills.filter((bill) => !bill.cycleId || bill.cycleId === cycleId)
  }

  async getActiveUtilityBillingPlan(cycleId: string) {
    const latest = [...this.utilityBillingPlans]
      .reverse()
      .find(
        (plan) =>
          plan.cycleId === cycleId && (plan.status === 'active' || plan.status === 'settled')
      )
    return latest
      ? {
          id: `utility-plan-${latest.version}`,
          householdId: this.householdId,
          cycleId,
          version: latest.version,
          status: latest.status,
          dueDate: latest.dueDate,
          currency: latest.currency,
          maxCategoriesPerMemberApplied: latest.maxCategoriesPerMemberApplied,
          updatedFromPlanId: latest.updatedFromPlanId,
          reason: latest.reason,
          payload: latest.payload,
          createdAt: instantFromIso('2026-03-01T00:00:00.000Z')
        }
      : null
  }

  async listUtilityBillingPlansForCycle(cycleId: string) {
    return this.utilityBillingPlans
      .filter((plan) => plan.cycleId === cycleId)
      .map((plan) => ({
        id: `utility-plan-${plan.version}`,
        householdId: this.householdId,
        cycleId,
        version: plan.version,
        status: plan.status,
        dueDate: plan.dueDate,
        currency: plan.currency,
        maxCategoriesPerMemberApplied: plan.maxCategoriesPerMemberApplied,
        updatedFromPlanId: plan.updatedFromPlanId,
        reason: plan.reason,
        payload: plan.payload,
        createdAt: instantFromIso('2026-03-01T00:00:00.000Z')
      }))
  }

  async saveUtilityBillingPlan(input: Parameters<FinanceRepository['saveUtilityBillingPlan']>[0]) {
    this.utilityBillingPlans = [...this.utilityBillingPlans, input]
    return {
      id: `utility-plan-${input.version}`,
      householdId: this.householdId,
      cycleId: input.cycleId,
      version: input.version,
      status: input.status,
      dueDate: input.dueDate,
      currency: input.currency,
      maxCategoriesPerMemberApplied: input.maxCategoriesPerMemberApplied,
      updatedFromPlanId: input.updatedFromPlanId,
      reason: input.reason,
      payload: input.payload,
      createdAt: instantFromIso('2026-03-01T00:00:00.000Z')
    }
  }

  async updateUtilityBillingPlanStatus(
    planId: string,
    status: Parameters<FinanceRepository['updateUtilityBillingPlanStatus']>[1]
  ) {
    const version = Number(planId.split('-').at(-1) ?? '0')
    const plan = this.utilityBillingPlans.find((item) => item.version === version)
    if (!plan) {
      return null
    }

    plan.status = status
    return {
      id: planId,
      householdId: this.householdId,
      cycleId: plan.cycleId,
      version: plan.version,
      status: plan.status,
      dueDate: plan.dueDate,
      currency: plan.currency,
      maxCategoriesPerMemberApplied: plan.maxCategoriesPerMemberApplied,
      updatedFromPlanId: plan.updatedFromPlanId,
      reason: plan.reason,
      payload: plan.payload,
      createdAt: instantFromIso('2026-03-01T00:00:00.000Z')
    }
  }

  async listUtilityVendorPaymentFactsForCycle(cycleId: string) {
    return this.utilityVendorPaymentFacts.filter((fact) => fact.cycleId === cycleId)
  }

  async addUtilityVendorPaymentFact(
    input: Parameters<FinanceRepository['addUtilityVendorPaymentFact']>[0]
  ) {
    const fact = {
      id: `utility-vendor-${this.utilityVendorPaymentFacts.length + 1}`,
      cycleId: input.cycleId,
      utilityBillId: input.utilityBillId ?? null,
      billName: input.billName,
      payerMemberId: input.payerMemberId,
      amountMinor: input.amountMinor,
      currency: input.currency,
      plannedForMemberId: input.plannedForMemberId ?? null,
      planVersion: input.planVersion ?? null,
      matchedPlan: input.matchedPlan,
      recordedByMemberId: input.recordedByMemberId ?? null,
      recordedAt: input.recordedAt,
      createdAt: input.recordedAt
    }
    this.utilityVendorPaymentFacts = [...this.utilityVendorPaymentFacts, fact]
    return fact
  }

  async listUtilityReimbursementFactsForCycle(cycleId: string) {
    return this.utilityReimbursementFacts.filter((fact) => fact.cycleId === cycleId)
  }

  async addUtilityReimbursementFact(
    input: Parameters<FinanceRepository['addUtilityReimbursementFact']>[0]
  ) {
    const fact = {
      id: `utility-reimbursement-${this.utilityReimbursementFacts.length + 1}`,
      cycleId: input.cycleId,
      fromMemberId: input.fromMemberId,
      toMemberId: input.toMemberId,
      amountMinor: input.amountMinor,
      currency: input.currency,
      plannedFromMemberId: input.plannedFromMemberId ?? null,
      plannedToMemberId: input.plannedToMemberId ?? null,
      planVersion: input.planVersion ?? null,
      matchedPlan: input.matchedPlan,
      recordedByMemberId: input.recordedByMemberId ?? null,
      recordedAt: input.recordedAt,
      createdAt: input.recordedAt
    }
    this.utilityReimbursementFacts = [...this.utilityReimbursementFacts, fact]
    return fact
  }

  async listPaymentRecordsForCycle(cycleId: string) {
    return this.paymentRecords.filter((payment) => payment.cycleId === cycleId)
  }

  async listParsedPurchasesForRange(): Promise<readonly FinanceParsedPurchaseRecord[]> {
    return this.purchases
  }

  async listParsedPurchases(): Promise<readonly FinanceParsedPurchaseRecord[]> {
    return this.purchases
  }

  async listPaymentPurchaseAllocations() {
    return []
  }

  async getSettlementSnapshotLines() {
    return []
  }

  async savePaymentConfirmation() {
    return {
      status: 'needs_review' as const,
      reviewReason: 'settlement_not_ready' as const
    }
  }

  async replaceSettlementSnapshot(snapshot: SettlementSnapshotRecord): Promise<void> {
    this.replacedSnapshot = snapshot
  }
}

const householdConfigurationRepository: Pick<
  HouseholdConfigurationRepository,
  'getHouseholdBillingSettings' | 'listHouseholdMembers' | 'listHouseholdMemberAbsencePolicies'
> = {
  async getHouseholdBillingSettings(householdId) {
    const repository = financeRepositoryForHousehold(householdId)
    const defaults: HouseholdBillingSettingsRecord = {
      householdId,
      settlementCurrency: 'GEL',
      rentAmountMinor: 70000n,
      rentCurrency: 'USD',
      rentDueDay: 20,
      rentWarningDay: 17,
      utilitiesDueDay: 4,
      utilitiesReminderDay: 3,
      timezone: 'Asia/Tbilisi',
      rentPaymentDestinations: null
    }

    return repository.billingSettingsOverride
      ? { ...defaults, ...repository.billingSettingsOverride }
      : defaults
  },
  async listHouseholdMembers(householdId) {
    const repository = financeRepositoryForHousehold(householdId)

    return repository.members.map((member) => ({
      id: member.id,
      householdId,
      telegramUserId: member.telegramUserId,
      displayName: member.displayName,
      status: repository.memberStatuses.get(member.id) ?? 'active',
      preferredLocale: null,
      householdDefaultLocale: 'en' as const,
      rentShareWeight: member.rentShareWeight,
      isAdmin: member.isAdmin
    }))
  },
  async listHouseholdMemberAbsencePolicies(householdId) {
    return financeRepositoryForHousehold(householdId).memberAbsencePolicies.map((policy) => ({
      householdId,
      memberId: policy.memberId,
      effectiveFromPeriod: policy.effectiveFromPeriod,
      policy: policy.policy
    }))
  }
}

const financeRepositories = new Map<string, FinanceRepositoryStub>()

function financeRepositoryForHousehold(householdId: string): FinanceRepositoryStub {
  const repository = financeRepositories.get(householdId)
  if (!repository) {
    throw new Error(`Missing finance repository stub for ${householdId}`)
  }

  return repository
}

const exchangeRateProvider: ExchangeRateProvider = {
  async getRate(input) {
    if (input.baseCurrency === input.quoteCurrency) {
      return {
        baseCurrency: input.baseCurrency,
        quoteCurrency: input.quoteCurrency,
        rateMicros: 1_000_000n,
        effectiveDate: input.effectiveDate,
        source: 'nbg'
      }
    }

    if (input.baseCurrency === 'USD' && input.quoteCurrency === 'GEL') {
      return {
        baseCurrency: 'USD',
        quoteCurrency: 'GEL',
        rateMicros: 2_700_000n,
        effectiveDate: input.effectiveDate,
        source: 'nbg'
      }
    }

    return {
      baseCurrency: input.baseCurrency,
      quoteCurrency: input.quoteCurrency,
      rateMicros: 370_370n,
      effectiveDate: input.effectiveDate,
      source: 'nbg'
    }
  }
}

function createService(repository: FinanceRepositoryStub) {
  financeRepositories.set(repository.householdId, repository)

  return createFinanceCommandService({
    householdId: repository.householdId,
    repository,
    householdConfigurationRepository,
    exchangeRateProvider
  })
}

describe('createFinanceCommandService', () => {
  test('setRent falls back to the open cycle period when one is active', async () => {
    const repository = new FinanceRepositoryStub()
    const currentPeriod = expectedCurrentCyclePeriod('Asia/Tbilisi', 20)
    repository.openCycleRecord = {
      id: 'cycle-1',
      period: currentPeriod,
      currency: 'GEL'
    }

    const service = createService(repository)
    const result = await service.setRent('700', undefined, undefined)

    expect(result).not.toBeNull()
    expect(result?.period).toBe(currentPeriod)
    expect(result?.currency).toBe('USD')
    expect(result?.amount.amountMinor).toBe(70000n)
    expect(repository.lastSavedRentRule).toEqual({
      period: currentPeriod,
      amountMinor: 70000n,
      currency: 'USD'
    })
  })

  test('getAdminCycleState prefers the open cycle and returns rent plus utility bills', async () => {
    const repository = new FinanceRepositoryStub()
    const currentPeriod = expectedCurrentCyclePeriod('Asia/Tbilisi', 20)
    repository.openCycleRecord = {
      id: 'cycle-1',
      period: currentPeriod,
      currency: 'GEL'
    }
    repository.latestCycleRecord = {
      id: 'cycle-0',
      period: '2026-02',
      currency: 'GEL'
    }
    repository.rentRule = {
      amountMinor: 70000n,
      currency: 'USD'
    }
    repository.utilityBills = [
      {
        id: 'utility-1',
        billName: 'Electricity',
        amountMinor: 12000n,
        currency: 'GEL',
        createdByMemberId: 'alice',
        createdAt: instantFromIso('2026-03-12T12:00:00.000Z')
      }
    ]

    const service = createService(repository)
    const result = await service.getAdminCycleState()

    expect(result).toEqual({
      cycle: {
        id: 'cycle-1',
        period: currentPeriod,
        currency: 'GEL'
      },
      rentRule: {
        amountMinor: 70000n,
        currency: 'USD'
      },
      utilityBills: [
        {
          id: 'utility-1',
          billName: 'Electricity',
          amount: expect.objectContaining({
            amountMinor: 12000n,
            currency: 'GEL'
          }),
          currency: 'GEL',
          createdByMemberId: 'alice',
          createdAt: instantFromIso('2026-03-12T12:00:00.000Z')
        }
      ]
    })
  })

  test('addUtilityBill auto-opens the expected cycle when none is active', async () => {
    const repository = new FinanceRepositoryStub()
    const service = createService(repository)

    const result = await service.addUtilityBill('Electricity', '55.20', 'member-1')
    const expectedPeriod = expectedCurrentCyclePeriod('Asia/Tbilisi', 20)

    expect(result).not.toBeNull()
    expect(result?.period).toBe(expectedPeriod)
    expect(repository.lastUtilityBill).toEqual({
      cycleId: 'opened-cycle',
      billName: 'Electricity',
      amountMinor: 5520n,
      currency: 'GEL',
      createdByMemberId: 'member-1'
    })
  })

  test('generateStatement settles into cycle currency and persists snapshot', async () => {
    const repository = new FinanceRepositoryStub()
    repository.latestCycleRecord = {
      id: 'cycle-2026-03',
      period: '2026-03',
      currency: 'GEL'
    }
    repository.members = [
      {
        id: 'alice',
        telegramUserId: '100',
        displayName: 'Alice',
        rentShareWeight: 1,
        isAdmin: true
      },
      {
        id: 'bob',
        telegramUserId: '200',
        displayName: 'Bob',
        rentShareWeight: 1,
        isAdmin: false
      }
    ]
    repository.rentRule = {
      amountMinor: 70000n,
      currency: 'USD'
    }
    repository.utilityBills = [
      {
        id: 'utility-1',
        billName: 'Electricity',
        amountMinor: 12000n,
        currency: 'GEL',
        createdByMemberId: 'alice',
        createdAt: instantFromIso('2026-03-12T12:00:00.000Z')
      }
    ]
    repository.purchases = [
      {
        id: 'purchase-1',
        cycleId: 'cycle-2026-03',
        cyclePeriod: '2026-03',
        payerMemberId: 'alice',
        amountMinor: 3000n,
        currency: 'GEL',
        description: 'Soap',
        occurredAt: instantFromIso('2026-03-12T11:00:00.000Z')
      }
    ]
    repository.paymentRecords = [
      {
        id: 'payment-1',
        cycleId: 'cycle-2026-03',
        cyclePeriod: '2026-03',
        memberId: 'alice',
        kind: 'rent',
        amountMinor: 50000n,
        currency: 'GEL',
        recordedAt: instantFromIso('2026-03-18T12:00:00.000Z')
      }
    ]

    const service = createService(repository)
    const dashboard = await service.generateDashboard('2026-03')
    const statement = await service.generateStatement('2026-03')

    expect(dashboard).not.toBeNull()
    expect(dashboard?.currency).toBe('GEL')
    expect(dashboard?.rentSourceAmount.toMajorString()).toBe('700.00')
    expect(dashboard?.rentDisplayAmount.toMajorString()).toBe('1890.00')
    expect(dashboard?.members.map((line) => line.netDue.amountMinor)).toEqual([99000n, 102000n])
    expect(dashboard?.ledger.map((entry) => entry.title)).toEqual(['rent', 'Electricity', 'Soap'])
    expect(dashboard?.ledger.map((entry) => entry.kind)).toEqual(['payment', 'utility', 'purchase'])
    expect(dashboard?.ledger.map((entry) => entry.currency)).toEqual(['GEL', 'GEL', 'GEL'])
    expect(dashboard?.ledger.map((entry) => entry.displayCurrency)).toEqual(['GEL', 'GEL', 'GEL'])
    expect(dashboard?.ledger.map((entry) => entry.paymentKind)).toEqual(['rent', null, null])
    expect(statement).toBe(
      [
        'Statement for 2026-03',
        'Rent: 700.00 USD (~1890.00 GEL)',
        '- Alice: due 990.00 GEL, paid 500.00 GEL, remaining 490.00 GEL',
        '- Bob: due 1020.00 GEL, paid 0.00 GEL, remaining 1020.00 GEL',
        'Total due: 2010.00 GEL',
        'Total paid: 500.00 GEL',
        'Total remaining: 1510.00 GEL'
      ].join('\n')
    )
    expect(repository.replacedSnapshot).not.toBeNull()
    expect(repository.replacedSnapshot?.cycleId).toBe('cycle-2026-03')
    expect(repository.replacedSnapshot?.currency).toBe('GEL')
    expect(repository.replacedSnapshot?.totalDueMinor).toBe(201000n)
    expect(repository.replacedSnapshot?.lines.map((line) => line.netDueMinor)).toEqual([
      99000n,
      102000n
    ])
  })

  test('generateDashboard prefers the open cycle over a later latest cycle', async () => {
    const repository = new FinanceRepositoryStub()
    repository.members = [
      {
        id: 'stas',
        telegramUserId: '100',
        displayName: 'Stas',
        rentShareWeight: 1,
        isAdmin: true
      }
    ]
    repository.openCycleRecord = {
      id: 'cycle-2026-03',
      period: '2026-03',
      currency: 'GEL'
    }
    repository.latestCycleRecord = {
      id: 'cycle-2026-04',
      period: '2026-04',
      currency: 'GEL'
    }
    repository.rentRule = {
      amountMinor: 70000n,
      currency: 'USD'
    }

    const service = createService(repository)
    const dashboard = await service.generateDashboard('2026-03')

    expect(dashboard?.period).toBe('2026-03')
  })

  test('generateDashboard excludes away members from utilities but keeps them in default purchase splits', async () => {
    const repository = new FinanceRepositoryStub()
    repository.members = [
      {
        id: 'alice',
        telegramUserId: '1',
        displayName: 'Alice',
        rentShareWeight: 1,
        isAdmin: true
      },
      {
        id: 'bob',
        telegramUserId: '2',
        displayName: 'Bob',
        rentShareWeight: 1,
        isAdmin: false
      },
      {
        id: 'carol',
        telegramUserId: '3',
        displayName: 'Carol',
        rentShareWeight: 1,
        isAdmin: false
      }
    ]
    repository.memberStatuses.set('carol', 'away')
    repository.memberAbsencePolicies = [
      {
        memberId: 'carol',
        effectiveFromPeriod: '2026-03',
        policy: 'away_rent_only'
      }
    ]
    repository.openCycleRecord = {
      id: 'cycle-2026-03',
      period: '2026-03',
      currency: 'GEL'
    }
    repository.rentRule = {
      amountMinor: 90000n,
      currency: 'GEL'
    }
    repository.utilityBills = [
      {
        id: 'utility-1',
        billName: 'Gas',
        amountMinor: 12000n,
        currency: 'GEL',
        createdByMemberId: 'alice',
        createdAt: instantFromIso('2026-03-12T12:00:00.000Z')
      }
    ]
    repository.purchases = [
      {
        id: 'purchase-1',
        cycleId: 'cycle-2026-03',
        cyclePeriod: '2026-03',
        payerMemberId: 'alice',
        amountMinor: 3000n,
        currency: 'GEL',
        description: 'Kitchen towels',
        occurredAt: instantFromIso('2026-03-10T12:00:00.000Z')
      }
    ]

    const service = createService(repository)
    const dashboard = await service.generateDashboard()

    expect(
      dashboard?.members.map((line) => ({
        memberId: line.memberId,
        utility: line.utilityShare.amountMinor,
        purchaseOffset: line.purchaseOffset.amountMinor
      }))
    ).toEqual([
      { memberId: 'alice', utility: 6000n, purchaseOffset: -2000n },
      { memberId: 'bob', utility: 6000n, purchaseOffset: 1000n },
      { memberId: 'carol', utility: 0n, purchaseOffset: 1000n }
    ])
  })

  test('updatePurchase persists explicit participant splits', async () => {
    const repository = new FinanceRepositoryStub()
    const service = createService(repository)

    const result = await service.updatePurchase('purchase-1', 'Kitchen towels', '30.00', 'GEL', {
      mode: 'custom_amounts',
      participants: [
        {
          memberId: 'alice',
          shareAmountMajor: '20.00'
        },
        {
          memberId: 'bob',
          shareAmountMajor: '10.00'
        }
      ]
    })

    expect(result).toMatchObject({
      purchaseId: 'purchase-1',
      currency: 'GEL'
    })
    expect(repository.lastUpdatedPurchaseInput).toEqual({
      purchaseId: 'purchase-1',
      amountMinor: 3000n,
      currency: 'GEL',
      description: 'Kitchen towels',
      splitMode: 'custom_amounts',
      participants: [
        {
          memberId: 'alice',
          included: true,
          shareAmountMinor: 2000n
        },
        {
          memberId: 'bob',
          included: true,
          shareAmountMinor: 1000n
        }
      ]
    })
  })

  test('generateDashboard exposes purchase participant splits in the ledger', async () => {
    const repository = new FinanceRepositoryStub()
    repository.members = [
      {
        id: 'alice',
        telegramUserId: '1',
        displayName: 'Alice',
        rentShareWeight: 1,
        isAdmin: true
      },
      {
        id: 'bob',
        telegramUserId: '2',
        displayName: 'Bob',
        rentShareWeight: 1,
        isAdmin: false
      },
      {
        id: 'carol',
        telegramUserId: '3',
        displayName: 'Carol',
        rentShareWeight: 1,
        isAdmin: false
      }
    ]
    repository.openCycleRecord = {
      id: 'cycle-2026-03',
      period: '2026-03',
      currency: 'GEL'
    }
    repository.rentRule = {
      amountMinor: 90000n,
      currency: 'GEL'
    }
    repository.purchases = [
      {
        id: 'purchase-1',
        cycleId: 'cycle-2026-03',
        cyclePeriod: '2026-03',
        payerMemberId: 'alice',
        amountMinor: 3000n,
        currency: 'GEL',
        description: 'Kettle',
        occurredAt: instantFromIso('2026-03-10T12:00:00.000Z'),
        splitMode: 'custom_amounts',
        participants: [
          {
            memberId: 'alice',
            included: true,
            shareAmountMinor: 2000n
          },
          {
            memberId: 'bob',
            included: true,
            shareAmountMinor: 1000n
          },
          {
            memberId: 'carol',
            included: false,
            shareAmountMinor: null
          }
        ]
      }
    ]

    const service = createService(repository)
    const dashboard = await service.generateDashboard()
    const purchaseEntry = dashboard?.ledger.find((entry) => entry.id === 'purchase-1')

    expect(purchaseEntry?.kind).toBe('purchase')
    expect(purchaseEntry?.purchaseSplitMode).toBe('custom_amounts')
    expect(purchaseEntry?.purchaseParticipants).toEqual([
      {
        memberId: 'alice',
        included: true,
        shareAmount: Money.fromMinor(2000n, 'GEL')
      },
      {
        memberId: 'bob',
        included: true,
        shareAmount: Money.fromMinor(1000n, 'GEL')
      },
      {
        memberId: 'carol',
        included: false,
        shareAmount: null
      }
    ])
  })

  test('generateDashboard should not 500 on legacy malformed custom split purchases (mixed null/explicit shares)', async () => {
    const repository = new FinanceRepositoryStub()
    repository.members = [
      {
        id: 'alice',
        telegramUserId: '1',
        displayName: 'Alice',
        rentShareWeight: 1,
        isAdmin: true
      },
      {
        id: 'bob',
        telegramUserId: '2',
        displayName: 'Bob',
        rentShareWeight: 1,
        isAdmin: false
      }
    ]
    repository.openCycleRecord = {
      id: 'cycle-2026-03',
      period: '2026-03',
      currency: 'GEL'
    }
    repository.rentRule = {
      amountMinor: 70000n,
      currency: 'USD'
    }
    repository.purchases = [
      {
        id: 'malformed-purchase-1',
        cycleId: 'cycle-2026-03',
        cyclePeriod: '2026-03',
        payerMemberId: 'alice',
        amountMinor: 1000n, // Total is 10.00 GEL
        currency: 'GEL',
        description: 'Legacy purchase',
        occurredAt: instantFromIso('2026-03-12T11:00:00.000Z'),
        splitMode: 'custom_amounts',
        participants: [
          {
            memberId: 'alice',
            included: true,
            shareAmountMinor: 1000n // Explicitly Alice takes full 10.00 GEL
          },
          {
            memberId: 'bob',
            // Missing included: false, and shareAmountMinor is null
            // This is the malformed data that used to cause 500
            shareAmountMinor: null
          }
        ]
      }
    ]

    const service = createService(repository)
    const dashboard = await service.generateDashboard()

    expect(dashboard).not.toBeNull()
    const purchase = dashboard?.ledger.find((e) => e.id === 'malformed-purchase-1')
    expect(purchase?.purchaseSplitMode).toBe('custom_amounts')

    // Bob should be treated as excluded from the settlement calculation
    const bobLine = dashboard?.members.find((m) => m.memberId === 'bob')
    expect(bobLine?.purchaseOffset.amountMinor).toBe(0n)

    const aliceLine = dashboard?.members.find((m) => m.memberId === 'alice')
    // Alice paid 1000n and her share is 1000n -> offset 0n
    expect(aliceLine?.purchaseOffset.amountMinor).toBe(0n)
  })

  test('generateDashboard succeeds even if rent rule is missing', async () => {
    const repository = new FinanceRepositoryStub()
    repository.members = [
      {
        id: 'alice',
        telegramUserId: '1',
        displayName: 'Alice',
        rentShareWeight: 1,
        isAdmin: true
      }
    ]
    repository.openCycleRecord = {
      id: 'cycle-2026-03',
      period: '2026-03',
      currency: 'GEL'
    }

    // Simulate missing rent rule
    repository.rentRule = null

    const service = createService(repository)
    const dashboard = await service.generateDashboard('2026-03')

    expect(dashboard).not.toBeNull()
    expect(dashboard?.period).toBe('2026-03')
    expect(dashboard?.rentSourceAmount.amountMinor).toBe(0n)
    expect(dashboard?.rentDisplayAmount.amountMinor).toBe(0n)
    expect(dashboard?.totalDue.amountMinor).toBe(0n)
  })

  test('generateDashboard carries unresolved purchases from prior cycles into the current cycle', async () => {
    const repository = new FinanceRepositoryStub()
    repository.members = [
      {
        id: 'alice',
        telegramUserId: '1',
        displayName: 'Alice',
        rentShareWeight: 1,
        isAdmin: true
      },
      {
        id: 'bob',
        telegramUserId: '2',
        displayName: 'Bob',
        rentShareWeight: 1,
        isAdmin: false
      }
    ]
    repository.openCycleRecord = {
      id: 'cycle-2026-04',
      period: '2026-04',
      currency: 'GEL'
    }
    repository.rentRule = {
      amountMinor: 0n,
      currency: 'GEL'
    }
    repository.utilityBills = [
      {
        id: 'utility-1',
        billName: 'Electricity',
        amountMinor: 5000n,
        currency: 'GEL',
        createdByMemberId: 'alice',
        createdAt: instantFromIso('2026-04-05T12:00:00.000Z')
      }
    ]
    repository.purchases = [
      {
        id: 'purchase-1',
        cycleId: 'cycle-2026-03',
        cyclePeriod: '2026-03',
        payerMemberId: 'alice',
        amountMinor: 3000n,
        currency: 'GEL',
        description: 'Soap',
        occurredAt: instantFromIso('2026-03-12T11:00:00.000Z'),
        splitMode: 'custom_amounts',
        participants: [
          {
            memberId: 'alice',
            included: true,
            shareAmountMinor: 1500n
          },
          {
            memberId: 'bob',
            included: true,
            shareAmountMinor: 1500n
          }
        ]
      }
    ]

    const service = createService(repository)
    const dashboard = await service.generateDashboard()
    const bobLine = dashboard?.members.find((member) => member.memberId === 'bob')
    const purchaseEntry = dashboard?.ledger.find((entry) => entry.id === 'purchase-1')

    expect(bobLine?.purchaseOffset.amountMinor).toBe(1500n)
    expect(bobLine?.utilityShare.amountMinor).toBe(2500n)
    expect(purchaseEntry?.kind).toBe('purchase')
    expect(purchaseEntry?.originPeriod).toBe('2026-03')
    expect(purchaseEntry?.resolutionStatus).toBe('unresolved')
    expect(purchaseEntry?.outstandingByMember).toEqual([
      {
        memberId: 'bob',
        amount: Money.fromMinor(1500n, 'GEL')
      }
    ])
  })

  test('addPayment allocates utilities overage to the oldest unresolved purchase balance', async () => {
    const repository = new FinanceRepositoryStub()
    repository.members = [
      {
        id: 'alice',
        telegramUserId: '1',
        displayName: 'Alice',
        rentShareWeight: 1,
        isAdmin: true
      },
      {
        id: 'bob',
        telegramUserId: '2',
        displayName: 'Bob',
        rentShareWeight: 1,
        isAdmin: false
      }
    ]
    repository.openCycleRecord = {
      id: 'cycle-2026-04',
      period: '2026-04',
      currency: 'GEL'
    }
    repository.rentRule = {
      amountMinor: 0n,
      currency: 'GEL'
    }
    repository.utilityBills = [
      {
        id: 'utility-1',
        billName: 'Electricity',
        amountMinor: 5000n,
        currency: 'GEL',
        createdByMemberId: 'alice',
        createdAt: instantFromIso('2026-04-05T12:00:00.000Z')
      }
    ]
    repository.purchases = [
      {
        id: 'purchase-oldest',
        cycleId: 'cycle-2026-03',
        cyclePeriod: '2026-03',
        payerMemberId: 'alice',
        amountMinor: 3000n,
        currency: 'GEL',
        description: 'Old soap',
        occurredAt: instantFromIso('2026-03-12T11:00:00.000Z'),
        splitMode: 'custom_amounts',
        participants: [
          {
            memberId: 'alice',
            included: true,
            shareAmountMinor: 1500n
          },
          {
            memberId: 'bob',
            included: true,
            shareAmountMinor: 1500n
          }
        ]
      },
      {
        id: 'purchase-newer',
        cycleId: 'cycle-2026-04',
        cyclePeriod: '2026-04',
        payerMemberId: 'alice',
        amountMinor: 2000n,
        currency: 'GEL',
        description: 'New sponge',
        occurredAt: instantFromIso('2026-04-07T11:00:00.000Z'),
        splitMode: 'custom_amounts',
        participants: [
          {
            memberId: 'alice',
            included: true,
            shareAmountMinor: 1000n
          },
          {
            memberId: 'bob',
            included: true,
            shareAmountMinor: 1000n
          }
        ]
      }
    ]

    const service = createService(repository)
    await service.addPayment('bob', 'utilities', '40.00', 'GEL', '2026-04')

    expect(repository.lastReplacedPaymentPurchaseAllocations).toEqual({
      paymentRecordId: 'payment-record-1',
      allocations: [
        {
          purchaseId: 'purchase-oldest',
          memberId: 'bob',
          amountMinor: 1500n
        }
      ]
    })
  })

  test('generateDashboard aggregates overdue payments by kind across unresolved past cycles', async () => {
    const repository = new FinanceRepositoryStub()
    repository.members = [
      {
        id: 'alice',
        telegramUserId: '1',
        displayName: 'Alice',
        rentShareWeight: 1,
        isAdmin: true
      },
      {
        id: 'bob',
        telegramUserId: '2',
        displayName: 'Bob',
        rentShareWeight: 1,
        isAdmin: false
      }
    ]
    repository.cycles = [
      { id: 'cycle-2026-01', period: '2026-01', currency: 'GEL' },
      { id: 'cycle-2026-02', period: '2026-02', currency: 'GEL' },
      { id: 'cycle-2026-03', period: '2026-03', currency: 'GEL' }
    ]
    repository.openCycleRecord = repository.cycles[2]!
    repository.latestCycleRecord = repository.cycles[2]!
    repository.rentRule = {
      amountMinor: 2000n,
      currency: 'GEL'
    }
    repository.utilityBills = [
      {
        id: 'utility-2026-02',
        cycleId: 'cycle-2026-02',
        billName: 'Electricity',
        amountMinor: 600n,
        currency: 'GEL',
        createdByMemberId: 'alice',
        createdAt: instantFromIso('2026-02-10T12:00:00.000Z')
      }
    ]
    repository.paymentRecords = [
      {
        id: 'payment-1',
        cycleId: 'cycle-2026-03',
        cyclePeriod: '2026-03',
        memberId: 'bob',
        kind: 'rent',
        amountMinor: 1000n,
        currency: 'GEL',
        recordedAt: instantFromIso('2026-03-18T12:00:00.000Z')
      }
    ]

    const service = createService(repository)
    const dashboard = await service.generateDashboard()
    const bobLine = dashboard?.members.find((member) => member.memberId === 'bob')

    expect(bobLine?.overduePayments).toEqual([
      {
        kind: 'rent',
        amountMinor: 2000n,
        periods: ['2026-01', '2026-02']
      },
      {
        kind: 'utilities',
        amountMinor: 300n,
        periods: ['2026-02']
      }
    ])
  })

  test('addPayment without explicit period applies overdue payments oldest-first across cycles', async () => {
    const repository = new FinanceRepositoryStub()
    repository.members = [
      {
        id: 'alice',
        telegramUserId: '1',
        displayName: 'Alice',
        rentShareWeight: 1,
        isAdmin: true
      },
      {
        id: 'bob',
        telegramUserId: '2',
        displayName: 'Bob',
        rentShareWeight: 1,
        isAdmin: false
      }
    ]
    repository.cycles = [
      { id: 'cycle-2026-01', period: '2026-01', currency: 'GEL' },
      { id: 'cycle-2026-02', period: '2026-02', currency: 'GEL' },
      { id: 'cycle-2026-03', period: '2026-03', currency: 'GEL' }
    ]
    repository.openCycleRecord = repository.cycles[2]!
    repository.latestCycleRecord = repository.cycles[2]!
    repository.rentRule = {
      amountMinor: 2000n,
      currency: 'GEL'
    }

    const service = createService(repository)
    await service.addPayment('bob', 'rent', '15.00', 'GEL')

    expect(repository.addedPaymentRecords).toEqual([
      {
        cycleId: 'cycle-2026-01',
        memberId: 'bob',
        kind: 'rent',
        amountMinor: 1000n,
        currency: 'GEL',
        recordedAt: repository.addedPaymentRecords[0]!.recordedAt
      },
      {
        cycleId: 'cycle-2026-02',
        memberId: 'bob',
        kind: 'rent',
        amountMinor: 500n,
        currency: 'GEL',
        recordedAt: repository.addedPaymentRecords[1]!.recordedAt
      }
    ])
  })

  test('generateDashboard rounds rent suggestions in payment period summaries', async () => {
    const repository = new FinanceRepositoryStub()
    repository.members = [
      {
        id: 'alice',
        telegramUserId: '1',
        displayName: 'Alice',
        rentShareWeight: 1,
        isAdmin: true
      }
    ]
    repository.openCycleRecord = {
      id: 'cycle-2026-03',
      period: '2026-03',
      currency: 'GEL'
    }
    repository.latestCycleRecord = repository.openCycleRecord
    repository.cycles = [repository.openCycleRecord]
    repository.rentRule = {
      amountMinor: 47256n,
      currency: 'GEL'
    }

    const service = createService(repository)
    const dashboard = await service.generateDashboard('2026-03')
    const rentSummary = dashboard?.paymentPeriods?.[0]?.kinds.find((kind) => kind.kind === 'rent')

    expect(rentSummary?.unresolvedMembers[0]?.suggestedAmount.toMajorString()).toBe('473.00')
  })

  test('addPayment rejects duplicate explicit payments when the period is already effectively settled', async () => {
    const repository = new FinanceRepositoryStub()
    repository.members = [
      {
        id: 'alice',
        telegramUserId: '1',
        displayName: 'Alice',
        rentShareWeight: 1,
        isAdmin: true
      }
    ]
    repository.openCycleRecord = {
      id: 'cycle-2026-03',
      period: '2026-03',
      currency: 'GEL'
    }
    repository.latestCycleRecord = repository.openCycleRecord
    repository.cycles = [repository.openCycleRecord]
    repository.rentRule = {
      amountMinor: 47256n,
      currency: 'GEL'
    }
    repository.paymentRecords = [
      {
        id: 'payment-1',
        cycleId: 'cycle-2026-03',
        cyclePeriod: '2026-03',
        memberId: 'alice',
        kind: 'rent',
        amountMinor: 47200n,
        currency: 'GEL',
        recordedAt: instantFromIso('2026-03-18T12:00:00.000Z')
      }
    ]

    const service = createService(repository)

    await expect(service.addPayment('alice', 'rent', '10.00', 'GEL', '2026-03')).rejects.toThrow(
      'Payment period is already settled'
    )
  })

  test('generateDashboard applies purchase balance through utilities mode', async () => {
    const repository = new FinanceRepositoryStub()
    repository.members = [
      {
        id: 'alice',
        telegramUserId: '1',
        displayName: 'Alice',
        rentShareWeight: 1,
        isAdmin: true
      },
      {
        id: 'bob',
        telegramUserId: '2',
        displayName: 'Bob',
        rentShareWeight: 1,
        isAdmin: false
      }
    ]
    repository.openCycleRecord = {
      id: 'cycle-2026-03',
      period: '2026-03',
      currency: 'GEL'
    }
    repository.latestCycleRecord = repository.openCycleRecord
    repository.cycles = [repository.openCycleRecord]
    repository.rentRule = {
      amountMinor: 70000n,
      currency: 'USD'
    }
    repository.billingSettingsOverride = {
      paymentBalanceAdjustmentPolicy: 'utilities'
    }
    repository.utilityBills = [
      {
        id: 'bill-electricity',
        billName: 'Electricity',
        amountMinor: 10000n,
        currency: 'GEL',
        createdByMemberId: 'alice',
        createdAt: instantFromIso('2026-03-01T09:00:00.000Z')
      }
    ]
    repository.purchases = [
      {
        id: 'purchase-1',
        cycleId: 'cycle-2026-03',
        cyclePeriod: '2026-03',
        payerMemberId: 'alice',
        amountMinor: 2000n,
        currency: 'GEL',
        description: 'Shared food',
        occurredAt: instantFromIso('2026-03-02T10:00:00.000Z'),
        splitMode: 'equal'
      }
    ]

    const service = createService(repository)
    const dashboard = await service.generateDashboard('2026-03')

    expect(
      dashboard?.utilityBillingPlan?.memberSummaries.map((summary) => ({
        memberId: summary.memberId,
        fairShareMinor: summary.fairShare.amountMinor
      }))
    ).toEqual([
      { memberId: 'alice', fairShareMinor: 4000n },
      { memberId: 'bob', fairShareMinor: 6000n }
    ])
    expect(
      dashboard?.paymentPeriods?.[0]?.kinds
        .find((kind) => kind.kind === 'utilities')
        ?.unresolvedMembers.map((member) => ({
          memberId: member.memberId,
          baseDueMinor: member.baseDue.amountMinor
        }))
    ).toEqual([
      { memberId: 'alice', baseDueMinor: 4000n },
      { memberId: 'bob', baseDueMinor: 6000n }
    ])
  })

  test('generateDashboard routes purchase balance through rent mode instead of utility targets', async () => {
    const repository = new FinanceRepositoryStub()
    repository.members = [
      {
        id: 'alice',
        telegramUserId: '1',
        displayName: 'Alice',
        rentShareWeight: 1,
        isAdmin: true
      },
      {
        id: 'bob',
        telegramUserId: '2',
        displayName: 'Bob',
        rentShareWeight: 1,
        isAdmin: false
      }
    ]
    repository.openCycleRecord = {
      id: 'cycle-2026-03',
      period: '2026-03',
      currency: 'GEL'
    }
    repository.latestCycleRecord = repository.openCycleRecord
    repository.cycles = [repository.openCycleRecord]
    repository.rentRule = {
      amountMinor: 70000n,
      currency: 'USD'
    }
    repository.billingSettingsOverride = {
      paymentBalanceAdjustmentPolicy: 'rent'
    }
    repository.utilityBills = [
      {
        id: 'bill-electricity',
        billName: 'Electricity',
        amountMinor: 10000n,
        currency: 'GEL',
        createdByMemberId: 'alice',
        createdAt: instantFromIso('2026-03-01T09:00:00.000Z')
      }
    ]
    repository.purchases = [
      {
        id: 'purchase-1',
        cycleId: 'cycle-2026-03',
        cyclePeriod: '2026-03',
        payerMemberId: 'alice',
        amountMinor: 2000n,
        currency: 'GEL',
        description: 'Shared food',
        occurredAt: instantFromIso('2026-03-02T10:00:00.000Z'),
        splitMode: 'equal'
      }
    ]

    const service = createService(repository)
    const dashboard = await service.generateDashboard('2026-03')

    expect(
      dashboard?.utilityBillingPlan?.memberSummaries.map((summary) => ({
        memberId: summary.memberId,
        fairShareMinor: summary.fairShare.amountMinor
      }))
    ).toEqual([
      { memberId: 'alice', fairShareMinor: 5000n },
      { memberId: 'bob', fairShareMinor: 5000n }
    ])
    expect(
      dashboard?.utilityBillingPlan?.categories.every((category) => category.isFullAssignment)
    ).toBe(true)
    expect(dashboard?.rentBillingState.memberSummaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          memberId: 'alice',
          due: expect.objectContaining({ amountMinor: 93500n })
        }),
        expect.objectContaining({
          memberId: 'bob',
          due: expect.objectContaining({ amountMinor: 95500n })
        })
      ])
    )
  })

  test('generateDashboard keeps both payment kinds raw in manual mode', async () => {
    const repository = new FinanceRepositoryStub()
    repository.members = [
      {
        id: 'alice',
        telegramUserId: '1',
        displayName: 'Alice',
        rentShareWeight: 1,
        isAdmin: true
      },
      {
        id: 'bob',
        telegramUserId: '2',
        displayName: 'Bob',
        rentShareWeight: 1,
        isAdmin: false
      }
    ]
    repository.openCycleRecord = {
      id: 'cycle-2026-03',
      period: '2026-03',
      currency: 'GEL'
    }
    repository.latestCycleRecord = repository.openCycleRecord
    repository.cycles = [repository.openCycleRecord]
    repository.rentRule = {
      amountMinor: 70000n,
      currency: 'USD'
    }
    repository.billingSettingsOverride = {
      paymentBalanceAdjustmentPolicy: 'separate'
    }
    repository.utilityBills = [
      {
        id: 'bill-electricity',
        billName: 'Electricity',
        amountMinor: 10000n,
        currency: 'GEL',
        createdByMemberId: 'alice',
        createdAt: instantFromIso('2026-03-01T09:00:00.000Z')
      }
    ]
    repository.purchases = [
      {
        id: 'purchase-1',
        cycleId: 'cycle-2026-03',
        cyclePeriod: '2026-03',
        payerMemberId: 'alice',
        amountMinor: 2000n,
        currency: 'GEL',
        description: 'Shared food',
        occurredAt: instantFromIso('2026-03-02T10:00:00.000Z'),
        splitMode: 'equal'
      }
    ]

    const service = createService(repository)
    const dashboard = await service.generateDashboard('2026-03')

    expect(
      dashboard?.rentBillingState.memberSummaries.map((summary) => summary.due.amountMinor)
    ).toEqual([94500n, 94500n])
    expect(
      dashboard?.paymentPeriods?.[0]?.kinds
        .find((kind) => kind.kind === 'utilities')
        ?.unresolvedMembers.map((member) => member.baseDue.amountMinor)
    ).toEqual([5000n, 5000n])
  })

  test('recordUtilityVendorPayment marks the previous plan diverged and rebalances the remainder', async () => {
    const repository = new FinanceRepositoryStub()
    repository.members = [
      {
        id: 'alice',
        telegramUserId: '1',
        displayName: 'Alice',
        rentShareWeight: 1,
        isAdmin: true
      },
      {
        id: 'bob',
        telegramUserId: '2',
        displayName: 'Bob',
        rentShareWeight: 1,
        isAdmin: false
      }
    ]
    repository.openCycleRecord = {
      id: 'cycle-2026-04',
      period: '2026-04',
      currency: 'GEL'
    }
    repository.latestCycleRecord = repository.openCycleRecord
    repository.cycles = [repository.openCycleRecord]
    repository.utilityBills = [
      {
        id: 'bill-electricity',
        billName: 'Electricity',
        amountMinor: 10000n,
        currency: 'GEL',
        createdByMemberId: 'alice',
        createdAt: instantFromIso('2026-04-01T09:00:00.000Z')
      },
      {
        id: 'bill-gas',
        billName: 'Gas',
        amountMinor: 10000n,
        currency: 'GEL',
        createdByMemberId: 'alice',
        createdAt: instantFromIso('2026-04-01T09:01:00.000Z')
      }
    ]

    const service = createService(repository)
    const initialPlan = await service.generateCurrentBillPlan('2026-04')

    expect(initialPlan?.utilityBillingPlan?.version).toBe(1)
    expect(
      initialPlan?.utilityBillingPlan?.categories.map((category) => ({
        bill: category.billName,
        assigned: category.assignedMemberId
      }))
    ).toEqual([
      {
        bill: 'Electricity',
        assigned: 'alice'
      },
      {
        bill: 'Gas',
        assigned: 'bob'
      }
    ])

    const result = await service.recordUtilityVendorPayment({
      utilityBillId: 'bill-gas',
      payerMemberId: 'alice',
      actorMemberId: 'alice',
      periodArg: '2026-04'
    })

    expect(repository.utilityVendorPaymentFacts).toHaveLength(1)
    expect(repository.utilityVendorPaymentFacts[0]).toMatchObject({
      utilityBillId: 'bill-gas',
      payerMemberId: 'alice',
      matchedPlan: false,
      plannedForMemberId: null,
      planVersion: 1
    })
    expect(repository.utilityBillingPlans.map((plan) => plan.status)).toEqual([
      'diverged',
      'active'
    ])
    expect(result?.plan?.version).toBe(2)
    expect(result?.plan?.reason).toBe('rebalanced_after_off_plan_change')
    expect(
      result?.plan?.categories.map((category) => ({
        bill: category.billName,
        assigned: category.assignedMemberId,
        amountMinor: category.assignedAmount.amountMinor
      }))
    ).toEqual([
      {
        bill: 'Electricity',
        assigned: 'bob',
        amountMinor: 10000n
      }
    ])
    expect(
      result?.plan?.memberSummaries.every(
        (summary) => summary.projectedDeltaAfterPlan.amountMinor === 0n
      )
    ).toBe(true)
  })
})
