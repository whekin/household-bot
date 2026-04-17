import { describe, expect, test } from 'bun:test'

import { parsePaymentConfirmationMessage } from './payment-confirmation-parser'

describe('parsePaymentConfirmationMessage', () => {
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
})
