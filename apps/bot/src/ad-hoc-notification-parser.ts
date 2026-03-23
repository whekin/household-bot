import { Temporal, nowInstant, type Instant } from '@household/domain'
import type { HouseholdMemberRecord } from '@household/ports'

type SupportedLocale = 'en' | 'ru'

export interface ParsedAdHocNotificationRequest {
  kind: 'parsed' | 'missing_schedule' | 'invalid_past' | 'not_intent'
  originalRequestText: string
  notificationText: string | null
  assigneeMemberId: string | null
  scheduledFor: Instant | null
  timePrecision: 'exact' | 'date_only_defaulted' | null
}

export interface ParsedAdHocNotificationSchedule {
  kind: 'parsed' | 'missing_schedule' | 'invalid_past'
  scheduledFor: Instant | null
  timePrecision: 'exact' | 'date_only_defaulted' | null
}

const INTENT_PATTERNS = [
  /\bremind(?: me)?(?: to)?\b/i,
  /\bping me\b/i,
  /\bnotification\b/i,
  /(?:^|[^\p{L}])напомни(?:ть)?(?=$|[^\p{L}])/iu,
  /(?:^|[^\p{L}])напоминани[ея](?=$|[^\p{L}])/iu,
  /(?:^|[^\p{L}])пни(?=$|[^\p{L}])/iu,
  /(?:^|[^\p{L}])толкни(?=$|[^\p{L}])/iu
] as const

const DAYTIME_DEFAULT_HOUR = 12

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function stripLeadingBotAddress(value: string): string {
  const match = value.match(/^([^,\n:]{1,40})([:,])\s+/u)
  if (!match) {
    return value
  }

  return value.slice(match[0].length)
}

function hasIntent(value: string): boolean {
  return INTENT_PATTERNS.some((pattern) => pattern.test(value))
}

function removeIntentPreamble(value: string): string {
  const normalized = stripLeadingBotAddress(value)
  const patterns = [
    /\bremind(?: me)?(?: to)?\b/iu,
    /\bping me to\b/iu,
    /(?:^|[^\p{L}])напомни(?:ть)?(?=$|[^\p{L}])/iu,
    /(?:^|[^\p{L}])пни(?=$|[^\p{L}])/iu,
    /(?:^|[^\p{L}])толкни(?=$|[^\p{L}])/iu
  ]

  for (const pattern of patterns) {
    const match = pattern.exec(normalized)
    if (!match) {
      continue
    }

    return normalizeWhitespace(normalized.slice(match.index + match[0].length))
  }

  return normalizeWhitespace(normalized)
}

