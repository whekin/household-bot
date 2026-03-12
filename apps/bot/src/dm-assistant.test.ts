import { describe, expect, test } from 'bun:test'

import type { FinanceCommandService } from '@household/application'
import { Money } from '@household/domain'
import type {
  HouseholdConfigurationRepository,
  ProcessedBotMessageRepository,
  TelegramPendingActionRecord,
  TelegramPendingActionRepository,
  TopicMessageHistoryRecord,
  TopicMessageHistoryRepository
} from '@household/ports'

import { createTelegramBot } from './bot'
import {
  createInMemoryAssistantConversationMemoryStore,
  createInMemoryAssistantRateLimiter,
  createInMemoryAssistantUsageTracker,
  registerDmAssistant
} from './dm-assistant'
import {
  registerConfiguredPurchaseTopicIngestion,
  type PurchaseMessageIngestionRepository
} from './purchase-topic-ingestion'

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

function privateMessageUpdate(text: string) {
  return {
    update_id: 2001,
    message: {
      message_id: 55,
      date: Math.floor(Date.now() / 1000),
      chat: {
        id: 123456,
        type: 'private'
      },
      from: {
        id: 123456,
        is_bot: false,
        first_name: 'Stan',
        language_code: 'en'
      },
      text
    }
  }
}

function topicMessageUpdate(
  text: string,
  options?: {
    replyToBot?: boolean
    fromId?: number
    firstName?: string
    updateId?: number
  }
) {
  return {
    update_id: options?.updateId ?? 3001,
    message: {
      message_id: 88,
      date: Math.floor(Date.now() / 1000),
      message_thread_id: 777,
      is_topic_message: true,
      chat: {
        id: -100123,
        type: 'supergroup'
      },
      from: {
        id: options?.fromId ?? 123456,
        is_bot: false,
        first_name: options?.firstName ?? 'Stan',
        language_code: 'en'
      },
      text,
      ...(options?.replyToBot
        ? {
            reply_to_message: {
              message_id: 87,
              date: Math.floor(Date.now() / 1000),
              chat: {
                id: -100123,
                type: 'supergroup'
              },
              from: {
                id: 999000,
                is_bot: true,
                first_name: 'Household Test Bot',
                username: 'household_test_bot'
              },
              text: 'previous bot reply'
            }
          }
        : {})
    }
  }
}

function topicMentionUpdate(text: string) {
  return topicMessageUpdate(text)
}

function privateCallbackUpdate(data: string) {
  return {
    update_id: 2002,
    callback_query: {
      id: 'callback-1',
      from: {
        id: 123456,
        is_bot: false,
        first_name: 'Stan',
        language_code: 'en'
      },
      chat_instance: 'instance-1',
      data,
      message: {
        message_id: 77,
        date: Math.floor(Date.now() / 1000),
        chat: {
          id: 123456,
          type: 'private'
        },
        text: 'placeholder'
      }
    }
  }
}

function createHouseholdRepository(): HouseholdConfigurationRepository {
  const household = {
    householdId: 'household-1',
    householdName: 'Kojori House',
    telegramChatId: '-100123',
    telegramChatType: 'supergroup',
    title: 'Kojori House',
    defaultLocale: 'en' as const
  }

  return {
    registerTelegramHouseholdChat: async () => ({
      status: 'existing',
      household
    }),
    getTelegramHouseholdChat: async () => household,
    getHouseholdChatByHouseholdId: async () => household,
    bindHouseholdTopic: async () => {
      throw new Error('not used')
    },
    getHouseholdTopicBinding: async () => null,
    findHouseholdTopicByTelegramContext: async () => null,
    listHouseholdTopicBindings: async () => [],
    clearHouseholdTopicBindings: async () => {},
    listReminderTargets: async () => [],
    upsertHouseholdJoinToken: async () => {
      throw new Error('not used')
    },
    getHouseholdJoinToken: async () => null,
    getHouseholdByJoinToken: async () => null,
    upsertPendingHouseholdMember: async () => {
      throw new Error('not used')
    },
    getPendingHouseholdMember: async () => null,
    findPendingHouseholdMemberByTelegramUserId: async () => null,
    ensureHouseholdMember: async () => {
      throw new Error('not used')
    },
    getHouseholdMember: async () => ({
      id: 'member-1',
      householdId: 'household-1',
      telegramUserId: '123456',
      displayName: 'Stan',
      status: 'active',
      preferredLocale: null,
      householdDefaultLocale: 'en',
      rentShareWeight: 1,
      isAdmin: true
    }),
    listHouseholdMembers: async () => [
      {
        id: 'member-1',
        householdId: 'household-1',
        telegramUserId: '123456',
        displayName: 'Stan',
        status: 'active',
        preferredLocale: null,
        householdDefaultLocale: 'en',
        rentShareWeight: 1,
        isAdmin: true
      },
      {
        id: 'member-2',
        householdId: 'household-1',
        telegramUserId: '222222',
        displayName: 'Dima',
        status: 'active',
        preferredLocale: null,
        householdDefaultLocale: 'en',
        rentShareWeight: 1,
        isAdmin: false
      },
      {
        id: 'member-3',
        householdId: 'household-1',
        telegramUserId: '333333',
        displayName: 'Chorbanaut',
        status: 'away',
        preferredLocale: null,
        householdDefaultLocale: 'en',
        rentShareWeight: 1,
        isAdmin: false
      }
    ],
    getHouseholdBillingSettings: async () => ({
      householdId: 'household-1',
      settlementCurrency: 'GEL',
      rentAmountMinor: 70000n,
      rentCurrency: 'USD',
      rentDueDay: 20,
      rentWarningDay: 17,
      utilitiesDueDay: 4,
      utilitiesReminderDay: 3,
      timezone: 'Asia/Tbilisi'
    }),
    updateHouseholdBillingSettings: async () => {
      throw new Error('not used')
    },
    listHouseholdUtilityCategories: async () => [],
    upsertHouseholdUtilityCategory: async () => {
      throw new Error('not used')
    },
    listHouseholdMembersByTelegramUserId: async () => [
      {
        id: 'member-1',
        householdId: 'household-1',
        telegramUserId: '123456',
        displayName: 'Stan',
        status: 'active',
        preferredLocale: null,
        householdDefaultLocale: 'en',
        rentShareWeight: 1,
        isAdmin: true
      }
    ],
    listPendingHouseholdMembers: async () => [],
    approvePendingHouseholdMember: async () => null,
    updateHouseholdDefaultLocale: async () => household,
    updateMemberPreferredLocale: async () => null,
    updateHouseholdMemberDisplayName: async () => null,
    promoteHouseholdAdmin: async () => null,
    updateHouseholdMemberRentShareWeight: async () => null,
    updateHouseholdMemberStatus: async () => null,
    listHouseholdMemberAbsencePolicies: async () => [],
    upsertHouseholdMemberAbsencePolicy: async () => null
  }
}

