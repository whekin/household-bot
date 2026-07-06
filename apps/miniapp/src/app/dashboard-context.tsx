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
import { computeEffectiveBillingStage } from '@/lib/billing-stage'
import { hasEffectiveAdminAccess } from '@/lib/admin-access'
import { majorStringToMinor, minorToMajorString } from '@/lib/money'
import { absoluteMinor, memberEffectivePurchaseBalanceMajor } from '@/lib/ledger-helpers'
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
import {
  getDemoScenarioDefaultToday,
  getDemoScenarioState,
  type DemoScenarioId
} from '@/demo/miniapp-demo'
import { useI18n } from '@/i18n/context'
import { useSession } from './session-context'

/* ── Types ──────────────────────────────────────────── */

export type TestingRolePreview = 'admin' | 'resident'

type LedgerEntry = MiniAppDashboard['ledger'][number]
type MemberLine = MiniAppDashboard['members'][number]

export interface MemberBalanceItem {
  member: MemberLine
  amountMajor: string
  amountMinor: bigint
  isCredit: boolean
}

const chartPalette = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  'var(--color-chart-4)',
  'var(--color-chart-5)',
  'var(--color-chart-6)'
] as const

type DashboardContextValue = {
  dashboard: MiniAppDashboard | null
  loading: boolean
  refreshing: boolean
  adminSettings: MiniAppAdminSettingsPayload | null
  cycleState: MiniAppAdminCycleState | null
  pendingMembers: readonly MiniAppPendingMember[]
  effectiveIsAdmin: boolean
  currentMemberLine: MemberLine | null
  purchaseLedger: LedgerEntry[]
  currentCyclePurchaseLedger: LedgerEntry[]
  activePurchaseLedger: LedgerEntry[]
  resolvedPurchaseLedger: LedgerEntry[]
  utilityLedger: LedgerEntry[]
  paymentLedger: LedgerEntry[]
  utilityTotalMajor: string
  purchaseTotalMajor: string
  memberBalanceVisuals: ReturnType<typeof computeMemberBalanceVisuals>
  purchaseInvestmentChart: ReturnType<typeof computePurchaseInvestmentChart>
  memberPurchaseBalanceVisuals: MemberBalanceItem[]
  memberUtilityBalanceVisuals: MemberBalanceItem[]
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
  effectiveBillingStage: 'utilities' | 'rent' | 'idle'
  testingOverridesActive: boolean
  refresh: () => Promise<void>
}

const DashboardContext = createContext<DashboardContextValue | null>(null)

/* ── Derived computations (pure) ────────────────────── */

function computeMemberBalanceVisuals(
  data: MiniAppDashboard | null,
  copy: { shareRent: string; shareUtilities: string; shareOffset: string }
) {
  if (!data) return []

  const totals = data.members.map((member) => {
    const rentMinor = absoluteMinor(majorStringToMinor(member.rentShareMajor))
    const utilityMinor = absoluteMinor(majorStringToMinor(member.utilityShareMajor))
    const purchaseMinor = absoluteMinor(
      majorStringToMinor(memberEffectivePurchaseBalanceMajor(member))
    )

    return {
      member,
      totalMinor: rentMinor + utilityMinor + purchaseMinor,
      segments: [
        {
          key: 'rent',
          label: copy.shareRent,
          amountMajor: member.rentShareMajor,
          amountMinor: rentMinor
        },
        {
          key: 'utilities',
          label: copy.shareUtilities,
          amountMajor: member.utilityShareMajor,
          amountMinor: utilityMinor
        },
        {
          key:
            majorStringToMinor(memberEffectivePurchaseBalanceMajor(member)) < 0n
              ? 'purchase-credit'
              : 'purchase-debit',
          label: copy.shareOffset,
          amountMajor: memberEffectivePurchaseBalanceMajor(member),
          amountMinor: purchaseMinor
        }
      ]
    }
  })

  const maxTotalMinor = totals.reduce(
    (max, item) => (item.totalMinor > max ? item.totalMinor : max),
    0n
  )

  return totals
    .sort((left, right) => {
      const leftRemaining = majorStringToMinor(left.member.remainingMajor)
      const rightRemaining = majorStringToMinor(right.member.remainingMajor)
      if (rightRemaining === leftRemaining) {
        return left.member.displayName.localeCompare(right.member.displayName)
      }
      return rightRemaining > leftRemaining ? 1 : -1
    })
    .map((item) => ({
      ...item,
      barWidthPercent:
        maxTotalMinor > 0n ? (Number(item.totalMinor) / Number(maxTotalMinor)) * 100 : 0,
      segments: item.segments.map((segment) => ({
        ...segment,
        widthPercent:
          item.totalMinor > 0n ? (Number(segment.amountMinor) / Number(item.totalMinor)) * 100 : 0
      }))
    }))
}

