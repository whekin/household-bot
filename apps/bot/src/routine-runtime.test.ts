import { expect, test } from 'bun:test'
import { Bot } from 'grammy'
import type { HouseholdOnboardingService } from '@household/application'
import type { HouseholdConfigurationRepository, HouseholdMemberRecord } from '@household/ports'
import { routineMemoryRepository, routineInput } from '@household/application/testing/routines'
import { createRoutineRuntime } from './routine-runtime'
import { buildMiniAppInitData } from './telegram-miniapp-test-helpers'

function fixture() {
  const bot = new Bot('123:test-token')
  bot.botInfo = {
    id: 123,
    is_bot: true,
    first_name: 'Test bot',
    username: 'test_routines_bot',
    can_join_groups: true,
    can_read_all_group_messages: true,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
    has_topics_enabled: false,
    allows_users_to_create_topics: false
  }
  const member: HouseholdMemberRecord = {
    id: 'alex',
    householdId: 'house',
    telegramUserId: '100',
    displayName: 'Саша',
    status: 'active',
    isAdmin: true,
    preferredLocale: 'ru',
    householdDefaultLocale: 'ru',
    rentShareWeight: 1
  }
  const second: HouseholdMemberRecord = {
    ...member,
    id: 'sam',
    telegramUserId: '200',
    displayName: 'Сэм',
    isAdmin: false
  }
  const members = [member, second]
  const chat = {
    householdId: 'house',
    householdName: 'Дом',
    telegramChatId: '-1002636668636',
    telegramChatType: 'supergroup',
    title: 'Дом',
    defaultLocale: 'ru'
  }
  const households = {
    getHouseholdMember: async (householdId: string, userId: string) =>
      members.find((m) => m.householdId === householdId && m.telegramUserId === userId) ?? null,
    getHouseholdChatByHouseholdId: async () => chat,
    listHouseholdMembers: async () => members,
    listHouseholdMembersByTelegramUserId: async (userId: string) =>
      members.filter((m) => m.telegramUserId === userId),
    getHouseholdBillingSettings: async () => ({ timezone: 'Asia/Tbilisi' }),
    listHouseholdTopicBindings: async () => []
  } as unknown as HouseholdConfigurationRepository
  const onboardingService = {
    getMiniAppAccess: async ({ identity }: { identity: { telegramUserId: string } }) => ({
      status: 'active',
      member: members.find((m) => m.telegramUserId === identity.telegramUserId)
    })
  } as unknown as HouseholdOnboardingService
  const calls: Array<{ method: string; payload: Record<string, unknown> }> = []
  let msgId = 10
  let createError = false
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> })
    if (method === 'getChatMember')
      return {
        ok: true,
        result: {
          status: 'administrator',
          can_manage_topics: true,
          user: { id: 100, is_bot: false, first_name: 'Саша' }
        }
      } as never
    if (method === 'getChat')
      return {
        ok: true,
        result: { id: -1002636668636, type: 'supergroup', title: 'Дом', is_forum: true }
      } as never
    if (method === 'createForumTopic') {
      if (createError) throw new Error('Connection lost')
      return {
        ok: true,
        result: { message_thread_id: 136, name: 'Дела', icon_color: 7322096 }
      } as never
    }
    if (method === 'sendMessage')
      return {
        ok: true,
        result: {
          message_id: ++msgId,
          date: Math.floor(Date.now() / 1000),
          chat: { id: Number((payload as { chat_id: string }).chat_id), type: 'private' }
        }
      } as never
    return { ok: true, result: true } as never
  })
  const repository = routineMemoryRepository()
  const runtime = createRoutineRuntime({
    bot,
    repository,
    households,
    onboardingService,
    botToken: '123:test-token',
    allowedOrigins: ['http://localhost:5176'],
    report: () => {}
  })
  async function api(body: Record<string, unknown>, userId = 100) {
    const initData = buildMiniAppInitData('123:test-token', Math.floor(Date.now() / 1000), {
      id: userId,
      first_name: 'Test'
    })
    return runtime.handler.handler(
      new Request('http://localhost/api/miniapp/routines', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:5176' },
        body: JSON.stringify({ initData, ...body })
      })
    )
  }
  return {
    bot,
    runtime,
    repository,
    calls,
    member,
    second,
    api,
    createError: () => {
      createError = true
    }
  }
}

