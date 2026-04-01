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
  carryoverBefore?: Money
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
  amount: Money
  assignedMemberId: string
  paidAmount: Money
  fullCategoryPayment: boolean
  splitSourceBillId: string | null
}

export interface UtilityBillingMemberSummary {
  memberId: string
  fairShare: Money
  vendorPaid: Money
  assignedVendor: Money
  effectiveTarget: Money
  carryoverBefore: Money
  carryoverAfter: Money
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

interface SearchBillPart {
  utilityBillId: string
  billName: string
  splitSourceBillId: string | null
  amountMinor: bigint
  fullCategoryPayment: boolean
}

interface SearchResult {
  assignments: readonly {
    part: SearchBillPart
    assignedMemberId: string
  }[]
  maxCategoriesPerMemberApplied: number
  memberSummaries: readonly UtilityBillingMemberSummary[]
}

function absMinor(value: bigint): bigint {
  return value < 0n ? -value : value
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
  assignedRemainingByMemberId: ReadonlyMap<string, bigint>
}): readonly UtilityBillingMemberSummary[] {
  return input.members.map((member) => {
    const vendorPaidMinor = input.vendorPaidByMemberId.get(member.memberId) ?? 0n
    const assignedRemainingMinor = input.assignedRemainingByMemberId.get(member.memberId) ?? 0n
    const assignedVendorMinor = vendorPaidMinor + assignedRemainingMinor
    const carryoverBefore = member.carryoverBefore ?? Money.zero(input.currency)
    const effectiveTargetMinor = member.fairShare.amountMinor + carryoverBefore.amountMinor

    return {
      memberId: member.memberId,
      fairShare: member.fairShare,
      vendorPaid: Money.fromMinor(vendorPaidMinor, input.currency),
      assignedVendor: Money.fromMinor(assignedVendorMinor, input.currency),
      effectiveTarget: Money.fromMinor(effectiveTargetMinor, input.currency),
      carryoverBefore,
      carryoverAfter: Money.fromMinor(effectiveTargetMinor - assignedVendorMinor, input.currency)
    }
  })
}

function buildSearchParts(input: {
  bills: readonly UtilityBillingBill[]
  paidByBillId: ReadonlyMap<string, bigint>
}): readonly SearchBillPart[] {
  const parts: SearchBillPart[] = []

  for (const bill of input.bills) {
    const paidMinor = input.paidByBillId.get(bill.utilityBillId) ?? 0n
    const remainingMinor = bill.amount.amountMinor - paidMinor

    if (remainingMinor <= 0n) {
      continue
    }

    parts.push({
      utilityBillId: bill.utilityBillId,
      billName: bill.billName,
      splitSourceBillId: null,
      amountMinor: remainingMinor,
      fullCategoryPayment: true
    })
  }

  return parts.sort((left, right) => {
    if (left.amountMinor === right.amountMinor) {
      return left.billName.localeCompare(right.billName)
    }

    return left.amountMinor > right.amountMinor ? -1 : 1
  })
}

function assignmentLexicalKey(
  assignments: readonly {
    part: SearchBillPart
    assignedMemberId: string
  }[]
): string {
  return assignments
    .map(
      (assignment) =>
        `${assignment.part.utilityBillId}:${assignment.assignedMemberId}:${assignment.part.amountMinor.toString()}`
    )
    .join('|')
}

