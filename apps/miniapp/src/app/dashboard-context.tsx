import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'

import type { CalendarDateParts } from '@/lib/dates'
import { normalizePeriodOverride, parseCalendarDate } from '@/lib/dates'
import { hasEffectiveAdminAccess } from '@/lib/admin-access'
import {
  fetchMiniAppAdminSettings,
  fetchMiniAppBillingCycle,
  fetchMiniAppDashboard,
  fetchMiniAppPendingMembers,
  invalidateHouseholdQueries,
  miniAppQueryKeys,
  type MiniAppAdminCycleState,
  type MiniAppAdminSettingsPayload,
  type MiniAppDashboard,
  type MiniAppPendingMember
} from '@/api'
import type { DemoScenarioId } from '@/demo/miniapp-demo'
import { miniAppDemo } from '@/demo/loader'
import { useSession } from './session-context'

/* ── Types ──────────────────────────────────────────── */

export type TestingRolePreview = 'admin' | 'resident'

type LedgerEntry = MiniAppDashboard['ledger'][number]
type MemberLine = MiniAppDashboard['members'][number]

type DashboardContextValue = {
  dashboard: MiniAppDashboard | null
  loading: boolean
  error: Error | null
  refreshing: boolean
  adminLoading: boolean
  adminError: Error | null
  adminSettings: MiniAppAdminSettingsPayload | null
  cycleState: MiniAppAdminCycleState | null
  pendingMembers: readonly MiniAppPendingMember[]
  effectiveIsAdmin: boolean
  currentMemberLine: MemberLine | null
  /** Shared buys not paid back yet. */
  activePurchaseLedger: LedgerEntry[]
  testingRolePreview: TestingRolePreview | null
  setTestingRolePreview: (value: TestingRolePreview | null) => void
  demoScenario: DemoScenarioId
  setDemoScenario: (value: DemoScenarioId) => void
  testingPeriodOverride: string | null
  setTestingPeriodOverride: (value: string | null) => void
  testingTodayOverride: string | null
  setTestingTodayOverride: (value: string | null) => void
  effectivePeriod: string | null
  effectiveTodayOverride: CalendarDateParts | null
  testingOverridesActive: boolean
  refresh: () => Promise<void>
  // Mutations whose response already carries a rebuilt dashboard hand it straight to the
  // cache, so the screen updates without asking the server to build the same thing again.
  applyDashboard: (next: MiniAppDashboard) => boolean
}

const DashboardContext = createContext<DashboardContextValue | null>(null)

function periodFromCalendarValue(value: string | null | undefined): string | null {
  const parsed = value ? parseCalendarDate(value) : null
  if (!parsed) return null

  return `${String(parsed.year).padStart(4, '0')}-${String(parsed.month).padStart(2, '0')}`
}

/* ── Provider ───────────────────────────────────────── */

