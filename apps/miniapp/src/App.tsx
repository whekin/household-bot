import { Route, Router } from '@solidjs/router'
import { Match, Switch } from 'solid-js'

import { I18nProvider, useI18n } from './contexts/i18n-context'
import { SessionProvider, useSession, joinDeepLink } from './contexts/session-context'
import { DashboardProvider, useDashboard } from './contexts/dashboard-context'
import { AppShell } from './components/layout/shell'
import { LoadingState } from './components/session/loading-state'
import { BlockedState } from './components/session/blocked-state'
import { OnboardingState } from './components/session/onboarding-state'
import HomeRoute from './routes/home'
import BalancesRoute from './routes/balances'
import BillsRoute from './routes/bills'
import LedgerRoute from './routes/ledger'
import SettingsRoute from './routes/settings'

function AppContent() {
  const { session, onboardingSession, blockedSession, joining, handleJoinHousehold } = useSession()
  const { copy } = useI18n()

  return (
    <Switch>
      <Match when={session().status === 'loading'}>
        <main class="shell shell--centered">
          <LoadingState
            badge={copy().loadingBadge}
            title={copy().loadingTitle}
            body={copy().loadingBody}
          />
        </main>
      </Match>

      <Match when={session().status === 'blocked'}>
        <main class="shell shell--centered">
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
        </main>
      </Match>

      <Match when={session().status === 'onboarding'}>
        <main class="shell shell--centered">
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
        </main>
      </Match>

      <Match when={session().status === 'ready'}>
        <DashboardProvider>
          <AuthenticatedApp />
        </DashboardProvider>
      </Match>
    </Switch>
  )
}

function AuthenticatedApp() {
  const { initData } = useSession()
  const { loadDashboardData } = useDashboard()

  // Load dashboard data once the component mounts
  const data = initData()
  void loadDashboardData(data ?? '', true)

  return (
    <Router root={AppShell}>
      <Route path="/" component={HomeRoute} />
      <Route path="/balances" component={BalancesRoute} />
      <Route path="/bills" component={BillsRoute} />
      <Route path="/ledger" component={LedgerRoute} />
      <Route path="/settings" component={SettingsRoute} />
    </Router>
  )
}

function App() {
  return (
    <I18nProvider>
      <SessionProvider>
        <AppContent />
      </SessionProvider>
    </I18nProvider>
  )
}

export default App
