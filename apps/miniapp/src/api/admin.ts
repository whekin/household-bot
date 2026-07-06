import { miniAppApiError, postMiniApp } from './client'
import type {
  MiniAppAdminSettingsPayload,
  MiniAppAssistantConfig,
  MiniAppBillingSettings,
  MiniAppMember,
  MiniAppMemberPresenceDaysRecord,
  MiniAppNotificationSettings,
  MiniAppPendingMember,
  MiniAppRentPaymentDestination,
  MiniAppTopicBinding,
  MiniAppUtilityCategory
} from './types'

export async function fetchMiniAppPendingMembers(
  initData: string
): Promise<readonly MiniAppPendingMember[]> {
  const { response, payload } = await postMiniApp<{
    ok: boolean
    authorized?: boolean
    members?: MiniAppPendingMember[]
    error?: string
  }>('/api/miniapp/admin/pending-members', {
    initData
  })

  if (!response.ok || !payload.authorized || !payload.members) {
    throw miniAppApiError(response, payload, 'Failed to load pending members')
  }

  return payload.members
}

export async function approveMiniAppPendingMember(
  initData: string,
  pendingTelegramUserId: string
): Promise<void> {
  const { response, payload } = await postMiniApp<{
    ok: boolean
    authorized?: boolean
    error?: string
  }>('/api/miniapp/admin/approve-member', {
    initData,
    pendingTelegramUserId
  })

  if (!response.ok || !payload.authorized) {
    throw miniAppApiError(response, payload, 'Failed to approve member')
  }
}

export async function rejectMiniAppPendingMember(
  initData: string,
  pendingTelegramUserId: string
): Promise<void> {
  const { response, payload } = await postMiniApp<{
    ok: boolean
    authorized?: boolean
    error?: string
  }>('/api/miniapp/admin/reject-member', {
    initData,
    pendingTelegramUserId
  })

  if (!response.ok || !payload.authorized) {
    throw miniAppApiError(response, payload, 'Failed to reject member')
  }
}

export async function fetchMiniAppAdminSettings(
  initData: string
): Promise<MiniAppAdminSettingsPayload> {
  const { response, payload } = await postMiniApp<{
    ok: boolean
    authorized?: boolean
    householdName?: string
    settings?: MiniAppBillingSettings
    assistantConfig?: MiniAppAssistantConfig
    notificationSettings?: MiniAppNotificationSettings
    topics?: MiniAppTopicBinding[]
    categories?: MiniAppUtilityCategory[]
    members?: MiniAppMember[]
    error?: string
  }>('/api/miniapp/admin/settings', {
    initData
  })

  if (
    !response.ok ||
    !payload.authorized ||
    !payload.householdName ||
    !payload.settings ||
    !payload.assistantConfig ||
    !payload.notificationSettings ||
    !payload.topics ||
    !payload.categories ||
    !payload.members
  ) {
    throw miniAppApiError(response, payload, 'Failed to load admin settings')
  }

  return {
    householdName: payload.householdName,
    settings: payload.settings,
    assistantConfig: payload.assistantConfig,
    notificationSettings: payload.notificationSettings,
    topics: payload.topics,
    categories: payload.categories,
    members: payload.members
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
    preferredUtilityPayerMemberId?: string | null
    timezone: string
    rentPaymentDestinations?: readonly MiniAppRentPaymentDestination[] | null
    assistantContext?: string
    assistantTone?: string
    notificationSettings?: {
      periodEvents?: boolean
      planEvents?: boolean
      purchaseEvents?: boolean
      paymentEvents?: boolean
    }
  }
): Promise<{
  householdName: string
  settings: MiniAppBillingSettings
  assistantConfig: MiniAppAssistantConfig
  notificationSettings: MiniAppNotificationSettings
}> {
  const { response, payload } = await postMiniApp<{
    ok: boolean
    authorized?: boolean
    householdName?: string
    settings?: MiniAppBillingSettings
    assistantConfig?: MiniAppAssistantConfig
    notificationSettings?: MiniAppNotificationSettings
    error?: string
  }>('/api/miniapp/admin/settings/update', {
    initData,
    ...input
  })

  if (
    !response.ok ||
    !payload.authorized ||
    !payload.householdName ||
    !payload.settings ||
    !payload.assistantConfig ||
    !payload.notificationSettings
  ) {
    throw miniAppApiError(response, payload, 'Failed to update billing settings')
  }

  return {
    householdName: payload.householdName,
    settings: payload.settings,
    assistantConfig: payload.assistantConfig,
    notificationSettings: payload.notificationSettings
  }
}

