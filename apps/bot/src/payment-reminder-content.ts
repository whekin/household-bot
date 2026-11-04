import type { FinanceDashboard, FinanceDashboardPaymentKindSummary } from '@household/application'
import { formatDayDisplay, formatMoneyDisplay, formatMonthDisplay, Money } from '@household/domain'
import type { FinancePaymentKind } from '@household/ports'
import type { InlineKeyboardMarkup } from 'grammy/types'

import { escapeHtml } from './html'
import { getBotTranslations, type BotLocale } from './i18n'
import { paymentCardCopy } from './i18n/payment-cards'
import { buildUtilitiesReminderReplyMarkup } from './reminder-topic-utilities'
import { buildBotStartDeepLink } from './telegram-deep-links'

export type PaymentReminderKind = FinancePaymentKind
export type PaymentReminderViewMode = 'compact' | 'details'
export type PaymentReminderDispatchKind = 'utilities' | 'rent_warning' | 'rent_due'

export const PAYMENT_REMINDER_PAID_CALLBACK_PREFIX = 'pr:p:'
export const PAYMENT_REMINDER_DETAILS_CALLBACK_PREFIX = 'pr:d:'

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

function moneyText(amount: Money, locale: BotLocale): string {
  return formatMoneyDisplay(amount.amountMinor, amount.currency, locale)
}

export function formatBillingMonth(locale: BotLocale, period: string): string {
  return formatMonthDisplay(period, locale)
}

function formatDueDate(locale: BotLocale, dueDate: string): string {
  return formatDayDisplay(dueDate, locale)
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
  const copy = paymentCardCopy[locale]
  const destinations =
    dashboard.rentBillingState.paymentDestinations ?? dashboard.rentPaymentDestinations ?? []
  if (destinations.length === 0) {
    return [escapeHtml(getBotTranslations(locale).reminders.noRentDestinations)]
  }

  return destinations.flatMap((destination, index) => {
    const title = [destination.bankName, destination.label]
      .filter((value): value is string => Boolean(value))
      .join(' · ')

    return [
      ...(index > 0 ? [''] : []),
      `🏦 ${escapeHtml(title)}`,
      ...(destination.recipientName ? [escapeHtml(copy.recipient(destination.recipientName))] : []),
      `<code>${escapeHtml(destination.account)}</code>`,
      ...(destination.note ? [escapeHtml(destination.note)] : []),
      ...(destination.link ? [escapeHtml(destination.link)] : [])
    ]
  })
}

function rentMemberAmountLines(dashboard: FinanceDashboard, locale: BotLocale): string[] {
  return dashboard.rentBillingState.memberSummaries.map((member) =>
    member.remaining.amountMinor > 0n
      ? `⏳ <b>${escapeHtml(member.displayName)}</b> · ${escapeHtml(moneyText(member.remaining, locale))}`
      : `✅ <s>${escapeHtml(member.displayName)}</s>`
  )
}

