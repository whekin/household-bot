import { runtimeBotApiUrl } from './runtime-config'

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

export type MiniAppMemberAbsencePolicy =
  | 'resident'
  | 'away_rent_and_utilities'
  | 'away_rent_only'
  | 'inactive'

export interface MiniAppMemberAbsencePolicyRecord {
  memberId: string
  effectiveFromPeriod: string
  policy: MiniAppMemberAbsencePolicy
}

export interface MiniAppMember {
  id: string
  displayName: string
  status: 'active' | 'away' | 'left'
  rentShareWeight: number
  isAdmin: boolean
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

export interface MiniAppUtilityCategory {
  id: string
  householdId: string
  slug: string
  name: string
  sortOrder: number
  isActive: boolean
}

export interface MiniAppTopicBinding {
  role: 'purchase' | 'feedback' | 'reminders' | 'payments'
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
  rentSourceAmountMajor: string
  rentSourceCurrency: 'USD' | 'GEL'
  rentDisplayAmountMajor: string
  rentFxRateMicros: string | null
  rentFxEffectiveDate: string | null
  utilityCategories?: readonly {
    slug: string
    name: string
  }[]
  members: {
    memberId: string
    displayName: string
    predictedUtilityShareMajor: string | null
    rentShareMajor: string
    utilityShareMajor: string
    purchaseOffsetMajor: string
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
  topics: readonly MiniAppTopicBinding[]
  categories: readonly MiniAppUtilityCategory[]
  members: readonly MiniAppMember[]
  memberAbsencePolicies: readonly MiniAppMemberAbsencePolicyRecord[]
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

function apiBaseUrl(): string {
  const runtimeConfigured = runtimeBotApiUrl()
  if (runtimeConfigured) {
    return runtimeConfigured.replace(/\/$/, '')
  }

  const configured = import.meta.env.VITE_BOT_API_URL?.trim()

  if (configured) {
    return configured.replace(/\/$/, '')
  }

  if (import.meta.env.DEV) {
    return 'http://localhost:3000'
  }

  return window.location.origin
}

export async function fetchMiniAppSession(
  initData: string,
  joinToken?: string
): Promise<MiniAppSession> {
  const response = await fetch(`${apiBaseUrl()}/api/miniapp/session`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      initData,
      ...(joinToken
        ? {
            joinToken
          }
        : {})
    })
  })

  const payload = (await response.json()) as {
    ok: boolean
    authorized?: boolean
    member?: MiniAppSession['member']
    telegramUser?: MiniAppSession['telegramUser']
    onboarding?: MiniAppSession['onboarding']
    error?: string
  }

  if (!response.ok) {
    throw new Error(payload.error ?? 'Failed to create mini app session')
  }

  return {
    authorized: payload.authorized === true,
    ...(payload.member ? { member: payload.member } : {}),
    ...(payload.telegramUser ? { telegramUser: payload.telegramUser } : {}),
    ...(payload.onboarding ? { onboarding: payload.onboarding } : {})
  }
}

export async function joinMiniAppHousehold(
  initData: string,
  joinToken: string
): Promise<MiniAppSession> {
  const response = await fetch(`${apiBaseUrl()}/api/miniapp/join`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      initData,
      joinToken
    })
  })

  const payload = (await response.json()) as {
    ok: boolean
    authorized?: boolean
    member?: MiniAppSession['member']
    telegramUser?: MiniAppSession['telegramUser']
    onboarding?: MiniAppSession['onboarding']
    error?: string
  }

  if (!response.ok) {
    throw new Error(payload.error ?? 'Failed to join household')
  }

  return {
    authorized: payload.authorized === true,
    ...(payload.member ? { member: payload.member } : {}),
    ...(payload.telegramUser ? { telegramUser: payload.telegramUser } : {}),
    ...(payload.onboarding ? { onboarding: payload.onboarding } : {})
  }
}

