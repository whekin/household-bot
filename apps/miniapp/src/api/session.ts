import { miniAppApiError, postMiniApp } from './client'
import type { MiniAppLocalePreference, MiniAppSession } from './types'

export async function fetchMiniAppSession(
  initData: string,
  joinToken?: string
): Promise<MiniAppSession> {
  const { response, payload } = await postMiniApp<{
    ok: boolean
    authorized?: boolean
    member?: MiniAppSession['member']
    telegramUser?: MiniAppSession['telegramUser']
    onboarding?: MiniAppSession['onboarding']
    error?: string
  }>('/api/miniapp/session', {
    initData,
    ...(joinToken
      ? {
          joinToken
        }
      : {})
  })

  if (!response.ok) {
    throw miniAppApiError(response, payload, 'Failed to create mini app session')
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
  const { response, payload } = await postMiniApp<{
    ok: boolean
    authorized?: boolean
    member?: MiniAppSession['member']
    telegramUser?: MiniAppSession['telegramUser']
    onboarding?: MiniAppSession['onboarding']
    error?: string
  }>('/api/miniapp/join', {
    initData,
    joinToken
  })

  if (!response.ok) {
    throw miniAppApiError(response, payload, 'Failed to join household')
  }

  return {
    authorized: payload.authorized === true,
    ...(payload.member ? { member: payload.member } : {}),
    ...(payload.telegramUser ? { telegramUser: payload.telegramUser } : {}),
    ...(payload.onboarding ? { onboarding: payload.onboarding } : {})
  }
}

export async function updateMiniAppLocalePreference(
  initData: string,
  locale: 'en' | 'ru',
  scope: 'member' | 'household'
): Promise<MiniAppLocalePreference> {
  const { response, payload } = await postMiniApp<{
    ok: boolean
    authorized?: boolean
    locale?: MiniAppLocalePreference
    error?: string
  }>('/api/miniapp/preferences/locale', {
    initData,
    locale,
    scope
  })

  if (!response.ok || !payload.authorized || !payload.locale) {
    throw miniAppApiError(response, payload, 'Failed to update locale preference')
  }

  return payload.locale
}

export async function updateMiniAppOwnDisplayName(
  initData: string,
  displayName: string
): Promise<NonNullable<MiniAppSession['member']>> {
  const { response, payload } = await postMiniApp<{
    ok: boolean
    authorized?: boolean
    member?: MiniAppSession['member']
    error?: string
  }>('/api/miniapp/member/display-name', {
    initData,
    displayName
  })

  if (!response.ok || !payload.authorized || !payload.member) {
    throw miniAppApiError(response, payload, 'Failed to update display name')
  }

  return payload.member
}
