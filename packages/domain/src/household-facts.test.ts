import { describe, expect, test } from 'bun:test'

import {
  HOUSEHOLD_FACT_BODY_MAX_LENGTH,
  HOUSEHOLD_FACT_KEY_MAX_LENGTH,
  householdFactKey,
  normalizeHouseholdFact
} from './household-facts'

describe('householdFactKey', () => {
  test('slugs latin text', () => {
    expect(householdFactKey('  Wi-Fi Password ')).toBe('wi-fi-password')
    expect(householdFactKey('Trash / Recycling!')).toBe('trash-recycling')
  })

  test('returns an empty key for text without latin characters', () => {
    expect(householdFactKey('пароль от вайфая')).toBe('')
  })

  test('truncates without a trailing separator', () => {
    const key = householdFactKey('a'.repeat(HOUSEHOLD_FACT_KEY_MAX_LENGTH) + ' tail')
    expect(key).toBe('a'.repeat(HOUSEHOLD_FACT_KEY_MAX_LENGTH))
  })
})

describe('normalizeHouseholdFact', () => {
  test('derives the key from a latin title', () => {
    expect(normalizeHouseholdFact({ title: 'Door code', body: '1234' })).toEqual({
      key: 'door-code',
      title: 'Door code',
      body: '1234'
    })
  })

  test('keeps a non-latin title when an explicit key is given', () => {
    expect(normalizeHouseholdFact({ key: 'wifi', title: 'Пароль Wi-Fi', body: 'hunter2' })).toEqual(
      {
        key: 'wifi',
        title: 'Пароль Wi-Fi',
        body: 'hunter2'
      }
    )
  })

  test('rejects a non-latin title with no usable key', () => {
    expect(normalizeHouseholdFact({ title: 'Пароль', body: 'hunter2' })).toBeNull()
  })

  test('rejects an empty body', () => {
    expect(normalizeHouseholdFact({ key: 'wifi', title: 'Wi-Fi', body: '   ' })).toBeNull()
  })

  test('truncates an oversized body', () => {
    const fact = normalizeHouseholdFact({
      key: 'wifi',
      title: 'Wi-Fi',
      body: 'x'.repeat(HOUSEHOLD_FACT_BODY_MAX_LENGTH + 50)
    })

    expect(fact?.body.length).toBe(HOUSEHOLD_FACT_BODY_MAX_LENGTH)
  })
})
