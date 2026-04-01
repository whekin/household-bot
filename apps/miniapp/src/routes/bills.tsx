import { For, Match, Show, Switch, createEffect, createMemo, createSignal } from 'solid-js'

import { useI18n } from '../contexts/i18n-context'
import { useSession } from '../contexts/session-context'
import { useDashboard } from '../contexts/dashboard-context'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { PaymentsManager } from '../components/payments-manager'
import { CurrencyToggle } from '../components/ui/currency-toggle'
import { Field } from '../components/ui/field'
import { Input } from '../components/ui/input'
import { Skeleton } from '../components/ui/skeleton'
import { formatMoneyLabel } from '../lib/ledger-helpers'
import { minorToMajorString } from '../lib/money'
import {
  addMiniAppUtilityBill,
  deleteMiniAppUtilityBill,
  recordMiniAppUtilityVendorPayment,
  resolveMiniAppUtilityPlan,
  updateMiniAppCycleRent,
  updateMiniAppUtilityBill
} from '../miniapp-api'

function rateMicrosToString(value: string | null): string {
  if (!value) return ''
  const normalized = value.padStart(7, '0')
  const whole = normalized.slice(0, -6) || '0'
  const fraction = normalized.slice(-6).replace(/0+$/, '')
  return fraction.length > 0 ? `${whole}.${fraction}` : whole
}

function rateStringToMicros(value: string): string | null {
  const trimmed = value.trim().replace(',', '.')
  if (trimmed.length === 0) return null
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(trimmed)
  if (!match) return null
  const whole = match[1] ?? '0'
  const fraction = (match[2] ?? '').padEnd(6, '0')
  return `${whole}${fraction}`.replace(/^0+(?=\d)/, '')
}

function sameCategory(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}

