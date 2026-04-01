import { Money, type CurrencyCode } from '@household/domain'
import type {
  FinanceUtilityBillingPlanPayload,
  FinanceUtilityBillingPlanRecord,
  FinanceUtilityBillingPlanStatus
} from '@household/ports'

export interface UtilityBillingTargetMember {
  memberId: string
  displayName: string
  fairShare: Money
}

export interface UtilityBillingBill {
  utilityBillId: string
  billName: string
  amount: Money
}

export interface UtilityVendorPaymentFactInput {
  utilityBillId: string | null
  billName: string
  payerMemberId: string
  amount: Money
}

export interface UtilityBillingCategoryAssignment {
  utilityBillId: string
  billName: string
  billTotal: Money
  assignedAmount: Money
  assignedMemberId: string
  paidAmount: Money
  isFullAssignment: boolean
  splitGroupId: string | null
}

export interface UtilityBillingMemberSummary {
  memberId: string
  fairShare: Money
  vendorPaid: Money
  assignedThisCycle: Money
  projectedDeltaAfterPlan: Money
}

export interface UtilityBillingPlanComputed {
  status: FinanceUtilityBillingPlanStatus
  maxCategoriesPerMemberApplied: number
  categories: readonly UtilityBillingCategoryAssignment[]
  memberSummaries: readonly UtilityBillingMemberSummary[]
  fairShareByMember: readonly {
    memberId: string
    amount: Money
  }[]
}

export type UtilityBillingPlanStrategy = 'same_cycle' | 'whole_bills_first'

interface SearchBill {
  utilityBillId: string
  billName: string
  billTotalMinor: bigint
  paidAmountMinor: bigint
  remainingMinor: bigint
}

interface SearchAssignment {
  bill: SearchBill
  assignedMemberId: string
  assignedAmountMinor: bigint
}

interface SearchResult {
  assignments: readonly SearchAssignment[]
  maxCategoriesPerMemberApplied: number
  memberSummaries: readonly UtilityBillingMemberSummary[]
}

type LegacyFinanceUtilityBillingPlanPayload = {
  fairShareByMember?: readonly {
    memberId: string
    amountMinor: string
  }[]
  categories?: readonly {
    utilityBillId: string
    billName: string
    amountMinor: string
    assignedMemberId: string
    paidAmountMinor: string
    fullCategoryPayment?: boolean
    splitSourceBillId?: string | null
  }[]
  memberSummaries?: readonly {
    memberId: string
    fairShareMinor: string
    vendorPaidMinor: string
    assignedVendorMinor?: string
    effectiveTargetMinor?: string
    carryoverBeforeMinor?: string
    carryoverAfterMinor?: string
  }[]
}

function absMinor(value: bigint): bigint {
  return value < 0n ? -value : value
}

function maxMinor(left: bigint, right: bigint): bigint {
  return left > right ? left : right
}

function toMinorString(value: Money): string {
  return value.amountMinor.toString()
}

function candidatePaidByBill(
  bills: readonly UtilityBillingBill[],
  facts: readonly UtilityVendorPaymentFactInput[]
): ReadonlyMap<string, bigint> {
  const amounts = new Map<string, bigint>()
  const billNameToId = new Map(
    bills.map((bill) => [bill.billName.trim().toLowerCase(), bill.utilityBillId] as const)
  )

  for (const fact of facts) {
    const billId =
      fact.utilityBillId ?? billNameToId.get(fact.billName.trim().toLowerCase()) ?? null
    if (!billId) {
      continue
    }

    amounts.set(billId, (amounts.get(billId) ?? 0n) + fact.amount.amountMinor)
  }

  return amounts
}

