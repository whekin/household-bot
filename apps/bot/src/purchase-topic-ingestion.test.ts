import { describe, expect, test } from 'bun:test'

import { instantFromIso } from '@household/domain'
import { createTelegramBot } from './bot'

import {
  buildPurchaseAcknowledgement,
  extractPurchaseTopicCandidate,
  registerPurchaseTopicIngestion,
  resolveConfiguredPurchaseTopicRecord,
  type PurchaseMessageIngestionRepository,
  type PurchaseTopicCandidate
} from './purchase-topic-ingestion'

const config = {
  householdId: '11111111-1111-4111-8111-111111111111',
  householdChatId: '-10012345',
  purchaseTopicId: 777
}

function candidate(overrides: Partial<PurchaseTopicCandidate> = {}): PurchaseTopicCandidate {
  return {
    updateId: 1,
    chatId: '-10012345',
    messageId: '10',
    threadId: '777',
    senderTelegramUserId: '10002',
    rawText: 'Bought toilet paper 30 gel',
    messageSentAt: instantFromIso('2026-03-05T00:00:00.000Z'),
    ...overrides
  }
}

function purchaseUpdate(text: string) {
  const commandToken = text.split(' ')[0] ?? text

  return {
    update_id: 1001,
    message: {
      message_id: 55,
      date: Math.floor(Date.now() / 1000),
      message_thread_id: 777,
      is_topic_message: true,
      chat: {
        id: Number(config.householdChatId),
        type: 'supergroup'
      },
      from: {
        id: 10002,
        is_bot: false,
        first_name: 'Mia'
      },
      text,
      entities: text.startsWith('/')
        ? [
            {
              offset: 0,
              length: commandToken.length,
              type: 'bot_command'
            }
          ]
        : []
    }
  }
}

describe('extractPurchaseTopicCandidate', () => {
  test('returns record when message belongs to configured topic', () => {
    const record = extractPurchaseTopicCandidate(candidate(), config)

    expect(record).not.toBeNull()
    expect(record?.householdId).toBe(config.householdId)
    expect(record?.rawText).toBe('Bought toilet paper 30 gel')
  })

  test('skips message from other chat', () => {
    const record = extractPurchaseTopicCandidate(candidate({ chatId: '-10099999' }), config)

    expect(record).toBeNull()
  })

  test('skips message from other topic', () => {
    const record = extractPurchaseTopicCandidate(candidate({ threadId: '778' }), config)

    expect(record).toBeNull()
  })

  test('skips blank text after trim', () => {
    const record = extractPurchaseTopicCandidate(candidate({ rawText: '   ' }), config)

    expect(record).toBeNull()
  })

  test('skips slash commands in purchase topic', () => {
    const record = extractPurchaseTopicCandidate(
      candidate({ rawText: '/statement 2026-03' }),
      config
    )

    expect(record).toBeNull()
  })
})

describe('resolveConfiguredPurchaseTopicRecord', () => {
  test('returns record when the configured topic role is purchase', () => {
    const record = resolveConfiguredPurchaseTopicRecord(candidate(), {
      householdId: 'household-1',
      role: 'purchase',
      telegramThreadId: '777',
      topicName: 'Общие покупки'
    })

    expect(record).not.toBeNull()
    expect(record?.householdId).toBe('household-1')
  })

  test('skips non-purchase topic bindings', () => {
    const record = resolveConfiguredPurchaseTopicRecord(candidate(), {
      householdId: 'household-1',
      role: 'feedback',
      telegramThreadId: '777',
      topicName: 'Feedback'
    })

    expect(record).toBeNull()
  })
})

describe('buildPurchaseAcknowledgement', () => {
  test('returns parsed acknowledgement with amount summary', () => {
    const result = buildPurchaseAcknowledgement({
      status: 'created',
      processingStatus: 'parsed',
      parsedAmountMinor: 3000n,
      parsedCurrency: 'GEL',
      parsedItemDescription: 'toilet paper',
      parserConfidence: 92,
      parserMode: 'rules'
    })

    expect(result).toBe('Recorded purchase: toilet paper - 30.00 GEL')
  })

  test('returns review acknowledgement when parsing needs review', () => {
    const result = buildPurchaseAcknowledgement({
      status: 'created',
      processingStatus: 'needs_review',
      parsedAmountMinor: 3000n,
      parsedCurrency: 'GEL',
      parsedItemDescription: 'shared purchase',
      parserConfidence: 78,
      parserMode: 'rules'
    })

    expect(result).toBe('Saved for review: shared purchase - 30.00 GEL')
  })

  test('returns parse failure acknowledgement without guessed values', () => {
    const result = buildPurchaseAcknowledgement({
      status: 'created',
      processingStatus: 'parse_failed',
      parsedAmountMinor: null,
      parsedCurrency: null,
      parsedItemDescription: null,
      parserConfidence: null,
      parserMode: null
    })

    expect(result).toBe("Saved for review: I couldn't parse this purchase yet.")
  })

  test('does not acknowledge duplicates', () => {
    expect(
      buildPurchaseAcknowledgement({
        status: 'duplicate'
      })
    ).toBeNull()
  })

  test('returns Russian acknowledgement when requested', () => {
    const result = buildPurchaseAcknowledgement(
      {
        status: 'created',
        processingStatus: 'parsed',
        parsedAmountMinor: 3000n,
        parsedCurrency: 'GEL',
        parsedItemDescription: 'туалетная бумага',
        parserConfidence: 92,
        parserMode: 'rules'
      },
      'ru'
    )

    expect(result).toBe('Покупка сохранена: туалетная бумага - 30.00 GEL')
  })
})

describe('registerPurchaseTopicIngestion', () => {
  test('replies in-topic after a parsed purchase is recorded', async () => {
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
            id: Number(config.householdChatId),
            type: 'supergroup'
          },
          text: 'ok'
        }
      } as never
    })

    const repository: PurchaseMessageIngestionRepository = {
      async save() {
        return {
          status: 'created',
          processingStatus: 'parsed',
          parsedAmountMinor: 3000n,
          parsedCurrency: 'GEL',
          parsedItemDescription: 'toilet paper',
          parserConfidence: 92,
          parserMode: 'rules'
        }
      }
    }

    registerPurchaseTopicIngestion(bot, config, repository)
    await bot.handleUpdate(purchaseUpdate('Bought toilet paper 30 gel') as never)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.method).toBe('sendMessage')
    expect(calls[0]?.payload).toMatchObject({
      chat_id: Number(config.householdChatId),
      reply_parameters: {
        message_id: 55
      },
      text: 'Recorded purchase: toilet paper - 30.00 GEL'
    })
  })

  test('does not reply for duplicate deliveries', async () => {
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
            id: Number(config.householdChatId),
            type: 'supergroup'
          },
          text: 'ok'
        }
      } as never
    })

    const repository: PurchaseMessageIngestionRepository = {
      async save() {
        return {
          status: 'duplicate'
        }
      }
    }

    registerPurchaseTopicIngestion(bot, config, repository)
    await bot.handleUpdate(purchaseUpdate('Bought toilet paper 30 gel') as never)

    expect(calls).toHaveLength(0)
  })
})
