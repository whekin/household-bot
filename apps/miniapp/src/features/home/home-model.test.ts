import { describe, expect, test } from 'bun:test'

import type { MiniAppDashboard } from '../../api'
import { buildHomeModel, buysSummary, paymentWindows } from './home-model'

type PeriodSummary = NonNullable<MiniAppDashboard['paymentPeriods']>[number]

function unresolved(memberId: string, remainingMajor: string) {
  return {
    memberId,
    displayName: memberId,
    suggestedAmountMajor: remainingMajor,
    baseDueMajor: remainingMajor,
    paidMajor: '0.00',
    remainingMajor,
    effectivelySettled: false
  }
}

function period(
  value: string,
  input: { rent?: string; utilities?: string; current?: boolean } = {}
): PeriodSummary {
  return {
    period: value,
    utilityTotalMajor: '100.00',
    hasOverdueBalance: false,
    isCurrentPeriod: input.current ?? true,
    kinds: [
      {
        kind: 'rent',
        totalDueMajor: '0.00',
        totalPaidMajor: '0.00',
        totalRemainingMajor: input.rent ?? '0.00',
        unresolvedMembers: input.rent ? [unresolved('me', input.rent)] : []
      },
      {
        kind: 'utilities',
        totalDueMajor: '0.00',
        totalPaidMajor: '0.00',
        totalRemainingMajor: input.utilities ?? '0.00',
        unresolvedMembers: input.utilities ? [unresolved('me', input.utilities)] : []
      }
    ]
  }
}

function dashboard(overrides: Partial<MiniAppDashboard> = {}): MiniAppDashboard {
  return {
    period: '2026-10',
    currency: 'GEL',
    timezone: 'Asia/Tbilisi',
    rentWarningDay: 15,
    rentDueDay: 20,
    utilitiesReminderDay: 1,
    utilitiesDueDay: 10,
    paymentBalanceAdjustmentPolicy: 'utilities',
    rentPaymentDestinations: null,
    totalDueMajor: '0.00',
    totalPaidMajor: '0.00',
    totalRemainingMajor: '0.00',
    billingStage: 'idle',
    rentSourceAmountMajor: '0.00',
    rentSourceCurrency: 'GEL',
    rentDisplayAmountMajor: '0.00',
    rentFxRateMicros: null,
    rentFxEffectiveDate: null,
    utilityBillingPlan: null,
    rentBillingState: {
      dueDate: '2026-10-20',
      paymentDestinations: null,
      memberSummaries: [
        {
          memberId: 'me',
          displayName: 'me',
          dueMajor: '800.00',
          paidMajor: '0.00',
          remainingMajor: '800.00'
        }
      ]
    },
    members: [
      {
        memberId: 'me',
        displayName: 'me',
        predictedUtilityShareMajor: '100.00',
        rentShareMajor: '800.00',
        utilityShareMajor: '100.00',
        purchaseOffsetMajor: '0.00',
        netDueMajor: '900.00',
        paidMajor: '0.00',
        remainingMajor: '900.00',
        overduePayments: [],
        explanations: []
      }
    ],
    paymentPeriods: [],
    ledger: [],
    notifications: [],
    ...overrides
  }
}

const today = (day: number, month = 10) => ({ year: 2026, month, day })

