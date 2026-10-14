import { describe, expect, test } from 'bun:test'

import { parseMoneyInput, sanitizeMoneyInput } from './money'

describe('sanitizeMoneyInput', () => {
  test('keeps digits, one decimal point and two decimals', () => {
    expect(sanitizeMoneyInput('12,5')).toBe('12.5')
    expect(sanitizeMoneyInput('1 000')).toBe('1000')
    expect(sanitizeMoneyInput('12 ₾')).toBe('12')
    expect(sanitizeMoneyInput('-5')).toBe('5')
    expect(sanitizeMoneyInput('1.2.3')).toBe('1.23')
    expect(sanitizeMoneyInput('9.999')).toBe('9.99')
    expect(sanitizeMoneyInput('1e3')).toBe('13')
  })
})

describe('parseMoneyInput', () => {
  test('never throws on what people type', () => {
    expect(parseMoneyInput('')).toBe(0n)
    expect(parseMoneyInput('10a')).toBe(1000n)
    expect(parseMoneyInput('1 000,50')).toBe(100050n)
    expect(parseMoneyInput('.')).toBe(0n)
    expect(parseMoneyInput('abc')).toBe(0n)
  })
})
