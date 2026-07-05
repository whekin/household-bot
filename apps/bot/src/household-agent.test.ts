import { afterEach, describe, expect, test } from 'bun:test'

import type { FinanceCommandService } from '@household/application'
import { Money } from '@household/domain'
import type {
  HouseholdConfigurationRepository,
  TelegramPendingActionRecord,
  TelegramPendingActionRepository
} from '@household/ports'

import { createTelegramBot } from './bot'
import { registerHouseholdAgent } from './household-agent'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function mockAgentModel(replyText: string): { calls: number[] } {
  const calls: number[] = []
  globalThis.fetch = (async () => {
    calls.push(1)
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

function groupUpdate(text: string, fromId = 10002) {
  return {
    update_id: 9002,
    message: {
      message_id: 72,
      date: Math.floor(Date.now() / 1000),
      chat: { id: -10012345, type: 'supergroup' },
      from: { id: fromId, is_bot: false, first_name: 'Mia' },
      text
    }
  } as never
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

describe('registerHouseholdAgent in private chats', () => {
  test('answers DM messages without a wake gate', async () => {
    const model = mockAgentModel('Привет, Мия!')
    const calls: Array<{ method: string; payload: unknown }> = []
    const bot = createAgentBot(calls)

    registerHouseholdAgent(bot, {
      ...agentOptions,
      householdConfigurationRepository: createHouseholdRepositoryFake(1),
      financeServiceForHousehold: () => createFinanceServiceFake()
    })

    await bot.handleUpdate(dmUpdate('привет'))

    const reply = calls.find((call) => call.method === 'sendMessage')
    expect((reply?.payload as { text: string } | undefined)?.text).toBe('Привет, Мия!')
    expect(model.calls.length).toBe(1)
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

  test('stays silent in groups without an addressing signal', async () => {
    const model = mockAgentModel('unused')
    const calls: Array<{ method: string; payload: unknown }> = []
    const bot = createAgentBot(calls)

    registerHouseholdAgent(bot, {
      ...agentOptions,
      householdConfigurationRepository: {
        ...createHouseholdRepositoryFake(1),
        getTelegramHouseholdChat: async () => ({
          householdId: 'household-1',
          householdName: 'Test',
          telegramChatId: '-10012345',
          telegramChatType: 'supergroup',
          title: 'Test',
          defaultLocale: 'ru'
        })
      } as unknown as HouseholdConfigurationRepository,
      financeServiceForHousehold: () => createFinanceServiceFake()
    })

    await bot.handleUpdate(groupUpdate('давай я твою долю оплачу, а ты вернёшь потом'))

    expect(calls.find((call) => call.method === 'sendMessage')).toBeUndefined()
    expect(model.calls.length).toBe(0)
  })
})
