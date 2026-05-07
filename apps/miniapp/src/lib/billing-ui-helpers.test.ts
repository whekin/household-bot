/// <reference types="bun" />

import { describe, expect, test } from 'bun:test'

import {
  hasUtilityPlanAssignments,
  isSettledQuietPlan,
  isUtilityPlanActionable,
  paymentQueueGroups,
  utilityPlanSnapshotOutcomes,
  utilityPlanTotals,
  type UtilityBillingPlan
} from './billing-ui-helpers'
import type { MiniAppDashboard } from '../miniapp-api'

const settledPlan: UtilityBillingPlan = {
  version: 1,
  status: 'settled',
  dueDate: '2026-05-06',
  updatedFromVersion: null,
  reason: null,
  categories: [
    {
      utilityBillId: 'gas',
      billName: 'Gas',
      billTotalMajor: '253.33',
      assignedAmountMajor: '98.10',
      assignedMemberId: 'alice',
      assignedDisplayName: 'Alice',
      paidAmountMajor: '98.10',
      isFullAssignment: false,
      splitGroupId: 'gas'
    },
    {
      utilityBillId: 'electricity',
      billName: 'Electricity',
      billTotalMajor: '56.86',
      assignedAmountMajor: '56.86',
      assignedMemberId: 'dima',
      assignedDisplayName: 'Dima',
      paidAmountMajor: '56.86',
      isFullAssignment: true,
      splitGroupId: null
    }
  ],
  memberSummaries: [
    {
      memberId: 'stas',
      displayName: 'Stas',
      fairShareMajor: '0.00',
      vendorPaidMajor: '0.00',
      assignedThisCycleMajor: '0.00',
      projectedDeltaAfterPlanMajor: '0.00'
    },
    {
      memberId: 'alice',
      displayName: 'Alice',
      fairShareMajor: '98.10',
      vendorPaidMajor: '98.10',
      assignedThisCycleMajor: '0.00',
      projectedDeltaAfterPlanMajor: '0.00'
    },
    {
      memberId: 'dima',
      displayName: 'Dima',
      fairShareMajor: '100.10',
      vendorPaidMajor: '56.86',
      assignedThisCycleMajor: '0.00',
      projectedDeltaAfterPlanMajor: '-43.24'
    }
  ]
}

function dashboard(input: {
  billingStage: MiniAppDashboard['billingStage']
  utilityBillingPlan: MiniAppDashboard['utilityBillingPlan']
  paymentPeriods?: MiniAppDashboard['paymentPeriods']
}): MiniAppDashboard {
  return {
    period: '2026-05',
    currency: 'GEL',
    timezone: 'Asia/Tbilisi',
    rentWarningDay: 25,
    rentDueDay: 1,
    utilitiesReminderDay: 3,
    utilitiesDueDay: 6,
    paymentBalanceAdjustmentPolicy: 'utilities',
    rentPaymentDestinations: null,
    totalDueMajor: '0.00',
    totalPaidMajor: '0.00',
    totalRemainingMajor: '0.00',
    billingStage: input.billingStage,
    rentSourceAmountMajor: '0.00',
    rentSourceCurrency: 'GEL',
    rentDisplayAmountMajor: '0.00',
    rentFxRateMicros: null,
    rentFxEffectiveDate: null,
    ...(input.utilityBillingPlan === undefined
      ? {}
      : {
          utilityBillingPlan: input.utilityBillingPlan
        }),
    rentBillingState: {
      dueDate: '2026-05-01',
      paymentDestinations: null,
      memberSummaries: []
    },
    members: [
      {
        memberId: 'stas',
        displayName: 'Stas',
        predictedUtilityShareMajor: null,
        rentShareMajor: '0.00',
        utilityShareMajor: '0.00',
        purchaseOffsetMajor: '0.00',
        carryForwardCreditMajor: '22.93',
        effectivePurchaseBalanceMajor: '-22.93',
        netDueMajor: '0.00',
        paidMajor: '0.00',
        remainingMajor: '0.00',
        overduePayments: [],
        explanations: []
      },
      {
        memberId: 'alice',
        displayName: 'Alice',
        predictedUtilityShareMajor: null,
        rentShareMajor: '0.00',
        utilityShareMajor: '98.10',
        purchaseOffsetMajor: '0.00',
        carryForwardCreditMajor: '0.00',
        effectivePurchaseBalanceMajor: '0.00',
        netDueMajor: '0.00',
        paidMajor: '98.10',
        remainingMajor: '0.00',
        overduePayments: [],
        explanations: []
      }
    ],
    ...(input.paymentPeriods === undefined
      ? {}
      : {
          paymentPeriods: input.paymentPeriods
        }),
    ledger: [],
    notifications: []
  }
}

