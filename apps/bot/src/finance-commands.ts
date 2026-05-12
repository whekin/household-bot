import type {
  FinanceCommandService,
  HouseholdAuditNotificationService
} from '@household/application'
import { Money, nowInstant } from '@household/domain'
import type {
  HouseholdBillingSettingsRecord,
  HouseholdConfigurationRepository,
  TelegramPendingActionRepository
} from '@household/ports'
import { InputFile, type Bot, type Context } from 'grammy'

import { getBotTranslations, type BotLocale } from './i18n'
import { formatUserFacingMoney } from './i18n/money'
import { resolveReplyLocale } from './bot-locale'
import {
  buildTemplateText,
  REMINDER_UTILITY_ACTION,
  REMINDER_UTILITY_ACTION_TTL_MS
} from './reminder-topic-utilities'
import {
  TELEGRAM_HOME_BALANCES_CALLBACK,
  TELEGRAM_HOME_MY_BILL_CALLBACK,
  TELEGRAM_HOME_STATUS_CALLBACK
} from './home-menu'

type FinanceDashboardForBot = NonNullable<
  Awaited<ReturnType<FinanceCommandService['generateDashboard']>>
>

const BILL_SHOW_CALLBACK_PREFIX = 'bill:show:'
const BILL_RESOLVE_CALLBACK_PREFIX = 'bill:resolve:'
const BILL_JSON_CALLBACK_PREFIX = 'bill:json:'
const STATUS_SHOW_CALLBACK_PREFIX = 'status:show:'
const STATUS_DETAILS_CALLBACK_PREFIX = 'status:details:'
const STATUS_BALANCES_CALLBACK_PREFIX = 'status:balances:'
const HOME_BALANCE_SHOW_CALLBACK_PREFIX = 'home:bal:'
const BILL_SHOW_PENDING_ACTION = 'bill_command'
const BILL_PENDING_ACTION_TTL_MS = 1000 * 60 * 60
export const ASSISTANT_COMMAND_ACTION = 'assistant_command_suggestion'
export const ASSISTANT_COMMAND_RUN_CALLBACK_PREFIX = 'assistant_command:run:'
export const ASSISTANT_COMMAND_CANCEL_CALLBACK_PREFIX = 'assistant_command:cancel:'

function commandArgs(ctx: Context): string[] {
  const raw = typeof ctx.match === 'string' ? ctx.match.trim() : ''
  if (raw.length === 0) {
    return []
  }

  return raw.split(/\s+/).filter(Boolean)
}

function formatBillingPeriodLabel(
  locale: Parameters<typeof getBotTranslations>[0],
  period: string
): string {
  const [yearRaw, monthRaw] = period.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return period
  }

  const formatter = new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  })

  const formatted = formatter.format(new Date(Date.UTC(year, month - 1, 1)))

  return locale === 'ru' ? formatted.replace(/\s?г\.$/u, '') : formatted
}

function formatCycleDueDate(
  locale: Parameters<typeof getBotTranslations>[0],
  period: string,
  dueDay: number
): string {
  const [yearRaw, monthRaw] = period.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return period
  }

  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const day = Math.min(Math.max(dueDay, 1), maxDay)
  const formatter = new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-US', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC'
  })

  return formatter.format(new Date(Date.UTC(year, month - 1, day)))
}

function isGroupChat(ctx: Context): boolean {
  return ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup'
}

function isPrivateChat(ctx: Context): boolean {
  return ctx.chat?.type === 'private'
}

function parseBillMode(raw: string | undefined): 'utilities' | 'rent' | null {
  if (!raw) {
    return null
  }

  const normalized = raw.trim().toLowerCase()
  if (normalized === 'utilities' || normalized === 'utility') {
    return 'utilities'
  }
  if (normalized === 'rent') {
    return 'rent'
  }

  return null
}

function parseBillDetailMode(raw: string | undefined): 'compact' | 'full' | null {
  if (!raw) {
    return null
  }

  const normalized = raw.trim().toLowerCase()
  if (normalized === 'full' || normalized === 'details' || normalized === 'detail') {
    return 'full'
  }
  if (normalized === 'compact' || normalized === 'short') {
    return 'compact'
  }

  return null
}

function parseBillArgs(args: readonly string[]): {
  forcedMode: 'utilities' | 'rent' | null
  detailMode: 'compact' | 'full'
  hasInvalidArgs: boolean
} {
  let forcedMode: 'utilities' | 'rent' | null = null
  let detailMode: 'compact' | 'full' = 'compact'

  for (const arg of args) {
    const parsedMode = parseBillMode(arg)
    if (parsedMode) {
      forcedMode = parsedMode
      continue
    }

    const parsedDetailMode = parseBillDetailMode(arg)
    if (parsedDetailMode) {
      detailMode = parsedDetailMode
      continue
    }

    return {
      forcedMode: null,
      detailMode: 'compact',
      hasInvalidArgs: true
    }
  }

  return {
    forcedMode,
    detailMode,
    hasInvalidArgs: false
  }
}

function sortCurrentMemberFirst<T extends { memberId: string }>(
  items: readonly T[],
  currentMemberId?: string | null
): T[] {
  if (!currentMemberId) {
    return [...items]
  }

  return [...items].sort((left, right) => {
    if (left.memberId === currentMemberId && right.memberId !== currentMemberId) {
      return -1
    }
    if (right.memberId === currentMemberId && left.memberId !== currentMemberId) {
      return 1
    }

    return 0
  })
}

function formatAbsoluteDate(
  locale: Parameters<typeof getBotTranslations>[0],
  rawDate: string
): string {
  const [yearRaw, monthRaw, dayRaw] = rawDate.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  const day = Number(dayRaw)

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return rawDate
  }

  return new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-US', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC'
  }).format(new Date(Date.UTC(year, month - 1, day)))
}

function formatAbsoluteMoney(amount: Money, currency: 'USD' | 'GEL'): string {
  const absoluteMinor = amount.amountMinor < 0n ? -amount.amountMinor : amount.amountMinor
  return formatUserFacingMoney(
    Money.fromMinor(absoluteMinor, amount.currency).toMajorString(),
    currency
  )
}

function formatPurchaseBalanceLine(input: {
  locale: Parameters<typeof getBotTranslations>[0]
  amount: Money
  currency: 'USD' | 'GEL'
}): string | null {
  if (input.amount.amountMinor === 0n) {
    return null
  }

  const amountText = formatAbsoluteMoney(input.amount, input.currency)
  if (input.amount.amountMinor < 0n) {
    return input.locale === 'ru'
      ? `По покупкам в плюсе: ${amountText}`
      : `Purchase credit: ${amountText}`
  }

  return input.locale === 'ru'
    ? `По покупкам к доплате: ${amountText}`
    : `Purchase due: ${amountText}`
}

function formatRemainingCreditLine(input: {
  locale: Parameters<typeof getBotTranslations>[0]
  amount: Money
  currency: 'USD' | 'GEL'
}): string | null {
  if (input.amount.amountMinor === 0n) {
    return null
  }

  const amountText = formatAbsoluteMoney(input.amount, input.currency)
  if (input.amount.amountMinor < 0n) {
    return input.locale === 'ru'
      ? `В плюсе после коммуналки: ${amountText}`
      : `Credit after utilities: ${amountText}`
  }

  return input.locale === 'ru'
    ? `После коммуналки к доплате: ${amountText}`
    : `Due after utilities: ${amountText}`
}

function formatDashboardUtilityTotal(dashboard: FinanceDashboardForBot): Money {
  return dashboard.ledger
    .filter((entry) => entry.kind === 'utility')
    .reduce((sum, entry) => sum.add(entry.displayAmount), Money.zero(dashboard.currency))
}

function formatDashboardUtilityDueNow(dashboard: FinanceDashboardForBot): Money {
  return (
    dashboard.utilityBillingPlan?.memberSummaries.reduce(
      (sum, summary) => sum.add(summary.assignedThisCycle),
      Money.zero(dashboard.currency)
    ) ??
    dashboard.paymentPeriods
      ?.find((period) => period.isCurrentPeriod)
      ?.kinds.find((kind) => kind.kind === 'utilities')?.totalRemaining ??
    Money.zero(dashboard.currency)
  )
}

function formatDashboardRentDueNow(dashboard: FinanceDashboardForBot): Money {
  return dashboard.rentBillingState.memberSummaries.reduce(
    (sum, summary) => sum.add(summary.remaining),
    Money.zero(dashboard.currency)
  )
}

function formatHouseholdStageLine(
  locale: Parameters<typeof getBotTranslations>[0],
  dashboard: FinanceDashboardForBot
): string {
  if (dashboard.billingStage === 'utilities') {
    const dueDate =
      dashboard.utilityBillingPlan?.dueDate ??
      formatCycleDueDate(locale, dashboard.period, dashboard.utilitiesDueDay)
    return locale === 'ru'
      ? `💡 Сейчас: коммуналка · до ${formatAbsoluteDate(locale, dueDate)}`
      : `💡 Now: utilities · due ${formatAbsoluteDate(locale, dueDate)}`
  }

  if (dashboard.billingStage === 'rent') {
    const dueDate = dashboard.rentBillingState.dueDate
    return locale === 'ru'
      ? `🏡 Сейчас: аренда · до ${formatAbsoluteDate(locale, dueDate)}`
      : `🏡 Now: rent · due ${formatAbsoluteDate(locale, dueDate)}`
  }

  return locale === 'ru' ? '✅ Сейчас: активных оплат нет' : '✅ Now: no active payment window'
}

function formatHouseholdRentAmount(
  locale: Parameters<typeof getBotTranslations>[0],
  dashboard: FinanceDashboardForBot
): string {
  if (dashboard.rentSourceAmount.currency === dashboard.rentDisplayAmount.currency) {
    return formatUserFacingMoney(dashboard.rentDisplayAmount.toMajorString(), dashboard.currency)
  }

  return `${formatUserFacingMoney(
    dashboard.rentSourceAmount.toMajorString(),
    dashboard.rentSourceAmount.currency
  )} (~${formatUserFacingMoney(dashboard.rentDisplayAmount.toMajorString(), dashboard.currency)})`
}

function formatHouseholdRentOverviewLine(
  locale: Parameters<typeof getBotTranslations>[0],
  dashboard: FinanceDashboardForBot
): string {
  const remaining = formatDashboardRentDueNow(dashboard)
  return `🏡 ${locale === 'ru' ? 'Аренда' : 'Rent'}: ${formatHouseholdRentAmount(
    locale,
    dashboard
  )} · ${locale === 'ru' ? 'до' : 'due'} ${formatAbsoluteDate(
    locale,
    dashboard.rentBillingState.dueDate
  )} · ${locale === 'ru' ? 'осталось' : 'remaining'} ${formatUserFacingMoney(
    remaining.toMajorString(),
    dashboard.currency
  )}`
}

function formatHouseholdUtilityOverviewLine(
  locale: Parameters<typeof getBotTranslations>[0],
  dashboard: FinanceDashboardForBot
): string {
  const total = formatDashboardUtilityTotal(dashboard)
  const dueNow = formatDashboardUtilityDueNow(dashboard)
  const dueDate =
    dashboard.utilityBillingPlan?.dueDate ??
    formatCycleDueDate(locale, dashboard.period, dashboard.utilitiesDueDay)

  return `💡 ${locale === 'ru' ? 'Коммуналка' : 'Utilities'}: ${formatUserFacingMoney(
    total.toMajorString(),
    dashboard.currency
  )} · ${locale === 'ru' ? 'до' : 'due'} ${formatAbsoluteDate(locale, dueDate)} · ${
    locale === 'ru' ? 'сейчас' : 'now'
  } ${formatUserFacingMoney(dueNow.toMajorString(), dashboard.currency)}`
}

function formatHouseholdStatusMemberValue(input: {
  locale: Parameters<typeof getBotTranslations>[0]
  amount: Money
  member: FinanceDashboardForBot['members'][number] | null
  paid?: Money
}): string {
  if (input.amount.amountMinor > 0n) {
    return formatUserFacingMoney(input.amount.toMajorString(), input.amount.currency)
  }

  const coveredByPurchaseCredit =
    input.member &&
    (input.paid?.amountMinor ?? 0n) === 0n &&
    input.member.purchaseOffset.amountMinor < 0n &&
    (input.member.utilityShare.amountMinor > 0n || input.member.rentShare.amountMinor > 0n)

  if (coveredByPurchaseCredit) {
    return input.locale === 'ru' ? 'закрыто плюсом' : 'covered by credit'
  }

  return input.locale === 'ru' ? 'закрыто' : 'settled'
}