function createBoundHouseholdRepository(
  role: 'purchase' | 'payments'
): HouseholdConfigurationRepository {
  const repository = createHouseholdRepository()

  return {
    ...repository,
    findHouseholdTopicByTelegramContext: async () => ({
      householdId: 'household-1',
      role,
      telegramThreadId: '777',
      topicName: role === 'purchase' ? 'Purchases' : 'Payments'
    })
  }
}

function createFinanceService(): FinanceCommandService {
  return {
    getMemberByTelegramUserId: async () => ({
      id: 'member-1',
      telegramUserId: '123456',
      displayName: 'Stan',
      rentShareWeight: 1,
      isAdmin: true
    }),
    getOpenCycle: async () => null,
    ensureExpectedCycle: async () => ({
      id: 'cycle-1',
      period: '2026-03',
      currency: 'GEL'
    }),
    getAdminCycleState: async () => ({
      cycle: null,
      rentRule: null,
      utilityBills: []
    }),
    openCycle: async () => ({
      id: 'cycle-1',
      period: '2026-03',
      currency: 'GEL'
    }),
    closeCycle: async () => null,
    setRent: async () => null,
    addUtilityBill: async () => null,
    updateUtilityBill: async () => null,
    deleteUtilityBill: async () => false,
    updatePurchase: async () => null,
    deletePurchase: async () => false,
    addPayment: async (_memberId, kind, amountArg, currencyArg) => ({
      paymentId: 'payment-1',
      amount: {
        amountMinor: (BigInt(amountArg.replace('.', '')) * 100n) / 100n,
        currency: (currencyArg ?? 'GEL') as 'GEL' | 'USD',
        toMajorString: () => amountArg
      } as never,
      currency: (currencyArg ?? 'GEL') as 'GEL' | 'USD',
      period: '2026-03'
    }),
    updatePayment: async () => null,
    deletePayment: async () => false,
    generateDashboard: async () => ({
      period: '2026-03',
      currency: 'GEL',
      timezone: 'Asia/Tbilisi',
      rentDueDay: 20,
      utilitiesDueDay: 4,
      paymentBalanceAdjustmentPolicy: 'utilities',
      totalDue: Money.fromMajor('1000.00', 'GEL'),
      totalPaid: Money.fromMajor('500.00', 'GEL'),
      totalRemaining: Money.fromMajor('500.00', 'GEL'),
      rentSourceAmount: Money.fromMajor('700.00', 'USD'),
      rentDisplayAmount: Money.fromMajor('1890.00', 'GEL'),
      rentFxRateMicros: null,
      rentFxEffectiveDate: null,
      members: [
        {
          memberId: 'member-1',
          displayName: 'Stan',
          rentShare: Money.fromMajor('700.00', 'GEL'),
          utilityShare: Money.fromMajor('100.00', 'GEL'),
          purchaseOffset: Money.fromMajor('50.00', 'GEL'),
          netDue: Money.fromMajor('850.00', 'GEL'),
          paid: Money.fromMajor('500.00', 'GEL'),
          remaining: Money.fromMajor('350.00', 'GEL'),
          explanations: []
        },
        {
          memberId: 'member-2',
          displayName: 'Dima',
          rentShare: Money.fromMajor('700.00', 'GEL'),
          utilityShare: Money.fromMajor('100.00', 'GEL'),
          purchaseOffset: Money.fromMajor('15.00', 'GEL'),
          netDue: Money.fromMajor('815.00', 'GEL'),
          paid: Money.fromMajor('200.00', 'GEL'),
          remaining: Money.fromMajor('615.00', 'GEL'),
          explanations: []
        },
        {
          memberId: 'member-3',
          displayName: 'Chorbanaut',
          rentShare: Money.fromMajor('700.00', 'GEL'),
          utilityShare: Money.fromMajor('0.00', 'GEL'),
          purchaseOffset: Money.fromMajor('-20.00', 'GEL'),
          netDue: Money.fromMajor('680.00', 'GEL'),
          paid: Money.fromMajor('100.00', 'GEL'),
          remaining: Money.fromMajor('580.00', 'GEL'),
          explanations: []
        }
      ],
      ledger: [
        {
          id: 'purchase-1',
          kind: 'purchase' as const,
          title: 'Soap',
          memberId: 'member-1',
          amount: Money.fromMajor('30.00', 'GEL'),
          currency: 'GEL' as const,
          displayAmount: Money.fromMajor('30.00', 'GEL'),
          displayCurrency: 'GEL' as const,
          fxRateMicros: null,
          fxEffectiveDate: null,
          actorDisplayName: 'Stan',
          occurredAt: '2026-03-12T11:00:00.000Z',
          paymentKind: null
        }
      ]
    }),
    generateStatement: async () => null
  }
}

function createPromptRepository(): TelegramPendingActionRepository {
  let pending: TelegramPendingActionRecord | null = null

  return {
    async upsertPendingAction(input) {
      pending = input
      return input
    },
    async getPendingAction() {
      return pending
    },
    async clearPendingAction() {
      pending = null
    },
    async clearPendingActionsForChat(telegramChatId, action) {
      if (!pending || pending.telegramChatId !== telegramChatId) {
        return
      }

      if (action && pending.action !== action) {
        return
      }

      pending = null
    }
  }
}