export async function fetchMiniAppDashboard(initData: string): Promise<MiniAppDashboard> {
  const response = await fetch(`${apiBaseUrl()}/api/miniapp/dashboard`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      initData
    })
  })

  const payload = (await response.json()) as {
    ok: boolean
    authorized?: boolean
    dashboard?: MiniAppDashboard
    error?: string
  }

  if (!response.ok || !payload.authorized || !payload.dashboard) {
    throw new Error(payload.error ?? 'Failed to load dashboard')
  }

  return payload.dashboard
}

export async function updateMiniAppNotification(
  initData: string,
  input: {
    notificationId: string
    scheduledLocal?: string
    timezone?: string
    deliveryMode?: 'topic' | 'dm_all' | 'dm_selected'
    dmRecipientMemberIds?: readonly string[]
  }
): Promise<void> {
  const response = await fetch(`${apiBaseUrl()}/api/miniapp/notifications/update`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      initData,
      ...input
    })
  })

  const payload = (await response.json()) as {
    ok: boolean
    authorized?: boolean
    error?: string
  }

  if (!response.ok || !payload.authorized) {
    throw new Error(payload.error ?? 'Failed to update notification')
  }
}

export async function cancelMiniAppNotification(
  initData: string,
  notificationId: string
): Promise<void> {
  const response = await fetch(`${apiBaseUrl()}/api/miniapp/notifications/cancel`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      initData,
      notificationId
    })
  })

  const payload = (await response.json()) as {
    ok: boolean
    authorized?: boolean
    error?: string
  }

  if (!response.ok || !payload.authorized) {
    throw new Error(payload.error ?? 'Failed to cancel notification')
  }
}

export async function fetchMiniAppPendingMembers(
  initData: string
): Promise<readonly MiniAppPendingMember[]> {
  const response = await fetch(`${apiBaseUrl()}/api/miniapp/admin/pending-members`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      initData
    })
  })

  const payload = (await response.json()) as {
    ok: boolean
    authorized?: boolean
    members?: MiniAppPendingMember[]
    error?: string
  }

  if (!response.ok || !payload.authorized || !payload.members) {
    throw new Error(payload.error ?? 'Failed to load pending members')
  }

  return payload.members
}

export async function approveMiniAppPendingMember(
  initData: string,
  pendingTelegramUserId: string
): Promise<void> {
  const response = await fetch(`${apiBaseUrl()}/api/miniapp/admin/approve-member`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      initData,
      pendingTelegramUserId
    })
  })

  const payload = (await response.json()) as {
    ok: boolean
    authorized?: boolean
    error?: string
  }

  if (!response.ok || !payload.authorized) {
    throw new Error(payload.error ?? 'Failed to approve member')
  }
}

export async function rejectMiniAppPendingMember(
  initData: string,
  pendingTelegramUserId: string
): Promise<void> {
  const response = await fetch(`${apiBaseUrl()}/api/miniapp/admin/reject-member`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      initData,
      pendingTelegramUserId
    })
  })

  const payload = (await response.json()) as {
    ok: boolean
    authorized?: boolean
    error?: string
  }

  if (!response.ok || !payload.authorized) {
    throw new Error(payload.error ?? 'Failed to reject member')
  }
}

export async function updateMiniAppLocalePreference(
  initData: string,
  locale: 'en' | 'ru',
  scope: 'member' | 'household'
): Promise<MiniAppLocalePreference> {
  const response = await fetch(`${apiBaseUrl()}/api/miniapp/preferences/locale`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      initData,
      locale,
      scope
    })
  })

  const payload = (await response.json()) as {
    ok: boolean
    authorized?: boolean
    locale?: MiniAppLocalePreference
    error?: string
  }

  if (!response.ok || !payload.authorized || !payload.locale) {
    throw new Error(payload.error ?? 'Failed to update locale preference')
  }

  return payload.locale
}