function formatHouseholdStatusCounts(
  locale: Parameters<typeof getBotTranslations>[0],
  dashboard: FinanceDashboardForBot
): string {
  const counts = dashboard.members.reduce(
    (current, member) => {
      current[member.status ?? 'active'] += 1
      return current
    },
    { active: 0, away: 0, left: 0 }
  )
  const parts = [
    counts.active > 0 ? `${counts.active} ${locale === 'ru' ? 'активн.' : 'active'}` : null,
    counts.away > 0 ? `${counts.away} ${locale === 'ru' ? 'в отъезде' : 'away'}` : null,
    counts.left > 0 ? `${counts.left} ${locale === 'ru' ? 'вышли' : 'left'}` : null
  ].filter(Boolean)

  return parts.join(' · ')
}

function formatHouseholdMemberStatusLabel(
  locale: Parameters<typeof getBotTranslations>[0],
  status: FinanceDashboardForBot['members'][number]['status']
): string | null {
  if (!status || status === 'active') {
    return null
  }

  if (status === 'away') {
    return locale === 'ru' ? 'в отъезде' : 'away'
  }

  return locale === 'ru' ? 'вышел' : 'left'
}

function formatHouseholdStatusMemberLines(
  locale: Parameters<typeof getBotTranslations>[0],
  dashboard: FinanceDashboardForBot
): string[] {
  const visibleMembers = [...dashboard.members]
    .sort((left, right) => {
      const amountDelta = right.remaining.amountMinor - left.remaining.amountMinor
      if (amountDelta !== 0n) {
        return amountDelta > 0n ? 1 : -1
      }
      return left.displayName.localeCompare(right.displayName)
    })
    .slice(0, 6)
  return visibleMembers.map((member) => {
    const statusLabel = formatHouseholdMemberStatusLabel(locale, member.status)
    const value = formatHouseholdStatusMemberValue({
      locale,
      amount: member.remaining,
      member,
      paid: member.paid
    })
    return `  • ${member.displayName}${statusLabel ? ` (${statusLabel})` : ''}: ${value}`
  })
}

function formatHouseholdPurchasePolicyLine(
  locale: Parameters<typeof getBotTranslations>[0],
  dashboard: FinanceDashboardForBot
): string | null {
  if (dashboard.members.every((member) => member.purchaseOffset.amountMinor === 0n)) {
    return null
  }

  if (dashboard.paymentBalanceAdjustmentPolicy === 'utilities') {
    return locale === 'ru' ? '🛒 Покупки → коммуналка' : '🛒 Purchases → utilities'
  }

  if (dashboard.paymentBalanceAdjustmentPolicy === 'rent') {
    return locale === 'ru' ? '🛒 Покупки → аренда' : '🛒 Purchases → rent'
  }

  return locale === 'ru' ? '🛒 Покупки отдельно' : '🛒 Purchases separate'
}

function truncateStatusTitle(title: string): string {
  return title.length > 34 ? `${title.slice(0, 31).trim()}…` : title
}

function formatHouseholdActivityDate(
  locale: Parameters<typeof getBotTranslations>[0],
  occurredAt: string | null
): string {
  if (!occurredAt) {
    return locale === 'ru' ? 'без даты' : 'no date'
  }

  const instant = new Date(occurredAt)
  if (Number.isNaN(instant.getTime())) {
    return occurredAt
  }

  return new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-US', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC'
  }).format(instant)
}

function formatHouseholdActivityLines(
  locale: Parameters<typeof getBotTranslations>[0],
  dashboard: FinanceDashboardForBot,
  kind: 'purchase' | 'payment'
): string[] {
  return dashboard.ledger
    .filter((entry) => entry.kind === kind)
    .sort((left, right) => (right.occurredAt ?? '').localeCompare(left.occurredAt ?? ''))
    .slice(0, 2)
    .map((entry) => {
      const title =
        kind === 'payment'
          ? entry.paymentKind === 'rent'
            ? locale === 'ru'
              ? 'аренда'
              : 'rent'
            : locale === 'ru'
              ? 'коммуналка'
              : 'utilities'
          : truncateStatusTitle(entry.title)
      const actor = entry.actorDisplayName ? ` · ${entry.actorDisplayName}` : ''
      return `  • ${formatHouseholdActivityDate(locale, entry.occurredAt)}${actor}: ${title} · ${formatUserFacingMoney(entry.displayAmount.toMajorString(), entry.displayCurrency)}`
    })
}

function formatPurchaseDriverLine(input: {
  locale: Parameters<typeof getBotTranslations>[0]
  currency: 'USD' | 'GEL'
  driver: {
    title: string
    amount: Money
    direction: 'credit' | 'debit'
  }
}): string {
  const sign = input.driver.direction === 'credit' ? '-' : '+'
  return `${input.driver.title} ${sign}${formatUserFacingMoney(input.driver.amount.toMajorString(), input.currency)}`
}

function formatUtilityAssignmentLine(input: {
  locale: Parameters<typeof getBotTranslations>[0]
  currency: 'USD' | 'GEL'
  category: {
    billName: string
    billTotal: Money
    assignedAmount: Money
    paidAmount: Money
    isFullAssignment: boolean
  }
  details?: {
    providerName: string | null
    customerNumber: string | null
    paymentLink: string | null
    note: string | null
  }
}): string {
  const amountText = formatUserFacingMoney(
    input.category.assignedAmount.toMajorString(),
    input.currency
  )
  const line = input.category.isFullAssignment
    ? `${input.category.billName} — ${amountText}`
    : `${input.category.billName} — ${amountText} ${
        input.locale === 'ru' ? 'из' : 'of'
      } ${formatUserFacingMoney(input.category.billTotal.toMajorString(), input.currency)}`

  const detailLines = [
    input.category.paidAmount.amountMinor > 0n
      ? `${input.locale === 'ru' ? 'уже оплачено' : 'already paid'}: ${formatUserFacingMoney(input.category.paidAmount.toMajorString(), input.currency)}`
      : null,
    input.details?.providerName
      ? `${input.locale === 'ru' ? 'провайдер' : 'provider'}: ${input.details.providerName}`
      : null,
    input.details?.customerNumber
      ? `${input.locale === 'ru' ? 'счёт' : 'account'}: ${input.details.customerNumber}`
      : null,
    input.details?.paymentLink
      ? `${input.locale === 'ru' ? 'ссылка' : 'link'}: ${input.details.paymentLink}`
      : null,
    input.details?.note
      ? `${input.locale === 'ru' ? 'примечание' : 'note'}: ${input.details.note}`
      : null
  ].filter(Boolean)

  return detailLines.length > 0 ? `- ${line}\n  ${detailLines.join('\n  ')}` : `- ${line}`
}

function formatUtilityMemberBlock(input: {
  locale: Parameters<typeof getBotTranslations>[0]
  currency: 'USD' | 'GEL'
  displayName: string
  payNow: Money
  summary?: {
    fairShare: Money
    vendorPaid: Money
    assignedThisCycle: Money
  } | null
  balance?: {
    utilityShare: Money
    purchaseOffset: Money
    purchaseDrivers?: readonly {
      title: string
      amount: Money
      direction: 'credit' | 'debit'
    }[]
  } | null
  categories: readonly string[]
  viewerOnly: boolean
  detailMode: 'compact' | 'full'
}): string {
  const isFullyPaid =
    input.payNow.amountMinor === 0n && input.summary && input.summary.vendorPaid.amountMinor > 0n
  const isCoveredByBalance =
    input.payNow.amountMinor === 0n &&
    !isFullyPaid &&
    input.balance &&
    input.balance.utilityShare.amountMinor > 0n &&
    input.balance.purchaseOffset.amountMinor < 0n

  // Calculate remaining balance after this cycle
  const remainingBalance =
    input.balance && input.summary
      ? input.balance.purchaseOffset.add(input.balance.utilityShare)
      : null
  const purchaseBalanceLine =
    input.balance && input.summary
      ? formatPurchaseBalanceLine({
          locale: input.locale,
          amount: input.balance.purchaseOffset,
          currency: input.currency
        })
      : null

  const balanceLine =
    input.balance && input.summary
      ? `📊 ${[
          `${input.locale === 'ru' ? 'Доля' : 'Share'}: ${formatUserFacingMoney(input.balance.utilityShare.toMajorString(), input.currency)}`,
          purchaseBalanceLine,
          `${input.locale === 'ru' ? 'План' : 'Plan'}: ${formatUserFacingMoney(input.summary.fairShare.toMajorString(), input.currency)}`
        ]
          .filter(Boolean)
          .join(' · ')}`
      : null

  const lines = input.viewerOnly
    ? input.payNow.amountMinor === 0n
      ? [
          input.locale === 'ru'
            ? isFullyPaid
              ? 'Уже оплачено.'
              : isCoveredByBalance
                ? 'Закрыто твоим плюсом.'
                : 'В этом цикле платить не нужно.'
            : isFullyPaid
              ? 'Already paid.'
              : isCoveredByBalance
                ? 'Covered by your credit.'
                : 'Nothing to pay this cycle.'
        ]
      : [
          `${input.locale === 'ru' ? 'Осталось оплатить' : 'Remaining to pay'}: ${formatUserFacingMoney(input.payNow.toMajorString(), input.currency)}`
        ]
    : [
        input.displayName,
        ...(balanceLine ? [balanceLine] : []),
        input.payNow.amountMinor === 0n
          ? input.locale === 'ru'
            ? isFullyPaid
              ? 'Уже оплачено.'
              : isCoveredByBalance
                ? 'Закрыто твоим плюсом.'
                : 'Платить не нужно.'
            : isFullyPaid
              ? 'Already paid.'
              : isCoveredByBalance
                ? 'Covered by your credit.'
                : 'Nothing to pay.'
          : `${input.locale === 'ru' ? 'Осталось оплатить' : 'Remaining to pay'}: ${formatUserFacingMoney(input.payNow.toMajorString(), input.currency)}`
      ]

  if (input.viewerOnly && balanceLine) {
    lines.unshift(balanceLine)
  }

  if (isCoveredByBalance && remainingBalance && input.detailMode === 'full') {
    const remainingCreditLine = formatRemainingCreditLine({
      locale: input.locale,
      amount: remainingBalance,
      currency: input.currency
    })
    if (remainingCreditLine) {
      lines.push(`💳 ${remainingCreditLine}`)
    }
  }

  const purchaseDrivers = input.balance?.purchaseDrivers ?? []
  if (purchaseDrivers.length > 0 && input.detailMode === 'full') {
    const sortedDrivers = [...purchaseDrivers].sort((left, right) => {
      const amountComparison = right.amount.compare(left.amount)
      if (amountComparison !== 0) {
        return amountComparison
      }

      return left.title.localeCompare(right.title)
    })
    const visibleDrivers = sortedDrivers
    const overflowCount = sortedDrivers.length - visibleDrivers.length
    lines.push(
      `${input.locale === 'ru' ? 'Покупки' : 'Purchases'}: ${[
        ...visibleDrivers.map((driver) =>
          formatPurchaseDriverLine({
            locale: input.locale,
            currency: input.currency,
            driver
          })
        ),
        ...(overflowCount > 0 ? [`${input.locale === 'ru' ? 'ещё' : 'plus'} ${overflowCount}`] : [])
      ].join('; ')}`
    )
  }

  if (input.payNow.amountMinor > 0n && input.categories.length > 0) {
    lines.push(...input.categories)
  } else if (input.payNow.amountMinor > 0n) {
    lines.push(
      input.locale === 'ru'
        ? 'В этом цикле по коммуналке платить не нужно.'
        : 'No utility payment this cycle.'
    )
  }

  return lines.join('\n')
}

function formatRentDestinationLines(input: {
  locale: Parameters<typeof getBotTranslations>[0]
  destinations: readonly {
    label: string
    recipientName: string | null
    bankName: string | null
    account: string
    note: string | null
    link: string | null
  }[]
}): readonly string[] {
  return input.destinations.flatMap((destination) => {
    const detailLines = [
      destination.recipientName
        ? `${input.locale === 'ru' ? 'получатель' : 'recipient'}: ${destination.recipientName}`
        : null,
      destination.bankName
        ? `${input.locale === 'ru' ? 'банк' : 'bank'}: ${destination.bankName}`
        : null,
      `${input.locale === 'ru' ? 'счёт' : 'account'}: ${destination.account}`,
      destination.link ? `${input.locale === 'ru' ? 'ссылка' : 'link'}: ${destination.link}` : null,
      destination.note
        ? `${input.locale === 'ru' ? 'примечание' : 'note'}: ${destination.note}`
        : null
    ].filter(Boolean)

    return detailLines.length > 0
      ? [`- ${destination.label}`, `  ${detailLines.join('\n  ')}`]
      : [`- ${destination.label}`]
  })
}