export default function BillsRoute() {
  const { copy, locale } = useI18n()
  const { initData, refreshHouseholdData, readySession } = useSession()
  const {
    adminSettings,
    cycleState,
    dashboard,
    effectiveBillingStage,
    effectiveIsAdmin,
    loading,
    utilityLedger
  } = useDashboard()

  const [utilityAmounts, setUtilityAmounts] = createSignal<Record<string, string>>({})
  const [savingUtilityName, setSavingUtilityName] = createSignal<string | null>(null)
  const [rentDraft, setRentDraft] = createSignal({
    amountMajor: '',
    currency: 'USD' as 'USD' | 'GEL',
    fxRate: ''
  })
  const [savingRent, setSavingRent] = createSignal(false)
  const [utilityActionKey, setUtilityActionKey] = createSignal<string | null>(null)

  const utilityCategories = createMemo(() => dashboard()?.utilityCategories ?? [])

  const defaultRentLabel = createMemo(() => {
    const settings = adminSettings()?.settings
    if (!settings?.rentAmountMinor) return '—'
    return formatMoneyLabel(
      minorToMajorString(BigInt(settings.rentAmountMinor)),
      settings.rentCurrency,
      locale()
    )
  })
  const hasRentOverride = createMemo(() => Boolean(cycleState()?.rentRule))
  const currentMemberId = createMemo(() =>
    readySession()?.status === 'ready' ? readySession()!.member.id : null
  )
  const currentMemberIsAdmin = createMemo(
    () => readySession()?.status === 'ready' && readySession()!.member.isAdmin
  )
  const utilityBillingPlan = createMemo(() => dashboard()?.utilityBillingPlan ?? null)
  const currentUtilityAssignments = createMemo(() =>
    (utilityBillingPlan()?.categories ?? []).filter(
      (category) => category.assignedMemberId === currentMemberId()
    )
  )
  const currentUtilitySummary = createMemo(
    () =>
      (utilityBillingPlan()?.memberSummaries ?? []).find(
        (summary) => summary.memberId === currentMemberId()
      ) ?? null
  )
  const householdUtilityPlanMembers = createMemo(() => {
    const plan = utilityBillingPlan()
    if (!plan) return []

    const currentId = currentMemberId()
    const categoriesByMemberId = new Map<string, typeof plan.categories>()
    for (const summary of plan.memberSummaries) {
      categoriesByMemberId.set(
        summary.memberId,
        plan.categories.filter((category) => category.assignedMemberId === summary.memberId)
      )
    }

    return [...plan.memberSummaries]
      .sort((left, right) => {
        if (left.memberId === currentId) return -1
        if (right.memberId === currentId) return 1
        return left.displayName.localeCompare(right.displayName)
      })
      .map((summary) => ({
        ...summary,
        categories: categoriesByMemberId.get(summary.memberId) ?? []
      }))
  })
  const currentRentSummary = createMemo(
    () =>
      dashboard()?.rentBillingState.memberSummaries.find(
        (summary) => summary.memberId === currentMemberId()
      ) ?? null
  )
  const utilityCategoryByName = createMemo(
    () =>
      new Map(utilityCategories().map((category) => [category.name.trim().toLowerCase(), category]))
  )

  createEffect(() => {
    const categories = utilityCategories()
    const entries = utilityLedger()
    setUtilityAmounts(
      Object.fromEntries(
        categories.map((category) => {
          const entry = entries.find((item) => sameCategory(item.title, category.name))
          return [category.name, entry?.amountMajor ?? '']
        })
      )
    )
  })

  createEffect(() => {
    const cycle = cycleState()
    const data = dashboard()
    if (!data) return

    const rule = cycle?.rentRule
    setRentDraft({
      amountMajor:
        rule?.amountMinor !== undefined ? minorToMajorString(BigInt(rule.amountMinor)) : '',
      currency: rule?.currency ?? adminSettings()?.settings.rentCurrency ?? 'USD',
      fxRate: rateMicrosToString(data.rentFxRateMicros)
    })
  })

  async function handleSaveUtility(categoryName: string) {
    const data = initData()
    const amountMajor = utilityAmounts()[categoryName]?.trim() ?? ''
    const currentEntry = utilityLedger().find((entry) => sameCategory(entry.title, categoryName))
    if (!data || savingUtilityName()) return

    setSavingUtilityName(categoryName)
    try {
      if (currentEntry && amountMajor.length === 0) {
        await deleteMiniAppUtilityBill(data, currentEntry.id)
      } else if (currentEntry) {
        await updateMiniAppUtilityBill(data, {
          billId: currentEntry.id,
          billName: categoryName,
          amountMajor,
          currency: currentEntry.currency
        })
      } else if (amountMajor.length > 0) {
        await addMiniAppUtilityBill(data, {
          billName: categoryName,
          amountMajor,
          currency: (dashboard()?.currency as 'USD' | 'GEL') ?? 'GEL'
        })
      }

      await refreshHouseholdData(true, true)
    } finally {
      setSavingUtilityName(null)
    }
  }

  async function handleSaveRent() {
    const data = initData()
    const current = dashboard()
    const draft = rentDraft()
    if (!data || !current || !draft.amountMajor.trim()) return

    setSavingRent(true)
    try {
      const fxRateMicros = rateStringToMicros(draft.fxRate)
      await updateMiniAppCycleRent(data, {
        amountMajor: draft.amountMajor,
        currency: draft.currency,
        period: current.period,
        ...(fxRateMicros ? { fxRateMicros } : {})
      })
      await refreshHouseholdData(true, true)
    } finally {
      setSavingRent(false)
    }
  }

  async function runUtilityAction(key: string, action: () => Promise<void>) {
    if (utilityActionKey()) return
    setUtilityActionKey(key)
    try {
      await action()
      await refreshHouseholdData(true, true)
    } finally {
      setUtilityActionKey(null)
    }
  }

  async function handleResolvePlanned(memberId: string) {
    const data = initData()
    if (!data) return
    await runUtilityAction(`resolve:${memberId}`, () =>
      resolveMiniAppUtilityPlan(data, {
        memberId,
        ...(dashboard()?.period ? { period: dashboard()!.period } : {})
      })
    )
  }

  async function handleRecordVendorPayment(utilityBillId: string, payerMemberId: string) {
    const data = initData()
    if (!data) return
    await runUtilityAction(`vendor:${utilityBillId}:${payerMemberId}`, () =>
      recordMiniAppUtilityVendorPayment(data, {
        utilityBillId,
        payerMemberId,
        ...(dashboard()?.period ? { period: dashboard()!.period } : {})
      })
    )
  }

  return (
    <div class="route route--bills">
      <div class="bills-section">
        <Switch>
          <Match when={loading()}>
            <Card>
              <Skeleton style={{ width: '100%', height: '24px', 'margin-bottom': '12px' }} />
              <Skeleton style={{ width: '80%', height: '48px' }} />
            </Card>
          </Match>

          <Match when={!dashboard()}>
            <Card>
              <p class="empty-state">{copy().emptyDashboard}</p>
            </Card>
          </Match>

          <Match when={dashboard()}>
            {(data) => (
              <>
                <Switch>
                  <Match when={effectiveBillingStage() === 'utilities'}>
                    <Card accent>
                      <div class="statement-section-heading">
                        <div>
                          <strong>
                            {locale() === 'ru' ? 'Твоя коммуналка сейчас' : 'Your utilities now'}
                          </strong>
                          <p>
                            {locale() === 'ru'
                              ? 'Сначала твои текущие счета. Ниже — план для остальных.'
                              : 'Your current utility instructions first. The household plan is below.'}
                          </p>
                        </div>
                        <span class="ui-badge ui-badge--muted">
                          {data().paymentBalanceAdjustmentPolicy === 'utilities'
                            ? locale() === 'ru'
                              ? 'Зачёт через коммуналку'
                              : 'Through utilities'
                            : data().paymentBalanceAdjustmentPolicy === 'rent'
                              ? locale() === 'ru'
                                ? 'Зачёт через аренду'
                                : 'Through rent'
                              : locale() === 'ru'
                                ? 'Вручную'
                                : 'Manual'}
                        </span>
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
                              <div class="statement-list__item statement-list__item--stack">
                                <div>
                                  <strong>
                                    {`${category.isFullAssignment ? (locale() === 'ru' ? 'ПОЛНОСТЬЮ' : 'FULL') : locale() === 'ru' ? 'ЧАСТЬ' : 'SPLIT'} · ${category.billName}`}
                                  </strong>
                                  <span>
                                    {formatMoneyLabel(
                                      category.assignedAmountMajor,
                                      data().currency,
                                      locale()
                                    )}
                                  </span>
                                  <Show when={!category.isFullAssignment}>
                                    <span>
                                      {locale() === 'ru'
                                        ? `Счёт целиком: ${formatMoneyLabel(category.billTotalMajor, data().currency, locale())}`
                                        : `Bill total: ${formatMoneyLabel(category.billTotalMajor, data().currency, locale())}`}
                                    </span>
                                  </Show>
                                  <Show
                                    when={utilityCategoryByName().get(
                                      category.billName.trim().toLowerCase()
                                    )}
                                  >
                                    {(details) => (
                                      <span>
                                        {[
                                          details().providerName,
                                          details().customerNumber,
                                          details().note
                                        ]
                                          .filter(Boolean)
                                          .join(' · ')}
                                      </span>
                                    )}
                                  </Show>
                                </div>
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
                                  {formatMoneyLabel(
                                    summary().fairShareMajor,
                                    data().currency,
                                    locale()
                                  )}
                                </strong>
                              </div>
                              <div class="statement-chip">
                                <span>{locale() === 'ru' ? 'Уже оплачено' : 'Already paid'}</span>
                                <strong>
                                  {formatMoneyLabel(
                                    summary().vendorPaidMajor,
                                    data().currency,
                                    locale()
                                  )}
                                </strong>
                              </div>
                              <div class="statement-chip">
                                <span>
                                  {locale() === 'ru' ? 'Назначено сейчас' : 'Assigned now'}
                                </span>
                                <strong>
                                  {formatMoneyLabel(
                                    summary().assignedThisCycleMajor,
                                    data().currency,
                                    locale()
                                  )}
                                </strong>
                              </div>
                              <div class="statement-chip">
                                <span>{locale() === 'ru' ? 'После плана' : 'After plan'}</span>
                                <strong>
                                  {formatMoneyLabel(
                                    summary().projectedDeltaAfterPlanMajor,
                                    data().currency,
                                    locale()
                                  )}
                                </strong>
                              </div>
                            </div>
                          )}
                        </Show>
                        <div class="statement-actions statement-actions--single">
                          <Button
                            variant="primary"
                            loading={utilityActionKey() === `resolve:${currentMemberId()}`}
                            onClick={() =>
                              currentMemberId() && void handleResolvePlanned(currentMemberId()!)
                            }
                          >
                            {locale() === 'ru' ? 'Оплатил по плану' : 'Resolve my plan'}
                          </Button>
                        </div>
                      </Show>
                    </Card>
                  </Match>

                  <Match when={effectiveBillingStage() === 'rent' && currentRentSummary()}>
                    {(summary) => (
                      <Card accent>
                        <div class="statement-section-heading">
                          <div>
                            <strong>
                              {locale() === 'ru' ? 'Твоя аренда сейчас' : 'Your rent now'}
                            </strong>
                            <p>
                              {locale() === 'ru'
                                ? `Срок ${data().rentBillingState.dueDate}`
                                : `Due ${data().rentBillingState.dueDate}`}
                            </p>
                          </div>
                          <span class="ui-badge ui-badge--accent">
                            {locale() === 'ru' ? 'Аренда' : 'Rent'}
                          </span>
                        </div>
                        <div class="statement-chip-grid">
                          <div class="statement-chip">
                            <span>{locale() === 'ru' ? 'К оплате' : 'Due now'}</span>
                            <strong>
                              {formatMoneyLabel(
                                summary().remainingMajor,
                                data().currency,
                                locale()
                              )}
                            </strong>
                          </div>
                          <div class="statement-chip">
                            <span>{locale() === 'ru' ? 'Полная сумма' : 'Full due'}</span>
                            <strong>
                              {formatMoneyLabel(summary().dueMajor, data().currency, locale())}
                            </strong>
                          </div>
                          <div class="statement-chip">
                            <span>{locale() === 'ru' ? 'Уже оплачено' : 'Already paid'}</span>
                            <strong>
                              {formatMoneyLabel(summary().paidMajor, data().currency, locale())}
                            </strong>
                          </div>
                        </div>
                        <Show when={(data().rentBillingState.paymentDestinations ?? []).length > 0}>
                          <div class="statement-list">
                            <For each={data().rentBillingState.paymentDestinations ?? []}>
                              {(destination) => (
                                <div class="statement-list__item statement-list__item--stack">
                                  <div>
                                    <strong>{destination.label}</strong>
                                    <span>
                                      {[
                                        destination.recipientName,
                                        destination.bankName,
                                        destination.account
                                      ]
                                        .filter(Boolean)
                                        .join(' · ')}
                                    </span>
                                    <Show when={destination.note}>
                                      <span>{destination.note}</span>
                                    </Show>
                                  </div>
                                </div>
                              )}
                            </For>
                          </div>
                        </Show>
                      </Card>
                    )}
                  </Match>

                  <Match when={effectiveBillingStage() === 'idle'}>
                    <Card>
                      <div class="statement-section-heading">
                        <div>
                          <strong>
                            {locale() === 'ru'
                              ? 'Сейчас активных оплат нет'
                              : 'No active payment window right now'}
                          </strong>
                          <p>
                            {locale() === 'ru'
                              ? 'На этой странице ниже останутся история и настройки цикла.'
                              : 'History and cycle tools stay below.'}
                          </p>
                        </div>
                      </div>
                    </Card>
                  </Match>
                </Switch>

                <Show when={utilityBillingPlan()}>
                  {(plan) => (
                    <Card>
                      <div class="statement-section-heading">
                        <div>
                          <strong>{locale() === 'ru' ? 'План по дому' : 'Household plan'}</strong>
                          <p>
                            {(locale() === 'ru' ? 'Версия' : 'Version') + ` ${plan().version}`} ·{' '}
                            {locale() === 'ru' ? 'Срок' : 'Due'} {plan().dueDate}
                          </p>
                        </div>
                        <span
                          class={`ui-badge ${
                            plan().status === 'settled' || plan().status === 'active'
                              ? 'ui-badge--accent'
                              : 'ui-badge--muted'
                          }`}
                        >
                          {plan().status === 'active'
                            ? locale() === 'ru'
                              ? 'По плану'
                              : 'On track'
                            : plan().status === 'settled'
                              ? locale() === 'ru'
                                ? 'Закрыто'
                                : 'Settled'
                              : locale() === 'ru'
                                ? 'Пересчитано'
                                : 'Rebalanced'}
                        </span>
                      </div>
                      <div class="statement-list">
                        <For each={householdUtilityPlanMembers()}>
                          {(summary) => (
                            <div class="statement-list__item statement-list__item--stack">
                              <div class="utility-member-card__header">
                                <div>
                                  <strong>{summary.displayName}</strong>
                                  <Show when={summary.memberId === currentMemberId()}>
                                    <span class="utility-member-card__current">
                                      {locale() === 'ru' ? 'Сначала ты' : 'You first'}
                                    </span>
                                  </Show>
                                </div>
                                <Show
                                  when={
                                    currentMemberIsAdmin() && summary.memberId !== currentMemberId()
                                  }
                                >
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    loading={utilityActionKey() === `resolve:${summary.memberId}`}
                                    onClick={() => void handleResolvePlanned(summary.memberId)}
                                  >
                                    {locale() === 'ru'
                                      ? `Записать за ${summary.displayName}`
                                      : `Record for ${summary.displayName}`}
                                  </Button>
                                </Show>
                              </div>
                              <div class="statement-chip-grid">
                                <div class="statement-chip">
                                  <span>{locale() === 'ru' ? 'Цель' : 'Target'}</span>
                                  <strong>
                                    {formatMoneyLabel(
                                      summary.fairShareMajor,
                                      data().currency,
                                      locale()
                                    )}
                                  </strong>
                                </div>
                                <div class="statement-chip">
                                  <span>{locale() === 'ru' ? 'Уже оплачено' : 'Already paid'}</span>
                                  <strong>
                                    {formatMoneyLabel(
                                      summary.vendorPaidMajor,
                                      data().currency,
                                      locale()
                                    )}
                                  </strong>
                                </div>
                                <div class="statement-chip">
                                  <span>
                                    {locale() === 'ru' ? 'Назначено сейчас' : 'Assigned now'}
                                  </span>
                                  <strong>
                                    {formatMoneyLabel(
                                      summary.assignedThisCycleMajor,
                                      data().currency,
                                      locale()
                                    )}
                                  </strong>
                                </div>
                                <div class="statement-chip">
                                  <span>{locale() === 'ru' ? 'После плана' : 'After plan'}</span>
                                  <strong>
                                    {formatMoneyLabel(
                                      summary.projectedDeltaAfterPlanMajor,
                                      data().currency,
                                      locale()
                                    )}
                                  </strong>
                                </div>
                              </div>
                              <Show
                                when={summary.categories.length > 0}
                                fallback={
                                  <span class="statement-list__empty">
                                    {locale() === 'ru'
                                      ? 'Сейчас ничего не назначено.'
                                      : 'Nothing is assigned right now.'}
                                  </span>
                                }
                              >
                                <div class="statement-list">
                                  <For each={summary.categories}>
                                    {(category) => (
                                      <div class="statement-list__item">
                                        <div>
                                          <strong>
                                            {`${category.isFullAssignment ? (locale() === 'ru' ? 'ПОЛНОСТЬЮ' : 'FULL') : locale() === 'ru' ? 'ЧАСТЬ' : 'SPLIT'} · ${category.billName}`}
                                          </strong>
                                          <span>
                                            {formatMoneyLabel(
                                              category.assignedAmountMajor,
                                              data().currency,
                                              locale()
                                            )}
                                          </span>
                                          <Show when={!category.isFullAssignment}>
                                            <span>
                                              {locale() === 'ru'
                                                ? `Счёт целиком: ${formatMoneyLabel(category.billTotalMajor, data().currency, locale())}`
                                                : `Bill total: ${formatMoneyLabel(category.billTotalMajor, data().currency, locale())}`}
                                            </span>
                                          </Show>
                                        </div>
                                        <Show
                                          when={
                                            currentMemberId() &&
                                            currentMemberId() !== category.assignedMemberId
                                          }
                                        >
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            loading={
                                              utilityActionKey() ===
                                              `vendor:${category.utilityBillId}:${currentMemberId()}`
                                            }
                                            onClick={() =>
                                              currentMemberId() &&
                                              void handleRecordVendorPayment(
                                                category.utilityBillId,
                                                currentMemberId()!
                                              )
                                            }
                                          >
                                            {locale() === 'ru'
                                              ? 'Я оплатил вместо этого'
                                              : 'I paid this instead'}
                                          </Button>
                                        </Show>
                                      </div>
                                    )}
                                  </For>
                                </div>
                              </Show>
                            </div>
                          )}
                        </For>
                      </div>
                    </Card>
                  )}
                </Show>

                <Show when={effectiveIsAdmin()}>
                  <details class="billing-admin-tools" open={effectiveBillingStage() === 'rent'}>
                    <summary>{locale() === 'ru' ? 'Инструменты цикла' : 'Cycle tools'}</summary>
                    <div class="billing-admin-tools__body">
                      <section class="billing-admin-panel">
                        <div class="statement-section-heading">
                          <div>
                            <strong>{copy().shareRent}</strong>
                            <p>{copy().rentPanelBody}</p>
                          </div>
                          <span
                            class={`ui-badge ${hasRentOverride() ? 'ui-badge--accent' : 'ui-badge--muted'}`}
                          >
                            {hasRentOverride()
                              ? copy().currentCycleOverrideRent
                              : copy().currentCycleUsesDefaultRent}
                          </span>
                        </div>
                        <div class="rent-block rent-block--flat">
                          <div class="rent-block__overview rent-block__overview--flat">
                            <div class="rent-overview-grid rent-overview-grid--flat">
                              <div class="rent-overview-row">
                                <span>{copy().rentPanelHouseholdDefaultLabel}</span>
                                <strong>{defaultRentLabel()}</strong>
                              </div>
                              <div class="rent-overview-row">
                                <span>{copy().rentPanelCycleSourceLabel}</span>
                                <strong>
                                  {formatMoneyLabel(
                                    data().rentSourceAmountMajor,
                                    data().rentSourceCurrency,
                                    locale()
                                  )}
                                </strong>
                              </div>
                              <div class="rent-overview-row">
                                <span>{copy().rentPanelSettlementLabel}</span>
                                <strong>
                                  {formatMoneyLabel(
                                    data().rentDisplayAmountMajor,
                                    data().currency,
                                    locale()
                                  )}
                                </strong>
                              </div>
                              <div class="rent-overview-row">
                                <span>{copy().rentPanelFxLabel}</span>
                                <strong>
                                  {data().rentFxRateMicros
                                    ? rateMicrosToString(data().rentFxRateMicros)
                                    : data().rentSourceCurrency === data().currency
                                      ? copy().rentPanelNoConversion
                                      : copy().rentPanelAutoRate}
                                </strong>
                              </div>
                            </div>
                          </div>
                          <div class="rent-block__editor rent-block__editor--flat">
                            <div class="rent-block__form">
                              <Field label={copy().defaultRentAmount}>
                                <Input
                                  type="number"
                                  value={rentDraft().amountMajor}
                                  onInput={(e) =>
                                    setRentDraft((draft) => ({
                                      ...draft,
                                      amountMajor: e.currentTarget.value
                                    }))
                                  }
                                />
                              </Field>
                              <Field label={copy().rentCurrencyLabel}>
                                <CurrencyToggle
                                  value={rentDraft().currency}
                                  ariaLabel={copy().rentCurrencyLabel}
                                  onChange={(value) =>
                                    setRentDraft((draft) => ({
                                      ...draft,
                                      currency: value as 'USD' | 'GEL'
                                    }))
                                  }
                                />
                              </Field>
                              <Field
                                label={copy().rentPanelFxLabel}
                                hint={copy().rentPanelFxHint}
                                wide
                              >
                                <Input
                                  type="text"
                                  value={rentDraft().fxRate}
                                  placeholder="2.76"
                                  onInput={(e) =>
                                    setRentDraft((draft) => ({
                                      ...draft,
                                      fxRate: e.currentTarget.value
                                    }))
                                  }
                                />
                              </Field>
                            </div>
                            <Button
                              variant="primary"
                              class="rent-block__save"
                              loading={savingRent()}
                              onClick={() => void handleSaveRent()}
                            >
                              {savingRent() ? copy().savingSettings : copy().saveSettingsAction}
                            </Button>
                          </div>
                        </div>
                      </section>

                      <section class="billing-admin-panel">
                        <div class="statement-section-heading">
                          <div>
                            <strong>{copy().utilityLedgerTitle}</strong>
                            <p>{copy().utilityBillsEditorBody}</p>
                          </div>
                        </div>
                        <Show
                          when={utilityCategories().length > 0}
                          fallback={<p class="empty-state">{copy().utilityBillsEmpty}</p>}
                        >
                          <div class="inline-editor-list">
                            <For each={utilityCategories()}>
                              {(category) => {
                                const entry = () =>
                                  utilityLedger().find((item) =>
                                    sameCategory(item.title, category.name)
                                  )
                                const currentAmount = () => utilityAmounts()[category.name] ?? ''
                                return (
                                  <div class="inline-editor-row">
                                    <div class="inline-editor-row__label">
                                      <strong>{category.name}</strong>
                                      <span>
                                        {entry()?.actorDisplayName ?? copy().utilityCategoryLabel}
                                      </span>
                                    </div>
                                    <Input
                                      type="text"
                                      inputMode="decimal"
                                      value={currentAmount()}
                                      onInput={(e) =>
                                        setUtilityAmounts((prev) => ({
                                          ...prev,
                                          [category.name]: e.currentTarget.value
                                        }))
                                      }
                                    />
                                    <div class="inline-editor-row__value">
                                      <Show when={entry()}>
                                        {(saved) => (
                                          <span>
                                            {formatMoneyLabel(
                                              saved().displayAmountMajor,
                                              saved().displayCurrency,
                                              locale()
                                            )}
                                          </span>
                                        )}
                                      </Show>
                                    </div>
                                    <Button
                                      variant="primary"
                                      loading={savingUtilityName() === category.name}
                                      onClick={() => void handleSaveUtility(category.name)}
                                    >
                                      {entry()
                                        ? copy().saveUtilityBillAction
                                        : copy().addUtilityBillAction}
                                    </Button>
                                  </div>
                                )
                              }}
                            </For>
                          </div>
                        </Show>
                      </section>
                    </div>
                  </details>
                </Show>

                <PaymentsManager />
              </>
            )}
          </Match>
        </Switch>
      </div>
    </div>
  )
}