function searchAssignments(input: {
  currency: CurrencyCode
  members: readonly UtilityBillingTargetMember[]
  vendorPaidByMemberId: ReadonlyMap<string, bigint>
  parts: readonly SearchBillPart[]
  maxCategoriesPerMemberApplied: number
}): SearchResult | null {
  if (input.members.length === 0) {
    return null
  }

  let bestScore: readonly [number, bigint, string] | null = null
  let bestResult: SearchResult | null = null

  const assignedCount = new Map<string, number>()
  const assignedMinor = new Map<string, bigint>()
  const assignments: Array<{ part: SearchBillPart; assignedMemberId: string }> = []

  const finalize = () => {
    const splitCategoryCount = new Set(
      assignments
        .filter((assignment) => !assignment.part.fullCategoryPayment)
        .map((assignment) => assignment.part.splitSourceBillId ?? assignment.part.utilityBillId)
    ).size

    const memberSummaries = summarizeMembers({
      currency: input.currency,
      members: input.members,
      vendorPaidByMemberId: input.vendorPaidByMemberId,
      assignedRemainingByMemberId: assignedMinor
    })
    const deviationMinor = memberSummaries.reduce(
      (sum, summary) => sum + absMinor(summary.carryoverAfter.amountMinor),
      0n
    )
    const lexical = assignmentLexicalKey(assignments)
    const result: SearchResult = {
      assignments: [...assignments],
      maxCategoriesPerMemberApplied: input.maxCategoriesPerMemberApplied,
      memberSummaries
    }
    const score: readonly [number, bigint, string] = [splitCategoryCount, deviationMinor, lexical]

    if (
      !bestScore ||
      score[0] < bestScore[0] ||
      (score[0] === bestScore[0] && score[1] < bestScore[1]) ||
      (score[0] === bestScore[0] && score[1] === bestScore[1] && score[2] < bestScore[2])
    ) {
      bestScore = score
      bestResult = result
    }
  }

  const recurse = (index: number, splitUsed: boolean) => {
    if (index >= input.parts.length) {
      finalize()
      return
    }

    const part = input.parts[index]!

    for (const member of input.members) {
      const nextCount = (assignedCount.get(member.memberId) ?? 0) + 1
      if (nextCount > input.maxCategoriesPerMemberApplied) {
        continue
      }

      assignedCount.set(member.memberId, nextCount)
      assignedMinor.set(
        member.memberId,
        (assignedMinor.get(member.memberId) ?? 0n) + part.amountMinor
      )
      assignments.push({ part, assignedMemberId: member.memberId })
      recurse(index + 1, splitUsed)
      assignments.pop()
      assignedMinor.set(
        member.memberId,
        (assignedMinor.get(member.memberId) ?? 0n) - part.amountMinor
      )
      if (nextCount === 1) {
        assignedCount.delete(member.memberId)
      } else {
        assignedCount.set(member.memberId, nextCount - 1)
      }
    }

    if (splitUsed || part.amountMinor <= 1n) {
      return
    }

    for (let leftIndex = 0; leftIndex < input.members.length; leftIndex += 1) {
      const leftMember = input.members[leftIndex]!
      for (let rightIndex = leftIndex + 1; rightIndex < input.members.length; rightIndex += 1) {
        const rightMember = input.members[rightIndex]!
        const leftCount = (assignedCount.get(leftMember.memberId) ?? 0) + 1
        const rightCount = (assignedCount.get(rightMember.memberId) ?? 0) + 1

        if (
          leftCount > input.maxCategoriesPerMemberApplied ||
          rightCount > input.maxCategoriesPerMemberApplied
        ) {
          continue
        }

        const leftCurrentMinor =
          (input.vendorPaidByMemberId.get(leftMember.memberId) ?? 0n) +
          (assignedMinor.get(leftMember.memberId) ?? 0n)
        const leftTargetMinor =
          leftMember.fairShare.amountMinor +
          (leftMember.carryoverBefore ?? Money.zero(input.currency)).amountMinor
        const desiredLeftMinor = leftTargetMinor - leftCurrentMinor
        const leftPartMinor =
          desiredLeftMinor <= 0n
            ? 1n
            : desiredLeftMinor >= part.amountMinor
              ? part.amountMinor - 1n
              : desiredLeftMinor

        if (leftPartMinor <= 0n || leftPartMinor >= part.amountMinor) {
          continue
        }

        const leftPart: SearchBillPart = {
          utilityBillId: part.utilityBillId,
          billName: part.billName,
          splitSourceBillId: part.utilityBillId,
          amountMinor: leftPartMinor,
          fullCategoryPayment: false
        }
        const rightPart: SearchBillPart = {
          utilityBillId: part.utilityBillId,
          billName: part.billName,
          splitSourceBillId: part.utilityBillId,
          amountMinor: part.amountMinor - leftPartMinor,
          fullCategoryPayment: false
        }

        assignedCount.set(leftMember.memberId, leftCount)
        assignedCount.set(rightMember.memberId, rightCount)
        assignedMinor.set(
          leftMember.memberId,
          (assignedMinor.get(leftMember.memberId) ?? 0n) + leftPart.amountMinor
        )
        assignedMinor.set(
          rightMember.memberId,
          (assignedMinor.get(rightMember.memberId) ?? 0n) + rightPart.amountMinor
        )
        assignments.push({ part: leftPart, assignedMemberId: leftMember.memberId })
        assignments.push({ part: rightPart, assignedMemberId: rightMember.memberId })
        recurse(index + 1, true)
        assignments.pop()
        assignments.pop()
        assignedMinor.set(
          leftMember.memberId,
          (assignedMinor.get(leftMember.memberId) ?? 0n) - leftPart.amountMinor
        )
        assignedMinor.set(
          rightMember.memberId,
          (assignedMinor.get(rightMember.memberId) ?? 0n) - rightPart.amountMinor
        )
        if (leftCount === 1) {
          assignedCount.delete(leftMember.memberId)
        } else {
          assignedCount.set(leftMember.memberId, leftCount - 1)
        }
        if (rightCount === 1) {
          assignedCount.delete(rightMember.memberId)
        } else {
          assignedCount.set(rightMember.memberId, rightCount - 1)
        }
      }
    }
  }

  recurse(0, false)
  return bestResult
}