describe('buildHomeModel', () => {
  test('owes what paymentPeriods lists for the member, counting days to the due date', () => {
    const model = buildHomeModel({
      dashboard: dashboard({ paymentPeriods: [period('2026-10', { utilities: '55.33' })] }),
      memberId: 'me',
      today: today(6)
    })

    expect(model.status).toBe('due')
    expect(model.totalDueMajor).toBe('55.33')
    expect(model.obligations).toEqual([
      expect.objectContaining({
        kind: 'utilities',
        dueDate: '2026-10-10',
        daysLeft: 4,
        overdue: false
      })
    ])
  })

  test('marks an older month and a passed due date as overdue and lists them first', () => {
    const model = buildHomeModel({
      dashboard: dashboard({
        paymentPeriods: [
          period('2026-10', { utilities: '55.33', rent: '800.00' }),
          period('2026-09', { utilities: '61.20', current: false })
        ]
      }),
      memberId: 'me',
      today: today(16)
    })

    expect(model.status).toBe('overdue')
    expect(model.totalDueMajor).toBe('916.53')
    expect(model.obligations.map((entry) => [entry.key, entry.overdue])).toEqual([
      ['2026-09:utilities', true],
      ['2026-10:utilities', true],
      ['2026-10:rent', false]
    ])
  })

  test('ignores other members and settled rows', () => {
    const summary = period('2026-10')
    summary.kinds[1]!.unresolvedMembers = [
      unresolved('someone-else', '40.00'),
      { ...unresolved('me', '0.00'), effectivelySettled: true }
    ]
    const model = buildHomeModel({
      dashboard: dashboard({ paymentPeriods: [summary] }),
      memberId: 'me',
      today: today(6)
    })

    expect(model.status).toBe('clear')
    expect(model.obligations).toEqual([])
  })

  test('when clear, points at the next window that has not opened yet', () => {
    const model = buildHomeModel({
      dashboard: dashboard(),
      memberId: 'me',
      today: today(12)
    })

    expect(model.next).toEqual({
      kind: 'rent',
      startDate: '2026-10-15',
      endDate: '2026-10-20',
      estimateMajor: '800.00'
    })
  })

  test("after rent, the next window is next month's utilities without an estimate", () => {
    const model = buildHomeModel({ dashboard: dashboard(), memberId: 'me', today: today(25) })

    expect(model.next).toEqual({
      kind: 'utilities',
      startDate: '2026-11-01',
      endDate: '2026-11-10',
      estimateMajor: null
    })
  })

  test('lists only my unpaid plan bills, with provider details matched by name', () => {
    const model = buildHomeModel({
      dashboard: dashboard({
        paymentPeriods: [period('2026-10', { utilities: '55.33' })],
        utilityCategories: [
          {
            slug: 'water',
            name: 'Water',
            providerName: 'GWP',
            customerNumber: '998877',
            paymentLink: null,
            note: null
          }
        ],
        utilityBillingPlan: {
          version: 1,
          status: 'active',
          dueDate: '2026-10-10',
          updatedFromVersion: null,
          reason: null,
          memberSummaries: [],
          categories: [
            {
              utilityBillId: 'water',
              billName: 'water ',
              billTotalMajor: '42.00',
              assignedAmountMajor: '42.00',
              remainingAmountMajor: '42.00',
              assignedMemberId: 'me',
              assignedDisplayName: 'me',
              paidAmountMajor: '0.00',
              isFullAssignment: true,
              splitGroupId: null
            },
            {
              utilityBillId: 'internet',
              billName: 'Internet',
              billTotalMajor: '80.00',
              assignedAmountMajor: '13.33',
              remainingAmountMajor: '0.00',
              assignedMemberId: 'me',
              assignedDisplayName: 'me',
              paidAmountMajor: '13.33',
              isFullAssignment: false,
              splitGroupId: 'internet'
            }
          ]
        }
      }),
      memberId: 'me',
      today: today(6)
    })

    expect(model.myBills).toEqual([
      expect.objectContaining({
        billId: 'water',
        amountMajor: '42.00',
        providerName: 'GWP',
        customerNumber: '998877'
      })
    ])
  })
})

describe('paymentWindows', () => {
  test('starts the utilities window in the previous month when the reminder day is after the due day', () => {
    const [utilities] = paymentWindows(
      { utilitiesReminderDay: 28, utilitiesDueDay: 5, rentWarningDay: 15, rentDueDay: 20 },
      '2026-03'
    )
    expect(utilities).toEqual({ kind: 'utilities', startDate: '2026-02-28', endDate: '2026-03-05' })
  })
})

describe('buysSummary', () => {
  test('says the direction instead of a sign and follows the house policy', () => {
    const owed = dashboard()
    owed.members[0]!.purchaseOffsetMajor = '-40.00'
    expect(buysSummary(owed, 'me')).toEqual({
      buysBalanceMajor: '-40.00',
      buysDirection: 'owed',
      buysSettleThrough: 'utilities'
    })

    const owes = dashboard({ paymentBalanceAdjustmentPolicy: 'separate' })
    owes.members[0]!.purchaseOffsetMajor = '12.50'
    expect(buysSummary(owes, 'me')).toMatchObject({
      buysDirection: 'owe',
      buysSettleThrough: 'direct'
    })
  })
})
