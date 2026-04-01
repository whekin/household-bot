import { createContext, createSignal, onMount, useContext, type ParentProps } from 'solid-js'

import type { Locale } from '../i18n'
import {
  joinMiniAppHousehold,
  updateMiniAppLocalePreference,
  updateMiniAppOwnDisplayName
} from '../miniapp-api'
import { fetchSessionQuery, invalidateHouseholdQueries } from '../app/miniapp-queries'
import { getTelegramWebApp } from '../telegram-webapp'
import { demoMember, demoTelegramUser } from '../demo/miniapp-demo'
import { useI18n } from './i18n-context'

/* ── Types ──────────────────────────────────────────── */

export type SessionState =
  | { status: 'loading' }
  | { status: 'blocked'; reason: 'telegram_only' | 'error' }
  | {
      status: 'onboarding'
      mode: 'join_required' | 'pending' | 'open_from_group'
      householdName?: string
      telegramUser: {
        firstName: string | null
        username: string | null
        languageCode: string | null
      }
    }
  | {
      status: 'ready'
      mode: 'live' | 'demo'
      member: {
        id: string
        householdName: string
        displayName: string
        status: 'active' | 'away' | 'left'
        isAdmin: boolean
        preferredLocale: Locale | null
        householdDefaultLocale: Locale
      }
      telegramUser: {
        firstName: string | null
        username: string | null
        languageCode: string | null
      }
    }

type SessionContextValue = {
  session: () => SessionState
  setSession: (updater: SessionState | ((prev: SessionState) => SessionState)) => void
  readySession: () => Extract<SessionState, { status: 'ready' }> | null
  onboardingSession: () => Extract<SessionState, { status: 'onboarding' }> | null
  blockedSession: () => Extract<SessionState, { status: 'blocked' }> | null
  webApp: ReturnType<typeof getTelegramWebApp>
  initData: () => string | undefined
  joining: () => boolean
  displayNameDraft: () => string
  setDisplayNameDraft: (value: string | ((prev: string) => string)) => void
  savingOwnDisplayName: () => boolean
  handleJoinHousehold: () => Promise<void>
  handleSaveOwnDisplayName: () => Promise<void>
  handleMemberLocaleChange: (nextLocale: Locale) => Promise<void>
  handleHouseholdLocaleChange: (nextLocale: Locale) => Promise<void>
  refreshHouseholdData: (includeAdmin?: boolean, forceRefresh?: boolean) => Promise<void>
  registerRefreshListener: (
    listener: (initData: string, isAdmin: boolean) => Promise<void>
  ) => () => void
}

const SessionContext = createContext<SessionContextValue>()

/* ── Helpers ────────────────────────────────────────── */

function joinContext(): { joinToken?: string; botUsername?: string } {
  if (typeof window === 'undefined') {
    return {}
  }

  const params = new URLSearchParams(window.location.search)
  const joinToken = params.get('join')?.trim()
  const botUsername = params.get('bot')?.trim()

  return {
    ...(joinToken ? { joinToken } : {}),
    ...(botUsername ? { botUsername } : {})
  }
}

export function joinDeepLink(): string | null {
  const context = joinContext()
  if (!context.botUsername || !context.joinToken) {
    return null
  }

  return `https://t.me/${context.botUsername}?start=join_${encodeURIComponent(context.joinToken)}`
}

const demoSession: Extract<SessionState, { status: 'ready' }> = {
  status: 'ready',
  mode: 'demo',
  member: demoMember,
  telegramUser: demoTelegramUser
}

