import { describe, expect, test } from 'bun:test'

import type {
  HouseholdAdminService,
  HouseholdOnboardingService,
  HouseholdSetupService
} from '@household/application'

import { createTelegramBot } from './bot'
import { buildJoinMiniAppUrl, registerHouseholdSetupCommands } from './household-setup'

function startUpdate(text: string) {
  const commandToken = text.split(' ')[0] ?? text

  return {
    update_id: 2001,
    message: {
      message_id: 71,
      date: Math.floor(Date.now() / 1000),
      chat: {
        id: 123456,
        type: 'private'
      },
      from: {
        id: 123456,
        is_bot: false,
        first_name: 'Stan'
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

function createHouseholdSetupService(): HouseholdSetupService {
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
            name: 'Kojori House'
          }
        }
      }
    }

    registerHouseholdSetupCommands({
      bot,
      householdSetupService: createHouseholdSetupService(),
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
})