function summarizeMembers(input: {
  currency: CurrencyCode
  members: readonly UtilityBillingTargetMember[]
  vendorPaidByMemberId: ReadonlyMap<string, bigint>
  assignedThisCycleByMemberId: ReadonlyMap<string, bigint>
}): readonly UtilityBillingMemberSummary[] {
  return input.members.map((member) => {
    const vendorPaidMinor = input.vendorPaidByMemberId.get(member.memberId) ?? 0n
    const assignedThisCycleMinor = input.assignedThisCycleByMemberId.get(member.memberId) ?? 0n
    const projectedDeltaAfterPlanMinor =
      vendorPaidMinor + assignedThisCycleMinor - member.fairShare.amountMinor

    return {
      memberId: member.memberId,
      fairShare: member.fairShare,
      vendorPaid: Money.fromMinor(vendorPaidMinor, input.currency),
      assignedThisCycle: Money.fromMinor(assignedThisCycleMinor, input.currency),
      projectedDeltaAfterPlan: Money.fromMinor(projectedDeltaAfterPlanMinor, input.currency)
    }
  })
}

function buildSearchBills(input: {
  bills: readonly UtilityBillingBill[]
  paidByBillId: ReadonlyMap<string, bigint>
}): readonly SearchBill[] {
  return input.bills
    .map((bill) => {
      const paidAmountMinor = input.paidByBillId.get(bill.utilityBillId) ?? 0n
      return {
        utilityBillId: bill.utilityBillId,
        billName: bill.billName,
        billTotalMinor: bill.amount.amountMinor,
        paidAmountMinor,
        remainingMinor: bill.amount.amountMinor - paidAmountMinor
      }
    })
    .filter((bill) => bill.remainingMinor > 0n)
    .sort((left, right) => {
      if (left.remainingMinor === right.remainingMinor) {
        return left.billName.localeCompare(right.billName)
      }

      return left.remainingMinor > right.remainingMinor ? -1 : 1
    })
}

function assignmentLexicalKey(assignments: readonly SearchAssignment[]): string {
  return [...assignments]
    .sort((left, right) => {
      if (left.bill.utilityBillId !== right.bill.utilityBillId) {
        return left.bill.utilityBillId.localeCompare(right.bill.utilityBillId)
      }

      if (left.assignedMemberId !== right.assignedMemberId) {
        return left.assignedMemberId.localeCompare(right.assignedMemberId)
      }

      if (left.assignedAmountMinor === right.assignedAmountMinor) {
        return 0
      }

      return left.assignedAmountMinor > right.assignedAmountMinor ? -1 : 1
    })
    .map(
      (assignment) =>
        `${assignment.bill.utilityBillId}:${assignment.assignedMemberId}:${assignment.assignedAmountMinor.toString()}`
    )
    .join('|')
}

function permuteMemberIndexes(count: number): readonly number[][] {
  const results: number[][] = []
  const indexes = Array.from({ length: count }, (_, index) => index)

  const recurse = (current: number[], remaining: number[]) => {
    if (remaining.length === 0) {
      results.push(current)
      return
    }

    for (let index = 0; index < remaining.length; index += 1) {
      recurse(
        [...current, remaining[index]!],
        remaining.filter((_, candidateIndex) => candidateIndex !== index)
      )
    }
  }

  recurse([], indexes)
  return results
}

function generateAllocationCandidates(input: {
  bill: SearchBill
  members: readonly UtilityBillingTargetMember[]
  vendorPaidByMemberId: ReadonlyMap<string, bigint>
  assignedThisCycleByMemberId: ReadonlyMap<string, bigint>
}): readonly ReadonlyMap<string, bigint>[] {
  const candidates = new Map<string, ReadonlyMap<string, bigint>>()
  const permutations = permuteMemberIndexes(input.members.length)

  for (const permutation of permutations) {
    for (
      let participantCount = 1;
      participantCount <= input.members.length;
      participantCount += 1
    ) {
      let remainingMinor = input.bill.remainingMinor
      const allocation = new Map<string, bigint>()

      for (let index = 0; index < participantCount && remainingMinor > 0n; index += 1) {
        const member = input.members[permutation[index]!]!
        const amountMinor =
          index === participantCount - 1
            ? remainingMinor
            : (() => {
                const alreadyCommittedMinor =
                  (input.vendorPaidByMemberId.get(member.memberId) ?? 0n) +
                  (input.assignedThisCycleByMemberId.get(member.memberId) ?? 0n)
                const remainingTargetMinor = member.fairShare.amountMinor - alreadyCommittedMinor
                if (remainingTargetMinor <= 0n) {
                  return 0n
                }
                return remainingTargetMinor >= remainingMinor
                  ? remainingMinor
                  : remainingTargetMinor
              })()

        if (amountMinor <= 0n) {
          continue
        }

        allocation.set(member.memberId, amountMinor)
        remainingMinor -= amountMinor
      }

      if (remainingMinor !== 0n || allocation.size === 0) {
        continue
      }

      const key = [...allocation.entries()]
        .sort(([leftMemberId], [rightMemberId]) => leftMemberId.localeCompare(rightMemberId))
        .map(([memberId, amountMinor]) => `${memberId}:${amountMinor.toString()}`)
        .join('|')
      if (!candidates.has(key)) {
        candidates.set(key, allocation)
      }
    }
  }

  return [...candidates.values()]
}

