import { Money, nowInstant, type CurrencyCode, type SupportedLocale } from '@household/domain'
import type {
  HouseholdAuditEventRecord,
  HouseholdAuditNotificationCategory,
  HouseholdAuditNotificationRepository,
  HouseholdConfigurationRepository,
  HouseholdNotificationSettingsRecord
} from '@household/ports'

export interface HouseholdAuditNotificationSendResult {
  telegramMessageId?: string | null
}

export interface HouseholdAuditNotificationService {
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
  }): Promise<HouseholdAuditEventRecord>
}

export interface HouseholdAuditNotificationDetails {
  locale: SupportedLocale
  compactText: string
  expandedText: string
}

export interface HouseholdAuditNotificationLogger {
  warn: (payload: object, message: string) => void
}

export const AUDIT_NOTIFICATION_VIEW_CALLBACK_PREFIX = 'audit_notice:view:'

function cleanSummaryText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 240)
}

export function formatAuditNotificationSummary(input: {
  actorDisplayName: string
  actionText: string
  objectText?: string | null
  amountText?: string | null
  period?: string | null
}): string {
  const parts = [
    input.actorDisplayName.trim() || 'Someone',
    input.actionText.trim(),
    input.objectText?.trim() || null,
    input.amountText?.trim() || null,
    input.period?.trim() ? `(${input.period.trim()})` : null
  ].filter((part): part is string => Boolean(part))

  return cleanSummaryText(parts.join(' '))
}

function metadataString(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function formatPeriodLabel(locale: SupportedLocale, value: string | null): string | null {
  if (!value) {
    return null
  }

  const match = /^(\d{4})-(\d{2})$/.exec(value)
  if (!match) {
    return value
  }

  const year = Number(match[1])
  const month = Number(match[2])
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return value
  }

  return new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(Date.UTC(year, month - 1, 1)))
}

function metadataBoolean(metadata: Record<string, unknown>, key: string): boolean | null {
  const value = metadata[key]
  return typeof value === 'boolean' ? value : null
}

function formatMoneyFromMetadata(metadata: Record<string, unknown>): string | null {
  const amountText = metadataString(metadata, 'amountText')
  if (amountText) {
    return amountText
  }

  const amountMajorRaw = metadataString(metadata, 'amountMajor')
  const amountMajorCurrency = metadataString(metadata, 'currency')
  if (amountMajorRaw && (amountMajorCurrency === 'USD' || amountMajorCurrency === 'GEL')) {
    if (amountMajorCurrency === 'USD') {
      return `$${amountMajorRaw}`
    }
    return `${amountMajorRaw} ₾`
  }

  const amountMinorRaw = metadataString(metadata, 'amountMinor')
  const currency = metadataString(metadata, 'currency')
  if (!amountMinorRaw || (currency !== 'USD' && currency !== 'GEL')) {
    return null
  }

  let amount: string
  try {
    amount = Money.fromMinor(BigInt(amountMinorRaw), currency as CurrencyCode).toMajorString()
  } catch {
    return null
  }
  if (currency === 'USD') {
    return `$${amount}`
  }
  if (currency === 'GEL') {
    return `${amount} ₾`
  }
  return `${amount} ${currency}`
}

function formatMoneyFromRecord(record: Record<string, unknown>): string | null {
  return formatMoneyFromMetadata(record)
}

function localizedKind(locale: SupportedLocale, value: string | null): string | null {
  if (!value) {
    return null
  }
  if (locale === 'ru') {
    if (value === 'rent') return 'аренда'
    if (value === 'utilities') return 'коммуналка'
  }
  return value
}

function localizedClosedPaymentKind(locale: SupportedLocale, value: string | null): string | null {
  if (locale === 'ru') {
    if (value === 'rent') return 'аренды'
    if (value === 'utilities') return 'коммуналки'
  }
  return localizedKind(locale, value)
}

