import { Show } from 'solid-js'

import { FinanceSummaryCards } from '../components/finance/finance-summary-cards'
import { MemberBalanceCard } from '../components/finance/member-balance-card'
import type { MiniAppDashboard } from '../miniapp-api'

type Props = {
  copy: Record<string, string | undefined>
  dashboard: MiniAppDashboard | null
  currentMemberLine: MiniAppDashboard['members'][number] | null
  utilityTotalMajor: string
  purchaseTotalMajor: string
}

export function HomeScreen(props: Props) {
  return (
    <Show
      when={props.dashboard}
      fallback={
        <div class="home-grid">
          <article class="balance-item balance-item--accent balance-spotlight">
            <header class="balance-spotlight__header">
              <div class="balance-spotlight__copy">
                <strong>{props.copy.yourBalanceTitle ?? ''}</strong>
                <p>{props.copy.yourBalanceBody ?? ''}</p>
              </div>
              <div class="balance-spotlight__hero">
                <span>{props.copy.remainingLabel ?? ''}</span>
                <strong>—</strong>
              </div>
            </header>
          </article>
        </div>
      }
    >
      {(dashboard) => (
        <div class="home-grid">
          <Show when={props.currentMemberLine}>
            {(member) => (
              <MemberBalanceCard copy={props.copy} dashboard={dashboard()} member={member()} />
            )}
          </Show>

          <article class="balance-item balance-item--wide balance-item--muted">
            <header>
              <strong>{props.copy.houseSnapshotTitle ?? ''}</strong>
              <span>{dashboard().period}</span>
            </header>
            <p>{props.copy.houseSnapshotBody ?? ''}</p>
            <div class="summary-card-grid summary-card-grid--secondary">
              <FinanceSummaryCards
                dashboard={dashboard()}
                utilityTotalMajor={props.utilityTotalMajor}
                purchaseTotalMajor={props.purchaseTotalMajor}
                labels={{
                  remaining: props.copy.remainingLabel ?? '',
                  rent: props.copy.shareRent ?? '',
                  utilities: props.copy.shareUtilities ?? '',
                  purchases: props.copy.purchasesTitle ?? ''
                }}
              />
            </div>
          </article>
        </div>
      )}
    </Show>
  )
}
