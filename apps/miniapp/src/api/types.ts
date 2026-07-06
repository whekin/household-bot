export interface MiniAppSession {
  authorized: boolean
  member?: {
    id: string
    householdId: string
    householdName: string
    displayName: string
    status: 'active' | 'away' | 'left'
    isAdmin: boolean
    preferredLocale: 'en' | 'ru' | null
    householdDefaultLocale: 'en' | 'ru'
  }
  telegramUser?: {
    firstName: string | null
    username: string | null
    languageCode: string | null
  }
  onboarding?: {
    status: 'join_required' | 'pending' | 'open_from_group'
    householdName?: string
    householdDefaultLocale?: 'en' | 'ru'
  }
}

export interface MiniAppLocalePreference {
  scope: 'member' | 'household'
  effectiveLocale: 'en' | 'ru'
  memberPreferredLocale: 'en' | 'ru' | null
  householdDefaultLocale: 'en' | 'ru'
}

export interface MiniAppPendingMember {
  telegramUserId: string
  displayName: string
  username: string | null
  languageCode: string | null
}

export interface MiniAppMemberPresenceDaysRecord {
  householdId: string
  memberId: string
  period: string
  daysPresent: number
}

export interface MiniAppMember {
  id: string
  displayName: string
  status: 'active' | 'away' | 'left'
  rentShareWeight: number
  isAdmin: boolean
  daysPresent?: number
}

export interface MiniAppBillingSettings {
  householdId: string
  settlementCurrency: 'USD' | 'GEL'
  paymentBalanceAdjustmentPolicy: 'utilities' | 'rent' | 'separate'
  rentAmountMinor: string | null
  rentCurrency: 'USD' | 'GEL'
  rentDueDay: number
  rentWarningDay: number
  utilitiesDueDay: number
  utilitiesReminderDay: number
  preferredUtilityPayerMemberId: string | null
  timezone: string
  rentPaymentDestinations: readonly MiniAppRentPaymentDestination[] | null
}

export interface MiniAppRentPaymentDestination {
  label: string
  recipientName: string | null
  bankName: string | null
  account: string
  note: string | null
  link: string | null
}

export interface MiniAppAssistantConfig {
  householdId: string
  assistantContext: string | null
  assistantTone: string | null
}

export interface MiniAppNotificationSettings {
  householdId: string
  periodEvents: boolean
  planEvents: boolean
  purchaseEvents: boolean
  paymentEvents: boolean
}

export interface MiniAppUtilityCategory {
  id: string
  householdId: string
  slug: string
  name: string
  sortOrder: number
  isActive: boolean
  providerName: string | null
  customerNumber: string | null
  paymentLink: string | null
  note: string | null
}

export interface MiniAppTopicBinding {
  role: 'purchase' | 'feedback' | 'reminders' | 'payments' | 'notifications'
  telegramThreadId: string
  topicName: string | null
}

