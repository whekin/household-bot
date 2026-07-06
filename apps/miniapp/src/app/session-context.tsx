import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'

import type { Locale } from '@/i18n'
import { useI18n } from '@/i18n/context'
import {
  fetchSessionQuery,
  isMiniAppSessionExpiredError,
  joinMiniAppHousehold,
  updateMiniAppLocalePreference,
  updateMiniAppOwnDisplayName
} from '@/api'
import { getTelegramWebApp } from '@/telegram/webapp'
import { demoMember, demoTelegramUser } from '@/demo/miniapp-demo'
import { hasEffectiveAdminAccess } from '@/lib/admin-access'

/* ── Types ──────────────────────────────────────────── */

type TelegramUserInfo = {
  firstName: string | null
  username: string | null
  languageCode: string | null
}

export type SessionMember = {
  id: string
  householdName: string
  displayName: string
  status: 'active' | 'away' | 'left'
  isAdmin: boolean
  preferredLocale: Locale | null
  householdDefaultLocale: Locale
}

export type SessionState =
  | { status: 'loading' }
  | { status: 'blocked'; reason: 'telegram_only' | 'session_expired' | 'error' }
  | {
      status: 'onboarding'
      mode: 'join_required' | 'pending' | 'open_from_group'
      householdName?: string
      telegramUser: TelegramUserInfo
    }
  | {
      status: 'ready'
      mode: 'live' | 'demo'
      member: SessionMember
      telegramUser: TelegramUserInfo
    }

type SessionContextValue = {
  session: SessionState
  readySession: Extract<SessionState, { status: 'ready' }> | null
  initData: string | undefined
  joining: boolean
  handleJoinHousehold: () => Promise<void>
  saveOwnDisplayName: (name: string) => Promise<void>
  handleMemberLocaleChange: (nextLocale: Locale) => Promise<void>
  handleHouseholdLocaleChange: (nextLocale: Locale) => Promise<void>
  handleMiniAppRequestError: (error: unknown) => boolean
}

const SessionContext = createContext<SessionContextValue | null>(null)

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

function readInitData(): string | undefined {
  return getTelegramWebApp()?.initData?.trim() || undefined
}

async function waitForTelegramInitData(
  options: { timeoutMs?: number; intervalMs?: number } = {}
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

export function SessionProvider({ children }: { children: ReactNode }) {
  const { locale, setLocale } = useI18n()
  const [session, setSession] = useState<SessionState>({ status: 'loading' })
  const [joining, setJoining] = useState(false)
  const bootstrapped = useRef(false)
  const localeRef = useRef(locale)
  localeRef.current = locale

  const handleMiniAppRequestError = useCallback((error: unknown): boolean => {
    if (!isMiniAppSessionExpiredError(error)) {
      return false
    }

    setSession({ status: 'blocked', reason: 'session_expired' })
    return true
  }, [])

  useEffect(() => {
    if (bootstrapped.current) return
    bootstrapped.current = true

    async function bootstrap() {
      const webApp = getTelegramWebApp()
      webApp?.ready?.()
      webApp?.expand?.()

      const data = await waitForTelegramInitData()
      if (!data) {
        if (import.meta.env.DEV) {
          setSession(demoSession)
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
        setSession({
          status: 'ready',
          mode: 'live',
          member: payload.member,
          telegramUser: payload.telegramUser
        })
      } catch (error) {
        if (import.meta.env.DEV) {
          setSession(demoSession)
          return
        }
        if (handleMiniAppRequestError(error)) {
          return
        }
        setSession({ status: 'blocked', reason: 'error' })
      }
    }

    void bootstrap()
  }, [setLocale, handleMiniAppRequestError])

  const handleJoinHousehold = useCallback(async () => {
    const data = readInitData()
    const joinToken = joinContext().joinToken
    if (!data || !joinToken) return

    setJoining(true)
    try {
      const payload = await joinMiniAppHousehold(data, joinToken)
      if (payload.authorized && payload.member && payload.telegramUser) {
        setLocale(payload.member.preferredLocale ?? payload.member.householdDefaultLocale)
        setSession({
          status: 'ready',
          mode: 'live',
          member: payload.member,
          telegramUser: payload.telegramUser
        })
        return
      }

      setLocale(
        payload.onboarding?.householdDefaultLocale ??
          ((payload.telegramUser?.languageCode ?? localeRef.current).startsWith('ru') ? 'ru' : 'en')
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
    } catch (error) {
      if (handleMiniAppRequestError(error)) {
        return
      }
      setSession({ status: 'blocked', reason: 'error' })
    } finally {
      setJoining(false)
    }
  }, [setLocale, handleMiniAppRequestError])

  const saveOwnDisplayName = useCallback(async (name: string) => {
    const data = readInitData()
    const nextName = name.trim()
    if (!data || nextName.length === 0) return

    const updatedMember = await updateMiniAppOwnDisplayName(data, nextName)
    setSession((prev) =>
      prev.status === 'ready'
        ? { ...prev, member: { ...prev.member, displayName: updatedMember.displayName } }
        : prev
    )
  }, [])

  const handleMemberLocaleChange = useCallback(
    async (nextLocale: Locale) => {
      const data = readInitData()
      setLocale(nextLocale)
      if (!data) return

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
      } catch (error) {
        // Locale was already set optimistically
        handleMiniAppRequestError(error)
      }
    },
    [setLocale, handleMiniAppRequestError]
  )

  const handleHouseholdLocaleChange = useCallback(
    async (nextLocale: Locale) => {
      const data = readInitData()
      if (!data) return

      try {
        const updated = await updateMiniAppLocalePreference(data, nextLocale, 'household')
        setSession((prev) => {
          if (prev.status !== 'ready') return prev
          const next = {
            ...prev,
            member: { ...prev.member, householdDefaultLocale: updated.householdDefaultLocale }
          }
          if (!prev.member.preferredLocale) {
            setLocale(updated.effectiveLocale)
          }
          return next
        })
      } catch (error) {
        handleMiniAppRequestError(error)
      }
    },
    [setLocale, handleMiniAppRequestError]
  )

  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      readySession: session.status === 'ready' ? session : null,
      initData: session.status === 'ready' && session.mode === 'demo' ? undefined : readInitData(),
      joining,
      handleJoinHousehold,
      saveOwnDisplayName,
      handleMemberLocaleChange,
      handleHouseholdLocaleChange,
      handleMiniAppRequestError
    }),
    [
      session,
      joining,
      handleJoinHousehold,
      saveOwnDisplayName,
      handleMemberLocaleChange,
      handleHouseholdLocaleChange,
      handleMiniAppRequestError
    ]
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext)
  if (!context) {
    throw new Error('useSession must be used within a SessionProvider')
  }
  return context
}

export function useReadySession(): Extract<SessionState, { status: 'ready' }> {
  const { readySession } = useSession()
  if (!readySession) {
    throw new Error('useReadySession requires an authenticated session')
  }
  return readySession
}

export { hasEffectiveAdminAccess }
