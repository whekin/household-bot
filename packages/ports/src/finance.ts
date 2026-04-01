import type { CurrencyCode, Instant } from '@household/domain'

export interface FinanceMemberRecord {
  id: string
  telegramUserId: string
  displayName: string
  rentShareWeight: number
  isAdmin: boolean
}

export interface FinanceCycleRecord {
  id: string
  period: string
  currency: CurrencyCode
}

export interface FinanceMemberOverduePaymentRecord {
  kind: FinancePaymentKind
  amountMinor: bigint
  periods: readonly string[]
}

export interface FinanceCycleExchangeRateRecord {
  cycleId: string
  sourceCurrency: CurrencyCode
  targetCurrency: CurrencyCode
  rateMicros: bigint
  effectiveDate: string
  source: 'nbg'
}

export interface FinanceRentRuleRecord {
  amountMinor: bigint
  currency: CurrencyCode
}

export interface FinanceParsedPurchaseRecord {
  id: string
  cycleId: string | null
  cyclePeriod?: string | null
  payerMemberId: string
  amountMinor: bigint
  currency: CurrencyCode
  description: string | null
  occurredAt: Instant | null
  splitMode?: 'equal' | 'custom_amounts'
  participants?: readonly {
    id?: string
    memberId: string
    included?: boolean
    shareAmountMinor: bigint | null
  }[]
}

export interface FinancePaymentPurchaseAllocationRecord {
  id: string
  paymentRecordId: string
  purchaseId: string
  memberId: string
  amountMinor: bigint
  recordedAt: Instant
}

export interface FinanceUtilityBillRecord {
  id: string
  billName: string
  amountMinor: bigint
  currency: CurrencyCode
  createdByMemberId: string | null
  createdAt: Instant
}

export type FinancePaymentKind = 'rent' | 'utilities'
export type FinanceUtilityBillingPlanStatus = 'active' | 'diverged' | 'superseded' | 'settled'

export interface FinanceUtilityBillingPlanMemberPayload {
  memberId: string
  amountMinor: string
}

export interface FinanceUtilityBillingPlanCategoryPayload {
  utilityBillId: string
  billName: string
  billTotalMinor: string
  assignedAmountMinor: string
  assignedMemberId: string
  paidAmountMinor: string
  isFullAssignment: boolean
  splitGroupId: string | null
}

export interface FinanceUtilityBillingPlanMemberSummaryPayload {
  memberId: string
  fairShareMinor: string
  vendorPaidMinor: string
  assignedThisCycleMinor: string
  projectedDeltaAfterPlanMinor: string
}

export interface FinanceUtilityBillingPlanPayload {
  fairShareByMember: readonly FinanceUtilityBillingPlanMemberPayload[]
  categories: readonly FinanceUtilityBillingPlanCategoryPayload[]
  memberSummaries: readonly FinanceUtilityBillingPlanMemberSummaryPayload[]
}

export interface FinanceUtilityBillingPlanRecord {
  id: string
  householdId: string
  cycleId: string
  version: number
  status: FinanceUtilityBillingPlanStatus
  dueDate: string
  currency: CurrencyCode
  maxCategoriesPerMemberApplied: number
  updatedFromPlanId: string | null
  reason: string | null
  payload: FinanceUtilityBillingPlanPayload
  createdAt: Instant
}

export interface FinanceUtilityVendorPaymentFactRecord {
  id: string
  cycleId: string
  utilityBillId: string | null
  billName: string
  payerMemberId: string
  amountMinor: bigint
  currency: CurrencyCode
  plannedForMemberId: string | null
  planVersion: number | null
  matchedPlan: boolean
  recordedByMemberId: string | null
  recordedAt: Instant
  createdAt: Instant
}

export interface FinanceUtilityReimbursementFactRecord {
  id: string
  cycleId: string
  fromMemberId: string
  toMemberId: string
  amountMinor: bigint
  currency: CurrencyCode
  plannedFromMemberId: string | null
  plannedToMemberId: string | null
  planVersion: number | null
  matchedPlan: boolean
  recordedByMemberId: string | null
  recordedAt: Instant
  createdAt: Instant
}

export interface FinancePaymentRecord {
  id: string
  cycleId: string
  cyclePeriod?: string | null
  memberId: string
  kind: FinancePaymentKind
  amountMinor: bigint
  currency: CurrencyCode
  recordedAt: Instant
}

