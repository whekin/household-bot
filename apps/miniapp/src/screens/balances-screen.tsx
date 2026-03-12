import { Show } from 'solid-js'

import { MemberBalanceCard } from '../components/finance/member-balance-card'
import type { MiniAppDashboard } from '../miniapp-api'

type Props = {
  copy: Record<string, string | undefined>
  dashboard: MiniAppDashboard | null
  currentMemberLine: MiniAppDashboard['members'][number] | null
}

export function BalancesScreen(props: Props) {
  return (
    <Show
      when={props.dashboard}
      fallback={
        <div class="balance-list">
          <p>{props.copy.emptyDashboard ?? ''}</p>
        </div>
      }
    >
      {(dashboard) => (
        <div class="balance-list">
          <Show when={props.currentMemberLine}>
            {(member) => (
              <MemberBalanceCard
                copy={props.copy}
                dashboard={dashboard()}
                member={member()}
                detail
              />
            )}
          </Show>
          <article class="balance-item balance-item--muted">
            <header>
              <strong>{props.copy.balanceScreenScopeTitle ?? ''}</strong>
              <span>{dashboard().period}</span>
            </header>
            <p>{props.copy.balanceScreenScopeBody ?? ''}</p>
          </article>
        </div>
      )}
    </Show>
  )
}
