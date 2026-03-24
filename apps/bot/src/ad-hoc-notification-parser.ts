import { Temporal, nowInstant, type Instant } from '@household/domain'

import type { AdHocNotificationResolutionMode } from './openai-ad-hoc-notification-interpreter'

export interface ParsedAdHocNotificationSchedule {
  kind: 'parsed' | 'missing_schedule' | 'invalid_past'
  scheduledFor: Instant | null
  timePrecision: 'exact' | 'date_only_defaulted' | null
}

function precisionFromResolutionMode(
  resolutionMode: AdHocNotificationResolutionMode | null
): 'exact' | 'date_only_defaulted' | null {
  if (resolutionMode === 'exact') {
    return 'exact'
  }

  if (resolutionMode === 'fuzzy_window' || resolutionMode === 'date_only') {
    return 'date_only_defaulted'
  }

  return null
}

export function parseAdHocNotificationSchedule(input: {
  timezone: string
  resolvedLocalDate: string | null
  resolvedHour: number | null
  resolvedMinute: number | null
  relativeOffsetMinutes?: number | null
  dateReferenceMode?: 'relative' | 'calendar' | null
  resolutionMode: AdHocNotificationResolutionMode | null
  now?: Instant
}): ParsedAdHocNotificationSchedule {
  const effectiveNow = input.now ?? nowInstant()
  const timePrecision = precisionFromResolutionMode(input.resolutionMode)
  if (
    input.resolutionMode === null ||
    input.resolutionMode === 'ambiguous' ||
    timePrecision === null
  ) {
    return {
      kind: 'missing_schedule',
      scheduledFor: null,
      timePrecision: null
    }
  }

  if (input.relativeOffsetMinutes !== null && input.relativeOffsetMinutes !== undefined) {
    const scheduled = effectiveNow.add({ minutes: input.relativeOffsetMinutes })
    if (scheduled.epochMilliseconds <= effectiveNow.epochMilliseconds) {
      return {
        kind: 'invalid_past',
        scheduledFor: null,
        timePrecision: null
      }
    }

    return {
      kind: 'parsed',
      scheduledFor: scheduled,
      timePrecision
    }
  }

  if (!input.resolvedLocalDate) {
    return {
      kind: 'missing_schedule',
      scheduledFor: null,
      timePrecision: null
    }
  }

  const hour =
    input.resolutionMode === 'date_only' ? (input.resolvedHour ?? 12) : input.resolvedHour
  const minute =
    input.resolutionMode === 'date_only' ? (input.resolvedMinute ?? 0) : input.resolvedMinute

  if (hour === null || minute === null) {
    return {
      kind: 'missing_schedule',
      scheduledFor: null,
      timePrecision: null
    }
  }

  try {
    const nowZdt = effectiveNow.toZonedDateTimeISO(input.timezone)
    let date = Temporal.PlainDate.from(input.resolvedLocalDate)

    if (
      input.dateReferenceMode === 'relative' &&
      nowZdt.hour <= 4 &&
      Temporal.PlainDate.compare(date, nowZdt.toPlainDate().add({ days: 1 })) === 0
    ) {
      date = nowZdt.toPlainDate()
    }

    const scheduled = Temporal.ZonedDateTime.from({
      timeZone: input.timezone,
      year: date.year,
      month: date.month,
      day: date.day,
      hour,
      minute,
      second: 0,
      millisecond: 0
    }).toInstant()

    if (scheduled.epochMilliseconds <= effectiveNow.epochMilliseconds) {
      return {
        kind: 'invalid_past',
        scheduledFor: null,
        timePrecision: null
      }
    }

    return {
      kind: 'parsed',
      scheduledFor: scheduled,
      timePrecision
    }
  } catch {
    return {
      kind: 'missing_schedule',
      scheduledFor: null,
      timePrecision: null
    }
  }
}