export async function fetchMiniAppAdminSettings(
  initData: string
): Promise<MiniAppAdminSettingsPayload> {
  const response = await fetch(`${apiBaseUrl()}/api/miniapp/admin/settings`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      initData
    })
  })

  const payload = (await response.json()) as {
    ok: boolean
    authorized?: boolean
    householdName?: string
    settings?: MiniAppBillingSettings
    assistantConfig?: MiniAppAssistantConfig
    topics?: MiniAppTopicBinding[]
    categories?: MiniAppUtilityCategory[]
    members?: MiniAppMember[]
    memberAbsencePolicies?: MiniAppMemberAbsencePolicyRecord[]
    error?: string
  }

  if (
    !response.ok ||
    !payload.authorized ||
    !payload.householdName ||
    !payload.settings ||
    !payload.assistantConfig ||
    !payload.topics ||
    !payload.categories ||
    !payload.members ||
    !payload.memberAbsencePolicies
  ) {
    throw new Error(payload.error ?? 'Failed to load admin settings')
  }

  return {
    householdName: payload.householdName,
    settings: payload.settings,
    assistantConfig: payload.assistantConfig,
    topics: payload.topics,
    categories: payload.categories,
    members: payload.members,
    memberAbsencePolicies: payload.memberAbsencePolicies
  }
}

export async function updateMiniAppBillingSettings(
  initData: string,
  input: {
    settlementCurrency?: 'USD' | 'GEL'
    paymentBalanceAdjustmentPolicy?: 'utilities' | 'rent' | 'separate'
    householdName?: string
    rentAmountMajor?: string
    rentCurrency: 'USD' | 'GEL'
    rentDueDay: number
    rentWarningDay: number
    utilitiesDueDay: number
    utilitiesReminderDay: number
    timezone: string
    rentPaymentDestinations?: readonly MiniAppRentPaymentDestination[] | null
    assistantContext?: string
    assistantTone?: string
  }
): Promise<{
  householdName: string
  settings: MiniAppBillingSettings
  assistantConfig: MiniAppAssistantConfig
}> {
  const response = await fetch(`${apiBaseUrl()}/api/miniapp/admin/settings/update`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      initData,
      ...input
    })
  })

  const payload = (await response.json()) as {
    ok: boolean
    authorized?: boolean
    householdName?: string
    settings?: MiniAppBillingSettings
    assistantConfig?: MiniAppAssistantConfig
    error?: string
  }

  if (
    !response.ok ||
    !payload.authorized ||
    !payload.householdName ||
    !payload.settings ||
    !payload.assistantConfig
  ) {
    throw new Error(payload.error ?? 'Failed to update billing settings')
  }

  return {
    householdName: payload.householdName,
    settings: payload.settings,
    assistantConfig: payload.assistantConfig
  }
}

export async function upsertMiniAppUtilityCategory(
  initData: string,
  input: {
    slug?: string
    name: string
    sortOrder: number
    isActive: boolean
  }
): Promise<MiniAppUtilityCategory> {
  const response = await fetch(`${apiBaseUrl()}/api/miniapp/admin/utility-categories/upsert`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      initData,
      ...input
    })
  })

  const payload = (await response.json()) as {
    ok: boolean
    authorized?: boolean
    category?: MiniAppUtilityCategory
    error?: string
  }

  if (!response.ok || !payload.authorized || !payload.category) {
    throw new Error(payload.error ?? 'Failed to save utility category')
  }

  return payload.category
}

export async function promoteMiniAppMember(
  initData: string,
  memberId: string
): Promise<MiniAppMember> {
  const response = await fetch(`${apiBaseUrl()}/api/miniapp/admin/members/promote`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      initData,
      memberId
    })
  })

  const payload = (await response.json()) as {
    ok: boolean
    authorized?: boolean
    member?: MiniAppMember
    error?: string
  }

  if (!response.ok || !payload.authorized || !payload.member) {
    throw new Error(payload.error ?? 'Failed to promote member')
  }

  return payload.member
}

