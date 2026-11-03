import {
  formatMoneyDisplay,
  formatMonthDisplay,
  nextPeriod,
  nowInstant,
  parseMajorToMinor,
  type SupportedLocale
} from '@household/domain'
import type {
  FinancePaymentKind,
  HouseholdAuditEventRecord,
  HouseholdAuditNotificationCategory,
  HouseholdAuditNotificationRepository,
  HouseholdConfigurationRepository,
  HouseholdNotificationSettingsRecord
} from '@household/ports'

import type { HouseholdPaymentProgress } from './payment-progress'

export interface HouseholdAuditNotificationSendResult {
  telegramMessageId?: string | null
}

export interface HouseholdAuditNotificationService {
  /** Resolves to null when `dedupeKey` was already used for this household. */
  recordEvent(input: {
    householdId: string
    actorMemberId?: string | null
    actorDisplayName: string
    eventType: string
    category: HouseholdAuditNotificationCategory
    summaryText: string
    metadata?: Record<string, unknown>
    parseMode?: 'HTML'
    replyMarkup?: unknown
    preserveSummaryText?: boolean
    deliveryTopicRole?: 'notifications' | 'reminders'
    dedupeKey?: string
  }): Promise<HouseholdAuditEventRecord | null>
}

export type HouseholdPaymentProgressLoader = (input: {
  householdId: string
  kind: FinancePaymentKind
  period: string
}) => Promise<HouseholdPaymentProgress | null>

export interface HouseholdAuditNotificationDetails {
  locale: SupportedLocale
  compactText: string
  expandedText: string
}

export interface HouseholdAuditNotificationLogger {
  warn: (payload: object, message: string) => void
}

export const AUDIT_NOTIFICATION_VIEW_CALLBACK_PREFIX = 'audit_notice:view:'

export const PAYMENT_FULLY_PAID_EVENT = 'payment.fully_paid'

// Events that move a month closer to being paid; each one may complete it.
const PAYMENT_PROGRESS_EVENTS = new Set([
  'payment.recorded',
  'payment_period.closed',
  'utility_plan.resolved',
  'utility_plan.settled',
  'utility_vendor_payment.recorded'
])

