import { minorToMajorString } from '@/lib/money'
import type {
  MiniAppAdminCycleState,
  MiniAppAdminSettingsPayload,
  MiniAppDashboard,
  MiniAppPendingMember,
  MiniAppSession
} from '../api'

/**
 * Dev-only demo household. Each scenario is generated from one small set of facts
 * (members, bills, purchases, payments) so every screen reads the same story:
 * what Home says you owe is what Month and History add up to.
 */
export type DemoScenarioId = 'utilities-due' | 'rent-due' | 'all-set' | 'overdue'

export const demoScenarioIds: readonly DemoScenarioId[] = [
  'utilities-due',
  'rent-due',
  'all-set',
  'overdue'
]

type DemoScenarioState = {
  dashboard: MiniAppDashboard
  pendingMembers: readonly MiniAppPendingMember[]
  adminSettings: MiniAppAdminSettingsPayload
  cycleState: MiniAppAdminCycleState
}

type DemoStateOverrides = {
  periodOverride?: string | null
  todayOverride?: string | null
}

type Ledger = MiniAppDashboard['ledger']
type MemberId = 'demo-member' | 'member-chorb' | 'member-el'

export const demoMember: NonNullable<MiniAppSession['member']> = {
  id: 'demo-member',
  householdId: 'demo-household',
  householdName: 'Kojori House',
  displayName: 'Stas',
  status: 'active',
  isAdmin: true,
  preferredLocale: 'en',
  householdDefaultLocale: 'en'
}

export const demoTelegramUser: NonNullable<MiniAppSession['telegramUser']> = {
  firstName: 'Stas',
  username: 'stas_demo',
  languageCode: 'en'
}

const NAMES: Record<MemberId, string> = {
  'demo-member': 'Stas',
  'member-chorb': 'Chorbanaut',
  'member-el': 'El'
}
const MEMBER_IDS: readonly MemberId[] = ['demo-member', 'member-chorb', 'member-el']

const RENT_WARNING_DAY = 15
const RENT_DUE_DAY = 20
const UTILITIES_REMINDER_DAY = 1
const UTILITIES_DUE_DAY = 10

/** All amounts below are minor units (tetri). */
const RENT_SHARE = 80500
const UTILITY_BILLS = [
  { id: 'bill-electricity', name: 'Electricity', amount: 16400 },
  { id: 'bill-internet', name: 'Internet', amount: 8000 },
  { id: 'bill-water', name: 'Water', amount: 4200 }
] as const
const UTILITY_SHARES: Record<MemberId, number> = {
  'demo-member': 9533,
  'member-chorb': 9533,
  'member-el': 9534
}

const rentPaymentDestinations = [
  {
    label: 'Landlord · TBC card',
    recipientName: 'Nana Beridze',
    bankName: 'TBC Bank',
    account: '1234 5678 9012 3456',
    note: 'Message: Kojori House rent',
    link: null
  },
  {
    label: 'Bank of Georgia transfer',
    recipientName: 'Nana Beridze',
    bankName: 'Bank of Georgia',
    account: 'GE29BG0000000123456789',
    note: 'Use if the card transfer fails',
    link: 'https://bank.example/rent'
  }
] as const

const utilityCategories = [
  {
    slug: 'electricity',
    name: 'Electricity',
    providerName: 'Telasi',
    customerNumber: '00012345',
    paymentLink: 'https://pay.example/telasi',
    note: null
  },
  {
    slug: 'internet',
    name: 'Internet',
    providerName: 'Magti',
    customerNumber: 'KOJORI-88',
    paymentLink: null,
    note: 'Pay in the Magti app'
  },
  {
    slug: 'water',
    name: 'Water',
    providerName: 'GWP',
    customerNumber: '998877',
    paymentLink: null,
    note: null
  }
] as const

const pendingMembers: readonly MiniAppPendingMember[] = [
  { telegramUserId: '555777', displayName: 'Mia', username: 'mia', languageCode: 'ru' }
]

const money = (minor: number) => minorToMajorString(BigInt(minor))

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function parsePeriod(period: string) {
  const [year, month] = period.split('-').map((part) => Number.parseInt(part, 10))
  return { year: year ?? 2026, month: month ?? 1 }
}

