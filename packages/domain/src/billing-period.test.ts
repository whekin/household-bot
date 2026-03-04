import { describe, expect, test } from 'bun:test'

import { DOMAIN_ERROR_CODE, DomainError } from './errors'
import { BillingPeriod } from './billing-period'

describe('BillingPeriod', () => {
  test('parses canonical YYYY-MM format', () => {
    const period = BillingPeriod.fromString('2026-03')

    expect(period.year).toBe(2026)
    expect(period.month).toBe(3)
    expect(period.toString()).toBe('2026-03')
  })

  test('rejects malformed format', () => {
    expect(() => BillingPeriod.fromString('2026/03')).toThrow(
      new DomainError(
        DOMAIN_ERROR_CODE.INVALID_BILLING_PERIOD,
        'Billing period must match YYYY-MM: 2026/03'
      )
    )
  })

  test('navigates next and previous correctly', () => {
    const december = BillingPeriod.from(2026, 12)

    expect(december.next().toString()).toBe('2027-01')
    expect(december.previous().toString()).toBe('2026-11')
  })

  test('compares periods', () => {
    const left = BillingPeriod.from(2026, 3)
    const right = BillingPeriod.from(2026, 4)

    expect(left.compare(right)).toBe(-1)
    expect(right.compare(left)).toBe(1)
    expect(left.compare(BillingPeriod.from(2026, 3))).toBe(0)
  })
})
