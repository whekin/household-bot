import { describe, expect, test } from 'bun:test'

import {
  cycleHistoryStatus,
  cyclePaymentProgressPercent,
  formatHistoryPeriod
} from './cycle-history-helpers'

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

  test('computes a clamped payment progress without floating-point money math', () => {
    expect(cyclePaymentProgressPercent({ totalDueMajor: '100.00', totalPaidMajor: '63.25' })).toBe(
      63.25
    )
    expect(cyclePaymentProgressPercent({ totalDueMajor: '100.00', totalPaidMajor: '120.00' })).toBe(
      100
    )
    expect(cyclePaymentProgressPercent({ totalDueMajor: '0.00', totalPaidMajor: '0.00' })).toBe(100)
  })
})
