import { For, Match, Switch, createMemo } from 'solid-js'

import { useI18n } from '../contexts/i18n-context'
import { useDashboard } from '../contexts/dashboard-context'
import { Card } from '../components/ui/card'
import { Skeleton } from '../components/ui/skeleton'
import { formatMoneyLabel, memberCreditClass, memberRemainingClass } from '../lib/ledger-helpers'
import { majorStringToMinor, minorToMajorString } from '../lib/money'

function normalizedWidth(valueMinor: bigint, maxMinor: bigint): string {
  if (maxMinor <= 0n) return '0%'
  return `${Math.max((Number(valueMinor) / Number(maxMinor)) * 100, 6)}%`
}

export default function BalancesRoute() {
  const { copy, locale } = useI18n()
  const { dashboard, loading, purchaseLedger, purchaseTotalMajor, utilityTotalMajor } =
    useDashboard()
  const formatAmount = (amountMajor: string, currency: 'USD' | 'GEL') =>
    formatMoneyLabel(amountMajor, currency, locale())

  const purchaseByMember = createMemo(() => {
    const data = dashboard()
    if (!data) return []

    const totals = new Map<string, bigint>()
    for (const entry of purchaseLedger()) {
      const key = entry.memberId ?? entry.actorDisplayName ?? entry.id
      totals.set(key, (totals.get(key) ?? 0n) + majorStringToMinor(entry.displayAmountMajor))
    }

    return data.members.map((member) => ({
      member,
      spentMinor: totals.get(member.memberId) ?? 0n,
      spentMajor: minorToMajorString(totals.get(member.memberId) ?? 0n),
      balanceMajor: member.purchaseOffsetMajor,
      balanceMinor: majorStringToMinor(member.purchaseOffsetMajor)
    }))
  })

  const categoryVisuals = createMemo(() => {
    const data = dashboard()
    if (!data) return []

    const rows = data.members.map((member) => ({
      member,
      rentMinor: majorStringToMinor(member.rentShareMajor),
      utilityMinor: majorStringToMinor(member.utilityShareMajor),
      offsetMinor: majorStringToMinor(member.purchaseOffsetMajor)
    }))

    const maxRent = rows.reduce((max, row) => (row.rentMinor > max ? row.rentMinor : max), 0n)
    const maxUtility = rows.reduce(
      (max, row) => (row.utilityMinor > max ? row.utilityMinor : max),
      0n
    )
    const maxOffset = rows.reduce((max, row) => {
      const current = row.offsetMinor < 0n ? -row.offsetMinor : row.offsetMinor
      return current > max ? current : max
    }, 0n)

    return rows.map((row) => ({
      member: row.member,
      rentMajor: minorToMajorString(row.rentMinor),
      utilityMajor: minorToMajorString(row.utilityMinor),
      offsetMajor: minorToMajorString(row.offsetMinor),
      rentWidth: normalizedWidth(row.rentMinor, maxRent),
      utilityWidth: normalizedWidth(row.utilityMinor, maxUtility),
      offsetWidth: normalizedWidth(
        row.offsetMinor < 0n ? -row.offsetMinor : row.offsetMinor,
        maxOffset
      ),
      offsetClass: row.offsetMinor < 0n ? 'is-credit' : 'is-debit'
    }))
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
              <Card>
                <div class="statement-header">
                  <div>
                    <p class="statement-header__eyebrow">{copy().balancesTitle}</p>
                    <h2 class="statement-header__title">
                      {formatAmount(data().totalRemainingMajor, data().currency)}
                    </h2>
                    <p class="statement-header__body">{copy().householdBalancesBody}</p>
                  </div>
                  <div class="statement-chip-grid">
                    <div class="statement-chip">
                      <span>{copy().purchasesBalanceTitle}</span>
                      <strong>{formatAmount(purchaseTotalMajor(), data().currency)}</strong>
                    </div>
                    <div class="statement-chip">
                      <span>{copy().utilitiesBalanceTitle}</span>
                      <strong>{formatAmount(utilityTotalMajor(), data().currency)}</strong>
                    </div>
                  </div>
                </div>
              </Card>

              <Card>
                <div class="statement-section-heading">
                  <div>
                    <strong>
                      {locale() === 'ru' ? 'Кто должен сейчас' : 'Who owes right now'}
                    </strong>
                    <p>{copy().householdBalancesBody}</p>
                  </div>
                </div>
                <div class="statement-list">
                  <For each={data().members}>
                    {(member) => (
                      <div
                        class={`statement-list__item statement-list__item--member ${memberRemainingClass(member)}`}
                      >
                        <div>
                          <strong>{member.displayName}</strong>
                          <span>
                            {locale() === 'ru' ? 'К начислению' : 'Total due'}:{' '}
                            {formatAmount(member.netDueMajor, data().currency)}
                          </span>
                        </div>
                        <strong>{formatAmount(member.remainingMajor, data().currency)}</strong>
                      </div>
                    )}
                  </For>
                </div>
              </Card>

              <Card>
                <div class="statement-section-heading">
                  <div>
                    <strong>{copy().purchasesBalanceTitle}</strong>
                    <p>
                      {locale() === 'ru'
                        ? 'Показывает, сколько каждый внёс в общие покупки и как это влияет на его баланс.'
                        : 'See how much each member paid for shared purchases and how it affects the balance.'}
                    </p>
                  </div>
                </div>
                <div class="statement-rows">
                  <div class="statement-row statement-row--header">
                    <span>{locale() === 'ru' ? 'Участник' : 'Member'}</span>
                    <span>{locale() === 'ru' ? 'Оплачено' : 'Spent'}</span>
                    <span>{locale() === 'ru' ? 'Баланс покупок' : 'Purchase balance'}</span>
                  </div>
                  <For each={purchaseByMember()}>
                    {(item) => (
                      <div class={`statement-row ${memberCreditClass(item.member)}`}>
                        <strong>{item.member.displayName}</strong>
                        <span>{formatAmount(item.spentMajor, data().currency)}</span>
                        <span>{formatAmount(item.balanceMajor, data().currency)}</span>
                      </div>
                    )}
                  </For>
                </div>
              </Card>

              <Card>
                <div class="statement-section-heading">
                  <div>
                    <strong>{copy().utilitiesBalanceTitle}</strong>
                    <p>
                      {locale() === 'ru'
                        ? 'Показывает долю коммуналки и итоговую сумму после поправки по балансу.'
                        : 'See each member utility share and the final amount after balance adjustments.'}
                    </p>
                  </div>
                </div>
                <div class="statement-rows">
                  <div class="statement-row statement-row--header">
                    <span>{locale() === 'ru' ? 'Участник' : 'Member'}</span>
                    <span>{copy().pureUtilitiesLabel}</span>
                    <span>{copy().utilitiesAdjustedTotalLabel}</span>
                  </div>
                  <For each={data().members}>
                    {(member) => {
                      const pureMinor = majorStringToMinor(member.utilityShareMajor)
                      const adjustedMinor =
                        data().paymentBalanceAdjustmentPolicy === 'utilities'
                          ? pureMinor + majorStringToMinor(member.purchaseOffsetMajor)
                          : pureMinor
                      return (
                        <div class="statement-row">
                          <strong>{member.displayName}</strong>
                          <span>
                            {formatAmount(minorToMajorString(pureMinor), data().currency)}
                          </span>
                          <span>
                            {formatAmount(minorToMajorString(adjustedMinor), data().currency)}
                          </span>
                        </div>
                      )
                    }}
                  </For>
                </div>
              </Card>

              <Card>
                <div class="statement-section-heading">
                  <div>
                    <strong>
                      {locale() === 'ru' ? 'Разбивка по категориям' : 'Breakdown by category'}
                    </strong>
                    <p>
                      {locale() === 'ru'
                        ? 'Сравни аренду, коммуналку и поправку по покупкам отдельно для каждого участника.'
                        : 'Compare rent, utilities, and purchase adjustments separately for each member.'}
                    </p>
                  </div>
                </div>
                <div class="category-visual-grid">
                  <For each={categoryVisuals()}>
                    {(item) => (
                      <div class="category-visual-row">
                        <strong>{item.member.displayName}</strong>
                        <div class="category-visual-row__group">
                          <span>{copy().shareRent}</span>
                          <div class="category-visual-row__track">
                            <div
                              class="category-visual-row__bar category-visual-row__bar--rent"
                              style={{ width: item.rentWidth }}
                            />
                          </div>
                          <em>{formatAmount(item.rentMajor, data().currency)}</em>
                        </div>
                        <div class="category-visual-row__group">
                          <span>{copy().shareUtilities}</span>
                          <div class="category-visual-row__track">
                            <div
                              class="category-visual-row__bar category-visual-row__bar--utilities"
                              style={{ width: item.utilityWidth }}
                            />
                          </div>
                          <em>{formatAmount(item.utilityMajor, data().currency)}</em>
                        </div>
                        <div class="category-visual-row__group">
                          <span>{copy().shareOffset}</span>
                          <div class="category-visual-row__track">
                            <div
                              class={`category-visual-row__bar category-visual-row__bar--offset ${item.offsetClass}`}
                              style={{ width: item.offsetWidth }}
                            />
                          </div>
                          <em>{formatAmount(item.offsetMajor, data().currency)}</em>
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
