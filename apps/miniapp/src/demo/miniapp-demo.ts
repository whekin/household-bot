import type {
  MiniAppAdminCycleState,
  MiniAppAdminSettingsPayload,
  MiniAppDashboard,
  MiniAppPendingMember,
  MiniAppSession
} from '../miniapp-api'

export type DemoScenarioId = 'current-cycle' | 'overdue-utilities' | 'overdue-rent-and-utilities'

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

const rentPaymentDestinations = [
  {
    label: 'Landlord TBC card',
    recipientName: 'Nana Beridze',
    bankName: 'TBC Bank',
    account: '1234 5678 9012 3456',
    note: 'Message: Kojori House rent',
    link: null
  },
  {
    label: 'USD fallback transfer',
    recipientName: 'Nana Beridze',
    bankName: 'Bank of Georgia',
    account: 'GE29BG0000000123456789',
    note: 'Use only if GEL transfer is unavailable',
    link: 'https://bank.example/rent'
  }
] as const

const pendingMembers: readonly MiniAppPendingMember[] = [
  {
    telegramUserId: '555777',
    displayName: 'Mia',
    username: 'mia',
    languageCode: 'ru'
  },
  {
    telegramUserId: '777999',
    displayName: 'Dima',
    username: 'dima',
    languageCode: 'en'
  },
  {
    telegramUserId: '888111',
    displayName: 'Nika',
    username: 'nika_forest',
    languageCode: 'en'
  }
]

const adminSettings: MiniAppAdminSettingsPayload = {
  householdName: 'Kojori House',
  settings: {
    householdId: 'demo-household',
    settlementCurrency: 'GEL',
    paymentBalanceAdjustmentPolicy: 'utilities',
    rentAmountMinor: '241500',
    rentCurrency: 'USD',
    rentDueDay: 20,
    rentWarningDay: 17,
    utilitiesDueDay: 4,
    utilitiesReminderDay: 3,
    timezone: 'Asia/Tbilisi',
    rentPaymentDestinations
  },
  assistantConfig: {
    householdId: 'demo-household',
    assistantContext:
      'The household is a large shared house in Kojori with a backyard, a guest room, and a long-running purchase ledger.',
    assistantTone: 'Playful but concise'
  },
  topics: [
    { role: 'purchase', telegramThreadId: '101', topicName: 'Purchases' },
    { role: 'feedback', telegramThreadId: '102', topicName: 'Anonymous feedback' },
    { role: 'reminders', telegramThreadId: '103', topicName: 'Reminders' },
    { role: 'payments', telegramThreadId: '104', topicName: 'Payments' }
  ],
  categories: [
    {
      id: 'cat-electricity',
      householdId: 'demo-household',
      slug: 'electricity',
      name: 'Electricity',
      sortOrder: 0,
      isActive: true,
      providerName: 'Telasi',
      customerNumber: '00012345',
      paymentLink: null,
      note: null
    },
    {
      id: 'cat-internet',
      householdId: 'demo-household',
      slug: 'internet',
      name: 'Internet',
      sortOrder: 1,
      isActive: true,
      providerName: 'Magti',
      customerNumber: 'KOJORI-88',
      paymentLink: null,
      note: null
    },
    {
      id: 'cat-water',
      householdId: 'demo-household',
      slug: 'water',
      name: 'Water',
      sortOrder: 2,
      isActive: true,
      providerName: 'GWP',
      customerNumber: '998877',
      paymentLink: null,
      note: null
    },
    {
      id: 'cat-gas',
      householdId: 'demo-household',
      slug: 'gas',
      name: 'Gas',
      sortOrder: 3,
      isActive: false,
      providerName: 'Tbilisi Energy',
      customerNumber: '445566',
      paymentLink: null,
      note: null
    }
  ],
  members: [
    { id: 'demo-member', displayName: 'Stas', status: 'active', rentShareWeight: 1, isAdmin: true },
    {
      id: 'member-chorb',
      displayName: 'Chorbanaut',
      status: 'active',
      rentShareWeight: 1,
      isAdmin: false
    },
    { id: 'member-el', displayName: 'El', status: 'away', rentShareWeight: 2, isAdmin: false }
  ],
  memberAbsencePolicies: [
    {
      memberId: 'member-el',
      startsOn: '2026-03-01',
      endsOn: '2026-03-31',
      policy: 'away_rent_only'
    }
  ]
}

