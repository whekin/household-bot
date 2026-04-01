import { Show, For, createEffect, createMemo, createSignal, Switch, Match } from 'solid-js'
import { Clock, ChevronDown, ChevronUp, Copy, Check, CreditCard } from 'lucide-solid'
import { useNavigate } from '@solidjs/router'

import { useSession } from '../contexts/session-context'
import { useI18n } from '../contexts/i18n-context'
import { useDashboard } from '../contexts/dashboard-context'
import { Card } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { CurrencyToggle } from '../components/ui/currency-toggle'
import { Field } from '../components/ui/field'
import { Input } from '../components/ui/input'
import { Modal } from '../components/ui/dialog'
import { Toast } from '../components/ui/toast'
import { Skeleton } from '../components/ui/skeleton'
import { formatMoneyLabel } from '../lib/ledger-helpers'
import { majorStringToMinor, minorToMajorString } from '../lib/money'
import {
  compareTodayToPeriodDay,
  daysUntilPeriodDay,
  formatCyclePeriod,
  formatPeriodDay,
  nextCyclePeriod,
  parseCalendarDate
} from '../lib/dates'
import {
  submitMiniAppUtilityBill,
  addMiniAppPayment,
  updateMiniAppNotification,
  cancelMiniAppNotification
} from '../miniapp-api'
import type { MiniAppDashboard } from '../miniapp-api'

function sumMemberPaymentsByKind(
  data: MiniAppDashboard,
  memberId: string,
  kind: 'rent' | 'utilities'
): bigint {
  return data.ledger.reduce((sum, entry) => {
    if (entry.kind !== 'payment' || entry.memberId !== memberId || entry.paymentKind !== kind) {
      return sum
    }

    return sum + majorStringToMinor(entry.amountMajor)
  }, 0n)
}

function paymentProposalMinor(
  data: MiniAppDashboard,
  member: MiniAppDashboard['members'][number],
  kind: 'rent' | 'utilities'
): bigint {
  const purchaseOffsetMinor = majorStringToMinor(member.purchaseOffsetMajor)
  const baseMinor =
    kind === 'rent'
      ? majorStringToMinor(member.rentShareMajor)
      : majorStringToMinor(member.utilityShareMajor)

  const proposalMinor =
    data.paymentBalanceAdjustmentPolicy === kind ? baseMinor + purchaseOffsetMinor : baseMinor

  if (kind !== 'rent' || proposalMinor <= 0n) {
    return proposalMinor
  }

  const wholeMinor = proposalMinor / 100n
  const remainderMinor = proposalMinor % 100n

  return (remainderMinor >= 50n ? wholeMinor + 1n : wholeMinor) * 100n
}

function paymentRemainingMinor(
  data: MiniAppDashboard,
  member: MiniAppDashboard['members'][number],
  kind: 'rent' | 'utilities'
): bigint {
  const proposalMinor = paymentProposalMinor(data, member, kind)
  const paidMinor = sumMemberPaymentsByKind(data, member.memberId, kind)
  const remainingMinor = proposalMinor - paidMinor

  return remainingMinor > 0n ? remainingMinor : 0n
}

function zonedDateTimeParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date)

  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0')

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute')
  }
}

function dateKey(input: { year: number; month: number; day: number }) {
  return [
    String(input.year).padStart(4, '0'),
    String(input.month).padStart(2, '0'),
    String(input.day).padStart(2, '0')
  ].join('-')
}

function shiftDateKey(currentKey: string, days: number): string {
  const [yearText = '1970', monthText = '01', dayText = '01'] = currentKey.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const shifted = new Date(Date.UTC(year, month - 1, day + days))
  return [
    shifted.getUTCFullYear(),
    String(shifted.getUTCMonth() + 1).padStart(2, '0'),
    String(shifted.getUTCDate()).padStart(2, '0')
  ].join('-')
}

function formatNotificationTimeOfDay(locale: 'en' | 'ru', hour: number, minute: number) {
  const exact = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  if (locale !== 'ru' || minute !== 0) {
    return locale === 'ru' ? `в ${exact}` : `at ${exact}`
  }

  if (hour >= 5 && hour <= 11) return `в ${hour} утра`
  if (hour >= 12 && hour <= 16) return hour === 12 ? 'в 12 дня' : `в ${hour} дня`
  if (hour >= 17 && hour <= 23) return `в ${hour > 12 ? hour - 12 : hour} вечера`
  return `в ${hour} ночи`
}

