import type {
  FinanceCommandService,
  HouseholdAuditNotificationService
} from '@household/application'
import {
  formatDayDisplay,
  formatMoneyDisplay,
  formatMonthDisplay,
  Money,
  nowInstant
} from '@household/domain'
import type {
  HouseholdConfigurationRepository,
  TelegramPendingActionRepository
} from '@household/ports'
import type { Bot, Context } from 'grammy'

import { ackCallbackQuery } from './telegram-callback-guards'
import { getBotTranslations, type BotLocale } from './i18n'
import { financeViewCopy } from './i18n/finance-views'
import { serializeUtilityResolutionAssignments } from './audit-metadata'
import { escapeHtml } from './html'
import { resolveReplyLocale } from './bot-locale'
import {
  buildTelegramHomeMenuButton,
  TELEGRAM_HOME_BALANCES_CALLBACK,
  TELEGRAM_HOME_MY_BILL_CALLBACK,
  TELEGRAM_HOME_MY_BILL_FULL_CALLBACK,
  TELEGRAM_HOME_STATUS_CALLBACK
} from './home-menu'
import { tryEditMessageText } from './telegram-message-edit'
import type { LivePaymentCardService } from './live-payment-cards'
import { buildScheduledPaymentReminderContent } from './payment-reminder-content'

type FinanceDashboardForBot = NonNullable<
  Awaited<ReturnType<FinanceCommandService['generateDashboard']>>
>
type FinanceBillPlanForBot = NonNullable<
  Awaited<ReturnType<FinanceCommandService['generateCurrentBillPlan']>>
>
type InlineCallbackButton = { text: string; callback_data: string }

const BILL_SHOW_CALLBACK_PREFIX = 'bill:show:'
const BILL_VIEW_CALLBACK_PREFIX = 'bill:view:'
const PERSONAL_BILL_SHOW_CALLBACK_PREFIX = 'my_bill:show:'
const BILL_RESOLVE_CALLBACK_PREFIX = 'bill:resolve:'
const STATUS_SHOW_CALLBACK_PREFIX = 'status:show:'
const STATUS_DETAILS_CALLBACK_PREFIX = 'status:details:'
const STATUS_BALANCES_CALLBACK_PREFIX = 'status:balances:'
const HOME_BALANCE_SHOW_CALLBACK_PREFIX = 'home:bal:'
const BILL_SHOW_PENDING_ACTION = 'bill_command'
const BILL_PENDING_ACTION_TTL_MS = 1000 * 60 * 60

/** Which of the three /bill views a message shows, so its switch row offers the other two. */
type BillView = 'household' | 'full' | 'viewer' | 'mine'

function callbackPrefixPattern(prefix: string): RegExp {
  return new RegExp(`^${prefix}`)
}

function commandArgs(ctx: Context): string[] {
  const raw = typeof ctx.match === 'string' ? ctx.match.trim() : ''
  if (raw.length === 0) {
    return []
  }

  return raw.split(/\s+/).filter(Boolean)
}

function money(amount: Money, locale: BotLocale, currency: string = amount.currency): string {
  return formatMoneyDisplay(amount.amountMinor, currency, locale)
}

function absoluteMoney(amount: Money, locale: BotLocale, currency: string): string {
  const absoluteMinor = amount.amountMinor < 0n ? -amount.amountMinor : amount.amountMinor
  return formatMoneyDisplay(absoluteMinor, currency, locale)
}

function capitalize(text: string): string {
  return text.length > 0 ? `${text[0]!.toUpperCase()}${text.slice(1)}` : text
}

/** The household's utilities due date for a `YYYY-MM` period, as `YYYY-MM-DD`. */
function cycleDueDate(period: string, dueDay: number): string | null {
  const match = /^(\d{4})-(\d{2})$/.exec(period)
  if (!match) {
    return null
  }

  const year = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12) {
    return null
  }

  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const day = Math.min(Math.max(dueDay, 1), maxDay)
  return `${match[1]}-${match[2]}-${String(day).padStart(2, '0')}`
}

function utilitiesDueDay(locale: BotLocale, dashboard: FinanceDashboardForBot): string {
  const dueDate =
    dashboard.utilityBillingPlan?.dueDate ??
    cycleDueDate(dashboard.period, dashboard.utilitiesDueDay) ??
    dashboard.period
  return formatDayDisplay(dueDate, locale)
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

function formatFxRateMicros(rateMicros: bigint): string {
  const whole = rateMicros / 1_000_000n
  const fraction = (rateMicros % 1_000_000n).toString().padStart(6, '0')
  const significantFraction = fraction.replace(/0+$/u, '').padEnd(4, '0')
  return `${whole.toString()}.${significantFraction}`
}

function formatRentConversionLine(input: {
  locale: BotLocale
  conversion: FinanceBillPlanForBot['rentConversion']
}): string | null {
  if (
    input.conversion.sourceAmount.currency === input.conversion.settlementAmount.currency ||
    input.conversion.rateMicros === null ||
    input.conversion.rateMicros <= 0n
  ) {
    return null
  }

  const t = financeViewCopy[input.locale]
  const rate = t.rentRate(
    input.conversion.sourceAmount.currency,
    formatFxRateMicros(input.conversion.rateMicros),
    input.conversion.settlementAmount.currency
  )

  return input.conversion.effectiveDate
    ? `${rate} ${t.rentRateAsOf(escapeHtml(formatDayDisplay(input.conversion.effectiveDate, input.locale)))}`
    : rate
}

/** "в плюсе 10 ₾" / "к доплате 15 ₾", or null when purchases are even. */
function formatPurchaseBalancePhrase(input: {
  locale: BotLocale
  amount: Money
  currency: 'USD' | 'GEL'
}): string | null {
  if (input.amount.amountMinor === 0n) {
    return null
  }

  const t = financeViewCopy[input.locale]
  const amountText = absoluteMoney(input.amount, input.locale, input.currency)
  return input.amount.amountMinor < 0n ? t.purchaseCredit(amountText) : t.purchaseDue(amountText)
}

function formatPurchaseBalanceLine(input: {
  locale: BotLocale
  amount: Money
  currency: 'USD' | 'GEL'
  /** Appends how the balance is settled. Off for inline lists that have no room. */
  explainSettlement?: boolean
}): string | null {
  const phrase = formatPurchaseBalancePhrase(input)
  if (!phrase) {
    return null
  }

  const t = financeViewCopy[input.locale]
  // Nobody transfers this to anybody: it lands in the next cycle's utility share.
  // Left unsaid, the figure reads as a debt to a housemate to go and settle now.
  const settlesVia = input.explainSettlement
    ? `, ${input.amount.amountMinor < 0n ? t.creditComesBack : t.dueGoesIn}`
    : ''

  return `${t.purchases}: ${phrase}${settlesVia}`
}

function formatRemainingCreditPhrase(input: {
  locale: BotLocale
  amount: Money
  currency: 'USD' | 'GEL'
}): string | null {
  if (input.amount.amountMinor === 0n) {
    return null
  }

  const t = financeViewCopy[input.locale]
  const amountText = absoluteMoney(input.amount, input.locale, input.currency)
  return input.amount.amountMinor < 0n
    ? t.afterUtilitiesCredit(amountText)
    : t.afterUtilitiesDue(amountText)
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

/** "коммуналка до 6 мая" for the payment window that is open now, or null between windows. */
function formatStagePhrase(locale: BotLocale, dashboard: FinanceDashboardForBot): string | null {
  const t = financeViewCopy[locale]
  if (dashboard.billingStage === 'utilities') {
    return t.utilitiesDue(utilitiesDueDay(locale, dashboard))
  }

  if (dashboard.billingStage === 'rent') {
    return t.rentDue(formatDayDisplay(dashboard.rentBillingState.dueDate, locale))
  }

  return null
}

function formatHouseholdLeadLine(locale: BotLocale, dashboard: FinanceDashboardForBot): string {
  const t = financeViewCopy[locale]
  const total =
    dashboard.totalRemaining.amountMinor === 0n
      ? t.allPaid
      : t.totalLeft(money(dashboard.totalRemaining, locale, dashboard.currency))
  const stage = formatStagePhrase(locale, dashboard)

  return stage ? `${total} · ${stage}` : total
}

function formatHouseholdRentAmount(locale: BotLocale, dashboard: FinanceDashboardForBot): string {
  const displayAmount = money(dashboard.rentDisplayAmount, locale, dashboard.currency)
  if (dashboard.rentSourceAmount.currency === dashboard.rentDisplayAmount.currency) {
    return displayAmount
  }

  return `${money(dashboard.rentSourceAmount, locale)} (~${displayAmount})`
}

function formatHouseholdRentOverviewLine(
  locale: BotLocale,
  dashboard: FinanceDashboardForBot
): string {
  const t = financeViewCopy[locale]
  const remaining = formatDashboardRentDueNow(dashboard)
  return [
    `${t.rent}: ${formatHouseholdRentAmount(locale, dashboard)}`,
    t.dueBy(formatDayDisplay(dashboard.rentBillingState.dueDate, locale)),
    remaining.amountMinor > 0n ? t.left(money(remaining, locale, dashboard.currency)) : null
  ]
    .filter(Boolean)
    .join(' · ')
}

function formatHouseholdUtilityOverviewLine(
  locale: BotLocale,
  dashboard: FinanceDashboardForBot
): string {
  const t = financeViewCopy[locale]
  const total = formatDashboardUtilityTotal(dashboard)
  const dueNow = formatDashboardUtilityDueNow(dashboard)

  return [
    `${t.utilities}: ${money(total, locale, dashboard.currency)}`,
    t.dueBy(utilitiesDueDay(locale, dashboard)),
    dueNow.amountMinor > 0n ? t.left(money(dueNow, locale, dashboard.currency)) : null
  ]
    .filter(Boolean)
    .join(' · ')
}

function formatHouseholdStatusMemberValue(input: {
  locale: BotLocale
  member: FinanceDashboardForBot['members'][number]
}): string {
  const t = financeViewCopy[input.locale]
  if (input.member.remaining.amountMinor > 0n) {
    return money(input.member.remaining, input.locale)
  }

  const coveredByPurchaseCredit =
    input.member.paid.amountMinor === 0n &&
    input.member.purchaseOffset.amountMinor < 0n &&
    (input.member.utilityShare.amountMinor > 0n || input.member.rentShare.amountMinor > 0n)

  return coveredByPurchaseCredit ? t.memberCoveredByPurchases : t.memberSettled
}

function formatHouseholdMemberStatusLabel(
  locale: BotLocale,
  status: FinanceDashboardForBot['members'][number]['status']
): string | null {
  if (!status || status === 'active') {
    return null
  }

  const t = financeViewCopy[locale]
  return status === 'away' ? t.memberAway : t.memberLeft
}

function formatHouseholdStatusMemberLines(
  locale: BotLocale,
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
    const value = formatHouseholdStatusMemberValue({ locale, member })
    return `• ${member.displayName}${statusLabel ? ` (${statusLabel})` : ''} — ${value}`
  })
}