function computePurchaseInvestmentChart(
  data: MiniAppDashboard | null,
  entries: LedgerEntry[],
  fallbackLabel: string
) {
  if (!data) {
    return { totalMajor: '0.00', slices: [] }
  }

  const membersById = new Map(data.members.map((member) => [member.memberId, member.displayName]))
  const totals = new Map<string, { label: string; amountMinor: bigint }>()

  for (const entry of entries) {
    const key = entry.memberId ?? entry.actorDisplayName ?? entry.id
    const label =
      (entry.memberId ? membersById.get(entry.memberId) : null) ??
      entry.actorDisplayName ??
      fallbackLabel
    const current = totals.get(key) ?? { label, amountMinor: 0n }
    totals.set(key, {
      label,
      amountMinor: current.amountMinor + absoluteMinor(majorStringToMinor(entry.displayAmountMajor))
    })
  }

  const items = [...totals.entries()]
    .map(([key, value], index) => ({
      key,
      label: value.label,
      amountMinor: value.amountMinor,
      amountMajor: minorToMajorString(value.amountMinor),
      color: chartPalette[index % chartPalette.length]!
    }))
    .filter((item) => item.amountMinor > 0n)
    .sort((left, right) => (right.amountMinor > left.amountMinor ? 1 : -1))

  const totalMinor = items.reduce((sum, item) => sum + item.amountMinor, 0n)
  const circumference = 2 * Math.PI * 42
  let offset = 0

  return {
    totalMajor: minorToMajorString(totalMinor),
    slices: items.map((item) => {
      const ratio = totalMinor > 0n ? Number(item.amountMinor) / Number(totalMinor) : 0
      const dash = ratio * circumference
      const slice = {
        ...item,
        percentage: Math.round(ratio * 100),
        dasharray: `${dash} ${Math.max(circumference - dash, 0)}`,
        dashoffset: `${-offset}`
      }
      offset += dash
      return slice
    })
  }
}

function computeMemberPurchaseBalanceVisuals(data: MiniAppDashboard | null): MemberBalanceItem[] {
  if (!data) return []

  return data.members
    .map((member) => ({
      member,
      amountMajor: memberEffectivePurchaseBalanceMajor(member),
      amountMinor: absoluteMinor(majorStringToMinor(memberEffectivePurchaseBalanceMajor(member))),
      isCredit: majorStringToMinor(memberEffectivePurchaseBalanceMajor(member)) < 0n
    }))
    .sort((left, right) => {
      if (right.amountMinor === left.amountMinor) {
        return left.member.displayName.localeCompare(right.member.displayName)
      }
      return right.amountMinor > left.amountMinor ? 1 : -1
    })
}

function computeMemberUtilityBalanceVisuals(data: MiniAppDashboard | null): MemberBalanceItem[] {
  if (!data) return []

  return data.members
    .map((member) => ({
      member,
      amountMajor: member.utilityShareMajor,
      amountMinor: absoluteMinor(majorStringToMinor(member.utilityShareMajor)),
      isCredit: false
    }))
    .sort((left, right) => {
      if (right.amountMinor === left.amountMinor) {
        return left.member.displayName.localeCompare(right.member.displayName)
      }
      return right.amountMinor > left.amountMinor ? 1 : -1
    })
}

function periodFromCalendarValue(value: string | null | undefined): string | null {
  const parsed = value ? parseCalendarDate(value) : null
  if (!parsed) return null

  return `${String(parsed.year).padStart(4, '0')}-${String(parsed.month).padStart(2, '0')}`
}

/* ── Provider ───────────────────────────────────────── */