function compareScore(
  left: readonly [bigint, bigint, number, number, number, number, string],
  right: readonly [bigint, bigint, number, number, number, number, string]
): number {
  for (let index = 0; index < left.length - 1; index += 1) {
    const leftValue = left[index]!
    const rightValue = right[index]!
    if (leftValue === rightValue) {
      continue
    }

    return leftValue < rightValue ? -1 : 1
  }

  return (left[left.length - 1] as string).localeCompare(right[right.length - 1] as string)
}

function compareStrategyScore(
  strategy: UtilityBillingPlanStrategy,
  left: readonly [bigint, bigint, number, number, number, number, string],
  right: readonly [bigint, bigint, number, number, number, number, string]
): number {
  if (strategy === 'same_cycle') {
    return compareScore(left, right)
  }

  const remap = (
    score: readonly [bigint, bigint, number, number, number, number, string]
  ): readonly [number, number, number, bigint, bigint, number, string] => [
    score[2],
    score[3],
    score[4],
    score[0],
    score[1],
    score[5],
    score[6]
  ]

  const leftMapped = remap(left)
  const rightMapped = remap(right)

  for (let index = 0; index < leftMapped.length - 1; index += 1) {
    const leftValue = leftMapped[index]!
    const rightValue = rightMapped[index]!
    if (leftValue === rightValue) {
      continue
    }

    return leftValue < rightValue ? -1 : 1
  }

  return (leftMapped[leftMapped.length - 1] as string).localeCompare(
    rightMapped[rightMapped.length - 1] as string
  )
}

