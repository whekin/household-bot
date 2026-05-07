import { describe, expect, test } from 'bun:test'

import { Temporal } from '@household/domain'
import type {
  CreateHouseholdAuditEventInput,
  HouseholdAuditEventRecord,
  HouseholdAuditNotificationRepository,
  HouseholdConfigurationRepository,
  HouseholdNotificationSettingsRecord,
  UpdateHouseholdAuditEventDeliveryInput,
  UpdateHouseholdNotificationSettingsInput
} from '@household/ports'

import {
  createHouseholdAuditNotificationService,
  formatAuditNotificationSummary
} from './household-audit-notification-service'

class AuditNotificationRepositoryStub implements HouseholdAuditNotificationRepository {
  events = new Map<string, HouseholdAuditEventRecord>()
  settings: HouseholdNotificationSettingsRecord = {
    householdId: 'household-1',
    periodEvents: true,
    planEvents: true,
    purchaseEvents: true,
    paymentEvents: true,
    createdAt: Temporal.Instant.from('2026-01-01T00:00:00Z'),
    updatedAt: Temporal.Instant.from('2026-01-01T00:00:00Z')
  }

  async createAuditEvent(
    input: CreateHouseholdAuditEventInput
  ): Promise<HouseholdAuditEventRecord> {
    const record: HouseholdAuditEventRecord = {
      id: `event-${this.events.size + 1}`,
      householdId: input.householdId,
      actorMemberId: input.actorMemberId ?? null,
      actorDisplayName: input.actorDisplayName,
      eventType: input.eventType,
      category: input.category,
      summaryText: input.summaryText,
      metadata: input.metadata ?? {},
      deliveryStatus: input.deliveryStatus ?? 'pending',
      deliveredTelegramChatId: null,
      deliveredTelegramThreadId: null,
      deliveredTelegramMessageId: null,
      deliveryError: null,
      createdAt: input.createdAt
    }
    this.events.set(record.id, record)
    return record
  }

  async getNotificationSettings(): Promise<HouseholdNotificationSettingsRecord> {
    return this.settings
  }

  async updateNotificationSettings(
    input: UpdateHouseholdNotificationSettingsInput
  ): Promise<HouseholdNotificationSettingsRecord> {
    this.settings = {
      ...this.settings,
      ...input,
      updatedAt: input.updatedAt
    }
    return this.settings
  }

  async updateAuditEventDelivery(
    input: UpdateHouseholdAuditEventDeliveryInput
  ): Promise<HouseholdAuditEventRecord | null> {
    const event = this.events.get(input.eventId)
    if (!event) {
      return null
    }

    const next: HouseholdAuditEventRecord = {
      ...event,
      deliveryStatus: input.deliveryStatus,
      deliveredTelegramChatId:
        input.deliveredTelegramChatId !== undefined
          ? input.deliveredTelegramChatId
          : event.deliveredTelegramChatId,
      deliveredTelegramThreadId:
        input.deliveredTelegramThreadId !== undefined
          ? input.deliveredTelegramThreadId
          : event.deliveredTelegramThreadId,
      deliveredTelegramMessageId:
        input.deliveredTelegramMessageId !== undefined
          ? input.deliveredTelegramMessageId
          : event.deliveredTelegramMessageId,
      deliveryError: input.deliveryError !== undefined ? input.deliveryError : event.deliveryError
    }
    this.events.set(next.id, next)
    return next
  }

  async listAuditEventsForHousehold(
    householdId: string,
    limit: number
  ): Promise<readonly HouseholdAuditEventRecord[]> {
    return [...this.events.values()]
      .filter((event) => event.householdId === householdId)
      .slice(0, limit)
  }
}

function householdRepository(input?: {
  notificationThreadId?: string | null
  reminderThreadId?: string | null
}): Pick<
  HouseholdConfigurationRepository,
  'getHouseholdChatByHouseholdId' | 'getHouseholdTopicBinding'
> {
  return {
    async getHouseholdChatByHouseholdId(householdId) {
      return {
        householdId,
        householdName: 'Kojori House',
        telegramChatId: '-100123',
        telegramChatType: 'supergroup',
        title: 'Kojori House',
        defaultLocale: 'en'
      }
    },
    async getHouseholdTopicBinding(householdId, role) {
      const threadId =
        role === 'notifications'
          ? input?.notificationThreadId
          : role === 'reminders'
            ? input?.reminderThreadId
            : null
      if (!threadId) {
        return null
      }
      return {
        householdId,
        role,
        telegramThreadId: threadId,
        topicName: role
      }
    }
  }
}

