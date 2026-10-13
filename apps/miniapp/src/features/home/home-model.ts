import type { MiniAppDashboard, MiniAppRentPaymentDestination } from '@/api'
import type { CalendarDateParts } from '@/lib/dates'
import { parsePeriod } from '@/lib/dates'
import { majorStringToMinor, minorToMajorString } from '@/lib/money'

/**
 * Everything Home says about the reader, derived from one source.
 *
 * What you owe comes only from `paymentPeriods` — the same per-member rows the
 * server closes against and the bot reminds about — so Home, Month and the
 * reminder cards always agree. The server already hides rent until its window
 * opens and keeps unpaid older months in the list, so "owe now" is simply
 * "every unresolved row that is mine".
 */

export type MoneyKind = 'rent' | 'utilities'

export type Obligation = {
  key: string
  period: string
  kind: MoneyKind
  amountMajor: string
  dueDate: string
  /** Negative once the due date has passed. */
  daysLeft: number
  overdue: boolean
  isCurrentPeriod: boolean
}

export type MyUtilityBill = {
  billId: string
  name: string
  amountMajor: string
  billTotalMajor: string
  isSplit: boolean
  providerName: string | null
  customerNumber: string | null
  paymentLink: string | null
  note: string | null
}

export type PaymentWindow = {
  kind: MoneyKind
  startDate: string
  endDate: string
}

export type HomeStatus = 'overdue' | 'due' | 'clear'

export type HomeModel = {
  period: string
  today: string
  status: HomeStatus
  obligations: Obligation[]
  totalDueMajor: string
  /** Kinds already paid in full this period, for the "all clear" state. */
  paidThisPeriod: { kind: MoneyKind; amountMajor: string }[]
  next: (PaymentWindow & { estimateMajor: string | null }) | null
  /** Windows that overlap the current period month, for the month strip. */
  windows: PaymentWindow[]
  myBills: MyUtilityBill[]
  utilityBreakdown: { shareMajor: string; buysMajor: string; targetMajor: string } | null
  rentDestinations: readonly MiniAppRentPaymentDestination[]
  /** My shared-purchase balance. Positive: I owe the house. Negative: the house owes me. */
  buysBalanceMajor: string
  buysDirection: 'owe' | 'owed' | 'even'
  buysSettleThrough: 'utilities' | 'rent' | 'direct'
}

const DAY_MS = 86_400_000

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** `day` of `period`, clamped to the month's length, shifted by `monthOffset` months. */
export function periodDate(period: string, day: number, monthOffset = 0): string {
  const parsed = parsePeriod(period)
  if (!parsed) return `${period}-${pad(day)}`
  const base = new Date(Date.UTC(parsed.year, parsed.month - 1 + monthOffset, 1))
  const year = base.getUTCFullYear()
  const month = base.getUTCMonth() + 1
  const safeDay = Math.max(1, Math.min(day, daysInMonth(year, month)))
  return `${year}-${pad(month)}-${pad(safeDay)}`
}

export function dateValue(date: string): number {
  const [year, month, day] = date.split('-').map((part) => Number.parseInt(part, 10))
  return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1)
}

export function daysBetween(from: string, to: string): number {
  return Math.round((dateValue(to) - dateValue(from)) / DAY_MS)
}

function shiftPeriod(period: string, delta: number): string {
  return periodDate(period, 1, delta).slice(0, 7)
}

/** The utilities window can start in the month before the one it bills. */
export function paymentWindows(
  dashboard: Pick<
    MiniAppDashboard,
    'utilitiesReminderDay' | 'utilitiesDueDay' | 'rentWarningDay' | 'rentDueDay'
  >,
  period: string
): PaymentWindow[] {
  const utilitiesStartOffset = dashboard.utilitiesReminderDay > dashboard.utilitiesDueDay ? -1 : 0
  return [
    {
      kind: 'utilities',
      startDate: periodDate(period, dashboard.utilitiesReminderDay, utilitiesStartOffset),
      endDate: periodDate(period, dashboard.utilitiesDueDay)
    },
    {
      kind: 'rent',
      startDate: periodDate(period, dashboard.rentWarningDay),
      endDate: periodDate(period, dashboard.rentDueDay)
    }
  ]
}

function dueDateFor(dashboard: MiniAppDashboard, period: string, kind: MoneyKind): string {
  if (period === dashboard.period) {
    if (kind === 'rent' && dashboard.rentBillingState.dueDate) {
      return dashboard.rentBillingState.dueDate
    }
    if (kind === 'utilities' && dashboard.utilityBillingPlan?.dueDate) {
      return dashboard.utilityBillingPlan.dueDate
    }
  }
  return periodDate(period, kind === 'rent' ? dashboard.rentDueDay : dashboard.utilitiesDueDay)
}

export type BuysSummary = Pick<
  HomeModel,
  'buysBalanceMajor' | 'buysDirection' | 'buysSettleThrough'
>

/** My shared-purchase balance and how it gets settled under the house policy. */
export function buysSummary(dashboard: MiniAppDashboard, memberId: string): BuysSummary {
  const balance =
    dashboard.members.find((member) => member.memberId === memberId)?.purchaseOffsetMajor ?? '0.00'
  const minor = majorStringToMinor(balance)
  const policy = dashboard.paymentBalanceAdjustmentPolicy
  return {
    buysBalanceMajor: balance,
    buysDirection: minor > 0n ? 'owe' : minor < 0n ? 'owed' : 'even',
    buysSettleThrough: policy === 'separate' ? 'direct' : policy === 'rent' ? 'rent' : 'utilities'
  }
}

