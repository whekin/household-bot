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
  readonly note?: string
  readonly activityId?: string
  readonly recurrence?: { readonly intervalDays: number; readonly firstDueDate: string }
}

export interface RoutineQuickAction {
  readonly id: string
  readonly label: string
  readonly summaryLabel: string
}

export interface RoutineDefinition {
  readonly title: string
  readonly tasks: readonly RoutineTask[]
  readonly dayStart?: string
  readonly quickActions?: readonly RoutineQuickAction[]
}

export interface RoutineOccurrenceSeed {
  /** Unique within a routine; independent of mutable titles and array order. */
  readonly key: string
  readonly taskId: string
  readonly localDate: string
  readonly localTime: string | null
  readonly title: string
  readonly dueAt: Instant | null
  readonly windowEndsAt: Instant | null
  readonly note?: string
  readonly activityId?: string
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

/** A single time or a local time window, including windows that cross midnight. */
export function parseRoutineTime(value: string): { start: string; end: string | null } {
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?:[-–]([01]\d|2[0-3]):([0-5]\d))?$/.exec(value)
  if (!match) invalid('Times must be HH:mm or HH:mm-HH:mm')
  const start = `${match[1]}:${match[2]}`
  const end = match[3] ? `${match[3]}:${match[4]}` : null
  if (start === end) invalid('A time window must have a nonzero duration')
  return { start, end }
}
function minutesOf(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
}
export function routineDayDate(timezone: string, dayStart: string, now: Instant | string): string {
  const at = typeof now === 'string' ? Temporal.Instant.from(now) : now
  const local = at.toZonedDateTimeISO(timezone)
  const date = local.toPlainDate()
  const boundary = date
    .toPlainDateTime(Temporal.PlainTime.from(dayStart))
    .toZonedDateTime(timezone, { disambiguation: 'compatible' })
    .toInstant()
  return (Temporal.Instant.compare(at, boundary) < 0 ? date.subtract({ days: 1 }) : date).toString()
}

export function routineTimeInstant(
  localDate: string,
  clock: string,
  timezone: string,
  dayStart = '00:00'
): Instant {
  const date = Temporal.PlainDate.from(localDate)
  const scheduledDate = clock < dayStart ? date.add({ days: 1 }) : date
  return scheduledDate
    .toPlainDateTime(Temporal.PlainTime.from(clock))
    .toZonedDateTime(timezone, { disambiguation: 'compatible' })
    .toInstant()
}