export async function upsertMiniAppUtilityCategory(
  initData: string,
  input: {
    slug?: string
    name: string
    sortOrder: number
    isActive: boolean
    providerName?: string | null
    customerNumber?: string | null
    paymentLink?: string | null
    note?: string | null
  }
): Promise<MiniAppUtilityCategory> {
  const { response, payload } = await postMiniApp<{
    ok: boolean
    authorized?: boolean
    category?: MiniAppUtilityCategory
    error?: string
  }>('/api/miniapp/admin/utility-categories/upsert', {
    initData,
    ...input
  })

  if (!response.ok || !payload.authorized || !payload.category) {
    throw miniAppApiError(response, payload, 'Failed to save utility category')
  }

  return payload.category
}

export async function promoteMiniAppMember(
  initData: string,
  memberId: string
): Promise<MiniAppMember> {
  const { response, payload } = await postMiniApp<{
    ok: boolean
    authorized?: boolean
    member?: MiniAppMember
    error?: string
  }>('/api/miniapp/admin/members/promote', {
    initData,
    memberId
  })

  if (!response.ok || !payload.authorized || !payload.member) {
    throw miniAppApiError(response, payload, 'Failed to promote member')
  }

  return payload.member
}

export async function updateMiniAppMemberDisplayName(
  initData: string,
  memberId: string,
  displayName: string
): Promise<MiniAppMember> {
  const { response, payload } = await postMiniApp<{
    ok: boolean
    authorized?: boolean
    member?: MiniAppMember
    error?: string
  }>('/api/miniapp/admin/members/display-name', {
    initData,
    memberId,
    displayName
  })

  if (!response.ok || !payload.member) {
    throw miniAppApiError(response, payload, 'Failed to update member display name')
  }

  return payload.member
}

export async function updateMiniAppMemberRentWeight(
  initData: string,
  memberId: string,
  rentShareWeight: number
): Promise<MiniAppMember> {
  const { response, payload } = await postMiniApp<{
    ok: boolean
    authorized?: boolean
    member?: MiniAppMember
    error?: string
  }>('/api/miniapp/admin/members/rent-weight', {
    initData,
    memberId,
    rentShareWeight
  })

  if (!response.ok || !payload.member) {
    throw miniAppApiError(response, payload, 'Failed to update member rent weight')
  }

  return payload.member
}

export async function updateMiniAppMemberStatus(
  initData: string,
  memberId: string,
  status: 'active' | 'away' | 'left'
): Promise<MiniAppMember> {
  const { response, payload } = await postMiniApp<{
    ok: boolean
    authorized?: boolean
    member?: MiniAppMember
    error?: string
  }>('/api/miniapp/admin/members/status', {
    initData,
    memberId,
    status
  })

  if (!response.ok || !payload.member) {
    throw miniAppApiError(response, payload, 'Failed to update member status')
  }

  return payload.member
}

export async function demoteMiniAppMember(
  initData: string,
  memberId: string
): Promise<MiniAppMember> {
  const { response, payload } = await postMiniApp<{
    ok: boolean
    authorized?: boolean
    member?: MiniAppMember
    error?: string
  }>('/api/miniapp/admin/members/demote', {
    initData,
    memberId
  })

  if (!response.ok || !payload.member) {
    throw miniAppApiError(response, payload, 'Failed to remove admin access')
  }

  return payload.member
}

export async function updateMiniAppMemberPresenceDays(
  initData: string,
  memberId: string,
  period: string,
  daysPresent: number
): Promise<MiniAppMemberPresenceDaysRecord> {
  const { response, payload } = await postMiniApp<{
    ok: boolean
    authorized?: boolean
    presenceDays?: MiniAppMemberPresenceDaysRecord
    error?: string
  }>('/api/miniapp/admin/members/presence-days', {
    initData,
    memberId,
    period,
    daysPresent
  })

  if (!response.ok || !payload.presenceDays) {
    throw miniAppApiError(response, payload, 'Failed to update member presence days')
  }

  return payload.presenceDays
}
