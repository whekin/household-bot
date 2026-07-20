import type { FinanceDashboard, FinanceDashboardPaymentKindSummary } from '@household/application'
import type { Money } from '@household/domain'
import type { FinancePaymentKind } from '@household/ports'
import type { InlineKeyboardMarkup } from 'grammy/types'

import { escapeHtml } from './html'
import { getBotTranslations, type BotLocale } from './i18n'
import { formatUserFacingMoney } from './i18n/money'
import { buildUtilitiesReminderReplyMarkup } from './reminder-topic-utilities'
import { buildBotStartDeepLink } from './telegram-deep-links'

export type PaymentReminderKind = FinancePaymentKind
export type PaymentReminderViewMode = 'compact' | 'details' | 'confirm-close'
export type PaymentReminderDispatchKind = 'utilities' | 'rent_warning' | 'rent_due'

export const PAYMENT_REMINDER_PAID_CALLBACK_PREFIX = 'pr:p:'
export const PAYMENT_REMINDER_DETAILS_CALLBACK_PREFIX = 'pr:d:'
export const PAYMENT_REMINDER_CLOSE_CALLBACK_PREFIX = 'pr:c:'
export const PAYMENT_REMINDER_CONFIRM_CLOSE_CALLBACK_PREFIX = 'pr:cc:'

export interface PaymentReminderMessageContent {
  text: string
  parseMode: 'HTML'
  replyMarkup?: InlineKeyboardMarkup
}

export interface PaymentReminderContentInput {
  locale: BotLocale
  kind: PaymentReminderKind
  dispatchKind: PaymentReminderDispatchKind
  period: string
  dashboard: FinanceDashboard
  viewMode: PaymentReminderViewMode
  botUsername?: string
  miniAppUrl?: string
}

export type PaymentReminderRenderSurface =
  | 'billing-reminder-prompt'
  | 'payment-instruction'
  | 'scheduled-reminder'

type PaymentReminderRenderInput = PaymentReminderContentInput & {
  surface: PaymentReminderRenderSurface
}

function moneyText(amount: Money): string {
  return formatUserFacingMoney(amount.toMajorString(), amount.currency)
}

export function formatBillingMonth(locale: BotLocale, period: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period)
  if (!match) {
    return period
  }

  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(monthIndex) ||
    monthIndex < 0 ||
    monthIndex > 11
  ) {
    return period
  }

  return new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(Date.UTC(year, monthIndex, 1)))
}

function formatDueDate(locale: BotLocale, dueDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueDate)
  if (!match) {
    return dueDate
  }

  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  const day = Number(match[3])
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(monthIndex) ||
    !Number.isInteger(day) ||
    monthIndex < 0 ||
    monthIndex > 11 ||
    day < 1 ||
    day > 31
  ) {
    return dueDate
  }

  return new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-US', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC'
  }).format(new Date(Date.UTC(year, monthIndex, day)))
}

function paymentKindSummary(
  dashboard: FinanceDashboard,
  period: string,
  kind: PaymentReminderKind
): FinanceDashboardPaymentKindSummary | null {
  return (
    dashboard.paymentPeriods
      ?.find((summary) => summary.period === period)
      ?.kinds.find((summary) => summary.kind === kind) ?? null
  )
}

function rentDestinationLines(dashboard: FinanceDashboard, locale: BotLocale): string[] {
  const destinations =
    dashboard.rentBillingState.paymentDestinations ?? dashboard.rentPaymentDestinations ?? []
  if (destinations.length === 0) {
    return [`• ${escapeHtml(getBotTranslations(locale).reminders.noRentDestinations)}`]
  }

  return destinations.flatMap((destination) => {
    const title = [destination.bankName, destination.label]
      .filter((value): value is string => Boolean(value))
      .join(' · ')

    return [
      `🏦 <b>${escapeHtml(title)}</b>`,
      ...(destination.recipientName
        ? [
            `${escapeHtml(locale === 'ru' ? 'Получатель' : 'Recipient')}: ${escapeHtml(destination.recipientName)}`
          ]
        : []),
      `${escapeHtml(locale === 'ru' ? 'Счёт' : 'Account')}: <code>${escapeHtml(destination.account)}</code>`,
      ...(destination.note ? [escapeHtml(destination.note)] : []),
      ...(destination.link ? [escapeHtml(destination.link)] : [])
    ]
  })
}

function rentMemberAmountLines(dashboard: FinanceDashboard, locale: BotLocale): string[] {
  return dashboard.rentBillingState.memberSummaries.map((member) => {
    return member.remaining.amountMinor > 0n
      ? `👤 <b>${escapeHtml(member.displayName)}</b> — ${escapeHtml(moneyText(member.remaining))}`
      : `✅ <b>${escapeHtml(member.displayName)}</b> — ${escapeHtml(
          locale === 'ru' ? 'оплачено' : 'paid'
        )}`
  })
}

