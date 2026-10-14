import type { MiniAppDashboard } from '@/api'
import type { CalendarDateParts } from '@/lib/dates'
import { majorStringToMinor, minorToMajorString } from '@/lib/money'
import { paymentWindows, type MoneyKind, type PaymentWindow } from '@/features/home/home-model'

/**
 * The house's month in one model: who owes what for utilities and rent, the bills
 * behind utilities, and anything still open from earlier months.
 *
 * Amounts still owed come from `paymentPeriods`, the same rows Home and the
 * server's "mark as paid" use, so a person's number is identical on every screen.
 */

type LedgerEntry = MiniAppDashboard['ledger'][number]
type VendorPayment = NonNullable<
  NonNullable<MiniAppDashboard['utilityBillingPlan']>['vendorPayments']
>[number]

export type MemberPayment = {
  memberId: string
  displayName: string
  isMe: boolean
  dueMajor: string
  paidMajor: string
  remainingMajor: string
  settled: boolean
}

export type KindStatus = {
  kind: MoneyKind
  window: PaymentWindow
  /** The window has started, so amounts are payable now. */
  opened: boolean
  /** The due date has passed with money still open. */
  late: boolean
  totalDueMajor: string
  totalPaidMajor: string
  totalRemainingMajor: string
  members: MemberPayment[]
  paidCount: number
}

export type BillAssignee = {
  memberId: string
  displayName: string
  amountMajor: string
  paidMajor: string
  remainingMajor: string
}

export type MonthBill = {
  id: string
  name: string
  amountMajor: string
  entry: LedgerEntry
  assignees: BillAssignee[]
  remainingMajor: string
  providerName: string | null
  customerNumber: string | null
  paymentLink: string | null
  vendorPayments: VendorPayment[]
}

export type EarlierDebt = {
  key: string
  period: string
  kind: MoneyKind
  memberId: string
  displayName: string
  isMe: boolean
  amountMajor: string
  dueMajor: string
  paidMajor: string
}