const cycleState: MiniAppAdminCycleState = {
  cycle: {
    id: 'cycle-demo-2026-03',
    period: '2026-03',
    currency: 'GEL'
  },
  rentRule: {
    amountMinor: '241500',
    currency: 'USD'
  },
  utilityBills: [
    {
      id: 'utility-bill-1',
      billName: 'Electricity',
      amountMinor: '16400',
      currency: 'GEL',
      createdByMemberId: 'demo-member',
      createdAt: '2026-03-02T09:15:00.000Z'
    },
    {
      id: 'utility-bill-2',
      billName: 'Internet',
      amountMinor: '8000',
      currency: 'GEL',
      createdByMemberId: 'demo-member',
      createdAt: '2026-03-03T10:30:00.000Z'
    },
    {
      id: 'utility-bill-3',
      billName: 'Water',
      amountMinor: '4200',
      currency: 'GEL',
      createdByMemberId: 'member-chorb',
      createdAt: '2026-03-03T12:45:00.000Z'
    }
  ]
}

function baseLedger(): MiniAppDashboard['ledger'] {
  return [
    {
      id: 'purchase-resolved-1',
      kind: 'purchase',
      title: 'Bulk cleaning supplies',
      memberId: 'demo-member',
      paymentKind: null,
      amountMajor: '72.00',
      currency: 'GEL',
      displayAmountMajor: '72.00',
      displayCurrency: 'GEL',
      fxRateMicros: null,
      fxEffectiveDate: null,
      actorDisplayName: 'Stas',
      occurredAt: '2026-01-28T18:30:00.000Z',
      originPeriod: '2026-01',
      resolutionStatus: 'resolved',
      resolvedAt: '2026-02-04T09:10:00.000Z',
      outstandingByMember: [],
      payerMemberId: 'demo-member',
      purchaseSplitMode: 'equal',
      purchaseParticipants: [
        { memberId: 'demo-member', included: true, shareAmountMajor: null },
        { memberId: 'member-chorb', included: true, shareAmountMajor: null },
        { memberId: 'member-el', included: true, shareAmountMajor: null }
      ]
    },
    {
      id: 'purchase-unresolved-1',
      kind: 'purchase',
      title: 'Gas heater refill',
      memberId: 'member-chorb',
      paymentKind: null,
      amountMajor: '54.00',
      currency: 'GEL',
      displayAmountMajor: '54.00',
      displayCurrency: 'GEL',
      fxRateMicros: null,
      fxEffectiveDate: null,
      actorDisplayName: 'Chorbanaut',
      occurredAt: '2026-02-17T20:15:00.000Z',
      originPeriod: '2026-02',
      resolutionStatus: 'unresolved',
      resolvedAt: null,
      outstandingByMember: [
        { memberId: 'demo-member', amountMajor: '18.00' },
        { memberId: 'member-el', amountMajor: '18.00' }
      ],
      payerMemberId: 'member-chorb',
      purchaseSplitMode: 'equal',
      purchaseParticipants: [
        { memberId: 'demo-member', included: true, shareAmountMajor: null },
        { memberId: 'member-chorb', included: true, shareAmountMajor: null },
        { memberId: 'member-el', included: true, shareAmountMajor: null }
      ]
    },
    {
      id: 'purchase-unresolved-2',
      kind: 'purchase',
      title: 'Water filter cartridges',
      memberId: 'demo-member',
      paymentKind: null,
      amountMajor: '96.00',
      currency: 'GEL',
      displayAmountMajor: '96.00',
      displayCurrency: 'GEL',
      fxRateMicros: null,
      fxEffectiveDate: null,
      actorDisplayName: 'Stas',
      occurredAt: '2026-03-03T19:00:00.000Z',
      originPeriod: '2026-03',
      resolutionStatus: 'unresolved',
      resolvedAt: null,
      outstandingByMember: [
        { memberId: 'member-chorb', amountMajor: '24.00' },
        { memberId: 'member-el', amountMajor: '34.00' }
      ],
      payerMemberId: 'demo-member',
      purchaseSplitMode: 'custom_amounts',
      purchaseParticipants: [
        { memberId: 'demo-member', included: true, shareAmountMajor: '38.00' },
        { memberId: 'member-chorb', included: true, shareAmountMajor: '24.00' },
        { memberId: 'member-el', included: true, shareAmountMajor: '34.00' }
      ]
    },
    {
      id: 'utility-1',
      kind: 'utility',
      title: 'Electricity',
      memberId: null,
      paymentKind: null,
      amountMajor: '164.00',
      currency: 'GEL',
      displayAmountMajor: '164.00',
      displayCurrency: 'GEL',
      fxRateMicros: null,
      fxEffectiveDate: null,
      actorDisplayName: 'Stas',
      occurredAt: '2026-03-02T09:15:00.000Z'
    },
    {
      id: 'utility-2',
      kind: 'utility',
      title: 'Internet',
      memberId: null,
      paymentKind: null,
      amountMajor: '80.00',
      currency: 'GEL',
      displayAmountMajor: '80.00',
      displayCurrency: 'GEL',
      fxRateMicros: null,
      fxEffectiveDate: null,
      actorDisplayName: 'Stas',
      occurredAt: '2026-03-03T10:30:00.000Z'
    },
    {
      id: 'utility-3',
      kind: 'utility',
      title: 'Water',
      memberId: null,
      paymentKind: null,
      amountMajor: '42.00',
      currency: 'GEL',
      displayAmountMajor: '42.00',
      displayCurrency: 'GEL',
      fxRateMicros: null,
      fxEffectiveDate: null,
      actorDisplayName: 'Chorbanaut',
      occurredAt: '2026-03-03T12:45:00.000Z'
    },
    {
      id: 'payment-rent-demo',
      kind: 'payment',
      title: 'rent',
      memberId: 'demo-member',
      paymentKind: 'rent',
      amountMajor: '603.75',
      currency: 'GEL',
      displayAmountMajor: '603.75',
      displayCurrency: 'GEL',
      fxRateMicros: null,
      fxEffectiveDate: null,
      actorDisplayName: 'Stas',
      occurredAt: '2026-03-18T18:10:00.000Z'
    },
    {
      id: 'payment-utilities-demo',
      kind: 'payment',
      title: 'utilities',
      memberId: 'demo-member',
      paymentKind: 'utilities',
      amountMajor: '58.00',
      currency: 'GEL',
      displayAmountMajor: '58.00',
      displayCurrency: 'GEL',
      fxRateMicros: null,
      fxEffectiveDate: null,
      actorDisplayName: 'Stas',
      occurredAt: '2026-03-04T20:00:00.000Z'
    },
    {
      id: 'payment-rent-el',
      kind: 'payment',
      title: 'rent',
      memberId: 'member-el',
      paymentKind: 'rent',
      amountMajor: '377.00',
      currency: 'GEL',
      displayAmountMajor: '377.00',
      displayCurrency: 'GEL',
      fxRateMicros: null,
      fxEffectiveDate: null,
      actorDisplayName: 'El',
      occurredAt: '2026-03-21T08:20:00.000Z'
    }
  ]
}

