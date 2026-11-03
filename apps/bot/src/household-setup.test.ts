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

function createUnusedHouseholdOnboardingService(): HouseholdOnboardingService {
  return {
    async ensureHouseholdJoinToken() {
      throw new Error('not used')
    },
    async getMiniAppAccess() {
      throw new Error('not used')
    },
    async joinHousehold() {
      throw new Error('not used')
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
        preferredUtilityPayerMemberId: null,
        timezone: 'Asia/Tbilisi',
        rentPaymentDestinations: null
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
        preferredUtilityPayerMemberId: input.preferredUtilityPayerMemberId ?? null,
        timezone: input.timezone ?? 'Asia/Tbilisi',
        rentPaymentDestinations: input.rentPaymentDestinations ?? null
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
    async rejectPendingHouseholdMember() {
      return false
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
    async demoteHouseholdAdmin() {
      return null
    },
    async updateHouseholdMemberRentShareWeight() {
      return null
    },
    async updateHouseholdMemberStatus() {
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

    expect(url).toBe('https://household-dev-mini-app.example.app/?bot=kojori_bot&join=join-token')
  })

  test('returns null when no mini app url is configured', () => {
    expect(buildJoinMiniAppUrl(undefined, 'kojori_bot', 'join-token')).toBeNull()
  })
})

describe('registerHouseholdSetupCommands', () => {
  test('opens the mini app from a dashboard start payload in private chat', async () => {
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

    registerHouseholdSetupCommands({
      bot,
      householdSetupService: createRejectedHouseholdSetupService(),
      householdOnboardingService: createUnusedHouseholdOnboardingService(),
      householdAdminService: createHouseholdAdminService(),
      miniAppUrl: 'https://miniapp.example.app'
    })

    await bot.handleUpdate(startUpdate('/start dashboard') as never)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.payload).toMatchObject({
      chat_id: 123456,
      text: '📱 The app opens with the button below.',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '📱 Open the app',
              web_app: {
                url: 'https://miniapp.example.app/?bot=household_test_bot'
              }
            }
          ]
        ]
      }
    })
  })

  test('opens Telegram home from a plain private start payload', async () => {
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

    registerHouseholdSetupCommands({
      bot,
      householdSetupService: createRejectedHouseholdSetupService(),
      householdOnboardingService: createUnusedHouseholdOnboardingService(),
      householdAdminService: createHouseholdAdminService(),
      miniAppUrl: 'https://miniapp.example.app'
    })

    await bot.handleUpdate(startUpdate('/start') as never)

    const payload = calls[0]?.payload as
      | {
          text?: string
          reply_markup?: {
            inline_keyboard?: Array<
              Array<{ text: string; callback_data?: string; web_app?: { url: string } }>
            >
          }
        }
      | undefined
    expect(payload?.text).toBe('🏠 <b>Household menu</b>\nWhat would you like to see?')
    expect(calls[0]?.payload).toMatchObject({ parse_mode: 'HTML' })
    expect(payload?.reply_markup?.inline_keyboard).toEqual([
      [
        { text: '💸 My bill', callback_data: 'home:my_bill' },
        { text: '🏠 Household', callback_data: 'home:status' }
      ],
      [
        { text: '🛒 Purchases', callback_data: 'home:balances' },
        { text: '🔎 Details', callback_data: 'home:my_bill_full' }
      ],
      [
        { text: '🧹 Chores', callback_data: 'home:routines' },
        {
          text: '📱 App',
          web_app: { url: 'https://miniapp.example.app/?bot=household_test_bot' }
        }
      ],
      [{ text: '❔ Help', callback_data: 'home:help' }]
    ])
  })

  test('renders private home with feedback action only when available', async () => {
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

    registerHouseholdSetupCommands({
      bot,
      householdSetupService: createRejectedHouseholdSetupService(),
      householdOnboardingService: createUnusedHouseholdOnboardingService(),
      householdAdminService: createHouseholdAdminService(),
      anonymousFeedbackAvailable: true
    })

    await bot.handleUpdate(startUpdate('/start') as never)

    const payload = calls[0]?.payload as
      | {
          reply_markup?: {
            inline_keyboard?: Array<Array<{ text: string; callback_data?: string }>>
          }
        }
      | undefined
    expect(payload?.reply_markup?.inline_keyboard).toEqual([
      [
        { text: '💸 My bill', callback_data: 'home:my_bill' },
        { text: '🏠 Household', callback_data: 'home:status' }
      ],
      [
        { text: '🛒 Purchases', callback_data: 'home:balances' },
        { text: '🔎 Details', callback_data: 'home:my_bill_full' }
      ],
      [
        { text: '🧹 Chores', callback_data: 'home:routines' },
        { text: '🕶 Anonymous', callback_data: 'home:feedback' }
      ],
      [{ text: '❔ Help', callback_data: 'home:help' }]
    ])
    expect(JSON.stringify(payload?.reply_markup)).not.toContain('📱')
  })

  test('opens the same task menu from /home in private chat', async () => {
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

    registerHouseholdSetupCommands({
      bot,
      householdSetupService: createRejectedHouseholdSetupService(),
      householdOnboardingService: createUnusedHouseholdOnboardingService(),
      householdAdminService: createHouseholdAdminService(),
      anonymousFeedbackAvailable: true
    })

    await bot.handleUpdate(startUpdate('/home') as never)

    const payload = calls[0]?.payload as { text?: string } | undefined
    expect(payload?.text).toBe('🏠 <b>Household menu</b>\nWhat would you like to see?')
  })

  test('renders group home with setup action for Telegram admins', async () => {
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

      return {
        ok: true,
        result: {
          message_id: calls.length,
          date: Math.floor(Date.now() / 1000),
          chat: {
            id: -100123456,
            type: 'supergroup'
          },
          text: 'ok'
        }
      } as never
    })

    registerHouseholdSetupCommands({
      bot,
      householdSetupService: createRejectedHouseholdSetupService(),
      householdOnboardingService: createUnusedHouseholdOnboardingService(),
      householdAdminService: createHouseholdAdminService(),
      miniAppUrl: 'https://miniapp.example.app',
      anonymousFeedbackAvailable: true
    })

    await bot.handleUpdate(groupCommandUpdate('/home') as never)

    const payload = calls.find((call) => call.method === 'sendMessage')?.payload as
      | {
          reply_markup?: {
            inline_keyboard?: Array<Array<{ text: string; callback_data?: string; url?: string }>>
          }
        }
      | undefined
    expect(payload?.reply_markup?.inline_keyboard).toEqual([
      [
        { text: '💸 My bill', callback_data: 'home:my_bill' },
        { text: '🏠 Household', callback_data: 'home:status' }
      ],
      [
        { text: '🛒 Purchases', callback_data: 'home:balances' },
        { text: '🔎 Details', callback_data: 'home:my_bill_full' }
      ],
      [
        { text: '📱 App', url: 'https://t.me/household_test_bot/app' },
        { text: '⚙️ Setup', callback_data: 'home:setup' }
      ],
      [{ text: '❔ Help', callback_data: 'home:help' }]
    ])
    expect(
      (calls.find((call) => call.method === 'sendMessage')?.payload as { text?: string })?.text
    ).toBe('🏠 <b>Household menu</b>\nBills, payments and purchases — all in one place.')
    expect(JSON.stringify(payload?.reply_markup)).not.toContain('home:feedback')
    expect(JSON.stringify(payload?.reply_markup)).not.toContain('home:routines')
  })

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
      parse_mode: 'HTML',
      text: '⏳ Request to join <b>Kojori House</b> sent — now an admin just needs to approve it.',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '📱 Open the app',
              web_app: {
                url: 'https://miniapp.example.app/?bot=household_test_bot&join=join-token'
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
      parse_mode: 'HTML',
      text: '⏳ Заявка в <b>Kojori House</b> отправлена — осталось дождаться админа.',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '📱 Открыть приложение',
              web_app: {
                url: 'https://miniapp.example.app/?bot=household_test_bot&join=join-token'
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
    expect(sendPayload.text).toBe(
      [
        '🎉 <b>Kojori House</b> — your new household is ready!',
        '',
        'Next, give each conversation its topic.',
        '',
        '<b>Topics: 0 of 5</b>',
        'Create the missing ones below or bind your own: /bind inside a topic.',
        '⬜ Purchases  ⬜ Anonymous',
        '⬜ Reminders  ⬜ Payments',
        '⬜ Notifications'
      ].join('\n')
    )
    expect(calls[1]?.payload).toMatchObject({ parse_mode: 'HTML' })
    expect(sendPayload.reply_markup).toEqual({
      inline_keyboard: [
        [
          { text: '+ Purchases', callback_data: 'setup_topic:create:purchase' },
          { text: '+ Anonymous', callback_data: 'setup_topic:create:feedback' },
          { text: '+ Reminders', callback_data: 'setup_topic:create:reminders' }
        ],
        [
          { text: '+ Payments', callback_data: 'setup_topic:create:payments' },
          { text: '+ Notifications', callback_data: 'setup_topic:create:notifications' }
        ],
        [
          {
            text: 'Join the household',
            url: 'https://t.me/household_test_bot?start=join_join-token'
          }
        ]
      ]
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
        text: '✅ Topic "Shared purchases" created: Purchases.'
      }
    })
    const editedText = (calls[3]?.payload as { text?: string } | undefined)?.text
    expect(calls[3]).toMatchObject({
      method: 'editMessageText',
      payload: {
        chat_id: -100123456,
        message_id: 91
      }
    })
    expect(editedText).toContain('<b>Topics: 1 of 5</b>')
    expect(editedText).toContain('✅ Purchases  ⬜ Anonymous')

    expect(await repository.getHouseholdTopicBinding('household-1', 'purchase')).toMatchObject({
      telegramThreadId: '77',
      topicName: 'Shared purchases'
    })
  })

  test('sends the invite link with no pending requests via /invite', async () => {
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
            message_id: 500,
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
          token: 'test-join-token'
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
    calls.length = 0

    await bot.handleUpdate(groupCommandUpdate('/invite') as never)

    expect(calls.filter((call) => call.method === 'sendMessage')).toHaveLength(1)
    expect(calls[1]).toMatchObject({
      method: 'sendMessage',
      payload: {
        chat_id: -100123456,
        parse_mode: 'HTML',
        text: '🔗 <b>Invite to Kojori House</b>\n<code>https://t.me/household_test_bot?start=join_test-join-token</code>\n\nNo new requests.',
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: 'Join the household',
                url: 'https://t.me/household_test_bot?start=join_test-join-token'
              }
            ]
          ]
        }
      }
    })
  })

  test('lists pending requests with approve buttons in the /invite message', async () => {
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

      return {
        ok: true,
        result: {
          message_id: 500,
          date: Math.floor(Date.now() / 1000),
          chat: {
            id: -100123456,
            type: 'supergroup'
          },
          text: (payload as { text?: string }).text ?? 'ok'
        }
      } as never
    })

    const pendingMember = (
      telegramUserId: string,
      displayName: string,
      username: string | null
    ): HouseholdPendingMemberRecord => ({
      householdId: 'household-1',
      householdName: 'Kojori House',
      telegramUserId,
      displayName,
      username,
      languageCode: 'en',
      householdDefaultLocale: 'en'
    })

    registerHouseholdSetupCommands({
      bot,
      householdSetupService: createHouseholdSetupService(repository),
      householdOnboardingService: {
        async ensureHouseholdJoinToken() {
          return {
            householdId: 'household-1',
            householdName: 'Kojori House',
            token: 'test-join-token'
          }
        },
        async getMiniAppAccess() {
          return {
            status: 'open_from_group'
          }
        },
        async joinHousehold() {
          throw new Error('not used')
        }
      },
      householdAdminService: {
        async listPendingMembers() {
          return {
            status: 'ok',
            householdName: 'Kojori House',
            members: [
              pendingMember('201', 'Ion <Admin>', 'ion'),
              pendingMember('202', 'Dima', null),
              pendingMember('203', 'Nika', 'nika')
            ]
          }
        },
        async approvePendingMember() {
          throw new Error('not used')
        }
      },
      householdConfigurationRepository: repository,
      promptRepository: createPromptRepository()
    })

    await bot.handleUpdate(groupCommandUpdate('/setup Kojori House') as never)
    calls.length = 0

    await bot.handleUpdate(groupCommandUpdate('/invite') as never)

    expect(calls[1]).toMatchObject({
      method: 'sendMessage',
      payload: {
        chat_id: -100123456,
        parse_mode: 'HTML',
        text: [
          '🔗 <b>Invite to Kojori House</b>',
          '<code>https://t.me/household_test_bot?start=join_test-join-token</code>',
          '',
          'Waiting for approval:',
          '• <b>Ion &lt;Admin&gt;</b> · @ion',
          '• <b>Dima</b>',
          '• <b>Nika</b> · @nika'
        ].join('\n'),
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: 'Join the household',
                url: 'https://t.me/household_test_bot?start=join_test-join-token'
              }
            ],
            [
              { text: '✅ Ion <Admin>', callback_data: 'approve_member:201' },
              { text: '✅ Dima', callback_data: 'approve_member:202' }
            ],
            [{ text: '✅ Nika', callback_data: 'approve_member:203' }]
          ]
        }
      }
    })
  })
})