// The household reads these lines in a group chat, so the copy stays gender-neutral and
// impersonal ("аренда оплачена", never "оплатил"), and the subject comes first.
const copy = {
  ru: {
    someone: 'Кто-то',
    rent: 'аренда',
    utilities: 'коммуналка',
    rentGenitive: 'аренды',
    utilitiesGenitive: 'коммуналки',
    of: 'из',
    paidFor: (kind: string, month: string | null) =>
      `${kind}${month ? ` за ${month}` : ''} оплачена`,
    paidForCapitalized: (kind: string, month: string | null) =>
      `${capitalize(kind)}${month ? ` за ${month}` : ''} оплачена`,
    paymentChanged: (kindGenitive: string | null) =>
      kindGenitive ? `оплата ${kindGenitive} изменена` : 'оплата изменена',
    paymentRemoved: (kindGenitive: string | null) =>
      kindGenitive ? `оплата ${kindGenitive} удалена` : 'оплата удалена',
    purchaseFallback: 'общая покупка',
    purchaseChanged: 'покупка изменена',
    purchaseRemoved: 'покупка удалена',
    billAdded: 'новый счёт',
    billChanged: 'счёт изменён',
    billRemoved: 'счёт удалён',
    billPaid: 'счёт оплачен',
    billPaymentRemoved: 'оплата счёта удалена',
    rentNow: (amount: string, fromMonth: string | null) =>
      `аренда теперь ${amount}${fromMonth ? ` с ${fromMonth}` : ''}`,
    monthOpened: (month: string) => `открыт месяц — ${month}`,
    monthClosed: (month: string) => `месяц закрыт — ${month}`,
    viaAssistant: (actor: string, summary: string) =>
      `${actor} через ассистента: ${summary} — готово`,
    rentFullyPaid: (month: string, members: number | null, amount: string, nextMonth: string) =>
      `Аренда за ${month} закрыта! ${members ? `Все ${members} оплатили` : 'Все оплатили'}, ${amount} — можно выдыхать до ${nextMonth}`,
    utilitiesFullyPaid: (month: string) =>
      `Коммуналка за ${month} закрыта! Свет горит, вода течёт — все оплатили`,
    detailShares: 'Доли',
    detailExcluded: 'Не участвуют',
    detailCustomSplit: 'Суммы указаны вручную',
    detailAlreadyPaid: 'Уже было оплачено',
    detailSkipped: 'Пропущены',
    detailBills: 'Счета',
    detailsButton: 'Подробнее',
    hideButton: 'Свернуть'
  },
  en: {
    someone: 'Someone',
    rent: 'rent',
    utilities: 'utilities',
    rentGenitive: 'rent',
    utilitiesGenitive: 'utilities',
    of: 'of',
    paidFor: (kind: string, month: string | null) => `${kind}${month ? ` for ${month}` : ''} paid`,
    paidForCapitalized: (kind: string, month: string | null) =>
      `${capitalize(kind)}${month ? ` for ${month}` : ''} paid`,
    paymentChanged: (kind: string | null) => (kind ? `${kind} payment changed` : 'payment changed'),
    paymentRemoved: (kind: string | null) => (kind ? `${kind} payment removed` : 'payment removed'),
    purchaseFallback: 'shared purchase',
    purchaseChanged: 'purchase edited',
    purchaseRemoved: 'purchase removed',
    billAdded: 'new bill',
    billChanged: 'bill edited',
    billRemoved: 'bill removed',
    billPaid: 'bill paid',
    billPaymentRemoved: 'bill payment removed',
    rentNow: (amount: string, fromMonth: string | null) =>
      `rent is now ${amount}${fromMonth ? ` from ${fromMonth}` : ''}`,
    monthOpened: (month: string) => `opened ${month}`,
    monthClosed: (month: string) => `closed ${month}`,
    viaAssistant: (actor: string, summary: string) =>
      `${actor} via the assistant: ${summary} — done`,
    rentFullyPaid: (month: string, members: number | null, amount: string, nextMonth: string) =>
      `${month} rent is done! ${members ? `All ${members} paid` : 'Everyone paid'}, ${amount} — breathe easy until ${nextMonth}`,
    utilitiesFullyPaid: (month: string) =>
      `${month} utilities are done! Lights on, water running — everyone paid`,
    detailShares: 'Shares',
    detailExcluded: 'Not included',
    detailCustomSplit: 'Custom amounts',
    detailAlreadyPaid: 'Already paid',
    detailSkipped: 'Skipped',
    detailBills: 'Bills',
    detailsButton: 'More',
    hideButton: 'Less'
  }
} as const

type Copy = (typeof copy)[SupportedLocale]

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function cleanText(value: string): string {
  return value
    .replace(/[ \t]+/g, ' ')
    .trim()
    .slice(0, 400)
}

function metadataString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function metadataRecords(
  metadata: Record<string, unknown>,
  key: string
): Record<string, unknown>[] {
  const raw = metadata[key]
  return Array.isArray(raw)
    ? raw.filter(
        (entry): entry is Record<string, unknown> =>
          Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry)
      )
    : []
}

function minorAmountOf(record: Record<string, unknown>): bigint | null {
  const minor = metadataString(record, 'amountMinor')
  if (minor) {
    try {
      return BigInt(minor)
    } catch {
      return null
    }
  }
  const major = metadataString(record, 'amountMajor')
  return major ? parseMajorToMinor(major) : null
}

function moneyOf(locale: SupportedLocale, record: Record<string, unknown>): string | null {
  const currency = metadataString(record, 'currency')
  const minor = minorAmountOf(record)
  if (currency && minor !== null) {
    return formatMoneyDisplay(minor, currency, locale)
  }
  return metadataString(record, 'amountText')
}

function sumMoney(locale: SupportedLocale, records: readonly Record<string, unknown>[]) {
  const currencies = new Set(records.map((record) => metadataString(record, 'currency')))
  if (records.length === 0 || currencies.size !== 1) {
    return null
  }
  let total = 0n
  for (const record of records) {
    const minor = minorAmountOf(record)
    if (minor === null) {
      return null
    }
    total += minor
  }
  return formatMoneyDisplay(total, [...currencies][0]!, locale)
}

