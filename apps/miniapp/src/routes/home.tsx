import { Show, For, createMemo, createSignal, Switch, Match } from 'solid-js'
import { Clock, ChevronDown, ChevronUp, Copy, Check, CreditCard } from 'lucide-solid'
import { useNavigate } from '@solidjs/router'

import { useSession } from '../contexts/session-context'
import { useI18n } from '../contexts/i18n-context'
import { useDashboard } from '../contexts/dashboard-context'
import { Card } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Field } from '../components/ui/field'
import { Input } from '../components/ui/input'
import { Modal } from '../components/ui/dialog'
import { Toast } from '../components/ui/toast'
import { Skeleton } from '../components/ui/skeleton'
import { memberRemainingClass, ledgerPrimaryAmount } from '../lib/ledger-helpers'
import { majorStringToMinor, minorToMajorString } from '../lib/money'
import {
  compareTodayToPeriodDay,
  daysUntilPeriodDay,
  formatPeriodDay,
  nextCyclePeriod,
  parseCalendarDate
} from '../lib/dates'
import { submitMiniAppUtilityBill, addMiniAppPayment } from '../miniapp-api'

export default function HomeRoute() {
  const navigate = useNavigate()
  const { readySession, initData, refreshHouseholdData } = useSession()
  const { copy, locale } = useI18n()
  const {
    dashboard,
    loading,
    currentMemberLine,
    utilityLedger,
    utilityTotalMajor,
    purchaseLedger,
    purchaseTotalMajor,
    testingPeriodOverride,
    testingTodayOverride
  } = useDashboard()
  const [showAllActivity, setShowAllActivity] = createSignal(false)
  const [utilityDraft, setUtilityDraft] = createSignal({
    billName: '',
    amountMajor: '',
    currency: (dashboard()?.currency as 'USD' | 'GEL') ?? 'GEL'
  })
  const [submittingUtilities, setSubmittingUtilities] = createSignal(false)
  const [copiedValue, setCopiedValue] = createSignal<string | null>(null)
  const [quickPaymentOpen, setQuickPaymentOpen] = createSignal(false)
  const [quickPaymentType, setQuickPaymentType] = createSignal<'rent' | 'utilities'>('rent')
  const [quickPaymentAmount, setQuickPaymentAmount] = createSignal('')
  const [submittingPayment, setSubmittingPayment] = createSignal(false)
  const [toastState, setToastState] = createSignal<{
    visible: boolean
    message: string
    type: 'success' | 'info' | 'error'
  }>({ visible: false, message: '', type: 'info' })

  async function copyText(value: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(value)
      return true
    } catch {
      try {
        const element = document.createElement('textarea')
        element.value = value
        element.setAttribute('readonly', 'true')
        element.style.position = 'absolute'
        element.style.left = '-9999px'
        document.body.appendChild(element)
        element.select()
        document.execCommand('copy')
        document.body.removeChild(element)
        return true
      } catch {}
    }

    return false
  }

  async function handleCopy(value: string) {
    if (await copyText(value)) {
      setCopiedValue(value)
      setToastState({ visible: true, message: copy().copiedToast, type: 'success' })
      setTimeout(() => {
        if (copiedValue() === value) {
          setCopiedValue(null)
        }
      }, 1400)
    }
  }

  function dueStatusBadge() {
    const data = dashboard()
    if (!data) return null

    const remaining = majorStringToMinor(data.totalRemainingMajor)
    if (remaining <= 0n) return { label: copy().homeSettledTitle, variant: 'accent' as const }
    return { label: copy().homeDueTitle, variant: 'danger' as const }
  }

  function paymentWindowStatus(input: {
    period: string
    timezone: string
    reminderDay: number
    dueDay: number
    todayOverride?: ReturnType<typeof parseCalendarDate>
  }): { active: boolean; daysUntilDue: number | null } {
    if (!Number.isInteger(input.reminderDay) || !Number.isInteger(input.dueDay)) {
      return { active: false, daysUntilDue: null }
    }

    const start = compareTodayToPeriodDay(
      input.period,
      input.reminderDay,
      input.timezone,
      input.todayOverride
    )
    const end = compareTodayToPeriodDay(
      input.period,
      input.dueDay,
      input.timezone,
      input.todayOverride
    )
    if (start === null || end === null) {
      return { active: false, daysUntilDue: null }
    }

    const reminderPassed = start !== -1
    const dueNotPassed = end !== 1
    const daysUntilDue = daysUntilPeriodDay(
      input.period,
      input.dueDay,
      input.timezone,
      input.todayOverride
    )

    return {
      active: reminderPassed && dueNotPassed,
      daysUntilDue
    }
  }

  const todayOverride = createMemo(() => {
    const raw = testingTodayOverride()
    if (!raw) return null
    return parseCalendarDate(raw)
  })

  const effectivePeriod = createMemo(() => {
    const data = dashboard()
    if (!data) return null
    const override = testingPeriodOverride()
    if (!override) return data.period
    const match = /^(\d{4})-(\d{2})$/.exec(override)
    if (!match) return data.period
    const month = Number.parseInt(match[2] ?? '', 10)
    if (!Number.isInteger(month) || month < 1 || month > 12) return data.period
    return override
  })

  const homeMode = createMemo(() => {
    const data = dashboard()
    if (!data) return 'none' as const
    const period = effectivePeriod() ?? data.period
    const today = todayOverride()

    const utilities = paymentWindowStatus({
      period,
      timezone: data.timezone,
      reminderDay: data.utilitiesReminderDay,
      dueDay: data.utilitiesDueDay,
      todayOverride: today
    })
    const rent = paymentWindowStatus({
      period,
      timezone: data.timezone,
      reminderDay: data.rentWarningDay,
      dueDay: data.rentDueDay,
      todayOverride: today
    })

    if (utilities.active && rent.active) {
      const utilitiesDays = utilities.daysUntilDue ?? Number.POSITIVE_INFINITY
      const rentDays = rent.daysUntilDue ?? Number.POSITIVE_INFINITY
      return utilitiesDays <= rentDays ? ('utilities' as const) : ('rent' as const)
    }

    if (utilities.active) return 'utilities' as const
    if (rent.active) return 'rent' as const
    return 'none' as const
  })

  async function handleSubmitUtilities() {
    const data = initData()
    const current = dashboard()
    const draft = utilityDraft()
    if (!data || !current || submittingUtilities()) return
    if (!draft.billName.trim() || !draft.amountMajor.trim()) return

    setSubmittingUtilities(true)
    try {
      await submitMiniAppUtilityBill(data, {
        billName: draft.billName,
        amountMajor: draft.amountMajor,
        currency: draft.currency
      })
      setUtilityDraft({
        billName: '',
        amountMajor: '',
        currency: current.currency
      })
      await refreshHouseholdData(true, true)
    } finally {
      setSubmittingUtilities(false)
    }
  }

  function openQuickPayment(type: 'rent' | 'utilities') {
    const data = dashboard()
    if (!data || !currentMemberLine()) return

    const member = currentMemberLine()!
    const amount = type === 'rent' ? member.rentShareMajor : member.utilityShareMajor

    setQuickPaymentType(type)
    setQuickPaymentAmount(amount)
    setQuickPaymentOpen(true)
  }

  async function handleQuickPaymentSubmit() {
    const data = initData()
    const amount = quickPaymentAmount()
    const type = quickPaymentType()

    if (!data || !amount.trim() || !currentMemberLine()) return

    setSubmittingPayment(true)
    try {
      await addMiniAppPayment(data, {
        memberId: currentMemberLine()!.memberId,
        kind: type,
        amountMajor: amount,
        currency: (dashboard()?.currency as 'USD' | 'GEL') ?? 'GEL'
      })
      setQuickPaymentOpen(false)
      setToastState({
        visible: true,
        message: copy().quickPaymentSuccess,
        type: 'success'
      })
      await refreshHouseholdData(true, true)
    } catch {
      setToastState({
        visible: true,
        message: copy().quickPaymentFailed,
        type: 'error'
      })
    } finally {
      setSubmittingPayment(false)
    }
  }

  return (
    <div class="route route--home">
      {/* ── Welcome hero ────────────────────────────── */}
      <div class="home-hero">
        <p class="home-hero__greeting">{copy().welcome},</p>
        <h2 class="home-hero__name">{readySession()?.member.displayName}</h2>
      </div>

      {/* ── Dashboard stats ─────────────────────────── */}
      <Switch>
        <Match when={loading()}>
          <Card>
            <div class="balance-card">
              <div class="balance-card__header">
                <Skeleton style={{ width: '140px', height: '20px' }} />
              </div>
              <div class="balance-card__amounts" style={{ 'margin-top': '16px' }}>
                <Skeleton style={{ width: '100%', height: '48px' }} />
                <div style={{ height: '12px' }} />
                <Skeleton style={{ width: '80%', height: '24px' }} />
                <div style={{ height: '8px' }} />
                <Skeleton style={{ width: '60%', height: '24px' }} />
              </div>
            </div>
          </Card>
          <Card>
            <div class="balance-card">
              <div class="balance-card__header">
                <Skeleton style={{ width: '120px', height: '20px' }} />
              </div>
              <div class="balance-card__amounts" style={{ 'margin-top': '16px' }}>
                <Skeleton style={{ width: '70%', height: '24px' }} />
                <div style={{ height: '8px' }} />
                <Skeleton style={{ width: '50%', height: '24px' }} />
              </div>
            </div>
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
              <Show when={currentMemberLine()}>
                {(member) => {
                  const policy = () => data().paymentBalanceAdjustmentPolicy

                  const rentBaseMinor = () => majorStringToMinor(member().rentShareMajor)
                  const utilitiesBaseMinor = () => majorStringToMinor(member().utilityShareMajor)
                  const purchaseOffsetMinor = () => majorStringToMinor(member().purchaseOffsetMajor)

                  const rentProposalMinor = () =>
                    policy() === 'rent' ? rentBaseMinor() + purchaseOffsetMinor() : rentBaseMinor()
                  const utilitiesProposalMinor = () =>
                    policy() === 'utilities'
                      ? utilitiesBaseMinor() + purchaseOffsetMinor()
                      : utilitiesBaseMinor()

                  const mode = () => homeMode()
                  const currency = () => data().currency
                  const timezone = () => data().timezone
                  const period = () => effectivePeriod() ?? data().period
                  const today = () => todayOverride()

                  function upcomingDay(day: number): {
                    dateLabel: string
                    daysUntil: number | null
                  } {
                    const withinPeriodDays = daysUntilPeriodDay(period(), day, timezone(), today())
                    if (withinPeriodDays === null) {
                      return { dateLabel: '—', daysUntil: null }
                    }

                    if (withinPeriodDays >= 0) {
                      return {
                        dateLabel: formatPeriodDay(period(), day, locale()),
                        daysUntil: withinPeriodDays
                      }
                    }

                    const next = nextCyclePeriod(period())
                    if (!next) {
                      return {
                        dateLabel: formatPeriodDay(period(), day, locale()),
                        daysUntil: null
                      }
                    }

                    return {
                      dateLabel: formatPeriodDay(next, day, locale()),
                      daysUntil: daysUntilPeriodDay(next, day, timezone(), today())
                    }
                  }

                  const rentDueDate = () => formatPeriodDay(period(), data().rentDueDay, locale())
                  const utilitiesDueDate = () =>
                    formatPeriodDay(period(), data().utilitiesDueDay, locale())

                  const rentDaysUntilDue = () =>
                    daysUntilPeriodDay(period(), data().rentDueDay, timezone(), today())
                  const utilitiesDaysUntilDue = () =>
                    daysUntilPeriodDay(period(), data().utilitiesDueDay, timezone(), today())

                  const rentUpcoming = () => upcomingDay(data().rentWarningDay)
                  const utilitiesUpcoming = () => upcomingDay(data().utilitiesReminderDay)

                  const focusBadge = () => {
                    const badge = dueStatusBadge()
                    return badge ? <Badge variant={badge.variant}>{badge.label}</Badge> : null
                  }

                  const dueBadge = (days: number | null) => {
                    if (days === null) return null
                    if (days < 0) return <Badge variant="danger">{copy().overdueLabel}</Badge>
                    if (days === 0) return <Badge variant="danger">{copy().dueTodayLabel}</Badge>
                    return (
                      <Badge variant="muted">
                        {copy().daysLeftLabel.replace('{count}', String(days))}
                      </Badge>
                    )
                  }

                  return (
                    <>
                      <Show when={mode() === 'utilities'}>
                        <Card accent>
                          <div class="balance-card">
                            <div class="balance-card__header">
                              <span class="balance-card__label">{copy().homeUtilitiesTitle}</span>
                              <div style={{ display: 'flex', gap: '8px', 'align-items': 'center' }}>
                                {focusBadge()}
                                <Button
                                  variant="primary"
                                  size="sm"
                                  onClick={() => openQuickPayment('utilities')}
                                >
                                  <CreditCard size={14} />
                                  {copy().quickPaymentSubmitAction}
                                </Button>
                              </div>
                            </div>
                            <div class="balance-card__amounts">
                              <div class="balance-card__row balance-card__row--subtotal">
                                <span>{copy().finalDue}</span>
                                <strong>
                                  {minorToMajorString(utilitiesProposalMinor())} {currency()}
                                </strong>
                              </div>
                              <div class="balance-card__row">
                                <span>
                                  {copy().dueOnLabel.replace('{date}', utilitiesDueDate())}
                                </span>
                                {dueBadge(utilitiesDaysUntilDue())}
                              </div>
                              <div class="balance-card__row">
                                <span>{copy().baseDue}</span>
                                <strong>
                                  {member().utilityShareMajor} {currency()}
                                </strong>
                              </div>
                              <Show when={policy() === 'utilities'}>
                                <div class="balance-card__row">
                                  <span>{copy().balanceAdjustmentLabel}</span>
                                  <strong>
                                    {member().purchaseOffsetMajor} {currency()}
                                  </strong>
                                </div>
                              </Show>
                              <Show when={utilityLedger().length > 0}>
                                <div class="balance-card__row balance-card__row--subtotal">
                                  <span>{copy().homeUtilitiesBillsTitle}</span>
                                  <strong>
                                    {utilityTotalMajor()} {currency()}
                                  </strong>
                                </div>
                                <For each={utilityLedger()}>
                                  {(entry) => (
                                    <div class="balance-card__row">
                                      <span>{entry.title}</span>
                                      <strong>{ledgerPrimaryAmount(entry)}</strong>
                                    </div>
                                  )}
                                </For>
                              </Show>
                            </div>
                          </div>
                        </Card>
                      </Show>

                      <Show when={mode() === 'rent'}>
                        <Card accent>
                          <div class="balance-card">
                            <div class="balance-card__header">
                              <span class="balance-card__label">{copy().homeRentTitle}</span>
                              <div style={{ display: 'flex', gap: '8px', 'align-items': 'center' }}>
                                {focusBadge()}
                                <Button
                                  variant="primary"
                                  size="sm"
                                  onClick={() => openQuickPayment('rent')}
                                >
                                  <CreditCard size={14} />
                                  {copy().quickPaymentSubmitAction}
                                </Button>
                              </div>
                            </div>
                            <div class="balance-card__amounts">
                              <div class="balance-card__row balance-card__row--subtotal">
                                <span>{copy().finalDue}</span>
                                <strong>
                                  {minorToMajorString(rentProposalMinor())} {currency()}
                                </strong>
                              </div>
                              <div class="balance-card__row">
                                <span>{copy().dueOnLabel.replace('{date}', rentDueDate())}</span>
                                {dueBadge(rentDaysUntilDue())}
                              </div>
                              <div class="balance-card__row">
                                <span>{copy().baseDue}</span>
                                <strong>
                                  {member().rentShareMajor} {currency()}
                                </strong>
                              </div>
                              <Show when={policy() === 'rent'}>
                                <div class="balance-card__row">
                                  <span>{copy().balanceAdjustmentLabel}</span>
                                  <strong>
                                    {member().purchaseOffsetMajor} {currency()}
                                  </strong>
                                </div>
                              </Show>
                            </div>
                          </div>
                        </Card>
                      </Show>

                      <Show when={mode() === 'none'}>
                        <Card muted>
                          <div class="balance-card">
                            <div class="balance-card__header">
                              <span class="balance-card__label">{copy().homeNoPaymentTitle}</span>
                            </div>
                            <div class="balance-card__amounts">
                              <div class="balance-card__row">
                                <span>
                                  {copy().homeUtilitiesUpcomingLabel.replace(
                                    '{date}',
                                    utilitiesUpcoming().dateLabel
                                  )}
                                </span>
                                <strong>
                                  {utilitiesUpcoming().daysUntil !== null
                                    ? copy().daysLeftLabel.replace(
                                        '{count}',
                                        String(utilitiesUpcoming().daysUntil)
                                      )
                                    : '—'}
                                </strong>
                              </div>
                              <div class="balance-card__row">
                                <span>
                                  {copy().homeRentUpcomingLabel.replace(
                                    '{date}',
                                    rentUpcoming().dateLabel
                                  )}
                                </span>
                                <strong>
                                  {rentUpcoming().daysUntil !== null
                                    ? copy().daysLeftLabel.replace(
                                        '{count}',
                                        String(rentUpcoming().daysUntil)
                                      )
                                    : '—'}
                                </strong>
                              </div>
                            </div>
                          </div>
                        </Card>
                      </Show>

                      <Show when={mode() === 'utilities' && utilityLedger().length === 0}>
                        <Card>
                          <div class="balance-card">
                            <div class="balance-card__header">
                              <span class="balance-card__label">
                                {copy().homeFillUtilitiesTitle}
                              </span>
                            </div>
                            <p class="empty-state">{copy().homeFillUtilitiesBody}</p>
                            <div class="editor-grid">
                              <Field label={copy().utilityCategoryLabel} wide>
                                <Input
                                  value={utilityDraft().billName}
                                  onInput={(e) =>
                                    setUtilityDraft((d) => ({
                                      ...d,
                                      billName: e.currentTarget.value
                                    }))
                                  }
                                />
                              </Field>
                              <Field label={copy().utilityAmount} wide>
                                <Input
                                  type="number"
                                  value={utilityDraft().amountMajor}
                                  onInput={(e) =>
                                    setUtilityDraft((d) => ({
                                      ...d,
                                      amountMajor: e.currentTarget.value
                                    }))
                                  }
                                />
                              </Field>
                              <div style={{ display: 'flex', gap: '10px' }}>
                                <Button
                                  variant="primary"
                                  loading={submittingUtilities()}
                                  disabled={
                                    !utilityDraft().billName.trim() ||
                                    !utilityDraft().amountMajor.trim()
                                  }
                                  onClick={() => void handleSubmitUtilities()}
                                >
                                  {submittingUtilities()
                                    ? copy().homeFillUtilitiesSubmitting
                                    : copy().homeFillUtilitiesSubmitAction}
                                </Button>
                                <Button variant="ghost" onClick={() => navigate('/ledger')}>
                                  {copy().homeFillUtilitiesOpenLedgerAction}
                                </Button>
                              </div>
                            </div>
                          </div>
                        </Card>
                      </Show>

                      <Show when={mode() === 'rent' && data().rentPaymentDestinations?.length}>
                        <div style={{ display: 'grid', gap: '12px' }}>
                          <For each={data().rentPaymentDestinations ?? []}>
                            {(destination) => (
                              <Card>
                                <div class="balance-card">
                                  <div class="balance-card__header">
                                    <span class="balance-card__label">{destination.label}</span>
                                  </div>
                                  <div class="balance-card__amounts">
                                    <Show when={destination.recipientName}>
                                      {(value) => (
                                        <div class="balance-card__row">
                                          <span>{copy().rentPaymentDestinationRecipient}</span>
                                          <strong>
                                            <button
                                              class="copyable-detail"
                                              classList={{ 'is-copied': copiedValue() === value() }}
                                              type="button"
                                              onClick={() => void handleCopy(value())}
                                            >
                                              <span>{value()}</span>
                                              {copiedValue() === value() ? (
                                                <Check size={14} />
                                              ) : (
                                                <Copy size={14} />
                                              )}
                                            </button>
                                          </strong>
                                        </div>
                                      )}
                                    </Show>
                                    <Show when={destination.bankName}>
                                      {(value) => (
                                        <div class="balance-card__row">
                                          <span>{copy().rentPaymentDestinationBank}</span>
                                          <strong>
                                            <button
                                              class="copyable-detail"
                                              classList={{ 'is-copied': copiedValue() === value() }}
                                              type="button"
                                              onClick={() => void handleCopy(value())}
                                            >
                                              <span>{value()}</span>
                                              {copiedValue() === value() ? (
                                                <Check size={14} />
                                              ) : (
                                                <Copy size={14} />
                                              )}
                                            </button>
                                          </strong>
                                        </div>
                                      )}
                                    </Show>
                                    <div class="balance-card__row">
                                      <span>{copy().rentPaymentDestinationAccount}</span>
                                      <strong>
                                        <button
                                          class="copyable-detail"
                                          classList={{
                                            'is-copied': copiedValue() === destination.account
                                          }}
                                          type="button"
                                          onClick={() => void handleCopy(destination.account)}
                                        >
                                          <span>{destination.account}</span>
                                          {copiedValue() === destination.account ? (
                                            <Check size={14} />
                                          ) : (
                                            <Copy size={14} />
                                          )}
                                        </button>
                                      </strong>
                                    </div>
                                    <Show when={destination.link}>
                                      {(value) => (
                                        <div class="balance-card__row">
                                          <span>{copy().rentPaymentDestinationLink}</span>
                                          <strong>
                                            <button
                                              class="copyable-detail"
                                              classList={{ 'is-copied': copiedValue() === value() }}
                                              type="button"
                                              onClick={() => void handleCopy(value())}
                                            >
                                              <span>{value()}</span>
                                              {copiedValue() === value() ? (
                                                <Check size={14} />
                                              ) : (
                                                <Copy size={14} />
                                              )}
                                            </button>
                                          </strong>
                                        </div>
                                      )}
                                    </Show>
                                    <Show when={destination.note}>
                                      {(value) => (
                                        <div class="balance-card__row">
                                          <span>{copy().rentPaymentDestinationNote}</span>
                                          <strong>
                                            <button
                                              class="copyable-detail"
                                              classList={{ 'is-copied': copiedValue() === value() }}
                                              type="button"
                                              onClick={() => void handleCopy(value())}
                                            >
                                              <span>{value()}</span>
                                              {copiedValue() === value() ? (
                                                <Check size={14} />
                                              ) : (
                                                <Copy size={14} />
                                              )}
                                            </button>
                                          </strong>
                                        </div>
                                      )}
                                    </Show>
                                  </div>
                                </div>
                              </Card>
                            )}
                          </For>
                        </div>
                      </Show>
                    </>
                  )
                }}
              </Show>

              {/* Your balance card */}
              <Show when={currentMemberLine()}>
                {(member) => (
                  <>
                    <Show when={homeMode() !== 'none'}>
                      {(() => {
                        const subtotalMinor =
                          majorStringToMinor(member().rentShareMajor) +
                          majorStringToMinor(member().utilityShareMajor)
                        const subtotalMajor = minorToMajorString(subtotalMinor)

                        return (
                          <Card>
                            <div class="balance-card">
                              <div class="balance-card__header">
                                <span class="balance-card__label">{copy().yourBalanceTitle}</span>
                                <Show when={dueStatusBadge()}>
                                  {(badge) => (
                                    <Badge variant={badge().variant}>{badge().label}</Badge>
                                  )}
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
                      })()}
                    </Show>

                    <Show when={homeMode() === 'none'}>
                      <Card>
                        <div class="balance-card">
                          <div class="balance-card__header">
                            <span class="balance-card__label">{copy().homePurchasesTitle}</span>
                          </div>
                          <div class="balance-card__amounts">
                            <div class="balance-card__row balance-card__row--subtotal">
                              <span>{copy().homePurchasesOffsetLabel}</span>
                              <strong>
                                {member().purchaseOffsetMajor} {data().currency}
                              </strong>
                            </div>
                            <div class="balance-card__row">
                              <span>
                                {copy().homePurchasesTotalLabel.replace(
                                  '{count}',
                                  String(purchaseLedger().length)
                                )}
                              </span>
                              <strong>
                                {purchaseTotalMajor()} {data().currency}
                              </strong>
                            </div>
                          </div>
                        </div>
                      </Card>
                    </Show>
                  </>
                )}
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
                      <For each={showAllActivity() ? data().ledger : data().ledger.slice(0, 5)}>
                        {(entry) => (
                          <div class="activity-card__item">
                            <span class="activity-card__title">{entry.title}</span>
                            <span class="activity-card__amount">{ledgerPrimaryAmount(entry)}</span>
                          </div>
                        )}
                      </For>
                    </div>
                    <Show when={data().ledger.length > 5}>
                      <button
                        class="activity-card__show-more"
                        onClick={() => setShowAllActivity(!showAllActivity())}
                      >
                        <Show
                          when={showAllActivity()}
                          fallback={
                            <>
                              <span>{copy().showMoreAction}</span>
                              <ChevronDown size={14} />
                            </>
                          }
                        >
                          <span>{copy().showLessAction}</span>
                          <ChevronUp size={14} />
                        </Show>
                      </button>
                    </Show>
                  </Show>
                </div>
              </Card>
            </>
          )}
        </Match>
      </Switch>

      {/* Quick Payment Modal */}
      <Modal
        open={quickPaymentOpen()}
        title={copy().quickPaymentTitle}
        description={copy().quickPaymentBody.replace(
          '{type}',
          quickPaymentType() === 'rent' ? copy().shareRent : copy().shareUtilities
        )}
        closeLabel={copy().showLessAction}
        onClose={() => setQuickPaymentOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setQuickPaymentOpen(false)}>
              {copy().showLessAction}
            </Button>
            <Button
              variant="primary"
              loading={submittingPayment()}
              disabled={!quickPaymentAmount().trim()}
              onClick={() => void handleQuickPaymentSubmit()}
            >
              {submittingPayment()
                ? copy().quickPaymentSubmitting
                : copy().quickPaymentSubmitAction}
            </Button>
          </>
        }
      >
        <div style={{ display: 'grid', gap: '12px' }}>
          <Field label={copy().quickPaymentAmountLabel}>
            <Input
              type="number"
              value={quickPaymentAmount()}
              onInput={(e) => setQuickPaymentAmount(e.currentTarget.value)}
              placeholder="0.00"
            />
          </Field>
          <Field label={copy().quickPaymentCurrencyLabel}>
            <Input type="text" value={(dashboard()?.currency as 'USD' | 'GEL') ?? 'GEL'} disabled />
          </Field>
        </div>
      </Modal>

      {/* Toast Notifications */}
      <Toast
        state={toastState()}
        onClose={() => setToastState({ ...toastState(), visible: false })}
      />
    </div>
  )
}
