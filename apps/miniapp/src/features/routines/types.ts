import type { RoutineDefinition } from '@household/domain'
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
    title: string
    rows: Array<{
      id: string
      taskId: string
      title: string
      localTime: string | null
      dueAt: string | null
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
