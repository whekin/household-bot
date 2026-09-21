import { describe, expect, test } from 'bun:test'
import { createRoutineService, materializeRoutineDay } from './routine-service'

import { routineMemoryRepository, routineActor, routineInput } from './routine-test-fixtures'

describe('shared routine application', () => {
  test('two members use the same day; retries and stale clicks cannot toggle twice', async () => {
    const repository = routineMemoryRepository()
    const service = createRoutineService(repository, () => '2026-09-10T04:00:00Z')
    const doc = await service.save(routineActor, routineInput)
    const input = {
      id: doc.id,
      rowId: doc.days[0]!.rows[0]!.id,
      version: 0,
      action: 'complete' as const,
      requestId: 'first'
    }
    await service.act(routineActor, input)
    await service.act(routineActor, input)
    await expect(
      service.act({ ...routineActor, id: 'sam' }, { ...input, requestId: 'second' })
    ).rejects.toThrow('Уже отмечено')
    const latest = (await service.list(routineActor))[0]!
    expect(latest.days[0]!.rows[0]!.version).toBe(1)
    expect(latest.days[0]!.rows[0]!.actorName).toBe('Саша')
    await service.act(
      { ...routineActor, id: 'sam' },
      { ...input, action: 'reopen', version: 1, requestId: 'third' }
    )
    expect((await repository.get(doc.id))!.days[0]!.rows[0]!.status).toBe('pending')
  })
  test('edits start tomorrow and preserve a completed snapshot', async () => {
    let now = '2026-09-10T04:00:00Z'
    const repository = routineMemoryRepository()
    const service = createRoutineService(repository, () => now)
    const doc = await service.save(routineActor, routineInput)
    await service.act(routineActor, {
      id: doc.id,
      rowId: doc.days[0]!.rows[0]!.id,
      version: 0,
      action: 'complete',
      requestId: '1'
    })
    await service.save(routineActor, {
      ...routineInput,
      expectedRevision: 1,
      definition: {
        ...routineInput.definition,
        title: 'Растения',
        tasks: [
          { ...routineInput.definition.tasks[0]!, title: 'Полить', times: ['10:00', '18:00'] }
        ]
      }
    })
    const today = (await service.list(routineActor))[0]!
    expect(today.days[0]!.rows[0]!.title).toBe('Вода')
    expect(today.days[0]!.rows[0]!.status).toBe('completed')
    now = '2026-09-10T20:00:00Z' // midnight in Tbilisi
    const next = (await service.list(routineActor))[0]!
    expect(next.days[1]!.rows).toHaveLength(2)
    expect(next.days[1]!.title).toBe('Растения')
    await expect(
      service.act(routineActor, {
        id: doc.id,
        rowId: doc.days[0]!.rows[0]!.id,
        version: 1,
        action: 'reopen',
        requestId: 'old'
      })
    ).rejects.toThrow('устарела')
  })
  test('membership, household isolation and admin configuration are enforced', async () => {
    const repository = routineMemoryRepository()
    const service = createRoutineService(repository)
    await service.save(routineActor, routineInput)
    await expect(service.list({ ...routineActor, status: 'left' })).rejects.toThrow('прав')
    await expect(service.save({ ...routineActor, isAdmin: false }, routineInput)).rejects.toThrow(
      'прав'
    )
    await expect(
      service.pause({ ...routineActor, householdId: 'other' }, routineInput.id, true, 1)
    ).rejects.toThrow('not found')
    await expect(service.pause(routineActor, routineInput.id, true, 0)).rejects.toThrow('изменён')
  })
  test('pause retains work and subscriptions are per-member', async () => {
    const repository = routineMemoryRepository()
    const service = createRoutineService(repository)
    const doc = await service.save(routineActor, routineInput)
    await service.subscribe(routineActor, doc.id, true)
    await service.subscribe({ ...routineActor, id: 'sam', telegramUserId: '200' }, doc.id, false)
    await service.pause(routineActor, doc.id, true, 1)
    await expect(
      service.act(routineActor, {
        id: doc.id,
        rowId: doc.days[0]!.rows[0]!.id,
        version: 0,
        action: 'complete',
        requestId: 'paused'
      })
    ).rejects.toThrow('паузе')
    const final = (await repository.get(doc.id))!
    expect(final.subscriptions.alex?.enabled).toBe(true)
    expect(final.subscriptions.sam?.enabled).toBe(false)
  })
  test('materialization is idempotent, has bounded history and does not backfill missed days', async () => {
    const service = createRoutineService(routineMemoryRepository(), () => '2026-09-10T04:00:00Z')
    const doc = await service.save(routineActor, routineInput)
    materializeRoutineDay(doc, '2026-09-10T05:00:00Z')
    expect(doc.days).toHaveLength(1)
    materializeRoutineDay(doc, '2026-11-01T05:00:00Z')
    expect(doc.days.map((d) => d.date)).toEqual(['2026-11-01'])
  })
})

