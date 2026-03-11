import { describe, expect, mock, test } from 'bun:test'

import type { AnonymousFeedbackService } from '@household/application'
import { nowInstant, Temporal, type Instant } from '@household/domain'
import type {
  HouseholdConfigurationRepository,
  TelegramPendingActionRecord,
  TelegramPendingActionRepository
} from '@household/ports'

import { createTelegramBot } from './bot'
import { registerAnonymousFeedback } from './anonymous-feedback'

function anonUpdate(params: {
  updateId: number
  chatType: 'private' | 'supergroup'
  text: string
  languageCode?: string
}) {
  const commandToken = params.text.split(' ')[0] ?? params.text

  return {
    update_id: params.updateId,
    message: {
      message_id: params.updateId,
      date: Math.floor(Date.now() / 1000),
      chat: {
        id: params.chatType === 'private' ? 123456 : -100123456,
        type: params.chatType
      },
      from: {
        id: 123456,
        is_bot: false,
        first_name: 'Stan',
        ...(params.languageCode
          ? {
              language_code: params.languageCode
            }
          : {})
      },
      text: params.text,
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

function createPromptRepository(): TelegramPendingActionRepository {
  const store = new Map<
    string,
    {
      action: TelegramPendingActionRecord['action']
      expiresAt: Instant | null
    }
  >()

  return {
    async upsertPendingAction(input) {
      store.set(`${input.telegramChatId}:${input.telegramUserId}`, {
        action: input.action,
        expiresAt: input.expiresAt
      })
      return input
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
        telegramChatId,
        telegramUserId,
        action: record.action,
        payload: {},
        expiresAt: record.expiresAt
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
  return {
    registerTelegramHouseholdChat: async () => ({
      status: 'existing',
      household: {
        householdId: 'household-1',
        householdName: 'Kojori House',
        telegramChatId: '-100222333',
        telegramChatType: 'supergroup',
        title: 'Kojori House',
        defaultLocale: 'ru'
      }
    }),
    getTelegramHouseholdChat: async () => ({
      householdId: 'household-1',
      householdName: 'Kojori House',
      telegramChatId: '-100222333',
      telegramChatType: 'supergroup',
      title: 'Kojori House',
      defaultLocale: 'ru'
    }),
    getHouseholdChatByHouseholdId: async () => ({
      householdId: 'household-1',
      householdName: 'Kojori House',
      telegramChatId: '-100222333',
      telegramChatType: 'supergroup',
      title: 'Kojori House',
      defaultLocale: 'ru'
    }),
    bindHouseholdTopic: async (input) => ({
      householdId: input.householdId,
      role: input.role,
      telegramThreadId: input.telegramThreadId,
      topicName: input.topicName?.trim() || null
    }),
    getHouseholdTopicBinding: async (_householdId, role) =>
      role === 'feedback'
        ? {
            householdId: 'household-1',
            role: 'feedback',
            telegramThreadId: '77',
            topicName: 'Feedback'
          }
        : null,
    findHouseholdTopicByTelegramContext: async () => null,
    listHouseholdTopicBindings: async () => [],
    clearHouseholdTopicBindings: async () => {},
    listReminderTargets: async () => [],
    upsertHouseholdJoinToken: async () => ({
      householdId: 'household-1',
      householdName: 'Kojori House',
      token: 'join-token',
      createdByTelegramUserId: null
    }),
    getHouseholdJoinToken: async () => null,
    getHouseholdByJoinToken: async () => null,
    upsertPendingHouseholdMember: async (input) => ({
      householdId: input.householdId,
      householdName: 'Kojori House',
      telegramUserId: input.telegramUserId,
      displayName: input.displayName,
      username: input.username?.trim() || null,
      languageCode: input.languageCode?.trim() || null,
      householdDefaultLocale: 'ru'
    }),
    getPendingHouseholdMember: async () => null,
    findPendingHouseholdMemberByTelegramUserId: async () => null,
    ensureHouseholdMember: async (input) => ({
      id: `member-${input.telegramUserId}`,
      householdId: input.householdId,
      telegramUserId: input.telegramUserId,
      displayName: input.displayName,
      status: input.status ?? 'active',
      preferredLocale: input.preferredLocale ?? null,
      householdDefaultLocale: 'ru',
      rentShareWeight: 1,
      isAdmin: input.isAdmin === true
    }),
    getHouseholdMember: async () => null,
    listHouseholdMembers: async () => [],
    listHouseholdMembersByTelegramUserId: async () => [
      {
        id: 'member-123456',
        householdId: 'household-1',
        telegramUserId: '123456',
        displayName: 'Stan',
        status: 'active',
        preferredLocale: null,
        householdDefaultLocale: 'ru',
        rentShareWeight: 1,
        isAdmin: false
      }
    ],
    listPendingHouseholdMembers: async () => [],
    approvePendingHouseholdMember: async () => null,
    updateHouseholdDefaultLocale: async (_householdId, locale) => ({
      householdId: 'household-1',
      householdName: 'Kojori House',
      telegramChatId: '-100222333',
      telegramChatType: 'supergroup',
      title: 'Kojori House',
      defaultLocale: locale
    }),
    updateMemberPreferredLocale: async (_householdId, telegramUserId, locale) => ({
      id: `member-${telegramUserId}`,
      householdId: 'household-1',
      telegramUserId,
      displayName: 'Stan',
      status: 'active',
      preferredLocale: locale,
      householdDefaultLocale: 'ru',
      rentShareWeight: 1,
      isAdmin: false
    }),
    updateHouseholdMemberDisplayName: async () => null,
    getHouseholdBillingSettings: async (householdId) => ({
      householdId,
      settlementCurrency: 'GEL',
      rentAmountMinor: null,
      rentCurrency: 'USD',
      rentDueDay: 20,
      rentWarningDay: 17,
      utilitiesDueDay: 4,
      utilitiesReminderDay: 3,
      timezone: 'Asia/Tbilisi'
    }),
    updateHouseholdBillingSettings: async (input) => ({
      householdId: input.householdId,
      settlementCurrency: 'GEL',
      rentAmountMinor: input.rentAmountMinor ?? null,
      rentCurrency: input.rentCurrency ?? 'USD',
      rentDueDay: input.rentDueDay ?? 20,
      rentWarningDay: input.rentWarningDay ?? 17,
      utilitiesDueDay: input.utilitiesDueDay ?? 4,
      utilitiesReminderDay: input.utilitiesReminderDay ?? 3,
      timezone: input.timezone ?? 'Asia/Tbilisi'
    }),
    listHouseholdUtilityCategories: async () => [],
    upsertHouseholdUtilityCategory: async (input) => ({
      id: input.slug ?? 'utility-category-1',
      householdId: input.householdId,
      slug: input.slug ?? 'custom',
      name: input.name,
      sortOrder: input.sortOrder,
      isActive: input.isActive
    }),
    promoteHouseholdAdmin: async () => null,
    updateHouseholdMemberRentShareWeight: async () => null,
    updateHouseholdMemberStatus: async () => null,
    listHouseholdMemberAbsencePolicies: async () => [],
    upsertHouseholdMemberAbsencePolicy: async () => null
  }
}

describe('registerAnonymousFeedback', () => {
  test('posts accepted feedback into the configured topic', async () => {
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
            id: 1,
            type: 'private'
          },
          text: 'ok'
        }
      } as never
    })

    const anonymousFeedbackService: AnonymousFeedbackService = {
      submit: mock(async () => ({
        status: 'accepted' as const,
        submissionId: 'submission-1',
        sanitizedText: 'Please clean the kitchen tonight.'
      })),
      markPosted: mock(async () => {}),
      markFailed: mock(async () => {})
    }

    registerAnonymousFeedback({
      bot,
      anonymousFeedbackServiceForHousehold: () => anonymousFeedbackService,
      householdConfigurationRepository: createHouseholdConfigurationRepository(),
      promptRepository: createPromptRepository()
    })

    await bot.handleUpdate(
      anonUpdate({
        updateId: 1001,
        chatType: 'private',
        text: '/anon Please clean the kitchen tonight.'
      }) as never
    )

    expect(calls).toHaveLength(2)
    expect(calls[0]?.method).toBe('sendMessage')
    expect(calls[0]?.payload).toMatchObject({
      chat_id: '-100222333',
      message_thread_id: 77,
      text: 'Анонимное сообщение по дому\n\nPlease clean the kitchen tonight.'
    })
    expect(calls[1]?.payload).toMatchObject({
      text: 'Анонимное сообщение отправлено.'
    })
  })

  test('uses household locale for the posted anonymous note even when member locale differs', async () => {
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

    const repository = createHouseholdConfigurationRepository()
    repository.listHouseholdMembersByTelegramUserId = async () => [
      {
        id: 'member-123456',
        householdId: 'household-1',
        telegramUserId: '123456',
        displayName: 'Stan',
        status: 'active',
        preferredLocale: 'en',
        householdDefaultLocale: 'ru',
        rentShareWeight: 1,
        isAdmin: false
      }
    ]

    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })

      return {
        ok: true,
        result: {
          message_id: calls.length,
          date: Math.floor(Date.now() / 1000),
          chat: {
            id: method === 'sendMessage' ? -100222333 : 123456,
            type: method === 'sendMessage' ? 'supergroup' : 'private'
          },
          text: 'ok'
        }
      } as never
    })

    registerAnonymousFeedback({
      bot,
      anonymousFeedbackServiceForHousehold: () => ({
        submit: async () => ({
          status: 'accepted',
          submissionId: 'submission-1',
          sanitizedText: 'Проверка локали дома'
        }),
        markPosted: async () => undefined,
        markFailed: async () => undefined
      }),
      householdConfigurationRepository: repository,
      promptRepository: createPromptRepository()
    })

    await bot.handleUpdate(
      anonUpdate({
        updateId: 99,
        chatType: 'private',
        text: '/anon Проверка локали дома',
        languageCode: 'en'
      }) as never
    )

    const sendMessagePayloads = calls
      .filter((call) => call.method === 'sendMessage')
      .map((call) => call.payload as { text?: string })

    expect(
      sendMessagePayloads.some((payload) => payload.text?.startsWith('Анонимное сообщение по дому'))
    ).toBe(true)
    expect(
      sendMessagePayloads.some((payload) => payload.text?.startsWith('Anonymous household note'))
    ).toBe(false)
  })

  test('rejects group usage and keeps feedback private', async () => {
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
            id: -100123456,
            type: 'supergroup'
          },
          text: 'ok'
        }
      } as never
    })

    registerAnonymousFeedback({
      bot,
      anonymousFeedbackServiceForHousehold: () => ({
        submit: mock(async () => ({
          status: 'accepted' as const,
          submissionId: 'submission-1',
          sanitizedText: 'unused'
        })),
        markPosted: mock(async () => {}),
        markFailed: mock(async () => {})
      }),
      householdConfigurationRepository: createHouseholdConfigurationRepository(),
      promptRepository: createPromptRepository()
    })

    await bot.handleUpdate(
      anonUpdate({
        updateId: 1002,
        chatType: 'supergroup',
        text: '/anon Please clean the kitchen tonight.'
      }) as never
    )

    expect(calls).toHaveLength(1)
    expect(calls[0]?.payload).toMatchObject({
      text: 'Используйте /anon в личном чате с ботом.'
    })
  })

  test('prompts for the next DM message when /anon has no body', async () => {
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
            id: 1,
            type: 'private'
          },
          text: 'ok'
        }
      } as never
    })

    const submit = mock(async () => ({
      status: 'accepted' as const,
      submissionId: 'submission-1',
      sanitizedText: 'Please clean the kitchen tonight.'
    }))

    registerAnonymousFeedback({
      bot,
      anonymousFeedbackServiceForHousehold: () => ({
        submit,
        markPosted: mock(async () => {}),
        markFailed: mock(async () => {})
      }),
      householdConfigurationRepository: createHouseholdConfigurationRepository(),
      promptRepository: createPromptRepository()
    })

    await bot.handleUpdate(
      anonUpdate({
        updateId: 1003,
        chatType: 'private',
        text: '/anon'
      }) as never
    )

    await bot.handleUpdate(
      anonUpdate({
        updateId: 1004,
        chatType: 'private',
        text: 'Please clean the kitchen tonight.'
      }) as never
    )

    expect(submit).toHaveBeenCalledTimes(1)
    expect(calls[0]?.payload).toMatchObject({
      text: 'Отправьте анонимное сообщение следующим сообщением или нажмите «Отменить».'
    })
    expect(calls[1]?.payload).toMatchObject({
      chat_id: '-100222333',
      message_thread_id: 77,
      text: 'Анонимное сообщение по дому\n\nPlease clean the kitchen tonight.'
    })
    expect(calls[2]?.payload).toMatchObject({
      text: 'Анонимное сообщение отправлено.'
    })
  })

  test('prompts in Russian for Russian-speaking users', async () => {
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
            id: 1,
            type: 'private'
          },
          text: 'ok'
        }
      } as never
    })

    registerAnonymousFeedback({
      bot,
      anonymousFeedbackServiceForHousehold: () => ({
        submit: mock(async () => ({
          status: 'accepted' as const,
          submissionId: 'submission-1',
          sanitizedText: 'irrelevant'
        })),
        markPosted: mock(async () => {}),
        markFailed: mock(async () => {})
      }),
      householdConfigurationRepository: createHouseholdConfigurationRepository(),
      promptRepository: createPromptRepository()
    })

    await bot.handleUpdate(
      anonUpdate({
        updateId: 8001,
        chatType: 'private',
        text: '/anon',
        languageCode: 'ru'
      }) as never
    )

    expect(calls[0]?.payload).toMatchObject({
      chat_id: 123456,
      text: 'Отправьте анонимное сообщение следующим сообщением или нажмите «Отменить».',
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: 'Отменить',
              callback_data: 'cancel_prompt:anonymous_feedback'
            }
          ]
        ]
      }
    })
  })

  test('cancels the pending anonymous feedback prompt', async () => {
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
            id: 1,
            type: 'private'
          },
          text: 'ok'
        }
      } as never
    })

    const submit = mock(async () => ({
      status: 'accepted' as const,
      submissionId: 'submission-1',
      sanitizedText: 'Please clean the kitchen tonight.'
    }))

    registerAnonymousFeedback({
      bot,
      anonymousFeedbackServiceForHousehold: () => ({
        submit,
        markPosted: mock(async () => {}),
        markFailed: mock(async () => {})
      }),
      householdConfigurationRepository: createHouseholdConfigurationRepository(),
      promptRepository: createPromptRepository()
    })

    await bot.handleUpdate(
      anonUpdate({
        updateId: 1005,
        chatType: 'private',
        text: '/anon'
      }) as never
    )

    await bot.handleUpdate({
      update_id: 1006,
      callback_query: {
        id: 'callback-1',
        from: {
          id: 123456,
          is_bot: false,
          first_name: 'Stan'
        },
        chat_instance: 'chat-instance',
        message: {
          message_id: 1005,
          date: Math.floor(Date.now() / 1000),
          chat: {
            id: 123456,
            type: 'private'
          },
          text: 'Send me the anonymous message in your next reply, or tap Cancel.'
        },
        data: 'cancel_prompt:anonymous_feedback'
      }
    } as never)

    await bot.handleUpdate(
      anonUpdate({
        updateId: 1007,
        chatType: 'private',
        text: 'Please clean the kitchen tonight.'
      }) as never
    )

    expect(submit).toHaveBeenCalledTimes(0)
    expect(calls[1]?.method).toBe('answerCallbackQuery')
    expect(calls[2]?.method).toBe('editMessageText')
  })

  test('includes the next allowed time in cooldown replies', async () => {
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
            id: 1,
            type: 'private'
          },
          text: 'ok'
        }
      } as never
    })

    registerAnonymousFeedback({
      bot,
      anonymousFeedbackServiceForHousehold: () => ({
        submit: mock(async () => ({
          status: 'rejected' as const,
          reason: 'cooldown' as const,
          nextAllowedAt: nowInstant().add({ hours: 6 })
        })),
        markPosted: mock(async () => {}),
        markFailed: mock(async () => {})
      }),
      householdConfigurationRepository: createHouseholdConfigurationRepository(),
      promptRepository: createPromptRepository()
    })

    await bot.handleUpdate(
      anonUpdate({
        updateId: 1008,
        chatType: 'private',
        text: '/anon Please clean the kitchen tonight.'
      }) as never
    )

    expect(calls).toHaveLength(1)
    expect(calls[0]?.payload).toMatchObject({
      text: 'Сейчас действует пауза на анонимные сообщения. Следующее сообщение можно отправить через 6 часов.'
    })
  })
})
