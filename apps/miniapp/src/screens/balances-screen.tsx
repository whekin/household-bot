import { For, Show } from 'solid-js'

import { FinanceSummaryCards } from '../components/finance/finance-summary-cards'
import { FinanceVisuals } from '../components/finance/finance-visuals'
import { MemberBalanceCard } from '../components/finance/member-balance-card'
import { formatCyclePeriod } from '../lib/dates'
import type { MiniAppDashboard } from '../miniapp-api'

type Props = {
  copy: Record<string, string | undefined>
  locale: 'en' | 'ru'
  dashboard: MiniAppDashboard | null
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
                locale={props.locale}
                dashboard={dashboard()}
                member={member()}
                detail
              />
            )}
          </Show>
          <article class="balance-item balance-item--muted">
            <header>
              <strong>{props.copy.balanceScreenScopeTitle ?? ''}</strong>
              <span>{formatCyclePeriod(dashboard().period, props.locale)}</span>
            </header>
            <p>{props.copy.balanceScreenScopeBody ?? ''}</p>
          </article>
          <article class="balance-item balance-item--wide balance-item--muted">
            <header>
              <strong>{props.copy.houseSnapshotTitle ?? ''}</strong>
              <span>{formatCyclePeriod(dashboard().period, props.locale)}</span>
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
          <FinanceVisuals
            dashboard={dashboard()}
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
          <section class="balance-item balance-item--wide balance-section">
            <header class="balance-section__header">
              <div class="balance-section__copy">
                <strong>{props.copy.householdBalancesTitle ?? ''}</strong>
                <p>{props.copy.householdBalancesBody ?? ''}</p>
              </div>
              <span class="mini-chip mini-chip--muted">
                {String(dashboard().members.length)} {props.copy.membersCount ?? ''}
              </span>
            </header>
            <div class="household-balance-list">
              <For each={dashboard().members}>
                {(member) => (
                  <article class="ledger-compact-card household-balance-list__card">
                    <div class="ledger-compact-card__main">
                      <header>
                        <strong>{member.displayName}</strong>
                        <span class={`balance-status ${props.memberRemainingClass(member)}`}>
                          {member.remainingMajor} {dashboard().currency}
                        </span>
                      </header>
                      <div class="ledger-compact-card__meta">
                        <span class="mini-chip mini-chip--muted">
                          {props.copy.baseDue ?? ''}: {props.memberBaseDueMajor(member)}{' '}
                          {dashboard().currency}
                        </span>
                        <span class="mini-chip mini-chip--muted">
                          {props.copy.shareRent ?? ''}: {member.rentShareMajor}{' '}
                          {dashboard().currency}
                        </span>
                        <span class="mini-chip mini-chip--muted">
                          {props.copy.shareUtilities ?? ''}: {member.utilityShareMajor}{' '}
                          {dashboard().currency}
                        </span>
                        <span class="mini-chip mini-chip--muted">
                          {props.copy.shareOffset ?? ''}: {member.purchaseOffsetMajor}{' '}
                          {dashboard().currency}
                        </span>
                        <span class="mini-chip mini-chip--muted">
                          {props.copy.paidLabel ?? ''}: {member.paidMajor} {dashboard().currency}
                        </span>
                      </div>
                    </div>
                  </article>
                )}
              </For>
            </div>
          </section>
        </div>
      )}
    </Show>
  )
}
