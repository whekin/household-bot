import type { CurrencyCode } from '@household/domain'
import type { FinancePaymentKind } from '@household/ports'

import type { FinanceDashboard } from './finance-command-service'

/** Where a payment kind stands for one month, as announced to the household. */
export interface HouseholdPaymentProgress {
  kind: FinancePaymentKind
  period: string
  /** Rent only: utilities shares are uneven, so a headcount would mislead. */
  paidMembers: number | null
  totalMembers: number | null
  totalDueMinor: bigint
  currency: CurrencyCode
  fullyPaid: boolean
}

export function paymentProgressFromDashboard(
  dashboard: FinanceDashboard,
  kind: FinancePaymentKind,
  period: string
): HouseholdPaymentProgress | null {
  const summary = dashboard.paymentPeriods
    ?.find((candidate) => candidate.period === period)
    ?.kinds.find((candidate) => candidate.kind === kind)
  if (!summary || summary.totalDue.amountMinor <= 0n) {
    return null
  }

  const rentMembers =
    kind === 'rent' && dashboard.period === period
      ? dashboard.rentBillingState.memberSummaries.filter((member) => member.due.amountMinor > 0n)
      : null

  return {
    kind,
    period,
    paidMembers: rentMembers
      ? rentMembers.filter((member) => member.remaining.amountMinor <= 0n).length
      : null,
    totalMembers: rentMembers ? rentMembers.length : null,
    totalDueMinor: summary.totalDue.amountMinor,
    currency: summary.totalDue.currency,
    fullyPaid: summary.totalRemaining.amountMinor <= 0n
  }
}