function aliasVariants(token: string): string[] {
  const aliases = new Set<string>([token])

  if (token.endsWith('а') && token.length > 2) {
    aliases.add(`${token.slice(0, -1)}ы`)
    aliases.add(`${token.slice(0, -1)}е`)
    aliases.add(`${token.slice(0, -1)}у`)
    aliases.add(`${token.slice(0, -1)}ой`)
  }

  if (token.endsWith('я') && token.length > 2) {
    aliases.add(`${token.slice(0, -1)}и`)
    aliases.add(`${token.slice(0, -1)}ю`)
    aliases.add(`${token.slice(0, -1)}ей`)
  }

  if (token.endsWith('й') && token.length > 2) {
    aliases.add(`${token.slice(0, -1)}я`)
    aliases.add(`${token.slice(0, -1)}ю`)
  }

  return [...aliases]
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

function memberAliases(member: HouseholdMemberRecord): string[] {
  const normalized = normalizeText(member.displayName)
  const tokens = normalized.split(' ').filter((token) => token.length >= 2)
  const aliases = new Set<string>([normalized, ...tokens])

  for (const token of tokens) {
    for (const alias of aliasVariants(token)) {
      aliases.add(alias)
    }
  }

  return [...aliases]
}

function detectAssignee(
  text: string,
  members: readonly HouseholdMemberRecord[],
  senderMemberId: string
): string | null {
  const normalizedText = ` ${normalizeText(text)} `
  const candidates = members
    .filter((member) => member.status === 'active' && member.id !== senderMemberId)
    .map((member) => ({
      memberId: member.id,
      score: memberAliases(member).reduce((best, alias) => {
        const normalizedAlias = alias.trim()
        if (normalizedAlias.length < 2) {
          return best
        }

        if (normalizedText.includes(` ${normalizedAlias} `)) {
          return Math.max(best, normalizedAlias.length + 10)
        }

        return best
      }, 0)
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)

  return candidates[0]?.memberId ?? null
}

function parseTime(text: string): {
  hour: number
  minute: number
  matchedText: string | null
} | null {
  const explicit = /(?:^|\s)(?:at|в)\s*(\d{1,2})(?::(\d{2}))?(?=$|[^\d])/iu.exec(text)
  const standalone = explicit ? explicit : /(?:^|\s)(\d{1,2}):(\d{2})(?=$|[^\d])/u.exec(text)
  const match = standalone
  if (!match) {
    return null
  }

  const hour = Number(match[1])
  const minute = Number(match[2] ?? '0')
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) {
    return null
  }

  return {
    hour,
    minute,
    matchedText: match[0]
  }
}

function parseDate(
  text: string,
  timezone: string,
  referenceInstant: Instant
): {
  date: Temporal.PlainDate
  matchedText: string | null
  precision: 'exact' | 'date_only_defaulted'
} | null {
  const localNow = referenceInstant.toZonedDateTimeISO(timezone)

  const relativePatterns: Array<{
    pattern: RegExp
    days: number
  }> = [
    { pattern: /\bday after tomorrow\b/iu, days: 2 },
    { pattern: /(?:^|[^\p{L}])послезавтра(?=$|[^\p{L}])/iu, days: 2 },
    { pattern: /\btomorrow\b/iu, days: 1 },
    { pattern: /(?:^|[^\p{L}])завтра(?=$|[^\p{L}])/iu, days: 1 },
    { pattern: /\btoday\b/iu, days: 0 },
    { pattern: /(?:^|[^\p{L}])сегодня(?=$|[^\p{L}])/iu, days: 0 }
  ]

  for (const entry of relativePatterns) {
    const match = entry.pattern.exec(text)
    if (!match) {
      continue
    }

    return {
      date: localNow.toPlainDate().add({ days: entry.days }),
      matchedText: match[0],
      precision: 'date_only_defaulted'
    }
  }

  const isoMatch = /\b(\d{4})-(\d{2})-(\d{2})\b/u.exec(text)
  if (isoMatch) {
    return {
      date: Temporal.PlainDate.from({
        year: Number(isoMatch[1]),
        month: Number(isoMatch[2]),
        day: Number(isoMatch[3])
      }),
      matchedText: isoMatch[0],
      precision: 'date_only_defaulted'
    }
  }

  const dottedMatch = /\b(\d{1,2})[./](\d{1,2})(?:[./](\d{4}))?\b/u.exec(text)
  if (dottedMatch) {
    return {
      date: Temporal.PlainDate.from({
        year: Number(dottedMatch[3] ?? String(localNow.year)),
        month: Number(dottedMatch[2]),
        day: Number(dottedMatch[1])
      }),
      matchedText: dottedMatch[0],
      precision: 'date_only_defaulted'
    }
  }

  return null
}

export function parseAdHocNotificationSchedule(input: {
  text: string
  timezone: string
  now?: Instant
}): ParsedAdHocNotificationSchedule {
  const rawText = normalizeWhitespace(input.text)
  const referenceInstant = input.now ?? nowInstant()
  const date = parseDate(rawText, input.timezone, referenceInstant)
  const time = parseTime(rawText)

  if (!date) {
    return {
      kind: 'missing_schedule',
      scheduledFor: null,
      timePrecision: null
    }
  }

  const scheduledDateTime = Temporal.ZonedDateTime.from({
    timeZone: input.timezone,
    year: date.date.year,
    month: date.date.month,
    day: date.date.day,
    hour: time?.hour ?? DAYTIME_DEFAULT_HOUR,
    minute: time?.minute ?? 0,
    second: 0,
    millisecond: 0
  }).toInstant()

  if (scheduledDateTime.epochMilliseconds <= referenceInstant.epochMilliseconds) {
    return {
      kind: 'invalid_past',
      scheduledFor: scheduledDateTime,
      timePrecision: time ? 'exact' : 'date_only_defaulted'
    }
  }

  return {
    kind: 'parsed',
    scheduledFor: scheduledDateTime,
    timePrecision: time ? 'exact' : 'date_only_defaulted'
  }
}

function stripScheduleFragments(text: string, fragments: readonly (string | null)[]): string {
  let next = text

  for (const fragment of fragments) {
    if (!fragment || fragment.trim().length === 0) {
      continue
    }

    next = next.replace(fragment, ' ')
  }

  next = next
    .replace(/\b(?:on|at|в)\b/giu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/^[,.\-:;]+/u, '')
    .replace(/[,\-:;]+$/u, '')
    .trim()

  return next
}

export function parseAdHocNotificationRequest(input: {
  text: string
  timezone: string
  locale: SupportedLocale
  members: readonly HouseholdMemberRecord[]
  senderMemberId: string
  now?: Instant
}): ParsedAdHocNotificationRequest {
  const rawText = normalizeWhitespace(input.text)
  if (!hasIntent(rawText)) {
    return {
      kind: 'not_intent',
      originalRequestText: rawText,
      notificationText: null,
      assigneeMemberId: null,
      scheduledFor: null,
      timePrecision: null
    }
  }

  const body = removeIntentPreamble(rawText)
  const referenceInstant = input.now ?? nowInstant()
  const date = parseDate(body, input.timezone, referenceInstant)
  const time = parseTime(body)

  const notificationText = stripScheduleFragments(body, [
    date?.matchedText ?? null,
    time?.matchedText ?? null
  ])
  const assigneeMemberId = detectAssignee(notificationText, input.members, input.senderMemberId)

  if (!date) {
    return {
      kind: 'missing_schedule',
      originalRequestText: rawText,
      notificationText: notificationText.length > 0 ? notificationText : body,
      assigneeMemberId,
      scheduledFor: null,
      timePrecision: null
    }
  }

  const schedule = parseAdHocNotificationSchedule({
    text: [date.matchedText, time?.matchedText].filter(Boolean).join(' '),
    timezone: input.timezone,
    now: referenceInstant
  })

  if (schedule.kind === 'invalid_past') {
    return {
      kind: 'invalid_past',
      originalRequestText: rawText,
      notificationText: notificationText.length > 0 ? notificationText : body,
      assigneeMemberId,
      scheduledFor: schedule.scheduledFor,
      timePrecision: schedule.timePrecision
    }
  }

  return {
    kind: 'parsed',
    originalRequestText: rawText,
    notificationText: notificationText.length > 0 ? notificationText : body,
    assigneeMemberId,
    scheduledFor: schedule.scheduledFor,
    timePrecision: schedule.timePrecision
  }
}
