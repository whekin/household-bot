import { describe, expect, test } from 'bun:test'
import type { HouseholdConfigurationRepository } from '@household/ports'
import { createRoutineService } from '@household/application'
import {
  routineActor,
  routineInput,
  routineMemoryRepository
} from '@household/application/testing/routines'
import { createRoutineDelivery, type RoutineTransport } from './routine-delivery'
import { parseRoutineTopicLink } from './routine-topic-link'
import { renderRoutineCard } from './routine-cards'

async function fixture() {
  let now = '2026-09-10T04:00:00Z'
  const repository = routineMemoryRepository()
  const service = createRoutineService(repository, () => now)
  const doc = await service.save(routineActor, routineInput)
  const calls: Array<{ method: string; chat: string; messageId: number; text: string }> = []
  let fail:
    | { error_code: number; description: string; parameters?: { retry_after: number } }
    | Error
    | null = null
  let id = 0
  const transport: RoutineTransport = {
    async send(chat, _thread, content) {
      if (fail) throw fail
      const messageId = ++id
      calls.push({ method: 'send', chat, messageId, text: content.text })
      return messageId
    },
    async edit(chat, messageId, content) {
      if (fail) throw fail
      calls.push({ method: 'edit', chat, messageId, text: content.text })
    },
    async remove(chat, messageId) {
      if (fail) throw fail
      calls.push({ method: 'remove', chat, messageId, text: '' })
    }
  }
  const households = {
    listHouseholdMembers: async () => [
      routineActor,
      { ...routineActor, id: 'sam', telegramUserId: '200', displayName: 'Сэм' }
    ]
  } as unknown as HouseholdConfigurationRepository
  const delivery = createRoutineDelivery({ repository, households, transport, clock: () => now })
  return {
    repository,
    service,
    doc,
    calls,
    delivery,
    transport,
    households,
    setNow: (v: string) => {
      now = v
    },
    setFail: (v: typeof fail) => {
      fail = v
    }
  }
}

test('idle ticks do not reload the aggregate for historical or unchanged messages', async () => {
  const f = await fixture()
  await f.delivery.bind(f.doc.id, routineActor.householdId, {
    chatId: '-1001',
    threadId: 136,
    name: 'Дела'
  })
  await f.repository.change(f.doc.id, routineActor.householdId, (doc) => {
    const day = { ...structuredClone(doc.days[0]!), date: '2026-09-09' }
    doc.days.push(day)
    for (let i = 0; i < 100; i++) {
      doc.messages.push({
        key: `history-${i}`,
        date: day.date,
        rowId: null,
        chatId: '-1001',
        threadId: 136,
        messageId: 1000 + i,
        status: i % 2 ? 'removed' : 'sent',
        fingerprint: JSON.stringify(renderRoutineCard(doc, day, '2026-09-10T04:00:00Z')),
        error: null,
        retryAt: null
      })
    }
  })
  let reads = 0
  const originalGet = f.repository.get.bind(f.repository)
  const originalList = f.repository.list.bind(f.repository)
  const originalChange = f.repository.change.bind(f.repository)
  f.repository.get = async (...args) => {
    reads++
    return originalGet(...args)
  }
  f.repository.list = async (...args) => {
    reads++
    return originalList(...args)
  }
  f.repository.change = async (...args) => {
    reads++
    return originalChange(...args)
  }
  const before = f.calls.length
  await f.delivery.tick()
  expect(f.calls).toHaveLength(before)
  expect(reads).toBeLessThanOrEqual(6)
})

test('delivery rechecks a candidate changed after the snapshot was read', async () => {
  const f = await fixture()
  await f.delivery.bind(f.doc.id, routineActor.householdId, {
    chatId: '-1001',
    threadId: 136,
    name: 'Дела'
  })
  await f.repository.change(f.doc.id, routineActor.householdId, (doc) => {
    doc.messages[0]!.fingerprint = ''
  })
  const originalGet = f.repository.get.bind(f.repository)
  let gets = 0
  f.repository.get = async (id) => {
    const doc = structuredClone(await originalGet(id))
    if (++gets === 2) {
      await f.repository.change(id, routineActor.householdId, (current) => {
        current.messages[0]!.status = 'removed'
      })
    }
    return doc
  }
  const before = f.calls.length
  await f.delivery.reconcile(f.doc.id)
  expect(gets).toBe(2)
  expect(f.calls).toHaveLength(before)
})

