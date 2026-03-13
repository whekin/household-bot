import { Show, For } from 'solid-js'
import { Clock } from 'lucide-solid'

import { useSession } from '../contexts/session-context'
import { useI18n } from '../contexts/i18n-context'
import { useDashboard } from '../contexts/dashboard-context'
import { Card } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { memberRemainingClass, ledgerPrimaryAmount } from '../lib/ledger-helpers'
import { majorStringToMinor, minorToMajorString } from '../lib/money'

export default function HomeRoute() {
  const { readySession } = useSession()
  const { copy } = useI18n()
  const { dashboard, currentMemberLine } = useDashboard()

  function dueStatusBadge() {
    const data = dashboard()
    if (!data) return null

    const remaining = majorStringToMinor(data.totalRemainingMajor)
    if (remaining <= 0n) return { label: copy().homeSettledTitle, variant: 'accent' as const }
    return { label: copy().homeDueTitle, variant: 'danger' as const }
  }

  return (
    <div class="route route--home">
      {/* ── Welcome hero ────────────────────────────── */}
      <div class="home-hero">
        <p class="home-hero__greeting">{copy().welcome},</p>
        <h2 class="home-hero__name">{readySession()?.member.displayName}</h2>
      </div>

      {/* ── Dashboard stats ─────────────────────────── */}
      <Show
        when={dashboard()}
        fallback={
          <Card>
            <p class="empty-state">{copy().emptyDashboard}</p>
          </Card>
        }
      >
        {(data) => (
          <>
            {/* Your balance card */}
            <Show when={currentMemberLine()}>
              {(member) => {
                const subtotalMinor =
                  majorStringToMinor(member().rentShareMajor) +
                  majorStringToMinor(member().utilityShareMajor)
                const subtotalMajor = minorToMajorString(subtotalMinor)

                return (
                  <Card accent>
                    <div class="balance-card">
                      <div class="balance-card__header">
                        <span class="balance-card__label">{copy().yourBalanceTitle}</span>
                        <Show when={dueStatusBadge()}>
                          {(badge) => <Badge variant={badge().variant}>{badge().label}</Badge>}
                        </Show>
                      </div>
                      <div class="balance-card__amounts">
                        <div class="balance-card__row">
                          <span>{copy().shareRent}</span>
                          <strong>
                            {member().rentShareMajor} {data().currency}
                          </strong>
                        </div>
                        <div class="balance-card__row">
                          <span>{copy().shareUtilities}</span>
                          <strong>
                            {member().utilityShareMajor} {data().currency}
                          </strong>
                        </div>
                        <div class="balance-card__row balance-card__row--subtotal">
                          <span>{copy().totalDueLabel}</span>
                          <strong>
                            {subtotalMajor} {data().currency}
                          </strong>
                        </div>
                        <div class="balance-card__row">
                          <span>{copy().balanceAdjustmentLabel}</span>
                          <strong>
                            {member().purchaseOffsetMajor} {data().currency}
                          </strong>
                        </div>
                        <div
                          class={`balance-card__row balance-card__remaining ${memberRemainingClass(member())}`}
                        >
                          <span>{copy().remainingLabel}</span>
                          <strong>
                            {member().remainingMajor} {data().currency}
                          </strong>
                        </div>
                      </div>
                    </div>
                  </Card>
                )
              }}
            </Show>

            {/* Rent FX card */}
            <Show when={data().rentSourceCurrency !== data().currency}>
              <Card muted>
                <div class="fx-card">
                  <strong class="fx-card__title">{copy().rentFxTitle}</strong>
                  <div class="fx-card__row">
                    <span>{copy().sourceAmountLabel}</span>
                    <strong>
                      {data().rentSourceAmountMajor} {data().rentSourceCurrency}
                    </strong>
                  </div>
                  <div class="fx-card__row">
                    <span>{copy().settlementAmountLabel}</span>
                    <strong>
                      {data().rentDisplayAmountMajor} {data().currency}
                    </strong>
                  </div>
                  <Show when={data().rentFxEffectiveDate}>
                    <div class="fx-card__row fx-card__row--muted">
                      <span>{copy().fxEffectiveDateLabel}</span>
                      <span>{data().rentFxEffectiveDate}</span>
                    </div>
                  </Show>
                </div>
              </Card>
            </Show>

            {/* Latest activity */}
            <Card>
              <div class="activity-card">
                <div class="activity-card__header">
                  <Clock size={16} />
                  <span>{copy().latestActivityTitle}</span>
                </div>
                <Show
                  when={data().ledger.length > 0}
                  fallback={<p class="empty-state">{copy().latestActivityEmpty}</p>}
                >
                  <div class="activity-card__list">
                    <For each={data().ledger.slice(0, 5)}>
                      {(entry) => (
                        <div class="activity-card__item">
                          <span class="activity-card__title">{entry.title}</span>
                          <span class="activity-card__amount">{ledgerPrimaryAmount(entry)}</span>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </Card>
          </>
        )}
      </Show>
    </div>
  )
}
