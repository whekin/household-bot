import { useNavigate } from '@solidjs/router'
import { For, Match, Switch, createMemo } from 'solid-js'

import { useDashboard } from '../contexts/dashboard-context'
import { useI18n } from '../contexts/i18n-context'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Skeleton } from '../components/ui/skeleton'
import { formatFriendlyDate } from '../lib/dates'
import { formatMoneyLabel } from '../lib/ledger-helpers'

export default function ActivityRoute() {
  const navigate = useNavigate()
  const { copy, locale } = useI18n()
  const { dashboard, loading, purchaseLedger, paymentLedger } = useDashboard()

  const recentActivity = createMemo(() => {
    const data = dashboard()
    if (!data) return []

    return [...data.ledger]
      .filter((entry) => entry.kind === 'purchase' || entry.kind === 'payment')
      .sort((left, right) => (right.occurredAt ?? '').localeCompare(left.occurredAt ?? ''))
      .slice(0, 8)
      .map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        title: entry.title,
        dateLabel: entry.occurredAt ? formatFriendlyDate(entry.occurredAt, locale()) : '—',
        amountLabel: formatMoneyLabel(entry.displayAmountMajor, entry.displayCurrency, locale()),
        actor: entry.actorDisplayName ?? '—'
      }))
  })

  const unresolvedPurchasesCount = createMemo(
    () => purchaseLedger().filter((entry) => entry.resolutionStatus !== 'resolved').length
  )

  return (
    <div class="route route--activity">
      <Switch>
        <Match when={loading()}>
          <Card>
            <Skeleton style={{ width: '160px', height: '20px' }} />
            <Skeleton style={{ width: '100%', height: '88px', 'margin-top': '16px' }} />
          </Card>
        </Match>

        <Match when={!dashboard()}>
          <Card>
            <p class="empty-state">{copy().emptyDashboard}</p>
          </Card>
        </Match>

        <Match when={dashboard()}>
          <div class="activity-stack">
            <Card class="activity-hero">
              <div class="activity-hero__copy">
                <span class="eyebrow">
                  {locale() === 'ru' ? 'История и контекст' : 'History and context'}
                </span>
                <h2>{locale() === 'ru' ? 'Активность дома' : 'Household activity'}</h2>
                <p>
                  {locale() === 'ru'
                    ? 'Быстрый обзор покупок, платежей и переходов к детальным журналам.'
                    : 'A lighter view of purchases, payments, and the paths into detailed ledgers.'}
                </p>
              </div>
              <div class="activity-hero__actions">
                <Button variant="secondary" onClick={() => navigate('/balances')}>
                  {locale() === 'ru' ? 'Разбор баланса' : 'Balance breakdown'}
                </Button>
                <Button variant="primary" onClick={() => navigate('/purchases')}>
                  {locale() === 'ru' ? 'Журнал покупок' : 'Purchase ledger'}
                </Button>
              </div>
            </Card>

            <div class="activity-metrics">
              <Card muted class="activity-metric-card">
                <span>{locale() === 'ru' ? 'Открытые покупки' : 'Open purchases'}</span>
                <strong>{unresolvedPurchasesCount()}</strong>
                <p>
                  {locale() === 'ru'
                    ? 'Покупки, которые ещё влияют на общий расчёт.'
                    : 'Purchases still affecting the shared settlement.'}
                </p>
              </Card>
              <Card muted class="activity-metric-card">
                <span>{locale() === 'ru' ? 'Записанные платежи' : 'Recorded payments'}</span>
                <strong>{paymentLedger().length}</strong>
                <p>
                  {locale() === 'ru'
                    ? 'Последние подтверждённые платежи дома.'
                    : 'The most recent confirmed household payments.'}
                </p>
              </Card>
            </div>

            <Card class="activity-feed-card">
              <div class="activity-section-heading">
                <div>
                  <strong>{locale() === 'ru' ? 'Последние события' : 'Recent events'}</strong>
                  <p>
                    {locale() === 'ru'
                      ? 'Покупки и платежи в одном потоке.'
                      : 'Purchases and payments in one compact feed.'}
                  </p>
                </div>
                <Badge variant="muted">{recentActivity().length}</Badge>
              </div>

              <div class="activity-feed">
                <For each={recentActivity()}>
                  {(entry) => (
                    <article class="activity-feed__row">
                      <div class="activity-feed__copy">
                        <div class="activity-feed__title-line">
                          <strong>{entry.title}</strong>
                          <Badge variant={entry.kind === 'payment' ? 'accent' : 'muted'}>
                            {entry.kind === 'payment'
                              ? locale() === 'ru'
                                ? 'Платёж'
                                : 'Payment'
                              : locale() === 'ru'
                                ? 'Покупка'
                                : 'Purchase'}
                          </Badge>
                        </div>
                        <p>{`${entry.dateLabel} · ${entry.actor}`}</p>
                      </div>
                      <strong class="activity-feed__amount">{entry.amountLabel}</strong>
                    </article>
                  )}
                </For>
              </div>
            </Card>
          </div>
        </Match>
      </Switch>
    </div>
  )
}
