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

function callbackUpdate(data: string, fromId = 10002) {
  return {
    update_id: 1002,
    callback_query: {
      id: 'callback-1',
      from: {
        id: fromId,
        is_bot: false,
        first_name: 'Mia'
      },
      chat_instance: 'instance-1',
      data,
      message: {
        message_id: 77,
        date: Math.floor(Date.now() / 1000),
        chat: {
          id: Number(config.householdChatId),
          type: 'supergroup'
        },
        text: 'placeholder'
      }
    }
  }
}

function createTestBot() {
  const bot = createTelegramBot('000000:test-token')

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

  return bot
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
  test('returns proposal acknowledgement for a likely purchase', () => {
    const result = buildPurchaseAcknowledgement({
      status: 'pending_confirmation',
      purchaseMessageId: 'proposal-1',
      parsedAmountMinor: 3000n,
      parsedCurrency: 'GEL',
      parsedItemDescription: 'toilet paper',
      parserConfidence: 92,
      parserMode: 'llm'
    })

    expect(result).toBe(
      'I think this shared purchase was: toilet paper - 30.00 GEL. Confirm or cancel below.'
    )
  })

  test('returns explicit clarification text from the interpreter', () => {
    const result = buildPurchaseAcknowledgement({
      status: 'clarification_needed',
      purchaseMessageId: 'proposal-2',
      clarificationQuestion: 'Which currency was this purchase in?',
      parsedAmountMinor: 3000n,
      parsedCurrency: null,
      parsedItemDescription: 'toilet paper',
      parserConfidence: 61,
      parserMode: 'llm'
    })

    expect(result).toBe('Which currency was this purchase in?')
  })

  test('returns fallback clarification when the interpreter question is missing', () => {
    const result = buildPurchaseAcknowledgement({
      status: 'clarification_needed',
      purchaseMessageId: 'proposal-3',
      clarificationQuestion: null,
      parsedAmountMinor: null,
      parsedCurrency: null,
      parsedItemDescription: 'toilet paper',
      parserConfidence: 42,
      parserMode: 'llm'
    })

    expect(result).toBe('What amount and currency should I record for this shared purchase?')
  })

  test('returns parse failure acknowledgement without guessing values', () => {
    const result = buildPurchaseAcknowledgement({
      status: 'parse_failed',
      purchaseMessageId: 'proposal-4'
    })

    expect(result).toBe(
      "I couldn't understand this as a shared purchase yet. Please restate it with item, amount, and currency."
    )
  })

  test('does not acknowledge duplicates or non-purchase chatter', () => {
    expect(
      buildPurchaseAcknowledgement({
        status: 'duplicate'
      })
    ).toBeNull()

    expect(
      buildPurchaseAcknowledgement({
        status: 'ignored_not_purchase',
        purchaseMessageId: 'proposal-5'
      })
    ).toBeNull()
  })

  test('returns Russian proposal text when requested', () => {
    const result = buildPurchaseAcknowledgement(
      {
        status: 'pending_confirmation',
        purchaseMessageId: 'proposal-6',
        parsedAmountMinor: 3000n,
        parsedCurrency: 'GEL',
        parsedItemDescription: 'туалетная бумага',
        parserConfidence: 92,
        parserMode: 'llm'
      },
      'ru'
    )

    expect(result).toBe(
      'Похоже, это общая покупка: туалетная бумага - 30.00 GEL. Подтвердите или отмените ниже.'
    )
  })
})