function createPurchaseRepository(): PurchaseMessageIngestionRepository {
  const clarificationKeys = new Set<string>()
  const proposals = new Map<
    string,
    {
      householdId: string
      senderTelegramUserId: string
      parsedAmountMinor: bigint
      parsedCurrency: 'GEL' | 'USD'
      parsedItemDescription: string
      participants: readonly {
        id: string
        memberId: string
        displayName: string
        included: boolean
      }[]
      status: 'pending_confirmation' | 'confirmed' | 'cancelled'
    }
  >()

  function key(input: { householdId: string; senderTelegramUserId: string; threadId: string }) {
    return `${input.householdId}:${input.senderTelegramUserId}:${input.threadId}`
  }

  return {
    async hasClarificationContext(record) {
      return clarificationKeys.has(key(record))
    },
    async save(record) {
      const threadKey = key(record)

      if (record.rawText === 'I bought a door handle for 30 lari') {
        proposals.set('purchase-1', {
          householdId: record.householdId,
          senderTelegramUserId: record.senderTelegramUserId,
          parsedAmountMinor: 3000n,
          parsedCurrency: 'GEL',
          parsedItemDescription: 'door handle',
          participants: [
            {
              id: 'participant-1',
              memberId: 'member-1',
              displayName: 'Mia',
              included: true
            }
          ],
          status: 'pending_confirmation'
        })

        return {
          status: 'pending_confirmation' as const,
          purchaseMessageId: 'purchase-1',
          parsedAmountMinor: 3000n,
          parsedCurrency: 'GEL' as const,
          parsedItemDescription: 'door handle',
          parserConfidence: 92,
          parserMode: 'llm' as const,
          participants: [
            {
              id: 'participant-1',
              memberId: 'member-1',
              displayName: 'Mia',
              included: true
            }
          ]
        }
      }

      if (record.rawText === 'I bought sausages, paid 45') {
        clarificationKeys.add(threadKey)
        return {
          status: 'clarification_needed' as const,
          purchaseMessageId: 'purchase-clarification-1',
          clarificationQuestion: 'Which currency was this purchase in?',
          parsedAmountMinor: 4500n,
          parsedCurrency: null,
          parsedItemDescription: 'sausages',
          parserConfidence: 61,
          parserMode: 'llm' as const
        }
      }

      if (record.rawText === 'lari' && clarificationKeys.has(threadKey)) {
        clarificationKeys.delete(threadKey)
        proposals.set('purchase-2', {
          householdId: record.householdId,
          senderTelegramUserId: record.senderTelegramUserId,
          parsedAmountMinor: 4500n,
          parsedCurrency: 'GEL',
          parsedItemDescription: 'sausages',
          participants: [
            {
              id: 'participant-1',
              memberId: 'member-1',
              displayName: 'Mia',
              included: true
            }
          ],
          status: 'pending_confirmation'
        })

        return {
          status: 'pending_confirmation' as const,
          purchaseMessageId: 'purchase-2',
          parsedAmountMinor: 4500n,
          parsedCurrency: 'GEL' as const,
          parsedItemDescription: 'sausages',
          parserConfidence: 88,
          parserMode: 'llm' as const,
          participants: [
            {
              id: 'participant-1',
              memberId: 'member-1',
              displayName: 'Mia',
              included: true
            }
          ]
        }
      }

      return {
        status: 'ignored_not_purchase' as const,
        purchaseMessageId: `ignored-${record.messageId}`
      }
    },
    async confirm(purchaseMessageId, actorTelegramUserId) {
      const proposal = proposals.get(purchaseMessageId)
      if (!proposal) {
        return {
          status: 'not_found' as const
        }
      }

      if (proposal.senderTelegramUserId !== actorTelegramUserId) {
        return {
          status: 'forbidden' as const,
          householdId: proposal.householdId
        }
      }

      if (proposal.status === 'confirmed') {
        return {
          status: 'already_confirmed' as const,
          purchaseMessageId,
          householdId: proposal.householdId,
          parsedAmountMinor: proposal.parsedAmountMinor,
          parsedCurrency: proposal.parsedCurrency,
          parsedItemDescription: proposal.parsedItemDescription,
          parserConfidence: 92,
          parserMode: 'llm' as const,
          participants: proposal.participants
        }
      }

      if (proposal.status !== 'pending_confirmation') {
        return {
          status: 'not_pending' as const,
          householdId: proposal.householdId
        }
      }

      proposal.status = 'confirmed'
      return {
        status: 'confirmed' as const,
        purchaseMessageId,
        householdId: proposal.householdId,
        parsedAmountMinor: proposal.parsedAmountMinor,
        parsedCurrency: proposal.parsedCurrency,
        parsedItemDescription: proposal.parsedItemDescription,
        parserConfidence: 92,
        parserMode: 'llm' as const,
        participants: proposal.participants
      }
    },
    async cancel(purchaseMessageId, actorTelegramUserId) {
      const proposal = proposals.get(purchaseMessageId)
      if (!proposal) {
        return {
          status: 'not_found' as const
        }
      }

      if (proposal.senderTelegramUserId !== actorTelegramUserId) {
        return {
          status: 'forbidden' as const,
          householdId: proposal.householdId
        }
      }

      if (proposal.status === 'cancelled') {
        return {
          status: 'already_cancelled' as const,
          purchaseMessageId,
          householdId: proposal.householdId,
          parsedAmountMinor: proposal.parsedAmountMinor,
          parsedCurrency: proposal.parsedCurrency,
          parsedItemDescription: proposal.parsedItemDescription,
          parserConfidence: 92,
          parserMode: 'llm' as const,
          participants: proposal.participants
        }
      }

      if (proposal.status !== 'pending_confirmation') {
        return {
          status: 'not_pending' as const,
          householdId: proposal.householdId
        }
      }

      proposal.status = 'cancelled'
      return {
        status: 'cancelled' as const,
        purchaseMessageId,
        householdId: proposal.householdId,
        parsedAmountMinor: proposal.parsedAmountMinor,
        parsedCurrency: proposal.parsedCurrency,
        parsedItemDescription: proposal.parsedItemDescription,
        parserConfidence: 92,
        parserMode: 'llm' as const,
        participants: proposal.participants
      }
    },
    async toggleParticipant() {
      throw new Error('not used')
    }
  }
}

