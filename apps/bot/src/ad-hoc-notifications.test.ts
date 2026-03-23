import { describe, expect, test } from 'bun:test'

import type { AdHocNotificationService } from '@household/application'
import { Temporal } from '@household/domain'
import type {
  HouseholdAssistantConfigRecord,
  HouseholdBillingSettingsRecord,
  HouseholdMemberRecord,
  TelegramPendingActionRecord,
  TelegramPendingActionRepository
} from '@household/ports'

import { createTelegramBot } from './bot'
import { registerAdHocNotifications } from './ad-hoc-notifications'
import type { AdHocNotificationInterpreter } from './openai-ad-hoc-notification-interpreter'

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

function reminderMessageUpdate(text: string, threadId = 777) {
  return {
    update_id: 4001,
    message: {
      message_id: 55,
      date: Math.floor(Date.now() / 1000),
      message_thread_id: threadId,
      is_topic_message: true,
      chat: {
        id: -10012345,
        type: 'supergroup'
      },
      from: {
        id: 10002,
        is_bot: false,
        first_name: 'Dima'
      },
      text
    }
  }
}

function reminderCallbackUpdate(data: string, threadId = 777) {
  return {
    update_id: 4002,
    callback_query: {
      id: 'callback-adhoc-1',
      from: {
        id: 10002,
        is_bot: false,
        first_name: 'Dima'
      },
      chat_instance: 'instance-1',
      data,
      message: {
        message_id: 99,
        date: Math.floor(Date.now() / 1000),
        message_thread_id: threadId,
        chat: {
          id: -10012345,
          type: 'supergroup'
        },
        text: 'placeholder'
      }
    }
  }
}

function member(
  input: Partial<HouseholdMemberRecord> & Pick<HouseholdMemberRecord, 'id'>
): HouseholdMemberRecord {
  return {
    id: input.id,
    householdId: input.householdId ?? 'household-1',
    telegramUserId: input.telegramUserId ?? `${input.id}-tg`,
    displayName: input.displayName ?? input.id,
    status: input.status ?? 'active',
    preferredLocale: input.preferredLocale ?? 'ru',
    householdDefaultLocale: input.householdDefaultLocale ?? 'ru',
    rentShareWeight: input.rentShareWeight ?? 1,
    isAdmin: input.isAdmin ?? false
  }
}

function createHouseholdRepository() {
  const members = [
    member({ id: 'dima', telegramUserId: '10002', displayName: 'Дима' }),
    member({ id: 'georgiy', displayName: 'Георгий' })
  ]
  const settings: HouseholdBillingSettingsRecord = {
    householdId: 'household-1',
    settlementCurrency: 'GEL',
    rentAmountMinor: 0n,
    rentCurrency: 'GEL',
    rentDueDay: 20,
    rentWarningDay: 17,
    utilitiesDueDay: 4,
    utilitiesReminderDay: 3,
    timezone: 'Asia/Tbilisi',
    paymentBalanceAdjustmentPolicy: 'utilities',
    rentPaymentDestinations: null
  }
  const assistantConfig: HouseholdAssistantConfigRecord = {
    householdId: 'household-1',
    assistantContext: null,
    assistantTone: 'Playful'
  }

  return {
    async getTelegramHouseholdChat() {
      return {
        householdId: 'household-1',
        householdName: 'Kojori',
        telegramChatId: '-10012345',
        telegramChatType: 'supergroup' as const,
        title: 'Kojori',
        defaultLocale: 'ru' as const
      }
    },
    async findHouseholdTopicByTelegramContext() {
      return {
        householdId: 'household-1',
        role: 'reminders' as const,
        telegramThreadId: '777',
        topicName: 'Напоминания'
      }
    },
    async getHouseholdMember(householdId: string, telegramUserId: string) {
      return (
        members.find(
          (entry) => entry.householdId === householdId && entry.telegramUserId === telegramUserId
        ) ?? null
      )
    },
    async listHouseholdMembers() {
      return members
    },
    async getHouseholdBillingSettings() {
      return settings
    },
    async getHouseholdAssistantConfig() {
      return assistantConfig
    }
  }
}

