import { describe, expect, test } from 'bun:test'

import { AUDIT_NOTIFICATION_VIEW_CALLBACK_PREFIX } from '@household/application'
import { Temporal } from '@household/domain'
import type { HouseholdAuditEventRecord } from '@household/ports'

import { registerAuditNotificationCallbacks } from './audit-notifications'
import { createTelegramBot } from './bot'

function auditEvent(input: Partial<HouseholdAuditEventRecord> = {}): HouseholdAuditEventRecord {
  return {
    id: input.id ?? 'audit-1',
    householdId: input.householdId ?? 'household-1',
    actorMemberId: input.actorMemberId ?? 'member-1',
    actorDisplayName: input.actorDisplayName ?? 'Стас',
    eventType: input.eventType ?? 'purchase.added',
    category: input.category ?? 'purchase_events',
    summaryText: input.summaryText ?? 'Стас добавил покупку: Pizza 30.00 ₾',
    metadata: input.metadata ?? {
      notificationDetails: {
        locale: 'ru',
        compactText: 'Стас добавил покупку: Pizza 30.00 ₾',
        expandedText: 'Стас добавил покупку: Pizza 30.00 ₾\nПлательщик: Стас\nУчастники: Стас, Дима'
      }
    },
    deliveryStatus: input.deliveryStatus ?? 'sent',
    deliveredTelegramChatId: input.deliveredTelegramChatId ?? '-100123',
    deliveredTelegramThreadId: input.deliveredTelegramThreadId ?? '501',
    deliveredTelegramMessageId: input.deliveredTelegramMessageId ?? '9001',
    deliveryError: input.deliveryError ?? null,
    createdAt: input.createdAt ?? Temporal.Instant.from('2026-03-24T12:00:00Z')
  }
}

function callbackUpdate(input: {
  data: string
  chatId?: number
  threadId?: number
  messageId?: number
}) {
  return {
    update_id: 1,
    callback_query: {
      id: 'callback-1',
      from: {
        id: 123,
        is_bot: false,
        first_name: 'Stas'
      },
      chat_instance: 'chat-instance',
      data: input.data,
      message: {
        message_id: input.messageId ?? 9001,
        date: Math.floor(Date.now() / 1000),
        chat: {
          id: input.chatId ?? -100123,
          type: 'supergroup'
        },
        message_thread_id: input.threadId ?? 501,
        text: 'compact'
      }
    }
  }
}

function setBotInfo(bot: ReturnType<typeof createTelegramBot>) {
  bot.botInfo = {
    id: 999000,
    is_bot: true,
    first_name: 'Household Test Bot',
    username: 'household_test_bot',
    can_join_groups: true,
    can_read_all_group_messages: false,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
    has_topics_enabled: true,
    allows_users_to_create_topics: false
  }
}

describe('registerAuditNotificationCallbacks', () => {
  test('expands and collapses audit notification details inline', async () => {
    const bot = createTelegramBot('000000:test-token')
    setBotInfo(bot)
    const calls: Array<{ method: string; payload: unknown }> = []
    const event = auditEvent()

    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })
      return {
        ok: true,
        result: true
      } as never
    })

    registerAuditNotificationCallbacks({
      bot,
      repository: {
        async getAuditEventById() {
          return event
        }
      }
    })

    await bot.handleUpdate(
      callbackUpdate({
        data: `${AUDIT_NOTIFICATION_VIEW_CALLBACK_PREFIX}${event.id}:expanded`
      }) as never
    )
    await bot.handleUpdate(
      callbackUpdate({
        data: `${AUDIT_NOTIFICATION_VIEW_CALLBACK_PREFIX}${event.id}:compact`
      }) as never
    )

    expect(calls[0]).toMatchObject({
      method: 'editMessageText',
      payload: {
        text: expect.stringContaining('Плательщик: Стас')
      }
    })
    expect(JSON.stringify(calls[0]?.payload)).toContain('Скрыть')
    expect(calls[2]).toMatchObject({
      method: 'editMessageText',
      payload: {
        text: 'Стас добавил покупку: Pizza 30.00 ₾'
      }
    })
    expect(JSON.stringify(calls[2]?.payload)).toContain('Детали')
  })

  test('rejects callbacks for a different delivered message', async () => {
    const bot = createTelegramBot('000000:test-token')
    setBotInfo(bot)
    const calls: Array<{ method: string; payload: unknown }> = []
    const event = auditEvent()

    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })
      return {
        ok: true,
        result: true
      } as never
    })

    registerAuditNotificationCallbacks({
      bot,
      repository: {
        async getAuditEventById() {
          return event
        }
      }
    })

    await bot.handleUpdate(
      callbackUpdate({
        data: `${AUDIT_NOTIFICATION_VIEW_CALLBACK_PREFIX}${event.id}:expanded`,
        threadId: 999
      }) as never
    )

    expect(calls.map((call) => call.method)).toEqual(['answerCallbackQuery'])
  })
})
