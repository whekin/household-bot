import { Match, Switch, createMemo, createSignal, onMount } from 'solid-js'

import { dictionary, type Locale } from './i18n'
import { fetchMiniAppSession } from './miniapp-api'
import { getTelegramWebApp } from './telegram-webapp'

type SessionState =
  | {
      status: 'loading'
    }
  | {
      status: 'blocked'
      reason: 'not_member' | 'telegram_only' | 'error'
    }
  | {
      status: 'ready'
      mode: 'live' | 'demo'
      member: {
        displayName: string
        isAdmin: boolean
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
    isAdmin: false
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

function App() {
  const [locale, setLocale] = createSignal<Locale>('en')
  const [session, setSession] = createSignal<SessionState>({
    status: 'loading'
  })
  const [activeNav, setActiveNav] = createSignal<NavigationKey>('home')

  const copy = createMemo(() => dictionary[locale()])
  const blockedSession = createMemo(() => {
    const current = session()
    return current.status === 'blocked' ? current : null
  })
  const readySession = createMemo(() => {
    const current = session()
    return current.status === 'ready' ? current : null
  })
  const webApp = getTelegramWebApp()

  onMount(async () => {
    setLocale(detectLocale())

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
      const payload = await fetchMiniAppSession(initData)
      if (!payload.authorized || !payload.member || !payload.telegramUser) {
        setSession({
          status: 'blocked',
          reason: payload.reason === 'not_member' ? 'not_member' : 'error'
        })
        return
      }

      setSession({
        status: 'ready',
        mode: 'live',
        member: payload.member,
        telegramUser: payload.telegramUser
      })
    } catch {
      if (import.meta.env.DEV) {
        setSession(demoSession)
        return
      }

      setSession({
        status: 'blocked',
        reason: 'error'
      })
    }
  })

  const renderPanel = () => {
    switch (activeNav()) {
      case 'balances':
        return copy().balancesEmpty
      case 'ledger':
        return copy().ledgerEmpty
      case 'house':
        return copy().houseEmpty
      default:
        return copy().summaryBody
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
              onClick={() => setLocale('en')}
            >
              EN
            </button>
            <button
              classList={{ 'is-active': locale() === 'ru' }}
              type="button"
              onClick={() => setLocale('ru')}
            >
              RU
            </button>
          </div>
        </label>
      </section>

      <Switch>
        <Match when={session().status === 'loading'}>
          <section class="hero-card">
            <span class="pill">{copy().navHint}</span>
            <h2>{copy().loadingTitle}</h2>
            <p>{copy().loadingBody}</p>
          </section>
        </Match>

        <Match when={session().status === 'blocked'}>
          <section class="hero-card">
            <span class="pill">{copy().navHint}</span>
            <h2>
              {blockedSession()?.reason === 'telegram_only'
                ? copy().telegramOnlyTitle
                : copy().unauthorizedTitle}
            </h2>
            <p>
              {blockedSession()?.reason === 'telegram_only'
                ? copy().telegramOnlyBody
                : copy().unauthorizedBody}
            </p>
            <button class="ghost-button" type="button" onClick={() => window.location.reload()}>
              {copy().reload}
            </button>
          </section>
        </Match>

        <Match when={session().status === 'ready'}>
          <section class="hero-card">
            <div class="hero-card__meta">
              <span class="pill">
                {readySession()?.mode === 'demo' ? copy().demoBadge : copy().navHint}
              </span>
              <span class="pill pill--muted">
                {readySession()?.member.isAdmin ? copy().adminTag : copy().residentTag}
              </span>
            </div>

            <h2>
              {copy().welcome},{' '}
              {readySession()?.telegramUser.firstName ?? readySession()?.member.displayName}
            </h2>
            <p>{copy().sectionBody}</p>
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
              <p class="eyebrow">{copy().summaryTitle}</p>
              <h3>{readySession()?.member.displayName}</h3>
              <p>{renderPanel()}</p>
            </article>

            <article class="panel">
              <p class="eyebrow">{copy().cardAccess}</p>
              <p>{copy().cardAccessBody}</p>
            </article>

            <article class="panel">
              <p class="eyebrow">{copy().cardLocale}</p>
              <p>{copy().cardLocaleBody}</p>
            </article>

            <article class="panel">
              <p class="eyebrow">{copy().cardNext}</p>
              <p>{copy().cardNextBody}</p>
            </article>
          </section>
        </Match>
      </Switch>
    </main>
  )
}

export default App