export type MonthModel = {
  period: string
  today: string
  utilities: KindStatus
  rent: KindStatus
  bills: MonthBill[]
  missingBills: string[]
  billsTotalMajor: string
  /** Plan lines can still be paid or redrawn. */
  planOpen: boolean
  earlier: EarlierDebt[]
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function minorSum(values: readonly string[]): bigint {
  return values.reduce((sum, value) => sum + majorStringToMinor(value), 0n)
}

function sameName(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}

function sortMembers(members: MemberPayment[]): MemberPayment[] {
  return [...members].sort((left, right) => {
    if (left.isMe !== right.isMe) return left.isMe ? -1 : 1
    if (left.settled !== right.settled) return left.settled ? 1 : -1
    return left.displayName.localeCompare(right.displayName)
  })
}

function kindStatus(input: {
  dashboard: MiniAppDashboard
  kind: MoneyKind
  memberId: string
  today: string
}): KindStatus {
  const { dashboard, kind, memberId, today } = input
  const window = paymentWindows(dashboard, dashboard.period).find((entry) => entry.kind === kind)!
  const current = (dashboard.paymentPeriods ?? []).find(
    (summary) => summary.period === dashboard.period
  )
  const rows = current?.kinds.find((entry) => entry.kind === kind)?.unresolvedMembers ?? []
  const plan = dashboard.utilityBillingPlan

  const members = dashboard.members
    .filter((member) => member.status !== 'left')
    .map((member): MemberPayment => {
      const row = rows.find(
        (entry) => entry.memberId === member.memberId && !entry.effectivelySettled
      )
      const remainingMinor = row ? majorStringToMinor(row.remainingMajor) : 0n

      let paidMinor: bigint
      if (row) {
        paidMinor = majorStringToMinor(row.paidMajor)
      } else if (kind === 'rent') {
        paidMinor = majorStringToMinor(
          dashboard.rentBillingState.memberSummaries.find(
            (summary) => summary.memberId === member.memberId
          )?.paidMajor ?? '0.00'
        )
      } else {
        // Receipts and provider marks can describe the same money; take the larger.
        const receipts = minorSum(
          dashboard.ledger
            .filter(
              (entry) =>
                entry.kind === 'payment' &&
                entry.paymentKind === 'utilities' &&
                entry.memberId === member.memberId
            )
            .map((entry) => entry.displayAmountMajor)
        )
        const vendor = majorStringToMinor(
          plan?.memberSummaries.find((summary) => summary.memberId === member.memberId)
            ?.vendorPaidMajor ?? '0.00'
        )
        paidMinor = receipts > vendor ? receipts : vendor
      }

      // Before rent opens the server lists nobody; show each share as what is coming.
      const upcomingRentMinor =
        kind === 'rent' && today < window.startDate && !row
          ? majorStringToMinor(
              dashboard.rentBillingState.memberSummaries.find(
                (summary) => summary.memberId === member.memberId
              )?.remainingMajor ?? '0.00'
            )
          : 0n
      const remaining = remainingMinor > 0n ? remainingMinor : upcomingRentMinor

      return {
        memberId: member.memberId,
        displayName: member.displayName,
        isMe: member.memberId === memberId,
        dueMajor: minorToMajorString(paidMinor + remaining),
        paidMajor: minorToMajorString(paidMinor),
        remainingMajor: minorToMajorString(remaining),
        settled: remaining === 0n
      }
    })

  const totalDue = minorSum(members.map((member) => member.dueMajor))
  const totalPaid = minorSum(members.map((member) => member.paidMajor))
  const totalRemaining = minorSum(members.map((member) => member.remainingMajor))

  return {
    kind,
    window,
    // The server lists utilities as soon as bills exist, before the window starts; those
    // rows are payable, so they count as open. Rent rows only appear once rent opens.
    opened: today >= window.startDate || (kind === 'utilities' && rows.length > 0),
    late: today > window.endDate && totalRemaining > 0n,
    totalDueMajor: minorToMajorString(totalDue),
    totalPaidMajor: minorToMajorString(totalPaid),
    totalRemainingMajor: minorToMajorString(totalRemaining),
    members: sortMembers(members),
    paidCount: members.filter(
      (member) => member.settled && majorStringToMinor(member.dueMajor) > 0n
    ).length
  }
}

export function buildMonthModel(input: {
  dashboard: MiniAppDashboard
  memberId: string
  today: CalendarDateParts
}): MonthModel {
  const { dashboard, memberId } = input
  const today = `${input.today.year}-${pad(input.today.month)}-${pad(input.today.day)}`
  const plan = dashboard.utilityBillingPlan
  const categories = dashboard.utilityCategories ?? []

  const billEntries = dashboard.ledger.filter((entry) => entry.kind === 'utility')
  const bills: MonthBill[] = billEntries.map((entry) => {
    const lines = (plan?.categories ?? []).filter((category) => category.utilityBillId === entry.id)
    const info = categories.find((category) => sameName(category.name, entry.title))
    return {
      id: entry.id,
      name: entry.title,
      amountMajor: entry.displayAmountMajor,
      entry,
      assignees: lines.map((line) => ({
        memberId: line.assignedMemberId,
        displayName: line.assignedDisplayName,
        amountMajor: line.assignedAmountMajor,
        paidMajor: line.paidAmountMajor,
        remainingMajor: line.remainingAmountMajor
      })),
      remainingMajor: minorToMajorString(minorSum(lines.map((line) => line.remainingAmountMajor))),
      providerName: info?.providerName ?? null,
      customerNumber: info?.customerNumber ?? null,
      paymentLink: info?.paymentLink ?? null,
      vendorPayments: (plan?.vendorPayments ?? []).filter(
        (payment) => payment.utilityBillId === entry.id
      )
    }
  })

  const missingBills = categories
    .filter((category) => !billEntries.some((entry) => sameName(entry.title, category.name)))
    .map((category) => category.name)

  const earlier: EarlierDebt[] = (dashboard.paymentPeriods ?? [])
    .filter((summary) => summary.period !== dashboard.period)
    .sort((left, right) => left.period.localeCompare(right.period))
    .flatMap((summary) =>
      summary.kinds.flatMap((kind) =>
        kind.unresolvedMembers
          .filter((row) => !row.effectivelySettled && majorStringToMinor(row.remainingMajor) > 0n)
          .map((row) => ({
            key: `${summary.period}:${kind.kind}:${row.memberId}`,
            period: summary.period,
            kind: kind.kind,
            memberId: row.memberId,
            displayName: row.displayName,
            isMe: row.memberId === memberId,
            amountMajor: row.remainingMajor,
            dueMajor: minorToMajorString(
              majorStringToMinor(row.paidMajor) + majorStringToMinor(row.remainingMajor)
            ),
            paidMajor: row.paidMajor
          }))
      )
    )

  return {
    period: dashboard.period,
    today,
    utilities: kindStatus({ dashboard, kind: 'utilities', memberId, today }),
    rent: kindStatus({ dashboard, kind: 'rent', memberId, today }),
    bills,
    missingBills,
    billsTotalMajor: minorToMajorString(minorSum(bills.map((bill) => bill.amountMajor))),
    planOpen: Boolean(plan && plan.status !== 'settled'),
    earlier
  }
}
