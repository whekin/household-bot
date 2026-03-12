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
  const [yearValue, monthValue] = period.split('-')
  const year = Number.parseInt(yearValue ?? '', 10)
  const month = Number.parseInt(monthValue ?? '', 10)

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return period
  }

  const date = new Date(Date.UTC(year, month - 1, 1))
  const includeYear = year !== new Date().getUTCFullYear()

  return new Intl.DateTimeFormat(localeTag(locale), {
    month: 'long',
    ...(includeYear ? { year: 'numeric' } : {})
  }).format(date)
}