describe('registerPurchaseTopicIngestion', () => {
  test('replies in-topic with a proposal and buttons for a likely purchase', async () => {
    const bot = createTestBot()
    const calls: Array<{ method: string; payload: unknown }> = []

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
      async hasClarificationContext() {
        return false
      },
      async save() {
        return {
          status: 'pending_confirmation',
          purchaseMessageId: 'proposal-1',
          parsedAmountMinor: 3000n,
          parsedCurrency: 'GEL',
          parsedItemDescription: 'toilet paper',
          parserConfidence: 92,
          parserMode: 'llm'
        }
      },
      async confirm() {
        throw new Error('not used')
      },
      async cancel() {
        throw new Error('not used')
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
      text: 'I think this shared purchase was: toilet paper - 30.00 GEL. Confirm or cancel below.',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: 'Confirm',
              callback_data: 'purchase:confirm:proposal-1'
            },
            {
              text: 'Cancel',
              callback_data: 'purchase:cancel:proposal-1'
            }
          ]
        ]
      }
    })
  })

  test('replies with a clarification question for ambiguous purchases', async () => {
    const bot = createTestBot()
    const calls: Array<{ method: string; payload: unknown }> = []

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
      async hasClarificationContext() {
        return false
      },
      async save() {
        return {
          status: 'clarification_needed',
          purchaseMessageId: 'proposal-1',
          clarificationQuestion: 'Which currency was this purchase in?',
          parsedAmountMinor: 3000n,
          parsedCurrency: null,
          parsedItemDescription: 'toilet paper',
          parserConfidence: 52,
          parserMode: 'llm'
        }
      },
      async confirm() {
        throw new Error('not used')
      },
      async cancel() {
        throw new Error('not used')
      }
    }

    registerPurchaseTopicIngestion(bot, config, repository)
    await bot.handleUpdate(purchaseUpdate('Bought toilet paper for 30') as never)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.payload).toMatchObject({
      text: 'Which currency was this purchase in?'
    })
  })

  test('sends a processing reply and edits it when an interpreter is configured', async () => {
    const bot = createTestBot()
    const calls: Array<{ method: string; payload: unknown }> = []

    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })

      if (method === 'sendMessage') {
        return {
          ok: true,
          result: {
            message_id: calls.length,
            date: Math.floor(Date.now() / 1000),
            chat: {
              id: Number(config.householdChatId),
              type: 'supergroup'
            },
            text: (payload as { text?: string }).text ?? 'ok'
          }
        } as never
      }

      return {
        ok: true,
        result: true
      } as never
    })

    const repository: PurchaseMessageIngestionRepository = {
      async hasClarificationContext() {
        return false
      },
      async save() {
        return {
          status: 'pending_confirmation',
          purchaseMessageId: 'proposal-1',
          parsedAmountMinor: 3000n,
          parsedCurrency: 'GEL',
          parsedItemDescription: 'toilet paper',
          parserConfidence: 92,
          parserMode: 'llm'
        }
      },
      async confirm() {
        throw new Error('not used')
      },
      async cancel() {
        throw new Error('not used')
      }
    }

    registerPurchaseTopicIngestion(bot, config, repository, {
      interpreter: async () => ({
        decision: 'purchase',
        amountMinor: 3000n,
        currency: 'GEL',
        itemDescription: 'toilet paper',
        confidence: 92,
        parserMode: 'llm',
        clarificationQuestion: null
      })
    })

    await bot.handleUpdate(purchaseUpdate('Bought toilet paper 30 gel') as never)

    expect(calls).toHaveLength(3)
    expect(calls[0]).toMatchObject({
      method: 'sendChatAction',
      payload: {
        chat_id: Number(config.householdChatId),
        action: 'typing',
        message_thread_id: config.purchaseTopicId
      }
    })
    expect(calls[1]).toMatchObject({
      method: 'sendMessage',
      payload: {
        chat_id: Number(config.householdChatId),
        text: 'Checking that purchase...',
        reply_parameters: {
          message_id: 55
        }
      }
    })
    expect(calls[2]).toMatchObject({
      method: 'editMessageText',
      payload: {
        chat_id: Number(config.householdChatId),
        message_id: 2,
        text: 'I think this shared purchase was: toilet paper - 30.00 GEL. Confirm or cancel below.',
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: 'Confirm',
                callback_data: 'purchase:confirm:proposal-1'
              },
              {
                text: 'Cancel',
                callback_data: 'purchase:cancel:proposal-1'
              }
            ]
          ]
        }
      }
    })
  })

  test('does not reply for duplicate deliveries or non-purchase chatter', async () => {
    const bot = createTestBot()
    const calls: Array<{ method: string; payload: unknown }> = []
    let saveCall = 0

    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })
      return {
        ok: true,
        result: true
      } as never
    })

    const repository: PurchaseMessageIngestionRepository = {
      async hasClarificationContext() {
        return false
      },
      async save() {
        saveCall += 1
        return saveCall === 1
          ? {
              status: 'duplicate' as const
            }
          : {
              status: 'ignored_not_purchase' as const,
              purchaseMessageId: 'proposal-1'
            }
      },
      async confirm() {
        throw new Error('not used')
      },
      async cancel() {
        throw new Error('not used')
      }
    }

    registerPurchaseTopicIngestion(bot, config, repository)
    await bot.handleUpdate(purchaseUpdate('Bought toilet paper 30 gel') as never)
    await bot.handleUpdate(purchaseUpdate('This is not a purchase') as never)

    expect(calls).toHaveLength(0)
  })

  test('confirms a pending proposal and edits the bot message', async () => {
    const bot = createTestBot()
    const calls: Array<{ method: string; payload: unknown }> = []

    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })

      return {
        ok: true,
        result: true
      } as never
    })

    const repository: PurchaseMessageIngestionRepository = {
      async hasClarificationContext() {
        return false
      },
      async save() {
        return {
          status: 'pending_confirmation',
          purchaseMessageId: 'proposal-1',
          parsedAmountMinor: 3000n,
          parsedCurrency: 'GEL',
          parsedItemDescription: 'toilet paper',
          parserConfidence: 92,
          parserMode: 'llm'
        }
      },
      async confirm() {
        return {
          status: 'confirmed' as const,
          purchaseMessageId: 'proposal-1',
          householdId: config.householdId,
          parsedAmountMinor: 3000n,
          parsedCurrency: 'GEL' as const,
          parsedItemDescription: 'toilet paper',
          parserConfidence: 92,
          parserMode: 'llm' as const
        }
      },
      async cancel() {
        throw new Error('not used')
      }
    }

    registerPurchaseTopicIngestion(bot, config, repository)
    await bot.handleUpdate(callbackUpdate('purchase:confirm:proposal-1') as never)

    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({
      method: 'answerCallbackQuery',
      payload: {
        callback_query_id: 'callback-1',
        text: 'Purchase confirmed.'
      }
    })
    expect(calls[1]).toMatchObject({
      method: 'editMessageText',
      payload: {
        chat_id: Number(config.householdChatId),
        message_id: 77,
        text: 'Purchase confirmed: toilet paper - 30.00 GEL',
        reply_markup: {
          inline_keyboard: []
        }
      }
    })
  })

  test('handles duplicate confirm callbacks idempotently', async () => {
    const bot = createTestBot()
    const calls: Array<{ method: string; payload: unknown }> = []

    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })

      return {
        ok: true,
        result: true
      } as never
    })

    const repository: PurchaseMessageIngestionRepository = {
      async hasClarificationContext() {
        return false
      },
      async save() {
        throw new Error('not used')
      },
      async confirm() {
        return {
          status: 'already_confirmed' as const,
          purchaseMessageId: 'proposal-1',
          householdId: config.householdId,
          parsedAmountMinor: 3000n,
          parsedCurrency: 'GEL' as const,
          parsedItemDescription: 'toilet paper',
          parserConfidence: 92,
          parserMode: 'llm' as const
        }
      },
      async cancel() {
        throw new Error('not used')
      }
    }

    registerPurchaseTopicIngestion(bot, config, repository)
    await bot.handleUpdate(callbackUpdate('purchase:confirm:proposal-1') as never)

    expect(calls[0]).toMatchObject({
      method: 'answerCallbackQuery',
      payload: {
        callback_query_id: 'callback-1',
        text: 'This purchase was already confirmed.'
      }
    })
    expect(calls[1]).toMatchObject({
      method: 'editMessageText',
      payload: {
        text: 'Purchase confirmed: toilet paper - 30.00 GEL'
      }
    })
  })

  test('cancels a pending proposal and edits the bot message', async () => {
    const bot = createTestBot()
    const calls: Array<{ method: string; payload: unknown }> = []

    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })

      return {
        ok: true,
        result: true
      } as never
    })

    const repository: PurchaseMessageIngestionRepository = {
      async hasClarificationContext() {
        return false
      },
      async save() {
        throw new Error('not used')
      },
      async confirm() {
        throw new Error('not used')
      },
      async cancel() {
        return {
          status: 'cancelled' as const,
          purchaseMessageId: 'proposal-1',
          householdId: config.householdId,
          parsedAmountMinor: 3000n,
          parsedCurrency: 'GEL' as const,
          parsedItemDescription: 'toilet paper',
          parserConfidence: 92,
          parserMode: 'llm' as const
        }
      }
    }

    registerPurchaseTopicIngestion(bot, config, repository)
    await bot.handleUpdate(callbackUpdate('purchase:cancel:proposal-1') as never)

    expect(calls[0]).toMatchObject({
      method: 'answerCallbackQuery',
      payload: {
        callback_query_id: 'callback-1',
        text: 'Purchase cancelled.'
      }
    })
    expect(calls[1]).toMatchObject({
      method: 'editMessageText',
      payload: {
        text: 'Purchase proposal cancelled: toilet paper - 30.00 GEL'
      }
    })
  })
})