describe('routine Telegram delivery', () => {
  test('group and DM share one occurrence, reminders disappear after completion from either surface', async () => {
    const f = await fixture()
    await f.delivery.bind(f.doc.id, routineActor.householdId, {
      chatId: '-1001',
      threadId: 136,
      name: 'Дела'
    })
    await f.service.subscribe(routineActor, f.doc.id, true)
    await f.delivery.requestCard(f.doc.id, routineActor.householdId, '100')
    expect(f.calls.filter((c) => c.method === 'send')).toHaveLength(2)
    f.setNow('2026-09-10T05:00:00.001Z')
    await f.delivery.tick()
    expect(f.calls.filter((c) => c.method === 'send')).toHaveLength(4)
    // The due slot repaints both day cards once; count only what completion causes.
    const beforeCompletion = f.calls.length
    await f.service.act(routineActor, {
      id: f.doc.id,
      rowId: f.doc.days[0]!.rows[0]!.id,
      version: 0,
      action: 'complete',
      requestId: 'dm'
    })
    await f.delivery.reconcile(f.doc.id)
    const afterCompletion = f.calls.slice(beforeCompletion)
    expect(afterCompletion.filter((c) => c.method === 'edit')).toHaveLength(2)
    expect(afterCompletion.filter((c) => c.method === 'remove')).toHaveLength(2)
    await f.service.act(
      { ...routineActor, id: 'sam' },
      {
        id: f.doc.id,
        rowId: f.doc.days[0]!.rows[0]!.id,
        version: 1,
        action: 'reopen',
        requestId: 'group'
      }
    )
    await f.delivery.tick()
    expect(f.calls.filter((c) => c.method === 'send')).toHaveLength(4)
  })
  test('429 retries only after delay; unknown send timeouts never blindly duplicate', async () => {
    const f = await fixture()
    f.setFail({
      error_code: 429,
      description: 'Too Many Requests',
      parameters: { retry_after: 60 }
    })
    await f.delivery.bind(f.doc.id, routineActor.householdId, {
      chatId: '-1001',
      threadId: 136,
      name: 'Дела'
    })
    f.setFail(null)
    await f.delivery.tick()
    expect(f.calls).toHaveLength(0)
    f.setNow('2026-09-10T04:01:00Z')
    await f.delivery.tick()
    expect(f.calls.filter((c) => c.method === 'send')).toHaveLength(1)
    f.setFail(new Error('socket closed'))
    await f.delivery.requestCard(f.doc.id, routineActor.householdId, '100')
    f.setFail(null)
    await f.delivery.tick()
    const doc = (await f.repository.get(f.doc.id))!
    expect(doc.messages.find((m) => m.chatId === '100')?.status).toBe('unknown')
    expect(f.calls.filter((c) => c.method === 'send')).toHaveLength(1)
  })
  test('paused/missed slots do not backfill and old day buttons are removed', async () => {
    const f = await fixture()
    await f.delivery.bind(f.doc.id, routineActor.householdId, {
      chatId: '-1001',
      threadId: 136,
      name: 'Дела'
    })
    f.setNow('2026-09-10T06:00:00Z')
    await f.delivery.tick()
    expect(f.calls.filter((c) => c.method === 'send')).toHaveLength(1)
    f.setNow('2026-09-11T04:00:00Z')
    await f.delivery.tick()
    expect(f.calls.filter((c) => c.method === 'send')).toHaveLength(2)
    const doc = (await f.repository.get(f.doc.id))!
    const old = renderRoutineCard(doc, doc.days[0]!, '2026-09-11T04:00:00Z')
    expect(old.reply_markup.inline_keyboard).toEqual([])
  })
  test('rebind retires old cards and publishes a new destination without deleting the topic', async () => {
    const f = await fixture()
    await f.delivery.bind(f.doc.id, routineActor.householdId, {
      chatId: '-1001',
      threadId: 136,
      name: 'One'
    })
    await f.delivery.bind(f.doc.id, routineActor.householdId, {
      chatId: '-1001',
      threadId: 137,
      name: 'Two'
    })
    expect(f.calls.filter((c) => c.method === 'send')).toHaveLength(2)
    expect(f.calls.some((c) => c.method === 'edit' && c.text.includes('перенесён'))).toBe(true)
  })
  test('a blocked DM does not prevent group delivery', async () => {
    const f = await fixture()
    f.setFail({ error_code: 403, description: 'Forbidden' })
    await f.service.subscribe(routineActor, f.doc.id, true)
    await f.delivery.requestCard(f.doc.id, routineActor.householdId, '100')
    f.setFail(null)
    await f.delivery.bind(f.doc.id, routineActor.householdId, {
      chatId: '-1001',
      threadId: 136,
      name: 'Дела'
    })
    expect(f.calls.some((c) => c.chat === '-1001')).toBe(true)
    expect((await f.repository.get(f.doc.id))?.subscriptions.alex?.blocked).toBe(true)
  })
  test('overlapping workers respect the routine delivery lease', async () => {
    const f = await fixture()
    await Promise.all([
      f.delivery.requestCard(f.doc.id, routineActor.householdId, '100'),
      f.delivery.requestCard(f.doc.id, routineActor.householdId, '100')
    ])
    expect(f.calls.filter((c) => c.method === 'send')).toHaveLength(1)
  })
  test('callbacks stay under 64 bytes and expose explicit actions', async () => {
    const f = await fixture()
    const content = renderRoutineCard(f.doc, f.doc.days[0]!, '2026-09-10T04:00:00Z')
    for (const row of content.reply_markup.inline_keyboard)
      for (const button of row)
        if ('callback_data' in button)
          expect(Buffer.byteLength(button.callback_data)).toBeLessThanOrEqual(64)
    expect(content.reply_markup.inline_keyboard[0]?.[0]).toMatchObject({
      callback_data: expect.stringMatching(/:0:d$/)
    })
  })
  test('a multi-slot day card offers one focused button and expands to the full checklist', async () => {
    const f = await fixture()
    const doc = await f.service.save(routineActor, {
      ...routineInput,
      id: '00112233445566aa',
      definition: {
        title: 'Уход',
        tasks: [
          {
            ...routineInput.definition.tasks[0]!,
            times: ['09:00', '13:00', '20:00'],
            reminderEnabled: false
          }
        ]
      }
    })
    const upcoming = renderRoutineCard(doc, doc.days[0]!, '2026-09-10T04:00:00Z')
    expect(upcoming.text).toContain('Дальше: 09:00')
    expect(upcoming.reply_markup.inline_keyboard).toHaveLength(2)
    expect(upcoming.reply_markup.inline_keyboard[0]![0]).toMatchObject({
      text: '☐ 09:00 · Вода',
      callback_data: `rt:${doc.id}:${doc.days[0]!.rows[0]!.id}:0:d`
    })
    expect(upcoming.reply_markup.inline_keyboard[1]![0]).toMatchObject({
      text: '⋯ Все дела · 0 из 3',
      callback_data: `rtx:${doc.id}`
    })
    const due = renderRoutineCard(doc, doc.days[0]!, '2026-09-10T09:30:00Z')
    expect(due.text).toContain('Пора: 13:00')
    expect(due.reply_markup.inline_keyboard[0]![0]).toMatchObject({ text: '⏰ 13:00 · Вода' })
    const expanded = renderRoutineCard(doc, doc.days[0]!, '2026-09-10T09:30:00Z', undefined, true)
    expect(expanded.reply_markup.inline_keyboard).toHaveLength(4)
    expect(expanded.reply_markup.inline_keyboard[3]![0]).toMatchObject({
      text: '⌃ Свернуть',
      callback_data: `rtx:${doc.id}`
    })
    for (const content of [upcoming, due, expanded])
      for (const row of content.reply_markup.inline_keyboard)
        for (const button of row)
          if ('callback_data' in button)
            expect(Buffer.byteLength(button.callback_data)).toBeLessThanOrEqual(64)
  })
  test('the card names the last completion and reports a finished day', async () => {
    const f = await fixture()
    await f.service.act(routineActor, {
      id: f.doc.id,
      rowId: f.doc.days[0]!.rows[0]!.id,
      version: 0,
      action: 'complete',
      requestId: 'done'
    })
    const doc = (await f.repository.get(f.doc.id))!
    const content = renderRoutineCard(doc, doc.days[0]!, '2026-09-10T05:10:00Z')
    expect(content.text).toContain('Последнее: 08:00, Саша')
    expect(content.text).toContain('Все дела на сегодня выполнены')
    expect(content.reply_markup.inline_keyboard[0]![0]).toMatchObject({
      callback_data: expect.stringMatching(/:1:u$/)
    })
  })
  test('expired leases can be reclaimed after a worker crash', async () => {
    const f = await fixture()
    await f.repository.change(f.doc.id, routineActor.householdId, (d) => {
      d.lease = { token: 'crashed', until: '2026-09-10T03:59:00Z' }
    })
    await f.delivery.requestCard(f.doc.id, routineActor.householdId, '100')
    expect(f.calls).toHaveLength(1)
  })
})

