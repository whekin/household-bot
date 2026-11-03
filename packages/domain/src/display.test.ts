import { describe, expect, test } from 'bun:test'

import {
  formatDayDisplay,
  formatMajorMoneyDisplay,
  formatMoneyDisplay,
  formatMonthDisplay,
  nextPeriod,
  pluralRu
} from './display'

describe('formatMoneyDisplay', () => {
  test('drops zero kopecks and keeps the rest', () => {
    expect(formatMoneyDisplay(45500n, 'GEL')).toBe('455 ₾')
    expect(formatMoneyDisplay(595n, 'GEL')).toBe('5.95 ₾')
    expect(formatMoneyDisplay(550n, 'GEL')).toBe('5.50 ₾')
    expect(formatMoneyDisplay(0n, 'GEL')).toBe('0 ₾')
  })

  test('groups thousands per locale', () => {
    expect(formatMoneyDisplay(182000n, 'GEL', 'ru')).toBe('1 820 ₾')
    expect(formatMoneyDisplay(182000n, 'USD', 'en')).toBe('$1,820')
  })

  test('uses a real minus sign', () => {
    expect(formatMoneyDisplay(-149n, 'GEL')).toBe('−1.49 ₾')
  })

  test('accepts major-unit strings', () => {
    expect(formatMajorMoneyDisplay('455.00', 'GEL')).toBe('455 ₾')
    expect(formatMajorMoneyDisplay('5.5', 'USD', 'en')).toBe('$5.50')
  })
})

describe('formatMonthDisplay', () => {
  test('names the month without the year', () => {
    expect(formatMonthDisplay('2026-10', 'ru')).toBe('октябрь')
    expect(formatMonthDisplay('2026-11', 'ru', 'genitive')).toBe('ноября')
    expect(formatMonthDisplay('2026-10', 'en')).toBe('October')
    expect(formatMonthDisplay('bad', 'ru')).toBe('bad')
  })

  test('rolls over to the next month', () => {
    expect(nextPeriod('2026-10')).toBe('2026-11')
    expect(nextPeriod('2026-12')).toBe('2027-01')
  })

  test('formats a day', () => {
    expect(formatDayDisplay('2026-10-25', 'ru')).toBe('25 октября')
    expect(formatDayDisplay('2026-10-25', 'en')).toBe('October 25')
  })
})

describe('pluralRu', () => {
  test('picks the right form', () => {
    const forms = ['счёт', 'счёта', 'счетов'] as const
    expect(pluralRu(1, forms)).toBe('счёт')
    expect(pluralRu(3, forms)).toBe('счёта')
    expect(pluralRu(5, forms)).toBe('счетов')
    expect(pluralRu(11, forms)).toBe('счетов')
    expect(pluralRu(21, forms)).toBe('счёт')
  })
})