test('signed mini app creation, link binding, private card and group callback form one end-to-end flow', async () => {
  const f = fixture()
  expect((await f.api({ operation: 'save', ...routineInput })).status).toBe(200)
  expect(
    (
      await f.api({
        operation: 'bind',
        id: routineInput.id,
        expectedRevision: 1,
        mode: 'link',
        link: 'https://t.me/c/2636668636/136/4223'
      })
    ).status
  ).toBe(200)
  expect(
    f.calls.some((c) => c.method === 'sendMessage' && c.payload.message_thread_id === 136)
  ).toBe(true)
  expect((await f.api({ operation: 'open', id: routineInput.id }, 200)).status).toBe(200)
  const doc = (await f.repository.get(routineInput.id))!
  const row = doc.days[0]!.rows[0]!
  const groupMessage = doc.messages.find((m) => m.threadId === 136)!
  await f.bot.handleUpdate({
    update_id: 1,
    callback_query: {
      id: 'callback-1',
      from: { id: 200, is_bot: false, first_name: 'Сэм' },
      chat_instance: 'instance',
      data: `rt:${doc.id}:${row.id}:0:d`,
      message: {
        message_id: groupMessage.messageId!,
        date: Math.floor(Date.now() / 1000),
        chat: { id: -1002636668636, type: 'supergroup', title: 'Дом' },
        message_thread_id: 136
      }
    }
  })
  expect((await f.repository.get(doc.id))?.days[0]!.rows[0]!.actorName).toBe('Сэм')
  expect(
    f.calls.filter((c) => c.method === 'editMessageText').map((c) => String(c.payload.chat_id))
  ).toContain('200')
  expect(
    (
      await f.api(
        {
          operation: 'act',
          id: doc.id,
          rowId: row.id,
          version: 1,
          action: 'reopen',
          requestId: 'undo'
        },
        100
      )
    ).status
  ).toBe(200)
  expect((await f.repository.get(doc.id))?.days[0]!.rows[0]!.status).toBe('pending')
  expect(f.calls.filter((c) => c.method === 'createForumTopic')).toHaveLength(0)
})

test('API rejects nonadmins, foreign groups, invalid sessions and stale revisions', async () => {
  const f = fixture()
  expect((await f.api({ operation: 'save', ...routineInput }, 200)).status).toBe(403)
  await f.api({ operation: 'save', ...routineInput })
  expect(
    (
      await f.api({
        operation: 'bind',
        id: routineInput.id,
        expectedRevision: 1,
        mode: 'link',
        link: 'https://t.me/c/999/136/4223'
      })
    ).status
  ).toBe(400)
  expect((await f.api({ operation: 'save', ...routineInput, expectedRevision: 8 })).status).toBe(
    409
  )
  const response = await f.runtime.handler.handler(
    new Request('http://localhost/api/miniapp/routines', {
      method: 'POST',
      body: JSON.stringify({ initData: 'invalid' })
    })
  )
  expect(response.status).toBe(401)
  f.second.status = 'left'
  expect((await f.api({ operation: 'list' }, 200)).status).toBe(403)
})

test('topic creation is automatically bound and a replay cannot create another topic', async () => {
  const f = fixture()
  await f.api({ operation: 'save', ...routineInput })
  const request = {
    operation: 'bind',
    id: routineInput.id,
    expectedRevision: 1,
    mode: 'create',
    name: 'Дела'
  }
  expect((await f.api(request)).status).toBe(200)
  expect((await f.api(request)).status).toBe(409)
  expect(f.calls.filter((c) => c.method === 'createForumTopic')).toHaveLength(1)
  expect((await f.repository.get(routineInput.id))?.destination?.threadId).toBe(136)
})

