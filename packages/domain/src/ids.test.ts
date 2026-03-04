import { describe, expect, test } from 'bun:test'

import { DOMAIN_ERROR_CODE, DomainError } from './errors'
import { BillingCycleId, HouseholdId, MemberId, PurchaseEntryId } from './ids'

describe('IDs', () => {
  test('creates and compares typed ids', () => {
    const left = MemberId.from('member_1')
    const right = MemberId.from('member_1')

    expect(left.equals(right)).toBe(true)
    expect(left.toString()).toBe('member_1')
  })

  test('typed ids with same value and different type are not equal', () => {
    const member = MemberId.from('abc')
    const household = HouseholdId.from('abc')

    expect(member.equals(household)).toBe(false)
  })

  test('rejects invalid id values', () => {
    expect(() => BillingCycleId.from('')).toThrow(
      new DomainError(DOMAIN_ERROR_CODE.INVALID_ENTITY_ID, 'BillingCycleId cannot be empty')
    )

    expect(() => PurchaseEntryId.from('bad value with space')).toThrow(
      new DomainError(
        DOMAIN_ERROR_CODE.INVALID_ENTITY_ID,
        'PurchaseEntryId contains invalid characters: bad value with space'
      )
    )
  })
})
