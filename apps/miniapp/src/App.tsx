import { Match, Show, Switch, createMemo, createSignal, onMount } from 'solid-js'

import { dictionary, type Locale } from './i18n'
import { majorStringToMinor, minorToMajorString } from './lib/money'
import {
  fetchAdminSettingsQuery,
  fetchBillingCycleQuery,
  fetchDashboardQuery,
  fetchPendingMembersQuery,
  fetchSessionQuery,
  invalidateHouseholdQueries
} from './app/miniapp-queries'
import {
  addMiniAppUtilityBill,
  addMiniAppPayment,
  approveMiniAppPendingMember,
  deleteMiniAppPayment,
  deleteMiniAppPurchase,
  deleteMiniAppUtilityBill,
  joinMiniAppHousehold,
  openMiniAppBillingCycle,
  promoteMiniAppMember,
  updateMiniAppMemberDisplayName,
  updateMiniAppMemberAbsencePolicy,
  updateMiniAppMemberStatus,
  updateMiniAppMemberRentWeight,
  updateMiniAppOwnDisplayName,
  type MiniAppAdminCycleState,
  type MiniAppAdminSettingsPayload,
  type MiniAppMemberAbsencePolicy,
  updateMiniAppLocalePreference,
  updateMiniAppBillingSettings,
  updateMiniAppCycleRent,
  updateMiniAppPayment,
  updateMiniAppPurchase,
  upsertMiniAppUtilityCategory,
  updateMiniAppUtilityBill,
  type MiniAppDashboard,
  type MiniAppPendingMember
} from './miniapp-api'
import {
  Button,
  Field,
  HomeIcon,
  HouseIcon,
  MiniChip,
  Modal,
  ReceiptIcon,
  WalletIcon
} from './components/ui'
import { NavigationTabs } from './components/layout/navigation-tabs'
import { TopBar } from './components/layout/top-bar'
import { BlockedState } from './components/session/blocked-state'
import { LoadingState } from './components/session/loading-state'
import { OnboardingState } from './components/session/onboarding-state'
import { BalancesScreen } from './screens/balances-screen'
import { HomeScreen } from './screens/home-screen'
import { HouseScreen } from './screens/house-screen'
import { LedgerScreen } from './screens/ledger-screen'
import {
  demoAdminSettings,
  demoCycleState,
  demoDashboard,
  demoMember,
  demoPendingMembers,
  demoTelegramUser
} from './demo/miniapp-demo'
import { getTelegramWebApp } from './telegram-webapp'

type SessionState =
  | {
      status: 'loading'
    }
  | {
      status: 'blocked'
      reason: 'telegram_only' | 'error'
    }
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

type NavigationKey = 'home' | 'balances' | 'ledger' | 'house'

const chartPalette = ['#f7b389', '#6fd3c0', '#f06a8d', '#94a8ff', '#f3d36f', '#7dc96d'] as const

type UtilityBillDraft = {
  billName: string
  amountMajor: string
  currency: 'USD' | 'GEL'
}

type PurchaseDraft = {
  description: string
  amountMajor: string
  currency: 'USD' | 'GEL'
  splitMode: 'equal' | 'custom_amounts'
  participants: {
    memberId: string
    shareAmountMajor: string
  }[]
}

type PaymentDraft = {
  memberId: string
  kind: 'rent' | 'utilities'
  amountMajor: string
  currency: 'USD' | 'GEL'
}

type TestingRolePreview = 'admin' | 'resident'

const TESTING_ROLE_TAP_WINDOW_MS = 30 * 60 * 1000

const demoSession: Extract<SessionState, { status: 'ready' }> = {
  status: 'ready',
  mode: 'demo',
  member: demoMember,
  telegramUser: demoTelegramUser
}

function detectLocale(): Locale {
  const telegramLocale = getTelegramWebApp()?.initDataUnsafe?.user?.language_code
  const browserLocale = navigator.language.toLowerCase()

  return (telegramLocale ?? browserLocale).startsWith('ru') ? 'ru' : 'en'
}

function joinContext(): {
  joinToken?: string
  botUsername?: string
} {
  if (typeof window === 'undefined') {
    return {}
  }

  const params = new URLSearchParams(window.location.search)
  const joinToken = params.get('join')?.trim()
  const botUsername = params.get('bot')?.trim()

  return {
    ...(joinToken
      ? {
          joinToken
        }
      : {}),
    ...(botUsername
      ? {
          botUsername
        }
      : {})
  }
}

function joinDeepLink(): string | null {
  const context = joinContext()
  if (!context.botUsername || !context.joinToken) {
    return null
  }

  return `https://t.me/${context.botUsername}?start=join_${encodeURIComponent(context.joinToken)}`
}

function defaultCyclePeriod(): string {
  return new Date().toISOString().slice(0, 7)
}

function absoluteMinor(value: bigint): bigint {
  return value < 0n ? -value : value
}

function memberBaseDueMajor(member: MiniAppDashboard['members'][number]): string {
  return minorToMajorString(
    majorStringToMinor(member.rentShareMajor) + majorStringToMinor(member.utilityShareMajor)
  )
}

function memberRemainingClass(member: MiniAppDashboard['members'][number]): string {
  const remainingMinor = majorStringToMinor(member.remainingMajor)

  if (remainingMinor < 0n) {
    return 'is-credit'
  }

  if (remainingMinor === 0n) {
    return 'is-settled'
  }

  return 'is-due'
}

function ledgerPrimaryAmount(entry: MiniAppDashboard['ledger'][number]): string {
  return `${entry.displayAmountMajor} ${entry.displayCurrency}`
}

function ledgerSecondaryAmount(entry: MiniAppDashboard['ledger'][number]): string | null {
  if (entry.currency === entry.displayCurrency && entry.amountMajor === entry.displayAmountMajor) {
    return null
  }

  return `${entry.amountMajor} ${entry.currency}`
}

function cycleUtilityBillDrafts(
  bills: MiniAppAdminCycleState['utilityBills']
): Record<string, UtilityBillDraft> {
  return Object.fromEntries(
    bills.map((bill) => [
      bill.id,
      {
        billName: bill.billName,
        amountMajor: minorToMajorString(BigInt(bill.amountMinor)),
        currency: bill.currency
      }
    ])
  )
}

function purchaseDrafts(
  entries: readonly MiniAppDashboard['ledger'][number][]
): Record<string, PurchaseDraft> {
  return Object.fromEntries(
    entries
      .filter((entry) => entry.kind === 'purchase')
      .map((entry) => [
        entry.id,
        {
          description: entry.title,
          amountMajor: entry.amountMajor,
          currency: entry.currency,
          splitMode: entry.purchaseSplitMode ?? 'equal',
          participants:
            entry.purchaseParticipants
              ?.filter((participant) => participant.included)
              .map((participant) => ({
                memberId: participant.memberId,
                shareAmountMajor: participant.shareAmountMajor ?? ''
              })) ?? []
        }
      ])
  )
}

function purchaseDraftForEntry(entry: MiniAppDashboard['ledger'][number]): PurchaseDraft {
  return {
    description: entry.title,
    amountMajor: entry.amountMajor,
    currency: entry.currency,
    splitMode: entry.purchaseSplitMode ?? 'equal',
    participants:
      entry.purchaseParticipants
        ?.filter((participant) => participant.included)
        .map((participant) => ({
          memberId: participant.memberId,
          shareAmountMajor: participant.shareAmountMajor ?? ''
        })) ?? []
  }
}

function paymentDrafts(
  entries: readonly MiniAppDashboard['ledger'][number][]
): Record<string, PaymentDraft> {
  return Object.fromEntries(
    entries
      .filter((entry) => entry.kind === 'payment')
      .map((entry) => [
        entry.id,
        {
          memberId: entry.memberId ?? '',
          kind: entry.paymentKind ?? 'rent',
          amountMajor: entry.amountMajor,
          currency: entry.currency
        }
      ])
  )
}

function paymentDraftForEntry(entry: MiniAppDashboard['ledger'][number]): PaymentDraft {
  return {
    memberId: entry.memberId ?? '',
    kind: entry.paymentKind ?? 'rent',
    amountMajor: entry.amountMajor,
    currency: entry.currency
  }
}

