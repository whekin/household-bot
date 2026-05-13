import { describe, expect, test } from 'bun:test'

import type { MiniAppDashboard } from '../../miniapp-api'
import {
  buildTodayTimeline,
  buildTodayViewModel,
  chooseTodayStage,
  type TodayPeriodSummary
} from './today-view-model'

function periodSummary(
  input: {
    rentRemaining?: string
    utilitiesRemaining?: string
    isCurrentPeriod?: boolean
  } = {}
): TodayPeriodSummary {
  return {
    period: '2026-03',
    utilityTotalMajor: '100.00',
    hasOverdueBalance: false,
    isCurrentPeriod: input.isCurrentPeriod ?? true,
    kinds: [
      {
        kind: 'utilities',
        totalDueMajor: '100.00',
        totalPaidMajor: '0.00',
        totalRemainingMajor: input.utilitiesRemaining ?? '0.00',
        unresolvedMembers:
          input.utilitiesRemaining && input.utilitiesRemaining !== '0.00'
            ? [
                {
                  memberId: 'member-a',
                  displayName: 'Ada',
                  suggestedAmountMajor: input.utilitiesRemaining,
                  baseDueMajor: input.utilitiesRemaining,
                  paidMajor: '0.00',
                  remainingMajor: input.utilitiesRemaining,
                  effectivelySettled: false
                }
              ]
            : []
      },
      {
        kind: 'rent',
        totalDueMajor: '300.00',
        totalPaidMajor: '0.00',
        totalRemainingMajor: input.rentRemaining ?? '0.00',
        unresolvedMembers:
          input.rentRemaining && input.rentRemaining !== '0.00'
            ? [
                {
                  memberId: 'member-a',
                  displayName: 'Ada',
                  suggestedAmountMajor: input.rentRemaining,
                  baseDueMajor: input.rentRemaining,
                  paidMajor: '0.00',
                  remainingMajor: input.rentRemaining,
                  effectivelySettled: false
                }
              ]
            : []
      }
    ]
  }
}

function dashboard(summary: TodayPeriodSummary): MiniAppDashboard {
  return {
    period: '2026-03',
    currency: 'GEL',
    timezone: 'Asia/Tbilisi',
    rentWarningDay: 17,
    rentDueDay: 20,
    utilitiesReminderDay: 3,
    utilitiesDueDay: 4,
    paymentBalanceAdjustmentPolicy: 'utilities',
    rentPaymentDestinations: null,
    totalDueMajor: '300.00',
    totalPaidMajor: '0.00',
    totalRemainingMajor: '300.00',
    billingStage: 'idle',
    rentSourceAmountMajor: '300.00',
    rentSourceCurrency: 'GEL',
    rentDisplayAmountMajor: '300.00',
    rentFxRateMicros: null,
    rentFxEffectiveDate: null,
    utilityBillingPlan: null,
    rentBillingState: {
      dueDate: '2026-03-20',
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
        utilityShareMajor: '0.00',
        purchaseOffsetMajor: '0.00',
        effectivePurchaseBalanceMajor: '0.00',
        netDueMajor: '300.00',
        paidMajor: '0.00',
        remainingMajor: '300.00',
        overduePayments: [],
        explanations: []
      }
    ],
    paymentPeriods: [summary],
    ledger: [],
    notifications: []
  }
}

