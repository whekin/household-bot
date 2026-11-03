import type { CurrencyCode } from './money'
import type { SupportedLocale } from './locale'

// One spelling for amounts and months across every surface that shows them to people.

const RU_MONTHS_NOMINATIVE = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь'
] as const

const RU_MONTHS_GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря'
] as const

const EN_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
] as const

// U+202F narrow no-break space keeps "1 820 ₾" on one line.
const RU_GROUP_SEPARATOR = ' '
const MINUS = '−'

function groupDigits(digits: string, separator: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator)
}

/**
 * Whole amounts drop their kopecks ("455 ₾"); anything else keeps both digits ("5.50 ₾").
 */
export function formatMoneyDisplay(
  amountMinor: bigint,
  currency: CurrencyCode | string,
  locale: SupportedLocale = 'ru'
): string {
  const negative = amountMinor < 0n
  const absolute = negative ? -amountMinor : amountMinor
  const whole = groupDigits(
    (absolute / 100n).toString(),
    locale === 'ru' ? RU_GROUP_SEPARATOR : ','
  )
  const fraction = absolute % 100n
  const number = fraction === 0n ? whole : `${whole}.${fraction.toString().padStart(2, '0')}`
  const sign = negative ? MINUS : ''

  if (currency === 'USD') {
    return `${sign}$${number}`
  }
  if (currency === 'GEL') {
    return `${sign}${number} ₾`
  }
  return `${sign}${number} ${currency}`
}

/** Parses a major-unit string such as "455.00" or "5.5" into minor units, or null. */
export function parseMajorToMinor(value: string): bigint | null {
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim())
  if (!match) {
    return null
  }
  const minor = BigInt(match[2]!) * 100n + BigInt((match[3] ?? '').padEnd(2, '0') || '0')
  return match[1] ? -minor : minor
}

/** Same as {@link formatMoneyDisplay} for amounts that arrive as major-unit strings. */
export function formatMajorMoneyDisplay(
  amountMajor: string,
  currency: CurrencyCode | string,
  locale: SupportedLocale = 'ru'
): string {
  const minor = parseMajorToMinor(amountMajor)
  return minor === null ? `${amountMajor} ${currency}` : formatMoneyDisplay(minor, currency, locale)
}

function monthIndexOf(period: string): number | null {
  const match = /^(\d{4})-(\d{2})$/.exec(period)
  if (!match) {
    return null
  }
  const index = Number(match[2]) - 1
  return index >= 0 && index <= 11 ? index : null
}

/**
 * "октябрь" / "October" for a `YYYY-MM` period. The year is left out on purpose: a
 * household talks about this month and the last few, never a year back.
 * `genitive` gives "октября" for phrases like "до октября"; English ignores it.
 */
export function formatMonthDisplay(
  period: string,
  locale: SupportedLocale = 'ru',
  grammaticalCase: 'nominative' | 'genitive' = 'nominative'
): string {
  const index = monthIndexOf(period)
  if (index === null) {
    return period
  }
  if (locale === 'en') {
    return EN_MONTHS[index]!
  }
  return (grammaticalCase === 'genitive' ? RU_MONTHS_GENITIVE : RU_MONTHS_NOMINATIVE)[index]!
}

/** The month after a `YYYY-MM` period, as `YYYY-MM`. */
export function nextPeriod(period: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period)
  if (!match) {
    return period
  }
  const year = Number(match[1])
  const month = Number(match[2])
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`
}

/** "25 октября" / "October 25" for a `YYYY-MM-DD` date. */
export function formatDayDisplay(date: string, locale: SupportedLocale = 'ru'): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) {
    return date
  }
  const index = Number(match[2]) - 1
  const day = Number(match[3])
  if (index < 0 || index > 11 || day < 1 || day > 31) {
    return date
  }
  return locale === 'en' ? `${EN_MONTHS[index]} ${day}` : `${day} ${RU_MONTHS_GENITIVE[index]}`
}

/**
 * Russian plural pick: `pluralRu(3, ['счёт', 'счёта', 'счетов'])` → "счёта".
 */
export function pluralRu(count: number, forms: readonly [string, string, string]): string {
  const absolute = Math.abs(count) % 100
  const last = absolute % 10
  if (absolute > 10 && absolute < 20) return forms[2]
  if (last === 1) return forms[0]
  if (last >= 2 && last <= 4) return forms[1]
  return forms[2]
}