function formatHouseholdPurchasePolicyLine(
  locale: BotLocale,
  dashboard: FinanceDashboardForBot
): string | null {
  if (dashboard.members.every((member) => member.purchaseOffset.amountMinor === 0n)) {
    return null
  }

  const t = financeViewCopy[locale]
  if (dashboard.paymentBalanceAdjustmentPolicy === 'utilities') {
    return t.purchasesGoToUtilities
  }

  if (dashboard.paymentBalanceAdjustmentPolicy === 'rent') {
    return t.purchasesGoToRent
  }

  return t.purchasesSeparate
}

function truncateStatusTitle(title: string): string {
  return title.length > 34 ? `${title.slice(0, 31).trim()}…` : title
}

function formatActivityDay(locale: BotLocale, occurredAt: string | null): string | null {
  if (!occurredAt) {
    return null
  }

  const instant = new Date(occurredAt)
  if (Number.isNaN(instant.getTime())) {
    return null
  }

  return formatDayDisplay(instant.toISOString().slice(0, 10), locale)
}

function formatHouseholdActivityLines(
  locale: BotLocale,
  dashboard: FinanceDashboardForBot,
  kind: 'purchase' | 'payment'
): string[] {
  const t = financeViewCopy[locale]
  return dashboard.ledger
    .filter((entry) => entry.kind === kind)
    .sort((left, right) => (right.occurredAt ?? '').localeCompare(left.occurredAt ?? ''))
    .slice(0, 2)
    .map((entry) => {
      const title =
        kind === 'payment'
          ? entry.paymentKind === 'rent'
            ? t.rentPayment
            : t.utilitiesPayment
          : truncateStatusTitle(entry.title)
      const subject = entry.actorDisplayName
        ? `${entry.actorDisplayName}: ${title}`
        : capitalize(title)
      return `• ${[
        subject,
        money(entry.displayAmount, locale, entry.displayCurrency),
        formatActivityDay(locale, entry.occurredAt)
      ]
        .filter(Boolean)
        .join(' · ')}`
    })
}

