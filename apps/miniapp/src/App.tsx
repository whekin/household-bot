import { Match, Show, Switch, createMemo, createSignal, onMount, type JSX } from 'solid-js'

import { dictionary, type Locale } from './i18n'
import {
  addMiniAppUtilityBill,
  addMiniAppPayment,
  approveMiniAppPendingMember,
  closeMiniAppBillingCycle,
  deleteMiniAppPayment,
  deleteMiniAppPurchase,
  deleteMiniAppUtilityBill,
  fetchMiniAppAdminSettings,
  fetchMiniAppBillingCycle,
  fetchMiniAppDashboard,
  fetchMiniAppPendingMembers,
  fetchMiniAppSession,
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
import { Button, Field, IconButton, Modal } from './components/ui'
import { HeroBanner } from './components/layout/hero-banner'
import { NavigationTabs } from './components/layout/navigation-tabs'
import { ProfileCard } from './components/layout/profile-card'
import { TopBar } from './components/layout/top-bar'
import { FinanceSummaryCards } from './components/finance/finance-summary-cards'
import { FinanceVisuals } from './components/finance/finance-visuals'
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
type HouseSectionKey = 'billing' | 'utilities' | 'members' | 'topics'

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

const chartPalette = ['#f7b389', '#6fd3c0', '#f06a8d', '#94a8ff', '#f3d36f', '#7dc96d'] as const

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

function majorStringToMinor(value: string): bigint {
  const trimmed = value.trim()
  const negative = trimmed.startsWith('-')
  const normalized = negative ? trimmed.slice(1) : trimmed
  const [whole = '0', fraction = ''] = normalized.split('.')
  const major = BigInt(whole || '0')
  const cents = BigInt((fraction.padEnd(2, '0').slice(0, 2) || '00').replace(/\D/g, '') || '0')
  const minor = major * 100n + cents

  return negative ? -minor : minor
}

function minorToMajorString(value: bigint): string {
  const negative = value < 0n
  const absolute = negative ? -value : value
  const whole = absolute / 100n
  const fraction = String(absolute % 100n).padStart(2, '0')

  return `${negative ? '-' : ''}${whole.toString()}.${fraction}`
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
  const [activeHouseSection, setActiveHouseSection] = createSignal<HouseSectionKey>('billing')
  const [dashboard, setDashboard] = createSignal<MiniAppDashboard | null>(null)
  const [pendingMembers, setPendingMembers] = createSignal<readonly MiniAppPendingMember[]>([])
  const [adminSettings, setAdminSettings] = createSignal<MiniAppAdminSettingsPayload | null>(null)
  const [cycleState, setCycleState] = createSignal<MiniAppAdminCycleState | null>(null)
  const [joining, setJoining] = createSignal(false)
  const [approvingTelegramUserId, setApprovingTelegramUserId] = createSignal<string | null>(null)
  const [promotingMemberId, setPromotingMemberId] = createSignal<string | null>(null)
  const [savingOwnDisplayName, setSavingOwnDisplayName] = createSignal(false)
  const [savingMemberDisplayNameId, setSavingMemberDisplayNameId] = createSignal<string | null>(
    null
  )
  const [savingRentWeightMemberId, setSavingRentWeightMemberId] = createSignal<string | null>(null)
  const [savingMemberStatusId, setSavingMemberStatusId] = createSignal<string | null>(null)
  const [savingMemberAbsencePolicyId, setSavingMemberAbsencePolicyId] = createSignal<string | null>(
    null
  )
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
  const [closingCycle, setClosingCycle] = createSignal(false)
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
  const [billingSettingsOpen, setBillingSettingsOpen] = createSignal(false)
  const [cycleRentOpen, setCycleRentOpen] = createSignal(false)
  const [addingUtilityBillOpen, setAddingUtilityBillOpen] = createSignal(false)
  const [addingPaymentOpen, setAddingPaymentOpen] = createSignal(false)
  const [profileEditorOpen, setProfileEditorOpen] = createSignal(false)
  const [addingPayment, setAddingPayment] = createSignal(false)
  const [billingForm, setBillingForm] = createSignal({
    settlementCurrency: 'GEL' as 'USD' | 'GEL',
    paymentBalanceAdjustmentPolicy: 'utilities' as 'utilities' | 'rent' | 'separate',
    rentAmountMajor: '',
    rentCurrency: 'USD' as 'USD' | 'GEL',
    rentDueDay: 20,
    rentWarningDay: 17,
    utilitiesDueDay: 4,
    utilitiesReminderDay: 3,
    timezone: 'Asia/Tbilisi'
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
      const nextDashboard = await fetchMiniAppDashboard(initData)
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
      setPendingMembers(await fetchMiniAppPendingMembers(initData))
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('Failed to load pending mini app members', error)
      }

      setPendingMembers([])
    }
  }

  async function loadAdminSettings(initData: string) {
    try {
      const payload = await fetchMiniAppAdminSettings(initData)
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
        timezone: payload.settings.timezone
      })
      setPaymentForm((current) => ({
        ...current,
        memberId: current.memberId || payload.members[0]?.id || '',
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
      const payload = await fetchMiniAppBillingCycle(initData)
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

  async function refreshHouseholdData(initData: string, includeAdmin = false) {
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
      timezone: demoAdminSettings.settings.timezone
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
      const payload = await fetchMiniAppSession(initData, joinContext().joinToken)
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

  async function handleSaveMemberDisplayName(memberId: string) {
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
      const settings = await updateMiniAppBillingSettings(initData, billingForm())
      setAdminSettings((current) =>
        current
          ? {
              ...current,
              settings
            }
          : current
      )
      setCycleForm((current) => ({
        ...current,
        rentCurrency: settings.rentCurrency,
        utilityCurrency: settings.settlementCurrency
      }))
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
      setCycleRentOpen(false)
    } finally {
      setOpeningCycle(false)
    }
  }

  async function handleCloseCycle() {
    const initData = webApp?.initData?.trim()
    const currentReady = readySession()
    if (!initData || currentReady?.mode !== 'live' || !currentReady.member.isAdmin) {
      return
    }

    setClosingCycle(true)

    try {
      const state = await closeMiniAppBillingCycle(initData, cycleState()?.cycle?.period)
      setCycleState(state)
      setUtilityBillDrafts(cycleUtilityBillDrafts(state.utilityBills))
      setCycleRentOpen(false)
    } finally {
      setClosingCycle(false)
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
      await refreshHouseholdData(initData, true)
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
      await refreshHouseholdData(initData, true)
      setEditingPurchaseId((current) => (current === purchaseId ? null : current))
    } finally {
      setDeletingPurchaseId(null)
    }
  }

  async function handleAddPayment() {
    const initData = webApp?.initData?.trim()
    const currentReady = readySession()
    const draft = paymentForm()
    if (
      !initData ||
      currentReady?.mode !== 'live' ||
      !currentReady.member.isAdmin ||
      draft.memberId.trim().length === 0 ||
      draft.amountMajor.trim().length === 0
    ) {
      return
    }

    setAddingPayment(true)

    try {
      await addMiniAppPayment(initData, draft)
      setPaymentForm((current) => ({
        ...current,
        amountMajor: ''
      }))
      await refreshHouseholdData(initData, true)
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
      await refreshHouseholdData(initData, true)
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
      await refreshHouseholdData(initData, true)
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

  async function handleSaveRentWeight(memberId: string) {
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
      setEditingMemberId(null)
    } finally {
      setSavingRentWeightMemberId(null)
    }
  }

  async function handleSaveMemberStatus(memberId: string) {
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
      setEditingMemberId(null)
    } finally {
      setSavingMemberStatusId(null)
    }
  }

  async function handleSaveMemberAbsencePolicy(memberId: string) {
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
      setEditingMemberId(null)
    } finally {
      setSavingMemberAbsencePolicyId(null)
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

  const renderPanel = () => {
    switch (activeNav()) {
      case 'balances':
        return (
          <div class="balance-list">
            <ShowDashboard
              dashboard={dashboard()}
              fallback={<p>{copy().emptyDashboard}</p>}
              render={(data) => (
                <>
                  {currentMemberLine() ? (
                    <article class="balance-item balance-item--accent">
                      <header>
                        <strong>{copy().yourBalanceTitle}</strong>
                        <span>
                          {currentMemberLine()!.netDueMajor} {data.currency}
                        </span>
                      </header>
                      <p>{copy().yourBalanceBody}</p>
                      <div class="balance-breakdown">
                        <div class="stat-card">
                          <span>{copy().baseDue}</span>
                          <strong>
                            {memberBaseDueMajor(currentMemberLine()!)} {data.currency}
                          </strong>
                        </div>
                        <div class="stat-card">
                          <span>{copy().shareOffset}</span>
                          <strong>
                            {currentMemberLine()!.purchaseOffsetMajor} {data.currency}
                          </strong>
                        </div>
                        <div class="stat-card">
                          <span>{copy().finalDue}</span>
                          <strong>
                            {currentMemberLine()!.netDueMajor} {data.currency}
                          </strong>
                        </div>
                        <div class="stat-card">
                          <span>{copy().paidLabel}</span>
                          <strong>
                            {currentMemberLine()!.paidMajor} {data.currency}
                          </strong>
                        </div>
                        <div class="stat-card">
                          <span>{copy().remainingLabel}</span>
                          <strong>
                            {currentMemberLine()!.remainingMajor} {data.currency}
                          </strong>
                        </div>
                      </div>
                    </article>
                  ) : null}
                  <div class="home-grid home-grid--summary">
                    <FinanceSummaryCards
                      dashboard={data}
                      utilityTotalMajor={utilityTotalMajor()}
                      purchaseTotalMajor={purchaseTotalMajor()}
                      labels={{
                        remaining: copy().remainingLabel,
                        rent: copy().shareRent,
                        utilities: copy().shareUtilities,
                        purchases: copy().purchasesTitle
                      }}
                    />
                  </div>
                  <FinanceVisuals
                    dashboard={data}
                    memberVisuals={memberBalanceVisuals()}
                    purchaseChart={purchaseInvestmentChart()}
                    remainingClass={memberRemainingClass}
                    labels={{
                      financeVisualsTitle: copy().financeVisualsTitle,
                      financeVisualsBody: copy().financeVisualsBody,
                      membersCount: copy().membersCount,
                      purchaseInvestmentsTitle: copy().purchaseInvestmentsTitle,
                      purchaseInvestmentsBody: copy().purchaseInvestmentsBody,
                      purchaseInvestmentsEmpty: copy().purchaseInvestmentsEmpty,
                      purchaseTotalLabel: copy().purchaseTotalLabel,
                      purchaseShareLabel: copy().purchaseShareLabel
                    }}
                  />
                  <article class="balance-item">
                    <header>
                      <strong>{copy().householdBalancesTitle}</strong>
                    </header>
                    <p>{copy().householdBalancesBody}</p>
                  </article>
                  {data.members.map((member) => (
                    <article class="balance-item">
                      <header>
                        <strong>{member.displayName}</strong>
                        <span>
                          {member.remainingMajor} {data.currency}
                        </span>
                      </header>
                      <p>
                        {copy().baseDue}: {memberBaseDueMajor(member)} {data.currency}
                      </p>
                      <p>
                        {copy().shareRent}: {member.rentShareMajor} {data.currency}
                      </p>
                      <p>
                        {copy().shareUtilities}: {member.utilityShareMajor} {data.currency}
                      </p>
                      <p>
                        {copy().shareOffset}: {member.purchaseOffsetMajor} {data.currency}
                      </p>
                      <p>
                        {copy().paidLabel}: {member.paidMajor} {data.currency}
                      </p>
                      <p class={`balance-status ${memberRemainingClass(member)}`}>
                        {copy().remainingLabel}: {member.remainingMajor} {data.currency}
                      </p>
                    </article>
                  ))}
                </>
              )}
            />
          </div>
        )
      case 'ledger':
        return (
          <div class="ledger-list">
            <ShowDashboard
              dashboard={dashboard()}
              fallback={<p>{copy().emptyDashboard}</p>}
              render={() => (
                <>
                  <article class="balance-item">
                    <header>
                      <strong>
                        {readySession()?.member.isAdmin
                          ? copy().purchaseReviewTitle
                          : copy().purchasesTitle}
                      </strong>
                    </header>
                    <Show when={readySession()?.member.isAdmin}>
                      <p>{copy().purchaseReviewBody}</p>
                    </Show>
                    {purchaseLedger().length === 0 ? (
                      <p>{copy().purchasesEmpty}</p>
                    ) : (
                      <div class="ledger-list">
                        {purchaseLedger().map((entry) => (
                          <article class="ledger-compact-card">
                            <div class="ledger-compact-card__main">
                              <header>
                                <strong>{entry.title}</strong>
                                <span>{entry.occurredAt?.slice(0, 10) ?? '—'}</span>
                              </header>
                              <p>{entry.actorDisplayName ?? copy().ledgerActorFallback}</p>
                              <div class="ledger-compact-card__meta">
                                <span class="mini-chip">{ledgerPrimaryAmount(entry)}</span>
                                <Show when={ledgerSecondaryAmount(entry)}>
                                  {(secondary) => (
                                    <span class="mini-chip mini-chip--muted">{secondary()}</span>
                                  )}
                                </Show>
                                <Show when={entry.kind === 'purchase'}>
                                  <span class="mini-chip mini-chip--muted">
                                    {purchaseParticipantSummary(entry)}
                                  </span>
                                </Show>
                              </div>
                            </div>
                            <Show when={readySession()?.member.isAdmin}>
                              <div class="ledger-compact-card__actions">
                                <IconButton
                                  label={copy().editEntryAction}
                                  onClick={() => setEditingPurchaseId(entry.id)}
                                >
                                  ...
                                </IconButton>
                              </div>
                            </Show>
                          </article>
                        ))}
                      </div>
                    )}
                  </article>
                  <Modal
                    open={Boolean(editingPurchaseEntry())}
                    title={copy().purchaseReviewTitle}
                    description={copy().purchaseEditorBody}
                    closeLabel={copy().closeEditorAction}
                    onClose={() => setEditingPurchaseId(null)}
                    footer={(() => {
                      const entry = editingPurchaseEntry()

                      if (!entry) {
                        return null
                      }

                      return (
                        <div class="modal-action-row">
                          <Button
                            variant="danger"
                            onClick={() => void handleDeletePurchase(entry.id)}
                          >
                            {deletingPurchaseId() === entry.id
                              ? copy().deletingPurchase
                              : copy().purchaseDeleteAction}
                          </Button>
                          <div class="modal-action-row__primary">
                            <Button variant="ghost" onClick={() => setEditingPurchaseId(null)}>
                              {copy().closeEditorAction}
                            </Button>
                            <Button
                              variant="primary"
                              disabled={savingPurchaseId() === entry.id}
                              onClick={() => void handleUpdatePurchase(entry.id)}
                            >
                              {savingPurchaseId() === entry.id
                                ? copy().savingPurchase
                                : copy().purchaseSaveAction}
                            </Button>
                          </div>
                        </div>
                      )
                    })()}
                  >
                    {(() => {
                      const entry = editingPurchaseEntry()

                      if (!entry) {
                        return null
                      }

                      const draft = purchaseDraftMap()[entry.id] ?? purchaseDraftForEntry(entry)
                      const splitPreview = purchaseSplitPreview(entry.id)

                      return (
                        <>
                          <div class="editor-grid">
                            <Field label={copy().purchaseReviewTitle} wide>
                              <input
                                value={draft.description}
                                onInput={(event) =>
                                  updatePurchaseDraft(entry.id, entry, (current) => ({
                                    ...current,
                                    description: event.currentTarget.value
                                  }))
                                }
                              />
                            </Field>
                            <Field label={copy().paymentAmount}>
                              <input
                                value={draft.amountMajor}
                                onInput={(event) =>
                                  updatePurchaseDraft(entry.id, entry, (current) => ({
                                    ...current,
                                    amountMajor: event.currentTarget.value
                                  }))
                                }
                              />
                            </Field>
                            <Field label={copy().settlementCurrency}>
                              <select
                                value={draft.currency}
                                onChange={(event) =>
                                  updatePurchaseDraft(entry.id, entry, (current) => ({
                                    ...current,
                                    currency: event.currentTarget.value as 'USD' | 'GEL'
                                  }))
                                }
                              >
                                <option value="GEL">GEL</option>
                                <option value="USD">USD</option>
                              </select>
                            </Field>
                          </div>

                          <section class="editor-panel">
                            <header class="editor-panel__header">
                              <strong>{copy().purchaseSplitTitle}</strong>
                              <span>
                                {draft.splitMode === 'custom_amounts'
                                  ? copy().purchaseSplitCustom
                                  : copy().purchaseSplitEqual}
                              </span>
                            </header>
                            <div class="editor-grid">
                              <Field label={copy().purchaseSplitModeLabel} wide>
                                <select
                                  value={draft.splitMode}
                                  onChange={(event) =>
                                    updatePurchaseDraft(entry.id, entry, (current) => ({
                                      ...current,
                                      splitMode: event.currentTarget.value as
                                        | 'equal'
                                        | 'custom_amounts'
                                    }))
                                  }
                                >
                                  <option value="equal">{copy().purchaseSplitEqual}</option>
                                  <option value="custom_amounts">
                                    {copy().purchaseSplitCustom}
                                  </option>
                                </select>
                              </Field>
                            </div>
                            <div class="participant-list">
                              {(adminSettings()?.members ?? []).map((member) => {
                                const included = draft.participants.some(
                                  (participant) => participant.memberId === member.id
                                )
                                const previewAmount =
                                  splitPreview.find(
                                    (participant) => participant.memberId === member.id
                                  )?.amountMajor ?? '0.00'

                                return (
                                  <article class="participant-card">
                                    <header>
                                      <strong>{member.displayName}</strong>
                                      <span>
                                        {previewAmount} {draft.currency}
                                      </span>
                                    </header>
                                    <div class="participant-card__controls">
                                      <Button
                                        variant={included ? 'primary' : 'secondary'}
                                        onClick={() =>
                                          togglePurchaseParticipant(
                                            entry.id,
                                            entry,
                                            member.id,
                                            !included
                                          )
                                        }
                                      >
                                        {included
                                          ? copy().participantIncluded
                                          : copy().participantExcluded}
                                      </Button>
                                      <Show when={included && draft.splitMode === 'custom_amounts'}>
                                        <Field
                                          label={copy().purchaseCustomShareLabel}
                                          class="participant-card__field"
                                        >
                                          <input
                                            value={
                                              draft.participants.find(
                                                (participant) => participant.memberId === member.id
                                              )?.shareAmountMajor ?? ''
                                            }
                                            onInput={(event) =>
                                              updatePurchaseDraft(entry.id, entry, (current) => ({
                                                ...current,
                                                participants: current.participants.map(
                                                  (participant) =>
                                                    participant.memberId === member.id
                                                      ? {
                                                          ...participant,
                                                          shareAmountMajor:
                                                            event.currentTarget.value
                                                        }
                                                      : participant
                                                )
                                              }))
                                            }
                                          />
                                        </Field>
                                      </Show>
                                    </div>
                                  </article>
                                )
                              })}
                            </div>
                          </section>
                        </>
                      )
                    })()}
                  </Modal>
                  <article class="balance-item">
                    <header>
                      <strong>{copy().utilityLedgerTitle}</strong>
                    </header>
                    {utilityLedger().length === 0 ? (
                      <p>{copy().utilityLedgerEmpty}</p>
                    ) : (
                      <div class="ledger-list">
                        {utilityLedger().map((entry) => (
                          <article class="ledger-item">
                            <header>
                              <strong>{ledgerTitle(entry)}</strong>
                              <span>{ledgerPrimaryAmount(entry)}</span>
                            </header>
                            <Show when={ledgerSecondaryAmount(entry)}>
                              {(secondary) => <p>{secondary()}</p>}
                            </Show>
                            <p>{entry.actorDisplayName ?? copy().ledgerActorFallback}</p>
                          </article>
                        ))}
                      </div>
                    )}
                  </article>
                  <article class="balance-item">
                    <header>
                      <strong>{copy().paymentsAdminTitle}</strong>
                    </header>
                    <Show when={readySession()?.member.isAdmin}>
                      <p>{copy().paymentsAdminBody}</p>
                      <div class="panel-toolbar">
                        <Button variant="secondary" onClick={() => setAddingPaymentOpen(true)}>
                          {copy().paymentsAddAction}
                        </Button>
                      </div>
                    </Show>
                    {paymentLedger().length === 0 ? (
                      <p>{copy().paymentsEmpty}</p>
                    ) : (
                      <div class="ledger-list">
                        {paymentLedger().map((entry) => (
                          <article class="ledger-compact-card">
                            <div class="ledger-compact-card__main">
                              <header>
                                <strong>{paymentMemberName(entry)}</strong>
                                <span>{entry.occurredAt?.slice(0, 10) ?? '—'}</span>
                              </header>
                              <p>{ledgerTitle(entry)}</p>
                              <div class="ledger-compact-card__meta">
                                <span class="mini-chip">{ledgerPrimaryAmount(entry)}</span>
                                <Show when={ledgerSecondaryAmount(entry)}>
                                  {(secondary) => (
                                    <span class="mini-chip mini-chip--muted">{secondary()}</span>
                                  )}
                                </Show>
                              </div>
                            </div>
                            <Show when={readySession()?.member.isAdmin}>
                              <div class="ledger-compact-card__actions">
                                <IconButton
                                  label={copy().editEntryAction}
                                  onClick={() => setEditingPaymentId(entry.id)}
                                >
                                  ...
                                </IconButton>
                              </div>
                            </Show>
                          </article>
                        ))}
                      </div>
                    )}
                  </article>
                  <Modal
                    open={addingPaymentOpen()}
                    title={copy().paymentsAddAction}
                    description={copy().paymentCreateBody}
                    closeLabel={copy().closeEditorAction}
                    onClose={() => setAddingPaymentOpen(false)}
                    footer={
                      <div class="modal-action-row modal-action-row--single">
                        <Button variant="ghost" onClick={() => setAddingPaymentOpen(false)}>
                          {copy().closeEditorAction}
                        </Button>
                        <Button
                          variant="primary"
                          disabled={
                            addingPayment() || paymentForm().amountMajor.trim().length === 0
                          }
                          onClick={() => void handleAddPayment()}
                        >
                          {addingPayment() ? copy().addingPayment : copy().paymentsAddAction}
                        </Button>
                      </div>
                    }
                  >
                    <div class="editor-grid">
                      <Field label={copy().paymentMember} wide>
                        <select
                          value={paymentForm().memberId}
                          onChange={(event) =>
                            setPaymentForm((current) => ({
                              ...current,
                              memberId: event.currentTarget.value
                            }))
                          }
                        >
                          {adminSettings()?.members.map((member) => (
                            <option value={member.id}>{member.displayName}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label={copy().paymentKind}>
                        <select
                          value={paymentForm().kind}
                          onChange={(event) =>
                            setPaymentForm((current) => ({
                              ...current,
                              kind: event.currentTarget.value as 'rent' | 'utilities'
                            }))
                          }
                        >
                          <option value="rent">{copy().paymentLedgerRent}</option>
                          <option value="utilities">{copy().paymentLedgerUtilities}</option>
                        </select>
                      </Field>
                      <Field label={copy().paymentAmount}>
                        <input
                          value={paymentForm().amountMajor}
                          onInput={(event) =>
                            setPaymentForm((current) => ({
                              ...current,
                              amountMajor: event.currentTarget.value
                            }))
                          }
                        />
                      </Field>
                      <Field label={copy().settlementCurrency}>
                        <select
                          value={paymentForm().currency}
                          onChange={(event) =>
                            setPaymentForm((current) => ({
                              ...current,
                              currency: event.currentTarget.value as 'USD' | 'GEL'
                            }))
                          }
                        >
                          <option value="GEL">GEL</option>
                          <option value="USD">USD</option>
                        </select>
                      </Field>
                    </div>
                  </Modal>
                  <Modal
                    open={Boolean(editingPaymentEntry())}
                    title={copy().paymentsAdminTitle}
                    description={copy().paymentEditorBody}
                    closeLabel={copy().closeEditorAction}
                    onClose={() => setEditingPaymentId(null)}
                    footer={(() => {
                      const entry = editingPaymentEntry()

                      if (!entry) {
                        return null
                      }

                      return (
                        <div class="modal-action-row">
                          <Button
                            variant="danger"
                            onClick={() => void handleDeletePayment(entry.id)}
                          >
                            {deletingPaymentId() === entry.id
                              ? copy().deletingPayment
                              : copy().paymentDeleteAction}
                          </Button>
                          <div class="modal-action-row__primary">
                            <Button variant="ghost" onClick={() => setEditingPaymentId(null)}>
                              {copy().closeEditorAction}
                            </Button>
                            <Button
                              variant="primary"
                              disabled={savingPaymentId() === entry.id}
                              onClick={() => void handleUpdatePayment(entry.id)}
                            >
                              {savingPaymentId() === entry.id
                                ? copy().addingPayment
                                : copy().paymentSaveAction}
                            </Button>
                          </div>
                        </div>
                      )
                    })()}
                  >
                    {(() => {
                      const entry = editingPaymentEntry()

                      if (!entry) {
                        return null
                      }

                      const draft = paymentDraftMap()[entry.id] ?? paymentDraftForEntry(entry)

                      return (
                        <div class="editor-grid">
                          <Field label={copy().paymentMember} wide>
                            <select
                              value={draft.memberId}
                              onChange={(event) =>
                                updatePaymentDraft(entry.id, entry, (current) => ({
                                  ...current,
                                  memberId: event.currentTarget.value
                                }))
                              }
                            >
                              {adminSettings()?.members.map((member) => (
                                <option value={member.id}>{member.displayName}</option>
                              ))}
                            </select>
                          </Field>
                          <Field label={copy().paymentKind}>
                            <select
                              value={draft.kind}
                              onChange={(event) =>
                                updatePaymentDraft(entry.id, entry, (current) => ({
                                  ...current,
                                  kind: event.currentTarget.value as 'rent' | 'utilities'
                                }))
                              }
                            >
                              <option value="rent">{copy().paymentLedgerRent}</option>
                              <option value="utilities">{copy().paymentLedgerUtilities}</option>
                            </select>
                          </Field>
                          <Field label={copy().paymentAmount}>
                            <input
                              value={draft.amountMajor}
                              onInput={(event) =>
                                updatePaymentDraft(entry.id, entry, (current) => ({
                                  ...current,
                                  amountMajor: event.currentTarget.value
                                }))
                              }
                            />
                          </Field>
                          <Field label={copy().settlementCurrency}>
                            <select
                              value={draft.currency}
                              onChange={(event) =>
                                updatePaymentDraft(entry.id, entry, (current) => ({
                                  ...current,
                                  currency: event.currentTarget.value as 'USD' | 'GEL'
                                }))
                              }
                            >
                              <option value="GEL">GEL</option>
                              <option value="USD">USD</option>
                            </select>
                          </Field>
                        </div>
                      )
                    })()}
                  </Modal>
                </>
              )}
            />
          </div>
        )
      case 'house':
        return readySession()?.member.isAdmin ? (
          <div class="admin-layout">
            <article class="balance-item balance-item--accent admin-hero">
              <header>
                <strong>{copy().householdSettingsTitle}</strong>
                <span>{adminSettings()?.settings.settlementCurrency ?? '—'}</span>
              </header>
              <p>{copy().householdSettingsBody}</p>
              <div class="admin-summary-grid">
                <article class="stat-card">
                  <span>{copy().billingCycleTitle}</span>
                  <strong>{cycleState()?.cycle?.period ?? copy().billingCycleEmpty}</strong>
                </article>
                <article class="stat-card">
                  <span>{copy().settlementCurrency}</span>
                  <strong>{adminSettings()?.settings.settlementCurrency ?? '—'}</strong>
                </article>
                <article class="stat-card">
                  <span>{copy().membersCount}</span>
                  <strong>{String(adminSettings()?.members.length ?? 0)}</strong>
                </article>
                <article class="stat-card">
                  <span>{copy().pendingRequests}</span>
                  <strong>{String(pendingMembers().length)}</strong>
                </article>
              </div>
            </article>

            <div class="section-switch">
              {(
                [
                  ['billing', copy().houseSectionBilling],
                  ['utilities', copy().houseSectionUtilities],
                  ['members', copy().houseSectionMembers],
                  ['topics', copy().houseSectionTopics]
                ] as const
              ).map(([key, label]) => (
                <button
                  classList={{ 'is-active': activeHouseSection() === key }}
                  type="button"
                  onClick={() => setActiveHouseSection(key)}
                >
                  {label}
                </button>
              ))}
            </div>

            <Show when={activeHouseSection() === 'billing'}>
              <section class="admin-section">
                <header class="admin-section__header">
                  <div>
                    <h3>{copy().billingCycleTitle}</h3>
                    <p>{copy().billingSettingsTitle}</p>
                  </div>
                </header>
                <div class="admin-grid">
                  <article class="balance-item">
                    <header>
                      <strong>{copy().billingCycleTitle}</strong>
                      <span>{cycleState()?.cycle?.period ?? copy().billingCycleEmpty}</span>
                    </header>
                    <p>
                      {cycleState()?.cycle
                        ? copy().billingCycleStatus.replace(
                            '{currency}',
                            cycleState()?.cycle?.currency ?? billingForm().settlementCurrency
                          )
                        : copy().billingCycleOpenHint}
                    </p>
                    <Show when={dashboard()}>
                      {(data) => (
                        <p>
                          {copy().shareRent}: {data().rentSourceAmountMajor}{' '}
                          {data().rentSourceCurrency}
                          {data().rentSourceCurrency !== data().currency
                            ? ` -> ${data().rentDisplayAmountMajor} ${data().currency}`
                            : ''}
                        </p>
                      )}
                    </Show>
                    <div class="panel-toolbar">
                      <Button variant="secondary" onClick={() => setCycleRentOpen(true)}>
                        {cycleState()?.cycle ? copy().manageCycleAction : copy().openCycleAction}
                      </Button>
                      <Show when={cycleState()?.cycle}>
                        <Button
                          variant="ghost"
                          disabled={closingCycle()}
                          onClick={() => void handleCloseCycle()}
                        >
                          {closingCycle() ? copy().closingCycle : copy().closeCycleAction}
                        </Button>
                      </Show>
                    </div>
                  </article>

                  <article class="balance-item">
                    <header>
                      <strong>{copy().billingSettingsTitle}</strong>
                      <span>{billingForm().settlementCurrency}</span>
                    </header>
                    <p>
                      {billingForm().paymentBalanceAdjustmentPolicy === 'utilities'
                        ? copy().paymentBalanceAdjustmentUtilities
                        : billingForm().paymentBalanceAdjustmentPolicy === 'rent'
                          ? copy().paymentBalanceAdjustmentRent
                          : copy().paymentBalanceAdjustmentSeparate}
                    </p>
                    <div class="ledger-compact-card__meta">
                      <span class="mini-chip">
                        {copy().rentAmount}: {billingForm().rentAmountMajor || '—'}{' '}
                        {billingForm().rentCurrency}
                      </span>
                      <span class="mini-chip mini-chip--muted">
                        {copy().timezone}: {billingForm().timezone}
                      </span>
                    </div>
                    <div class="panel-toolbar">
                      <Button variant="secondary" onClick={() => setBillingSettingsOpen(true)}>
                        {copy().manageSettingsAction}
                      </Button>
                    </div>
                  </article>

                  <article class="balance-item">
                    <header>
                      <strong>{copy().householdLanguage}</strong>
                      <span>{readySession()?.member.householdDefaultLocale.toUpperCase()}</span>
                    </header>
                    <p>{copy().householdSettingsBody}</p>
                    <div class="locale-switch__buttons">
                      <button
                        classList={{
                          'is-active': readySession()?.member.householdDefaultLocale === 'en'
                        }}
                        type="button"
                        disabled={savingHouseholdLocale()}
                        onClick={() => void handleHouseholdLocaleChange('en')}
                      >
                        EN
                      </button>
                      <button
                        classList={{
                          'is-active': readySession()?.member.householdDefaultLocale === 'ru'
                        }}
                        type="button"
                        disabled={savingHouseholdLocale()}
                        onClick={() => void handleHouseholdLocaleChange('ru')}
                      >
                        RU
                      </button>
                    </div>
                  </article>
                </div>
                <Modal
                  open={cycleRentOpen()}
                  title={copy().billingCycleTitle}
                  description={copy().cycleEditorBody}
                  closeLabel={copy().closeEditorAction}
                  onClose={() => setCycleRentOpen(false)}
                  footer={
                    cycleState()?.cycle ? (
                      <div class="modal-action-row modal-action-row--single">
                        <Button variant="ghost" onClick={() => setCycleRentOpen(false)}>
                          {copy().closeEditorAction}
                        </Button>
                        <Button
                          variant="primary"
                          disabled={
                            savingCycleRent() || cycleForm().rentAmountMajor.trim().length === 0
                          }
                          onClick={() => void handleSaveCycleRent()}
                        >
                          {savingCycleRent() ? copy().savingCycleRent : copy().saveCycleRentAction}
                        </Button>
                      </div>
                    ) : (
                      <div class="modal-action-row modal-action-row--single">
                        <Button variant="ghost" onClick={() => setCycleRentOpen(false)}>
                          {copy().closeEditorAction}
                        </Button>
                        <Button
                          variant="primary"
                          disabled={openingCycle()}
                          onClick={() => void handleOpenCycle()}
                        >
                          {openingCycle() ? copy().openingCycle : copy().openCycleAction}
                        </Button>
                      </div>
                    )
                  }
                >
                  {cycleState()?.cycle ? (
                    <div class="editor-grid">
                      <Field label={copy().rentAmount}>
                        <input
                          value={cycleForm().rentAmountMajor}
                          onInput={(event) =>
                            setCycleForm((current) => ({
                              ...current,
                              rentAmountMajor: event.currentTarget.value
                            }))
                          }
                        />
                      </Field>
                      <Field label={copy().shareRent}>
                        <select
                          value={cycleForm().rentCurrency}
                          onChange={(event) =>
                            setCycleForm((current) => ({
                              ...current,
                              rentCurrency: event.currentTarget.value as 'USD' | 'GEL'
                            }))
                          }
                        >
                          <option value="USD">USD</option>
                          <option value="GEL">GEL</option>
                        </select>
                      </Field>
                    </div>
                  ) : (
                    <div class="editor-grid">
                      <Field label={copy().billingCyclePeriod}>
                        <input
                          value={cycleForm().period}
                          onInput={(event) =>
                            setCycleForm((current) => ({
                              ...current,
                              period: event.currentTarget.value
                            }))
                          }
                        />
                      </Field>
                      <Field label={copy().settlementCurrency}>
                        <div class="settings-field__value">{billingForm().settlementCurrency}</div>
                      </Field>
                    </div>
                  )}
                </Modal>
                <Modal
                  open={billingSettingsOpen()}
                  title={copy().billingSettingsTitle}
                  description={copy().billingSettingsEditorBody}
                  closeLabel={copy().closeEditorAction}
                  onClose={() => setBillingSettingsOpen(false)}
                  footer={
                    <div class="modal-action-row modal-action-row--single">
                      <Button variant="ghost" onClick={() => setBillingSettingsOpen(false)}>
                        {copy().closeEditorAction}
                      </Button>
                      <Button
                        variant="primary"
                        disabled={savingBillingSettings()}
                        onClick={() => void handleSaveBillingSettings()}
                      >
                        {savingBillingSettings()
                          ? copy().savingSettings
                          : copy().saveSettingsAction}
                      </Button>
                    </div>
                  }
                >
                  <div class="editor-grid">
                    <Field label={copy().settlementCurrency}>
                      <select
                        value={billingForm().settlementCurrency}
                        onChange={(event) =>
                          setBillingForm((current) => ({
                            ...current,
                            settlementCurrency: event.currentTarget.value as 'USD' | 'GEL'
                          }))
                        }
                      >
                        <option value="GEL">GEL</option>
                        <option value="USD">USD</option>
                      </select>
                    </Field>
                    <Field label={copy().paymentBalanceAdjustmentPolicy} wide>
                      <select
                        value={billingForm().paymentBalanceAdjustmentPolicy}
                        onChange={(event) =>
                          setBillingForm((current) => ({
                            ...current,
                            paymentBalanceAdjustmentPolicy: event.currentTarget.value as
                              | 'utilities'
                              | 'rent'
                              | 'separate'
                          }))
                        }
                      >
                        <option value="utilities">
                          {copy().paymentBalanceAdjustmentUtilities}
                        </option>
                        <option value="rent">{copy().paymentBalanceAdjustmentRent}</option>
                        <option value="separate">{copy().paymentBalanceAdjustmentSeparate}</option>
                      </select>
                    </Field>
                    <Field label={copy().rentAmount}>
                      <input
                        value={billingForm().rentAmountMajor}
                        onInput={(event) =>
                          setBillingForm((current) => ({
                            ...current,
                            rentAmountMajor: event.currentTarget.value
                          }))
                        }
                      />
                    </Field>
                    <Field label={copy().shareRent}>
                      <select
                        value={billingForm().rentCurrency}
                        onChange={(event) =>
                          setBillingForm((current) => ({
                            ...current,
                            rentCurrency: event.currentTarget.value as 'USD' | 'GEL'
                          }))
                        }
                      >
                        <option value="USD">USD</option>
                        <option value="GEL">GEL</option>
                      </select>
                    </Field>
                    <Field label={copy().rentDueDay}>
                      <input
                        type="number"
                        min="1"
                        max="31"
                        value={String(billingForm().rentDueDay)}
                        onInput={(event) =>
                          setBillingForm((current) => ({
                            ...current,
                            rentDueDay: Number(event.currentTarget.value)
                          }))
                        }
                      />
                    </Field>
                    <Field label={copy().rentWarningDay}>
                      <input
                        type="number"
                        min="1"
                        max="31"
                        value={String(billingForm().rentWarningDay)}
                        onInput={(event) =>
                          setBillingForm((current) => ({
                            ...current,
                            rentWarningDay: Number(event.currentTarget.value)
                          }))
                        }
                      />
                    </Field>
                    <Field label={copy().utilitiesDueDay}>
                      <input
                        type="number"
                        min="1"
                        max="31"
                        value={String(billingForm().utilitiesDueDay)}
                        onInput={(event) =>
                          setBillingForm((current) => ({
                            ...current,
                            utilitiesDueDay: Number(event.currentTarget.value)
                          }))
                        }
                      />
                    </Field>
                    <Field label={copy().utilitiesReminderDay}>
                      <input
                        type="number"
                        min="1"
                        max="31"
                        value={String(billingForm().utilitiesReminderDay)}
                        onInput={(event) =>
                          setBillingForm((current) => ({
                            ...current,
                            utilitiesReminderDay: Number(event.currentTarget.value)
                          }))
                        }
                      />
                    </Field>
                    <Field label={copy().timezone} wide>
                      <input
                        value={billingForm().timezone}
                        onInput={(event) =>
                          setBillingForm((current) => ({
                            ...current,
                            timezone: event.currentTarget.value
                          }))
                        }
                      />
                    </Field>
                  </div>
                </Modal>
              </section>
            </Show>

            <Show when={activeHouseSection() === 'utilities'}>
              <section class="admin-section">
                <header class="admin-section__header">
                  <div>
                    <h3>{copy().utilityCategoriesTitle}</h3>
                    <p>{copy().utilityCategoriesBody}</p>
                  </div>
                </header>
                <div class="admin-grid">
                  <article class="balance-item">
                    <header>
                      <strong>{copy().utilityLedgerTitle}</strong>
                      <span>{cycleForm().utilityCurrency}</span>
                    </header>
                    <p>{copy().utilityBillsEditorBody}</p>
                    <div class="panel-toolbar">
                      <Button variant="secondary" onClick={() => setAddingUtilityBillOpen(true)}>
                        {copy().addUtilityBillAction}
                      </Button>
                    </div>
                    <div class="ledger-list">
                      {cycleState()?.utilityBills.length ? (
                        cycleState()?.utilityBills.map((bill) => (
                          <article class="ledger-compact-card">
                            <div class="ledger-compact-card__main">
                              <header>
                                <strong>{bill.billName}</strong>
                                <span>{bill.createdAt.slice(0, 10)}</span>
                              </header>
                              <p>{copy().utilityCategoryName}</p>
                              <div class="ledger-compact-card__meta">
                                <span class="mini-chip">
                                  {minorToMajorString(BigInt(bill.amountMinor))} {bill.currency}
                                </span>
                              </div>
                            </div>
                            <div class="ledger-compact-card__actions">
                              <IconButton
                                label={copy().editUtilityBillAction}
                                onClick={() => setEditingUtilityBillId(bill.id)}
                              >
                                ...
                              </IconButton>
                            </div>
                          </article>
                        ))
                      ) : (
                        <p>{copy().utilityBillsEmpty}</p>
                      )}
                    </div>
                  </article>

                  <article class="balance-item">
                    <header>
                      <strong>{copy().utilityCategoriesTitle}</strong>
                      <span>{String(adminSettings()?.categories.length ?? 0)}</span>
                    </header>
                    <p>{copy().utilityCategoriesBody}</p>
                    <div class="panel-toolbar">
                      <Button variant="secondary" onClick={() => setEditingCategorySlug('__new__')}>
                        {copy().addCategoryAction}
                      </Button>
                    </div>
                    <div class="ledger-list">
                      {adminSettings()?.categories.map((category) => (
                        <article class="ledger-compact-card">
                          <div class="ledger-compact-card__main">
                            <header>
                              <strong>{category.name}</strong>
                              <span>{category.isActive ? 'ON' : 'OFF'}</span>
                            </header>
                            <p>{copy().utilityCategoryName}</p>
                            <div class="ledger-compact-card__meta">
                              <span
                                class={`mini-chip ${category.isActive ? '' : 'mini-chip--muted'}`}
                              >
                                {category.isActive ? 'ON' : 'OFF'}
                              </span>
                            </div>
                          </div>
                          <div class="ledger-compact-card__actions">
                            <IconButton
                              label={copy().editCategoryAction}
                              onClick={() => setEditingCategorySlug(category.slug)}
                            >
                              ...
                            </IconButton>
                          </div>
                        </article>
                      ))}
                    </div>
                  </article>
                </div>
                <Modal
                  open={addingUtilityBillOpen()}
                  title={copy().addUtilityBillAction}
                  description={copy().utilityBillCreateBody}
                  closeLabel={copy().closeEditorAction}
                  onClose={() => setAddingUtilityBillOpen(false)}
                  footer={
                    <div class="modal-action-row modal-action-row--single">
                      <Button variant="ghost" onClick={() => setAddingUtilityBillOpen(false)}>
                        {copy().closeEditorAction}
                      </Button>
                      <Button
                        variant="primary"
                        disabled={
                          savingUtilityBill() || cycleForm().utilityAmountMajor.trim().length === 0
                        }
                        onClick={() => void handleAddUtilityBill()}
                      >
                        {savingUtilityBill()
                          ? copy().savingUtilityBill
                          : copy().addUtilityBillAction}
                      </Button>
                    </div>
                  }
                >
                  <div class="editor-grid">
                    <Field label={copy().utilityCategoryLabel}>
                      <select
                        value={cycleForm().utilityCategorySlug}
                        onChange={(event) =>
                          setCycleForm((current) => ({
                            ...current,
                            utilityCategorySlug: event.currentTarget.value
                          }))
                        }
                      >
                        {adminSettings()
                          ?.categories.filter((category) => category.isActive)
                          .map((category) => (
                            <option value={category.slug}>{category.name}</option>
                          ))}
                      </select>
                    </Field>
                    <Field label={copy().utilityAmount}>
                      <input
                        value={cycleForm().utilityAmountMajor}
                        onInput={(event) =>
                          setCycleForm((current) => ({
                            ...current,
                            utilityAmountMajor: event.currentTarget.value
                          }))
                        }
                      />
                    </Field>
                    <Field label={copy().settlementCurrency}>
                      <select
                        value={cycleForm().utilityCurrency}
                        onChange={(event) =>
                          setCycleForm((current) => ({
                            ...current,
                            utilityCurrency: event.currentTarget.value as 'USD' | 'GEL'
                          }))
                        }
                      >
                        <option value="GEL">GEL</option>
                        <option value="USD">USD</option>
                      </select>
                    </Field>
                  </div>
                </Modal>
                <Modal
                  open={Boolean(editingUtilityBill())}
                  title={copy().utilityLedgerTitle}
                  description={copy().utilityBillEditorBody}
                  closeLabel={copy().closeEditorAction}
                  onClose={() => setEditingUtilityBillId(null)}
                  footer={(() => {
                    const bill = editingUtilityBill()
                    if (!bill) {
                      return null
                    }
                    return (
                      <div class="modal-action-row">
                        <Button
                          variant="danger"
                          onClick={() => void handleDeleteUtilityBill(bill.id)}
                        >
                          {deletingUtilityBillId() === bill.id
                            ? copy().deletingUtilityBill
                            : copy().deleteUtilityBillAction}
                        </Button>
                        <div class="modal-action-row__primary">
                          <Button variant="ghost" onClick={() => setEditingUtilityBillId(null)}>
                            {copy().closeEditorAction}
                          </Button>
                          <Button
                            variant="primary"
                            disabled={savingUtilityBillId() === bill.id}
                            onClick={() => void handleUpdateUtilityBill(bill.id)}
                          >
                            {savingUtilityBillId() === bill.id
                              ? copy().savingUtilityBill
                              : copy().saveUtilityBillAction}
                          </Button>
                        </div>
                      </div>
                    )
                  })()}
                >
                  {(() => {
                    const bill = editingUtilityBill()
                    if (!bill) {
                      return null
                    }
                    const draft = utilityBillDrafts()[bill.id] ?? {
                      billName: bill.billName,
                      amountMajor: minorToMajorString(BigInt(bill.amountMinor)),
                      currency: bill.currency
                    }
                    return (
                      <div class="editor-grid">
                        <Field label={copy().utilityCategoryName} wide>
                          <input
                            value={draft.billName}
                            onInput={(event) =>
                              updateUtilityBillDraft(bill.id, bill, (current) => ({
                                ...current,
                                billName: event.currentTarget.value
                              }))
                            }
                          />
                        </Field>
                        <Field label={copy().utilityAmount}>
                          <input
                            value={draft.amountMajor}
                            onInput={(event) =>
                              updateUtilityBillDraft(bill.id, bill, (current) => ({
                                ...current,
                                amountMajor: event.currentTarget.value
                              }))
                            }
                          />
                        </Field>
                        <Field label={copy().settlementCurrency}>
                          <select
                            value={draft.currency}
                            onChange={(event) =>
                              updateUtilityBillDraft(bill.id, bill, (current) => ({
                                ...current,
                                currency: event.currentTarget.value as 'USD' | 'GEL'
                              }))
                            }
                          >
                            <option value="GEL">GEL</option>
                            <option value="USD">USD</option>
                          </select>
                        </Field>
                      </div>
                    )
                  })()}
                </Modal>
                <Modal
                  open={Boolean(editingCategorySlug())}
                  title={
                    editingCategorySlug() === '__new__'
                      ? copy().addCategoryAction
                      : copy().utilityCategoriesTitle
                  }
                  description={
                    editingCategorySlug() === '__new__'
                      ? copy().categoryCreateBody
                      : copy().categoryEditorBody
                  }
                  closeLabel={copy().closeEditorAction}
                  onClose={() => setEditingCategorySlug(null)}
                  footer={(() => {
                    const category = editingCategory()
                    const isNew = editingCategorySlug() === '__new__'
                    return (
                      <div class="modal-action-row modal-action-row--single">
                        <Button variant="ghost" onClick={() => setEditingCategorySlug(null)}>
                          {copy().closeEditorAction}
                        </Button>
                        <Button
                          variant="primary"
                          disabled={
                            isNew
                              ? newCategoryName().trim().length === 0 ||
                                savingCategorySlug() === '__new__'
                              : !category || savingCategorySlug() === category.slug
                          }
                          onClick={() =>
                            void handleSaveUtilityCategory(
                              isNew
                                ? {
                                    name: newCategoryName(),
                                    sortOrder: adminSettings()?.categories.length ?? 0,
                                    isActive: true
                                  }
                                : {
                                    slug: category!.slug,
                                    name: category!.name,
                                    sortOrder: category!.sortOrder,
                                    isActive: category!.isActive
                                  }
                            )
                          }
                        >
                          {savingCategorySlug() === (isNew ? '__new__' : (category?.slug ?? null))
                            ? copy().savingCategory
                            : isNew
                              ? copy().addCategoryAction
                              : copy().saveCategoryAction}
                        </Button>
                      </div>
                    )
                  })()}
                >
                  {editingCategorySlug() === '__new__' ? (
                    <div class="editor-grid">
                      <Field label={copy().utilityCategoryName} wide>
                        <input
                          value={newCategoryName()}
                          onInput={(event) => setNewCategoryName(event.currentTarget.value)}
                        />
                      </Field>
                    </div>
                  ) : (
                    (() => {
                      const category = editingCategory()
                      if (!category) {
                        return null
                      }
                      return (
                        <div class="editor-grid">
                          <Field label={copy().utilityCategoryName} wide>
                            <input
                              value={category.name}
                              onInput={(event) =>
                                setAdminSettings((current) =>
                                  current
                                    ? {
                                        ...current,
                                        categories: current.categories.map((item) =>
                                          item.slug === category.slug
                                            ? {
                                                ...item,
                                                name: event.currentTarget.value
                                              }
                                            : item
                                        )
                                      }
                                    : current
                                )
                              }
                            />
                          </Field>
                          <Field label={copy().utilityCategoryActive}>
                            <select
                              value={category.isActive ? 'true' : 'false'}
                              onChange={(event) =>
                                setAdminSettings((current) =>
                                  current
                                    ? {
                                        ...current,
                                        categories: current.categories.map((item) =>
                                          item.slug === category.slug
                                            ? {
                                                ...item,
                                                isActive: event.currentTarget.value === 'true'
                                              }
                                            : item
                                        )
                                      }
                                    : current
                                )
                              }
                            >
                              <option value="true">ON</option>
                              <option value="false">OFF</option>
                            </select>
                          </Field>
                        </div>
                      )
                    })()
                  )}
                </Modal>
              </section>
            </Show>

            <Show when={activeHouseSection() === 'members'}>
              <section class="admin-section">
                <header class="admin-section__header">
                  <div>
                    <h3>{copy().adminsTitle}</h3>
                    <p>{copy().adminsBody}</p>
                  </div>
                </header>
                <div class="admin-grid">
                  <article class="balance-item admin-card--wide">
                    <header>
                      <strong>{copy().adminsTitle}</strong>
                      <span>{String(adminSettings()?.members.length ?? 0)}</span>
                    </header>
                    <div class="ledger-list">
                      {adminSettings()?.members.map((member) => (
                        <article class="ledger-compact-card">
                          <div class="ledger-compact-card__main">
                            <header>
                              <strong>{member.displayName}</strong>
                              <span>{member.isAdmin ? copy().adminTag : copy().residentTag}</span>
                            </header>
                            <p>{memberStatusLabel(member.status)}</p>
                            <div class="ledger-compact-card__meta">
                              <span class="mini-chip">
                                {copy().rentWeightLabel}: {member.rentShareWeight}
                              </span>
                              <span class="mini-chip mini-chip--muted">
                                {resolvedMemberAbsencePolicy(member.id, member.status).policy ===
                                'away_rent_only'
                                  ? copy().absencePolicyAwayRentOnly
                                  : resolvedMemberAbsencePolicy(member.id, member.status).policy ===
                                      'away_rent_and_utilities'
                                    ? copy().absencePolicyAwayRentAndUtilities
                                    : resolvedMemberAbsencePolicy(member.id, member.status)
                                          .policy === 'inactive'
                                      ? copy().absencePolicyInactive
                                      : copy().absencePolicyResident}
                              </span>
                            </div>
                          </div>
                          <div class="ledger-compact-card__actions">
                            <IconButton
                              label={copy().editMemberAction}
                              onClick={() => setEditingMemberId(member.id)}
                            >
                              ...
                            </IconButton>
                          </div>
                        </article>
                      ))}
                    </div>
                  </article>

                  <article class="balance-item">
                    <header>
                      <strong>{copy().pendingMembersTitle}</strong>
                      <span>{String(pendingMembers().length)}</span>
                    </header>
                    <p>{copy().pendingMembersBody}</p>
                    {pendingMembers().length === 0 ? (
                      <p>{copy().pendingMembersEmpty}</p>
                    ) : (
                      <div class="admin-sublist admin-sublist--plain">
                        {pendingMembers().map((member) => (
                          <article class="ledger-item">
                            <header>
                              <strong>{member.displayName}</strong>
                              <span>{member.telegramUserId}</span>
                            </header>
                            <p>
                              {member.username
                                ? copy().pendingMemberHandle.replace('{username}', member.username)
                                : (member.languageCode ?? 'Telegram')}
                            </p>
                            <button
                              class="ghost-button"
                              type="button"
                              disabled={approvingTelegramUserId() === member.telegramUserId}
                              onClick={() => void handleApprovePendingMember(member.telegramUserId)}
                            >
                              {approvingTelegramUserId() === member.telegramUserId
                                ? copy().approvingMember
                                : copy().approveMemberAction}
                            </button>
                          </article>
                        ))}
                      </div>
                    )}
                  </article>
                </div>
                <Modal
                  open={Boolean(editingMember())}
                  title={copy().adminsTitle}
                  description={copy().memberEditorBody}
                  closeLabel={copy().closeEditorAction}
                  onClose={() => setEditingMemberId(null)}
                  footer={(() => {
                    const member = editingMember()
                    if (!member) {
                      return null
                    }

                    return (
                      <div class="modal-action-row">
                        <div class="modal-action-row__primary">
                          <Button variant="ghost" onClick={() => setEditingMemberId(null)}>
                            {copy().closeEditorAction}
                          </Button>
                          <Button
                            variant="secondary"
                            disabled={
                              savingMemberDisplayNameId() === member.id ||
                              (memberDisplayNameDrafts()[member.id] ?? member.displayName).trim()
                                .length < 2 ||
                              (
                                memberDisplayNameDrafts()[member.id] ?? member.displayName
                              ).trim() === member.displayName
                            }
                            onClick={() => void handleSaveMemberDisplayName(member.id)}
                          >
                            {savingMemberDisplayNameId() === member.id
                              ? copy().savingDisplayName
                              : copy().saveDisplayName}
                          </Button>
                          <Button
                            variant="secondary"
                            disabled={savingMemberStatusId() === member.id}
                            onClick={() => void handleSaveMemberStatus(member.id)}
                          >
                            {savingMemberStatusId() === member.id
                              ? copy().savingMemberStatus
                              : copy().saveMemberStatusAction}
                          </Button>
                          <Button
                            variant="secondary"
                            disabled={
                              savingMemberAbsencePolicyId() === member.id ||
                              (memberStatusDrafts()[member.id] ?? member.status) !== 'away'
                            }
                            onClick={() => void handleSaveMemberAbsencePolicy(member.id)}
                          >
                            {savingMemberAbsencePolicyId() === member.id
                              ? copy().savingAbsencePolicy
                              : copy().saveAbsencePolicyAction}
                          </Button>
                          <Button
                            variant="primary"
                            disabled={
                              savingRentWeightMemberId() === member.id ||
                              Number(rentWeightDrafts()[member.id] ?? member.rentShareWeight) <= 0
                            }
                            onClick={() => void handleSaveRentWeight(member.id)}
                          >
                            {savingRentWeightMemberId() === member.id
                              ? copy().savingRentWeight
                              : copy().saveRentWeightAction}
                          </Button>
                          <Show when={!member.isAdmin}>
                            <Button
                              variant="ghost"
                              disabled={promotingMemberId() === member.id}
                              onClick={() => void handlePromoteMember(member.id)}
                            >
                              {promotingMemberId() === member.id
                                ? copy().promotingAdmin
                                : copy().promoteAdminAction}
                            </Button>
                          </Show>
                        </div>
                      </div>
                    )
                  })()}
                >
                  {(() => {
                    const member = editingMember()
                    if (!member) {
                      return null
                    }

                    return (
                      <div class="editor-grid">
                        <Field label={copy().displayNameLabel} hint={copy().displayNameHint} wide>
                          <input
                            value={memberDisplayNameDrafts()[member.id] ?? member.displayName}
                            onInput={(event) =>
                              setMemberDisplayNameDrafts((current) => ({
                                ...current,
                                [member.id]: event.currentTarget.value
                              }))
                            }
                          />
                        </Field>
                        <Field label={copy().memberStatusLabel} wide>
                          <select
                            value={memberStatusDrafts()[member.id] ?? member.status}
                            onChange={(event) =>
                              setMemberStatusDrafts((current) => ({
                                ...current,
                                [member.id]: event.currentTarget.value as 'active' | 'away' | 'left'
                              }))
                            }
                          >
                            <option value="active">{copy().memberStatusActive}</option>
                            <option value="away">{copy().memberStatusAway}</option>
                            <option value="left">{copy().memberStatusLeft}</option>
                          </select>
                        </Field>
                        <Field
                          label={copy().absencePolicyLabel}
                          hint={
                            resolvedMemberAbsencePolicy(member.id, member.status)
                              .effectiveFromPeriod
                              ? copy().absencePolicyEffectiveFrom.replace(
                                  '{period}',
                                  resolvedMemberAbsencePolicy(member.id, member.status)
                                    .effectiveFromPeriod
                                )
                              : copy().absencePolicyHint
                          }
                          wide
                        >
                          <select
                            value={
                              memberAbsencePolicyDrafts()[member.id] ??
                              resolvedMemberAbsencePolicy(member.id, member.status).policy
                            }
                            disabled={(memberStatusDrafts()[member.id] ?? member.status) !== 'away'}
                            onChange={(event) =>
                              setMemberAbsencePolicyDrafts((current) => ({
                                ...current,
                                [member.id]: event.currentTarget.value as MiniAppMemberAbsencePolicy
                              }))
                            }
                          >
                            <option value="away_rent_and_utilities">
                              {copy().absencePolicyAwayRentAndUtilities}
                            </option>
                            <option value="away_rent_only">
                              {copy().absencePolicyAwayRentOnly}
                            </option>
                            <option value="inactive">{copy().absencePolicyInactive}</option>
                            <option value="resident">{copy().absencePolicyResident}</option>
                          </select>
                        </Field>
                        <Field label={copy().rentWeightLabel} wide>
                          <input
                            inputmode="numeric"
                            value={rentWeightDrafts()[member.id] ?? String(member.rentShareWeight)}
                            onInput={(event) =>
                              setRentWeightDrafts((current) => ({
                                ...current,
                                [member.id]: event.currentTarget.value
                              }))
                            }
                          />
                        </Field>
                      </div>
                    )
                  })()}
                </Modal>
              </section>
            </Show>

            <Show when={activeHouseSection() === 'topics'}>
              <section class="admin-section">
                <header class="admin-section__header">
                  <div>
                    <h3>{copy().topicBindingsTitle}</h3>
                    <p>{copy().topicBindingsBody}</p>
                  </div>
                </header>
                <div class="admin-grid">
                  <article class="balance-item admin-card--wide">
                    <header>
                      <strong>{copy().topicBindingsTitle}</strong>
                      <span>{String(adminSettings()?.topics.length ?? 0)}/4</span>
                    </header>
                    <div class="balance-list admin-sublist">
                      {(['purchase', 'feedback', 'reminders', 'payments'] as const).map((role) => {
                        const binding = adminSettings()?.topics.find((topic) => topic.role === role)

                        return (
                          <article class="ledger-item">
                            <header>
                              <strong>{topicRoleLabel(role)}</strong>
                              <span>{binding ? copy().topicBound : copy().topicUnbound}</span>
                            </header>
                            <p>
                              {binding
                                ? `${binding.topicName ?? `Topic #${binding.telegramThreadId}`} · #${binding.telegramThreadId}`
                                : copy().topicUnbound}
                            </p>
                          </article>
                        )
                      })}
                    </div>
                  </article>
                </div>
              </section>
            </Show>
          </div>
        ) : (
          <div class="balance-list">
            <article class="balance-item">
              <header>
                <strong>{copy().residentHouseTitle}</strong>
              </header>
              <p>{copy().residentHouseBody}</p>
            </article>
          </div>
        )
      default:
        return (
          <div class="home-grid home-grid--summary">
            <ShowDashboard
              dashboard={dashboard()}
              fallback={
                <>
                  <article class="stat-card">
                    <span>{copy().remainingLabel}</span>
                    <strong>—</strong>
                  </article>
                  <article class="stat-card">
                    <span>{copy().shareRent}</span>
                    <strong>—</strong>
                  </article>
                  <article class="stat-card">
                    <span>{copy().shareUtilities}</span>
                    <strong>—</strong>
                  </article>
                  <article class="stat-card">
                    <span>{copy().purchasesTitle}</span>
                    <strong>—</strong>
                  </article>
                </>
              }
              render={(data) => (
                <FinanceSummaryCards
                  dashboard={data}
                  utilityTotalMajor={utilityTotalMajor()}
                  purchaseTotalMajor={purchaseTotalMajor()}
                  labels={{
                    remaining: copy().remainingLabel,
                    rent: copy().shareRent,
                    utilities: copy().shareUtilities,
                    purchases: copy().purchasesTitle
                  }}
                />
              )}
            />
            {readySession()?.member.isAdmin ? (
              <article class="stat-card">
                <span>{copy().pendingRequests}</span>
                <strong>{String(pendingMembers().length)}</strong>
              </article>
            ) : null}

            {currentMemberLine() ? (
              <article class="balance-item balance-item--accent">
                <header>
                  <strong>{copy().yourBalanceTitle}</strong>
                  <span>
                    {currentMemberLine()!.remainingMajor} {dashboard()?.currency ?? ''}
                  </span>
                </header>
                <p>{copy().yourBalanceBody}</p>
                <ShowDashboard
                  dashboard={dashboard()}
                  fallback={null}
                  render={(data) => (
                    <p>
                      {copy().shareRent}: {data.rentSourceAmountMajor} {data.rentSourceCurrency}
                      {data.rentSourceCurrency !== data.currency
                        ? ` -> ${data.rentDisplayAmountMajor} ${data.currency}`
                        : ''}
                    </p>
                  )}
                />
                <div class="balance-breakdown">
                  <div class="stat-card">
                    <span>{copy().baseDue}</span>
                    <strong>
                      {memberBaseDueMajor(currentMemberLine()!)} {dashboard()?.currency ?? ''}
                    </strong>
                  </div>
                  <div class="stat-card">
                    <span>{copy().shareOffset}</span>
                    <strong>
                      {currentMemberLine()!.purchaseOffsetMajor} {dashboard()?.currency ?? ''}
                    </strong>
                  </div>
                  <div class="stat-card">
                    <span>{copy().finalDue}</span>
                    <strong>
                      {currentMemberLine()!.netDueMajor} {dashboard()?.currency ?? ''}
                    </strong>
                  </div>
                  <div class="stat-card">
                    <span>{copy().paidLabel}</span>
                    <strong>
                      {currentMemberLine()!.paidMajor} {dashboard()?.currency ?? ''}
                    </strong>
                  </div>
                  <div class="stat-card">
                    <span>{copy().remainingLabel}</span>
                    <strong>
                      {currentMemberLine()!.remainingMajor} {dashboard()?.currency ?? ''}
                    </strong>
                  </div>
                </div>
              </article>
            ) : (
              <article class="balance-item">
                <header>
                  <strong>{copy().overviewTitle}</strong>
                </header>
                <p>{copy().overviewBody}</p>
              </article>
            )}

            <ShowDashboard
              dashboard={dashboard()}
              fallback={null}
              render={(data) => (
                <FinanceVisuals
                  dashboard={data}
                  memberVisuals={memberBalanceVisuals()}
                  purchaseChart={purchaseInvestmentChart()}
                  remainingClass={memberRemainingClass}
                  labels={{
                    financeVisualsTitle: copy().financeVisualsTitle,
                    financeVisualsBody: copy().financeVisualsBody,
                    membersCount: copy().membersCount,
                    purchaseInvestmentsTitle: copy().purchaseInvestmentsTitle,
                    purchaseInvestmentsBody: copy().purchaseInvestmentsBody,
                    purchaseInvestmentsEmpty: copy().purchaseInvestmentsEmpty,
                    purchaseTotalLabel: copy().purchaseTotalLabel,
                    purchaseShareLabel: copy().purchaseShareLabel
                  }}
                />
              )}
            />

            <article class="balance-item balance-item--wide">
              <header>
                <strong>{copy().latestActivityTitle}</strong>
              </header>
              <ShowDashboard
                dashboard={dashboard()}
                fallback={<p>{copy().latestActivityEmpty}</p>}
                render={(data) =>
                  data.ledger.length === 0 ? (
                    <p>{copy().latestActivityEmpty}</p>
                  ) : (
                    <div class="activity-list">
                      {data.ledger.slice(0, 3).map((entry) => (
                        <article class="activity-row">
                          <header>
                            <strong>{ledgerTitle(entry)}</strong>
                            <span>{ledgerPrimaryAmount(entry)}</span>
                          </header>
                          <Show when={ledgerSecondaryAmount(entry)}>
                            {(secondary) => <p>{secondary()}</p>}
                          </Show>
                          <p>{entry.actorDisplayName ?? copy().ledgerActorFallback}</p>
                        </article>
                      ))}
                    </div>
                  )
                }
              />
            </article>
          </div>
        )
    }
  }

  return (
    <main class="shell">
      <div class="shell__backdrop shell__backdrop--top" />
      <div class="shell__backdrop shell__backdrop--bottom" />

      <TopBar
        subtitle={copy().appSubtitle}
        title={copy().appTitle}
        languageLabel={copy().language}
        locale={locale()}
        saving={savingMemberLocale()}
        onChange={(nextLocale) => void handleMemberLocaleChange(nextLocale)}
      />

      <Switch>
        <Match when={session().status === 'loading'}>
          <HeroBanner
            badges={[copy().loadingBadge]}
            title={copy().loadingTitle}
            body={copy().loadingBody}
          />
        </Match>

        <Match when={session().status === 'blocked'}>
          <HeroBanner
            badges={[copy().loadingBadge]}
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
            action={{ label: copy().reload, onClick: () => window.location.reload() }}
          />
        </Match>

        <Match when={session().status === 'onboarding'}>
          <section class="hero-card">
            <div class="hero-card__meta">
              <span class="pill">{copy().loadingBadge}</span>
            </div>
            <h2>
              {onboardingSession()?.mode === 'pending'
                ? copy().pendingTitle
                : onboardingSession()?.mode === 'open_from_group'
                  ? copy().openFromGroupTitle
                  : copy().joinTitle}
            </h2>
            <p>
              {onboardingSession()?.mode === 'pending'
                ? copy().pendingBody.replace(
                    '{household}',
                    onboardingSession()?.householdName ?? copy().householdFallback
                  )
                : onboardingSession()?.mode === 'open_from_group'
                  ? copy().openFromGroupBody
                  : copy().joinBody.replace(
                      '{household}',
                      onboardingSession()?.householdName ?? copy().householdFallback
                    )}
            </p>
            <div class="nav-grid">
              {onboardingSession()?.mode === 'join_required' ? (
                <Button variant="ghost" disabled={joining()} onClick={handleJoinHousehold}>
                  {joining() ? copy().joining : copy().joinAction}
                </Button>
              ) : null}
              {joinDeepLink() ? (
                <a
                  class="ui-button ui-button--ghost"
                  href={joinDeepLink() ?? '#'}
                  target="_blank"
                  rel="noreferrer"
                >
                  {copy().botLinkAction}
                </a>
              ) : null}
              <Button variant="ghost" onClick={() => window.location.reload()}>
                {copy().reload}
              </Button>
            </div>
          </section>
        </Match>

        <Match when={session().status === 'ready'}>
          <HeroBanner
            badges={[
              readySession()?.mode === 'demo' ? copy().demoBadge : copy().liveBadge,
              readySession()?.member.isAdmin ? copy().adminTag : copy().residentTag,
              readySession()?.member.status
                ? memberStatusLabel(readySession()!.member.status)
                : copy().memberStatusActive
            ]}
            title={`${copy().welcome}, ${readySession()?.telegramUser.firstName ?? readySession()?.member.displayName}`}
            body={copy().overviewBody}
            action={
              readySession()?.mode === 'live'
                ? {
                    label: copy().manageProfileAction,
                    onClick: () => setProfileEditorOpen(true)
                  }
                : undefined
            }
          />

          <NavigationTabs
            items={
              [
                { key: 'home', label: copy().home },
                { key: 'balances', label: copy().balances },
                { key: 'ledger', label: copy().ledger },
                { key: 'house', label: copy().house }
              ] as const
            }
            active={activeNav()}
            onChange={setActiveNav}
          />

          <section class="content-grid">
            <ProfileCard
              displayName={readySession()?.member.displayName ?? ''}
              roleLabel={readySession()?.member.isAdmin ? copy().adminTag : copy().residentTag}
              statusSummary={copy().memberStatusSummary.replace(
                '{status}',
                readySession()?.member.status
                  ? memberStatusLabel(readySession()!.member.status)
                  : copy().memberStatusActive
              )}
              modeBadge={readySession()?.mode === 'demo' ? copy().demoBadge : copy().liveBadge}
              localeBadge={locale().toUpperCase()}
            />
            <div class="content-stack">{renderPanel()}</div>
          </section>
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

function ShowDashboard(props: {
  dashboard: MiniAppDashboard | null
  fallback: JSX.Element
  render: (dashboard: MiniAppDashboard) => JSX.Element
}) {
  return <>{props.dashboard ? props.render(props.dashboard) : props.fallback}</>
}

export default App
