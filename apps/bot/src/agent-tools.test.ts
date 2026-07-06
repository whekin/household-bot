import { describe, expect, test } from 'bun:test'

import { Money } from '@household/domain'

import { explicitAmountFromMessage, paymentKindDueDate, splitMoneyByWeights } from './agent-tools'

describe('explicitAmountFromMessage', () => {
  test('accepts an amount with currency written in the message', () => {
    const amount = explicitAmountFromMessage({
      rawText: 'оплатил коммуналку 100 лари',
      amountMajor: '100',
      currency: 'GEL'
    })

    expect(amount?.amountMinor).toBe(10000n)
  })

  test('accepts a bare number from the message', () => {
    const amount = explicitAmountFromMessage({
      rawText: 'Закинул 465 за аренду',
      amountMajor: '465',
      currency: 'GEL'
    })

    expect(amount?.amountMinor).toBe(46500n)
  })

  test('accepts comma decimal variants', () => {
    const amount = explicitAmountFromMessage({
      rawText: 'перевёл 18,48',
      amountMajor: '18.48',
      currency: 'GEL'
    })

    expect(amount?.amountMinor).toBe(1848n)
  })

  test('rejects amounts that are not present in the message', () => {
    expect(
      explicitAmountFromMessage({
        rawText: 'Так, сегодня надо бы дооплатить',
        amountMajor: '18.48',
        currency: 'GEL'
      })
    ).toBeNull()
  })

  test('rejects partial digit matches', () => {
    expect(
      explicitAmountFromMessage({
        rawText: 'взял 1465 бонусов',
        amountMajor: '465',
        currency: 'GEL'
      })
    ).toBeNull()
  })

  test('rejects non-positive and malformed amounts', () => {
    expect(
      explicitAmountFromMessage({ rawText: '0', amountMajor: '0', currency: 'GEL' })
    ).toBeNull()
    expect(
      explicitAmountFromMessage({ rawText: 'сто', amountMajor: 'сто', currency: 'GEL' })
    ).toBeNull()
  })
})

describe('paymentKindDueDate', () => {
  const settings = { rentDueDay: 20, utilitiesDueDay: 5 }

  test('builds per-kind due dates inside the period', () => {
    expect(paymentKindDueDate('2026-07', 'rent', settings)).toBe('2026-07-20')
    expect(paymentKindDueDate('2026-06', 'utilities', settings)).toBe('2026-06-05')
  })

  test('clamps the due day to the month length', () => {
    expect(paymentKindDueDate('2026-02', 'rent', { rentDueDay: 31, utilitiesDueDay: 5 })).toBe(
      '2026-02-28'
    )
  })

  test('rejects malformed periods', () => {
    expect(paymentKindDueDate('июнь', 'rent', settings)).toBeNull()
  })
})

describe('splitMoneyByWeights', () => {
  test('splits evenly and deterministically distributes the remainder', () => {
    const shares = splitMoneyByWeights(Money.fromMajor('700', 'USD'), [
      { memberId: 'a', weight: 1 },
      { memberId: 'b', weight: 1 },
      { memberId: 'c', weight: 1 },
      { memberId: 'd', weight: 1 }
    ])

    expect(shares.get('a')?.toMajorString()).toBe('175.00')
    expect(shares.get('d')?.toMajorString()).toBe('175.00')
  })

  test('gives leftover minor units to the first members', () => {
    const shares = splitMoneyByWeights(Money.fromMinor(100n, 'GEL'), [
      { memberId: 'a', weight: 1 },
      { memberId: 'b', weight: 1 },
      { memberId: 'c', weight: 1 }
    ])

    const total = [...shares.values()].reduce((sum, amount) => sum + amount.amountMinor, 0n)
    expect(total).toBe(100n)
    expect(shares.get('a')?.amountMinor).toBe(34n)
    expect(shares.get('b')?.amountMinor).toBe(33n)
  })

  test('respects uneven weights and skips zero-weight members', () => {
    const shares = splitMoneyByWeights(Money.fromMajor('300', 'GEL'), [
      { memberId: 'a', weight: 2 },
      { memberId: 'b', weight: 1 },
      { memberId: 'c', weight: 0 }
    ])

    expect(shares.get('a')?.toMajorString()).toBe('200.00')
    expect(shares.get('b')?.toMajorString()).toBe('100.00')
    expect(shares.has('c')).toBe(false)
  })
})