function formatUtilityAssignmentLine(input: {
  locale: BotLocale
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
  const t = financeViewCopy[input.locale]
  const amountText = money(input.category.assignedAmount, input.locale, input.currency)
  const line = input.category.isFullAssignment
    ? `${input.category.billName} — ${amountText}`
    : `${input.category.billName} — ${amountText} ${t.of} ${money(
        input.category.billTotal,
        input.locale,
        input.currency
      )}`

  const detailLines = [
    input.category.paidAmount.amountMinor > 0n
      ? t.billAlreadyPaid(money(input.category.paidAmount, input.locale, input.currency))
      : null,
    input.details?.providerName ? t.billProvider(input.details.providerName) : null,
    input.details?.customerNumber ? t.billCustomerNumber(input.details.customerNumber) : null,
    input.details?.paymentLink ? t.billLink(input.details.paymentLink) : null,
    input.details?.note ? t.billNote(input.details.note) : null
  ].filter(Boolean)

  return detailLines.length > 0 ? `• ${line}\n  ${detailLines.join('\n  ')}` : `• ${line}`
}

/** "Gas" for a single bill covering the whole amount, "Свет 56.86 ₾, Газ 20.31 ₾" otherwise. */
function formatUtilityAssignmentSummary(input: {
  locale: BotLocale
  currency: 'USD' | 'GEL'
  payNow: Money
  categories: readonly {
    billName: string
    assignedAmount: Money
  }[]
}): string | null {
  if (input.categories.length === 0) {
    return null
  }

  const [onlyCategory] = input.categories
  if (
    input.categories.length === 1 &&
    onlyCategory!.assignedAmount.amountMinor === input.payNow.amountMinor
  ) {
    return onlyCategory!.billName
  }

  return input.categories
    .map(
      (category) =>
        `${category.billName} ${money(category.assignedAmount, input.locale, input.currency)}`
    )
    .join(', ')
}

function formatUtilityMemberBlock(input: {
  locale: BotLocale
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
}): string {
  const t = financeViewCopy[input.locale]
  const isFullyPaid =
    input.payNow.amountMinor === 0n && input.summary && input.summary.vendorPaid.amountMinor > 0n
  const isCoveredByBalance =
    input.payNow.amountMinor === 0n &&
    !isFullyPaid &&
    input.balance &&
    input.balance.utilityShare.amountMinor > 0n &&
    input.balance.purchaseOffset.amountMinor < 0n

  // What is left of the purchase balance once this cycle's utility share is taken out.
  const remainingBalance =
    input.balance && input.summary
      ? input.balance.purchaseOffset.add(input.balance.utilityShare)
      : null
  const purchaseBalanceLine =
    input.balance && input.summary
      ? formatPurchaseBalanceLine({
          locale: input.locale,
          amount: input.balance.purchaseOffset,
          currency: input.currency,
          explainSettlement: true
        })
      : null

  // No total here: it is the sum of the two figures beside it, and for a member the
  // plan assigns nothing it contradicts the line underneath — a target of 29.82 sitting
  // above "nothing to pay" is what sends people asking who they owe it to.
  const balanceLine =
    input.balance && input.summary
      ? [
          t.share(money(input.balance.utilityShare, input.locale, input.currency)),
          purchaseBalanceLine
        ]
          .filter(Boolean)
          .join(' · ')
      : null

  const payNowText = money(input.payNow, input.locale, input.currency)
  const lines: string[] = []
  if (input.viewerOnly) {
    if (balanceLine) {
      lines.push(balanceLine)
    }
    lines.push(
      input.payNow.amountMinor > 0n
        ? t.viewerLeft(payNowText)
        : isFullyPaid
          ? t.viewerPaid
          : isCoveredByBalance
            ? t.viewerCovered
            : t.viewerNothingToPay
    )
  } else {
    const status =
      input.payNow.amountMinor > 0n
        ? t.left(payNowText)
        : isFullyPaid
          ? t.memberPaid
          : isCoveredByBalance
            ? t.memberCovered
            : t.memberNothingToPay
    lines.push(`${input.displayName} — ${status}`)
    if (balanceLine) {
      lines.push(balanceLine)
    }
  }

  if (isCoveredByBalance && remainingBalance) {
    const remainingCredit = formatRemainingCreditPhrase({
      locale: input.locale,
      amount: remainingBalance,
      currency: input.currency
    })
    if (remainingCredit) {
      lines.push(capitalize(remainingCredit))
    }
  }

  const purchaseDrivers = input.balance?.purchaseDrivers ?? []
  if (purchaseDrivers.length > 0) {
    const sortedDrivers = [...purchaseDrivers].sort((left, right) => {
      const amountComparison = right.amount.compare(left.amount)
      if (amountComparison !== 0) {
        return amountComparison
      }

      return left.title.localeCompare(right.title)
    })
    lines.push(
      `${t.purchaseBreakdown}: ${sortedDrivers
        .map(
          (driver) =>
            `${driver.title} ${driver.direction === 'credit' ? '−' : '+'}${money(
              driver.amount,
              input.locale,
              input.currency
            )}`
        )
        .join('; ')}`
    )
  }

  if (input.payNow.amountMinor > 0n && input.categories.length > 0) {
    lines.push(...input.categories)
  } else if (input.payNow.amountMinor > 0n) {
    lines.push(t.utilitiesNothingThisMonth)
  }

  return lines.join('\n')
}

type RentPaymentDestinationForBot = {
  label: string
  recipientName: string | null
  bankName: string | null
  account: string
  note: string | null
  link: string | null
}

function formatRentDestinationSection(input: {
  locale: BotLocale
  destinations: readonly RentPaymentDestinationForBot[]
}): string[] {
  if (input.destinations.length === 0) {
    return []
  }

  const t = financeViewCopy[input.locale]
  return [
    t.whereToPay,
    ...input.destinations.flatMap((destination) => {
      const destinationTitle = [destination.bankName, destination.label]
        .filter((value): value is string => Boolean(value))
        .join(' · ')
      const detailLines = [
        destination.recipientName ? t.recipient(escapeHtml(destination.recipientName)) : null,
        t.account(escapeHtml(destination.account)),
        destination.link ? t.link(escapeHtml(destination.link)) : null,
        destination.note ? t.note(escapeHtml(destination.note)) : null
      ].filter((line): line is string => line !== null)

      return [`<b>${escapeHtml(destinationTitle)}</b>`, ...detailLines, '']
    })
  ]
}

function buildRentAccountCopyButtonRows(input: {
  locale: BotLocale
  destinations: readonly {
    label: string
    bankName: string | null
    account: string
  }[]
}): Array<Array<{ text: string; copy_text: { text: string } }>> {
  const t = financeViewCopy[input.locale]
  const buttons = input.destinations.flatMap((destination) => {
    if (destination.account.length === 0 || destination.account.length > 256) {
      return []
    }

    return [
      {
        text: t.copyAccountButton((destination.bankName ?? destination.label).slice(0, 40)),
        copy_text: { text: destination.account }
      }
    ]
  })

  const rows: Array<Array<{ text: string; copy_text: { text: string } }>> = []
  for (let index = 0; index < buttons.length; index += 2) {
    rows.push(buttons.slice(index, index + 2))
  }
  return rows
}

function billViewRow(locale: BotLocale, current: BillView): InlineCallbackButton[] {
  const t = financeViewCopy[locale]
  const household = {
    text: t.householdBillButton,
    callback_data: `${BILL_VIEW_CALLBACK_PREFIX}household`
  }
  const mine = { text: t.myBillButton, callback_data: `${BILL_VIEW_CALLBACK_PREFIX}mine` }

  switch (current) {
    case 'household':
      return [mine, { text: t.detailsButton, callback_data: `${BILL_VIEW_CALLBACK_PREFIX}full` }]
    case 'full':
    case 'viewer':
      return [household, mine]
    case 'mine':
      return [
        household,
        { text: t.detailsButton, callback_data: TELEGRAM_HOME_MY_BILL_FULL_CALLBACK }
      ]
  }
}

export function createFinanceCommandsService(options: {
  householdConfigurationRepository: HouseholdConfigurationRepository
  financeServiceForHousehold: (householdId: string) => FinanceCommandService
  promptRepository?: TelegramPendingActionRepository
  miniAppUrl?: string
  botUsername?: string
  auditNotificationService?: HouseholdAuditNotificationService
  livePaymentCardService?: LivePaymentCardService
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
      ctx.from.id.toString(),
      BILL_SHOW_PENDING_ACTION
    )
    if (!action || action.action !== BILL_SHOW_PENDING_ACTION) {
      return null
    }

    return action
  }

  function homeMenuRow(locale: BotLocale): InlineCallbackButton[] {
    return [buildTelegramHomeMenuButton(getBotTranslations(locale).home.menuButton)]
  }

  function homeMenuReplyMarkup(locale: BotLocale): {
    inline_keyboard: InlineCallbackButton[][]
  } {
    return {
      inline_keyboard: [homeMenuRow(locale)]
    }
  }

  function appendHomeMenuRow(
    locale: BotLocale,
    rows: InlineCallbackButton[][]
  ): InlineCallbackButton[][] {
    return [...rows, homeMenuRow(locale)]
  }

  async function replyOrEditText(input: {
    ctx: Context
    text: string
    options?: Parameters<Context['reply']>[1]
    editMessage?: boolean | undefined
  }) {
    if (
      input.editMessage &&
      (await tryEditMessageText(
        input.ctx,
        input.text,
        input.options as Parameters<Context['editMessageText']>[1]
      ))
    ) {
      return null
    }

    return input.ctx.reply(input.text, input.options)
  }

  async function replyOrEditWithHomeMenu(input: {
    ctx: Context
    locale: BotLocale
    text: string
    editMessage?: boolean | undefined
  }) {
    await replyOrEditText({
      ctx: input.ctx,
      text: input.text,
      options: {
        reply_markup: homeMenuReplyMarkup(input.locale)
      },
      editMessage: input.editMessage
    })
  }

  function formatBalances(locale: BotLocale, dashboard: FinanceDashboardForBot): string {
    const t = financeViewCopy[locale]
    const purchases = dashboard.ledger.filter(
      (entry) => entry.kind === 'purchase' && entry.resolutionStatus === 'unresolved'
    )

    const memberBalances = dashboard.members
      .map((member) => {
        const memberPurchases = purchases.filter(
          (purchase) => purchase.payerMemberId === member.memberId
        )
        const balancePhrase = formatPurchaseBalancePhrase({
          locale,
          amount: member.purchaseOffset,
          currency: dashboard.currency
        })

        const purchaseLines = memberPurchases.map((purchase) => {
          let split: string | null = null
          if (purchase.purchaseParticipants) {
            const includedParticipants = purchase.purchaseParticipants.filter((p) => p.included)
            split =
              includedParticipants.length === dashboard.members.length
                ? t.splitEveryone
                : t.splitOnly(
                    includedParticipants
                      .map(
                        (participant) =>
                          dashboard.members.find((item) => item.memberId === participant.memberId)
                            ?.displayName ?? '?'
                      )
                      .join(', ')
                  )
          }

          return `• ${[
            escapeHtml(purchase.title),
            money(purchase.displayAmount, locale, dashboard.currency),
            split ? escapeHtml(split) : null
          ]
            .filter(Boolean)
            .join(' · ')}`
        })

        if (!balancePhrase && purchaseLines.length === 0) {
          return null
        }

        return [
          `<b>${escapeHtml(member.displayName)}</b>${balancePhrase ? ` · ${balancePhrase}` : ''}`,
          ...purchaseLines
        ].join('\n')
      })
      .filter((block): block is string => block !== null)

    return [
      t.purchasesTitle(escapeHtml(formatMonthDisplay(dashboard.period, locale))),
      '',
      ...(memberBalances.length > 0
        ? memberBalances.flatMap((block, index) =>
            index < memberBalances.length - 1 ? [block, ''] : [block]
          )
        : [t.noOpenPurchases])
    ].join('\n')
  }

  async function replyWithBalances(input: {
    ctx: Context
    locale: BotLocale
    service: FinanceCommandService
    periodArg?: string
    editMessage?: boolean | undefined
  }) {
    const dashboard = await input.service.generateDashboard(input.periodArg)
    if (!dashboard) {
      await replyOrEditWithHomeMenu({
        ctx: input.ctx,
        locale: input.locale,
        text: financeViewCopy[input.locale].noMonth,
        editMessage: input.editMessage
      })
      return
    }

    await replyOrEditText({
      ctx: input.ctx,
      text: formatBalances(input.locale, dashboard),
      options: {
        parse_mode: 'HTML',
        reply_markup: homeMenuReplyMarkup(input.locale)
      },
      editMessage: input.editMessage
    })
  }

  async function replyWithRequestedBalances(input: {
    ctx: Context
    locale: BotLocale
    editMessage?: boolean | undefined
  }) {
    const t = financeViewCopy[input.locale]
    const telegramUserId = input.ctx.from?.id?.toString()
    if (!telegramUserId) {
      await replyOrEditWithHomeMenu({
        ctx: input.ctx,
        locale: input.locale,
        text: t.unableToIdentifySender,
        editMessage: input.editMessage
      })
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
        service: resolved.service,
        editMessage: input.editMessage
      })
      return
    }

    const memberships =
      await options.householdConfigurationRepository.listHouseholdMembersByTelegramUserId(
        telegramUserId
      )
    if (memberships.length === 0) {
      await replyOrEditWithHomeMenu({
        ctx: input.ctx,
        locale: input.locale,
        text: t.notMember,
        editMessage: input.editMessage
      })
      return
    }

    if (memberships.length === 1) {
      await replyWithBalances({
        ctx: input.ctx,
        locale: input.locale,
        service: options.financeServiceForHousehold(memberships[0]!.householdId),
        editMessage: input.editMessage
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
    await replyOrEditText({
      ctx: input.ctx,
      text: t.chooseHousehold,
      options: {
        reply_markup: {
          inline_keyboard: [
            ...households.map(({ household }, index) => [
              {
                text:
                  household?.householdName ??
                  `${financeViewCopy[input.locale].household} ${index + 1}`,
                callback_data: `${HOME_BALANCE_SHOW_CALLBACK_PREFIX}${index}`
              }
            ]),
            homeMenuRow(input.locale)
          ]
        }
      },
      editMessage: input.editMessage
    })
  }

  function formatHouseholdStatus(
    locale: BotLocale,
    dashboard: FinanceDashboardForBot,
    householdName?: string | null
  ): string {
    const t = financeViewCopy[locale]
    const purchasePolicyLine = formatHouseholdPurchasePolicyLine(locale, dashboard)
    const activityLines = [
      ...formatHouseholdActivityLines(locale, dashboard, 'purchase'),
      ...formatHouseholdActivityLines(locale, dashboard, 'payment')
    ]
    const memberLines = formatHouseholdStatusMemberLines(locale, dashboard)
    const hiddenMemberCount = Math.max(dashboard.members.length - memberLines.length, 0)

    return [
      t.overviewTitle(householdName ?? t.household, formatMonthDisplay(dashboard.period, locale)),
      formatHouseholdLeadLine(locale, dashboard),
      '',
      formatHouseholdRentOverviewLine(locale, dashboard),
      formatHouseholdUtilityOverviewLine(locale, dashboard),
      ...(purchasePolicyLine ? [purchasePolicyLine] : []),
      ...(activityLines.length > 0 ? ['', t.recentTitle, ...activityLines] : []),
      ...(memberLines.length > 0
        ? [
            '',
            t.membersTitle,
            ...memberLines,
            ...(hiddenMemberCount > 0 ? [`• ${t.more(hiddenMemberCount)}`] : [])
          ]
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
    const t = financeViewCopy[locale]
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
      householdName: household.householdName ?? household.title ?? null
    }
  }

  async function requireMember(ctx: Context) {
    const locale = await resolveReplyLocale({
      ctx,
      repository: options.householdConfigurationRepository
    })
    const t = financeViewCopy[locale]
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

  async function recordCommandAudit(input: {
    resolved: NonNullable<Awaited<ReturnType<typeof requireMember>>>
    category: 'plan_events'
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
    locale: BotLocale
    period: string
    plan: NonNullable<FinanceBillPlanForBot['utilityBillingPlan']>
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
    const t = financeViewCopy[input.locale]
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
            if (input.detailMode === 'full') {
              return formatUtilityMemberBlock({
                locale: input.locale,
                currency: input.currency,
                displayName: entry.displayName,
                payNow: entry.payNow,
                summary: entry.summary,
                balance: entry.balance,
                categories:
                  entry.payNow.amountMinor === 0n && !input.viewerMemberId
                    ? []
                    : entry.memberCategories.map((category) => {
                        const details = categoryDetailsByName.get(
                          category.billName.trim().toLowerCase()
                        )
                        return formatUtilityAssignmentLine({
                          locale: input.locale,
                          currency: input.currency,
                          category,
                          ...(details ? { details } : {})
                        })
                      }),
                viewerOnly: Boolean(input.viewerMemberId)
              })
            }

            const purchaseBalanceLine = entry.balance
              ? formatPurchaseBalanceLine({
                  locale: input.locale,
                  amount: entry.balance.purchaseOffset,
                  currency: input.currency,
                  explainSettlement: true
                })
              : null

            if (entry.payNow.amountMinor === 0n) {
              const isFullyPaid = Boolean(
                entry.summary && entry.summary.vendorPaid.amountMinor > 0n
              )
              const isCoveredByBalance =
                !isFullyPaid &&
                Boolean(entry.balance) &&
                entry.balance!.utilityShare.amountMinor > 0n &&
                entry.balance!.purchaseOffset.amountMinor < 0n
              // Owing nothing is not the same as having paid. A redraw can take
              // a member's assignment away entirely, and telling them they paid
              // for a bill they never touched is worse than saying nothing.
              const status = isFullyPaid
                ? t.memberPaid
                : isCoveredByBalance
                  ? t.memberCovered
                  : t.memberNothingToPay
              const remainingCredit =
                isCoveredByBalance && entry.balance && entry.summary
                  ? formatRemainingCreditPhrase({
                      locale: input.locale,
                      amount: entry.balance.purchaseOffset.add(entry.balance.utilityShare),
                      currency: input.currency
                    })
                  : null

              return [
                `• ${entry.displayName} — ${status}${remainingCredit ? `, ${remainingCredit}` : ''}`,
                ...(!isCoveredByBalance && purchaseBalanceLine ? [`  ${purchaseBalanceLine}`] : [])
              ].join('\n')
            }

            const bills = formatUtilityAssignmentSummary({
              locale: input.locale,
              currency: input.currency,
              payNow: entry.payNow,
              categories: entry.memberCategories
            })
            return [
              `• ${entry.displayName} — ${money(entry.payNow, input.locale, input.currency)}${
                bills ? `: ${bills}` : ''
              }`,
              ...(purchaseBalanceLine ? [`  ${purchaseBalanceLine}`] : [])
            ].join('\n')
          })
        : [t.utilitiesUnassigned]

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
    // Even share per person, rounded half up to the minor unit.
    const memberCount = BigInt(input.plan.memberSummaries.length || 1)
    const baseShare = Money.fromMinor(
      (totalBills.amountMinor * 2n + memberCount) / (2n * memberCount),
      input.currency
    )

    const month = formatMonthDisplay(input.period, input.locale)
    const dueDay = formatDayDisplay(input.plan.dueDate, input.locale)

    return [
      input.detailMode === 'compact'
        ? t.utilitiesTitle(month, dueDay)
        : t.utilitiesDetailsTitle(month, dueDay),
      // No bills entered yet: a zero total would only add noise above the members.
      ...(totalBills.amountMinor > 0n
        ? [
            t.billsTotal(
              money(totalBills, input.locale, input.currency),
              money(baseShare, input.locale, input.currency)
            )
          ]
        : []),
      '',
      memberBlocks.join(input.detailMode === 'compact' ? '\n' : '\n\n')
    ].join('\n')
  }

  function formatRentBillState(input: {
    locale: BotLocale
    householdName?: string | null | undefined
    period: string
    state: FinanceBillPlanForBot['rentBillingState']
    conversion: FinanceBillPlanForBot['rentConversion']
    currency: 'USD' | 'GEL'
    viewerMemberId?: string | null
    orderMemberId?: string | null
  }): string {
    const t = financeViewCopy[input.locale]
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
    const conversionLine = formatRentConversionLine({
      locale: input.locale,
      conversion: input.conversion
    })
    const amountText = (amount: Money) => escapeHtml(money(amount, input.locale, input.currency))

    let leadLine: string | null
    let memberLines: string[]
    if (input.viewerMemberId) {
      const viewer = visibleMembers[0]
      leadLine =
        viewer && viewer.remaining.amountMinor > 0n
          ? t.rentViewerDue(amountText(viewer.remaining))
          : viewer
            ? t.rentViewerPaid
            : null
      memberLines = []
    } else {
      const totalRemaining = input.state.memberSummaries.reduce(
        (sum, member) => sum.add(member.remaining),
        Money.zero(input.currency)
      )
      leadLine =
        totalRemaining.amountMinor > 0n ? t.totalLeft(amountText(totalRemaining)) : t.allPaid
      memberLines = visibleMembers.map(
        (member) =>
          `<b>${escapeHtml(member.displayName)}</b> — ${
            member.remaining.amountMinor > 0n ? amountText(member.remaining) : t.rentMemberPaid
          }`
      )
    }

    return [
      t.rentTitle(
        escapeHtml(formatMonthDisplay(input.period, input.locale)),
        escapeHtml(formatDayDisplay(input.state.dueDate, input.locale))
      ),
      ...(input.householdName ? [escapeHtml(input.householdName)] : []),
      ...(leadLine ? [leadLine] : []),
      ...(conversionLine ? [conversionLine] : []),
      ...(memberLines.length > 0 ? ['', ...memberLines] : []),
      ...(destinationLines.length > 0 ? ['', ...destinationLines] : [])
    ]
      .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
      .join('\n')
      .trim()
  }

  function formatIdleBillState(input: {
    locale: BotLocale
    householdName?: string | null | undefined
    plan: FinanceBillPlanForBot
  }): string {
    const t = financeViewCopy[input.locale]
    const utilitiesDueDate = input.plan.utilityBillingPlan?.dueDate
    return [
      t.idleTitle,
      ...(input.householdName ? [input.householdName] : []),
      ...(utilitiesDueDate
        ? [t.idleUtilitiesDue(formatDayDisplay(utilitiesDueDate, input.locale))]
        : []),
      t.idleRentDue(formatDayDisplay(input.plan.rentBillingState.dueDate, input.locale))
    ].join('\n')
  }

  function buildBillReply(input: {
    locale: BotLocale
    householdName?: string | null | undefined
    plan: FinanceBillPlanForBot
    utilityCategories: readonly {
      name: string
      providerName: string | null
      customerNumber: string | null
      paymentLink: string | null
      note: string | null
    }[]
    forcedMode?: 'utilities' | 'rent' | null
    viewerMemberId?: string | null
    orderMemberId?: string | null
    detailMode: 'compact' | 'full'
  }): {
    text: string
    parseMode?: 'HTML'
    copyButtonRows?: Array<Array<{ text: string; copy_text: { text: string } }>>
  } {
    const mode = input.forcedMode ?? input.plan.billingStage

    if (mode === 'utilities' && input.plan.utilityBillingPlan) {
      return {
        text: formatUtilityBillPlan({
          locale: input.locale,
          period: input.plan.period,
          plan: input.plan.utilityBillingPlan,
          currency: input.plan.currency,
          utilityCategories: input.utilityCategories,
          memberBalances: input.plan.members ?? [],
          detailMode: input.detailMode,
          ...(input.orderMemberId === undefined ? {} : { orderMemberId: input.orderMemberId }),
          ...(input.viewerMemberId === undefined ? {} : { viewerMemberId: input.viewerMemberId })
        })
      }
    }

    if (mode === 'rent') {
      return {
        text: formatRentBillState({
          locale: input.locale,
          householdName: input.householdName,
          period: input.plan.period,
          state: input.plan.rentBillingState,
          conversion: input.plan.rentConversion,
          currency: input.plan.currency,
          ...(input.orderMemberId === undefined ? {} : { orderMemberId: input.orderMemberId }),
          ...(input.viewerMemberId === undefined ? {} : { viewerMemberId: input.viewerMemberId })
        }),
        parseMode: 'HTML',
        copyButtonRows: buildRentAccountCopyButtonRows({
          locale: input.locale,
          destinations: input.plan.rentBillingState.paymentDestinations ?? []
        })
      }
    }

    return {
      text: formatIdleBillState({
        locale: input.locale,
        householdName: input.householdName,
        plan: input.plan
      })
    }
  }

  function activeUtilityCategories(
    categories: Awaited<
      ReturnType<HouseholdConfigurationRepository['listHouseholdUtilityCategories']>
    >
  ) {
    return categories
      .filter((category) => category.isActive)
      .map((category) => ({
        name: category.name,
        providerName: category.providerName ?? null,
        customerNumber: category.customerNumber ?? null,
        paymentLink: category.paymentLink ?? null,
        note: category.note ?? null
      }))
  }

  function formatPersonalBillSummary(input: {
    locale: BotLocale
    dashboard: FinanceDashboardForBot
    memberId: string
    householdName?: string | null
  }): string {
    const t = financeViewCopy[input.locale]
    const month = formatMonthDisplay(input.dashboard.period, input.locale)
    const title = input.householdName
      ? t.myBillTitleWithHousehold(input.householdName, month)
      : t.myBillTitle(month)
    const member = input.dashboard.members.find((item) => item.memberId === input.memberId)
    if (!member) {
      return [title, '', t.memberMissing].join('\n')
    }

    const currency = input.dashboard.currency
    const owes = member.remaining.amountMinor > 0n
    const stage = owes ? formatStagePhrase(input.locale, input.dashboard) : null
    const leadLine = owes ? t.myBillLeft(money(member.remaining, input.locale, currency)) : null
    const purchaseLine = formatPurchaseBalanceLine({
      locale: input.locale,
      amount: member.purchaseOffset,
      currency,
      explainSettlement: true
    })

    return [
      `${owes ? '⏳' : '✅'} ${title}`,
      leadLine ? (stage ? `${leadLine} · ${stage}` : leadLine) : t.myBillSettled,
      '',
      t.monthTotal(
        money(member.netDue, input.locale, currency),
        money(member.paid, input.locale, currency)
      ),
      `${t.rent}: ${money(member.rentShare, input.locale, currency)}`,
      `${t.utilities}: ${money(member.utilityShare, input.locale, currency)}`,
      ...(purchaseLine ? [purchaseLine] : [])
    ].join('\n')
  }

  function buildPersonalBillSummaryReplyMarkup(locale: BotLocale): {
    inline_keyboard: InlineCallbackButton[][]
  } {
    const t = financeViewCopy[locale]
    return {
      inline_keyboard: [
        billViewRow(locale, 'mine'),
        [
          { text: t.purchasesButton, callback_data: TELEGRAM_HOME_BALANCES_CALLBACK },
          { text: t.overviewButton, callback_data: TELEGRAM_HOME_STATUS_CALLBACK }
        ],
        homeMenuRow(locale)
      ]
    }
  }

  async function replyWithPersonalBillSummary(input: {
    ctx: Context
    locale: BotLocale
    service: FinanceCommandService
    householdId: string
    memberId: string
    householdName?: string | null
    editMessage?: boolean | undefined
  }) {
    const dashboard = await input.service.generateDashboard()
    const text = dashboard
      ? formatPersonalBillSummary({
          locale: input.locale,
          dashboard,
          memberId: input.memberId,
          ...(input.householdName === undefined ? {} : { householdName: input.householdName })
        })
      : financeViewCopy[input.locale].noMonth

    await storeBillPendingAction({
      ctx: input.ctx,
      payload: {
        kind: 'personal_summary',
        householdId: input.householdId,
        memberId: input.memberId
      }
    })
    await replyOrEditText({
      ctx: input.ctx,
      text,
      options: {
        reply_markup: buildPersonalBillSummaryReplyMarkup(input.locale)
      },
      editMessage: input.editMessage
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
    editMessage?: boolean | undefined
  }) {
    const locale = await resolveReplyLocale({
      ctx: input.ctx,
      repository: options.householdConfigurationRepository,
      householdId: input.householdId
    })
    const view: BillView = input.viewerMemberId
      ? 'viewer'
      : input.detailMode === 'full'
        ? 'full'
        : 'household'

    if (isGroupChat(input.ctx) && view === 'household') {
      const dashboard = await input.service.generateDashboard(input.periodArg)
      const sharedKind = input.forcedMode ?? dashboard?.billingStage
      if (dashboard && (sharedKind === 'rent' || sharedKind === 'utilities')) {
        const content = buildScheduledPaymentReminderContent({
          locale,
          kind: sharedKind,
          dispatchKind: sharedKind === 'utilities' ? 'utilities' : 'rent_due',
          period: dashboard.period,
          dashboard,
          viewMode: 'compact',
          botUsername: input.ctx.me.username ?? options.botUsername,
          ...(options.miniAppUrl ? { miniAppUrl: options.miniAppUrl } : {})
        })
        const sentBill = await replyOrEditText({
          ctx: input.ctx,
          text: content.text,
          options: {
            parse_mode: content.parseMode,
            reply_markup: {
              inline_keyboard: [
                ...(content.replyMarkup?.inline_keyboard ?? []),
                billViewRow(locale, view)
              ]
            }
          },
          editMessage: input.editMessage
        })
        if (sentBill && options.livePaymentCardService && input.ctx.chat) {
          await options.livePaymentCardService.register({
            householdId: input.householdId,
            kind: sharedKind,
            period: dashboard.period,
            surface: 'bill',
            locale,
            telegramChatId: input.ctx.chat.id.toString(),
            telegramThreadId:
              'message_thread_id' in sentBill && sentBill.message_thread_id !== undefined
                ? sentBill.message_thread_id.toString()
                : null,
            telegramMessageId: sentBill.message_id.toString()
          })
        }
        return
      }
    }

    const [plan, utilityCategories] = await Promise.all([
      input.service.generateCurrentBillPlan(input.periodArg),
      options.householdConfigurationRepository.listHouseholdUtilityCategories(input.householdId)
    ])
    if (!plan) {
      const noMonthText = financeViewCopy[locale].noMonth
      if (isGroupChat(input.ctx)) {
        await replyOrEditText({
          ctx: input.ctx,
          text: noMonthText,
          editMessage: input.editMessage
        })
      } else {
        await replyOrEditWithHomeMenu({
          ctx: input.ctx,
          locale,
          text: noMonthText,
          editMessage: input.editMessage
        })
      }
      return
    }

    const keyboard: InlineCallbackButton[][] = []
    const viewerUtilitySummary = input.viewerMemberId
      ? plan.utilityBillingPlan?.memberSummaries.find(
          (summary) => summary.memberId === input.viewerMemberId
        )
      : null
    const viewerHasUnresolvedPlannedUtilities = input.viewerMemberId
      ? viewerUtilitySummary
        ? viewerUtilitySummary.assignedThisCycle.amountMinor > 0n
        : (plan.utilityBillingPlan?.categories.some(
            (category) =>
              category.assignedMemberId === input.viewerMemberId &&
              category.assignedAmount.amountMinor > category.paidAmount.amountMinor
          ) ?? false)
      : false

    if (
      (input.forcedMode ?? plan.billingStage) === 'utilities' &&
      plan.utilityBillingPlan &&
      input.viewerMemberId &&
      viewerHasUnresolvedPlannedUtilities
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
          text: financeViewCopy[locale].markPlannedPaidButton,
          callback_data: `${BILL_RESOLVE_CALLBACK_PREFIX}current`
        }
      ])
    }
    keyboard.push(billViewRow(locale, view))

    const reply = buildBillReply({
      locale,
      householdName: input.householdName,
      plan,
      utilityCategories: activeUtilityCategories(utilityCategories),
      detailMode: input.detailMode,
      ...(input.forcedMode === undefined ? {} : { forcedMode: input.forcedMode }),
      ...(input.viewerMemberId === undefined ? {} : { viewerMemberId: input.viewerMemberId }),
      ...(input.orderMemberId === undefined ? {} : { orderMemberId: input.orderMemberId })
    })
    const billKeyboardRows = [
      ...(reply.copyButtonRows ?? []),
      ...(isGroupChat(input.ctx) ? keyboard : appendHomeMenuRow(locale, keyboard))
    ]
    const sentBill = await replyOrEditText({
      ctx: input.ctx,
      text: reply.text,
      options: {
        ...(reply.parseMode ? { parse_mode: reply.parseMode } : {}),
        reply_markup: { inline_keyboard: billKeyboardRows }
      },
      editMessage: input.editMessage
    })
    const billMode = input.forcedMode ?? plan.billingStage
    if (
      sentBill &&
      options.livePaymentCardService &&
      (billMode === 'rent' || billMode === 'utilities') &&
      !input.viewerMemberId &&
      input.ctx.chat
    ) {
      await options.livePaymentCardService.register({
        householdId: input.householdId,
        kind: billMode,
        period: plan.period,
        surface: 'bill',
        locale,
        telegramChatId: input.ctx.chat.id.toString(),
        telegramThreadId:
          'message_thread_id' in sentBill && sentBill.message_thread_id !== undefined
            ? sentBill.message_thread_id.toString()
            : null,
        telegramMessageId: sentBill.message_id.toString()
      })
    }
  }

  /** Callback data carries `current` or an explicit `YYYY-MM` from older messages. */
  function periodArgFromStatusCallback(raw: string): string | undefined {
    return raw === 'current' ? undefined : raw
  }

  function buildMiniAppUrl(ctx: Context): string | null {
    const botUsername = ctx.me.username ?? options.botUsername
    if (!isPrivateChat(ctx) || !options.miniAppUrl || !botUsername) {
      return null
    }

    return `${options.miniAppUrl}${options.miniAppUrl.includes('?') ? '&' : '?'}bot=${botUsername}`
  }

  function buildStatusReplyMarkup(input: { ctx: Context; locale: BotLocale }): {
    inline_keyboard: Array<Array<InlineCallbackButton | { text: string; web_app: { url: string } }>>
  } {
    const t = financeViewCopy[input.locale]
    const rows: Array<Array<InlineCallbackButton | { text: string; web_app: { url: string } }>> = []

    if (isGroupChat(input.ctx) || options.promptRepository) {
      rows.push([
        { text: t.detailsButton, callback_data: `${STATUS_DETAILS_CALLBACK_PREFIX}current` },
        { text: t.purchasesButton, callback_data: `${STATUS_BALANCES_CALLBACK_PREFIX}current` }
      ])
    }

    const webAppUrl = buildMiniAppUrl(input.ctx)
    if (webAppUrl) {
      rows.push([{ text: t.appButton, web_app: { url: webAppUrl } }])
    }

    rows.push(homeMenuRow(input.locale))

    return { inline_keyboard: rows }
  }

  async function replyWithHouseholdStatus(input: {
    ctx: Context
    locale: BotLocale
    service: FinanceCommandService
    householdId: string
    memberId: string
    householdName?: string | null
    editMessage?: boolean | undefined
  }) {
    const dashboard = await input.service.generateDashboard()
    if (!dashboard) {
      await replyOrEditWithHomeMenu({
        ctx: input.ctx,
        locale: input.locale,
        text: financeViewCopy[input.locale].noMonth,
        editMessage: input.editMessage
      })
      return
    }

    await storeBillPendingAction({
      ctx: input.ctx,
      payload: {
        kind: 'status_action',
        householdId: input.householdId,
        memberId: input.memberId
      }
    })

    await replyOrEditText({
      ctx: input.ctx,
      text: formatHouseholdStatus(input.locale, dashboard, input.householdName),
      options: {
        reply_markup: buildStatusReplyMarkup({ ctx: input.ctx, locale: input.locale })
      },
      editMessage: input.editMessage
    })
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
    const periodArg = periodArgFromStatusCallback(input.callbackPeriod)

    return {
      service: options.financeServiceForHousehold(membership.householdId),
      householdId: membership.householdId,
      memberId: membership.id,
      householdName: household?.householdName ?? null,
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
    editMessage?: boolean | undefined
  }) {
    const t = financeViewCopy[input.locale]
    const telegramUserId = input.ctx.from?.id?.toString()
    if (!telegramUserId) {
      await replyOrEditWithHomeMenu({
        ctx: input.ctx,
        locale: input.locale,
        text: t.unableToIdentifySender,
        editMessage: input.editMessage
      })
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
        editMessage: input.editMessage
      })
      return
    }

    const memberships =
      await options.householdConfigurationRepository.listHouseholdMembersByTelegramUserId(
        telegramUserId
      )
    if (memberships.length === 0) {
      await replyOrEditWithHomeMenu({
        ctx: input.ctx,
        locale: input.locale,
        text: t.notMember,
        editMessage: input.editMessage
      })
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
        householdName: household?.householdName ?? null,
        editMessage: input.editMessage
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
        choices: households.map(({ membership }) => ({
          householdId: membership.householdId,
          memberId: membership.id
        }))
      }
    })
    await replyOrEditText({
      ctx: input.ctx,
      text: t.chooseHousehold,
      options: {
        reply_markup: {
          inline_keyboard: [
            ...households.map(({ household }, index) => [
              {
                text:
                  household?.householdName ??
                  `${financeViewCopy[input.locale].household} ${index + 1}`,
                callback_data: `${STATUS_SHOW_CALLBACK_PREFIX}${index}`
              }
            ]),
            homeMenuRow(input.locale)
          ]
        }
      },
      editMessage: input.editMessage
    })
  }

  async function replyWithRequestedBillPlan(input: {
    ctx: Context
    locale: BotLocale
    forcedMode: 'utilities' | 'rent' | null
    showMode: 'household' | 'viewer'
    detailMode: 'compact' | 'full'
    editMessage?: boolean | undefined
  }) {
    const t = financeViewCopy[input.locale]
    const telegramUserId = input.ctx.from?.id?.toString()
    if (!telegramUserId) {
      await replyOrEditWithHomeMenu({
        ctx: input.ctx,
        locale: input.locale,
        text: t.unableToIdentifySender,
        editMessage: input.editMessage
      })
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
          ? { orderMemberId: resolved.member.id }
          : { viewerMemberId: resolved.member.id }),
        forcedMode: input.forcedMode,
        detailMode: input.detailMode,
        editMessage: input.editMessage
      })
      return
    }

    const memberships =
      await options.householdConfigurationRepository.listHouseholdMembersByTelegramUserId(
        telegramUserId
      )
    if (memberships.length === 0) {
      await replyOrEditWithHomeMenu({
        ctx: input.ctx,
        locale: input.locale,
        text: t.notMember,
        editMessage: input.editMessage
      })
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
        householdName: household?.householdName ?? null,
        ...(input.showMode === 'household'
          ? { orderMemberId: membership.id }
          : { viewerMemberId: membership.id }),
        forcedMode: input.forcedMode,
        detailMode: input.detailMode,
        editMessage: input.editMessage
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
    await replyOrEditText({
      ctx: input.ctx,
      text: t.chooseHousehold,
      options: {
        reply_markup: {
          inline_keyboard: [
            ...households.map(({ household }, index) => [
              {
                text:
                  household?.householdName ??
                  `${financeViewCopy[input.locale].household} ${index + 1}`,
                callback_data: `${BILL_SHOW_CALLBACK_PREFIX}${index}:${input.forcedMode ?? 'auto'}:${input.detailMode}`
              }
            ]),
            homeMenuRow(input.locale)
          ]
        }
      },
      editMessage: input.editMessage
    })
  }

  async function replyWithRequestedPersonalBillSummary(input: {
    ctx: Context
    locale: BotLocale
    editMessage?: boolean | undefined
  }) {
    const t = financeViewCopy[input.locale]
    const telegramUserId = input.ctx.from?.id?.toString()
    if (!telegramUserId) {
      await replyOrEditWithHomeMenu({
        ctx: input.ctx,
        locale: input.locale,
        text: t.unableToIdentifySender,
        editMessage: input.editMessage
      })
      return
    }

    if (isGroupChat(input.ctx)) {
      const resolved = await requireMember(input.ctx)
      if (!resolved) {
        return
      }

      await replyWithPersonalBillSummary({
        ctx: input.ctx,
        locale: input.locale,
        service: resolved.service,
        householdId: resolved.householdId,
        memberId: resolved.member.id,
        householdName: resolved.householdName,
        editMessage: input.editMessage
      })
      return
    }

    const memberships =
      await options.householdConfigurationRepository.listHouseholdMembersByTelegramUserId(
        telegramUserId
      )
    if (memberships.length === 0) {
      await replyOrEditWithHomeMenu({
        ctx: input.ctx,
        locale: input.locale,
        text: t.notMember,
        editMessage: input.editMessage
      })
      return
    }

    if (memberships.length === 1) {
      const membership = memberships[0]!
      const household =
        await options.householdConfigurationRepository.getHouseholdChatByHouseholdId(
          membership.householdId
        )
      await replyWithPersonalBillSummary({
        ctx: input.ctx,
        locale: input.locale,
        service: options.financeServiceForHousehold(membership.householdId),
        householdId: membership.householdId,
        memberId: membership.id,
        householdName: household?.householdName ?? null,
        editMessage: input.editMessage
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
        kind: 'personal_summary_choose',
        choices: households.map(({ membership }) => ({
          householdId: membership.householdId,
          memberId: membership.id
        }))
      }
    })
    await replyOrEditText({
      ctx: input.ctx,
      text: t.chooseHousehold,
      options: {
        reply_markup: {
          inline_keyboard: [
            ...households.map(({ household }, index) => [
              {
                text:
                  household?.householdName ??
                  `${financeViewCopy[input.locale].household} ${index + 1}`,
                callback_data: `${PERSONAL_BILL_SHOW_CALLBACK_PREFIX}${index}`
              }
            ]),
            homeMenuRow(input.locale)
          ]
        }
      },
      editMessage: input.editMessage
    })
  }

  /** Reads `{ householdId, memberId }` from the chooser the user just answered. */
  function chosenHousehold(
    choices: unknown[],
    index: number
  ): { householdId: string; memberId: string } | null {
    const choice = choices[index]
    if (
      !choice ||
      typeof choice !== 'object' ||
      typeof (choice as { householdId?: unknown }).householdId !== 'string' ||
      typeof (choice as { memberId?: unknown }).memberId !== 'string'
    ) {
      return null
    }

    const { householdId, memberId } = choice as { householdId: string; memberId: string }
    return { householdId, memberId }
  }

  function register(bot: Bot): void {
    bot.command('bill', async (ctx) => {
      const locale = await resolveReplyLocale({
        ctx,
        repository: options.householdConfigurationRepository
      })
      const { forcedMode, detailMode, hasInvalidArgs } = parseBillArgs(commandArgs(ctx))
      if (hasInvalidArgs) {
        await ctx.reply(financeViewCopy[locale].billUsage)
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

    bot.callbackQuery(callbackPrefixPattern(BILL_VIEW_CALLBACK_PREFIX), async (ctx) => {
      // Read-only re-render: stop the spinner before the work, not after it.
      await ackCallbackQuery(ctx)
      const view = ctx.callbackQuery.data.slice(BILL_VIEW_CALLBACK_PREFIX.length)
      const locale = await resolveReplyLocale({
        ctx,
        repository: options.householdConfigurationRepository
      })
      // The group /bill card is shared and kept live, so another view goes out as a new
      // message there instead of replacing the card for everyone.
      const editMessage = !isGroupChat(ctx)

      if (view === 'mine') {
        await replyWithRequestedPersonalBillSummary({ ctx, locale, editMessage })
        return
      }

      if (view === 'household' || view === 'full') {
        await replyWithRequestedBillPlan({
          ctx,
          locale,
          forcedMode: null,
          showMode: 'household',
          detailMode: view === 'full' ? 'full' : 'compact',
          editMessage
        })
      }
    })

    bot.callbackQuery(callbackPrefixPattern(BILL_SHOW_CALLBACK_PREFIX), async (ctx) => {
      // Read-only re-render: stop the spinner before the work, not after it.
      await ackCallbackQuery(ctx)
      const payload = ctx.callbackQuery.data.slice(BILL_SHOW_CALLBACK_PREFIX.length)
      const [choiceIndexRaw, modeRaw, detailRaw] = payload.split(':')
      const telegramUserId = ctx.from?.id?.toString()
      const choiceIndex = Number(choiceIndexRaw)
      if (!Number.isInteger(choiceIndex) || choiceIndex < 0 || !telegramUserId) {
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
      const choice = chosenHousehold(choices, choiceIndex)
      if (!choice) {
        return
      }

      const { householdId, memberId } = choice
      const locale = await resolveReplyLocale({
        ctx,
        repository: options.householdConfigurationRepository,
        householdId
      })
      const [household, plan, utilityCategories] = await Promise.all([
        options.householdConfigurationRepository.getHouseholdChatByHouseholdId(householdId),
        options.financeServiceForHousehold(householdId).generateCurrentBillPlan(),
        options.householdConfigurationRepository.listHouseholdUtilityCategories(householdId)
      ])
      if (!plan) {
        return
      }

      const reply = buildBillReply({
        locale,
        householdName: household?.householdName ?? null,
        plan,
        utilityCategories: activeUtilityCategories(utilityCategories),
        forcedMode: modeRaw === 'auto' ? null : parseBillMode(modeRaw),
        detailMode,
        ...(showMode === 'household' ? { orderMemberId: memberId } : { viewerMemberId: memberId })
      })
      const view: BillView =
        showMode === 'viewer' ? 'viewer' : detailMode === 'full' ? 'full' : 'household'
      await replyOrEditText({
        ctx,
        text: reply.text,
        options: {
          ...(reply.parseMode ? { parse_mode: reply.parseMode } : {}),
          reply_markup: {
            inline_keyboard: [
              ...(reply.copyButtonRows ?? []),
              billViewRow(locale, view),
              homeMenuRow(locale)
            ]
          }
        },
        editMessage: true
      })
    })

    bot.callbackQuery(callbackPrefixPattern(PERSONAL_BILL_SHOW_CALLBACK_PREFIX), async (ctx) => {
      // Read-only re-render: stop the spinner before the work, not after it.
      await ackCallbackQuery(ctx)
      const choiceIndex = Number(
        ctx.callbackQuery.data.slice(PERSONAL_BILL_SHOW_CALLBACK_PREFIX.length)
      )
      if (!Number.isInteger(choiceIndex) || choiceIndex < 0) {
        return
      }

      const pendingAction = await getBillPendingAction(ctx)
      const choices = Array.isArray(pendingAction?.payload.choices)
        ? pendingAction.payload.choices
        : []
      const choice = chosenHousehold(choices, choiceIndex)
      if (!choice) {
        return
      }

      const { householdId, memberId } = choice
      const locale = await resolveReplyLocale({
        ctx,
        repository: options.householdConfigurationRepository,
        householdId
      })
      const household =
        await options.householdConfigurationRepository.getHouseholdChatByHouseholdId(householdId)
      await replyWithPersonalBillSummary({
        ctx,
        locale,
        service: options.financeServiceForHousehold(householdId),
        householdId,
        memberId,
        householdName: household?.householdName ?? null,
        editMessage: true
      })
    })

    bot.callbackQuery(callbackPrefixPattern(BILL_RESOLVE_CALLBACK_PREFIX), async (ctx) => {
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
        await ackCallbackQuery(ctx)
        return
      }

      const service = options.financeServiceForHousehold(householdId)
      const actingMember = await service.getMemberByTelegramUserId(telegramUserId)
      if (!actingMember || (!actingMember.isAdmin && actingMember.id !== memberId)) {
        await ackCallbackQuery(ctx)
        return
      }

      const locale = await resolveReplyLocale({
        ctx,
        repository: options.householdConfigurationRepository,
        householdId
      })
      const t = financeViewCopy[locale]
      const periodArg =
        pendingAction?.payload.kind === 'resolve' &&
        typeof pendingAction.payload.periodArg === 'string' &&
        pendingAction.payload.periodArg.length > 0
          ? pendingAction.payload.periodArg
          : undefined
      const household =
        await options.householdConfigurationRepository.getHouseholdChatByHouseholdId(householdId)

      async function renderViewerUtilities(plan: FinanceBillPlanForBot) {
        const utilityCategories =
          await options.householdConfigurationRepository.listHouseholdUtilityCategories(
            householdId!
          )
        const reply = buildBillReply({
          locale,
          householdName: household?.householdName ?? null,
          plan,
          utilityCategories: activeUtilityCategories(utilityCategories),
          forcedMode: 'utilities',
          viewerMemberId: actingMember!.id,
          detailMode: 'compact'
        })
        await replyOrEditText({
          ctx,
          text: reply.text,
          options: {
            ...(reply.parseMode ? { parse_mode: reply.parseMode } : {}),
            reply_markup: {
              inline_keyboard: [...(reply.copyButtonRows ?? []), homeMenuRow(locale)]
            }
          },
          editMessage: true
        })
      }

      const beforePlan = await service.generateCurrentBillPlan(periodArg)
      const beforeSummary = beforePlan?.utilityBillingPlan?.memberSummaries.find(
        (summary) => summary.memberId === memberId
      )
      if (beforePlan && beforeSummary && beforeSummary.assignedThisCycle.amountMinor <= 0n) {
        await renderViewerUtilities(beforePlan)
        await ctx.answerCallbackQuery({ text: t.alreadyPaidToast })
        return
      }

      const resolveResult = await service.resolveUtilityBillAsPlanned({
        memberId,
        actorMemberId: actingMember.id,
        ...(periodArg ? { periodArg } : {})
      })
      if (resolveResult) {
        await recordCommandAudit({
          resolved: {
            member: actingMember,
            service,
            householdId,
            householdName: household?.householdName ?? null
          },
          category: 'plan_events',
          eventType:
            resolveResult.plan?.status === 'settled'
              ? 'utility_plan.settled'
              : 'utility_plan.resolved',
          summaryText: `${actingMember.displayName} marked planned utilities paid (${resolveResult.period})`,
          metadata: {
            period: resolveResult.period,
            memberId,
            resolvedAssignments: serializeUtilityResolutionAssignments(
              resolveResult.resolvedAssignments
            ),
            resolvedBillIds: resolveResult.resolvedBillIds
          }
        })
      }
      if (resolveResult && options.livePaymentCardService) {
        await options.livePaymentCardService.refresh({
          householdId,
          kind: 'utilities',
          period: resolveResult.period
        })
      }
      const plan = await service.generateCurrentBillPlan(periodArg)
      if (!plan) {
        await ackCallbackQuery(ctx)
        return
      }

      await renderViewerUtilities(plan)
      await ctx.answerCallbackQuery({ text: t.plannedPaidToast })
    })

    bot.callbackQuery(callbackPrefixPattern(STATUS_SHOW_CALLBACK_PREFIX), async (ctx) => {
      // Read-only re-render: stop the spinner before the work, not after it.
      await ackCallbackQuery(ctx)
      const choiceIndex = Number(ctx.callbackQuery.data.slice(STATUS_SHOW_CALLBACK_PREFIX.length))
      if (!Number.isInteger(choiceIndex) || choiceIndex < 0) {
        return
      }

      const pendingAction = await getBillPendingAction(ctx)
      const choices = Array.isArray(pendingAction?.payload.choices)
        ? pendingAction.payload.choices
        : []
      const choice = chosenHousehold(choices, choiceIndex)
      if (!choice) {
        return
      }

      const { householdId, memberId } = choice
      const memberships =
        await options.householdConfigurationRepository.listHouseholdMembersByTelegramUserId(
          ctx.from?.id?.toString() ?? ''
        )
      const membership = memberships.find(
        (item) => item.householdId === householdId && item.id === memberId
      )
      if (!membership) {
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
        householdName: household?.householdName ?? null,
        editMessage: true
      })
    })

    bot.callbackQuery(callbackPrefixPattern(STATUS_DETAILS_CALLBACK_PREFIX), async (ctx) => {
      // Read-only re-render: stop the spinner before the work, not after it.
      await ackCallbackQuery(ctx)
      const callbackPeriod = ctx.callbackQuery.data.slice(STATUS_DETAILS_CALLBACK_PREFIX.length)
      const target = await resolveStatusCallbackTarget({ ctx, callbackPeriod })
      if (!target) {
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
        detailMode: 'full',
        editMessage: true
      })
    })

    bot.callbackQuery(callbackPrefixPattern(STATUS_BALANCES_CALLBACK_PREFIX), async (ctx) => {
      // Read-only re-render: stop the spinner before the work, not after it.
      await ackCallbackQuery(ctx)
      const callbackPeriod = ctx.callbackQuery.data.slice(STATUS_BALANCES_CALLBACK_PREFIX.length)
      const target = await resolveStatusCallbackTarget({ ctx, callbackPeriod })
      if (!target) {
        return
      }

      const locale = await resolveReplyLocale({
        ctx,
        repository: options.householdConfigurationRepository,
        householdId: target.householdId
      })
      await replyWithBalances({
        ctx,
        locale,
        service: target.service,
        ...(target.periodArg ? { periodArg: target.periodArg } : {}),
        editMessage: true
      })
    })

    bot.callbackQuery(TELEGRAM_HOME_MY_BILL_CALLBACK, async (ctx) => {
      // Read-only re-render: stop the spinner before the work, not after it.
      await ackCallbackQuery(ctx)
      const locale = await resolveReplyLocale({
        ctx,
        repository: options.householdConfigurationRepository
      })
      await replyWithRequestedPersonalBillSummary({
        ctx,
        locale,
        editMessage: true
      })
    })

    bot.callbackQuery(TELEGRAM_HOME_MY_BILL_FULL_CALLBACK, async (ctx) => {
      // Read-only re-render: stop the spinner before the work, not after it.
      await ackCallbackQuery(ctx)
      const locale = await resolveReplyLocale({
        ctx,
        repository: options.householdConfigurationRepository
      })
      await replyWithRequestedBillPlan({
        ctx,
        locale,
        forcedMode: null,
        showMode: 'viewer',
        detailMode: 'full',
        editMessage: true
      })
    })

    bot.callbackQuery(TELEGRAM_HOME_STATUS_CALLBACK, async (ctx) => {
      // Read-only re-render: stop the spinner before the work, not after it.
      await ackCallbackQuery(ctx)
      const locale = await resolveReplyLocale({
        ctx,
        repository: options.householdConfigurationRepository
      })
      await replyWithRequestedHouseholdStatus({
        ctx,
        locale,
        editMessage: true
      })
    })

    bot.callbackQuery(TELEGRAM_HOME_BALANCES_CALLBACK, async (ctx) => {
      // Read-only re-render: stop the spinner before the work, not after it.
      await ackCallbackQuery(ctx)
      const locale = await resolveReplyLocale({
        ctx,
        repository: options.householdConfigurationRepository
      })
      await replyWithRequestedBalances({
        ctx,
        locale,
        editMessage: true
      })
    })

    bot.callbackQuery(callbackPrefixPattern(HOME_BALANCE_SHOW_CALLBACK_PREFIX), async (ctx) => {
      // Read-only re-render: stop the spinner before the work, not after it.
      await ackCallbackQuery(ctx)
      const choiceIndex = Number(
        ctx.callbackQuery.data.slice(HOME_BALANCE_SHOW_CALLBACK_PREFIX.length)
      )
      if (!Number.isInteger(choiceIndex) || choiceIndex < 0) {
        return
      }

      const pendingAction = await getBillPendingAction(ctx)
      const choices = Array.isArray(pendingAction?.payload.choices)
        ? pendingAction.payload.choices
        : []
      const choice = chosenHousehold(choices, choiceIndex)
      if (!choice) {
        return
      }

      const locale = await resolveReplyLocale({
        ctx,
        repository: options.householdConfigurationRepository,
        householdId: choice.householdId
      })
      await replyWithBalances({
        ctx,
        locale,
        service: options.financeServiceForHousehold(choice.householdId),
        editMessage: true
      })
    })
  }

  return {
    register
  }
}