function searchAssignments(input: {
  currency: CurrencyCode
  members: readonly UtilityBillingTargetMember[]
  vendorPaidByMemberId: ReadonlyMap<string, bigint>
  bills: readonly SearchBill[]
  strategy: UtilityBillingPlanStrategy
}): SearchResult | null {
  if (input.members.length === 0) {
    return null
  }

  let bestScore: readonly [bigint, bigint, number, number, number, number, string] | null = null
  let bestResult: SearchResult | null = null

  const assignedActionCount = new Map<string, number>()
  const assignedThisCycleByMemberId = new Map<string, bigint>()
  const assignments: SearchAssignment[] = []

  const finalize = () => {
    const memberSummaries = summarizeMembers({
      currency: input.currency,
      members: input.members,
      vendorPaidByMemberId: input.vendorPaidByMemberId,
      assignedThisCycleByMemberId
    })
    const maxFrontingMinor = memberSummaries.reduce(
      (max, summary) => maxMinor(max, maxMinor(summary.projectedDeltaAfterPlan.amountMinor, 0n)),
      0n
    )
    const totalAbsDeviationMinor = memberSummaries.reduce(
      (sum, summary) => sum + absMinor(summary.projectedDeltaAfterPlan.amountMinor),
      0n
    )
    const splitCategoryCount = new Set(
      input.bills
        .filter(
          (bill) =>
            assignments.filter((assignment) => assignment.bill.utilityBillId === bill.utilityBillId)
              .length > 1
        )
        .map((bill) => bill.utilityBillId)
    ).size
    const actionCounts = input.members.map(
      (member) => assignedActionCount.get(member.memberId) ?? 0
    )
    const excessActionCount = actionCounts.reduce((sum, count) => sum + Math.max(0, count - 2), 0)
    const maxActionsPerMember = actionCounts.reduce((max, count) => (count > max ? count : max), 0)
    const totalActions = actionCounts.reduce((sum, count) => sum + count, 0)
    const lexical = assignmentLexicalKey(assignments)
    const score: readonly [bigint, bigint, number, number, number, number, string] = [
      maxFrontingMinor,
      totalAbsDeviationMinor,
      splitCategoryCount,
      excessActionCount,
      maxActionsPerMember,
      totalActions,
      lexical
    ]

    if (!bestScore || compareStrategyScore(input.strategy, score, bestScore) < 0) {
      bestScore = score
      bestResult = {
        assignments: [...assignments],
        maxCategoriesPerMemberApplied: maxActionsPerMember,
        memberSummaries
      }
    }
  }

  const recurse = (index: number) => {
    if (index >= input.bills.length) {
      finalize()
      return
    }

    const bill = input.bills[index]!
    const candidates = generateAllocationCandidates({
      bill,
      members: input.members,
      vendorPaidByMemberId: input.vendorPaidByMemberId,
      assignedThisCycleByMemberId
    })

    for (const candidate of candidates) {
      const appliedMembers: string[] = []
      for (const [memberId, amountMinor] of candidate.entries()) {
        assignedActionCount.set(memberId, (assignedActionCount.get(memberId) ?? 0) + 1)
        assignedThisCycleByMemberId.set(
          memberId,
          (assignedThisCycleByMemberId.get(memberId) ?? 0n) + amountMinor
        )
        assignments.push({
          bill,
          assignedMemberId: memberId,
          assignedAmountMinor: amountMinor
        })
        appliedMembers.push(memberId)
      }

      recurse(index + 1)

      for (let reverseIndex = assignments.length - 1; reverseIndex >= 0; reverseIndex -= 1) {
        if (assignments[reverseIndex]!.bill.utilityBillId !== bill.utilityBillId) {
          break
        }
        assignments.pop()
      }

      for (const memberId of appliedMembers) {
        const amountMinor = candidate.get(memberId) ?? 0n
        assignedThisCycleByMemberId.set(
          memberId,
          (assignedThisCycleByMemberId.get(memberId) ?? 0n) - amountMinor
        )
        const nextCount = (assignedActionCount.get(memberId) ?? 0) - 1
        if (nextCount <= 0) {
          assignedActionCount.delete(memberId)
        } else {
          assignedActionCount.set(memberId, nextCount)
        }
      }
    }
  }

  recurse(0)
  return bestResult
}

export function computeUtilityBillingPlan(input: {
  currency: CurrencyCode
  members: readonly UtilityBillingTargetMember[]
  bills: readonly UtilityBillingBill[]
  vendorPayments: readonly UtilityVendorPaymentFactInput[]
  strategy?: UtilityBillingPlanStrategy
}): UtilityBillingPlanComputed {
  const paidByBillId = candidatePaidByBill(input.bills, input.vendorPayments)
  const vendorPaidByMemberId = new Map<string, bigint>()

  for (const fact of input.vendorPayments) {
    vendorPaidByMemberId.set(
      fact.payerMemberId,
      (vendorPaidByMemberId.get(fact.payerMemberId) ?? 0n) + fact.amount.amountMinor
    )
  }

  const searchBills = buildSearchBills({
    bills: input.bills,
    paidByBillId
  })
  const emptySummary = summarizeMembers({
    currency: input.currency,
    members: input.members,
    vendorPaidByMemberId,
    assignedThisCycleByMemberId: new Map<string, bigint>()
  })

  if (searchBills.length === 0) {
    return {
      status: 'settled',
      maxCategoriesPerMemberApplied: 0,
      categories: [],
      memberSummaries: emptySummary,
      fairShareByMember: input.members.map((member) => ({
        memberId: member.memberId,
        amount: member.fairShare
      }))
    }
  }

  const best = searchAssignments({
    currency: input.currency,
    members: input.members,
    vendorPaidByMemberId,
    bills: searchBills,
    strategy: input.strategy ?? 'same_cycle'
  })

  if (!best) {
    return {
      status: 'settled',
      maxCategoriesPerMemberApplied: 0,
      categories: [],
      memberSummaries: emptySummary,
      fairShareByMember: input.members.map((member) => ({
        memberId: member.memberId,
        amount: member.fairShare
      }))
    }
  }

  const assignmentCountByBillId = best.assignments.reduce((counts, assignment) => {
    counts.set(assignment.bill.utilityBillId, (counts.get(assignment.bill.utilityBillId) ?? 0) + 1)
    return counts
  }, new Map<string, number>())

  return {
    status: best.assignments.length === 0 ? 'settled' : 'active',
    maxCategoriesPerMemberApplied: best.maxCategoriesPerMemberApplied,
    categories: best.assignments.map((assignment) => ({
      utilityBillId: assignment.bill.utilityBillId,
      billName: assignment.bill.billName,
      billTotal: Money.fromMinor(assignment.bill.billTotalMinor, input.currency),
      assignedAmount: Money.fromMinor(assignment.assignedAmountMinor, input.currency),
      assignedMemberId: assignment.assignedMemberId,
      paidAmount: Money.fromMinor(assignment.bill.paidAmountMinor, input.currency),
      isFullAssignment: (assignmentCountByBillId.get(assignment.bill.utilityBillId) ?? 0) === 1,
      splitGroupId:
        (assignmentCountByBillId.get(assignment.bill.utilityBillId) ?? 0) > 1
          ? assignment.bill.utilityBillId
          : null
    })),
    memberSummaries: best.memberSummaries,
    fairShareByMember: input.members.map((member) => ({
      memberId: member.memberId,
      amount: member.fairShare
    }))
  }
}