export function computeUtilityBillingPlan(input: {
  currency: CurrencyCode
  members: readonly UtilityBillingTargetMember[]
  bills: readonly UtilityBillingBill[]
  vendorPayments: readonly UtilityVendorPaymentFactInput[]
}): UtilityBillingPlanComputed {
  const paidByBillId = candidatePaidByBill(input.bills, input.vendorPayments)
  const vendorPaidByMemberId = new Map<string, bigint>()

  for (const fact of input.vendorPayments) {
    vendorPaidByMemberId.set(
      fact.payerMemberId,
      (vendorPaidByMemberId.get(fact.payerMemberId) ?? 0n) + fact.amount.amountMinor
    )
  }

  const searchParts = buildSearchParts({
    bills: input.bills,
    paidByBillId
  })
  const emptySummary = summarizeMembers({
    currency: input.currency,
    members: input.members,
    vendorPaidByMemberId,
    assignedRemainingByMemberId: new Map<string, bigint>()
  })

  if (searchParts.length === 0) {
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

  let best: SearchResult | null = null
  const maxCap = Math.max(2, input.members.length, searchParts.length)
  for (let cap = 2; cap <= maxCap; cap += 1) {
    best = searchAssignments({
      currency: input.currency,
      members: input.members,
      vendorPaidByMemberId,
      parts: searchParts,
      maxCategoriesPerMemberApplied: cap
    })
    if (best) {
      break
    }
  }

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

  const categories = best.assignments.map((assignment) => ({
    utilityBillId: assignment.part.utilityBillId,
    billName: assignment.part.billName,
    amount: Money.fromMinor(assignment.part.amountMinor, input.currency),
    assignedMemberId: assignment.assignedMemberId,
    paidAmount: Money.fromMinor(
      paidByBillId.get(assignment.part.utilityBillId) ?? 0n,
      input.currency
    ),
    fullCategoryPayment: assignment.part.fullCategoryPayment,
    splitSourceBillId: assignment.part.splitSourceBillId
  }))

  return {
    status: categories.length === 0 ? 'settled' : 'active',
    maxCategoriesPerMemberApplied: best.maxCategoriesPerMemberApplied,
    categories,
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
      amountMinor: toMinorString(category.amount),
      assignedMemberId: category.assignedMemberId,
      paidAmountMinor: toMinorString(category.paidAmount),
      fullCategoryPayment: category.fullCategoryPayment,
      splitSourceBillId: category.splitSourceBillId
    })),
    memberSummaries: plan.memberSummaries.map((summary) => ({
      memberId: summary.memberId,
      fairShareMinor: toMinorString(summary.fairShare),
      vendorPaidMinor: toMinorString(summary.vendorPaid),
      assignedVendorMinor: toMinorString(summary.assignedVendor),
      effectiveTargetMinor: toMinorString(summary.effectiveTarget),
      carryoverBeforeMinor: toMinorString(summary.carryoverBefore),
      carryoverAfterMinor: toMinorString(summary.carryoverAfter)
    }))
  }
}

export function materializeUtilityBillingPlanRecord(
  record: FinanceUtilityBillingPlanRecord
): UtilityBillingPlanComputed {
  const currency = record.currency

  return {
    status: record.status,
    maxCategoriesPerMemberApplied: record.maxCategoriesPerMemberApplied,
    categories: record.payload.categories.map((category) => ({
      utilityBillId: category.utilityBillId,
      billName: category.billName,
      amount: Money.fromMinor(category.amountMinor, currency),
      assignedMemberId: category.assignedMemberId,
      paidAmount: Money.fromMinor(category.paidAmountMinor, currency),
      fullCategoryPayment: category.fullCategoryPayment,
      splitSourceBillId: category.splitSourceBillId
    })),
    memberSummaries: record.payload.memberSummaries.map((summary) => ({
      memberId: summary.memberId,
      fairShare: Money.fromMinor(summary.fairShareMinor, currency),
      vendorPaid: Money.fromMinor(summary.vendorPaidMinor, currency),
      assignedVendor: Money.fromMinor(summary.assignedVendorMinor, currency),
      effectiveTarget: Money.fromMinor(summary.effectiveTargetMinor, currency),
      carryoverBefore: Money.fromMinor(summary.carryoverBeforeMinor, currency),
      carryoverAfter: Money.fromMinor(summary.carryoverAfterMinor, currency)
    })),
    fairShareByMember: record.payload.fairShareByMember.map((member) => ({
      memberId: member.memberId,
      amount: Money.fromMinor(member.amountMinor, currency)
    }))
  }
}
