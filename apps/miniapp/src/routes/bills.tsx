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
import { formatCyclePeriod } from '../lib/dates'
import { formatMoneyLabel } from '../lib/ledger-helpers'
import { majorStringToMinor, minorToMajorString } from '../lib/money'
import {
  addMiniAppUtilityBill,
  deleteMiniAppUtilityBill,
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
  const { initData, refreshHouseholdData } = useSession()
  const { adminSettings, cycleState, dashboard, effectiveIsAdmin, loading, utilityLedger } =
    useDashboard()

  const [utilityAmounts, setUtilityAmounts] = createSignal<Record<string, string>>({})
  const [savingUtilityName, setSavingUtilityName] = createSignal<string | null>(null)
  const [rentDraft, setRentDraft] = createSignal({
    amountMajor: '',
    currency: 'USD' as 'USD' | 'GEL',
    fxRate: ''
  })
  const [savingRent, setSavingRent] = createSignal(false)

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

  const utilityOverview = createMemo(() => {
    const data = dashboard()
    if (!data) return []

    return data.members.map((member) => {
      const pureMinor = majorStringToMinor(member.utilityShareMajor)
      const adjustmentMinor =
        data.paymentBalanceAdjustmentPolicy === 'utilities'
          ? majorStringToMinor(member.purchaseOffsetMajor)
          : 0n
      const adjustedMinor = pureMinor + adjustmentMinor

      return {
        memberId: member.memberId,
        displayName: member.displayName,
        pureMajor: minorToMajorString(pureMinor),
        adjustedMajor: minorToMajorString(adjustedMinor)
      }
    })
  })
  const utilityCycleTotal = createMemo(() =>
    minorToMajorString(
      utilityLedger().reduce((sum, entry) => sum + majorStringToMinor(entry.displayAmountMajor), 0n)
    )
  )
  const adjustedUtilityTotal = createMemo(() =>
    minorToMajorString(
      utilityOverview().reduce((sum, item) => sum + majorStringToMinor(item.adjustedMajor), 0n)
    )
  )
  const hasRentOverride = createMemo(() => Boolean(cycleState()?.rentRule))

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
                <Card>
                  <div class="statement-header">
                    <div>
                      <p class="statement-header__eyebrow">{copy().bills}</p>
                      <h2 class="statement-header__title">
                        {formatCyclePeriod(data().period, locale())}
                      </h2>
                      <p class="statement-header__body">
                        {copy().currentCycleLabel} · {data().currency}
                      </p>
                    </div>
                    <div class="statement-chip-grid">
                      <div class="statement-chip">
                        <span>{copy().pureUtilitiesLabel}</span>
                        <strong>
                          {formatMoneyLabel(utilityCycleTotal(), data().currency, locale())}
                        </strong>
                      </div>
                      <div class="statement-chip">
                        <span>{copy().utilitiesAdjustedTotalLabel}</span>
                        <strong>
                          {formatMoneyLabel(adjustedUtilityTotal(), data().currency, locale())}
                        </strong>
                      </div>
                    </div>
                  </div>
                </Card>

                <Card>
                  <div class="statement-section-heading">
                    <div>
                      <strong>{copy().utilitiesBalanceTitle}</strong>
                      <p>{copy().utilitiesBalanceBody}</p>
                    </div>
                  </div>
                  <div class="statement-rows">
                    <div class="statement-row statement-row--header">
                      <span>{locale() === 'ru' ? 'Участник' : 'Member'}</span>
                      <span>{copy().pureUtilitiesLabel}</span>
                      <span>{copy().utilitiesAdjustedTotalLabel}</span>
                    </div>
                    <For each={utilityOverview()}>
                      {(item) => (
                        <div class="statement-row">
                          <strong>{item.displayName}</strong>
                          <span>{formatMoneyLabel(item.pureMajor, data().currency, locale())}</span>
                          <span>
                            {formatMoneyLabel(item.adjustedMajor, data().currency, locale())}
                          </span>
                        </div>
                      )}
                    </For>
                  </div>
                </Card>

                <Show when={effectiveIsAdmin()}>
                  <Card>
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
                    <div class="rent-block">
                      <div class="rent-block__overview">
                        <div class="rent-block__header">
                          <div>
                            <p class="rent-block__eyebrow">{copy().currentCycleLabel}</p>
                            <h3>{formatCyclePeriod(data().period, locale())}</h3>
                          </div>
                          <p class="rent-block__meta">
                            {copy().billingCycleStatus.replace('{currency}', data().currency)}
                          </p>
                        </div>
                        <div class="rent-overview-grid">
                          <div class="rent-overview-card">
                            <span>{copy().rentPanelHouseholdDefaultLabel}</span>
                            <strong>{defaultRentLabel()}</strong>
                          </div>
                          <div class="rent-overview-card">
                            <span>{copy().rentPanelCycleSourceLabel}</span>
                            <strong>
                              {formatMoneyLabel(
                                data().rentSourceAmountMajor,
                                data().rentSourceCurrency,
                                locale()
                              )}
                            </strong>
                          </div>
                          <div class="rent-overview-card">
                            <span>{copy().rentPanelSettlementLabel}</span>
                            <strong>
                              {formatMoneyLabel(
                                data().rentDisplayAmountMajor,
                                data().currency,
                                locale()
                              )}
                            </strong>
                          </div>
                          <div class="rent-overview-card">
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
                        <p class="rent-block__note">
                          {hasRentOverride()
                            ? copy().rentPanelOverrideNote
                            : copy().rentPanelDefaultNote}
                        </p>
                      </div>
                      <div class="rent-block__editor">
                        <div class="rent-block__editor-copy">
                          <strong>{copy().manageCycleAction}</strong>
                          <p>{copy().cycleEditorBody}</p>
                        </div>
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
                          <Field label={copy().rentPanelFxLabel} hint={copy().rentPanelFxHint} wide>
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
                  </Card>
                </Show>

                <Card>
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
                            utilityLedger().find((item) => sameCategory(item.title, category.name))
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
                                type="number"
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
                </Card>

                <PaymentsManager />
              </>
            )}
          </Match>
        </Switch>
      </div>
    </div>
  )
}