export function serializeUtilityBillingPlanPayload(
  plan: UtilityBillingPlanComputed
): FinanceUtilityBillingPlanPayload {
  return {
    fairShareByMember: plan.fairShareByMember.map((member) => ({
      memberId: member.memberId,
      amountMinor: toMinorString(member.amount)
    })),
    categories: plan.categories.map((category) => ({
      utilityBillId: category.utilityBillId,
      billName: category.billName,
      billTotalMinor: toMinorString(category.billTotal),
      assignedAmountMinor: toMinorString(category.assignedAmount),
      assignedMemberId: category.assignedMemberId,
      paidAmountMinor: toMinorString(category.paidAmount),
      isFullAssignment: category.isFullAssignment,
      splitGroupId: category.splitGroupId
    })),
    memberSummaries: plan.memberSummaries.map((summary) => ({
      memberId: summary.memberId,
      fairShareMinor: toMinorString(summary.fairShare),
      vendorPaidMinor: toMinorString(summary.vendorPaid),
      assignedThisCycleMinor: toMinorString(summary.assignedThisCycle),
      projectedDeltaAfterPlanMinor: toMinorString(summary.projectedDeltaAfterPlan)
    }))
  }
}

function materializeLegacyCategoryPayload(input: {
  category: {
    utilityBillId: string
    billName: string
    amountMinor: string
    assignedMemberId: string
    paidAmountMinor: string
    fullCategoryPayment?: boolean
    splitSourceBillId?: string | null
  }
  currency: CurrencyCode
  billTotalMinorByBillId: ReadonlyMap<string, bigint>
}): UtilityBillingCategoryAssignment {
  const assignedAmount = Money.fromMinor(input.category.amountMinor, input.currency)
  return {
    utilityBillId: input.category.utilityBillId,
    billName: input.category.billName,
    billTotal: Money.fromMinor(
      input.billTotalMinorByBillId.get(input.category.utilityBillId) ?? input.category.amountMinor,
      input.currency
    ),
    assignedAmount,
    assignedMemberId: input.category.assignedMemberId,
    paidAmount: Money.fromMinor(input.category.paidAmountMinor, input.currency),
    isFullAssignment: input.category.fullCategoryPayment ?? true,
    splitGroupId: input.category.splitSourceBillId ?? null
  }
}

