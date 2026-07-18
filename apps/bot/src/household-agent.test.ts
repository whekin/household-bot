import { afterEach, describe, expect, test } from 'bun:test'

import type { FinanceCommandService } from '@household/application'
import { Money } from '@household/domain'
import type {
  HouseholdConfigurationRepository,
  TelegramPendingActionRecord,
  TelegramPendingActionRepository,
  TopicMessageHistoryRecord,
  TopicMessageHistoryRepository
} from '@household/ports'

import { createTelegramBot } from './bot'
import { registerHouseholdAgent } from './household-agent'
import { HouseholdContextCache } from './household-context-cache'
import type { WakeClassifier } from './wake-gate'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function mockAgentModel(replyText: string): { calls: Array<{ body: string }> } {
  const calls: Array<{ body: string }> = []
  globalThis.fetch = (async (
    _input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1]
  ) => {
    calls.push({ body: String(init?.body ?? '') })
    return new Response(
      JSON.stringify({
        output: [{ type: 'message', content: [{ type: 'output_text', text: replyText }] }],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }
      }),
      { status: 200 }
    )
  }) as unknown as typeof fetch
  return { calls }
}

function createAgentBot(calls: Array<{ method: string; payload: unknown }>) {
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

  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload })
    return {
      ok: true,
      result: {
        message_id: calls.length + 100,
        date: Math.floor(Date.now() / 1000),
        chat: { id: 5555, type: 'private' },
        text: 'ok'
      }
    } as never
  })

  return bot
}

function dmUpdate(text: string, fromId = 10002) {
  return {
    update_id: 9001,
    message: {
      message_id: 71,
      date: Math.floor(Date.now() / 1000),
      chat: { id: fromId, type: 'private' },
      from: { id: fromId, is_bot: false, first_name: 'Mia' },
      text
    }
  } as never
}

function groupUpdate(text: string, fromId = 10002, sequence = 0) {
  return {
    update_id: 9002 + sequence,
    message: {
      message_id: 72 + sequence,
      date: Math.floor(Date.now() / 1000) + sequence,
      chat: { id: -10012345, type: 'supergroup' },
      from: { id: fromId, is_bot: false, first_name: 'Mia' },
      text
    }
  } as never
}

function createHistoryRepositoryFake(): TopicMessageHistoryRepository & {
  records: TopicMessageHistoryRecord[]
} {
  const records: TopicMessageHistoryRecord[] = []
  return {
    records,
    async saveMessage(input) {
      records.push(input)
    },
    async listRecentThreadMessages(input) {
      return records
        .filter(
          (record) =>
            record.householdId === input.householdId &&
            record.telegramChatId === input.telegramChatId &&
            record.telegramThreadId === input.telegramThreadId
        )
        .slice(-input.limit)
    },
    async listRecentChatMessages(input) {
      return records
        .filter(
          (record) =>
            record.householdId === input.householdId &&
            record.telegramChatId === input.telegramChatId &&
            record.messageSentAt !== null &&
            record.messageSentAt.epochMilliseconds >= input.sentAtOrAfter.epochMilliseconds
        )
        .slice(-input.limit)
    }
  }
}

function createPromptRepositoryFake(): TelegramPendingActionRepository {
  const pending = new Map<string, TelegramPendingActionRecord>()
  const key = (chatId: string, userId: string, action: string) => `${chatId}:${userId}:${action}`

  return {
    async upsertPendingAction(input) {
      pending.set(key(input.telegramChatId, input.telegramUserId, input.action), input)
      return input
    },
    async getPendingAction(chatId, userId, action) {
      if (action) {
        return pending.get(key(chatId, userId, action)) ?? null
      }
      return (
        [...pending.values()].find(
          (entry) => entry.telegramChatId === chatId && entry.telegramUserId === userId
        ) ?? null
      )
    },
    async clearPendingAction(chatId, userId, action) {
      for (const [entryKey, entry] of pending.entries()) {
        if (entry.telegramChatId !== chatId || entry.telegramUserId !== userId) {
          continue
        }
        if (action && entry.action !== action) {
          continue
        }
        pending.delete(entryKey)
      }
    },
    async clearPendingActionsForChat() {}
  }
}

function createHouseholdRepositoryFake(memberships: number): HouseholdConfigurationRepository {
  return {
    listHouseholdMembersByTelegramUserId: async () =>
      Array.from({ length: memberships }, (_, index) => ({
        id: `member-${index + 1}`,
        householdId: `household-${index + 1}`,
        telegramUserId: '10002',
        displayName: 'Mia',
        status: 'active',
        preferredLocale: 'ru',
        householdDefaultLocale: 'ru',
        rentShareWeight: 1,
        isAdmin: false
      })),
    findHouseholdTopicByTelegramContext: async () => null,
    getTelegramHouseholdChat: async () => null,
    getHouseholdChatByHouseholdId: async () => ({
      householdId: 'household-1',
      householdName: 'Test',
      telegramChatId: '-10012345',
      telegramChatType: 'supergroup',
      title: 'Test',
      defaultLocale: 'ru'
    }),
    getHouseholdBillingSettings: async () => ({
      householdId: 'household-1',
      settlementCurrency: 'GEL',
      rentAmountMinor: 70000n,
      rentCurrency: 'USD',
      rentDueDay: 20,
      rentWarningDay: 17,
      utilitiesDueDay: 4,
      utilitiesReminderDay: 3,
      preferredUtilityPayerMemberId: null,
      timezone: 'Asia/Tbilisi'
    })
  } as unknown as HouseholdConfigurationRepository
}

