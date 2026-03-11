import { describe, expect, test } from 'bun:test'

import type {
  HouseholdAdminService,
  HouseholdOnboardingService,
  HouseholdSetupService
} from '@household/application'
import { createHouseholdSetupService } from '@household/application'
import { nowInstant, Temporal } from '@household/domain'
import type {
  HouseholdConfigurationRepository,
  HouseholdJoinTokenRecord,
  HouseholdMemberRecord,
  HouseholdPendingMemberRecord,
  HouseholdTelegramChatRecord,
  HouseholdTopicBindingRecord,
  TelegramPendingActionRecord,
  TelegramPendingActionRepository
} from '@household/ports'

import { createTelegramBot } from './bot'
import { buildJoinMiniAppUrl, registerHouseholdSetupCommands } from './household-setup'

function startUpdate(
  text: string,
  options: {
    userId?: number
    firstName?: string
    languageCode?: string
  } = {}
) {
  const commandToken = text.split(' ')[0] ?? text
  const userId = options.userId ?? 123456

  return {
    update_id: 2001,
    message: {
      message_id: 71,
      date: Math.floor(Date.now() / 1000),
      chat: {
        id: userId,
        type: 'private'
      },
      from: {
        id: userId,
        is_bot: false,
        first_name: options.firstName ?? 'Stan',
        ...(options.languageCode
          ? {
              language_code: options.languageCode
            }
          : {})
      },
      text,
      entities: [
        {
          offset: 0,
          length: commandToken.length,
          type: 'bot_command'
        }
      ]
    }
  }
}

function createRejectedHouseholdSetupService(): HouseholdSetupService {
  return {
    async setupGroupChat() {
      return {
        status: 'rejected',
        reason: 'invalid_chat_type'
      }
    },
    async bindTopic() {
      return {
        status: 'rejected',
        reason: 'household_not_found'
      }
    },
    async unsetupGroupChat() {
      return {
        status: 'noop'
      }
    }
  }
}

function createHouseholdAdminService(): HouseholdAdminService {
  return {
    async listPendingMembers() {
      return {
        status: 'rejected',
        reason: 'household_not_found'
      }
    },
    async approvePendingMember() {
      return {
        status: 'rejected',
        reason: 'pending_not_found'
      }
    }
  }
}

function groupCommandUpdate(text: string) {
  const commandToken = text.split(' ')[0] ?? text

  return {
    update_id: 3001,
    message: {
      message_id: 81,
      date: Math.floor(Date.now() / 1000),
      chat: {
        id: -100123456,
        type: 'supergroup',
        title: 'Kojori House'
      },
      from: {
        id: 123456,
        is_bot: false,
        first_name: 'Stan',
        language_code: 'en'
      },
      text,
      entities: [
        {
          offset: 0,
          length: commandToken.length,
          type: 'bot_command'
        }
      ]
    }
  }
}

function groupReplyCommandUpdate(text: string, repliedUser: { id: number; firstName: string }) {
  const commandToken = text.split(' ')[0] ?? text

  return {
    update_id: 3004,
    message: {
      message_id: 82,
      date: Math.floor(Date.now() / 1000),
      chat: {
        id: -100123456,
        type: 'supergroup',
        title: 'Kojori House'
      },
      from: {
        id: 123456,
        is_bot: false,
        first_name: 'Stan',
        language_code: 'en'
      },
      reply_to_message: {
        message_id: 80,
        date: Math.floor(Date.now() / 1000),
        chat: {
          id: -100123456,
          type: 'supergroup',
          title: 'Kojori House'
        },
        from: {
          id: repliedUser.id,
          is_bot: false,
          first_name: repliedUser.firstName
        },
        text: 'hello'
      },
      text,
      entities: [
        {
          offset: 0,
          length: commandToken.length,
          type: 'bot_command'
        }
      ]
    }
  }
}

function groupCallbackUpdate(data: string) {
  return {
    update_id: 3002,
    callback_query: {
      id: 'callback-1',
      from: {
        id: 123456,
        is_bot: false,
        first_name: 'Stan',
        language_code: 'en'
      },
      chat_instance: 'group-instance-1',
      data,
      message: {
        message_id: 91,
        date: Math.floor(Date.now() / 1000),
        chat: {
          id: -100123456,
          type: 'supergroup',
          title: 'Kojori House'
        },
        text: 'placeholder'
      }
    }
  }
}

