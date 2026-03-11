import { For, Show } from 'solid-js'

import { FinanceSummaryCards } from '../components/finance/finance-summary-cards'
import type { MiniAppDashboard } from '../miniapp-api'

type Props = {
  copy: Record<string, string | undefined>
  dashboard: MiniAppDashboard | null
  readyIsAdmin: boolean
  pendingMembersCount: number
  currentMemberLine: MiniAppDashboard['members'][number] | null
  utilityTotalMajor: string
  purchaseTotalMajor: string
  memberBaseDueMajor: (member: MiniAppDashboard['members'][number]) => string
  ledgerTitle: (entry: MiniAppDashboard['ledger'][number]) => string
  ledgerPrimaryAmount: (entry: MiniAppDashboard['ledger'][number]) => string
  ledgerSecondaryAmount: (entry: MiniAppDashboard['ledger'][number]) => string | null
}

export function HomeScreen(props: Props) {
  return (
    <Show
      when={props.dashboard}
      fallback={
        <div class="home-grid">
          <div class="summary-card-grid">
            <article class="stat-card">
              <span>{props.copy.remainingLabel ?? ''}</span>
              <strong>—</strong>
            </article>
            <article class="stat-card">
              <span>{props.copy.shareRent ?? ''}</span>
              <strong>—</strong>
            </article>
            <article class="stat-card">
              <span>{props.copy.shareUtilities ?? ''}</span>
              <strong>—</strong>
            </article>
            <article class="stat-card">
              <span>{props.copy.purchasesTitle ?? ''}</span>
              <strong>—</strong>
            </article>
          </div>
        </div>
      }
    >
      {(dashboard) => (
        <div class="home-grid">
          <div class="summary-card-grid">
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
            <Show when={props.readyIsAdmin}>
              <article class="stat-card">
                <span>{props.copy.pendingRequests ?? ''}</span>
                <strong>{String(props.pendingMembersCount)}</strong>
              </article>
            </Show>
          </div>

          <Show when={props.currentMemberLine}>
            {(member) => (
              <article class="balance-item balance-item--accent">
                <header>
                  <strong>{props.copy.yourBalanceTitle ?? ''}</strong>
                  <span>
                    {member().remainingMajor} {dashboard().currency}
                  </span>
                </header>
                <p>
                  {props.copy.shareRent ?? ''}: {dashboard().rentSourceAmountMajor}{' '}
                  {dashboard().rentSourceCurrency}
                  {dashboard().rentSourceCurrency !== dashboard().currency
                    ? ` -> ${dashboard().rentDisplayAmountMajor} ${dashboard().currency}`
                    : ''}
                </p>
                <div class="balance-breakdown">
                  <article class="stat-card">
                    <span>{props.copy.baseDue ?? ''}</span>
                    <strong>
                      {props.memberBaseDueMajor(member())} {dashboard().currency}
                    </strong>
                  </article>
                  <article class="stat-card">
                    <span>{props.copy.shareOffset ?? ''}</span>
                    <strong>
                      {member().purchaseOffsetMajor} {dashboard().currency}
                    </strong>
                  </article>
                  <article class="stat-card">
                    <span>{props.copy.finalDue ?? ''}</span>
                    <strong>
                      {member().netDueMajor} {dashboard().currency}
                    </strong>
                  </article>
                  <article class="stat-card">
                    <span>{props.copy.paidLabel ?? ''}</span>
                    <strong>
                      {member().paidMajor} {dashboard().currency}
                    </strong>
                  </article>
                  <article class="stat-card">
                    <span>{props.copy.remainingLabel ?? ''}</span>
                    <strong>
                      {member().remainingMajor} {dashboard().currency}
                    </strong>
                  </article>
                </div>
              </article>
            )}
          </Show>

          <article class="balance-item balance-item--wide">
            <header>
              <strong>{props.copy.latestActivityTitle ?? ''}</strong>
            </header>
            {dashboard().ledger.length === 0 ? (
              <p>{props.copy.latestActivityEmpty ?? ''}</p>
            ) : (
              <div class="activity-list">
                <For each={dashboard().ledger.slice(0, 3)}>
                  {(entry) => (
                    <article class="activity-row">
                      <header>
                        <strong>{props.ledgerTitle(entry)}</strong>
                        <span>{props.ledgerPrimaryAmount(entry)}</span>
                      </header>
                      <Show when={props.ledgerSecondaryAmount(entry)}>
                        {(secondary) => <p>{secondary()}</p>}
                      </Show>
                      <p>{entry.actorDisplayName ?? props.copy.ledgerActorFallback ?? ''}</p>
                    </article>
                  )}
                </For>
              </div>
            )}
          </article>
        </div>
      )}
    </Show>
  )
}