export interface MiniAppDashboard {
  period: string
  currency: 'USD' | 'GEL'
  timezone: string
  rentWarningDay: number
  rentDueDay: number
  utilitiesReminderDay: number
  utilitiesDueDay: number
  paymentBalanceAdjustmentPolicy: 'utilities' | 'rent' | 'separate'
  rentPaymentDestinations: readonly MiniAppRentPaymentDestination[] | null
  totalDueMajor: string
  totalPaidMajor: string
  totalRemainingMajor: string
  billingStage: 'utilities' | 'rent' | 'idle'
  rentSourceAmountMajor: string
  rentSourceCurrency: 'USD' | 'GEL'
  rentDisplayAmountMajor: string
  rentFxRateMicros: string | null
  rentFxEffectiveDate: string | null
  utilityBillingPlan?: {
    version: number
    status: 'active' | 'diverged' | 'superseded' | 'settled'
    dueDate: string
    updatedFromVersion: number | null
    reason: string | null
    categories: readonly {
      utilityBillId: string
      billName: string
      billTotalMajor: string
      assignedAmountMajor: string
      assignedMemberId: string
      assignedDisplayName: string
      paidAmountMajor: string
      isFullAssignment: boolean
      splitGroupId: string | null
    }[]
    memberSummaries: readonly {
      memberId: string
      displayName: string
      fairShareMajor: string
      vendorPaidMajor: string
      assignedThisCycleMajor: string
      projectedDeltaAfterPlanMajor: string
    }[]
  } | null
  rentBillingState: {
    dueDate: string
    paymentDestinations: readonly MiniAppRentPaymentDestination[] | null
    memberSummaries: readonly {
      memberId: string
      displayName: string
      dueMajor: string
      paidMajor: string
      remainingMajor: string
    }[]
  }
  utilityCategories?: readonly {
    slug: string
    name: string
    providerName: string | null
    customerNumber: string | null
    paymentLink: string | null
    note: string | null
  }[]
  members: {
    memberId: string
    displayName: string
    status?: 'active' | 'away' | 'left'
    daysPresent?: number
    predictedUtilityShareMajor: string | null
    rentShareMajor: string
    utilityShareMajor: string
    purchaseOffsetMajor: string
    carryForwardCreditMajor?: string
    effectivePurchaseBalanceMajor?: string
    netDueMajor: string
    paidMajor: string
    remainingMajor: string
    overduePayments: readonly {
      kind: 'rent' | 'utilities'
      amountMajor: string
      periods: readonly string[]
    }[]
    explanations: readonly string[]
  }[]
  paymentPeriods?: {
    period: string
    utilityTotalMajor: string
    hasOverdueBalance: boolean
    isCurrentPeriod: boolean
    kinds: {
      kind: 'rent' | 'utilities'
      totalDueMajor: string
      totalPaidMajor: string
      totalRemainingMajor: string
      unresolvedMembers: {
        memberId: string
        displayName: string
        suggestedAmountMajor: string
        baseDueMajor: string
        paidMajor: string
        remainingMajor: string
        effectivelySettled: boolean
      }[]
    }[]
  }[]
  ledger: {
    id: string
    kind: 'purchase' | 'utility' | 'payment'
    title: string
    memberId: string | null
    paymentKind: 'rent' | 'utilities' | null
    amountMajor: string
    currency: 'USD' | 'GEL'
    displayAmountMajor: string
    displayCurrency: 'USD' | 'GEL'
    fxRateMicros: string | null
    fxEffectiveDate: string | null
    actorDisplayName: string | null
    occurredAt: string | null
    purchaseSplitMode?: 'equal' | 'custom_amounts'
    originPeriod?: string | null
    isCurrentCyclePurchase?: boolean
    resolutionStatus?: 'unresolved' | 'resolved'
    resolvedAt?: string | null
    outstandingByMember?: readonly {
      memberId: string
      amountMajor: string
    }[]
    purchaseParticipants?: readonly {
      memberId: string
      included: boolean
      shareAmountMajor: string | null
    }[]
    payerMemberId?: string
  }[]
  notifications: {
    id: string
    summaryText: string
    scheduledFor: string
    status: 'scheduled' | 'sent' | 'cancelled'
    deliveryMode: 'topic' | 'dm_all' | 'dm_selected'
    dmRecipientMemberIds: readonly string[]
    dmRecipientDisplayNames: readonly string[]
    creatorMemberId: string
    creatorDisplayName: string
    assigneeMemberId: string | null
    assigneeDisplayName: string | null
    canCancel: boolean
    canEdit: boolean
  }[]
}

export interface MiniAppAdminSettingsPayload {
  householdName: string
  settings: MiniAppBillingSettings
  assistantConfig: MiniAppAssistantConfig
  notificationSettings: MiniAppNotificationSettings
  topics: readonly MiniAppTopicBinding[]
  categories: readonly MiniAppUtilityCategory[]
  members: readonly MiniAppMember[]
}

export interface MiniAppAdminCycleState {
  cycle: {
    id: string
    period: string
    currency: 'USD' | 'GEL'
  } | null
  rentRule: {
    amountMinor: string
    currency: 'USD' | 'GEL'
  } | null
  utilityBills: readonly {
    id: string
    billName: string
    amountMinor: string
    currency: 'USD' | 'GEL'
    createdByMemberId: string | null
    createdAt: string
  }[]
}
