import { describe, expect, test } from 'bun:test'

import { cycleHistoryStatus, formatHistoryPeriod } from './past-months'

describe('cycle history helpers', () => {
  test('formats a canonical period in the active locale', () => {
    expect(formatHistoryPeriod('2026-03', 'en')).toBe('March 2026')
    expect(formatHistoryPeriod('2026-03', 'ru')).toBe('март 2026 г.')
    expect(formatHistoryPeriod('not-a-period', 'en')).toBe('not-a-period')
  })

  test('classifies settled, outstanding, and credit archives', () => {
    expect(cycleHistoryStatus({ totalRemainingMajor: '0.00' })).toBe('settled')
    expect(cycleHistoryStatus({ totalRemainingMajor: '12.40' })).toBe('outstanding')
    expect(cycleHistoryStatus({ totalRemainingMajor: '-2.00' })).toBe('credit')
  })
})
