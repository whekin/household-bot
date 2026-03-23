import { describe, expect, test } from 'bun:test'
import type { HouseholdConfigurationRepository } from '@household/ports'

import { createTelegramBot } from './bot'

function helpUpdate(languageCode: string) {
  return {
    update_id: 9001,
    message: {
      message_id: 1,
      date: Math.floor(Date.now() / 1000),
      chat: {
        id: 123456,
        type: 'private'
      },
      from: {
        id: 123456,
        is_bot: false,
        first_name: 'Stan',
        language_code: languageCode
      },
      text: '/help',
      entities: [
        {
          offset: 0,
          length: 5,
          type: 'bot_command'
        }
      ]
    }
  }
}

function groupHelpUpdate(languageCode: string) {
  return {
    update_id: 9002,
    message: {
      message_id: 2,
      date: Math.floor(Date.now() / 1000),
      chat: {
        id: -100123456,
        type: 'supergroup',
        title: 'Kojori'
      },
      from: {
        id: 123456,
        is_bot: false,
        first_name: 'Stan',
        language_code: languageCode
      },
      message_thread_id: 7,
      text: '/help',
      entities: [
        {
          offset: 0,
          length: 5,
          type: 'bot_command'
        }
      ]
    }
  }
}

function createRepository(isAdmin = false): HouseholdConfigurationRepository {
  return {
    registerTelegramHouseholdChat: async () => {
      throw new Error('not implemented')
    },
    getTelegramHouseholdChat: async () => null,
    getHouseholdChatByHouseholdId: async () => null,
    bindHouseholdTopic: async () => {
      throw new Error('not implemented')
    },
    getHouseholdTopicBinding: async () => null,
    findHouseholdTopicByTelegramContext: async () => null,
    listHouseholdTopicBindings: async () => [],
    clearHouseholdTopicBindings: async () => {},
    listReminderTargets: async () => [],
    upsertHouseholdJoinToken: async () => {
      throw new Error('not implemented')
    },
    getHouseholdJoinToken: async () => null,
    getHouseholdByJoinToken: async () => null,
    upsertPendingHouseholdMember: async () => {
      throw new Error('not implemented')
    },
    getPendingHouseholdMember: async () => null,
    findPendingHouseholdMemberByTelegramUserId: async () => null,
    ensureHouseholdMember: async () => {
      throw new Error('not implemented')
    },
    getHouseholdMember: async () => null,
    listHouseholdMembers: async () => [],
    getHouseholdBillingSettings: async () => ({
      householdId: 'household-1',
      settlementCurrency: 'GEL',
      rentAmountMinor: null,
      rentCurrency: 'USD',
      rentDueDay: 20,
      rentWarningDay: 17,
      utilitiesDueDay: 4,
      utilitiesReminderDay: 3,
      timezone: 'Asia/Tbilisi',
      rentPaymentDestinations: null
    }),
    updateHouseholdBillingSettings: async () => {
      throw new Error('not implemented')
    },
    listHouseholdUtilityCategories: async () => [],
    upsertHouseholdUtilityCategory: async () => {
      throw new Error('not implemented')
    },
    listHouseholdMembersByTelegramUserId: async () =>
      isAdmin
        ? [
            {
              id: 'member-1',
              householdId: 'household-1',
              telegramUserId: '123456',
              displayName: 'Stan',
              status: 'active',
              preferredLocale: 'ru',
              householdDefaultLocale: 'ru',
              rentShareWeight: 1,
              isAdmin: true
            }
          ]
        : [],
    listPendingHouseholdMembers: async () => [],
    approvePendingHouseholdMember: async () => null,
    rejectPendingHouseholdMember: async () => false,
    updateHouseholdDefaultLocale: async () => {
      throw new Error('not implemented')
    },
    updateMemberPreferredLocale: async () => null,
    updateHouseholdMemberDisplayName: async () => null,
    promoteHouseholdAdmin: async () => null,
    demoteHouseholdAdmin: async () => null,
    updateHouseholdMemberRentShareWeight: async () => null,
    updateHouseholdMemberStatus: async () => null,
    listHouseholdMemberAbsencePolicies: async () => [],
    upsertHouseholdMemberAbsencePolicy: async () => null
  }
}

describe('createTelegramBot i18n', () => {
  test('replies with Russian help text for Russian users', async () => {
    const bot = createTelegramBot('000000:test-token', undefined, createRepository(false))
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

    await bot.handleUpdate(helpUpdate('ru') as never)

    expect(calls[0]?.payload).toMatchObject({
      chat_id: 123456
    })

    const payload = calls[0]?.payload as { text?: string } | undefined
    expect(payload?.text).toContain('Бот для дома подключен.')
    expect(payload?.text).toContain('/anon - Отправить анонимное сообщение по дому')
    expect(payload?.text).not.toContain('/setup')
  })

  test('shows admin commands in private help for household admins', async () => {
    const bot = createTelegramBot('000000:test-token', undefined, createRepository(true))
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

    await bot.handleUpdate(helpUpdate('ru') as never)

    const payload = calls[0]?.payload as { text?: string } | undefined
    expect(payload?.text).toContain('/setup - Подключить эту группу как дом')
  })

  test('shows admin commands in group help for Telegram group admins', async () => {
    const bot = createTelegramBot('000000:test-token', undefined, createRepository(false))
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

    await bot.handleUpdate(groupHelpUpdate('en') as never)

    const payload = calls.find((call) => call.method === 'sendMessage')?.payload as
      | { text?: string }
      | undefined
    expect(payload?.text).toContain('/setup - Register this group as a household')
    expect(payload?.text).not.toContain('/anon - Send anonymous household feedback')
  })
})
