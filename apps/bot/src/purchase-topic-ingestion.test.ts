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

function participants() {
  return [
    {
      id: 'participant-1',
      memberId: 'member-1',
      displayName: 'Mia',
      included: true
    },
    {
      id: 'participant-2',
      memberId: 'member-2',
      displayName: 'Dima',
      included: false
    }
  ] as const
}

function purchaseUpdate(
  text: string,
  options: {
    replyToBot?: boolean
  } = {}
) {
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
      ...(options.replyToBot
        ? {
            reply_to_message: {
              message_id: 12,
              date: Math.floor(Date.now() / 1000),
              chat: {
                id: Number(config.householdChatId),
                type: 'supergroup'
              },
              from: {
                id: 999000,
                is_bot: true,
                first_name: 'Household Test Bot',
                username: 'household_test_bot'
              },
              text: 'Which amount was that purchase?'
            }
          }
        : {}),
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
      parserMode: 'llm',
      participants: participants()
    })

    expect(result).toBe(`I think this shared purchase was: toilet paper - 30.00 GEL.

Participants:
- Mia
- Dima (excluded)
Confirm or cancel below.`)
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
        parserMode: 'llm',
        participants: participants()
      },
      'ru'
    )

    expect(result).toBe(`Похоже, это общая покупка: туалетная бумага - 30.00 GEL.

Участники:
- Mia
- Dima (не участвует)
Подтвердите или отмените ниже.`)
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
          parserMode: 'llm',
          participants: participants()
        }
      },
      async confirm() {
        throw new Error('not used')
      },
      async cancel() {
        throw new Error('not used')
      },
      async toggleParticipant() {
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
      text: `I think this shared purchase was: toilet paper - 30.00 GEL.

Participants:
- Mia
- Dima (excluded)
Confirm or cancel below.`,
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '✅ Mia',
              callback_data: 'purchase:participant:participant-1'
            }
          ],
          [
            {
              text: '⬜ Dima',
              callback_data: 'purchase:participant:participant-2'
            }
          ],
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
      },
      async toggleParticipant() {
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

  test('keeps bare-amount purchase reports on the ingestion path', async () => {
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
      async save(record) {
        expect(record.rawText).toBe('Bought toilet paper 30')
        return {
          status: 'clarification_needed',
          purchaseMessageId: 'proposal-amount-only',
          clarificationQuestion: 'Which currency was this purchase in?',
          parsedAmountMinor: 3000n,
          parsedCurrency: null,
          parsedItemDescription: 'toilet paper',
          parserConfidence: 58,
          parserMode: 'llm'
        }
      },
      async confirm() {
        throw new Error('not used')
      },
      async cancel() {
        throw new Error('not used')
      },
      async toggleParticipant() {
        throw new Error('not used')
      }
    }

    registerPurchaseTopicIngestion(bot, config, repository, {
      interpreter: async () => ({
        decision: 'clarification',
        amountMinor: 3000n,
        currency: null,
        itemDescription: 'toilet paper',
        confidence: 58,
        parserMode: 'llm',
        clarificationQuestion: 'Which currency was this purchase in?'
      })
    })

    await bot.handleUpdate(purchaseUpdate('Bought toilet paper 30') as never)

    expect(calls).toHaveLength(3)
    expect(calls[0]).toMatchObject({
      method: 'sendChatAction'
    })
    expect(calls[1]).toMatchObject({
      method: 'sendMessage',
      payload: {
        text: 'Checking that purchase...'
      }
    })
    expect(calls[2]).toMatchObject({
      method: 'editMessageText',
      payload: {
        text: 'Which currency was this purchase in?'
      }
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
          parserMode: 'llm',
          participants: participants()
        }
      },
      async confirm() {
        throw new Error('not used')
      },
      async cancel() {
        throw new Error('not used')
      },
      async toggleParticipant() {
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
        text: `I think this shared purchase was: toilet paper - 30.00 GEL.

Participants:
- Mia
- Dima (excluded)
Confirm or cancel below.`,
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '✅ Mia',
                callback_data: 'purchase:participant:participant-1'
              }
            ],
            [
              {
                text: '⬜ Dima',
                callback_data: 'purchase:participant:participant-2'
              }
            ],
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

  test('stays silent for planning chatter even when an interpreter is configured', async () => {
    const bot = createTestBot()
    const calls: Array<{ method: string; payload: unknown }> = []
    let saveCalls = 0

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
        saveCalls += 1
        return {
          status: 'ignored_not_purchase',
          purchaseMessageId: 'ignored-1'
        }
      },
      async confirm() {
        throw new Error('not used')
      },
      async cancel() {
        throw new Error('not used')
      },
      async toggleParticipant() {
        throw new Error('not used')
      }
    }

    registerPurchaseTopicIngestion(bot, config, repository, {
      interpreter: async () => ({
        decision: 'not_purchase',
        amountMinor: null,
        currency: null,
        itemDescription: null,
        confidence: 12,
        parserMode: 'llm',
        clarificationQuestion: null
      })
    })

    await bot.handleUpdate(purchaseUpdate('We should buy toilet paper for 30 gel') as never)

    expect(saveCalls).toBe(0)
    expect(calls).toHaveLength(0)
  })

  test('stays silent for stray amount chatter in the purchase topic', async () => {
    const bot = createTestBot()
    const calls: Array<{ method: string; payload: unknown }> = []
    let saveCalls = 0

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
        saveCalls += 1
        return {
          status: 'ignored_not_purchase',
          purchaseMessageId: 'ignored-2'
        }
      },
      async confirm() {
        throw new Error('not used')
      },
      async cancel() {
        throw new Error('not used')
      },
      async toggleParticipant() {
        throw new Error('not used')
      }
    }

    registerPurchaseTopicIngestion(bot, config, repository, {
      interpreter: async () => ({
        decision: 'not_purchase',
        amountMinor: null,
        currency: null,
        itemDescription: null,
        confidence: 17,
        parserMode: 'llm',
        clarificationQuestion: null
      })
    })

    await bot.handleUpdate(purchaseUpdate('This machine costs 300 gel, scary') as never)

    expect(saveCalls).toBe(0)
    expect(calls).toHaveLength(0)
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
      },
      async toggleParticipant() {
        throw new Error('not used')
      }
    }

    registerPurchaseTopicIngestion(bot, config, repository)
    await bot.handleUpdate(purchaseUpdate('Bought toilet paper 30 gel') as never)
    await bot.handleUpdate(purchaseUpdate('This is not a purchase') as never)

    expect(calls).toHaveLength(0)
  })

  test('skips explicitly tagged bot messages in the purchase topic', async () => {
    const bot = createTestBot()
    const calls: Array<{ method: string; payload: unknown }> = []
    let saveCalls = 0

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
        saveCalls += 1
        return {
          status: 'ignored_not_purchase' as const,
          purchaseMessageId: 'ignored-1'
        }
      },
      async confirm() {
        throw new Error('not used')
      },
      async cancel() {
        throw new Error('not used')
      },
      async toggleParticipant() {
        throw new Error('not used')
      }
    }

    registerPurchaseTopicIngestion(bot, config, repository)
    await bot.handleUpdate(purchaseUpdate('@household_test_bot how is life?') as never)

    expect(saveCalls).toBe(1)
    expect(calls).toHaveLength(0)
  })

  test('still handles tagged purchase-like messages in the purchase topic', async () => {
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
      async save(record) {
        expect(record.rawText).toBe('Bought toilet paper 30 gel')
        return {
          status: 'pending_confirmation',
          purchaseMessageId: 'proposal-1',
          parsedAmountMinor: 3000n,
          parsedCurrency: 'GEL',
          parsedItemDescription: 'toilet paper',
          parserConfidence: 92,
          parserMode: 'llm',
          participants: participants()
        }
      },
      async confirm() {
        throw new Error('not used')
      },
      async cancel() {
        throw new Error('not used')
      },
      async toggleParticipant() {
        throw new Error('not used')
      }
    }

    registerPurchaseTopicIngestion(bot, config, repository)
    await bot.handleUpdate(
      purchaseUpdate('@household_test_bot Bought toilet paper 30 gel') as never
    )

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      method: 'sendMessage',
      payload: {
        text: `I think this shared purchase was: toilet paper - 30.00 GEL.

Participants:
- Mia
- Dima (excluded)
Confirm or cancel below.`
      }
    })
  })

  test('does not send the purchase handoff for tagged non-purchase conversation', async () => {
    const bot = createTestBot()
    const calls: Array<{ method: string; payload: unknown }> = []
    let saveCalls = 0

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
        saveCalls += 1
        return {
          status: 'ignored_not_purchase',
          purchaseMessageId: 'ignored-3'
        }
      },
      async confirm() {
        throw new Error('not used')
      },
      async cancel() {
        throw new Error('not used')
      },
      async toggleParticipant() {
        throw new Error('not used')
      }
    }

    registerPurchaseTopicIngestion(bot, config, repository, {
      interpreter: async () => ({
        decision: 'not_purchase',
        amountMinor: null,
        currency: null,
        itemDescription: null,
        confidence: 19,
        parserMode: 'llm',
        clarificationQuestion: null
      })
    })

    await bot.handleUpdate(purchaseUpdate('@household_test_bot please ignore me today') as never)

    expect(saveCalls).toBe(1)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      method: 'sendChatAction',
      payload: {
        chat_id: Number(config.householdChatId),
        action: 'typing',
        message_thread_id: config.purchaseTopicId
      }
    })
  })

  test('continues purchase handling for replies to bot messages without a fresh mention', async () => {
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
      async save(record) {
        expect(record.rawText).toBe('Actually it was 32 gel')
        return {
          status: 'clarification_needed',
          purchaseMessageId: 'proposal-2',
          clarificationQuestion: 'Was that for toilet paper?',
          parsedAmountMinor: 3200n,
          parsedCurrency: 'GEL',
          parsedItemDescription: null,
          parserConfidence: 61,
          parserMode: 'llm'
        }
      },
      async confirm() {
        throw new Error('not used')
      },
      async cancel() {
        throw new Error('not used')
      },
      async toggleParticipant() {
        throw new Error('not used')
      }
    }

    registerPurchaseTopicIngestion(bot, config, repository, {
      interpreter: async () => ({
        decision: 'clarification',
        amountMinor: 3200n,
        currency: 'GEL',
        itemDescription: null,
        confidence: 61,
        parserMode: 'llm',
        clarificationQuestion: 'Was that for toilet paper?'
      })
    })

    await bot.handleUpdate(purchaseUpdate('Actually it was 32 gel', { replyToBot: true }) as never)

    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({
      method: 'sendChatAction'
    })
    expect(calls[1]).toMatchObject({
      method: 'sendMessage',
      payload: {
        text: 'Was that for toilet paper?'
      }
    })
  })

  test('continues purchase handling for active clarification context without a fresh mention', async () => {
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
        return true
      },
      async save(record) {
        expect(record.rawText).toBe('32 gel')
        return {
          status: 'clarification_needed',
          purchaseMessageId: 'proposal-3',
          clarificationQuestion: 'What item was that for?',
          parsedAmountMinor: 3200n,
          parsedCurrency: 'GEL',
          parsedItemDescription: null,
          parserConfidence: 58,
          parserMode: 'llm'
        }
      },
      async confirm() {
        throw new Error('not used')
      },
      async cancel() {
        throw new Error('not used')
      },
      async toggleParticipant() {
        throw new Error('not used')
      }
    }

    registerPurchaseTopicIngestion(bot, config, repository, {
      interpreter: async () => ({
        decision: 'clarification',
        amountMinor: 3200n,
        currency: 'GEL',
        itemDescription: null,
        confidence: 58,
        parserMode: 'llm',
        clarificationQuestion: 'What item was that for?'
      })
    })

    await bot.handleUpdate(purchaseUpdate('32 gel') as never)

    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({
      method: 'sendChatAction'
    })
    expect(calls[1]).toMatchObject({
      method: 'sendMessage',
      payload: {
        text: 'What item was that for?'
      }
    })
  })

  test('toggles purchase participants before confirmation', async () => {
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
        throw new Error('not used')
      },
      async toggleParticipant() {
        return {
          status: 'updated' as const,
          purchaseMessageId: 'proposal-1',
          householdId: config.householdId,
          parsedAmountMinor: 3000n,
          parsedCurrency: 'GEL' as const,
          parsedItemDescription: 'toilet paper',
          parserConfidence: 92,
          parserMode: 'llm' as const,
          participants: [
            {
              id: 'participant-1',
              memberId: 'member-1',
              displayName: 'Mia',
              included: true
            },
            {
              id: 'participant-2',
              memberId: 'member-2',
              displayName: 'Dima',
              included: true
            }
          ]
        }
      }
    }

    registerPurchaseTopicIngestion(bot, config, repository)
    await bot.handleUpdate(callbackUpdate('purchase:participant:participant-2') as never)

    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({
      method: 'answerCallbackQuery',
      payload: {
        callback_query_id: 'callback-1'
      }
    })
    expect(calls[1]).toMatchObject({
      method: 'editMessageText',
      payload: {
        text: `I think this shared purchase was: toilet paper - 30.00 GEL.

Participants:
- Mia
- Dima
Confirm or cancel below.`,
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '✅ Mia',
                callback_data: 'purchase:participant:participant-1'
              }
            ],
            [
              {
                text: '✅ Dima',
                callback_data: 'purchase:participant:participant-2'
              }
            ],
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

  test('blocks removing the last included participant', async () => {
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
        throw new Error('not used')
      },
      async toggleParticipant() {
        return {
          status: 'at_least_one_required' as const,
          householdId: config.householdId
        }
      }
    }

    registerPurchaseTopicIngestion(bot, config, repository)
    await bot.handleUpdate(callbackUpdate('purchase:participant:participant-1') as never)

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      method: 'answerCallbackQuery',
      payload: {
        callback_query_id: 'callback-1',
        text: 'Keep at least one participant in the purchase split.',
        show_alert: true
      }
    })
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
          parserMode: 'llm',
          participants: participants()
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
      },
      async toggleParticipant() {
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
      },
      async toggleParticipant() {
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
      },
      async toggleParticipant() {
        throw new Error('not used')
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