function App() {
  const [locale, setLocale] = createSignal<Locale>('en')
  const [session, setSession] = createSignal<SessionState>({
    status: 'loading'
  })
  const [activeNav, setActiveNav] = createSignal<NavigationKey>('home')
  const [dashboard, setDashboard] = createSignal<MiniAppDashboard | null>(null)
  const [pendingMembers, setPendingMembers] = createSignal<readonly MiniAppPendingMember[]>([])
  const [adminSettings, setAdminSettings] = createSignal<MiniAppAdminSettingsPayload | null>(null)
  const [cycleState, setCycleState] = createSignal<MiniAppAdminCycleState | null>(null)
  const [joining, setJoining] = createSignal(false)
  const [approvingTelegramUserId, setApprovingTelegramUserId] = createSignal<string | null>(null)
  const [promotingMemberId, setPromotingMemberId] = createSignal<string | null>(null)
  const [savingOwnDisplayName, setSavingOwnDisplayName] = createSignal(false)
  const [, setSavingMemberDisplayNameId] = createSignal<string | null>(null)
  const [, setSavingRentWeightMemberId] = createSignal<string | null>(null)
  const [, setSavingMemberStatusId] = createSignal<string | null>(null)
  const [, setSavingMemberAbsencePolicyId] = createSignal<string | null>(null)
  const [savingMemberEditorId, setSavingMemberEditorId] = createSignal<string | null>(null)
  const [displayNameDraft, setDisplayNameDraft] = createSignal('')
  const [memberDisplayNameDrafts, setMemberDisplayNameDrafts] = createSignal<
    Record<string, string>
  >({})
  const [rentWeightDrafts, setRentWeightDrafts] = createSignal<Record<string, string>>({})
  const [memberStatusDrafts, setMemberStatusDrafts] = createSignal<
    Record<string, 'active' | 'away' | 'left'>
  >({})
  const [memberAbsencePolicyDrafts, setMemberAbsencePolicyDrafts] = createSignal<
    Record<string, MiniAppMemberAbsencePolicy>
  >({})
  const [savingMemberLocale, setSavingMemberLocale] = createSignal(false)
  const [savingHouseholdLocale, setSavingHouseholdLocale] = createSignal(false)
  const [savingBillingSettings, setSavingBillingSettings] = createSignal(false)
  const [savingCategorySlug, setSavingCategorySlug] = createSignal<string | null>(null)
  const [openingCycle, setOpeningCycle] = createSignal(false)
  const [savingCycleRent, setSavingCycleRent] = createSignal(false)
  const [savingUtilityBill, setSavingUtilityBill] = createSignal(false)
  const [savingUtilityBillId, setSavingUtilityBillId] = createSignal<string | null>(null)
  const [deletingUtilityBillId, setDeletingUtilityBillId] = createSignal<string | null>(null)
  const [utilityBillDrafts, setUtilityBillDrafts] = createSignal<Record<string, UtilityBillDraft>>(
    {}
  )
  const [purchaseDraftMap, setPurchaseDraftMap] = createSignal<Record<string, PurchaseDraft>>({})
  const [paymentDraftMap, setPaymentDraftMap] = createSignal<Record<string, PaymentDraft>>({})
  const [savingPurchaseId, setSavingPurchaseId] = createSignal<string | null>(null)
  const [deletingPurchaseId, setDeletingPurchaseId] = createSignal<string | null>(null)
  const [savingPaymentId, setSavingPaymentId] = createSignal<string | null>(null)
  const [deletingPaymentId, setDeletingPaymentId] = createSignal<string | null>(null)
  const [editingPurchaseId, setEditingPurchaseId] = createSignal<string | null>(null)
  const [editingPaymentId, setEditingPaymentId] = createSignal<string | null>(null)
  const [editingUtilityBillId, setEditingUtilityBillId] = createSignal<string | null>(null)
  const [editingMemberId, setEditingMemberId] = createSignal<string | null>(null)
  const [editingCategorySlug, setEditingCategorySlug] = createSignal<string | null>(null)
  const [editingCategoryDraft, setEditingCategoryDraft] = createSignal<{
    name: string
    isActive: boolean
  } | null>(null)
  const [billingSettingsOpen, setBillingSettingsOpen] = createSignal(false)
  const [cycleRentOpen, setCycleRentOpen] = createSignal(false)
  const [addingUtilityBillOpen, setAddingUtilityBillOpen] = createSignal(false)
  const [addingPaymentOpen, setAddingPaymentOpen] = createSignal(false)
  const [profileEditorOpen, setProfileEditorOpen] = createSignal(false)
  const [testingSurfaceOpen, setTestingSurfaceOpen] = createSignal(false)
  const [roleChipTapHistory, setRoleChipTapHistory] = createSignal<number[]>([])
  const [testingRolePreview, setTestingRolePreview] = createSignal<TestingRolePreview | null>(null)
  const [addingPayment, setAddingPayment] = createSignal(false)
  const [billingForm, setBillingForm] = createSignal({
    householdName: '',
    settlementCurrency: 'GEL' as 'USD' | 'GEL',
    paymentBalanceAdjustmentPolicy: 'utilities' as 'utilities' | 'rent' | 'separate',
    rentAmountMajor: '',
    rentCurrency: 'USD' as 'USD' | 'GEL',
    rentDueDay: 20,
    rentWarningDay: 17,
    utilitiesDueDay: 4,
    utilitiesReminderDay: 3,
    timezone: 'Asia/Tbilisi',
    assistantContext: '',
    assistantTone: ''
  })
  const [newCategoryName, setNewCategoryName] = createSignal('')
  const [cycleForm, setCycleForm] = createSignal({
    period: defaultCyclePeriod(),
    rentCurrency: 'USD' as 'USD' | 'GEL',
    utilityCurrency: 'GEL' as 'USD' | 'GEL',
    rentAmountMajor: '',
    utilityCategorySlug: '',
    utilityAmountMajor: ''
  })
  const [paymentForm, setPaymentForm] = createSignal<PaymentDraft>({
    memberId: '',
    kind: 'rent',
    amountMajor: '',
    currency: 'GEL'
  })

  const copy = createMemo(() => dictionary[locale()])
  const onboardingSession = createMemo(() => {
    const current = session()
    return current.status === 'onboarding' ? current : null
  })
  const blockedSession = createMemo(() => {
    const current = session()
    return current.status === 'blocked' ? current : null
  })
  const readySession = createMemo(() => {
    const current = session()
    return current.status === 'ready' ? current : null
  })
  const effectiveIsAdmin = createMemo(() => {
    const current = readySession()
    if (!current) {
      return false
    }

    if (!current.member.isAdmin) {
      return false
    }

    const preview = testingRolePreview()
    if (!preview) {
      return true
    }

    return preview === 'admin'
  })
  const currentMemberLine = createMemo(() => {
    const current = readySession()
    const data = dashboard()

    if (!current || !data) {
      return null
    }

    return data.members.find((member) => member.memberId === current.member.id) ?? null
  })
  const purchaseLedger = createMemo(() =>
    (dashboard()?.ledger ?? []).filter((entry) => entry.kind === 'purchase')
  )
  const utilityLedger = createMemo(() =>
    (dashboard()?.ledger ?? []).filter((entry) => entry.kind === 'utility')
  )
  const paymentLedger = createMemo(() =>
    (dashboard()?.ledger ?? []).filter((entry) => entry.kind === 'payment')
  )
  const editingPurchaseEntry = createMemo(
    () => purchaseLedger().find((entry) => entry.id === editingPurchaseId()) ?? null
  )
  const editingPaymentEntry = createMemo(
    () => paymentLedger().find((entry) => entry.id === editingPaymentId()) ?? null
  )
  const defaultPaymentMemberId = createMemo(() => adminSettings()?.members[0]?.id ?? '')
  const editingUtilityBill = createMemo(
    () => cycleState()?.utilityBills.find((bill) => bill.id === editingUtilityBillId()) ?? null
  )
  const editingMember = createMemo(
    () => adminSettings()?.members.find((member) => member.id === editingMemberId()) ?? null
  )
  const editingCategory = createMemo(
    () =>
      adminSettings()?.categories.find((category) => category.slug === editingCategorySlug()) ??
      null
  )
  const utilityTotalMajor = createMemo(() =>
    minorToMajorString(
      utilityLedger().reduce((sum, entry) => sum + majorStringToMinor(entry.displayAmountMajor), 0n)
    )
  )
  const purchaseTotalMajor = createMemo(() =>
    minorToMajorString(
      purchaseLedger().reduce(
        (sum, entry) => sum + majorStringToMinor(entry.displayAmountMajor),
        0n
      )
    )
  )
  const memberBalanceVisuals = createMemo(() => {
    const data = dashboard()
    if (!data) {
      return []
    }

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
            label: copy().shareRent,
            amountMajor: member.rentShareMajor,
            amountMinor: rentMinor
          },
          {
            key: 'utilities',
            label: copy().shareUtilities,
            amountMajor: member.utilityShareMajor,
            amountMinor: utilityMinor
          },
          {
            key:
              majorStringToMinor(member.purchaseOffsetMajor) < 0n
                ? 'purchase-credit'
                : 'purchase-debit',
            label: copy().shareOffset,
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
  })
  const purchaseInvestmentChart = createMemo(() => {
    const data = dashboard()
    if (!data) {
      return {
        totalMajor: '0.00',
        slices: []
      }
    }

    const membersById = new Map(data.members.map((member) => [member.memberId, member.displayName]))
    const totals = new Map<string, { label: string; amountMinor: bigint }>()

    for (const entry of purchaseLedger()) {
      const key = entry.memberId ?? entry.actorDisplayName ?? entry.id
      const label =
        (entry.memberId ? membersById.get(entry.memberId) : null) ??
        entry.actorDisplayName ??
        copy().ledgerActorFallback
      const current = totals.get(key) ?? {
        label,
        amountMinor: 0n
      }

      totals.set(key, {
        label,
        amountMinor:
          current.amountMinor + absoluteMinor(majorStringToMinor(entry.displayAmountMajor))
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
  })
  const webApp = getTelegramWebApp()

  function ledgerTitle(entry: MiniAppDashboard['ledger'][number]): string {
    if (entry.kind !== 'payment') {
      return entry.title
    }

    return entry.paymentKind === 'utilities'
      ? copy().paymentLedgerUtilities
      : copy().paymentLedgerRent
  }

  function purchaseParticipantSummary(entry: MiniAppDashboard['ledger'][number]): string {
    if (entry.kind !== 'purchase') {
      return ''
    }

    const includedCount =
      entry.purchaseParticipants?.filter((participant) => participant.included).length ?? 0
    const splitLabel =
      entry.purchaseSplitMode === 'custom_amounts'
        ? copy().purchaseSplitCustom
        : copy().purchaseSplitEqual

    return `${includedCount} ${copy().participantsLabel} · ${splitLabel}`
  }

  function paymentMemberName(entry: MiniAppDashboard['ledger'][number]): string {
    if (!entry.memberId) {
      return entry.actorDisplayName ?? copy().ledgerActorFallback
    }

    return (
      adminSettings()?.members.find((member) => member.id === entry.memberId)?.displayName ??
      dashboard()?.members.find((member) => member.memberId === entry.memberId)?.displayName ??
      entry.actorDisplayName ??
      copy().ledgerActorFallback
    )
  }

  function topicRoleLabel(role: 'purchase' | 'feedback' | 'reminders' | 'payments'): string {
    switch (role) {
      case 'purchase':
        return copy().topicPurchase
      case 'feedback':
        return copy().topicFeedback
      case 'reminders':
        return copy().topicReminders
      case 'payments':
        return copy().topicPayments
    }
  }

  function memberStatusLabel(status: 'active' | 'away' | 'left'): string {
    switch (status) {
      case 'active':
        return copy().memberStatusActive
      case 'away':
        return copy().memberStatusAway
      case 'left':
        return copy().memberStatusLeft
    }
  }

  function handleRoleChipTap() {
    const currentReady = readySession()
    if (!currentReady?.member.isAdmin) {
      return
    }

    const now = Date.now()
    const nextHistory = [
      ...roleChipTapHistory().filter((timestamp) => now - timestamp < TESTING_ROLE_TAP_WINDOW_MS),
      now
    ]

    if (nextHistory.length >= 5) {
      setRoleChipTapHistory([])
      setTestingSurfaceOpen(true)
      return
    }

    setRoleChipTapHistory(nextHistory)
  }

  function defaultAbsencePolicyForStatus(
    status: 'active' | 'away' | 'left'
  ): MiniAppMemberAbsencePolicy {
    if (status === 'away') {
      return 'away_rent_and_utilities'
    }

    if (status === 'left') {
      return 'inactive'
    }

    return 'resident'
  }

  function resolvedMemberAbsencePolicy(
    memberId: string,
    status: 'active' | 'away' | 'left',
    settings = adminSettings()
  ) {
    const current = settings?.memberAbsencePolicies
      .filter((policy) => policy.memberId === memberId)
      .sort((left, right) => left.effectiveFromPeriod.localeCompare(right.effectiveFromPeriod))
      .at(-1)

    return (
      current ?? {
        memberId,
        effectiveFromPeriod: '',
        policy: defaultAbsencePolicyForStatus(status)
      }
    )
  }

  function syncDisplayName(memberId: string, displayName: string) {
    setSession((current) =>
      current.status === 'ready' && current.member.id === memberId
        ? {
            ...current,
            member: {
              ...current.member,
              displayName
            }
          }
        : current
    )
    setAdminSettings((current) =>
      current
        ? {
            ...current,
            members: current.members.map((member) =>
              member.id === memberId
                ? {
                    ...member,
                    displayName
                  }
                : member
            )
          }
        : current
    )
    setDashboard((current) =>
      current
        ? {
            ...current,
            members: current.members.map((member) =>
              member.memberId === memberId
                ? {
                    ...member,
                    displayName
                  }
                : member
            ),
            ledger: current.ledger.map((entry) =>
              entry.memberId === memberId
                ? {
                    ...entry,
                    actorDisplayName: displayName
                  }
                : entry
            )
          }
        : current
    )
    setDisplayNameDraft((current) =>
      readySession()?.member.id === memberId ? displayName : current
    )
    setMemberDisplayNameDrafts((current) => ({
      ...current,
      [memberId]: displayName
    }))
  }

  function updatePurchaseDraft(
    purchaseId: string,
    entry: MiniAppDashboard['ledger'][number],
    update: (draft: PurchaseDraft) => PurchaseDraft
  ) {
    setPurchaseDraftMap((current) => {
      const draft = current[purchaseId] ?? purchaseDraftForEntry(entry)
      return {
        ...current,
        [purchaseId]: update(draft)
      }
    })
  }

  function updatePaymentDraft(
    paymentId: string,
    entry: MiniAppDashboard['ledger'][number],
    update: (draft: PaymentDraft) => PaymentDraft
  ) {
    setPaymentDraftMap((current) => {
      const draft = current[paymentId] ?? paymentDraftForEntry(entry)
      return {
        ...current,
        [paymentId]: update(draft)
      }
    })
  }

  function togglePurchaseParticipant(
    purchaseId: string,
    entry: MiniAppDashboard['ledger'][number],
    memberId: string,
    included: boolean
  ) {
    updatePurchaseDraft(purchaseId, entry, (draft) => ({
      ...draft,
      participants: included
        ? [
            ...draft.participants.filter((participant) => participant.memberId !== memberId),
            {
              memberId,
              shareAmountMajor: ''
            }
          ]
        : draft.participants.filter((participant) => participant.memberId !== memberId)
    }))
  }

  function updateUtilityBillDraft(
    billId: string,
    bill: MiniAppAdminCycleState['utilityBills'][number],
    update: (draft: UtilityBillDraft) => UtilityBillDraft
  ) {
    setUtilityBillDrafts((current) => {
      const draft = current[billId] ?? {
        billName: bill.billName,
        amountMajor: minorToMajorString(BigInt(bill.amountMinor)),
        currency: bill.currency
      }

      return {
        ...current,
        [billId]: update(draft)
      }
    })
  }

  async function loadDashboard(initData: string) {
    try {
      const nextDashboard = await fetchDashboardQuery(initData)
      setDashboard(nextDashboard)
      setPurchaseDraftMap(purchaseDrafts(nextDashboard.ledger))
      setPaymentDraftMap(paymentDrafts(nextDashboard.ledger))
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('Failed to load mini app dashboard', error)
      }

      setDashboard(null)
      setPurchaseDraftMap({})
      setPaymentDraftMap({})
    }
  }

  async function loadPendingMembers(initData: string) {
    try {
      setPendingMembers(await fetchPendingMembersQuery(initData))
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('Failed to load pending mini app members', error)
      }

      setPendingMembers([])
    }
  }

  async function loadAdminSettings(initData: string) {
    try {
      const payload = await fetchAdminSettingsQuery(initData)
      setAdminSettings(payload)
      setMemberDisplayNameDrafts(
        Object.fromEntries(payload.members.map((member) => [member.id, member.displayName]))
      )
      setRentWeightDrafts(
        Object.fromEntries(
          payload.members.map((member) => [member.id, String(member.rentShareWeight)])
        )
      )
      setMemberStatusDrafts(
        Object.fromEntries(payload.members.map((member) => [member.id, member.status]))
      )
      setMemberAbsencePolicyDrafts(
        Object.fromEntries(
          payload.members.map((member) => [
            member.id,
            resolvedMemberAbsencePolicy(member.id, member.status, payload).policy
          ])
        )
      )
      setCycleForm((current) => ({
        ...current,
        rentCurrency: payload.settings.rentCurrency,
        utilityCurrency: payload.settings.settlementCurrency,
        utilityCategorySlug:
          current.utilityCategorySlug ||
          payload.categories.find((category) => category.isActive)?.slug ||
          ''
      }))
      setBillingForm({
        householdName: payload.householdName,
        settlementCurrency: payload.settings.settlementCurrency,
        paymentBalanceAdjustmentPolicy: payload.settings.paymentBalanceAdjustmentPolicy,
        rentAmountMajor: payload.settings.rentAmountMinor
          ? (Number(payload.settings.rentAmountMinor) / 100).toFixed(2)
          : '',
        rentCurrency: payload.settings.rentCurrency,
        rentDueDay: payload.settings.rentDueDay,
        rentWarningDay: payload.settings.rentWarningDay,
        utilitiesDueDay: payload.settings.utilitiesDueDay,
        utilitiesReminderDay: payload.settings.utilitiesReminderDay,
        timezone: payload.settings.timezone,
        assistantContext: payload.assistantConfig.assistantContext ?? '',
        assistantTone: payload.assistantConfig.assistantTone ?? ''
      })
      setPaymentForm((current) => ({
        ...current,
        memberId:
          (current.memberId && payload.members.some((member) => member.id === current.memberId)
            ? current.memberId
            : payload.members[0]?.id) ?? '',
        currency: payload.settings.settlementCurrency
      }))
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('Failed to load mini app admin settings', error)
      }

      setAdminSettings(null)
    }
  }

  async function loadCycleState(initData: string) {
    try {
      const payload = await fetchBillingCycleQuery(initData)
      setCycleState(payload)
      setUtilityBillDrafts(cycleUtilityBillDrafts(payload.utilityBills))
      setCycleForm((current) => ({
        ...current,
        period: payload.cycle?.period ?? current.period,
        rentCurrency:
          payload.rentRule?.currency ??
          adminSettings()?.settings.rentCurrency ??
          current.rentCurrency,
        utilityCurrency: adminSettings()?.settings.settlementCurrency ?? current.utilityCurrency,
        rentAmountMajor: payload.rentRule
          ? (Number(payload.rentRule.amountMinor) / 100).toFixed(2)
          : '',
        utilityCategorySlug:
          current.utilityCategorySlug ||
          adminSettings()?.categories.find((category) => category.isActive)?.slug ||
          '',
        utilityAmountMajor: current.utilityAmountMajor
      }))
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('Failed to load mini app billing cycle', error)
      }

      setCycleState(null)
    }
  }

  async function refreshHouseholdData(
    initData: string,
    includeAdmin = false,
    forceRefresh = false
  ) {
    if (forceRefresh) {
      await invalidateHouseholdQueries(initData)
    }

    await loadDashboard(initData)

    if (includeAdmin) {
      await Promise.all([
        loadAdminSettings(initData),
        loadCycleState(initData),
        loadPendingMembers(initData)
      ])
      return
    }

    const currentReady = readySession()
    if (currentReady?.mode === 'live' && currentReady.member.isAdmin) {
      await Promise.all([
        loadAdminSettings(initData),
        loadCycleState(initData),
        loadPendingMembers(initData)
      ])
    }
  }

  function applyDemoState() {
    setDisplayNameDraft(demoSession.member.displayName)
    setSession(demoSession)
    setDashboard(demoDashboard)
    setPendingMembers([...demoPendingMembers])
    setAdminSettings(demoAdminSettings)
    setCycleState(demoCycleState)
    setPurchaseDraftMap(purchaseDrafts(demoDashboard.ledger))
    setPaymentDraftMap(paymentDrafts(demoDashboard.ledger))
    setMemberDisplayNameDrafts(
      Object.fromEntries(demoAdminSettings.members.map((member) => [member.id, member.displayName]))
    )
    setRentWeightDrafts(
      Object.fromEntries(
        demoAdminSettings.members.map((member) => [member.id, String(member.rentShareWeight)])
      )
    )
    setMemberStatusDrafts(
      Object.fromEntries(demoAdminSettings.members.map((member) => [member.id, member.status]))
    )
    setMemberAbsencePolicyDrafts(
      Object.fromEntries(
        demoAdminSettings.members.map((member) => [
          member.id,
          resolvedMemberAbsencePolicy(member.id, member.status, demoAdminSettings).policy
        ])
      )
    )
    setBillingForm({
      householdName: demoAdminSettings.householdName,
      settlementCurrency: demoAdminSettings.settings.settlementCurrency,
      paymentBalanceAdjustmentPolicy: demoAdminSettings.settings.paymentBalanceAdjustmentPolicy,
      rentAmountMajor: demoAdminSettings.settings.rentAmountMinor
        ? (Number(demoAdminSettings.settings.rentAmountMinor) / 100).toFixed(2)
        : '',
      rentCurrency: demoAdminSettings.settings.rentCurrency,
      rentDueDay: demoAdminSettings.settings.rentDueDay,
      rentWarningDay: demoAdminSettings.settings.rentWarningDay,
      utilitiesDueDay: demoAdminSettings.settings.utilitiesDueDay,
      utilitiesReminderDay: demoAdminSettings.settings.utilitiesReminderDay,
      timezone: demoAdminSettings.settings.timezone,
      assistantContext: demoAdminSettings.assistantConfig.assistantContext ?? '',
      assistantTone: demoAdminSettings.assistantConfig.assistantTone ?? ''
    })
    setCycleForm((current) => ({
      ...current,
      period: demoCycleState.cycle?.period ?? current.period,
      rentCurrency: demoAdminSettings.settings.rentCurrency,
      utilityCurrency: demoAdminSettings.settings.settlementCurrency,
      rentAmountMajor: demoAdminSettings.settings.rentAmountMinor
        ? (Number(demoAdminSettings.settings.rentAmountMinor) / 100).toFixed(2)
        : '',
      utilityCategorySlug:
        demoAdminSettings.categories.find((category) => category.isActive)?.slug ?? '',
      utilityAmountMajor: ''
    }))
    setPaymentForm({
      memberId: demoAdminSettings.members[0]?.id ?? '',
      kind: 'rent',
      amountMajor: '',
      currency: demoAdminSettings.settings.settlementCurrency
    })
    setUtilityBillDrafts(cycleUtilityBillDrafts(demoCycleState.utilityBills))
  }

  async function bootstrap() {
    const fallbackLocale = detectLocale()
    setLocale(fallbackLocale)

    webApp?.ready?.()
    webApp?.expand?.()

    const initData = webApp?.initData?.trim()
    if (!initData) {
      if (import.meta.env.DEV) {
        applyDemoState()
        return
      }

      setSession({
        status: 'blocked',
        reason: 'telegram_only'
      })
      return
    }

    try {
      const payload = await fetchSessionQuery(initData, joinContext().joinToken)
      if (!payload.authorized || !payload.member || !payload.telegramUser) {
        setLocale(
          payload.onboarding?.householdDefaultLocale ??
            ((payload.telegramUser?.languageCode ?? fallbackLocale).startsWith('ru') ? 'ru' : 'en')
        )
        setSession({
          status: 'onboarding',
          mode: payload.onboarding?.status ?? 'open_from_group',
          ...(payload.onboarding?.householdName
            ? {
                householdName: payload.onboarding.householdName
              }
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

      await loadDashboard(initData)
      if (payload.member.isAdmin) {
        await loadPendingMembers(initData)
        await loadAdminSettings(initData)
        await loadCycleState(initData)
      } else {
        setAdminSettings(null)
        setCycleState(null)
      }
    } catch {
      if (import.meta.env.DEV) {
        applyDemoState()
        return
      }

      setSession({
        status: 'blocked',
        reason: 'error'
      })
    }
  }

  onMount(() => {
    void bootstrap()
  })

  async function handleJoinHousehold() {
    const initData = webApp?.initData?.trim()
    const joinToken = joinContext().joinToken

    if (!initData || !joinToken || joining()) {
      return
    }

    setJoining(true)

    try {
      const payload = await joinMiniAppHousehold(initData, joinToken)
      if (payload.authorized && payload.member && payload.telegramUser) {
        setLocale(payload.member.preferredLocale ?? payload.member.householdDefaultLocale)
        setDisplayNameDraft(payload.member.displayName)
        setSession({
          status: 'ready',
          mode: 'live',
          member: payload.member,
          telegramUser: payload.telegramUser
        })
        await loadDashboard(initData)
        if (payload.member.isAdmin) {
          await loadPendingMembers(initData)
          await loadAdminSettings(initData)
          await loadCycleState(initData)
        } else {
          setAdminSettings(null)
          setCycleState(null)
        }
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
          ? {
              householdName: payload.onboarding.householdName
            }
          : {}),
        telegramUser: payload.telegramUser ?? {
          firstName: null,
          username: null,
          languageCode: null
        }
      })
    } catch {
      setSession({
        status: 'blocked',
        reason: 'error'
      })
    } finally {
      setJoining(false)
    }
  }

  async function handleApprovePendingMember(pendingTelegramUserId: string) {
    const initData = webApp?.initData?.trim()
    if (!initData || approvingTelegramUserId()) {
      return
    }

    setApprovingTelegramUserId(pendingTelegramUserId)

    try {
      await approveMiniAppPendingMember(initData, pendingTelegramUserId)
      setPendingMembers((current) =>
        current.filter((member) => member.telegramUserId !== pendingTelegramUserId)
      )
    } finally {
      setApprovingTelegramUserId(null)
    }
  }

  async function handleMemberLocaleChange(nextLocale: Locale) {
    const initData = webApp?.initData?.trim()
    const currentReady = readySession()

    setLocale(nextLocale)

    if (!initData || currentReady?.mode !== 'live') {
      return
    }

    setSavingMemberLocale(true)

    try {
      const updated = await updateMiniAppLocalePreference(initData, nextLocale, 'member')

      setSession((current) =>
        current.status === 'ready'
          ? {
              ...current,
              member: {
                ...current.member,
                preferredLocale: updated.memberPreferredLocale,
                householdDefaultLocale: updated.householdDefaultLocale
              }
            }
          : current
      )
      setLocale(updated.effectiveLocale)
      await refreshHouseholdData(initData, true, true)
    } finally {
      setSavingMemberLocale(false)
    }
  }

  async function handleHouseholdLocaleChange(nextLocale: Locale) {
    const initData = webApp?.initData?.trim()
    const currentReady = readySession()
    if (!initData || currentReady?.mode !== 'live' || !currentReady.member.isAdmin) {
      return
    }

    setSavingHouseholdLocale(true)

    try {
      const updated = await updateMiniAppLocalePreference(initData, nextLocale, 'household')

      setSession((current) =>
        current.status === 'ready'
          ? {
              ...current,
              member: {
                ...current.member,
                householdDefaultLocale: updated.householdDefaultLocale
              }
            }
          : current
      )

      if (!currentReady.member.preferredLocale) {
        setLocale(updated.effectiveLocale)
      }

      await refreshHouseholdData(initData, true, true)
    } finally {
      setSavingHouseholdLocale(false)
    }
  }

  async function handleSaveOwnDisplayName() {
    const initData = webApp?.initData?.trim()
    const currentReady = readySession()
    const nextDisplayName = displayNameDraft().trim()
    if (!initData || currentReady?.mode !== 'live' || nextDisplayName.length === 0) {
      return
    }

    setSavingOwnDisplayName(true)

    try {
      const updatedMember = await updateMiniAppOwnDisplayName(initData, nextDisplayName)
      syncDisplayName(updatedMember.id, updatedMember.displayName)
    } finally {
      setSavingOwnDisplayName(false)
    }
  }

  async function handleSaveMemberDisplayName(memberId: string, closeEditor = true) {
    const initData = webApp?.initData?.trim()
    const currentReady = readySession()
    const nextDisplayName = memberDisplayNameDrafts()[memberId]?.trim()
    if (
      !initData ||
      currentReady?.mode !== 'live' ||
      !currentReady.member.isAdmin ||
      !nextDisplayName
    ) {
      return
    }

    setSavingMemberDisplayNameId(memberId)

    try {
      const updatedMember = await updateMiniAppMemberDisplayName(
        initData,
        memberId,
        nextDisplayName
      )
      syncDisplayName(updatedMember.id, updatedMember.displayName)
      if (closeEditor) {
        setEditingMemberId(null)
      }
    } finally {
      setSavingMemberDisplayNameId(null)
    }
  }

  async function handleSaveBillingSettings() {
    const initData = webApp?.initData?.trim()
    const currentReady = readySession()
    if (!initData || currentReady?.mode !== 'live' || !currentReady.member.isAdmin) {
      return
    }

    setSavingBillingSettings(true)

    try {
      const { householdName, settings, assistantConfig } = await updateMiniAppBillingSettings(
        initData,
        billingForm()
      )
      setAdminSettings((current) =>
        current
          ? {
              ...current,
              householdName,
              settings,
              assistantConfig
            }
          : current
      )
      setBillingForm((current) => ({
        ...current,
        householdName
      }))
      setSession((current) =>
        current.status === 'ready'
          ? {
              ...current,
              member: {
                ...current.member,
                householdName
              }
            }
          : current
      )
      setCycleForm((current) => ({
        ...current,
        rentCurrency: settings.rentCurrency,
        utilityCurrency: settings.settlementCurrency
      }))
      await refreshHouseholdData(initData, true, true)
      setBillingSettingsOpen(false)
    } finally {
      setSavingBillingSettings(false)
    }
  }

  async function handleOpenCycle() {
    const initData = webApp?.initData?.trim()
    const currentReady = readySession()
    if (!initData || currentReady?.mode !== 'live' || !currentReady.member.isAdmin) {
      return
    }

    setOpeningCycle(true)

    try {
      const state = await openMiniAppBillingCycle(initData, {
        period: cycleForm().period,
        currency: billingForm().settlementCurrency
      })
      setCycleState(state)
      setUtilityBillDrafts(cycleUtilityBillDrafts(state.utilityBills))
      setCycleForm((current) => ({
        ...current,
        period: state.cycle?.period ?? current.period,
        utilityCurrency: billingForm().settlementCurrency
      }))
      await refreshHouseholdData(initData, true, true)
      setCycleRentOpen(false)
    } finally {
      setOpeningCycle(false)
    }
  }

  async function handleSaveCycleRent() {
    const initData = webApp?.initData?.trim()
    const currentReady = readySession()
    if (!initData || currentReady?.mode !== 'live' || !currentReady.member.isAdmin) {
      return
    }

    setSavingCycleRent(true)

    try {
      const state = await updateMiniAppCycleRent(initData, {
        amountMajor: cycleForm().rentAmountMajor,
        currency: cycleForm().rentCurrency,
        ...(cycleState()?.cycle?.period
          ? {
              period: cycleState()!.cycle!.period
            }
          : {})
      })
      setCycleState(state)
      setUtilityBillDrafts(cycleUtilityBillDrafts(state.utilityBills))
      await refreshHouseholdData(initData, true, true)
      setCycleRentOpen(false)
    } finally {
      setSavingCycleRent(false)
    }
  }

  async function handleAddUtilityBill() {
    const initData = webApp?.initData?.trim()
    const currentReady = readySession()
    if (!initData || currentReady?.mode !== 'live' || !currentReady.member.isAdmin) {
      return
    }

    const selectedCategory =
      adminSettings()?.categories.find(
        (category) => category.slug === cycleForm().utilityCategorySlug
      ) ?? adminSettings()?.categories.find((category) => category.isActive)

    if (!selectedCategory || cycleForm().utilityAmountMajor.trim().length === 0) {
      return
    }

    setSavingUtilityBill(true)

    try {
      const state = await addMiniAppUtilityBill(initData, {
        billName: selectedCategory.name,
        amountMajor: cycleForm().utilityAmountMajor,
        currency: cycleForm().utilityCurrency
      })
      setCycleState(state)
      setUtilityBillDrafts(cycleUtilityBillDrafts(state.utilityBills))
      setCycleForm((current) => ({
        ...current,
        utilityAmountMajor: ''
      }))
      await refreshHouseholdData(initData, true, true)
      setAddingUtilityBillOpen(false)
    } finally {
      setSavingUtilityBill(false)
    }
  }

  async function handleUpdateUtilityBill(billId: string) {
    const initData = webApp?.initData?.trim()
    const currentReady = readySession()
    const draft = utilityBillDrafts()[billId]

    if (
      !initData ||
      currentReady?.mode !== 'live' ||
      !currentReady.member.isAdmin ||
      !draft ||
      draft.billName.trim().length === 0 ||
      draft.amountMajor.trim().length === 0
    ) {
      return
    }

    setSavingUtilityBillId(billId)

    try {
      const state = await updateMiniAppUtilityBill(initData, {
        billId,
        billName: draft.billName,
        amountMajor: draft.amountMajor,
        currency: draft.currency
      })
      setCycleState(state)
      setUtilityBillDrafts(cycleUtilityBillDrafts(state.utilityBills))
      await refreshHouseholdData(initData, true, true)
      setEditingUtilityBillId(null)
    } finally {
      setSavingUtilityBillId(null)
    }
  }

  async function handleDeleteUtilityBill(billId: string) {
    const initData = webApp?.initData?.trim()
    const currentReady = readySession()
    if (!initData || currentReady?.mode !== 'live' || !currentReady.member.isAdmin) {
      return
    }

    setDeletingUtilityBillId(billId)

    try {
      const state = await deleteMiniAppUtilityBill(initData, billId)
      setCycleState(state)
      setUtilityBillDrafts(cycleUtilityBillDrafts(state.utilityBills))
      await refreshHouseholdData(initData, true, true)
      setEditingUtilityBillId((current) => (current === billId ? null : current))
    } finally {
      setDeletingUtilityBillId(null)
    }
  }

  async function handleUpdatePurchase(purchaseId: string) {
    const initData = webApp?.initData?.trim()
    const currentReady = readySession()
    const draft = purchaseDraftMap()[purchaseId]

    if (
      !initData ||
      currentReady?.mode !== 'live' ||
      !currentReady.member.isAdmin ||
      !draft ||
      draft.description.trim().length === 0 ||
      draft.amountMajor.trim().length === 0 ||
      draft.participants.length === 0 ||
      (draft.splitMode === 'custom_amounts' &&
        draft.participants.some((participant) => participant.shareAmountMajor.trim().length === 0))
    ) {
      return
    }

    setSavingPurchaseId(purchaseId)

    try {
      await updateMiniAppPurchase(initData, {
        purchaseId,
        description: draft.description,
        amountMajor: draft.amountMajor,
        currency: draft.currency,
        split: {
          mode: draft.splitMode,
          participants: (adminSettings()?.members ?? []).map((member) => {
            const participant = draft.participants.find(
              (currentParticipant) => currentParticipant.memberId === member.id
            )

            return {
              memberId: member.id,
              included: Boolean(participant),
              ...(draft.splitMode === 'custom_amounts' && participant
                ? {
                    shareAmountMajor: participant.shareAmountMajor
                  }
                : {})
            }
          })
        }
      })
      await refreshHouseholdData(initData, true, true)
      setEditingPurchaseId(null)
    } finally {
      setSavingPurchaseId(null)
    }
  }

  async function handleDeletePurchase(purchaseId: string) {
    const initData = webApp?.initData?.trim()
    const currentReady = readySession()
    if (!initData || currentReady?.mode !== 'live' || !currentReady.member.isAdmin) {
      return
    }

    setDeletingPurchaseId(purchaseId)

    try {
      await deleteMiniAppPurchase(initData, purchaseId)
      await refreshHouseholdData(initData, true, true)
      setEditingPurchaseId((current) => (current === purchaseId ? null : current))
    } finally {
      setDeletingPurchaseId(null)
    }
  }

  async function handleAddPayment() {
    const initData = webApp?.initData?.trim()
    const currentReady = readySession()
    const draft = paymentForm()
    const memberId = draft.memberId.trim() || defaultPaymentMemberId()
    if (
      !initData ||
      currentReady?.mode !== 'live' ||
      !currentReady.member.isAdmin ||
      memberId.length === 0 ||
      draft.amountMajor.trim().length === 0
    ) {
      return
    }

    setAddingPayment(true)

    try {
      await addMiniAppPayment(initData, {
        ...draft,
        memberId
      })
      setPaymentForm((current) => ({
        ...current,
        memberId,
        amountMajor: ''
      }))
      await refreshHouseholdData(initData, true, true)
      setAddingPaymentOpen(false)
    } finally {
      setAddingPayment(false)
    }
  }

  async function handleUpdatePayment(paymentId: string) {
    const initData = webApp?.initData?.trim()
    const currentReady = readySession()
    const draft = paymentDraftMap()[paymentId]
    if (
      !initData ||
      currentReady?.mode !== 'live' ||
      !currentReady.member.isAdmin ||
      !draft ||
      draft.memberId.trim().length === 0 ||
      draft.amountMajor.trim().length === 0
    ) {
      return
    }

    setSavingPaymentId(paymentId)

    try {
      await updateMiniAppPayment(initData, {
        paymentId,
        memberId: draft.memberId,
        kind: draft.kind,
        amountMajor: draft.amountMajor,
        currency: draft.currency
      })
      await refreshHouseholdData(initData, true, true)
      setEditingPaymentId(null)
    } finally {
      setSavingPaymentId(null)
    }
  }

  async function handleDeletePayment(paymentId: string) {
    const initData = webApp?.initData?.trim()
    const currentReady = readySession()
    if (!initData || currentReady?.mode !== 'live' || !currentReady.member.isAdmin) {
      return
    }

    setDeletingPaymentId(paymentId)

    try {
      await deleteMiniAppPayment(initData, paymentId)
      await refreshHouseholdData(initData, true, true)
      setEditingPaymentId((current) => (current === paymentId ? null : current))
    } finally {
      setDeletingPaymentId(null)
    }
  }

  async function handleSaveUtilityCategory(input: {
    slug?: string
    name: string
    sortOrder: number
    isActive: boolean
  }) {
    const initData = webApp?.initData?.trim()
    const currentReady = readySession()
    if (!initData || currentReady?.mode !== 'live' || !currentReady.member.isAdmin) {
      return
    }

    setSavingCategorySlug(input.slug ?? '__new__')

    try {
      const category = await upsertMiniAppUtilityCategory(initData, input)
      setAdminSettings((current) => {
        if (!current) {
          return current
        }

        const categories = current.categories.some((item) => item.slug === category.slug)
          ? current.categories.map((item) => (item.slug === category.slug ? category : item))
          : [...current.categories, category]

        return {
          ...current,
          categories: [...categories].sort((left, right) => left.sortOrder - right.sortOrder)
        }
      })

      if (!input.slug) {
        setNewCategoryName('')
      }

      setEditingCategorySlug(null)
    } finally {
      setSavingCategorySlug(null)
    }
  }

  async function handlePromoteMember(memberId: string) {
    const initData = webApp?.initData?.trim()
    const currentReady = readySession()
    if (!initData || currentReady?.mode !== 'live' || !currentReady.member.isAdmin) {
      return
    }

    setPromotingMemberId(memberId)

    try {
      const member = await promoteMiniAppMember(initData, memberId)
      setAdminSettings((current) =>
        current
          ? {
              ...current,
              members: current.members.map((item) => (item.id === member.id ? member : item))
            }
          : current
      )
      setRentWeightDrafts((current) => ({
        ...current,
        [member.id]: String(member.rentShareWeight)
      }))
      setEditingMemberId(null)
    } finally {
      setPromotingMemberId(null)
    }
  }

  async function handleSaveRentWeight(
    memberId: string,
    closeEditor = true,
    refreshAfterSave = true
  ) {
    const initData = webApp?.initData?.trim()
    const currentReady = readySession()
    const nextWeight = Number(rentWeightDrafts()[memberId] ?? '')
    if (
      !initData ||
      currentReady?.mode !== 'live' ||
      !currentReady.member.isAdmin ||
      !Number.isInteger(nextWeight) ||
      nextWeight <= 0
    ) {
      return
    }

    setSavingRentWeightMemberId(memberId)

    try {
      const member = await updateMiniAppMemberRentWeight(initData, memberId, nextWeight)
      setAdminSettings((current) =>
        current
          ? {
              ...current,
              members: current.members.map((item) => (item.id === member.id ? member : item))
            }
          : current
      )
      setRentWeightDrafts((current) => ({
        ...current,
        [member.id]: String(member.rentShareWeight)
      }))
      if (refreshAfterSave) {
        await refreshHouseholdData(initData, true, true)
      }
      if (closeEditor) {
        setEditingMemberId(null)
      }
    } finally {
      setSavingRentWeightMemberId(null)
    }
  }

  async function handleSaveMemberStatus(
    memberId: string,
    closeEditor = true,
    refreshAfterSave = true
  ) {
    const initData = webApp?.initData?.trim()
    const currentReady = readySession()
    const nextStatus = memberStatusDrafts()[memberId]
    if (!initData || currentReady?.mode !== 'live' || !currentReady.member.isAdmin || !nextStatus) {
      return
    }

    setSavingMemberStatusId(memberId)

    try {
      const member = await updateMiniAppMemberStatus(initData, memberId, nextStatus)
      setAdminSettings((current) =>
        current
          ? {
              ...current,
              members: current.members.map((item) => (item.id === member.id ? member : item))
            }
          : current
      )
      setMemberStatusDrafts((current) => ({
        ...current,
        [member.id]: member.status
      }))
      setMemberAbsencePolicyDrafts((current) => ({
        ...current,
        [member.id]:
          current[member.id] ??
          resolvedMemberAbsencePolicy(member.id, member.status).policy ??
          defaultAbsencePolicyForStatus(member.status)
      }))
      if (refreshAfterSave) {
        await refreshHouseholdData(initData, true, true)
      }
      if (closeEditor) {
        setEditingMemberId(null)
      }
    } finally {
      setSavingMemberStatusId(null)
    }
  }

  async function handleSaveMemberAbsencePolicy(
    memberId: string,
    closeEditor = true,
    refreshAfterSave = true
  ) {
    const initData = webApp?.initData?.trim()
    const currentReady = readySession()
    const member = adminSettings()?.members.find((entry) => entry.id === memberId)
    const nextPolicy = memberAbsencePolicyDrafts()[memberId]
    const effectiveStatus = memberStatusDrafts()[memberId] ?? member?.status

    if (
      !initData ||
      currentReady?.mode !== 'live' ||
      !currentReady.member.isAdmin ||
      !member ||
      !nextPolicy ||
      effectiveStatus !== 'away'
    ) {
      return
    }

    setSavingMemberAbsencePolicyId(memberId)

    try {
      const savedPolicy = await updateMiniAppMemberAbsencePolicy(initData, memberId, nextPolicy)
      setAdminSettings((current) =>
        current
          ? {
              ...current,
              memberAbsencePolicies: [
                ...current.memberAbsencePolicies.filter(
                  (policy) =>
                    !(
                      policy.memberId === savedPolicy.memberId &&
                      policy.effectiveFromPeriod === savedPolicy.effectiveFromPeriod
                    )
                ),
                savedPolicy
              ]
            }
          : current
      )
      setMemberAbsencePolicyDrafts((current) => ({
        ...current,
        [memberId]: savedPolicy.policy
      }))
      if (refreshAfterSave) {
        await refreshHouseholdData(initData, true, true)
      }
      if (closeEditor) {
        setEditingMemberId(null)
      }
    } finally {
      setSavingMemberAbsencePolicyId(null)
    }
  }

  async function handleSaveMemberChanges(memberId: string) {
    const currentReady = readySession()
    const member = adminSettings()?.members.find((entry) => entry.id === memberId)
    const nextDisplayName = memberDisplayNameDrafts()[memberId]?.trim() ?? member?.displayName ?? ''
    const nextStatus = memberStatusDrafts()[memberId] ?? member?.status
    const nextPolicy = memberAbsencePolicyDrafts()[memberId]
    const nextWeight = Number(rentWeightDrafts()[memberId] ?? member?.rentShareWeight ?? 0)

    if (
      currentReady?.mode !== 'live' ||
      !currentReady.member.isAdmin ||
      !member ||
      nextDisplayName.length < 2 ||
      !nextStatus ||
      !Number.isInteger(nextWeight) ||
      nextWeight <= 0 ||
      savingMemberEditorId() === memberId
    ) {
      return
    }

    const currentPolicy = resolvedMemberAbsencePolicy(member.id, member.status).policy
    const wantsAwayPolicySave = nextStatus === 'away' && nextPolicy && nextPolicy !== currentPolicy
    const hasNameChange = nextDisplayName !== member.displayName
    const hasStatusChange = nextStatus !== member.status
    const hasWeightChange = nextWeight !== member.rentShareWeight
    const requiresDashboardRefresh = hasStatusChange || wantsAwayPolicySave || hasWeightChange

    if (!hasNameChange && !hasStatusChange && !wantsAwayPolicySave && !hasWeightChange) {
      return
    }

    setSavingMemberEditorId(memberId)

    try {
      if (hasNameChange) {
        await handleSaveMemberDisplayName(memberId, false)
      }

      if (hasStatusChange) {
        await handleSaveMemberStatus(memberId, false, false)
      }

      if (wantsAwayPolicySave) {
        await handleSaveMemberAbsencePolicy(memberId, false, false)
      }

      if (hasWeightChange) {
        await handleSaveRentWeight(memberId, false, false)
      }

      if (requiresDashboardRefresh) {
        const initData = webApp?.initData?.trim()
        if (initData) {
          await refreshHouseholdData(initData, true, true)
        }
      }

      setEditingMemberId(null)
    } finally {
      setSavingMemberEditorId(null)
    }
  }

  function purchaseSplitPreview(purchaseId: string): { memberId: string; amountMajor: string }[] {
    const draft = purchaseDraftMap()[purchaseId]
    if (!draft || draft.participants.length === 0) {
      return []
    }

    if (draft.splitMode === 'custom_amounts') {
      return draft.participants.map((participant) => ({
        memberId: participant.memberId,
        amountMajor: participant.shareAmountMajor
      }))
    }

    const totalMinor = majorStringToMinor(draft.amountMajor)
    const count = BigInt(draft.participants.length)
    if (count <= 0n) {
      return []
    }

    const base = totalMinor / count
    const remainder = totalMinor % count

    return draft.participants.map((participant, index) => ({
      memberId: participant.memberId,
      amountMajor: minorToMajorString(base + (BigInt(index) < remainder ? 1n : 0n))
    }))
  }

  const panel = createMemo(() => {
    switch (activeNav()) {
      case 'balances':
        return (
          <BalancesScreen
            copy={copy()}
            locale={locale()}
            dashboard={dashboard()}
            currentMemberLine={currentMemberLine()}
            utilityTotalMajor={utilityTotalMajor()}
            purchaseTotalMajor={purchaseTotalMajor()}
            memberBalanceVisuals={memberBalanceVisuals()}
            purchaseChart={purchaseInvestmentChart()}
            memberBaseDueMajor={memberBaseDueMajor}
            memberRemainingClass={memberRemainingClass}
          />
        )
      case 'ledger':
        return (
          <LedgerScreen
            copy={copy()}
            locale={locale()}
            dashboard={dashboard()}
            readyIsAdmin={effectiveIsAdmin()}
            adminMembers={adminSettings()?.members ?? []}
            purchaseEntries={purchaseLedger()}
            utilityEntries={utilityLedger()}
            paymentEntries={paymentLedger()}
            editingPurchaseEntry={editingPurchaseEntry()}
            editingPaymentEntry={editingPaymentEntry()}
            purchaseDraftMap={purchaseDraftMap()}
            paymentDraftMap={paymentDraftMap()}
            paymentForm={paymentForm()}
            addingPaymentOpen={addingPaymentOpen()}
            savingPurchaseId={savingPurchaseId()}
            deletingPurchaseId={deletingPurchaseId()}
            savingPaymentId={savingPaymentId()}
            deletingPaymentId={deletingPaymentId()}
            addingPayment={addingPayment()}
            ledgerTitle={ledgerTitle}
            ledgerPrimaryAmount={ledgerPrimaryAmount}
            ledgerSecondaryAmount={ledgerSecondaryAmount}
            purchaseParticipantSummary={purchaseParticipantSummary}
            purchaseDraftForEntry={purchaseDraftForEntry}
            paymentDraftForEntry={paymentDraftForEntry}
            purchaseSplitPreview={purchaseSplitPreview}
            paymentMemberName={paymentMemberName}
            onOpenPurchaseEditor={setEditingPurchaseId}
            onClosePurchaseEditor={() => setEditingPurchaseId(null)}
            onDeletePurchase={handleDeletePurchase}
            onSavePurchase={handleUpdatePurchase}
            onPurchaseDescriptionChange={(purchaseId, entry, value) =>
              updatePurchaseDraft(purchaseId, entry, (current) => ({
                ...current,
                description: value
              }))
            }
            onPurchaseAmountChange={(purchaseId, entry, value) =>
              updatePurchaseDraft(purchaseId, entry, (current) => ({
                ...current,
                amountMajor: value
              }))
            }
            onPurchaseCurrencyChange={(purchaseId, entry, value) =>
              updatePurchaseDraft(purchaseId, entry, (current) => ({
                ...current,
                currency: value
              }))
            }
            onPurchaseSplitModeChange={(purchaseId, entry, value) =>
              updatePurchaseDraft(purchaseId, entry, (current) => ({
                ...current,
                splitMode: value
              }))
            }
            onTogglePurchaseParticipant={togglePurchaseParticipant}
            onPurchaseParticipantShareChange={(purchaseId, entry, memberId, value) =>
              updatePurchaseDraft(purchaseId, entry, (current) => ({
                ...current,
                participants: current.participants.map((participant) =>
                  participant.memberId === memberId
                    ? {
                        ...participant,
                        shareAmountMajor: value
                      }
                    : participant
                )
              }))
            }
            onOpenAddPayment={() => {
              setPaymentForm((current) => ({
                ...current,
                memberId: current.memberId.trim() || defaultPaymentMemberId(),
                currency: adminSettings()?.settings.settlementCurrency ?? current.currency
              }))
              setAddingPaymentOpen(true)
            }}
            onCloseAddPayment={() => setAddingPaymentOpen(false)}
            onAddPayment={handleAddPayment}
            onPaymentFormMemberChange={(value) =>
              setPaymentForm((current) => ({
                ...current,
                memberId: value
              }))
            }
            onPaymentFormKindChange={(value) =>
              setPaymentForm((current) => ({
                ...current,
                kind: value
              }))
            }
            onPaymentFormAmountChange={(value) =>
              setPaymentForm((current) => ({
                ...current,
                amountMajor: value
              }))
            }
            onPaymentFormCurrencyChange={(value) =>
              setPaymentForm((current) => ({
                ...current,
                currency: value
              }))
            }
            onOpenPaymentEditor={setEditingPaymentId}
            onClosePaymentEditor={() => setEditingPaymentId(null)}
            onDeletePayment={handleDeletePayment}
            onSavePayment={handleUpdatePayment}
            onPaymentDraftMemberChange={(paymentId, entry, value) =>
              updatePaymentDraft(paymentId, entry, (current) => ({
                ...current,
                memberId: value
              }))
            }
            onPaymentDraftKindChange={(paymentId, entry, value) =>
              updatePaymentDraft(paymentId, entry, (current) => ({
                ...current,
                kind: value
              }))
            }
            onPaymentDraftAmountChange={(paymentId, entry, value) =>
              updatePaymentDraft(paymentId, entry, (current) => ({
                ...current,
                amountMajor: value
              }))
            }
            onPaymentDraftCurrencyChange={(paymentId, entry, value) =>
              updatePaymentDraft(paymentId, entry, (current) => ({
                ...current,
                currency: value
              }))
            }
          />
        )
      case 'house':
        return (
          <HouseScreen
            copy={copy()}
            locale={locale()}
            readyIsAdmin={effectiveIsAdmin()}
            householdDefaultLocale={readySession()?.member.householdDefaultLocale ?? 'en'}
            householdName={readySession()?.member.householdName ?? billingForm().householdName}
            profileDisplayName={readySession()?.member.displayName ?? displayNameDraft()}
            dashboard={dashboard()}
            adminSettings={adminSettings()}
            cycleState={cycleState()}
            pendingMembers={pendingMembers()}
            billingForm={billingForm()}
            cycleForm={cycleForm()}
            newCategoryName={newCategoryName()}
            cycleRentOpen={cycleRentOpen()}
            billingSettingsOpen={billingSettingsOpen()}
            addingUtilityBillOpen={addingUtilityBillOpen()}
            editingUtilityBill={editingUtilityBill()}
            editingUtilityBillId={editingUtilityBillId()}
            utilityBillDrafts={utilityBillDrafts()}
            editingCategorySlug={editingCategorySlug()}
            editingCategory={editingCategory()}
            editingMember={editingMember()}
            memberDisplayNameDrafts={memberDisplayNameDrafts()}
            memberStatusDrafts={memberStatusDrafts()}
            memberAbsencePolicyDrafts={memberAbsencePolicyDrafts()}
            rentWeightDrafts={rentWeightDrafts()}
            openingCycle={openingCycle()}
            savingCycleRent={savingCycleRent()}
            savingBillingSettings={savingBillingSettings()}
            savingUtilityBill={savingUtilityBill()}
            savingUtilityBillId={savingUtilityBillId()}
            deletingUtilityBillId={deletingUtilityBillId()}
            savingCategorySlug={savingCategorySlug()}
            approvingTelegramUserId={approvingTelegramUserId()}
            savingMemberEditorId={savingMemberEditorId()}
            promotingMemberId={promotingMemberId()}
            savingHouseholdLocale={savingHouseholdLocale()}
            minorToMajorString={minorToMajorString}
            memberStatusLabel={memberStatusLabel}
            topicRoleLabel={topicRoleLabel}
            resolvedMemberAbsencePolicy={(memberId, status) =>
              resolvedMemberAbsencePolicy(memberId, status)
            }
            onChangeHouseholdLocale={handleHouseholdLocaleChange}
            onOpenProfileEditor={() => setProfileEditorOpen(true)}
            onOpenCycleModal={() => setCycleRentOpen(true)}
            onCloseCycleModal={() => setCycleRentOpen(false)}
            onSaveCycleRent={handleSaveCycleRent}
            onOpenCycle={handleOpenCycle}
            onCycleRentAmountChange={(value) =>
              setCycleForm((current) => ({
                ...current,
                rentAmountMajor: value
              }))
            }
            onCycleRentCurrencyChange={(value) =>
              setCycleForm((current) => ({
                ...current,
                rentCurrency: value
              }))
            }
            onCyclePeriodChange={(value) =>
              setCycleForm((current) => ({
                ...current,
                period: value
              }))
            }
            onOpenBillingSettingsModal={() => setBillingSettingsOpen(true)}
            onCloseBillingSettingsModal={() => setBillingSettingsOpen(false)}
            onSaveBillingSettings={handleSaveBillingSettings}
            onBillingSettlementCurrencyChange={(value) =>
              setBillingForm((current) => ({
                ...current,
                settlementCurrency: value
              }))
            }
            onBillingHouseholdNameChange={(value) =>
              setBillingForm((current) => ({
                ...current,
                householdName: value
              }))
            }
            onBillingAdjustmentPolicyChange={(value) =>
              setBillingForm((current) => ({
                ...current,
                paymentBalanceAdjustmentPolicy: value
              }))
            }
            onBillingRentAmountChange={(value) =>
              setBillingForm((current) => ({
                ...current,
                rentAmountMajor: value
              }))
            }
            onBillingRentCurrencyChange={(value) =>
              setBillingForm((current) => ({
                ...current,
                rentCurrency: value
              }))
            }
            onBillingRentDueDayChange={(value) =>
              value === null
                ? undefined
                : setBillingForm((current) => ({
                    ...current,
                    rentDueDay: value
                  }))
            }
            onBillingRentWarningDayChange={(value) =>
              value === null
                ? undefined
                : setBillingForm((current) => ({
                    ...current,
                    rentWarningDay: value
                  }))
            }
            onBillingUtilitiesDueDayChange={(value) =>
              value === null
                ? undefined
                : setBillingForm((current) => ({
                    ...current,
                    utilitiesDueDay: value
                  }))
            }
            onBillingUtilitiesReminderDayChange={(value) =>
              value === null
                ? undefined
                : setBillingForm((current) => ({
                    ...current,
                    utilitiesReminderDay: value
                  }))
            }
            onBillingTimezoneChange={(value) =>
              setBillingForm((current) => ({
                ...current,
                timezone: value
              }))
            }
            onBillingAssistantContextChange={(value) =>
              setBillingForm((current) => ({
                ...current,
                assistantContext: value
              }))
            }
            onBillingAssistantToneChange={(value) =>
              setBillingForm((current) => ({
                ...current,
                assistantTone: value
              }))
            }
            onOpenAddUtilityBill={() => setAddingUtilityBillOpen(true)}
            onCloseAddUtilityBill={() => setAddingUtilityBillOpen(false)}
            onAddUtilityBill={handleAddUtilityBill}
            onCycleUtilityCategoryChange={(value) =>
              setCycleForm((current) => ({
                ...current,
                utilityCategorySlug: value
              }))
            }
            onCycleUtilityAmountChange={(value) =>
              setCycleForm((current) => ({
                ...current,
                utilityAmountMajor: value
              }))
            }
            onCycleUtilityCurrencyChange={(value) =>
              setCycleForm((current) => ({
                ...current,
                utilityCurrency: value
              }))
            }
            onOpenUtilityBillEditor={setEditingUtilityBillId}
            onCloseUtilityBillEditor={() => setEditingUtilityBillId(null)}
            onDeleteUtilityBill={handleDeleteUtilityBill}
            onSaveUtilityBill={handleUpdateUtilityBill}
            onUtilityBillNameChange={(billId, bill, value) =>
              updateUtilityBillDraft(billId, bill, (current) => ({
                ...current,
                billName: value
              }))
            }
            onUtilityBillAmountChange={(billId, bill, value) =>
              updateUtilityBillDraft(billId, bill, (current) => ({
                ...current,
                amountMajor: value
              }))
            }
            onUtilityBillCurrencyChange={(billId, bill, value) =>
              updateUtilityBillDraft(billId, bill, (current) => ({
                ...current,
                currency: value
              }))
            }
            onOpenCategoryEditor={(slug) => {
              setEditingCategorySlug(slug)
              if (slug === '__new__') {
                setNewCategoryName('')
                setEditingCategoryDraft(null)
                return
              }

              const category =
                adminSettings()?.categories.find((item) => item.slug === slug) ?? null
              setEditingCategoryDraft(
                category
                  ? {
                      name: category.name,
                      isActive: category.isActive
                    }
                  : null
              )
            }}
            onCloseCategoryEditor={() => {
              setEditingCategorySlug(null)
              setEditingCategoryDraft(null)
              setNewCategoryName('')
            }}
            onNewCategoryNameChange={setNewCategoryName}
            onSaveNewCategory={() =>
              handleSaveUtilityCategory({
                name: newCategoryName(),
                sortOrder: adminSettings()?.categories.length ?? 0,
                isActive: true
              })
            }
            onSaveExistingCategory={() => {
              const category = editingCategory()
              if (!category) {
                return Promise.resolve()
              }

              return handleSaveUtilityCategory({
                slug: category.slug,
                name: editingCategoryDraft()?.name ?? category.name,
                sortOrder: category.sortOrder,
                isActive: editingCategoryDraft()?.isActive ?? category.isActive
              })
            }}
            editingCategoryDraft={editingCategoryDraft()}
            onEditingCategoryNameChange={(value) =>
              setEditingCategoryDraft((current) =>
                current
                  ? {
                      ...current,
                      name: value
                    }
                  : current
              )
            }
            onEditingCategoryActiveChange={(value) =>
              setEditingCategoryDraft((current) =>
                current
                  ? {
                      ...current,
                      isActive: value
                    }
                  : current
              )
            }
            onOpenMemberEditor={setEditingMemberId}
            onCloseMemberEditor={() => setEditingMemberId(null)}
            onApprovePendingMember={handleApprovePendingMember}
            onMemberDisplayNameDraftChange={(memberId, value) =>
              setMemberDisplayNameDrafts((current) => ({
                ...current,
                [memberId]: value
              }))
            }
            onMemberStatusDraftChange={(memberId, value) =>
              setMemberStatusDrafts((current) => ({
                ...current,
                [memberId]: value
              }))
            }
            onMemberAbsencePolicyDraftChange={(memberId, value) =>
              setMemberAbsencePolicyDrafts((current) => ({
                ...current,
                [memberId]: value
              }))
            }
            onRentWeightDraftChange={(memberId, value) =>
              setRentWeightDrafts((current) => ({
                ...current,
                [memberId]: value
              }))
            }
            onSaveMemberChanges={handleSaveMemberChanges}
            onPromoteMember={handlePromoteMember}
          />
        )
      default:
        return (
          <HomeScreen
            copy={copy()}
            locale={locale()}
            dashboard={dashboard()}
            currentMemberLine={currentMemberLine()}
            utilityTotalMajor={utilityTotalMajor()}
            purchaseTotalMajor={purchaseTotalMajor()}
          />
        )
    }
  })

  return (
    <main class="shell">
      <div class="shell__backdrop shell__backdrop--top" />
      <div class="shell__backdrop shell__backdrop--bottom" />

      <TopBar
        subtitle={copy().appSubtitle}
        title={
          readySession()?.member.householdName ??
          onboardingSession()?.householdName ??
          copy().appTitle
        }
        languageLabel={copy().language}
        locale={locale()}
        saving={savingMemberLocale()}
        onChange={(nextLocale) => void handleMemberLocaleChange(nextLocale)}
      />

      <Switch>
        <Match when={session().status === 'loading'}>
          <LoadingState
            badge={copy().loadingBadge}
            title={copy().loadingTitle}
            body={copy().loadingBody}
          />
        </Match>

        <Match when={session().status === 'blocked'}>
          <BlockedState
            badge={copy().loadingBadge}
            title={
              blockedSession()?.reason === 'telegram_only'
                ? copy().telegramOnlyTitle
                : copy().unexpectedErrorTitle
            }
            body={
              blockedSession()?.reason === 'telegram_only'
                ? copy().telegramOnlyBody
                : copy().unexpectedErrorBody
            }
            reloadLabel={copy().reload}
            onReload={() => window.location.reload()}
          />
        </Match>

        <Match when={session().status === 'onboarding'}>
          <OnboardingState
            badge={copy().loadingBadge}
            title={
              onboardingSession()?.mode === 'pending'
                ? copy().pendingTitle
                : onboardingSession()?.mode === 'open_from_group'
                  ? copy().openFromGroupTitle
                  : copy().joinTitle
            }
            body={
              onboardingSession()?.mode === 'pending'
                ? copy().pendingBody.replace(
                    '{household}',
                    onboardingSession()?.householdName ?? copy().householdFallback
                  )
                : onboardingSession()?.mode === 'open_from_group'
                  ? copy().openFromGroupBody
                  : copy().joinBody.replace(
                      '{household}',
                      onboardingSession()?.householdName ?? copy().householdFallback
                    )
            }
            canJoin={onboardingSession()?.mode === 'join_required'}
            joining={joining()}
            joinActionLabel={copy().joinAction}
            joiningLabel={copy().joining}
            botLinkLabel={copy().botLinkAction}
            botLink={joinDeepLink()}
            reloadLabel={copy().reload}
            onJoin={handleJoinHousehold}
            onReload={() => window.location.reload()}
          />
        </Match>

        <Match when={session().status === 'ready'}>
          <section class="app-context-row">
            <div class="app-context-meta">
              <MiniChip>
                {readySession()?.mode === 'demo' ? copy().demoBadge : copy().liveBadge}
              </MiniChip>
              <Show
                when={readySession()?.member.isAdmin}
                fallback={
                  <MiniChip muted>
                    {effectiveIsAdmin() ? copy().adminTag : copy().residentTag}
                  </MiniChip>
                }
              >
                <button
                  class="mini-chip mini-chip--muted mini-chip-button"
                  onClick={handleRoleChipTap}
                >
                  {effectiveIsAdmin() ? copy().adminTag : copy().residentTag}
                </button>
              </Show>
              <MiniChip muted>
                {readySession()?.member.status
                  ? memberStatusLabel(readySession()!.member.status)
                  : copy().memberStatusActive}
              </MiniChip>
              <Show when={testingRolePreview()}>
                {(preview) => (
                  <MiniChip>{`${copy().testingViewBadge ?? ''}: ${preview() === 'admin' ? copy().adminTag : copy().residentTag}`}</MiniChip>
                )}
              </Show>
            </div>
          </section>

          <section class="content-stack">{panel()}</section>
          <div class="app-bottom-nav">
            <NavigationTabs
              items={
                [
                  { key: 'home', label: copy().home, icon: <HomeIcon /> },
                  { key: 'balances', label: copy().balances, icon: <WalletIcon /> },
                  { key: 'ledger', label: copy().ledger, icon: <ReceiptIcon /> },
                  { key: 'house', label: copy().house, icon: <HouseIcon /> }
                ] as const
              }
              active={activeNav()}
              onChange={setActiveNav}
            />
          </div>
          <Modal
            open={testingSurfaceOpen()}
            title={copy().testingSurfaceTitle ?? ''}
            description={copy().testingSurfaceBody}
            closeLabel={copy().closeEditorAction}
            onClose={() => setTestingSurfaceOpen(false)}
            footer={
              <div class="modal-action-row">
                <Button variant="ghost" onClick={() => setTestingSurfaceOpen(false)}>
                  {copy().closeEditorAction}
                </Button>
                <Button variant="secondary" onClick={() => setTestingRolePreview(null)}>
                  {copy().testingUseRealRoleAction ?? ''}
                </Button>
              </div>
            }
          >
            <div class="testing-card">
              <article class="testing-card__section">
                <span>{copy().testingCurrentRoleLabel ?? ''}</span>
                <strong>
                  {readySession()?.member.isAdmin ? copy().adminTag : copy().residentTag}
                </strong>
              </article>
              <article class="testing-card__section">
                <span>{copy().testingPreviewRoleLabel ?? ''}</span>
                <strong>
                  {testingRolePreview()
                    ? testingRolePreview() === 'admin'
                      ? copy().adminTag
                      : copy().residentTag
                    : copy().testingUseRealRoleAction}
                </strong>
              </article>
              <div class="testing-card__actions">
                <Button variant="secondary" onClick={() => setTestingRolePreview('admin')}>
                  {copy().testingPreviewAdminAction ?? ''}
                </Button>
                <Button variant="secondary" onClick={() => setTestingRolePreview('resident')}>
                  {copy().testingPreviewResidentAction ?? ''}
                </Button>
              </div>
            </div>
          </Modal>
          <Modal
            open={profileEditorOpen()}
            title={copy().displayNameLabel}
            description={copy().profileEditorBody}
            closeLabel={copy().closeEditorAction}
            onClose={() => setProfileEditorOpen(false)}
            footer={
              <div class="modal-action-row modal-action-row--single">
                <Button variant="ghost" onClick={() => setProfileEditorOpen(false)}>
                  {copy().closeEditorAction}
                </Button>
                <Button
                  variant="primary"
                  disabled={
                    savingOwnDisplayName() ||
                    displayNameDraft().trim().length < 2 ||
                    displayNameDraft().trim() === readySession()?.member.displayName
                  }
                  onClick={() => void handleSaveOwnDisplayName()}
                >
                  {savingOwnDisplayName() ? copy().savingDisplayName : copy().saveDisplayName}
                </Button>
              </div>
            }
          >
            <div class="editor-grid">
              <Field label={copy().displayNameLabel} hint={copy().displayNameHint} wide>
                <input
                  value={displayNameDraft()}
                  onInput={(event) => setDisplayNameDraft(event.currentTarget.value)}
                />
              </Field>
            </div>
          </Modal>
        </Match>
      </Switch>
    </main>
  )
}

export default App
