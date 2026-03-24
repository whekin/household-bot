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
import { formatReminderWhen, registerAdHocNotifications } from './ad-hoc-notifications'
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
  test('shows a compact playful confirmation, supports time edits, and persists the hidden rendered text on confirm', async () => {
    const bot = createTelegramBot('000000:test-token')
    const calls: Array<{ method: string; payload: unknown }> = []
    const promptRepository = createPromptRepository()
    const scheduledRequests: Array<{ notificationText: string }> = []
    const now = Temporal.Now.instant()
    const localNow = now.toZonedDateTimeISO('Asia/Tbilisi')
    const baseDate =
      localNow.hour <= 4 ? localNow.toPlainDate().subtract({ days: 1 }) : localNow.toPlainDate()
    const tomorrow = baseDate.add({ days: 1 }).toString()
    let draftEditCalls = 0
    const initialWhen = formatReminderWhen({
      locale: 'ru',
      scheduledForIso: Temporal.ZonedDateTime.from(`${tomorrow}T09:00:00[Asia/Tbilisi]`)
        .toInstant()
        .toString(),
      timezone: 'Asia/Tbilisi',
      now
    })
    const updatedWhen = formatReminderWhen({
      locale: 'ru',
      scheduledForIso: Temporal.ZonedDateTime.from(`${tomorrow}T10:00:00[Asia/Tbilisi]`)
        .toInstant()
        .toString(),
      timezone: 'Asia/Tbilisi',
      now
    })

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
          resolvedLocalDate: tomorrow,
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
          resolvedLocalDate: tomorrow,
          resolvedHour: 9,
          resolvedMinute: 0,
          resolutionMode: 'fuzzy_window',
          clarificationQuestion: null,
          confidence: 90,
          parserMode: 'llm'
        }
      },
      async interpretDraftEdit() {
        draftEditCalls += 1
        if (draftEditCalls === 2) {
          return {
            decision: 'cancel',
            notificationText: null,
            assigneeChanged: false,
            assigneeMemberId: null,
            resolvedLocalDate: null,
            resolvedHour: null,
            resolvedMinute: null,
            resolutionMode: null,
            deliveryMode: null,
            dmRecipientMemberIds: null,
            clarificationQuestion: null,
            confidence: 95,
            parserMode: 'llm'
          }
        }

        return {
          decision: 'updated',
          notificationText: null,
          assigneeChanged: false,
          assigneeMemberId: null,
          resolvedLocalDate: tomorrow,
          resolvedHour: 10,
          resolvedMinute: 0,
          resolutionMode: 'exact',
          deliveryMode: null,
          dmRecipientMemberIds: null,
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
      async updateNotification() {
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
      text: `Окей, ${initialWhen} напомню.`
    })
    expect((calls[0]?.payload as { text?: string })?.text).not.toContain(
      'Дима, пора пошпынять Георгия и узнать, позвонил ли он уже.'
    )

    const pending = await promptRepository.getPendingAction('-10012345', '10002')
    expect((pending?.payload as { proposalId?: string } | null)?.proposalId).toBeTruthy()

    await bot.handleUpdate(reminderMessageUpdate('Давай на 10 часов лучше') as never)

    expect(draftEditCalls).toBe(1)
    expect(calls[1]?.payload).toMatchObject({
      text: `Окей, ${updatedWhen} напомню.`
    })

    await bot.handleUpdate(reminderMessageUpdate('А вообще, я не буду кушать') as never)

    expect(draftEditCalls).toBe(2)
    expect(calls[2]?.payload).toMatchObject({
      text: 'Окей, тогда не напоминаю.'
    })
    expect(await promptRepository.getPendingAction('-10012345', '10002')).toBeNull()

    const replacementPending = await promptRepository.getPendingAction('-10012345', '10002')
    expect(replacementPending).toBeNull()

    await bot.handleUpdate(
      reminderMessageUpdate('Железяка, напомни пошпынять Георгия завтра с утра') as never
    )

    const renewedPending = await promptRepository.getPendingAction('-10012345', '10002')
    const renewedProposalId = (renewedPending?.payload as { proposalId?: string } | null)
      ?.proposalId
    expect(renewedProposalId).toBeTruthy()

    await bot.handleUpdate(
      reminderCallbackUpdate(`adhocnotif:confirm:${renewedProposalId}`) as never
    )

    expect(calls[4]?.method).toBe('answerCallbackQuery')
    expect(calls[5]?.method).toBe('editMessageText')
    expect(calls[5]?.payload).toMatchObject({
      text: `Окей, ${initialWhen} напомню.`
    })

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
        async updateNotification() {
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

  test('expands advanced controls inline', async () => {
    const bot = createTelegramBot('000000:test-token')
    const calls: Array<{ method: string; payload: unknown }> = []
    const now = Temporal.Now.instant()
    const localNow = now.toZonedDateTimeISO('Asia/Tbilisi')
    const baseDate =
      localNow.hour <= 4 ? localNow.toPlainDate().subtract({ days: 1 }) : localNow.toPlainDate()
    const tomorrow = baseDate.add({ days: 1 }).toString()
    const expectedWhen = formatReminderWhen({
      locale: 'ru',
      scheduledForIso: Temporal.ZonedDateTime.from(`${tomorrow}T09:00:00[Asia/Tbilisi]`)
        .toInstant()
        .toString(),
      timezone: 'Asia/Tbilisi',
      now
    })

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
        async updateNotification() {
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
      reminderInterpreter: {
        async interpretRequest() {
          return {
            decision: 'notification',
            notificationText: 'покушать',
            assigneeMemberId: 'dima',
            resolvedLocalDate: tomorrow,
            resolvedHour: 9,
            resolvedMinute: 0,
            resolutionMode: 'fuzzy_window',
            clarificationQuestion: null,
            confidence: 90,
            parserMode: 'llm'
          }
        },
        async interpretSchedule() {
          throw new Error('not used')
        },
        async interpretDraftEdit() {
          throw new Error('not used')
        },
        async renderDeliveryText() {
          return 'Стас, не забудь покушать.'
        }
      }
    })

    await bot.handleUpdate(reminderMessageUpdate('Напомни завтра с утра покушать') as never)

    const firstPayload = calls[0]?.payload as { reply_markup?: InlineKeyboardMarkup; text?: string }
    const moreButton = firstPayload.reply_markup?.inline_keyboard[0]?.[2] as
      | { text?: string; callback_data?: string }
      | undefined
    expect(moreButton?.text).toBe('Еще')
    expect(firstPayload.text).toBe(`Окей, ${expectedWhen} напомню.`)

    const callbackData = moreButton?.callback_data
    expect(callbackData).toBeTruthy()

    await bot.handleUpdate(reminderCallbackUpdate(callbackData ?? 'missing') as never)

    expect(calls[1]?.method).toBe('editMessageText')
    const expandedPayload = calls[1]?.payload as { reply_markup?: InlineKeyboardMarkup }
    expect(expandedPayload.reply_markup?.inline_keyboard[0]?.[2]?.text).toBe('Скрыть')
    expect(expandedPayload.reply_markup?.inline_keyboard[1]?.[0]?.text).toContain('В топик')
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
