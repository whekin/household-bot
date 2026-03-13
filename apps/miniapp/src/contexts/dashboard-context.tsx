import { createContext, createMemo, createSignal, useContext, type ParentProps } from 'solid-js'

import { majorStringToMinor, minorToMajorString } from '../lib/money'
import {
  fetchDashboardQuery,
  fetchAdminSettingsQuery,
  fetchBillingCycleQuery,
  fetchPendingMembersQuery
} from '../app/miniapp-queries'
import { absoluteMinor } from '../lib/ledger-helpers'
import type {
  MiniAppAdminCycleState,
  MiniAppAdminSettingsPayload,
  MiniAppDashboard,
  MiniAppPendingMember
} from '../miniapp-api'
import {
  demoAdminSettings,
  demoCycleState,
  demoDashboard,
  demoPendingMembers
} from '../demo/miniapp-demo'
import { useSession } from './session-context'
import { useI18n } from './i18n-context'

/* ── Types ──────────────────────────────────────────── */

export type TestingRolePreview = 'admin' | 'resident'

export type BillingFormState = {
  householdName: string
  settlementCurrency: 'USD' | 'GEL'
  paymentBalanceAdjustmentPolicy: 'utilities' | 'rent' | 'separate'
  rentAmountMajor: string
  rentCurrency: 'USD' | 'GEL'
  rentDueDay: number
  rentWarningDay: number
  utilitiesDueDay: number
  utilitiesReminderDay: number
  timezone: string
  assistantContext: string
  assistantTone: string
}

export type CycleFormState = {
  period: string
  rentCurrency: 'USD' | 'GEL'
  utilityCurrency: 'USD' | 'GEL'
  rentAmountMajor: string
  utilityCategorySlug: string
  utilityAmountMajor: string
}

const chartPalette = ['#3ecf8e', '#6fd3c0', '#94a8ff', '#f06a8d', '#f3d36f', '#7dc96d'] as const

type DashboardContextValue = {
  dashboard: () => MiniAppDashboard | null
  setDashboard: (
    value: MiniAppDashboard | null | ((prev: MiniAppDashboard | null) => MiniAppDashboard | null)
  ) => void
  adminSettings: () => MiniAppAdminSettingsPayload | null
  setAdminSettings: (
    value:
      | MiniAppAdminSettingsPayload
      | null
      | ((prev: MiniAppAdminSettingsPayload | null) => MiniAppAdminSettingsPayload | null)
  ) => void
  cycleState: () => MiniAppAdminCycleState | null
  setCycleState: (
    value:
      | MiniAppAdminCycleState
      | null
      | ((prev: MiniAppAdminCycleState | null) => MiniAppAdminCycleState | null)
  ) => void
  pendingMembers: () => readonly MiniAppPendingMember[]
  setPendingMembers: (
    value:
      | readonly MiniAppPendingMember[]
      | ((prev: readonly MiniAppPendingMember[]) => readonly MiniAppPendingMember[])
  ) => void
  effectiveIsAdmin: () => boolean
  currentMemberLine: () => MiniAppDashboard['members'][number] | null
  purchaseLedger: () => MiniAppDashboard['ledger'][number][]
  utilityLedger: () => MiniAppDashboard['ledger'][number][]
  paymentLedger: () => MiniAppDashboard['ledger'][number][]
  utilityTotalMajor: () => string
  purchaseTotalMajor: () => string
  memberBalanceVisuals: () => ReturnType<typeof computeMemberBalanceVisuals>
  purchaseInvestmentChart: () => ReturnType<typeof computePurchaseInvestmentChart>
  testingRolePreview: () => TestingRolePreview | null
  setTestingRolePreview: (value: TestingRolePreview | null) => void
  loadDashboardData: (initData: string, isAdmin: boolean) => Promise<void>
  applyDemoState: () => void
}

const DashboardContext = createContext<DashboardContextValue>()

/* ── Derived computations ───────────────────────────── */

