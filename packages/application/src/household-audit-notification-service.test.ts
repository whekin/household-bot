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
  getAuditNotificationDetails,
  renderAuditNotification
} from './household-audit-notification-service'
import type { HouseholdPaymentProgress } from './payment-progress'

class AuditNotificationRepositoryStub implements HouseholdAuditNotificationRepository {
  events = new Map<string, HouseholdAuditEventRecord>()
  dedupeKeys = new Set<string>()
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
  ): Promise<HouseholdAuditEventRecord | null> {
    if (input.dedupeKey) {
      if (this.dedupeKeys.has(input.dedupeKey)) {
        return null
      }
      this.dedupeKeys.add(input.dedupeKey)
    }
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

const october = {
  kind: 'rent',
  period: '2026-10',
  paidMembers: 3,
  totalMembers: 4,
  totalDueMinor: 182000n,
  currency: 'GEL',
  fullyPaid: false
} as const

describe('renderAuditNotification', () => {
  test('names the payer and the purchase, nothing else', () => {
    const metadata = { description: 'Mr. Proper', amountMinor: '1200', currency: 'GEL' }
    expect(
      renderAuditNotification({
        locale: 'en',
        actorDisplayName: 'Stas',
        eventType: 'purchase.added',
        fallbackSummaryText: 'fallback',
        metadata
      }).compactText
    ).toBe('🛒 Stas: Mr. Proper · 12 ₾')
    expect(
      renderAuditNotification({
        locale: 'ru',
        actorDisplayName: 'Стас',
        eventType: 'purchase.confirmed',
        fallbackSummaryText: 'fallback',
        metadata
      }).compactText
    ).toBe('🛒 Стас: Mr. Proper · 12 ₾')
  })

  test('expands purchase shares only when there is something to add', () => {
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
          { memberId: 'member-1', displayName: 'Стас', included: true, shareAmountText: '20 ₾' },
          { memberId: 'member-2', displayName: 'Дима', included: false }
        ]
      }
    })

    expect(rendered.compactText).toBe('🛒 Стас: Pizza · 30 ₾')
    expect(rendered.details?.expandedText).toBe(
      [
        '🛒 Стас: Pizza · 30 ₾',
        '',
        'Суммы указаны вручную',
        'Доли: Стас 20 ₾',
        'Не участвуют: Дима'
      ].join('\n')
    )
  })

  test('says whose rent is paid, with progress and no repeated name', () => {
    const rendered = renderAuditNotification({
      locale: 'ru',
      actorDisplayName: 'Ион',
      eventType: 'payment.recorded',
      fallbackSummaryText: 'fallback',
      metadata: {
        kind: 'rent',
        memberDisplayName: 'Ион',
        amountMinor: '45500',
        currency: 'GEL',
        period: '2026-10'
      },
      progress: october
    })

    expect(rendered.compactText).toBe('🏠 Ион: аренда за октябрь оплачена · 455 ₾ · 3 из 4')
    expect(rendered.details).toBeNull()
  })

  test('credits whoever marked someone else as paid', () => {
    const rendered = renderAuditNotification({
      locale: 'en',
      actorDisplayName: 'Stas',
      eventType: 'payment_period.closed',
      fallbackSummaryText: 'fallback',
      metadata: {
        kind: 'rent',
        period: '2026-10',
        closedMembers: [
          { memberId: 'dima', displayName: 'Dima', amountMinor: '45500', currency: 'GEL' }
        ]
      },
      progress: october
    })

    expect(rendered.compactText).toBe('🏠 Dima: rent for October paid · 455 ₾ · 3 of 4 · ✍️ Stas')
  })

  test('lists several members at once and explains who was skipped', () => {
    const rendered = renderAuditNotification({
      locale: 'ru',
      actorDisplayName: 'Стас',
      eventType: 'payment.recorded',
      fallbackSummaryText: 'fallback',
      metadata: {
        kind: 'utilities',
        period: '2026-07',
        closedMembers: [
          { memberId: 'stas', displayName: 'Стас', amountMinor: '2000', currency: 'GEL' },
          { memberId: 'alisa', displayName: 'Алиса', amountMinor: '2000', currency: 'GEL' }
        ],
        skippedMembers: [{ memberId: 'dima', displayName: 'Дима', reason: 'already_settled' }]
      }
    })

    expect(rendered.compactText).toBe(
      '💡 Коммуналка за июль оплачена: Стас, Алиса · 40 ₾ · ✍️ Стас'
    )
    expect(rendered.details?.expandedText).toContain('Уже было оплачено: Дима')
    expect(rendered.details?.expandedText).not.toContain('already_settled')
  })

  test('lists the bills a member paid on the utility plan', () => {
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
            billName: 'Газ',
            amountMinor: '9306',
            currency: 'GEL'
          }
        ]
      }
    })

    expect(rendered.compactText).toBe('💡 Ион: коммуналка за июнь оплачена · Газ 93.06 ₾ · ✍️ Стас')
    expect(rendered.details).toBeNull()
  })

  test('keeps edits and settings to one plain line', () => {
    expect(
      renderAuditNotification({
        locale: 'en',
        actorDisplayName: 'Stas',
        eventType: 'utility_bill.added',
        fallbackSummaryText: 'fallback',
        metadata: {
          billName: 'Electricity',
          amountMinor: '3584',
          currency: 'GEL',
          period: '2026-07'
        }
      }).compactText
    ).toBe('💡 Stas: new bill · Electricity · 35.84 ₾')

    expect(
      renderAuditNotification({
        locale: 'ru',
        actorDisplayName: 'Стас',
        eventType: 'rent.updated',
        fallbackSummaryText: 'fallback',
        metadata: { amountMinor: '241500', currency: 'GEL', period: '2026-07' }
      }).compactText
    ).toBe('🏠 Стас: аренда теперь 2\u202f415 ₾ с июля')

    expect(
      renderAuditNotification({
        locale: 'ru',
        actorDisplayName: 'Стас',
        eventType: 'purchase.deleted',
        fallbackSummaryText: 'fallback',
        metadata: { purchaseId: 'p-1' }
      }).compactText
    ).toBe('🗑 Стас: покупка удалена')
  })

  test('celebrates a fully paid month', () => {
    const metadata = {
      kind: 'rent',
      period: '2026-10',
      amountMinor: '182000',
      currency: 'GEL',
      totalMembers: 4
    }
    expect(
      renderAuditNotification({
        locale: 'ru',
        actorDisplayName: 'System',
        eventType: 'payment.fully_paid',
        fallbackSummaryText: 'fallback',
        metadata
      }).compactText
    ).toBe('🎉 Аренда за октябрь закрыта! Все 4 оплатили, 1\u202f820 ₾ — можно выдыхать до ноября')
    expect(
      renderAuditNotification({
        locale: 'en',
        actorDisplayName: 'System',
        eventType: 'payment.fully_paid',
        fallbackSummaryText: 'fallback',
        metadata: { ...metadata, kind: 'utilities' }
      }).compactText
    ).toBe('🎉 October utilities are done! Lights on, water running — everyone paid')
  })

  test('falls back to the caller summary for unknown events', () => {
    expect(
      renderAuditNotification({
        locale: 'ru',
        actorDisplayName: 'Маша',
        eventType: 'plan.settled',
        fallbackSummaryText: 'Masha settled the plan',
        metadata: {}
      }).compactText
    ).toBe('Masha settled the plan')
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

    expect(event!.deliveryStatus).toBe('pending')
    expect(sentMessages).toEqual([
      {
        chatId: '-100123',
        threadId: '501',
        text: '🛒 Alex: shared purchase'
      }
    ])
    expect(repository.events.get(event!.id)).toMatchObject({
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
            included: false
          }
        ]
      }
    })

    expect(sentMessages).toEqual([
      {
        text: '🛒 Стас: Pizza · 30 ₾',
        replyMarkup: buildAuditNotificationViewReplyMarkup({
          eventId: event!.id,
          locale: 'ru',
          viewMode: 'compact'
        })
      }
    ])
    const stored = repository.events.get(event!.id)
    expect(stored?.summaryText).toBe('🛒 Стас: Pizza · 30 ₾')
    expect(stored ? getAuditNotificationDetails(stored)?.expandedText : null).toContain(
      'Не участвуют: Дима'
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
    expect(repository.events.get(event!.id)?.summaryText).toBe(richText)
    expect(repository.events.get(event!.id)?.summaryText).toContain('\n\n')
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
    expect(repository.events.get(event!.id)).toMatchObject({
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

    expect(repository.events.get(event!.id)).toMatchObject({
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

    expect(repository.events.get(event!.id)).toMatchObject({
      deliveryStatus: 'failed',
      deliveryError: 'Telegram is unavailable'
    })
    expect(warnings).toHaveLength(1)
  })
})

describe('fully paid milestone', () => {
  function milestoneService(progress: () => Promise<HouseholdPaymentProgress | null>) {
    const repository = new AuditNotificationRepositoryStub()
    const sent: string[] = []
    const service = createHouseholdAuditNotificationService({
      repository,
      householdConfigurationRepository: householdRepository({
        notificationThreadId: '501',
        defaultLocale: 'ru'
      }),
      sendTopicMessage: async (message) => {
        sent.push(message.text)
        return { telegramMessageId: String(sent.length) }
      },
      paymentProgress: progress
    })
    return { repository, sent, service }
  }

  const payment = (memberDisplayName: string) => ({
    householdId: 'household-1',
    actorDisplayName: memberDisplayName,
    eventType: 'payment_period.closed',
    category: 'payment_events' as const,
    summaryText: 'closed rent',
    metadata: {
      kind: 'rent',
      period: '2026-10',
      closedMembers: [
        {
          memberId: memberDisplayName,
          displayName: memberDisplayName,
          amountMinor: '45500',
          currency: 'GEL'
        }
      ]
    }
  })

  test('follows the payment that completes the month, exactly once', async () => {
    const { sent, service } = milestoneService(async () => ({
      kind: 'rent',
      period: '2026-10',
      paidMembers: 4,
      totalMembers: 4,
      totalDueMinor: 182000n,
      currency: 'GEL',
      fullyPaid: true
    }))

    await service.recordEvent(payment('Алиса'))
    await service.recordEvent(payment('Алиса'))

    expect(sent).toEqual([
      '🏠 Алиса: аренда за октябрь оплачена · 455 ₾ · 4 из 4',
      '🎉 Аренда за октябрь закрыта! Все 4 оплатили, 1\u202f820 ₾ — можно выдыхать до ноября',
      '🏠 Алиса: аренда за октябрь оплачена · 455 ₾ · 4 из 4'
    ])
  })

  test('stays quiet while someone still owes', async () => {
    const { sent, service } = milestoneService(async () => ({
      kind: 'rent',
      period: '2026-10',
      paidMembers: 3,
      totalMembers: 4,
      totalDueMinor: 182000n,
      currency: 'GEL',
      fullyPaid: false
    }))

    await service.recordEvent(payment('Дима'))

    expect(sent).toEqual(['🏠 Дима: аренда за октябрь оплачена · 455 ₾ · 3 из 4'])
  })

  test('does not ask for progress on edits and deletions', async () => {
    let calls = 0
    const { service } = milestoneService(async () => {
      calls += 1
      return null
    })

    await service.recordEvent({
      ...payment('Стас'),
      eventType: 'payment.deleted',
      metadata: { kind: 'rent', period: '2026-10' }
    })

    expect(calls).toBe(0)
  })
})
