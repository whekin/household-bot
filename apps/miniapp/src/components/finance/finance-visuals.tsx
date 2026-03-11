import { For, Match, Switch } from 'solid-js'

import type { MiniAppDashboard } from '../../miniapp-api'

type MemberVisual = {
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
}

type PurchaseSlice = {
  key: string
  label: string
  amountMajor: string
  color: string
  percentage: number
  dasharray: string
  dashoffset: string
}

type Props = {
  dashboard: MiniAppDashboard
  memberVisuals: readonly MemberVisual[]
  purchaseChart: {
    totalMajor: string
    slices: readonly PurchaseSlice[]
  }
  labels: {
    financeVisualsTitle: string
    financeVisualsBody: string
    membersCount: string
    purchaseInvestmentsTitle: string
    purchaseInvestmentsBody: string
    purchaseInvestmentsEmpty: string
    purchaseTotalLabel: string
    purchaseShareLabel: string
  }
  remainingClass: (member: MiniAppDashboard['members'][number]) => string
}

export function FinanceVisuals(props: Props) {
  return (
    <>
      <article class="balance-item balance-item--wide">
        <header>
          <strong>{props.labels.financeVisualsTitle}</strong>
          <span>
            {props.labels.membersCount}: {String(props.dashboard.members.length)}
          </span>
        </header>
        <p>{props.labels.financeVisualsBody}</p>
        <div class="member-visual-list">
          <For each={props.memberVisuals}>
            {(item) => (
              <article class="member-visual-card">
                <header>
                  <strong>{item.member.displayName}</strong>
                  <span class={`balance-status ${props.remainingClass(item.member)}`}>
                    {item.member.remainingMajor} {props.dashboard.currency}
                  </span>
                </header>
                <div class="member-visual-bar">
                  <div
                    class="member-visual-bar__track"
                    style={{ width: `${item.barWidthPercent}%` }}
                  >
                    <For each={item.segments}>
                      {(segment) => (
                        <span
                          class={`member-visual-bar__segment member-visual-bar__segment--${segment.key}`}
                          style={{ width: `${segment.widthPercent}%` }}
                        />
                      )}
                    </For>
                  </div>
                </div>
                <div class="member-visual-meta">
                  <For each={item.segments}>
                    {(segment) => (
                      <span class={`member-visual-chip member-visual-chip--${segment.key}`}>
                        {segment.label}: {segment.amountMajor} {props.dashboard.currency}
                      </span>
                    )}
                  </For>
                </div>
              </article>
            )}
          </For>
        </div>
      </article>

      <article class="balance-item balance-item--wide">
        <header>
          <strong>{props.labels.purchaseInvestmentsTitle}</strong>
          <span>
            {props.labels.purchaseTotalLabel}: {props.purchaseChart.totalMajor}{' '}
            {props.dashboard.currency}
          </span>
        </header>
        <p>{props.labels.purchaseInvestmentsBody}</p>
        <Switch>
          <Match when={props.purchaseChart.slices.length === 0}>
            <p>{props.labels.purchaseInvestmentsEmpty}</p>
          </Match>
          <Match when={props.purchaseChart.slices.length > 0}>
            <div class="purchase-chart">
              <div class="purchase-chart__figure">
                <svg class="purchase-chart__donut" viewBox="0 0 120 120" aria-hidden="true">
                  <circle class="purchase-chart__ring" cx="60" cy="60" r="42" />
                  <For each={props.purchaseChart.slices}>
                    {(slice) => (
                      <circle
                        class="purchase-chart__slice"
                        cx="60"
                        cy="60"
                        r="42"
                        stroke={slice.color}
                        stroke-dasharray={slice.dasharray}
                        stroke-dashoffset={slice.dashoffset}
                      />
                    )}
                  </For>
                </svg>
                <div class="purchase-chart__center">
                  <strong>{props.purchaseChart.totalMajor}</strong>
                  <small>{props.dashboard.currency}</small>
                </div>
              </div>
              <div class="purchase-chart__legend">
                <For each={props.purchaseChart.slices}>
                  {(slice) => (
                    <article class="purchase-chart__legend-item">
                      <div>
                        <span
                          class="purchase-chart__legend-swatch"
                          style={{ 'background-color': slice.color }}
                        />
                        <strong>{slice.label}</strong>
                      </div>
                      <p>
                        {slice.amountMajor} {props.dashboard.currency} ·{' '}
                        {props.labels.purchaseShareLabel} {slice.percentage}%
                      </p>
                    </article>
                  )}
                </For>
              </div>
            </div>
          </Match>
        </Switch>
      </article>
    </>
  )
}