export async function updateMiniAppOwnDisplayName(
  initData: string,
  displayName: string
): Promise<NonNullable<MiniAppSession['member']>> {
  const response = await fetch(`${apiBaseUrl()}/api/miniapp/member/display-name`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      initData,
      displayName
    })
  })

  const payload = (await response.json()) as {
    ok: boolean
    authorized?: boolean
    member?: MiniAppSession['member']
    error?: string
  }

  if (!response.ok || !payload.authorized || !payload.member) {
    throw new Error(payload.error ?? 'Failed to update display name')
  }

  return payload.member
}

export async function updateMiniAppMemberDisplayName(
  initData: string,
  memberId: string,
  displayName: string
): Promise<MiniAppMember> {
  const response = await fetch(`${apiBaseUrl()}/api/miniapp/admin/members/display-name`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      initData,
      memberId,
      displayName
    })
  })

  const payload = (await response.json()) as {
    ok: boolean
    authorized?: boolean
    member?: MiniAppMember
    error?: string
  }

  if (!response.ok || !payload.member) {
    throw new Error(payload.error ?? 'Failed to update member display name')
  }

  return payload.member
}

export async function updateMiniAppMemberRentWeight(
  initData: string,
  memberId: string,
  rentShareWeight: number
): Promise<MiniAppMember> {
  const response = await fetch(`${apiBaseUrl()}/api/miniapp/admin/members/rent-weight`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      initData,
      memberId,
      rentShareWeight
    })
  })

  const payload = (await response.json()) as {
    ok: boolean
    authorized?: boolean
    member?: MiniAppMember
    error?: string
  }

  if (!response.ok || !payload.member) {
    throw new Error(payload.error ?? 'Failed to update member rent weight')
  }

  return payload.member
}

export async function updateMiniAppMemberStatus(
  initData: string,
  memberId: string,
  status: 'active' | 'away' | 'left'
): Promise<MiniAppMember> {
  const response = await fetch(`${apiBaseUrl()}/api/miniapp/admin/members/status`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      initData,
      memberId,
      status
    })
  })

  const payload = (await response.json()) as {
    ok: boolean
    authorized?: boolean
    member?: MiniAppMember
    error?: string
  }

  if (!response.ok || !payload.member) {
    throw new Error(payload.error ?? 'Failed to update member status')
  }

  return payload.member
}

export async function demoteMiniAppMember(
  initData: string,
  memberId: string
): Promise<MiniAppMember> {
  const response = await fetch(`${apiBaseUrl()}/api/miniapp/admin/members/demote`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      initData,
      memberId
    })
  })

  const payload = (await response.json()) as {
    ok: boolean
    authorized?: boolean
    member?: MiniAppMember
    error?: string
  }

  if (!response.ok || !payload.member) {
    throw new Error(payload.error ?? 'Failed to remove admin access')
  }

  return payload.member
}

export async function updateMiniAppMemberAbsencePolicy(
  initData: string,
  memberId: string,
  policy: MiniAppMemberAbsencePolicy
): Promise<MiniAppMemberAbsencePolicyRecord> {
  const response = await fetch(`${apiBaseUrl()}/api/miniapp/admin/members/absence-policy`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      initData,
      memberId,
      policy
    })
  })

  const payload = (await response.json()) as {
    ok: boolean
    authorized?: boolean
    policy?: MiniAppMemberAbsencePolicyRecord
    error?: string
  }

  if (!response.ok || !payload.policy) {
    throw new Error(payload.error ?? 'Failed to update member absence policy')
  }

  return payload.policy
}

export async function fetchMiniAppBillingCycle(initData: string): Promise<MiniAppAdminCycleState> {
  const response = await fetch(`${apiBaseUrl()}/api/miniapp/admin/billing-cycle`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      initData
    })
  })

  const payload = (await response.json()) as {
    ok: boolean
    authorized?: boolean
    cycleState?: MiniAppAdminCycleState
    error?: string
  }

  if (!response.ok || !payload.authorized || !payload.cycleState) {
    throw new Error(payload.error ?? 'Failed to load billing cycle')
  }

  return payload.cycleState
}

