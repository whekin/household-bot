import { For, Show } from 'solid-js'

import { FinanceSummaryCards } from '../components/finance/finance-summary-cards'
import { FinanceVisuals } from '../components/finance/finance-visuals'
import type { MiniAppDashboard } from '../miniapp-api'

type Props = {
  copy: Record<string, string | undefined>
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
  if (!props.dashboard) {
    return (
      <div class="balance-list">
        <p>{props.copy.emptyDashboard ?? ''}</p>
      </div>
    )
  }

  return (
    <div class="balance-list">
      <Show when={props.currentMemberLine}>
        {(member) => (
          <article class="balance-item balance-item--accent">
            <header>
              <strong>{props.copy.yourBalanceTitle ?? ''}</strong>
              <span>
                {member().netDueMajor} {props.dashboard!.currency}
              </span>
            </header>
            <p>{props.copy.yourBalanceBody ?? ''}</p>
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
      <div class="summary-card-grid">
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
      </div>
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
      <article class="balance-item">
        <header>
          <strong>{props.copy.householdBalancesTitle ?? ''}</strong>
        </header>
        <p>{props.copy.householdBalancesBody ?? ''}</p>
      </article>
      <For each={props.dashboard.members}>
        {(member) => (
          <article class="balance-item">
            <header>
              <strong>{member.displayName}</strong>
              <span>
                {member.remainingMajor} {props.dashboard!.currency}
              </span>
            </header>
            <p>
              {props.copy.baseDue ?? ''}: {props.memberBaseDueMajor(member)}{' '}
              {props.dashboard!.currency}
            </p>
            <p>
              {props.copy.shareRent ?? ''}: {member.rentShareMajor} {props.dashboard!.currency}
            </p>
            <p>
              {props.copy.shareUtilities ?? ''}: {member.utilityShareMajor}{' '}
              {props.dashboard!.currency}
            </p>
            <p>
              {props.copy.shareOffset ?? ''}: {member.purchaseOffsetMajor}{' '}
              {props.dashboard!.currency}
            </p>
            <p>
              {props.copy.paidLabel ?? ''}: {member.paidMajor} {props.dashboard!.currency}
            </p>
            <p class={`balance-status ${props.memberRemainingClass(member)}`}>
              {props.copy.remainingLabel ?? ''}: {member.remainingMajor} {props.dashboard!.currency}
            </p>
          </article>
        )}
      </For>
    </div>
  )
}
