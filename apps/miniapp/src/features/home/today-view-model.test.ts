import { describe, expect, test } from 'bun:test'

import type { MiniAppDashboard } from '../../api'
import {
  buildTodayTimeline,
  buildTodayViewModel,
  chooseTodayStage,
  railSegmentState,
  purchaseShareForMember,
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

function installmentDashboard(additionalPayment = false): MiniAppDashboard {
  const remainingMajor = additionalPayment ? '19.95' : '23.95'
  const paidMajor = additionalPayment ? '38.57' : '34.57'
  const summary = periodSummary({ utilitiesRemaining: remainingMajor })
  Object.assign(summary.kinds[0]!.unresolvedMembers[0]!, {
    baseDueMajor: '58.52',
    paidMajor
  })
  const data = dashboard(summary)
  data.members[0]!.utilityShareMajor = '45.05'
  data.utilityBillingPlan = {
    version: 3,
    status: 'active',
    dueDate: '2026-03-05',
    updatedFromVersion: 2,
    reason: 'rebalanced_after_cycle_change',
    categories: [
      {
        utilityBillId: 'electricity',
        billName: 'Electricity',
        billTotalMajor: '44.02',
        assignedAmountMajor: '15.64',
        remainingAmountMajor: additionalPayment ? '11.64' : '15.64',
        assignedMemberId: 'member-a',
        assignedDisplayName: 'Ada',
        paidAmountMajor: additionalPayment ? '32.38' : '28.38',
        isFullAssignment: false,
        splitGroupId: 'electricity'
      },
      {
        utilityBillId: 'internet',
        billName: 'Internet',
        billTotalMajor: '61.39',
        assignedAmountMajor: '8.31',
        remainingAmountMajor: '8.31',
        assignedMemberId: 'member-a',
        assignedDisplayName: 'Ada',
        paidAmountMajor: '53.08',
        isFullAssignment: false,
        splitGroupId: 'internet'
      }
    ],
    memberSummaries: [
      {
        memberId: 'member-a',
        displayName: 'Ada',
        fairShareMajor: '58.52',
        vendorPaidMajor: paidMajor,
        assignedThisCycleMajor: remainingMajor,
        projectedDeltaAfterPlanMajor: '0.00'
      }
    ],
    vendorPayments: [
      ['gas', 'Gas', 'member-a', '20.37'],
      ['cleaning', 'Cleaning', 'member-a', '2.50'],
      ['electricity', 'Electricity', 'member-a', '11.66'],
      ['electricity', 'Electricity', 'member-a', '0.04'],
      ['electricity', 'Electricity', 'member-b', '16.68'],
      ...(additionalPayment ? [['electricity', 'Electricity', 'member-a', '4.00']] : [])
    ].map(([utilityBillId, billName, payerMemberId, amountMajor], index) => ({
      id: `fact-${index}`,
      utilityBillId: utilityBillId!,
      billName: billName!,
      payerMemberId: payerMemberId!,
      payerDisplayName: payerMemberId === 'member-a' ? 'Ada' : 'Bob',
      amountMajor: amountMajor!,
      matchedPlan: additionalPayment && index === 5,
      recordedAt: '2026-03-06T06:00:00Z'
    }))
  }
  return data
}

describe('member payment transparency', () => {
  function modelFor(data: MiniAppDashboard, currentMemberId = 'member-a') {
    return buildTodayViewModel({
      dashboard: data,
      currentMemberId,
      effectivePeriod: data.period,
      effectiveStage: 'utilities'
    })
  }

  test('shows accounted installments and the exact remainder for another member', () => {
    const line = modelFor(installmentDashboard(), 'member-b').memberLines[0]!
    expect(line.paidMajor).toBe('34.57')
    expect(line.amountMajor).toBe('23.95')
    expect(line.utilityLines).toEqual([
      { billId: 'electricity', billName: 'Electricity', amountMajor: '15.64', paidMajor: '11.70' },
      { billId: 'internet', billName: 'Internet', amountMajor: '8.31', paidMajor: '0.00' },
      { billId: 'cleaning', billName: 'Cleaning', amountMajor: '0.00', paidMajor: '2.50' },
      { billId: 'gas', billName: 'Gas', amountMajor: '0.00', paidMajor: '20.37' }
    ])
  })

  test('counts a new installment once while preserving carried payments', () => {
    const line = modelFor(installmentDashboard(true)).memberLines[0]!
    expect(line.paidMajor).toBe('38.57')
    expect(line.amountMajor).toBe('19.95')
    expect(line.utilityLines.find((item) => item.billId === 'electricity')).toEqual({
      billId: 'electricity',
      billName: 'Electricity',
      amountMajor: '11.64',
      paidMajor: '15.70'
    })
  })

  test('identifies accounted cash that has not been attributed to a provider', () => {
    const data = installmentDashboard()
    Object.assign(data.paymentPeriods![0]!.kinds[0]!.unresolvedMembers[0]!, {
      paidMajor: '38.57',
      remainingMajor: '19.95'
    })
    const line = modelFor(data).memberLines[0]!
    expect(line.paidMajor).toBe('38.57')
    expect(line.amountMajor).toBe('19.95')
    expect(line.unallocatedPaidMajor).toBe('4.00')
    expect(line.utilityLines[0]!.paidMajor).toBe('11.70')
  })

  test('retains fully paid bills and accounted totals for a settled member', () => {
    const data = installmentDashboard()
    data.paymentPeriods![0]!.kinds[0]!.unresolvedMembers = []
    data.utilityBillingPlan!.categories = []
    data.utilityBillingPlan!.memberSummaries[0]!.assignedThisCycleMajor = '0.00'
    const line = modelFor(data).memberLines[0]!
    expect(line.settled).toBe(true)
    expect(line.paidMajor).toBe('34.57')
    expect(line.amountMajor).toBe('0.00')
    expect(line.utilityLines).toHaveLength(3)
    expect(line.utilityLines.every((item) => item.amountMajor === '0.00')).toBe(true)
  })

  test('does not treat an unrelated rent receipt as an accounted utility payment', () => {
    const data = installmentDashboard()
    data.paymentPeriods![0]!.kinds[0]!.unresolvedMembers = []
    data.ledger = [
      {
        id: 'rent',
        kind: 'payment',
        title: 'Rent',
        memberId: 'member-a',
        paymentKind: 'rent',
        amountMajor: '300.00',
        currency: 'USD',
        displayAmountMajor: '810.00',
        displayCurrency: 'GEL',
        fxRateMicros: '2700000',
        fxEffectiveDate: '2026-03-01',
        actorDisplayName: 'Ada',
        occurredAt: null
      }
    ]
    expect(modelFor(data).memberLines[0]!.paidMajor).toBe('34.57')
    data.ledger[0]!.paymentKind = 'utilities'
    expect(modelFor(data).memberLines[0]!.paidMajor).toBe('810.00')
  })

  test('shows partial rent payments from the server rent summary', () => {
    const data = dashboard(periodSummary({ rentRemaining: '180.00' }))
    data.rentBillingState.memberSummaries[0]!.paidMajor = '120.00'
    data.rentBillingState.memberSummaries[0]!.remainingMajor = '180.00'
    const model = buildTodayViewModel({
      dashboard: data,
      currentMemberId: 'member-a',
      effectivePeriod: data.period,
      effectiveStage: 'rent'
    })
    expect(model.memberLines[0]!.paidMajor).toBe('120.00')
    expect(model.memberLines[0]!.amountMajor).toBe('180.00')
  })
})

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
        paidMajor: '0.00',
        settled: false,
        isCurrent: true,
        utilityLines: [],
        utilityBreakdown: null
      }
    ])
  })

  test('gives the rail to the open stage once the calendar has moved past its window', () => {
    const utilities = { key: 'utilities', kind: 'utilities' as const }
    const pause = { key: 'pause-before-rent', kind: 'idle' as const }
    // Today sits in the pause, but utilities are still open — the extended period.
    const model = { stage: 'utilities' as const, currentTimelineSegmentKey: 'pause-before-rent' }

    expect(railSegmentState(model, utilities as never)).toBe('active')
    expect(railSegmentState(model, pause as never)).toBe('inactive')
  })

  test('falls back to the calendar segment when no stage is open', () => {
    const pause = { key: 'pause-before-rent', kind: 'idle' as const }
    const rent = { key: 'rent', kind: 'rent' as const }
    const model = { stage: 'idle' as const, currentTimelineSegmentKey: 'pause-before-rent' }

    expect(railSegmentState(model, pause as never)).toBe('active')
    expect(railSegmentState(model, rent as never)).toBe('inactive')
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
              remainingAmountMajor: '24.00',
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
              remainingAmountMajor: '18.00',
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

    expect(model.memberLines[0]!.utilityLines).toEqual([
      {
        billId: 'bill-electricity',
        billName: 'Electricity',
        amountMajor: '24.00',
        paidMajor: '0.00'
      },
      { billId: 'bill-water', billName: 'Water', amountMajor: '18.00', paidMajor: '0.00' }
    ])
  })

  test('flags a shared-purchase balance left over on a closed row', () => {
    const base = dashboard(periodSummary({ utilitiesRemaining: '0.00' }))
    const model = buildTodayViewModel({
      dashboard: {
        ...base,
        members: base.members.map((member) => ({ ...member, purchaseOffsetMajor: '34.78' })),
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
              billTotalMajor: '37.04',
              assignedAmountMajor: '37.04',
              remainingAmountMajor: '0.00',
              assignedMemberId: 'member-a',
              assignedDisplayName: 'Ada',
              paidAmountMajor: '37.04',
              isFullAssignment: true,
              splitGroupId: null
            }
          ],
          memberSummaries: [
            {
              memberId: 'member-a',
              displayName: 'Ada',
              // Share 71.82, but only the 37.04 bill could be routed to her.
              fairShareMajor: '71.82',
              vendorPaidMajor: '37.04',
              assignedThisCycleMajor: '0.00',
              projectedDeltaAfterPlanMajor: '-34.78'
            }
          ]
        }
      },
      currentMemberId: 'member-a',
      effectivePeriod: '2026-03',
      effectiveStage: 'utilities'
    })

    const line = model.memberLines.find((entry) => entry.memberId === 'member-a')
    // She covered the only bill routed to her, so the row closes even though the
    // plan still carries a 37.04 assignment against her name.
    expect(line?.amountMajor).toBe('0.00')
    expect(line?.settled).toBe(true)
    // Closed, but the shared-purchase balance is still hers.
    expect(line?.purchaseBalanceMajor).toBe('34.78')
  })

  test('keeps the sign when a closed member is owed rather than owing', () => {
    const base = dashboard(periodSummary({ utilitiesRemaining: '0.00' }))
    const model = buildTodayViewModel({
      dashboard: {
        ...base,
        members: base.members.map((member) => ({ ...member, purchaseOffsetMajor: '-46.28' }))
      },
      currentMemberId: 'member-a',
      effectivePeriod: '2026-03',
      effectiveStage: 'utilities'
    })

    // The household owes them. Without the sign this member sees nothing at all,
    // because being owed is exactly what closes their row first.
    expect(
      model.memberLines.find((entry) => entry.memberId === 'member-a')?.purchaseBalanceMajor
    ).toBe('-46.28')
  })

  test('exposes current member utility breakdown', () => {
    const model = buildTodayViewModel({
      dashboard: {
        ...dashboard(periodSummary({ utilitiesRemaining: '28.12' })),
        members: [
          {
            ...dashboard(periodSummary()).members[0]!,
            utilityShareMajor: '63.05',
            purchaseOffsetMajor: '-12.00'
          }
        ],
        utilityBillingPlan: {
          version: 1,
          status: 'active',
          dueDate: '2026-03-05',
          updatedFromVersion: null,
          reason: null,
          categories: [],
          memberSummaries: [
            {
              memberId: 'member-a',
              displayName: 'Ada',
              fairShareMajor: '28.12',
              vendorPaidMajor: '0.00',
              assignedThisCycleMajor: '28.12',
              projectedDeltaAfterPlanMajor: '0.00'
            }
          ]
        }
      },
      currentMemberId: 'member-a',
      effectivePeriod: '2026-03',
      effectiveStage: 'utilities'
    })

    expect(model.memberLines[0]!.utilityBreakdown).toEqual({
      shareMajor: '63.05',
      purchaseOffsetMajor: '-34.93',
      targetMajor: '28.12',
      hasAdjustment: true
    })
  })

  test('uses rent billing-state payment destinations when present', () => {
    const householdDestination = {
      label: 'Household card',
      recipientName: 'Nana',
      bankName: 'TBC',
      account: '1111 2222 3333 4444',
      note: null,
      link: null
    }
    const billingStateDestination = {
      label: 'March transfer',
      recipientName: 'Nana',
      bankName: 'Bank of Georgia',
      account: 'GE29BG0000000123456789',
      note: 'March rent',
      link: 'https://bank.example/rent'
    }

    const model = buildTodayViewModel({
      dashboard: {
        ...dashboard(periodSummary({ rentRemaining: '300.00' })),
        rentPaymentDestinations: [householdDestination],
        rentBillingState: {
          ...dashboard(periodSummary({ rentRemaining: '300.00' })).rentBillingState,
          paymentDestinations: [billingStateDestination]
        }
      },
      currentMemberId: 'member-a',
      effectivePeriod: '2026-03',
      effectiveStage: 'rent'
    })

    expect(model.rentPaymentDestinations).toEqual([billingStateDestination])
  })

  test('falls back to household rent payment destinations when billing state has none', () => {
    const householdDestination = {
      label: 'Household card',
      recipientName: 'Nana',
      bankName: 'TBC',
      account: '1111 2222 3333 4444',
      note: null,
      link: null
    }

    const model = buildTodayViewModel({
      dashboard: {
        ...dashboard(periodSummary({ rentRemaining: '300.00' })),
        rentPaymentDestinations: [householdDestination]
      },
      currentMemberId: 'member-a',
      effectivePeriod: '2026-03',
      effectiveStage: 'rent'
    })

    expect(model.rentPaymentDestinations).toEqual([householdDestination])
  })

  test('preserves an empty billing-state payment destination list', () => {
    const householdDestination = {
      label: 'Household card',
      recipientName: 'Nana',
      bankName: 'TBC',
      account: '1111 2222 3333 4444',
      note: null,
      link: null
    }

    const model = buildTodayViewModel({
      dashboard: {
        ...dashboard(periodSummary({ rentRemaining: '300.00' })),
        rentPaymentDestinations: [householdDestination],
        rentBillingState: {
          ...dashboard(periodSummary({ rentRemaining: '300.00' })).rentBillingState,
          paymentDestinations: []
        }
      },
      currentMemberId: 'member-a',
      effectivePeriod: '2026-03',
      effectiveStage: 'rent'
    })

    expect(model.rentPaymentDestinations).toEqual([])
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

test('displayed purchase shares do not change when API participant order changes', () => {
  const entry: MiniAppDashboard['ledger'][number] = {
    id: 'p',
    kind: 'purchase',
    title: 'Uneven purchase',
    memberId: 'alice',
    payerMemberId: 'alice',
    paymentKind: null,
    amountMajor: '10.00',
    currency: 'GEL',
    displayAmountMajor: '10.00',
    displayCurrency: 'GEL',
    fxRateMicros: null,
    fxEffectiveDate: null,
    actorDisplayName: 'Alice',
    occurredAt: null,
    purchaseSplitMode: 'equal'
  }
  for (const ids of [
    ['alice', 'bob', 'carol'],
    ['bob', 'alice', 'carol'],
    ['carol', 'bob', 'alice']
  ]) {
    entry.purchaseParticipants = ids.map((memberId) => ({
      memberId,
      included: true,
      shareAmountMajor: null
    }))
    expect(purchaseShareForMember(entry, 'alice')).toBe('3.34')
    expect(purchaseShareForMember(entry, 'bob')).toBe('3.33')
    expect(purchaseShareForMember(entry, 'carol')).toBe('3.33')
  }
})
