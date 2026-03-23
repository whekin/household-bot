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
  resolutionMode: AdHocNotificationResolutionMode | null
  now?: Instant
}): ParsedAdHocNotificationSchedule {
  const timePrecision = precisionFromResolutionMode(input.resolutionMode)
  if (
    !input.resolvedLocalDate ||
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
    const date = Temporal.PlainDate.from(input.resolvedLocalDate)
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

    const effectiveNow = input.now ?? nowInstant()
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