// Group utility obligations by member so everyone finds their own block once,
// instead of scanning a flat per-bill list to spot the lines that are theirs.
function utilitiesByMemberLines(input: {
  dashboard: FinanceDashboard
  locale: BotLocale
  period: string
}): string[] {
  const t = getBotTranslations(input.locale).reminders
  const summary = paymentKindSummary(input.dashboard, input.period, 'utilities')
  const categories = input.dashboard.utilityBillingPlan?.categories ?? []
  const unresolvedById = new Map(
    (summary?.unresolvedMembers ?? []).map((member) => [member.memberId, member])
  )

  const categoriesByMember = new Map<string, (typeof categories)[number][]>()
  for (const category of categories) {
    categoriesByMember.set(category.assignedMemberId, [
      ...(categoriesByMember.get(category.assignedMemberId) ?? []),
      category
    ])
  }

  // Unresolved members first (in summary order), then any remaining assignees.
  const orderedMemberIds: string[] = []
  const nameById = new Map<string, string>()
  for (const member of summary?.unresolvedMembers ?? []) {
    orderedMemberIds.push(member.memberId)
    nameById.set(member.memberId, member.displayName)
  }
  for (const category of categories) {
    if (!orderedMemberIds.includes(category.assignedMemberId)) {
      orderedMemberIds.push(category.assignedMemberId)
      nameById.set(category.assignedMemberId, category.assignedDisplayName)
    }
  }

  if (orderedMemberIds.length === 0) {
    return ['• ' + escapeHtml(t.noUtilityPlan)]
  }

  const lines: string[] = []
  for (const memberId of orderedMemberIds) {
    const memberCategories = categoriesByMember.get(memberId) ?? []
    const unresolved = unresolvedById.get(memberId)
    const emoji = unresolved ? '🔴' : '✅'
    const displayName = nameById.get(memberId) ?? memberId
    const total =
      unresolved?.suggestedAmount ??
      memberCategories
        .slice(1)
        .reduce(
          (sum, category) => sum.add(category.assignedAmount),
          memberCategories[0]!.assignedAmount
        )
    lines.push(`${emoji} <b>${escapeHtml(displayName)}</b> — ${escapeHtml(moneyText(total))}`)
    for (const category of memberCategories) {
      const billPaid = category.paidAmount.amountMinor >= category.assignedAmount.amountMinor
      lines.push(
        `${billPaid ? '   ✅' : '   •'} ${escapeHtml(category.billName)} · ${escapeHtml(moneyText(category.assignedAmount))}`
      )
    }
  }

  return lines
}

function totalRemainingText(summary: FinanceDashboardPaymentKindSummary | null): string {
  return summary ? moneyText(summary.totalRemaining) : '0.00'
}

function buildKeyboard(input: PaymentReminderRenderInput): InlineKeyboardMarkup {
  const t = getBotTranslations(input.locale).reminders
  const summary = paymentKindSummary(input.dashboard, input.period, input.kind)
  const fullyPaid = !summary || summary.totalRemaining.amountMinor <= 0n
  const dashboardUrl = buildBotStartDeepLink(input.botUsername, 'dashboard')
  const detailMode = input.viewMode === 'details' ? 'compact' : 'details'
  const rows: InlineKeyboardMarkup['inline_keyboard'] = []

  if (input.kind === 'rent' && input.viewMode !== 'confirm-close') {
    const destinations =
      input.dashboard.rentBillingState.paymentDestinations ??
      input.dashboard.rentPaymentDestinations ??
      []
    for (const destination of destinations) {
      if (destination.account.length === 0 || destination.account.length > 256) {
        continue
      }
      rows.push([
        {
          text:
            input.locale === 'ru'
              ? `📋 Скопировать счёт · ${(destination.bankName ?? destination.label).slice(0, 40)}`
              : `📋 Copy account · ${(destination.bankName ?? destination.label).slice(0, 40)}`,
          copy_text: { text: destination.account }
        }
      ])
    }
  }

  if (!fullyPaid && input.viewMode !== 'confirm-close') {
    rows.push([
      {
        text: input.kind === 'utilities' ? t.paidUtilitiesButton : t.paidButton,
        callback_data: `${PAYMENT_REMINDER_PAID_CALLBACK_PREFIX}${input.kind}:${input.period}`
      }
    ])
  }

  if (input.viewMode === 'confirm-close') {
    rows.push([
      {
        text: t.confirmCloseButton,
        callback_data: `${PAYMENT_REMINDER_CONFIRM_CLOSE_CALLBACK_PREFIX}${input.kind}:${input.period}`
      },
      {
        text: t.cancelButton,
        callback_data: `${PAYMENT_REMINDER_DETAILS_CALLBACK_PREFIX}${input.kind}:${input.period}:compact`
      }
    ])
  } else {
    rows.push([
      {
        text: input.viewMode === 'details' ? t.hideDetailsButton : t.detailsButton,
        callback_data: `${PAYMENT_REMINDER_DETAILS_CALLBACK_PREFIX}${input.kind}:${input.period}:${detailMode}`
      },
      ...(!fullyPaid
        ? [
            {
              text: t.closeUnpaidButton,
              callback_data: `${PAYMENT_REMINDER_CLOSE_CALLBACK_PREFIX}${input.kind}:${input.period}`
            }
          ]
        : [])
    ])
  }

  if (
    input.kind === 'utilities' &&
    input.viewMode !== 'confirm-close' &&
    input.surface === 'billing-reminder-prompt'
  ) {
    rows.push(
      ...buildUtilitiesReminderReplyMarkup(input.locale, {
        ...(input.miniAppUrl ? { miniAppUrl: input.miniAppUrl } : {}),
        ...(input.botUsername ? { botUsername: input.botUsername } : {}),
        period: input.period
      }).inline_keyboard.slice(0, 1)
    )
  }

  if (dashboardUrl) {
    rows.push([{ text: t.openDashboardButton, url: dashboardUrl }])
  }

  return { inline_keyboard: rows }
}

