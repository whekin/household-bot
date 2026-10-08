import { QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense, useEffect, useState } from 'react'

import { AppHeader, TabBar, type TabId } from '@/components/layout'
import { BlockedScreen, LoadingScreen, OnboardingScreen } from '@/components/session-states'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ToastProvider } from '@/components/toast'
import { ViewErrorBoundary } from '@/components/view-error-boundary'
import { I18nProvider, useI18n } from '@/i18n/context'
import { HomeView } from '@/features/home/home-view'
import { DashboardProvider, useDashboard } from './dashboard-context'
import { miniAppQueryClient } from './query-client'
import { SessionProvider, useSession } from './session-context'
import { ThemeProvider } from './theme-context'

const RoutinesView = lazy(() =>
  import('@/features/routines/routines-view').then((module) => ({ default: module.RoutinesView }))
)
const ActivityView = lazy(() =>
  import('@/features/activity/activity-view').then((module) => ({ default: module.ActivityView }))
)
const SettingsView = lazy(() =>
  import('@/features/settings/settings-view').then((module) => ({ default: module.SettingsView }))
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

function ViewLoading() {
  const { copy } = useI18n()
  return (
    <div role="status" aria-label={copy.loadingTitle} className="space-y-4">
      <Skeleton className="h-44 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  )
}

function ViewLoadError({
  title,
  onRetry,
  loading = false
}: {
  title: string
  onRetry: () => void
  loading?: boolean
}) {
  const { copy } = useI18n()
  return (
    <Card>
      <div role="alert" className="space-y-3 text-center">
        <p className="font-semibold">{title}</p>
        <p className="text-sm text-muted-foreground">{copy.dashboardLoadErrorBody}</p>
        <Button loading={loading} onClick={onRetry}>
          {copy.reload}
        </Button>
      </div>
    </Card>
  )
}

function DashboardContent({
  tab,
  routinesOpen,
  onCloseRoutines
}: {
  tab: TabId
  routinesOpen: boolean
  onCloseRoutines: () => void
}) {
  const { dashboard, error, adminError, refreshing, refresh } = useDashboard()
  const { copy } = useI18n()

  if (!routinesOpen && ((error && !dashboard) || (tab !== 'home' && adminError))) {
    return (
      <ViewLoadError
        title={copy.dashboardLoadErrorTitle}
        loading={refreshing}
        onRetry={() => void refresh()}
      />
    )
  }

  return (
    <ViewErrorBoundary
      key={routinesOpen ? 'routines' : tab}
      fallback={
        <ViewLoadError title={copy.viewLoadErrorTitle} onRetry={() => window.location.reload()} />
      }
    >
      <Suspense fallback={<ViewLoading />}>
        {routinesOpen ? <RoutinesView onBack={onCloseRoutines} /> : null}
        {!routinesOpen && tab === 'home' ? <HomeView /> : null}
        {!routinesOpen && tab === 'activity' ? <ActivityView /> : null}
        {!routinesOpen && tab === 'settings' ? <SettingsView /> : null}
      </Suspense>
    </ViewErrorBoundary>
  )
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
    <DashboardProvider loadAdminData={!routinesOpen && tab !== 'home'}>
      <div className="pb-[calc(84px+env(safe-area-inset-bottom))]">
        <AppHeader />
        <main className="mx-auto max-w-lg space-y-4 px-4 pt-4">
          <DashboardContent
            tab={tab}
            routinesOpen={routinesOpen}
            onCloseRoutines={() => setRoutinesOpen(false)}
          />
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
