import { nowInstant } from '@household/domain'
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

export interface HouseholdAuditNotificationLogger {
  warn: (payload: object, message: string) => void
}

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
      const event = await input.repository.createAuditEvent({
        householdId: eventInput.householdId,
        actorMemberId: eventInput.actorMemberId ?? null,
        actorDisplayName: eventInput.actorDisplayName.trim() || 'Someone',
        eventType: eventInput.eventType,
        category: eventInput.category,
        summaryText: cleanSummaryText(eventInput.summaryText),
        metadata: eventInput.metadata ?? {},
        createdAt: nowInstant()
      })

      try {
        const settings = await input.repository.getNotificationSettings(event.householdId)
        if (!categoryEnabled(event.category, settings)) {
          await markSkipped(event.id, 'category_disabled')
          return event
        }

        const [chat, notificationTopic, reminderTopic] = await Promise.all([
          input.householdConfigurationRepository.getHouseholdChatByHouseholdId(event.householdId),
          input.householdConfigurationRepository.getHouseholdTopicBinding(
            event.householdId,
            'notifications'
          ),
          input.householdConfigurationRepository.getHouseholdTopicBinding(
            event.householdId,
            'reminders'
          )
        ])
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
          ...(eventInput.replyMarkup !== undefined
            ? {
                replyMarkup: eventInput.replyMarkup
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