test('moving day start later keeps last evening open until the new boundary', async () => {
  let now = '2026-09-15T18:00:00+04:00'
  const service = createRoutineService(routineMemoryRepository(), () => now)
  const doc = await service.save(routineActor, routineInput)
  await service.save(routineActor, {
    ...routineInput,
    expectedRevision: 1,
    definition: {
      ...routineInput.definition,
      dayStart: '04:00',
      tasks: [{ ...routineInput.definition.tasks[0]!, times: ['00:00-02:00'] }]
    }
  })
  now = '2026-09-16T01:00:00+04:00'
  const during = (await service.list(routineActor))[0]!
  expect(during.days.map((day) => day.date)).toEqual(['2026-09-15'])
  await service.act(routineActor, {
    id: doc.id,
    rowId: doc.days[0]!.rows[0]!.id,
    version: 0,
    action: 'complete',
    requestId: 'night'
  })
  now = '2026-09-16T04:00:00+04:00'
  const after = (await service.list(routineActor))[0]!
  expect(after.days.map((day) => day.date)).toEqual(['2026-09-15', '2026-09-16'])
  expect(after.days[1]?.rows[0]?.dueAt).toBe('2026-09-16T20:00:00Z')
})

test('a new 04:00 routine accepts yesterday card actions at 01:00 but not after 04:00', async () => {
  let now = '2026-09-15T20:00:00+04:00'
  const repository = routineMemoryRepository()
  const service = createRoutineService(repository, () => now)
  const definition = {
    ...routineInput.definition,
    dayStart: '04:00',
    quickActions: [{ id: 'feed', label: 'Покормил сейчас', summaryLabel: 'Последнее кормление' }],
    tasks: [{ ...routineInput.definition.tasks[0]!, activityId: 'feed', times: ['00:00-02:00'] }]
  }
  const doc = await service.save(routineActor, { ...routineInput, definition })
  now = '2026-09-16T01:00:00+04:00'
  const input = {
    id: doc.id,
    rowId: doc.days[0]!.rows[0]!.id,
    version: 0,
    action: 'complete' as const,
    activityId: 'feed',
    requestId: 'quick'
  }
  const completed = await service.act(routineActor, input)
  expect(completed.days[0]?.rows[0]?.actedAt).toBe(now)
  await expect(
    service.act({ ...routineActor, id: 'sam' }, { ...input, requestId: 'other' })
  ).rejects.toThrow('Уже отмечено')
  await service.act(routineActor, { ...input, version: 1, requestId: 'fresh-repeat' })
  expect((await repository.get(doc.id))?.days[0]?.rows[0]?.version).toBe(1)
  now = '2026-09-16T04:00:00+04:00'
  await expect(
    service.act(routineActor, { ...input, version: 1, requestId: 'old-card' })
  ).rejects.toThrow('устарела')
})

test('moving the boundary earlier during the night never activates a saved definition retroactively', async () => {
  let now = '2026-09-15T20:00:00+04:00'
  const service = createRoutineService(routineMemoryRepository(), () => now)
  await service.save(routineActor, {
    ...routineInput,
    definition: { ...routineInput.definition, dayStart: '04:00' }
  })
  now = '2026-09-16T01:00:00+04:00'
  const doc = await service.save(routineActor, {
    ...routineInput,
    expectedRevision: 1,
    definition: { ...routineInput.definition, dayStart: '00:00' }
  })
  expect(doc.nextDefinition?.effectiveDate).toBe('2026-09-17')
  expect((await service.list(routineActor))[0]?.definition.dayStart).toBe('04:00')
})

