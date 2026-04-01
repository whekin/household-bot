import { For, Match, Show, Switch, createMemo } from 'solid-js'

import { useI18n } from '../contexts/i18n-context'
import { useDashboard } from '../contexts/dashboard-context'
import { Card } from '../components/ui/card'
import { Skeleton } from '../components/ui/skeleton'
import { formatMoneyLabel } from '../lib/ledger-helpers'
import { majorStringToMinor, minorToMajorString } from '../lib/money'

function normalizedWidth(valueMinor: bigint, maxMinor: bigint): string {
  if (maxMinor <= 0n) return '0%'
  return `${Math.max((Number(valueMinor) / Number(maxMinor)) * 100, 6)}%`
}

export default function BalancesRoute() {
  const { copy, locale } = useI18n()
  const { dashboard, effectiveBillingStage, loading, purchaseLedger, currentMemberLine } =
    useDashboard()
  const formatAmount = (amountMajor: string, currency: 'USD' | 'GEL') =>
    formatMoneyLabel(amountMajor, currency, locale())

  const purchaseRows = createMemo(() => {
    const data = dashboard()
    const currentMember = currentMemberLine()
    if (!data) return []

    const spentByMemberId = new Map<string, bigint>()
    for (const entry of purchaseLedger()) {
      if (!entry.memberId) {
        continue
      }
      spentByMemberId.set(
        entry.memberId,
        (spentByMemberId.get(entry.memberId) ?? 0n) + majorStringToMinor(entry.displayAmountMajor)
      )
    }

    const rows = data.members.map((member) => ({
      memberId: member.memberId,
      displayName: member.displayName,
      spentMinor: spentByMemberId.get(member.memberId) ?? 0n,
      purchaseBalanceMinor: majorStringToMinor(member.purchaseOffsetMajor),
      purchaseBalanceMajor: member.purchaseOffsetMajor,
      isCurrent: currentMember?.memberId === member.memberId
    }))
    const maxBalanceMinor = rows.reduce((max, row) => {
      const absolute =
        row.purchaseBalanceMinor < 0n ? -row.purchaseBalanceMinor : row.purchaseBalanceMinor
      return absolute > max ? absolute : max
    }, 0n)

    return rows
      .sort((left, right) => {
        if (left.isCurrent) return -1
        if (right.isCurrent) return 1
        return left.displayName.localeCompare(right.displayName)
      })
      .map((row) => ({
        ...row,
        spentMajor: minorToMajorString(row.spentMinor),
        width: normalizedWidth(
          row.purchaseBalanceMinor < 0n ? -row.purchaseBalanceMinor : row.purchaseBalanceMinor,
          maxBalanceMinor
        ),
        side:
          row.purchaseBalanceMinor < 0n ? 'left' : row.purchaseBalanceMinor > 0n ? 'right' : 'none'
      }))
  })

  const currentUtilityAssignments = createMemo(() => {
    const data = dashboard()
    const currentMember = currentMemberLine()
    if (!data?.utilityBillingPlan || !currentMember) return []

    return data.utilityBillingPlan.categories.filter(
      (category) => category.assignedMemberId === currentMember.memberId
    )
  })

  const currentUtilitySummary = createMemo(() => {
    const data = dashboard()
    const currentMember = currentMemberLine()
    if (!data?.utilityBillingPlan || !currentMember) return null

    return (
      data.utilityBillingPlan.memberSummaries.find(
        (summary) => summary.memberId === currentMember.memberId
      ) ?? null
    )
  })

  const currentRentSummary = createMemo(() => {
    const data = dashboard()
    const currentMember = currentMemberLine()
    if (!data || !currentMember) return null

    return (
      data.rentBillingState.memberSummaries.find(
        (summary) => summary.memberId === currentMember.memberId
      ) ?? null
    )
  })

  return (
    <div class="route route--balances">
      <Switch>
        <Match when={loading()}>
          <Card>
            <Skeleton style={{ width: '180px', height: '20px' }} />
            <Skeleton style={{ width: '100%', height: '120px', 'margin-top': '16px' }} />
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
              <Show when={effectiveBillingStage() === 'utilities'}>
                <Card accent>
                  <div class="statement-section-heading">
                    <div>
                      <strong>
                        {locale() === 'ru' ? 'Коммуналка сейчас' : 'Utilities right now'}
                      </strong>
                      <p>
                        {data().paymentBalanceAdjustmentPolicy === 'rent'
                          ? locale() === 'ru'
                            ? 'Баланс по покупкам уйдёт в аренду. Здесь только текущие коммунальные назначения.'
                            : 'Purchase balance will be settled through rent. This screen shows only current utility work.'
                          : data().paymentBalanceAdjustmentPolicy === 'separate'
                            ? locale() === 'ru'
                              ? 'Баланс покупок остаётся отдельно. Здесь только коммуналка.'
                              : 'Purchase balance stays separate. This screen shows utilities only.'
                            : locale() === 'ru'
                              ? 'Баланс по покупкам уже учтён в коммуналке.'
                              : 'Purchase balance is already applied through utilities.'}
                      </p>
                    </div>
                  </div>
                  <Show
                    when={currentUtilityAssignments().length > 0}
                    fallback={
                      <p class="empty-state">
                        {locale() === 'ru'
                          ? 'Сейчас тебе ничего не назначено по коммуналке.'
                          : 'Nothing is currently assigned to you for utilities.'}
                      </p>
                    }
                  >
                    <div class="statement-list">
                      <For each={currentUtilityAssignments()}>
                        {(category) => (
                          <div class="statement-list__item">
                            <div>
                              <strong>{category.billName}</strong>
                              <span>
                                {formatAmount(category.assignedAmountMajor, data().currency)}
                              </span>
                            </div>
                            <span class="ui-badge ui-badge--muted">
                              {category.isFullAssignment
                                ? locale() === 'ru'
                                  ? 'Полностью'
                                  : 'Full'
                                : locale() === 'ru'
                                  ? 'Часть'
                                  : 'Split'}
                            </span>
                          </div>
                        )}
                      </For>
                    </div>
                    <Show when={currentUtilitySummary()}>
                      {(summary) => (
                        <div class="statement-chip-grid">
                          <div class="statement-chip">
                            <span>{locale() === 'ru' ? 'Цель' : 'Target'}</span>
                            <strong>
                              {formatAmount(summary().fairShareMajor, data().currency)}
                            </strong>
                          </div>
                          <div class="statement-chip">
                            <span>{locale() === 'ru' ? 'Назначено сейчас' : 'Assigned now'}</span>
                            <strong>
                              {formatAmount(summary().assignedThisCycleMajor, data().currency)}
                            </strong>
                          </div>
                          <div class="statement-chip">
                            <span>{locale() === 'ru' ? 'После плана' : 'After plan'}</span>
                            <strong>
                              {formatAmount(
                                summary().projectedDeltaAfterPlanMajor,
                                data().currency
                              )}
                            </strong>
                          </div>
                        </div>
                      )}
                    </Show>
                  </Show>
                </Card>
              </Show>

              <Show when={effectiveBillingStage() === 'rent' && currentRentSummary()}>
                {(summary) => (
                  <Card accent>
                    <div class="statement-section-heading">
                      <div>
                        <strong>{locale() === 'ru' ? 'Аренда сейчас' : 'Rent right now'}</strong>
                        <p>
                          {locale() === 'ru'
                            ? `Срок ${data().rentBillingState.dueDate}`
                            : `Due ${data().rentBillingState.dueDate}`}
                        </p>
                      </div>
                    </div>
                    <div class="statement-chip-grid">
                      <div class="statement-chip">
                        <span>{locale() === 'ru' ? 'К оплате' : 'Due now'}</span>
                        <strong>{formatAmount(summary().remainingMajor, data().currency)}</strong>
                      </div>
                      <div class="statement-chip">
                        <span>{locale() === 'ru' ? 'Полная сумма' : 'Full due'}</span>
                        <strong>{formatAmount(summary().dueMajor, data().currency)}</strong>
                      </div>
                      <div class="statement-chip">
                        <span>{locale() === 'ru' ? 'Уже оплачено' : 'Already paid'}</span>
                        <strong>{formatAmount(summary().paidMajor, data().currency)}</strong>
                      </div>
                    </div>
                  </Card>
                )}
              </Show>

              <Card>
                <div class="statement-section-heading">
                  <div>
                    <strong>{locale() === 'ru' ? 'Баланс по покупкам' : 'Purchase balance'}</strong>
                    <p>
                      {locale() === 'ru'
                        ? 'Это вклад каждого участника в общие покупки после разделения. Это не текущий счёт к оплате.'
                        : 'This is each member’s shared-purchase position after split. It is not a current payment request.'}
                    </p>
                  </div>
                </div>
                <div class="statement-list">
                  <For each={purchaseRows()}>
                    {(row) => (
                      <div class="statement-list__item statement-list__item--stack">
                        <div class="utility-member-card__header">
                          <div>
                            <strong>{row.displayName}</strong>
                            <Show when={row.isCurrent}>
                              <span class="utility-member-card__current">
                                {locale() === 'ru' ? 'Это ты' : 'You'}
                              </span>
                            </Show>
                          </div>
                          <strong>{formatAmount(row.purchaseBalanceMajor, data().currency)}</strong>
                        </div>
                        <div class="purchase-balance-bar">
                          <div class="purchase-balance-bar__zero" />
                          <Show when={row.side !== 'none'}>
                            <div
                              class={`purchase-balance-bar__fill ${
                                row.side === 'left' ? 'is-credit' : 'is-debit'
                              }`}
                              style={{
                                width: row.width,
                                left: row.side === 'left' ? `calc(50% - ${row.width})` : '50%'
                              }}
                            />
                          </Show>
                        </div>
                        <div class="statement-chip-grid">
                          <div class="statement-chip">
                            <span>{locale() === 'ru' ? 'Баланс' : 'Balance'}</span>
                            <strong>
                              {formatAmount(row.purchaseBalanceMajor, data().currency)}
                            </strong>
                          </div>
                          <div class="statement-chip">
                            <span>{locale() === 'ru' ? 'Оплачено' : 'Spent'}</span>
                            <strong>{formatAmount(row.spentMajor, data().currency)}</strong>
                          </div>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Card>
            </>
          )}
        </Match>
      </Switch>
    </div>
  )
}