function createProcessedBotMessageRepository(): ProcessedBotMessageRepository {
  const claims = new Set<string>()

  return {
    async claimMessage(input) {
      const key = `${input.householdId}:${input.source}:${input.sourceMessageKey}`
      if (claims.has(key)) {
        return {
          claimed: false
        }
      }

      claims.add(key)

      return {
        claimed: true
      }
    },
    async releaseMessage(input) {
      claims.delete(`${input.householdId}:${input.source}:${input.sourceMessageKey}`)
    }
  }
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

describe('registerDmAssistant', () => {
  test('replies with a conversational DM answer and records token usage', async () => {
    const bot = createTestBot()
    const calls: Array<{ method: string; payload: unknown }> = []
    const usageTracker = createInMemoryAssistantUsageTracker()

    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })

      if (method === 'sendMessage') {
        return {
          ok: true,
          result: {
            message_id: calls.length,
            date: Math.floor(Date.now() / 1000),
            chat: {
              id: 123456,
              type: 'private'
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

    registerDmAssistant({
      bot,
      assistant: {
        async respond() {
          return {
            text: 'You still owe 350.00 GEL this cycle.',
            usage: {
              inputTokens: 100,
              outputTokens: 25,
              totalTokens: 125
            }
          }
        }
      },
      householdConfigurationRepository: createHouseholdRepository(),
      promptRepository: createPromptRepository(),
      financeServiceForHousehold: () => createFinanceService(),
      memoryStore: createInMemoryAssistantConversationMemoryStore(12),
      rateLimiter: createInMemoryAssistantRateLimiter({
        burstLimit: 5,
        burstWindowMs: 60_000,
        rollingLimit: 50,
        rollingWindowMs: 86_400_000
      }),
      usageTracker
    })

    await bot.handleUpdate(privateMessageUpdate('How much do I still owe this month?') as never)

    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({
      method: 'sendChatAction',
      payload: {
        chat_id: 123456,
        action: 'typing'
      }
    })
    expect(calls[1]).toMatchObject({
      method: 'sendMessage',
      payload: {
        chat_id: 123456,
        text: 'You still owe 350.00 GEL this cycle.'
      }
    })
    expect(usageTracker.listHouseholdUsage('household-1')).toEqual([
      {
        householdId: 'household-1',
        telegramUserId: '123456',
        displayName: 'Stan',
        requestCount: 1,
        inputTokens: 100,
        outputTokens: 25,
        totalTokens: 125,
        updatedAt: expect.any(String)
      }
    ])
  })

  test('creates a payment confirmation proposal in DM', async () => {
    const bot = createTestBot()
    const calls: Array<{ method: string; payload: unknown }> = []
    const promptRepository = createPromptRepository()

    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })
      return {
        ok: true,
        result: true
      } as never
    })

    registerDmAssistant({
      bot,
      householdConfigurationRepository: createHouseholdRepository(),
      promptRepository,
      financeServiceForHousehold: () => createFinanceService(),
      memoryStore: createInMemoryAssistantConversationMemoryStore(12),
      rateLimiter: createInMemoryAssistantRateLimiter({
        burstLimit: 5,
        burstWindowMs: 60_000,
        rollingLimit: 50,
        rollingWindowMs: 86_400_000
      }),
      usageTracker: createInMemoryAssistantUsageTracker()
    })

    await bot.handleUpdate(privateMessageUpdate('I paid the rent') as never)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.payload).toMatchObject({
      text: expect.stringContaining('I can record this rent payment: 700.00 GEL.'),
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: 'Confirm payment',
              callback_data: expect.stringContaining('assistant_payment:confirm:')
            },
            {
              text: 'Cancel',
              callback_data: expect.stringContaining('assistant_payment:cancel:')
            }
          ]
        ]
      }
    })

    const pending = await promptRepository.getPendingAction('123456', '123456')
    expect(pending?.action).toBe('assistant_payment_confirmation')
    expect(pending?.payload).toMatchObject({
      householdId: 'household-1',
      memberId: 'member-1',
      kind: 'rent',
      amountMinor: '70000',
      currency: 'GEL'
    })
  })

  test('answers utilities balance questions deterministically in DM', async () => {
    const bot = createTestBot()
    const calls: Array<{ method: string; payload: unknown }> = []

    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })
      return {
        ok: true,
        result: true
      } as never
    })

    registerDmAssistant({
      bot,
      householdConfigurationRepository: createHouseholdRepository(),
      promptRepository: createPromptRepository(),
      financeServiceForHousehold: () => createFinanceService(),
      memoryStore: createInMemoryAssistantConversationMemoryStore(12),
      rateLimiter: createInMemoryAssistantRateLimiter({
        burstLimit: 5,
        burstWindowMs: 60_000,
        rollingLimit: 50,
        rollingWindowMs: 86_400_000
      }),
      usageTracker: createInMemoryAssistantUsageTracker()
    })

    await bot.handleUpdate(privateMessageUpdate('How much do I owe for utilities?') as never)

    const replyCall = calls.find((call) => call.method === 'sendMessage')
    expect(replyCall).toBeDefined()
    const replyText = String((replyCall?.payload as { text?: unknown } | undefined)?.text ?? '')
    expect(replyText).toContain('Current utilities payment guidance:')
    expect(replyText).toContain('Utilities due: 100.00 GEL')
    expect(replyText).toContain('Purchase balance: 50.00 GEL')
    expect(replyText).toContain('Suggested payment under utilities adjustment: 150.00 GEL')
  })

  test('answers household roster questions from real member data', async () => {
    const bot = createTestBot()
    const calls: Array<{ method: string; payload: unknown }> = []

    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })
      return {
        ok: true,
        result: true
      } as never
    })

    registerDmAssistant({
      bot,
      householdConfigurationRepository: createHouseholdRepository(),
      promptRepository: createPromptRepository(),
      financeServiceForHousehold: () => createFinanceService(),
      memoryStore: createInMemoryAssistantConversationMemoryStore(12),
      rateLimiter: createInMemoryAssistantRateLimiter({
        burstLimit: 5,
        burstWindowMs: 60_000,
        rollingLimit: 50,
        rollingWindowMs: 86_400_000
      }),
      usageTracker: createInMemoryAssistantUsageTracker()
    })

    await bot.handleUpdate(privateMessageUpdate('Who do we have in the household?') as never)

    const replyText = String(
      (
        calls.find((call) => call.method === 'sendMessage')?.payload as
          | { text?: unknown }
          | undefined
      )?.text ?? ''
    )
    expect(replyText).toContain('Current household members:')
    expect(replyText).toContain('Stan (active)')
    expect(replyText).toContain('Dima (active)')
    expect(replyText).toContain('Chorbanaut (away)')
  })

  test('answers another member purchase balance from real data', async () => {
    const bot = createTestBot()
    const calls: Array<{ method: string; payload: unknown }> = []

    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })
      return {
        ok: true,
        result: true
      } as never
    })

    registerDmAssistant({
      bot,
      householdConfigurationRepository: createHouseholdRepository(),
      promptRepository: createPromptRepository(),
      financeServiceForHousehold: () => createFinanceService(),
      memoryStore: createInMemoryAssistantConversationMemoryStore(12),
      rateLimiter: createInMemoryAssistantRateLimiter({
        burstLimit: 5,
        burstWindowMs: 60_000,
        rollingLimit: 50,
        rollingWindowMs: 86_400_000
      }),
      usageTracker: createInMemoryAssistantUsageTracker()
    })

    await bot.handleUpdate(privateMessageUpdate('What is Dima shared purchase balance?') as never)

    const replyText = String(
      (
        calls.find((call) => call.method === 'sendMessage')?.payload as
          | { text?: unknown }
          | undefined
      )?.text ?? ''
    )
    expect(replyText).toContain("Dima's shared purchase balance is 15.00 GEL.")
  })

  test('routes obvious purchase-like DMs into purchase confirmation flow', async () => {
    const bot = createTestBot()
    const calls: Array<{ method: string; payload: unknown }> = []
    let assistantCalls = 0

    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })
      return {
        ok: true,
        result: true
      } as never
    })

    registerDmAssistant({
      bot,
      assistant: {
        async respond() {
          assistantCalls += 1
          return {
            text: 'fallback assistant reply',
            usage: {
              inputTokens: 10,
              outputTokens: 5,
              totalTokens: 15
            }
          }
        }
      },
      purchaseRepository: createPurchaseRepository(),
      householdConfigurationRepository: createHouseholdRepository(),
      promptRepository: createPromptRepository(),
      financeServiceForHousehold: () => createFinanceService(),
      memoryStore: createInMemoryAssistantConversationMemoryStore(12),
      rateLimiter: createInMemoryAssistantRateLimiter({
        burstLimit: 5,
        burstWindowMs: 60_000,
        rollingLimit: 50,
        rollingWindowMs: 86_400_000
      }),
      usageTracker: createInMemoryAssistantUsageTracker()
    })

    await bot.handleUpdate(privateMessageUpdate('I bought a door handle for 30 lari') as never)

    expect(assistantCalls).toBe(0)
    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({
      method: 'sendChatAction',
      payload: {
        chat_id: 123456,
        action: 'typing'
      }
    })
    expect(calls[1]).toMatchObject({
      method: 'sendMessage',
      payload: {
        chat_id: 123456,
        text: `I think this shared purchase was: door handle - 30.00 GEL.
Confirm or cancel below.`,
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: 'Confirm',
                callback_data: 'assistant_purchase:confirm:purchase-1'
              },
              {
                text: 'Cancel',
                callback_data: 'assistant_purchase:cancel:purchase-1'
              }
            ]
          ]
        }
      }
    })
  })

  test('uses clarification context for follow-up purchase replies in DM', async () => {
    const bot = createTestBot()
    const calls: Array<{ method: string; payload: unknown }> = []

    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })
      return {
        ok: true,
        result: true
      } as never
    })

    registerDmAssistant({
      bot,
      purchaseRepository: createPurchaseRepository(),
      householdConfigurationRepository: createHouseholdRepository(),
      promptRepository: createPromptRepository(),
      financeServiceForHousehold: () => createFinanceService(),
      memoryStore: createInMemoryAssistantConversationMemoryStore(12),
      rateLimiter: createInMemoryAssistantRateLimiter({
        burstLimit: 5,
        burstWindowMs: 60_000,
        rollingLimit: 50,
        rollingWindowMs: 86_400_000
      }),
      usageTracker: createInMemoryAssistantUsageTracker()
    })

    await bot.handleUpdate(privateMessageUpdate('I bought sausages, paid 45') as never)
    await bot.handleUpdate(privateMessageUpdate('lari') as never)

    expect(calls).toHaveLength(4)
    expect(calls[1]).toMatchObject({
      method: 'sendMessage',
      payload: {
        chat_id: 123456,
        text: 'Which currency was this purchase in?'
      }
    })
    expect(calls[3]).toMatchObject({
      method: 'sendMessage',
      payload: {
        chat_id: 123456,
        text: `I think this shared purchase was: sausages - 45.00 GEL.
Confirm or cancel below.`,
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: 'Confirm',
                callback_data: 'assistant_purchase:confirm:purchase-2'
              },
              {
                text: 'Cancel',
                callback_data: 'assistant_purchase:cancel:purchase-2'
              }
            ]
          ]
        }
      }
    })
  })

  test('confirms a pending purchase proposal from DM callback', async () => {
    const bot = createTestBot()
    const calls: Array<{ method: string; payload: unknown }> = []
    const purchaseRepository = createPurchaseRepository()

    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })
      return {
        ok: true,
        result: true
      } as never
    })

    registerDmAssistant({
      bot,
      purchaseRepository,
      householdConfigurationRepository: createHouseholdRepository(),
      promptRepository: createPromptRepository(),
      financeServiceForHousehold: () => createFinanceService(),
      memoryStore: createInMemoryAssistantConversationMemoryStore(12),
      rateLimiter: createInMemoryAssistantRateLimiter({
        burstLimit: 5,
        burstWindowMs: 60_000,
        rollingLimit: 50,
        rollingWindowMs: 86_400_000
      }),
      usageTracker: createInMemoryAssistantUsageTracker()
    })

    await bot.handleUpdate(privateMessageUpdate('I bought a door handle for 30 lari') as never)
    calls.length = 0

    await bot.handleUpdate(privateCallbackUpdate('assistant_purchase:confirm:purchase-1') as never)

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
        chat_id: 123456,
        message_id: 77,
        text: 'Purchase confirmed: door handle - 30.00 GEL'
      }
    })
  })

  test('falls back to the generic assistant for non-purchase chatter', async () => {
    const bot = createTestBot()
    const calls: Array<{ method: string; payload: unknown }> = []
    let assistantCalls = 0

    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })

      if (method === 'sendMessage') {
        return {
          ok: true,
          result: {
            message_id: calls.length,
            date: Math.floor(Date.now() / 1000),
            chat: {
              id: 123456,
              type: 'private'
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

    registerDmAssistant({
      bot,
      assistant: {
        async respond() {
          assistantCalls += 1
          return {
            text: 'general fallback reply',
            usage: {
              inputTokens: 22,
              outputTokens: 7,
              totalTokens: 29
            }
          }
        }
      },
      purchaseRepository: createPurchaseRepository(),
      householdConfigurationRepository: createHouseholdRepository(),
      promptRepository: createPromptRepository(),
      financeServiceForHousehold: () => createFinanceService(),
      memoryStore: createInMemoryAssistantConversationMemoryStore(12),
      rateLimiter: createInMemoryAssistantRateLimiter({
        burstLimit: 5,
        burstWindowMs: 60_000,
        rollingLimit: 50,
        rollingWindowMs: 86_400_000
      }),
      usageTracker: createInMemoryAssistantUsageTracker()
    })

    await bot.handleUpdate(privateMessageUpdate('How are you?') as never)

    expect(assistantCalls).toBe(1)
    expect(calls).toHaveLength(2)
    expect(calls[1]).toMatchObject({
      method: 'sendMessage',
      payload: {
        chat_id: 123456,
        text: 'general fallback reply'
      }
    })
  })

  test('replies as the general assistant when explicitly mentioned in a household topic', async () => {
    const bot = createTestBot()
    const calls: Array<{ method: string; payload: unknown }> = []
    let assistantCalls = 0

    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })

      if (method === 'sendMessage') {
        return {
          ok: true,
          result: {
            message_id: calls.length,
            date: Math.floor(Date.now() / 1000),
            chat: {
              id: -100123,
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

    registerDmAssistant({
      bot,
      assistant: {
        async respond(input) {
          assistantCalls += 1
          expect(input.userMessage).toBe('how is life?')
          return {
            text: 'Still standing.',
            usage: {
              inputTokens: 15,
              outputTokens: 4,
              totalTokens: 19
            }
          }
        }
      },
      householdConfigurationRepository: createHouseholdRepository(),
      promptRepository: createPromptRepository(),
      financeServiceForHousehold: () => createFinanceService(),
      memoryStore: createInMemoryAssistantConversationMemoryStore(12),
      rateLimiter: createInMemoryAssistantRateLimiter({
        burstLimit: 5,
        burstWindowMs: 60_000,
        rollingLimit: 50,
        rollingWindowMs: 86_400_000
      }),
      usageTracker: createInMemoryAssistantUsageTracker()
    })

    await bot.handleUpdate(topicMentionUpdate('@household_test_bot how is life?') as never)

    expect(assistantCalls).toBe(1)
    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({
      method: 'sendChatAction',
      payload: {
        chat_id: -100123,
        action: 'typing',
        message_thread_id: 777
      }
    })
    expect(calls[1]).toMatchObject({
      method: 'sendMessage',
      payload: {
        chat_id: -100123,
        message_thread_id: 777,
        text: 'Still standing.'
      }
    })
  })

  test('uses the shared router for playful addressed topic replies without calling the full assistant', async () => {
    const bot = createTestBot()
    const calls: Array<{ method: string; payload: unknown }> = []
    let assistantCalls = 0

    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })

      if (method === 'sendMessage') {
        return {
          ok: true,
          result: {
            message_id: calls.length,
            date: Math.floor(Date.now() / 1000),
            chat: {
              id: -100123,
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

    registerDmAssistant({
      bot,
      assistant: {
        async respond() {
          assistantCalls += 1
          return {
            text: 'Should not be called.',
            usage: {
              inputTokens: 10,
              outputTokens: 2,
              totalTokens: 12
            }
          }
        }
      },
      topicRouter: async () => ({
        route: 'chat_reply',
        replyText: 'Тут. Если что-то реально купили, подключусь.',
        helperKind: null,
        shouldStartTyping: false,
        shouldClearWorkflow: false,
        confidence: 96,
        reason: 'smalltalk'
      }),
      purchaseRepository: createPurchaseRepository(),
      purchaseInterpreter: async () => null,
      householdConfigurationRepository: createHouseholdRepository(),
      promptRepository: createPromptRepository(),
      financeServiceForHousehold: () => createFinanceService(),
      memoryStore: createInMemoryAssistantConversationMemoryStore(12),
      rateLimiter: createInMemoryAssistantRateLimiter({
        burstLimit: 5,
        burstWindowMs: 60_000,
        rollingLimit: 50,
        rollingWindowMs: 86_400_000
      }),
      usageTracker: createInMemoryAssistantUsageTracker()
    })

    await bot.handleUpdate(topicMentionUpdate('@household_test_bot А ты тут?') as never)

    expect(assistantCalls).toBe(0)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      method: 'sendMessage',
      payload: {
        text: 'Тут. Если что-то реально купили, подключусь.'
      }
    })
  })

  test('reuses the purchase-topic route instead of calling the shared router twice', async () => {
    const bot = createTestBot()
    const calls: Array<{ method: string; payload: unknown }> = []
    let assistantCalls = 0
    let routerCalls = 0
    const householdConfigurationRepository = createBoundHouseholdRepository('purchase')
    const topicRouter = async () => {
      routerCalls += 1

      return {
        route: 'topic_helper' as const,
        replyText: null,
        helperKind: 'assistant' as const,
        shouldStartTyping: true,
        shouldClearWorkflow: false,
        confidence: 96,
        reason: 'question'
      }
    }

    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })

      if (method === 'sendMessage') {
        return {
          ok: true,
          result: {
            message_id: calls.length,
            date: Math.floor(Date.now() / 1000),
            chat: {
              id: -100123,
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

    registerConfiguredPurchaseTopicIngestion(
      bot,
      householdConfigurationRepository,
      createPurchaseRepository(),
      {
        router: topicRouter
      }
    )

    registerDmAssistant({
      bot,
      assistant: {
        async respond() {
          assistantCalls += 1
          return {
            text: 'Still here.',
            usage: {
              inputTokens: 10,
              outputTokens: 3,
              totalTokens: 13
            }
          }
        }
      },
      topicRouter,
      purchaseRepository: createPurchaseRepository(),
      purchaseInterpreter: async () => null,
      householdConfigurationRepository,
      promptRepository: createPromptRepository(),
      financeServiceForHousehold: () => createFinanceService(),
      memoryStore: createInMemoryAssistantConversationMemoryStore(12),
      rateLimiter: createInMemoryAssistantRateLimiter({
        burstLimit: 5,
        burstWindowMs: 60_000,
        rollingLimit: 50,
        rollingWindowMs: 86_400_000
      }),
      usageTracker: createInMemoryAssistantUsageTracker()
    })

    await bot.handleUpdate(topicMentionUpdate('@household_test_bot how is life?') as never)

    expect(routerCalls).toBe(1)
    expect(assistantCalls).toBe(1)
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          method: 'sendMessage',
          payload: expect.objectContaining({
            text: 'Still here.'
          })
        })
      ])
    )
  })

  test('stays silent for regular group chatter when the bot is not addressed', async () => {
    const bot = createTestBot()
    const calls: Array<{ method: string; payload: unknown }> = []
    let assistantCalls = 0

    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })

      if (method === 'sendMessage') {
        return {
          ok: true,
          result: {
            message_id: calls.length,
            date: Math.floor(Date.now() / 1000),
            chat: {
              id: -100123,
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

    registerDmAssistant({
      bot,
      assistant: {
        async respond() {
          assistantCalls += 1
          return {
            text: 'I should not speak here.',
            usage: {
              inputTokens: 12,
              outputTokens: 5,
              totalTokens: 17
            }
          }
        }
      },
      purchaseRepository: createPurchaseRepository(),
      purchaseInterpreter: async () => null,
      householdConfigurationRepository: createHouseholdRepository(),
      promptRepository: createPromptRepository(),
      financeServiceForHousehold: () => createFinanceService(),
      memoryStore: createInMemoryAssistantConversationMemoryStore(12),
      rateLimiter: createInMemoryAssistantRateLimiter({
        burstLimit: 5,
        burstWindowMs: 60_000,
        rollingLimit: 50,
        rollingWindowMs: 86_400_000
      }),
      usageTracker: createInMemoryAssistantUsageTracker()
    })

    await bot.handleUpdate(topicMessageUpdate('Dima is joking with Stas again') as never)

    expect(assistantCalls).toBe(0)
    expect(calls).toHaveLength(0)
  })

  test('creates a purchase proposal in a household topic without an explicit mention', async () => {
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
              id: -100123,
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

    registerDmAssistant({
      bot,
      assistant: {
        async respond(input) {
          expect(input.authoritativeFacts).toEqual([
            'The purchase has not been saved yet.',
            'Detected shared purchase: door handle - 30.00 GEL.',
            'Buttons shown to the user are Confirm and Cancel.'
          ])
          return {
            text: 'Looks like a shared purchase: door handle - 30.00 GEL.',
            usage: {
              inputTokens: 10,
              outputTokens: 2,
              totalTokens: 12
            }
          }
        }
      },
      purchaseRepository: createPurchaseRepository(),
      purchaseInterpreter: async () => null,
      householdConfigurationRepository: createHouseholdRepository(),
      promptRepository: createPromptRepository(),
      financeServiceForHousehold: () => createFinanceService(),
      memoryStore: createInMemoryAssistantConversationMemoryStore(12),
      rateLimiter: createInMemoryAssistantRateLimiter({
        burstLimit: 5,
        burstWindowMs: 60_000,
        rollingLimit: 50,
        rollingWindowMs: 86_400_000
      }),
      usageTracker: createInMemoryAssistantUsageTracker()
    })

    await bot.handleUpdate(topicMessageUpdate('I bought a door handle for 30 lari') as never)

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      method: 'sendMessage',
      payload: {
        chat_id: -100123,
        message_thread_id: 777,
        text: 'Looks like a shared purchase: door handle - 30.00 GEL.',
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: 'Confirm',
                callback_data: 'assistant_purchase:confirm:purchase-1'
              },
              {
                text: 'Cancel',
                callback_data: 'assistant_purchase:cancel:purchase-1'
              }
            ]
          ]
        }
      }
    })
  })

  test('replies when a household member answers the bot message in a topic', async () => {
    const bot = createTestBot()
    const calls: Array<{ method: string; payload: unknown }> = []
    let assistantCalls = 0

    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })

      if (method === 'sendMessage') {
        return {
          ok: true,
          result: {
            message_id: calls.length,
            date: Math.floor(Date.now() / 1000),
            chat: {
              id: -100123,
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

    registerDmAssistant({
      bot,
      assistant: {
        async respond(input) {
          assistantCalls += 1
          expect(input.userMessage).toBe('tell me a joke')
          return {
            text: 'Rent is still due on the 20th.',
            usage: {
              inputTokens: 17,
              outputTokens: 8,
              totalTokens: 25
            }
          }
        }
      },
      purchaseRepository: createPurchaseRepository(),
      purchaseInterpreter: async () => null,
      householdConfigurationRepository: createHouseholdRepository(),
      promptRepository: createPromptRepository(),
      financeServiceForHousehold: () => createFinanceService(),
      memoryStore: createInMemoryAssistantConversationMemoryStore(12),
      rateLimiter: createInMemoryAssistantRateLimiter({
        burstLimit: 5,
        burstWindowMs: 60_000,
        rollingLimit: 50,
        rollingWindowMs: 86_400_000
      }),
      usageTracker: createInMemoryAssistantUsageTracker()
    })

    await bot.handleUpdate(
      topicMessageUpdate('tell me a joke', {
        replyToBot: true
      }) as never
    )

    expect(assistantCalls).toBe(1)
    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({
      method: 'sendChatAction',
      payload: {
        chat_id: -100123,
        action: 'typing',
        message_thread_id: 777
      }
    })
    expect(calls[1]).toMatchObject({
      method: 'sendMessage',
      payload: {
        chat_id: -100123,
        message_thread_id: 777,
        text: 'Rent is still due on the 20th.'
      }
    })
  })

  test('loads persisted thread and same-day chat history including bot replies', async () => {
    const bot = createTestBot()
    const calls: Array<{ method: string; payload: unknown }> = []
    const topicMessageHistoryRepository = createTopicMessageHistoryRepository()
    let recentThreadTexts: string[] = []
    let sameDayTexts: string[] = []

    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })

      if (method === 'sendMessage') {
        return {
          ok: true,
          result: {
            message_id: calls.length,
            date: Math.floor(Date.now() / 1000),
            chat: {
              id: -100123,
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

    registerDmAssistant({
      bot,
      assistant: {
        async respond(input) {
          recentThreadTexts = input.recentThreadMessages?.map((message) => message.text) ?? []
          sameDayTexts = input.sameDayChatMessages?.map((message) => message.text) ?? []

          return {
            text: 'Yes. You were discussing a TV for the house.',
            usage: {
              inputTokens: 20,
              outputTokens: 9,
              totalTokens: 29
            }
          }
        }
      },
      householdConfigurationRepository: createHouseholdRepository(),
      promptRepository: createPromptRepository(),
      financeServiceForHousehold: () => createFinanceService(),
      memoryStore: createInMemoryAssistantConversationMemoryStore(12),
      rateLimiter: createInMemoryAssistantRateLimiter({
        burstLimit: 5,
        burstWindowMs: 60_000,
        rollingLimit: 50,
        rollingWindowMs: 86_400_000
      }),
      usageTracker: createInMemoryAssistantUsageTracker(),
      topicMessageHistoryRepository
    })

    await bot.handleUpdate(topicMessageUpdate('I think we need a TV in the house') as never)
    await bot.handleUpdate(
      topicMentionUpdate('@household_test_bot do you remember what we said today?') as never
    )
    await bot.handleUpdate(
      topicMentionUpdate('@household_test_bot do you remember what you answered?') as never
    )

    expect(recentThreadTexts).toContain('I think we need a TV in the house')
    expect(recentThreadTexts).toContain('Yes. You were discussing a TV for the house.')
    expect(sameDayTexts).toContain('I think we need a TV in the house')
    expect(sameDayTexts).toContain('Yes. You were discussing a TV for the house.')
    expect(calls.at(-1)).toMatchObject({
      method: 'sendMessage',
      payload: {
        text: 'Yes. You were discussing a TV for the house.'
      }
    })
  })

  test('uses rolling chat history for summary questions instead of finance helper replies', async () => {
    const bot = createTestBot()
    const calls: Array<{ method: string; payload: unknown }> = []
    const topicMessageHistoryRepository = createTopicMessageHistoryRepository()
    let sameDayTexts: string[] = []
    let assistantCalls = 0

    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })

      if (method === 'sendMessage') {
        return {
          ok: true,
          result: {
            message_id: calls.length,
            date: Math.floor(Date.now() / 1000),
            chat: {
              id: -100123,
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

    registerDmAssistant({
      bot,
      assistant: {
        async respond(input) {
          assistantCalls += 1
          sameDayTexts = input.sameDayChatMessages?.map((message) => message.text) ?? []

          return {
            text: 'В чате ты говорил, что думаешь о семечках.',
            usage: {
              inputTokens: 24,
              outputTokens: 10,
              totalTokens: 34
            }
          }
        }
      },
      householdConfigurationRepository: createHouseholdRepository(),
      promptRepository: createPromptRepository(),
      financeServiceForHousehold: () => createFinanceService(),
      memoryStore: createInMemoryAssistantConversationMemoryStore(12),
      rateLimiter: createInMemoryAssistantRateLimiter({
        burstLimit: 5,
        burstWindowMs: 60_000,
        rollingLimit: 50,
        rollingWindowMs: 86_400_000
      }),
      usageTracker: createInMemoryAssistantUsageTracker(),
      topicMessageHistoryRepository
    })

    await bot.handleUpdate(topicMessageUpdate('Я думаю о семечках') as never)
    await bot.handleUpdate(
      topicMentionUpdate('@household_test_bot можешь дать сводку, что происходило в чате?') as never
    )

    expect(assistantCalls).toBe(1)
    expect(sameDayTexts).toContain('Я думаю о семечках')
    expect(calls.at(-1)).toMatchObject({
      method: 'sendMessage',
      payload: {
        text: 'В чате ты говорил, что думаешь о семечках.'
      }
    })
  })

  test('responds to strong contextual follow-ups without a repeated mention', async () => {
    const bot = createTestBot()
    const calls: Array<{ method: string; payload: unknown }> = []
    let assistantCalls = 0

    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })

      if (method === 'sendMessage') {
        return {
          ok: true,
          result: {
            message_id: calls.length,
            date: Math.floor(Date.now() / 1000),
            chat: {
              id: -100123,
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

    registerDmAssistant({
      bot,
      assistant: {
        async respond(input) {
          assistantCalls += 1

          return {
            text:
              assistantCalls === 1
                ? 'Still standing.'
                : `Отвечаю по контексту: ${input.userMessage}`,
            usage: {
              inputTokens: 15,
              outputTokens: 8,
              totalTokens: 23
            }
          }
        }
      },
      householdConfigurationRepository: createHouseholdRepository(),
      promptRepository: createPromptRepository(),
      financeServiceForHousehold: () => createFinanceService(),
      memoryStore: createInMemoryAssistantConversationMemoryStore(12),
      rateLimiter: createInMemoryAssistantRateLimiter({
        burstLimit: 5,
        burstWindowMs: 60_000,
        rollingLimit: 50,
        rollingWindowMs: 86_400_000
      }),
      usageTracker: createInMemoryAssistantUsageTracker(),
      topicMessageHistoryRepository: createTopicMessageHistoryRepository()
    })

    await bot.handleUpdate(topicMentionUpdate('@household_test_bot how is life?') as never)
    await bot.handleUpdate(
      topicMessageUpdate('Вопрос выше, я уже задал, ты просто не ответил') as never
    )

    expect(assistantCalls).toBe(2)
    expect(calls.at(-1)).toMatchObject({
      method: 'sendMessage',
      payload: {
        text: 'Отвечаю по контексту: Вопрос выше, я уже задал, ты просто не ответил'
      }
    })
  })

  test('stays silent for casual follow-ups after a recent bot reply', async () => {
    const bot = createTestBot()
    const calls: Array<{ method: string; payload: unknown }> = []
    let assistantCalls = 0

    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })

      if (method === 'sendMessage') {
        return {
          ok: true,
          result: {
            message_id: calls.length,
            date: Math.floor(Date.now() / 1000),
            chat: {
              id: -100123,
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

    registerDmAssistant({
      bot,
      assistant: {
        async respond() {
          assistantCalls += 1

          return {
            text: 'Still standing.',
            usage: {
              inputTokens: 15,
              outputTokens: 8,
              totalTokens: 23
            }
          }
        }
      },
      householdConfigurationRepository: createHouseholdRepository(),
      promptRepository: createPromptRepository(),
      financeServiceForHousehold: () => createFinanceService(),
      memoryStore: createInMemoryAssistantConversationMemoryStore(12),
      rateLimiter: createInMemoryAssistantRateLimiter({
        burstLimit: 5,
        burstWindowMs: 60_000,
        rollingLimit: 50,
        rollingWindowMs: 86_400_000
      }),
      usageTracker: createInMemoryAssistantUsageTracker(),
      topicMessageHistoryRepository: createTopicMessageHistoryRepository()
    })

    await bot.handleUpdate(topicMentionUpdate('@household_test_bot how is life?') as never)
    await bot.handleUpdate(topicMessageUpdate('ok', { updateId: 3002 }) as never)

    expect(assistantCalls).toBe(1)
    expect(calls.filter((call) => call.method === 'sendMessage')).toHaveLength(1)
  })

  test('ignores duplicate deliveries of the same DM update', async () => {
    const bot = createTestBot()
    const calls: Array<{ method: string; payload: unknown }> = []
    const usageTracker = createInMemoryAssistantUsageTracker()

    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })

      if (method === 'sendMessage') {
        return {
          ok: true,
          result: {
            message_id: calls.length,
            date: Math.floor(Date.now() / 1000),
            chat: {
              id: 123456,
              type: 'private'
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

    registerDmAssistant({
      bot,
      assistant: {
        async respond() {
          return {
            text: 'You still owe 350.00 GEL this cycle.',
            usage: {
              inputTokens: 100,
              outputTokens: 25,
              totalTokens: 125
            }
          }
        }
      },
      householdConfigurationRepository: createHouseholdRepository(),
      messageProcessingRepository: createProcessedBotMessageRepository(),
      promptRepository: createPromptRepository(),
      financeServiceForHousehold: () => createFinanceService(),
      memoryStore: createInMemoryAssistantConversationMemoryStore(12),
      rateLimiter: createInMemoryAssistantRateLimiter({
        burstLimit: 5,
        burstWindowMs: 60_000,
        rollingLimit: 50,
        rollingWindowMs: 86_400_000
      }),
      usageTracker
    })

    const update = privateMessageUpdate('How much do I still owe this month?')
    await bot.handleUpdate(update as never)
    await bot.handleUpdate(update as never)

    expect(calls).toHaveLength(2)
    expect(usageTracker.listHouseholdUsage('household-1')).toEqual([
      {
        householdId: 'household-1',
        telegramUserId: '123456',
        displayName: 'Stan',
        requestCount: 1,
        inputTokens: 100,
        outputTokens: 25,
        totalTokens: 125,
        updatedAt: expect.any(String)
      }
    ])
  })

  test('confirms a pending payment proposal from DM callback', async () => {
    const bot = createTestBot()
    const calls: Array<{ method: string; payload: unknown }> = []
    const promptRepository = createPromptRepository()
    const repository = createHouseholdRepository()

    await promptRepository.upsertPendingAction({
      telegramUserId: '123456',
      telegramChatId: '123456',
      action: 'assistant_payment_confirmation',
      payload: {
        proposalId: 'proposal-1',
        householdId: 'household-1',
        memberId: 'member-1',
        kind: 'rent',
        amountMinor: '70000',
        currency: 'GEL'
      },
      expiresAt: null
    })

    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })
      return {
        ok: true,
        result: true
      } as never
    })

    registerDmAssistant({
      bot,
      householdConfigurationRepository: repository,
      promptRepository,
      financeServiceForHousehold: () => createFinanceService(),
      memoryStore: createInMemoryAssistantConversationMemoryStore(12),
      rateLimiter: createInMemoryAssistantRateLimiter({
        burstLimit: 5,
        burstWindowMs: 60_000,
        rollingLimit: 50,
        rollingWindowMs: 86_400_000
      }),
      usageTracker: createInMemoryAssistantUsageTracker()
    })

    await bot.handleUpdate(privateCallbackUpdate('assistant_payment:confirm:proposal-1') as never)

    expect(calls[0]).toMatchObject({
      method: 'answerCallbackQuery',
      payload: {
        callback_query_id: 'callback-1',
        text: 'Recorded rent payment: 700.00 GEL'
      }
    })
    expect(calls[1]).toMatchObject({
      method: 'editMessageText',
      payload: {
        chat_id: 123456,
        message_id: 77,
        text: 'Recorded rent payment: 700.00 GEL'
      }
    })
    expect(await promptRepository.getPendingAction('123456', '123456')).toBeNull()
  })
})