export function materializeUtilityBillingPlanRecord(
  record: FinanceUtilityBillingPlanRecord
): UtilityBillingPlanComputed {
  const currency = record.currency
  const payload = record.payload as
    | FinanceUtilityBillingPlanPayload
    | LegacyFinanceUtilityBillingPlanPayload

  const legacyCategories = (payload.categories ?? []) as NonNullable<
    LegacyFinanceUtilityBillingPlanPayload['categories']
  >
  const billTotalMinorByBillId = legacyCategories.reduce((totals, category) => {
    const assignedAmountMinor = BigInt(
      String(
        (category as { amountMinor?: string; assignedAmountMinor?: string }).amountMinor ??
          (category as { amountMinor?: string; assignedAmountMinor?: string })
            .assignedAmountMinor ??
          '0'
      )
    )
    totals.set(
      category.utilityBillId,
      (totals.get(category.utilityBillId) ?? BigInt(category.paidAmountMinor)) + assignedAmountMinor
    )
    return totals
  }, new Map<string, bigint>())

  return {
    status: record.status,
    maxCategoriesPerMemberApplied: record.maxCategoriesPerMemberApplied,
    categories: (payload.categories ?? []).map((category) => {
      const nextCategory = category as FinanceUtilityBillingPlanPayload['categories'][number] & {
        amountMinor?: string
        fullCategoryPayment?: boolean
        splitSourceBillId?: string | null
      }

      if ('assignedAmountMinor' in nextCategory && nextCategory.assignedAmountMinor !== undefined) {
        return {
          utilityBillId: nextCategory.utilityBillId,
          billName: nextCategory.billName,
          billTotal: Money.fromMinor(nextCategory.billTotalMinor, currency),
          assignedAmount: Money.fromMinor(nextCategory.assignedAmountMinor, currency),
          assignedMemberId: nextCategory.assignedMemberId,
          paidAmount: Money.fromMinor(nextCategory.paidAmountMinor, currency),
          isFullAssignment: nextCategory.isFullAssignment,
          splitGroupId: nextCategory.splitGroupId
        }
      }

      return materializeLegacyCategoryPayload({
        category: {
          utilityBillId: nextCategory.utilityBillId,
          billName: nextCategory.billName,
          amountMinor: String(nextCategory.amountMinor ?? nextCategory.assignedAmountMinor),
          assignedMemberId: nextCategory.assignedMemberId,
          paidAmountMinor: nextCategory.paidAmountMinor,
          ...(nextCategory.fullCategoryPayment === undefined
            ? {}
            : { fullCategoryPayment: nextCategory.fullCategoryPayment }),
          ...(nextCategory.splitSourceBillId === undefined
            ? {}
            : { splitSourceBillId: nextCategory.splitSourceBillId })
        },
        currency,
        billTotalMinorByBillId
      })
    }),
    memberSummaries: (payload.memberSummaries ?? []).map((summary) => {
      const nextSummary = summary as FinanceUtilityBillingPlanPayload['memberSummaries'][number] & {
        assignedVendorMinor?: string
      }

      if (
        'assignedThisCycleMinor' in nextSummary &&
        nextSummary.assignedThisCycleMinor !== undefined
      ) {
        return {
          memberId: nextSummary.memberId,
          fairShare: Money.fromMinor(nextSummary.fairShareMinor, currency),
          vendorPaid: Money.fromMinor(nextSummary.vendorPaidMinor, currency),
          assignedThisCycle: Money.fromMinor(nextSummary.assignedThisCycleMinor, currency),
          projectedDeltaAfterPlan: Money.fromMinor(
            nextSummary.projectedDeltaAfterPlanMinor,
            currency
          )
        }
      }

      const vendorPaidMinor = BigInt(nextSummary.vendorPaidMinor)
      const fairShareMinor = BigInt(nextSummary.fairShareMinor)
      const assignedVendorMinor = BigInt(
        nextSummary.assignedVendorMinor ?? nextSummary.vendorPaidMinor
      )

      return {
        memberId: nextSummary.memberId,
        fairShare: Money.fromMinor(fairShareMinor, currency),
        vendorPaid: Money.fromMinor(vendorPaidMinor, currency),
        assignedThisCycle: Money.fromMinor(assignedVendorMinor - vendorPaidMinor, currency),
        projectedDeltaAfterPlan: Money.fromMinor(assignedVendorMinor - fairShareMinor, currency)
      }
    }),
    fairShareByMember: (payload.fairShareByMember ?? []).map((member) => ({
      memberId: member.memberId,
      amount: Money.fromMinor(member.amountMinor, currency)
    }))
  }
}