export function buildPaymentReminderMessageContentForSurface(
  input: PaymentReminderRenderInput
): PaymentReminderMessageContent {
  const t = getBotTranslations(input.locale).reminders
  const month = formatBillingMonth(input.locale, input.period)
  const summary = paymentKindSummary(input.dashboard, input.period, input.kind)
  const fullyPaid = !summary || summary.totalRemaining.amountMinor <= 0n
  const title =
    input.kind === 'rent'
      ? `🏠 <b>${escapeHtml(input.locale === 'ru' ? 'Аренда' : 'Rent')} · ${escapeHtml(month)}</b>`
      : `💡 <b>${escapeHtml(input.locale === 'ru' ? 'Коммуналка к оплате' : 'Utilities due')}</b>`
  const dueDate =
    input.kind === 'rent'
      ? formatDueDate(input.locale, input.dashboard.rentBillingState.dueDate)
      : input.dashboard.utilityBillingPlan
        ? formatDueDate(input.locale, input.dashboard.utilityBillingPlan.dueDate)
        : month
  const lines =
    input.kind === 'rent'
      ? [
          title,
          `📅 ${escapeHtml(input.locale === 'ru' ? 'Оплатить до' : 'Pay by')} ${escapeHtml(dueDate)}`
        ]
      : [
          title,
          `📅 ${escapeHtml(month)} · ${escapeHtml(input.locale === 'ru' ? 'срок' : 'due')} ${escapeHtml(dueDate)}`
        ]

  if (fullyPaid) {
    lines.push('', `✅ <b>${escapeHtml(t.fullyPaid(input.kind, month))}</b>`)
  } else if (input.kind === 'utilities') {
    lines.push(
      '',
      `💰 <b>${escapeHtml(input.locale === 'ru' ? 'Осталось' : 'Remaining')}:</b> ${escapeHtml(totalRemainingText(summary))}`
    )

    // One block per member: name + total, then their bills underneath.
    lines.push(
      '',
      `<b>${escapeHtml(input.locale === 'ru' ? 'Кто сколько платит' : 'Who pays what')}</b>`,
      ...utilitiesByMemberLines({
        dashboard: input.dashboard,
        locale: input.locale,
        period: input.period
      })
    )
  }

  if (input.kind === 'rent') {
    lines.push(
      '',
      `<b>${escapeHtml(input.locale === 'ru' ? 'К оплате' : 'Amount due')}</b>`,
      ...rentMemberAmountLines(input.dashboard, input.locale),
      '',
      `<b>${escapeHtml(input.locale === 'ru' ? 'Куда переводить' : 'Where to pay')}</b>`,
      ...rentDestinationLines(input.dashboard, input.locale)
    )
  }

  if (input.viewMode === 'confirm-close') {
    const unresolvedCount = summary?.unresolvedMembers.length ?? 0
    lines.push(
      '',
      `⚠️ <b>${escapeHtml(input.locale === 'ru' ? 'Подтвердите закрытие' : 'Confirm close')}</b>`,
      escapeHtml(
        input.locale === 'ru'
          ? `${month}, ${input.kind === 'rent' ? 'аренда' : 'коммуналка'}: неоплаченных ${unresolvedCount}.`
          : `${month}, ${input.kind}: ${unresolvedCount} unpaid.`
      )
    )
  }

  return {
    text: lines.join('\n'),
    parseMode: 'HTML',
    replyMarkup: buildKeyboard(input)
  }
}

export function buildScheduledPaymentReminderContent(
  input: PaymentReminderContentInput
): PaymentReminderMessageContent {
  return buildPaymentReminderMessageContentForSurface({
    ...input,
    surface: 'scheduled-reminder'
  })
}