function sameName(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}

export function buildHomeModel(input: {
  dashboard: MiniAppDashboard
  memberId: string
  today: CalendarDateParts
}): HomeModel {
  const { dashboard, memberId } = input
  const today = `${input.today.year}-${pad(input.today.month)}-${pad(input.today.day)}`
  const period = dashboard.period

  const obligations: Obligation[] = []
  for (const summary of dashboard.paymentPeriods ?? []) {
    for (const kind of summary.kinds) {
      const mine = kind.unresolvedMembers.find((row) => row.memberId === memberId)
      if (!mine || mine.effectivelySettled) continue
      if (majorStringToMinor(mine.remainingMajor) <= 0n) continue

      const dueDate = dueDateFor(dashboard, summary.period, kind.kind)
      const daysLeft = daysBetween(today, dueDate)
      obligations.push({
        key: `${summary.period}:${kind.kind}`,
        period: summary.period,
        kind: kind.kind,
        amountMajor: mine.remainingMajor,
        dueDate,
        daysLeft,
        overdue: daysLeft < 0 || !summary.isCurrentPeriod,
        isCurrentPeriod: summary.isCurrentPeriod
      })
    }
  }
  obligations.sort((left, right) => {
    if (left.overdue !== right.overdue) return left.overdue ? -1 : 1
    return left.dueDate.localeCompare(right.dueDate) || left.kind.localeCompare(right.kind)
  })

  const totalDueMinor = obligations.reduce(
    (sum, obligation) => sum + majorStringToMinor(obligation.amountMajor),
    0n
  )
  const status: HomeStatus = obligations.some((obligation) => obligation.overdue)
    ? 'overdue'
    : obligations.length > 0
      ? 'due'
      : 'clear'

  const me = dashboard.members.find((member) => member.memberId === memberId) ?? null

  /* Paid this period */
  const paidThisPeriod: HomeModel['paidThisPeriod'] = []
  const owesKind = (kind: MoneyKind) =>
    obligations.some((obligation) => obligation.isCurrentPeriod && obligation.kind === kind)
  const rentPaid = majorStringToMinor(
    dashboard.rentBillingState.memberSummaries.find((row) => row.memberId === memberId)
      ?.paidMajor ?? '0.00'
  )
  const utilitiesPaid = majorStringToMinor(
    dashboard.utilityBillingPlan?.memberSummaries.find((row) => row.memberId === memberId)
      ?.vendorPaidMajor ?? '0.00'
  )
  if (utilitiesPaid > 0n && !owesKind('utilities')) {
    paidThisPeriod.push({ kind: 'utilities', amountMajor: minorToMajorString(utilitiesPaid) })
  }
  if (rentPaid > 0n && !owesKind('rent')) {
    paidThisPeriod.push({ kind: 'rent', amountMajor: minorToMajorString(rentPaid) })
  }

  /* Next window that has not opened yet */
  const windows = paymentWindows(dashboard, period)
  const upcoming = [...windows, ...paymentWindows(dashboard, shiftPeriod(period, 1))]
    .filter((window) => window.startDate > today)
    .sort((left, right) => left.startDate.localeCompare(right.startDate))
  const nextWindow = upcoming.find((window) => !owesKind(window.kind)) ?? null
  const next = nextWindow
    ? {
        ...nextWindow,
        estimateMajor:
          nextWindow.kind === 'rent' && nextWindow.startDate.startsWith(period)
            ? (me?.rentShareMajor ?? null)
            : null
      }
    : null

  /* Bills I pay directly this period */
  const plan = dashboard.utilityBillingPlan
  const categoryInfo = dashboard.utilityCategories ?? []
  const myBills: MyUtilityBill[] = (plan?.status === 'settled' ? [] : (plan?.categories ?? []))
    .filter(
      (category) =>
        category.assignedMemberId === memberId &&
        majorStringToMinor(category.remainingAmountMajor) > 0n
    )
    .map((category) => {
      const info = categoryInfo.find((entry) => sameName(entry.name, category.billName))
      return {
        billId: category.utilityBillId,
        name: category.billName,
        amountMajor: category.remainingAmountMajor,
        billTotalMajor: category.billTotalMajor,
        isSplit: !category.isFullAssignment,
        providerName: info?.providerName ?? null,
        customerNumber: info?.customerNumber ?? null,
        paymentLink: info?.paymentLink ?? null,
        note: info?.note ?? null
      }
    })

  /* Why my utilities number is what it is */
  const buysMinor = majorStringToMinor(me?.purchaseOffsetMajor ?? '0.00')
  const policy = dashboard.paymentBalanceAdjustmentPolicy
  const shareMinor = majorStringToMinor(me?.utilityShareMajor ?? '0.00')
  const utilityBreakdown =
    me && policy === 'utilities' && buysMinor !== 0n && owesKind('utilities')
      ? {
          shareMajor: me.utilityShareMajor,
          buysMajor: me.purchaseOffsetMajor,
          targetMajor: minorToMajorString(shareMinor + buysMinor > 0n ? shareMinor + buysMinor : 0n)
        }
      : null

  return {
    period,
    today,
    status,
    obligations,
    totalDueMajor: minorToMajorString(totalDueMinor),
    paidThisPeriod,
    next,
    windows,
    myBills,
    utilityBreakdown,
    rentDestinations:
      dashboard.rentBillingState.paymentDestinations ?? dashboard.rentPaymentDestinations ?? [],
    ...buysSummary(dashboard, memberId)
  }
}
