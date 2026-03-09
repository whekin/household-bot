import type { BillingPeriod } from './billing-period'
import type { BillingCycleId, MemberId, PurchaseEntryId } from './ids'
import type { Money } from './money'

export type UtilitySplitMode = 'equal' | 'weighted_by_days'

export interface SettlementMemberInput {
  memberId: MemberId
  active: boolean
  rentWeight?: number
  utilityDays?: number
}

export interface SettlementPurchaseInput {
  purchaseId: PurchaseEntryId
  payerId: MemberId
  amount: Money
  description?: string
}

export interface SettlementInput {
  cycleId: BillingCycleId
  period: BillingPeriod
  rent: Money
  utilities: Money
  utilitySplitMode: UtilitySplitMode
  members: readonly SettlementMemberInput[]
  purchases: readonly SettlementPurchaseInput[]
}

export interface SettlementMemberLine {
  memberId: MemberId
  rentShare: Money
  utilityShare: Money
  purchaseOffset: Money
  netDue: Money
  explanations: readonly string[]
}

export interface SettlementResult {
  cycleId: BillingCycleId
  period: BillingPeriod
  lines: readonly SettlementMemberLine[]
  totalDue: Money
}
