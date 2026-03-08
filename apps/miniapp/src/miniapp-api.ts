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
  reason?: string
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

export async function fetchMiniAppSession(initData: string): Promise<MiniAppSession> {
  const response = await fetch(`${apiBaseUrl()}/api/miniapp/session`, {
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
    member?: MiniAppSession['member']
    telegramUser?: MiniAppSession['telegramUser']
    reason?: string
    error?: string
  }

  if (!response.ok) {
    throw new Error(payload.error)
  }

  return {
    authorized: payload.authorized === true,
    ...(payload.member ? { member: payload.member } : {}),
    ...(payload.telegramUser ? { telegramUser: payload.telegramUser } : {}),
    ...(payload.reason ? { reason: payload.reason } : {})
  }
}