describe('topic message links', () => {
  test.each(['https://t.me/c/2636668636/136/4223', 'https://t.me/c/2636668636/4223?thread=136'])(
    'parses %s',
    (link) => {
      expect(parseRoutineTopicLink(link)).toEqual({
        chat: '-1002636668636',
        threadId: 136,
        messageId: 4223
      })
    }
  )
  test('public link resolves username separately from the parser', () => {
    expect(parseRoutineTopicLink('https://t.me/our_house/136/4223')).toEqual({
      chat: '@our_house',
      threadId: 136,
      messageId: 4223
    })
  })
  test.each([
    'https://t.me/c/2636668636/4223',
    'https://evil.com/c/2636668636/136/4223',
    'https://t.me.evil.com/c/1/2/3',
    'https://t.me/c/1/2/3?thread=4',
    'https://t.me/c/1/2/3?thread=2&thread=2',
    'https://t.me/c/1/0/3',
    'https://t.me/c/1/2/3?comment=7',
    'https://t.me/c/1/99999999999/3'
  ])('rejects ambiguous or invalid link %s', (link) => {
    expect(() => parseRoutineTopicLink(link)).toThrow()
  })
})

test('a rate-limited reminder is discarded once the catch-up window closes', async () => {
  const f = await fixture()
  await f.delivery.bind(f.doc.id, routineActor.householdId, {
    chatId: '-1001',
    threadId: 136,
    name: 'Дела'
  })
  f.setNow('2026-09-10T05:00:00Z')
  f.setFail({
    error_code: 429,
    description: 'Too many requests',
    parameters: { retry_after: 1200 }
  })
  await f.delivery.tick()
  f.setFail(null)
  f.setNow('2026-09-10T05:21:00Z')
  await f.delivery.tick()
  expect(f.calls.filter((c) => c.method === 'send')).toHaveLength(1)
})

