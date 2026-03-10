import { describe, expect, test } from 'bun:test'

import { instantFromIso, Money } from '@household/domain'
import { createTelegramBot } from './bot'
import {
  buildPaymentAcknowledgement,
  registerConfiguredPaymentTopicIngestion,
  resolveConfiguredPaymentTopicRecord,
  type PaymentTopicCandidate
} from './payment-topic-ingestion'

function candidate(overrides: Partial<PaymentTopicCandidate> = {}): PaymentTopicCandidate {
  return {
    updateId: 1,
    chatId: '-10012345',
    messageId: '10',
    threadId: '888',
    senderTelegramUserId: '10002',
    rawText: 'за жилье закинул',
    attachmentCount: 0,
    messageSentAt: instantFromIso('2026-03-20T00:00:00.000Z'),
    ...overrides
  }
}

function paymentUpdate(text: string) {
  return {
    update_id: 1001,
    message: {
      message_id: 55,
      date: Math.floor(Date.now() / 1000),
      message_thread_id: 888,
      is_topic_message: true,
      chat: {
        id: -10012345,
        type: 'supergroup'
      },
      from: {
        id: 10002,
        is_bot: false,
        first_name: 'Mia'
      },
      text
    }
  }
}

describe('resolveConfiguredPaymentTopicRecord', () => {
  test('returns record when the topic role is payments', () => {
    const record = resolveConfiguredPaymentTopicRecord(candidate(), {
      householdId: 'household-1',
      role: 'payments',
      telegramThreadId: '888',
      topicName: 'Быт'
    })

    expect(record).not.toBeNull()
    expect(record?.householdId).toBe('household-1')
  })

  test('skips non-payments topic bindings', () => {
    const record = resolveConfiguredPaymentTopicRecord(candidate(), {
      householdId: 'household-1',
      role: 'feedback',
      telegramThreadId: '888',
      topicName: 'Анонимно'
    })

    expect(record).toBeNull()
  })
})

describe('buildPaymentAcknowledgement', () => {
  test('returns localized recorded acknowledgement', () => {
    expect(
      buildPaymentAcknowledgement('ru', {
        status: 'recorded',
        kind: 'rent',
        amountMajor: '472.50',
        currency: 'GEL'
      })
    ).toBe('Оплата аренды сохранена: 472.50 GEL')
  })

  test('returns review acknowledgement', () => {
    expect(
      buildPaymentAcknowledgement('en', {
        status: 'needs_review'
      })
    ).toBe('Saved this payment confirmation for review.')
  })
})

describe('registerConfiguredPaymentTopicIngestion', () => {
  test('replies in-topic after a payment confirmation is recorded', async () => {
    const bot = createTelegramBot('000000:test-token')
    const calls: Array<{ method: string; payload: unknown }> = []

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

    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })

      return {
        ok: true,
        result: {
          message_id: calls.length,
          date: Math.floor(Date.now() / 1000),
          chat: {
            id: -10012345,
            type: 'supergroup'
          },
          text: 'ok'
        }
      } as never
    })

    registerConfiguredPaymentTopicIngestion(
      bot,
      {
        getHouseholdChatByHouseholdId: async () => ({
          householdId: 'household-1',
          householdName: 'Test bot',
          telegramChatId: '-10012345',
          telegramChatType: 'supergroup',
          title: 'Test bot',
          defaultLocale: 'ru'
        }),
        findHouseholdTopicByTelegramContext: async () => ({
          householdId: 'household-1',
          role: 'payments',
          telegramThreadId: '888',
          topicName: 'Быт'
        })
      } as never,
      () => ({
        submit: async () => ({
          status: 'recorded',
          kind: 'rent',
          amount: Money.fromMajor('472.50', 'GEL')
        })
      })
    )

    await bot.handleUpdate(paymentUpdate('за жилье закинул') as never)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.method).toBe('sendMessage')
    expect(calls[0]?.payload).toMatchObject({
      chat_id: -10012345,
      reply_parameters: {
        message_id: 55
      },
      text: 'Оплата аренды сохранена: 472.50 GEL'
    })
  })
})
