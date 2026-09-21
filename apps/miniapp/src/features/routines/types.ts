import type { RoutineDefinition, RoutineQuickAction } from '@household/domain'
export interface RoutineView {
  id: string
  revision: number
  definition: RoutineDefinition
  effectiveDate: string | null
  publishTime: string
  timezone: string
  paused: boolean
  destination: { chatId: string; threadId: number; name: string } | null
  day: {
    date: string
    quickActions?: readonly RoutineQuickAction[]
    title: string
    rows: Array<{
      id: string
      taskId: string
      title: string
      localTime: string | null
      dueAt: string | null
      windowEndsAt?: string | null
      note?: string
      activityId?: string
      recurrenceDueDate?: string
      nextDueDate?: string
      reminderEnabled: boolean
      claimEnabled: boolean
      version: number
      status: 'pending' | 'claimed' | 'completed'
      actorId: string | null
      actorName: string | null
      actedAt: string | null
      expiresAt: string | null
    }>
  } | null
  groupStatus: 'none' | 'pending' | 'ready' | 'error' | 'unknown'
  quickTargets?: Array<{
    id: string
    label: string
    rowId: string
    version: number
    completed: boolean
  }>
  lastActions?: Array<{ label: string; at: string | null; actorName: string | null }>
  recurringTasks?: Array<{
    taskId: string
    title: string
    intervalDays: number
    nextDueDate: string
    lastCompletedAt: string | null
    lastCompletedByName: string | null
  }>
  subscribed: boolean
  dmBlocked: boolean
  privateCardUnknown: boolean
  errors: string[]
}
export interface RoutinesResponse {
  error?: string
  routines: RoutineView[]
  topics: Array<{ threadId: number; name: string }>
  botUrl: string
}