function createGroupHouseholdRepositoryFake(): HouseholdConfigurationRepository {
  return {
    ...createHouseholdRepositoryFake(1),
    getTelegramHouseholdChat: async () => ({
      householdId: 'household-1',
      householdName: 'Test',
      telegramChatId: '-10012345',
      telegramChatType: 'supergroup',
      title: 'Test',
      defaultLocale: 'ru'
    })
  } as unknown as HouseholdConfigurationRepository
}

function createFinanceServiceFake(): FinanceCommandService {
  return {
    getMemberByTelegramUserId: async () => ({
      id: 'member-1',
      telegramUserId: '10002',
      displayName: 'Mia',
      rentShareWeight: 1,
      isAdmin: false
    }),
    listMembers: async () => [
      {
        id: 'member-1',
        telegramUserId: '10002',
        displayName: 'Mia',
        rentShareWeight: 1,
        isAdmin: false
      }
    ],
    generateDashboard: async () => ({
      period: '2026-07',
      currency: 'GEL',
      totalDue: Money.zero('GEL'),
      totalPaid: Money.zero('GEL'),
      totalRemaining: Money.zero('GEL'),
      members: [],
      ledger: []
    })
  } as unknown as FinanceCommandService
}

const agentOptions = {
  promptRepository: createPromptRepositoryFake(),
  apiKey: 'test-key',
  model: 'test-model',
  timeoutMs: 5000
}

const followUpWakeClassifier: WakeClassifier = async (input) => ({
  addressedToBot: input.messageText === 'Давай другой анекдот',
  completedPaymentFact: false,
  completedPurchaseFact: false,
  notificationRequest: false
})

