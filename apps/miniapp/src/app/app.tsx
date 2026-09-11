import { QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense, useEffect, useState } from 'react'

import { AppHeader, TabBar, type TabId } from '@/components/layout'
import { BlockedScreen, LoadingScreen, OnboardingScreen } from '@/components/session-states'
import { ToastProvider } from '@/components/toast'
import { I18nProvider } from '@/i18n/context'
import { HomeView } from '@/features/home/home-view'
import { ActivityView } from '@/features/activity/activity-view'
import { SettingsView } from '@/features/settings/settings-view'
import { DashboardProvider } from './dashboard-context'
import { miniAppQueryClient } from './query-client'
import { SessionProvider, useSession } from './session-context'
import { ThemeProvider } from './theme-context'

const RoutinesView = lazy(() =>
  import('@/features/routines/routines-view').then((module) => ({ default: module.RoutinesView }))
)

const TAB_HASHES: Record<TabId, string> = {
  home: '',
  activity: '#activity',
  settings: '#settings'
}

function tabFromHash(): TabId {
  if (typeof window === 'undefined') return 'home'
  const hash = window.location.hash
  if (hash.startsWith('#activity')) return 'activity'
  if (hash.startsWith('#settings')) return 'settings'
  return 'home'
}

function AuthenticatedApp() {
  const [routinesOpen, setRoutinesOpen] = useState(window.location.hash === '#routines')
  useEffect(() => {
    const open = () => setRoutinesOpen(true)
    window.addEventListener('miniapp:routines', open)
    return () => window.removeEventListener('miniapp:routines', open)
  }, [])
  const [tab, setTab] = useState<TabId>(tabFromHash)

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<TabId>).detail
      if (detail === 'home' || detail === 'activity' || detail === 'settings') {
        setTab(detail)
      }
    }
    window.addEventListener('miniapp:navigate', handler)
    return () => window.removeEventListener('miniapp:navigate', handler)
  }, [])

  useEffect(() => {
    const hash = routinesOpen ? '#routines' : TAB_HASHES[tab]
    if (window.location.hash !== hash) {
      history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`)
    }
    window.scrollTo({ top: 0 })
  }, [tab, routinesOpen])

  return (
    <DashboardProvider>
      <div className="pb-[calc(84px+env(safe-area-inset-bottom))]">
        <AppHeader />
        <main className="mx-auto max-w-lg space-y-4 px-4 pt-4">
          {routinesOpen ? (
            <Suspense fallback={<p role="status">…</p>}>
              <RoutinesView onBack={() => setRoutinesOpen(false)} />
            </Suspense>
          ) : null}
          {!routinesOpen && tab === 'home' ? <HomeView /> : null}
          {!routinesOpen && tab === 'activity' ? <ActivityView /> : null}
          {!routinesOpen && tab === 'settings' ? <SettingsView /> : null}
        </main>
      </div>
      <TabBar
        tab={tab}
        onChange={(next) => {
          setRoutinesOpen(false)
          setTab(next)
        }}
      />
    </DashboardProvider>
  )
}

function AppContent() {
  const { session } = useSession()

  if (session.status === 'loading') {
    return <LoadingScreen />
  }
  if (session.status === 'blocked') {
    return <BlockedScreen reason={session.reason} />
  }
  if (session.status === 'onboarding') {
    return <OnboardingScreen mode={session.mode} householdName={session.householdName} />
  }
  return <AuthenticatedApp />
}

export function App() {
  return (
    <QueryClientProvider client={miniAppQueryClient}>
      <ThemeProvider>
        <I18nProvider>
          <ToastProvider>
            <SessionProvider>
              <AppContent />
            </SessionProvider>
          </ToastProvider>
        </I18nProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
