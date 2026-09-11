import { DomainError } from './errors'
import { Temporal, type Instant } from './time'

export const ROUTINE_DAILY_OCCURRENCE_LIMIT = 20
export const ROUTINE_CLAIM_MINUTES = 30

export interface RoutineTask {
  readonly id: string
  readonly title: string
  /** ISO weekdays, Monday = 1. */
  readonly weekdays: readonly number[]
  /** Empty means one untimed occurrence. */
  readonly times: readonly string[]
  readonly reminderEnabled: boolean
  readonly claimEnabled: boolean
}

export interface RoutineDefinition {
  readonly title: string
  readonly tasks: readonly RoutineTask[]
}

export interface RoutineOccurrenceSeed {
  /** Unique within a routine; independent of mutable titles and array order. */
  readonly key: string
  readonly taskId: string
  readonly localDate: string
  readonly localTime: string | null
  readonly title: string
  readonly dueAt: Instant | null
  readonly reminderEnabled: boolean
  readonly claimEnabled: boolean
}

function invalid(message: string): never {
  throw new DomainError('INVALID_ROUTINE', message)
}

function normalizeTitle(value: string, limit: number): string {
  const title = value.trim()
  if (!title || Array.from(title).length > limit || /[\p{Cc}\p{Zl}\p{Zp}]/u.test(title)) {
    invalid(`Title must contain 1–${limit} characters on one line`)
  }
  return title
}

export function normalizeRoutine(input: RoutineDefinition): RoutineDefinition {
  const title = normalizeTitle(input.title, 80)
  if (input.tasks.length === 0 || input.tasks.length > ROUTINE_DAILY_OCCURRENCE_LIMIT) {
    invalid(`A routine must have 1–${ROUTINE_DAILY_OCCURRENCE_LIMIT} tasks`)
  }
  const ids = new Set<string>()
  const tasks = input.tasks.map((task): RoutineTask => {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(task.id) || ids.has(task.id)) {
      invalid('Task IDs must be unique stable identifiers')
    }
    ids.add(task.id)
    if (typeof task.reminderEnabled !== 'boolean' || typeof task.claimEnabled !== 'boolean')
      invalid('Reminder and claim settings must be booleans')
    if (
      task.weekdays.length === 0 ||
      new Set(task.weekdays).size !== task.weekdays.length ||
      task.weekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7)
    ) {
      invalid('Weekdays must be distinct ISO weekdays from 1 to 7')
    }
    if (
      new Set(task.times).size !== task.times.length ||
      task.times.some((time) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))
    ) {
      invalid('Times must be distinct HH:mm values')
    }
    if (task.reminderEnabled && task.times.length === 0) {
      invalid('A reminder needs a scheduled time')
    }
    return {
      ...task,
      title: normalizeTitle(task.title, 60),
      weekdays: [...task.weekdays].sort((a, b) => a - b),
      times: [...task.times].sort()
    }
  })
  for (let day = 1; day <= 7; day += 1) {
    const count = tasks.reduce(
      (total, task) => total + (task.weekdays.includes(day) ? Math.max(1, task.times.length) : 0),
      0
    )
    if (count > ROUTINE_DAILY_OCCURRENCE_LIMIT) {
      invalid(`A day may contain at most ${ROUTINE_DAILY_OCCURRENCE_LIMIT} occurrences`)
    }
  }
  return { title, tasks }
}

/** The caller chooses the effective revision and persists these immutable day snapshots. */
export function routineOccurrencesForDate(input: {
  definition: RoutineDefinition
  localDate: string
  timezone: string
}): readonly RoutineOccurrenceSeed[] {
  const definition = normalizeRoutine(input.definition)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.localDate)) {
    invalid('Date must match YYYY-MM-DD')
  }
  let date: Temporal.PlainDate
  try {
    date = Temporal.PlainDate.from(input.localDate)
    // Validate even when no task is due or all tasks are untimed.
    date.toZonedDateTime(input.timezone)
  } catch {
    return invalid('Invalid local date or timezone')
  }
  return definition.tasks.flatMap((task) => {
    if (!task.weekdays.includes(date.dayOfWeek)) return []
    const times: readonly (string | null)[] = task.times.length ? task.times : [null]
    return times.map((time) => ({
      key: `${task.id}/${input.localDate}/${time ?? 'day'}`,
      taskId: task.id,
      localDate: input.localDate,
      localTime: time,
      title: task.title,
      dueAt:
        time === null
          ? null
          : date
              .toPlainDateTime(Temporal.PlainTime.from(time))
              .toZonedDateTime(input.timezone, { disambiguation: 'compatible' })
              .toInstant(),
      reminderEnabled: task.reminderEnabled,
      claimEnabled: task.claimEnabled
    }))
  })
}

