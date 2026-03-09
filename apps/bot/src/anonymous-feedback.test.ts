import { describe, expect, mock, test } from 'bun:test'

import type { AnonymousFeedbackService } from '@household/application'
import type { TelegramPendingActionRepository } from '@household/ports'

import { createTelegramBot } from './bot'
import { registerAnonymousFeedback } from './anonymous-feedback'

function anonUpdate(params: {
  updateId: number
  chatType: 'private' | 'supergroup'
  text: string
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
        first_name: 'Stan'
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
  const store = new Map<string, { action: 'anonymous_feedback'; expiresAt: Date | null }>()

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

      if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) {
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
    }
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
      anonymousFeedbackService,
      promptRepository: createPromptRepository(),
      householdChatId: '-100222333',
      feedbackTopicId: 77
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
      text: 'Anonymous household note\n\nPlease clean the kitchen tonight.'
    })
    expect(calls[1]?.payload).toMatchObject({
      text: 'Anonymous feedback delivered.'
    })
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
      anonymousFeedbackService: {
        submit: mock(async () => ({
          status: 'accepted' as const,
          submissionId: 'submission-1',
          sanitizedText: 'unused'
        })),
        markPosted: mock(async () => {}),
        markFailed: mock(async () => {})
      },
      promptRepository: createPromptRepository(),
      householdChatId: '-100222333',
      feedbackTopicId: 77
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
      text: 'Use /anon in a private chat with the bot.'
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
      anonymousFeedbackService: {
        submit,
        markPosted: mock(async () => {}),
        markFailed: mock(async () => {})
      },
      promptRepository: createPromptRepository(),
      householdChatId: '-100222333',
      feedbackTopicId: 77
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
      text: 'Send me the anonymous message in your next reply, or tap Cancel.'
    })
    expect(calls[1]?.payload).toMatchObject({
      chat_id: '-100222333',
      message_thread_id: 77,
      text: 'Anonymous household note\n\nPlease clean the kitchen tonight.'
    })
    expect(calls[2]?.payload).toMatchObject({
      text: 'Anonymous feedback delivered.'
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
      anonymousFeedbackService: {
        submit,
        markPosted: mock(async () => {}),
        markFailed: mock(async () => {})
      },
      promptRepository: createPromptRepository(),
      householdChatId: '-100222333',
      feedbackTopicId: 77
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
})