function nameOf(record: Record<string, unknown>): string | null {
  return metadataString(record, 'displayName')
}

function paymentKindOf(eventType: string, metadata: Record<string, unknown>) {
  const kind = metadataString(metadata, 'kind')
  if (kind === 'rent' || kind === 'utilities') {
    return kind
  }
  return eventType.startsWith('utility_') ? 'utilities' : null
}

function kindWord(t: Copy, kind: FinancePaymentKind | null): string | null {
  return kind === 'rent' ? t.rent : kind === 'utilities' ? t.utilities : null
}

function kindGenitive(t: Copy, kind: FinancePaymentKind | null): string | null {
  return kind === 'rent' ? t.rentGenitive : kind === 'utilities' ? t.utilitiesGenitive : null
}

function joinParts(parts: readonly (string | null | undefined | false)[]): string {
  return parts.filter((part): part is string => Boolean(part)).join(' · ')
}

function progressText(t: Copy, progress: HouseholdPaymentProgress | null): string | null {
  return progress?.paidMembers !== null &&
    progress?.paidMembers !== undefined &&
    progress.totalMembers
    ? `${progress.paidMembers} ${t.of} ${progress.totalMembers}`
    : null
}

function eventEmoji(eventType: string, kind: FinancePaymentKind | null): string | null {
  if (eventType === PAYMENT_FULLY_PAID_EVENT) return '🎉'
  if (eventType.startsWith('agent.')) return '🤖'
  if (eventType.endsWith('.updated') && eventType !== 'rent.updated') return '✏️'
  if (eventType.endsWith('.deleted')) return '🗑'
  if (eventType === 'cycle.opened') return '📅'
  if (eventType === 'cycle.closed') return '📦'
  if (eventType.startsWith('purchase.')) return '🛒'
  if (eventType === 'rent.updated' || kind === 'rent') return '🏠'
  if (kind === 'utilities' || eventType.startsWith('utility_')) return '💡'
  return null
}

interface RenderContext {
  locale: SupportedLocale
  t: Copy
  actor: string
  eventType: string
  metadata: Record<string, unknown>
  kind: FinancePaymentKind | null
  month: string | null
  progress: HouseholdPaymentProgress | null
}

// "Ион: аренда за октябрь оплачена · 455 ₾ · 3 из 4", with "✍️ Стас" when someone
// else pressed the button.
function renderPaymentLine(context: RenderContext): string {
  const { t, actor, metadata, kind, month, locale } = context
  const word = kindWord(t, kind) ?? t.rent
  const closed = metadataRecords(metadata, 'closedMembers')
  const namedMember = metadataString(metadata, 'memberDisplayName')
  const targets =
    closed.length > 0
      ? closed.map((member) => ({
          name: nameOf(member) ?? t.someone,
          amount: moneyOf(locale, member)
        }))
      : [{ name: namedMember ?? actor, amount: moneyOf(locale, metadata) }]
  const progress = progressText(t, context.progress)

  if (targets.length === 1) {
    const target = targets[0]!
    return joinParts([
      `${target.name}: ${t.paidFor(word, month)}`,
      target.amount,
      progress,
      target.name !== actor ? `✍️ ${actor}` : null
    ])
  }

  return joinParts([
    `${t.paidForCapitalized(word, month)}: ${targets.map((target) => target.name).join(', ')}`,
    sumMoney(locale, closed),
    progress,
    `✍️ ${actor}`
  ])
}

