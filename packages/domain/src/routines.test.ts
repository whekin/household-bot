import { describe, expect, test } from 'bun:test'

import { Temporal } from './time'
import {
  applyRoutineAction,
  effectiveRoutineProgress,
  normalizeRoutine,
  routineDayDate,
  pickRoutineQuickTarget,
  pickRoutineFocus,
  routineOccurrencesForDate,
  type RoutineAction,
  type RoutineOccurrenceState,
  type RoutineTask
} from './routines'

const task: RoutineTask = {
  id: 'water',
  title: ' Свежая вода ',
  weekdays: [1, 2, 3, 4, 5, 6, 7],
  times: [],
  reminderEnabled: false,
  claimEnabled: true
}
const now = Temporal.Instant.from('2026-09-10T05:00:00Z')
const pending: RoutineOccurrenceState = { version: 0, progress: { status: 'pending' } }

function act(
  state: RoutineOccurrenceState,
  action: RoutineAction,
  memberId = 'alex',
  expectedVersion = state.version,
  at = now
) {
  return applyRoutineAction({
    state,
    action,
    memberId,
    expectedVersion,
    now: at,
    claimEnabled: true
  })
}

function occurrences(
  tasks: readonly RoutineTask[],
  localDate = '2026-09-10',
  timezone = 'Asia/Tbilisi'
) {
  return routineOccurrencesForDate({ definition: { title: 'Уход', tasks }, localDate, timezone })
}

describe('routine schedules', () => {
  test('normalizes user labels and time ordering without mutating the draft', () => {
    const times = ['18:00', '09:00']
    const result = normalizeRoutine({ title: '  Дом  ', tasks: [{ ...task, times }] })
    expect(result.title).toBe('Дом')
    expect(result.tasks[0]?.title).toBe('Свежая вода')
    expect(result.tasks[0]?.times).toEqual(['09:00', '18:00'])
    expect(times).toEqual(['18:00', '09:00'])
  })

  test('creates an untimed checkbox and distinct slots in household timezone', () => {
    const rows = occurrences([
      task,
      { ...task, id: 'feed', title: 'Кормление', times: ['09:00', '18:00'], reminderEnabled: true }
    ])
    expect(rows).toHaveLength(3)
    expect(rows[0]?.dueAt).toBeNull()
    expect(rows[0]?.key).toBe('water/2026-09-10/day')
    expect(rows[1]?.dueAt?.toString()).toBe('2026-09-10T05:00:00Z')
    expect(rows[2]?.dueAt?.toString()).toBe('2026-09-10T14:00:00Z')
    expect(occurrences([{ ...task, weekdays: [1] }])).toEqual([])
  })

  test('slot identity survives renaming and changes across dates', () => {
    expect(occurrences([task])[0]?.key).toBe(
      occurrences([{ ...task, title: 'Полить растения' }])[0]?.key
    )
    expect(occurrences([task])[0]?.key).not.toBe(occurrences([task], '2026-09-11')[0]?.key)
  })

  test('handles DST gaps and repeated hours as one occurrence per configured slot', () => {
    const scheduled = { ...task, times: ['02:30'] }
    const spring = occurrences([scheduled], '2026-03-29', 'Europe/Berlin')
    const autumn = occurrences([scheduled], '2026-10-25', 'Europe/Berlin')
    expect(spring).toHaveLength(1)
    expect(spring[0]?.dueAt?.toString()).toBe('2026-03-29T01:30:00Z')
    expect(autumn).toHaveLength(1)
    expect(autumn[0]?.dueAt?.toString()).toBe('2026-10-25T00:30:00Z')
  })

  test.each([
    { weekdays: [] },
    { weekdays: [0] },
    { weekdays: [8] },
    { weekdays: [1.5] },
    { weekdays: [1, 1] },
    { times: ['24:00'] },
    { times: ['9:00'] },
    { times: ['12:60'] },
    { times: ['09:00', '09:00'] },
    { times: [], reminderEnabled: true },
    { title: ' ' },
    { title: 'a'.repeat(61) },
    { title: 'line\nbreak' },
    { id: 'unsafe/id' }
  ])('rejects invalid task configuration %j', (patch) => {
    expect(() => occurrences([{ ...task, ...patch }])).toThrow()
  })

  test('rejects duplicate task IDs, empty routine and invalid dates even without scheduled tasks', () => {
    expect(() => occurrences([task, task])).toThrow()
    expect(() => occurrences([])).toThrow()
    expect(() => occurrences([task], '2026-02-30')).toThrow()
    expect(() => occurrences([task], '2026-9-10')).toThrow()
    expect(() => occurrences([task], '2026-09-10', 'Not/AZone')).toThrow()
  })

  test('limits expanded daily rows, including untimed tasks', () => {
    const times = Array.from({ length: 20 }, (_, i) => `${String(i).padStart(2, '0')}:00`)
    expect(occurrences([{ ...task, times }])).toHaveLength(20)
    expect(() =>
      occurrences([
        { ...task, times },
        { ...task, id: 'other' }
      ])
    ).toThrow()
    expect(() =>
      occurrences([
        { ...task, times, weekdays: [1] },
        { ...task, id: 'other', weekdays: [2] }
      ])
    ).not.toThrow()
  })
})