export function DashboardProvider({ children }: { children: ReactNode }) {
  const { readySession, initData, handleMiniAppRequestError } = useSession()
  const { copy } = useI18n()
  const queryClient = useQueryClient()

  const [testingRolePreview, setTestingRolePreview] = useState<TestingRolePreview | null>(null)
  const [demoScenario, setDemoScenario] = useState<DemoScenarioId>('current-cycle')
  const [testingPeriodOverride, setTestingPeriodOverride] = useState<string | null>(null)
  const [testingTodayOverride, setTestingTodayOverride] = useState<string | null>(null)

  const isDemo = readySession?.mode === 'demo' || !initData
  const member = readySession?.member ?? null

  const derivedTestingPeriodOverride =
    normalizePeriodOverride(testingPeriodOverride) ?? periodFromCalendarValue(testingTodayOverride)

  const demoDefaultTodayOverride = isDemo
    ? getDemoScenarioDefaultToday(demoScenario, derivedTestingPeriodOverride)
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
        ? getDemoScenarioState(demoScenario, {
            periodOverride: requestPeriodOverride,
            todayOverride: requestTodayOverride
          })
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
    enabled: adminEnabled
  })
  const cycleStateQuery = useQuery({
    queryKey: miniAppQueryKeys.billingCycle(initData ?? ''),
    queryFn: () => fetchMiniAppBillingCycle(initData ?? ''),
    enabled: adminEnabled
  })
  const pendingMembersQuery = useQuery({
    queryKey: miniAppQueryKeys.pendingMembers(initData ?? ''),
    queryFn: () => fetchMiniAppPendingMembers(initData ?? ''),
    enabled: adminEnabled
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
  const refreshing = !isDemo && !dashboardQuery.isPending && dashboardQuery.isFetching

  const refresh = useCallback(async () => {
    if (!initData) return
    await invalidateHouseholdQueries(initData)
  }, [initData])

  /* ── Derivations ── */

  const effectivePeriod = dashboard
    ? (derivedTestingPeriodOverride ?? demoDefaultPeriodOverride ?? dashboard.period)
    : null

  const effectiveBillingStage = useMemo(
    () =>
      computeEffectiveBillingStage({
        dashboard,
        period: effectivePeriod,
        todayOverride: effectiveTodayOverride,
        preferTimelineWindow: testingTodayOverride !== null
      }),
    [dashboard, effectivePeriod, effectiveTodayOverride, testingTodayOverride]
  )

  const testingOverridesActive = Boolean(
    normalizePeriodOverride(testingPeriodOverride) ?? testingTodayOverride
  )

  const currentMemberLine = useMemo(() => {
    if (!member || !dashboard) return null
    return dashboard.members.find((m) => m.memberId === member.id) ?? null
  }, [member, dashboard])

  const ledger = useMemo(() => dashboard?.ledger ?? [], [dashboard])
  const purchaseLedger = useMemo(() => ledger.filter((e) => e.kind === 'purchase'), [ledger])
  const currentCyclePurchaseLedger = useMemo(
    () => purchaseLedger.filter((entry) => entry.isCurrentCyclePurchase === true),
    [purchaseLedger]
  )
  const activePurchaseLedger = useMemo(
    () => purchaseLedger.filter((entry) => entry.resolutionStatus !== 'resolved'),
    [purchaseLedger]
  )
  const resolvedPurchaseLedger = useMemo(
    () => purchaseLedger.filter((entry) => entry.resolutionStatus === 'resolved'),
    [purchaseLedger]
  )
  const utilityLedger = useMemo(() => ledger.filter((e) => e.kind === 'utility'), [ledger])
  const paymentLedger = useMemo(() => ledger.filter((e) => e.kind === 'payment'), [ledger])

  const utilityTotalMajor = useMemo(
    () =>
      minorToMajorString(
        utilityLedger.reduce((sum, e) => sum + majorStringToMinor(e.displayAmountMajor), 0n)
      ),
    [utilityLedger]
  )
  const purchaseTotalMajor = useMemo(
    () =>
      minorToMajorString(
        currentCyclePurchaseLedger.reduce(
          (sum, e) => sum + majorStringToMinor(e.displayAmountMajor),
          0n
        )
      ),
    [currentCyclePurchaseLedger]
  )

  const memberBalanceVisuals = useMemo(
    () =>
      computeMemberBalanceVisuals(dashboard, {
        shareRent: copy.shareRent,
        shareUtilities: copy.shareUtilities,
        shareOffset: copy.shareOffset
      }),
    [dashboard, copy]
  )
  const purchaseInvestmentChart = useMemo(
    () =>
      computePurchaseInvestmentChart(
        dashboard,
        currentCyclePurchaseLedger,
        copy.ledgerActorFallback
      ),
    [dashboard, currentCyclePurchaseLedger, copy]
  )
  const memberPurchaseBalanceVisuals = useMemo(
    () => computeMemberPurchaseBalanceVisuals(dashboard),
    [dashboard]
  )
  const memberUtilityBalanceVisuals = useMemo(
    () => computeMemberUtilityBalanceVisuals(dashboard),
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
    refreshing,
    adminSettings,
    cycleState,
    pendingMembers,
    effectiveIsAdmin,
    currentMemberLine,
    purchaseLedger,
    currentCyclePurchaseLedger,
    activePurchaseLedger,
    resolvedPurchaseLedger,
    utilityLedger,
    paymentLedger,
    utilityTotalMajor,
    purchaseTotalMajor,
    memberBalanceVisuals,
    purchaseInvestmentChart,
    memberPurchaseBalanceVisuals,
    memberUtilityBalanceVisuals,
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
    effectiveBillingStage,
    testingOverridesActive,
    refresh
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