function renderUtilityPlanLine(context: RenderContext): string {
  const { t, actor, metadata, month, locale } = context
  const assignments = metadataRecords(metadata, 'resolvedAssignments')
  const members = [
    ...new Set(assignments.map((assignment) => nameOf(assignment)).filter(Boolean))
  ] as string[]
  const single = members.length === 1 ? members[0]! : null
  const subject =
    single ?? metadataString(metadata, 'memberDisplayName') ?? (members.length === 0 ? actor : null)

  if (subject) {
    const bills = assignments
      .map((assignment) =>
        [metadataString(assignment, 'billName'), moneyOf(locale, assignment)]
          .filter(Boolean)
          .join(' ')
      )
      .filter(Boolean)
      .join(', ')
    return joinParts([
      `${subject}: ${t.paidFor(t.utilities, month)}`,
      bills || null,
      subject !== actor ? `✍️ ${actor}` : null
    ])
  }

  return joinParts([
    `${t.paidForCapitalized(t.utilities, month)}: ${members.join(', ')}`,
    sumMoney(locale, assignments),
    `✍️ ${actor}`
  ])
}

function renderFullyPaidLine(context: RenderContext): string {
  const { t, metadata, kind, locale } = context
  const period = metadataString(metadata, 'period') ?? ''
  const month = formatMonthDisplay(period, locale)
  if (kind === 'utilities') {
    return t.utilitiesFullyPaid(month)
  }
  const members = metadata.totalMembers
  return t.rentFullyPaid(
    month,
    typeof members === 'number' && members > 0 ? members : null,
    moneyOf(locale, metadata) ?? '',
    formatMonthDisplay(nextPeriod(period), locale, 'genitive')
  )
}

function renderLine(context: RenderContext, fallback: string): string {
  const { t, actor, eventType, metadata, kind, month, locale } = context
  const money = moneyOf(locale, metadata)
  const description = metadataString(metadata, 'description')
  const billName = metadataString(metadata, 'billName')

  switch (eventType) {
    case PAYMENT_FULLY_PAID_EVENT:
      return renderFullyPaidLine(context)
    case 'payment.recorded':
    case 'payment_period.closed':
      return renderPaymentLine(context)
    case 'utility_plan.resolved':
    case 'utility_plan.settled':
      return renderUtilityPlanLine(context)
    case 'payment.updated':
      return joinParts([
        `${actor}: ${t.paymentChanged(kindGenitive(t, kind))}`,
        metadataString(metadata, 'memberDisplayName'),
        money
      ])
    case 'payment.deleted':
      return joinParts([`${actor}: ${t.paymentRemoved(kindGenitive(t, kind))}`, money])
    case 'purchase.added':
    case 'purchase.created':
    case 'purchase.confirmed': {
      const payer = metadataString(metadata, 'payerDisplayName') ?? actor
      return joinParts([
        `${payer}: ${description ?? t.purchaseFallback}`,
        money,
        payer !== actor ? `✍️ ${actor}` : null
      ])
    }
    case 'purchase.updated':
      return joinParts([`${actor}: ${t.purchaseChanged}`, description, money])
    case 'purchase.deleted':
      return joinParts([`${actor}: ${t.purchaseRemoved}`, description, money])
    case 'utility_bill.added':
      return joinParts([`${actor}: ${t.billAdded}`, billName, money])
    case 'utility_bill.updated':
      return joinParts([`${actor}: ${t.billChanged}`, billName, money])
    case 'utility_bill.deleted':
      return joinParts([`${actor}: ${t.billRemoved}`, billName])
    case 'utility_vendor_payment.recorded':
      return joinParts([`${actor}: ${t.billPaid}`, billName, money])
    case 'utility_vendor_payment.deleted':
      return joinParts([`${actor}: ${t.billPaymentRemoved}`, billName])
    case 'rent.updated': {
      const period = metadataString(metadata, 'period')
      return `${actor}: ${t.rentNow(
        money ?? '',
        period ? formatMonthDisplay(period, locale, 'genitive') : null
      )}`
    }
    case 'cycle.opened':
      return `${actor}: ${t.monthOpened(month ?? '')}`
    case 'cycle.closed':
      return `${actor}: ${t.monthClosed(month ?? '')}`
  }

  if (eventType.startsWith('agent.')) {
    const summary = metadataString(metadata, 'summary')
    return summary ? t.viaAssistant(actor, summary) : fallback
  }

  return fallback
}