export function DashboardProvider({
  children,
  loadAdminData = false
}: {
  children: ReactNode
  loadAdminData?: boolean
}) {
  const { readySession, initData, handleMiniAppRequestError } = useSession()
  const queryClient = useQueryClient()

  const [testingRolePreview, setTestingRolePreview] = useState<TestingRolePreview | null>(null)
  const [demoScenario, setDemoScenario] = useState<DemoScenarioId>(() => {
    const requested = new URLSearchParams(window.location.search).get('scenario')
    return miniAppDemo?.demoScenarioIds.find((id) => id === requested) ?? 'utilities-due'
  })
  const [testingPeriodOverride, setTestingPeriodOverride] = useState<string | null>(null)
  const [testingTodayOverride, setTestingTodayOverride] = useState<string | null>(null)

  const isDemo = miniAppDemo !== null && (readySession?.mode === 'demo' || !initData)
  const member = readySession?.member ?? null

  const derivedTestingPeriodOverride =
    normalizePeriodOverride(testingPeriodOverride) ?? periodFromCalendarValue(testingTodayOverride)

  const demoDefaultTodayOverride = isDemo
    ? (miniAppDemo?.getDemoScenarioDefaultToday(demoScenario, derivedTestingPeriodOverride) ?? null)
    : null
  const demoDefaultPeriodOverride = isDemo
    ? periodFromCalendarValue(demoDefaultTodayOverride)
    : null

  const effectiveTodayOverride = useMemo(() => {
    const value = testingTodayOverride || demoDefaultTodayOverride
    return value ? parseCalendarDate(value) : null
  }, [testingTodayOverride, demoDefaultTodayOverride])

  const effectiveIsAdmin = hasEffectiveAdminAccess(member ?? undefined, testingRolePreview)

  const requestPeriodOverride = derivedTestingPeriodOverride ?? demoDefaultPeriodOverride
  const requestTodayOverride = testingTodayOverride

  /* ── Data: demo state or live queries ── */

  const demoState = useMemo(
    () =>
      isDemo
        ? (miniAppDemo?.getDemoScenarioState(demoScenario, {
            periodOverride: requestPeriodOverride,
            todayOverride: requestTodayOverride
          }) ?? null)
        : null,
    [isDemo, demoScenario, requestPeriodOverride, requestTodayOverride]
  )

  const dashboardQuery = useQuery({
    queryKey: miniAppQueryKeys.dashboard(
      initData ?? '',
      requestPeriodOverride,
      requestTodayOverride
    ),
    queryFn: () =>
      fetchMiniAppDashboard(initData ?? '', {
        periodOverride: requestPeriodOverride,
        todayOverride: requestTodayOverride
      }),
    enabled: !isDemo
  })

  const adminEnabled = !isDemo && effectiveIsAdmin
  const adminSettingsQuery = useQuery({
    queryKey: miniAppQueryKeys.adminSettings(initData ?? ''),
    queryFn: () => fetchMiniAppAdminSettings(initData ?? ''),
    enabled: adminEnabled && loadAdminData
  })
  const cycleStateQuery = useQuery({
    queryKey: miniAppQueryKeys.billingCycle(initData ?? ''),
    queryFn: () => fetchMiniAppBillingCycle(initData ?? ''),
    enabled: adminEnabled && loadAdminData
  })
  const pendingMembersQuery = useQuery({
    queryKey: miniAppQueryKeys.pendingMembers(initData ?? ''),
    queryFn: () => fetchMiniAppPendingMembers(initData ?? ''),
    enabled: adminEnabled && loadAdminData
  })

  const queryError =
    dashboardQuery.error ??
    adminSettingsQuery.error ??
    cycleStateQuery.error ??
    pendingMembersQuery.error
  useEffect(() => {
    if (queryError) {
      handleMiniAppRequestError(queryError)
    }
  }, [queryError, handleMiniAppRequestError])

  const dashboard = isDemo ? (demoState?.dashboard ?? null) : (dashboardQuery.data ?? null)
  const adminSettings = isDemo
    ? (demoState?.adminSettings ?? null)
    : adminEnabled
      ? (adminSettingsQuery.data ?? null)
      : null
  const cycleState = isDemo
    ? (demoState?.cycleState ?? null)
    : adminEnabled
      ? (cycleStateQuery.data ?? null)
      : null
  const pendingMembers = isDemo
    ? (demoState?.pendingMembers ?? [])
    : adminEnabled
      ? (pendingMembersQuery.data ?? [])
      : []

  const loading = !isDemo && dashboardQuery.isPending
  const error = isDemo ? null : dashboardQuery.error
  const adminLoading =
    adminEnabled && loadAdminData && (adminSettingsQuery.isPending || cycleStateQuery.isPending)
  const adminError = adminEnabled
    ? (adminSettingsQuery.error ?? cycleStateQuery.error ?? pendingMembersQuery.error)
    : null
  const refreshing = !isDemo && !dashboardQuery.isPending && dashboardQuery.isFetching

  const refresh = useCallback(async () => {
    if (!initData) return
    await invalidateHouseholdQueries(initData)
  }, [initData])

  const applyDashboard = useCallback(
    (next: MiniAppDashboard) => {
      // Declines rather than caching a dashboard for a period this screen is not showing;
      // the caller falls back to a full refresh, which is correct if slower.
      if (!initData || isDemo) return false
      const shownPeriod = requestPeriodOverride ?? dashboardQuery.data?.period
      if (shownPeriod && next.period !== shownPeriod) return false

      queryClient.setQueryData(
        miniAppQueryKeys.dashboard(initData, requestPeriodOverride, requestTodayOverride),
        next
      )
      return true
    },
    [
      initData,
      isDemo,
      queryClient,
      requestPeriodOverride,
      requestTodayOverride,
      dashboardQuery.data?.period
    ]
  )

  /* ── Derivations ── */

  const effectivePeriod = dashboard
    ? (derivedTestingPeriodOverride ?? demoDefaultPeriodOverride ?? dashboard.period)
    : null

  const testingOverridesActive = Boolean(
    normalizePeriodOverride(testingPeriodOverride) ?? testingTodayOverride
  )

  const currentMemberLine = useMemo(() => {
    if (!member || !dashboard) return null
    return dashboard.members.find((m) => m.memberId === member.id) ?? null
  }, [member, dashboard])

  const activePurchaseLedger = useMemo(
    () =>
      (dashboard?.ledger ?? []).filter(
        (entry) => entry.kind === 'purchase' && entry.resolutionStatus !== 'resolved'
      ),
    [dashboard]
  )

  /* Reset admin caches when admin access is toggled off via role preview */
  useEffect(() => {
    if (!adminEnabled && initData) {
      queryClient.removeQueries({ queryKey: miniAppQueryKeys.adminSettings(initData) })
      queryClient.removeQueries({ queryKey: miniAppQueryKeys.billingCycle(initData) })
      queryClient.removeQueries({ queryKey: miniAppQueryKeys.pendingMembers(initData) })
    }
  }, [adminEnabled, initData, queryClient])

  const value: DashboardContextValue = {
    dashboard,
    loading,
    error,
    refreshing,
    adminLoading,
    adminError,
    adminSettings,
    cycleState,
    pendingMembers,
    effectiveIsAdmin,
    currentMemberLine,
    activePurchaseLedger,
    testingRolePreview,
    setTestingRolePreview,
    demoScenario,
    setDemoScenario,
    testingPeriodOverride,
    setTestingPeriodOverride,
    testingTodayOverride,
    setTestingTodayOverride,
    effectivePeriod,
    effectiveTodayOverride,
    testingOverridesActive,
    refresh,
    applyDashboard
  }

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>
}

export function useDashboard(): DashboardContextValue {
  const context = useContext(DashboardContext)
  if (!context) {
    throw new Error('useDashboard must be used within a DashboardProvider')
  }
  return context
}
