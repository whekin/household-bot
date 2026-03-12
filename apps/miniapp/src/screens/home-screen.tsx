import { Show } from 'solid-js'

import { FinanceSummaryCards } from '../components/finance/finance-summary-cards'
import { sumMajorStrings } from '../lib/money'
import type { MiniAppDashboard } from '../miniapp-api'

type Props = {
  copy: Record<string, string | undefined>
  dashboard: MiniAppDashboard | null
  currentMemberLine: MiniAppDashboard['members'][number] | null
  utilityTotalMajor: string
  purchaseTotalMajor: string
}

export function HomeScreen(props: Props) {
  const adjustedRentMajor = () => {
    if (!props.currentMemberLine) {
      return null
    }

    return sumMajorStrings(
      props.currentMemberLine.rentShareMajor,
      props.currentMemberLine.purchaseOffsetMajor
    )
  }

  const adjustedUtilitiesMajor = () => {
    if (!props.currentMemberLine) {
      return null
    }

    return sumMajorStrings(
      props.currentMemberLine.utilityShareMajor,
      props.currentMemberLine.purchaseOffsetMajor
    )
  }

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
              <article class="balance-item balance-item--accent home-pay-card">
                <header class="home-pay-card__header">
                  <div class="home-pay-card__copy">
                    <strong>{props.copy.payNowTitle ?? props.copy.yourBalanceTitle ?? ''}</strong>
                    <p>{props.copy.payNowBody ?? ''}</p>
                  </div>
                  <div class="balance-spotlight__hero">
                    <span>{props.copy.remainingLabel ?? ''}</span>
                    <strong>
                      {member().remainingMajor} {dashboard().currency}
                    </strong>
                    <small>
                      {props.copy.totalDue ?? ''}: {member().netDueMajor} {dashboard().currency}
                    </small>
                  </div>
                </header>

                <div class="balance-spotlight__stats">
                  <article class="stat-card balance-spotlight__stat">
                    <span>{props.copy.paidLabel ?? ''}</span>
                    <strong>
                      {member().paidMajor} {dashboard().currency}
                    </strong>
                  </article>
                  <article class="stat-card balance-spotlight__stat">
                    <span>{props.copy.currentCycleLabel ?? ''}</span>
                    <strong>{dashboard().period}</strong>
                  </article>
                </div>

                <div class="home-pay-card__chips">
                  <span class="mini-chip">
                    {dashboard().paymentBalanceAdjustmentPolicy === 'rent'
                      ? props.copy.rentAdjustedTotalLabel
                      : props.copy.shareRent}
                    :{' '}
                    {dashboard().paymentBalanceAdjustmentPolicy === 'rent'
                      ? adjustedRentMajor()
                      : member().rentShareMajor}{' '}
                    {dashboard().currency}
                  </span>
                  <span class="mini-chip mini-chip--muted">
                    {dashboard().paymentBalanceAdjustmentPolicy === 'utilities'
                      ? props.copy.utilitiesAdjustedTotalLabel
                      : props.copy.shareUtilities}
                    :{' '}
                    {dashboard().paymentBalanceAdjustmentPolicy === 'utilities'
                      ? adjustedUtilitiesMajor()
                      : member().utilityShareMajor}{' '}
                    {dashboard().currency}
                  </span>
                  <span class="mini-chip mini-chip--muted">
                    {props.copy.balanceAdjustmentLabel ?? props.copy.shareOffset}:{' '}
                    {member().purchaseOffsetMajor} {dashboard().currency}
                  </span>
                </div>
              </article>
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