function parsePeriod(period: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(period)
  if (!match) return null

  const year = Number.parseInt(match[1] ?? '', 10)
  const month = Number.parseInt(match[2] ?? '', 10)
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null
  }

  return { year, month }
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function remapDateIntoPeriod(value: string, period: string): string {
  const parsed = parsePeriod(period)
  if (!parsed) return value

  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (dateMatch) {
    const day = Math.min(
      Number.parseInt(dateMatch[3] ?? '1', 10),
      daysInMonth(parsed.year, parsed.month)
    )
    return `${period}-${String(day).padStart(2, '0')}`
  }

  const dateTimeMatch = /^(\d{4})-(\d{2})-(\d{2})(T.*)$/.exec(value)
  if (dateTimeMatch) {
    const day = Math.min(
      Number.parseInt(dateTimeMatch[3] ?? '1', 10),
      daysInMonth(parsed.year, parsed.month)
    )
    return `${period}-${String(day).padStart(2, '0')}${dateTimeMatch[4]}`
  }

  return value
}

function dayInPeriod(period: string, day: number): string {
  return `${period}-${String(day).padStart(2, '0')}`
}

function buildDemoUtilityPlan(state: {
  members: MiniAppDashboard['members']
  ledger: MiniAppDashboard['ledger']
}): NonNullable<MiniAppDashboard['utilityBillingPlan']> | null {
  const utilityEntries = state.ledger.filter((entry) => entry.kind === 'utility')
  if (utilityEntries.length === 0) {
    return null
  }

  const vendorPaidByMemberId = new Map<string, bigint>()
  for (const entry of state.ledger) {
    if (entry.kind !== 'payment' || entry.paymentKind !== 'utilities' || !entry.memberId) continue
    vendorPaidByMemberId.set(
      entry.memberId,
      (vendorPaidByMemberId.get(entry.memberId) ?? 0n) +
        BigInt(Math.round(Number(entry.amountMajor) * 100))
    )
  }

  const participants = state.members.filter((member) => Number(member.utilityShareMajor) > 0)
  const remainingTargetByMemberId = new Map<string, bigint>(
    participants.map((member) => {
      const fairShareMinor = BigInt(Math.round(Number(member.utilityShareMajor) * 100))
      const vendorPaidMinor = vendorPaidByMemberId.get(member.memberId) ?? 0n
      const remainingMinor = fairShareMinor - vendorPaidMinor
      return [member.memberId, remainingMinor > 0n ? remainingMinor : 0n] as const
    })
  )

  const categories: Array<
    NonNullable<MiniAppDashboard['utilityBillingPlan']>['categories'][number]
  > = []

  for (const entry of utilityEntries) {
    let remainingBillMinor = BigInt(Math.round(Number(entry.displayAmountMajor) * 100))
    const assignments: Array<{ memberId: string; amountMinor: bigint }> = []

    const orderedParticipants = [...participants].sort((left, right) => {
      const leftRemaining = remainingTargetByMemberId.get(left.memberId) ?? 0n
      const rightRemaining = remainingTargetByMemberId.get(right.memberId) ?? 0n
      if (rightRemaining === leftRemaining) {
        return left.displayName.localeCompare(right.displayName)
      }
      return rightRemaining > leftRemaining ? 1 : -1
    })

    for (const member of orderedParticipants) {
      if (remainingBillMinor <= 0n) break
      const remainingTargetMinor = remainingTargetByMemberId.get(member.memberId) ?? 0n
      if (remainingTargetMinor <= 0n) continue

      const assignedMinor =
        remainingTargetMinor >= remainingBillMinor ? remainingBillMinor : remainingTargetMinor
      if (assignedMinor <= 0n) continue

      assignments.push({ memberId: member.memberId, amountMinor: assignedMinor })
      remainingTargetByMemberId.set(member.memberId, remainingTargetMinor - assignedMinor)
      remainingBillMinor -= assignedMinor
    }

    for (const assignment of assignments) {
      const displayName =
        state.members.find((member) => member.memberId === assignment.memberId)?.displayName ??
        assignment.memberId
      const billMinor = BigInt(Math.round(Number(entry.displayAmountMajor) * 100))
      categories.push({
        utilityBillId: entry.id,
        billName: entry.title,
        billTotalMajor: entry.displayAmountMajor,
        assignedAmountMajor: (Number(assignment.amountMinor) / 100).toFixed(2),
        assignedMemberId: assignment.memberId,
        assignedDisplayName: displayName,
        paidAmountMajor: '0.00',
        isFullAssignment: assignments.length === 1 && assignment.amountMinor === billMinor,
        splitGroupId: assignments.length > 1 ? entry.id : null
      })
    }
  }

  return {
    version: 1,
    status: 'active',
    dueDate: '2026-03-04',
    updatedFromVersion: null,
    reason: null,
    categories,
    memberSummaries: state.members.map((member) => {
      const fairShareMinor = BigInt(Math.round(Number(member.utilityShareMajor) * 100))
      const vendorPaidMinor = vendorPaidByMemberId.get(member.memberId) ?? 0n
      const assignedMinor = categories
        .filter((category) => category.assignedMemberId === member.memberId)
        .reduce(
          (sum, category) => sum + BigInt(Math.round(Number(category.assignedAmountMajor) * 100)),
          0n
        )

      return {
        memberId: member.memberId,
        displayName: member.displayName,
        fairShareMajor: (Number(fairShareMinor) / 100).toFixed(2),
        vendorPaidMajor: (Number(vendorPaidMinor) / 100).toFixed(2),
        assignedThisCycleMajor: (Number(assignedMinor) / 100).toFixed(2),
        projectedDeltaAfterPlanMajor: (
          Number(vendorPaidMinor + assignedMinor - fairShareMinor) / 100
        ).toFixed(2)
      }
    })
  }
}

