import { describe, expect, test } from 'bun:test'
import { Bot } from 'grammy'

import { registerCallbackQueryGuards } from './telegram-callback-guards'

function callbackUpdate(options: {
  data: string
  updateId: number
  messageId?: number
  fromId?: number
}) {
  return {
    update_id: options.updateId,
    callback_query: {
      id: `callback-${options.updateId}`,
      from: {
        id: options.fromId ?? 4242,
        is_bot: false,
        first_name: 'Mia'
      },
      chat_instance: 'instance-1',
      data: options.data,
      message: {
        message_id: options.messageId ?? 77,
        date: 1_700_000_000,
        chat: {
          id: -10012345,
          type: 'supergroup'
        },
        text: 'Utilities reminder'
      }
    }
  }
}

function createGuardedBot() {
  const bot = new Bot('000000:test-token')
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
  bot.api.config.use(async () => ({ ok: true, result: true }) as never)
  registerCallbackQueryGuards({ bot })

  return bot
}

describe('registerCallbackQueryGuards', () => {
  test('runs repeat presses of one button one after another instead of concurrently', async () => {
    const bot = createGuardedBot()
    const events: string[] = []
    let running = 0
    let maxConcurrent = 0

    bot.callbackQuery('bill:show', async (ctx) => {
      running += 1
      maxConcurrent = Math.max(maxConcurrent, running)
      events.push(`start:${ctx.callbackQuery.id}`)
      await new Promise((resolve) => setTimeout(resolve, 10))
      events.push(`end:${ctx.callbackQuery.id}`)
      running -= 1
    })

    await Promise.all([
      bot.handleUpdate(callbackUpdate({ data: 'bill:show', updateId: 1 }) as never),
      bot.handleUpdate(callbackUpdate({ data: 'bill:show', updateId: 2 }) as never)
    ])

    expect(maxConcurrent).toBe(1)
    expect(events).toEqual([
      'start:callback-1',
      'end:callback-1',
      'start:callback-2',
      'end:callback-2'
    ])
  })

  test('lets both presses run when they are different buttons', async () => {
    const bot = createGuardedBot()
    let running = 0
    let maxConcurrent = 0

    bot.callbackQuery(/^bill:/, async () => {
      running += 1
      maxConcurrent = Math.max(maxConcurrent, running)
      await new Promise((resolve) => setTimeout(resolve, 10))
      running -= 1
    })

    await Promise.all([
      bot.handleUpdate(callbackUpdate({ data: 'bill:show', updateId: 1 }) as never),
      bot.handleUpdate(callbackUpdate({ data: 'bill:details', updateId: 2 }) as never)
    ])

    expect(maxConcurrent).toBe(2)
  })

  test('a failing press does not swallow the one queued behind it', async () => {
    const bot = createGuardedBot()
    const handled: string[] = []

    bot.callbackQuery('bill:show', async (ctx) => {
      handled.push(ctx.callbackQuery.id)
      if (ctx.callbackQuery.id === 'callback-1') {
        throw new Error('boom')
      }
    })

    // handleUpdate surfaces the handler's own failure; only the queued press matters here.
    await Promise.all([
      bot.handleUpdate(callbackUpdate({ data: 'bill:show', updateId: 1 }) as never).catch(() => {}),
      bot.handleUpdate(callbackUpdate({ data: 'bill:show', updateId: 2 }) as never)
    ])

    expect(handled).toEqual(['callback-1', 'callback-2'])
  })
})