function shiftPeriod(period: string, delta: number) {
  const { year, month } = parsePeriod(period)
  const date = new Date(Date.UTC(year, month - 1 + delta, 1))
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`
}

function day(period: string, value: number, time = '12:00') {
  return `${period}-${pad(value)}T${time}:00.000Z`
}

/* ── Scenario facts ──────────────────────────────────── */

type PurchaseFact = {
  id: string
  title: string
  payer: MemberId
  amount: number
  day: number
  period: 'current' | 'previous'
  /** Shares of each participant, payer included. */
  shares: Record<MemberId, number>
  resolved: boolean
}

type ScenarioFacts = {
  today: number
  purchases: PurchaseFact[]
  /** Utility plan: bill → who pays how much. */
  plan: { billId: string; member: MemberId; amount: number }[]
  /** Utility amounts each member has already paid to providers this period. */
  utilitiesPaid: Partial<Record<MemberId, number>>
  rentPaid: Partial<Record<MemberId, number>>
  /** Unpaid utilities from last month, per member. */
  overdueUtilities?: Partial<Record<MemberId, number>>
}

const PARTY_GROCERIES: PurchaseFact = {
  id: 'purchase-groceries',
  title: 'Groceries for the barbecue',
  payer: 'member-chorb',
  amount: 12000,
  day: 12,
  period: 'current',
  shares: { 'demo-member': 4000, 'member-chorb': 4000, 'member-el': 4000 },
  resolved: false
}

const SPONGES: PurchaseFact = {
  id: 'purchase-sponges',
  title: 'Dish soap and sponges',
  payer: 'demo-member',
  amount: 4500,
  day: 21,
  period: 'current',
  shares: { 'demo-member': 1500, 'member-chorb': 1500, 'member-el': 1500 },
  resolved: false
}

const HEATER: PurchaseFact = {
  id: 'purchase-heater',
  title: 'Gas heater refill',
  payer: 'member-chorb',
  amount: 5400,
  day: 27,
  period: 'previous',
  shares: { 'demo-member': 1800, 'member-chorb': 1800, 'member-el': 1800 },
  resolved: false
}

const FILTERS: PurchaseFact = {
  id: 'purchase-filters',
  title: 'Water filter cartridges',
  payer: 'demo-member',
  amount: 9600,
  day: 3,
  period: 'current',
  shares: { 'demo-member': 3800, 'member-chorb': 2400, 'member-el': 3400 },
  resolved: false
}

const CLEANING: PurchaseFact = {
  id: 'purchase-cleaning',
  title: 'Bulk cleaning supplies',
  payer: 'demo-member',
  amount: 7200,
  day: 18,
  period: 'previous',
  shares: { 'demo-member': 2400, 'member-chorb': 2400, 'member-el': 2400 },
  resolved: true
}

/*
 * Before utilities settle, the open buys are the heater (Chorbanaut) and the filters
 * (Stas): Stas −40.00, Chorbanaut −12.00, El +52.00. Utility targets are the bill share
 * plus that balance, so the plan below hands out exactly 286.00.
 */
const UTILITY_PLAN: ScenarioFacts['plan'] = [
  { billId: 'bill-water', member: 'demo-member', amount: 4200 },
  { billId: 'bill-internet', member: 'demo-member', amount: 1333 },
  { billId: 'bill-internet', member: 'member-chorb', amount: 6667 },
  { billId: 'bill-electricity', member: 'member-chorb', amount: 1666 },
  { billId: 'bill-electricity', member: 'member-el', amount: 14734 }
]

const ALL_UTILITIES_PAID = { 'demo-member': 5533, 'member-chorb': 8333, 'member-el': 14734 }

const scenarioFacts: Record<DemoScenarioId, ScenarioFacts> = {
  'utilities-due': {
    today: 6,
    purchases: [CLEANING, HEATER, FILTERS],
    plan: UTILITY_PLAN,
    utilitiesPaid: { 'member-chorb': 8333 },
    rentPaid: {}
  },
  'rent-due': {
    today: 17,
    purchases: [
      CLEANING,
      { ...HEATER, resolved: true },
      { ...FILTERS, resolved: true },
      PARTY_GROCERIES
    ],
    plan: UTILITY_PLAN,
    utilitiesPaid: ALL_UTILITIES_PAID,
    rentPaid: { 'member-el': RENT_SHARE }
  },
  'all-set': {
    today: 23,
    purchases: [
      CLEANING,
      { ...HEATER, resolved: true },
      { ...FILTERS, resolved: true },
      { ...PARTY_GROCERIES, resolved: true },
      SPONGES
    ],
    plan: UTILITY_PLAN,
    utilitiesPaid: ALL_UTILITIES_PAID,
    rentPaid: { 'demo-member': RENT_SHARE, 'member-chorb': RENT_SHARE, 'member-el': RENT_SHARE }
  },
  overdue: {
    today: 12,
    purchases: [CLEANING, HEATER, FILTERS],
    plan: UTILITY_PLAN,
    utilitiesPaid: { 'member-chorb': 8333, 'member-el': 14734 },
    rentPaid: {},
    overdueUtilities: { 'demo-member': 6120 }
  }
}

/* ── Derivations ─────────────────────────────────────── */

function purchaseOffsets(purchases: readonly PurchaseFact[]): Record<MemberId, number> {
  const offsets: Record<MemberId, number> = { 'demo-member': 0, 'member-chorb': 0, 'member-el': 0 }
  for (const purchase of purchases) {
    if (purchase.resolved) continue
    for (const memberId of MEMBER_IDS) {
      if (memberId === purchase.payer) continue
      const share = purchase.shares[memberId]
      offsets[memberId] += share
      offsets[purchase.payer] -= share
    }
  }
  return offsets
}

function buildLedger(period: string, facts: ScenarioFacts): Ledger {
  const previous = shiftPeriod(period, -1)
  const entries: Ledger = []

  for (const purchase of facts.purchases) {
    const origin = purchase.period === 'current' ? period : previous
    entries.push({
      id: purchase.id,
      kind: 'purchase',
      title: purchase.title,
      memberId: purchase.payer,
      paymentKind: null,
      amountMajor: money(purchase.amount),
      currency: 'GEL',
      displayAmountMajor: money(purchase.amount),
      displayCurrency: 'GEL',
      fxRateMicros: null,
      fxEffectiveDate: null,
      actorDisplayName: NAMES[purchase.payer],
      occurredAt: day(origin, purchase.day, '18:30'),
      originPeriod: origin,
      isCurrentCyclePurchase: purchase.period === 'current',
      resolutionStatus: purchase.resolved ? 'resolved' : 'unresolved',
      resolvedAt: purchase.resolved ? day(period, Math.min(facts.today, 9)) : null,
      outstandingByMember: purchase.resolved
        ? []
        : MEMBER_IDS.filter((id) => id !== purchase.payer).map((id) => ({
            memberId: id,
            amountMajor: money(purchase.shares[id])
          })),
      payerMemberId: purchase.payer,
      createdByMemberId: purchase.payer,
      hasRecordedAllocations: purchase.resolved,
      purchaseSplitMode:
        new Set(Object.values(purchase.shares)).size > 1 ? 'custom_amounts' : 'equal',
      purchaseParticipants: MEMBER_IDS.map((id) => ({
        memberId: id,
        included: true,
        shareAmountMajor: money(purchase.shares[id])
      }))
    })
  }

  UTILITY_BILLS.forEach((bill, index) => {
    entries.push({
      id: bill.id,
      kind: 'utility',
      title: bill.name,
      memberId: null,
      paymentKind: null,
      amountMajor: money(bill.amount),
      currency: 'GEL',
      displayAmountMajor: money(bill.amount),
      displayCurrency: 'GEL',
      fxRateMicros: null,
      fxEffectiveDate: null,
      actorDisplayName: index === 2 ? NAMES['member-chorb'] : NAMES['demo-member'],
      occurredAt: day(period, 1, `0${index + 7}:15`)
    })
  })

  for (const memberId of MEMBER_IDS) {
    const utilities = facts.utilitiesPaid[memberId]
    if (utilities) {
      entries.push(
        paymentEntry(
          memberId,
          'utilities',
          utilities,
          day(period, memberId === 'member-chorb' ? 3 : 8, '20:00')
        )
      )
    }
    const rent = facts.rentPaid[memberId]
    if (rent) {
      entries.push(
        paymentEntry(
          memberId,
          'rent',
          rent,
          day(period, memberId === 'member-el' ? 15 : 19, '10:40')
        )
      )
    }
  }

  return entries.sort((left, right) =>
    (right.occurredAt ?? '').localeCompare(left.occurredAt ?? '')
  )
}

function paymentEntry(
  memberId: MemberId,
  kind: 'rent' | 'utilities',
  amount: number,
  occurredAt: string
): Ledger[number] {
  return {
    id: `payment-${kind}-${memberId}`,
    kind: 'payment',
    title: kind,
    memberId,
    paymentKind: kind,
    amountMajor: money(amount),
    currency: 'GEL',
    displayAmountMajor: money(amount),
    displayCurrency: 'GEL',
    fxRateMicros: null,
    fxEffectiveDate: null,
    actorDisplayName: NAMES[memberId],
    occurredAt
  }
}

function buildDashboard(period: string, todayDay: number, facts: ScenarioFacts): MiniAppDashboard {
  const previous = shiftPeriod(period, -1)
  const ledger = buildLedger(period, facts)

  // Utilities are settled through the plan; before they are, the open buys feed into it.
  const utilityTargets: Record<MemberId, number> = {
    'demo-member': 0,
    'member-chorb': 0,
    'member-el': 0
  }
  for (const line of facts.plan) utilityTargets[line.member] += line.amount

  const offsets = purchaseOffsets(facts.purchases)
  const rentOpen = todayDay >= RENT_WARNING_DAY
  const utilitiesLate = todayDay > UTILITIES_DUE_DAY
  const rentLate = todayDay > RENT_DUE_DAY

  const utilityRemaining = (id: MemberId) =>
    Math.max(0, utilityTargets[id] - (facts.utilitiesPaid[id] ?? 0))
  const rentRemaining = (id: MemberId) => Math.max(0, RENT_SHARE - (facts.rentPaid[id] ?? 0))

  const members: MiniAppDashboard['members'] = MEMBER_IDS.map((id) => {
    const overdue = facts.overdueUtilities?.[id] ?? 0
    const paid = (facts.utilitiesPaid[id] ?? 0) + (facts.rentPaid[id] ?? 0)
    const netDue = RENT_SHARE + UTILITY_SHARES[id] + offsets[id]
    return {
      memberId: id,
      displayName: NAMES[id],
      status: 'active',
      daysPresent: 30,
      predictedUtilityShareMajor: money(UTILITY_SHARES[id]),
      rentShareMajor: money(RENT_SHARE),
      utilityShareMajor: money(UTILITY_SHARES[id]),
      purchaseOffsetMajor: money(offsets[id]),
      netDueMajor: money(netDue),
      paidMajor: money(paid),
      remainingMajor: money(Math.max(0, netDue - paid)),
      overduePayments: [
        ...(overdue > 0
          ? [{ kind: 'utilities' as const, amountMajor: money(overdue), periods: [previous] }]
          : []),
        ...(utilitiesLate && utilityRemaining(id) > 0
          ? [
              {
                kind: 'utilities' as const,
                amountMajor: money(utilityRemaining(id)),
                periods: [period]
              }
            ]
          : []),
        ...(rentLate && rentRemaining(id) > 0
          ? [{ kind: 'rent' as const, amountMajor: money(rentRemaining(id)), periods: [period] }]
          : [])
      ],
      explanations: []
    }
  })

  const unresolved = (kind: 'rent' | 'utilities') =>
    MEMBER_IDS.map((id) => {
      const due = kind === 'rent' ? RENT_SHARE : utilityTargets[id]
      const paid = kind === 'rent' ? (facts.rentPaid[id] ?? 0) : (facts.utilitiesPaid[id] ?? 0)
      const remaining = Math.max(0, due - paid)
      return {
        memberId: id,
        displayName: NAMES[id],
        suggestedAmountMajor: money(remaining),
        baseDueMajor: money(due),
        paidMajor: money(paid),
        remainingMajor: money(remaining),
        effectivelySettled: remaining === 0
      }
    }).filter((member) => !member.effectivelySettled)

  const kindTotals = (kind: 'rent' | 'utilities') => {
    const due = MEMBER_IDS.reduce(
      (sum, id) => sum + (kind === 'rent' ? RENT_SHARE : utilityTargets[id]),
      0
    )
    const paid = MEMBER_IDS.reduce(
      (sum, id) =>
        sum + (kind === 'rent' ? (facts.rentPaid[id] ?? 0) : (facts.utilitiesPaid[id] ?? 0)),
      0
    )
    return {
      totalDueMajor: money(due),
      totalPaidMajor: money(paid),
      totalRemainingMajor: money(due - paid)
    }
  }

  const paymentPeriods: NonNullable<MiniAppDashboard['paymentPeriods']> = [
    {
      period,
      utilityTotalMajor: '286.00',
      hasOverdueBalance:
        (utilitiesLate && MEMBER_IDS.some((id) => utilityRemaining(id) > 0)) ||
        (rentLate && MEMBER_IDS.some((id) => rentRemaining(id) > 0)),
      isCurrentPeriod: true,
      kinds: [
        {
          kind: 'rent',
          ...kindTotals('rent'),
          unresolvedMembers: rentOpen ? unresolved('rent') : []
        },
        {
          kind: 'utilities',
          ...kindTotals('utilities'),
          unresolvedMembers: unresolved('utilities')
        }
      ]
    }
  ]

  if (facts.overdueUtilities) {
    const overdueMembers = MEMBER_IDS.flatMap((id) => {
      const amount = facts.overdueUtilities?.[id] ?? 0
      return amount > 0
        ? [
            {
              memberId: id,
              displayName: NAMES[id],
              suggestedAmountMajor: money(amount),
              baseDueMajor: money(amount),
              paidMajor: '0.00',
              remainingMajor: money(amount),
              effectivelySettled: false
            }
          ]
        : []
    })
    const total = MEMBER_IDS.reduce((sum, id) => sum + (facts.overdueUtilities?.[id] ?? 0), 0)
    paymentPeriods.push({
      period: previous,
      utilityTotalMajor: '301.20',
      hasOverdueBalance: true,
      isCurrentPeriod: false,
      kinds: [
        {
          kind: 'rent',
          totalDueMajor: money(RENT_SHARE * 3),
          totalPaidMajor: money(RENT_SHARE * 3),
          totalRemainingMajor: '0.00',
          unresolvedMembers: []
        },
        {
          kind: 'utilities',
          totalDueMajor: '301.20',
          totalPaidMajor: money(30120 - total),
          totalRemainingMajor: money(total),
          unresolvedMembers: overdueMembers
        }
      ]
    })
  }

  const planSettled = MEMBER_IDS.every((id) => utilityRemaining(id) === 0)
  const vendorPayments: NonNullable<
    NonNullable<MiniAppDashboard['utilityBillingPlan']>['vendorPayments']
  >[number][] = []
  const categories = facts.plan.map((line, index) => {
    const bill = UTILITY_BILLS.find((entry) => entry.id === line.billId)!
    const memberPaid = facts.utilitiesPaid[line.member] ?? 0
    // A member pays their lines in plan order; whatever they have paid covers the earliest ones.
    const before = facts.plan
      .slice(0, index)
      .filter((entry) => entry.member === line.member)
      .reduce((sum, entry) => sum + entry.amount, 0)
    const paid = Math.max(0, Math.min(line.amount, memberPaid - before))
    if (paid > 0) {
      vendorPayments.push({
        id: `vendor-${line.billId}-${line.member}`,
        utilityBillId: line.billId,
        billName: bill.name,
        payerMemberId: line.member,
        payerDisplayName: NAMES[line.member],
        amountMajor: money(paid),
        matchedPlan: true,
        recordedAt: day(period, line.member === 'member-chorb' ? 3 : 8, '20:00')
      })
    }
    const isFull = line.amount === bill.amount
    return {
      utilityBillId: bill.id,
      billName: bill.name,
      billTotalMajor: money(bill.amount),
      assignedAmountMajor: money(line.amount),
      remainingAmountMajor: money(line.amount - paid),
      assignedMemberId: line.member,
      assignedDisplayName: NAMES[line.member],
      paidAmountMajor: money(paid),
      isFullAssignment: isFull,
      splitGroupId: isFull ? null : bill.id
    }
  })

  const cycleHistory: NonNullable<MiniAppDashboard['cycleHistory']> = [1, 2].map((back) => {
    const historyPeriod = shiftPeriod(period, -back)
    const overdue =
      back === 1 ? MEMBER_IDS.reduce((sum, id) => sum + (facts.overdueUtilities?.[id] ?? 0), 0) : 0
    const utilityTotal = back === 1 ? 30120 : 27450
    const total = RENT_SHARE * 3 + utilityTotal
    return {
      period: historyPeriod,
      currency: 'GEL',
      source: 'frozen',
      totalDueMajor: money(total),
      totalPaidMajor: money(total - overdue),
      totalRemainingMajor: money(overdue),
      rentTotalMajor: money(RENT_SHARE * 3),
      utilityTotalMajor: money(utilityTotal),
      purchaseVolumeMajor: back === 1 ? '126.00' : '88.40',
      purchaseCount: back === 1 ? 2 : 3,
      members: MEMBER_IDS.map((id) => {
        const utility = Math.round(utilityTotal / 3)
        const left = back === 1 ? (facts.overdueUtilities?.[id] ?? 0) : 0
        return {
          memberId: id,
          displayName: NAMES[id],
          rentShareMajor: money(RENT_SHARE),
          utilityShareMajor: money(utility),
          purchaseOffsetMajor: '0.00',
          netDueMajor: money(RENT_SHARE + utility),
          paidMajor: money(RENT_SHARE + utility - left),
          remainingMajor: money(left)
        }
      }),
      purchaseContributors: [
        {
          memberId: 'demo-member',
          displayName: 'Stas',
          amountMajor: back === 1 ? '72.00' : '41.40',
          purchaseCount: back === 1 ? 1 : 2
        },
        {
          memberId: 'member-chorb',
          displayName: 'Chorbanaut',
          amountMajor: back === 1 ? '54.00' : '47.00',
          purchaseCount: 1
        }
      ]
    }
  })

  const totals = MEMBER_IDS.reduce(
    (sum, id) => ({
      due: sum.due + RENT_SHARE + UTILITY_SHARES[id] + offsets[id],
      paid: sum.paid + (facts.utilitiesPaid[id] ?? 0) + (facts.rentPaid[id] ?? 0)
    }),
    { due: 0, paid: 0 }
  )

  return {
    period,
    currency: 'GEL',
    timezone: 'Asia/Tbilisi',
    rentWarningDay: RENT_WARNING_DAY,
    rentDueDay: RENT_DUE_DAY,
    utilitiesReminderDay: UTILITIES_REMINDER_DAY,
    utilitiesDueDay: UTILITIES_DUE_DAY,
    paymentBalanceAdjustmentPolicy: 'utilities',
    rentPaymentDestinations,
    totalDueMajor: money(totals.due),
    totalPaidMajor: money(totals.paid),
    totalRemainingMajor: money(totals.due - totals.paid),
    billingStage:
      rentOpen && MEMBER_IDS.some((id) => rentRemaining(id) > 0) && planSettled
        ? 'rent'
        : planSettled
          ? 'idle'
          : 'utilities',
    rentSourceAmountMajor: '875.00',
    rentSourceCurrency: 'USD',
    rentDisplayAmountMajor: money(RENT_SHARE * 3),
    rentFxRateMicros: '2760000',
    rentFxEffectiveDate: `${period}-${pad(RENT_WARNING_DAY)}`,
    utilityBillingPlan: {
      version: 1,
      status: planSettled ? 'settled' : 'active',
      dueDate: `${period}-${pad(UTILITIES_DUE_DAY)}`,
      updatedFromVersion: null,
      reason: null,
      categories,
      memberSummaries: MEMBER_IDS.map((id) => ({
        memberId: id,
        displayName: NAMES[id],
        fairShareMajor: money(UTILITY_SHARES[id]),
        vendorPaidMajor: money(facts.utilitiesPaid[id] ?? 0),
        assignedThisCycleMajor: money(utilityRemaining(id)),
        projectedDeltaAfterPlanMajor: '0.00'
      })),
      vendorPayments
    },
    rentBillingState: {
      dueDate: `${period}-${pad(RENT_DUE_DAY)}`,
      paymentDestinations: rentPaymentDestinations,
      memberSummaries: MEMBER_IDS.map((id) => ({
        memberId: id,
        displayName: NAMES[id],
        dueMajor: money(RENT_SHARE),
        paidMajor: money(facts.rentPaid[id] ?? 0),
        remainingMajor: money(rentRemaining(id))
      }))
    },
    utilityCategories,
    members,
    paymentPeriods,
    cycleHistory,
    ledger,
    notifications: []
  }
}

/* ── Admin payloads ──────────────────────────────────── */

function buildAdminSettings(): MiniAppAdminSettingsPayload {
  return {
    householdName: 'Kojori House',
    settings: {
      householdId: 'demo-household',
      settlementCurrency: 'GEL',
      paymentBalanceAdjustmentPolicy: 'utilities',
      rentAmountMinor: '87500',
      rentCurrency: 'USD',
      rentDueDay: RENT_DUE_DAY,
      rentWarningDay: RENT_WARNING_DAY,
      utilitiesDueDay: UTILITIES_DUE_DAY,
      utilitiesReminderDay: UTILITIES_REMINDER_DAY,
      preferredUtilityPayerMemberId: null,
      timezone: 'Asia/Tbilisi',
      rentPaymentDestinations
    },
    assistantConfig: {
      householdId: 'demo-household',
      assistantContext:
        'A shared house in Kojori with a backyard and a long-running purchase ledger.',
      assistantTone: 'Playful but concise'
    },
    notificationSettings: {
      householdId: 'demo-household',
      periodEvents: true,
      planEvents: true,
      purchaseEvents: true,
      paymentEvents: true
    },
    topics: [
      { role: 'purchase', telegramThreadId: '101', topicName: 'Purchases' },
      { role: 'feedback', telegramThreadId: '102', topicName: 'Anonymous feedback' },
      { role: 'reminders', telegramThreadId: '103', topicName: 'Reminders' },
      { role: 'payments', telegramThreadId: '104', topicName: 'Payments' },
      { role: 'notifications', telegramThreadId: '105', topicName: 'Notifications' }
    ],
    categories: utilityCategories.map((category, index) => ({
      id: `cat-${category.slug}`,
      householdId: 'demo-household',
      sortOrder: index,
      isActive: true,
      ...category
    })),
    facts: [
      {
        key: 'wifi',
        title: 'Wi-Fi',
        body: 'Network Kojori-5G, password hunter2hunter2',
        updatedAt: '2026-07-01T10:00:00Z'
      },
      {
        key: 'trash-day',
        title: 'Trash',
        body: 'Collected Tuesday and Friday mornings; bins go out the night before.',
        updatedAt: '2026-07-02T08:30:00Z'
      }
    ],
    members: MEMBER_IDS.map((id) => ({
      id,
      displayName: NAMES[id],
      status: 'active',
      rentShareWeight: 1,
      isAdmin: id === 'demo-member'
    }))
  }
}

function buildCycleState(period: string): MiniAppAdminCycleState {
  return {
    cycle: { id: `cycle-demo-${period}`, period, currency: 'GEL' },
    rentRule: null,
    utilityBills: UTILITY_BILLS.map((bill) => ({
      id: bill.id,
      billName: bill.name,
      amountMinor: String(bill.amount),
      currency: 'GEL',
      createdByMemberId: 'demo-member',
      createdAt: day(period, 1, '09:15')
    }))
  }
}

/* ── Public API ──────────────────────────────────────── */

function currentPeriod(): string {
  const now = new Date()
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`
}

export function getDemoScenarioDefaultToday(
  id: DemoScenarioId,
  periodOverride?: string | null
): string {
  const period = periodOverride?.trim() || currentPeriod()
  return `${period}-${pad(scenarioFacts[id].today)}`
}

export function getDemoScenarioState(
  id: DemoScenarioId,
  overrides: DemoStateOverrides = {}
): DemoScenarioState {
  const today = overrides.todayOverride?.trim() || null
  const period = overrides.periodOverride?.trim() || today?.slice(0, 7) || currentPeriod()
  const todayDay = today ? Number.parseInt(today.slice(8, 10), 10) : scenarioFacts[id].today

  return {
    dashboard: buildDashboard(period, todayDay, scenarioFacts[id]),
    pendingMembers,
    adminSettings: buildAdminSettings(),
    cycleState: buildCycleState(period)
  }
}
