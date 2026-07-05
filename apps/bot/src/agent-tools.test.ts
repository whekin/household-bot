import { describe, expect, test } from 'bun:test'

import { explicitAmountFromMessage } from './agent-tools'

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
