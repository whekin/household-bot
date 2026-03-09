import { runtimeBotApiUrl } from './runtime-config'

export interface MiniAppSession {
  authorized: boolean
  member?: {
    displayName: string
    isAdmin: boolean
  }
  telegramUser?: {
    firstName: string | null
    username: string | null
    languageCode: string | null
  }
  onboarding?: {
    status: 'join_required' | 'pending' | 'open_from_group'
    householdName?: string
  }
}

export interface MiniAppDashboard {
  period: string
  currency: 'USD' | 'GEL'
  totalDueMajor: string
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
    actorDisplayName: string | null
    occurredAt: string | null
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