describe('routine actions', () => {
  test('any member can complete and explicitly undo an up-to-date completion', () => {
    const completed = act(pending, 'complete')
    expect(completed.status).toBe('changed')
    expect(completed.state.progress).toEqual({
      status: 'completed',
      memberId: 'alex',
      completedAt: now
    })
    const reopened = act(completed.state, 'reopen', 'sam')
    expect(reopened.state).toEqual({ version: 2, progress: { status: 'pending' } })
    expect(pending.progress.status).toBe('pending')
  })

  test('two clicks from the same old card cannot undo or reattribute a completion', () => {
    const completed = act(pending, 'complete')
    expect(act(completed.state, 'complete', 'sam', 0).status).toBe('conflict')
    expect(act(completed.state, 'reopen', 'sam', 0).status).toBe('conflict')
    const duplicate = act(completed.state, 'complete', 'sam')
    expect(duplicate.status).toBe('unchanged')
    expect(duplicate.state).toBe(completed.state)
  })

  test('reopen retries cannot erase a later completion', () => {
    const first = act(pending, 'complete').state
    const reopened = act(first, 'reopen').state
    const second = act(reopened, 'complete', 'sam').state
    expect(act(second, 'reopen', 'alex', first.version).status).toBe('conflict')
  })

  test('claim is exclusive but does not prevent another member from completing', () => {
    const claimed = act(pending, 'claim')
    expect(claimed.state.progress.status).toBe('claimed')
    expect(act(claimed.state, 'claim', 'sam').status).toBe('claimed_by_other')
    expect(act(claimed.state, 'release', 'sam').status).toBe('claimed_by_other')
    expect(act(claimed.state, 'complete', 'sam').state.progress.status).toBe('completed')
    expect(act(claimed.state, 'release').state.progress.status).toBe('pending')
  })

  test('claim expires at exactly 30 minutes and can be acquired by someone else', () => {
    const claimed = act(pending, 'claim').state
    const boundary = now.add({ seconds: 30 * 60 })
    expect(
      effectiveRoutineProgress(claimed.progress, boundary.subtract({ seconds: 1 })).status
    ).toBe('claimed')
    expect(effectiveRoutineProgress(claimed.progress, boundary).status).toBe('pending')
    const next = act(claimed, 'claim', 'sam', claimed.version, boundary)
    expect(next.status).toBe('changed')
    expect(next.state.progress.status === 'claimed' && next.state.progress.memberId).toBe('sam')
  })

  test('repeated claim does not silently extend the lease', () => {
    const claimed = act(pending, 'claim').state
    const retry = act(claimed, 'claim', 'alex', claimed.version, now.add({ seconds: 60 }))
    expect(retry.status).toBe('unchanged')
    expect(retry.state).toBe(claimed)
  })

  test('disabled claim and operations on completed/pending tasks do not change them', () => {
    expect(
      applyRoutineAction({
        state: pending,
        expectedVersion: 0,
        action: 'claim',
        memberId: 'alex',
        now,
        claimEnabled: false
      }).status
    ).toBe('claim_disabled')
    expect(act(pending, 'reopen').status).toBe('unchanged')
    expect(act(pending, 'release').status).toBe('unchanged')
    const completed = act(pending, 'complete').state
    expect(act(completed, 'claim').status).toBe('unchanged')
    expect(act(completed, 'release').status).toBe('unchanged')
  })

  test('rejects invalid actors and versions', () => {
    expect(() => act(pending, 'complete', ' ')).toThrow()
    expect(() => act(pending, 'complete', 'alex', -1)).toThrow()
    expect(() => act({ ...pending, version: 0.5 }, 'complete')).toThrow()
  })
})