export async function openMiniAppBillingCycle(
  initData: string,
  input: {
    period: string
    currency: 'USD' | 'GEL'
  }
): Promise<MiniAppAdminCycleState> {
  const response = await fetch(`${apiBaseUrl()}/api/miniapp/admin/billing-cycle/open`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      initData,
      ...input
    })
  })

  const payload = (await response.json()) as {
    ok: boolean
    authorized?: boolean
    cycleState?: MiniAppAdminCycleState
    error?: string
  }

  if (!response.ok || !payload.authorized || !payload.cycleState) {
    throw new Error(payload.error ?? 'Failed to open billing cycle')
  }

  return payload.cycleState
}

export async function closeMiniAppBillingCycle(
  initData: string,
  period?: string
): Promise<MiniAppAdminCycleState> {
  const response = await fetch(`${apiBaseUrl()}/api/miniapp/admin/billing-cycle/close`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      initData,
      ...(period
        ? {
            period
          }
        : {})
    })
  })

  const payload = (await response.json()) as {
    ok: boolean
    authorized?: boolean
    cycleState?: MiniAppAdminCycleState
    error?: string
  }

  if (!response.ok || !payload.authorized || !payload.cycleState) {
    throw new Error(payload.error ?? 'Failed to close billing cycle')
  }

  return payload.cycleState
}

export async function updateMiniAppCycleRent(
  initData: string,
  input: {
    amountMajor: string
    currency: 'USD' | 'GEL'
    period?: string
    fxRateMicros?: string
  }
): Promise<MiniAppAdminCycleState> {
  const response = await fetch(`${apiBaseUrl()}/api/miniapp/admin/rent/update`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      initData,
      ...input
    })
  })

  const payload = (await response.json()) as {
    ok: boolean
    authorized?: boolean
    cycleState?: MiniAppAdminCycleState
    error?: string
  }

  if (!response.ok || !payload.authorized || !payload.cycleState) {
    throw new Error(payload.error ?? 'Failed to update rent')
  }

  return payload.cycleState
}

export async function addMiniAppUtilityBill(
  initData: string,
  input: {
    billName: string
    amountMajor: string
    currency: 'USD' | 'GEL'
  }
): Promise<MiniAppAdminCycleState> {
  const response = await fetch(`${apiBaseUrl()}/api/miniapp/admin/utility-bills/add`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      initData,
      ...input
    })
  })

  const payload = (await response.json()) as {
    ok: boolean
    authorized?: boolean
    cycleState?: MiniAppAdminCycleState
    error?: string
  }

  if (!response.ok || !payload.authorized || !payload.cycleState) {
    throw new Error(payload.error ?? 'Failed to add utility bill')
  }

  return payload.cycleState
}

export async function submitMiniAppUtilityBill(
  initData: string,
  input: {
    billName: string
    amountMajor: string
    currency: 'USD' | 'GEL'
  }
): Promise<void> {
  const response = await fetch(`${apiBaseUrl()}/api/miniapp/utility-bills/add`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      initData,
      ...input
    })
  })

  const payload = (await response.json()) as {
    ok: boolean
    authorized?: boolean
    error?: string
  }

  if (!response.ok || !payload.authorized) {
    throw new Error(payload.error ?? 'Failed to submit utility bill')
  }
}

export async function updateMiniAppUtilityBill(
  initData: string,
  input: {
    billId: string
    billName: string
    amountMajor: string
    currency: 'USD' | 'GEL'
  }
): Promise<MiniAppAdminCycleState> {
  const response = await fetch(`${apiBaseUrl()}/api/miniapp/admin/utility-bills/update`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      initData,
      ...input
    })
  })

  const payload = (await response.json()) as {
    ok: boolean
    authorized?: boolean
    cycleState?: MiniAppAdminCycleState
    error?: string
  }

  if (!response.ok || !payload.authorized || !payload.cycleState) {
    throw new Error(payload.error ?? 'Failed to update utility bill')
  }

  return payload.cycleState
}