test('undo after the due time does not create a reminder that was never sent', async () => {
  const f = await fixture()
  await f.delivery.bind(f.doc.id, routineActor.householdId, {
    chatId: '-1001',
    threadId: 136,
    name: 'Дела'
  })
  const rowId = f.doc.days[0]!.rows[0]!.id
  await f.service.act(routineActor, {
    id: f.doc.id,
    rowId,
    version: 0,
    action: 'complete',
    requestId: 'early'
  })
  f.setNow('2026-09-10T05:01:00Z')
  await f.service.act(routineActor, {
    id: f.doc.id,
    rowId,
    version: 1,
    action: 'reopen',
    requestId: 'late-undo'
  })
  await f.delivery.tick()
  expect(f.calls.filter((c) => c.method === 'send')).toHaveLength(1)
})

test('a deleted daily card can be recreated by explicitly opening it again', async () => {
  const f = await fixture()
  await f.delivery.requestCard(f.doc.id, routineActor.householdId, '100')
  await f.service.act(routineActor, {
    id: f.doc.id,
    rowId: f.doc.days[0]!.rows[0]!.id,
    version: 0,
    action: 'complete',
    requestId: 'done'
  })
  f.setFail({ error_code: 400, description: 'Bad Request: message to edit not found' })
  await f.delivery.tick()
  f.setFail(null)
  await f.delivery.requestCard(f.doc.id, routineActor.householdId, '100')
  expect(f.calls.filter((c) => c.method === 'send')).toHaveLength(2)
})

test('a night window keeps yesterday card actionable and sends only one reminder inside its window', async () => {
  const f = await fixture()
  const doc = await f.service.save(routineActor, {
    ...routineInput,
    id: 'aabbccddeeff0022',
    definition: {
      ...routineInput.definition,
      dayStart: '04:00',
      tasks: [
        { ...routineInput.definition.tasks[0]!, times: ['00:00-02:00'], reminderEnabled: true }
      ]
    }
  })
  await f.delivery.bind(doc.id, routineActor.householdId, {
    chatId: '-1001',
    threadId: 136,
    name: 'Ночь'
  })
  f.setNow('2026-09-10T20:30:00Z') // 00:30 next calendar day, still routine day September 10
  await f.delivery.tick()
  const live = (await f.repository.get(doc.id))!
  expect(live.days.map((day) => day.date)).toEqual(['2026-09-10'])
  expect(
    renderRoutineCard(live, live.days[0]!, '2026-09-10T20:30:00Z').reply_markup.inline_keyboard
      .length
  ).toBeGreaterThan(0)
  expect(f.calls.filter((call) => call.method === 'send')).toHaveLength(2)
  f.setNow('2026-09-10T21:00:00Z')
  await f.delivery.tick()
  expect(f.calls.filter((call) => call.method === 'send')).toHaveLength(2)
})
