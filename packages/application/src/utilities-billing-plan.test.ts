import { describe, expect, test } from 'bun:test'

import { Money } from '@household/domain'

import { computeUtilityBillingPlan } from './utilities-billing-plan'

function member(memberId: string, displayName: string, fairShareMajor: string) {
  return {
    memberId,
    displayName,
    fairShare: Money.fromMajor(fairShareMajor, 'GEL')
  }
}

function bill(utilityBillId: string, billName: string, amountMajor: string) {
  return {
    utilityBillId,
    billName,
    amount: Money.fromMajor(amountMajor, 'GEL')
  }
}

function assignedTotals(plan: ReturnType<typeof computeUtilityBillingPlan>) {
  const totals = new Map<string, bigint>()

  for (const category of plan.categories) {
    totals.set(
      category.assignedMemberId,
      (totals.get(category.assignedMemberId) ?? 0n) + category.amount.amountMinor
    )
  }

  return totals
}

describe('computeUtilityBillingPlan', () => {
  test('assigns whole bills within the 2-category cap when an exact fit exists', () => {
    const plan = computeUtilityBillingPlan({
      currency: 'GEL',
      members: [
        member('alice', 'Alice', '100.00'),
        member('bob', 'Bob', '100.00'),
        member('carol', 'Carol', '100.00')
      ],
      bills: [
        bill('gas', 'Gas', '100.00'),
        bill('electricity', 'Electricity', '100.00'),
        bill('internet', 'Internet', '80.00'),
        bill('cleaning', 'Cleaning', '20.00')
      ],
      vendorPayments: [],
      reimbursements: []
    })

    expect(plan.maxCategoriesPerMemberApplied).toBe(2)
    expect(plan.categories.every((category) => category.fullCategoryPayment)).toBe(true)

    const counts = plan.categories.reduce(
      (result, category) =>
        result.set(category.assignedMemberId, (result.get(category.assignedMemberId) ?? 0) + 1),
      new Map<string, number>()
    )

    expect([...counts.values()].every((count) => count <= 2)).toBe(true)
    expect([...assignedTotals(plan).values()].sort((left, right) => Number(left - right))).toEqual([
      10000n,
      10000n,
      10000n
    ])
  })

  test('relaxes the category cap when 2 assignments per member are impossible', () => {
    const plan = computeUtilityBillingPlan({
      currency: 'GEL',
      members: [member('alice', 'Alice', '50.00'), member('bob', 'Bob', '50.00')],
      bills: [
        bill('bill-1', 'Bill 1', '20.00'),
        bill('bill-2', 'Bill 2', '20.00'),
        bill('bill-3', 'Bill 3', '20.00'),
        bill('bill-4', 'Bill 4', '20.00'),
        bill('bill-5', 'Bill 5', '20.00')
      ],
      vendorPayments: [],
      reimbursements: []
    })

    const counts = [
      ...plan.categories
        .reduce(
          (result, category) =>
            result.set(category.assignedMemberId, (result.get(category.assignedMemberId) ?? 0) + 1),
          new Map<string, number>()
        )
        .values()
    ].sort((left, right) => left - right)

    expect(plan.maxCategoriesPerMemberApplied).toBe(3)
    expect(counts).toEqual([2, 3])
    expect(plan.categories.every((category) => category.fullCategoryPayment)).toBe(true)
  })

  test('uses deterministic member assignment when multiple plans have the same score', () => {
    const plan = computeUtilityBillingPlan({
      currency: 'GEL',
      members: [member('alice', 'Alice', '50.00'), member('bob', 'Bob', '50.00')],
      bills: [bill('bill-a', 'A bill', '50.00'), bill('bill-b', 'B bill', '50.00')],
      vendorPayments: [],
      reimbursements: []
    })

    expect(
      plan.categories.map((category) => ({
        utilityBillId: category.utilityBillId,
        assignedMemberId: category.assignedMemberId
      }))
    ).toEqual([
      { utilityBillId: 'bill-a', assignedMemberId: 'alice' },
      { utilityBillId: 'bill-b', assignedMemberId: 'bob' }
    ])
  })

  test('prefers whole-bill assignments over split alternatives', () => {
    const plan = computeUtilityBillingPlan({
      currency: 'GEL',
      members: [member('alice', 'Alice', '50.00'), member('bob', 'Bob', '50.00')],
      bills: [
        bill('big', 'Big bill', '80.00'),
        bill('small-1', 'Small bill 1', '10.00'),
        bill('small-2', 'Small bill 2', '10.00')
      ],
      vendorPayments: [],
      reimbursements: []
    })

    expect(plan.maxCategoriesPerMemberApplied).toBe(2)
    expect(plan.categories.every((category) => category.fullCategoryPayment)).toBe(true)
    expect(plan.categories.every((category) => category.splitSourceBillId === null)).toBe(true)
  })
})
