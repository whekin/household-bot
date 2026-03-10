import { Match, Show, Switch, createMemo, createSignal, onMount, type JSX } from 'solid-js'

import { dictionary, type Locale } from './i18n'
import {
  addMiniAppUtilityBill,
  approveMiniAppPendingMember,
  closeMiniAppBillingCycle,
  deleteMiniAppUtilityBill,
  fetchMiniAppAdminSettings,
  fetchMiniAppBillingCycle,
  fetchMiniAppDashboard,
  fetchMiniAppPendingMembers,
  fetchMiniAppSession,
  joinMiniAppHousehold,
  openMiniAppBillingCycle,
  promoteMiniAppMember,
  updateMiniAppMemberRentWeight,
  type MiniAppAdminCycleState,
  type MiniAppAdminSettingsPayload,
  updateMiniAppLocalePreference,
  updateMiniAppBillingSettings,
  updateMiniAppCycleRent,
  upsertMiniAppUtilityCategory,
  updateMiniAppUtilityBill,
  type MiniAppDashboard,
  type MiniAppPendingMember
} from './miniapp-api'
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

type UtilityBillDraft = {
  billName: string
  amountMajor: string
  currency: 'USD' | 'GEL'
}

const demoSession: Extract<SessionState, { status: 'ready' }> = {
  status: 'ready',
  mode: 'demo',
  member: {
    id: 'demo-member',
    displayName: 'Demo Resident',
    isAdmin: false,
    preferredLocale: 'en',
    householdDefaultLocale: 'en'
  },
  telegramUser: {
    firstName: 'Demo',
    username: 'demo_user',
    languageCode: 'en'
  }
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

function dashboardMemberCount(dashboard: MiniAppDashboard | null): string {
  return dashboard ? String(dashboard.members.length) : '—'
}

function dashboardLedgerCount(dashboard: MiniAppDashboard | null): string {
  return dashboard ? String(dashboard.ledger.length) : '—'
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
  const [savingRentWeightMemberId, setSavingRentWeightMemberId] = createSignal<string | null>(null)
  const [rentWeightDrafts, setRentWeightDrafts] = createSignal<Record<string, string>>({})
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
  const [billingForm, setBillingForm] = createSignal({
    settlementCurrency: 'GEL' as 'USD' | 'GEL',
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
  const webApp = getTelegramWebApp()

  function ledgerTitle(entry: MiniAppDashboard['ledger'][number]): string {
    if (entry.kind !== 'payment') {
      return entry.title
    }

    return entry.paymentKind === 'utilities'
      ? copy().paymentLedgerUtilities
      : copy().paymentLedgerRent
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

  async function loadDashboard(initData: string) {
    try {
      setDashboard(await fetchMiniAppDashboard(initData))
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('Failed to load mini app dashboard', error)
      }

      setDashboard(null)
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
      setRentWeightDrafts(
        Object.fromEntries(
          payload.members.map((member) => [member.id, String(member.rentShareWeight)])
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

  async function bootstrap() {
    const fallbackLocale = detectLocale()
    setLocale(fallbackLocale)

    webApp?.ready?.()
    webApp?.expand?.()

    const initData = webApp?.initData?.trim()
    if (!initData) {
      if (import.meta.env.DEV) {
        setSession(demoSession)
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
        setSession(demoSession)
        setDashboard({
          period: '2026-03',
          currency: 'GEL',
          totalDueMajor: '1030.00',
          totalPaidMajor: '501.00',
          totalRemainingMajor: '529.00',
          rentSourceAmountMajor: '700.00',
          rentSourceCurrency: 'USD',
          rentDisplayAmountMajor: '1932.00',
          rentFxRateMicros: '2760000',
          rentFxEffectiveDate: '2026-03-17',
          members: [
            {
              memberId: 'demo-member',
              displayName: 'Demo Resident',
              rentShareMajor: '483.00',
              utilityShareMajor: '32.00',
              purchaseOffsetMajor: '-14.00',
              netDueMajor: '501.00',
              paidMajor: '501.00',
              remainingMajor: '0.00',
              explanations: ['Equal utility split', 'Shared purchase offset']
            },
            {
              memberId: 'member-2',
              displayName: 'Alice',
              rentShareMajor: '483.00',
              utilityShareMajor: '32.00',
              purchaseOffsetMajor: '14.00',
              netDueMajor: '529.00',
              paidMajor: '0.00',
              remainingMajor: '529.00',
              explanations: ['Equal utility split']
            }
          ],
          ledger: [
            {
              id: 'purchase-1',
              kind: 'purchase',
              title: 'Soap',
              paymentKind: null,
              amountMajor: '30.00',
              currency: 'GEL',
              displayAmountMajor: '30.00',
              displayCurrency: 'GEL',
              fxRateMicros: null,
              fxEffectiveDate: null,
              actorDisplayName: 'Alice',
              occurredAt: '2026-03-12T11:00:00.000Z'
            },
            {
              id: 'utility-1',
              kind: 'utility',
              title: 'Electricity',
              paymentKind: null,
              amountMajor: '120.00',
              currency: 'GEL',
              displayAmountMajor: '120.00',
              displayCurrency: 'GEL',
              fxRateMicros: null,
              fxEffectiveDate: null,
              actorDisplayName: 'Alice',
              occurredAt: '2026-03-12T12:00:00.000Z'
            },
            {
              id: 'payment-1',
              kind: 'payment',
              title: 'rent',
              paymentKind: 'rent',
              amountMajor: '501.00',
              currency: 'GEL',
              displayAmountMajor: '501.00',
              displayCurrency: 'GEL',
              fxRateMicros: null,
              fxEffectiveDate: null,
              actorDisplayName: 'Demo Resident',
              occurredAt: '2026-03-18T15:10:00.000Z'
            }
          ]
        })
        setPendingMembers([
          {
            telegramUserId: '555777',
            displayName: 'Mia',
            username: 'mia',
            languageCode: 'ru'
          }
        ])
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
    } finally {
      setDeletingUtilityBillId(null)
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
    } finally {
      setSavingRentWeightMemberId(null)
    }
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
                      <strong>{copy().purchasesTitle}</strong>
                    </header>
                    {purchaseLedger().length === 0 ? (
                      <p>{copy().purchasesEmpty}</p>
                    ) : (
                      <div class="ledger-list">
                        {purchaseLedger().map((entry) => (
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
                      <strong>{copy().paymentsTitle}</strong>
                    </header>
                    {paymentLedger().length === 0 ? (
                      <p>{copy().paymentsEmpty}</p>
                    ) : (
                      <div class="ledger-list">
                        {paymentLedger().map((entry) => (
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
                  {cycleState()?.cycle ? (
                    <>
                      <p>
                        {copy().billingCycleStatus.replace(
                          '{currency}',
                          cycleState()?.cycle?.currency ?? billingForm().settlementCurrency
                        )}
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
                      <div class="settings-grid">
                        <label class="settings-field">
                          <span>{copy().rentAmount}</span>
                          <input
                            value={cycleForm().rentAmountMajor}
                            onInput={(event) =>
                              setCycleForm((current) => ({
                                ...current,
                                rentAmountMajor: event.currentTarget.value
                              }))
                            }
                          />
                        </label>
                        <label class="settings-field">
                          <span>{copy().shareRent}</span>
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
                        </label>
                      </div>
                      <div class="inline-actions">
                        <button
                          class="ghost-button"
                          type="button"
                          disabled={
                            savingCycleRent() || cycleForm().rentAmountMajor.trim().length === 0
                          }
                          onClick={() => void handleSaveCycleRent()}
                        >
                          {savingCycleRent() ? copy().savingCycleRent : copy().saveCycleRentAction}
                        </button>
                        <button
                          class="ghost-button"
                          type="button"
                          disabled={closingCycle()}
                          onClick={() => void handleCloseCycle()}
                        >
                          {closingCycle() ? copy().closingCycle : copy().closeCycleAction}
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p>{copy().billingCycleOpenHint}</p>
                      <div class="settings-grid">
                        <label class="settings-field">
                          <span>{copy().billingCyclePeriod}</span>
                          <input
                            value={cycleForm().period}
                            onInput={(event) =>
                              setCycleForm((current) => ({
                                ...current,
                                period: event.currentTarget.value
                              }))
                            }
                          />
                        </label>
                        <div class="settings-field">
                          <span>{copy().settlementCurrency}</span>
                          <div class="settings-field__value">
                            {billingForm().settlementCurrency}
                          </div>
                        </div>
                      </div>
                      <button
                        class="ghost-button"
                        type="button"
                        disabled={openingCycle()}
                        onClick={() => void handleOpenCycle()}
                      >
                        {openingCycle() ? copy().openingCycle : copy().openCycleAction}
                      </button>
                    </>
                  )}
                </article>

                <article class="balance-item">
                  <header>
                    <strong>{copy().billingSettingsTitle}</strong>
                    <span>{billingForm().settlementCurrency}</span>
                  </header>
                  <div class="settings-grid">
                    <label class="settings-field">
                      <span>{copy().settlementCurrency}</span>
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
                    </label>
                    <label class="settings-field">
                      <span>{copy().rentAmount}</span>
                      <input
                        value={billingForm().rentAmountMajor}
                        onInput={(event) =>
                          setBillingForm((current) => ({
                            ...current,
                            rentAmountMajor: event.currentTarget.value
                          }))
                        }
                      />
                    </label>
                    <label class="settings-field">
                      <span>{copy().shareRent}</span>
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
                    </label>
                    <label class="settings-field">
                      <span>{copy().rentDueDay}</span>
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
                    </label>
                    <label class="settings-field">
                      <span>{copy().rentWarningDay}</span>
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
                    </label>
                    <label class="settings-field">
                      <span>{copy().utilitiesDueDay}</span>
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
                    </label>
                    <label class="settings-field">
                      <span>{copy().utilitiesReminderDay}</span>
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
                    </label>
                    <label class="settings-field settings-field--wide">
                      <span>{copy().timezone}</span>
                      <input
                        value={billingForm().timezone}
                        onInput={(event) =>
                          setBillingForm((current) => ({
                            ...current,
                            timezone: event.currentTarget.value
                          }))
                        }
                      />
                    </label>
                  </div>
                  <button
                    class="ghost-button"
                    type="button"
                    disabled={savingBillingSettings()}
                    onClick={() => void handleSaveBillingSettings()}
                  >
                    {savingBillingSettings() ? copy().savingSettings : copy().saveSettingsAction}
                  </button>
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

                <article class="balance-item">
                  <header>
                    <strong>{copy().topicBindingsTitle}</strong>
                    <span>{String(adminSettings()?.topics.length ?? 0)}/4</span>
                  </header>
                  <p>{copy().topicBindingsBody}</p>
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
                  <div class="settings-grid">
                    <label class="settings-field">
                      <span>{copy().utilityCategoryLabel}</span>
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
                    </label>
                    <label class="settings-field">
                      <span>{copy().utilityAmount}</span>
                      <input
                        value={cycleForm().utilityAmountMajor}
                        onInput={(event) =>
                          setCycleForm((current) => ({
                            ...current,
                            utilityAmountMajor: event.currentTarget.value
                          }))
                        }
                      />
                    </label>
                    <label class="settings-field">
                      <span>{copy().settlementCurrency}</span>
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
                    </label>
                  </div>
                  <button
                    class="ghost-button"
                    type="button"
                    disabled={
                      savingUtilityBill() || cycleForm().utilityAmountMajor.trim().length === 0
                    }
                    onClick={() => void handleAddUtilityBill()}
                  >
                    {savingUtilityBill() ? copy().savingUtilityBill : copy().addUtilityBillAction}
                  </button>
                  <div class="admin-sublist admin-sublist--plain">
                    {cycleState()?.utilityBills.length ? (
                      cycleState()?.utilityBills.map((bill) => (
                        <article class="utility-bill-row">
                          <header>
                            <strong>
                              {utilityBillDrafts()[bill.id]?.billName ?? bill.billName}
                            </strong>
                            <span>{bill.createdAt.slice(0, 10)}</span>
                          </header>
                          <div class="settings-grid">
                            <label class="settings-field settings-field--wide">
                              <span>{copy().utilityCategoryName}</span>
                              <input
                                value={utilityBillDrafts()[bill.id]?.billName ?? bill.billName}
                                onInput={(event) =>
                                  setUtilityBillDrafts((current) => ({
                                    ...current,
                                    [bill.id]: {
                                      ...(current[bill.id] ?? {
                                        billName: bill.billName,
                                        amountMajor: minorToMajorString(BigInt(bill.amountMinor)),
                                        currency: bill.currency
                                      }),
                                      billName: event.currentTarget.value
                                    }
                                  }))
                                }
                              />
                            </label>
                            <label class="settings-field">
                              <span>{copy().utilityAmount}</span>
                              <input
                                value={
                                  utilityBillDrafts()[bill.id]?.amountMajor ??
                                  minorToMajorString(BigInt(bill.amountMinor))
                                }
                                onInput={(event) =>
                                  setUtilityBillDrafts((current) => ({
                                    ...current,
                                    [bill.id]: {
                                      ...(current[bill.id] ?? {
                                        billName: bill.billName,
                                        amountMajor: minorToMajorString(BigInt(bill.amountMinor)),
                                        currency: bill.currency
                                      }),
                                      amountMajor: event.currentTarget.value
                                    }
                                  }))
                                }
                              />
                            </label>
                            <label class="settings-field">
                              <span>{copy().settlementCurrency}</span>
                              <select
                                value={utilityBillDrafts()[bill.id]?.currency ?? bill.currency}
                                onChange={(event) =>
                                  setUtilityBillDrafts((current) => ({
                                    ...current,
                                    [bill.id]: {
                                      ...(current[bill.id] ?? {
                                        billName: bill.billName,
                                        amountMajor: minorToMajorString(BigInt(bill.amountMinor)),
                                        currency: bill.currency
                                      }),
                                      currency: event.currentTarget.value as 'USD' | 'GEL'
                                    }
                                  }))
                                }
                              >
                                <option value="GEL">GEL</option>
                                <option value="USD">USD</option>
                              </select>
                            </label>
                          </div>
                          <div class="inline-actions">
                            <button
                              class="ghost-button"
                              type="button"
                              disabled={savingUtilityBillId() === bill.id}
                              onClick={() => void handleUpdateUtilityBill(bill.id)}
                            >
                              {savingUtilityBillId() === bill.id
                                ? copy().savingUtilityBill
                                : copy().saveUtilityBillAction}
                            </button>
                            <button
                              class="ghost-button ghost-button--danger"
                              type="button"
                              disabled={deletingUtilityBillId() === bill.id}
                              onClick={() => void handleDeleteUtilityBill(bill.id)}
                            >
                              {deletingUtilityBillId() === bill.id
                                ? copy().deletingUtilityBill
                                : copy().deleteUtilityBillAction}
                            </button>
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
                  <div class="admin-sublist admin-sublist--plain">
                    {adminSettings()?.categories.map((category) => (
                      <article class="utility-bill-row">
                        <header>
                          <strong>{category.name}</strong>
                          <span>{category.isActive ? 'ON' : 'OFF'}</span>
                        </header>
                        <div class="settings-grid">
                          <label class="settings-field settings-field--wide">
                            <span>{copy().utilityCategoryName}</span>
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
                          </label>
                          <label class="settings-field">
                            <span>{copy().utilityCategoryActive}</span>
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
                          </label>
                        </div>
                        <button
                          class="ghost-button"
                          type="button"
                          disabled={savingCategorySlug() === category.slug}
                          onClick={() =>
                            void handleSaveUtilityCategory({
                              slug: category.slug,
                              name:
                                adminSettings()?.categories.find(
                                  (item) => item.slug === category.slug
                                )?.name ?? category.name,
                              sortOrder: category.sortOrder,
                              isActive:
                                adminSettings()?.categories.find(
                                  (item) => item.slug === category.slug
                                )?.isActive ?? category.isActive
                            })
                          }
                        >
                          {savingCategorySlug() === category.slug
                            ? copy().savingCategory
                            : copy().saveCategoryAction}
                        </button>
                      </article>
                    ))}
                    <article class="ledger-item">
                      <label class="settings-field settings-field--wide">
                        <span>{copy().utilityCategoryName}</span>
                        <input
                          value={newCategoryName()}
                          onInput={(event) => setNewCategoryName(event.currentTarget.value)}
                        />
                      </label>
                      <button
                        class="ghost-button"
                        type="button"
                        disabled={
                          newCategoryName().trim().length === 0 ||
                          savingCategorySlug() === '__new__'
                        }
                        onClick={() =>
                          void handleSaveUtilityCategory({
                            name: newCategoryName(),
                            sortOrder: adminSettings()?.categories.length ?? 0,
                            isActive: true
                          })
                        }
                      >
                        {savingCategorySlug() === '__new__'
                          ? copy().savingCategory
                          : copy().addCategoryAction}
                      </button>
                    </article>
                  </div>
                </article>
              </div>
            </section>

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
                  <div class="balance-list admin-sublist">
                    {adminSettings()?.members.map((member) => (
                      <article class="utility-bill-row">
                        <header>
                          <strong>{member.displayName}</strong>
                          <span>{member.isAdmin ? copy().adminTag : copy().residentTag}</span>
                        </header>
                        <div class="settings-grid">
                          <label class="settings-field settings-field--wide">
                            <span>{copy().rentWeightLabel}</span>
                            <input
                              inputmode="numeric"
                              value={
                                rentWeightDrafts()[member.id] ?? String(member.rentShareWeight)
                              }
                              onInput={(event) =>
                                setRentWeightDrafts((current) => ({
                                  ...current,
                                  [member.id]: event.currentTarget.value
                                }))
                              }
                            />
                          </label>
                        </div>
                        <div class="inline-actions">
                          <button
                            class="ghost-button"
                            type="button"
                            disabled={
                              savingRentWeightMemberId() === member.id ||
                              Number(rentWeightDrafts()[member.id] ?? member.rentShareWeight) <= 0
                            }
                            onClick={() => void handleSaveRentWeight(member.id)}
                          >
                            {savingRentWeightMemberId() === member.id
                              ? copy().savingRentWeight
                              : copy().saveRentWeightAction}
                          </button>
                          {!member.isAdmin ? (
                            <button
                              class="ghost-button"
                              type="button"
                              disabled={promotingMemberId() === member.id}
                              onClick={() => void handlePromoteMember(member.id)}
                            >
                              {promotingMemberId() === member.id
                                ? copy().promotingAdmin
                                : copy().promoteAdminAction}
                            </button>
                          ) : null}
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
            </section>
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
            <article class="stat-card">
              <span>{copy().totalDue}</span>
              <strong>
                {dashboard() ? `${dashboard()!.totalDueMajor} ${dashboard()!.currency}` : '—'}
              </strong>
            </article>
            <article class="stat-card">
              <span>{copy().paidLabel}</span>
              <strong>
                {dashboard() ? `${dashboard()!.totalPaidMajor} ${dashboard()!.currency}` : '—'}
              </strong>
            </article>
            <article class="stat-card">
              <span>{copy().remainingLabel}</span>
              <strong>
                {dashboard() ? `${dashboard()!.totalRemainingMajor} ${dashboard()!.currency}` : '—'}
              </strong>
            </article>
            <article class="stat-card">
              <span>{copy().membersCount}</span>
              <strong>{dashboardMemberCount(dashboard())}</strong>
            </article>
            <article class="stat-card">
              <span>{copy().ledgerEntries}</span>
              <strong>{dashboardLedgerCount(dashboard())}</strong>
            </article>
            <article class="stat-card">
              <span>{copy().purchasesTitle}</span>
              <strong>{String(purchaseLedger().length)}</strong>
            </article>
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

      <section class="topbar">
        <div>
          <p class="eyebrow">{copy().appSubtitle}</p>
          <h1>{copy().appTitle}</h1>
        </div>

        <label class="locale-switch">
          <span>{copy().language}</span>
          <div class="locale-switch__buttons">
            <button
              classList={{ 'is-active': locale() === 'en' }}
              type="button"
              disabled={savingMemberLocale()}
              onClick={() => void handleMemberLocaleChange('en')}
            >
              EN
            </button>
            <button
              classList={{ 'is-active': locale() === 'ru' }}
              type="button"
              disabled={savingMemberLocale()}
              onClick={() => void handleMemberLocaleChange('ru')}
            >
              RU
            </button>
          </div>
        </label>
      </section>

      <Switch>
        <Match when={session().status === 'loading'}>
          <section class="hero-card">
            <span class="pill">{copy().loadingBadge}</span>
            <h2>{copy().loadingTitle}</h2>
            <p>{copy().loadingBody}</p>
          </section>
        </Match>

        <Match when={session().status === 'blocked'}>
          <section class="hero-card">
            <span class="pill">{copy().loadingBadge}</span>
            <h2>
              {blockedSession()?.reason === 'telegram_only'
                ? copy().telegramOnlyTitle
                : copy().unexpectedErrorTitle}
            </h2>
            <p>
              {blockedSession()?.reason === 'telegram_only'
                ? copy().telegramOnlyBody
                : copy().unexpectedErrorBody}
            </p>
            <button class="ghost-button" type="button" onClick={() => window.location.reload()}>
              {copy().reload}
            </button>
          </section>
        </Match>

        <Match when={session().status === 'onboarding'}>
          <section class="hero-card">
            <span class="pill">{copy().loadingBadge}</span>
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
                <button
                  class="ghost-button"
                  type="button"
                  disabled={joining()}
                  onClick={handleJoinHousehold}
                >
                  {joining() ? copy().joining : copy().joinAction}
                </button>
              ) : null}
              {joinDeepLink() ? (
                <a
                  class="ghost-button"
                  href={joinDeepLink() ?? '#'}
                  target="_blank"
                  rel="noreferrer"
                >
                  {copy().botLinkAction}
                </a>
              ) : null}
              <button class="ghost-button" type="button" onClick={() => window.location.reload()}>
                {copy().reload}
              </button>
            </div>
          </section>
        </Match>

        <Match when={session().status === 'ready'}>
          <section class="hero-card">
            <div class="hero-card__meta">
              <span class="pill">
                {readySession()?.mode === 'demo' ? copy().demoBadge : copy().liveBadge}
              </span>
              <span class="pill pill--muted">
                {readySession()?.member.isAdmin ? copy().adminTag : copy().residentTag}
              </span>
            </div>

            <h2>
              {copy().welcome},{' '}
              {readySession()?.telegramUser.firstName ?? readySession()?.member.displayName}
            </h2>
            <p>{copy().overviewBody}</p>
          </section>

          <nav class="nav-grid">
            {(
              [
                ['home', copy().home],
                ['balances', copy().balances],
                ['ledger', copy().ledger],
                ['house', copy().house]
              ] as const
            ).map(([key, label]) => (
              <button
                classList={{ 'is-active': activeNav() === key }}
                type="button"
                onClick={() => setActiveNav(key)}
              >
                {label}
              </button>
            ))}
          </nav>

          <section class="content-grid">
            <article class="panel panel--wide">
              <p class="eyebrow">{copy().overviewTitle}</p>
              <h3>{readySession()?.member.displayName}</h3>
              <div>{renderPanel()}</div>
            </article>
          </section>
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
