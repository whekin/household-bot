import type { CurrencyCode } from '@household/domain'

export interface FinanceMemberRecord {
  id: string
  telegramUserId: string
  displayName: string
  isAdmin: boolean
}

export interface FinanceCycleRecord {
  id: string
  period: string
  currency: CurrencyCode
}

export interface FinanceRentRuleRecord {
  amountMinor: bigint
  currency: CurrencyCode
}

export interface FinanceParsedPurchaseRecord {
  id: string
  payerMemberId: string
  amountMinor: bigint
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
  closeCycle(cycleId: string, closedAt: Date): Promise<void>
  saveRentRule(period: string, amountMinor: bigint, currency: CurrencyCode): Promise<void>
  addUtilityBill(input: {
    cycleId: string
    billName: string
    amountMinor: bigint
    currency: CurrencyCode
    createdByMemberId: string
  }): Promise<void>
  getRentRuleForPeriod(period: string): Promise<FinanceRentRuleRecord | null>
  getUtilityTotalForCycle(cycleId: string): Promise<bigint>
  listParsedPurchasesForRange(
    start: Date,
    end: Date
  ): Promise<readonly FinanceParsedPurchaseRecord[]>
  replaceSettlementSnapshot(snapshot: SettlementSnapshotRecord): Promise<void>
}