function formatNotificationWhen(
  locale: 'en' | 'ru',
  scheduledForIso: string,
  timeZone: string
): string {
  const now = zonedDateTimeParts(new Date(), timeZone)
  const target = zonedDateTimeParts(new Date(scheduledForIso), timeZone)
  const nowKey = dateKey(now)
  const sleepAwareBaseKey = now.hour <= 4 ? shiftDateKey(nowKey, -1) : nowKey
  const targetKey = dateKey(target)
  const timeText = formatNotificationTimeOfDay(locale, target.hour, target.minute)

  if (targetKey === sleepAwareBaseKey) {
    return locale === 'ru' ? `Сегодня ${timeText}` : `Today ${timeText}`
  }
  if (targetKey === shiftDateKey(sleepAwareBaseKey, 1)) {
    return locale === 'ru' ? `Завтра ${timeText}` : `Tomorrow ${timeText}`
  }
  if (targetKey === shiftDateKey(sleepAwareBaseKey, 2)) {
    return locale === 'ru' ? `Послезавтра ${timeText}` : `The day after tomorrow ${timeText}`
  }

  const dateText =
    locale === 'ru'
      ? `${String(target.day).padStart(2, '0')}.${String(target.month).padStart(2, '0')}.${target.year}`
      : `${target.year}-${String(target.month).padStart(2, '0')}-${String(target.day).padStart(2, '0')}`

  return `${dateText} ${timeText}`
}

function formatNotificationDelivery(
  locale: 'en' | 'ru',
  notification: MiniAppDashboard['notifications'][number]
) {
  if (notification.deliveryMode === 'topic') {
    return locale === 'ru' ? 'В этот топик' : 'This topic'
  }

  if (notification.deliveryMode === 'dm_all') {
    return locale === 'ru' ? 'Всем в личку' : 'DM to everyone'
  }

  return locale === 'ru'
    ? notification.dmRecipientDisplayNames.length > 0
      ? `В личку: ${notification.dmRecipientDisplayNames.join(', ')}`
      : 'В выбранные лички'
    : notification.dmRecipientDisplayNames.length > 0
      ? `DM: ${notification.dmRecipientDisplayNames.join(', ')}`
      : 'DM selected members'
}

