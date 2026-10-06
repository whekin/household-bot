import { describe, expect, test } from 'bun:test'

import { parsePaymentConfirmationMessage } from './payment-confirmation-parser'

describe('parsePaymentConfirmationMessage', () => {
  test.each([
    ['paid electricity 15.70₾', 1570n, 'GEL'],
    ['paid electricity 4лари', 400n, 'GEL'],
    ['paid rent 175$', 17500n, 'USD']
  ] as const)('keeps exact units in %s', (text, minor, currency) => {
    const result = parsePaymentConfirmationMessage(text, 'GEL')
    expect(result.explicitAmount?.amountMinor).toBe(minor)
    expect(result.explicitAmount?.currency).toBe(currency)
  })
  test.each(['paid electricity 4.001 GEL', 'paid electricity .5 GEL', 'paid electricity -4 GEL'])(
    'does not replace a malformed amount with billing guidance: %s',
    (text) => {
      expect(parsePaymentConfirmationMessage(text, 'GEL').reviewReason).not.toBeNull()
    }
  )
  test('detects rent confirmation without explicit amount', () => {
    const result = parsePaymentConfirmationMessage('за жилье закинул', 'GEL')

    expect(result.kind).toBe('rent')
    expect(result.explicitAmount).toBeNull()
    expect(result.reviewReason).toBeNull()
  })

  test('detects rent confirmation for genitive housing phrasing', () => {
    const result = parsePaymentConfirmationMessage('я уже закинул за оплату жилья', 'GEL')

    expect(result.kind).toBe('rent')
    expect(result.explicitAmount).toBeNull()
    expect(result.reviewReason).toBeNull()
  })

  test('detects utility confirmation with explicit default-currency amount', () => {
    const result = parsePaymentConfirmationMessage('оплатил газ 120', 'GEL')

    expect(result.kind).toBe('utilities')
    expect(result.explicitAmount?.amountMinor).toBe(12000n)
    expect(result.explicitAmount?.currency).toBe('GEL')
    expect(result.reviewReason).toBeNull()
  })

  test('keeps multi-member confirmations for review', () => {
    const result = parsePaymentConfirmationMessage('перевел за Кирилла и себя', 'GEL')

    expect(result.kind).toBeNull()
    expect(result.reviewReason).toBe('multiple_members')
  })

  test('keeps generic done messages for review', () => {
    const result = parsePaymentConfirmationMessage('готово', 'GEL')

    expect(result.kind).toBeNull()
    expect(result.reviewReason).toBe('kind_ambiguous')
  })

  test('detects receipt-style paid captions as payment intent', () => {
    const result = parsePaymentConfirmationMessage('🖼 оплачено', 'GEL')

    expect(result.kind).toBeNull()
    expect(result.reviewReason).toBe('kind_ambiguous')
  })

  test('does not treat future закину wording as completed payment intent', () => {
    const result = parsePaymentConfirmationMessage('завтра закину', 'GEL')

    expect(result.kind).toBeNull()
    expect(result.reviewReason).toBe('intent_missing')
  })
})
