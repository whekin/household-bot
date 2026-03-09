import { describe, expect, test } from 'bun:test'

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

describe('createTelegramBot i18n', () => {
  test('replies with Russian help text for Russian users', async () => {
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

    await bot.handleUpdate(helpUpdate('ru') as never)

    expect(calls[0]?.payload).toMatchObject({
      chat_id: 123456
    })

    const payload = calls[0]?.payload as { text?: string } | undefined
    expect(payload?.text).toContain('Бот для дома подключен.')
    expect(payload?.text).toContain('/anon - Отправить анонимное сообщение по дому')
  })
})