function formatRentDestinationSection(input: {
  locale: Parameters<typeof getBotTranslations>[0]
  destinations: readonly {
    label: string
    recipientName: string | null
    bankName: string | null
    account: string
    note: string | null
    link: string | null
  }[]
}): string[] {
  if (input.destinations.length === 0) {
    return []
  }

  return [
    input.locale === 'ru' ? 'Реквизиты для оплаты:' : 'Payment details:',
    ...formatRentDestinationLines(input)
  ]
}

export function createFinanceCommandsService(options: {
  householdConfigurationRepository: HouseholdConfigurationRepository
  financeServiceForHousehold: (householdId: string) => FinanceCommandService
  promptRepository?: TelegramPendingActionRepository
  miniAppUrl?: string
  botUsername?: string
  auditNotificationService?: HouseholdAuditNotificationService
}): {
  register: (bot: Bot) => void
} {
  async function storeBillPendingAction(input: { ctx: Context; payload: Record<string, unknown> }) {
    if (!options.promptRepository || !input.ctx.from?.id || !input.ctx.chat?.id) {
      return
    }

    await options.promptRepository.upsertPendingAction({
      telegramUserId: input.ctx.from.id.toString(),
      telegramChatId: input.ctx.chat.id.toString(),
      action: BILL_SHOW_PENDING_ACTION,
      payload: input.payload,
      expiresAt: nowInstant().add({ milliseconds: BILL_PENDING_ACTION_TTL_MS })
    })
  }

  async function getBillPendingAction(ctx: Context) {
    if (!options.promptRepository || !ctx.from?.id || !ctx.chat?.id) {
      return null
    }

    const action = await options.promptRepository.getPendingAction(
      ctx.chat.id.toString(),
      ctx.from.id.toString()
    )
    if (!action || action.action !== BILL_SHOW_PENDING_ACTION) {
      return null
    }

    return action
  }

  function formatStatement(
    locale: Parameters<typeof getBotTranslations>[0],
    dashboard: NonNullable<Awaited<ReturnType<FinanceCommandService['generateDashboard']>>>
  ): string {
    const t = getBotTranslations(locale).finance

    return [
      t.statementTitle(dashboard.period),
      ...dashboard.members.map((line) =>
        t.statementLine(line.displayName, line.netDue.toMajorString(), dashboard.currency)
      ),
      t.statementTotal(dashboard.totalDue.toMajorString(), dashboard.currency)
    ].join('\n')
  }

  function formatBalances(
    locale: Parameters<typeof getBotTranslations>[0],
    dashboard: NonNullable<Awaited<ReturnType<FinanceCommandService['generateDashboard']>>>
  ): string {
    const purchases = dashboard.ledger.filter(
      (entry) => entry.kind === 'purchase' && entry.resolutionStatus === 'unresolved'
    )

    const memberBalances = dashboard.members
      .map((member) => {
        const memberPurchases = purchases.filter(
          (purchase) => purchase.payerMemberId === member.memberId
        )
        const balanceLine = formatPurchaseBalanceLine({
          locale,
          amount: member.purchaseOffset,
          currency: dashboard.currency
        })

        const purchaseLines = memberPurchases.map((purchase) => {
          const amountText = `-${formatUserFacingMoney(
            purchase.displayAmount.toMajorString(),
            dashboard.currency
          )}`

          let participantsText = ''
          if (purchase.purchaseParticipants) {
            const includedParticipants = purchase.purchaseParticipants.filter((p) => p.included)
            if (includedParticipants.length === dashboard.members.length) {
              participantsText = ' 👥'
            } else {
              const initials = includedParticipants
                .map((p) => {
                  const participantMember = dashboard.members.find((m) => m.memberId === p.memberId)
                  return participantMember?.displayName.charAt(0) || '?'
                })
                .join(', ')
              participantsText = ` (${initials})`
            }
          }

          return `  • ${purchase.title}: ${amountText}${participantsText}`
        })

        if (!balanceLine && purchaseLines.length === 0) {
          return null
        }

        return [
          `👤 ${member.displayName}${balanceLine ? ` · ${balanceLine.toLocaleLowerCase(locale === 'ru' ? 'ru-RU' : 'en-US')}` : ''}`,
          ...purchaseLines
        ].join('\n')
      })
      .filter((block): block is string => block !== null)

    return [
      `🛒 ${locale === 'ru' ? 'Покупки' : 'Purchases'} · ${formatBillingPeriodLabel(locale, dashboard.period)}`,
      '',
      ...memberBalances.flatMap((block, index) =>
        index < memberBalances.length - 1 ? [block, ''] : [block]
      )
    ].join('\n')
  }

  async function replyWithBalances(input: {
    ctx: Context
    locale: BotLocale
    service: FinanceCommandService
    periodArg?: string
  }) {
    const t = getBotTranslations(input.locale).finance
    const dashboard = await input.service.generateDashboard(input.periodArg)
    if (!dashboard) {
      await input.ctx.reply(t.noStatementCycle)
      return
    }

    await input.ctx.reply(formatBalances(input.locale, dashboard))
  }

  async function replyWithRequestedBalances(input: { ctx: Context; locale: BotLocale }) {
    const t = getBotTranslations(input.locale).finance
    const telegramUserId = input.ctx.from?.id?.toString()
    if (!telegramUserId) {
      await input.ctx.reply(t.unableToIdentifySender)
      return
    }

    if (isGroupChat(input.ctx)) {
      const resolved = await requireMember(input.ctx)
      if (!resolved) {
        return
      }

      await replyWithBalances({
        ctx: input.ctx,
        locale: input.locale,
        service: resolved.service
      })
      return
    }

    const memberships =
      await options.householdConfigurationRepository.listHouseholdMembersByTelegramUserId(
        telegramUserId
      )
    if (memberships.length === 0) {
      await input.ctx.reply(t.notMember)
      return
    }

    if (memberships.length === 1) {
      await replyWithBalances({
        ctx: input.ctx,
        locale: input.locale,
        service: options.financeServiceForHousehold(memberships[0]!.householdId)
      })
      return
    }

    const households = await Promise.all(
      memberships.map(async (membership) => ({
        membership,
        household: await options.householdConfigurationRepository.getHouseholdChatByHouseholdId(
          membership.householdId
        )
      }))
    )
    await storeBillPendingAction({
      ctx: input.ctx,
      payload: {
        kind: 'balances_choose',
        choices: households.map(({ membership }) => ({
          householdId: membership.householdId,
          memberId: membership.id
        }))
      }
    })
    await input.ctx.reply(t.chooseHouseholdForBalances, {
      reply_markup: {
        inline_keyboard: households.map(({ membership, household }, index) => [
          {
            text: household?.householdName ?? membership.householdId,
            callback_data: `${HOME_BALANCE_SHOW_CALLBACK_PREFIX}${index}`
          }
        ])
      }
    })
  }

  function formatHouseholdStatus(
    locale: Parameters<typeof getBotTranslations>[0],
    dashboard: NonNullable<Awaited<ReturnType<FinanceCommandService['generateDashboard']>>>,
    householdName?: string | null
  ): string {
    const purchasePolicyLine = formatHouseholdPurchasePolicyLine(locale, dashboard)
    const purchaseLines = formatHouseholdActivityLines(locale, dashboard, 'purchase')
    const paymentLines = formatHouseholdActivityLines(locale, dashboard, 'payment')
    const memberLines = formatHouseholdStatusMemberLines(locale, dashboard)
    const hiddenMemberCount = Math.max(dashboard.members.length - memberLines.length, 0)

    return [
      `🏠 ${householdName ?? (locale === 'ru' ? 'Дом' : 'Household')} · ${formatBillingPeriodLabel(locale, dashboard.period)}`,
      formatHouseholdStageLine(locale, dashboard),
      '',
      formatHouseholdRentOverviewLine(locale, dashboard),
      formatHouseholdUtilityOverviewLine(locale, dashboard),
      dashboard.totalRemaining.amountMinor === 0n
        ? locale === 'ru'
          ? '📊 Итого: все закрыто'
          : '📊 Total: everything settled'
        : `📊 ${locale === 'ru' ? 'Итого осталось' : 'Total remaining'}: ${formatUserFacingMoney(
            dashboard.totalRemaining.toMajorString(),
            dashboard.currency
          )}`,
      ...(purchasePolicyLine ? [purchasePolicyLine] : []),
      ...(purchaseLines.length > 0 || paymentLines.length > 0
        ? [
            '',
            `🧾 ${locale === 'ru' ? 'Последнее' : 'Latest'}`,
            ...(purchaseLines.length > 0
              ? [`  ${locale === 'ru' ? 'Покупки' : 'Purchases'}:`, ...purchaseLines]
              : []),
            ...(paymentLines.length > 0
              ? [`  ${locale === 'ru' ? 'Оплаты' : 'Payments'}:`, ...paymentLines]
              : [])
          ]
        : []),
      '',
      `👥 ${locale === 'ru' ? 'Участники' : 'Members'}: ${formatHouseholdStatusCounts(locale, dashboard)}`,
      ...(memberLines.length > 0
        ? memberLines
        : [`  • ${locale === 'ru' ? 'Все закрыто' : 'Everything is settled'}`]),
      ...(hiddenMemberCount > 0
        ? [`  • ${locale === 'ru' ? 'ещё' : 'plus'} ${hiddenMemberCount}`]
        : [])
    ].join('\n')
  }

  async function resolveGroupFinanceService(ctx: Context): Promise<{
    service: FinanceCommandService
    householdId: string
    householdName: string | null
  } | null> {
    const locale = await resolveReplyLocale({
      ctx,
      repository: options.householdConfigurationRepository
    })
    const t = getBotTranslations(locale).finance
    if (!isGroupChat(ctx)) {
      await ctx.reply(t.useInGroup)
      return null
    }

    const household = await options.householdConfigurationRepository.getTelegramHouseholdChat(
      ctx.chat!.id.toString()
    )
    if (!household) {
      await ctx.reply(t.householdNotConfigured)
      return null
    }

    return {
      service: options.financeServiceForHousehold(household.householdId),
      householdId: household.householdId,
      householdName: household.householdName ?? household.title ?? household.householdId
    }
  }

  async function requireMember(ctx: Context) {
    const locale = await resolveReplyLocale({
      ctx,
      repository: options.householdConfigurationRepository
    })
    const t = getBotTranslations(locale).finance
    const telegramUserId = ctx.from?.id?.toString()
    if (!telegramUserId) {
      await ctx.reply(t.unableToIdentifySender)
      return null
    }

    const scoped = await resolveGroupFinanceService(ctx)
    if (!scoped) {
      return null
    }

    const member = await scoped.service.getMemberByTelegramUserId(telegramUserId)
    if (!member) {
      await ctx.reply(t.notMember)
      return null
    }

    return {
      member,
      service: scoped.service,
      householdId: scoped.householdId,
      householdName: scoped.householdName
    }
  }

  async function requireAdmin(ctx: Context) {
    const locale = await resolveReplyLocale({
      ctx,
      repository: options.householdConfigurationRepository
    })
    const t = getBotTranslations(locale).finance
    const resolved = await requireMember(ctx)
    if (!resolved) {
      return null
    }

    if (!resolved.member.isAdmin) {
      await ctx.reply(t.adminOnly)
      return null
    }

    return resolved
  }

  async function recordCommandAudit(input: {
    resolved: NonNullable<Awaited<ReturnType<typeof requireMember>>>
    category: 'period_events' | 'plan_events' | 'payment_events'
    eventType: string
    summaryText: string
    metadata?: Record<string, unknown>
  }) {
    if (!options.auditNotificationService) {
      return
    }

    await options.auditNotificationService.recordEvent({
      householdId: input.resolved.householdId,
      actorMemberId: input.resolved.member.id,
      actorDisplayName: input.resolved.member.displayName,
      eventType: input.eventType,
      category: input.category,
      summaryText: input.summaryText,
      metadata: input.metadata ?? {}
    })
  }

  function formatUtilityBillPlan(input: {
    locale: Parameters<typeof getBotTranslations>[0]
    householdName?: string | null | undefined
    period: string
    plan: NonNullable<
      NonNullable<
        Awaited<ReturnType<FinanceCommandService['generateCurrentBillPlan']>>
      >['utilityBillingPlan']
    >
    currency: 'USD' | 'GEL'
    utilityCategories: readonly {
      name: string
      providerName: string | null
      customerNumber: string | null
      paymentLink: string | null
      note: string | null
    }[]
    viewerMemberId?: string | null
    orderMemberId?: string | null
    memberBalances?: readonly {
      memberId: string
      utilityShare: Money
      purchaseOffset: Money
      purchaseDrivers?: readonly {
        title: string
        amount: Money
        direction: 'credit' | 'debit'
      }[]
    }[]
    detailMode: 'compact' | 'full'
  }): string {
    const categoryDetailsByName = new Map(
      (input.utilityCategories ?? []).map((category) => [
        category.name.trim().toLowerCase(),
        category
      ])
    )
    const relevantSummaries = sortCurrentMemberFirst(
      input.viewerMemberId
        ? input.plan.memberSummaries.filter((summary) => summary.memberId === input.viewerMemberId)
        : input.plan.memberSummaries,
      input.orderMemberId ?? input.viewerMemberId
    )
    const relevantCategories = [...input.plan.categories]
      .filter((category) =>
        input.viewerMemberId ? category.assignedMemberId === input.viewerMemberId : true
      )
      .sort((left, right) => {
        if (
          input.orderMemberId &&
          left.assignedMemberId === input.orderMemberId &&
          right.assignedMemberId !== input.orderMemberId
        ) {
          return -1
        }
        if (
          input.orderMemberId &&
          right.assignedMemberId === input.orderMemberId &&
          left.assignedMemberId !== input.orderMemberId
        ) {
          return 1
        }

        if (left.assignedDisplayName !== right.assignedDisplayName) {
          return left.assignedDisplayName.localeCompare(right.assignedDisplayName)
        }

        return left.billName.localeCompare(right.billName)
      })
    const fallbackMemberIds = Array.from(
      new Set(relevantCategories.map((category) => category.assignedMemberId))
    )
    const memberIds =
      relevantSummaries.length > 0
        ? relevantSummaries.map((summary) => summary.memberId)
        : input.viewerMemberId
          ? [input.viewerMemberId]
          : fallbackMemberIds
    const memberEntries = memberIds.map((memberId) => {
      const summary = relevantSummaries.find((item) => item.memberId === memberId) ?? null
      const balance = input.memberBalances?.find((item) => item.memberId === memberId) ?? null
      const memberCategories = relevantCategories.filter(
        (category) => category.assignedMemberId === memberId
      )
      const payNow =
        summary?.assignedThisCycle ??
        memberCategories.reduce(
          (sum, category) => sum.add(category.assignedAmount),
          Money.zero(input.currency)
        )
      const displayName =
        summary?.displayName ?? memberCategories[0]?.assignedDisplayName ?? memberId

      return { memberId, summary, balance, memberCategories, payNow, displayName }
    })

    // Sort: unpaid members first, then paid members
    if (!input.viewerMemberId) {
      memberEntries.sort((a, b) => {
        const aPaid = a.payNow.amountMinor === 0n ? 1 : 0
        const bPaid = b.payNow.amountMinor === 0n ? 1 : 0
        return aPaid - bPaid
      })
    }

    const memberBlocks =
      memberEntries.length > 0
        ? memberEntries.map((entry) => {
            const isCoveredByBalance =
              entry.payNow.amountMinor === 0n &&
              entry.balance &&
              entry.balance.utilityShare.amountMinor > 0n &&
              entry.balance.purchaseOffset.amountMinor < 0n
            const remainingBalance =
              entry.balance && entry.summary
                ? entry.balance.purchaseOffset.add(entry.balance.utilityShare)
                : null
            const purchaseBalanceLine = entry.balance
              ? formatPurchaseBalanceLine({
                  locale: input.locale,
                  amount: entry.balance.purchaseOffset,
                  currency: input.currency
                })
              : null

            if (input.detailMode === 'compact') {
              if (entry.payNow.amountMinor === 0n) {
                const statusText = isCoveredByBalance
                  ? input.locale === 'ru'
                    ? 'Закрыто твоим плюсом'
                    : 'Covered by your credit'
                  : input.locale === 'ru'
                    ? 'Уже оплачено'
                    : 'Already paid'
                const remainingCreditLine =
                  isCoveredByBalance && remainingBalance
                    ? formatRemainingCreditLine({
                        locale: input.locale,
                        amount: remainingBalance,
                        currency: input.currency
                      })
                    : null

                return [
                  `👤 ${entry.displayName}`,
                  `  ✅ ${statusText}`,
                  ...(remainingCreditLine ? [`  • ${remainingCreditLine}`] : []),
                  ...(!isCoveredByBalance && purchaseBalanceLine
                    ? [`  • ${purchaseBalanceLine}`]
                    : [])
                ].join('\n')
              }

              return [
                `👤 ${entry.displayName}`,
                `  • ${input.locale === 'ru' ? 'К оплате' : 'To pay'}: ${formatUserFacingMoney(entry.payNow.toMajorString(), input.currency)}`,
                ...(purchaseBalanceLine ? [`  • ${purchaseBalanceLine}`] : [])
              ].join('\n')
            }

            return formatUtilityMemberBlock({
              locale: input.locale,
              currency: input.currency,
              displayName: entry.displayName,
              payNow: entry.payNow,
              summary: entry.summary,
              balance: entry.balance,
              detailMode: input.detailMode,
              categories:
                entry.payNow.amountMinor === 0n && !input.viewerMemberId
                  ? []
                  : entry.memberCategories.map((category) => {
                      const details = categoryDetailsByName.get(
                        category.billName.trim().toLowerCase()
                      )
                      return details
                        ? formatUtilityAssignmentLine({
                            locale: input.locale,
                            currency: input.currency,
                            category,
                            details
                          })
                        : formatUtilityAssignmentLine({
                            locale: input.locale,
                            currency: input.currency,
                            category
                          })
                    }),
              viewerOnly: Boolean(input.viewerMemberId)
            })
          })
        : [
            input.locale === 'ru'
              ? 'В этом цикле по коммуналке активных назначений нет.'
              : 'No active utility assignments for this cycle.'
          ]

    // Calculate base share per person
    const totalsByBillId = new Map<string, Money>()
    for (const category of input.plan.categories) {
      if (!totalsByBillId.has(category.utilityBillId)) {
        totalsByBillId.set(category.utilityBillId, category.billTotal)
      }
    }
    const totalBills = [...totalsByBillId.values()].reduce(
      (sum, amount) => sum.add(amount),
      Money.zero(input.currency)
    )
    const memberCount = input.plan.memberSummaries.length || 1
    const baseShare = Money.fromMajor(
      (Number(totalBills.toMajorString()) / memberCount).toFixed(2),
      input.currency
    )

    const memberSeparator = input.detailMode === 'compact' ? '\n\n' : '\n\n'

    if (input.detailMode === 'compact') {
      return [
        `💡 ${input.locale === 'ru' ? 'Коммуналка' : 'Utilities'} · ${formatBillingPeriodLabel(input.locale, input.period)}`,
        `📅 ${input.locale === 'ru' ? 'До' : 'Due'} ${formatAbsoluteDate(input.locale, input.plan.dueDate)} · ${
          input.locale === 'ru' ? 'доля' : 'share'
        } ${formatUserFacingMoney(baseShare.toMajorString(), input.currency)}`,
        `💰 ${input.locale === 'ru' ? 'Счета' : 'Bills'}: ${formatUserFacingMoney(totalBills.toMajorString(), input.currency)}`,
        '',
        memberBlocks.join(memberSeparator),
        '',
        `${input.locale === 'ru' ? 'Детали' : 'Details'}: /bill_full`
      ].join('\n')
    }

    return [
      `🔎 ${input.locale === 'ru' ? 'Детали коммуналки' : 'Utilities details'} · ${formatBillingPeriodLabel(input.locale, input.period)}`,
      `📅 ${input.locale === 'ru' ? 'До' : 'Due'} ${formatAbsoluteDate(input.locale, input.plan.dueDate)} · ${
        input.locale === 'ru' ? 'доля' : 'share'
      } ${formatUserFacingMoney(baseShare.toMajorString(), input.currency)}`,
      `💰 ${input.locale === 'ru' ? 'Счета' : 'Bills'}: ${formatUserFacingMoney(totalBills.toMajorString(), input.currency)}`,
      '',
      memberBlocks.join(memberSeparator),
      '',
      `${input.locale === 'ru' ? 'Покупки' : 'Purchases'}: /balance`
    ].join('\n')
  }

  function formatRentBillState(input: {
    locale: Parameters<typeof getBotTranslations>[0]
    householdName?: string | null | undefined
    period: string
    state: NonNullable<
      Awaited<ReturnType<FinanceCommandService['generateCurrentBillPlan']>>
    >['rentBillingState']
    currency: 'USD' | 'GEL'
    adjustmentPolicy: HouseholdBillingSettingsRecord['paymentBalanceAdjustmentPolicy']
    viewerMemberId?: string | null
    orderMemberId?: string | null
  }): string {
    const visibleMembers = sortCurrentMemberFirst(
      input.viewerMemberId
        ? input.state.memberSummaries.filter((member) => member.memberId === input.viewerMemberId)
        : input.state.memberSummaries,
      input.orderMemberId ?? input.viewerMemberId
    )
    const destinationLines = input.state.paymentDestinations
      ? formatRentDestinationSection({
          locale: input.locale,
          destinations: input.state.paymentDestinations
        })
      : []

    return [
      `${input.locale === 'ru' ? 'Аренда' : 'Rent state'} · ${formatBillingPeriodLabel(input.locale, input.period)}`,
      ...(input.householdName ? [input.householdName] : []),
      `${input.locale === 'ru' ? 'Срок' : 'Due'}: ${formatAbsoluteDate(input.locale, input.state.dueDate)}`,
      ...(destinationLines.length > 0 ? ['', ...destinationLines] : []),
      '',
      visibleMembers
        .map((member) =>
          (input.viewerMemberId
            ? [
                member.remaining.amountMinor > 0n
                  ? `${input.locale === 'ru' ? 'Осталось оплатить' : 'Remaining to pay'}: ${formatUserFacingMoney(member.remaining.toMajorString(), input.currency)}`
                  : input.locale === 'ru'
                    ? 'Уже оплачено.'
                    : 'Already paid.'
              ]
            : [
                member.displayName,
                member.remaining.amountMinor > 0n
                  ? `${input.locale === 'ru' ? 'Осталось оплатить' : 'Remaining to pay'}: ${formatUserFacingMoney(member.remaining.toMajorString(), input.currency)}`
                  : input.locale === 'ru'
                    ? 'Уже оплачено.'
                    : 'Already paid.'
              ]
          ).join('\n')
        )
        .join('\n\n')
    ].join('\n')
  }

  function formatIdleBillState(input: {
    locale: Parameters<typeof getBotTranslations>[0]
    householdName?: string | null | undefined
    plan: NonNullable<Awaited<ReturnType<FinanceCommandService['generateCurrentBillPlan']>>>
  }): string {
    return [
      `${input.locale === 'ru' ? 'Счета вне окна оплаты' : 'No active payment window'} · ${formatBillingPeriodLabel(input.locale, input.plan.period)}`,
      ...(input.householdName ? [input.householdName] : []),
      `${input.locale === 'ru' ? 'Коммуналка до' : 'Utilities due'}: ${formatAbsoluteDate(input.locale, input.plan.utilityBillingPlan?.dueDate ?? input.plan.period)}`,
      `${input.locale === 'ru' ? 'Аренда до' : 'Rent due'}: ${formatAbsoluteDate(input.locale, input.plan.rentBillingState.dueDate)}`
    ].join('\n')
  }

  function buildBillReply(input: {
    locale: Parameters<typeof getBotTranslations>[0]
    householdName?: string | null | undefined
    plan: NonNullable<Awaited<ReturnType<FinanceCommandService['generateCurrentBillPlan']>>>
    utilityCategories: readonly {
      name: string
      providerName: string | null
      customerNumber: string | null
      paymentLink: string | null
      note: string | null
    }[]
    adjustmentPolicy: HouseholdBillingSettingsRecord['paymentBalanceAdjustmentPolicy']
    forcedMode?: 'utilities' | 'rent' | null
    viewerMemberId?: string | null
    orderMemberId?: string | null
    detailMode: 'compact' | 'full'
  }): string {
    const mode = input.forcedMode ?? input.plan.billingStage

    if (mode === 'utilities' && input.plan.utilityBillingPlan) {
      return formatUtilityBillPlan({
        locale: input.locale,
        householdName: input.householdName,
        period: input.plan.period,
        plan: input.plan.utilityBillingPlan,
        currency: input.plan.currency,
        utilityCategories: input.utilityCategories,
        memberBalances: input.plan.members ?? [],
        detailMode: input.detailMode,
        ...(input.orderMemberId === undefined
          ? {}
          : {
              orderMemberId: input.orderMemberId
            }),
        ...(input.viewerMemberId === undefined
          ? {}
          : {
              viewerMemberId: input.viewerMemberId
            })
      })
    }

    if (mode === 'rent') {
      return formatRentBillState({
        locale: input.locale,
        householdName: input.householdName,
        period: input.plan.period,
        state: input.plan.rentBillingState,
        currency: input.plan.currency,
        adjustmentPolicy: input.adjustmentPolicy,
        ...(input.orderMemberId === undefined
          ? {}
          : {
              orderMemberId: input.orderMemberId
            }),
        ...(input.viewerMemberId === undefined
          ? {}
          : {
              viewerMemberId: input.viewerMemberId
            })
      })
    }

    return formatIdleBillState({
      locale: input.locale,
      householdName: input.householdName,
      plan: input.plan
    })
  }

  async function replyWithBillPlan(input: {
    ctx: Context
    service: FinanceCommandService
    householdId: string
    householdName?: string | null
    periodArg?: string
    viewerMemberId?: string | null
    forcedMode?: 'utilities' | 'rent' | null
    orderMemberId?: string | null
    detailMode: 'compact' | 'full'
  }) {
    const locale = await resolveReplyLocale({
      ctx: input.ctx,
      repository: options.householdConfigurationRepository,
      householdId: input.householdId
    })
    const [plan, utilityCategories, billingSettings] = await Promise.all([
      input.service.generateCurrentBillPlan(input.periodArg),
      options.householdConfigurationRepository.listHouseholdUtilityCategories(input.householdId),
      options.householdConfigurationRepository.getHouseholdBillingSettings(input.householdId)
    ])
    if (!plan) {
      await input.ctx.reply(getBotTranslations(locale).finance.noStatementCycle)
      return
    }

    const keyboard: Array<Array<{ text: string; callback_data: string }>> = []
    if (
      (input.forcedMode ?? plan.billingStage) === 'utilities' &&
      plan.utilityBillingPlan &&
      input.viewerMemberId &&
      plan.utilityBillingPlan.categories.some(
        (category) => category.assignedMemberId === input.viewerMemberId
      )
    ) {
      await storeBillPendingAction({
        ctx: input.ctx,
        payload: {
          kind: 'resolve',
          householdId: input.householdId,
          viewerMemberId: input.viewerMemberId,
          periodArg: input.periodArg ?? null
        }
      })
      keyboard.push([
        {
          text: locale === 'ru' ? 'Оплатил по плану' : 'Resolve my planned bills',
          callback_data: `${BILL_RESOLVE_CALLBACK_PREFIX}current`
        }
      ])
    }

    await input.ctx.reply(
      buildBillReply({
        locale,
        householdName: input.householdName,
        plan,
        utilityCategories: utilityCategories
          .filter((category) => category.isActive)
          .map((category) => ({
            name: category.name,
            providerName: category.providerName ?? null,
            customerNumber: category.customerNumber ?? null,
            paymentLink: category.paymentLink ?? null,
            note: category.note ?? null
          })),
        adjustmentPolicy: billingSettings.paymentBalanceAdjustmentPolicy,
        detailMode: input.detailMode,
        ...(input.forcedMode === undefined
          ? {}
          : {
              forcedMode: input.forcedMode
            }),
        ...(input.viewerMemberId === undefined
          ? {}
          : {
              viewerMemberId: input.viewerMemberId
            }),
        ...(input.orderMemberId === undefined
          ? {}
          : {
              orderMemberId: input.orderMemberId
            })
      }),
      keyboard.length > 0 ? { reply_markup: { inline_keyboard: keyboard } } : {}
    )
  }

  function statusCallbackPeriod(periodArg: string | undefined): string {
    return periodArg && periodArg.length <= 20 && !periodArg.includes(':') ? periodArg : 'current'
  }

  function periodArgFromStatusCallback(
    raw: string,
    pendingPeriodArg?: string | null
  ): string | undefined {
    return raw === 'current' ? (pendingPeriodArg ?? undefined) : raw
  }

  function buildMiniAppUrl(ctx: Context): string | null {
    const botUsername = ctx.me.username ?? options.botUsername
    if (!isPrivateChat(ctx) || !options.miniAppUrl || !botUsername) {
      return null
    }

    return `${options.miniAppUrl}${options.miniAppUrl.includes('?') ? '&' : '?'}bot=${botUsername}`
  }

  function buildStatusReplyMarkup(input: { ctx: Context; locale: BotLocale; periodArg?: string }): {
    inline_keyboard: Array<
      Array<{ text: string; callback_data: string } | { text: string; web_app: { url: string } }>
    >
  } | null {
    const rows: Array<
      Array<{ text: string; callback_data: string } | { text: string; web_app: { url: string } }>
    > = []
    const callbackPeriod = statusCallbackPeriod(input.periodArg)

    if (isGroupChat(input.ctx) || options.promptRepository) {
      rows.push([
        {
          text: input.locale === 'ru' ? 'Детали' : 'Details',
          callback_data: `${STATUS_DETAILS_CALLBACK_PREFIX}${callbackPeriod}`
        },
        {
          text: input.locale === 'ru' ? 'Балансы' : 'Balances',
          callback_data: `${STATUS_BALANCES_CALLBACK_PREFIX}${callbackPeriod}`
        }
      ])
    }

    const webAppUrl = buildMiniAppUrl(input.ctx)
    if (webAppUrl) {
      rows.push([
        {
          text: getBotTranslations(input.locale).setup.openMiniAppButton,
          web_app: { url: webAppUrl }
        }
      ])
    }

    return rows.length > 0 ? { inline_keyboard: rows } : null
  }

  async function replyWithHouseholdStatus(input: {
    ctx: Context
    locale: BotLocale
    service: FinanceCommandService
    householdId: string
    memberId: string
    householdName?: string | null
    periodArg?: string
    editMessage?: boolean
  }) {
    const dashboard = await input.service.generateDashboard(input.periodArg)
    if (!dashboard) {
      const text = getBotTranslations(input.locale).finance.noStatementCycle
      if (input.editMessage) {
        await input.ctx.editMessageText(text)
        return
      }

      await input.ctx.reply(text)
      return
    }

    await storeBillPendingAction({
      ctx: input.ctx,
      payload: {
        kind: 'status_action',
        householdId: input.householdId,
        memberId: input.memberId,
        periodArg: input.periodArg ?? null
      }
    })
    const replyMarkup = buildStatusReplyMarkup({
      ctx: input.ctx,
      locale: input.locale,
      ...(input.periodArg ? { periodArg: input.periodArg } : {})
    })
    const replyOptions = replyMarkup ? { reply_markup: replyMarkup } : {}
    const text = formatHouseholdStatus(input.locale, dashboard, input.householdName)

    if (input.editMessage) {
      await input.ctx.editMessageText(text, replyOptions)
      return
    }

    await input.ctx.reply(text, replyOptions)
  }

  async function resolvePrivateStatusTarget(input: {
    ctx: Context
    callbackPeriod: string
  }): Promise<{
    service: FinanceCommandService
    householdId: string
    memberId: string
    householdName: string | null
    periodArg?: string
  } | null> {
    const pending = await getBillPendingAction(input.ctx)
    const pendingPeriodArg =
      pending?.payload.kind === 'status_action' && typeof pending.payload.periodArg === 'string'
        ? pending.payload.periodArg
        : null
    const pendingHouseholdId =
      pending?.payload.kind === 'status_action' && typeof pending.payload.householdId === 'string'
        ? pending.payload.householdId
        : null
    const pendingMemberId =
      pending?.payload.kind === 'status_action' && typeof pending.payload.memberId === 'string'
        ? pending.payload.memberId
        : null
    const telegramUserId = input.ctx.from?.id?.toString()
    if (!telegramUserId) {
      return null
    }

    const memberships =
      await options.householdConfigurationRepository.listHouseholdMembersByTelegramUserId(
        telegramUserId
      )
    const membership =
      pendingHouseholdId && pendingMemberId
        ? memberships.find(
            (item) => item.householdId === pendingHouseholdId && item.id === pendingMemberId
          )
        : memberships.length === 1
          ? memberships[0]
          : null

    if (!membership) {
      return null
    }

    const household = await options.householdConfigurationRepository.getHouseholdChatByHouseholdId(
      membership.householdId
    )
    const periodArg = periodArgFromStatusCallback(input.callbackPeriod, pendingPeriodArg)

    return {
      service: options.financeServiceForHousehold(membership.householdId),
      householdId: membership.householdId,
      memberId: membership.id,
      householdName: household?.householdName ?? membership.householdId,
      ...(periodArg ? { periodArg } : {})
    }
  }

  async function resolveStatusCallbackTarget(input: {
    ctx: Context
    callbackPeriod: string
  }): Promise<{
    service: FinanceCommandService
    householdId: string
    memberId: string
    householdName: string | null
    periodArg?: string
  } | null> {
    if (isGroupChat(input.ctx)) {
      const resolved = await requireMember(input.ctx)
      if (!resolved) {
        return null
      }

      const periodArg = periodArgFromStatusCallback(input.callbackPeriod)

      return {
        service: resolved.service,
        householdId: resolved.householdId,
        memberId: resolved.member.id,
        householdName: resolved.householdName,
        ...(periodArg ? { periodArg } : {})
      }
    }

    return resolvePrivateStatusTarget(input)
  }

  async function replyWithRequestedHouseholdStatus(input: {
    ctx: Context
    locale: BotLocale
    periodArg?: string
  }) {
    const telegramUserId = input.ctx.from?.id?.toString()
    if (!telegramUserId) {
      await input.ctx.reply(getBotTranslations(input.locale).finance.unableToIdentifySender)
      return
    }

    if (isGroupChat(input.ctx)) {
      const resolved = await requireMember(input.ctx)
      if (!resolved) {
        return
      }

      await replyWithHouseholdStatus({
        ctx: input.ctx,
        locale: input.locale,
        service: resolved.service,
        householdId: resolved.householdId,
        memberId: resolved.member.id,
        householdName: resolved.householdName,
        ...(input.periodArg ? { periodArg: input.periodArg } : {})
      })
      return
    }

    const memberships =
      await options.householdConfigurationRepository.listHouseholdMembersByTelegramUserId(
        telegramUserId
      )
    if (memberships.length === 0) {
      await input.ctx.reply(getBotTranslations(input.locale).finance.notMember)
      return
    }

    if (memberships.length === 1) {
      const membership = memberships[0]!
      const household =
        await options.householdConfigurationRepository.getHouseholdChatByHouseholdId(
          membership.householdId
        )
      await replyWithHouseholdStatus({
        ctx: input.ctx,
        locale: input.locale,
        service: options.financeServiceForHousehold(membership.householdId),
        householdId: membership.householdId,
        memberId: membership.id,
        householdName: household?.householdName ?? membership.householdId,
        ...(input.periodArg ? { periodArg: input.periodArg } : {})
      })
      return
    }

    const households = await Promise.all(
      memberships.map(async (membership) => ({
        membership,
        household: await options.householdConfigurationRepository.getHouseholdChatByHouseholdId(
          membership.householdId
        )
      }))
    )
    await storeBillPendingAction({
      ctx: input.ctx,
      payload: {
        kind: 'status_choose',
        periodArg: input.periodArg ?? null,
        choices: households.map(({ membership }) => ({
          householdId: membership.householdId,
          memberId: membership.id
        }))
      }
    })
    await input.ctx.reply(
      input.locale === 'ru' ? 'Выберите дом для статуса:' : 'Choose a household:',
      {
        reply_markup: {
          inline_keyboard: households.map(({ membership, household }, index) => [
            {
              text: household?.householdName ?? membership.householdId,
              callback_data: `${STATUS_SHOW_CALLBACK_PREFIX}${index}`
            }
          ])
        }
      }
    )
  }

  async function replyWithBillingAuditExport(input: {
    ctx: Context
    service: FinanceCommandService
    householdId: string
    householdName?: string | null
    requesterMemberId: string
    requesterDisplayName: string
    periodArg?: string
  }) {
    const locale = await resolveReplyLocale({
      ctx: input.ctx,
      repository: options.householdConfigurationRepository,
      householdId: input.householdId
    })
    const audit = await input.service.generateBillingAuditExport(input.periodArg)
    if (!audit) {
      await input.ctx.reply(getBotTranslations(locale).finance.noStatementCycle)
      return
    }

    const payload = {
      ...audit,
      household: {
        ...audit.household,
        householdName: input.householdName ?? null,
        requesterMemberId: input.requesterMemberId,
        requesterDisplayName: input.requesterDisplayName
      }
    }
    const json = `${JSON.stringify(payload, null, 2)}\n`
    const fileName = `billing-audit-${audit.meta.period}.json`
    await input.ctx.replyWithDocument(new InputFile(Buffer.from(json, 'utf8'), fileName), {
      caption:
        locale === 'ru'
          ? `Аудит расчётов за ${formatBillingPeriodLabel(locale, audit.meta.period)}`
          : `Billing audit for ${formatBillingPeriodLabel(locale, audit.meta.period)}`
    })
  }

  async function replyWithRequestedBillPlan(input: {
    ctx: Context
    locale: BotLocale
    forcedMode: 'utilities' | 'rent' | null
    showMode: 'household' | 'viewer'
    detailMode: 'compact' | 'full'
  }) {
    const telegramUserId = input.ctx.from?.id?.toString()
    if (!telegramUserId) {
      await input.ctx.reply(getBotTranslations(input.locale).finance.unableToIdentifySender)
      return
    }

    if (isGroupChat(input.ctx)) {
      const resolved = await requireMember(input.ctx)
      if (!resolved) {
        return
      }

      await replyWithBillPlan({
        ctx: input.ctx,
        service: resolved.service,
        householdId: resolved.householdId,
        ...(input.showMode === 'household'
          ? {
              orderMemberId: resolved.member.id
            }
          : {
              viewerMemberId: resolved.member.id
            }),
        forcedMode: input.forcedMode,
        detailMode: input.detailMode
      })
      return
    }

    const memberships =
      await options.householdConfigurationRepository.listHouseholdMembersByTelegramUserId(
        telegramUserId
      )
    if (memberships.length === 0) {
      await input.ctx.reply(getBotTranslations(input.locale).finance.notMember)
      return
    }

    if (memberships.length === 1) {
      const membership = memberships[0]!
      const household =
        await options.householdConfigurationRepository.getHouseholdChatByHouseholdId(
          membership.householdId
        )
      await replyWithBillPlan({
        ctx: input.ctx,
        service: options.financeServiceForHousehold(membership.householdId),
        householdId: membership.householdId,
        householdName: household?.householdName ?? membership.householdId,
        ...(input.showMode === 'household'
          ? {
              orderMemberId: membership.id
            }
          : {
              viewerMemberId: membership.id
            }),
        forcedMode: input.forcedMode,
        detailMode: input.detailMode
      })
      return
    }

    const households = await Promise.all(
      memberships.map(async (membership) => ({
        membership,
        household: await options.householdConfigurationRepository.getHouseholdChatByHouseholdId(
          membership.householdId
        )
      }))
    )
    await storeBillPendingAction({
      ctx: input.ctx,
      payload: {
        kind: 'show',
        showMode: input.showMode,
        detailMode: input.detailMode,
        choices: households.map(({ membership }) => ({
          householdId: membership.householdId,
          memberId: membership.id
        }))
      }
    })
    await input.ctx.reply(
      input.locale === 'ru' ? 'Выберите дом для просмотра счета:' : 'Choose a household:',
      {
        reply_markup: {
          inline_keyboard: households.map(({ membership, household }, index) => [
            {
              text: household?.householdName ?? membership.householdId,
              callback_data: `${BILL_SHOW_CALLBACK_PREFIX}${index}:${input.forcedMode ?? 'auto'}:${input.detailMode}`
            }
          ])
        }
      }
    )
  }

  function register(bot: Bot): void {
    bot.command('bill', async (ctx) => {
      const locale = await resolveReplyLocale({
        ctx,
        repository: options.householdConfigurationRepository
      })
      const { forcedMode, detailMode, hasInvalidArgs } = parseBillArgs(commandArgs(ctx))
      if (hasInvalidArgs) {
        await ctx.reply(getBotTranslations(locale).common.useHelp)
        return
      }

      await replyWithRequestedBillPlan({
        ctx,
        locale,
        forcedMode,
        showMode: 'household',
        detailMode
      })
    })

    bot.command('bill_full', async (ctx) => {
      const locale = await resolveReplyLocale({
        ctx,
        repository: options.householdConfigurationRepository
      })
      const { forcedMode, hasInvalidArgs } = parseBillArgs(commandArgs(ctx))
      if (hasInvalidArgs) {
        await ctx.reply(getBotTranslations(locale).common.useHelp)
        return
      }

      await replyWithRequestedBillPlan({
        ctx,
        locale,
        forcedMode,
        showMode: 'household',
        detailMode: 'full'
      })
    })

    bot.command('my_bill', async (ctx) => {
      const locale = await resolveReplyLocale({
        ctx,
        repository: options.householdConfigurationRepository
      })
      const { forcedMode, detailMode, hasInvalidArgs } = parseBillArgs(commandArgs(ctx))
      if (hasInvalidArgs) {
        await ctx.reply(getBotTranslations(locale).common.useHelp)
        return
      }

      await replyWithRequestedBillPlan({
        ctx,
        locale,
        forcedMode,
        showMode: 'viewer',
        detailMode
      })
    })

    bot.command('my_bill_full', async (ctx) => {
      const locale = await resolveReplyLocale({
        ctx,
        repository: options.householdConfigurationRepository
      })
      const { forcedMode, hasInvalidArgs } = parseBillArgs(commandArgs(ctx))
      if (hasInvalidArgs) {
        await ctx.reply(getBotTranslations(locale).common.useHelp)
        return
      }

      await replyWithRequestedBillPlan({
        ctx,
        locale,
        forcedMode,
        showMode: 'viewer',
        detailMode: 'full'
      })
    })

    bot.command('bill_json', async (ctx) => {
      const locale = await resolveReplyLocale({
        ctx,
        repository: options.householdConfigurationRepository
      })
      const periodArg = commandArgs(ctx)[0]
      const telegramUserId = ctx.from?.id?.toString()
      if (!telegramUserId) {
        await ctx.reply(getBotTranslations(locale).finance.unableToIdentifySender)
        return
      }

      if (isGroupChat(ctx)) {
        const resolved = await requireAdmin(ctx)
        if (!resolved) {
          return
        }

        await replyWithBillingAuditExport({
          ctx,
          service: resolved.service,
          householdId: resolved.householdId,
          requesterMemberId: resolved.member.id,
          requesterDisplayName: resolved.member.displayName,
          ...(periodArg ? { periodArg } : {})
        })
        return
      }

      const memberships =
        await options.householdConfigurationRepository.listHouseholdMembersByTelegramUserId(
          telegramUserId
        )
      if (memberships.length === 0) {
        await ctx.reply(getBotTranslations(locale).finance.notMember)
        return
      }

      const adminMemberships = memberships.filter((membership) => membership.isAdmin)
      if (adminMemberships.length === 0) {
        await ctx.reply(getBotTranslations(locale).finance.adminOnly)
        return
      }

      if (adminMemberships.length === 1) {
        const membership = adminMemberships[0]!
        const household =
          await options.householdConfigurationRepository.getHouseholdChatByHouseholdId(
            membership.householdId
          )
        await replyWithBillingAuditExport({
          ctx,
          service: options.financeServiceForHousehold(membership.householdId),
          householdId: membership.householdId,
          householdName: household?.householdName ?? membership.householdId,
          requesterMemberId: membership.id,
          requesterDisplayName: membership.displayName,
          ...(periodArg ? { periodArg } : {})
        })
        return
      }

      const households = await Promise.all(
        adminMemberships.map(async (membership) => ({
          membership,
          household: await options.householdConfigurationRepository.getHouseholdChatByHouseholdId(
            membership.householdId
          )
        }))
      )
      await storeBillPendingAction({
        ctx,
        payload: {
          kind: 'json_export',
          periodArg: periodArg ?? null,
          choices: households.map(({ membership }) => ({
            householdId: membership.householdId,
            memberId: membership.id
          }))
        }
      })
      await ctx.reply(locale === 'ru' ? 'Выберите дом для JSON-экспорта:' : 'Choose a household:', {
        reply_markup: {
          inline_keyboard: households.map(({ membership, household }, index) => [
            {
              text: household?.householdName ?? membership.householdId,
              callback_data: `${BILL_JSON_CALLBACK_PREFIX}${index}`
            }
          ])
        }
      })
    })

    bot.callbackQuery(
      new RegExp(`^${BILL_SHOW_CALLBACK_PREFIX.replace(':', '\\:')}`),
      async (ctx) => {
        const payload = ctx.callbackQuery.data.slice(BILL_SHOW_CALLBACK_PREFIX.length)
        const [choiceIndexRaw, modeRaw, detailRaw] = payload.split(':')
        const telegramUserId = ctx.from?.id?.toString()
        const choiceIndex = Number(choiceIndexRaw)
        if (!Number.isInteger(choiceIndex) || choiceIndex < 0 || !telegramUserId) {
          await ctx.answerCallbackQuery()
          return
        }

        const pendingAction = await getBillPendingAction(ctx)
        const choices = Array.isArray(pendingAction?.payload.choices)
          ? pendingAction.payload.choices
          : []
        const showMode =
          pendingAction?.payload.kind === 'show' && pendingAction.payload.showMode === 'household'
            ? 'household'
            : 'viewer'
        const pendingDetailMode =
          pendingAction?.payload.kind === 'show' && pendingAction.payload.detailMode === 'full'
            ? 'full'
            : 'compact'
        const detailMode = parseBillDetailMode(detailRaw) ?? pendingDetailMode
        const choice = choices[choiceIndex]
        const householdId =
          choice &&
          typeof choice === 'object' &&
          typeof choice.householdId === 'string' &&
          typeof choice.memberId === 'string'
            ? choice.householdId
            : null
        const memberId =
          choice &&
          typeof choice === 'object' &&
          typeof choice.householdId === 'string' &&
          typeof choice.memberId === 'string'
            ? choice.memberId
            : null
        if (!householdId || !memberId) {
          await ctx.answerCallbackQuery()
          return
        }

        const locale = await resolveReplyLocale({
          ctx,
          repository: options.householdConfigurationRepository,
          householdId
        })
        const [household, plan, utilityCategories, billingSettings] = await Promise.all([
          options.householdConfigurationRepository.getHouseholdChatByHouseholdId(householdId),
          options.financeServiceForHousehold(householdId).generateCurrentBillPlan(),
          options.householdConfigurationRepository.listHouseholdUtilityCategories(householdId),
          options.householdConfigurationRepository.getHouseholdBillingSettings(householdId)
        ])
        if (!plan) {
          await ctx.answerCallbackQuery()
          return
        }

        await ctx.editMessageText(
          buildBillReply({
            locale,
            householdName: household?.householdName ?? householdId,
            plan,
            utilityCategories: utilityCategories
              .filter((category) => category.isActive)
              .map((category) => ({
                name: category.name,
                providerName: category.providerName ?? null,
                customerNumber: category.customerNumber ?? null,
                paymentLink: category.paymentLink ?? null,
                note: category.note ?? null
              })),
            adjustmentPolicy: billingSettings.paymentBalanceAdjustmentPolicy,
            forcedMode: modeRaw === 'auto' ? null : parseBillMode(modeRaw),
            detailMode,
            ...(showMode === 'household'
              ? {
                  orderMemberId: memberId
                }
              : {
                  viewerMemberId: memberId
                })
          })
        )
        await ctx.answerCallbackQuery()
      }
    )

    bot.callbackQuery(
      new RegExp(`^${BILL_JSON_CALLBACK_PREFIX.replace(':', '\\:')}`),
      async (ctx) => {
        const choiceIndex = Number(ctx.callbackQuery.data.slice(BILL_JSON_CALLBACK_PREFIX.length))
        if (!Number.isInteger(choiceIndex) || choiceIndex < 0) {
          await ctx.answerCallbackQuery()
          return
        }

        const pendingAction = await getBillPendingAction(ctx)
        const choices = Array.isArray(pendingAction?.payload.choices)
          ? pendingAction.payload.choices
          : []
        const choice = choices[choiceIndex]
        const householdId =
          choice &&
          typeof choice === 'object' &&
          typeof choice.householdId === 'string' &&
          typeof choice.memberId === 'string'
            ? choice.householdId
            : null
        const memberId =
          choice &&
          typeof choice === 'object' &&
          typeof choice.householdId === 'string' &&
          typeof choice.memberId === 'string'
            ? choice.memberId
            : null
        const periodArg =
          pendingAction?.payload.kind === 'json_export' &&
          typeof pendingAction.payload.periodArg === 'string'
            ? pendingAction.payload.periodArg
            : undefined
        if (!householdId || !memberId) {
          await ctx.answerCallbackQuery()
          return
        }

        const memberships =
          await options.householdConfigurationRepository.listHouseholdMembersByTelegramUserId(
            ctx.from?.id?.toString() ?? ''
          )
        const membership = memberships.find(
          (member) => member.householdId === householdId && member.id === memberId && member.isAdmin
        )
        if (!membership) {
          await ctx.answerCallbackQuery()
          return
        }

        const household =
          await options.householdConfigurationRepository.getHouseholdChatByHouseholdId(householdId)
        await replyWithBillingAuditExport({
          ctx,
          service: options.financeServiceForHousehold(householdId),
          householdId,
          householdName: household?.householdName ?? householdId,
          requesterMemberId: membership.id,
          requesterDisplayName: membership.displayName,
          ...(periodArg ? { periodArg } : {})
        })
        await ctx.answerCallbackQuery()
      }
    )

    bot.callbackQuery(
      new RegExp(`^${BILL_RESOLVE_CALLBACK_PREFIX.replace(':', '\\:')}`),
      async (ctx) => {
        const pendingAction = await getBillPendingAction(ctx)
        const householdId =
          pendingAction?.payload.kind === 'resolve' &&
          typeof pendingAction.payload.householdId === 'string'
            ? pendingAction.payload.householdId
            : null
        const memberId =
          pendingAction?.payload.kind === 'resolve' &&
          typeof pendingAction.payload.viewerMemberId === 'string'
            ? pendingAction.payload.viewerMemberId
            : null
        const telegramUserId = ctx.from?.id?.toString()
        if (!householdId || !memberId || !telegramUserId) {
          await ctx.answerCallbackQuery()
          return
        }

        const service = options.financeServiceForHousehold(householdId)
        const actingMember = await service.getMemberByTelegramUserId(telegramUserId)
        if (!actingMember || (!actingMember.isAdmin && actingMember.id !== memberId)) {
          await ctx.answerCallbackQuery()
          return
        }

        const locale = await resolveReplyLocale({
          ctx,
          repository: options.householdConfigurationRepository,
          householdId
        })
        const household =
          await options.householdConfigurationRepository.getHouseholdChatByHouseholdId(householdId)
        await service.resolveUtilityBillAsPlanned({
          memberId,
          actorMemberId: actingMember.id
        })
        const [plan, utilityCategories, billingSettings] = await Promise.all([
          service.generateCurrentBillPlan(),
          options.householdConfigurationRepository.listHouseholdUtilityCategories(householdId),
          options.householdConfigurationRepository.getHouseholdBillingSettings(householdId)
        ])
        if (!plan) {
          await ctx.answerCallbackQuery()
          return
        }

        await ctx.editMessageText(
          buildBillReply({
            locale,
            householdName: household?.householdName ?? householdId,
            plan,
            utilityCategories: utilityCategories
              .filter((category) => category.isActive)
              .map((category) => ({
                name: category.name,
                providerName: category.providerName ?? null,
                customerNumber: category.customerNumber ?? null,
                paymentLink: category.paymentLink ?? null,
                note: category.note ?? null
              })),
            adjustmentPolicy: billingSettings.paymentBalanceAdjustmentPolicy,
            forcedMode: 'utilities',
            viewerMemberId: actingMember.id,
            detailMode: 'compact'
          })
        )
        await ctx.answerCallbackQuery({
          text: locale === 'ru' ? 'Коммуналка отмечена по плану.' : 'Marked as paid as planned.'
        })
      }
    )

    bot.callbackQuery(
      new RegExp(`^${STATUS_SHOW_CALLBACK_PREFIX.replace(':', '\\:')}`),
      async (ctx) => {
        const choiceIndex = Number(ctx.callbackQuery.data.slice(STATUS_SHOW_CALLBACK_PREFIX.length))
        if (!Number.isInteger(choiceIndex) || choiceIndex < 0) {
          await ctx.answerCallbackQuery()
          return
        }

        const pendingAction = await getBillPendingAction(ctx)
        const choices = Array.isArray(pendingAction?.payload.choices)
          ? pendingAction.payload.choices
          : []
        const choice = choices[choiceIndex]
        const householdId =
          choice &&
          typeof choice === 'object' &&
          typeof choice.householdId === 'string' &&
          typeof choice.memberId === 'string'
            ? choice.householdId
            : null
        const memberId =
          choice &&
          typeof choice === 'object' &&
          typeof choice.householdId === 'string' &&
          typeof choice.memberId === 'string'
            ? choice.memberId
            : null
        const periodArg =
          pendingAction?.payload.kind === 'status_choose' &&
          typeof pendingAction.payload.periodArg === 'string'
            ? pendingAction.payload.periodArg
            : undefined
        if (!householdId || !memberId) {
          await ctx.answerCallbackQuery()
          return
        }

        const memberships =
          await options.householdConfigurationRepository.listHouseholdMembersByTelegramUserId(
            ctx.from?.id?.toString() ?? ''
          )
        const membership = memberships.find(
          (item) => item.householdId === householdId && item.id === memberId
        )
        if (!membership) {
          await ctx.answerCallbackQuery()
          return
        }

        const locale = await resolveReplyLocale({
          ctx,
          repository: options.householdConfigurationRepository,
          householdId
        })
        const household =
          await options.householdConfigurationRepository.getHouseholdChatByHouseholdId(householdId)
        await replyWithHouseholdStatus({
          ctx,
          locale,
          service: options.financeServiceForHousehold(householdId),
          householdId,
          memberId,
          householdName: household?.householdName ?? householdId,
          ...(periodArg ? { periodArg } : {}),
          editMessage: true
        })
        await ctx.answerCallbackQuery()
      }
    )

    bot.callbackQuery(
      new RegExp(`^${STATUS_DETAILS_CALLBACK_PREFIX.replace(':', '\\:')}`),
      async (ctx) => {
        const callbackPeriod = ctx.callbackQuery.data.slice(STATUS_DETAILS_CALLBACK_PREFIX.length)
        const target = await resolveStatusCallbackTarget({ ctx, callbackPeriod })
        if (!target) {
          await ctx.answerCallbackQuery()
          return
        }

        await replyWithBillPlan({
          ctx,
          service: target.service,
          householdId: target.householdId,
          householdName: target.householdName,
          ...(target.periodArg ? { periodArg: target.periodArg } : {}),
          orderMemberId: target.memberId,
          forcedMode: null,
          detailMode: 'full'
        })
        await ctx.answerCallbackQuery()
      }
    )

    bot.callbackQuery(
      new RegExp(`^${STATUS_BALANCES_CALLBACK_PREFIX.replace(':', '\\:')}`),
      async (ctx) => {
        const callbackPeriod = ctx.callbackQuery.data.slice(STATUS_BALANCES_CALLBACK_PREFIX.length)
        const target = await resolveStatusCallbackTarget({ ctx, callbackPeriod })
        if (!target) {
          await ctx.answerCallbackQuery()
          return
        }

        const locale = await resolveReplyLocale({
          ctx,
          repository: options.householdConfigurationRepository,
          householdId: target.householdId
        })
        const dashboard = await target.service.generateDashboard(target.periodArg)
        if (!dashboard) {
          await ctx.answerCallbackQuery()
          return
        }

        await ctx.reply(formatBalances(locale, dashboard))
        await ctx.answerCallbackQuery()
      }
    )

    bot.callbackQuery(TELEGRAM_HOME_MY_BILL_CALLBACK, async (ctx) => {
      const locale = await resolveReplyLocale({
        ctx,
        repository: options.householdConfigurationRepository
      })
      await replyWithRequestedBillPlan({
        ctx,
        locale,
        forcedMode: null,
        showMode: 'viewer',
        detailMode: 'compact'
      })
      await ctx.answerCallbackQuery()
    })

    bot.callbackQuery(TELEGRAM_HOME_STATUS_CALLBACK, async (ctx) => {
      const locale = await resolveReplyLocale({
        ctx,
        repository: options.householdConfigurationRepository
      })
      await replyWithRequestedHouseholdStatus({
        ctx,
        locale
      })
      await ctx.answerCallbackQuery()
    })

    bot.callbackQuery(TELEGRAM_HOME_BALANCES_CALLBACK, async (ctx) => {
      const locale = await resolveReplyLocale({
        ctx,
        repository: options.householdConfigurationRepository
      })
      await replyWithRequestedBalances({
        ctx,
        locale
      })
      await ctx.answerCallbackQuery()
    })

    bot.callbackQuery(
      new RegExp(`^${HOME_BALANCE_SHOW_CALLBACK_PREFIX.replace(':', '\\:')}`),
      async (ctx) => {
        const choiceIndex = Number(
          ctx.callbackQuery.data.slice(HOME_BALANCE_SHOW_CALLBACK_PREFIX.length)
        )
        if (!Number.isInteger(choiceIndex) || choiceIndex < 0) {
          await ctx.answerCallbackQuery()
          return
        }

        const pendingAction = await getBillPendingAction(ctx)
        const choices = Array.isArray(pendingAction?.payload.choices)
          ? pendingAction.payload.choices
          : []
        const choice = choices[choiceIndex]
        const householdId =
          choice &&
          typeof choice === 'object' &&
          typeof choice.householdId === 'string' &&
          typeof choice.memberId === 'string'
            ? choice.householdId
            : null
        if (!householdId) {
          await ctx.answerCallbackQuery()
          return
        }

        const locale = await resolveReplyLocale({
          ctx,
          repository: options.householdConfigurationRepository,
          householdId
        })
        await replyWithBalances({
          ctx,
          locale,
          service: options.financeServiceForHousehold(householdId)
        })
        await ctx.answerCallbackQuery()
      }
    )

    bot.callbackQuery(
      new RegExp(`^${ASSISTANT_COMMAND_CANCEL_CALLBACK_PREFIX.replace(':', '\\:')}`),
      async (ctx) => {
        const telegramUserId = ctx.from?.id?.toString()
        const telegramChatId = ctx.chat?.id?.toString()
        if (telegramUserId && telegramChatId && options.promptRepository) {
          await options.promptRepository.clearPendingAction(telegramChatId, telegramUserId)
        }
        await ctx.answerCallbackQuery({
          text: 'Cancelled'
        })
        if (ctx.msg) {
          await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } })
        }
      }
    )

    bot.callbackQuery(
      new RegExp(`^${ASSISTANT_COMMAND_RUN_CALLBACK_PREFIX.replace(':', '\\:')}`),
      async (ctx) => {
        const telegramUserId = ctx.from?.id?.toString()
        const telegramChatId = ctx.chat?.id?.toString()
        if (!telegramUserId || !telegramChatId || !options.promptRepository) {
          await ctx.answerCallbackQuery()
          return
        }

        const pending = await options.promptRepository.getPendingAction(
          telegramChatId,
          telegramUserId
        )
        const payload = pending?.action === ASSISTANT_COMMAND_ACTION ? pending.payload : null
        const command = payload?.command
        const householdId = payload?.householdId
        const memberId = payload?.memberId
        const forcedMode = parseBillMode(
          typeof payload?.forcedMode === 'string' ? payload.forcedMode : undefined
        )
        const detailMode =
          payload?.detailMode === 'full' || payload?.detailMode === 'compact'
            ? payload.detailMode
            : 'compact'
        if (
          typeof command !== 'string' ||
          typeof householdId !== 'string' ||
          typeof memberId !== 'string'
        ) {
          await ctx.answerCallbackQuery({ show_alert: true })
          return
        }

        if (
          command !== 'bill' &&
          command !== 'bill_full' &&
          command !== 'my_bill' &&
          command !== 'my_bill_full' &&
          command !== 'household_status'
        ) {
          await ctx.answerCallbackQuery({ show_alert: true })
          return
        }

        let actingMemberId: string | null = null
        let service: FinanceCommandService | null = null
        let resolvedHouseholdName: string | null = null

        if (isGroupChat(ctx)) {
          const resolved = await requireMember(ctx)
          if (!resolved || resolved.householdId !== householdId) {
            await ctx.answerCallbackQuery({ show_alert: true })
            return
          }
          actingMemberId = resolved.member.id
          service = resolved.service
        } else {
          const membership = (
            await options.householdConfigurationRepository.listHouseholdMembersByTelegramUserId(
              telegramUserId
            )
          ).find((item) => item.householdId === householdId && item.id === memberId)
          if (!membership) {
            await ctx.answerCallbackQuery({ show_alert: true })
            return
          }
          actingMemberId = membership.id
          service = options.financeServiceForHousehold(householdId)
          const household =
            await options.householdConfigurationRepository.getHouseholdChatByHouseholdId(
              householdId
            )
          resolvedHouseholdName = household?.householdName ?? householdId
        }

        await options.promptRepository.clearPendingAction(telegramChatId, telegramUserId)
        await ctx.answerCallbackQuery()

        if (command === 'household_status') {
          const locale = await resolveReplyLocale({
            ctx,
            repository: options.householdConfigurationRepository,
            householdId
          })
          await replyWithHouseholdStatus({
            ctx,
            locale,
            service,
            householdId,
            memberId: actingMemberId,
            ...(resolvedHouseholdName ? { householdName: resolvedHouseholdName } : {})
          })
          return
        }

        await replyWithBillPlan({
          ctx,
          service,
          householdId,
          ...(resolvedHouseholdName ? { householdName: resolvedHouseholdName } : {}),
          ...(command === 'my_bill' || command === 'my_bill_full'
            ? { viewerMemberId: actingMemberId }
            : { orderMemberId: actingMemberId }),
          forcedMode,
          detailMode
        })
      }
    )

    bot.command('household_status', async (ctx) => {
      const locale = await resolveReplyLocale({
        ctx,
        repository: options.householdConfigurationRepository
      })
      const t = getBotTranslations(locale).finance

      try {
        await replyWithRequestedHouseholdStatus({
          ctx,
          locale,
          ...(commandArgs(ctx)[0] ? { periodArg: commandArgs(ctx)[0] } : {})
        })
      } catch (error) {
        await ctx.reply(t.statementFailed((error as Error).message))
      }
    })

    bot.command('balance', async (ctx) => {
      const locale = await resolveReplyLocale({
        ctx,
        repository: options.householdConfigurationRepository
      })
      const t = getBotTranslations(locale).finance

      try {
        await replyWithRequestedBalances({ ctx, locale })
      } catch (error) {
        await ctx.reply(t.statementFailed((error as Error).message))
      }
    })

    bot.command('cycle_open', async (ctx) => {
      const locale = await resolveReplyLocale({
        ctx,
        repository: options.householdConfigurationRepository
      })
      const t = getBotTranslations(locale).finance
      const resolved = await requireAdmin(ctx)
      if (!resolved) {
        return
      }

      const args = commandArgs(ctx)
      if (args.length === 0) {
        await ctx.reply(t.cycleOpenUsage)
        return
      }

      try {
        const cycle = await resolved.service.openCycle(args[0]!, args[1])
        await recordCommandAudit({
          resolved,
          category: 'period_events',
          eventType: 'cycle.opened',
          summaryText: `${resolved.member.displayName} opened period ${cycle.period}`,
          metadata: {
            period: cycle.period,
            currency: cycle.currency
          }
        })
        await ctx.reply(t.cycleOpened(cycle.period, cycle.currency))
      } catch (error) {
        await ctx.reply(t.cycleOpenFailed((error as Error).message))
      }
    })

    bot.command('cycle_close', async (ctx) => {
      const locale = await resolveReplyLocale({
        ctx,
        repository: options.householdConfigurationRepository
      })
      const t = getBotTranslations(locale).finance
      const resolved = await requireAdmin(ctx)
      if (!resolved) {
        return
      }

      try {
        const cycle = await resolved.service.closeCycle(commandArgs(ctx)[0])
        if (!cycle) {
          await ctx.reply(t.noCycleToClose)
          return
        }

        await recordCommandAudit({
          resolved,
          category: 'period_events',
          eventType: 'cycle.closed',
          summaryText: `${resolved.member.displayName} closed period ${cycle.period}`,
          metadata: {
            period: cycle.period
          }
        })
        await ctx.reply(t.cycleClosed(cycle.period))
      } catch (error) {
        await ctx.reply(t.cycleCloseFailed((error as Error).message))
      }
    })

    bot.command('rent_set', async (ctx) => {
      const locale = await resolveReplyLocale({
        ctx,
        repository: options.householdConfigurationRepository
      })
      const t = getBotTranslations(locale).finance
      const resolved = await requireAdmin(ctx)
      if (!resolved) {
        return
      }

      const args = commandArgs(ctx)
      if (args.length === 0) {
        await ctx.reply(t.rentSetUsage)
        return
      }

      try {
        const result = await resolved.service.setRent(args[0]!, args[1], args[2])
        if (!result) {
          await ctx.reply(t.rentNoPeriod)
          return
        }

        await recordCommandAudit({
          resolved,
          category: 'period_events',
          eventType: 'rent.updated',
          summaryText: `${resolved.member.displayName} updated rent: ${formatUserFacingMoney(result.amount.toMajorString(), result.currency)} (${result.period})`,
          metadata: {
            amountMinor: result.amount.amountMinor.toString(),
            currency: result.currency,
            period: result.period
          }
        })
        await ctx.reply(t.rentSaved(result.amount.toMajorString(), result.currency, result.period))
      } catch (error) {
        await ctx.reply(t.rentSaveFailed((error as Error).message))
      }
    })

    bot.command('utility_add', async (ctx) => {
      const locale = await resolveReplyLocale({
        ctx,
        repository: options.householdConfigurationRepository
      })
      const t = getBotTranslations(locale).finance
      const resolved = await requireAdmin(ctx)
      if (!resolved) {
        return
      }

      const args = commandArgs(ctx)
      if (args.length < 2) {
        await ctx.reply(t.utilityAddUsage)
        return
      }

      try {
        const result = await resolved.service.addUtilityBill(
          args[0]!,
          args[1]!,
          resolved.member.id,
          args[2]
        )
        if (!result) {
          await ctx.reply(t.utilityNoOpenCycle)
          return
        }

        await recordCommandAudit({
          resolved,
          category: 'plan_events',
          eventType: 'utility_bill.added',
          summaryText: `${resolved.member.displayName} added utility bill: ${args[0]!} ${formatUserFacingMoney(result.amount.toMajorString(), result.currency)} (${result.period})`,
          metadata: {
            billName: args[0]!,
            amountMinor: result.amount.amountMinor.toString(),
            currency: result.currency,
            period: result.period
          }
        })
        await ctx.reply(
          t.utilityAdded(args[0]!, result.amount.toMajorString(), result.currency, result.period)
        )
      } catch (error) {
        await ctx.reply(t.utilityAddFailed((error as Error).message))
      }
    })

    bot.command('payment_add', async (ctx) => {
      const locale = await resolveReplyLocale({
        ctx,
        repository: options.householdConfigurationRepository
      })
      const t = getBotTranslations(locale).finance
      const resolved = await requireMember(ctx)
      if (!resolved) {
        return
      }

      const args = commandArgs(ctx)
      const kind = args[0]
      if (kind !== 'rent' && kind !== 'utilities') {
        await ctx.reply(t.paymentAddUsage)
        return
      }

      try {
        const dashboard = await resolved.service.generateDashboard()
        if (!dashboard) {
          await ctx.reply(t.paymentNoCycle)
          return
        }

        const currentMember = dashboard.members.find(
          (member) => member.memberId === resolved.member.id
        )
        if (!currentMember) {
          await ctx.reply(t.notMember)
          return
        }

        const inferredAmount =
          kind === 'rent'
            ? currentMember.rentShare
            : currentMember.netDue.subtract(currentMember.rentShare)

        if (args[1] === undefined && inferredAmount.amountMinor <= 0n) {
          await ctx.reply(t.paymentNoBalance)
          return
        }

        const amountArg = args[1] ?? inferredAmount.toMajorString()
        const currencyArg = args[2]
        const result = await resolved.service.addPayment(
          resolved.member.id,
          kind,
          amountArg,
          currencyArg
        )

        if (!result) {
          await ctx.reply(t.paymentNoCycle)
          return
        }

        await recordCommandAudit({
          resolved,
          category: 'payment_events',
          eventType: 'payment.recorded',
          summaryText: `${resolved.member.displayName} recorded ${kind} payment: ${formatUserFacingMoney(result.amount.toMajorString(), result.currency)} (${result.period})`,
          metadata: {
            paymentId: result.paymentId,
            memberId: resolved.member.id,
            kind,
            amountMinor: result.amount.amountMinor.toString(),
            currency: result.currency,
            period: result.period
          }
        })
        await ctx.reply(
          t.paymentAdded(kind, result.amount.toMajorString(), result.currency, result.period)
        )
      } catch (error) {
        await ctx.reply(t.paymentAddFailed((error as Error).message))
      }
    })

    bot.command('statement', async (ctx) => {
      const locale = await resolveReplyLocale({
        ctx,
        repository: options.householdConfigurationRepository
      })
      const t = getBotTranslations(locale).finance
      const resolved = await requireMember(ctx)
      if (!resolved) {
        return
      }

      try {
        const dashboard = await resolved.service.generateDashboard(commandArgs(ctx)[0])
        if (!dashboard) {
          await ctx.reply(t.noStatementCycle)
          return
        }

        await ctx.reply(formatStatement(locale, dashboard))
      } catch (error) {
        await ctx.reply(t.statementFailed((error as Error).message))
      }
    })

    bot.command('utilities', async (ctx) => {
      if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') {
        return
      }

      const locale = await resolveReplyLocale({
        ctx,
        repository: options.householdConfigurationRepository
      })
      const tf = getBotTranslations(locale).finance

      const threadId =
        ctx.msg && 'message_thread_id' in ctx.msg && ctx.msg.message_thread_id !== undefined
          ? ctx.msg.message_thread_id.toString()
          : null

      if (!threadId) {
        await ctx.reply(tf.utilitiesTopicRequired)
        return
      }

      const binding =
        await options.householdConfigurationRepository.findHouseholdTopicByTelegramContext({
          telegramChatId: ctx.chat.id.toString(),
          telegramThreadId: threadId
        })

      if (!binding) {
        await ctx.reply(tf.utilitiesNotLinked)
        return
      }

      const telegramUserId = ctx.from?.id?.toString()
      if (!telegramUserId) {
        return
      }

      const financeService = options.financeServiceForHousehold(binding.householdId)
      const [householdLocale, member, settings, categories, _cycle] = await Promise.all([
        resolveReplyLocale({
          ctx,
          repository: options.householdConfigurationRepository,
          householdId: binding.householdId
        }),
        financeService.getMemberByTelegramUserId(telegramUserId),
        options.householdConfigurationRepository.getHouseholdBillingSettings(binding.householdId),
        options.householdConfigurationRepository.listHouseholdUtilityCategories(
          binding.householdId
        ),
        financeService.ensureExpectedCycle()
      ])

      if (!member) {
        await ctx.reply(getBotTranslations(householdLocale).finance.notMember)
        return
      }

      const tr = getBotTranslations(householdLocale).reminders
      const activeCategories = categories
        .filter((category) => category.isActive)
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map((category) => category.name)

      if (activeCategories.length === 0) {
        await ctx.reply(tr.noActiveCategories)
        return
      }

      const { text, parseMode } = buildTemplateText(
        householdLocale,
        settings.settlementCurrency,
        activeCategories
      )

      if (options.promptRepository) {
        await options.promptRepository.upsertPendingAction({
          telegramUserId,
          telegramChatId: ctx.chat.id.toString(),
          action: REMINDER_UTILITY_ACTION,
          payload: {
            stage: 'template',
            householdId: binding.householdId,
            threadId,
            period: _cycle.period,
            currency: settings.settlementCurrency,
            memberId: member.id,
            categories: activeCategories
          },
          expiresAt: nowInstant().add({ milliseconds: REMINDER_UTILITY_ACTION_TTL_MS })
        })
      }

      await ctx.reply(text, {
        parse_mode: parseMode,
        reply_parameters: {
          message_id: ctx.msg?.message_id ?? 0
        }
      })
    })
  }

  return {
    register
  }
}
