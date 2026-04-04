import type { FinanceCommandService } from '@household/application'
import { Money, nowInstant } from '@household/domain'
import type {
  HouseholdBillingSettingsRecord,
  HouseholdConfigurationRepository,
  TelegramPendingActionRepository
} from '@household/ports'
import { InputFile, type Bot, type Context } from 'grammy'

import { getBotTranslations } from './i18n'
import { formatUserFacingMoney } from './i18n/money'
import { resolveReplyLocale } from './bot-locale'
import {
  buildTemplateText,
  REMINDER_UTILITY_ACTION,
  REMINDER_UTILITY_ACTION_TTL_MS
} from './reminder-topic-utilities'

const BILL_SHOW_CALLBACK_PREFIX = 'bill:show:'
const BILL_RESOLVE_CALLBACK_PREFIX = 'bill:resolve:'
const BILL_JSON_CALLBACK_PREFIX = 'bill:json:'
const BILL_SHOW_PENDING_ACTION = 'bill_command'
const BILL_PENDING_ACTION_TTL_MS = 1000 * 60 * 60

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

  return formatter.format(new Date(Date.UTC(year, month - 1, 1)))
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

function hasAllFlag(args: readonly string[]): boolean {
  return args.some((arg) => arg.trim().toLowerCase() === 'all')
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

function utilityPlanStatusLabel(
  locale: Parameters<typeof getBotTranslations>[0],
  status: 'active' | 'diverged' | 'superseded' | 'settled'
): string {
  if (status === 'settled') {
    return locale === 'ru' ? 'Закрыто' : 'Settled'
  }
  if (status === 'active') {
    return locale === 'ru' ? 'По плану' : 'On track'
  }

  return locale === 'ru' ? 'Пересчитано' : 'Rebalanced'
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
  categories: readonly string[]
  viewerOnly: boolean
}): string {
  const isFullyPaid =
    input.payNow.amountMinor === 0n && input.summary && input.summary.vendorPaid.amountMinor > 0n

  if (isFullyPaid && !input.viewerOnly) {
    const paidAmount = formatUserFacingMoney(
      input.summary!.vendorPaid.toMajorString(),
      input.currency
    )
    return `${input.displayName}\n${input.locale === 'ru' ? 'Оплачено' : 'Paid'}: ${paidAmount}`
  }

  const lines = input.viewerOnly
    ? input.payNow.amountMinor === 0n && isFullyPaid
      ? [
          `${input.locale === 'ru' ? 'Оплачено' : 'Paid'}: ${formatUserFacingMoney(
            input.summary!.vendorPaid.toMajorString(),
            input.currency
          )}`
        ]
      : [
          `${
            input.locale === 'ru' ? 'Сейчас тебе оплатить' : 'You pay now'
          }: ${formatUserFacingMoney(input.payNow.toMajorString(), input.currency)}`
        ]
    : [
        input.displayName,
        `${input.locale === 'ru' ? 'К оплате сейчас' : 'Pay now'}: ${formatUserFacingMoney(
          input.payNow.toMajorString(),
          input.currency
        )}`
      ]

  if (input.categories.length > 0) {
    lines.push(...input.categories)
  } else if (
    input.summary &&
    input.summary.fairShare.amountMinor > 0n &&
    input.summary.vendorPaid.amountMinor >= input.summary.fairShare.amountMinor
  ) {
    lines.push(input.locale === 'ru' ? 'Уже закрыто.' : 'Already settled.')
  } else {
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

export function createFinanceCommandsService(options: {
  householdConfigurationRepository: HouseholdConfigurationRepository
  financeServiceForHousehold: (householdId: string) => FinanceCommandService
  promptRepository?: TelegramPendingActionRepository
  miniAppUrl?: string
  botUsername?: string
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

  function formatHouseholdStatus(
    locale: Parameters<typeof getBotTranslations>[0],
    dashboard: NonNullable<Awaited<ReturnType<FinanceCommandService['generateDashboard']>>>,
    dueDay: number
  ): string {
    const t = getBotTranslations(locale).finance
    const utilityTotal = dashboard.ledger
      .filter((entry) => entry.kind === 'utility')
      .reduce((sum, entry) => sum.add(entry.displayAmount), Money.zero(dashboard.currency))
    const purchaseTotal = dashboard.ledger
      .filter((entry) => entry.kind === 'purchase')
      .reduce((sum, entry) => sum.add(entry.displayAmount), Money.zero(dashboard.currency))

    const rentLine =
      dashboard.rentSourceAmount.currency === dashboard.rentDisplayAmount.currency
        ? t.householdStatusRentDirect(
            dashboard.rentDisplayAmount.toMajorString(),
            dashboard.currency
          )
        : t.householdStatusRentConverted(
            dashboard.rentSourceAmount.toMajorString(),
            dashboard.rentSourceAmount.currency,
            dashboard.rentDisplayAmount.toMajorString(),
            dashboard.currency
          )

    const memberLines = [...dashboard.members]
      .sort((left, right) => right.remaining.compare(left.remaining))
      .map((member) =>
        member.paid.isZero()
          ? t.householdStatusMemberCompact(
              member.displayName,
              member.remaining.toMajorString(),
              dashboard.currency
            )
          : t.householdStatusMemberDetailed(
              member.displayName,
              member.remaining.toMajorString(),
              member.netDue.toMajorString(),
              member.paid.toMajorString(),
              dashboard.currency
            )
      )

    return [
      t.householdStatusTitle(formatBillingPeriodLabel(locale, dashboard.period)),
      t.householdStatusDueDate(formatCycleDueDate(locale, dashboard.period, dueDay)),
      '',
      t.householdStatusChargesHeading,
      rentLine,
      t.householdStatusUtilities(utilityTotal.toMajorString(), dashboard.currency),
      t.householdStatusPurchases(purchaseTotal.toMajorString(), dashboard.currency),
      '',
      t.householdStatusSettlementHeading,
      t.householdStatusSettlementBalance(dashboard.totalDue.toMajorString(), dashboard.currency),
      ...(!dashboard.totalPaid.isZero()
        ? [t.householdStatusSettlementPaid(dashboard.totalPaid.toMajorString(), dashboard.currency)]
        : []),
      t.householdStatusSettlementRemaining(
        dashboard.totalRemaining.toMajorString(),
        dashboard.currency
      ),
      '',
      t.householdStatusMembersHeading,
      ...memberLines
    ].join('\n')
  }

  async function resolveGroupFinanceService(ctx: Context): Promise<{
    service: FinanceCommandService
    householdId: string
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
      householdId: household.householdId
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
      householdId: scoped.householdId
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

      return { memberId, summary, memberCategories, payNow, displayName }
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
        ? memberEntries.map((entry) =>
            formatUtilityMemberBlock({
              locale: input.locale,
              currency: input.currency,
              displayName: entry.displayName,
              payNow: entry.payNow,
              summary: entry.summary,
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
          )
        : [
            input.locale === 'ru'
              ? 'В этом цикле по коммуналке активных назначений нет.'
              : 'No active utility assignments for this cycle.'
          ]

    return [
      `${input.locale === 'ru' ? 'Коммуналка' : 'Utilities plan'} · ${formatBillingPeriodLabel(input.locale, input.period)}`,
      ...(input.householdName ? [input.householdName] : []),
      `${input.locale === 'ru' ? 'Статус' : 'Status'}: ${utilityPlanStatusLabel(input.locale, input.plan.status)}`,
      `${input.locale === 'ru' ? 'Срок' : 'Due'}: ${formatAbsoluteDate(input.locale, input.plan.dueDate)}`,
      '',
      memberBlocks.join('\n\n')
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
      ? formatRentDestinationLines({
          locale: input.locale,
          destinations: input.state.paymentDestinations
        })
      : []

    return [
      `${input.locale === 'ru' ? 'Аренда' : 'Rent state'} · ${formatBillingPeriodLabel(input.locale, input.period)}`,
      ...(input.householdName ? [input.householdName] : []),
      `${input.locale === 'ru' ? 'Срок' : 'Due'}: ${formatAbsoluteDate(input.locale, input.state.dueDate)}`,
      '',
      visibleMembers
        .map((member) =>
          [
            ...(input.viewerMemberId
              ? [
                  `${input.locale === 'ru' ? 'Сейчас тебе оплатить' : 'You pay now'}: ${formatUserFacingMoney(member.remaining.toMajorString(), input.currency)}`
                ]
              : [
                  member.displayName,
                  `${input.locale === 'ru' ? 'К оплате сейчас' : 'Pay now'}: ${formatUserFacingMoney(member.remaining.toMajorString(), input.currency)}`
                ]),
            ...(member.remaining.amountMinor > 0n && destinationLines.length > 0
              ? destinationLines
              : [
                  member.remaining.amountMinor === 0n
                    ? input.locale === 'ru'
                      ? 'Уже закрыто.'
                      : 'Already settled.'
                    : input.adjustmentPolicy === 'rent'
                      ? input.locale === 'ru'
                        ? 'Сумма уже учитывает поправку по балансу.'
                        : 'This amount already reflects balance adjustment.'
                      : input.locale === 'ru'
                        ? 'Оплати аренду по реквизитам дома.'
                        : 'Pay rent to the household destination.'
                ])
          ].join('\n')
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
    viewerMemberId?: string | null
    forcedMode?: 'utilities' | 'rent' | null
    orderMemberId?: string | null
  }) {
    const locale = await resolveReplyLocale({
      ctx: input.ctx,
      repository: options.householdConfigurationRepository,
      householdId: input.householdId
    })
    const [plan, utilityCategories, billingSettings] = await Promise.all([
      input.service.generateCurrentBillPlan(),
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
          viewerMemberId: input.viewerMemberId
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

  function register(bot: Bot): void {
    bot.command('bill', async (ctx) => {
      const locale = await resolveReplyLocale({
        ctx,
        repository: options.householdConfigurationRepository
      })
      const args = commandArgs(ctx)
      const forcedMode = parseBillMode(args.find((arg) => parseBillMode(arg) !== null))
      const showAll = hasAllFlag(args)
      const telegramUserId = ctx.from?.id?.toString()
      if (!telegramUserId) {
        await ctx.reply(getBotTranslations(locale).finance.unableToIdentifySender)
        return
      }

      if (isGroupChat(ctx)) {
        const resolved = showAll ? await requireAdmin(ctx) : await requireMember(ctx)
        if (!resolved) {
          return
        }

        await replyWithBillPlan({
          ctx,
          service: resolved.service,
          householdId: resolved.householdId,
          ...(showAll
            ? {
                orderMemberId: resolved.member.id
              }
            : {
                viewerMemberId: resolved.member.id
              }),
          forcedMode
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

      if (memberships.length === 1) {
        const membership = memberships[0]!
        const household =
          await options.householdConfigurationRepository.getHouseholdChatByHouseholdId(
            membership.householdId
          )
        await replyWithBillPlan({
          ctx,
          service: options.financeServiceForHousehold(membership.householdId),
          householdId: membership.householdId,
          householdName: household?.householdName ?? membership.householdId,
          ...(showAll
            ? {
                orderMemberId: membership.id
              }
            : {
                viewerMemberId: membership.id
              }),
          forcedMode
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
        ctx,
        payload: {
          kind: 'show',
          choices: households.map(({ membership }) => ({
            householdId: membership.householdId,
            memberId: membership.id
          }))
        }
      })
      await ctx.reply(
        locale === 'ru' ? 'Выберите дом для просмотра счета:' : 'Choose a household:',
        {
          reply_markup: {
            inline_keyboard: households.map(({ membership, household }, index) => [
              {
                text: household?.householdName ?? membership.householdId,
                callback_data: `${BILL_SHOW_CALLBACK_PREFIX}${index}:${forcedMode ?? 'auto'}`
              }
            ])
          }
        }
      )
    })

    bot.command('bill_all', async (ctx) => {
      const locale = await resolveReplyLocale({
        ctx,
        repository: options.householdConfigurationRepository
      })
      const args = commandArgs(ctx)
      const forcedMode = parseBillMode(args.find((arg) => parseBillMode(arg) !== null))
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

        await replyWithBillPlan({
          ctx,
          service: resolved.service,
          householdId: resolved.householdId,
          orderMemberId: resolved.member.id,
          forcedMode
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

      if (memberships.length === 1) {
        const membership = memberships[0]!
        const household =
          await options.householdConfigurationRepository.getHouseholdChatByHouseholdId(
            membership.householdId
          )
        await replyWithBillPlan({
          ctx,
          service: options.financeServiceForHousehold(membership.householdId),
          householdId: membership.householdId,
          householdName: household?.householdName ?? membership.householdId,
          orderMemberId: membership.id,
          forcedMode
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
        ctx,
        payload: {
          kind: 'show',
          choices: households.map(({ membership }) => ({
            householdId: membership.householdId,
            memberId: membership.id
          }))
        }
      })
      await ctx.reply(
        locale === 'ru' ? 'Выберите дом для просмотра счета:' : 'Choose a household:',
        {
          reply_markup: {
            inline_keyboard: households.map(({ membership, household }, index) => [
              {
                text: household?.householdName ?? membership.householdId,
                callback_data: `${BILL_SHOW_CALLBACK_PREFIX}${index}:${forcedMode ?? 'auto'}`
              }
            ])
          }
        }
      )
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
        const [choiceIndexRaw, modeRaw] = payload.split(':')
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
            viewerMemberId: memberId
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
            viewerMemberId: actingMember.id
          })
        )
        await ctx.answerCallbackQuery({
          text: locale === 'ru' ? 'Коммуналка отмечена по плану.' : 'Marked as paid as planned.'
        })
      }
    )

    bot.command('household_status', async (ctx) => {
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

        const settings = await options.householdConfigurationRepository.getHouseholdBillingSettings(
          resolved.householdId
        )

        const webAppUrl =
          options.miniAppUrl && ctx.me.username
            ? `${options.miniAppUrl}${options.miniAppUrl.includes('?') ? '&' : '?'}bot=${ctx.me.username}`
            : options.miniAppUrl

        await ctx.reply(
          formatHouseholdStatus(locale, dashboard, settings.rentDueDay),
          webAppUrl
            ? {
                reply_markup: {
                  inline_keyboard: [
                    [
                      {
                        text: getBotTranslations(locale).setup.openMiniAppButton,
                        web_app: { url: webAppUrl }
                      }
                    ]
                  ]
                }
              }
            : {}
        )
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