export async function deleteMiniAppUtilityBill(
  initData: string,
  billId: string
): Promise<MiniAppAdminCycleState> {
  const response = await fetch(`${apiBaseUrl()}/api/miniapp/admin/utility-bills/delete`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      initData,
      billId
    })
  })

  const payload = (await response.json()) as {
    ok: boolean
    authorized?: boolean
    cycleState?: MiniAppAdminCycleState
    error?: string
  }

  if (!response.ok || !payload.authorized || !payload.cycleState) {
    throw new Error(payload.error ?? 'Failed to delete utility bill')
  }

  return payload.cycleState
}

export async function addMiniAppPurchase(
  initData: string,
  input: {
    description: string
    amountMajor: string
    currency: 'USD' | 'GEL'
    payerMemberId?: string
    split?: {
      mode: 'equal' | 'custom_amounts'
      participants: readonly {
        memberId: string
        included?: boolean
        shareAmountMajor?: string
      }[]
    }
  }
): Promise<void> {
  const response = await fetch(`${apiBaseUrl()}/api/miniapp/admin/purchases/add`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      initData,
      ...input
    })
  })

  const payload = (await response.json()) as { ok: boolean; authorized?: boolean; error?: string }
  if (!response.ok || !payload.authorized) {
    throw new Error(payload.error ?? 'Failed to add purchase')
  }
}

export async function updateMiniAppPurchase(
  initData: string,
  input: {
    purchaseId: string
    description: string
    amountMajor: string
    currency: 'USD' | 'GEL'
    payerMemberId?: string
    split?: {
      mode: 'equal' | 'custom_amounts'
      participants: readonly {
        memberId: string
        included?: boolean
        shareAmountMajor?: string
      }[]
    }
  }
): Promise<void> {
  const response = await fetch(`${apiBaseUrl()}/api/miniapp/admin/purchases/update`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      initData,
      ...input
    })
  })

  const payload = (await response.json()) as { ok: boolean; authorized?: boolean; error?: string }
  if (!response.ok || !payload.authorized) {
    throw new Error(payload.error ?? 'Failed to update purchase')
  }
}

export async function deleteMiniAppPurchase(initData: string, purchaseId: string): Promise<void> {
  const response = await fetch(`${apiBaseUrl()}/api/miniapp/admin/purchases/delete`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      initData,
      purchaseId
    })
  })

  const payload = (await response.json()) as { ok: boolean; authorized?: boolean; error?: string }
  if (!response.ok || !payload.authorized) {
    throw new Error(payload.error ?? 'Failed to delete purchase')
  }
}

export async function addMiniAppPayment(
  initData: string,
  input: {
    memberId: string
    kind: 'rent' | 'utilities'
    amountMajor: string
    currency: 'USD' | 'GEL'
    period?: string
  }
): Promise<void> {
  const response = await fetch(`${apiBaseUrl()}/api/miniapp/admin/payments/add`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      initData,
      ...input
    })
  })

  const payload = (await response.json()) as { ok: boolean; authorized?: boolean; error?: string }
  if (!response.ok || !payload.authorized) {
    throw new Error(payload.error ?? 'Failed to add payment')
  }
}

export async function updateMiniAppPayment(
  initData: string,
  input: {
    paymentId: string
    memberId: string
    kind: 'rent' | 'utilities'
    amountMajor: string
    currency: 'USD' | 'GEL'
  }
): Promise<void> {
  const response = await fetch(`${apiBaseUrl()}/api/miniapp/admin/payments/update`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      initData,
      ...input
    })
  })

  const payload = (await response.json()) as { ok: boolean; authorized?: boolean; error?: string }
  if (!response.ok || !payload.authorized) {
    throw new Error(payload.error ?? 'Failed to update payment')
  }
}

export async function deleteMiniAppPayment(initData: string, paymentId: string): Promise<void> {
  const response = await fetch(`${apiBaseUrl()}/api/miniapp/admin/payments/delete`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      initData,
      paymentId
    })
  })

  const payload = (await response.json()) as { ok: boolean; authorized?: boolean; error?: string }
  if (!response.ok || !payload.authorized) {
    throw new Error(payload.error ?? 'Failed to delete payment')
  }
}
