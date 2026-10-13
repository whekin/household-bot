import {
  Temporal,
  pickRoutineQuickTarget,
  routineDayDate,
  routineOccurrencesForDate,
  type RoutineDefinition
} from '@household/domain'
import type { RoutineView, RoutinesResponse } from './types'

export function createDemoDay(definition: RoutineDefinition): NonNullable<RoutineView['day']> {
  const date = routineDayDate(
    'Asia/Tbilisi',
    definition.dayStart ?? '00:00',
    new Date().toISOString()
  )
  return {
    date,
    title: definition.title,
    quickActions: definition.quickActions ?? [],
    rows: [
      ...routineOccurrencesForDate({ definition, localDate: date, timezone: 'Asia/Tbilisi' }),
      ...definition.tasks
        .filter((task) => task.recurrence && task.recurrence.firstDueDate <= date)
        .map((task) => ({
          taskId: task.id,
          title: task.title,
          localTime: null,
          dueAt: null,
          windowEndsAt: null,
          reminderEnabled: false,
          claimEnabled: task.claimEnabled,
          note: task.note,
          activityId: undefined
        }))
    ].map((row, index) => ({
      id: `demo-${index}`,
      taskId: row.taskId,
      title: row.title,
      localTime: row.localTime,
      dueAt: row.dueAt?.toString() ?? null,
      windowEndsAt: row.windowEndsAt?.toString() ?? null,
      reminderEnabled: row.reminderEnabled,
      claimEnabled: row.claimEnabled,
      ...(row.note ? { note: row.note } : {}),
      ...(row.activityId ? { activityId: row.activityId } : {}),
      ...(definition.tasks.find((task) => task.id === row.taskId)?.recurrence
        ? {
            recurrenceDueDate: definition.tasks.find((task) => task.id === row.taskId)!.recurrence!
              .firstDueDate
          }
        : {}),
      version: 0,
      status: 'pending',
      actorId: null,
      actorName: null,
      actedAt: null,
      expiresAt: null
    }))
  }
}
export function refreshDemoActions(doc: RoutineView): void {
  doc.recurringTasks = doc.definition.tasks
    .filter((task) => task.recurrence)
    .map((task) => {
      const row = doc.day?.rows.find((row) => row.taskId === task.id)
      const completed = row?.status === 'completed' && row.actedAt
      const nextDueDate = completed
        ? Temporal.Instant.from(row.actedAt!)
            .toZonedDateTimeISO(doc.timezone)
            .toPlainDate()
            .add({ days: task.recurrence!.intervalDays })
            .toString()
        : task.recurrence!.firstDueDate
      if (row) {
        if (completed) row.nextDueDate = nextDueDate
        else delete row.nextDueDate
      }
      return {
        taskId: task.id,
        title: task.title,
        intervalDays: task.recurrence!.intervalDays,
        nextDueDate,
        lastCompletedAt: completed ? row.actedAt : null,
        lastCompletedByName: completed ? row.actorName : null
      }
    })
  const actions = doc.day?.quickActions ?? []
  doc.quickTargets = actions.flatMap((action) => {
    const target = pickRoutineQuickTarget(doc.day?.rows ?? [], action.id, new Date().toISOString())
    return target
      ? [
          {
            ...action,
            rowId: target.id,
            version: target.version,
            completed: target.status === 'completed'
          }
        ]
      : []
  })
  doc.lastActions = actions.map((action) => {
    const last = doc.day?.rows
      .filter((row) => row.activityId === action.id && row.status === 'completed' && row.actedAt)
      .sort((a, b) => Date.parse(b.actedAt!) - Date.parse(a.actedAt!))[0]
    return {
      label: action.summaryLabel,
      at: last?.actedAt ?? null,
      actorName: last?.actorName ?? null
    }
  })
}

export function demoRoutinesResponse(): RoutinesResponse {
  const date = new Date().toISOString().slice(0, 10)
  const definition: RoutineDefinition = {
    title: 'House care',
    tasks: [
      {
        id: 'plants',
        title: 'Water the plants',
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        times: ['09:00'],
        reminderEnabled: true,
        claimEnabled: true
      },
      {
        id: 'water',
        title: 'Swap the drinking water',
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        times: [],
        reminderEnabled: false,
        claimEnabled: false
      }
    ]
  }
  return {
    routines: [
      {
        id: 'aabbccddeeff0011',
        revision: 1,
        definition,
        effectiveDate: null,
        publishTime: '08:00',
        timezone: 'Asia/Tbilisi',
        paused: false,
        destination: { chatId: '-1001', threadId: 136, name: 'House chores' },
        groupStatus: 'ready',
        subscribed: false,
        dmBlocked: false,
        privateCardUnknown: false,
        errors: [],
        day: {
          date,
          title: definition.title,
          rows: definition.tasks.map((task, i) => ({
            ...task,
            id: `${date.replaceAll('-', '')}${i}`,
            taskId: task.id,
            localTime: task.times[0] ?? null,
            dueAt: null,
            version: 0,
            status: i === 0 ? 'completed' : 'pending',
            actorId: i === 0 ? 'demo' : null,
            actorName: i === 0 ? 'Chorbanaut' : null,
            actedAt: null,
            expiresAt: null
          }))
        }
      }
    ],
    topics: [{ threadId: 136, name: 'House chores' }],
    botUrl: ''
  }
}