function actionText(locale: SupportedLocale, eventType: string): string | null {
  const en: Record<string, string> = {
    'cycle.opened': 'opened period',
    'cycle.closed': 'closed period',
    'rent.updated': 'updated rent:',
    'utility_bill.added': 'added utility bill:',
    'utility_bill.updated': 'updated utility bill:',
    'utility_bill.deleted': 'deleted utility bill',
    'purchase.added': 'added purchase:',
    'purchase.updated': 'updated purchase:',
    'purchase.confirmed': 'confirmed purchase:',
    'purchase.deleted': 'deleted purchase',
    'payment.recorded': 'recorded payment:',
    'payment.updated': 'updated payment:',
    'payment.deleted': 'deleted payment',
    'payment_period.closed': 'closed',
    'utility_plan.resolved': 'marked planned utilities paid:',
    'utility_plan.settled': 'settled planned utilities:',
    'utility_vendor_payment.recorded': 'recorded utility bill payment'
  }
  const ru: Record<string, string> = {
    'cycle.opened': 'открытие периода',
    'cycle.closed': 'закрытие периода',
    'rent.updated': 'обновление аренды',
    'utility_bill.added': 'добавление коммунального счёта',
    'utility_bill.updated': 'обновление коммунального счёта',
    'utility_bill.deleted': 'удаление коммунального счёта',
    'purchase.added': 'добавление покупки',
    'purchase.updated': 'обновление покупки',
    'purchase.confirmed': 'подтверждение покупки',
    'purchase.deleted': 'удаление покупки',
    'payment.recorded': 'запись платежа',
    'payment.updated': 'обновление платежа',
    'payment.deleted': 'удаление платежа',
    'payment_period.closed': 'закрытие',
    'utility_plan.resolved': 'отметил коммуналку по плану:',
    'utility_plan.settled': 'закрыл коммуналку по плану:',
    'utility_vendor_payment.recorded': 'запись оплаты коммуналки'
  }
  return (locale === 'ru' ? ru : en)[eventType] ?? null
}

function utilityPlanAssignmentDetails(metadata: Record<string, unknown>): Array<{
  memberId: string | null
  displayName: string
  billName: string
  amountText: string | null
}> {
  const raw = metadata.resolvedAssignments
  if (!Array.isArray(raw)) {
    return []
  }

  return raw
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return null
      }
      const record = entry as Record<string, unknown>
      const memberId = typeof record.memberId === 'string' ? record.memberId : null
      const displayName =
        typeof record.displayName === 'string' && record.displayName.trim().length > 0
          ? record.displayName.trim()
          : memberId
            ? `#${memberId}`
            : null
      const billName =
        typeof record.billName === 'string' && record.billName.trim().length > 0
          ? record.billName.trim()
          : null
      if (!displayName || !billName) {
        return null
      }

      return {
        memberId,
        displayName,
        billName,
        amountText: formatMoneyFromRecord(record)
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
}