describe('registerAdHocNotifications', () => {
  test('shows the final rendered reminder text and persists that same text on confirm', async () => {
    const bot = createTelegramBot('000000:test-token')
    const calls: Array<{ method: string; payload: unknown }> = []
    const promptRepository = createPromptRepository()
    const scheduledRequests: Array<{ notificationText: string }> = []

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
            id: -10012345,
            type: 'supergroup'
          },
          text: 'ok'
        }
      } as never
    })

    const interpreter: AdHocNotificationInterpreter = {
      async interpretRequest() {
        return {
          decision: 'notification',
          notificationText: 'пошпынять Георгия о том, позвонил ли он',
          assigneeMemberId: 'georgiy',
          resolvedLocalDate: '2026-03-24',
          resolvedHour: 9,
          resolvedMinute: 0,
          resolutionMode: 'fuzzy_window',
          clarificationQuestion: null,
          confidence: 90,
          parserMode: 'llm'
        }
      },
      async interpretSchedule() {
        return {
          decision: 'parsed',
          resolvedLocalDate: '2026-03-24',
          resolvedHour: 9,
          resolvedMinute: 0,
          resolutionMode: 'fuzzy_window',
          clarificationQuestion: null,
          confidence: 90,
          parserMode: 'llm'
        }
      },
      async renderDeliveryText(input) {
        expect(input.requesterDisplayName).toBe('Дима')
        expect(input.assigneeDisplayName).toBe('Георгий')
        return 'Дима, пора пошпынять Георгия и узнать, позвонил ли он уже.'
      }
    }

    const notificationService: AdHocNotificationService = {
      async scheduleNotification(input) {
        scheduledRequests.push({ notificationText: input.notificationText })
        return {
          status: 'scheduled',
          notification: {
            id: 'notif-1',
            householdId: input.householdId,
            creatorMemberId: input.creatorMemberId,
            assigneeMemberId: input.assigneeMemberId ?? null,
            originalRequestText: input.originalRequestText,
            notificationText: input.notificationText,
            timezone: input.timezone,
            scheduledFor: input.scheduledFor,
            timePrecision: input.timePrecision,
            deliveryMode: input.deliveryMode,
            dmRecipientMemberIds: input.dmRecipientMemberIds ?? [],
            friendlyTagAssignee: false,
            status: 'scheduled',
            sourceTelegramChatId: input.sourceTelegramChatId ?? null,
            sourceTelegramThreadId: input.sourceTelegramThreadId ?? null,
            sentAt: null,
            cancelledAt: null,
            cancelledByMemberId: null,
            createdAt: Temporal.Instant.from('2026-03-23T09:00:00Z'),
            updatedAt: Temporal.Instant.from('2026-03-23T09:00:00Z')
          }
        }
      },
      async listUpcomingNotifications() {
        return []
      },
      async cancelNotification() {
        return { status: 'not_found' }
      },
      async listDueNotifications() {
        return []
      },
      async claimDueNotification() {
        return false
      },
      async releaseDueNotification() {},
      async markNotificationSent() {
        return null
      }
    }

    registerAdHocNotifications({
      bot,
      householdConfigurationRepository: createHouseholdRepository() as never,
      promptRepository,
      notificationService,
      reminderInterpreter: interpreter
    })

    await bot.handleUpdate(
      reminderMessageUpdate('Железяка, напомни пошпынять Георгия завтра с утра') as never
    )

    expect(calls[0]?.method).toBe('sendMessage')
    expect(calls[0]?.payload).toMatchObject({
      text: expect.stringContaining('Дима, пора пошпынять Георгия и узнать, позвонил ли он уже.')
    })

    const pending = await promptRepository.getPendingAction('-10012345', '10002')
    const proposalId = (pending?.payload as { proposalId?: string } | null)?.proposalId
    expect(proposalId).toBeTruthy()

    await bot.handleUpdate(reminderCallbackUpdate(`adhocnotif:confirm:${proposalId}`) as never)

    expect(scheduledRequests).toEqual([
      {
        notificationText: 'Дима, пора пошпынять Георгия и узнать, позвонил ли он уже.'
      }
    ])
  })

  test('reports temporary unavailability when the reminder interpreter is missing', async () => {
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
        result: true
      } as never
    })

    registerAdHocNotifications({
      bot,
      householdConfigurationRepository: createHouseholdRepository() as never,
      promptRepository: createPromptRepository(),
      notificationService: {
        async scheduleNotification() {
          throw new Error('not used')
        },
        async listUpcomingNotifications() {
          return []
        },
        async cancelNotification() {
          return { status: 'not_found' }
        },
        async listDueNotifications() {
          return []
        },
        async claimDueNotification() {
          return false
        },
        async releaseDueNotification() {},
        async markNotificationSent() {
          return null
        }
      },
      reminderInterpreter: undefined
    })

    await bot.handleUpdate(reminderMessageUpdate('напомни завтра') as never)

    expect(calls[0]?.payload).toMatchObject({
      text: 'Сейчас не могу создать напоминание: модуль ИИ временно недоступен.'
    })
  })
})