describe('billing UI helpers', () => {
  test('detects settled quiet utility plans for snapshot rendering', () => {
    expect(
      isSettledQuietPlan(dashboard({ billingStage: 'idle', utilityBillingPlan: settledPlan }))
    ).toBe(true)
    expect(
      isSettledQuietPlan(dashboard({ billingStage: 'utilities', utilityBillingPlan: settledPlan }))
    ).toBe(false)
  })

  test('detects action-mode utility plans from status or assignments', () => {
    const activeEmptyPlan = {
      ...settledPlan,
      status: 'active' as const
    }
    const settledAssignedPlan = {
      ...settledPlan,
      memberSummaries: [
        {
          ...settledPlan.memberSummaries[0]!,
          assignedThisCycleMajor: '12.00'
        }
      ]
    }

    expect(isUtilityPlanActionable(activeEmptyPlan)).toBe(true)
    expect(hasUtilityPlanAssignments(activeEmptyPlan)).toBe(false)
    expect(isUtilityPlanActionable(settledAssignedPlan)).toBe(true)
    expect(isUtilityPlanActionable(settledPlan)).toBe(false)
  })

  test('computes settled plan totals and carry-forward credit', () => {
    const data = dashboard({ billingStage: 'idle', utilityBillingPlan: settledPlan })

    expect(utilityPlanTotals(settledPlan, data.members)).toEqual({
      assignedTotalMajor: '154.96',
      paidTotalMajor: '154.96',
      remainingTotalMajor: '0.00',
      carryForwardCreditMajor: '22.93'
    })
    expect(utilityPlanSnapshotOutcomes({ plan: settledPlan, members: data.members })).toEqual([
      {
        memberId: 'stas',
        displayName: 'Stas',
        amountMajor: '22.93'
      }
    ])
  })

  test('payment queue excludes settled periods and keeps overdue/current action groups', () => {
    const groups = paymentQueueGroups([
      {
        period: '2026-04',
        utilityTotalMajor: '0.00',
        hasOverdueBalance: true,
        isCurrentPeriod: false,
        kinds: [
          {
            kind: 'utilities',
            totalDueMajor: '40.00',
            totalPaidMajor: '10.00',
            totalRemainingMajor: '30.00',
            unresolvedMembers: [
              {
                memberId: 'alice',
                displayName: 'Alice',
                suggestedAmountMajor: '30.00',
                baseDueMajor: '40.00',
                paidMajor: '10.00',
                remainingMajor: '30.00',
                effectivelySettled: false
              }
            ]
          }
        ]
      },
      {
        period: '2026-05',
        utilityTotalMajor: '0.00',
        hasOverdueBalance: false,
        isCurrentPeriod: true,
        kinds: [
          {
            kind: 'rent',
            totalDueMajor: '100.00',
            totalPaidMajor: '0.00',
            totalRemainingMajor: '100.00',
            unresolvedMembers: [
              {
                memberId: 'stas',
                displayName: 'Stas',
                suggestedAmountMajor: '100.00',
                baseDueMajor: '100.00',
                paidMajor: '0.00',
                remainingMajor: '100.00',
                effectivelySettled: false
              }
            ]
          },
          {
            kind: 'utilities',
            totalDueMajor: '20.00',
            totalPaidMajor: '20.00',
            totalRemainingMajor: '0.00',
            unresolvedMembers: []
          }
        ]
      }
    ])

    expect(groups.map((group) => `${group.period}:${group.kind}`)).toEqual([
      '2026-04:utilities',
      '2026-05:rent'
    ])
  })
})
