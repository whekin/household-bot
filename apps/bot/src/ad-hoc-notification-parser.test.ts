import { describe, expect, test } from 'bun:test'

import { Temporal } from '@household/domain'
import type { HouseholdMemberRecord } from '@household/ports'

import {
  parseAdHocNotificationRequest,
  parseAdHocNotificationSchedule
} from './ad-hoc-notification-parser'

function member(
  input: Partial<HouseholdMemberRecord> & Pick<HouseholdMemberRecord, 'id'>
): HouseholdMemberRecord {
  return {
    id: input.id,
    householdId: input.householdId ?? 'household-1',
    telegramUserId: input.telegramUserId ?? `${input.id}-tg`,
    displayName: input.displayName ?? input.id,
    status: input.status ?? 'active',
    preferredLocale: input.preferredLocale ?? 'ru',
    householdDefaultLocale: input.householdDefaultLocale ?? 'ru',
    rentShareWeight: input.rentShareWeight ?? 1,
    isAdmin: input.isAdmin ?? false
  }
}

describe('parseAdHocNotificationRequest', () => {
  const members = [
    member({ id: 'dima', displayName: 'Дима' }),
    member({ id: 'georgiy', displayName: 'Георгий' })
  ]

  test('parses exact datetime and assignee from russian request', () => {
    const parsed = parseAdHocNotificationRequest({
      text: 'Железяка, напомни пошпынять Георгия завтра в 15:30',
      timezone: 'Asia/Tbilisi',
      locale: 'ru',
      members,
      senderMemberId: 'dima',
      now: Temporal.Instant.from('2026-03-23T09:00:00Z')
    })

    expect(parsed.kind).toBe('parsed')
    expect(parsed.notificationText).toContain('пошпынять Георгия')
    expect(parsed.assigneeMemberId).toBe('georgiy')
    expect(parsed.timePrecision).toBe('exact')
    expect(parsed.scheduledFor?.toString()).toBe('2026-03-24T11:30:00Z')
  })

  test('defaults vague tomorrow to daytime slot', () => {
    const parsed = parseAdHocNotificationRequest({
      text: 'напомни Георгию завтра про звонок',
      timezone: 'Asia/Tbilisi',
      locale: 'ru',
      members,
      senderMemberId: 'dima',
      now: Temporal.Instant.from('2026-03-23T09:00:00Z')
    })

    expect(parsed.kind).toBe('parsed')
    expect(parsed.timePrecision).toBe('date_only_defaulted')
    expect(parsed.scheduledFor?.toString()).toBe('2026-03-24T08:00:00Z')
  })

  test('requests follow-up when schedule is missing', () => {
    const parsed = parseAdHocNotificationRequest({
      text: 'напомни пошпынять Георгия',
      timezone: 'Asia/Tbilisi',
      locale: 'ru',
      members,
      senderMemberId: 'dima',
      now: Temporal.Instant.from('2026-03-23T09:00:00Z')
    })

    expect(parsed.kind).toBe('missing_schedule')
    expect(parsed.notificationText).toContain('пошпынять Георгия')
  })
})

describe('parseAdHocNotificationSchedule', () => {
  test('rejects past schedule', () => {
    const parsed = parseAdHocNotificationSchedule({
      text: 'сегодня в 10:00',
      timezone: 'Asia/Tbilisi',
      now: Temporal.Instant.from('2026-03-23T09:00:00Z')
    })

    expect(parsed.kind).toBe('invalid_past')
  })
})