test('uncertain topic creation stays recoverable through a link and never retries create blindly', async () => {
  const f = fixture()
  await f.api({ operation: 'save', ...routineInput })
  f.createError()
  const request = {
    operation: 'bind',
    id: routineInput.id,
    expectedRevision: 1,
    mode: 'create',
    name: 'Дела'
  }
  expect((await f.api(request)).status).toBe(400)
  expect((await f.api(request)).status).toBe(409)
  expect(f.calls.filter((c) => c.method === 'createForumTopic')).toHaveLength(1)
  expect(
    (await f.api({ ...request, mode: 'link', link: 'https://t.me/c/2636668636/136/4223' })).status
  ).toBe(200)
})

test('unknown group sends require an explicit admin recovery and repeated recovery does not duplicate', async () => {
  const f = fixture()
  await f.api({ operation: 'save', ...routineInput })
  await f.api({
    operation: 'bind',
    id: routineInput.id,
    expectedRevision: 1,
    mode: 'link',
    link: 'https://t.me/c/2636668636/136/4223'
  })
  await f.repository.change(routineInput.id, 'house', (doc) => {
    const message = doc.messages.find((m) => m.rowId === null)!
    message.status = 'unknown'
    message.messageId = null
  })
  await f.runtime.delivery.tick()
  expect(f.calls.filter((c) => c.method === 'sendMessage')).toHaveLength(1)
  expect((await f.api({ operation: 'retry_group_card', id: routineInput.id }, 200)).status).toBe(
    403
  )
  expect((await f.api({ operation: 'retry_group_card', id: routineInput.id })).status).toBe(200)
  await f.api({ operation: 'retry_group_card', id: routineInput.id })
  expect(f.calls.filter((c) => c.method === 'sendMessage')).toHaveLength(2)
})

test('expanding a day card is shared on that message and only for household members', async () => {
  const f = fixture()
  await f.api({
    operation: 'save',
    ...routineInput,
    definition: {
      title: 'Уход',
      tasks: [
        {
          ...routineInput.definition.tasks[0]!,
          times: ['09:00', '13:00'],
          reminderEnabled: false
        }
      ]
    }
  })
  await f.api({
    operation: 'bind',
    id: routineInput.id,
    expectedRevision: 1,
    mode: 'link',
    link: 'https://t.me/c/2636668636/136/4223'
  })
  const message = (await f.repository.get(routineInput.id))!.messages.find(
    (m) => m.threadId === 136
  )!
  const toggle = (userId: number, id = routineInput.id) =>
    f.bot.handleUpdate({
      update_id: userId,
      callback_query: {
        id: `callback-${userId}`,
        from: { id: userId, is_bot: false, first_name: 'Кто-то' },
        chat_instance: 'instance',
        data: `rtx:${id}`,
        message: {
          message_id: message.messageId!,
          date: Math.floor(Date.now() / 1000),
          chat: { id: -1002636668636, type: 'supergroup', title: 'Дом' },
          message_thread_id: 136
        }
      }
    })
  await toggle(200)
  expect(
    (await f.repository.get(routineInput.id))!.messages.find((m) => m.key === message.key)?.expanded
  ).toBe(true)
  const edits = f.calls.filter((c) => c.method === 'editMessageText')
  expect(String(edits.at(-1)?.payload.text)).toContain('☑️')
  await toggle(200)
  expect(
    (await f.repository.get(routineInput.id))!.messages.find((m) => m.key === message.key)?.expanded
  ).toBe(false)
  await toggle(999)
  expect(
    f.calls.some(
      (c) =>
        c.method === 'answerCallbackQuery' &&
        String(c.payload.text).includes('Доступ только участникам дома')
    )
  ).toBe(true)
})