function buildDetailLines(context: RenderContext): string[] {
  const { t, metadata, locale, eventType } = context
  const lines: string[] = []

  if (eventType.startsWith('purchase.')) {
    const participants = metadataRecords(metadata, 'participants')
    const included = participants.filter((participant) => participant.included !== false)
    const excluded = participants.filter((participant) => participant.included === false)
    const customSplit = metadataString(metadata, 'splitMode') === 'custom_amounts'
    const hasShares = included.some((participant) => metadataString(participant, 'shareAmountText'))
    // An even split among everyone is what the household assumes; only say more otherwise.
    if (!customSplit && !hasShares && excluded.length === 0) {
      return lines
    }
    if (customSplit) {
      lines.push(t.detailCustomSplit)
    }
    if (included.length > 0) {
      lines.push(
        `${t.detailShares}: ${included
          .map((participant) =>
            [nameOf(participant), metadataString(participant, 'shareAmountText')]
              .filter(Boolean)
              .join(' ')
          )
          .join(', ')}`
      )
    }
    if (excluded.length > 0) {
      lines.push(
        `${t.detailExcluded}: ${excluded
          .map((participant) => nameOf(participant))
          .filter(Boolean)
          .join(', ')}`
      )
    }
  }

  const skipped = metadataRecords(metadata, 'skippedMembers')
  const alreadyPaid = skipped.filter((member) => member.reason === 'already_settled')
  const otherSkipped = skipped.filter((member) => member.reason !== 'already_settled')
  if (alreadyPaid.length > 0) {
    lines.push(`${t.detailAlreadyPaid}: ${alreadyPaid.map(nameOf).filter(Boolean).join(', ')}`)
  }
  if (otherSkipped.length > 0) {
    lines.push(`${t.detailSkipped}: ${otherSkipped.map(nameOf).filter(Boolean).join(', ')}`)
  }

  const assignments = metadataRecords(metadata, 'resolvedAssignments')
  const assignedMembers = new Set(assignments.map(nameOf))
  if (assignedMembers.size > 1) {
    lines.push(
      `${t.detailBills}:`,
      ...assignments.map(
        (assignment) =>
          `• ${joinParts([nameOf(assignment), metadataString(assignment, 'billName'), moneyOf(locale, assignment)])}`
      )
    )
  }

  return lines
}

export function renderAuditNotification(input: {
  locale: SupportedLocale
  actorDisplayName: string
  eventType: string
  metadata: Record<string, unknown>
  fallbackSummaryText: string
  progress?: HouseholdPaymentProgress | null
}): {
  compactText: string
  details: HouseholdAuditNotificationDetails | null
} {
  const t = copy[input.locale]
  const kind = paymentKindOf(input.eventType, input.metadata)
  const period = metadataString(input.metadata, 'period')
  const context: RenderContext = {
    locale: input.locale,
    t,
    actor: input.actorDisplayName.trim() || t.someone,
    eventType: input.eventType,
    metadata: input.metadata,
    kind,
    month: period ? formatMonthDisplay(period, input.locale) : null,
    progress: input.progress ?? null
  }
  const line = cleanText(renderLine(context, input.fallbackSummaryText))
  const emoji = eventEmoji(input.eventType, kind)
  const compactText = emoji && !line.startsWith(emoji) ? `${emoji} ${line}` : line
  const detailLines = buildDetailLines(context)

  return {
    compactText,
    details:
      detailLines.length > 0
        ? {
            locale: input.locale,
            compactText,
            expandedText: [compactText, '', ...detailLines].join('\n')
          }
        : null
  }
}

export function getAuditNotificationDetails(
  event: HouseholdAuditEventRecord
): HouseholdAuditNotificationDetails | null {
  const raw = event.metadata.notificationDetails
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null
  }
  const record = raw as Record<string, unknown>
  const locale = record.locale === 'ru' || record.locale === 'en' ? record.locale : null
  const compactText = typeof record.compactText === 'string' ? record.compactText : null
  const expandedText = typeof record.expandedText === 'string' ? record.expandedText : null
  if (!locale || !compactText || !expandedText) {
    return null
  }
  return {
    locale,
    compactText,
    expandedText
  }
}