export function normalizeRoutine(input: RoutineDefinition): RoutineDefinition {
  const title = normalizeTitle(input.title, 80)
  const dayStart = input.dayStart ?? '00:00'
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(dayStart)) invalid('Invalid day start')
  const quickActions = input.quickActions ?? []
  if (
    quickActions.length > 3 ||
    new Set(quickActions.map((action) => action.id)).size !== quickActions.length
  )
    invalid('Up to three distinct quick actions are allowed')
  const actions = quickActions.map((action) => {
    if (!/^[a-zA-Z0-9_-]{1,12}$/.test(action.id)) invalid('Invalid activity ID')
    return {
      id: action.id,
      label: normalizeTitle(action.label, 40),
      summaryLabel: normalizeTitle(action.summaryLabel, 40)
    }
  })
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
    if (task.recurrence) {
      if (
        !Number.isInteger(task.recurrence.intervalDays) ||
        task.recurrence.intervalDays < 1 ||
        task.recurrence.intervalDays > 365
      )
        invalid('Repeat interval must be 1–365 days')
      try {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(task.recurrence.firstDueDate))
          invalid('Invalid first due date')
        Temporal.PlainDate.from(task.recurrence.firstDueDate)
      } catch {
        invalid('Invalid first due date')
      }
      if (task.weekdays.length || task.times.length || task.reminderEnabled || task.activityId)
        invalid(
          'Completion recurrence cannot have weekdays, times, slot reminders or quick actions'
        )
    }
    if (
      !task.recurrence &&
      (task.weekdays.length === 0 ||
        new Set(task.weekdays).size !== task.weekdays.length ||
        task.weekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7))
    ) {
      invalid('Weekdays must be distinct ISO weekdays from 1 to 7')
    }
    const windows = task.times
      .map((value) => {
        const { start, end } = parseRoutineTime(value)
        const offset = (minutesOf(start) - minutesOf(dayStart) + 1440) % 1440
        const duration = end ? (minutesOf(end) - minutesOf(start) + 1440) % 1440 : 0
        if (offset + duration > 1440) invalid('A window must not cross the routine day boundary')
        return { value: end ? `${start}-${end}` : start, offset, until: offset + duration }
      })
      .sort((a, b) => a.offset - b.offset)
    windows.forEach((window, index) => {
      const previous = windows[index - 1]
      if (previous && (window.offset === previous.offset || window.offset < previous.until))
        invalid('Task windows must not overlap')
    })
    if (task.activityId && !actions.some((action) => action.id === task.activityId))
      invalid('Unknown quick action group')
    const note = task.note?.trim()
    if (note) normalizeTitle(note, 120)
    if (task.reminderEnabled && task.times.length === 0) {
      invalid('A reminder needs a scheduled time')
    }
    return {
      ...task,
      title: normalizeTitle(task.title, 60),
      weekdays: [...task.weekdays].sort((a, b) => a - b),
      times: windows.map((window) => window.value),
      ...(note ? { note } : {})
    }
  })
  for (let day = 1; day <= 7; day += 1) {
    const count = tasks.reduce(
      (total, task) =>
        total +
        (task.recurrence ? 1 : task.weekdays.includes(day) ? Math.max(1, task.times.length) : 0),
      0
    )
    if (count > ROUTINE_DAILY_OCCURRENCE_LIMIT) {
      invalid(`A day may contain at most ${ROUTINE_DAILY_OCCURRENCE_LIMIT} occurrences`)
    }
  }
  for (const action of actions)
    if (!tasks.some((task) => task.activityId === action.id))
      invalid('Quick actions need at least one task')
  return {
    title,
    tasks,
    ...(input.dayStart ? { dayStart } : {}),
    ...(input.quickActions ? { quickActions: actions } : {})
  }
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
    if (task.recurrence || !task.weekdays.includes(date.dayOfWeek)) return []
    const times: readonly (string | null)[] = task.times.length ? task.times : [null]
    return times.map((time) => {
      const window = time === null ? null : parseRoutineTime(time)
      const scheduledDate =
        window && window.start < (definition.dayStart ?? '00:00') ? date.add({ days: 1 }) : date
      const instant = (day: Temporal.PlainDate, clock: string) =>
        day
          .toPlainDateTime(Temporal.PlainTime.from(clock))
          .toZonedDateTime(input.timezone, { disambiguation: 'compatible' })
          .toInstant()
      const dueAt = window ? instant(scheduledDate, window.start) : null
      let windowEndsAt = window?.end
        ? instant(
            window.end < window.start ? scheduledDate.add({ days: 1 }) : scheduledDate,
            window.end
          )
        : null
      // A DST gap can move a missing start beyond an otherwise valid end.
      if (dueAt && windowEndsAt && Temporal.Instant.compare(windowEndsAt, dueAt) <= 0) {
        windowEndsAt = dueAt.add({
          minutes: (minutesOf(window!.end!) - minutesOf(window!.start) + 1440) % 1440
        })
      }
      return {
        key: `${task.id}/${input.localDate}/${time ?? 'day'}`,
        taskId: task.id,
        localDate: input.localDate,
        localTime: time,
        title: task.title,
        dueAt,
        windowEndsAt,
        reminderEnabled: task.reminderEnabled,
        claimEnabled: task.claimEnabled,
        ...(task.note ? { note: task.note } : {}),
        ...(task.activityId ? { activityId: task.activityId } : {})
      }
    })
  })
}

export interface RoutineFocusCandidate {
  readonly status: 'pending' | 'claimed' | 'completed'
  readonly dueAt: string | null
  readonly windowEndsAt?: string | null
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
    const inside =
      row.windowEndsAt &&
      Temporal.Instant.compare(at, Temporal.Instant.from(row.windowEndsAt)) <= 0 &&
      left <= 0
    return {
      row,
      state: inside ? 'due' : left < 0 ? 'overdue' : left === 0 ? 'due' : 'upcoming',
      minutes: left
    }
  }
  const untimed = open.find((row) => !row.dueAt)
  return untimed ? { row: untimed, state: 'untimed', minutes: 0 } : null
}

/** Closest interval wins; completed rows stay candidates to make repeat presses harmless. */
export function pickRoutineQuickTarget<
  T extends RoutineFocusCandidate & { readonly activityId?: string }
>(rows: readonly T[], activityId: string, now: Instant | string): T | null {
  const at = (typeof now === 'string' ? Temporal.Instant.from(now) : now).epochMilliseconds
  const distance = (row: T) => {
    if (!row.dueAt) return Number.MAX_SAFE_INTEGER
    const start = Temporal.Instant.from(row.dueAt).epochMilliseconds
    const end = row.windowEndsAt ? Temporal.Instant.from(row.windowEndsAt).epochMilliseconds : start
    return at < start ? start - at : at > end ? at - end : 0
  }
  return (
    rows
      .filter((row) => row.activityId === activityId)
      .sort(
        (a, b) => distance(a) - distance(b) || (a.dueAt ?? '').localeCompare(b.dueAt ?? '')
      )[0] ?? null
  )
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
