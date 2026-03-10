import { runtimeBotApiUrl } from './runtime-config'

export interface MiniAppSession {
  authorized: boolean
  member?: {
    id: string
    householdId: string
    displayName: string
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

export interface MiniAppMember {
  id: string
  displayName: string
  rentShareWeight: number
  isAdmin: boolean
}

export interface MiniAppBillingSettings {
  householdId: string
  settlementCurrency: 'USD' | 'GEL'
  rentAmountMinor: string | null
  rentCurrency: 'USD' | 'GEL'
  rentDueDay: number
  rentWarningDay: number
  utilitiesDueDay: number
  utilitiesReminderDay: number
  timezone: string
}

export interface MiniAppUtilityCategory {
  id: string
  householdId: string
  slug: string
  name: string
  sortOrder: number
  isActive: boolean
}

export interface MiniAppDashboard {
  period: string
  currency: 'USD' | 'GEL'
  totalDueMajor: string
  rentSourceAmountMajor: string
  rentSourceCurrency: 'USD' | 'GEL'
  rentDisplayAmountMajor: string
  rentFxRateMicros: string | null
  rentFxEffectiveDate: string | null
  members: {
    memberId: string
    displayName: string
    rentShareMajor: string
    utilityShareMajor: string
    purchaseOffsetMajor: string
    netDueMajor: string
    explanations: readonly string[]
  }[]
  ledger: {
    id: string
    kind: 'purchase' | 'utility'
    title: string
    amountMajor: string
    currency: 'USD' | 'GEL'
    displayAmountMajor: string
    displayCurrency: 'USD' | 'GEL'
    fxRateMicros: string | null
    fxEffectiveDate: string | null
    actorDisplayName: string | null
    occurredAt: string | null
  }[]
}

export interface MiniAppAdminSettingsPayload {
  settings: MiniAppBillingSettings
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
    settings?: MiniAppBillingSettings
    categories?: MiniAppUtilityCategory[]
    members?: MiniAppMember[]
    error?: string
  }

  if (
    !response.ok ||
    !payload.authorized ||
    !payload.settings ||
    !payload.categories ||
    !payload.members
  ) {
    throw new Error(payload.error ?? 'Failed to load admin settings')
  }

  return {
    settings: payload.settings,
    categories: payload.categories,
    members: payload.members
  }
}

export async function updateMiniAppBillingSettings(
  initData: string,
  input: {
    settlementCurrency?: 'USD' | 'GEL'
    rentAmountMajor?: string
    rentCurrency: 'USD' | 'GEL'
    rentDueDay: number
    rentWarningDay: number
    utilitiesDueDay: number
    utilitiesReminderDay: number
    timezone: string
  }
): Promise<MiniAppBillingSettings> {
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
    settings?: MiniAppBillingSettings
    error?: string
  }

  if (!response.ok || !payload.authorized || !payload.settings) {
    throw new Error(payload.error ?? 'Failed to update billing settings')
  }

  return payload.settings
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