function createDashboard(state: {
  totalDueMajor: string
  totalPaidMajor: string
  totalRemainingMajor: string
  members: MiniAppDashboard['members']
  ledger?: MiniAppDashboard['ledger']
}): MiniAppDashboard {
  const ledger = state.ledger ?? baseLedger()
  const paymentPeriods: MiniAppDashboard['paymentPeriods'] = [
    {
      period: '2026-03',
      utilityTotalMajor: '286.00',
      hasOverdueBalance: state.members.some((member) => member.overduePayments.length > 0),
      isCurrentPeriod: true,
      kinds: [
        {
          kind: 'rent',
          totalDueMajor: state.members
            .reduce((sum, member) => sum + Number(member.rentShareMajor), 0)
            .toFixed(2),
          totalPaidMajor: '0.00',
          totalRemainingMajor: state.members
            .reduce((sum, member) => sum + Number(member.rentShareMajor), 0)
            .toFixed(2),
          unresolvedMembers: state.members
            .filter((member) => Number(member.rentShareMajor) > 0)
            .map((member) => ({
              memberId: member.memberId,
              displayName: member.displayName,
              suggestedAmountMajor: member.rentShareMajor,
              baseDueMajor: member.rentShareMajor,
              paidMajor: '0.00',
              remainingMajor: member.rentShareMajor,
              effectivelySettled: false
            }))
        },
        {
          kind: 'utilities',
          totalDueMajor: state.members
            .reduce((sum, member) => sum + Number(member.utilityShareMajor), 0)
            .toFixed(2),
          totalPaidMajor: '0.00',
          totalRemainingMajor: state.members
            .reduce((sum, member) => sum + Number(member.utilityShareMajor), 0)
            .toFixed(2),
          unresolvedMembers: state.members
            .filter((member) => Number(member.utilityShareMajor) > 0)
            .map((member) => ({
              memberId: member.memberId,
              displayName: member.displayName,
              suggestedAmountMajor: member.utilityShareMajor,
              baseDueMajor: member.utilityShareMajor,
              paidMajor: '0.00',
              remainingMajor: member.utilityShareMajor,
              effectivelySettled: false
            }))
        }
      ]
    }
  ]

  return {
    period: '2026-03',
    currency: 'GEL',
    timezone: 'Asia/Tbilisi',
    rentWarningDay: 17,
    rentDueDay: 20,
    utilitiesReminderDay: 3,
    utilitiesDueDay: 4,
    paymentBalanceAdjustmentPolicy: 'utilities',
    rentPaymentDestinations,
    totalDueMajor: state.totalDueMajor,
    totalPaidMajor: state.totalPaidMajor,
    totalRemainingMajor: state.totalRemainingMajor,
    billingStage: 'rent',
    rentSourceAmountMajor: '875.00',
    rentSourceCurrency: 'USD',
    rentDisplayAmountMajor: '2415.00',
    rentFxRateMicros: '2760000',
    rentFxEffectiveDate: '2026-03-17',
    utilityBillingPlan: null,
    rentBillingState: {
      dueDate: '2026-03-20',
      paymentDestinations: rentPaymentDestinations,
      memberSummaries: state.members.map((member) => ({
        memberId: member.memberId,
        displayName: member.displayName,
        dueMajor: member.rentShareMajor,
        paidMajor: '0.00',
        remainingMajor: member.rentShareMajor
      }))
    },
    members: state.members,
    paymentPeriods,
    ledger,
    notifications: [
      {
        id: 'notification-breakfast',
        summaryText: 'Stas, breakfast is waiting for your attention.',
        scheduledFor: '2026-03-25T05:00:00.000Z',
        status: 'scheduled',
        deliveryMode: 'topic',
        dmRecipientMemberIds: [],
        dmRecipientDisplayNames: [],
        creatorMemberId: 'demo-member',
        creatorDisplayName: 'Stas',
        assigneeMemberId: 'demo-member',
        assigneeDisplayName: 'Stas',
        canCancel: true,
        canEdit: true
      },
      {
        id: 'notification-call-georgiy',
        summaryText: 'Dima, time to check whether Georgiy has called back.',
        scheduledFor: '2026-03-25T16:00:00.000Z',
        status: 'scheduled',
        deliveryMode: 'dm_selected',
        dmRecipientMemberIds: ['member-chorb', 'demo-member'],
        dmRecipientDisplayNames: ['Dima', 'Stas'],
        creatorMemberId: 'member-chorb',
        creatorDisplayName: 'Chorbanaut',
        assigneeMemberId: null,
        assigneeDisplayName: null,
        canCancel: true,
        canEdit: true
      }
    ]
  }
}

