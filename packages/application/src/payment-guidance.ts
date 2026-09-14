import { BillingPeriod, Money, Temporal } from '@household/domain'
import type {
  HouseholdBillingSettingsRecord,
  HouseholdPaymentBalanceAdjustmentPolicy
} from '@household/ports'

import type {
  FinanceDashboard,
  FinanceDashboardMemberLine,
  FinanceDashboardPaymentKindSummary
} from './finance-command-service'

/** The reminder queue hides rent before its warning day; payment recording must not. */
export function paymentKindSummaryForRecording(
  dashboard: FinanceDashboard,
  period: string,
  kind: 'rent' | 'utilities'
): FinanceDashboardPaymentKindSummary | null {
  const summary =
    dashboard.paymentPeriods
      ?.find((entry) => entry.period === period)
      ?.kinds.find((entry) => entry.kind === kind) ?? null
  if (
    kind !== 'rent' ||
    period !== dashboard.period ||
    !dashboard.rentBillingState?.memberSummaries.length
  )
    return summary

  const members = dashboard.rentBillingState.memberSummaries
  return {
    kind,
    totalDue: members.reduce(
      (total, member) => total.add(member.due),
      Money.zero(dashboard.currency)
    ),
    totalPaid: members.reduce(
      (total, member) => total.add(member.paid),
      Money.zero(dashboard.currency)
    ),
    totalRemaining: members.reduce(
      (total, member) => total.add(member.remaining),
      Money.zero(dashboard.currency)
    ),
    unresolvedMembers: members
      .filter((member) => member.remaining.amountMinor > 0n)
      .map((member) => ({
        memberId: member.memberId,
        displayName: member.displayName,
        baseDue: member.due,
        paid: member.paid,
        remaining: member.remaining,
        suggestedAmount: Money.fromMinor(
          roundRentMinor(member.remaining.amountMinor),
          dashboard.currency
        ),
        effectivelySettled: false
      }))
  }
}

export interface MemberPaymentGuidance {
  kind: 'rent' | 'utilities'
  adjustmentPolicy: HouseholdPaymentBalanceAdjustmentPolicy
  baseAmount: Money
  purchaseOffset: Money
  proposalAmount: Money
  totalRemaining: Money
  source: 'settlement' | 'payment_period'
  reminderDate: string
  dueDate: string
  paymentWindowOpen: boolean
  paymentDue: boolean
}

function cycleDate(period: string, day: number): Temporal.PlainDate {
  const billingPeriod = BillingPeriod.fromString(period)
  const [yearRaw, monthRaw] = billingPeriod.toString().split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  const yearMonth = new Temporal.PlainYearMonth(year, month)
  const boundedDay = Math.min(Math.max(day, 1), yearMonth.daysInMonth)

  return new Temporal.PlainDate(year, month, boundedDay)
}

function adjustmentApplies(
  policy: HouseholdPaymentBalanceAdjustmentPolicy,
  kind: 'rent' | 'utilities'
): boolean {
  return (policy === 'utilities' && kind === 'utilities') || (policy === 'rent' && kind === 'rent')
}

function roundRentMinor(amountMinor: bigint): bigint {
  if (amountMinor <= 0n) {
    return 0n
  }

  const wholeMinor = amountMinor / 100n
  const remainderMinor = amountMinor % 100n

  return (remainderMinor >= 50n ? wholeMinor + 1n : wholeMinor) * 100n
}

export function buildMemberPaymentGuidance(input: {
  kind: 'rent' | 'utilities'
  period: string
  memberLine: FinanceDashboardMemberLine
  settings: HouseholdBillingSettingsRecord
  paymentKindSummary?: FinanceDashboardPaymentKindSummary | null
  referenceInstant?: Temporal.Instant
}): MemberPaymentGuidance {
  const policy = input.settings.paymentBalanceAdjustmentPolicy ?? 'utilities'
  const paymentPeriodMember =
    input.paymentKindSummary?.kind === input.kind
      ? (input.paymentKindSummary.unresolvedMembers.find(
          (member) => member.memberId === input.memberLine.memberId
        ) ?? null)
      : null
  const baseAmount = paymentPeriodMember
    ? paymentPeriodMember.baseDue
    : input.kind === 'rent'
      ? input.memberLine.rentShare
      : input.memberLine.utilityShare
  const purchaseOffset = paymentPeriodMember
    ? Money.zero(baseAmount.currency)
    : input.memberLine.purchaseOffset
  const adjustedMinor = adjustmentApplies(policy, input.kind)
    ? baseAmount.amountMinor + purchaseOffset.amountMinor
    : baseAmount.amountMinor
  const proposalAmount = paymentPeriodMember
    ? paymentPeriodMember.suggestedAmount
    : Money.fromMinor(
        input.kind === 'rent'
          ? roundRentMinor(adjustedMinor > 0n ? adjustedMinor : 0n)
          : adjustedMinor > 0n
            ? adjustedMinor
            : 0n,
        baseAmount.currency
      )

  const reminderDay =
    input.kind === 'rent' ? input.settings.rentWarningDay : input.settings.utilitiesReminderDay
  const dueDay = input.kind === 'rent' ? input.settings.rentDueDay : input.settings.utilitiesDueDay
  const reminderDate = cycleDate(input.period, reminderDay)
  const dueDate = cycleDate(input.period, dueDay)
  const localDate = (input.referenceInstant ?? Temporal.Now.instant())
    .toZonedDateTimeISO(input.settings.timezone)
    .toPlainDate()

  return {
    kind: input.kind,
    adjustmentPolicy: policy,
    baseAmount,
    purchaseOffset,
    proposalAmount,
    totalRemaining: paymentPeriodMember?.remaining ?? input.memberLine.remaining,
    source: paymentPeriodMember ? 'payment_period' : 'settlement',
    reminderDate: reminderDate.toString(),
    dueDate: dueDate.toString(),
    paymentWindowOpen: Temporal.PlainDate.compare(localDate, reminderDate) >= 0,
    paymentDue: Temporal.PlainDate.compare(localDate, dueDate) >= 0
  }
}
