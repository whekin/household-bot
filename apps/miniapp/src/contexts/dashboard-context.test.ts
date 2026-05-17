import { describe, expect, test } from 'bun:test'

import type { MiniAppDashboard } from '../miniapp-api'
import { computeEffectiveBillingStage } from '../lib/billing-stage'

function dashboard(): MiniAppDashboard {
  return {
    period: '2026-05',
    currency: 'GEL',
    timezone: 'Asia/Tbilisi',
    rentWarningDay: 15,
    rentDueDay: 20,
    utilitiesReminderDay: 30,
    utilitiesDueDay: 5,
    paymentBalanceAdjustmentPolicy: 'utilities',
    rentPaymentDestinations: null,
    totalDueMajor: '300.00',
    totalPaidMajor: '0.00',
    totalRemainingMajor: '300.00',
    billingStage: 'utilities',
    rentSourceAmountMajor: '300.00',
    rentSourceCurrency: 'GEL',
    rentDisplayAmountMajor: '300.00',
    rentFxRateMicros: null,
    rentFxEffectiveDate: null,
    utilityBillingPlan: {
      version: 1,
      status: 'active',
      dueDate: '2026-05-05',
      updatedFromVersion: null,
      reason: null,
      categories: [],
      memberSummaries: [
        {
          memberId: 'member-a',
          displayName: 'Ada',
          fairShareMajor: '42.00',
          vendorPaidMajor: '0.00',
          assignedThisCycleMajor: '42.00',
          projectedDeltaAfterPlanMajor: '0.00'
        }
      ]
    },
    rentBillingState: {
      dueDate: '2026-05-20',
      paymentDestinations: null,
      memberSummaries: [
        {
          memberId: 'member-a',
          displayName: 'Ada',
          dueMajor: '300.00',
          paidMajor: '0.00',
          remainingMajor: '300.00'
        }
      ]
    },
    members: [
      {
        memberId: 'member-a',
        displayName: 'Ada',
        status: 'active',
        predictedUtilityShareMajor: null,
        rentShareMajor: '300.00',
        utilityShareMajor: '42.00',
        purchaseOffsetMajor: '0.00',
        netDueMajor: '342.00',
        paidMajor: '0.00',
        remainingMajor: '342.00',
        overduePayments: [],
        explanations: []
      }
    ],
    paymentPeriods: [],
    ledger: [],
    notifications: []
  }
}

describe('computeEffectiveBillingStage', () => {
  test('lets explicit QA date overrides reach rent window even if demo utilities are still open', () => {
    expect(
      computeEffectiveBillingStage({
        dashboard: dashboard(),
        period: '2026-05',
        todayOverride: { year: 2026, month: 5, day: 18 },
        preferTimelineWindow: true
      })
    ).toBe('rent')
  })

  test('keeps explicit QA date overrides in wrapped utilities window', () => {
    expect(
      computeEffectiveBillingStage({
        dashboard: dashboard(),
        period: '2026-05',
        todayOverride: { year: 2026, month: 5, day: 3 },
        preferTimelineWindow: true
      })
    ).toBe('utilities')
  })
})
