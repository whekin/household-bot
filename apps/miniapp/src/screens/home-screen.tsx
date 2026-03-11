import { For, Show } from 'solid-js'

import { FinanceSummaryCards } from '../components/finance/finance-summary-cards'
import { FinanceVisuals } from '../components/finance/finance-visuals'
import type { MiniAppDashboard } from '../miniapp-api'

type Props = {
  copy: Record<string, string | undefined>
  dashboard: MiniAppDashboard | null
  readyIsAdmin: boolean
  pendingMembersCount: number
  currentMemberLine: MiniAppDashboard['members'][number] | null
  utilityTotalMajor: string
  purchaseTotalMajor: string
  memberBalanceVisuals: {
    member: MiniAppDashboard['members'][number]
    totalMinor: bigint
    barWidthPercent: number
    segments: {
      key: string
      label: string
      amountMajor: string
      amountMinor: bigint
      widthPercent: number
    }[]
  }[]
  purchaseChart: {
    totalMajor: string
    slices: {
      key: string
      label: string
      amountMajor: string
      color: string
      percentage: number
      dasharray: string
      dashoffset: string
    }[]
  }
  memberBaseDueMajor: (member: MiniAppDashboard['members'][number]) => string
  memberRemainingClass: (member: MiniAppDashboard['members'][number]) => string
  ledgerTitle: (entry: MiniAppDashboard['ledger'][number]) => string
  ledgerPrimaryAmount: (entry: MiniAppDashboard['ledger'][number]) => string
  ledgerSecondaryAmount: (entry: MiniAppDashboard['ledger'][number]) => string | null
}

export function HomeScreen(props: Props) {
  if (!props.dashboard) {
    return (
      <div class="home-grid home-grid--summary">
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
    )
  }

  return (
    <div class="home-grid home-grid--summary">
      <FinanceSummaryCards
        dashboard={props.dashboard}
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

      <Show
        when={props.currentMemberLine}
        fallback={
          <article class="balance-item">
            <header>
              <strong>{props.copy.overviewTitle ?? ''}</strong>
            </header>
            <p>{props.copy.overviewBody ?? ''}</p>
          </article>
        }
      >
        {(member) => (
          <article class="balance-item balance-item--accent">
            <header>
              <strong>{props.copy.yourBalanceTitle ?? ''}</strong>
              <span>
                {member().remainingMajor} {props.dashboard!.currency}
              </span>
            </header>
            <p>{props.copy.yourBalanceBody ?? ''}</p>
            <p>
              {props.copy.shareRent ?? ''}: {props.dashboard!.rentSourceAmountMajor}{' '}
              {props.dashboard!.rentSourceCurrency}
              {props.dashboard!.rentSourceCurrency !== props.dashboard!.currency
                ? ` -> ${props.dashboard!.rentDisplayAmountMajor} ${props.dashboard!.currency}`
                : ''}
            </p>
            <div class="balance-breakdown">
              <article class="stat-card">
                <span>{props.copy.baseDue ?? ''}</span>
                <strong>
                  {props.memberBaseDueMajor(member())} {props.dashboard!.currency}
                </strong>
              </article>
              <article class="stat-card">
                <span>{props.copy.shareOffset ?? ''}</span>
                <strong>
                  {member().purchaseOffsetMajor} {props.dashboard!.currency}
                </strong>
              </article>
              <article class="stat-card">
                <span>{props.copy.finalDue ?? ''}</span>
                <strong>
                  {member().netDueMajor} {props.dashboard!.currency}
                </strong>
              </article>
              <article class="stat-card">
                <span>{props.copy.paidLabel ?? ''}</span>
                <strong>
                  {member().paidMajor} {props.dashboard!.currency}
                </strong>
              </article>
              <article class="stat-card">
                <span>{props.copy.remainingLabel ?? ''}</span>
                <strong>
                  {member().remainingMajor} {props.dashboard!.currency}
                </strong>
              </article>
            </div>
          </article>
        )}
      </Show>

      <FinanceVisuals
        dashboard={props.dashboard}
        memberVisuals={props.memberBalanceVisuals}
        purchaseChart={props.purchaseChart}
        remainingClass={props.memberRemainingClass}
        labels={{
          financeVisualsTitle: props.copy.financeVisualsTitle ?? '',
          financeVisualsBody: props.copy.financeVisualsBody ?? '',
          membersCount: props.copy.membersCount ?? '',
          purchaseInvestmentsTitle: props.copy.purchaseInvestmentsTitle ?? '',
          purchaseInvestmentsBody: props.copy.purchaseInvestmentsBody ?? '',
          purchaseInvestmentsEmpty: props.copy.purchaseInvestmentsEmpty ?? '',
          purchaseTotalLabel: props.copy.purchaseTotalLabel ?? '',
          purchaseShareLabel: props.copy.purchaseShareLabel ?? ''
        }}
      />

      <article class="balance-item balance-item--wide">
        <header>
          <strong>{props.copy.latestActivityTitle ?? ''}</strong>
        </header>
        {props.dashboard.ledger.length === 0 ? (
          <p>{props.copy.latestActivityEmpty ?? ''}</p>
        ) : (
          <div class="activity-list">
            <For each={props.dashboard.ledger.slice(0, 3)}>
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
  )
}