export interface FinanceSettlementSnapshotLineRecord {
  memberId: string
  rentShareMinor: bigint
  utilityShareMinor: bigint
  purchaseOffsetMinor: bigint
  netDueMinor: bigint
}

export interface FinancePaymentConfirmationMessage {
  senderTelegramUserId: string
  rawText: string
  normalizedText: string
  telegramChatId: string
  telegramMessageId: string
  telegramThreadId: string
  telegramUpdateId: string
  attachmentCount: number
  messageSentAt: Instant | null
}

export type FinancePaymentConfirmationReviewReason =
  | 'member_not_found'
  | 'cycle_not_found'
  | 'settlement_not_ready'
  | 'intent_missing'
  | 'kind_ambiguous'
  | 'multiple_members'
  | 'non_positive_amount'

export type FinancePaymentConfirmationSaveInput =
  | (FinancePaymentConfirmationMessage & {
      status: 'recorded'
      cycleId: string
      memberId: string
      kind: FinancePaymentKind
      amountMinor: bigint
      currency: CurrencyCode
      explicitAmountMinor: bigint | null
      explicitCurrency: CurrencyCode | null
      recordedAt: Instant
    })
  | (FinancePaymentConfirmationMessage & {
      status: 'needs_review'
      cycleId: string | null
      memberId: string | null
      kind: FinancePaymentKind | null
      amountMinor: bigint | null
      currency: CurrencyCode | null
      explicitAmountMinor: bigint | null
      explicitCurrency: CurrencyCode | null
      reviewReason: FinancePaymentConfirmationReviewReason
    })

export type FinancePaymentConfirmationSaveResult =
  | {
      status: 'duplicate'
    }
  | {
      status: 'recorded'
      paymentRecord: FinancePaymentRecord
    }
  | {
      status: 'needs_review'
      reviewReason: FinancePaymentConfirmationReviewReason
    }

export interface SettlementSnapshotLineRecord {
  memberId: string
  rentShareMinor: bigint
  utilityShareMinor: bigint
  purchaseOffsetMinor: bigint
  netDueMinor: bigint
  explanations: readonly string[]
}

export interface SettlementSnapshotRecord {
  cycleId: string
  inputHash: string
  totalDueMinor: bigint
  currency: CurrencyCode
  metadata: Record<string, unknown>
  lines: readonly SettlementSnapshotLineRecord[]
}