test('replacing a pending boundary edit during its active extension cannot close tonight early', async () => {
  let now = '2026-09-15T18:00:00+04:00'
  const service = createRoutineService(routineMemoryRepository(), () => now)
  const first = await service.save(routineActor, routineInput)
  await service.save(routineActor, {
    ...routineInput,
    expectedRevision: 1,
    definition: { ...routineInput.definition, dayStart: '04:00' }
  })
  now = '2026-09-16T01:00:00+04:00'
  await service.save(routineActor, { ...routineInput, expectedRevision: 2 })
  const afterEdit = (await service.list(routineActor))[0]!
  expect(afterEdit.days.map((day) => day.date)).toEqual(['2026-09-15'])
  expect(afterEdit.nextDefinition?.effectiveDate).toBe('2026-09-17')
  await service.act(routineActor, {
    id: first.id,
    rowId: first.days[0]!.rows[0]!.id,
    version: 0,
    action: 'complete',
    requestId: 'after-edit'
  })
  now = '2026-09-16T04:00:00+04:00'
  const next = (await service.list(routineActor))[0]!
  expect(next.days.map((day) => day.date)).toEqual(['2026-09-15', '2026-09-16'])
  expect(next.activeDayExtension).toBeUndefined()
})

test('a future boundary extension can still be cancelled before it starts', async () => {
  let now = '2026-09-15T18:00:00+04:00'
  const service = createRoutineService(routineMemoryRepository(), () => now)
  await service.save(routineActor, routineInput)
  await service.save(routineActor, {
    ...routineInput,
    expectedRevision: 1,
    definition: { ...routineInput.definition, dayStart: '04:00' }
  })
  now = '2026-09-15T23:00:00+04:00'
  await service.save(routineActor, { ...routineInput, expectedRevision: 2 })
  now = '2026-09-16T00:01:00+04:00'
  const next = (await service.list(routineActor))[0]!
  expect(next.days.map((day) => day.date)).toEqual(['2026-09-15', '2026-09-16'])
})

