import type { RoutineDefinition, RoutineQuickAction } from '@household/domain'

export interface RoutineRow {
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
  reminderSuppressed: boolean
  version: number
  status: 'pending' | 'claimed' | 'completed'
  actorId: string | null
  actorName: string | null
  actedAt: string | null
  expiresAt: string | null
}
export interface RoutineDay {
  date: string
  title: string
  rows: RoutineRow[]
  dayStart?: string
  quickActions?: readonly RoutineQuickAction[]
}
export interface RoutineDestination {
  chatId: string
  threadId: number
  name: string
}
export interface RoutineMessage {
  key: string
  date: string
  chatId: string
  threadId: number | null
  rowId: string | null
  messageId: number | null
  /** Sending is persisted before sendMessage. Never blindly retry an ambiguous send. */
  status: 'sending' | 'sent' | 'unknown' | 'removed' | 'blocked'
  fingerprint: string
  error: string | null
  retryAt: string | null
  /** Day card only: every viewer of this message shares the expanded keyboard. */
  expanded?: boolean
}
export interface RoutineDocument {
  id: string
  householdId: string
  revision: number
  definition: RoutineDefinition
  nextDefinition: { effectiveDate: string; definition: RoutineDefinition } | null
  /** Once a delayed boundary is in effect, editing tomorrow cannot close tonight early. */
  activeDayExtension?: { date: string; until: string }
  timezone: string
  publishTime: string
  paused: boolean
  destination: RoutineDestination | null
  topicCreation: {
    requestId: string
    status: 'creating' | 'created' | 'unknown'
    destination: RoutineDestination | null
  } | null
  subscriptions: Record<string, { telegramUserId: string; enabled: boolean; blocked: boolean }>
  days: RoutineDay[]
  messages: RoutineMessage[]
  /** Durable recurrence state is independent of retained daily-card history. */
  recurringTasks?: Record<
    string,
    {
      nextDueDate: string
      lastCompletedAt: string | null
      lastCompletedBy: string | null
      lastCompletedByName: string | null
      previousCompletion?: { at: string | null; by: string | null; name: string | null }
      row: RoutineRow | null
    }
  >
  actionIds: string[]
  lease: { token: string; until: string } | null
  createdAt: string
  resumedAt: string
}
export interface RoutineRepository {
  list(householdId?: string): Promise<RoutineDocument[]>
  get(id: string): Promise<RoutineDocument | null>
  create(document: RoutineDocument): Promise<RoutineDocument>
  /** Locked transaction. Callback must be synchronous, pure and contain no IO. */
  change(
    id: string,
    householdId: string,
    change: (document: RoutineDocument) => void
  ): Promise<RoutineDocument>
}