describe('today view model', () => {
  test('keeps utilities active when the period is extended by unpaid utilities', () => {
    const summary = periodSummary({ utilitiesRemaining: '42.00' })

    expect(
      chooseTodayStage({
        dashboard: dashboard(summary),
        effectiveStage: 'utilities',
        periodSummary: summary
      })
    ).toBe('utilities')
  })

  test('does not promote idle into rent before the configured rent window starts', () => {
    const summary = periodSummary({ rentRemaining: '300.00' })

    expect(
      chooseTodayStage({
        dashboard: dashboard(summary),
        effectiveStage: 'idle',
        periodSummary: summary
      })
    ).toBe('idle')
  })

  test('uses between-period state when every payment kind is closed', () => {
    const summary = periodSummary()

    expect(
      chooseTodayStage({
        dashboard: dashboard(summary),
        effectiveStage: 'idle',
        periodSummary: summary
      })
    ).toBe('idle')
  })

  test('builds member close rows from the effective stage', () => {
    const model = buildTodayViewModel({
      dashboard: dashboard(periodSummary({ rentRemaining: '300.00' })),
      currentMemberId: 'member-a',
      effectivePeriod: '2026-03',
      effectiveStage: 'rent'
    })

    expect(model.stage).toBe('rent')
    expect(model.memberLines).toEqual([
      {
        memberId: 'member-a',
        displayName: 'Ada',
        amountMajor: '300.00',
        settled: false,
        isCurrent: true
      }
    ])
  })

  test('builds a proportional cycle map from configured payment windows', () => {
    expect(
      buildTodayTimeline({
        period: '2026-03',
        rentStartDay: 15,
        rentEndDay: 20,
        utilitiesStartDay: 30,
        utilitiesEndDay: 5
      })
    ).toEqual([
      {
        key: 'utilities',
        kind: 'utilities',
        startDay: 30,
        endDay: 5,
        spanDays: 6,
        renderSpanDays: 6,
        label: '30-5'
      },
      {
        key: 'pause-before-rent',
        kind: 'idle',
        startDay: 5,
        endDay: 15,
        spanDays: 10,
        renderSpanDays: 10,
        label: '5-15'
      },
      {
        key: 'rent',
        kind: 'rent',
        startDay: 15,
        endDay: 20,
        spanDays: 5,
        renderSpanDays: 5,
        label: '15-20'
      },
      {
        key: 'pause-before-utilities',
        kind: 'idle',
        startDay: 20,
        endDay: 30,
        spanDays: 10,
        renderSpanDays: 10,
        label: '20-30'
      }
    ])
  })

  test('includes timeline segments in the today model from dashboard settings', () => {
    const model = buildTodayViewModel({
      dashboard: {
        ...dashboard(periodSummary({ utilitiesRemaining: '42.00' })),
        rentWarningDay: 15,
        rentDueDay: 20,
        utilitiesReminderDay: 30,
        utilitiesDueDay: 5
      },
      currentMemberId: 'member-a',
      effectivePeriod: '2026-03',
      effectiveStage: 'idle'
    })

    expect(model.timelineSegments.map((segment) => segment.label)).toEqual([
      '30-5',
      '5-15',
      '15-20',
      '20-30'
    ])
  })

  test('exposes exact utility assignments for the current member', () => {
    const model = buildTodayViewModel({
      dashboard: {
        ...dashboard(periodSummary({ utilitiesRemaining: '42.00' })),
        utilityBillingPlan: {
          version: 1,
          status: 'active',
          dueDate: '2026-03-05',
          updatedFromVersion: null,
          reason: null,
          categories: [
            {
              utilityBillId: 'bill-electricity',
              billName: 'Electricity',
              billTotalMajor: '60.00',
              assignedAmountMajor: '24.00',
              assignedMemberId: 'member-a',
              assignedDisplayName: 'Ada',
              paidAmountMajor: '0.00',
              isFullAssignment: false,
              splitGroupId: null
            },
            {
              utilityBillId: 'bill-water',
              billName: 'Water',
              billTotalMajor: '30.00',
              assignedAmountMajor: '18.00',
              assignedMemberId: 'member-a',
              assignedDisplayName: 'Ada',
              paidAmountMajor: '0.00',
              isFullAssignment: false,
              splitGroupId: null
            }
          ],
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
        }
      },
      currentMemberId: 'member-a',
      effectivePeriod: '2026-03',
      effectiveStage: 'utilities'
    })

    expect(model.currentMemberUtilityLines).toEqual([
      { billName: 'Electricity', amountMajor: '24.00' },
      { billName: 'Water', amountMajor: '18.00' }
    ])
  })

  test('computes next payment window for idle state', () => {
    const model = buildTodayViewModel({
      dashboard: {
        ...dashboard(periodSummary()),
        rentWarningDay: 15,
        rentDueDay: 20,
        utilitiesReminderDay: 30,
        utilitiesDueDay: 5
      },
      currentMemberId: 'member-a',
      effectivePeriod: '2026-03',
      effectiveStage: 'idle',
      todayOverride: { year: 2026, month: 3, day: 10 }
    })

    expect(model.nextWindow).toEqual({
      kind: 'rent',
      label: 'rent',
      rangeLabel: '15-20'
    })
  })

  test('separates current-cycle purchase volume from active carryover purchases', () => {
    const data = dashboard(periodSummary())
    data.ledger = [
      {
        id: 'purchase-prior-unresolved',
        kind: 'purchase',
        title: 'Prior gas refill',
        memberId: 'member-a',
        paymentKind: null,
        amountMajor: '54.00',
        currency: 'GEL',
        displayAmountMajor: '54.00',
        displayCurrency: 'GEL',
        fxRateMicros: null,
        fxEffectiveDate: null,
        actorDisplayName: 'Ada',
        occurredAt: '2026-02-17T20:15:00.000Z',
        originPeriod: '2026-02',
        isCurrentCyclePurchase: false,
        resolutionStatus: 'unresolved',
        resolvedAt: null,
        outstandingByMember: [],
        payerMemberId: 'member-a',
        purchaseSplitMode: 'equal',
        purchaseParticipants: []
      },
      {
        id: 'purchase-current-unresolved',
        kind: 'purchase',
        title: 'Current filters',
        memberId: 'member-a',
        paymentKind: null,
        amountMajor: '96.00',
        currency: 'GEL',
        displayAmountMajor: '96.00',
        displayCurrency: 'GEL',
        fxRateMicros: null,
        fxEffectiveDate: null,
        actorDisplayName: 'Ada',
        occurredAt: '2026-03-03T19:00:00.000Z',
        originPeriod: '2026-03',
        isCurrentCyclePurchase: true,
        resolutionStatus: 'unresolved',
        resolvedAt: null,
        outstandingByMember: [],
        payerMemberId: 'member-a',
        purchaseSplitMode: 'equal',
        purchaseParticipants: []
      },
      {
        id: 'purchase-current-resolved',
        kind: 'purchase',
        title: 'Current closed supplies',
        memberId: 'member-a',
        paymentKind: null,
        amountMajor: '72.00',
        currency: 'GEL',
        displayAmountMajor: '72.00',
        displayCurrency: 'GEL',
        fxRateMicros: null,
        fxEffectiveDate: null,
        actorDisplayName: 'Ada',
        occurredAt: '2026-03-04T09:00:00.000Z',
        originPeriod: '2026-03',
        isCurrentCyclePurchase: true,
        resolutionStatus: 'resolved',
        resolvedAt: '2026-03-05T09:00:00.000Z',
        outstandingByMember: [],
        payerMemberId: 'member-a',
        purchaseSplitMode: 'equal',
        purchaseParticipants: []
      }
    ]

    const model = buildTodayViewModel({
      dashboard: data,
      currentMemberId: 'member-a',
      effectivePeriod: '2026-03',
      effectiveStage: 'idle'
    })

    expect(model.purchaseTotalMajor).toBe('168.00')
    expect(model.unresolvedPurchaseCount).toBe(2)
    expect(model.purchaseEntries.map((entry) => entry.id)).toEqual([
      'purchase-current-unresolved',
      'purchase-prior-unresolved'
    ])
  })

  test('tracks the current timeline segment separately from an extended utilities stage', () => {
    const model = buildTodayViewModel({
      dashboard: {
        ...dashboard(periodSummary({ utilitiesRemaining: '42.00' })),
        rentWarningDay: 17,
        rentDueDay: 20,
        utilitiesReminderDay: 1,
        utilitiesDueDay: 6
      },
      currentMemberId: 'member-a',
      effectivePeriod: '2026-05',
      effectiveStage: 'utilities',
      todayOverride: { year: 2026, month: 5, day: 13 }
    })

    expect(model.stage).toBe('utilities')
    expect(model.currentTimelineSegmentKey).toBe('pause-before-rent')
  })
})