describe('registerHouseholdAgent in private chats', () => {
  test('answers DM messages without a wake gate', async () => {
    const model = mockAgentModel('Привет, Мия!')
    const calls: Array<{ method: string; payload: unknown }> = []
    const bot = createAgentBot(calls)

    registerHouseholdAgent(bot, {
      ...agentOptions,
      householdConfigurationRepository: {
        ...createHouseholdRepositoryFake(1),
        getHouseholdAssistantConfig: async () => ({
          householdId: 'household-1',
          assistantContext: null,
          assistantTone: 'Call the household cat the financial director.'
        })
      },
      financeServiceForHousehold: () => createFinanceServiceFake(),
      contextCache: new HouseholdContextCache()
    })

    await bot.handleUpdate(dmUpdate('привет'))

    const reply = calls.find((call) => call.method === 'sendMessage')
    expect((reply?.payload as { text: string } | undefined)?.text).toBe('Привет, Мия!')
    expect(model.calls.length).toBe(1)

    const requestBody = JSON.parse(model.calls[0]?.body ?? '{}') as {
      input?: Array<{ role?: string; content?: string }>
    }
    const systemPrompt = requestBody.input?.find((message) => message.role === 'system')?.content
    expect(systemPrompt).toContain('relaxed, positive contemporary Russian group chat')
    expect(systemPrompt).toContain('Occasionally add one light chat marker')
    expect(systemPrompt).toContain('Do not end a Russian conversational reply with a full stop')
    expect(systemPrompt).toContain('custom instructions may refine your personality')
    expect(systemPrompt).toContain('always call get_rent_settings')
    expect(systemPrompt).toContain('Action notifications')
    expect(systemPrompt).toContain('Do not volunteer capability disclaimers')
    expect(systemPrompt).toContain('facts saved in the household system from real-world agreements')
    expect(systemPrompt).toContain('use that person as the owner')
    expect(systemPrompt).toContain('prefer a fresh, specific observational or situational joke')
    expect(systemPrompt).toContain('Treat “не смешно”, “давай другой”')
    expect(systemPrompt).toContain('change both the premise and the joke structure')
    expect(systemPrompt).toContain('Never claim that a joke will definitely make someone laugh')

    const contextPrompt = requestBody.input?.filter((message) => message.role === 'system')[1]
      ?.content
    expect(contextPrompt).toContain('Household custom instructions:')
    expect(contextPrompt).toContain('Call the household cat the financial director.')
  })

  test('tells non-members there is no household', async () => {
    const model = mockAgentModel('unused')
    const calls: Array<{ method: string; payload: unknown }> = []
    const bot = createAgentBot(calls)

    registerHouseholdAgent(bot, {
      ...agentOptions,
      householdConfigurationRepository: createHouseholdRepositoryFake(0),
      financeServiceForHousehold: () => createFinanceServiceFake()
    })

    await bot.handleUpdate(dmUpdate('привет'))

    const reply = calls.find((call) => call.method === 'sendMessage')
    expect(reply).toBeDefined()
    expect(model.calls.length).toBe(0)
  })

  test('sends a fixed fallback when a DM agent request fails', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: 'Incorrect API key provided' } }), {
        status: 401,
        headers: { 'x-request-id': 'req_dm_failure' }
      })) as unknown as typeof fetch
    const calls: Array<{ method: string; payload: unknown }> = []
    const bot = createAgentBot(calls)

    registerHouseholdAgent(bot, {
      ...agentOptions,
      householdConfigurationRepository: createHouseholdRepositoryFake(1),
      financeServiceForHousehold: () => createFinanceServiceFake()
    })

    await bot.handleUpdate(dmUpdate('привет'))

    const reply = calls.find((call) => call.method === 'sendMessage')
    expect((reply?.payload as { text: string } | undefined)?.text).toBe(
      'Сейчас не могу ответить. Попробуйте ещё раз через минуту.'
    )
  })

  test('stays silent in groups without an addressing signal', async () => {
    const model = mockAgentModel('unused')
    const calls: Array<{ method: string; payload: unknown }> = []
    const bot = createAgentBot(calls)

    registerHouseholdAgent(bot, {
      ...agentOptions,
      householdConfigurationRepository: createGroupHouseholdRepositoryFake(),
      financeServiceForHousehold: () => createFinanceServiceFake()
    })

    await bot.handleUpdate(groupUpdate('давай я твою долю оплачу, а ты вернёшь потом'))

    expect(calls.find((call) => call.method === 'sendMessage')).toBeUndefined()
    expect(model.calls.length).toBe(0)
  })

  test('continues a fresh same-member bot conversation without another mention', async () => {
    const model = mockAgentModel('Вот ещё один анекдот ))')
    const calls: Array<{ method: string; payload: unknown }> = []
    const bot = createAgentBot(calls)
    const historyRepository = createHistoryRepositoryFake()

    registerHouseholdAgent(bot, {
      ...agentOptions,
      householdConfigurationRepository: createGroupHouseholdRepositoryFake(),
      financeServiceForHousehold: () => createFinanceServiceFake(),
      historyRepository,
      wakeClassifier: followUpWakeClassifier
    })

    await bot.handleUpdate(groupUpdate('@household_test_bot расскажи анекдот'))
    await bot.handleUpdate(groupUpdate('Давай другой анекдот', 10002, 1))

    expect(model.calls).toHaveLength(2)
    expect(calls.filter((call) => call.method === 'sendMessage')).toHaveLength(2)
    expect(historyRepository.records.map((record) => record.isBot)).toEqual([
      false,
      true,
      false,
      true
    ])

    const secondRequest = JSON.parse(model.calls[1]?.body ?? '{}') as {
      input?: Array<{ role?: string; content?: string }>
    }
    const secondContext = secondRequest.input?.filter((message) => message.role === 'system')[1]
      ?.content
    expect(secondContext).toContain('BOT: Вот ещё один анекдот ))')
    expect(secondRequest.input?.at(-1)?.content).toBe('Давай другой анекдот')
  })

  test('does not continue after another housemate interrupts the exchange', async () => {
    const model = mockAgentModel('Вот ещё один анекдот ))')
    const calls: Array<{ method: string; payload: unknown }> = []
    const bot = createAgentBot(calls)
    const historyRepository = createHistoryRepositoryFake()

    registerHouseholdAgent(bot, {
      ...agentOptions,
      householdConfigurationRepository: createGroupHouseholdRepositoryFake(),
      financeServiceForHousehold: () => createFinanceServiceFake(),
      historyRepository,
      wakeClassifier: followUpWakeClassifier
    })

    await bot.handleUpdate(groupUpdate('@household_test_bot расскажи анекдот'))
    await bot.handleUpdate(groupUpdate('Стас, давай лучше без анекдотов', 10003, 1))
    await bot.handleUpdate(groupUpdate('Давай другой анекдот', 10002, 2))

    expect(model.calls).toHaveLength(1)
    expect(calls.filter((call) => call.method === 'sendMessage')).toHaveLength(1)
  })

  test('does not join a same-member message addressed to a housemate', async () => {
    const model = mockAgentModel('Вот ещё один анекдот ))')
    const calls: Array<{ method: string; payload: unknown }> = []
    const bot = createAgentBot(calls)
    const historyRepository = createHistoryRepositoryFake()

    registerHouseholdAgent(bot, {
      ...agentOptions,
      householdConfigurationRepository: createGroupHouseholdRepositoryFake(),
      financeServiceForHousehold: () => createFinanceServiceFake(),
      historyRepository,
      wakeClassifier: followUpWakeClassifier
    })

    await bot.handleUpdate(groupUpdate('@household_test_bot расскажи анекдот'))
    await bot.handleUpdate(groupUpdate('Ион, давай лучше другой анекдот', 10002, 1))

    expect(model.calls).toHaveLength(1)
    expect(calls.filter((call) => call.method === 'sendMessage')).toHaveLength(1)
  })
})
