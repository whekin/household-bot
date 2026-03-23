import { describe, expect, test } from 'bun:test'

import { Temporal } from '@household/domain'

import { parseAdHocNotificationSchedule } from './ad-hoc-notification-parser'

describe('parseAdHocNotificationSchedule', () => {
  test('parses exact local datetime from structured input', () => {
    const parsed = parseAdHocNotificationSchedule({
      timezone: 'Asia/Tbilisi',
      resolvedLocalDate: '2026-03-24',
      resolvedHour: 15,
      resolvedMinute: 30,
      resolutionMode: 'exact',
      now: Temporal.Instant.from('2026-03-23T09:00:00Z')
    })

    expect(parsed.kind).toBe('parsed')
    expect(parsed.timePrecision).toBe('exact')
    expect(parsed.scheduledFor?.toString()).toBe('2026-03-24T11:30:00Z')
  })

  test('keeps date-only schedules as inferred/defaulted', () => {
    const parsed = parseAdHocNotificationSchedule({
      timezone: 'Asia/Tbilisi',
      resolvedLocalDate: '2026-03-24',
      resolvedHour: 12,
      resolvedMinute: 0,
      resolutionMode: 'date_only',
      now: Temporal.Instant.from('2026-03-23T09:00:00Z')
    })

    expect(parsed.kind).toBe('parsed')
    expect(parsed.timePrecision).toBe('date_only_defaulted')
    expect(parsed.scheduledFor?.toString()).toBe('2026-03-24T08:00:00Z')
  })

  test('supports fuzzy-window schedules as inferred/defaulted', () => {
    const parsed = parseAdHocNotificationSchedule({
      timezone: 'Asia/Tbilisi',
      resolvedLocalDate: '2026-03-24',
      resolvedHour: 9,
      resolvedMinute: 0,
      resolutionMode: 'fuzzy_window',
      now: Temporal.Instant.from('2026-03-23T09:00:00Z')
    })

    expect(parsed.kind).toBe('parsed')
    expect(parsed.timePrecision).toBe('date_only_defaulted')
    expect(parsed.scheduledFor?.toString()).toBe('2026-03-24T05:00:00Z')
  })

  test('treats ambiguous structured schedule as missing', () => {
    const parsed = parseAdHocNotificationSchedule({
      timezone: 'Asia/Tbilisi',
      resolvedLocalDate: null,
      resolvedHour: null,
      resolvedMinute: null,
      resolutionMode: 'ambiguous',
      now: Temporal.Instant.from('2026-03-23T09:00:00Z')
    })

    expect(parsed.kind).toBe('missing_schedule')
  })

  test('rejects past structured schedule', () => {
    const parsed = parseAdHocNotificationSchedule({
      timezone: 'Asia/Tbilisi',
      resolvedLocalDate: '2026-03-23',
      resolvedHour: 10,
      resolvedMinute: 0,
      resolutionMode: 'exact',
      now: Temporal.Instant.from('2026-03-23T09:00:00Z')
    })

    expect(parsed.kind).toBe('invalid_past')
  })
})