async function waitForTelegramInitData(
  readInitData: () => string | undefined,
  options: {
    timeoutMs?: number
    intervalMs?: number
  } = {}
): Promise<string | undefined> {
  const timeoutMs = options.timeoutMs ?? 2500
  const intervalMs = options.intervalMs ?? 100
  const startedAt = Date.now()

  while (Date.now() - startedAt <= timeoutMs) {
    const data = readInitData()
    if (data) {
      return data
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  return readInitData()
}

/* ── Provider ───────────────────────────────────────── */

export function SessionProvider(
  props: ParentProps<{
    onReady?: (initData: string, isAdmin: boolean) => Promise<void>
  }>
) {
  const { locale, setLocale } = useI18n()
  const webApp = getTelegramWebApp()

  const [session, setSession] = createSignal<SessionState>({ status: 'loading' })
  const [joining, setJoining] = createSignal(false)
  const [displayNameDraft, setDisplayNameDraft] = createSignal('')
  const [savingOwnDisplayName, setSavingOwnDisplayName] = createSignal(false)

  const refreshListeners = new Set<(initData: string, isAdmin: boolean) => Promise<void>>()

  function registerRefreshListener(
    listener: (initData: string, isAdmin: boolean) => Promise<void>
  ) {
    refreshListeners.add(listener)
    return () => {
      refreshListeners.delete(listener)
    }
  }

  const readySession = () => {
    const current = session()
    return current.status === 'ready' ? current : null
  }
  const onboardingSession = () => {
    const current = session()
    return current.status === 'onboarding' ? current : null
  }
  const blockedSession = () => {
    const current = session()
    return current.status === 'blocked' ? current : null
  }
  const initData = () => webApp?.initData?.trim() || undefined

  async function bootstrap() {
    webApp?.ready?.()
    webApp?.expand?.()

    const data = await waitForTelegramInitData(initData)
    if (!data) {
      if (import.meta.env.DEV) {
        setSession(demoSession)
        setDisplayNameDraft(demoSession.member.displayName)
        await props.onReady?.('', true)
        return
      }
      setSession({ status: 'blocked', reason: 'telegram_only' })
      return
    }

    try {
      const payload = await fetchSessionQuery(data, joinContext().joinToken)
      if (!payload.authorized || !payload.member || !payload.telegramUser) {
        setLocale(
          payload.onboarding?.householdDefaultLocale ??
            ((payload.telegramUser?.languageCode ?? 'en').startsWith('ru') ? 'ru' : 'en')
        )
        setSession({
          status: 'onboarding',
          mode: payload.onboarding?.status ?? 'open_from_group',
          ...(payload.onboarding?.householdName
            ? { householdName: payload.onboarding.householdName }
            : {}),
          telegramUser: payload.telegramUser ?? {
            firstName: null,
            username: null,
            languageCode: null
          }
        })
        return
      }

      setLocale(payload.member.preferredLocale ?? payload.member.householdDefaultLocale)
      setDisplayNameDraft(payload.member.displayName)
      setSession({
        status: 'ready',
        mode: 'live',
        member: payload.member,
        telegramUser: payload.telegramUser
      })
      await props.onReady?.(data, payload.member.isAdmin)
    } catch {
      if (import.meta.env.DEV) {
        setSession(demoSession)
        setDisplayNameDraft(demoSession.member.displayName)
        await props.onReady?.('', true)
        return
      }
      setSession({ status: 'blocked', reason: 'error' })
    }
  }

  async function handleJoinHousehold() {
    const data = initData()
    const joinToken = joinContext().joinToken
    if (!data || !joinToken || joining()) return

    setJoining(true)
    try {
      const payload = await joinMiniAppHousehold(data, joinToken)
      if (payload.authorized && payload.member && payload.telegramUser) {
        setLocale(payload.member.preferredLocale ?? payload.member.householdDefaultLocale)
        setDisplayNameDraft(payload.member.displayName)
        setSession({
          status: 'ready',
          mode: 'live',
          member: payload.member,
          telegramUser: payload.telegramUser
        })
        await props.onReady?.(data, payload.member.isAdmin)
        return
      }

      setLocale(
        payload.onboarding?.householdDefaultLocale ??
          ((payload.telegramUser?.languageCode ?? locale()).startsWith('ru') ? 'ru' : 'en')
      )
      setSession({
        status: 'onboarding',
        mode: payload.onboarding?.status ?? 'pending',
        ...(payload.onboarding?.householdName
          ? { householdName: payload.onboarding.householdName }
          : {}),
        telegramUser: payload.telegramUser ?? {
          firstName: null,
          username: null,
          languageCode: null
        }
      })
    } catch {
      setSession({ status: 'blocked', reason: 'error' })
    } finally {
      setJoining(false)
    }
  }

  async function handleSaveOwnDisplayName() {
    const data = initData()
    const current = readySession()
    const nextName = displayNameDraft().trim()
    if (!data || current?.mode !== 'live' || nextName.length === 0) return

    setSavingOwnDisplayName(true)
    try {
      const updatedMember = await updateMiniAppOwnDisplayName(data, nextName)
      setSession((prev) =>
        prev.status === 'ready'
          ? { ...prev, member: { ...prev.member, displayName: updatedMember.displayName } }
          : prev
      )
      setDisplayNameDraft(updatedMember.displayName)
    } finally {
      setSavingOwnDisplayName(false)
    }
  }

  async function handleMemberLocaleChange(nextLocale: Locale) {
    const data = initData()
    const current = readySession()
    setLocale(nextLocale)

    if (!data || current?.mode !== 'live') return

    try {
      const updated = await updateMiniAppLocalePreference(data, nextLocale, 'member')
      setSession((prev) =>
        prev.status === 'ready'
          ? {
              ...prev,
              member: {
                ...prev.member,
                preferredLocale: updated.memberPreferredLocale,
                householdDefaultLocale: updated.householdDefaultLocale
              }
            }
          : prev
      )
      setLocale(updated.effectiveLocale)
    } catch {
      // Locale was already set optimistically
    }
  }

  async function handleHouseholdLocaleChange(nextLocale: Locale) {
    const data = initData()
    const current = readySession()
    if (!data || current?.mode !== 'live' || !current.member.isAdmin) return

    try {
      const updated = await updateMiniAppLocalePreference(data, nextLocale, 'household')
      setSession((prev) =>
        prev.status === 'ready'
          ? {
              ...prev,
              member: { ...prev.member, householdDefaultLocale: updated.householdDefaultLocale }
            }
          : prev
      )
      if (!current.member.preferredLocale) {
        setLocale(updated.effectiveLocale)
      }
    } catch {
      // Ignore
    }
  }

  async function refreshHouseholdData(includeAdmin = false, forceRefresh = false) {
    const data = initData()
    if (!data) return

    if (forceRefresh) {
      await invalidateHouseholdQueries(data)
    }
    // Delegate actual data loading to dashboard context via onReady
    const current = readySession()
    if (current) {
      const isAdmin = current.member.isAdmin && includeAdmin
      await Promise.all([
        props.onReady?.(data, isAdmin),
        ...Array.from(refreshListeners).map((l) => l(data, isAdmin))
      ])
    }
  }

  onMount(() => {
    void bootstrap()
  })

  return (
    <SessionContext.Provider
      value={{
        session,
        setSession,
        readySession,
        onboardingSession,
        blockedSession,
        webApp,
        initData,
        joining,
        displayNameDraft,
        setDisplayNameDraft,
        savingOwnDisplayName,
        handleJoinHousehold,
        handleSaveOwnDisplayName,
        handleMemberLocaleChange,
        handleHouseholdLocaleChange,
        refreshHouseholdData,
        registerRefreshListener
      }}
    >
      {props.children}
    </SessionContext.Provider>
  )
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext)
  if (!context) {
    throw new Error('useSession must be used within a SessionProvider')
  }
  return context
}
