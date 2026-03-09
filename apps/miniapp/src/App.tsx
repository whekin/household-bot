import { Match, Switch, createMemo, createSignal, onMount, type JSX } from 'solid-js'

import { dictionary, type Locale } from './i18n'
import {
  approveMiniAppPendingMember,
  fetchMiniAppAdminSettings,
  fetchMiniAppDashboard,
  fetchMiniAppPendingMembers,
  fetchMiniAppSession,
  joinMiniAppHousehold,
  promoteMiniAppMember,
  type MiniAppAdminSettingsPayload,
  updateMiniAppLocalePreference,
  updateMiniAppBillingSettings,
  upsertMiniAppUtilityCategory,
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

const demoSession: Extract<SessionState, { status: 'ready' }> = {
  status: 'ready',
  mode: 'demo',
  member: {
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

function App() {
  const [locale, setLocale] = createSignal<Locale>('en')
  const [session, setSession] = createSignal<SessionState>({
    status: 'loading'
  })
  const [activeNav, setActiveNav] = createSignal<NavigationKey>('home')
  const [dashboard, setDashboard] = createSignal<MiniAppDashboard | null>(null)
  const [pendingMembers, setPendingMembers] = createSignal<readonly MiniAppPendingMember[]>([])
  const [adminSettings, setAdminSettings] = createSignal<MiniAppAdminSettingsPayload | null>(null)
  const [joining, setJoining] = createSignal(false)
  const [approvingTelegramUserId, setApprovingTelegramUserId] = createSignal<string | null>(null)
  const [promotingMemberId, setPromotingMemberId] = createSignal<string | null>(null)
  const [savingMemberLocale, setSavingMemberLocale] = createSignal(false)
  const [savingHouseholdLocale, setSavingHouseholdLocale] = createSignal(false)
  const [savingBillingSettings, setSavingBillingSettings] = createSignal(false)
  const [savingCategorySlug, setSavingCategorySlug] = createSignal<string | null>(null)
  const [billingForm, setBillingForm] = createSignal({
    rentAmountMajor: '',
    rentCurrency: 'USD' as 'USD' | 'GEL',
    rentDueDay: 20,
    rentWarningDay: 17,
    utilitiesDueDay: 4,
    utilitiesReminderDay: 3,
    timezone: 'Asia/Tbilisi'
  })
  const [newCategoryName, setNewCategoryName] = createSignal('')

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
  const webApp = getTelegramWebApp()

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
      setBillingForm({
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
      }
    } catch {
      if (import.meta.env.DEV) {
        setSession(demoSession)
        setDashboard({
          period: '2026-03',
          currency: 'USD',
          totalDueMajor: '820.00',
          members: [
            {
              memberId: 'alice',
              displayName: 'Alice',
              rentShareMajor: '350.00',
              utilityShareMajor: '60.00',
              purchaseOffsetMajor: '-15.00',
              netDueMajor: '395.00',
              explanations: ['Equal utility split', 'Shared purchase offset']
            },
            {
              memberId: 'bob',
              displayName: 'Bob',
              rentShareMajor: '350.00',
              utilityShareMajor: '60.00',
              purchaseOffsetMajor: '15.00',
              netDueMajor: '425.00',
              explanations: ['Equal utility split']
            }
          ],
          ledger: [
            {
              id: 'purchase-1',
              kind: 'purchase',
              title: 'Soap',
              amountMajor: '30.00',
              actorDisplayName: 'Alice',
              occurredAt: '2026-03-12T11:00:00.000Z'
            },
            {
              id: 'utility-1',
              kind: 'utility',
              title: 'Electricity',
              amountMajor: '120.00',
              actorDisplayName: 'Alice',
              occurredAt: '2026-03-12T12:00:00.000Z'
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
    } finally {
      setSavingBillingSettings(false)
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
    } finally {
      setPromotingMemberId(null)
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
              render={(data) =>
                data.members.map((member) => (
                  <article class="balance-item">
                    <header>
                      <strong>{member.displayName}</strong>
                      <span>
                        {member.netDueMajor} {data.currency}
                      </span>
                    </header>
                    <p>
                      {copy().shareRent}: {member.rentShareMajor} {data.currency}
                    </p>
                    <p>
                      {copy().shareUtilities}: {member.utilityShareMajor} {data.currency}
                    </p>
                    <p>
                      {copy().shareOffset}: {member.purchaseOffsetMajor} {data.currency}
                    </p>
                  </article>
                ))
              }
            />
          </div>
        )
      case 'ledger':
        return (
          <div class="ledger-list">
            <ShowDashboard
              dashboard={dashboard()}
              fallback={<p>{copy().emptyDashboard}</p>}
              render={(data) =>
                data.ledger.map((entry) => (
                  <article class="ledger-item">
                    <header>
                      <strong>{entry.title}</strong>
                      <span>
                        {entry.amountMajor} {data.currency}
                      </span>
                    </header>
                    <p>{entry.actorDisplayName ?? 'Household'}</p>
                  </article>
                ))
              }
            />
          </div>
        )
      case 'house':
        return readySession()?.member.isAdmin ? (
          <div class="balance-list">
            <article class="balance-item">
              <header>
                <strong>{copy().householdSettingsTitle}</strong>
              </header>
              <p>{copy().householdSettingsBody}</p>
            </article>
            <article class="balance-item">
              <header>
                <strong>{copy().billingSettingsTitle}</strong>
              </header>
              <div class="settings-grid">
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
                <strong>{copy().utilityCategoriesTitle}</strong>
              </header>
              <p>{copy().utilityCategoriesBody}</p>
              <div class="balance-list">
                {adminSettings()?.categories.map((category) => (
                  <article class="ledger-item">
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
                            adminSettings()?.categories.find((item) => item.slug === category.slug)
                              ?.name ?? category.name,
                          sortOrder: category.sortOrder,
                          isActive:
                            adminSettings()?.categories.find((item) => item.slug === category.slug)
                              ?.isActive ?? category.isActive
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
                      newCategoryName().trim().length === 0 || savingCategorySlug() === '__new__'
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
            <article class="balance-item">
              <header>
                <strong>{copy().adminsTitle}</strong>
              </header>
              <p>{copy().adminsBody}</p>
              <div class="balance-list">
                {adminSettings()?.members.map((member) => (
                  <article class="ledger-item">
                    <header>
                      <strong>{member.displayName}</strong>
                      <span>{member.isAdmin ? copy().adminTag : copy().residentTag}</span>
                    </header>
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
                  </article>
                ))}
              </div>
            </article>
            <article class="balance-item">
              <header>
                <strong>{copy().pendingMembersTitle}</strong>
              </header>
              <p>{copy().pendingMembersBody}</p>
            </article>
            {pendingMembers().length === 0 ? (
              <article class="balance-item">
                <p>{copy().pendingMembersEmpty}</p>
              </article>
            ) : (
              pendingMembers().map((member) => (
                <article class="balance-item">
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
              ))
            )}
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
          <div class="home-grid">
            <article class="stat-card">
              <span>{copy().totalDue}</span>
              <strong>
                {dashboard() ? `${dashboard()!.totalDueMajor} ${dashboard()!.currency}` : '—'}
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
            {readySession()?.member.isAdmin ? (
              <article class="stat-card">
                <span>{copy().pendingRequests}</span>
                <strong>{String(pendingMembers().length)}</strong>
              </article>
            ) : null}

            <article class="balance-item">
              <header>
                <strong>{copy().overviewTitle}</strong>
              </header>
              <p>{copy().overviewBody}</p>
            </article>

            <article class="balance-item">
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
                    <div class="ledger-list">
                      {data.ledger.slice(0, 3).map((entry) => (
                        <article class="ledger-item">
                          <header>
                            <strong>{entry.title}</strong>
                            <span>
                              {entry.amountMajor} {data.currency}
                            </span>
                          </header>
                          <p>{entry.actorDisplayName ?? 'Household'}</p>
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
