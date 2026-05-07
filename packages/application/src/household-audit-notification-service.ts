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
    replyMarkup?: unknown
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
    'utility_plan.resolved': 'resolved utility plan for',
    'utility_plan.settled': 'marked utility plan settled for',
    'utility_vendor_payment.recorded': 'recorded utility bill payment'
  }
  const ru: Record<string, string> = {
    'cycle.opened': 'открыл период',
    'cycle.closed': 'закрыл период',
    'rent.updated': 'обновил аренду:',
    'utility_bill.added': 'добавил коммунальный счёт:',
    'utility_bill.updated': 'обновил коммунальный счёт:',
    'utility_bill.deleted': 'удалил коммунальный счёт',
    'purchase.added': 'добавил покупку:',
    'purchase.updated': 'обновил покупку:',
    'purchase.confirmed': 'подтвердил покупку:',
    'purchase.deleted': 'удалил покупку',
    'payment.recorded': 'записал платёж:',
    'payment.updated': 'обновил платёж:',
    'payment.deleted': 'удалил платёж',
    'utility_plan.resolved': 'отметил коммунальный план за',
    'utility_plan.settled': 'закрыл коммунальный план за',
    'utility_vendor_payment.recorded': 'записал оплату коммуналки'
  }
  return (locale === 'ru' ? ru : en)[eventType] ?? null
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

function buildExpandedText(input: {
  locale: SupportedLocale
  compactText: string
  metadata: Record<string, unknown>
}): string | null {
  const lines: string[] = [input.compactText]
  let hasMeaningfulDetail = false
  const amountText = formatMoneyFromMetadata(input.metadata)
  const period = metadataString(input.metadata, 'period')
  const payer = metadataString(input.metadata, 'payerDisplayName')
  const member = metadataString(input.metadata, 'memberDisplayName')
  const kind = localizedKind(input.locale, metadataString(input.metadata, 'kind'))
  const splitMode = splitModeLabel(input.locale, metadataString(input.metadata, 'splitMode'))
  const participants = participantDetails(input.metadata)
  const included = participants.filter((participant) => participant.included)
  const excluded = participants.filter((participant) => !participant.included)

  if (amountText) {
    lines.push(`${input.locale === 'ru' ? 'Сумма' : 'Amount'}: ${amountText}`)
    hasMeaningfulDetail = true
  }
  if (period) {
    lines.push(`${input.locale === 'ru' ? 'Период' : 'Period'}: ${period}`)
  }
  if (kind) {
    lines.push(`${input.locale === 'ru' ? 'Тип' : 'Kind'}: ${kind}`)
    hasMeaningfulDetail = true
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
  const actor = input.actorDisplayName.trim() || (input.locale === 'ru' ? 'Кто-то' : 'Someone')
  const action = actionText(input.locale, input.eventType)
  const description =
    metadataString(input.metadata, 'description') ??
    metadataString(input.metadata, 'billName') ??
    (input.eventType === 'purchase.confirmed'
      ? input.locale === 'ru'
        ? 'общая покупка'
        : 'shared purchase'
      : null)
  const period = metadataString(input.metadata, 'period')
  const amount = formatMoneyFromMetadata(input.metadata)
  const kind = localizedKind(input.locale, metadataString(input.metadata, 'kind'))

  const compactText = action
    ? cleanSummaryText(
        [
          actor,
          action,
          description,
          input.eventType.startsWith('payment.') ? kind : null,
          amount,
          input.eventType === 'utility_plan.resolved' ||
          input.eventType === 'utility_plan.settled' ||
          input.eventType === 'cycle.opened' ||
          input.eventType === 'cycle.closed'
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
      const rendered = renderAuditNotification({
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
        const topic = notificationTopic ?? reminderTopic

        if (!chat || !topic) {
          await markSkipped(event.id, 'notification_topic_unavailable')
          return event
        }

        const sent = await input.sendTopicMessage({
          householdId: event.householdId,
          chatId: chat.telegramChatId,
          threadId: topic.telegramThreadId,
          text: event.summaryText,
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
          deliveredTelegramThreadId: topic.telegramThreadId,
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