function computeMemberBalanceVisuals(
  data: MiniAppDashboard | null,
  copyFn: () => { shareRent: string; shareUtilities: string; shareOffset: string }
) {
  if (!data) return []

  const copy = copyFn()
  const totals = data.members.map((member) => {
    const rentMinor = absoluteMinor(majorStringToMinor(member.rentShareMajor))
    const utilityMinor = absoluteMinor(majorStringToMinor(member.utilityShareMajor))
    const purchaseMinor = absoluteMinor(majorStringToMinor(member.purchaseOffsetMajor))

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
            majorStringToMinor(member.purchaseOffsetMajor) < 0n
              ? 'purchase-credit'
              : 'purchase-debit',
          label: copy.shareOffset,
          amountMajor: member.purchaseOffsetMajor,
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
  entries: MiniAppDashboard['ledger'][number][],
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

/* ── Provider ───────────────────────────────────────── */

export function DashboardProvider(props: ParentProps) {
  const { readySession } = useSession()
  const { copy } = useI18n()

  const [dashboard, setDashboard] = createSignal<MiniAppDashboard | null>(null)
  const [adminSettings, setAdminSettings] = createSignal<MiniAppAdminSettingsPayload | null>(null)
  const [cycleState, setCycleState] = createSignal<MiniAppAdminCycleState | null>(null)
  const [pendingMembers, setPendingMembers] = createSignal<readonly MiniAppPendingMember[]>([])
  const [testingRolePreview, setTestingRolePreview] = createSignal<TestingRolePreview | null>(null)

  const effectiveIsAdmin = createMemo(() => {
    const current = readySession()
    if (!current?.member.isAdmin) return false
    const preview = testingRolePreview()
    if (!preview) return true
    return preview === 'admin'
  })

  const currentMemberLine = createMemo(() => {
    const current = readySession()
    const data = dashboard()
    if (!current || !data) return null
    return data.members.find((m) => m.memberId === current.member.id) ?? null
  })

  const purchaseLedger = createMemo(() =>
    (dashboard()?.ledger ?? []).filter((e) => e.kind === 'purchase')
  )
  const utilityLedger = createMemo(() =>
    (dashboard()?.ledger ?? []).filter((e) => e.kind === 'utility')
  )
  const paymentLedger = createMemo(() =>
    (dashboard()?.ledger ?? []).filter((e) => e.kind === 'payment')
  )

  const utilityTotalMajor = createMemo(() =>
    minorToMajorString(
      utilityLedger().reduce((sum, e) => sum + majorStringToMinor(e.displayAmountMajor), 0n)
    )
  )
  const purchaseTotalMajor = createMemo(() =>
    minorToMajorString(
      purchaseLedger().reduce((sum, e) => sum + majorStringToMinor(e.displayAmountMajor), 0n)
    )
  )

  const memberBalanceVisuals = createMemo(() => computeMemberBalanceVisuals(dashboard(), copy))

  const purchaseInvestmentChart = createMemo(() =>
    computePurchaseInvestmentChart(dashboard(), purchaseLedger(), copy().ledgerActorFallback)
  )

  async function loadDashboardData(initData: string, isAdmin: boolean) {
    // In demo mode, use demo data
    if (!initData) {
      applyDemoState()
      return
    }

    try {
      const nextDashboard = await fetchDashboardQuery(initData)
      setDashboard(nextDashboard)
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('Failed to load mini app dashboard', error)
      }
      setDashboard(null)
    }

    if (isAdmin) {
      try {
        const [settings, cycle, pending] = await Promise.all([
          fetchAdminSettingsQuery(initData),
          fetchBillingCycleQuery(initData),
          fetchPendingMembersQuery(initData)
        ])
        setAdminSettings(settings)
        setCycleState(cycle)
        setPendingMembers(pending)
      } catch (error) {
        if (import.meta.env.DEV) {
          console.warn('Failed to load admin data', error)
        }
      }
    }
  }

  function applyDemoState() {
    setDashboard(demoDashboard)
    setPendingMembers([...demoPendingMembers])
    setAdminSettings(demoAdminSettings)
    setCycleState(demoCycleState)
  }

  return (
    <DashboardContext.Provider
      value={{
        dashboard,
        setDashboard,
        adminSettings,
        setAdminSettings,
        cycleState,
        setCycleState,
        pendingMembers,
        setPendingMembers,
        effectiveIsAdmin,
        currentMemberLine,
        purchaseLedger,
        utilityLedger,
        paymentLedger,
        utilityTotalMajor,
        purchaseTotalMajor,
        memberBalanceVisuals,
        purchaseInvestmentChart,
        testingRolePreview,
        setTestingRolePreview,
        loadDashboardData,
        applyDemoState
      }}
    >
      {props.children}
    </DashboardContext.Provider>
  )
}

export function useDashboard(): DashboardContextValue {
  const context = useContext(DashboardContext)
  if (!context) {
    throw new Error('useDashboard must be used within a DashboardProvider')
  }
  return context
}
