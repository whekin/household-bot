import { describe, expect, test } from 'bun:test'

import { instantFromIso } from '@household/domain'
import { createTelegramBot } from './bot'

import {
  buildPurchaseAcknowledgement,
  registerPurchaseTopicCallbacks,
  canConfirmActivePurchaseProposal,
  explicitPurchaseParticipantMemberIds,
  finalizePayerDecision,
  resolvePurchasePayer,
  resolveProposalParticipantSelection,
  resolveConfiguredPurchaseTopicRecord,
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
  test('ignores explicit away participants when active members are available', () => {
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
        included: false
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

  test('does not include away members when no active purchase participants exist', () => {
    const participants = resolveProposalParticipantSelection({
      members: [
        {
          memberId: 'member-away',
          telegramUserId: '10002',
          lifecycleStatus: 'away'
        },
        {
          memberId: 'member-other-away',
          telegramUserId: '10003',
          lifecycleStatus: 'away'
        }
      ],
      senderTelegramUserId: '10002',
      senderMemberId: 'member-away',
      explicitParticipantMemberIds: null
    })

    expect(participants).toEqual([
      {
        memberId: 'member-away',
        included: false
      },
      {
        memberId: 'member-other-away',
        included: false
      }
    ])
  })
})

describe('resolvePurchasePayer', () => {
  test('does not resolve an away sender as payer while active members are available', () => {
    const resolution = resolvePurchasePayer({
      rawText: 'купил хлеб 10 лари',
      senderMemberId: 'member-away',
      members: [
        {
          memberId: 'member-active',
          displayName: 'Mia',
          status: 'active'
        },
        {
          memberId: 'member-away',
          displayName: 'Dima',
          status: 'away'
        }
      ]
    })

    expect(resolution).toEqual({
      status: 'ambiguous',
      payerMemberId: null,
      payerCandidateMemberIds: ['member-active']
    })
  })

  test('does not resolve active sender when text names an away payer', () => {
    const resolution = resolvePurchasePayer({
      rawText: 'Dima bought bread 10 GEL',
      senderMemberId: 'member-active',
      members: [
        {
          memberId: 'member-active',
          displayName: 'Mia',
          status: 'active'
        },
        {
          memberId: 'member-away',
          displayName: 'Dima',
          status: 'away'
        }
      ]
    })

    expect(resolution).toEqual({
      status: 'ambiguous',
      payerMemberId: null,
      payerCandidateMemberIds: ['member-active']
    })
  })

  test('does not resolve an away payer when no active payer candidates exist', () => {
    const resolution = resolvePurchasePayer({
      rawText: 'купил хлеб 10 лари',
      senderMemberId: 'member-away',
      members: [
        {
          memberId: 'member-away',
          displayName: 'Dima',
          status: 'away'
        },
        {
          memberId: 'member-other-away',
          displayName: 'Mia',
          status: 'away'
        }
      ]
    })

    expect(resolution).toEqual({
      status: 'ambiguous',
      payerMemberId: null,
      payerCandidateMemberIds: []
    })
  })
})

describe('finalizePayerDecision', () => {
  test('turns interpreter-provided inactive payers into payer clarification', () => {
    const decision: Parameters<typeof finalizePayerDecision>[0]['decision'] = {
      status: 'pending_confirmation',
      parsedAmountMinor: 1000n,
      parsedCurrency: 'GEL',
      parsedItemDescription: 'bread',
      payerMemberId: 'member-away',
      payerCandidateMemberIds: null,
      amountSource: 'explicit',
      calculationExplanation: null,
      participantMemberIds: null,
      parserConfidence: 95,
      parserMode: 'llm',
      clarificationQuestion: null,
      parserError: null,
      needsReview: false
    }

    expect(
      finalizePayerDecision({
        decision,
        rawText: 'Dima bought bread 10 GEL',
        senderMemberId: 'member-active',
        householdMembers: [
          {
            memberId: 'member-active',
            displayName: 'Mia',
            status: 'active'
          },
          {
            memberId: 'member-away',
            displayName: 'Dima',
            status: 'away'
          }
        ]
      })
    ).toEqual({
      ...decision,
      status: 'clarification_needed',
      payerMemberId: null,
      payerCandidateMemberIds: ['member-active'],
      needsReview: true
    })
  })

  test('does not attach payer buttons before incomplete inactive-payer parses are complete', () => {
    const decision: Parameters<typeof finalizePayerDecision>[0]['decision'] = {
      status: 'clarification_needed',
      parsedAmountMinor: null,
      parsedCurrency: null,
      parsedItemDescription: 'bread',
      payerMemberId: 'member-away',
      payerCandidateMemberIds: null,
      amountSource: null,
      calculationExplanation: null,
      participantMemberIds: null,
      parserConfidence: 80,
      parserMode: 'llm',
      clarificationQuestion: 'How much did the bread cost?',
      parserError: null,
      needsReview: true
    }

    expect(
      finalizePayerDecision({
        decision,
        rawText: 'Dima bought bread',
        senderMemberId: 'member-active',
        householdMembers: [
          {
            memberId: 'member-active',
            displayName: 'Mia',
            status: 'active'
          },
          {
            memberId: 'member-away',
            displayName: 'Dima',
            status: 'away'
          }
        ]
      })
    ).toEqual({
      ...decision,
      payerMemberId: null,
      payerCandidateMemberIds: null,
      needsReview: true
    })
  })
})

describe('canConfirmActivePurchaseProposal', () => {
  const members = [
    {
      memberId: 'member-active',
      status: 'active' as const
    },
    {
      memberId: 'member-away',
      status: 'away' as const
    }
  ]

  test('allows confirmation only when payer and included participants are still active', () => {
    expect(
      canConfirmActivePurchaseProposal({
        payerMemberId: 'member-active',
        participants: [
          {
            memberId: 'member-active',
            included: true
          },
          {
            memberId: 'member-away',
            included: false
          }
        ],
        members
      })
    ).toBe(true)
  })

  test('rejects stale confirmation when payer or included participant is inactive', () => {
    expect(
      canConfirmActivePurchaseProposal({
        payerMemberId: 'member-away',
        participants: [
          {
            memberId: 'member-active',
            included: true
          }
        ],
        members
      })
    ).toBe(false)
    expect(
      canConfirmActivePurchaseProposal({
        payerMemberId: 'member-active',
        participants: [
          {
            memberId: 'member-away',
            included: true
          }
        ],
        members
      })
    ).toBe(false)
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

describe('registerPurchaseTopicCallbacks', () => {
  function createHouseholdRepositoryForPurchases() {
    return {
      findHouseholdTopicByTelegramContext: async () => ({
        householdId: config.householdId,
        role: 'purchase' as const,
        telegramThreadId: '777',
        topicName: 'Покупки'
      }),
      getHouseholdChatByHouseholdId: async () => ({
        householdId: config.householdId,
        householdName: 'Test',
        telegramChatId: config.householdChatId,
        telegramChatType: 'supergroup',
        title: 'Test',
        defaultLocale: 'ru' as const
      })
    } as never
  }

  function createRepositoryFake() {
    const saved: Array<{ rawText: string; decision: string }> = []
    const confirmed: string[] = []

    const repository = {
      saved,
      confirmed,
      hasClarificationContext: async () => false,
      saveWithInterpretation: async (
        record: { rawText: string },
        interpretation: { decision: string; clarificationQuestion: string | null }
      ) => {
        saved.push({ rawText: record.rawText, decision: interpretation.decision })
        return {
          status: 'clarification_needed' as const,
          purchaseMessageId: 'pm-1',
          clarificationQuestion: interpretation.clarificationQuestion,
          parsedAmountMinor: null,
          parsedCurrency: null,
          parsedItemDescription: null,
          payerMemberId: null,
          payerDisplayName: null,
          amountSource: null,
          calculationExplanation: null,
          parserConfidence: null,
          parserMode: 'llm' as const
        }
      },
      confirm: async (purchaseMessageId: string) => {
        confirmed.push(purchaseMessageId)
        return {
          status: 'confirmed' as const,
          purchaseMessageId,
          householdId: config.householdId,
          participants: [],
          parsedAmountMinor: 3000n,
          parsedCurrency: 'GEL' as const,
          parsedItemDescription: 'toilet paper',
          payerMemberId: null,
          payerDisplayName: null,
          amountSource: 'explicit' as const,
          calculationExplanation: null,
          parserConfidence: 95,
          parserMode: 'llm' as const
        }
      },
      cancel: async () => ({ status: 'not_found' as const }),
      toggleParticipant: async () => ({ status: 'not_found' as const })
    }

    return repository
  }

  function captureCalls(bot: ReturnType<typeof createTestBot>) {
    const calls: Array<{ method: string; payload: unknown }> = []
    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })
      return {
        ok: true,
        result: {
          message_id: calls.length + 100,
          date: Math.floor(Date.now() / 1000),
          chat: { id: Number(config.householdChatId), type: 'supergroup' },
          text: 'ok'
        }
      } as never
    })
    return calls
  }

  test('asks for details on photo-only purchase messages', async () => {
    const bot = createTestBot()
    const calls = captureCalls(bot)
    const repository = createRepositoryFake()

    registerPurchaseTopicCallbacks(
      bot,
      createHouseholdRepositoryForPurchases(),
      repository as never
    )

    await bot.handleUpdate(purchaseUpdate('', { asPhotoOnly: true }) as never)

    expect(repository.saved).toHaveLength(1)
    expect(repository.saved[0]?.rawText).toBe('[photo]')
    const reply = calls.find((call) => call.method === 'sendMessage')
    expect(reply).toBeDefined()
  })

  test('passes plain text messages through without saving', async () => {
    const bot = createTestBot()
    const calls = captureCalls(bot)
    const repository = createRepositoryFake()
    let reachedNext = false

    registerPurchaseTopicCallbacks(
      bot,
      createHouseholdRepositoryForPurchases(),
      repository as never
    )
    bot.on('message', async () => {
      reachedNext = true
    })

    await bot.handleUpdate(purchaseUpdate('купил хлеб 3 лари') as never)

    expect(repository.saved).toHaveLength(0)
    expect(reachedNext).toBe(true)
    expect(calls.find((call) => call.method === 'sendMessage')).toBeUndefined()
  })

  test('confirm callback flows through the repository', async () => {
    const bot = createTestBot()
    captureCalls(bot)
    const repository = createRepositoryFake()

    registerPurchaseTopicCallbacks(
      bot,
      createHouseholdRepositoryForPurchases(),
      repository as never
    )

    await bot.handleUpdate(callbackUpdate('purchase:confirm:pm-1') as never)

    expect(repository.confirmed).toEqual(['pm-1'])
  })
})
