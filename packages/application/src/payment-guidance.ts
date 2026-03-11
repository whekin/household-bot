import { BillingPeriod, Money, Temporal } from '@household/domain'
import type {
  HouseholdBillingSettingsRecord,
  HouseholdPaymentBalanceAdjustmentPolicy
} from '@household/ports'

import type { FinanceDashboardMemberLine } from './finance-command-service'

export interface MemberPaymentGuidance {
  kind: 'rent' | 'utilities'
  adjustmentPolicy: HouseholdPaymentBalanceAdjustmentPolicy
  baseAmount: Money
  purchaseOffset: Money
  proposalAmount: Money
  totalRemaining: Money
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

export function buildMemberPaymentGuidance(input: {
  kind: 'rent' | 'utilities'
  period: string
  memberLine: FinanceDashboardMemberLine
  settings: HouseholdBillingSettingsRecord
  referenceInstant?: Temporal.Instant
}): MemberPaymentGuidance {
  const policy = input.settings.paymentBalanceAdjustmentPolicy ?? 'utilities'
  const baseAmount =
    input.kind === 'rent' ? input.memberLine.rentShare : input.memberLine.utilityShare
  const purchaseOffset = input.memberLine.purchaseOffset
  const proposalAmount = adjustmentApplies(policy, input.kind)
    ? baseAmount.add(purchaseOffset)
    : baseAmount

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
    totalRemaining: input.memberLine.remaining,
    reminderDate: reminderDate.toString(),
    dueDate: dueDate.toString(),
    paymentWindowOpen: Temporal.PlainDate.compare(localDate, reminderDate) >= 0,
    paymentDue: Temporal.PlainDate.compare(localDate, dueDate) >= 0
  }
}