const demoScenarioCatalog: Record<DemoScenarioId, DemoScenarioState> = {
  'current-cycle': {
    dashboard: createDashboard({
      totalDueMajor: '2571.00',
      totalPaidMajor: '1288.75',
      totalRemainingMajor: '1282.25',
      members: [
        {
          memberId: 'demo-member',
          displayName: 'Stas',
          predictedUtilityShareMajor: '95.33',
          rentShareMajor: '603.75',
          utilityShareMajor: '95.33',
          purchaseOffsetMajor: '-37.33',
          netDueMajor: '661.75',
          paidMajor: '661.75',
          remainingMajor: '0.00',
          overduePayments: [],
          explanations: [
            'Weighted rent share',
            'Utilities reflect three posted bills',
            'Purchase credit from January supplies and March water filters'
          ]
        },
        {
          memberId: 'member-chorb',
          displayName: 'Chorbanaut',
          predictedUtilityShareMajor: '95.33',
          rentShareMajor: '603.75',
          utilityShareMajor: '95.33',
          purchaseOffsetMajor: '44.67',
          netDueMajor: '743.75',
          paidMajor: '250.00',
          remainingMajor: '493.75',
          overduePayments: [],
          explanations: [
            'Standard resident share',
            'Still owes current-cycle utilities and purchases'
          ]
        },
        {
          memberId: 'member-el',
          displayName: 'El',
          predictedUtilityShareMajor: '0.00',
          rentShareMajor: '1207.50',
          utilityShareMajor: '0.00',
          purchaseOffsetMajor: '-42.00',
          netDueMajor: '1165.50',
          paidMajor: '377.00',
          remainingMajor: '788.50',
          overduePayments: [],
          explanations: ['Away policy applied to utilities', 'Purchase credit offsets part of rent']
        }
      ]
    }),
    pendingMembers,
    adminSettings,
    cycleState
  },
  'overdue-utilities': {
    dashboard: createDashboard({
      totalDueMajor: '2623.00',
      totalPaidMajor: '783.75',
      totalRemainingMajor: '1839.25',
      members: [
        {
          memberId: 'demo-member',
          displayName: 'Stas',
          predictedUtilityShareMajor: '104.00',
          rentShareMajor: '603.75',
          utilityShareMajor: '104.00',
          purchaseOffsetMajor: '18.00',
          netDueMajor: '725.75',
          paidMajor: '603.75',
          remainingMajor: '122.00',
          overduePayments: [
            {
              kind: 'utilities',
              amountMajor: '182.00',
              periods: ['2026-01', '2026-02']
            }
          ],
          explanations: [
            'Current rent is paid',
            'Utilities remain overdue from two prior periods',
            'Purchase carry-over stays separate from overdue closure'
          ]
        },
        {
          memberId: 'member-chorb',
          displayName: 'Chorbanaut',
          predictedUtilityShareMajor: '104.00',
          rentShareMajor: '603.75',
          utilityShareMajor: '104.00',
          purchaseOffsetMajor: '12.00',
          netDueMajor: '719.75',
          paidMajor: '180.00',
          remainingMajor: '539.75',
          overduePayments: [
            {
              kind: 'utilities',
              amountMajor: '91.00',
              periods: ['2026-02']
            }
          ],
          explanations: ['Partial utilities payment recorded this month']
        },
        {
          memberId: 'member-el',
          displayName: 'El',
          predictedUtilityShareMajor: '0.00',
          rentShareMajor: '1207.50',
          utilityShareMajor: '0.00',
          purchaseOffsetMajor: '-30.00',
          netDueMajor: '1177.50',
          paidMajor: '0.00',
          remainingMajor: '1177.50',
          overduePayments: [],
          explanations: [
            'Away policy applied to utilities',
            'No overdue utility base because away policy removed the share'
          ]
        }
      ],
      ledger: [
        ...baseLedger(),
        {
          id: 'payment-overdue-utilities-jan',
          kind: 'payment',
          title: 'utilities',
          memberId: 'member-chorb',
          paymentKind: 'utilities',
          amountMajor: '52.00',
          currency: 'GEL',
          displayAmountMajor: '52.00',
          displayCurrency: 'GEL',
          fxRateMicros: null,
          fxEffectiveDate: null,
          actorDisplayName: 'Chorbanaut',
          occurredAt: '2026-02-07T21:10:00.000Z'
        }
      ]
    }),
    pendingMembers,
    adminSettings,
    cycleState
  },
  'overdue-rent-and-utilities': {
    dashboard: createDashboard({
      totalDueMajor: '2629.00',
      totalPaidMajor: '200.00',
      totalRemainingMajor: '2429.00',
      members: [
        {
          memberId: 'demo-member',
          displayName: 'Stas',
          predictedUtilityShareMajor: '88.00',
          rentShareMajor: '603.75',
          utilityShareMajor: '88.00',
          purchaseOffsetMajor: '14.00',
          netDueMajor: '705.75',
          paidMajor: '0.00',
          remainingMajor: '705.75',
          overduePayments: [
            {
              kind: 'rent',
              amountMajor: '603.75',
              periods: ['2026-02']
            },
            {
              kind: 'utilities',
              amountMajor: '166.00',
              periods: ['2026-01', '2026-02']
            }
          ],
          explanations: [
            'Both rent and utilities are overdue',
            'Current-cycle purchases remain visible but do not keep overdue open'
          ]
        },
        {
          memberId: 'member-chorb',
          displayName: 'Chorbanaut',
          predictedUtilityShareMajor: '88.00',
          rentShareMajor: '603.75',
          utilityShareMajor: '88.00',
          purchaseOffsetMajor: '36.00',
          netDueMajor: '727.75',
          paidMajor: '0.00',
          remainingMajor: '727.75',
          overduePayments: [
            {
              kind: 'rent',
              amountMajor: '603.75',
              periods: ['2026-02']
            },
            {
              kind: 'utilities',
              amountMajor: '88.00',
              periods: ['2026-02']
            }
          ],
          explanations: ['No backfilled payments have been entered yet']
        },
        {
          memberId: 'member-el',
          displayName: 'El',
          predictedUtilityShareMajor: '0.00',
          rentShareMajor: '1207.50',
          utilityShareMajor: '0.00',
          purchaseOffsetMajor: '-12.00',
          netDueMajor: '1195.50',
          paidMajor: '200.00',
          remainingMajor: '995.50',
          overduePayments: [
            {
              kind: 'rent',
              amountMajor: '1207.50',
              periods: ['2026-02']
            }
          ],
          explanations: [
            'Away policy still charges rent',
            'One partial rent payment was entered late'
          ]
        }
      ],
      ledger: [
        ...baseLedger(),
        {
          id: 'payment-overdue-rent-el',
          kind: 'payment',
          title: 'rent',
          memberId: 'member-el',
          paymentKind: 'rent',
          amountMajor: '200.00',
          currency: 'GEL',
          displayAmountMajor: '200.00',
          displayCurrency: 'GEL',
          fxRateMicros: null,
          fxEffectiveDate: null,
          actorDisplayName: 'El',
          occurredAt: '2026-02-23T14:40:00.000Z'
        }
      ]
    }),
    pendingMembers,
    adminSettings,
    cycleState
  }
}

