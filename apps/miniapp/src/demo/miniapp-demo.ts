import type {
  MiniAppAdminCycleState,
  MiniAppAdminSettingsPayload,
  MiniAppDashboard,
  MiniAppPendingMember,
  MiniAppSession
} from '../miniapp-api'

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

export const demoDashboard: MiniAppDashboard = {
  period: '2026-03',
  currency: 'GEL',
  paymentBalanceAdjustmentPolicy: 'utilities',
  totalDueMajor: '2410.00',
  totalPaidMajor: '650.00',
  totalRemainingMajor: '1760.00',
  rentSourceAmountMajor: '875.00',
  rentSourceCurrency: 'USD',
  rentDisplayAmountMajor: '2415.00',
  rentFxRateMicros: '2760000',
  rentFxEffectiveDate: '2026-03-17',
  members: [
    {
      memberId: 'demo-member',
      displayName: 'Stas',
      rentShareMajor: '603.75',
      utilityShareMajor: '78.00',
      purchaseOffsetMajor: '-66.00',
      netDueMajor: '615.75',
      paidMajor: '615.75',
      remainingMajor: '0.00',
      explanations: ['Weighted rent share', 'Custom purchase split credit']
    },
    {
      memberId: 'member-chorb',
      displayName: 'Chorbanaut',
      rentShareMajor: '603.75',
      utilityShareMajor: '78.00',
      purchaseOffsetMajor: '12.00',
      netDueMajor: '693.75',
      paidMajor: '0.00',
      remainingMajor: '693.75',
      explanations: ['Standard resident share']
    },
    {
      memberId: 'member-el',
      displayName: 'El',
      rentShareMajor: '1207.50',
      utilityShareMajor: '0.00',
      purchaseOffsetMajor: '54.00',
      netDueMajor: '1261.50',
      paidMajor: '34.25',
      remainingMajor: '1227.25',
      explanations: ['Away policy applied to utilities']
    }
  ],
  ledger: [
    {
      id: 'purchase-1',
      kind: 'purchase',
      title: 'Bought kitchen towels',
      memberId: 'demo-member',
      paymentKind: null,
      amountMajor: '24.00',
      currency: 'GEL',
      displayAmountMajor: '24.00',
      displayCurrency: 'GEL',
      fxRateMicros: null,
      fxEffectiveDate: null,
      actorDisplayName: 'Stas',
      occurredAt: '2026-03-04T11:00:00.000Z',
      purchaseSplitMode: 'equal',
      purchaseParticipants: [
        { memberId: 'demo-member', included: true, shareAmountMajor: null },
        { memberId: 'member-chorb', included: true, shareAmountMajor: null },
        { memberId: 'member-el', included: false, shareAmountMajor: null }
      ]
    },
    {
      id: 'purchase-2',
      kind: 'purchase',
      title: 'Electric kettle',
      memberId: 'member-chorb',
      paymentKind: null,
      amountMajor: '96.00',
      currency: 'GEL',
      displayAmountMajor: '96.00',
      displayCurrency: 'GEL',
      fxRateMicros: null,
      fxEffectiveDate: null,
      actorDisplayName: 'Chorbanaut',
      occurredAt: '2026-03-08T16:20:00.000Z',
      purchaseSplitMode: 'custom_amounts',
      purchaseParticipants: [
        { memberId: 'demo-member', included: true, shareAmountMajor: '42.00' },
        { memberId: 'member-chorb', included: true, shareAmountMajor: '24.00' },
        { memberId: 'member-el', included: true, shareAmountMajor: '30.00' }
      ]
    },
    {
      id: 'utility-1',
      kind: 'utility',
      title: 'Electricity',
      memberId: null,
      paymentKind: null,
      amountMajor: '154.00',
      currency: 'GEL',
      displayAmountMajor: '154.00',
      displayCurrency: 'GEL',
      fxRateMicros: null,
      fxEffectiveDate: null,
      actorDisplayName: 'Stas',
      occurredAt: '2026-03-09T12:00:00.000Z'
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
      occurredAt: '2026-03-10T10:30:00.000Z'
    },
    {
      id: 'payment-1',
      kind: 'payment',
      title: 'rent',
      memberId: 'demo-member',
      paymentKind: 'rent',
      amountMajor: '615.75',
      currency: 'GEL',
      displayAmountMajor: '615.75',
      displayCurrency: 'GEL',
      fxRateMicros: null,
      fxEffectiveDate: null,
      actorDisplayName: 'Stas',
      occurredAt: '2026-03-11T18:10:00.000Z'
    },
    {
      id: 'payment-2',
      kind: 'payment',
      title: 'utilities',
      memberId: 'member-el',
      paymentKind: 'utilities',
      amountMajor: '34.25',
      currency: 'GEL',
      displayAmountMajor: '34.25',
      displayCurrency: 'GEL',
      fxRateMicros: null,
      fxEffectiveDate: null,
      actorDisplayName: 'El',
      occurredAt: '2026-03-13T09:00:00.000Z'
    }
  ]
}

export const demoPendingMembers: readonly MiniAppPendingMember[] = [
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
  }
]

export const demoAdminSettings: MiniAppAdminSettingsPayload = {
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
    timezone: 'Asia/Tbilisi'
  },
  assistantConfig: {
    householdId: 'demo-household',
    assistantContext: 'The household is a house in Kojori with a backyard and pine forest nearby.',
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
      isActive: true
    },
    {
      id: 'cat-internet',
      householdId: 'demo-household',
      slug: 'internet',
      name: 'Internet',
      sortOrder: 1,
      isActive: true
    },
    {
      id: 'cat-gas',
      householdId: 'demo-household',
      slug: 'gas',
      name: 'Gas',
      sortOrder: 2,
      isActive: false
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
      effectiveFromPeriod: '2026-03',
      policy: 'away_rent_only'
    }
  ]
}

export const demoCycleState: MiniAppAdminCycleState = {
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
      amountMinor: '15400',
      currency: 'GEL',
      createdByMemberId: 'demo-member',
      createdAt: '2026-03-09T12:00:00.000Z'
    },
    {
      id: 'utility-bill-2',
      billName: 'Internet',
      amountMinor: '8000',
      currency: 'GEL',
      createdByMemberId: 'demo-member',
      createdAt: '2026-03-10T10:30:00.000Z'
    }
  ]
}
