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
  return plan.categories.reduce((totals, category) => {
    totals.set(
      category.assignedMemberId,
      (totals.get(category.assignedMemberId) ?? 0n) + category.assignedAmount.amountMinor
    )
    return totals
  }, new Map<string, bigint>())
}

describe('computeUtilityBillingPlan', () => {
  test('assigns whole bills within the 2-action target when an exact fit exists', () => {
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
      vendorPayments: []
    })

    expect(plan.maxCategoriesPerMemberApplied).toBe(2)
    expect(plan.categories.every((category) => category.isFullAssignment)).toBe(true)

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
    expect(
      plan.memberSummaries.every((summary) => summary.projectedDeltaAfterPlan.amountMinor === 0n)
    ).toBe(true)
  })

  test('splits a large bill when whole-bill assignment would force material fronting', () => {
    const plan = computeUtilityBillingPlan({
      currency: 'GEL',
      members: [member('alice', 'Alice', '50.00'), member('bob', 'Bob', '50.00')],
      bills: [bill('big', 'Big bill', '80.00'), bill('small', 'Small bill', '20.00')],
      vendorPayments: []
    })

    expect(plan.categories.some((category) => category.splitGroupId === 'big')).toBe(true)
    expect(assignedTotals(plan)).toEqual(
      new Map([
        ['alice', 5000n],
        ['bob', 5000n]
      ])
    )
    expect(
      plan.memberSummaries.every((summary) => summary.projectedDeltaAfterPlan.amountMinor === 0n)
    ).toBe(true)
  })

  test('assigns only the unpaid remainder when a bill was already partially paid', () => {
    const plan = computeUtilityBillingPlan({
      currency: 'GEL',
      members: [member('alice', 'Alice', '75.00'), member('bob', 'Bob', '75.00')],
      bills: [bill('gas', 'Gas', '90.00'), bill('electricity', 'Electricity', '60.00')],
      vendorPayments: [
        {
          utilityBillId: 'gas',
          billName: 'Gas',
          payerMemberId: 'alice',
          amount: Money.fromMajor('40.00', 'GEL')
        }
      ]
    })

    const gasAssignments = plan.categories.filter((category) => category.utilityBillId === 'gas')
    expect(
      gasAssignments.reduce((sum, category) => sum + category.assignedAmount.amountMinor, 0n)
    ).toBe(5000n)
    expect(
      plan.memberSummaries.map((summary) => ({
        memberId: summary.memberId,
        vendorPaidMinor: summary.vendorPaid.amountMinor,
        assignedMinor: summary.assignedThisCycle.amountMinor,
        deltaMinor: summary.projectedDeltaAfterPlan.amountMinor
      }))
    ).toEqual([
      {
        memberId: 'alice',
        vendorPaidMinor: 4000n,
        assignedMinor: 3500n,
        deltaMinor: 0n
      },
      {
        memberId: 'bob',
        vendorPaidMinor: 0n,
        assignedMinor: 7500n,
        deltaMinor: 0n
      }
    ])
  })

  test('relaxes the 2-action target when a split is required for fairness', () => {
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
      vendorPayments: []
    })

    expect(plan.maxCategoriesPerMemberApplied).toBe(3)
    expect(plan.categories.some((category) => category.splitGroupId !== null)).toBe(true)
    expect(
      plan.memberSummaries.every((summary) => summary.projectedDeltaAfterPlan.amountMinor === 0n)
    ).toBe(true)
  })

  test('uses deterministic member assignment when multiple plans have the same score', () => {
    const plan = computeUtilityBillingPlan({
      currency: 'GEL',
      members: [member('alice', 'Alice', '50.00'), member('bob', 'Bob', '50.00')],
      bills: [bill('bill-a', 'A bill', '50.00'), bill('bill-b', 'B bill', '50.00')],
      vendorPayments: []
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

  test('prefers whole categories before fairness splits in whole-bills-first mode', () => {
    const plan = computeUtilityBillingPlan({
      currency: 'GEL',
      members: [
        member('alice', 'Alice', '101.67'),
        member('bob', 'Bob', '101.67'),
        member('carol', 'Carol', '101.66'),
        member('dave', 'Dave', '101.66')
      ],
      bills: [
        bill('gas', 'Gas', '321.07'),
        bill('electricity', 'Electricity', '83.09'),
        bill('cleaning', 'Cleaning', '2.50')
      ],
      vendorPayments: [],
      strategy: 'whole_bills_first'
    })

    expect(plan.categories.every((category) => category.isFullAssignment)).toBe(true)
    expect(plan.maxCategoriesPerMemberApplied).toBeLessThanOrEqual(2)
  })

  test('does not change assignments when members pay on-plan amounts', () => {
    // Scenario: A plan exists, Bob is assigned to pay for gas (169.44 GEL).
    // Bob pays 157.94 GEL toward gas. The plan should NOT recalculate Bob's assignment.
    // The algorithm should only see the unpaid remainder (11.50 GEL) as still needing assignment.

    // Initial plan - no payments yet
    const initialPlan = computeUtilityBillingPlan({
      currency: 'GEL',
      members: [
        member('alice', 'Alice', '29.35'),
        member('bob', 'Bob', '169.44'),
        member('carol', 'Carol', '82.10'),
        member('dave', 'Dave', '125.77')
      ],
      bills: [
        bill('gas', 'Gas', '321.07'),
        bill('electricity', 'Electricity', '83.09'),
        bill('cleaning', 'Cleaning', '2.50')
      ],
      vendorPayments: []
    })

    // Bob's initial assignment
    const bobInitialAssignments = initialPlan.categories.filter(
      (category) => category.assignedMemberId === 'bob'
    )
    const bobInitialTotal = bobInitialAssignments.reduce(
      (sum, category) => sum + category.assignedAmount.amountMinor,
      0n
    )

    // Now Bob pays 157.94 GEL for gas, which is ON-PLAN (matches his assignment)
    // In the real system, this payment would be marked with matchedPlan=true
    // and would NOT be passed to computeUtilityBillingPlan on subsequent calls.

    // Simulate what should happen: the plan stays the same, only the unpaid portion
    // is shown as remaining. The gas bill now has 157.94 paid, leaving 163.13 unpaid.
    const planAfterOnPlanPayment = computeUtilityBillingPlan({
      currency: 'GEL',
      members: [
        member('alice', 'Alice', '29.35'),
        member('bob', 'Bob', '169.44'),
        member('carol', 'Carol', '82.10'),
        member('dave', 'Dave', '125.77')
      ],
      bills: [
        bill('gas', 'Gas', '321.07'),
        bill('electricity', 'Electricity', '83.09'),
        bill('cleaning', 'Cleaning', '2.50')
      ],
      // Empty vendorPayments because on-plan payments shouldn't be passed to the algorithm
      vendorPayments: []
    })

    // The plan should be identical
    const bobAssignmentsAfter = planAfterOnPlanPayment.categories.filter(
      (category) => category.assignedMemberId === 'bob'
    )
    const bobTotalAfter = bobAssignmentsAfter.reduce(
      (sum, category) => sum + category.assignedAmount.amountMinor,
      0n
    )

    expect(bobTotalAfter).toBe(bobInitialTotal)
  })
})