export interface FinanceRepository {
  getMemberByTelegramUserId(telegramUserId: string): Promise<FinanceMemberRecord | null>
  listMembers(): Promise<readonly FinanceMemberRecord[]>
  listCycles(): Promise<readonly FinanceCycleRecord[]>
  getOpenCycle(): Promise<FinanceCycleRecord | null>
  getCycleByPeriod(period: string): Promise<FinanceCycleRecord | null>
  getLatestCycle(): Promise<FinanceCycleRecord | null>
  openCycle(period: string, currency: CurrencyCode): Promise<void>
  closeCycle(cycleId: string, closedAt: Instant): Promise<void>
  saveRentRule(period: string, amountMinor: bigint, currency: CurrencyCode): Promise<void>
  getCycleExchangeRate(
    cycleId: string,
    sourceCurrency: CurrencyCode,
    targetCurrency: CurrencyCode
  ): Promise<FinanceCycleExchangeRateRecord | null>
  saveCycleExchangeRate(
    input: FinanceCycleExchangeRateRecord
  ): Promise<FinanceCycleExchangeRateRecord>
  addUtilityBill(input: {
    cycleId: string
    billName: string
    amountMinor: bigint
    currency: CurrencyCode
    createdByMemberId: string
  }): Promise<void>
  addParsedPurchase(input: {
    cycleId: string
    payerMemberId: string
    amountMinor: bigint
    currency: CurrencyCode
    description: string | null
    occurredAt: Instant
    splitMode?: 'equal' | 'custom_amounts'
    participants?: readonly {
      memberId: string
      included?: boolean
      shareAmountMinor: bigint | null
    }[]
  }): Promise<FinanceParsedPurchaseRecord>
  updateParsedPurchase(input: {
    purchaseId: string
    amountMinor: bigint
    currency: CurrencyCode
    description: string | null
    payerMemberId?: string
    splitMode?: 'equal' | 'custom_amounts'
    participants?: readonly {
      memberId: string
      included?: boolean
      shareAmountMinor: bigint | null
    }[]
  }): Promise<FinanceParsedPurchaseRecord | null>
  deleteParsedPurchase(purchaseId: string): Promise<boolean>
  updateUtilityBill(input: {
    billId: string
    billName: string
    amountMinor: bigint
    currency: CurrencyCode
  }): Promise<FinanceUtilityBillRecord | null>
  deleteUtilityBill(billId: string): Promise<boolean>
  addPaymentRecord(input: {
    cycleId: string
    memberId: string
    kind: FinancePaymentKind
    amountMinor: bigint
    currency: CurrencyCode
    recordedAt: Instant
  }): Promise<FinancePaymentRecord>
  getPaymentRecord(paymentId: string): Promise<FinancePaymentRecord | null>
  replacePaymentPurchaseAllocations(input: {
    paymentRecordId: string
    allocations: readonly {
      purchaseId: string
      memberId: string
      amountMinor: bigint
    }[]
  }): Promise<void>
  updatePaymentRecord(input: {
    paymentId: string
    memberId: string
    kind: FinancePaymentKind
    amountMinor: bigint
    currency: CurrencyCode
  }): Promise<FinancePaymentRecord | null>
  deletePaymentRecord(paymentId: string): Promise<boolean>
  getRentRuleForPeriod(period: string): Promise<FinanceRentRuleRecord | null>
  getUtilityTotalForCycle(cycleId: string): Promise<bigint>
  listUtilityBillsForCycle(cycleId: string): Promise<readonly FinanceUtilityBillRecord[]>
  getActiveUtilityBillingPlan(cycleId: string): Promise<FinanceUtilityBillingPlanRecord | null>
  listUtilityBillingPlansForCycle(
    cycleId: string
  ): Promise<readonly FinanceUtilityBillingPlanRecord[]>
  saveUtilityBillingPlan(input: {
    cycleId: string
    version: number
    status: FinanceUtilityBillingPlanStatus
    dueDate: string
    currency: CurrencyCode
    maxCategoriesPerMemberApplied: number
    updatedFromPlanId: string | null
    reason: string | null
    payload: FinanceUtilityBillingPlanPayload
  }): Promise<FinanceUtilityBillingPlanRecord>
  updateUtilityBillingPlanStatus(
    planId: string,
    status: FinanceUtilityBillingPlanStatus
  ): Promise<FinanceUtilityBillingPlanRecord | null>
  listUtilityVendorPaymentFactsForCycle(
    cycleId: string
  ): Promise<readonly FinanceUtilityVendorPaymentFactRecord[]>
  addUtilityVendorPaymentFact(input: {
    cycleId: string
    utilityBillId?: string | null
    billName: string
    payerMemberId: string
    amountMinor: bigint
    currency: CurrencyCode
    plannedForMemberId?: string | null
    planVersion?: number | null
    matchedPlan: boolean
    recordedByMemberId?: string | null
    recordedAt: Instant
  }): Promise<FinanceUtilityVendorPaymentFactRecord>
  listUtilityReimbursementFactsForCycle(
    cycleId: string
  ): Promise<readonly FinanceUtilityReimbursementFactRecord[]>
  addUtilityReimbursementFact(input: {
    cycleId: string
    fromMemberId: string
    toMemberId: string
    amountMinor: bigint
    currency: CurrencyCode
    plannedFromMemberId?: string | null
    plannedToMemberId?: string | null
    planVersion?: number | null
    matchedPlan: boolean
    recordedByMemberId?: string | null
    recordedAt: Instant
  }): Promise<FinanceUtilityReimbursementFactRecord>
  listPaymentRecordsForCycle(cycleId: string): Promise<readonly FinancePaymentRecord[]>
  listParsedPurchasesForRange(
    start: Instant,
    end: Instant
  ): Promise<readonly FinanceParsedPurchaseRecord[]>
  listParsedPurchases(): Promise<readonly FinanceParsedPurchaseRecord[]>
  listPaymentPurchaseAllocations(): Promise<readonly FinancePaymentPurchaseAllocationRecord[]>
  getSettlementSnapshotLines(
    cycleId: string
  ): Promise<readonly FinanceSettlementSnapshotLineRecord[]>
  savePaymentConfirmation(
    input: FinancePaymentConfirmationSaveInput
  ): Promise<FinancePaymentConfirmationSaveResult>
  replaceSettlementSnapshot(snapshot: SettlementSnapshotRecord): Promise<void>
}