function notificationInputValue(iso: string, timeZone: string) {
  const target = zonedDateTimeParts(new Date(iso), timeZone)
  return `${dateKey(target)}T${String(target.hour).padStart(2, '0')}:${String(target.minute).padStart(2, '0')}`
}

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
    testingPeriodOverride,
    testingTodayOverride
  } = useDashboard()
  const [showAllActivity, setShowAllActivity] = createSignal(false)
  const [utilityAmounts, setUtilityAmounts] = createSignal<Record<string, string>>({})
  const [submittingUtilities, setSubmittingUtilities] = createSignal(false)
  const [copiedValue, setCopiedValue] = createSignal<string | null>(null)
  const [quickPaymentOpen, setQuickPaymentOpen] = createSignal(false)
  const [quickPaymentType, setQuickPaymentType] = createSignal<'rent' | 'utilities'>('rent')
  const [quickPaymentContext, setQuickPaymentContext] = createSignal<'current' | 'overdue'>(
    'current'
  )
  const [quickPaymentAmount, setQuickPaymentAmount] = createSignal('')
  const [submittingPayment, setSubmittingPayment] = createSignal(false)
  const [notificationEditorOpen, setNotificationEditorOpen] = createSignal(false)
  const [editingNotificationId, setEditingNotificationId] = createSignal<string | null>(null)
  const [notificationScheduleDraft, setNotificationScheduleDraft] = createSignal('')
  const [notificationDeliveryModeDraft, setNotificationDeliveryModeDraft] = createSignal<
    'topic' | 'dm_all' | 'dm_selected'
  >('topic')
  const [notificationRecipientsDraft, setNotificationRecipientsDraft] = createSignal<string[]>([])
  const [savingNotification, setSavingNotification] = createSignal(false)
  const [cancellingNotificationId, setCancellingNotificationId] = createSignal<string | null>(null)
  const [toastState, setToastState] = createSignal<{
    visible: boolean
    message: string
    type: 'success' | 'info' | 'error'
  }>({ visible: false, message: '', type: 'info' })

  const selectedNotification = createMemo(
    () =>
      dashboard()?.notifications.find(
        (notification) => notification.id === editingNotificationId()
      ) ?? null
  )

  const activeHouseholdMembers = createMemo(() => dashboard()?.members ?? [])
  const utilityCategories = createMemo(() => dashboard()?.utilityCategories ?? [])
  const latestActivity = createMemo(() => {
    const entries = [...(dashboard()?.ledger ?? [])]
    return entries.sort((left, right) => {
      if (left.occurredAt === right.occurredAt) {
        return right.title.localeCompare(left.title)
      }
      return (right.occurredAt ?? '').localeCompare(left.occurredAt ?? '')
    })
  })

  createEffect(() => {
    const categories = utilityCategories()
    setUtilityAmounts(Object.fromEntries(categories.map((category) => [category.name, ''])))
  })

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

  const currentPaymentModes = createMemo(() => {
    const data = dashboard()
    const member = currentMemberLine()
    if (!data || !member) return [] as ('rent' | 'utilities')[]
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
    const utilitiesDueMinor = paymentRemainingMinor(data, member, 'utilities')
    const rentDueMinor = paymentRemainingMinor(data, member, 'rent')
    const utilitiesActive = utilities.active && utilitiesDueMinor > 0n
    const rentActive = rent.active && rentDueMinor > 0n

    const modes: ('rent' | 'utilities')[] = []
    if (utilitiesActive) {
      modes.push('utilities')
    }
    if (rentActive) {
      modes.push('rent')
    }

    return modes
  })

  function overduePaymentFor(kind: 'rent' | 'utilities') {
    return currentMemberLine()?.overduePayments.find((payment) => payment.kind === kind) ?? null
  }

  async function handleSubmitUtilities() {
    const data = initData()
    const current = dashboard()
    const drafts = utilityAmounts()
    if (!data || !current || submittingUtilities()) return
    const entries = utilityCategories()
      .map((category) => ({
        billName: category.name,
        amountMajor: drafts[category.name]?.trim() ?? ''
      }))
      .filter((entry) => entry.amountMajor.length > 0)

    if (entries.length === 0) return

    setSubmittingUtilities(true)
    try {
      for (const entry of entries) {
        await submitMiniAppUtilityBill(data, {
          billName: entry.billName,
          amountMajor: entry.amountMajor,
          currency: current.currency
        })
      }
      setUtilityAmounts(
        Object.fromEntries(utilityCategories().map((category) => [category.name, '']))
      )
      await refreshHouseholdData(false, true)
    } finally {
      setSubmittingUtilities(false)
    }
  }

  function openQuickPayment(
    type: 'rent' | 'utilities',
    context: 'current' | 'overdue' = 'current'
  ) {
    const data = dashboard()
    if (!data || !currentMemberLine()) return

    const member = currentMemberLine()!
    const amount =
      context === 'overdue'
        ? (overduePaymentFor(type)?.amountMajor ?? '0.00')
        : minorToMajorString(paymentRemainingMinor(data, member, type))

    setQuickPaymentType(type)
    setQuickPaymentContext(context)
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

  function openNotificationEditor(notification: MiniAppDashboard['notifications'][number]) {
    const data = dashboard()
    if (!data) return

    setEditingNotificationId(notification.id)
    setNotificationScheduleDraft(notificationInputValue(notification.scheduledFor, data.timezone))
    setNotificationDeliveryModeDraft(notification.deliveryMode)
    setNotificationRecipientsDraft(
      notification.deliveryMode === 'dm_selected' ? [...notification.dmRecipientMemberIds] : []
    )
    setNotificationEditorOpen(true)
  }

  function toggleNotificationRecipient(memberId: string) {
    setNotificationRecipientsDraft((current) =>
      current.includes(memberId)
        ? current.filter((value) => value !== memberId)
        : [...current, memberId]
    )
  }

  async function handleNotificationSave() {
    const data = initData()
    const current = dashboard()
    const notification = selectedNotification()
    if (!data || !current || !notification || !notification.canEdit || savingNotification()) return

    setSavingNotification(true)
    try {
      await updateMiniAppNotification(data, {
        notificationId: notification.id,
        scheduledLocal: notificationScheduleDraft(),
        timezone: current.timezone,
        deliveryMode: notificationDeliveryModeDraft(),
        dmRecipientMemberIds:
          notificationDeliveryModeDraft() === 'dm_selected' ? notificationRecipientsDraft() : []
      })
      setNotificationEditorOpen(false)
      setToastState({
        visible: true,
        message: locale() === 'ru' ? 'Напоминание обновлено.' : 'Notification updated.',
        type: 'success'
      })
      await refreshHouseholdData(true, true)
    } catch {
      setToastState({
        visible: true,
        message:
          locale() === 'ru'
            ? 'Не получилось обновить напоминание.'
            : 'Failed to update notification.',
        type: 'error'
      })
    } finally {
      setSavingNotification(false)
    }
  }

  async function handleNotificationCancel(notificationId: string) {
    const data = initData()
    if (!data || cancellingNotificationId()) return

    setCancellingNotificationId(notificationId)
    try {
      await cancelMiniAppNotification(data, notificationId)
      if (editingNotificationId() === notificationId) {
        setNotificationEditorOpen(false)
      }
      setToastState({
        visible: true,
        message: locale() === 'ru' ? 'Напоминание отменено.' : 'Notification cancelled.',
        type: 'success'
      })
      await refreshHouseholdData(true, true)
    } catch {
      setToastState({
        visible: true,
        message:
          locale() === 'ru'
            ? 'Не получилось отменить напоминание.'
            : 'Failed to cancel notification.',
        type: 'error'
      })
    } finally {
      setCancellingNotificationId(null)
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
                  const rentRemainingMinor = () => paymentRemainingMinor(data(), member(), 'rent')
                  const utilitiesRemainingMinor = () =>
                    paymentRemainingMinor(data(), member(), 'utilities')

                  const modes = () => currentPaymentModes()
                  const formatMajorAmount = (
                    amountMajor: string,
                    currencyCode: 'USD' | 'GEL' = data().currency
                  ) => formatMoneyLabel(amountMajor, currencyCode, locale())
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
                      <Show when={overduePaymentFor('utilities')}>
                        {(overdue) => (
                          <Card accent>
                            <div class="balance-card">
                              <div class="balance-card__header">
                                <span class="balance-card__label">
                                  {copy().homeOverdueUtilitiesTitle}
                                </span>
                                <div
                                  style={{ display: 'flex', gap: '8px', 'align-items': 'center' }}
                                >
                                  <Badge variant="danger">{copy().overdueLabel}</Badge>
                                  <Button
                                    variant="primary"
                                    size="sm"
                                    onClick={() => openQuickPayment('utilities', 'overdue')}
                                  >
                                    <CreditCard size={14} />
                                    {copy().quickPaymentSubmitAction}
                                  </Button>
                                </div>
                              </div>
                              <div class="balance-card__amounts">
                                <div class="balance-card__row balance-card__row--subtotal">
                                  <span>{copy().finalDue}</span>
                                  <strong>{formatMajorAmount(overdue().amountMajor)}</strong>
                                </div>
                                <div class="balance-card__row">
                                  <span>
                                    {copy().homeOverduePeriodsLabel.replace(
                                      '{periods}',
                                      overdue()
                                        .periods.map((period) =>
                                          formatCyclePeriod(period, locale())
                                        )
                                        .join(', ')
                                    )}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </Card>
                        )}
                      </Show>

                      <Show when={overduePaymentFor('rent')}>
                        {(overdue) => (
                          <Card accent>
                            <div class="balance-card">
                              <div class="balance-card__header">
                                <span class="balance-card__label">
                                  {copy().homeOverdueRentTitle}
                                </span>
                                <div
                                  style={{ display: 'flex', gap: '8px', 'align-items': 'center' }}
                                >
                                  <Badge variant="danger">{copy().overdueLabel}</Badge>
                                  <Button
                                    variant="primary"
                                    size="sm"
                                    onClick={() => openQuickPayment('rent', 'overdue')}
                                  >
                                    <CreditCard size={14} />
                                    {copy().quickPaymentSubmitAction}
                                  </Button>
                                </div>
                              </div>
                              <div class="balance-card__amounts">
                                <div class="balance-card__row balance-card__row--subtotal">
                                  <span>{copy().finalDue}</span>
                                  <strong>{formatMajorAmount(overdue().amountMajor)}</strong>
                                </div>
                                <div class="balance-card__row">
                                  <span>
                                    {copy().homeOverduePeriodsLabel.replace(
                                      '{periods}',
                                      overdue()
                                        .periods.map((period) =>
                                          formatCyclePeriod(period, locale())
                                        )
                                        .join(', ')
                                    )}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </Card>
                        )}
                      </Show>

                      <Show when={modes().includes('utilities')}>
                        <Card accent>
                          <div class="balance-card">
                            <div class="balance-card__header">
                              <span class="balance-card__label">{copy().homeUtilitiesTitle}</span>
                              <div style={{ display: 'flex', gap: '8px', 'align-items': 'center' }}>
                                {focusBadge()}
                                <Button
                                  variant="primary"
                                  size="sm"
                                  onClick={() => openQuickPayment('utilities', 'current')}
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
                                  {formatMajorAmount(minorToMajorString(utilitiesRemainingMinor()))}
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
                                <strong>{formatMajorAmount(member().utilityShareMajor)}</strong>
                              </div>
                              <Show when={policy() === 'utilities'}>
                                <div class="balance-card__row">
                                  <span>{copy().balanceAdjustmentLabel}</span>
                                  <strong>{formatMajorAmount(member().purchaseOffsetMajor)}</strong>
                                </div>
                              </Show>
                              <Show when={utilityLedger().length > 0}>
                                <div class="balance-card__row balance-card__row--subtotal">
                                  <span>{copy().homeUtilitiesBillsTitle}</span>
                                  <strong>{formatMajorAmount(utilityTotalMajor())}</strong>
                                </div>
                                <For each={utilityLedger()}>
                                  {(entry) => (
                                    <div class="balance-card__row">
                                      <span>{entry.title}</span>
                                      <strong>
                                        {formatMoneyLabel(
                                          entry.displayAmountMajor,
                                          entry.displayCurrency,
                                          locale()
                                        )}
                                      </strong>
                                    </div>
                                  )}
                                </For>
                              </Show>
                            </div>
                          </div>
                        </Card>
                      </Show>

                      <Show when={modes().includes('rent')}>
                        <Card accent>
                          <div class="balance-card">
                            <div class="balance-card__header">
                              <span class="balance-card__label">{copy().homeRentTitle}</span>
                              <div style={{ display: 'flex', gap: '8px', 'align-items': 'center' }}>
                                {focusBadge()}
                                <Button
                                  variant="primary"
                                  size="sm"
                                  onClick={() => openQuickPayment('rent', 'current')}
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
                                  {formatMajorAmount(minorToMajorString(rentRemainingMinor()))}
                                </strong>
                              </div>
                              <div class="balance-card__row">
                                <span>{copy().dueOnLabel.replace('{date}', rentDueDate())}</span>
                                {dueBadge(rentDaysUntilDue())}
                              </div>
                              <div class="balance-card__row">
                                <span>{copy().baseDue}</span>
                                <strong>{formatMajorAmount(member().rentShareMajor)}</strong>
                              </div>
                              <Show when={policy() === 'rent'}>
                                <div class="balance-card__row">
                                  <span>{copy().balanceAdjustmentLabel}</span>
                                  <strong>{formatMajorAmount(member().purchaseOffsetMajor)}</strong>
                                </div>
                              </Show>
                            </div>
                          </div>
                        </Card>
                      </Show>

                      <Show
                        when={
                          modes().length === 0 &&
                          !overduePaymentFor('utilities') &&
                          !overduePaymentFor('rent')
                        }
                      >
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

                      <Show when={modes().includes('utilities') && utilityLedger().length === 0}>
                        <Card>
                          <div class="balance-card">
                            <div class="balance-card__header">
                              <span class="balance-card__label">
                                {copy().homeFillUtilitiesTitle}
                              </span>
                            </div>
                            <p class="empty-state">{copy().homeFillUtilitiesBody}</p>
                            <div class="editor-grid">
                              <div class="inline-editor-list">
                                <For each={utilityCategories()}>
                                  {(category) => (
                                    <div class="inline-editor-row">
                                      <div class="inline-editor-row__label">
                                        <strong>{category.name}</strong>
                                        <span>{copy().utilityCategoryLabel}</span>
                                      </div>
                                      <Input
                                        type="number"
                                        value={utilityAmounts()[category.name] ?? ''}
                                        onInput={(e) =>
                                          setUtilityAmounts((prev) => ({
                                            ...prev,
                                            [category.name]: e.currentTarget.value
                                          }))
                                        }
                                      />
                                      <div class="inline-editor-row__value">
                                        <span>{data().currency}</span>
                                      </div>
                                    </div>
                                  )}
                                </For>
                              </div>
                              <div style={{ display: 'flex', gap: '10px', 'flex-wrap': 'wrap' }}>
                                <Button
                                  variant="primary"
                                  loading={submittingUtilities()}
                                  disabled={
                                    !Object.values(utilityAmounts()).some((value) => value.trim())
                                  }
                                  onClick={() => void handleSubmitUtilities()}
                                >
                                  {submittingUtilities()
                                    ? copy().homeFillUtilitiesSubmitting
                                    : copy().homeFillUtilitiesSubmitAction}
                                </Button>
                                <Button variant="ghost" onClick={() => navigate('/bills')}>
                                  {copy().bills}
                                </Button>
                              </div>
                            </div>
                          </div>
                        </Card>
                      </Show>

                      <Show
                        when={modes().includes('rent') && data().rentPaymentDestinations?.length}
                      >
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

              <Card>
                <div class="balance-card">
                  <div class="balance-card__header">
                    <span class="balance-card__label">
                      {locale() === 'ru' ? 'Напоминания' : 'Notifications'}
                    </span>
                    <Badge variant="muted">{data().notifications.length}</Badge>
                  </div>
                  <Show
                    when={data().notifications.length > 0}
                    fallback={
                      <p class="empty-state">
                        {locale() === 'ru'
                          ? 'Пока нет запланированных напоминаний.'
                          : 'There are no scheduled notifications yet.'}
                      </p>
                    }
                  >
                    <div class="balance-card__amounts">
                      <For each={data().notifications}>
                        {(notification) => (
                          <div
                            class="balance-card__row"
                            style={{
                              'align-items': 'flex-start',
                              'flex-direction': 'column',
                              gap: '10px',
                              padding: '12px 0'
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                width: '100%',
                                'justify-content': 'space-between',
                                gap: '12px',
                                'align-items': 'flex-start'
                              }}
                            >
                              <div style={{ display: 'grid', gap: '6px' }}>
                                <strong>{notification.summaryText}</strong>
                                <span>
                                  {formatNotificationWhen(
                                    locale(),
                                    notification.scheduledFor,
                                    data().timezone
                                  )}
                                </span>
                                <span>{formatNotificationDelivery(locale(), notification)}</span>
                                <Show when={notification.assigneeDisplayName}>
                                  <span>
                                    {(locale() === 'ru' ? 'Для: ' : 'For: ') +
                                      notification.assigneeDisplayName}
                                  </span>
                                </Show>
                                <span>
                                  {(locale() === 'ru' ? 'Создал: ' : 'Created by: ') +
                                    notification.creatorDisplayName}
                                </span>
                              </div>
                              <div
                                style={{
                                  display: 'flex',
                                  gap: '8px',
                                  'flex-wrap': 'nowrap',
                                  'justify-content': 'flex-end',
                                  'align-items': 'center',
                                  'flex-shrink': '0'
                                }}
                              >
                                <Show when={notification.canEdit}>
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => openNotificationEditor(notification)}
                                  >
                                    {locale() === 'ru' ? 'Управлять' : 'Manage'}
                                  </Button>
                                </Show>
                                <Show when={notification.canCancel}>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    loading={cancellingNotificationId() === notification.id}
                                    onClick={() => void handleNotificationCancel(notification.id)}
                                  >
                                    {locale() === 'ru' ? 'Отменить' : 'Cancel'}
                                  </Button>
                                </Show>
                              </div>
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              </Card>

              {/* Latest activity */}
              <Card>
                <div class="activity-card">
                  <div class="activity-card__header">
                    <Clock size={16} />
                    <span>{copy().latestActivityTitle}</span>
                  </div>
                  <Show
                    when={latestActivity().length > 0}
                    fallback={<p class="empty-state">{copy().latestActivityEmpty}</p>}
                  >
                    <div class="activity-card__list">
                      <For
                        each={showAllActivity() ? latestActivity() : latestActivity().slice(0, 5)}
                      >
                        {(entry) => (
                          <div class="activity-card__item">
                            <span class="activity-card__title">{entry.title}</span>
                            <span class="activity-card__amount">
                              {formatMoneyLabel(
                                entry.displayAmountMajor,
                                entry.displayCurrency,
                                locale()
                              )}
                            </span>
                          </div>
                        )}
                      </For>
                    </div>
                    <Show when={latestActivity().length > 5}>
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

      <Modal
        open={notificationEditorOpen()}
        title={locale() === 'ru' ? 'Управление напоминанием' : 'Manage notification'}
        {...(selectedNotification()
          ? {
              description: formatNotificationWhen(
                locale(),
                selectedNotification()!.scheduledFor,
                dashboard()?.timezone ?? 'UTC'
              )
            }
          : {})}
        closeLabel={copy().showLessAction}
        onClose={() => {
          setNotificationEditorOpen(false)
        }}
        footer={
          <>
            <Show when={selectedNotification()?.canCancel}>
              <Button
                variant="ghost"
                loading={cancellingNotificationId() === selectedNotification()?.id}
                onClick={() =>
                  selectedNotification() &&
                  void handleNotificationCancel(selectedNotification()!.id)
                }
              >
                {locale() === 'ru' ? 'Отменить напоминание' : 'Cancel notification'}
              </Button>
            </Show>
            <Button variant="ghost" onClick={() => setNotificationEditorOpen(false)}>
              {copy().showLessAction}
            </Button>
            <Button
              variant="primary"
              loading={savingNotification()}
              disabled={
                !notificationScheduleDraft().trim() ||
                (notificationDeliveryModeDraft() === 'dm_selected' &&
                  notificationRecipientsDraft().length === 0)
              }
              onClick={() => void handleNotificationSave()}
            >
              {locale() === 'ru' ? 'Сохранить' : 'Save'}
            </Button>
          </>
        }
      >
        <div style={{ display: 'grid', gap: '16px' }}>
          <Field label={locale() === 'ru' ? 'Когда' : 'When'}>
            <Input
              type="datetime-local"
              value={notificationScheduleDraft()}
              onInput={(event) => setNotificationScheduleDraft(event.currentTarget.value)}
            />
          </Field>

          <Field label={locale() === 'ru' ? 'Куда отправлять' : 'Delivery'}>
            <div style={{ display: 'flex', gap: '8px', 'flex-wrap': 'wrap' }}>
              <Button
                variant={notificationDeliveryModeDraft() === 'topic' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setNotificationDeliveryModeDraft('topic')}
              >
                {locale() === 'ru' ? 'В топик' : 'Topic'}
              </Button>
              <Button
                variant={notificationDeliveryModeDraft() === 'dm_all' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setNotificationDeliveryModeDraft('dm_all')}
              >
                {locale() === 'ru' ? 'Всем в личку' : 'DM all'}
              </Button>
              <Button
                variant={
                  notificationDeliveryModeDraft() === 'dm_selected' ? 'primary' : 'secondary'
                }
                size="sm"
                onClick={() => setNotificationDeliveryModeDraft('dm_selected')}
              >
                {locale() === 'ru' ? 'Выбрать получателей' : 'Select recipients'}
              </Button>
            </div>
          </Field>

          <Show when={notificationDeliveryModeDraft() === 'dm_selected'}>
            <Field
              label={locale() === 'ru' ? 'Получатели' : 'Recipients'}
              hint={
                locale() === 'ru'
                  ? 'Выберите, кому отправить в личку.'
                  : 'Choose who should receive the DM.'
              }
            >
              <div style={{ display: 'flex', gap: '8px', 'flex-wrap': 'wrap' }}>
                <For each={activeHouseholdMembers()}>
                  {(member) => (
                    <Button
                      variant={
                        notificationRecipientsDraft().includes(member.memberId)
                          ? 'primary'
                          : 'secondary'
                      }
                      size="sm"
                      onClick={() => toggleNotificationRecipient(member.memberId)}
                    >
                      {member.displayName}
                    </Button>
                  )}
                </For>
              </div>
            </Field>
          </Show>
        </div>
      </Modal>

      {/* Quick Payment Modal */}
      <Modal
        open={quickPaymentOpen()}
        title={copy().quickPaymentTitle}
        description={(quickPaymentContext() === 'overdue'
          ? copy().quickPaymentOverdueBody
          : copy().quickPaymentCurrentBody
        ).replace(
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
            <CurrencyToggle
              value={(dashboard()?.currency as 'USD' | 'GEL') ?? 'GEL'}
              ariaLabel={copy().quickPaymentCurrencyLabel}
              disabled
            />
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