describe('routine focus', () => {
  const now = '2026-09-11T13:00:00Z'
  const slot = (time: string, status: 'pending' | 'claimed' | 'completed' = 'pending') => ({
    id: time,
    status,
    dueAt: `2026-09-11T${time}:00Z`
  })

  test('picks the latest slot that is already due and keeps missed ones untouched', () => {
    const focus = pickRoutineFocus([slot('09:00'), slot('12:00'), slot('16:00')], now)
    expect(focus?.row.id).toBe('12:00')
    expect(focus?.state).toBe('overdue')
    expect(focus?.minutes).toBe(-60)
  })

  test('falls back to the next slot when nothing is due yet', () => {
    const focus = pickRoutineFocus([slot('16:00'), slot('20:00')], now)
    expect(focus?.row.id).toBe('16:00')
    expect(focus?.state).toBe('upcoming')
    expect(focus?.minutes).toBe(180)
  })

  test('skips completed slots, keeps claimed ones actionable', () => {
    expect(pickRoutineFocus([slot('12:00', 'completed'), slot('16:00')], now)?.row.id).toBe('16:00')
    expect(pickRoutineFocus([slot('12:00', 'claimed'), slot('16:00')], now)?.row.id).toBe('12:00')
  })

  test('uses untimed rows only when no slot is left and reports an empty day', () => {
    const untimed = { id: 'any', status: 'pending' as const, dueAt: null }
    expect(pickRoutineFocus([slot('12:00', 'completed'), untimed], now)?.state).toBe('untimed')
    expect(pickRoutineFocus([slot('12:00'), untimed], now)?.row.id).toBe('12:00')
    expect(pickRoutineFocus([slot('12:00', 'completed')], now)).toBeNull()
    expect(pickRoutineFocus([], now)).toBeNull()
  })

  test('treats the exact slot minute as due', () => {
    expect(pickRoutineFocus([slot('13:00')], now)?.state).toBe('due')
  })
})

describe('flexible routine windows', () => {
  test('anchors after-midnight slots to the previous routine day', () => {
    const definition = {
      title: 'Ночь',
      dayStart: '04:00',
      tasks: [{ ...task, times: ['23:30-01:00', '01:30-02:00'] }]
    }
    const rows = routineOccurrencesForDate({
      definition,
      localDate: '2026-09-15',
      timezone: 'Asia/Tbilisi'
    })
    expect(rows[0]?.dueAt?.toString()).toBe('2026-09-15T19:30:00Z')
    expect(rows[0]?.windowEndsAt?.toString()).toBe('2026-09-15T21:00:00Z')
    expect(rows[1]?.dueAt?.toString()).toBe('2026-09-15T21:30:00Z')
    expect(rows[1]?.localDate).toBe('2026-09-15')
  })
  test('orders slots relative to the configured day start', () => {
    const definition = normalizeRoutine({
      title: 'День',
      dayStart: '04:00',
      tasks: [{ ...task, times: ['01:00', '09:00–10:00', '23:00'] }]
    })
    expect(definition.tasks[0]?.times).toEqual(['09:00-10:00', '23:00', '01:00'])
  })
  test.each(
    [
      ['09:00-09:00'],
      ['23:30-04:30'],
      ['09:00-10:00', '09:30'],
      ['09:00-10:00', '09:00–10:00']
    ].map((times) => ({ times }))
  )('rejects zero-length, overlapping and cross-boundary windows %j', ({ times }) => {
    expect(() =>
      normalizeRoutine({ title: 'День', dayStart: '04:00', tasks: [{ ...task, times }] })
    ).toThrow()
  })
  test('marks an open window as due, not overdue', () => {
    const row = {
      status: 'pending' as const,
      dueAt: '2026-09-15T05:00:00Z',
      windowEndsAt: '2026-09-15T06:00:00Z'
    }
    expect(pickRoutineFocus([row], '2026-09-15T05:59:00Z')?.state).toBe('due')
    expect(pickRoutineFocus([row], '2026-09-15T06:01:00Z')?.state).toBe('overdue')
  })
})