// Group utility obligations by member so everyone finds their own block once,
// instead of scanning a flat per-bill list to spot the lines that are theirs.
function utilitiesByMemberLines(input: {
  dashboard: FinanceDashboard
  locale: BotLocale
  period: string
}): string[] {
  const t = getBotTranslations(input.locale).reminders
  const copy = paymentCardCopy[input.locale]
  const summary = paymentKindSummary(input.dashboard, input.period, 'utilities')
  const plan = input.dashboard.utilityBillingPlan
  const categories = plan?.categories ?? []
  const unresolvedById = new Map(
    (summary?.unresolvedMembers ?? []).map((member) => [member.memberId, member])
  )
  const planSummaryById = new Map(
    (plan?.memberSummaries ?? []).map((member) => [member.memberId, member])
  )
  const purchaseBalanceById = new Map(
    input.dashboard.members.map((member) => [member.memberId, member.purchaseOffset])
  )
  const utilityShareById = new Map(
    input.dashboard.members.map((member) => [member.memberId, member.utilityShare])
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
  for (const member of plan?.memberSummaries ?? []) {
    nameById.set(member.memberId, member.displayName)
  }
  for (const category of categories) {
    if (!orderedMemberIds.includes(category.assignedMemberId)) {
      orderedMemberIds.push(category.assignedMemberId)
      nameById.set(category.assignedMemberId, category.assignedDisplayName)
    }
  }
  // A member can owe nothing on the plan and still hold a shared-purchase
  // position — most sharply the one the household owes, since being owed is what
  // empties their plan row. Without this they drop out of the list entirely and
  // their balance is never stated.
  for (const member of input.dashboard.members) {
    const planTarget = planSummaryById.get(member.memberId)?.fairShare.amountMinor
    const shapedByPurchases =
      member.purchaseOffset.amountMinor !== 0n ||
      (planTarget !== undefined && planTarget !== member.utilityShare.amountMinor)
    if (!orderedMemberIds.includes(member.memberId) && shapedByPurchases) {
      orderedMemberIds.push(member.memberId)
      nameById.set(member.memberId, member.displayName)
    }
  }

  if (orderedMemberIds.length === 0) {
    return ['• ' + escapeHtml(t.noUtilityPlan)]
  }

  const lines: string[] = []
  for (const memberId of orderedMemberIds) {
    const memberCategories = categoriesByMember.get(memberId) ?? []
    const unresolved = unresolvedById.get(memberId)
    const displayName = nameById.get(memberId) ?? memberId
    const total =
      unresolved?.suggestedAmount ??
      (memberCategories.length > 0
        ? memberCategories
            .slice(1)
            .reduce(
              (sum, category) => sum.add(category.assignedAmount),
              memberCategories[0]!.assignedAmount
            )
        : (planSummaryById.get(memberId)?.assignedThisCycle ??
          Money.zero(input.dashboard.currency)))
    // `paidAmount` is the whole bill's payments, whoever made them, so on a split
    // bill one member paying their share would tick everyone else's line as well.
    // Count only what this member put toward this bill.
    const isPaidByThisMember = (category: (typeof categories)[number]): boolean =>
      category.remainingAmount.amountMinor <= 0n
    // Their bills are covered by their own money: the amount below their name is
    // what they contributed, not another sum to hand over. Saying so keeps it out
    // of the running total a reader adds up from this list.
    const settledEverythingAssigned =
      !unresolved && memberCategories.length > 0 && memberCategories.every(isPaidByThisMember)

    if (lines.length > 0) {
      lines.push('')
    }
    lines.push(
      settledEverythingAssigned
        ? `✅ <s>${escapeHtml(displayName)}</s>`
        : `${total.amountMinor <= 0n ? '✅' : '⏳'} <b>${escapeHtml(displayName)}</b> · ${escapeHtml(
            total.amountMinor <= 0n ? copy.nothingToPayNow : moneyText(total, input.locale)
          )}`
    )
    for (const category of memberCategories) {
      const paidMinor = category.assignedAmount.amountMinor - category.remainingAmount.amountMinor
      const paidByMember = isPaidByThisMember(category)
      const partial =
        !paidByMember && paidMinor > 0n
          ? ` · ${escapeHtml(
              copy.alreadyPaid(
                moneyText(
                  Money.fromMinor(paidMinor, category.assignedAmount.currency),
                  input.locale
                )
              )
            )}`
          : ''
      lines.push(
        `${paidByMember ? '   ✅' : '   •'} ${escapeHtml(category.billName)} · ${escapeHtml(
          moneyText(paidByMember ? category.assignedAmount : category.remainingAmount, input.locale)
        )}${partial ? ` ${copy.left}${partial}` : ''}`
      )
    }
    const purchaseLine = purchaseBalanceLine({
      dashboard: input.dashboard,
      locale: input.locale,
      planSummary: planSummaryById.get(memberId) ?? null,
      utilityShare: utilityShareById.get(memberId) ?? null,
      liveOffset: purchaseBalanceById.get(memberId) ?? null,
      nothingPaidYet: (summary?.totalPaid.amountMinor ?? 0n) === 0n
    })
    if (purchaseLine) {
      lines.push(`   ${escapeHtml(purchaseLine)}`)
    }
  }

  return lines
}

// Below a whole lari a carry is rounding between shares, not something to tell people about.
const PURCHASE_TAIL_MIN_MINOR = 100n

/**
 * How shared purchases shaped this member's utilities amount.
 *
 * In utilities mode the plan already folds purchases in: a member's target is
 * their utility share plus what they owe on purchases (or minus what they are
 * owed). The line spells that sum out, so the amount beside the name reads as
 * arithmetic instead of a separate debt. It is read from the plan, not the live
 * balance, because the live balance moves every time someone else pays.
 *
 * Wording stays in the third person: the card is read by the whole household.
 */
function purchaseBalanceLine(input: {
  dashboard: FinanceDashboard
  locale: BotLocale
  planSummary: NonNullable<FinanceDashboard['utilityBillingPlan']>['memberSummaries'][number] | null
  utilityShare: Money | null
  liveOffset: Money | null
  nothingPaidYet: boolean
}): string | null {
  const copy = paymentCardCopy[input.locale]
  const currency = input.dashboard.currency
  const money = (minor: bigint) =>
    moneyText(Money.fromMinor(minor < 0n ? -minor : minor, currency), input.locale)
  const liveMinor = input.liveOffset?.amountMinor ?? 0n

  if (input.dashboard.paymentBalanceAdjustmentPolicy !== 'utilities') {
    if (liveMinor === 0n) {
      return null
    }
    return liveMinor > 0n
      ? copy.purchasesDueViaRent(money(liveMinor))
      : copy.purchasesCreditViaRent(money(liveMinor))
  }

  if (!input.planSummary || !input.utilityShare) {
    if (liveMinor === 0n) {
      return null
    }
    return liveMinor > 0n
      ? copy.purchasesDueNextMonth(money(liveMinor))
      : copy.purchasesCreditNextMonth(money(liveMinor))
  }

  const shareMinor = input.utilityShare.amountMinor
  const targetMinor = input.planSummary.fairShare.amountMinor

  // The target clamps at zero: purchases covered the whole share and the
  // household still owes this member the rest, which only a later cycle can repay.
  if (targetMinor === 0n && shareMinor > 0n) {
    const covered = copy.shareCoveredByPurchases(money(shareMinor))
    // Before anyone pays, the live balance is still the plan's input, so the
    // remainder is exact. Afterwards payments are clearing it piece by piece.
    const restMinor = input.nothingPaidYet ? -liveMinor - shareMinor : null
    if (restMinor === null) {
      return `${covered}, ${copy.restReturnsUnknown}`
    }
    return restMinor >= PURCHASE_TAIL_MIN_MINOR
      ? `${covered}, ${copy.restReturns(money(restMinor))}`
      : covered
  }

  const purchasesMinor = targetMinor - shareMinor
  if (purchasesMinor === 0n) {
    return null
  }

  const base = copy.shareWithPurchases(
    money(shareMinor),
    purchasesMinor > 0n ? '+' : '−',
    money(purchasesMinor)
  )
  // The plan routes whole bills, so a member can be handed less or more than
  // their target. The gap carries into the next cycle.
  const deltaMinor = input.planSummary.projectedDeltaAfterPlan.amountMinor
  if (deltaMinor > -PURCHASE_TAIL_MIN_MINOR && deltaMinor < PURCHASE_TAIL_MIN_MINOR) {
    return base
  }
  const nowMinor =
    input.planSummary.vendorPaid.amountMinor + input.planSummary.assignedThisCycle.amountMinor
  return `${base} ${
    deltaMinor < 0n
      ? copy.restNextMonth(money(targetMinor), money(nowMinor))
      : copy.extraReturnsNextMonth(money(targetMinor), money(nowMinor))
  }`
}

/** Whether any member's utilities amount this cycle was moved by shared purchases. */
function planIncludesPurchases(dashboard: FinanceDashboard): boolean {
  if (dashboard.paymentBalanceAdjustmentPolicy !== 'utilities' || !dashboard.utilityBillingPlan) {
    return false
  }
  const shareById = new Map(
    dashboard.members.map((member) => [member.memberId, member.utilityShare.amountMinor])
  )
  return dashboard.utilityBillingPlan.memberSummaries.some((summary) => {
    const shareMinor = shareById.get(summary.memberId)
    return shareMinor !== undefined && summary.fairShare.amountMinor !== shareMinor
  })
}

function isKindFullyPaid(summary: FinanceDashboardPaymentKindSummary | null): boolean {
  return !summary || summary.totalRemaining.amountMinor <= 0n
}

function buildKeyboard(input: PaymentReminderRenderInput): InlineKeyboardMarkup {
  const t = getBotTranslations(input.locale).reminders
  const copy = paymentCardCopy[input.locale]
  const fullyPaid = isKindFullyPaid(paymentKindSummary(input.dashboard, input.period, input.kind))
  const dashboardUrl = buildBotStartDeepLink(input.botUsername, 'dashboard')
  const rows: InlineKeyboardMarkup['inline_keyboard'] = []
  // Short actions share rows two at a time; the paid button leads.
  const actions: InlineKeyboardMarkup['inline_keyboard'][number] = []

  if (!fullyPaid) {
    actions.push({
      text: input.kind === 'utilities' ? t.paidUtilitiesButton : t.paidButton,
      callback_data: `${PAYMENT_REMINDER_PAID_CALLBACK_PREFIX}${input.kind}:${input.period}`
    })
  }

  if (input.kind === 'rent' && !fullyPaid) {
    const destinations =
      input.dashboard.rentBillingState.paymentDestinations ??
      input.dashboard.rentPaymentDestinations ??
      []
    for (const destination of destinations) {
      if (destination.account.length === 0 || destination.account.length > 256) {
        continue
      }
      actions.push({
        text: copy.copyAccount((destination.bankName ?? destination.label).slice(0, 40)),
        copy_text: { text: destination.account }
      })
    }
  }

  for (let index = 0; index < actions.length; index += 2) {
    rows.push(actions.slice(index, index + 2))
  }

  if (input.kind === 'utilities' && input.surface === 'billing-reminder-prompt') {
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
  const copy = paymentCardCopy[input.locale]
  const summary = paymentKindSummary(input.dashboard, input.period, input.kind)
  const fullyPaid = isKindFullyPaid(summary)
  const lines: string[] = []

  if (input.kind === 'rent') {
    const members = input.dashboard.rentBillingState.memberSummaries.filter(
      (member) => member.due.amountMinor > 0n
    )
    const paidCount = members.filter((member) => member.remaining.amountMinor <= 0n).length
    if (fullyPaid) {
      lines.push(
        copy.rentPaidTitle(input.period),
        escapeHtml(
          // «Все 1 оплатили» reads wrong; one member is just «Все оплатили».
          copy.everyonePaid(
            members.length > 1 ? members.length : null,
            summary ? moneyText(summary.totalDue, input.locale) : ''
          )
        )
      )
    } else {
      lines.push(
        copy.rentTitle(
          input.period,
          escapeHtml(formatDueDate(input.locale, input.dashboard.rentBillingState.dueDate))
        ),
        escapeHtml(
          copy.rentProgress(
            paidCount,
            members.length,
            moneyText(summary!.totalRemaining, input.locale)
          )
        ),
        '',
        ...rentMemberAmountLines(input.dashboard, input.locale),
        '',
        ...rentDestinationLines(input.dashboard, input.locale)
      )
    }
  } else {
    const dueDate = input.dashboard.utilityBillingPlan
      ? escapeHtml(formatDueDate(input.locale, input.dashboard.utilityBillingPlan.dueDate))
      : null
    if (fullyPaid) {
      lines.push(copy.utilitiesPaidTitle(input.period))
    } else {
      lines.push(
        copy.utilitiesTitle(input.period, dueDate),
        escapeHtml(copy.remaining(moneyText(summary!.totalRemaining, input.locale)))
      )
      if (planIncludesPurchases(input.dashboard)) {
        lines.push(escapeHtml(copy.purchasesExplained))
      }
      lines.push(
        '',
        ...utilitiesByMemberLines({
          dashboard: input.dashboard,
          locale: input.locale,
          period: input.period
        })
      )
      if (input.surface === 'scheduled-reminder') {
        lines.push('', escapeHtml(copy.screenshotHint))
      }
    }
  }

  if (input.dashboard.balanceUpdatePending) {
    lines.push(
      '',
      escapeHtml(getBotTranslations(input.locale).payments.balanceUpdatePendingReminder)
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
