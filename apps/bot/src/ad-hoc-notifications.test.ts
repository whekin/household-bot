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
import type { InlineKeyboardMarkup } from 'grammy/types'

import { createTelegramBot } from './bot'
import {
  createNotificationDraftPublisher,
  formatReminderWhen,
  registerAdHocNotifications
} from './ad-hoc-notifications'

function createPromptRepository(): TelegramPendingActionRepository {
  const pending = new Map<string, TelegramPendingActionRecord>()

  return {
    async upsertPendingAction(input) {
      pending.set(`${input.telegramChatId}:${input.telegramUserId}`, input)
      return input
    },
    async getPendingAction(telegramChatId, telegramUserId) {
      return pending.get(`${telegramChatId}:${telegramUserId}`) ?? null
    },
    async clearPendingAction(telegramChatId, telegramUserId) {
      pending.delete(`${telegramChatId}:${telegramUserId}`)
    },
    async clearPendingActionsForChat(telegramChatId, action) {
      for (const [key, value] of pending.entries()) {
        if (value.telegramChatId !== telegramChatId) {
          continue
        }
        if (action && value.action !== action) {
          continue
        }
        pending.delete(key)
      }
    }
  }
}

function reminderMessageUpdate(
  text: string,
  threadId = 777,
  from: { id: number; firstName: string } = { id: 10002, firstName: 'Dima' }
) {
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
        id: from.id,
        is_bot: false,
        first_name: from.firstName
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
    member({ id: 'stas', telegramUserId: '10003', displayName: 'Стас' }),
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
    preferredUtilityPayerMemberId: null,
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

function createNotificationServiceFake() {
  const scheduled: Array<Record<string, unknown>> = []
  const service = {
    scheduled,
    async scheduleNotification(input: Record<string, unknown>) {
      scheduled.push(input)
      return {
        status: 'scheduled',
        notification: {
          id: 'notification-1',
          scheduledFor: input.scheduledFor,
          notificationText: input.notificationText
        }
      }
    },
    async listUpcomingNotifications() {
      return []
    },
    async cancelNotification() {
      return { status: 'cancelled' }
    }
  }
  return service as unknown as AdHocNotificationService & { scheduled: typeof scheduled }
}

function createNotificationTestBot(calls: Array<{ method: string; payload: unknown }>) {
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
        message_id: calls.length + 500,
        date: Math.floor(Date.now() / 1000),
        chat: { id: -10012345, type: 'supergroup' },
        text: 'ok'
      }
    } as never
  })

  return bot
}

describe('createNotificationDraftPublisher', () => {
  test('posts a confirmation card and confirm schedules the notification', async () => {
    const calls: Array<{ method: string; payload: unknown }> = []
    const bot = createNotificationTestBot(calls)
    const promptRepository = createPromptRepository()
    const householdConfigurationRepository = createHouseholdRepository() as never
    const notificationService = createNotificationServiceFake()

    const publisher = createNotificationDraftPublisher({
      householdConfigurationRepository,
      promptRepository
    })

    const tomorrow = Temporal.Now.zonedDateTimeISO('Asia/Tbilisi').add({ days: 1 }).toPlainDate()

    bot.on('message', async (ctx) => {
      const published = await publisher.publish({
        ctx,
        text: 'Вынести мусор',
        localDate: tomorrow.toString(),
        hour: 10,
        minute: 0,
        assigneeMemberId: null
      })
      expect(published.status).toBe('card_posted')
    })
    registerAdHocNotifications({
      bot,
      householdConfigurationRepository,
      promptRepository,
      notificationService
    })

    await bot.handleUpdate(reminderMessageUpdate('напомни завтра в 10 вынести мусор') as never)

    const card = calls.find((call) => call.method === 'sendMessage')
    expect(card).toBeDefined()
    const markup = (card!.payload as { reply_markup: InlineKeyboardMarkup }).reply_markup
    const confirmButton = markup.inline_keyboard
      .flat()
      .find(
        (button) =>
          'callback_data' in button && button.callback_data.startsWith('adhocnotif:confirm:')
      )
    expect(confirmButton).toBeDefined()

    await bot.handleUpdate(
      reminderCallbackUpdate((confirmButton as { callback_data: string }).callback_data) as never
    )

    expect(notificationService.scheduled).toHaveLength(1)
    expect(notificationService.scheduled[0]?.notificationText).toBe('Вынести мусор')
  })

  test('rejects past schedules with a fixed status', async () => {
    const calls: Array<{ method: string; payload: unknown }> = []
    const bot = createNotificationTestBot(calls)
    const promptRepository = createPromptRepository()
    const publisher = createNotificationDraftPublisher({
      householdConfigurationRepository: createHouseholdRepository() as never,
      promptRepository
    })

    bot.on('message', async (ctx) => {
      const published = await publisher.publish({
        ctx,
        text: 'Опоздавшее напоминание',
        localDate: '2020-01-01',
        hour: 10,
        minute: 0,
        assigneeMemberId: null
      })
      expect(published.status).toBe('invalid_past')
    })

    await bot.handleUpdate(reminderMessageUpdate('напомни') as never)
    expect(calls.find((call) => call.method === 'sendMessage')).toBeUndefined()
  })
})

describe('formatReminderWhen', () => {
  test('uses sleep-aware tomorrow wording for the upcoming morning', () => {
    expect(
      formatReminderWhen({
        locale: 'ru',
        scheduledForIso: '2026-03-24T05:00:00Z',
        timezone: 'Asia/Tbilisi',
        now: Temporal.Instant.from('2026-03-23T21:00:00Z')
      })
    ).toBe('завтра в 9 утра')
  })

  test('keeps actual next-day reminders as tomorrow before 5am', () => {
    expect(
      formatReminderWhen({
        locale: 'ru',
        scheduledForIso: '2026-03-25T05:00:00Z',
        timezone: 'Asia/Tbilisi',
        now: Temporal.Instant.from('2026-03-24T00:14:00Z')
      })
    ).toBe('завтра в 9 утра')
  })
})
