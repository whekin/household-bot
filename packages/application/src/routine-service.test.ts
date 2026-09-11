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
