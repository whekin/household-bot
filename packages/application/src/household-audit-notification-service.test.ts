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
  buildAuditNotificationViewReplyMarkup,
  createHouseholdAuditNotificationService,
  formatAuditNotificationSummary,
  getAuditNotificationDetails,
  renderAuditNotification
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

  async getAuditEventById(eventId: string): Promise<HouseholdAuditEventRecord | null> {
    return this.events.get(eventId) ?? null
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
  defaultLocale?: 'en' | 'ru'
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
        defaultLocale: input?.defaultLocale ?? 'en'
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

describe('renderAuditNotification', () => {
  test('renders compact purchase actions in English and Russian', () => {
    expect(
      renderAuditNotification({
        locale: 'en',
        actorDisplayName: 'Stas',
        eventType: 'purchase.added',
        fallbackSummaryText: 'fallback',
        metadata: {
          description: 'Mr. Proper',
          amountMinor: '1200',
          currency: 'GEL'
        }
      }).compactText
    ).toBe('Stas added purchase: Mr. Proper 12.00 ₾')

    expect(
      renderAuditNotification({
        locale: 'ru',
        actorDisplayName: 'Стас',
        eventType: 'purchase.added',
        fallbackSummaryText: 'fallback',
        metadata: {
          description: 'Mr. Proper',
          amountMinor: '1200',
          currency: 'GEL'
        }
      }).compactText
    ).toBe('Стас: добавление покупки Mr. Proper 12.00 ₾')
  })

  test('renders expanded purchase details with participants', () => {
    const rendered = renderAuditNotification({
      locale: 'ru',
      actorDisplayName: 'Стас',
      eventType: 'purchase.added',
      fallbackSummaryText: 'fallback',
      metadata: {
        description: 'Pizza',
        amountMinor: '3000',
        currency: 'GEL',
        payerDisplayName: 'Стас',
        splitMode: 'custom_amounts',
        participants: [
          {
            memberId: 'member-1',
            displayName: 'Стас',
            included: true,
            shareAmountText: '20.00 ₾'
          },
          {
            memberId: 'member-2',
            displayName: 'Дима',
            included: false
          }
        ]
      }
    })

    expect(rendered.details?.expandedText).toContain('Плательщик: Стас')
    expect(rendered.details?.expandedText).toContain('Разделение: индивидуальные суммы')
    expect(rendered.details?.expandedText).toContain('Участники: Стас 20.00 ₾')
    expect(rendered.details?.expandedText).toContain('Исключены: Дима')
  })

  test('localizes closed payment periods with month labels and member details', () => {
    const rendered = renderAuditNotification({
      locale: 'ru',
      actorDisplayName: 'Стас',
      eventType: 'payment_period.closed',
      fallbackSummaryText: 'Stas closed rent for 2026-05',
      metadata: {
        period: '2026-05',
        kind: 'rent',
        closedMembers: [
          {
            memberId: 'member-1',
            displayName: 'Стас',
            amountMinor: '46900',
            currency: 'GEL'
          },
          {
            memberId: 'member-2',
            displayName: 'Дима',
            amountMinor: '46900',
            currency: 'GEL'
          }
        ]
      }
    })

    expect(rendered.compactText).toBe('Стас: закрытие аренды за май 2026 г.')
    expect(rendered.compactText).not.toContain('2026-05')
    expect(rendered.details?.expandedText).toContain('Период: май 2026 г.')
    expect(rendered.details?.expandedText).toContain('Закрыто для: Стас 469.00 ₾, Дима 469.00 ₾')
  })

  test('renders recorded payment target member details', () => {
    const rendered = renderAuditNotification({
      locale: 'en',
      actorDisplayName: 'Stas',
      eventType: 'payment.recorded',
      fallbackSummaryText: 'fallback',
      metadata: {
        kind: 'rent',
        memberDisplayName: 'Dima',
        amountMinor: '46900',
        currency: 'GEL',
        period: '2026-05'
      }
    })

    expect(rendered.compactText).toBe('Stas recorded payment: rent 469.00 ₾ (May 2026)')
    expect(rendered.details?.expandedText).toContain('Member: Dima')
    expect(rendered.details?.expandedText).toContain('Period: May 2026')
  })

  test('renders planned utility payment target and bills', () => {
    const rendered = renderAuditNotification({
      locale: 'ru',
      actorDisplayName: 'Стас',
      eventType: 'utility_plan.resolved',
      fallbackSummaryText: 'fallback',
      metadata: {
        period: '2026-06',
        memberId: 'ion',
        resolvedAssignments: [
          {
            memberId: 'ion',
            displayName: 'Ион',
            utilityBillId: 'gas',
            billName: 'Gas (Water)',
            amountMinor: '9306',
            currency: 'GEL'
          }
        ]
      }
    })

    expect(rendered.compactText).toBe(
      'Стас: отметил коммуналку по плану: Ион · Gas (Water) 93.06 ₾ июнь 2026 г.'
    )
    expect(rendered.details?.expandedText).toContain('Счета: Ион · Gas (Water) 93.06 ₾')
  })

  test('renders an actor-less celebratory milestone when utilities are fully paid', () => {
    const ru = renderAuditNotification({
      locale: 'ru',
      actorDisplayName: 'Стас',
      eventType: 'utility_plan.fully_paid',
      fallbackSummaryText: 'fallback',
      metadata: { period: '2026-07' }
    })
    expect(ru.compactText).toBe('🎉 Коммуналка за июль 2026 г. закрыта — все платежи внесены!')
    expect(ru.details).toBeNull()

    const en = renderAuditNotification({
      locale: 'en',
      actorDisplayName: 'Stas',
      eventType: 'utility_plan.fully_paid',
      fallbackSummaryText: 'fallback',
      metadata: { period: '2026-07' }
    })
    expect(en.compactText).toBe('🎉 Utilities for July 2026 are fully settled — everyone has paid!')
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

  test('uses household locale and sends expandable details button', async () => {
    const repository = new AuditNotificationRepositoryStub()
    const sentMessages: {
      text: string
      replyMarkup: unknown
    }[] = []
    const service = createHouseholdAuditNotificationService({
      repository,
      householdConfigurationRepository: householdRepository({
        notificationThreadId: '501',
        defaultLocale: 'ru'
      }),
      sendTopicMessage: async (message) => {
        sentMessages.push({
          text: message.text,
          replyMarkup: message.replyMarkup
        })
        return { telegramMessageId: '9001' }
      }
    })

    const event = await service.recordEvent({
      householdId: 'household-1',
      actorDisplayName: 'Стас',
      eventType: 'purchase.added',
      category: 'purchase_events',
      summaryText: 'Stas added purchase: Pizza 30.00 ₾',
      metadata: {
        description: 'Pizza',
        amountMinor: '3000',
        currency: 'GEL',
        payerDisplayName: 'Стас',
        splitMode: 'equal',
        participants: [
          {
            memberId: 'member-1',
            displayName: 'Стас',
            included: true
          },
          {
            memberId: 'member-2',
            displayName: 'Дима',
            included: true
          }
        ]
      }
    })

    expect(sentMessages).toEqual([
      {
        text: 'Стас: добавление покупки Pizza 30.00 ₾',
        replyMarkup: buildAuditNotificationViewReplyMarkup({
          eventId: event.id,
          locale: 'ru',
          viewMode: 'compact'
        })
      }
    ])
    const stored = repository.events.get(event.id)
    expect(stored?.summaryText).toBe('Стас: добавление покупки Pizza 30.00 ₾')
    expect(stored ? getAuditNotificationDetails(stored)?.expandedText : null).toContain(
      'Участники: Стас, Дима'
    )
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

  test('preserves rich reminder HTML and sends it to reminders topic', async () => {
    const repository = new AuditNotificationRepositoryStub()
    const sentMessages: {
      threadId: string | null
      text: string
      parseMode?: 'HTML'
      replyMarkup?: unknown
    }[] = []
    const replyMarkup = {
      inline_keyboard: [[{ text: 'I paid', callback_data: 'pr:p:rent:2026-05' }]]
    }
    const service = createHouseholdAuditNotificationService({
      repository,
      householdConfigurationRepository: householdRepository({
        notificationThreadId: '501',
        reminderThreadId: '401'
      }),
      sendTopicMessage: async (message) => {
        sentMessages.push({
          threadId: message.threadId,
          text: message.text,
          ...(message.parseMode ? { parseMode: message.parseMode } : {}),
          ...(message.replyMarkup ? { replyMarkup: message.replyMarkup } : {})
        })
        return { telegramMessageId: '9001' }
      }
    })

    const richText = [
      '🏠 <b>Rent due</b>',
      '📅 May 2026 · due May 15',
      '',
      '💰 <b>Remaining:</b> 469.00 ₾',
      '<b>Status</b>',
      '🔴 Stas — 469.00 ₾'
    ].join('\n')

    const event = await service.recordEvent({
      householdId: 'household-1',
      actorDisplayName: 'System',
      eventType: 'period.rent_due',
      category: 'period_events',
      summaryText: richText,
      metadata: {
        period: '2026-05',
        kind: 'rent'
      },
      parseMode: 'HTML',
      replyMarkup,
      preserveSummaryText: true,
      deliveryTopicRole: 'reminders'
    })

    expect(sentMessages).toEqual([
      {
        threadId: '401',
        text: richText,
        parseMode: 'HTML',
        replyMarkup
      }
    ])
    expect(repository.events.get(event.id)?.summaryText).toBe(richText)
    expect(repository.events.get(event.id)?.summaryText).toContain('\n\n')
  })

  test('sends rich reminder HTML to the household chat when reminders topic is absent', async () => {
    const repository = new AuditNotificationRepositoryStub()
    const sentMessages: {
      threadId: string | null
      text: string
      parseMode?: 'HTML'
    }[] = []
    const service = createHouseholdAuditNotificationService({
      repository,
      householdConfigurationRepository: householdRepository({
        notificationThreadId: '501'
      }),
      sendTopicMessage: async (message) => {
        sentMessages.push({
          threadId: message.threadId,
          text: message.text,
          ...(message.parseMode ? { parseMode: message.parseMode } : {})
        })
        return { telegramMessageId: '9002' }
      }
    })

    const richText = '🏠 <b>Rent due</b>\n\n💰 <b>Remaining:</b> 469.00 ₾'
    const event = await service.recordEvent({
      householdId: 'household-1',
      actorDisplayName: 'System',
      eventType: 'period.rent_due',
      category: 'period_events',
      summaryText: richText,
      parseMode: 'HTML',
      preserveSummaryText: true,
      deliveryTopicRole: 'reminders'
    })

    expect(sentMessages).toEqual([
      {
        threadId: null,
        text: richText,
        parseMode: 'HTML'
      }
    ])
    expect(repository.events.get(event.id)).toMatchObject({
      deliveryStatus: 'sent',
      deliveredTelegramThreadId: null,
      deliveredTelegramMessageId: '9002'
    })
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
