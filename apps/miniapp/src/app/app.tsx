import { QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

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
    const hash = TAB_HASHES[tab]
    if (window.location.hash !== hash) {
      history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`)
    }
    window.scrollTo({ top: 0 })
  }, [tab])

  return (
    <DashboardProvider>
      <div className="pb-[calc(84px+env(safe-area-inset-bottom))]">
        <AppHeader />
        <main className="mx-auto max-w-lg space-y-4 px-4 pt-4">
          {tab === 'home' ? <HomeView /> : null}
          {tab === 'activity' ? <ActivityView /> : null}
          {tab === 'settings' ? <SettingsView /> : null}
        </main>
      </div>
      <TabBar tab={tab} onChange={setTab} />
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
