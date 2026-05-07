import { majorStringToMinor, minorToMajorString } from './money'
import type { MiniAppDashboard } from '../miniapp-api'

export type UtilityBillingPlan = NonNullable<MiniAppDashboard['utilityBillingPlan']>
export type UtilityPlanMemberSummary = UtilityBillingPlan['memberSummaries'][number]
export type UtilityPlanCategory = UtilityBillingPlan['categories'][number]
export type PaymentPeriodSummary = NonNullable<MiniAppDashboard['paymentPeriods']>[number]

export interface UtilityPlanMemberRow extends UtilityPlanMemberSummary {
  categories: readonly UtilityPlanCategory[]
  isCurrent: boolean
  hasPendingAssignment: boolean
  carryForwardCreditMajor: string
  effectivePurchaseBalanceMajor: string
}

export interface UtilityPlanTotals {
  assignedTotalMajor: string
  paidTotalMajor: string
  remainingTotalMajor: string
  carryForwardCreditMajor: string
}

export interface UtilityPlanOutcomeRow {
  memberId: string
  displayName: string
  amountMajor: string
}

export interface PaymentQueueGroup {
  period: string
  kind: 'rent' | 'utilities'
  totalDueMajor: string
  totalPaidMajor: string
  totalRemainingMajor: string
  hasOverdueBalance: boolean
  isCurrentPeriod: boolean
  unresolvedMembers: PaymentPeriodSummary['kinds'][number]['unresolvedMembers']
}

export function hasUtilityPlanAssignments(plan: UtilityBillingPlan | null | undefined): boolean {
  return (
    plan?.memberSummaries.some(
      (summary) => majorStringToMinor(summary.assignedThisCycleMajor) > 0n
    ) ?? false
  )
}

export function isUtilityPlanActionable(plan: UtilityBillingPlan | null | undefined): boolean {
  return Boolean(plan && (plan.status !== 'settled' || hasUtilityPlanAssignments(plan)))
}

export function isSettledQuietPlan(data: MiniAppDashboard): boolean {
  return data.billingStage === 'idle' && data.utilityBillingPlan?.status === 'settled'
}

export function utilityPlanTotals(
  plan: UtilityBillingPlan,
  members: readonly MiniAppDashboard['members'][number][]
): UtilityPlanTotals {
  const assignedTotalMinor = plan.categories.reduce(
    (sum, category) => sum + majorStringToMinor(category.assignedAmountMajor),
    0n
  )
  const paidTotalMinor = plan.memberSummaries.reduce(
    (sum, summary) => sum + majorStringToMinor(summary.vendorPaidMajor),
    0n
  )
  const remainingTotalMinor = plan.memberSummaries.reduce(
    (sum, summary) => sum + majorStringToMinor(summary.assignedThisCycleMajor),
    0n
  )
  const carryForwardCreditMinor = members.reduce(
    (sum, member) => sum + majorStringToMinor(member.carryForwardCreditMajor ?? '0.00'),
    0n
  )

  return {
    assignedTotalMajor: minorToMajorString(assignedTotalMinor),
    paidTotalMajor: minorToMajorString(paidTotalMinor),
    remainingTotalMajor: minorToMajorString(remainingTotalMinor),
    carryForwardCreditMajor: minorToMajorString(carryForwardCreditMinor)
  }
}

export function utilityPlanMemberRows(input: {
  plan: UtilityBillingPlan
  members: readonly MiniAppDashboard['members'][number][]
  currentMemberId: string | null
  mode: 'action' | 'snapshot'
}): UtilityPlanMemberRow[] {
  const categoriesByMemberId = new Map<string, UtilityPlanCategory[]>()
  for (const summary of input.plan.memberSummaries) {
    categoriesByMemberId.set(
      summary.memberId,
      input.plan.categories.filter((category) => category.assignedMemberId === summary.memberId)
    )
  }

  const memberById = new Map(input.members.map((member) => [member.memberId, member]))
  const currentHasPending =
    input.currentMemberId !== null &&
    input.plan.memberSummaries.some(
      (summary) =>
        summary.memberId === input.currentMemberId &&
        majorStringToMinor(summary.assignedThisCycleMajor) > 0n
    )

  return [...input.plan.memberSummaries]
    .map((summary) => {
      const member = memberById.get(summary.memberId)
      const hasPendingAssignment = majorStringToMinor(summary.assignedThisCycleMajor) > 0n

      return {
        ...summary,
        categories: categoriesByMemberId.get(summary.memberId) ?? [],
        isCurrent: summary.memberId === input.currentMemberId,
        hasPendingAssignment,
        carryForwardCreditMajor: member?.carryForwardCreditMajor ?? '0.00',
        effectivePurchaseBalanceMajor:
          member?.effectivePurchaseBalanceMajor ?? member?.purchaseOffsetMajor ?? '0.00'
      }
    })
    .sort((left, right) => {
      if (input.mode === 'action') {
        if (currentHasPending && left.isCurrent !== right.isCurrent) {
          return left.isCurrent ? -1 : 1
        }
        if (left.hasPendingAssignment !== right.hasPendingAssignment) {
          return left.hasPendingAssignment ? -1 : 1
        }
      }

      return left.displayName.localeCompare(right.displayName)
    })
}

export function utilityPlanSnapshotOutcomes(input: {
  plan: UtilityBillingPlan
  members: readonly MiniAppDashboard['members'][number][]
}): UtilityPlanOutcomeRow[] {
  const memberById = new Map(input.members.map((member) => [member.memberId, member]))
  const rows: UtilityPlanOutcomeRow[] = []

  for (const summary of input.plan.memberSummaries) {
    const carryForwardMinor = majorStringToMinor(
      memberById.get(summary.memberId)?.carryForwardCreditMajor ?? '0.00'
    )
    if (carryForwardMinor > 0n) {
      rows.push({
        memberId: summary.memberId,
        displayName: summary.displayName,
        amountMajor: minorToMajorString(carryForwardMinor)
      })
    }
  }

  return rows.sort((left, right) => left.displayName.localeCompare(right.displayName))
}

export function paymentQueueGroups(
  periods: readonly PaymentPeriodSummary[] | undefined
): PaymentQueueGroup[] {
  const groups: PaymentQueueGroup[] = []

  for (const period of periods ?? []) {
    for (const kind of period.kinds) {
      const unresolvedMembers = kind.unresolvedMembers.filter(
        (member) => majorStringToMinor(member.remainingMajor) > 0n
      )
      if (unresolvedMembers.length === 0 || majorStringToMinor(kind.totalRemainingMajor) <= 0n) {
        continue
      }

      groups.push({
        period: period.period,
        kind: kind.kind,
        totalDueMajor: kind.totalDueMajor,
        totalPaidMajor: kind.totalPaidMajor,
        totalRemainingMajor: kind.totalRemainingMajor,
        hasOverdueBalance: period.hasOverdueBalance,
        isCurrentPeriod: period.isCurrentPeriod,
        unresolvedMembers
      })
    }
  }

  return groups.sort((left, right) => {
    const leftPriority =
      left.hasOverdueBalance && !left.isCurrentPeriod ? 0 : left.isCurrentPeriod ? 1 : 2
    const rightPriority =
      right.hasOverdueBalance && !right.isCurrentPeriod ? 0 : right.isCurrentPeriod ? 1 : 2

    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority
    }

    if (left.period !== right.period) {
      return leftPriority === 0
        ? left.period.localeCompare(right.period)
        : right.period.localeCompare(left.period)
    }

    return left.kind.localeCompare(right.kind)
  })
}