test('routine day boundary follows wall time across DST and month changes', () => {
  expect(routineDayDate('Asia/Tbilisi', '04:00', '2026-10-01T23:59:59+04:00')).toBe('2026-10-01')
  expect(routineDayDate('Asia/Tbilisi', '04:00', '2026-10-01T03:59:59+04:00')).toBe('2026-09-30')
  expect(routineDayDate('Asia/Tbilisi', '04:00', '2026-10-01T04:00:00+04:00')).toBe('2026-10-01')
  expect(routineDayDate('Europe/Berlin', '04:00', '2026-03-29T03:30:00+02:00')).toBe('2026-03-28')
})

test('quick target selects the closest matching window and never skips a completed closest row', () => {
  const rows = [
    {
      id: 'morning',
      activityId: 'feed',
      status: 'pending' as const,
      dueAt: '2026-09-15T05:00:00Z',
      windowEndsAt: '2026-09-15T06:00:00Z'
    },
    {
      id: 'midday',
      activityId: 'feed',
      status: 'completed' as const,
      dueAt: '2026-09-15T08:00:00Z',
      windowEndsAt: '2026-09-15T09:00:00Z'
    },
    {
      id: 'bottles',
      activityId: 'water',
      status: 'pending' as const,
      dueAt: '2026-09-15T08:30:00Z'
    }
  ]
  expect(pickRoutineQuickTarget(rows, 'feed', '2026-09-15T08:30:00Z')?.id).toBe('midday')
  expect(pickRoutineQuickTarget(rows, 'feed', '2026-09-15T07:00:00Z')?.id).toBe('morning')
  expect(pickRoutineQuickTarget(rows, 'unknown', '2026-09-15T08:30:00Z')).toBeNull()
})

test('DST missing start never produces a window ending before its start', () => {
  const rows = routineOccurrencesForDate({
    definition: { title: 'DST', tasks: [{ ...task, times: ['02:30-03:00'] }] },
    localDate: '2026-03-29',
    timezone: 'Europe/Berlin'
  })
  expect(rows[0]?.dueAt?.toString()).toBe('2026-03-29T01:30:00Z')
  expect(rows[0]?.windowEndsAt?.toString()).toBe('2026-03-29T02:00:00Z')
})

test('a boundary in the repeated DST hour never rolls the routine date backwards', () => {
  expect(routineDayDate('Europe/Berlin', '02:30', '2026-10-25T02:15:00+02:00')).toBe('2026-10-24')
  expect(routineDayDate('Europe/Berlin', '02:30', '2026-10-25T02:45:00+02:00')).toBe('2026-10-25')
  expect(routineDayDate('Europe/Berlin', '02:30', '2026-10-25T02:15:00+01:00')).toBe('2026-10-25')
  expect(routineDayDate('Europe/Berlin', '02:30', '2026-03-29T03:15:00+02:00')).toBe('2026-03-28')
  expect(routineDayDate('Europe/Berlin', '02:30', '2026-03-29T03:30:00+02:00')).toBe('2026-03-29')
})

test('completion recurrence validates its interval/date and excludes daily expansion', () => {
  const recurring = {
    ...task,
    weekdays: [],
    recurrence: { intervalDays: 14, firstDueDate: '2026-09-21' }
  }
  expect(normalizeRoutine({ title: 'Дом', tasks: [recurring] }).tasks[0]!.recurrence).toEqual(
    recurring.recurrence
  )
  expect(occurrences([recurring], '2026-10-01')).toEqual([])
  for (const intervalDays of [0, -1, 1.5, 366, NaN]) {
    expect(() =>
      normalizeRoutine({
        title: 'Дом',
        tasks: [{ ...recurring, recurrence: { ...recurring.recurrence, intervalDays } }]
      })
    ).toThrow()
  }
  for (const firstDueDate of ['2026-02-30', 'tomorrow', '2026-9-1']) {
    expect(() =>
      normalizeRoutine({
        title: 'Дом',
        tasks: [{ ...recurring, recurrence: { ...recurring.recurrence, firstDueDate } }]
      })
    ).toThrow()
  }
  for (const patch of [
    { weekdays: [1] },
    { times: ['09:00'] },
    { reminderEnabled: true },
    { activityId: 'water' }
  ]) {
    expect(() => normalizeRoutine({ title: 'Дом', tasks: [{ ...recurring, ...patch }] })).toThrow()
  }
})
