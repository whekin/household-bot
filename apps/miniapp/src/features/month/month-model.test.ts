import { describe, expect, test } from 'bun:test'

import { dashboard, memberLine, period, unresolved } from '../../test/dashboard-fixtures'
import { buildMonthModel } from './month-model'

const today = (day: number) => ({ year: 2026, month: 10, day })

function house() {
  const summary = period('2026-10')
  summary.kinds[1]!.unresolvedMembers = [
    { ...unresolved('me', '55.33'), paidMajor: '0.00' },
    { ...unresolved('el', '147.34'), paidMajor: '0.00' }
  ]
  return dashboard({
    members: [
      memberLine('me'),
      memberLine('chorb', { displayName: 'Chorbanaut' }),
      memberLine('el')
    ],
    paymentPeriods: [summary],
    rentBillingState: {
      dueDate: '2026-10-20',
      paymentDestinations: null,
      memberSummaries: ['me', 'chorb', 'el'].map((memberId) => ({
        memberId,
        displayName: memberId,
        dueMajor: '805.00',
        paidMajor: '0.00',
        remainingMajor: '805.00'
      }))
    },
    utilityCategories: [
      {
        slug: 'water',
        name: 'Water',
        providerName: 'GWP',
        customerNumber: '1',
        paymentLink: null,
        note: null
      },
      {
        slug: 'gas',
        name: 'Gas',
        providerName: null,
        customerNumber: null,
        paymentLink: null,
        note: null
      }
    ],
    ledger: [
      {
        id: 'bill-water',
        kind: 'utility',
        title: 'Water',
        memberId: 'me',
        paymentKind: null,
        amountMajor: '42.00',
        currency: 'GEL',
        displayAmountMajor: '42.00',
        displayCurrency: 'GEL',
        fxRateMicros: null,
        fxEffectiveDate: null,
        actorDisplayName: 'me',
        occurredAt: '2026-10-01T08:00:00.000Z'
      }
    ],
    utilityBillingPlan: {
      version: 1,
      status: 'active',
      dueDate: '2026-10-10',
      updatedFromVersion: null,
      reason: null,
      categories: [
        {
          utilityBillId: 'bill-water',
          billName: 'Water',
          billTotalMajor: '42.00',
          assignedAmountMajor: '42.00',
          remainingAmountMajor: '42.00',
          assignedMemberId: 'me',
          assignedDisplayName: 'me',
          paidAmountMajor: '0.00',
          isFullAssignment: true,
          splitGroupId: null
        }
      ],
      memberSummaries: [
        {
          memberId: 'chorb',
          displayName: 'Chorbanaut',
          fairShareMajor: '95.33',
          vendorPaidMajor: '83.33',
          assignedThisCycleMajor: '0.00',
          projectedDeltaAfterPlanMajor: '0.00'
        }
      ]
    }
  })
}

describe('buildMonthModel', () => {
  test('lists everyone for utilities, me first and open before paid, with paid people from provider marks', () => {
    const model = buildMonthModel({ dashboard: house(), memberId: 'me', today: today(6) })

    expect(
      model.utilities.members.map((row) => [row.memberId, row.remainingMajor, row.paidMajor])
    ).toEqual([
      ['me', '55.33', '0.00'],
      ['el', '147.34', '0.00'],
      ['chorb', '0.00', '83.33']
    ])
    expect(model.utilities.paidCount).toBe(1)
    expect(model.utilities.totalRemainingMajor).toBe('202.67')
    expect(model.utilities.opened).toBe(true)
    expect(model.utilities.late).toBe(false)
  })

  test('shows rent shares as upcoming before the rent window opens', () => {
    const model = buildMonthModel({ dashboard: house(), memberId: 'me', today: today(6) })

    expect(model.rent.opened).toBe(false)
    expect(model.rent.members.every((row) => row.remainingMajor === '805.00')).toBe(true)
  })

  test('marks utilities late after the due date while money is still open', () => {
    const model = buildMonthModel({ dashboard: house(), memberId: 'me', today: today(12) })

    expect(model.utilities.late).toBe(true)
  })

  test('joins bills to plan lines by bill id and lists categories with no bill yet', () => {
    const model = buildMonthModel({ dashboard: house(), memberId: 'me', today: today(6) })

    expect(model.bills).toEqual([
      expect.objectContaining({
        id: 'bill-water',
        providerName: 'GWP',
        remainingMajor: '42.00',
        assignees: [expect.objectContaining({ memberId: 'me', amountMajor: '42.00' })]
      })
    ])
    expect(model.missingBills).toEqual(['Gas'])
    expect(model.planOpen).toBe(true)
  })

  test('collects unpaid rows from earlier months, oldest first', () => {
    const data = house()
    data.paymentPeriods = [
      ...(data.paymentPeriods ?? []),
      period('2026-09', { utilities: '61.20', current: false }),
      period('2026-08', { rent: '805.00', current: false })
    ]
    const model = buildMonthModel({ dashboard: data, memberId: 'me', today: today(6) })

    expect(
      model.earlier.map((debt) => [debt.period, debt.kind, debt.amountMajor, debt.isMe])
    ).toEqual([
      ['2026-08', 'rent', '805.00', true],
      ['2026-09', 'utilities', '61.20', true]
    ])
  })
})