describe('completion-relative household chores', () => {
  function fixture(intervalDays = 14) {
    let now = '2026-09-21T10:00:00Z'
    const repository = routineMemoryRepository()
    const service = createRoutineService(repository, () => now)
    const input = {
      ...routineInput,
      definition: {
        title: 'Дом',
        tasks: [
          {
            id: 'sponge',
            title: 'Заменить губку',
            weekdays: [],
            times: [],
            reminderEnabled: false,
            claimEnabled: true,
            recurrence: { intervalDays, firstDueDate: '2026-09-21' }
          }
        ]
      }
    }
    return {
      repository,
      service,
      input,
      setNow: (value: string) => {
        now = value
      }
    }
  }
  test('overdue work remains one occurrence and next date follows actual completion', async () => {
    const f = fixture()
    const initial = await f.service.save(routineActor, f.input)
    const row = initial.days[0]!.rows[0]!
    f.setNow('2026-10-08T10:00:00Z')
    const overdue = (await f.service.list(routineActor))[0]!
    expect(overdue.days.at(-1)!.rows).toHaveLength(1)
    expect(overdue.days.at(-1)!.rows[0]!.id).toBe(row.id)
    const action = {
      id: initial.id,
      rowId: row.id,
      version: 0,
      action: 'complete' as const,
      requestId: 'done'
    }
    await f.service.act(routineActor, action)
    await f.service.act(routineActor, action)
    await expect(f.service.act(routineActor, { ...action, requestId: 'stale' })).rejects.toThrow(
      'Уже отмечено'
    )
    expect((await f.repository.get(initial.id))!.recurringTasks!.sponge!.nextDueDate).toBe(
      '2026-10-22'
    )
    f.setNow('2026-10-21T10:00:00Z')
    expect((await f.service.list(routineActor))[0]!.days.at(-1)!.rows).toHaveLength(0)
    f.setNow('2026-10-22T10:00:00Z')
    const next = (await f.service.list(routineActor))[0]!.days.at(-1)!.rows
    expect(next).toHaveLength(1)
    expect(next[0]!.id).not.toBe(row.id)
    expect(next[0]!.status).toBe('pending')
  })
  test('same-day undo restores the original due date and completion history', async () => {
    const f = fixture()
    const doc = await f.service.save(routineActor, f.input)
    const row = doc.days[0]!.rows[0]!
    await f.service.act(routineActor, {
      id: doc.id,
      rowId: row.id,
      version: 0,
      action: 'complete',
      requestId: 'done'
    })
    await f.service.act(routineActor, {
      id: doc.id,
      rowId: row.id,
      version: 1,
      action: 'reopen',
      requestId: 'undo'
    })
    const latest = (await f.service.list(routineActor))[0]!
    expect(latest.recurringTasks!.sponge!.nextDueDate).toBe('2026-09-21')
    expect(latest.recurringTasks!.sponge!.lastCompletedAt).toBeNull()
    expect(latest.days.at(-1)!.rows[0]!.status).toBe('pending')
  })
  test('long intervals survive history pruning and use the household completion date', async () => {
    const f = fixture(90)
    const doc = await f.service.save(routineActor, f.input)
    f.setNow('2026-09-21T21:00:00Z') // September 22 in Tbilisi
    await f.service.act(routineActor, {
      id: doc.id,
      rowId: doc.days[0]!.rows[0]!.id,
      version: 0,
      action: 'complete',
      requestId: 'done'
    })
    f.setNow('2026-11-25T10:00:00Z')
    const latest = (await f.service.list(routineActor))[0]!
    expect(latest.days).toHaveLength(1)
    expect(latest.days[0]!.rows).toHaveLength(0)
    expect(latest.recurringTasks!.sponge!.nextDueDate).toBe('2026-12-21')
    expect(latest.recurringTasks!.sponge!.lastCompletedByName).toBe(routineActor.displayName)
  })
  test('interval edits apply tomorrow from last completion; removal clears recurring state', async () => {
    const f = fixture()
    const doc = await f.service.save(routineActor, f.input)
    await f.service.act(routineActor, {
      id: doc.id,
      rowId: doc.days[0]!.rows[0]!.id,
      version: 0,
      action: 'complete',
      requestId: 'done'
    })
    const task = f.input.definition.tasks[0]!
    await f.service.save(routineActor, {
      ...f.input,
      expectedRevision: 1,
      definition: {
        title: 'Дом',
        tasks: [{ ...task, recurrence: { intervalDays: 7, firstDueDate: '2026-10-30' } }]
      }
    })
    expect((await f.service.list(routineActor))[0]!.recurringTasks!.sponge!.nextDueDate).toBe(
      '2026-10-05'
    )
    f.setNow('2026-09-22T10:00:00Z')
    expect((await f.service.list(routineActor))[0]!.recurringTasks!.sponge!.nextDueDate).toBe(
      '2026-09-28'
    )
    await f.service.save(routineActor, {
      ...f.input,
      expectedRevision: 2,
      definition: routineInput.definition
    })
    f.setNow('2026-09-23T10:00:00Z')
    expect((await f.service.list(routineActor))[0]!.recurringTasks).toEqual({})
  })
  test('a future first date stays hidden and paused overdue work survives pruning', async () => {
    const f = fixture()
    const doc = await f.service.save(routineActor, {
      ...f.input,
      definition: {
        ...f.input.definition,
        tasks: [
          {
            ...f.input.definition.tasks[0]!,
            recurrence: { intervalDays: 7, firstDueDate: '2026-09-28' }
          }
        ]
      }
    })
    expect(doc.days[0]!.rows).toHaveLength(0)
    await f.service.pause(routineActor, doc.id, true, 1)
    f.setNow('2026-11-21T10:00:00Z')
    const paused = (await f.service.list(routineActor))[0]!
    const row = paused.days.at(-1)!.rows[0]!
    expect(row.recurrenceDueDate).toBe('2026-09-28')
    await expect(
      f.service.act(routineActor, {
        id: doc.id,
        rowId: row.id,
        version: 0,
        action: 'complete',
        requestId: 'paused'
      })
    ).rejects.toThrow('паузе')
    await f.service.pause(routineActor, doc.id, false, 2)
    await f.service.act(routineActor, {
      id: doc.id,
      rowId: row.id,
      version: 0,
      action: 'complete',
      requestId: 'done'
    })
    expect((await f.repository.get(doc.id))!.recurringTasks!.sponge!.nextDueDate).toBe('2026-11-28')
  })
})