function utilityPlanResolutionDescription(
  locale: SupportedLocale,
  metadata: Record<string, unknown>
): string | null {
  const assignments = utilityPlanAssignmentDetails(metadata)
  if (assignments.length === 0) {
    const member = metadataString(metadata, 'memberDisplayName')
    if (member) {
      return member
    }

    return metadataBoolean(metadata, 'allMembers') === true
      ? locale === 'ru'
        ? 'все участники'
        : 'all members'
      : null
  }

  const memberNames = [...new Set(assignments.map((assignment) => assignment.displayName))]
  const totalByCurrency = new Map<string, bigint>()
  for (const entry of (metadata.resolvedAssignments as unknown[]).filter(
    (item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === 'object' && !Array.isArray(item)
  )) {
    const currency = metadataString(entry, 'currency')
    const amountMinorRaw = metadataString(entry, 'amountMinor')
    if ((currency !== 'USD' && currency !== 'GEL') || !amountMinorRaw) {
      continue
    }

    try {
      totalByCurrency.set(currency, (totalByCurrency.get(currency) ?? 0n) + BigInt(amountMinorRaw))
    } catch {
      // Ignore malformed amounts in notification metadata.
    }
  }

  if (memberNames.length === 1) {
    const billSummary = assignments
      .map((assignment) =>
        assignment.amountText
          ? `${assignment.billName} ${assignment.amountText}`
          : assignment.billName
      )
      .join('; ')
    return billSummary ? `${memberNames[0]} · ${billSummary}` : memberNames[0]!
  }

  const totalText =
    totalByCurrency.size === 1
      ? (() => {
          const [currency, amountMinor] = [...totalByCurrency.entries()][0]!
          return formatMoneyFromMetadata({
            amountMinor: amountMinor.toString(),
            currency
          })
        })()
      : null
  const memberCountText =
    locale === 'ru'
      ? `${memberNames.length} участн.`
      : `${memberNames.length} ${memberNames.length === 1 ? 'member' : 'members'}`

  return totalText ? `${memberCountText} · ${totalText}` : memberCountText
}

function participantDetails(metadata: Record<string, unknown>): Array<{
  memberId: string | null
  displayName: string
  included: boolean
  shareAmountText: string | null
}> {
  const raw = metadata.participants
  if (!Array.isArray(raw)) {
    return []
  }

  return raw
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return null
      }
      const record = entry as Record<string, unknown>
      const memberId = typeof record.memberId === 'string' ? record.memberId : null
      const displayName =
        typeof record.displayName === 'string' && record.displayName.trim().length > 0
          ? record.displayName.trim()
          : memberId
            ? `#${memberId}`
            : null
      if (!displayName) {
        return null
      }
      return {
        memberId,
        displayName,
        included: record.included !== false,
        shareAmountText:
          typeof record.shareAmountText === 'string' && record.shareAmountText.trim().length > 0
            ? record.shareAmountText.trim()
            : null
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
}

function splitModeLabel(locale: SupportedLocale, splitMode: string | null): string | null {
  if (!splitMode) {
    return null
  }
  if (splitMode === 'custom_amounts') {
    return locale === 'ru' ? 'индивидуальные суммы' : 'custom amounts'
  }
  if (splitMode === 'equal') {
    return locale === 'ru' ? 'поровну' : 'equal'
  }
  return splitMode
}

function paymentMemberDetails(
  metadata: Record<string, unknown>,
  key: 'closedMembers' | 'skippedMembers'
): Array<{
  displayName: string
  amountText: string | null
  reason: string | null
}> {
  const raw = metadata[key]
  if (!Array.isArray(raw)) {
    return []
  }

  return raw
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return null
      }
      const record = entry as Record<string, unknown>
      const memberId = typeof record.memberId === 'string' ? record.memberId : null
      const displayName =
        typeof record.displayName === 'string' && record.displayName.trim().length > 0
          ? record.displayName.trim()
          : memberId
            ? `#${memberId}`
            : null
      if (!displayName) {
        return null
      }

      return {
        displayName,
        amountText: formatMoneyFromMetadata(record),
        reason: typeof record.reason === 'string' ? record.reason : null
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
}

function buildExpandedText(input: {
  locale: SupportedLocale
  compactText: string
  metadata: Record<string, unknown>
}): string | null {
  const lines: string[] = [input.compactText]
  let hasMeaningfulDetail = false
  const amountText = formatMoneyFromMetadata(input.metadata)
  const period = formatPeriodLabel(input.locale, metadataString(input.metadata, 'period'))
  const payer = metadataString(input.metadata, 'payerDisplayName')
  const member = metadataString(input.metadata, 'memberDisplayName')
  const kind = localizedKind(input.locale, metadataString(input.metadata, 'kind'))
  const splitMode = splitModeLabel(input.locale, metadataString(input.metadata, 'splitMode'))
  const participants = participantDetails(input.metadata)
  const included = participants.filter((participant) => participant.included)
  const excluded = participants.filter((participant) => !participant.included)
  const closedMembers = paymentMemberDetails(input.metadata, 'closedMembers')
  const skippedMembers = paymentMemberDetails(input.metadata, 'skippedMembers')
  const utilityAssignments = utilityPlanAssignmentDetails(input.metadata)

  // Amount, period and kind are already carried by the compact line, so they
  // enrich the expanded view but never justify a "Details" button on their own.
  if (amountText) {
    lines.push(`${input.locale === 'ru' ? 'Сумма' : 'Amount'}: ${amountText}`)
  }
  if (period) {
    lines.push(`${input.locale === 'ru' ? 'Период' : 'Period'}: ${period}`)
  }
  if (kind) {
    lines.push(`${input.locale === 'ru' ? 'Тип' : 'Kind'}: ${kind}`)
  }
  if (payer) {
    lines.push(`${input.locale === 'ru' ? 'Плательщик' : 'Payer'}: ${payer}`)
    hasMeaningfulDetail = true
  }
  if (member) {
    lines.push(`${input.locale === 'ru' ? 'Участник' : 'Member'}: ${member}`)
    hasMeaningfulDetail = true
  }
  if (splitMode) {
    lines.push(`${input.locale === 'ru' ? 'Разделение' : 'Split'}: ${splitMode}`)
    hasMeaningfulDetail = true
  }
  if (included.length > 0) {
    lines.push(
      `${input.locale === 'ru' ? 'Участники' : 'Participants'}: ${included
        .map((participant) =>
          participant.shareAmountText
            ? `${participant.displayName} ${participant.shareAmountText}`
            : participant.displayName
        )
        .join(', ')}`
    )
    hasMeaningfulDetail = true
  }
  if (excluded.length > 0) {
    lines.push(
      `${input.locale === 'ru' ? 'Исключены' : 'Excluded'}: ${excluded
        .map((participant) => participant.displayName)
        .join(', ')}`
    )
    hasMeaningfulDetail = true
  }
  if (metadataBoolean(input.metadata, 'allMembers') === true) {
    lines.push(input.locale === 'ru' ? 'Для всех участников' : 'For all members')
    hasMeaningfulDetail = true
  }
  if (utilityAssignments.length > 0) {
    lines.push(
      `${input.locale === 'ru' ? 'Счета' : 'Bills'}: ${utilityAssignments
        .map((assignment) =>
          assignment.amountText
            ? `${assignment.displayName} · ${assignment.billName} ${assignment.amountText}`
            : `${assignment.displayName} · ${assignment.billName}`
        )
        .join('; ')}`
    )
    hasMeaningfulDetail = true
  }
  if (closedMembers.length > 0) {
    lines.push(
      `${input.locale === 'ru' ? 'Закрыто для' : 'Closed for'}: ${closedMembers
        .map((member) =>
          member.amountText ? `${member.displayName} ${member.amountText}` : member.displayName
        )
        .join(', ')}`
    )
    hasMeaningfulDetail = true
  }
  if (skippedMembers.length > 0) {
    lines.push(
      `${input.locale === 'ru' ? 'Пропущены' : 'Skipped'}: ${skippedMembers
        .map((member) =>
          member.reason ? `${member.displayName} (${member.reason})` : member.displayName
        )
        .join(', ')}`
    )
    hasMeaningfulDetail = true
  }

  return hasMeaningfulDetail ? lines.join('\n') : null
}

export function renderAuditNotification(input: {
  locale: SupportedLocale
  actorDisplayName: string
  eventType: string
  metadata: Record<string, unknown>
  fallbackSummaryText: string
}): {
  compactText: string
  details: HouseholdAuditNotificationDetails | null
} {
  // Milestone: every planned utility share is paid. Actor-less, celebratory.
  if (input.eventType === 'utility_plan.fully_paid') {
    const periodLabel = formatPeriodLabel(input.locale, metadataString(input.metadata, 'period'))
    const compactText =
      input.locale === 'ru'
        ? `🎉 Коммуналка${periodLabel ? ` за ${periodLabel}` : ''} закрыта — все платежи внесены!`
        : `🎉 Utilities${periodLabel ? ` for ${periodLabel}` : ''} are fully settled — everyone has paid!`
    return {
      compactText,
      details: null
    }
  }

  const actor = input.actorDisplayName.trim() || (input.locale === 'ru' ? 'Кто-то' : 'Someone')
  const actorPrefix = input.locale === 'ru' ? `${actor}:` : actor
  const action = actionText(input.locale, input.eventType)
  const utilityPlanDescription =
    input.eventType === 'utility_plan.resolved' || input.eventType === 'utility_plan.settled'
      ? utilityPlanResolutionDescription(input.locale, input.metadata)
      : null
  const description =
    utilityPlanDescription ??
    metadataString(input.metadata, 'description') ??
    metadataString(input.metadata, 'billName') ??
    (input.eventType === 'purchase.confirmed'
      ? input.locale === 'ru'
        ? 'общая покупка'
        : 'shared purchase'
      : null)
  const period = formatPeriodLabel(input.locale, metadataString(input.metadata, 'period'))
  const amount = formatMoneyFromMetadata(input.metadata)
  const kind =
    input.eventType === 'payment_period.closed'
      ? localizedClosedPaymentKind(input.locale, metadataString(input.metadata, 'kind'))
      : localizedKind(input.locale, metadataString(input.metadata, 'kind'))

  const compactText =
    action && input.eventType === 'payment_period.closed'
      ? cleanSummaryText(
          [
            actorPrefix,
            action,
            kind,
            period ? `${input.locale === 'ru' ? 'за' : 'for'} ${period}` : null
          ]
            .filter((part): part is string => Boolean(part))
            .join(' ')
        )
      : action
        ? cleanSummaryText(
            [
              actorPrefix,
              action,
              description,
              input.eventType.startsWith('payment.') || input.eventType === 'payment_period.closed'
                ? kind
                : null,
              amount,
              input.eventType === 'utility_plan.resolved' ||
              input.eventType === 'utility_plan.settled' ||
              input.eventType === 'cycle.opened' ||
              input.eventType === 'cycle.closed' ||
              input.eventType === 'payment_period.closed'
                ? period
                : period
                  ? `(${period})`
                  : null
            ]
              .filter((part): part is string => Boolean(part))
              .join(' ')
          )
        : cleanSummaryText(input.fallbackSummaryText)
  const expandedText = buildExpandedText({
    locale: input.locale,
    compactText,
    metadata: input.metadata
  })

  return {
    compactText,
    details:
      expandedText && expandedText !== compactText
        ? {
            locale: input.locale,
            compactText,
            expandedText
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
  const nextViewMode = input.viewMode === 'compact' ? 'expanded' : 'compact'
  const text =
    input.viewMode === 'compact'
      ? input.locale === 'ru'
        ? 'Детали'
        : 'Details'
      : input.locale === 'ru'
        ? 'Скрыть'
        : 'Hide'

  return {
    inline_keyboard: [
      [
        {
          text,
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
  logger?: HouseholdAuditNotificationLogger
}): HouseholdAuditNotificationService {
  async function markSkipped(eventId: string, reason: string) {
    await input.repository.updateAuditEventDelivery({
      eventId,
      deliveryStatus: 'skipped',
      deliveryError: reason
    })
  }

  return {
    async recordEvent(eventInput) {
      const chatForLocale = await input.householdConfigurationRepository
        .getHouseholdChatByHouseholdId(eventInput.householdId)
        .catch(() => null)
      const locale = chatForLocale?.defaultLocale ?? 'en'
      const baseMetadata = eventInput.metadata ?? {}
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
            fallbackSummaryText: eventInput.summaryText
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
        createdAt: nowInstant()
      })

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

      return event
    }
  }
}