export interface RoutineFocusCandidate {
  readonly status: 'pending' | 'claimed' | 'completed'
  readonly dueAt: string | null
}

export interface RoutineFocus<T> {
  readonly row: T
  readonly state: 'overdue' | 'due' | 'upcoming' | 'untimed'
  /** Signed minutes until the slot; negative when it has passed, zero when untimed. */
  readonly minutes: number
}

/**
 * The occurrence a single primary button acts on: the most recent slot that is already
 * due, otherwise the next one. A missed earlier slot stays untouched — it was not done.
 */
export function pickRoutineFocus<T extends RoutineFocusCandidate>(
  rows: readonly T[],
  now: Instant | string
): RoutineFocus<T> | null {
  const at = typeof now === 'string' ? Temporal.Instant.from(now) : now
  const open = rows.filter((row) => row.status !== 'completed')
  const minutes = (row: RoutineFocusCandidate) =>
    Math.round(
      (Temporal.Instant.from(row.dueAt!).epochMilliseconds - at.epochMilliseconds) / 60_000
    )
  const timed = open.filter((row) => row.dueAt).sort((a, b) => minutes(a) - minutes(b))
  const passed = timed.filter((row) => minutes(row) <= 0).at(-1)
  const row = passed ?? timed[0]
  if (row) {
    const left = minutes(row)
    return { row, state: left < 0 ? 'overdue' : left === 0 ? 'due' : 'upcoming', minutes: left }
  }
  const untimed = open.find((row) => !row.dueAt)
  return untimed ? { row: untimed, state: 'untimed', minutes: 0 } : null
}

export type RoutineProgress =
  | { readonly status: 'pending' }
  | {
      readonly status: 'claimed'
      readonly memberId: string
      readonly claimedAt: Instant
      readonly expiresAt: Instant
    }
  | { readonly status: 'completed'; readonly memberId: string; readonly completedAt: Instant }

export interface RoutineOccurrenceState {
  readonly version: number
  readonly progress: RoutineProgress
}

export type RoutineAction = 'complete' | 'reopen' | 'claim' | 'release'

export type RoutineActionResult =
  | { readonly status: 'changed'; readonly state: RoutineOccurrenceState }
  | {
      readonly status: 'unchanged' | 'conflict' | 'claimed_by_other' | 'claim_disabled'
      readonly state: RoutineOccurrenceState
    }

export function effectiveRoutineProgress(progress: RoutineProgress, now: Instant): RoutineProgress {
  if (progress.status === 'claimed' && Temporal.Instant.compare(now, progress.expiresAt) >= 0) {
    return { status: 'pending' }
  }
  return progress
}

/**
 * Pure transition only. Membership, date/pause guards, request deduplication and
 * atomic compare-and-set persistence belong to the application/repository boundary.
 * The action reflects the button the member saw, never a blind database toggle.
 */
export function applyRoutineAction(input: {
  state: RoutineOccurrenceState
  expectedVersion: number
  action: RoutineAction
  memberId: string
  claimEnabled: boolean
  now: Instant
}): RoutineActionResult {
  const { state, now, memberId } = input
  if (
    !Number.isSafeInteger(state.version) ||
    state.version < 0 ||
    state.version >= Number.MAX_SAFE_INTEGER ||
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 0 ||
    !memberId.trim()
  ) {
    invalid('A routine action requires valid versions and an actor')
  }
  if (input.expectedVersion !== state.version) return { status: 'conflict', state }
  const progress = effectiveRoutineProgress(state.progress, now)
  const change = (next: RoutineProgress): RoutineActionResult => ({
    status: 'changed',
    state: { version: state.version + 1, progress: next }
  })
  switch (input.action) {
    case 'complete':
      return progress.status === 'completed'
        ? { status: 'unchanged', state }
        : change({ status: 'completed', memberId, completedAt: now })
    case 'reopen':
      return progress.status === 'completed'
        ? change({ status: 'pending' })
        : { status: 'unchanged', state }
    case 'claim':
      if (!input.claimEnabled) return { status: 'claim_disabled', state }
      if (progress.status === 'completed') return { status: 'unchanged', state }
      if (progress.status === 'claimed') {
        return { status: progress.memberId === memberId ? 'unchanged' : 'claimed_by_other', state }
      }
      return change({
        status: 'claimed',
        memberId,
        claimedAt: now,
        expiresAt: now.add({ seconds: ROUTINE_CLAIM_MINUTES * 60 })
      })
    case 'release':
      if (progress.status !== 'claimed') return { status: 'unchanged', state }
      return progress.memberId === memberId
        ? change({ status: 'pending' })
        : { status: 'claimed_by_other', state }
  }
}