export function buildAuditNotificationViewReplyMarkup(input: {
  eventId: string
  locale: SupportedLocale
  viewMode: 'compact' | 'expanded'
}): {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>
} {
  const t = copy[input.locale]
  const nextViewMode = input.viewMode === 'compact' ? 'expanded' : 'compact'

  return {
    inline_keyboard: [
      [
        {
          text: input.viewMode === 'compact' ? t.detailsButton : t.hideButton,
          callback_data: `${AUDIT_NOTIFICATION_VIEW_CALLBACK_PREFIX}${input.eventId}:${nextViewMode}`
        }
      ]
    ]
  }
}

function categoryEnabled(
  category: HouseholdAuditNotificationCategory,
  settings: HouseholdNotificationSettingsRecord
): boolean {
  switch (category) {
    case 'period_events':
      return settings.periodEvents
    case 'plan_events':
      return settings.planEvents
    case 'purchase_events':
      return settings.purchaseEvents
    case 'payment_events':
      return settings.paymentEvents
  }
}

export function createHouseholdAuditNotificationService(input: {
  repository: HouseholdAuditNotificationRepository
  householdConfigurationRepository: Pick<
    HouseholdConfigurationRepository,
    'getHouseholdChatByHouseholdId' | 'getHouseholdTopicBinding'
  >
  sendTopicMessage: (message: {
    householdId: string
    chatId: string
    threadId: string | null
    text: string
    parseMode?: 'HTML'
    replyMarkup?: unknown
  }) => Promise<HouseholdAuditNotificationSendResult | void>
  /**
   * Reads where a payment kind stands after a payment event. With it, rent lines carry
   * "3 из 4" and the month's "fully paid" milestone is announced exactly once.
   */
  paymentProgress?: HouseholdPaymentProgressLoader
  onDelivered?: (input: {
    event: HouseholdAuditEventRecord
    chatId: string
    threadId: string | null
    messageId: string
  }) => Promise<void>
  logger?: HouseholdAuditNotificationLogger
}): HouseholdAuditNotificationService {
  async function markSkipped(eventId: string, reason: string) {
    await input.repository.updateAuditEventDelivery({
      eventId,
      deliveryStatus: 'skipped',
      deliveryError: reason
    })
  }

  async function loadProgress(eventInput: {
    householdId: string
    eventType: string
    metadata: Record<string, unknown>
  }): Promise<HouseholdPaymentProgress | null> {
    const kind = paymentKindOf(eventInput.eventType, eventInput.metadata)
    const period = metadataString(eventInput.metadata, 'period')
    if (!input.paymentProgress || !kind || !period) {
      return null
    }
    if (!PAYMENT_PROGRESS_EVENTS.has(eventInput.eventType)) {
      return null
    }
    try {
      return await input.paymentProgress({ householdId: eventInput.householdId, kind, period })
    } catch (error) {
      input.logger?.warn(
        {
          event: 'household.audit_notification.payment_progress_failed',
          householdId: eventInput.householdId,
          kind,
          period,
          error: error instanceof Error ? error.message : String(error)
        },
        'Failed to load payment progress for audit notification'
      )
      return null
    }
  }

  const service: HouseholdAuditNotificationService = {
    async recordEvent(eventInput) {
      const chatForLocale = await input.householdConfigurationRepository
        .getHouseholdChatByHouseholdId(eventInput.householdId)
        .catch(() => null)
      const locale = chatForLocale?.defaultLocale ?? 'en'
      const baseMetadata = eventInput.metadata ?? {}
      const progress = eventInput.preserveSummaryText
        ? null
        : await loadProgress({
            householdId: eventInput.householdId,
            eventType: eventInput.eventType,
            metadata: baseMetadata
          })
      const rendered = eventInput.preserveSummaryText
        ? {
            compactText: eventInput.summaryText,
            details: null
          }
        : renderAuditNotification({
            locale,
            actorDisplayName: eventInput.actorDisplayName,
            eventType: eventInput.eventType,
            metadata: baseMetadata,
            fallbackSummaryText: eventInput.summaryText,
            progress
          })
      const metadata = rendered.details
        ? {
            ...baseMetadata,
            notificationDetails: rendered.details
          }
        : baseMetadata
      const event = await input.repository.createAuditEvent({
        householdId: eventInput.householdId,
        actorMemberId: eventInput.actorMemberId ?? null,
        actorDisplayName: eventInput.actorDisplayName.trim() || 'Someone',
        eventType: eventInput.eventType,
        category: eventInput.category,
        summaryText: rendered.compactText,
        metadata,
        dedupeKey: eventInput.dedupeKey ?? null,
        createdAt: nowInstant()
      })
      if (!event) {
        return null
      }

      try {
        const settings = await input.repository.getNotificationSettings(event.householdId)
        if (!categoryEnabled(event.category, settings)) {
          await markSkipped(event.id, 'category_disabled')
          return event
        }

        const [resolvedChat, notificationTopic, reminderTopic] = await Promise.all([
          chatForLocale
            ? Promise.resolve(chatForLocale)
            : input.householdConfigurationRepository.getHouseholdChatByHouseholdId(
                event.householdId
              ),
          input.householdConfigurationRepository.getHouseholdTopicBinding(
            event.householdId,
            'notifications'
          ),
          input.householdConfigurationRepository.getHouseholdTopicBinding(
            event.householdId,
            'reminders'
          )
        ])
        const chat = resolvedChat
        const topic =
          eventInput.deliveryTopicRole === 'reminders'
            ? (reminderTopic ?? null)
            : (notificationTopic ?? reminderTopic)

        if (!chat || (!topic && eventInput.deliveryTopicRole !== 'reminders')) {
          await markSkipped(event.id, 'notification_topic_unavailable')
          return event
        }

        const sent = await input.sendTopicMessage({
          householdId: event.householdId,
          chatId: chat.telegramChatId,
          threadId: topic?.telegramThreadId ?? null,
          text: event.summaryText,
          ...(eventInput.parseMode ? { parseMode: eventInput.parseMode } : {}),
          ...(eventInput.replyMarkup !== undefined || rendered.details
            ? {
                replyMarkup:
                  eventInput.replyMarkup ??
                  buildAuditNotificationViewReplyMarkup({
                    eventId: event.id,
                    locale,
                    viewMode: 'compact'
                  })
              }
            : {})
        })

        await input.repository.updateAuditEventDelivery({
          eventId: event.id,
          deliveryStatus: 'sent',
          deliveredTelegramChatId: chat.telegramChatId,
          deliveredTelegramThreadId: topic?.telegramThreadId ?? null,
          deliveredTelegramMessageId: sent?.telegramMessageId ?? null,
          deliveryError: null
        })
        if (sent?.telegramMessageId && input.onDelivered) {
          try {
            await input.onDelivered({
              event,
              chatId: chat.telegramChatId,
              threadId: topic?.telegramThreadId ?? null,
              messageId: sent.telegramMessageId
            })
          } catch (error) {
            input.logger?.warn(
              {
                event: 'household.audit_notification.post_delivery_hook_failed',
                householdId: event.householdId,
                auditEventId: event.id,
                error
              },
              'Audit notification post-delivery hook failed'
            )
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        input.logger?.warn(
          {
            event: 'household.audit_notification.delivery_failed',
            householdId: event.householdId,
            auditEventId: event.id,
            error: message
          },
          'Failed to deliver household audit notification'
        )
        await input.repository.updateAuditEventDelivery({
          eventId: event.id,
          deliveryStatus: 'failed',
          deliveryError: message
        })
      }

      // The milestone follows the payment line that completed the month, once per month.
      if (progress?.fullyPaid) {
        await service.recordEvent({
          householdId: event.householdId,
          actorDisplayName: 'System',
          eventType: PAYMENT_FULLY_PAID_EVENT,
          category: 'payment_events',
          summaryText: `${progress.kind} for ${progress.period} is fully paid`,
          metadata: {
            kind: progress.kind,
            period: progress.period,
            amountMinor: progress.totalDueMinor.toString(),
            currency: progress.currency,
            totalMembers: progress.totalMembers
          },
          dedupeKey: `${PAYMENT_FULLY_PAID_EVENT}:${progress.kind}:${progress.period}`
        })
      }

      return event
    }
  }

  return service
}
