import { describe, expect, test } from 'bun:test'

import { instantFromIso, Money, type Instant } from '@household/domain'
import type {
  ExchangeRateProvider,
  FinanceCycleExchangeRateRecord,
  FinanceCycleRecord,
  FinanceBalanceLedgerEntryRecord,
  FinanceMemberRecord,
  FinancePaymentPurchaseAllocationRecord,
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
  memberPresenceDays: readonly {
    memberId: string
    period: string
    daysPresent: number
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
  utilityCategories: readonly {
    id: string
    slug: string
    name: string
    sortOrder: number
    isActive: boolean
    providerName?: string | null
    customerNumber?: string | null
    paymentLink?: string | null
    note?: string | null
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
  balanceLedgerEntries: readonly FinanceBalanceLedgerEntryRecord[] = []
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
  addedPaymentRecords: Array<
    Parameters<FinanceRepository['addPaymentRecord']>[0] & { idempotencyKey?: string }
  > = []
  paymentPurchaseAllocations: readonly FinancePaymentPurchaseAllocationRecord[] = []

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
    this.utilityBills = [
      ...this.utilityBills,
      {
        id: `utility-bill-${this.utilityBills.length + 1}`,
        cycleId: input.cycleId,
        billName: input.billName,
        amountMinor: input.amountMinor,
        currency: input.currency,
        createdByMemberId: input.createdByMemberId,
        createdAt: instantFromIso('2026-04-02T09:00:00.000Z')
      }
    ]
  }

  async addParsedPurchase(input: Parameters<FinanceRepository['addParsedPurchase']>[0]) {
    this.lastAddedPurchaseInput = input
    const created = {
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
    this.purchases = [...this.purchases, created]

    return created
  }

  async updateUtilityBill() {
    return null
  }

  async deleteUtilityBill() {
    return false
  }

  async updateParsedPurchase(input: Parameters<FinanceRepository['updateParsedPurchase']>[0]) {
    this.lastUpdatedPurchaseInput = input
    const existing = this.purchases.find((purchase) => purchase.id === input.purchaseId)
    const updated = {
      id: input.purchaseId,
      cycleId: existing?.cycleId ?? null,
      cyclePeriod: existing?.cyclePeriod ?? null,
      payerMemberId: input.payerMemberId ?? existing?.payerMemberId ?? 'alice',
      amountMinor: input.amountMinor,
      currency: input.currency,
      description: input.description,
      occurredAt:
        input.occurredAt ?? existing?.occurredAt ?? instantFromIso('2026-03-12T11:00:00.000Z'),
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
    this.purchases = this.purchases.map((purchase) =>
      purchase.id === input.purchaseId ? updated : purchase
    )

    return updated
  }

  async deleteParsedPurchase(purchaseId: string) {
    const existed = this.purchases.some((purchase) => purchase.id === purchaseId)
    this.purchases = this.purchases.filter((purchase) => purchase.id !== purchaseId)
    return existed
  }

  async getParsedPurchase(purchaseId: string) {
    return this.purchases.find((purchase) => purchase.id === purchaseId) ?? null
  }

  async ensureEqualPurchaseParticipants(purchaseId: string) {
    return this.getParsedPurchase(purchaseId)
  }

  async toggleSavedPurchaseParticipant() {
    return { status: 'not_found' as const }
  }

  async getPurchaseTopicMessage() {
    return null
  }

  async upsertPurchaseTopicMessage(
    input: Parameters<FinanceRepository['upsertPurchaseTopicMessage']>[0]
  ) {
    return {
      purchaseMessageId: input.purchaseMessageId,
      householdId: this.householdId,
      telegramChatId: input.telegramChatId,
      telegramThreadId: input.telegramThreadId,
      telegramMessageId: input.telegramMessageId,
      status: input.status,
      lastError: input.lastError ?? null
    }
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

  async addPaymentRecordIfNew(input: Parameters<FinanceRepository['addPaymentRecordIfNew']>[0]) {
    const existing = this.addedPaymentRecords.find(
      (record) => 'idempotencyKey' in record && record.idempotencyKey === input.idempotencyKey
    )
    if (existing) {
      return null
    }

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
    const recordedAt = instantFromIso('2026-04-03T12:00:00.000Z')
    this.paymentPurchaseAllocations = [
      ...this.paymentPurchaseAllocations.filter(
        (allocation) => allocation.paymentRecordId !== input.paymentRecordId
      ),
      ...input.allocations.map((allocation, index) => ({
        id: `${input.paymentRecordId}-allocation-${index + 1}`,
        paymentRecordId: input.paymentRecordId,
        purchaseId: allocation.purchaseId,
        memberId: allocation.memberId,
        amountMinor: allocation.amountMinor,
        resolutionCycleId: input.cycleId,
        resolutionMethod: input.resolutionMethod,
        resolutionPlanId: input.resolutionPlanId ?? null,
        recordedAt
      }))
    ]
  }

  async createManualPurchaseAllocations() {
    // Stub implementation
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

  async replaceCurrentUtilityBillingPlan(
    input: Parameters<FinanceRepository['replaceCurrentUtilityBillingPlan']>[0]
  ) {
    const current = [...this.utilityBillingPlans]
      .reverse()
      .find(
        (plan) =>
          plan.cycleId === input.cycleId && (plan.status === 'active' || plan.status === 'settled')
      )
    if (
      current &&
      current.status === input.status &&
      current.dueDate === input.dueDate &&
      current.currency === input.currency &&
      current.maxCategoriesPerMemberApplied === input.maxCategoriesPerMemberApplied &&
      JSON.stringify(current.payload) === JSON.stringify(input.payload)
    ) {
      return {
        id: `utility-plan-${current.version}`,
        householdId: this.householdId,
        cycleId: current.cycleId,
        version: current.version,
        status: current.status,
        dueDate: current.dueDate,
        currency: current.currency,
        maxCategoriesPerMemberApplied: current.maxCategoriesPerMemberApplied,
        updatedFromPlanId: current.updatedFromPlanId,
        reason: current.reason,
        payload: current.payload,
        createdAt: instantFromIso('2026-03-01T00:00:00.000Z')
      }
    }

    if (current && input.previousPlanReplacementStatus) {
      current.status = input.previousPlanReplacementStatus
    }
    const nextVersion =
      this.utilityBillingPlans.reduce((max, plan) => (plan.version > max ? plan.version : max), 0) +
      1
    return this.saveUtilityBillingPlan({
      cycleId: input.cycleId,
      version: nextVersion,
      status: input.status,
      dueDate: input.dueDate,
      currency: input.currency,
      maxCategoriesPerMemberApplied: input.maxCategoriesPerMemberApplied,
      updatedFromPlanId: current ? `utility-plan-${current.version}` : input.previousPlanId,
      reason: input.reason,
      payload: input.payload
    })
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

  async listBalanceLedgerEntries() {
    return this.balanceLedgerEntries
  }

  async addBalanceLedgerEntry(input: Parameters<FinanceRepository['addBalanceLedgerEntry']>[0]) {
    const existing = this.balanceLedgerEntries.find(
      (entry) => entry.idempotencyKey === input.idempotencyKey
    )
    if (existing) {
      return existing
    }

    const entry: FinanceBalanceLedgerEntryRecord = {
      id: `balance-ledger-${this.balanceLedgerEntries.length + 1}`,
      householdId: this.householdId,
      memberId: input.memberId,
      sourceCycleId: input.sourceCycleId,
      sourceCyclePeriod: input.sourceCyclePeriod,
      planId: input.planId ?? null,
      entryType: input.entryType,
      policyTarget: input.policyTarget,
      reason: input.reason,
      amountMinor: input.amountMinor,
      currency: input.currency,
      idempotencyKey: input.idempotencyKey,
      createdAt: instantFromIso('2026-04-03T12:00:00.000Z')
    }
    this.balanceLedgerEntries = [...this.balanceLedgerEntries, entry]
    return entry
  }

  async addUtilityVendorPaymentFact(
    input: Parameters<FinanceRepository['addUtilityVendorPaymentFact']>[0]
  ) {
    const fact = {
      id: `utility-vendor-${this.utilityVendorPaymentFacts.length + 1}`,
      cycleId: input.cycleId,
      planId: input.planId ?? null,
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

  async addUtilityVendorPaymentFactIfNew(
    input: Parameters<FinanceRepository['addUtilityVendorPaymentFactIfNew']>[0]
  ) {
    const existing = this.utilityVendorPaymentFacts.find(
      (fact) => 'idempotencyKey' in fact && fact.idempotencyKey === input.idempotencyKey
    )
    if (existing) {
      return null
    }

    const fact = {
      id: `utility-vendor-${this.utilityVendorPaymentFacts.length + 1}`,
      cycleId: input.cycleId,
      planId: input.planId ?? null,
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
      createdAt: input.recordedAt,
      idempotencyKey: input.idempotencyKey
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
    return this.paymentPurchaseAllocations
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
  | 'getHouseholdBillingSettings'
  | 'listHouseholdMembers'
  | 'listHouseholdMemberPresenceDays'
  | 'listHouseholdUtilityCategories'
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
      preferredUtilityPayerMemberId: null,
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
  async listHouseholdMemberPresenceDays(householdId) {
    return financeRepositoryForHousehold(householdId).memberPresenceDays.map((entry) => ({
      householdId,
      memberId: entry.memberId,
      period: entry.period,
      daysPresent: entry.daysPresent
    }))
  },
  async listHouseholdUtilityCategories(householdId) {
    return financeRepositoryForHousehold(householdId).utilityCategories.map((category) => ({
      householdId,
      id: category.id,
      slug: category.slug,
      name: category.name,
      sortOrder: category.sortOrder,
      isActive: category.isActive,
      providerName: category.providerName ?? null,
      customerNumber: category.customerNumber ?? null,
      paymentLink: category.paymentLink ?? null,
      note: category.note ?? null
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

function seedPurchaseMutationFixture(repository: FinanceRepositoryStub) {
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
  repository.purchases = [
    {
      id: 'purchase-1',
      cycleId: 'cycle-2026-03',
      cyclePeriod: '2026-03',
      payerMemberId: 'alice',
      amountMinor: 3000n,
      currency: 'GEL',
      description: 'Kitchen towels',
      occurredAt: instantFromIso('2026-03-12T11:00:00.000Z'),
      splitMode: 'equal',
      participants: []
    }
  ]
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

  test('addUtilityBill invalidates an existing utility plan for the active cycle', async () => {
    const repository = new FinanceRepositoryStub()
    const currentPeriod = expectedCurrentCyclePeriod('Asia/Tbilisi', 20)
    repository.openCycleRecord = {
      id: 'cycle-current',
      period: currentPeriod,
      currency: 'GEL'
    }
    repository.latestCycleRecord = repository.openCycleRecord
    repository.cycles = [repository.openCycleRecord]
    repository.utilityBillingPlans = [
      {
        cycleId: 'cycle-current',
        version: 1,
        status: 'active',
        dueDate: `${currentPeriod}-04`,
        currency: 'GEL',
        maxCategoriesPerMemberApplied: 0,
        updatedFromPlanId: null,
        reason: null,
        payload: {
          categories: [],
          purchaseIds: [],
          memberSummaries: [],
          fairShareByMember: []
        }
      }
    ]

    const service = createService(repository)
    await service.addUtilityBill('Electricity', '55.20', 'member-1')

    expect(repository.utilityBillingPlans.map((plan) => plan.status)).toEqual(['superseded'])
  })

  test('addUtilityBill invalidates an empty settled utility plan for the active cycle', async () => {
    const repository = new FinanceRepositoryStub()
    const currentPeriod = expectedCurrentCyclePeriod('Asia/Tbilisi', 20)
    repository.openCycleRecord = {
      id: 'cycle-current',
      period: currentPeriod,
      currency: 'GEL'
    }
    repository.latestCycleRecord = repository.openCycleRecord
    repository.cycles = [repository.openCycleRecord]
    repository.utilityBillingPlans = [
      {
        cycleId: 'cycle-current',
        version: 1,
        status: 'settled',
        dueDate: `${currentPeriod}-04`,
        currency: 'GEL',
        maxCategoriesPerMemberApplied: 0,
        updatedFromPlanId: null,
        reason: null,
        payload: {
          categories: [],
          purchaseIds: [],
          memberSummaries: [],
          fairShareByMember: []
        }
      }
    ]

    const service = createService(repository)
    await service.addUtilityBill('Electricity', '55.20', 'member-1')

    expect(repository.utilityBillingPlans.map((plan) => plan.status)).toEqual(['superseded'])
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

  test('generateDashboard marks current-cycle purchases separately from unresolved carryover', async () => {
    const repository = new FinanceRepositoryStub()
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
    repository.openCycleRecord = {
      id: 'cycle-2026-03',
      period: '2026-03',
      currency: 'GEL'
    }
    repository.latestCycleRecord = repository.openCycleRecord
    repository.cycles = [repository.openCycleRecord]
    repository.purchases = [
      {
        id: 'purchase-current',
        cycleId: 'cycle-2026-03',
        cyclePeriod: '2026-03',
        payerMemberId: 'alice',
        amountMinor: 2000n,
        currency: 'GEL',
        description: 'Current filters',
        occurredAt: instantFromIso('2026-03-12T11:00:00.000Z'),
        splitMode: 'equal'
      },
      {
        id: 'purchase-prior-open',
        cycleId: 'cycle-2026-02',
        cyclePeriod: '2026-02',
        payerMemberId: 'alice',
        amountMinor: 3000n,
        currency: 'GEL',
        description: 'Prior gas refill',
        occurredAt: instantFromIso('2026-02-12T11:00:00.000Z'),
        splitMode: 'equal'
      },
      {
        id: 'purchase-prior-resolved',
        cycleId: 'cycle-2026-02',
        cyclePeriod: '2026-02',
        payerMemberId: 'alice',
        amountMinor: 1000n,
        currency: 'GEL',
        description: 'Prior closed supplies',
        occurredAt: instantFromIso('2026-02-10T11:00:00.000Z'),
        splitMode: 'equal'
      }
    ]
    repository.paymentPurchaseAllocations = [
      {
        id: 'allocation-prior-resolved',
        paymentRecordId: 'payment-1',
        purchaseId: 'purchase-prior-resolved',
        memberId: 'bob',
        amountMinor: 500n,
        resolutionCycleId: 'cycle-2026-03',
        resolutionMethod: 'manual',
        resolutionPlanId: null,
        recordedAt: instantFromIso('2026-03-08T10:00:00.000Z')
      }
    ]

    const service = createService(repository)
    const dashboard = await service.generateDashboard('2026-03')
    const purchaseRows = new Map(
      dashboard?.ledger
        .filter((entry) => entry.kind === 'purchase')
        .map((entry) => [entry.id, entry]) ?? []
    )

    expect(purchaseRows.get('purchase-current')?.isCurrentCyclePurchase).toBe(true)
    expect(purchaseRows.get('purchase-current')?.resolutionStatus).toBe('unresolved')
    expect(purchaseRows.get('purchase-prior-open')?.isCurrentCyclePurchase).toBe(false)
    expect(purchaseRows.get('purchase-prior-open')?.resolutionStatus).toBe('unresolved')
    expect(purchaseRows.get('purchase-prior-resolved')?.isCurrentCyclePurchase).toBe(false)
    expect(purchaseRows.get('purchase-prior-resolved')?.resolutionStatus).toBe('resolved')
  })

  test('generateDashboard defaults utility days by status and prefers saved presence-day overrides', async () => {
    const repository = new FinanceRepositoryStub()
    repository.members = [
      {
        id: 'member-active',
        telegramUserId: '1',
        displayName: 'Active',
        rentShareWeight: 1,
        isAdmin: false
      },
      {
        id: 'member-away',
        telegramUserId: '2',
        displayName: 'Away',
        rentShareWeight: 1,
        isAdmin: false
      }
    ]
    repository.memberStatuses = new Map([
      ['member-active', 'active'],
      ['member-away', 'away']
    ])
    repository.cycleByPeriodRecord = {
      id: 'cycle-2026-03',
      period: '2026-03',
      currency: 'GEL'
    }
    repository.latestCycleRecord = repository.cycleByPeriodRecord!
    repository.cycles = [repository.cycleByPeriodRecord!]
    repository.rentRule = {
      amountMinor: 70000n,
      currency: 'USD'
    }
    repository.memberPresenceDays = [
      {
        memberId: 'member-away',
        period: '2026-03',
        daysPresent: 5
      }
    ]

    const service = createService(repository)

    const dashboard = await service.generateDashboard('2026-03')

    expect(
      dashboard?.members.find((member) => member.memberId === 'member-active')?.daysPresent
    ).toBe(31)
    expect(
      dashboard?.members.find((member) => member.memberId === 'member-away')?.daysPresent
    ).toBe(5)
  })

  test('generateDashboard excludes away members from default utility and purchase splits', async () => {
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
      { memberId: 'alice', utility: 6000n, purchaseOffset: -1500n },
      { memberId: 'bob', utility: 6000n, purchaseOffset: 1500n },
      { memberId: 'carol', utility: 0n, purchaseOffset: 0n }
    ])
  })

  test('updatePurchase persists explicit participant splits', async () => {
    const repository = new FinanceRepositoryStub()
    seedPurchaseMutationFixture(repository)
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

  test('updatePurchase allows excluded participants without explicit custom amounts', async () => {
    const repository = new FinanceRepositoryStub()
    seedPurchaseMutationFixture(repository)
    const service = createService(repository)

    const result = await service.updatePurchase('purchase-1', 'Kitchen towels', '30.00', 'GEL', {
      mode: 'custom_amounts',
      participants: [
        {
          memberId: 'alice',
          included: true,
          shareAmountMajor: '20.00'
        },
        {
          memberId: 'bob',
          included: false
        },
        {
          memberId: 'carol',
          included: true,
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
          included: false,
          shareAmountMinor: null
        },
        {
          memberId: 'carol',
          included: true,
          shareAmountMinor: 1000n
        }
      ]
    })
  })

  test('updatePurchase persists the edited occurred date', async () => {
    const repository = new FinanceRepositoryStub()
    seedPurchaseMutationFixture(repository)
    const service = createService(repository)

    await service.updatePurchase(
      'purchase-1',
      'Kitchen towels',
      '30.00',
      'GEL',
      undefined,
      undefined,
      '2026-03-14'
    )

    expect(repository.lastUpdatedPurchaseInput?.occurredAt?.toString()).toBe('2026-03-14T08:00:00Z')
  })

  test('updatePurchase rejects implicit amount changes for existing custom splits', async () => {
    const repository = new FinanceRepositoryStub()
    seedPurchaseMutationFixture(repository)
    repository.purchases = repository.purchases.map((purchase) => ({
      ...purchase,
      splitMode: 'custom_amounts' as const,
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
    }))
    const service = createService(repository)

    await expect(
      service.updatePurchase('purchase-1', 'Kitchen towels', '31.00', 'GEL')
    ).rejects.toThrow('Purchase custom split must be resubmitted when changing amount or currency')
    expect(repository.lastUpdatedPurchaseInput).toBeNull()
  })

  test('purchase mutations reject non-active or out-of-household split actors', async () => {
    const inactivePayerRepository = new FinanceRepositoryStub()
    seedPurchaseMutationFixture(inactivePayerRepository)
    inactivePayerRepository.openCycleRecord = {
      id: 'cycle-2026-03',
      period: '2026-03',
      currency: 'GEL'
    }
    inactivePayerRepository.memberStatuses.set('alice', 'away')
    const inactivePayerService = createService(inactivePayerRepository)

    await expect(
      inactivePayerService.addPurchase('Snacks', '10.00', 'alice', 'GEL')
    ).rejects.toThrow('Purchase payer must be an active household member')
    expect(inactivePayerRepository.lastAddedPurchaseInput).toBeNull()

    const outsiderRepository = new FinanceRepositoryStub()
    seedPurchaseMutationFixture(outsiderRepository)
    const outsiderService = createService(outsiderRepository)

    await expect(
      outsiderService.updatePurchase('purchase-1', 'Snacks', '10.00', 'GEL', {
        mode: 'equal',
        participants: [
          { memberId: 'alice', included: true },
          { memberId: 'mallory', included: true }
        ]
      })
    ).rejects.toThrow('Purchase participant is not a household member: mallory')
    expect(outsiderRepository.lastUpdatedPurchaseInput).toBeNull()
  })

  test('purchase mutations reject ambiguous or impossible custom splits', async () => {
    const duplicateRepository = new FinanceRepositoryStub()
    seedPurchaseMutationFixture(duplicateRepository)
    const duplicateService = createService(duplicateRepository)

    await expect(
      duplicateService.updatePurchase('purchase-1', 'Snacks', '30.00', 'GEL', {
        mode: 'custom_amounts',
        participants: [
          { memberId: 'alice', shareAmountMajor: '20.00' },
          { memberId: 'alice', shareAmountMajor: '10.00' }
        ]
      })
    ).rejects.toThrow('Purchase split contains duplicate participant: alice')
    expect(duplicateRepository.lastUpdatedPurchaseInput).toBeNull()

    const negativeShareRepository = new FinanceRepositoryStub()
    seedPurchaseMutationFixture(negativeShareRepository)
    const negativeShareService = createService(negativeShareRepository)

    await expect(
      negativeShareService.updatePurchase('purchase-1', 'Snacks', '30.00', 'GEL', {
        mode: 'custom_amounts',
        participants: [
          { memberId: 'alice', shareAmountMajor: '40.00' },
          { memberId: 'bob', shareAmountMajor: '-10.00' }
        ]
      })
    ).rejects.toThrow('Purchase custom split shares must be positive')
    expect(negativeShareRepository.lastUpdatedPurchaseInput).toBeNull()

    const emptyRepository = new FinanceRepositoryStub()
    seedPurchaseMutationFixture(emptyRepository)
    const emptyService = createService(emptyRepository)

    await expect(
      emptyService.updatePurchase('purchase-1', 'Snacks', '30.00', 'GEL', {
        mode: 'equal',
        participants: [
          { memberId: 'alice', included: false },
          { memberId: 'bob', included: false }
        ]
      })
    ).rejects.toThrow('Purchase split must include at least one active participant')
    expect(emptyRepository.lastUpdatedPurchaseInput).toBeNull()

    const invalidModeRepository = new FinanceRepositoryStub()
    seedPurchaseMutationFixture(invalidModeRepository)
    const invalidModeService = createService(invalidModeRepository)
    const invalidModeSplit = {
      mode: 'weighted',
      participants: [{ memberId: 'alice', included: true }]
    } as unknown as Parameters<typeof invalidModeService.updatePurchase>[4]

    await expect(
      invalidModeService.updatePurchase('purchase-1', 'Snacks', '30.00', 'GEL', invalidModeSplit)
    ).rejects.toThrow('Purchase split mode is not supported')
    expect(invalidModeRepository.lastUpdatedPurchaseInput).toBeNull()
  })

  test('purchase mutations reject non-positive purchase amounts before persistence', async () => {
    const repository = new FinanceRepositoryStub()
    seedPurchaseMutationFixture(repository)
    repository.openCycleRecord = {
      id: 'cycle-2026-03',
      period: '2026-03',
      currency: 'GEL'
    }
    const service = createService(repository)

    await expect(service.addPurchase('Free sample', '0.00', 'alice', 'GEL')).rejects.toThrow(
      'Purchase amount must be positive'
    )
    await expect(service.updatePurchase('purchase-1', 'Refund', '-1.00', 'GEL')).rejects.toThrow(
      'Purchase amount must be positive'
    )
    expect(repository.lastAddedPurchaseInput).toBeNull()
    expect(repository.lastUpdatedPurchaseInput).toBeNull()
  })

  test('purchase mutations supersede the current utility plan and regenerate it from latest purchases', async () => {
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
      }
    ]
    repository.purchases = [
      {
        id: 'purchase-1',
        cycleId: 'cycle-2026-04',
        cyclePeriod: '2026-04',
        payerMemberId: 'alice',
        amountMinor: 2000n,
        currency: 'GEL',
        description: 'Soap',
        occurredAt: instantFromIso('2026-04-01T10:00:00.000Z'),
        splitMode: 'equal',
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
    const initialDashboard = await service.generateDashboard('2026-04')

    expect(initialDashboard?.utilityBillingPlan?.version).toBe(1)
    expect(repository.utilityBillingPlans.map((plan) => plan.status)).toEqual(['active'])

    await service.updatePurchase(
      'purchase-1',
      'Soap',
      '40.00',
      'GEL',
      {
        mode: 'equal',
        participants: [
          { memberId: 'alice', included: true },
          { memberId: 'bob', included: true }
        ]
      },
      'alice',
      '2026-04-01'
    )

    expect(repository.utilityBillingPlans.map((plan) => plan.status)).toEqual(['superseded'])

    const refreshedDashboard = await service.generateDashboard('2026-04')

    expect(refreshedDashboard?.utilityBillingPlan?.version).toBe(2)
    expect(repository.utilityBillingPlans.map((plan) => plan.status)).toEqual([
      'superseded',
      'active'
    ])
  })

  test('generateDashboard regenerates the utility plan when the preferred utility payer changes', async () => {
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
        amountMinor: 5000n,
        currency: 'GEL',
        createdByMemberId: 'alice',
        createdAt: instantFromIso('2026-04-01T09:00:00.000Z')
      },
      {
        id: 'bill-gas',
        billName: 'Gas',
        amountMinor: 5000n,
        currency: 'GEL',
        createdByMemberId: 'alice',
        createdAt: instantFromIso('2026-04-01T09:05:00.000Z')
      }
    ]

    const service = createService(repository)
    const initialDashboard = await service.generateDashboard('2026-04')

    expect(initialDashboard?.utilityBillingPlan?.version).toBe(1)
    expect(repository.utilityBillingPlans[0]?.payload.preferredUtilityPayerMemberId).toBeNull()

    repository.billingSettingsOverride = {
      preferredUtilityPayerMemberId: 'bob'
    }

    const refreshedDashboard = await service.generateDashboard('2026-04')

    expect(refreshedDashboard?.utilityBillingPlan?.version).toBe(2)
    expect(repository.utilityBillingPlans.map((plan) => plan.status)).toEqual([
      'superseded',
      'active'
    ])
    expect(repository.utilityBillingPlans[1]?.payload.preferredUtilityPayerMemberId).toBe('bob')
  })

  test('generateCurrentBillPlan exposes compact purchase drivers for utility adjustments', async () => {
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
    repository.purchases = [
      {
        id: 'purchase-groceries',
        cycleId: 'cycle-2026-04',
        cyclePeriod: '2026-04',
        payerMemberId: 'alice',
        amountMinor: 9000n,
        currency: 'GEL',
        description: 'Groceries',
        occurredAt: instantFromIso('2026-04-02T10:00:00.000Z'),
        splitMode: 'equal'
      }
    ]

    const service = createService(repository)
    const plan = await service.generateCurrentBillPlan('2026-04')

    expect(
      plan?.members?.map((member) => ({
        memberId: member.memberId,
        drivers: member.purchaseDrivers.map((driver) => ({
          title: driver.title,
          direction: driver.direction,
          amountMinor: driver.amount.amountMinor
        }))
      }))
    ).toEqual([
      {
        memberId: 'alice',
        drivers: [
          {
            title: 'Groceries',
            direction: 'credit',
            amountMinor: 4500n
          }
        ]
      },
      {
        memberId: 'bob',
        drivers: []
      }
    ])
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

  test('generateDashboard zeroes purchase offsets for fully resolved current-cycle purchases', async () => {
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
    repository.purchases = [
      {
        id: 'purchase-1',
        cycleId: 'cycle-2026-04',
        cyclePeriod: '2026-04',
        payerMemberId: 'alice',
        amountMinor: 3000n,
        currency: 'GEL',
        description: 'Soap',
        occurredAt: instantFromIso('2026-04-07T11:00:00.000Z'),
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
    repository.paymentPurchaseAllocations = [
      {
        id: 'allocation-1',
        paymentRecordId: 'payment-1',
        purchaseId: 'purchase-1',
        memberId: 'bob',
        amountMinor: 1500n,
        resolutionCycleId: 'cycle-2026-04',
        resolutionMethod: 'manual',
        resolutionPlanId: null,
        recordedAt: instantFromIso('2026-04-08T10:00:00.000Z')
      }
    ]

    const service = createService(repository)
    const dashboard = await service.generateDashboard('2026-04')
    const purchaseEntry = dashboard?.ledger.find((entry) => entry.id === 'purchase-1')

    expect(purchaseEntry?.resolutionStatus).toBe('resolved')
    expect(purchaseEntry?.outstandingByMember).toEqual([])
    expect(
      dashboard?.members.map((member) => ({
        memberId: member.memberId,
        purchaseOffset: member.purchaseOffset.amountMinor
      }))
    ).toEqual([
      { memberId: 'alice', purchaseOffset: 0n },
      { memberId: 'bob', purchaseOffset: 0n }
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
      cycleId: 'cycle-2026-04',
      resolutionMethod: 'utilities_plan',
      resolutionPlanId: 'utility-plan-1',
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

  test('closePaymentPeriod records planned remaining rent for unresolved members', async () => {
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
      amountMinor: 10000n,
      currency: 'GEL'
    }
    repository.paymentRecords = [
      {
        id: 'payment-1',
        cycleId: 'cycle-2026-03',
        cyclePeriod: '2026-03',
        memberId: 'alice',
        kind: 'rent',
        amountMinor: 5000n,
        currency: 'GEL',
        recordedAt: instantFromIso('2026-03-18T12:00:00.000Z')
      }
    ]

    const service = createService(repository)
    const result = await service.closePaymentPeriod({
      periodArg: '2026-03',
      kind: 'rent',
      actorMemberId: 'alice',
      allMembers: true
    })

    expect(result?.closedMembers).toEqual([
      {
        memberId: 'bob',
        displayName: 'Bob',
        amount: Money.fromMajor('50.00', 'GEL')
      }
    ])
    expect(repository.addedPaymentRecords).toMatchObject([
      {
        cycleId: 'cycle-2026-03',
        memberId: 'bob',
        kind: 'rent',
        amountMinor: 5000n,
        currency: 'GEL'
      }
    ])
  })

  test('closePaymentPeriod is idempotent for repeated rent closes before payment records refresh', async () => {
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
      amountMinor: 10000n,
      currency: 'GEL'
    }

    const service = createService(repository)
    const first = await service.closePaymentPeriod({
      periodArg: '2026-03',
      kind: 'rent',
      actorMemberId: 'alice',
      memberIds: ['alice']
    })
    const second = await service.closePaymentPeriod({
      periodArg: '2026-03',
      kind: 'rent',
      actorMemberId: 'alice',
      memberIds: ['alice']
    })

    expect(first?.closedMembers).toHaveLength(1)
    expect(second?.closedMembers).toEqual([])
    expect(second?.skippedMembers).toEqual([
      {
        memberId: 'alice',
        displayName: 'Alice',
        reason: 'already_settled'
      }
    ])
    expect(repository.addedPaymentRecords).toHaveLength(1)
    expect(repository.addedPaymentRecords[0]?.idempotencyKey).toBe(
      'close-payment-period:household-1:cycle-2026-03:rent:alice'
    )
  })

  test('closePaymentPeriod is idempotent for repeated utilities closes before records refresh', async () => {
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
      id: 'cycle-2026-04',
      period: '2026-04',
      currency: 'GEL'
    }
    repository.latestCycleRecord = repository.openCycleRecord
    repository.cycles = [repository.openCycleRecord]
    repository.rentRule = { amountMinor: 10000n, currency: 'GEL' }
    repository.utilityBills = [
      {
        id: 'bill-gas',
        cycleId: 'cycle-2026-04',
        billName: 'Gas',
        amountMinor: 20000n,
        currency: 'GEL',
        createdByMemberId: 'alice',
        createdAt: instantFromIso('2026-04-01T09:00:00.000Z')
      }
    ]

    const service = createService(repository)
    const first = await service.closePaymentPeriod({
      periodArg: '2026-04',
      kind: 'utilities',
      actorMemberId: 'alice',
      memberIds: ['alice']
    })
    const second = await service.closePaymentPeriod({
      periodArg: '2026-04',
      kind: 'utilities',
      actorMemberId: 'alice',
      memberIds: ['alice']
    })

    expect(first?.closedMembers).toHaveLength(1)
    expect(second?.closedMembers).toEqual([])
    expect(repository.utilityVendorPaymentFacts).toHaveLength(1)
    expect(repository.addedPaymentRecords).toHaveLength(1)
    expect(repository.utilityVendorPaymentFacts[0]).toMatchObject({
      utilityBillId: 'bill-gas',
      payerMemberId: 'alice',
      matchedPlan: true
    })
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

  test('generateBillingAuditExport returns json-safe audit data with descriptions', async () => {
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
    repository.utilityCategories = [
      {
        id: 'cat-1',
        slug: 'gas',
        name: 'Gas',
        sortOrder: 1,
        isActive: true,
        providerName: 'Tbilisi Gas',
        customerNumber: 'ACC-1'
      },
      {
        id: 'cat-2',
        slug: 'internet',
        name: 'Internet',
        sortOrder: 2,
        isActive: true
      }
    ]
    repository.utilityBills = [
      {
        id: 'bill-gas',
        billName: 'Gas',
        amountMinor: 10000n,
        currency: 'GEL',
        createdByMemberId: 'alice',
        createdAt: instantFromIso('2026-03-01T09:00:00.000Z')
      }
    ]

    const service = createService(repository)
    const audit = await service.generateBillingAuditExport('2026-03')

    expect(audit?.meta.adjustmentPolicy).toBe('rent')
    expect(audit?.descriptions.adjustmentPolicies.separate).toContain('Manual mode')
    expect(audit?.descriptions.snapshotSemantics.settlementSnapshotLines).toContain(
      'frozen historical'
    )
    expect(audit?.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'ACTIVE_UTILITY_CATEGORY_WITHOUT_BILL',
          severity: 'warning'
        }),
        expect.objectContaining({
          code: 'RENT_MODE_DEFERS_BALANCE_ADJUSTMENT_TO_RENT',
          severity: 'info'
        })
      ])
    )
    expect(audit?.settings.utilityCategories[0]).toEqual(
      expect.objectContaining({
        name: 'Gas',
        providerName: 'Tbilisi Gas',
        customerNumber: 'ACC-1'
      })
    )
    expect(audit?.rawInputs.utilityBills[0]?.amount).toEqual(
      expect.objectContaining({
        amountMinor: '10000',
        amountMajor: '100.00',
        currency: 'GEL',
        display: '100.00 ₾'
      })
    )
    expect(audit?.rawInputs.settlementSnapshot).toEqual(
      expect.objectContaining({
        isFrozenHistoricalSnapshot: true
      })
    )
    expect(audit?.utilityPlan.fieldSemantics.planPayloadFairShareByMember).toContain(
      'fair-share input passed into that plan version'
    )
    expect(audit?.utilityPlan.explanation).toContain('deferred to rent')
    expect(audit?.dashboard.snapshot).toEqual(
      expect.objectContaining({
        period: '2026-03',
        rentSourceAmount: expect.objectContaining({
          currency: 'USD'
        })
      })
    )
    expect(() => JSON.stringify(audit)).not.toThrow()
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

  test('resolveUtilityBillAsPlanned shows correct vendorPaid and projectedDelta on dashboard', async () => {
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
    repository.rentRule = { amountMinor: 70000n, currency: 'USD' }
    repository.memberPresenceDays = [
      { memberId: 'alice', period: '2026-04', daysPresent: 30 },
      { memberId: 'bob', period: '2026-04', daysPresent: 30 }
    ]
    repository.utilityBills = [
      {
        id: 'bill-gas',
        cycleId: 'cycle-2026-04',
        billName: 'Gas',
        amountMinor: 20000n,
        currency: 'GEL',
        createdByMemberId: 'alice',
        createdAt: instantFromIso('2026-04-01T09:00:00.000Z')
      }
    ]

    const service = createService(repository)

    // Materialize initial plan
    const initialDashboard = await service.generateDashboard('2026-04')
    expect(initialDashboard?.utilityBillingPlan?.version).toBe(1)
    expect(
      initialDashboard?.utilityBillingPlan?.memberSummaries.every(
        (s) => s.projectedDeltaAfterPlan.amountMinor === 0n
      )
    ).toBe(true)

    // Resolve alice's planned bills
    const result = await service.resolveUtilityBillAsPlanned({
      memberId: 'alice',
      periodArg: '2026-04'
    })
    expect(result).not.toBeNull()
    expect(result?.resolvedBillIds).toContain('bill-gas')
    expect(result?.resolvedAssignments).toContainEqual(
      expect.objectContaining({
        memberId: 'alice',
        displayName: 'Alice',
        utilityBillId: 'bill-gas',
        billName: 'Gas',
        amount: expect.objectContaining({ amountMinor: 10000n })
      })
    )

    // Verify vendor facts created with matchedPlan
    expect(repository.utilityVendorPaymentFacts.length).toBeGreaterThan(0)
    expect(repository.utilityVendorPaymentFacts.every((f) => f.matchedPlan)).toBe(true)
    expect(repository.utilityVendorPaymentFacts.every((f) => f.payerMemberId === 'alice')).toBe(
      true
    )

    // Verify payment record created
    expect(repository.addedPaymentRecords).toHaveLength(1)
    expect(repository.addedPaymentRecords[0]).toMatchObject({
      memberId: 'alice',
      kind: 'utilities'
    })

    // Bridge stub gap: make payment records visible to listPaymentRecordsForCycle
    repository.paymentRecords = repository.addedPaymentRecords.map((r, i) => ({
      id: `payment-record-${i + 1}`,
      cycleId: r.cycleId,
      cyclePeriod: '2026-04',
      memberId: r.memberId,
      kind: r.kind,
      amountMinor: r.amountMinor,
      currency: r.currency,
      recordedAt: r.recordedAt
    }))

    // Generate dashboard after resolve
    const afterDashboard = await service.generateDashboard('2026-04')
    const summaries = afterDashboard?.utilityBillingPlan?.memberSummaries ?? []
    const aliceSummary = summaries.find((s) => s.memberId === 'alice')
    const bobSummary = summaries.find((s) => s.memberId === 'bob')

    // Alice: already paid her share, assigned remaining should be 0
    expect(aliceSummary?.vendorPaid.amountMinor).toBe(
      repository.addedPaymentRecords[0]!.amountMinor
    )
    expect(aliceSummary?.assignedThisCycle.amountMinor).toBe(0n)
    expect(aliceSummary?.projectedDeltaAfterPlan.amountMinor).toBe(0n)

    // Bob: hasn't paid, assigned should still be his full share
    expect(bobSummary?.vendorPaid.amountMinor).toBe(0n)
    expect(bobSummary?.assignedThisCycle.amountMinor).toBeGreaterThan(0n)
    expect(bobSummary?.projectedDeltaAfterPlan.amountMinor).toBe(0n)

    // Plan version should not have changed (on-plan payment doesn't rebalance)
    expect(afterDashboard?.utilityBillingPlan?.version).toBe(1)

    // Plan should NOT be settled yet (bob hasn't resolved)
    expect(afterDashboard?.utilityBillingPlan?.status).toBe('active')

    // Now resolve bob too
    await service.resolveUtilityBillAsPlanned({
      memberId: 'bob',
      periodArg: '2026-04'
    })

    // Bridge bob's payment record
    repository.paymentRecords = repository.addedPaymentRecords.map((r, i) => ({
      id: `payment-record-${i + 1}`,
      cycleId: r.cycleId,
      cyclePeriod: '2026-04',
      memberId: r.memberId,
      kind: r.kind,
      amountMinor: r.amountMinor,
      currency: r.currency,
      recordedAt: r.recordedAt
    }))

    const settledDashboard = await service.generateDashboard('2026-04')

    // Plan should now be settled since all members resolved
    expect(settledDashboard?.utilityBillingPlan?.status).toBe('settled')

    // Both members should show 0 remaining assignment
    const settledSummaries = settledDashboard?.utilityBillingPlan?.memberSummaries ?? []
    expect(settledSummaries.every((s) => s.assignedThisCycle.amountMinor === 0n)).toBe(true)
    expect(settledSummaries.every((s) => s.projectedDeltaAfterPlan.amountMinor === 0n)).toBe(true)
  })

  test('resolveUtilityBillAsPlanned is idempotent after the member already paid planned utilities', async () => {
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
    repository.rentRule = { amountMinor: 70000n, currency: 'USD' }
    repository.memberPresenceDays = [
      { memberId: 'alice', period: '2026-04', daysPresent: 30 },
      { memberId: 'bob', period: '2026-04', daysPresent: 30 }
    ]
    repository.utilityBills = [
      {
        id: 'bill-gas',
        cycleId: 'cycle-2026-04',
        billName: 'Gas',
        amountMinor: 20000n,
        currency: 'GEL',
        createdByMemberId: 'alice',
        createdAt: instantFromIso('2026-04-01T09:00:00.000Z')
      }
    ]

    const service = createService(repository)
    const initialDashboard = await service.generateDashboard('2026-04')
    const aliceAssignedMinor =
      initialDashboard?.utilityBillingPlan?.categories
        .filter((category) => category.assignedMemberId === 'alice')
        .reduce((sum, category) => sum + category.assignedAmount.amountMinor, 0n) ?? 0n

    const secondResult = await service.resolveUtilityBillAsPlanned({
      memberId: 'alice',
      periodArg: '2026-04'
    })
    repository.paymentRecords = repository.addedPaymentRecords.map((r, i) => ({
      id: `payment-record-${i + 1}`,
      cycleId: r.cycleId,
      cyclePeriod: '2026-04',
      memberId: r.memberId,
      kind: r.kind,
      amountMinor: r.amountMinor,
      currency: r.currency,
      recordedAt: r.recordedAt
    }))
    await service.resolveUtilityBillAsPlanned({
      memberId: 'alice',
      periodArg: '2026-04'
    })

    expect(repository.utilityVendorPaymentFacts).toHaveLength(1)
    expect(repository.utilityVendorPaymentFacts[0]).toMatchObject({
      utilityBillId: 'bill-gas',
      payerMemberId: 'alice',
      amountMinor: aliceAssignedMinor,
      matchedPlan: true
    })
    expect(repository.addedPaymentRecords).toHaveLength(1)
    expect(repository.utilityBillingPlans).toHaveLength(1)
    expect(
      secondResult?.plan?.categories.find((category) => category.assignedMemberId === 'alice')
        ?.paidAmount.amountMinor
    ).toBe(aliceAssignedMinor)
  })

  test('resolveUtilityBillAsPlanned repairs a missing utility payment record from matched plan facts', async () => {
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
    repository.rentRule = { amountMinor: 70000n, currency: 'USD' }
    repository.memberPresenceDays = [
      { memberId: 'alice', period: '2026-04', daysPresent: 30 },
      { memberId: 'bob', period: '2026-04', daysPresent: 30 }
    ]
    repository.utilityBills = [
      {
        id: 'bill-gas',
        cycleId: 'cycle-2026-04',
        billName: 'Gas',
        amountMinor: 20000n,
        currency: 'GEL',
        createdByMemberId: 'alice',
        createdAt: instantFromIso('2026-04-01T09:00:00.000Z')
      }
    ]

    const service = createService(repository)
    const initialDashboard = await service.generateDashboard('2026-04')
    const aliceAssignedMinor =
      initialDashboard?.utilityBillingPlan?.categories
        .filter((category) => category.assignedMemberId === 'alice')
        .reduce((sum, category) => sum + category.assignedAmount.amountMinor, 0n) ?? 0n

    repository.utilityVendorPaymentFacts = [
      {
        id: 'fact-1',
        cycleId: 'cycle-2026-04',
        utilityBillId: 'bill-gas',
        billName: 'Gas',
        payerMemberId: 'alice',
        amountMinor: aliceAssignedMinor,
        currency: 'GEL',
        plannedForMemberId: 'alice',
        planVersion: 1,
        matchedPlan: true,
        recordedByMemberId: 'alice',
        recordedAt: instantFromIso('2026-04-03T09:00:00.000Z'),
        createdAt: instantFromIso('2026-04-03T09:00:00.000Z')
      }
    ]

    const result = await service.resolveUtilityBillAsPlanned({
      memberId: 'alice',
      periodArg: '2026-04'
    })

    expect(repository.utilityVendorPaymentFacts).toHaveLength(1)
    expect(repository.addedPaymentRecords).toHaveLength(1)
    expect(repository.addedPaymentRecords[0]).toMatchObject({
      memberId: 'alice',
      kind: 'utilities',
      amountMinor: aliceAssignedMinor
    })
    expect(repository.utilityBillingPlans).toHaveLength(1)
    expect(result?.plan?.version).toBe(1)
  })

  test('resolveUtilityBillAsPlanned repairs purchase allocations for an existing planned payment', async () => {
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
    repository.rentRule = { amountMinor: 70000n, currency: 'USD' }
    repository.billingSettingsOverride = {
      paymentBalanceAdjustmentPolicy: 'utilities',
      preferredUtilityPayerMemberId: 'alice'
    }
    repository.memberPresenceDays = [
      { memberId: 'alice', period: '2026-04', daysPresent: 30 },
      { memberId: 'bob', period: '2026-04', daysPresent: 30 }
    ]
    repository.utilityBills = [
      {
        id: 'bill-gas',
        cycleId: 'cycle-2026-04',
        billName: 'Gas',
        amountMinor: 20000n,
        currency: 'GEL',
        createdByMemberId: 'alice',
        createdAt: instantFromIso('2026-04-01T09:00:00.000Z')
      }
    ]
    repository.purchases = [
      {
        id: 'purchase-alice',
        cycleId: 'cycle-2026-04',
        cyclePeriod: '2026-04',
        payerMemberId: 'alice',
        amountMinor: 6000n,
        currency: 'GEL',
        description: 'Alice supplies',
        occurredAt: instantFromIso('2026-04-02T09:00:00.000Z'),
        splitMode: 'equal'
      },
      {
        id: 'purchase-bob',
        cycleId: 'cycle-2026-04',
        cyclePeriod: '2026-04',
        payerMemberId: 'bob',
        amountMinor: 6000n,
        currency: 'GEL',
        description: 'Bob supplies',
        occurredAt: instantFromIso('2026-04-02T10:00:00.000Z'),
        splitMode: 'equal'
      }
    ]

    const service = createService(repository)
    const dashboard = await service.generateDashboard('2026-04')
    const plan = dashboard?.utilityBillingPlan
    const aliceAssignedMinor =
      plan?.categories
        .filter((category) => category.assignedMemberId === 'alice')
        .reduce((sum, category) => sum + category.assignedAmount.amountMinor, 0n) ?? 0n
    expect(aliceAssignedMinor).toBeGreaterThan(0n)

    repository.utilityVendorPaymentFacts = [
      {
        id: 'fact-1',
        cycleId: 'cycle-2026-04',
        planId: plan?.id ?? null,
        utilityBillId: 'bill-gas',
        billName: 'Gas',
        payerMemberId: 'alice',
        amountMinor: aliceAssignedMinor,
        currency: 'GEL',
        plannedForMemberId: 'alice',
        planVersion: plan?.version ?? null,
        matchedPlan: true,
        recordedByMemberId: 'alice',
        recordedAt: instantFromIso('2026-04-03T09:00:00.000Z'),
        createdAt: instantFromIso('2026-04-03T09:00:00.000Z')
      }
    ]
    repository.paymentRecords = [
      {
        id: 'payment-existing',
        cycleId: 'cycle-2026-04',
        cyclePeriod: '2026-04',
        memberId: 'alice',
        kind: 'utilities',
        amountMinor: aliceAssignedMinor,
        currency: 'GEL',
        recordedAt: instantFromIso('2026-04-03T09:05:00.000Z')
      }
    ]

    await service.resolveUtilityBillAsPlanned({
      memberId: 'alice',
      periodArg: '2026-04'
    })

    expect(repository.addedPaymentRecords).toHaveLength(0)
    expect(repository.lastReplacedPaymentPurchaseAllocations?.paymentRecordId).toBe(
      'payment-existing'
    )
    expect(repository.lastReplacedPaymentPurchaseAllocations?.allocations).toContainEqual({
      purchaseId: 'purchase-bob',
      memberId: 'alice',
      amountMinor: 3000n
    })
  })

  test('resolveUtilityBillAsPlanned can resolve the full utility plan in one idempotent action', async () => {
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
    repository.rentRule = { amountMinor: 70000n, currency: 'USD' }
    repository.billingSettingsOverride = {
      paymentBalanceAdjustmentPolicy: 'utilities',
      preferredUtilityPayerMemberId: 'alice'
    }
    repository.memberPresenceDays = [
      { memberId: 'alice', period: '2026-04', daysPresent: 30 },
      { memberId: 'bob', period: '2026-04', daysPresent: 30 }
    ]
    repository.utilityBills = [
      {
        id: 'bill-gas',
        cycleId: 'cycle-2026-04',
        billName: 'Gas',
        amountMinor: 20000n,
        currency: 'GEL',
        createdByMemberId: 'alice',
        createdAt: instantFromIso('2026-04-01T09:00:00.000Z')
      }
    ]
    repository.purchases = [
      {
        id: 'purchase-bob',
        cycleId: 'cycle-2026-04',
        cyclePeriod: '2026-04',
        payerMemberId: 'bob',
        amountMinor: 6000n,
        currency: 'GEL',
        description: 'Bob supplies',
        occurredAt: instantFromIso('2026-04-02T10:00:00.000Z'),
        splitMode: 'equal'
      }
    ]

    const service = createService(repository)
    await service.generateDashboard('2026-04')
    const result = await service.resolveUtilityBillAsPlanned({
      allMembers: true,
      actorMemberId: 'alice',
      periodArg: '2026-04'
    })
    const paymentRecordCount = repository.addedPaymentRecords.length
    const vendorFactCount = repository.utilityVendorPaymentFacts.length

    repository.paymentRecords = repository.addedPaymentRecords.map((payment, index) => ({
      id: `payment-record-${index + 1}`,
      cycleId: payment.cycleId,
      cyclePeriod: '2026-04',
      memberId: payment.memberId,
      kind: payment.kind,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      recordedAt: payment.recordedAt
    }))
    await service.resolveUtilityBillAsPlanned({
      allMembers: true,
      actorMemberId: 'alice',
      periodArg: '2026-04'
    })

    expect(result?.plan?.status).toBe('settled')
    expect(repository.addedPaymentRecords).toHaveLength(paymentRecordCount)
    expect(repository.utilityVendorPaymentFacts).toHaveLength(vendorFactCount)
    expect(
      repository.paymentPurchaseAllocations.some(
        (allocation) =>
          allocation.amountMinor === 3000n &&
          allocation.resolutionMethod === 'utilities_plan' &&
          allocation.resolutionPlanId === 'utility-plan-1'
      )
    ).toBe(true)
  })

  test('resolveUtilityBillAsPlanned full plan closes purchases for members covered by balance', async () => {
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
        id: 'stas',
        telegramUserId: '3',
        displayName: 'Stas',
        rentShareWeight: 1,
        isAdmin: false
      }
    ]
    repository.cycles = [
      { id: 'cycle-2026-04', period: '2026-04', currency: 'GEL' },
      { id: 'cycle-2026-05', period: '2026-05', currency: 'GEL' }
    ]
    repository.openCycleRecord = repository.cycles[1]!
    repository.latestCycleRecord = repository.cycles[1]!
    repository.rentRule = { amountMinor: 70000n, currency: 'USD' }
    repository.billingSettingsOverride = {
      paymentBalanceAdjustmentPolicy: 'utilities'
    }
    repository.memberPresenceDays = [
      { memberId: 'alice', period: '2026-05', daysPresent: 31 },
      { memberId: 'bob', period: '2026-05', daysPresent: 31 },
      { memberId: 'stas', period: '2026-05', daysPresent: 31 }
    ]
    repository.utilityBills = [
      {
        id: 'bill-gas',
        cycleId: 'cycle-2026-05',
        billName: 'Gas',
        amountMinor: 20000n,
        currency: 'GEL',
        createdByMemberId: 'alice',
        createdAt: instantFromIso('2026-05-01T09:00:00.000Z')
      }
    ]
    repository.purchases = [
      {
        id: 'purchase-april',
        cycleId: 'cycle-2026-04',
        cyclePeriod: '2026-04',
        payerMemberId: 'alice',
        amountMinor: 1200n,
        currency: 'GEL',
        description: 'April supplies',
        occurredAt: instantFromIso('2026-04-27T09:00:00.000Z'),
        splitMode: 'equal'
      }
    ]
    repository.utilityBillingPlans = [
      {
        cycleId: 'cycle-2026-05',
        version: 1,
        status: 'active',
        dueDate: '2026-05-04',
        currency: 'GEL',
        maxCategoriesPerMemberApplied: 3,
        updatedFromPlanId: null,
        reason: null,
        payload: {
          categories: [
            {
              utilityBillId: 'bill-gas',
              billName: 'Gas',
              billTotalMinor: '20000',
              assignedAmountMinor: '10000',
              assignedMemberId: 'alice',
              paidAmountMinor: '0',
              isFullAssignment: false,
              splitGroupId: 'bill-gas'
            },
            {
              utilityBillId: 'bill-gas',
              billName: 'Gas',
              billTotalMinor: '20000',
              assignedAmountMinor: '10000',
              assignedMemberId: 'bob',
              paidAmountMinor: '0',
              isFullAssignment: false,
              splitGroupId: 'bill-gas'
            }
          ],
          purchaseIds: [],
          memberSummaries: [
            {
              memberId: 'alice',
              fairShareMinor: '10000',
              vendorPaidMinor: '0',
              assignedThisCycleMinor: '10000',
              projectedDeltaAfterPlanMinor: '0'
            },
            {
              memberId: 'bob',
              fairShareMinor: '10000',
              vendorPaidMinor: '0',
              assignedThisCycleMinor: '10000',
              projectedDeltaAfterPlanMinor: '0'
            },
            {
              memberId: 'stas',
              fairShareMinor: '0',
              vendorPaidMinor: '0',
              assignedThisCycleMinor: '0',
              projectedDeltaAfterPlanMinor: '0'
            }
          ],
          fairShareByMember: [
            { memberId: 'alice', amountMinor: '10000' },
            { memberId: 'bob', amountMinor: '10000' },
            { memberId: 'stas', amountMinor: '0' }
          ],
          preferredUtilityPayerMemberId: null
        }
      }
    ]

    const service = createService(repository)
    await service.resolveUtilityBillAsPlanned({
      allMembers: true,
      actorMemberId: 'alice',
      periodArg: '2026-05'
    })

    expect(repository.addedPaymentRecords).toContainEqual(
      expect.objectContaining({
        memberId: 'stas',
        kind: 'utilities',
        amountMinor: 0n
      })
    )
    expect(repository.paymentPurchaseAllocations).toContainEqual(
      expect.objectContaining({
        purchaseId: 'purchase-april',
        memberId: 'stas',
        amountMinor: 400n,
        resolutionMethod: 'utilities_plan',
        resolutionPlanId: 'utility-plan-1'
      })
    )
    expect(repository.utilityBillingPlans[0]?.status).toBe('settled')
  })

  test('resolveUtilityBillAsPlanned carries excess purchase credit into the next cycle', async () => {
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
      { id: 'cycle-2026-05', period: '2026-05', currency: 'GEL' },
      { id: 'cycle-2026-06', period: '2026-06', currency: 'GEL' }
    ]
    repository.openCycleRecord = repository.cycles[0]!
    repository.latestCycleRecord = repository.cycles[0]!
    repository.rentRule = { amountMinor: 0n, currency: 'GEL' }
    repository.billingSettingsOverride = {
      paymentBalanceAdjustmentPolicy: 'utilities',
      preferredUtilityPayerMemberId: 'bob'
    }
    repository.memberPresenceDays = [
      { memberId: 'alice', period: '2026-05', daysPresent: 31 },
      { memberId: 'bob', period: '2026-05', daysPresent: 31 },
      { memberId: 'alice', period: '2026-06', daysPresent: 30 },
      { memberId: 'bob', period: '2026-06', daysPresent: 30 }
    ]
    repository.utilityBills = [
      {
        id: 'bill-may',
        cycleId: 'cycle-2026-05',
        billName: 'May utilities',
        amountMinor: 20000n,
        currency: 'GEL',
        createdByMemberId: 'alice',
        createdAt: instantFromIso('2026-05-01T09:00:00.000Z')
      },
      {
        id: 'bill-june',
        cycleId: 'cycle-2026-06',
        billName: 'June utilities',
        amountMinor: 10000n,
        currency: 'GEL',
        createdByMemberId: 'alice',
        createdAt: instantFromIso('2026-06-01T09:00:00.000Z')
      }
    ]
    repository.purchases = [
      {
        id: 'purchase-may',
        cycleId: 'cycle-2026-05',
        cyclePeriod: '2026-05',
        payerMemberId: 'alice',
        amountMinor: 30000n,
        currency: 'GEL',
        description: 'May shared supplies',
        occurredAt: instantFromIso('2026-05-02T10:00:00.000Z'),
        splitMode: 'equal'
      }
    ]

    const service = createService(repository)
    const mayDashboard = await service.generateDashboard('2026-05')
    const aliceMayPlan = mayDashboard?.utilityBillingPlan?.memberSummaries.find(
      (summary) => summary.memberId === 'alice'
    )

    expect(aliceMayPlan?.fairShare.amountMinor).toBe(0n)
    expect(mayDashboard?.utilityBillingPlan?.carryForwardCredits).toContainEqual(
      expect.objectContaining({
        memberId: 'alice',
        creditCreated: expect.objectContaining({ amountMinor: 5000n }),
        creditConsumed: expect.objectContaining({ amountMinor: 0n }),
        policyTarget: 'utilities'
      })
    )

    await service.resolveUtilityBillAsPlanned({
      allMembers: true,
      actorMemberId: 'alice',
      periodArg: '2026-05'
    })
    await service.resolveUtilityBillAsPlanned({
      allMembers: true,
      actorMemberId: 'alice',
      periodArg: '2026-05'
    })

    expect(repository.balanceLedgerEntries).toHaveLength(1)
    expect(repository.balanceLedgerEntries[0]).toEqual(
      expect.objectContaining({
        memberId: 'alice',
        sourceCyclePeriod: '2026-05',
        planId: 'utility-plan-1',
        entryType: 'credit_created',
        reason: 'excess_purchase_credit',
        amountMinor: 5000n
      })
    )
    const settledMayDashboard = await service.generateDashboard('2026-05')
    const aliceSettledLine = settledMayDashboard?.members.find(
      (member) => member.memberId === 'alice'
    )
    expect(aliceSettledLine?.purchaseOffset.amountMinor).toBe(0n)
    expect(aliceSettledLine?.carryForwardCredit?.amountMinor).toBe(5000n)
    expect(aliceSettledLine?.effectivePurchaseBalance?.amountMinor).toBe(-5000n)

    repository.openCycleRecord = repository.cycles[1]!
    repository.latestCycleRecord = repository.cycles[1]!
    const juneDashboard = await service.generateDashboard('2026-06')

    expect(
      juneDashboard?.utilityBillingPlan?.memberSummaries.map((summary) => ({
        memberId: summary.memberId,
        fairShareMinor: summary.fairShare.amountMinor
      }))
    ).toEqual([
      { memberId: 'alice', fairShareMinor: 0n },
      { memberId: 'bob', fairShareMinor: 5000n }
    ])
    expect(juneDashboard?.utilityBillingPlan?.carryForwardCredits).toContainEqual(
      expect.objectContaining({
        memberId: 'alice',
        creditConsumed: expect.objectContaining({ amountMinor: 5000n })
      })
    )

    const juneCurrentBill = await service.generateCurrentBillPlan('2026-06')
    expect(
      juneCurrentBill?.members?.find((member) => member.memberId === 'alice')?.carryForwardCredit
        ?.amountMinor
    ).toBe(5000n)
  })

  test('generateDashboard does not show overdue utilities when the current plan covered them', async () => {
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
        id: 'stas',
        telegramUserId: '2',
        displayName: 'Stas',
        rentShareWeight: 1,
        isAdmin: false
      }
    ]
    repository.openCycleRecord = {
      id: 'cycle-2026-05',
      period: '2026-05',
      currency: 'GEL'
    }
    repository.latestCycleRecord = repository.openCycleRecord
    repository.cycles = [repository.openCycleRecord]
    repository.rentRule = { amountMinor: 70000n, currency: 'USD' }
    repository.memberPresenceDays = [
      { memberId: 'alice', period: '2026-05', daysPresent: 31 },
      { memberId: 'stas', period: '2026-05', daysPresent: 31 }
    ]
    repository.utilityBills = [
      {
        id: 'bill-gas',
        cycleId: 'cycle-2026-05',
        billName: 'Gas',
        amountMinor: 20000n,
        currency: 'GEL',
        createdByMemberId: 'alice',
        createdAt: instantFromIso('2026-05-01T09:00:00.000Z')
      }
    ]
    repository.utilityBillingPlans = [
      {
        cycleId: 'cycle-2026-05',
        version: 1,
        status: 'active',
        dueDate: '2026-05-04',
        currency: 'GEL',
        maxCategoriesPerMemberApplied: 3,
        updatedFromPlanId: null,
        reason: null,
        payload: {
          categories: [
            {
              utilityBillId: 'bill-gas',
              billName: 'Gas',
              billTotalMinor: '20000',
              assignedAmountMinor: '20000',
              assignedMemberId: 'alice',
              paidAmountMinor: '0',
              isFullAssignment: true,
              splitGroupId: null
            }
          ],
          purchaseIds: [],
          memberSummaries: [
            {
              memberId: 'alice',
              fairShareMinor: '20000',
              vendorPaidMinor: '0',
              assignedThisCycleMinor: '20000',
              projectedDeltaAfterPlanMinor: '0'
            },
            {
              memberId: 'stas',
              fairShareMinor: '0',
              vendorPaidMinor: '0',
              assignedThisCycleMinor: '0',
              projectedDeltaAfterPlanMinor: '0'
            }
          ],
          fairShareByMember: [
            { memberId: 'alice', amountMinor: '20000' },
            { memberId: 'stas', amountMinor: '0' }
          ],
          preferredUtilityPayerMemberId: null
        }
      }
    ]

    const service = createService(repository)
    const dashboard = await service.generateDashboard('2026-05')
    const stas = dashboard?.members.find((member) => member.memberId === 'stas')

    expect(stas?.utilityShare.amountMinor).toBeGreaterThan(0n)
    expect(stas?.overduePayments.find((payment) => payment.kind === 'utilities')).toBeUndefined()
  })

  test('new purchases and utility bills do not replan after a planned utility payment', async () => {
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
    repository.rentRule = { amountMinor: 70000n, currency: 'USD' }
    repository.memberPresenceDays = [
      { memberId: 'alice', period: '2026-04', daysPresent: 30 },
      { memberId: 'bob', period: '2026-04', daysPresent: 30 }
    ]
    repository.utilityBills = [
      {
        id: 'bill-gas',
        cycleId: 'cycle-2026-04',
        billName: 'Gas',
        amountMinor: 20000n,
        currency: 'GEL',
        createdByMemberId: 'alice',
        createdAt: instantFromIso('2026-04-01T09:00:00.000Z')
      }
    ]

    const service = createService(repository)
    const initialDashboard = await service.generateDashboard('2026-04')
    const initialCategories = initialDashboard?.utilityBillingPlan?.categories.map((category) => ({
      utilityBillId: category.utilityBillId,
      assignedMemberId: category.assignedMemberId,
      amountMinor: category.assignedAmount.amountMinor
    }))

    await service.resolveUtilityBillAsPlanned({
      memberId: 'alice',
      periodArg: '2026-04'
    })
    await service.addPurchase('Snacks', '10.00', 'alice', 'GEL')
    await service.addUtilityBill('Electricity', '50.00', 'alice', 'GEL')

    const afterDashboard = await service.generateDashboard('2026-04')

    expect(repository.utilityBillingPlans).toHaveLength(1)
    expect(afterDashboard?.utilityBillingPlan?.version).toBe(1)
    expect(
      afterDashboard?.utilityBillingPlan?.categories.map((category) => ({
        utilityBillId: category.utilityBillId,
        assignedMemberId: category.assignedMemberId,
        amountMinor: category.assignedAmount.amountMinor
      }))
    ).toEqual(initialCategories)
  })

  test('orphan matched utility facts do not recreate a deleted plan as settled', async () => {
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
    repository.rentRule = { amountMinor: 70000n, currency: 'USD' }
    repository.memberPresenceDays = [
      { memberId: 'alice', period: '2026-04', daysPresent: 30 },
      { memberId: 'bob', period: '2026-04', daysPresent: 30 }
    ]
    repository.utilityBills = [
      {
        id: 'bill-gas',
        cycleId: 'cycle-2026-04',
        billName: 'Gas',
        amountMinor: 20000n,
        currency: 'GEL',
        createdByMemberId: 'alice',
        createdAt: instantFromIso('2026-04-01T09:00:00.000Z')
      }
    ]
    repository.utilityVendorPaymentFacts = [
      {
        id: 'fact-1',
        cycleId: 'cycle-2026-04',
        utilityBillId: 'bill-gas',
        billName: 'Gas',
        payerMemberId: 'alice',
        amountMinor: 20000n,
        currency: 'GEL',
        plannedForMemberId: 'alice',
        planVersion: 1,
        matchedPlan: true,
        recordedByMemberId: 'alice',
        recordedAt: instantFromIso('2026-04-03T09:00:00.000Z'),
        createdAt: instantFromIso('2026-04-03T09:00:00.000Z')
      }
    ]

    const service = createService(repository)
    const dashboard = await service.generateDashboard('2026-04')

    expect(repository.utilityBillingPlans).toHaveLength(1)
    expect(repository.utilityBillingPlans[0]?.status).toBe('active')
    expect(dashboard?.utilityBillingPlan?.status).toBe('active')
    expect(dashboard?.utilityBillingPlan?.categories.length).toBeGreaterThan(0)
  })

  test('generateDashboard does not mint duplicate utility plan versions after off-plan utility facts', async () => {
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
    repository.rentRule = { amountMinor: 70000n, currency: 'USD' }
    repository.memberPresenceDays = [
      { memberId: 'alice', period: '2026-04', daysPresent: 30 },
      { memberId: 'bob', period: '2026-04', daysPresent: 30 }
    ]
    repository.utilityBills = [
      {
        id: 'bill-electricity',
        cycleId: 'cycle-2026-04',
        billName: 'Electricity',
        amountMinor: 10000n,
        currency: 'GEL',
        createdByMemberId: 'alice',
        createdAt: instantFromIso('2026-04-01T09:00:00.000Z')
      },
      {
        id: 'bill-gas',
        cycleId: 'cycle-2026-04',
        billName: 'Gas',
        amountMinor: 10000n,
        currency: 'GEL',
        createdByMemberId: 'alice',
        createdAt: instantFromIso('2026-04-01T09:01:00.000Z')
      }
    ]

    const service = createService(repository)
    await service.generateCurrentBillPlan('2026-04')
    await service.recordUtilityVendorPayment({
      utilityBillId: 'bill-gas',
      payerMemberId: 'alice',
      actorMemberId: 'alice',
      periodArg: '2026-04'
    })

    await Promise.all([
      service.generateDashboard('2026-04'),
      service.generateDashboard('2026-04'),
      service.generateDashboard('2026-04'),
      service.generateDashboard('2026-04')
    ])

    expect(repository.utilityBillingPlans).toHaveLength(2)
    expect(repository.utilityBillingPlans.map((plan) => plan.version)).toEqual([1, 2])
    expect(repository.utilityBillingPlans.map((plan) => plan.status)).toEqual([
      'diverged',
      'active'
    ])
  })

  test('generateDashboard does not rebalance again when the active plan is newer than old off-plan facts', async () => {
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
    repository.rentRule = { amountMinor: 70000n, currency: 'USD' }
    repository.memberPresenceDays = [
      { memberId: 'alice', period: '2026-04', daysPresent: 30 },
      { memberId: 'bob', period: '2026-04', daysPresent: 30 }
    ]
    repository.utilityBills = [
      {
        id: 'bill-electricity',
        cycleId: 'cycle-2026-04',
        billName: 'Electricity',
        amountMinor: 10000n,
        currency: 'GEL',
        createdByMemberId: 'alice',
        createdAt: instantFromIso('2026-04-01T09:00:00.000Z')
      },
      {
        id: 'bill-gas',
        cycleId: 'cycle-2026-04',
        billName: 'Gas',
        amountMinor: 10000n,
        currency: 'GEL',
        createdByMemberId: 'alice',
        createdAt: instantFromIso('2026-04-01T09:01:00.000Z')
      }
    ]
    repository.utilityBillingPlans = [
      {
        cycleId: 'cycle-2026-04',
        version: 1,
        status: 'diverged',
        dueDate: '2026-04-04',
        currency: 'GEL',
        maxCategoriesPerMemberApplied: 1,
        updatedFromPlanId: null,
        reason: null,
        payload: {
          categories: [
            {
              utilityBillId: 'bill-electricity',
              billName: 'Electricity',
              billTotalMinor: '10000',
              assignedAmountMinor: '10000',
              assignedMemberId: 'alice',
              paidAmountMinor: '0',
              isFullAssignment: true,
              splitGroupId: null
            }
          ],
          purchaseIds: [],
          memberSummaries: [
            {
              memberId: 'alice',
              fairShareMinor: '10000',
              vendorPaidMinor: '0',
              assignedThisCycleMinor: '10000',
              projectedDeltaAfterPlanMinor: '0'
            },
            {
              memberId: 'bob',
              fairShareMinor: '10000',
              vendorPaidMinor: '0',
              assignedThisCycleMinor: '0',
              projectedDeltaAfterPlanMinor: '-10000'
            }
          ],
          fairShareByMember: [
            { memberId: 'alice', amountMinor: '10000' },
            { memberId: 'bob', amountMinor: '10000' }
          ],
          preferredUtilityPayerMemberId: null
        }
      },
      {
        cycleId: 'cycle-2026-04',
        version: 2,
        status: 'active',
        dueDate: '2026-04-04',
        currency: 'GEL',
        maxCategoriesPerMemberApplied: 1,
        updatedFromPlanId: 'utility-plan-1',
        reason: 'rebalanced_after_off_plan_change',
        payload: {
          categories: [
            {
              utilityBillId: 'bill-electricity',
              billName: 'Electricity',
              billTotalMinor: '10000',
              assignedAmountMinor: '10000',
              assignedMemberId: 'alice',
              paidAmountMinor: '0',
              isFullAssignment: true,
              splitGroupId: null
            },
            {
              utilityBillId: 'bill-gas',
              billName: 'Gas',
              billTotalMinor: '10000',
              assignedAmountMinor: '10000',
              assignedMemberId: 'bob',
              paidAmountMinor: '10000',
              isFullAssignment: true,
              splitGroupId: null
            }
          ],
          purchaseIds: [],
          memberSummaries: [
            {
              memberId: 'alice',
              fairShareMinor: '10000',
              vendorPaidMinor: '10000',
              assignedThisCycleMinor: '10000',
              projectedDeltaAfterPlanMinor: '0'
            },
            {
              memberId: 'bob',
              fairShareMinor: '10000',
              vendorPaidMinor: '0',
              assignedThisCycleMinor: '10000',
              projectedDeltaAfterPlanMinor: '0'
            }
          ],
          fairShareByMember: [
            { memberId: 'alice', amountMinor: '10000' },
            { memberId: 'bob', amountMinor: '10000' }
          ],
          preferredUtilityPayerMemberId: null
        }
      }
    ]
    repository.utilityVendorPaymentFacts = [
      {
        id: 'fact-1',
        cycleId: 'cycle-2026-04',
        utilityBillId: 'bill-gas',
        billName: 'Gas',
        payerMemberId: 'alice',
        amountMinor: 10000n,
        currency: 'GEL',
        plannedForMemberId: null,
        planVersion: 1,
        matchedPlan: false,
        recordedByMemberId: 'alice',
        recordedAt: instantFromIso('2026-04-02T09:00:00.000Z'),
        createdAt: instantFromIso('2026-04-02T09:00:00.000Z')
      }
    ]

    const service = createService(repository)
    await service.generateDashboard('2026-04')

    expect(repository.utilityBillingPlans).toHaveLength(2)
    expect(repository.utilityBillingPlans.map((plan) => plan.version)).toEqual([1, 2])
    expect(repository.utilityBillingPlans.map((plan) => plan.status)).toEqual([
      'diverged',
      'active'
    ])
  })

  test('generateDashboard bootstraps an active plan when only legacy off-plan vendor facts exist', async () => {
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
      id: 'cycle-2026-05',
      period: '2026-05',
      currency: 'GEL'
    }
    repository.latestCycleRecord = repository.openCycleRecord
    repository.cycles = [repository.openCycleRecord]
    repository.rentRule = { amountMinor: 70000n, currency: 'USD' }
    repository.memberPresenceDays = [
      { memberId: 'alice', period: '2026-05', daysPresent: 31 },
      { memberId: 'bob', period: '2026-05', daysPresent: 31 }
    ]
    repository.utilityBills = [
      {
        id: 'bill-electricity',
        cycleId: 'cycle-2026-05',
        billName: 'Electricity',
        amountMinor: 10000n,
        currency: 'GEL',
        createdByMemberId: 'alice',
        createdAt: instantFromIso('2026-05-01T09:00:00.000Z')
      },
      {
        id: 'bill-gas',
        cycleId: 'cycle-2026-05',
        billName: 'Gas',
        amountMinor: 10000n,
        currency: 'GEL',
        createdByMemberId: 'alice',
        createdAt: instantFromIso('2026-05-01T09:01:00.000Z')
      }
    ]
    repository.utilityVendorPaymentFacts = [
      {
        id: 'fact-1',
        cycleId: 'cycle-2026-05',
        utilityBillId: 'bill-gas',
        billName: 'Gas',
        payerMemberId: 'alice',
        amountMinor: 10000n,
        currency: 'GEL',
        plannedForMemberId: null,
        planVersion: null,
        matchedPlan: false,
        recordedByMemberId: 'alice',
        recordedAt: instantFromIso('2026-02-01T09:00:00.000Z'),
        createdAt: instantFromIso('2026-02-01T09:00:00.000Z')
      }
    ]

    const service = createService(repository)
    const dashboard = await service.generateDashboard('2026-05')

    expect(repository.utilityBillingPlans).toHaveLength(1)
    expect(repository.utilityBillingPlans[0]?.status).toBe('active')
    expect(dashboard?.utilityBillingPlan?.version).toBe(1)
    expect(dashboard?.utilityBillingPlan?.status).toBe('active')
    expect(dashboard?.utilityBillingPlan?.categories).toHaveLength(2)
  })

  test('generateDashboard keeps utilities stage after rent warning while planned utilities remain unpaid', async () => {
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
    repository.rentRule = { amountMinor: 70000n, currency: 'USD' }
    repository.memberPresenceDays = [
      { memberId: 'alice', period: '2026-04', daysPresent: 30 },
      { memberId: 'bob', period: '2026-04', daysPresent: 30 }
    ]
    repository.utilityBills = [
      {
        id: 'bill-gas',
        cycleId: 'cycle-2026-04',
        billName: 'Gas',
        amountMinor: 20000n,
        currency: 'GEL',
        createdByMemberId: 'alice',
        createdAt: instantFromIso('2026-04-01T09:00:00.000Z')
      }
    ]

    const service = createService(repository)
    const dashboard = await service.generateDashboard('2026-04', {
      todayOverride: '2026-04-18'
    })

    expect(dashboard?.utilityBillingPlan?.status).toBe('active')
    expect(dashboard?.billingStage).toBe('utilities')
  })

  test('generateDashboard replaces an empty settled utility plan when utility bills were added later', async () => {
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
      id: 'cycle-2026-05',
      period: '2026-05',
      currency: 'GEL'
    }
    repository.latestCycleRecord = repository.openCycleRecord
    repository.cycles = [repository.openCycleRecord]
    repository.rentRule = { amountMinor: 70000n, currency: 'USD' }
    repository.memberPresenceDays = [
      { memberId: 'alice', period: '2026-05', daysPresent: 31 },
      { memberId: 'bob', period: '2026-05', daysPresent: 31 }
    ]
    repository.utilityBills = [
      {
        id: 'bill-electricity',
        cycleId: 'cycle-2026-05',
        billName: 'Electricity',
        amountMinor: 10000n,
        currency: 'GEL',
        createdByMemberId: 'alice',
        createdAt: instantFromIso('2026-05-02T10:21:00.000Z')
      }
    ]
    repository.utilityBillingPlans = [
      {
        cycleId: 'cycle-2026-05',
        version: 1,
        status: 'settled',
        dueDate: '2026-05-04',
        currency: 'GEL',
        maxCategoriesPerMemberApplied: 0,
        updatedFromPlanId: null,
        reason: null,
        payload: {
          categories: [],
          purchaseIds: [],
          memberSummaries: [
            {
              memberId: 'alice',
              fairShareMinor: '0',
              vendorPaidMinor: '0',
              assignedThisCycleMinor: '0',
              projectedDeltaAfterPlanMinor: '0'
            },
            {
              memberId: 'bob',
              fairShareMinor: '0',
              vendorPaidMinor: '0',
              assignedThisCycleMinor: '0',
              projectedDeltaAfterPlanMinor: '0'
            }
          ],
          fairShareByMember: [
            { memberId: 'alice', amountMinor: '0' },
            { memberId: 'bob', amountMinor: '0' }
          ]
        }
      }
    ]

    const service = createService(repository)
    const dashboard = await service.generateDashboard('2026-05', {
      todayOverride: '2026-05-04'
    })

    expect(repository.utilityBillingPlans.map((plan) => plan.status)).toEqual([
      'superseded',
      'active'
    ])
    expect(dashboard?.utilityBillingPlan?.version).toBe(2)
    expect(dashboard?.utilityBillingPlan?.categories.length).toBeGreaterThan(0)
    expect(dashboard?.billingStage).toBe('utilities')
  })

  test('generateDashboard does not materialize an empty utility plan before bills exist', async () => {
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
      id: 'cycle-2026-06',
      period: '2026-06',
      currency: 'GEL'
    }
    repository.latestCycleRecord = repository.openCycleRecord
    repository.cycles = [repository.openCycleRecord]
    repository.rentRule = { amountMinor: 70000n, currency: 'USD' }
    repository.memberPresenceDays = [
      { memberId: 'alice', period: '2026-06', daysPresent: 30 },
      { memberId: 'bob', period: '2026-06', daysPresent: 30 }
    ]

    const service = createService(repository)
    const dashboard = await service.generateDashboard('2026-06', {
      todayOverride: '2026-06-01'
    })

    expect(repository.utilityBillingPlans).toHaveLength(0)
    expect(dashboard?.utilityBillingPlan).toBeNull()
  })

  test('generateDashboard ignores an existing empty settled utility plan before bills exist', async () => {
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
      id: 'cycle-2026-06',
      period: '2026-06',
      currency: 'GEL'
    }
    repository.latestCycleRecord = repository.openCycleRecord
    repository.cycles = [repository.openCycleRecord]
    repository.rentRule = { amountMinor: 70000n, currency: 'USD' }
    repository.memberPresenceDays = [
      { memberId: 'alice', period: '2026-06', daysPresent: 30 },
      { memberId: 'bob', period: '2026-06', daysPresent: 30 }
    ]
    repository.utilityBillingPlans = [
      {
        cycleId: 'cycle-2026-06',
        version: 1,
        status: 'settled',
        dueDate: '2026-06-05',
        currency: 'GEL',
        maxCategoriesPerMemberApplied: 0,
        updatedFromPlanId: null,
        reason: null,
        payload: {
          categories: [],
          purchaseIds: [],
          memberSummaries: [
            {
              memberId: 'alice',
              fairShareMinor: '0',
              vendorPaidMinor: '0',
              assignedThisCycleMinor: '0',
              projectedDeltaAfterPlanMinor: '0'
            },
            {
              memberId: 'bob',
              fairShareMinor: '0',
              vendorPaidMinor: '0',
              assignedThisCycleMinor: '0',
              projectedDeltaAfterPlanMinor: '0'
            }
          ],
          fairShareByMember: [
            { memberId: 'alice', amountMinor: '0' },
            { memberId: 'bob', amountMinor: '0' }
          ]
        }
      }
    ]

    const service = createService(repository)
    const dashboard = await service.generateDashboard('2026-06', {
      todayOverride: '2026-06-01'
    })

    expect(repository.utilityBillingPlans.map((plan) => plan.status)).toEqual(['settled'])
    expect(dashboard?.utilityBillingPlan).toBeNull()
  })

  test('resolveUtilityBillAsPlanned resolves purchases when policy is utilities', async () => {
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
    repository.rentRule = { amountMinor: 70000n, currency: 'USD' }
    repository.billingSettingsOverride = {
      paymentBalanceAdjustmentPolicy: 'utilities'
    }
    repository.memberPresenceDays = [
      { memberId: 'alice', period: '2026-04', daysPresent: 30 },
      { memberId: 'bob', period: '2026-04', daysPresent: 30 }
    ]
    repository.utilityBills = [
      {
        id: 'bill-gas',
        cycleId: 'cycle-2026-04',
        billName: 'Gas',
        amountMinor: 20000n,
        currency: 'GEL',
        createdByMemberId: 'alice',
        createdAt: instantFromIso('2026-04-01T09:00:00.000Z')
      }
    ]
    repository.purchases = [
      {
        id: 'purchase-1',
        cycleId: 'cycle-2026-04',
        cyclePeriod: '2026-04',
        payerMemberId: 'alice',
        amountMinor: 2000n,
        currency: 'GEL',
        description: 'Shared supplies',
        occurredAt: instantFromIso('2026-04-02T10:00:00.000Z'),
        splitMode: 'equal'
      }
    ]

    const service = createService(repository)

    // Materialize initial plan (includes purchase offset)
    await service.generateDashboard('2026-04')

    // Resolve bob's planned bills (bob owes on the purchase, so his payment triggers allocation)
    await service.resolveUtilityBillAsPlanned({
      memberId: 'bob',
      periodArg: '2026-04'
    })

    // Verify purchase allocations were created
    const allocations = repository.lastReplacedPaymentPurchaseAllocations
    expect(allocations).not.toBeNull()
    expect(allocations?.resolutionMethod).toBe('utilities_plan')
    expect((allocations?.allocations?.length ?? 0) > 0).toBe(true)
  })

  test('resolveUtilityBillAsPlanned resolves purchases even when purchaseOffset nets to zero', async () => {
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
    repository.rentRule = { amountMinor: 70000n, currency: 'USD' }
    repository.billingSettingsOverride = {
      paymentBalanceAdjustmentPolicy: 'utilities'
    }
    repository.memberPresenceDays = [
      { memberId: 'alice', period: '2026-04', daysPresent: 30 },
      { memberId: 'bob', period: '2026-04', daysPresent: 30 }
    ]
    repository.utilityBills = [
      {
        id: 'bill-gas',
        cycleId: 'cycle-2026-04',
        billName: 'Gas',
        amountMinor: 20000n,
        currency: 'GEL',
        createdByMemberId: 'alice',
        createdAt: instantFromIso('2026-04-01T09:00:00.000Z')
      }
    ]
    // Two symmetric purchases: alice paid 6000 shared equally, bob paid 6000 shared equally
    // Net offset for both members is 0 (they owe each other the same amount)
    repository.purchases = [
      {
        id: 'purchase-alice',
        cycleId: 'cycle-2026-04',
        cyclePeriod: '2026-04',
        payerMemberId: 'alice',
        amountMinor: 6000n,
        currency: 'GEL',
        description: 'Alice supplies',
        occurredAt: instantFromIso('2026-04-02T10:00:00.000Z'),
        splitMode: 'equal'
      },
      {
        id: 'purchase-bob',
        cycleId: 'cycle-2026-04',
        cyclePeriod: '2026-04',
        payerMemberId: 'bob',
        amountMinor: 6000n,
        currency: 'GEL',
        description: 'Bob supplies',
        occurredAt: instantFromIso('2026-04-02T11:00:00.000Z'),
        splitMode: 'equal'
      }
    ]

    const service = createService(repository)

    // Materialize initial plan (purchase offsets should net to 0)
    const initialDashboard = await service.generateDashboard('2026-04')
    const aliceLine = initialDashboard?.members.find((m) => m.memberId === 'alice')
    expect(aliceLine?.purchaseOffset.amountMinor).toBe(0n)

    // Resolve alice's planned bills
    await service.resolveUtilityBillAsPlanned({
      memberId: 'alice',
      periodArg: '2026-04'
    })

    // Despite zero net offset, alice owes 3000 on bob's purchase
    // The allocation should still resolve that debt
    const allocations = repository.lastReplacedPaymentPurchaseAllocations
    expect(allocations).not.toBeNull()
    expect(allocations?.resolutionMethod).toBe('utilities_plan')
    expect(allocations?.allocations?.length).toBeGreaterThan(0)

    const aliceAllocation = allocations?.allocations?.find(
      (a) => a.purchaseId === 'purchase-bob' && a.memberId === 'alice'
    )
    expect(aliceAllocation).toBeDefined()
    expect(aliceAllocation?.amountMinor).toBe(3000n)
  })
})
