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

export interface UtilityReimbursementFactInput {
  fromMemberId: string
  toMemberId: string
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

export interface UtilityBillingTransfer {
  fromMemberId: string
  toMemberId: string
  amount: Money
  settledAmount: Money
}

export interface UtilityBillingMemberSummary {
  memberId: string
  fairShare: Money
  vendorPaid: Money
  reimbursementSent: Money
  reimbursementReceived: Money
  assignedVendor: Money
  remainingTransferIn: Money
  remainingTransferOut: Money
  netSettled: Money
}

export interface UtilityBillingPlanComputed {
  status: FinanceUtilityBillingPlanStatus
  maxCategoriesPerMemberApplied: number
  categories: readonly UtilityBillingCategoryAssignment[]
  transfers: readonly UtilityBillingTransfer[]
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
  transfers: readonly UtilityBillingTransfer[]
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

function createTransfers(input: {
  currency: CurrencyCode
  members: readonly UtilityBillingTargetMember[]
  burdensByMemberId: ReadonlyMap<string, bigint>
}): readonly UtilityBillingTransfer[] {
  const deficits: Array<{ memberId: string; amountMinor: bigint }> = []
  const surpluses: Array<{ memberId: string; amountMinor: bigint }> = []

  for (const member of input.members) {
    const burdenMinor = input.burdensByMemberId.get(member.memberId) ?? 0n
    const deltaMinor = burdenMinor - member.fairShare.amountMinor

    if (deltaMinor > 0n) {
      surpluses.push({ memberId: member.memberId, amountMinor: deltaMinor })
    } else if (deltaMinor < 0n) {
      deficits.push({ memberId: member.memberId, amountMinor: -deltaMinor })
    }
  }

  surpluses.sort((left, right) => {
    if (left.amountMinor === right.amountMinor) {
      return left.memberId.localeCompare(right.memberId)
    }

    return left.amountMinor > right.amountMinor ? -1 : 1
  })
  deficits.sort((left, right) => {
    if (left.amountMinor === right.amountMinor) {
      return left.memberId.localeCompare(right.memberId)
    }

    return left.amountMinor > right.amountMinor ? -1 : 1
  })

  const transfers: UtilityBillingTransfer[] = []
  let deficitIndex = 0
  let surplusIndex = 0

  while (deficitIndex < deficits.length && surplusIndex < surpluses.length) {
    const deficit = deficits[deficitIndex]!
    const surplus = surpluses[surplusIndex]!
    const amountMinor =
      deficit.amountMinor < surplus.amountMinor ? deficit.amountMinor : surplus.amountMinor

    if (amountMinor > 0n) {
      transfers.push({
        fromMemberId: deficit.memberId,
        toMemberId: surplus.memberId,
        amount: Money.fromMinor(amountMinor, input.currency),
        settledAmount: Money.zero(input.currency)
      })
    }

    deficit.amountMinor -= amountMinor
    surplus.amountMinor -= amountMinor

    if (deficit.amountMinor === 0n) {
      deficitIndex += 1
    }
    if (surplus.amountMinor === 0n) {
      surplusIndex += 1
    }
  }

  return transfers
}

function summarizeMembers(input: {
  currency: CurrencyCode
  members: readonly UtilityBillingTargetMember[]
  vendorPaidByMemberId: ReadonlyMap<string, bigint>
  reimbursementSentByMemberId: ReadonlyMap<string, bigint>
  reimbursementReceivedByMemberId: ReadonlyMap<string, bigint>
  assignedVendorByMemberId: ReadonlyMap<string, bigint>
  transfers: readonly UtilityBillingTransfer[]
}): readonly UtilityBillingMemberSummary[] {
  const transferInByMemberId = new Map<string, bigint>()
  const transferOutByMemberId = new Map<string, bigint>()

  for (const transfer of input.transfers) {
    transferOutByMemberId.set(
      transfer.fromMemberId,
      (transferOutByMemberId.get(transfer.fromMemberId) ?? 0n) + transfer.amount.amountMinor
    )
    transferInByMemberId.set(
      transfer.toMemberId,
      (transferInByMemberId.get(transfer.toMemberId) ?? 0n) + transfer.amount.amountMinor
    )
  }

  return input.members.map((member) => ({
    memberId: member.memberId,
    fairShare: member.fairShare,
    vendorPaid: Money.fromMinor(
      input.vendorPaidByMemberId.get(member.memberId) ?? 0n,
      input.currency
    ),
    reimbursementSent: Money.fromMinor(
      input.reimbursementSentByMemberId.get(member.memberId) ?? 0n,
      input.currency
    ),
    reimbursementReceived: Money.fromMinor(
      input.reimbursementReceivedByMemberId.get(member.memberId) ?? 0n,
      input.currency
    ),
    assignedVendor: Money.fromMinor(
      input.assignedVendorByMemberId.get(member.memberId) ?? 0n,
      input.currency
    ),
    remainingTransferIn: Money.fromMinor(
      transferInByMemberId.get(member.memberId) ?? 0n,
      input.currency
    ),
    remainingTransferOut: Money.fromMinor(
      transferOutByMemberId.get(member.memberId) ?? 0n,
      input.currency
    ),
    netSettled: Money.fromMinor(
      (input.vendorPaidByMemberId.get(member.memberId) ?? 0n) +
        (input.reimbursementSentByMemberId.get(member.memberId) ?? 0n) -
        (input.reimbursementReceivedByMemberId.get(member.memberId) ?? 0n),
      input.currency
    )
  }))
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
  fixedBurdenByMemberId: ReadonlyMap<string, bigint>
  vendorPaidByMemberId: ReadonlyMap<string, bigint>
  reimbursementSentByMemberId: ReadonlyMap<string, bigint>
  reimbursementReceivedByMemberId: ReadonlyMap<string, bigint>
  parts: readonly SearchBillPart[]
  maxCategoriesPerMemberApplied: number
}): SearchResult | null {
  const eligibleMembers = input.members.filter((member) => member.fairShare.amountMinor > 0n)
  if (eligibleMembers.length === 0) {
    return null
  }

  let bestScore: readonly [number, bigint, number, string] | null = null
  let bestResult: SearchResult | null = null

  const assignedCount = new Map<string, number>()
  const assignedMinor = new Map<string, bigint>()
  const assignments: Array<{ part: SearchBillPart; assignedMemberId: string }> = []

  const finalize = () => {
    const burdens = new Map<string, bigint>(input.fixedBurdenByMemberId)
    for (const member of input.members) {
      burdens.set(
        member.memberId,
        (burdens.get(member.memberId) ?? 0n) + (assignedMinor.get(member.memberId) ?? 0n)
      )
    }

    const transfers = createTransfers({
      currency: input.currency,
      members: input.members,
      burdensByMemberId: burdens
    })

    const deviationMinor = input.members.reduce((sum, member) => {
      const burdenMinor = burdens.get(member.memberId) ?? 0n
      return sum + absMinor(burdenMinor - member.fairShare.amountMinor)
    }, 0n)
    const splitCategoryCount = new Set(
      assignments
        .filter((assignment) => !assignment.part.fullCategoryPayment)
        .map((assignment) => assignment.part.splitSourceBillId ?? assignment.part.utilityBillId)
    ).size

    const lexical = assignmentLexicalKey(assignments)
    const memberSummaries = summarizeMembers({
      currency: input.currency,
      members: input.members,
      vendorPaidByMemberId: input.vendorPaidByMemberId,
      reimbursementSentByMemberId: input.reimbursementSentByMemberId,
      reimbursementReceivedByMemberId: input.reimbursementReceivedByMemberId,
      assignedVendorByMemberId: assignedMinor,
      transfers
    })

    const result: SearchResult = {
      assignments: [...assignments],
      maxCategoriesPerMemberApplied: input.maxCategoriesPerMemberApplied,
      transfers,
      memberSummaries
    }

    const score: readonly [number, bigint, number, string] = [
      splitCategoryCount,
      deviationMinor,
      transfers.length,
      lexical
    ]
    if (
      !bestScore ||
      score[0] < bestScore[0] ||
      (score[0] === bestScore[0] && score[1] < bestScore[1]) ||
      (score[0] === bestScore[0] && score[1] === bestScore[1] && score[2] < bestScore[2]) ||
      (score[0] === bestScore[0] &&
        score[1] === bestScore[1] &&
        score[2] === bestScore[2] &&
        score[3] < bestScore[3])
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

    for (const member of eligibleMembers) {
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

    for (let leftIndex = 0; leftIndex < eligibleMembers.length; leftIndex += 1) {
      const leftMember = eligibleMembers[leftIndex]!
      for (let rightIndex = leftIndex + 1; rightIndex < eligibleMembers.length; rightIndex += 1) {
        const rightMember = eligibleMembers[rightIndex]!
        const leftCount = (assignedCount.get(leftMember.memberId) ?? 0) + 1
        const rightCount = (assignedCount.get(rightMember.memberId) ?? 0) + 1
        if (
          leftCount > input.maxCategoriesPerMemberApplied ||
          rightCount > input.maxCategoriesPerMemberApplied
        ) {
          continue
        }

        const currentLeftBurden =
          (input.fixedBurdenByMemberId.get(leftMember.memberId) ?? 0n) +
          (assignedMinor.get(leftMember.memberId) ?? 0n)
        const desiredLeftMinor = leftMember.fairShare.amountMinor - currentLeftBurden
        const clampedLeftMinor =
          desiredLeftMinor <= 0n
            ? 1n
            : desiredLeftMinor >= part.amountMinor
              ? part.amountMinor - 1n
              : desiredLeftMinor

        if (clampedLeftMinor <= 0n || clampedLeftMinor >= part.amountMinor) {
          continue
        }

        const leftPart: SearchBillPart = {
          utilityBillId: part.utilityBillId,
          billName: part.billName,
          splitSourceBillId: part.utilityBillId,
          amountMinor: clampedLeftMinor,
          fullCategoryPayment: false
        }
        const rightPart: SearchBillPart = {
          utilityBillId: part.utilityBillId,
          billName: part.billName,
          splitSourceBillId: part.utilityBillId,
          amountMinor: part.amountMinor - clampedLeftMinor,
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
  reimbursements: readonly UtilityReimbursementFactInput[]
}): UtilityBillingPlanComputed {
  const paidByBillId = candidatePaidByBill(input.bills, input.vendorPayments)
  const vendorPaidByMemberId = new Map<string, bigint>()
  const reimbursementSentByMemberId = new Map<string, bigint>()
  const reimbursementReceivedByMemberId = new Map<string, bigint>()

  for (const fact of input.vendorPayments) {
    vendorPaidByMemberId.set(
      fact.payerMemberId,
      (vendorPaidByMemberId.get(fact.payerMemberId) ?? 0n) + fact.amount.amountMinor
    )
  }
  for (const reimbursement of input.reimbursements) {
    reimbursementSentByMemberId.set(
      reimbursement.fromMemberId,
      (reimbursementSentByMemberId.get(reimbursement.fromMemberId) ?? 0n) +
        reimbursement.amount.amountMinor
    )
    reimbursementReceivedByMemberId.set(
      reimbursement.toMemberId,
      (reimbursementReceivedByMemberId.get(reimbursement.toMemberId) ?? 0n) +
        reimbursement.amount.amountMinor
    )
  }

  const fixedBurdenByMemberId = new Map<string, bigint>()
  for (const member of input.members) {
    fixedBurdenByMemberId.set(
      member.memberId,
      (vendorPaidByMemberId.get(member.memberId) ?? 0n) +
        (reimbursementSentByMemberId.get(member.memberId) ?? 0n) -
        (reimbursementReceivedByMemberId.get(member.memberId) ?? 0n)
    )
  }

  const searchParts = buildSearchParts({
    bills: input.bills,
    paidByBillId
  })

  const maxCap = Math.max(
    2,
    ...input.members.map((member) => (member.fairShare.amountMinor > 0n ? 1 : 0))
  )

  let best: SearchResult | null = null
  for (let cap = 2; cap <= Math.max(maxCap, searchParts.length || 2); cap += 1) {
    best = searchAssignments({
      currency: input.currency,
      members: input.members,
      fixedBurdenByMemberId,
      vendorPaidByMemberId,
      reimbursementSentByMemberId,
      reimbursementReceivedByMemberId,
      parts: searchParts,
      maxCategoriesPerMemberApplied: cap
    })
    if (best) {
      break
    }
  }

  const emptySummary = summarizeMembers({
    currency: input.currency,
    members: input.members,
    vendorPaidByMemberId,
    reimbursementSentByMemberId,
    reimbursementReceivedByMemberId,
    assignedVendorByMemberId: new Map<string, bigint>(),
    transfers: []
  })

  if (!best) {
    return {
      status: 'settled',
      maxCategoriesPerMemberApplied: 0,
      categories: [],
      transfers: [],
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
  const status = categories.length === 0 && best.transfers.length === 0 ? 'settled' : 'active'

  return {
    status,
    maxCategoriesPerMemberApplied: best.maxCategoriesPerMemberApplied,
    categories,
    transfers: best.transfers,
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
    transfers: plan.transfers.map((transfer) => ({
      fromMemberId: transfer.fromMemberId,
      toMemberId: transfer.toMemberId,
      amountMinor: toMinorString(transfer.amount),
      settledAmountMinor: toMinorString(transfer.settledAmount)
    })),
    memberSummaries: plan.memberSummaries.map((summary) => ({
      memberId: summary.memberId,
      fairShareMinor: toMinorString(summary.fairShare),
      vendorPaidMinor: toMinorString(summary.vendorPaid),
      reimbursementSentMinor: toMinorString(summary.reimbursementSent),
      reimbursementReceivedMinor: toMinorString(summary.reimbursementReceived),
      assignedVendorMinor: toMinorString(summary.assignedVendor),
      remainingTransferInMinor: toMinorString(summary.remainingTransferIn),
      remainingTransferOutMinor: toMinorString(summary.remainingTransferOut),
      netSettledMinor: toMinorString(summary.netSettled)
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
    transfers: record.payload.transfers.map((transfer) => ({
      fromMemberId: transfer.fromMemberId,
      toMemberId: transfer.toMemberId,
      amount: Money.fromMinor(transfer.amountMinor, currency),
      settledAmount: Money.fromMinor(transfer.settledAmountMinor, currency)
    })),
    memberSummaries: record.payload.memberSummaries.map((summary) => ({
      memberId: summary.memberId,
      fairShare: Money.fromMinor(summary.fairShareMinor, currency),
      vendorPaid: Money.fromMinor(summary.vendorPaidMinor, currency),
      reimbursementSent: Money.fromMinor(summary.reimbursementSentMinor, currency),
      reimbursementReceived: Money.fromMinor(summary.reimbursementReceivedMinor, currency),
      assignedVendor: Money.fromMinor(summary.assignedVendorMinor, currency),
      remainingTransferIn: Money.fromMinor(summary.remainingTransferInMinor, currency),
      remainingTransferOut: Money.fromMinor(summary.remainingTransferOutMinor, currency),
      netSettled: Money.fromMinor(summary.netSettledMinor, currency)
    })),
    fairShareByMember: record.payload.fairShareByMember.map((member) => ({
      memberId: member.memberId,
      amount: Money.fromMinor(member.amountMinor, currency)
    }))
  }
}
