import type { Locale } from '../i18n'

function localeTag(locale: Locale): string {
  return locale === 'ru' ? 'ru-RU' : 'en-US'
}

export function formatFriendlyDate(value: string, locale: Locale): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  const includeYear = date.getUTCFullYear() !== new Date().getUTCFullYear()

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
