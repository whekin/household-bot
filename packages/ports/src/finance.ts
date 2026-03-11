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

export interface FinanceUtilityBillRecord {
  id: string
  billName: string
  amountMinor: bigint
  currency: CurrencyCode
  createdByMemberId: string | null
  createdAt: Instant
}

export type FinancePaymentKind = 'rent' | 'utilities'

export interface FinancePaymentRecord {
  id: string
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
  updateParsedPurchase(input: {
    purchaseId: string
    amountMinor: bigint
    currency: CurrencyCode
    description: string | null
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
  listPaymentRecordsForCycle(cycleId: string): Promise<readonly FinancePaymentRecord[]>
  listParsedPurchasesForRange(
    start: Instant,
    end: Instant
  ): Promise<readonly FinanceParsedPurchaseRecord[]>
  getSettlementSnapshotLines(
    cycleId: string
  ): Promise<readonly FinanceSettlementSnapshotLineRecord[]>
  savePaymentConfirmation(
    input: FinancePaymentConfirmationSaveInput
  ): Promise<FinancePaymentConfirmationSaveResult>
  replaceSettlementSnapshot(snapshot: SettlementSnapshotRecord): Promise<void>
}
