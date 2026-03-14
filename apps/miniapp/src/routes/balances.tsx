import { Show, For, Switch, Match } from 'solid-js'
import { BarChart3 } from 'lucide-solid'

import { useI18n } from '../contexts/i18n-context'
import { useDashboard } from '../contexts/dashboard-context'
import { Card } from '../components/ui/card'
import { Skeleton } from '../components/ui/skeleton'
import { memberRemainingClass } from '../lib/ledger-helpers'

export default function BalancesRoute() {
  const { copy } = useI18n()
  const { dashboard, loading, memberBalanceVisuals, purchaseInvestmentChart } = useDashboard()

  return (
    <div class="route route--balances">
      <Switch>
        <Match when={loading()}>
          <Card>
            <div class="section-header">
              <Skeleton style={{ width: '180px', height: '20px' }} />
              <Skeleton style={{ width: '100%', height: '16px', 'margin-top': '8px' }} />
            </div>
            <div style={{ 'margin-top': '16px' }}>
              <Skeleton style={{ width: '100%', height: '120px' }} />
            </div>
          </Card>
          <Card>
            <Skeleton style={{ width: '200px', height: '20px' }} />
            <Skeleton style={{ width: '100%', height: '80px', 'margin-top': '16px' }} />
          </Card>
        </Match>

        <Match when={!dashboard()}>
          <Card>
            <p class="empty-state">{copy().balancesEmpty}</p>
          </Card>
        </Match>

        <Match when={dashboard()}>
          {(data) => (
            <>
              {/* ── Household balances ─────────────────── */}
              <Card>
                <div class="section-header">
                  <strong>{copy().householdBalancesTitle}</strong>
                  <p>{copy().householdBalancesBody}</p>
                </div>
                <div class="member-balance-list">
                  <For each={data().members}>
                    {(member) => (
                      <div class={`member-balance-row ${memberRemainingClass(member)}`}>
                        <span class="member-balance-row__name">{member.displayName}</span>
                        <div class="member-balance-row__amounts">
                          <span class="member-balance-row__due">
                            {member.netDueMajor} {data().currency}
                          </span>
                          <span class="member-balance-row__remaining">
                            {member.remainingMajor} {data().currency}
                          </span>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Card>

              {/* ── Balance breakdown bars ──────────────── */}
              <Card>
                <div class="section-header">
                  <BarChart3 size={16} />
                  <strong>{copy().financeVisualsTitle}</strong>
                  <p>{copy().financeVisualsBody}</p>
                </div>
                <div class="balance-visuals">
                  <For each={memberBalanceVisuals()}>
                    {(item) => (
                      <div class="balance-bar-row">
                        <span class="balance-bar-row__name">{item.member.displayName}</span>
                        <div
                          class="balance-bar-row__track"
                          style={{ width: `${Math.max(item.barWidthPercent, 8)}%` }}
                        >
                          <For each={item.segments}>
                            {(segment) => (
                              <div
                                class={`balance-bar-row__segment balance-bar-row__segment--${segment.key}`}
                                style={{ width: `${segment.widthPercent}%` }}
                                title={`${segment.label}: ${segment.amountMajor} ${data().currency}`}
                              />
                            )}
                          </For>
                        </div>
                        <span class={`balance-bar-row__label ${memberRemainingClass(item.member)}`}>
                          {item.member.remainingMajor} {data().currency}
                        </span>
                      </div>
                    )}
                  </For>
                  <div class="balance-bar-legend">
                    <span class="balance-bar-legend__item balance-bar-legend__item--rent">
                      {copy().shareRent}
                    </span>
                    <span class="balance-bar-legend__item balance-bar-legend__item--utilities">
                      {copy().shareUtilities}
                    </span>
                    <span class="balance-bar-legend__item balance-bar-legend__item--purchase">
                      {copy().shareOffset}
                    </span>
                  </div>
                </div>
              </Card>

              {/* ── Purchase investment donut ───────────── */}
              <Card>
                <div class="section-header">
                  <strong>{copy().purchaseInvestmentsTitle}</strong>
                  <p>{copy().purchaseInvestmentsBody}</p>
                </div>
                <Show
                  when={purchaseInvestmentChart().slices.length > 0}
                  fallback={<p class="empty-state">{copy().purchaseInvestmentsEmpty}</p>}
                >
                  <div class="donut-chart">
                    <svg viewBox="0 0 100 100" class="donut-chart__svg">
                      <For each={purchaseInvestmentChart().slices}>
                        {(slice) => (
                          <circle
                            cx="50"
                            cy="50"
                            r="42"
                            fill="none"
                            stroke={slice.color}
                            stroke-width="12"
                            stroke-dasharray={slice.dasharray}
                            stroke-dashoffset={slice.dashoffset}
                            class="donut-chart__slice"
                          />
                        )}
                      </For>
                      <text x="50" y="48" text-anchor="middle" class="donut-chart__total">
                        {purchaseInvestmentChart().totalMajor}
                      </text>
                      <text x="50" y="58" text-anchor="middle" class="donut-chart__label">
                        {data().currency}
                      </text>
                    </svg>
                    <div class="donut-chart__legend">
                      <For each={purchaseInvestmentChart().slices}>
                        {(slice) => (
                          <div class="donut-chart__legend-item">
                            <span class="donut-chart__color" style={{ background: slice.color }} />
                            <span>{slice.label}</span>
                            <strong>
                              {slice.amountMajor} ({slice.percentage}%)
                            </strong>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>
              </Card>
            </>
          )}
        </Match>
      </Switch>
    </div>
  )
}
