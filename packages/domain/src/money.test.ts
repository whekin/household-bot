import { describe, expect, test } from 'bun:test'

import { DOMAIN_ERROR_CODE, DomainError } from './errors'
import { Money } from './money'

describe('Money', () => {
  test('parses major units and formats back deterministically', () => {
    const money = Money.fromMajor('12.34', 'GEL')

    expect(money.amountMinor).toBe(1234n)
    expect(money.toMajorString()).toBe('12.34')
  })

  test('rejects non-integer minor units', () => {
    expect(() => Money.fromMinor(10.5, 'GEL')).toThrow(
      new DomainError(
        DOMAIN_ERROR_CODE.INVALID_MONEY_AMOUNT,
        'Money minor amount must be an integer'
      )
    )
  })

  test('adds and subtracts money in same currency', () => {
    const base = Money.fromMinor(1000n, 'USD')
    const delta = Money.fromMinor(250n, 'USD')

    expect(base.add(delta).amountMinor).toBe(1250n)
    expect(base.subtract(delta).amountMinor).toBe(750n)
  })

  test('throws on currency mismatch', () => {
    const gel = Money.fromMinor(1000n, 'GEL')
    const usd = Money.fromMinor(1000n, 'USD')

    expect(() => gel.add(usd)).toThrow(
      new DomainError(
        DOMAIN_ERROR_CODE.CURRENCY_MISMATCH,
        'Money operation currency mismatch: GEL vs USD'
      )
    )
  })

  test('splits evenly with deterministic remainder allocation', () => {
    const amount = Money.fromMinor(10n, 'GEL')
    const parts = amount.splitEvenly(3)

    expect(parts.map((part) => part.amountMinor)).toEqual([4n, 3n, 3n])
    expect(parts.reduce((sum, current) => sum + current.amountMinor, 0n)).toBe(10n)
  })

  test('splits by weights deterministically', () => {
    const amount = Money.fromMinor(100n, 'GEL')
    const parts = amount.splitByWeights([3, 2, 1])

    expect(parts.map((part) => part.amountMinor)).toEqual([50n, 33n, 17n])
    expect(parts.reduce((sum, current) => sum + current.amountMinor, 0n)).toBe(100n)
  })

  test('splits negative values with same deterministic rules', () => {
    const amount = Money.fromMinor(-10n, 'GEL')
    const parts = amount.splitEvenly(3)

    expect(parts.map((part) => part.amountMinor)).toEqual([-4n, -3n, -3n])
    expect(parts.reduce((sum, current) => sum + current.amountMinor, 0n)).toBe(-10n)
  })
})
