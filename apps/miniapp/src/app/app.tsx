import { QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'

import { AppHeader, TabBar } from '@/components/layout'
import { BlockedScreen, LoadingScreen, OnboardingScreen } from '@/components/session-states'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ToastProvider } from '@/components/toast'
import { ViewErrorBoundary } from '@/components/view-error-boundary'
import { AddSheet, type AddChoice } from '@/features/add/add-sheet'
import { HomeView } from '@/features/home/home-view'
import { I18nProvider, useI18n } from '@/i18n/context'
import { AppNavContext, TAB_IDS, type TabId } from './app-nav'
import { DashboardProvider, useDashboard } from './dashboard-context'
import { miniAppQueryClient } from './query-client'
import { SessionProvider, useSession } from './session-context'
import { ThemeProvider } from './theme-context'

const MonthView = lazy(() =>
  import('@/features/month/month-view').then((module) => ({ default: module.MonthView }))
)
const HistoryView = lazy(() =>
  import('@/features/history/history-view').then((module) => ({ default: module.HistoryView }))
)
const HouseView = lazy(() =>
  import('@/features/settings/settings-view').then((module) => ({ default: module.SettingsView }))
)
const PurchaseEditor = lazy(() =>
  import('@/features/activity/purchase-editor').then((module) => ({
    default: module.PurchaseEditor
  }))
)
const UtilityEditor = lazy(() =>
  import('@/features/activity/utility-editor').then((module) => ({
    default: module.UtilityEditor
  }))
)
const PaymentEditor = lazy(() =>
  import('@/features/activity/payment-editor').then((module) => ({
    default: module.PaymentEditor
  }))
)
const BuysSheet = lazy(() =>
  import('@/features/home/buys-sheet').then((module) => ({ default: module.BuysSheet }))
)
const RoutinesView = lazy(() =>
  import('@/features/routines/routines-view').then((module) => ({ default: module.RoutinesView }))
)

function tabFromHash(): TabId {
  const hash = window.location.hash.replace('#', '')
  return (TAB_IDS as readonly string[]).includes(hash) ? (hash as TabId) : 'home'
}

function ViewLoading() {
  const { copy } = useI18n()
  return (
    <div role="status" aria-label={copy.loadingTitle} className="space-y-3">
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
      <div role="alert" className="space-y-3 py-2 text-center">
        <p className="font-semibold">{title}</p>
        <p className="text-sm text-muted-foreground">{copy.dashboardLoadErrorBody}</p>
        <Button variant="primary" loading={loading} onClick={onRetry}>
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

  const view = routinesOpen ? 'routines' : tab
  return (
    <ViewErrorBoundary
      key={view}
      fallback={
        <ViewLoadError title={copy.viewLoadErrorTitle} onRetry={() => window.location.reload()} />
      }
    >
      <Suspense fallback={<ViewLoading />}>
        {view === 'routines' ? <RoutinesView onBack={onCloseRoutines} /> : null}
        {view === 'home' ? <HomeView /> : null}
        {view === 'month' ? <MonthView /> : null}
        {view === 'history' ? <HistoryView /> : null}
        {view === 'house' ? <HouseView /> : null}
      </Suspense>
    </ViewErrorBoundary>
  )
}

/** Sheets any screen can open: the Add chooser, the editors it leads to, shared buys. */
function ShellSheets({
  addOpen,
  setAddOpen,
  buys,
  setBuys
}: {
  addOpen: boolean
  setAddOpen: (open: boolean) => void
  buys: { open: boolean; transfer: boolean }
  setBuys: (value: { open: boolean; transfer: boolean }) => void
}) {
  const [editor, setEditor] = useState<Exclude<AddChoice, 'transfer'> | null>(null)

  return (
    <>
      <AddSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        onChoose={(choice) => {
          if (choice === 'transfer') setBuys({ open: true, transfer: true })
          else setEditor(choice)
        }}
      />
      {/* Editors load on first use; Home's first paint does not wait for them. */}
      <Suspense fallback={null}>
        {editor === 'purchase' ? (
          <PurchaseEditor open entry={null} onOpenChange={(open) => !open && setEditor(null)} />
        ) : null}
        {editor === 'bill' ? (
          <UtilityEditor open entry={null} onOpenChange={(open) => !open && setEditor(null)} />
        ) : null}
        {editor === 'payment' ? (
          <PaymentEditor
            open
            entry={null}
            prefill={null}
            onOpenChange={(open) => !open && setEditor(null)}
          />
        ) : null}
        {buys.open ? (
          <BuysSheet
            open
            startWithTransfer={buys.transfer}
            onOpenChange={(open) => {
              if (!open) setBuys({ open: false, transfer: false })
            }}
          />
        ) : null}
      </Suspense>
    </>
  )
}

function AuthenticatedApp() {
  const [routinesOpen, setRoutinesOpen] = useState(window.location.hash === '#routines')
  const [tab, setTab] = useState<TabId>(tabFromHash)
  const [addOpen, setAddOpen] = useState(false)
  const [buys, setBuys] = useState({ open: false, transfer: false })

  useEffect(() => {
    const open = () => setRoutinesOpen(true)
    window.addEventListener('miniapp:routines', open)
    return () => window.removeEventListener('miniapp:routines', open)
  }, [])

  useEffect(() => {
    const hash = routinesOpen ? '#routines' : tab === 'home' ? '' : `#${tab}`
    if (window.location.hash !== hash) {
      history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`)
    }
    window.scrollTo({ top: 0 })
  }, [tab, routinesOpen])

  const nav = useMemo(
    () => ({
      tab,
      navigate: (next: TabId) => {
        setRoutinesOpen(false)
        setTab(next)
      },
      openAdd: () => setAddOpen(true),
      openBuys: (options?: { transfer?: boolean }) =>
        setBuys({ open: true, transfer: options?.transfer ?? false }),
      openRoutines: () => setRoutinesOpen(true)
    }),
    [tab]
  )

  return (
    <AppNavContext.Provider value={nav}>
      <DashboardProvider loadAdminData={!routinesOpen && (tab === 'month' || tab === 'house')}>
        <div className="pb-[calc(96px+env(safe-area-inset-bottom))]">
          <AppHeader />
          <main className="mx-auto max-w-lg px-4 pt-3">
            <DashboardContent
              tab={tab}
              routinesOpen={routinesOpen}
              onCloseRoutines={() => setRoutinesOpen(false)}
            />
          </main>
        </div>
        <TabBar tab={routinesOpen ? 'house' : tab} onChange={nav.navigate} onAdd={nav.openAdd} />
        <ShellSheets addOpen={addOpen} setAddOpen={setAddOpen} buys={buys} setBuys={setBuys} />
      </DashboardProvider>
    </AppNavContext.Provider>
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
