import { describe, expect, test } from 'bun:test'

import { instantFromIso } from '@household/domain'
import type {
  HouseholdConfigurationRepository,
  TopicMessageHistoryRecord,
  TopicMessageHistoryRepository
} from '@household/ports'
import { createTelegramBot } from './bot'

import {
  buildPurchaseAcknowledgement,
  extractPurchaseTopicCandidate,
  explicitPurchaseParticipantMemberIds,
  looksLikeLikelyCompletedPurchase,
  registerConfiguredPurchaseTopicIngestion,
  registerPurchaseTopicIngestion,
  resolveProposalParticipantSelection,
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
    threadId?: number
    asCaption?: boolean
    asPhotoOnly?: boolean
  } = {}
) {
  const commandToken = text.split(' ')[0] ?? text

  return {
    update_id: 1001,
    message: {
      message_id: 55,
      date: Math.floor(Date.now() / 1000),
      message_thread_id: options.threadId ?? 777,
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
      ...(options.asPhotoOnly
        ? {
            photo: [
              {
                file_id: 'photo-1',
                file_unique_id: 'photo-1',
                width: 100,
                height: 100
              }
            ]
          }
        : options.asCaption
          ? {
              caption: text,
              photo: [
                {
                  file_id: 'photo-1',
                  file_unique_id: 'photo-1',
                  width: 100,
                  height: 100
                }
              ]
            }
          : {
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
            })
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

function createTopicMessageHistoryRepository(): TopicMessageHistoryRepository {
  const rows: TopicMessageHistoryRecord[] = []

  return {
    async saveMessage(input) {
      rows.push(input)
    },
    async listRecentThreadMessages(input) {
      return rows
        .filter(
          (row) =>
            row.householdId === input.householdId &&
            row.telegramChatId === input.telegramChatId &&
            row.telegramThreadId === input.telegramThreadId
        )
        .slice(-input.limit)
    },
    async listRecentChatMessages(input) {
      return rows
        .filter(
          (row) =>
            row.householdId === input.householdId &&
            row.telegramChatId === input.telegramChatId &&
            row.messageSentAt &&
            row.messageSentAt.epochMilliseconds >= input.sentAtOrAfter.epochMilliseconds
        )
        .slice(-input.limit)
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

describe('looksLikeLikelyCompletedPurchase', () => {
  test('accepts Russian item-first completed purchases with trailing lari amount', () => {
    expect(looksLikeLikelyCompletedPurchase('стиральный порошок уже купил 12 лари')).toBe(true)
  })

  test('does not treat shopping-list chatter as a completed purchase', () => {
    expect(
      looksLikeLikelyCompletedPurchase('Сейчас заканчивается туалетка и стиральный порошок')
    ).toBe(false)
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
      amountSource: 'explicit',
      calculationExplanation: null,
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

  test('shows a calculation note when the llm computed the total', () => {
    const result = buildPurchaseAcknowledgement({
      status: 'pending_confirmation',
      purchaseMessageId: 'proposal-1b',
      parsedAmountMinor: 3000n,
      parsedCurrency: 'GEL',
      parsedItemDescription: 'water bottles',
      amountSource: 'calculated',
      calculationExplanation: '5 x 6 lari = 30 lari',
      parserConfidence: 94,
      parserMode: 'llm',
      participants: participants()
    })

    expect(result).toBe(`I think this shared purchase was: water bottles - 30.00 GEL.
I calculated the total as 5 x 6 lari = 30 lari. Is that right?

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
      amountSource: 'explicit',
      calculationExplanation: null,
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
      amountSource: null,
      calculationExplanation: null,
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
        amountSource: 'explicit',
        calculationExplanation: null,
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

describe('resolveProposalParticipantSelection', () => {
  test('prefers explicit llm-selected participants over away-status defaults', () => {
    const participants = resolveProposalParticipantSelection({
      members: [
        {
          memberId: 'member-stas',
          telegramUserId: '10002',
          lifecycleStatus: 'active'
        },
        {
          memberId: 'member-dima',
          telegramUserId: '10003',
          lifecycleStatus: 'active'
        },
        {
          memberId: 'member-alice',
          telegramUserId: '10004',
          lifecycleStatus: 'away'
        }
      ],
      senderTelegramUserId: '10002',
      senderMemberId: 'member-stas',
      explicitParticipantMemberIds: ['member-stas', 'member-alice']
    })

    expect(participants).toEqual([
      {
        memberId: 'member-stas',
        included: true
      },
      {
        memberId: 'member-dima',
        included: false
      },
      {
        memberId: 'member-alice',
        included: true
      }
    ])
  })

  test('falls back to the sender when explicit members are no longer eligible', () => {
    const participants = resolveProposalParticipantSelection({
      members: [
        {
          memberId: 'member-stas',
          telegramUserId: '10002',
          lifecycleStatus: 'active'
        },
        {
          memberId: 'member-dima',
          telegramUserId: '10003',
          lifecycleStatus: 'active'
        },
        {
          memberId: 'member-alice',
          telegramUserId: '10004',
          lifecycleStatus: 'left'
        }
      ],
      senderTelegramUserId: '10002',
      senderMemberId: 'member-stas',
      explicitParticipantMemberIds: ['member-alice']
    })

    expect(participants).toEqual([
      {
        memberId: 'member-stas',
        included: true
      },
      {
        memberId: 'member-dima',
        included: false
      }
    ])
  })

  test('includes all active members by default and excludes away members', () => {
    const participants = resolveProposalParticipantSelection({
      members: [
        {
          memberId: 'member-ion',
          telegramUserId: '10002',
          lifecycleStatus: 'active'
        },
        {
          memberId: 'member-stas',
          telegramUserId: '10003',
          lifecycleStatus: 'active'
        },
        {
          memberId: 'member-alice',
          telegramUserId: '10004',
          lifecycleStatus: 'away'
        }
      ],
      senderTelegramUserId: '10002',
      senderMemberId: 'member-ion',
      explicitParticipantMemberIds: null
    })

    expect(participants).toEqual([
      {
        memberId: 'member-ion',
        included: true
      },
      {
        memberId: 'member-stas',
        included: true
      },
      {
        memberId: 'member-alice',
        included: false
      }
    ])
  })
})

describe('explicitPurchaseParticipantMemberIds', () => {
  test('ignores sender-only model participants when the text does not narrow the split', () => {
    expect(
      explicitPurchaseParticipantMemberIds({
        rawText: 'стиральный порошок уже купил 12 лари',
        participantMemberIds: ['member-ion']
      })
    ).toBeNull()
  })

  test('keeps participants when the text explicitly narrows the split', () => {
    expect(
      explicitPurchaseParticipantMemberIds({
        rawText: 'купил туалетку для меня и Димы 12 лари',
        participantMemberIds: ['member-ion', 'member-dima']
      })
    ).toEqual(['member-ion', 'member-dima'])
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
      async saveWithInterpretation() {
        throw new Error('not implemented')
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
      async saveWithInterpretation() {
        throw new Error('not implemented')
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

  test('reads purchase captions from photo messages', async () => {
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
        expect(record.rawText).toBe('Bought toilet paper 30 gel')
        return {
          status: 'pending_confirmation',
          purchaseMessageId: 'proposal-caption',
          parsedAmountMinor: 3000n,
          parsedCurrency: 'GEL',
          parsedItemDescription: 'toilet paper',
          payerMemberId: 'member-1',
          payerDisplayName: 'Mia',
          parserConfidence: 90,
          parserMode: 'llm',
          participants: participants()
        }
      },
      async confirm() {
        throw new Error('not used')
      },
      async saveWithInterpretation() {
        throw new Error('not implemented')
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
      purchaseUpdate('Bought toilet paper 30 gel', { asCaption: true }) as never
    )

    expect(calls).toHaveLength(1)
    expect(calls[0]?.payload).toMatchObject({
      text: expect.stringContaining('toilet paper - 30.00 GEL')
    })
  })

  test('keeps photo-only purchase messages in clarification flow and accepts price-only followups', async () => {
    const bot = createTestBot()
    const calls: Array<{ method: string; payload: unknown }> = []
    let hasClarificationContext = false
    let saveCalls = 0
    let saveWithInterpretationCalls = 0

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
          text: (payload as { text?: string }).text ?? 'ok'
        }
      } as never
    })

    const repository: PurchaseMessageIngestionRepository = {
      async hasClarificationContext() {
        return hasClarificationContext
      },
      async save(record, interpreter, defaultCurrency, options) {
        saveCalls += 1
        expect(record.rawText).toBe('24лар')
        expect(interpreter).toBeDefined()
        expect(defaultCurrency).toBe('GEL')
        expect(options).toEqual({
          householdContext: null,
          assistantTone: null
        })

        return {
          status: 'clarification_needed',
          purchaseMessageId: 'proposal-price-followup',
          clarificationQuestion: null,
          parsedAmountMinor: 2400n,
          parsedCurrency: 'GEL',
          parsedItemDescription: null,
          payerMemberId: 'member-1',
          payerDisplayName: 'Mia',
          parserConfidence: 66,
          parserMode: 'llm'
        }
      },
      async saveWithInterpretation(_record, interpretation) {
        saveWithInterpretationCalls += 1
        hasClarificationContext = true
        expect(interpretation).toMatchObject({
          decision: 'clarification',
          amountMinor: null,
          currency: null,
          itemDescription: null
        })

        return {
          status: 'clarification_needed',
          purchaseMessageId: 'proposal-photo-only',
          clarificationQuestion:
            'I can see the photo, but I still need the item and total. What exactly was bought and for how much?',
          parsedAmountMinor: null,
          parsedCurrency: null,
          parsedItemDescription: null,
          payerMemberId: 'member-1',
          payerDisplayName: 'Mia',
          parserConfidence: 0,
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

    const householdConfigurationRepository = {
      findHouseholdTopicByTelegramContext: async () => ({
        householdId: config.householdId,
        telegramThreadId: '777',
        role: 'purchase' as const,
        topicName: 'Purchases'
      }),
      getHouseholdBillingSettings: async () => ({
        householdId: config.householdId,
        paymentBalanceAdjustmentPolicy: 'utilities' as const,
        rentAmountMinor: null,
        rentCurrency: 'USD' as const,
        rentDueDay: 4,
        rentWarningDay: 2,
        utilitiesDueDay: 12,
        utilitiesReminderDay: 10,
        timezone: 'Asia/Tbilisi',
        settlementCurrency: 'GEL' as const,
        rentPaymentDestinations: null
      }),
      getHouseholdChatByHouseholdId: async () => ({
        householdId: config.householdId,
        householdName: 'Test household',
        telegramChatId: config.householdChatId,
        telegramChatType: 'supergroup',
        title: 'Test household',
        defaultLocale: 'en' as const
      }),
      getHouseholdAssistantConfig: async () => ({
        householdId: config.householdId,
        assistantContext: null,
        assistantTone: null
      })
    } satisfies Pick<
      HouseholdConfigurationRepository,
      | 'findHouseholdTopicByTelegramContext'
      | 'getHouseholdBillingSettings'
      | 'getHouseholdChatByHouseholdId'
      | 'getHouseholdAssistantConfig'
    >

    registerConfiguredPurchaseTopicIngestion(
      bot,
      householdConfigurationRepository as unknown as HouseholdConfigurationRepository,
      repository,
      {
        interpreter: async () => ({
          decision: 'clarification',
          amountMinor: 2400n,
          currency: 'GEL',
          itemDescription: null,
          confidence: 66,
          parserMode: 'llm',
          clarificationQuestion: null
        }),
        topicProcessor: async () => ({
          route: 'silent',
          reason: 'followup_needs_interpreter'
        })
      }
    )

    await bot.handleUpdate(purchaseUpdate('', { asPhotoOnly: true }) as never)
    await bot.handleUpdate(purchaseUpdate('24лар') as never)

    expect(saveWithInterpretationCalls).toBe(1)
    expect(saveCalls).toBe(1)
    expect(calls).toHaveLength(3)
    expect(calls[0]).toMatchObject({
      method: 'sendMessage',
      payload: {
        text: 'I can see the photo, but I still need the item and total. What exactly was bought and for how much?'
      }
    })
    expect(calls[1]).toMatchObject({
      method: 'sendChatAction'
    })
    expect(calls[2]).toMatchObject({
      method: 'sendMessage',
      payload: {
        text: 'What exactly was purchased?'
      }
    })
  })

  test('shows payer selection buttons when the purchase payer is ambiguous', async () => {
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
          clarificationQuestion: null,
          parsedAmountMinor: 1000n,
          parsedCurrency: 'GEL',
          parsedItemDescription: 'chicken',
          payerMemberId: null,
          payerDisplayName: null,
          parserConfidence: 78,
          parserMode: 'llm',
          payerCandidates: [
            { memberId: 'member-1', displayName: 'Mia' },
            { memberId: 'member-2', displayName: 'Dima' }
          ]
        }
      },
      async confirm() {
        throw new Error('not used')
      },
      async saveWithInterpretation() {
        throw new Error('not implemented')
      },
      async cancel() {
        throw new Error('not used')
      },
      async toggleParticipant() {
        throw new Error('not used')
      }
    }

    registerPurchaseTopicIngestion(bot, config, repository)
    await bot.handleUpdate(purchaseUpdate('Dima bought chicken for 10 gel') as never)

    expect(calls).toHaveLength(1)
    const payload = calls[0]?.payload as {
      text: string
      reply_markup?: {
        inline_keyboard?: Array<Array<{ text: string; callback_data: string }>>
      }
    }

    expect(payload.text).toBe('I could not tell who bought this. Pick the payer below.')
    expect(payload.reply_markup?.inline_keyboard?.[0]).toEqual([
      {
        text: 'Mia paid',
        callback_data: 'purchase:payer:proposal-1:member-1'
      }
    ])
    expect(payload.reply_markup?.inline_keyboard?.[1]).toEqual([
      {
        text: 'Dima paid',
        callback_data: 'purchase:payer:proposal-1:member-2'
      }
    ])
    expect(payload.reply_markup?.inline_keyboard?.[2]).toEqual([
      {
        text: 'Cancel',
        callback_data: 'purchase:cancel:proposal-1'
      }
    ])
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
      async saveWithInterpretation() {
        throw new Error('not implemented')
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

    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({
      method: 'sendChatAction'
    })
    expect(calls[1]).toMatchObject({
      method: 'sendMessage',
      payload: {
        text: 'Which currency was this purchase in?'
      }
    })
  })

  test('sends a final purchase reply without a visible processing message', async () => {
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
      async saveWithInterpretation() {
        throw new Error('not implemented')
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

    expect(calls).toHaveLength(2)
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
        text: `I think this shared purchase was: toilet paper - 30.00 GEL.

Participants:
- Mia
- Dima (excluded)
Confirm or cancel below.`,
        reply_parameters: {
          message_id: 55
        },
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
      async saveWithInterpretation() {
        throw new Error('not implemented')
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

  test('stays silent for Russian shopping-list chatter without sending a processing message', async () => {
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
        throw new Error('not used')
      },
      async confirm() {
        throw new Error('not used')
      },
      async saveWithInterpretation() {
        throw new Error('not implemented')
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
        confidence: 96,
        parserMode: 'llm',
        clarificationQuestion: null
      })
    })

    await bot.handleUpdate(
      purchaseUpdate('Сейчас заканчивается туалетка и стиральный порошок') as never
    )

    expect(saveCalls).toBe(0)
    expect(calls).toHaveLength(0)
  })

  test('treats colloquial completed purchase reports as likely purchases', async () => {
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
        expect(record.rawText).toBe(
          'Короч, сходил на рынок и взял этот долбаный ковер. Сторговался до 150 лари'
        )
        return {
          status: 'pending_confirmation',
          purchaseMessageId: 'proposal-carpet',
          parsedAmountMinor: 15000n,
          parsedCurrency: 'GEL',
          parsedItemDescription: 'ковер',
          parserConfidence: 91,
          parserMode: 'llm',
          participants: participants()
        }
      },
      async confirm() {
        throw new Error('not used')
      },
      async saveWithInterpretation() {
        throw new Error('not implemented')
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
        amountMinor: 15000n,
        currency: 'GEL',
        itemDescription: 'ковер',
        confidence: 91,
        parserMode: 'llm',
        clarificationQuestion: null
      })
    })

    await bot.handleUpdate(
      purchaseUpdate(
        'Короч, сходил на рынок и взял этот долбаный ковер. Сторговался до 150 лари'
      ) as never
    )

    expect(calls).toHaveLength(2)
    expect(calls[1]).toMatchObject({
      method: 'sendMessage',
      payload: {
        text: `I think this shared purchase was: ковер - 150.00 GEL.

Participants:
- Mia
- Dima (excluded)
Confirm or cancel below.`
      }
    })
  })

  test('treats Russian item-first completed purchase reports as purchases', async () => {
    const bot = createTestBot()
    const calls: Array<{ method: string; payload: unknown }> = []
    let saveCalls = 0

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
          text: (payload as { text?: string }).text ?? 'ok'
        }
      } as never
    })

    const repository: PurchaseMessageIngestionRepository = {
      async hasClarificationContext() {
        return false
      },
      async save(record) {
        saveCalls += 1
        expect(record.rawText).toBe('стиральный порошок уже купил 12 лари')
        return {
          status: 'pending_confirmation',
          purchaseMessageId: 'proposal-detergent',
          parsedAmountMinor: 1200n,
          parsedCurrency: 'GEL',
          parsedItemDescription: 'стиральный порошок',
          parserConfidence: 92,
          parserMode: 'llm',
          participants: participants()
        }
      },
      async confirm() {
        throw new Error('not used')
      },
      async saveWithInterpretation() {
        throw new Error('not implemented')
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
        amountMinor: 1200n,
        currency: 'GEL',
        itemDescription: 'стиральный порошок',
        confidence: 92,
        parserMode: 'llm',
        clarificationQuestion: null
      })
    })

    await bot.handleUpdate(purchaseUpdate('стиральный порошок уже купил 12 лари') as never)

    expect(saveCalls).toBe(1)
    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({
      method: 'sendChatAction'
    })
    expect(calls[1]).toMatchObject({
      method: 'sendMessage',
      payload: {
        text: expect.stringContaining('стиральный порошок - 12.00 GEL')
      }
    })
  })

  test('uses dedicated buttons for calculated totals', async () => {
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
          purchaseMessageId: 'proposal-calculated',
          parsedAmountMinor: 3000n,
          parsedCurrency: 'GEL',
          parsedItemDescription: 'water bottles',
          amountSource: 'calculated',
          calculationExplanation: '5 x 6 lari = 30 lari',
          parserConfidence: 94,
          parserMode: 'llm',
          participants: participants()
        }
      },
      async confirm() {
        throw new Error('not used')
      },
      async saveWithInterpretation() {
        throw new Error('not implemented')
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
        itemDescription: 'water bottles',
        amountSource: 'calculated',
        calculationExplanation: '5 x 6 lari = 30 lari',
        confidence: 94,
        parserMode: 'llm',
        clarificationQuestion: null
      })
    })

    await bot.handleUpdate(purchaseUpdate('Bought 5 bottles of water, 6 lari each') as never)

    expect(calls[1]).toMatchObject({
      method: 'sendMessage',
      payload: {
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
                text: 'Looks right',
                callback_data: 'purchase:confirm:proposal-calculated'
              },
              {
                text: 'Fix amount',
                callback_data: 'purchase:fix_amount:proposal-calculated'
              },
              {
                text: 'Cancel',
                callback_data: 'purchase:cancel:proposal-calculated'
              }
            ]
          ]
        }
      }
    })
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
      async saveWithInterpretation() {
        throw new Error('not implemented')
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
      async saveWithInterpretation() {
        throw new Error('not implemented')
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
      async saveWithInterpretation() {
        throw new Error('not implemented')
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
      async saveWithInterpretation() {
        throw new Error('not implemented')
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
      async saveWithInterpretation() {
        throw new Error('not implemented')
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

  test('replies playfully to addressed banter with router and skips purchase save', async () => {
    const bot = createTestBot()
    const calls: Array<{ method: string; payload: unknown }> = []
    let saveCalls = 0

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
        saveCalls += 1
        throw new Error('not used')
      },
      async confirm() {
        throw new Error('not used')
      },
      async saveWithInterpretation() {
        throw new Error('not implemented')
      },
      async cancel() {
        throw new Error('not used')
      },
      async toggleParticipant() {
        throw new Error('not used')
      }
    }

    registerPurchaseTopicIngestion(bot, config, repository, {
      router: async () => ({
        route: 'chat_reply',
        replyText: 'Тут. Если что-то реально купили, подключусь.',
        helperKind: null,
        shouldStartTyping: false,
        shouldClearWorkflow: false,
        confidence: 95,
        reason: 'smalltalk'
      })
    })

    await bot.handleUpdate(purchaseUpdate('@household_test_bot А ты тут?') as never)

    expect(saveCalls).toBe(0)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      method: 'sendMessage',
      payload: {
        text: 'Тут. Если что-то реально купили, подключусь.'
      }
    })
  })

  test('clears active purchase clarification when router dismisses the workflow', async () => {
    const bot = createTestBot()
    const calls: Array<{ method: string; payload: unknown }> = []
    let clearCalls = 0

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
      async clearClarificationContext() {
        clearCalls += 1
      },
      async save() {
        throw new Error('not used')
      },
      async confirm() {
        throw new Error('not used')
      },
      async saveWithInterpretation() {
        throw new Error('not implemented')
      },
      async cancel() {
        throw new Error('not used')
      },
      async toggleParticipant() {
        throw new Error('not used')
      }
    }

    registerPurchaseTopicIngestion(bot, config, repository, {
      router: async () => ({
        route: 'dismiss_workflow',
        replyText: 'Окей, молчу.',
        helperKind: null,
        shouldStartTyping: false,
        shouldClearWorkflow: true,
        confidence: 98,
        reason: 'backoff'
      })
    })

    await bot.handleUpdate(purchaseUpdate('Отстань') as never)

    expect(clearCalls).toBe(1)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      method: 'sendMessage',
      payload: {
        text: 'Окей, молчу.'
      }
    })
  })

  test('clears active purchase clarification when a followup is ignored as not_purchase', async () => {
    const bot = createTestBot()
    let clearCalls = 0

    bot.api.config.use(async () => {
      return {
        ok: true,
        result: true
      } as never
    })

    const repository: PurchaseMessageIngestionRepository = {
      async hasClarificationContext() {
        return true
      },
      async clearClarificationContext() {
        clearCalls += 1
      },
      async save() {
        return {
          status: 'ignored_not_purchase',
          purchaseMessageId: 'purchase-1'
        }
      },
      async confirm() {
        throw new Error('not used')
      },
      async saveWithInterpretation() {
        throw new Error('not implemented')
      },
      async cancel() {
        throw new Error('not used')
      },
      async toggleParticipant() {
        throw new Error('not used')
      }
    }

    registerPurchaseTopicIngestion(bot, config, repository, {
      router: async () => ({
        route: 'purchase_followup',
        replyText: null,
        helperKind: 'purchase',
        shouldStartTyping: false,
        shouldClearWorkflow: false,
        confidence: 91,
        reason: 'llm_followup_guess'
      })
    })

    await bot.handleUpdate(purchaseUpdate('Я уже сказал выше') as never)

    expect(clearCalls).toBe(1)
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
      async saveWithInterpretation() {
        throw new Error('not implemented')
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
      async saveWithInterpretation() {
        throw new Error('not implemented')
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
      async saveWithInterpretation() {
        throw new Error('not implemented')
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
      async saveWithInterpretation() {
        throw new Error('not implemented')
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

  test('uses recent silent planning context for direct bot-address advice replies', async () => {
    const bot = createTestBot()
    const calls: Array<{ method: string; payload: unknown }> = []
    const historyRepository = createTopicMessageHistoryRepository()
    let sawDirectAddress = false
    let recentTurnTexts: string[] = []

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
      async saveWithInterpretation() {
        throw new Error('not implemented')
      },
      async cancel() {
        throw new Error('not used')
      },
      async toggleParticipant() {
        throw new Error('not used')
      }
    }

    registerPurchaseTopicIngestion(bot, config, repository, {
      historyRepository,
      router: async (input) => {
        if (input.messageText.includes('думаю купить')) {
          return {
            route: 'silent',
            replyText: null,
            helperKind: null,
            shouldStartTyping: false,
            shouldClearWorkflow: false,
            confidence: 90,
            reason: 'planning'
          }
        }

        sawDirectAddress = input.isExplicitMention
        recentTurnTexts = input.recentThreadMessages?.map((turn) => turn.text) ?? []

        return {
          route: 'chat_reply',
          replyText: 'Если 5 кг стоят 20 лари, это 4 лари за кило. Я бы еще сравнил цену.',
          helperKind: 'assistant',
          shouldStartTyping: false,
          shouldClearWorkflow: false,
          confidence: 92,
          reason: 'planning_advice'
        }
      }
    })

    await bot.handleUpdate(
      purchaseUpdate('В общем, думаю купить 5 килограмм картошки за 20 лари') as never
    )
    await bot.handleUpdate(purchaseUpdate('@household_test_bot что думаешь?') as never)

    expect(sawDirectAddress).toBe(true)
    expect(recentTurnTexts).toContain('В общем, думаю купить 5 килограмм картошки за 20 лари')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      method: 'sendMessage',
      payload: {
        text: 'Если 5 кг стоят 20 лари, это 4 лари за кило. Я бы еще сравнил цену.'
      }
    })
  })

  test('does not treat ordinary bot nouns as direct address', async () => {
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
      async saveWithInterpretation() {
        throw new Error('not implemented')
      },
      async cancel() {
        throw new Error('not used')
      },
      async toggleParticipant() {
        throw new Error('not used')
      }
    }

    registerPurchaseTopicIngestion(bot, config, repository, {
      router: async (input) => ({
        route: input.isExplicitMention ? 'chat_reply' : 'silent',
        replyText: input.isExplicitMention ? 'heard you' : null,
        helperKind: input.isExplicitMention ? 'assistant' : null,
        shouldStartTyping: false,
        shouldClearWorkflow: false,
        confidence: 90,
        reason: 'test'
      })
    })

    await bot.handleUpdate(purchaseUpdate('Думаю купить bot vacuum за 200 лари') as never)

    expect(calls).toHaveLength(0)
  })

  test('keeps silent planning context scoped to the current purchase thread', async () => {
    const bot = createTestBot()
    const calls: Array<{ method: string; payload: unknown }> = []
    const historyRepository = createTopicMessageHistoryRepository()
    let recentTurnTexts: string[] = []

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
      async saveWithInterpretation() {
        throw new Error('not implemented')
      },
      async cancel() {
        throw new Error('not used')
      },
      async toggleParticipant() {
        throw new Error('not used')
      }
    }

    const householdConfigurationRepository = {
      findHouseholdTopicByTelegramContext: async ({
        telegramThreadId
      }: {
        telegramThreadId: string
      }) => ({
        householdId: config.householdId,
        telegramThreadId,
        role: 'purchase' as const,
        topicName: null
      }),
      getHouseholdBillingSettings: async () => ({
        householdId: config.householdId,
        paymentBalanceAdjustmentPolicy: 'utilities' as const,
        rentAmountMinor: null,
        rentCurrency: 'USD' as const,
        rentDueDay: 4,
        rentWarningDay: 2,
        utilitiesDueDay: 12,
        utilitiesReminderDay: 10,
        timezone: 'Asia/Tbilisi',
        settlementCurrency: 'GEL' as const,
        rentPaymentDestinations: null
      }),
      getHouseholdChatByHouseholdId: async () => ({
        householdId: config.householdId,
        householdName: 'Test household',
        telegramChatId: config.householdChatId,
        telegramChatType: 'supergroup',
        title: 'Test household',
        defaultLocale: 'en' as const
      }),
      getHouseholdAssistantConfig: async () => ({
        householdId: config.householdId,
        assistantContext: null,
        assistantTone: null
      })
    } satisfies Pick<
      HouseholdConfigurationRepository,
      | 'findHouseholdTopicByTelegramContext'
      | 'getHouseholdBillingSettings'
      | 'getHouseholdChatByHouseholdId'
      | 'getHouseholdAssistantConfig'
    >

    registerConfiguredPurchaseTopicIngestion(
      bot,
      householdConfigurationRepository as unknown as HouseholdConfigurationRepository,
      repository,
      {
        historyRepository,
        topicProcessor: async (input) => {
          if (input.messageText.includes('картошки')) {
            return { route: 'silent', reason: 'planning' }
          }

          recentTurnTexts = input.recentThreadMessages?.map((turn) => turn.text) ?? []

          return {
            route: 'chat_reply',
            replyText: 'No leaked context here.',
            reason: 'thread_scoped'
          }
        }
      }
    )

    await bot.handleUpdate(
      purchaseUpdate('Думаю купить 5 килограмм картошки за 20 лари', { threadId: 777 }) as never
    )
    await bot.handleUpdate(purchaseUpdate('Бот, что думаешь?', { threadId: 778 }) as never)

    expect(recentTurnTexts).not.toContain('Думаю купить 5 килограмм картошки за 20 лари')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      method: 'sendMessage',
      payload: {
        text: 'No leaked context here.'
      }
    })
  })

  test('falls back to the purchase interpreter when the topic processor stays silent on an obvious third-person purchase', async () => {
    const bot = createTestBot()
    const calls: Array<{ method: string; payload: unknown }> = []
    let saveCalls = 0
    let saveWithInterpretationCalls = 0

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
      async save(_record, interpreter, defaultCurrency, options) {
        saveCalls += 1

        expect(interpreter).toBeDefined()
        expect(defaultCurrency).toBe('GEL')
        expect(options).toEqual({
          householdContext: null,
          assistantTone: null
        })

        return {
          status: 'pending_confirmation',
          purchaseMessageId: 'proposal-1',
          parsedAmountMinor: 3900n,
          parsedCurrency: 'GEL',
          parsedItemDescription: 'швабра',
          payerMemberId: 'member-2',
          payerDisplayName: 'Дима',
          parserConfidence: 92,
          parserMode: 'llm',
          participants: [
            {
              id: 'participant-1',
              memberId: 'member-1',
              displayName: 'Стас',
              included: false
            },
            {
              id: 'participant-2',
              memberId: 'member-2',
              displayName: 'Дима',
              included: true
            }
          ]
        }
      },
      async saveWithInterpretation() {
        saveWithInterpretationCalls += 1
        throw new Error('not used')
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

    const householdConfigurationRepository = {
      findHouseholdTopicByTelegramContext: async () => ({
        householdId: config.householdId,
        telegramThreadId: '777',
        role: 'purchase' as const,
        topicName: 'Purchases'
      }),
      getHouseholdBillingSettings: async () => ({
        householdId: config.householdId,
        paymentBalanceAdjustmentPolicy: 'utilities' as const,
        rentAmountMinor: null,
        rentCurrency: 'USD' as const,
        rentDueDay: 4,
        rentWarningDay: 2,
        utilitiesDueDay: 12,
        utilitiesReminderDay: 10,
        timezone: 'Asia/Tbilisi',
        settlementCurrency: 'GEL' as const,
        rentPaymentDestinations: null
      }),
      getHouseholdChatByHouseholdId: async () => ({
        householdId: config.householdId,
        householdName: 'Test household',
        telegramChatId: config.householdChatId,
        telegramChatType: 'supergroup',
        title: 'Test household',
        defaultLocale: 'ru' as const
      }),
      getHouseholdAssistantConfig: async () => ({
        householdId: config.householdId,
        assistantContext: null,
        assistantTone: null
      })
    } satisfies Pick<
      HouseholdConfigurationRepository,
      | 'findHouseholdTopicByTelegramContext'
      | 'getHouseholdBillingSettings'
      | 'getHouseholdChatByHouseholdId'
      | 'getHouseholdAssistantConfig'
    >

    registerConfiguredPurchaseTopicIngestion(
      bot,
      householdConfigurationRepository as unknown as HouseholdConfigurationRepository,
      repository,
      {
        interpreter: async () => ({
          decision: 'purchase',
          amountMinor: 3900n,
          currency: 'GEL',
          itemDescription: 'швабра',
          confidence: 92,
          parserMode: 'llm',
          clarificationQuestion: null
        }),
        topicProcessor: async () => ({
          route: 'silent',
          reason: 'misclassified_third_person_purchase'
        })
      }
    )

    await bot.handleUpdate(purchaseUpdate('Дима купил швабру за 39 лари') as never)

    expect(saveCalls).toBe(1)
    expect(saveWithInterpretationCalls).toBe(0)
    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({
      method: 'sendChatAction'
    })
    expect(calls[1]).toMatchObject({
      method: 'sendMessage',
      payload: {
        text: expect.stringContaining('I think this shared purchase was: швабра - 39.00 GEL.'),
        reply_markup: {
          inline_keyboard: expect.any(Array)
        }
      }
    })
  })

  test('falls back to the purchase interpreter when the topic processor asks clarification for an obvious purchase', async () => {
    const bot = createTestBot()
    const calls: Array<{ method: string; payload: unknown }> = []
    let saveCalls = 0
    let saveWithInterpretationCalls = 0

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
      async save(record, interpreter, defaultCurrency, options) {
        saveCalls += 1
        expect(record.rawText).toBe('стиральный порошок уже купил 12 лари')
        expect(interpreter).toBeDefined()
        expect(defaultCurrency).toBe('GEL')
        expect(options).toEqual({
          householdContext: null,
          assistantTone: null
        })

        return {
          status: 'pending_confirmation',
          purchaseMessageId: 'proposal-detergent',
          parsedAmountMinor: 1200n,
          parsedCurrency: 'GEL',
          parsedItemDescription: 'стиральный порошок',
          parserConfidence: 92,
          parserMode: 'llm',
          participants: participants()
        }
      },
      async saveWithInterpretation() {
        saveWithInterpretationCalls += 1
        throw new Error('not used')
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

    const householdConfigurationRepository = {
      findHouseholdTopicByTelegramContext: async () => ({
        householdId: config.householdId,
        telegramThreadId: '777',
        role: 'purchase' as const,
        topicName: 'Purchases'
      }),
      getHouseholdBillingSettings: async () => ({
        householdId: config.householdId,
        paymentBalanceAdjustmentPolicy: 'utilities' as const,
        rentAmountMinor: null,
        rentCurrency: 'USD' as const,
        rentDueDay: 4,
        rentWarningDay: 2,
        utilitiesDueDay: 12,
        utilitiesReminderDay: 10,
        timezone: 'Asia/Tbilisi',
        settlementCurrency: 'GEL' as const,
        rentPaymentDestinations: null
      }),
      getHouseholdChatByHouseholdId: async () => ({
        householdId: config.householdId,
        householdName: 'Test household',
        telegramChatId: config.householdChatId,
        telegramChatType: 'supergroup',
        title: 'Test household',
        defaultLocale: 'ru' as const
      }),
      getHouseholdAssistantConfig: async () => ({
        householdId: config.householdId,
        assistantContext: null,
        assistantTone: null
      })
    } satisfies Pick<
      HouseholdConfigurationRepository,
      | 'findHouseholdTopicByTelegramContext'
      | 'getHouseholdBillingSettings'
      | 'getHouseholdChatByHouseholdId'
      | 'getHouseholdAssistantConfig'
    >

    registerConfiguredPurchaseTopicIngestion(
      bot,
      householdConfigurationRepository as unknown as HouseholdConfigurationRepository,
      repository,
      {
        interpreter: async () => ({
          decision: 'purchase',
          amountMinor: 1200n,
          currency: 'GEL',
          itemDescription: 'стиральный порошок',
          confidence: 92,
          parserMode: 'llm',
          clarificationQuestion: null
        }),
        topicProcessor: async () => ({
          route: 'purchase_clarification',
          clarificationQuestion: 'Что именно купили?',
          reason: 'overcautious'
        })
      }
    )

    await bot.handleUpdate(purchaseUpdate('стиральный порошок уже купил 12 лари') as never)

    expect(saveCalls).toBe(1)
    expect(saveWithInterpretationCalls).toBe(0)
    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({
      method: 'sendChatAction'
    })
    expect(calls[1]).toMatchObject({
      method: 'sendMessage',
      payload: {
        text: expect.stringContaining(
          'I think this shared purchase was: стиральный порошок - 12.00 GEL.'
        )
      }
    })
  })

  test('falls back to the purchase interpreter for shorthand lari amounts mixed with quantity text', async () => {
    const bot = createTestBot()
    const calls: Array<{ method: string; payload: unknown }> = []
    let saveCalls = 0

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
      async save(record, interpreter, defaultCurrency, options) {
        saveCalls += 1

        expect(record.rawText).toBe('Купила жигу большую и 2 ножика маленьких 10 лар')
        expect(interpreter).toBeDefined()
        expect(defaultCurrency).toBe('GEL')
        expect(options).toEqual({
          householdContext: null,
          assistantTone: null
        })

        return {
          status: 'pending_confirmation',
          purchaseMessageId: 'proposal-short-lari',
          parsedAmountMinor: 1000n,
          parsedCurrency: 'GEL',
          parsedItemDescription: 'жига большая и 2 ножика маленьких',
          payerMemberId: 'member-1',
          payerDisplayName: 'Mia',
          parserConfidence: 91,
          parserMode: 'llm',
          participants: participants()
        }
      },
      async saveWithInterpretation() {
        throw new Error('not used')
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

    const householdConfigurationRepository = {
      findHouseholdTopicByTelegramContext: async () => ({
        householdId: config.householdId,
        telegramThreadId: '777',
        role: 'purchase' as const,
        topicName: 'Purchases'
      }),
      getHouseholdBillingSettings: async () => ({
        householdId: config.householdId,
        paymentBalanceAdjustmentPolicy: 'utilities' as const,
        rentAmountMinor: null,
        rentCurrency: 'USD' as const,
        rentDueDay: 4,
        rentWarningDay: 2,
        utilitiesDueDay: 12,
        utilitiesReminderDay: 10,
        timezone: 'Asia/Tbilisi',
        settlementCurrency: 'GEL' as const,
        rentPaymentDestinations: null
      }),
      getHouseholdChatByHouseholdId: async () => ({
        householdId: config.householdId,
        householdName: 'Test household',
        telegramChatId: config.householdChatId,
        telegramChatType: 'supergroup',
        title: 'Test household',
        defaultLocale: 'ru' as const
      }),
      getHouseholdAssistantConfig: async () => ({
        householdId: config.householdId,
        assistantContext: null,
        assistantTone: null
      })
    } satisfies Pick<
      HouseholdConfigurationRepository,
      | 'findHouseholdTopicByTelegramContext'
      | 'getHouseholdBillingSettings'
      | 'getHouseholdChatByHouseholdId'
      | 'getHouseholdAssistantConfig'
    >

    registerConfiguredPurchaseTopicIngestion(
      bot,
      householdConfigurationRepository as unknown as HouseholdConfigurationRepository,
      repository,
      {
        interpreter: async () => ({
          decision: 'purchase',
          amountMinor: 1000n,
          currency: 'GEL',
          itemDescription: 'жига большая и 2 ножика маленьких',
          confidence: 91,
          parserMode: 'llm',
          clarificationQuestion: null
        }),
        topicProcessor: async () => ({
          route: 'silent',
          reason: 'missed_short_lari'
        })
      }
    )

    await bot.handleUpdate(
      purchaseUpdate('Купила жигу большую и 2 ножика маленьких 10 лар') as never
    )

    expect(saveCalls).toBe(1)
    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({
      method: 'sendChatAction'
    })
    expect(calls[1]).toMatchObject({
      method: 'sendMessage',
      payload: {
        text: expect.stringContaining(
          'I think this shared purchase was: жига большая и 2 ножика маленьких - 10.00 GEL.'
        )
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
          parserMode: 'llm' as const,
          participants: participants()
        }
      },
      async saveWithInterpretation() {
        throw new Error('not implemented')
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
        text: `Purchase confirmed: toilet paper - 30.00 GEL

Participants:
- Mia
- Dima (excluded)`,
        reply_markup: {
          inline_keyboard: []
        }
      }
    })
  })

  test('allows the reported buyer to confirm a third-person purchase proposal', async () => {
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
      async confirm(purchaseMessageId, actorTelegramUserId) {
        expect(purchaseMessageId).toBe('proposal-1')
        expect(actorTelegramUserId).toBe('20002')

        return {
          status: 'confirmed' as const,
          purchaseMessageId: 'proposal-1',
          householdId: config.householdId,
          parsedAmountMinor: 3900n,
          parsedCurrency: 'GEL' as const,
          parsedItemDescription: 'швабра',
          payerMemberId: 'member-2',
          payerDisplayName: 'Dima',
          parserConfidence: 92,
          parserMode: 'llm' as const,
          participants: participants()
        }
      },
      async saveWithInterpretation() {
        throw new Error('not implemented')
      },
      async cancel() {
        throw new Error('not used')
      },
      async toggleParticipant() {
        throw new Error('not used')
      }
    }

    registerPurchaseTopicIngestion(bot, config, repository)
    await bot.handleUpdate(callbackUpdate('purchase:confirm:proposal-1', 20002) as never)

    expect(calls[0]).toMatchObject({
      method: 'answerCallbackQuery',
      payload: {
        text: 'Purchase confirmed.'
      }
    })
  })

  test('requests amount correction for calculated purchase proposals', async () => {
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
      async saveWithInterpretation() {
        throw new Error('not implemented')
      },
      async cancel() {
        throw new Error('not used')
      },
      async toggleParticipant() {
        throw new Error('not used')
      },
      async requestAmountCorrection() {
        return {
          status: 'requested',
          purchaseMessageId: 'proposal-1',
          householdId: config.householdId
        }
      }
    }

    registerPurchaseTopicIngestion(bot, config, repository)
    await bot.handleUpdate(callbackUpdate('purchase:fix_amount:proposal-1') as never)

    expect(calls).toHaveLength(2)
    expect(calls[1]).toMatchObject({
      method: 'editMessageText',
      payload: {
        text: 'Reply with the corrected total and currency in this topic, and I will re-check the purchase.',
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
          parserMode: 'llm' as const,
          participants: participants()
        }
      },
      async saveWithInterpretation() {
        throw new Error('not implemented')
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
        text: `Purchase confirmed: toilet paper - 30.00 GEL

Participants:
- Mia
- Dima (excluded)`
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
      async saveWithInterpretation() {
        throw new Error('not implemented')
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
          parserMode: 'llm' as const,
          participants: participants()
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