function applyOverridesToDemoState(
  state: DemoScenarioState,
  overrides: DemoStateOverrides = {}
): DemoScenarioState {
  const next = structuredClone(state)
  const periodOverride = overrides.periodOverride?.trim() || null
  if (!periodOverride) {
    next.dashboard.utilityBillingPlan = buildDemoUtilityPlan({
      members: next.dashboard.members,
      ledger: next.dashboard.ledger
    })
    return next
  }

  next.dashboard.period = periodOverride
  next.dashboard.rentBillingState.dueDate = dayInPeriod(periodOverride, next.dashboard.rentDueDay)
  if (next.dashboard.utilityBillingPlan) {
    next.dashboard.utilityBillingPlan.dueDate = dayInPeriod(
      periodOverride,
      next.dashboard.utilitiesDueDay
    )
  }
  next.dashboard.paymentPeriods = (next.dashboard.paymentPeriods ?? []).map((entry) => ({
    ...entry,
    period: periodOverride,
    isCurrentPeriod: true
  }))
  next.dashboard.ledger = next.dashboard.ledger.map((entry) => ({
    ...entry,
    occurredAt: entry.occurredAt ? remapDateIntoPeriod(entry.occurredAt, periodOverride) : null,
    ...(entry.originPeriod ? { originPeriod: periodOverride } : {})
  }))
  next.dashboard.notifications = next.dashboard.notifications.map((notification) => ({
    ...notification,
    scheduledFor: remapDateIntoPeriod(notification.scheduledFor, periodOverride)
  }))

  if (next.cycleState.cycle) {
    next.cycleState.cycle = {
      ...next.cycleState.cycle,
      period: periodOverride
    }
  }
  next.cycleState.utilityBills = next.cycleState.utilityBills.map((bill) => ({
    ...bill,
    createdAt: remapDateIntoPeriod(bill.createdAt, periodOverride)
  }))
  next.adminSettings.memberAbsencePolicies = next.adminSettings.memberAbsencePolicies.map(
    (policy) => ({
      ...policy,
      startsOn: remapDateIntoPeriod(policy.startsOn, periodOverride),
      endsOn: policy.endsOn ? remapDateIntoPeriod(policy.endsOn, periodOverride) : null
    })
  )
  next.dashboard.utilityBillingPlan = buildDemoUtilityPlan({
    members: next.dashboard.members,
    ledger: next.dashboard.ledger
  })

  return next
}

export function getDemoScenarioState(
  id: DemoScenarioId,
  overrides: DemoStateOverrides = {}
): DemoScenarioState {
  return applyOverridesToDemoState(demoScenarioCatalog[id], overrides)
}

export function getDemoScenarioDefaultToday(
  _id: DemoScenarioId,
  periodOverride?: string | null
): string {
  if (periodOverride?.trim()) {
    const today = new Date()
    const parsed = parsePeriod(periodOverride.trim())
    if (parsed) {
      const day = Math.min(today.getDate(), daysInMonth(parsed.year, parsed.month))
      return dayInPeriod(periodOverride.trim(), day)
    }
  }

  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
}

const defaultScenarioState = getDemoScenarioState('current-cycle')

export const demoDashboard = defaultScenarioState.dashboard
export const demoPendingMembers = defaultScenarioState.pendingMembers
export const demoAdminSettings = defaultScenarioState.adminSettings
export const demoCycleState = defaultScenarioState.cycleState