describe('formatAuditNotificationSummary', () => {
  test('keeps messages short and actor-first', () => {
    expect(
      formatAuditNotificationSummary({
        actorDisplayName: ' Alex ',
        actionText: 'added purchase:',
        objectText: 'groceries',
        amountText: '42 GEL'
      })
    ).toBe('Alex added purchase: groceries 42 GEL')
  })
})

describe('createHouseholdAuditNotificationService', () => {
  test('uses enabled category defaults and sends to notifications topic', async () => {
    const repository = new AuditNotificationRepositoryStub()
    const sentMessages: {
      chatId: string
      threadId: string | null
      text: string
    }[] = []
    const service = createHouseholdAuditNotificationService({
      repository,
      householdConfigurationRepository: householdRepository({
        notificationThreadId: '501',
        reminderThreadId: '401'
      }),
      sendTopicMessage: async (message) => {
        sentMessages.push({
          chatId: message.chatId,
          threadId: message.threadId,
          text: message.text
        })
        return { telegramMessageId: '9001' }
      }
    })

    const event = await service.recordEvent({
      householdId: 'household-1',
      actorMemberId: 'member-1',
      actorDisplayName: 'Alex',
      eventType: 'purchase.created',
      category: 'purchase_events',
      summaryText: 'Alex added purchase: groceries 42 GEL',
      metadata: { purchaseId: 'purchase-1' }
    })

    expect(event.deliveryStatus).toBe('pending')
    expect(sentMessages).toEqual([
      {
        chatId: '-100123',
        threadId: '501',
        text: 'Alex added purchase: groceries 42 GEL'
      }
    ])
    expect(repository.events.get(event.id)).toMatchObject({
      deliveryStatus: 'sent',
      deliveredTelegramThreadId: '501',
      deliveredTelegramMessageId: '9001'
    })
  })

  test('falls back to reminders topic when notifications is not bound', async () => {
    const repository = new AuditNotificationRepositoryStub()
    const sentThreadIds: (string | null)[] = []
    const service = createHouseholdAuditNotificationService({
      repository,
      householdConfigurationRepository: householdRepository({ reminderThreadId: '401' }),
      sendTopicMessage: async (message) => {
        sentThreadIds.push(message.threadId)
      }
    })

    await service.recordEvent({
      householdId: 'household-1',
      actorDisplayName: 'Masha',
      eventType: 'plan.settled',
      category: 'plan_events',
      summaryText: 'Masha marked utility plan settled for 2026-05'
    })

    expect(sentThreadIds).toEqual(['401'])
  })

  test('persists audit and skips delivery when category is disabled', async () => {
    const repository = new AuditNotificationRepositoryStub()
    repository.settings = {
      ...repository.settings,
      purchaseEvents: false
    }
    let sendCount = 0
    const service = createHouseholdAuditNotificationService({
      repository,
      householdConfigurationRepository: householdRepository({ notificationThreadId: '501' }),
      sendTopicMessage: async () => {
        sendCount += 1
      }
    })

    const event = await service.recordEvent({
      householdId: 'household-1',
      actorDisplayName: 'Alex',
      eventType: 'purchase.deleted',
      category: 'purchase_events',
      summaryText: 'Alex deleted purchase: groceries'
    })

    expect(repository.events.get(event.id)).toMatchObject({
      deliveryStatus: 'skipped',
      deliveryError: 'category_disabled'
    })
    expect(sendCount).toBe(0)
  })

  test('keeps the audit event when Telegram delivery fails', async () => {
    const repository = new AuditNotificationRepositoryStub()
    const warnings: object[] = []
    const service = createHouseholdAuditNotificationService({
      repository,
      householdConfigurationRepository: householdRepository({ notificationThreadId: '501' }),
      sendTopicMessage: async () => {
        throw new Error('Telegram is unavailable')
      },
      logger: {
        warn: (payload) => warnings.push(payload)
      }
    })

    const event = await service.recordEvent({
      householdId: 'household-1',
      actorDisplayName: 'Masha',
      eventType: 'payment.recorded',
      category: 'payment_events',
      summaryText: 'Masha recorded payment: rent 500 GEL'
    })

    expect(repository.events.get(event.id)).toMatchObject({
      deliveryStatus: 'failed',
      deliveryError: 'Telegram is unavailable'
    })
    expect(warnings).toHaveLength(1)
  })
})