function topicMessageUpdate(text: string, threadId: number) {
  return {
    update_id: 3003,
    message: {
      message_id: 92,
      date: Math.floor(Date.now() / 1000),
      is_topic_message: true,
      message_thread_id: threadId,
      chat: {
        id: -100123456,
        type: 'supergroup',
        title: 'Kojori House'
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

function createPromptRepository(): TelegramPendingActionRepository {
  const store = new Map<string, TelegramPendingActionRecord>()

  return {
    async upsertPendingAction(input) {
      const record = {
        ...input,
        payload: {
          ...input.payload
        }
      }
      store.set(`${input.telegramChatId}:${input.telegramUserId}`, record)
      return record
    },
    async getPendingAction(telegramChatId, telegramUserId) {
      const key = `${telegramChatId}:${telegramUserId}`
      const record = store.get(key)
      if (!record) {
        return null
      }

      if (record.expiresAt && Temporal.Instant.compare(record.expiresAt, nowInstant()) <= 0) {
        store.delete(key)
        return null
      }

      return {
        ...record,
        payload: {
          ...record.payload
        }
      }
    },
    async clearPendingAction(telegramChatId, telegramUserId) {
      store.delete(`${telegramChatId}:${telegramUserId}`)
    },
    async clearPendingActionsForChat(telegramChatId, action) {
      for (const [key, record] of store.entries()) {
        if (!key.startsWith(`${telegramChatId}:`)) {
          continue
        }

        if (action && record.action !== action) {
          continue
        }

        store.delete(key)
      }
    }
  }
}

function createHouseholdConfigurationRepository(): HouseholdConfigurationRepository {
  const households = new Map<string, HouseholdTelegramChatRecord>()
  const bindings = new Map<string, HouseholdTopicBindingRecord[]>()
  const joinTokens = new Map<string, HouseholdJoinTokenRecord>()
  const pendingMembers = new Map<string, HouseholdPendingMemberRecord>()
  const members = new Map<string, HouseholdMemberRecord>()

  return {
    async registerTelegramHouseholdChat(input) {
      const existing = households.get(input.telegramChatId)
      if (existing) {
        const next = {
          ...existing,
          telegramChatType: input.telegramChatType,
          title: input.title?.trim() || existing.title
        }
        households.set(input.telegramChatId, next)
        return {
          status: 'existing',
          household: next
        }
      }

      const created: HouseholdTelegramChatRecord = {
        householdId: 'household-1',
        householdName: input.householdName,
        telegramChatId: input.telegramChatId,
        telegramChatType: input.telegramChatType,
        title: input.title?.trim() || null,
        defaultLocale: 'en'
      }
      households.set(input.telegramChatId, created)

      return {
        status: 'created',
        household: created
      }
    },
    async getTelegramHouseholdChat(telegramChatId) {
      return households.get(telegramChatId) ?? null
    },
    async getHouseholdChatByHouseholdId(householdId) {
      return [...households.values()].find((entry) => entry.householdId === householdId) ?? null
    },
    async bindHouseholdTopic(input) {
      const next: HouseholdTopicBindingRecord = {
        householdId: input.householdId,
        role: input.role,
        telegramThreadId: input.telegramThreadId,
        topicName: input.topicName?.trim() || null
      }
      const existing = bindings.get(input.householdId) ?? []
      bindings.set(
        input.householdId,
        [...existing.filter((entry) => entry.role !== input.role), next].sort((left, right) =>
          left.role.localeCompare(right.role)
        )
      )
      return next
    },
    async getHouseholdTopicBinding(householdId, role) {
      return bindings.get(householdId)?.find((entry) => entry.role === role) ?? null
    },
    async findHouseholdTopicByTelegramContext(input) {
      const household = households.get(input.telegramChatId)
      if (!household) {
        return null
      }

      return (
        bindings
          .get(household.householdId)
          ?.find((entry) => entry.telegramThreadId === input.telegramThreadId) ?? null
      )
    },
    async listHouseholdTopicBindings(householdId) {
      return bindings.get(householdId) ?? []
    },
    async clearHouseholdTopicBindings(householdId) {
      bindings.set(householdId, [])
    },
    async listReminderTargets() {
      return []
    },
    async upsertHouseholdJoinToken(input) {
      const household = [...households.values()].find(
        (entry) => entry.householdId === input.householdId
      )
      if (!household) {
        throw new Error('Missing household')
      }

      const record: HouseholdJoinTokenRecord = {
        householdId: household.householdId,
        householdName: household.householdName,
        token: input.token,
        createdByTelegramUserId: input.createdByTelegramUserId ?? null
      }
      joinTokens.set(household.householdId, record)
      return record
    },
    async getHouseholdJoinToken(householdId) {
      return joinTokens.get(householdId) ?? null
    },
    async getHouseholdByJoinToken(token) {
      const record = [...joinTokens.values()].find((entry) => entry.token === token)
      if (!record) {
        return null
      }
      return (
        [...households.values()].find((entry) => entry.householdId === record.householdId) ?? null
      )
    },
    async upsertPendingHouseholdMember(input) {
      const household = [...households.values()].find(
        (entry) => entry.householdId === input.householdId
      )
      if (!household) {
        throw new Error('Missing household')
      }

      const record: HouseholdPendingMemberRecord = {
        householdId: household.householdId,
        householdName: household.householdName,
        telegramUserId: input.telegramUserId,
        displayName: input.displayName,
        username: input.username?.trim() || null,
        languageCode: input.languageCode?.trim() || null,
        householdDefaultLocale: household.defaultLocale
      }
      pendingMembers.set(`${input.householdId}:${input.telegramUserId}`, record)
      return record
    },
    async getPendingHouseholdMember(householdId, telegramUserId) {
      return pendingMembers.get(`${householdId}:${telegramUserId}`) ?? null
    },
    async findPendingHouseholdMemberByTelegramUserId(telegramUserId) {
      return (
        [...pendingMembers.values()].find((entry) => entry.telegramUserId === telegramUserId) ??
        null
      )
    },
    async ensureHouseholdMember(input) {
      const key = `${input.householdId}:${input.telegramUserId}`
      const existing = members.get(key)
      const household =
        [...households.values()].find((entry) => entry.householdId === input.householdId) ?? null
      if (!household) {
        throw new Error('Missing household')
      }

      const next: HouseholdMemberRecord = {
        id: existing?.id ?? `member-${input.telegramUserId}`,
        householdId: input.householdId,
        telegramUserId: input.telegramUserId,
        displayName: input.displayName,
        status: input.status ?? existing?.status ?? 'active',
        preferredLocale: input.preferredLocale ?? existing?.preferredLocale ?? null,
        householdDefaultLocale: household.defaultLocale,
        rentShareWeight: input.rentShareWeight ?? existing?.rentShareWeight ?? 1,
        isAdmin: input.isAdmin === true || existing?.isAdmin === true
      }
      members.set(key, next)
      return next
    },
    async getHouseholdMember(householdId, telegramUserId) {
      return members.get(`${householdId}:${telegramUserId}`) ?? null
    },
    async listHouseholdMembers(householdId) {
      return [...members.values()].filter((entry) => entry.householdId === householdId)
    },
    async getHouseholdBillingSettings(householdId) {
      return {
        householdId,
        settlementCurrency: 'GEL',
        rentAmountMinor: null,
        rentCurrency: 'USD',
        rentDueDay: 20,
        rentWarningDay: 17,
        utilitiesDueDay: 4,
        utilitiesReminderDay: 3,
        timezone: 'Asia/Tbilisi'
      }
    },
    async updateHouseholdBillingSettings(input) {
      return {
        householdId: input.householdId,
        settlementCurrency: input.settlementCurrency ?? 'GEL',
        rentAmountMinor: input.rentAmountMinor ?? null,
        rentCurrency: input.rentCurrency ?? 'USD',
        rentDueDay: input.rentDueDay ?? 20,
        rentWarningDay: input.rentWarningDay ?? 17,
        utilitiesDueDay: input.utilitiesDueDay ?? 4,
        utilitiesReminderDay: input.utilitiesReminderDay ?? 3,
        timezone: input.timezone ?? 'Asia/Tbilisi'
      }
    },
    async listHouseholdUtilityCategories() {
      return []
    },
    async upsertHouseholdUtilityCategory(input) {
      return {
        id: input.slug ?? 'utility-1',
        householdId: input.householdId,
        slug: input.slug ?? 'utility',
        name: input.name,
        sortOrder: input.sortOrder,
        isActive: input.isActive
      }
    },
    async listHouseholdMembersByTelegramUserId(telegramUserId) {
      return [...members.values()].filter((entry) => entry.telegramUserId === telegramUserId)
    },
    async listPendingHouseholdMembers(householdId) {
      return [...pendingMembers.values()].filter((entry) => entry.householdId === householdId)
    },
    async approvePendingHouseholdMember(input) {
      const key = `${input.householdId}:${input.telegramUserId}`
      const pending = pendingMembers.get(key)
      if (!pending) {
        return null
      }

      pendingMembers.delete(key)
      const member: HouseholdMemberRecord = {
        id: `member-${pending.telegramUserId}`,
        householdId: pending.householdId,
        telegramUserId: pending.telegramUserId,
        displayName: pending.displayName,
        status: 'active',
        preferredLocale: null,
        householdDefaultLocale: pending.householdDefaultLocale,
        rentShareWeight: 1,
        isAdmin: input.isAdmin === true
      }
      members.set(key, member)
      return member
    },
    async updateHouseholdDefaultLocale(householdId, locale) {
      const household = [...households.values()].find((entry) => entry.householdId === householdId)
      if (!household) {
        throw new Error('Missing household')
      }

      const next = {
        ...household,
        defaultLocale: locale
      }
      households.set(next.telegramChatId, next)
      return next
    },
    async updateMemberPreferredLocale(householdId, telegramUserId, locale) {
      const key = `${householdId}:${telegramUserId}`
      const member = members.get(key)
      return member
        ? {
            ...member,
            preferredLocale: locale
          }
        : null
    },
    async updateHouseholdMemberDisplayName() {
      return null
    },
    async promoteHouseholdAdmin() {
      return null
    },
    async updateHouseholdMemberRentShareWeight() {
      return null
    },
    async updateHouseholdMemberStatus() {
      return null
    },
    async listHouseholdMemberAbsencePolicies() {
      return []
    },
    async upsertHouseholdMemberAbsencePolicy() {
      return null
    }
  }
}

describe('buildJoinMiniAppUrl', () => {
  test('adds join token and bot username query parameters', () => {
    const url = buildJoinMiniAppUrl(
      'https://household-dev-mini-app.example.app',
      'kojori_bot',
      'join-token'
    )

    expect(url).toBe('https://household-dev-mini-app.example.app/?join=join-token&bot=kojori_bot')
  })

  test('returns null when no mini app url is configured', () => {
    expect(buildJoinMiniAppUrl(undefined, 'kojori_bot', 'join-token')).toBeNull()
  })
})

describe('registerHouseholdSetupCommands', () => {
  test('offers an Open mini app button after a DM join request', async () => {
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
            id: 123456,
            type: 'private'
          },
          text: 'ok'
        }
      } as never
    })

    const householdOnboardingService: HouseholdOnboardingService = {
      async ensureHouseholdJoinToken() {
        return {
          householdId: 'household-1',
          householdName: 'Kojori House',
          token: 'join-token'
        }
      },
      async getMiniAppAccess() {
        return {
          status: 'open_from_group'
        }
      },
      async joinHousehold() {
        return {
          status: 'pending',
          household: {
            id: 'household-1',
            name: 'Kojori House',
            defaultLocale: 'ru'
          }
        }
      }
    }

    registerHouseholdSetupCommands({
      bot,
      householdSetupService: createRejectedHouseholdSetupService(),
      householdOnboardingService,
      householdAdminService: createHouseholdAdminService(),
      miniAppUrl: 'https://miniapp.example.app'
    })

    await bot.handleUpdate(startUpdate('/start join_join-token') as never)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.method).toBe('sendMessage')
    expect(calls[0]?.payload).toMatchObject({
      chat_id: 123456,
      text: 'Join request sent for Kojori House. Wait for a household admin to confirm you.',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: 'Open mini app',
              web_app: {
                url: 'https://miniapp.example.app/?join=join-token&bot=household_test_bot'
              }
            }
          ]
        ]
      }
    })
  })

  test('localizes the DM join response for Russian users', async () => {
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
            id: 123456,
            type: 'private'
          },
          text: 'ok'
        }
      } as never
    })

    const householdOnboardingService: HouseholdOnboardingService = {
      async ensureHouseholdJoinToken() {
        return {
          householdId: 'household-1',
          householdName: 'Kojori House',
          token: 'join-token'
        }
      },
      async getMiniAppAccess() {
        return {
          status: 'open_from_group'
        }
      },
      async joinHousehold() {
        return {
          status: 'pending',
          household: {
            id: 'household-1',
            name: 'Kojori House',
            defaultLocale: 'ru'
          }
        }
      }
    }

    registerHouseholdSetupCommands({
      bot,
      householdSetupService: createRejectedHouseholdSetupService(),
      householdOnboardingService,
      householdAdminService: createHouseholdAdminService(),
      miniAppUrl: 'https://miniapp.example.app'
    })

    await bot.handleUpdate(startUpdate('/start join_join-token', { languageCode: 'ru' }) as never)

    expect(calls[0]?.payload).toMatchObject({
      chat_id: 123456,
      text: 'Заявка на вступление в Kojori House отправлена. Дождитесь подтверждения от админа дома.',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: 'Открыть мини-приложение',
              web_app: {
                url: 'https://miniapp.example.app/?join=join-token&bot=household_test_bot'
              }
            }
          ]
        ]
      }
    })
  })

  test('shows setup checklist with create and bind buttons for missing topics', async () => {
    const bot = createTelegramBot('000000:test-token')
    const calls: Array<{ method: string; payload: unknown }> = []
    const repository = createHouseholdConfigurationRepository()

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
      allows_users_to_create_topics: true
    }

    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })

      if (method === 'getChatMember') {
        return {
          ok: true,
          result: {
            status: 'administrator',
            user: {
              id: 123456,
              is_bot: false,
              first_name: 'Stan'
            }
          }
        } as never
      }

      if (method === 'sendMessage') {
        return {
          ok: true,
          result: {
            message_id: calls.length,
            date: Math.floor(Date.now() / 1000),
            chat: {
              id: -100123456,
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

    const householdOnboardingService: HouseholdOnboardingService = {
      async ensureHouseholdJoinToken() {
        return {
          householdId: 'household-1',
          householdName: 'Kojori House',
          token: 'join-token'
        }
      },
      async getMiniAppAccess() {
        return {
          status: 'open_from_group'
        }
      },
      async joinHousehold() {
        return {
          status: 'pending',
          household: {
            id: 'household-1',
            name: 'Kojori House',
            defaultLocale: 'en'
          }
        }
      }
    }

    registerHouseholdSetupCommands({
      bot,
      householdSetupService: createHouseholdSetupService(repository),
      householdOnboardingService,
      householdAdminService: createHouseholdAdminService(),
      householdConfigurationRepository: repository,
      promptRepository: createPromptRepository()
    })

    await bot.handleUpdate(groupCommandUpdate('/setup Kojori House') as never)

    expect(calls).toHaveLength(2)
    const sendPayload = calls[1]?.payload as {
      chat_id?: number
      text?: string
      reply_markup?: unknown
    }

    expect(calls[1]).toMatchObject({
      method: 'sendMessage',
      payload: {
        chat_id: -100123456
      }
    })
    expect(sendPayload.text).toContain('Household created: Kojori House')
    expect(sendPayload.text).toContain('- purchases: not configured')
    expect(sendPayload.text).toContain('- payments: not configured')
    expect(sendPayload.reply_markup).toMatchObject({
      inline_keyboard: expect.arrayContaining([
        [
          {
            text: 'Join household',
            url: 'https://t.me/household_test_bot?start=join_join-token'
          }
        ],
        [
          {
            text: 'Create purchases topic',
            callback_data: 'setup_topic:create:purchase'
          },
          {
            text: 'Bind purchases topic',
            callback_data: 'setup_topic:bind:purchase'
          }
        ]
      ])
    })
  })

  test('creates a targeted in-group invite from a replied user message', async () => {
    const bot = createTelegramBot('000000:test-token')
    const calls: Array<{ method: string; payload: unknown }> = []
    const repository = createHouseholdConfigurationRepository()
    const promptRepository = createPromptRepository()

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
      allows_users_to_create_topics: true
    }

    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })

      if (method === 'getChatMember') {
        return {
          ok: true,
          result: {
            status: 'administrator',
            user: {
              id: 123456,
              is_bot: false,
              first_name: 'Stan'
            }
          }
        } as never
      }

      if (method === 'sendMessage') {
        return {
          ok: true,
          result: {
            message_id: 410,
            date: Math.floor(Date.now() / 1000),
            chat: {
              id: -100123456,
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

    const householdOnboardingService: HouseholdOnboardingService = {
      async ensureHouseholdJoinToken() {
        return {
          householdId: 'household-1',
          householdName: 'Kojori House',
          token: 'join-token'
        }
      },
      async getMiniAppAccess() {
        return {
          status: 'open_from_group'
        }
      },
      async joinHousehold() {
        return {
          status: 'pending',
          household: {
            id: 'household-1',
            name: 'Kojori House',
            defaultLocale: 'en'
          }
        }
      }
    }

    registerHouseholdSetupCommands({
      bot,
      householdSetupService: createHouseholdSetupService(repository),
      householdOnboardingService,
      householdAdminService: createHouseholdAdminService(),
      householdConfigurationRepository: repository,
      promptRepository
    })

    await bot.handleUpdate(groupCommandUpdate('/setup Kojori House') as never)
    calls.length = 0

    await bot.handleUpdate(
      groupReplyCommandUpdate('/invite', { id: 654321, firstName: 'Chorbanaut' }) as never
    )

    expect(calls[1]).toMatchObject({
      method: 'sendMessage',
      payload: {
        chat_id: -100123456,
        text: 'Invitation prepared for Chorbanaut. Tap below to join Kojori House.',
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: 'Join household',
                url: 'https://t.me/household_test_bot?start=invite_-100123456_654321'
              }
            ]
          ]
        }
      }
    })

    expect(await promptRepository.getPendingAction('invite:-100123456', '654321')).toMatchObject({
      action: 'household_group_invite',
      payload: {
        joinToken: 'join-token',
        householdId: 'household-1',
        householdName: 'Kojori House',
        targetDisplayName: 'Chorbanaut',
        inviteMessageId: 410
      }
    })
  })

  test('rejects household invite links for the wrong Telegram user', async () => {
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
      allows_users_to_create_topics: true
    }

    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })
      return {
        ok: true,
        result: {
          message_id: 1,
          date: Math.floor(Date.now() / 1000),
          chat: {
            id: 111111,
            type: 'private'
          },
          text: (payload as { text?: string }).text ?? 'ok'
        }
      } as never
    })

    registerHouseholdSetupCommands({
      bot,
      householdSetupService: createRejectedHouseholdSetupService(),
      householdOnboardingService: {
        async ensureHouseholdJoinToken() {
          return {
            householdId: 'household-1',
            householdName: 'Kojori House',
            token: 'join-token'
          }
        },
        async getMiniAppAccess() {
          return {
            status: 'open_from_group'
          }
        },
        async joinHousehold() {
          return {
            status: 'invalid_token'
          }
        }
      },
      householdAdminService: createHouseholdAdminService(),
      promptRepository: createPromptRepository()
    })

    await bot.handleUpdate(
      startUpdate('/start invite_-100123456_654321', {
        userId: 111111,
        firstName: 'Wrong user'
      }) as never
    )

    expect(calls[0]).toMatchObject({
      method: 'sendMessage',
      payload: {
        chat_id: 111111,
        text: 'This invite is for a different Telegram user.'
      }
    })
  })

  test('consumes a targeted invite for the invited user and updates the group message', async () => {
    const bot = createTelegramBot('000000:test-token')
    const calls: Array<{ method: string; payload: unknown }> = []
    const repository = createHouseholdConfigurationRepository()
    const promptRepository = createPromptRepository()
    const joinCalls: string[] = []

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
      allows_users_to_create_topics: true
    }

    const householdOnboardingService: HouseholdOnboardingService = {
      async ensureHouseholdJoinToken() {
        return {
          householdId: 'household-1',
          householdName: 'Kojori House',
          token: 'join-token'
        }
      },
      async getMiniAppAccess(input) {
        if (joinCalls.includes(input.identity.telegramUserId)) {
          return {
            status: 'pending',
            household: {
              id: 'household-1',
              name: 'Kojori House',
              defaultLocale: 'en'
            }
          }
        }

        return {
          status: 'open_from_group'
        }
      },
      async joinHousehold(input) {
        joinCalls.push(input.identity.telegramUserId)
        return {
          status: 'pending',
          household: {
            id: 'household-1',
            name: 'Kojori House',
            defaultLocale: 'en'
          }
        }
      }
    }

    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })

      if (method === 'getChatMember') {
        return {
          ok: true,
          result: {
            status: 'administrator',
            user: {
              id: 123456,
              is_bot: false,
              first_name: 'Stan'
            }
          }
        } as never
      }

      if (method === 'sendMessage') {
        const chatId = (payload as { chat_id?: number }).chat_id ?? 0
        return {
          ok: true,
          result: {
            message_id: chatId === -100123456 ? 411 : 1,
            date: Math.floor(Date.now() / 1000),
            chat: {
              id: chatId,
              type: chatId > 0 ? 'private' : 'supergroup'
            },
            text: (payload as { text?: string }).text ?? 'ok'
          }
        } as never
      }

      if (method === 'editMessageText') {
        return {
          ok: true,
          result: {
            message_id: (payload as { message_id?: number }).message_id ?? 411,
            date: Math.floor(Date.now() / 1000),
            chat: {
              id: (payload as { chat_id?: number }).chat_id ?? -100123456,
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

    registerHouseholdSetupCommands({
      bot,
      householdSetupService: createHouseholdSetupService(repository),
      householdOnboardingService,
      householdAdminService: createHouseholdAdminService(),
      householdConfigurationRepository: repository,
      promptRepository
    })

    await bot.handleUpdate(groupCommandUpdate('/setup Kojori House') as never)
    calls.length = 0
    await bot.handleUpdate(
      groupReplyCommandUpdate('/invite', { id: 654321, firstName: 'Chorbanaut' }) as never
    )

    calls.length = 0
    await bot.handleUpdate(
      startUpdate('/start invite_-100123456_654321', {
        userId: 654321,
        firstName: 'Chorbanaut'
      }) as never
    )

    expect(calls[0]).toMatchObject({
      method: 'editMessageText',
      payload: {
        chat_id: -100123456,
        message_id: 411,
        text: 'Chorbanaut sent a join request for Kojori House.'
      }
    })
    expect(calls[1]).toMatchObject({
      method: 'sendMessage',
      payload: {
        chat_id: 654321,
        text: 'Join request sent for Kojori House. Wait for a household admin to confirm you.'
      }
    })

    expect(await promptRepository.getPendingAction('invite:-100123456', '654321')).toMatchObject({
      action: 'household_group_invite',
      payload: {
        completed: true
      }
    })

    calls.length = 0
    await bot.handleUpdate(
      startUpdate('/start invite_-100123456_654321', {
        userId: 654321,
        firstName: 'Chorbanaut'
      }) as never
    )

    expect(calls[0]).toMatchObject({
      method: 'editMessageText',
      payload: {
        chat_id: -100123456,
        message_id: 411,
        text: 'Chorbanaut sent a join request for Kojori House.'
      }
    })
    expect(calls[1]).toMatchObject({
      method: 'sendMessage',
      payload: {
        chat_id: 654321,
        text: 'Join request sent for Kojori House. Wait for a household admin to confirm you.'
      }
    })
  })

  test('creates and binds a missing setup topic from callback', async () => {
    const bot = createTelegramBot('000000:test-token')
    const calls: Array<{ method: string; payload: unknown }> = []
    const repository = createHouseholdConfigurationRepository()
    const promptRepository = createPromptRepository()
    const householdOnboardingService: HouseholdOnboardingService = {
      async ensureHouseholdJoinToken() {
        return {
          householdId: 'household-1',
          householdName: 'Kojori House',
          token: 'join-token'
        }
      },
      async getMiniAppAccess() {
        return {
          status: 'open_from_group'
        }
      },
      async joinHousehold() {
        return {
          status: 'pending',
          household: {
            id: 'household-1',
            name: 'Kojori House',
            defaultLocale: 'en'
          }
        }
      }
    }

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
      allows_users_to_create_topics: true
    }

    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })

      if (method === 'getChatMember') {
        return {
          ok: true,
          result: {
            status: 'administrator',
            user: {
              id: 123456,
              is_bot: false,
              first_name: 'Stan'
            }
          }
        } as never
      }

      if (method === 'createForumTopic') {
        return {
          ok: true,
          result: {
            name: 'Purchases',
            icon_color: 7322096,
            message_thread_id: 77
          }
        } as never
      }

      return {
        ok: true,
        result:
          method === 'editMessageText'
            ? {
                message_id: 91,
                date: Math.floor(Date.now() / 1000),
                chat: {
                  id: -100123456,
                  type: 'supergroup'
                },
                text: (payload as { text?: string }).text ?? 'ok'
              }
            : true
      } as never
    })

    registerHouseholdSetupCommands({
      bot,
      householdSetupService: createHouseholdSetupService(repository),
      householdOnboardingService,
      householdAdminService: createHouseholdAdminService(),
      householdConfigurationRepository: repository,
      promptRepository
    })

    await bot.handleUpdate(groupCommandUpdate('/setup Kojori House') as never)
    calls.length = 0

    await bot.handleUpdate(groupCallbackUpdate('setup_topic:create:purchase') as never)

    expect(calls[1]).toMatchObject({
      method: 'createForumTopic',
      payload: {
        chat_id: -100123456,
        name: 'Shared purchases'
      }
    })
    expect(calls[2]).toMatchObject({
      method: 'answerCallbackQuery',
      payload: {
        callback_query_id: 'callback-1',
        text: 'purchases topic created and bound: Shared purchases.'
      }
    })
    expect(calls[3]).toMatchObject({
      method: 'editMessageText',
      payload: {
        chat_id: -100123456,
        message_id: 91,
        text: expect.stringContaining('- purchases: bound to Shared purchases')
      }
    })

    expect(await repository.getHouseholdTopicBinding('household-1', 'purchase')).toMatchObject({
      telegramThreadId: '77',
      topicName: 'Shared purchases'
    })
  })

  test('arms manual setup topic binding and consumes the next topic message', async () => {
    const bot = createTelegramBot('000000:test-token')
    const calls: Array<{ method: string; payload: unknown }> = []
    const repository = createHouseholdConfigurationRepository()
    const promptRepository = createPromptRepository()
    const householdOnboardingService: HouseholdOnboardingService = {
      async ensureHouseholdJoinToken() {
        return {
          householdId: 'household-1',
          householdName: 'Kojori House',
          token: 'join-token'
        }
      },
      async getMiniAppAccess() {
        return {
          status: 'open_from_group'
        }
      },
      async joinHousehold() {
        return {
          status: 'pending',
          household: {
            id: 'household-1',
            name: 'Kojori House',
            defaultLocale: 'en'
          }
        }
      }
    }

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
      allows_users_to_create_topics: true
    }

    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })

      if (method === 'getChatMember') {
        return {
          ok: true,
          result: {
            status: 'administrator',
            user: {
              id: 123456,
              is_bot: false,
              first_name: 'Stan'
            }
          }
        } as never
      }

      if (method === 'sendMessage') {
        return {
          ok: true,
          result: {
            message_id: calls.length,
            date: Math.floor(Date.now() / 1000),
            chat: {
              id: -100123456,
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

    registerHouseholdSetupCommands({
      bot,
      householdSetupService: createHouseholdSetupService(repository),
      householdOnboardingService,
      householdAdminService: createHouseholdAdminService(),
      householdConfigurationRepository: repository,
      promptRepository
    })

    await bot.handleUpdate(groupCommandUpdate('/setup Kojori House') as never)
    calls.length = 0

    await bot.handleUpdate(groupCallbackUpdate('setup_topic:bind:payments') as never)

    expect(calls[1]).toMatchObject({
      method: 'answerCallbackQuery',
      payload: {
        callback_query_id: 'callback-1',
        text: 'Binding mode is on for payments. Open the target topic and send any message there within 10 minutes.'
      }
    })
    expect(await promptRepository.getPendingAction('-100123456', '123456')).toMatchObject({
      action: 'setup_topic_binding',
      payload: {
        role: 'payments',
        setupMessageId: 91
      }
    })

    calls.length = 0
    await bot.handleUpdate(topicMessageUpdate('hello from payments', 444) as never)

    expect(calls).toHaveLength(3)
    expect(calls[1]).toMatchObject({
      method: 'editMessageText',
      payload: {
        chat_id: -100123456,
        message_id: 91,
        text: expect.stringContaining('- payments: bound to thread 444')
      }
    })
    expect(calls[2]).toMatchObject({
      method: 'sendMessage',
      payload: {
        chat_id: -100123456,
        message_thread_id: 444,
        text: 'Payments topic saved for Kojori House (thread 444).'
      }
    })
    expect(await promptRepository.getPendingAction('-100123456', '123456')).toBeNull()
    expect(await repository.getHouseholdTopicBinding('household-1', 'payments')).toMatchObject({
      telegramThreadId: '444'
    })
  })

  test('resets setup state with /unsetup and clears pending setup bindings', async () => {
    const bot = createTelegramBot('000000:test-token')
    const calls: Array<{ method: string; payload: unknown }> = []
    const repository = createHouseholdConfigurationRepository()
    const promptRepository = createPromptRepository()
    const householdOnboardingService: HouseholdOnboardingService = {
      async ensureHouseholdJoinToken() {
        return {
          householdId: 'household-1',
          householdName: 'Kojori House',
          token: 'join-token'
        }
      },
      async getMiniAppAccess() {
        return {
          status: 'open_from_group'
        }
      },
      async joinHousehold() {
        return {
          status: 'pending',
          household: {
            id: 'household-1',
            name: 'Kojori House',
            defaultLocale: 'en'
          }
        }
      }
    }

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
      allows_users_to_create_topics: true
    }

    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })

      if (method === 'getChatMember') {
        return {
          ok: true,
          result: {
            status: 'administrator',
            user: {
              id: 123456,
              is_bot: false,
              first_name: 'Stan'
            }
          }
        } as never
      }

      if (method === 'sendMessage') {
        return {
          ok: true,
          result: {
            message_id: calls.length,
            date: Math.floor(Date.now() / 1000),
            chat: {
              id: -100123456,
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

    const householdSetupService = createHouseholdSetupService(repository)

    registerHouseholdSetupCommands({
      bot,
      householdSetupService,
      householdOnboardingService,
      householdAdminService: createHouseholdAdminService(),
      householdConfigurationRepository: repository,
      promptRepository
    })

    await bot.handleUpdate(groupCommandUpdate('/setup Kojori House') as never)
    await householdSetupService.bindTopic({
      actorIsAdmin: true,
      telegramChatId: '-100123456',
      role: 'purchase',
      telegramThreadId: '777',
      topicName: 'Shared purchases'
    })
    await promptRepository.upsertPendingAction({
      telegramUserId: '123456',
      telegramChatId: '-100123456',
      action: 'setup_topic_binding',
      payload: {
        role: 'payments'
      },
      expiresAt: nowInstant().add({ minutes: 10 })
    })

    calls.length = 0
    await bot.handleUpdate(groupCommandUpdate('/unsetup') as never)

    expect(calls[1]).toMatchObject({
      method: 'sendMessage',
      payload: {
        chat_id: -100123456,
        text: 'Setup state reset for Kojori House. Run /setup again to bind topics from scratch.'
      }
    })
    expect(await repository.listHouseholdTopicBindings('household-1')).toEqual([])
    expect(await repository.getTelegramHouseholdChat('-100123456')).toMatchObject({
      householdId: 'household-1'
    })
    expect(await promptRepository.getPendingAction('-100123456', '123456')).toBeNull()
  })

  test('treats repeated /unsetup as a safe no-op', async () => {
    const bot = createTelegramBot('000000:test-token')
    const calls: Array<{ method: string; payload: unknown }> = []
    const repository = createHouseholdConfigurationRepository()

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
      allows_users_to_create_topics: true
    }

    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })

      if (method === 'getChatMember') {
        return {
          ok: true,
          result: {
            status: 'administrator',
            user: {
              id: 123456,
              is_bot: false,
              first_name: 'Stan'
            }
          }
        } as never
      }

      if (method === 'sendMessage') {
        return {
          ok: true,
          result: {
            message_id: calls.length,
            date: Math.floor(Date.now() / 1000),
            chat: {
              id: -100123456,
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

    registerHouseholdSetupCommands({
      bot,
      householdSetupService: createHouseholdSetupService(repository),
      householdOnboardingService: {
        async ensureHouseholdJoinToken() {
          return {
            householdId: 'household-1',
            householdName: 'Kojori House',
            token: 'join-token'
          }
        },
        async getMiniAppAccess() {
          return {
            status: 'open_from_group'
          }
        },
        async joinHousehold() {
          return {
            status: 'pending',
            household: {
              id: 'household-1',
              name: 'Kojori House',
              defaultLocale: 'en'
            }
          }
        }
      },
      householdAdminService: createHouseholdAdminService(),
      householdConfigurationRepository: repository,
      promptRepository: createPromptRepository()
    })

    await bot.handleUpdate(groupCommandUpdate('/unsetup') as never)

    expect(calls[1]).toMatchObject({
      method: 'sendMessage',
      payload: {
        chat_id: -100123456,
        text: 'Nothing to reset for this group yet. Run /setup when you are ready.'
      }
    })
  })
})
