import type { Locale } from '../i18n'

function localeTag(locale: Locale): string {
  return locale === 'ru' ? 'ru-RU' : 'en-US'
}

function formatCalendarDate(
  year: number,
  month: number,
  day: number,
  locale: Locale
): string | null {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null
  }

  const includeYear = year !== new Date().getUTCFullYear()

  return new Intl.DateTimeFormat(localeTag(locale), {
    month: 'long',
    day: 'numeric',
    ...(includeYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC'
  }).format(new Date(Date.UTC(year, month - 1, day)))
}

function parsePeriod(period: string): { year: number; month: number } | null {
  const [yearValue, monthValue] = period.split('-')
  const year = Number.parseInt(yearValue ?? '', 10)
  const month = Number.parseInt(monthValue ?? '', 10)

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null
  }

  return {
    year,
    month
  }
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function formatTodayParts(timezone: string): { year: number; month: number; day: number } | null {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date())

    const year = Number.parseInt(parts.find((part) => part.type === 'year')?.value ?? '', 10)
    const month = Number.parseInt(parts.find((part) => part.type === 'month')?.value ?? '', 10)
    const day = Number.parseInt(parts.find((part) => part.type === 'day')?.value ?? '', 10)

    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
      return null
    }

    return { year, month, day }
  } catch {
    return null
  }
}

export function formatFriendlyDate(value: string, locale: Locale): string {
  const calendarDateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (calendarDateMatch) {
    const formatted = formatCalendarDate(
      Number.parseInt(calendarDateMatch[1] ?? '', 10),
      Number.parseInt(calendarDateMatch[2] ?? '', 10),
      Number.parseInt(calendarDateMatch[3] ?? '', 10),
      locale
    )
    if (formatted) {
      return formatted
    }
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  const includeYear = date.getFullYear() !== new Date().getFullYear()

  return new Intl.DateTimeFormat(localeTag(locale), {
    month: 'long',
    day: 'numeric',
    ...(includeYear ? { year: 'numeric' } : {})
  }).format(date)
}

export function formatCyclePeriod(period: string, locale: Locale): string {
  const parsed = parsePeriod(period)
  if (!parsed) {
    return period
  }

  const date = new Date(Date.UTC(parsed.year, parsed.month - 1, 1))
  const includeYear = parsed.year !== new Date().getUTCFullYear()

  return new Intl.DateTimeFormat(localeTag(locale), {
    month: 'long',
    ...(includeYear ? { year: 'numeric' } : {})
  }).format(date)
}

export function formatPeriodDay(period: string, day: number, locale: Locale): string {
  const parsed = parsePeriod(period)
  if (!parsed) {
    return period
  }

  const safeDay = Math.max(1, Math.min(day, daysInMonth(parsed.year, parsed.month)))

  return (
    formatCalendarDate(parsed.year, parsed.month, safeDay, locale) ??
    `${formatCyclePeriod(period, locale)} ${safeDay}`
  )
}

export function compareTodayToPeriodDay(
  period: string,
  day: number,
  timezone: string
): -1 | 0 | 1 | null {
  const parsed = parsePeriod(period)
  const today = formatTodayParts(timezone)
  if (!parsed || !today) {
    return null
  }

  const safeDay = Math.max(1, Math.min(day, daysInMonth(parsed.year, parsed.month)))
  const dueValue = Date.UTC(parsed.year, parsed.month - 1, safeDay)
  const todayValue = Date.UTC(today.year, today.month - 1, today.day)

  if (todayValue < dueValue) {
    return -1
  }

  if (todayValue > dueValue) {
    return 1
  }

  return 0
}

export function daysUntilPeriodDay(period: string, day: number, timezone: string): number | null {
  const parsed = parsePeriod(period)
  const today = formatTodayParts(timezone)
  if (!parsed || !today) {
    return null
  }

  const safeDay = Math.max(1, Math.min(day, daysInMonth(parsed.year, parsed.month)))
  const dueValue = Date.UTC(parsed.year, parsed.month - 1, safeDay)
  const todayValue = Date.UTC(today.year, today.month - 1, today.day)

  return Math.round((dueValue - todayValue) / 86_400_000)
}
