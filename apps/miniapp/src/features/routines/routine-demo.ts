import {
  pickRoutineQuickTarget,
  routineDayDate,
  routineOccurrencesForDate,
  type RoutineDefinition
} from '@household/domain'
import type { RoutineView } from './types'

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
    rows: routineOccurrencesForDate({ definition, localDate: date, timezone: 'Asia/Tbilisi' }).map(
      (row, index) => ({
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
        version: 0,
        status: 'pending',
        actorId: null,
        actorName: null,
        actedAt: null,
        expiresAt: null
      })
    )
  }
}
export function refreshDemoActions(doc: RoutineView): void {
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
