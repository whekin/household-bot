/// <reference types="bun" />

import { describe, expect, test } from 'bun:test'

import {
  percentageStringToBasisPoints,
  rebalancePurchaseSplit,
  validatePurchaseDraft,
  type PurchaseDraft
} from './ledger-helpers'

describe('percentageStringToBasisPoints', () => {
  test('parses decimal percentages without floating-point math', () => {
    expect(percentageStringToBasisPoints('12.34')).toBe(1234n)
    expect(percentageStringToBasisPoints('12,3')).toBe(1230n)
    expect(percentageStringToBasisPoints('.5')).toBe(50n)
    expect(percentageStringToBasisPoints('33.333')).toBe(3333n)
    expect(percentageStringToBasisPoints('33.335')).toBe(3334n)
    expect(percentageStringToBasisPoints('100')).toBe(10000n)
  })

  test('fails closed for invalid or negative percentages', () => {
    expect(percentageStringToBasisPoints('-1')).toBe(0n)
    expect(percentageStringToBasisPoints('abc')).toBe(0n)
  })
})

function customPurchaseDraft(
  participants: PurchaseDraft['participants'],
  amountMajor = '30.00'
): PurchaseDraft {
  return {
    description: 'groceries',
    amountMajor,
    currency: 'GEL',
    occurredOn: '2026-05-31',
    payerMemberId: 'member-a',
    splitMode: 'custom_amounts',
    splitInputMode: 'exact',
    participants
  }
}

describe('custom purchase draft split validation', () => {
  test('auto-excludes zero-share participants created by rebalance', () => {
    const draft = customPurchaseDraft([
      {
        memberId: 'member-a',
        included: true,
        shareAmountMajor: '15.00',
        sharePercentage: ''
      },
      {
        memberId: 'member-b',
        included: true,
        shareAmountMajor: '15.00',
        sharePercentage: '',
        isAutoCalculated: true
      }
    ])

    const rebalanced = rebalancePurchaseSplit(draft, 'member-a', '30.00')

    expect(rebalanced.participants).toEqual([
      {
        memberId: 'member-a',
        included: true,
        shareAmountMajor: '30.00',
        sharePercentage: '100.00',
        lastUpdatedAt: expect.any(Number),
        isAutoCalculated: false
      },
      {
        memberId: 'member-b',
        included: false,
        shareAmountMajor: '0.00',
        sharePercentage: '',
        isAutoCalculated: true
      }
    ])
    expect(validatePurchaseDraft(rebalanced)).toEqual({
      valid: true,
      remainingMinor: 0n
    })
  })

  test('rejects included zero shares before sending a custom split', () => {
    const draft = customPurchaseDraft([
      {
        memberId: 'member-a',
        included: true,
        shareAmountMajor: '30.00',
        sharePercentage: '100.00'
      },
      {
        memberId: 'member-b',
        included: true,
        shareAmountMajor: '0.00',
        sharePercentage: ''
      }
    ])

    expect(validatePurchaseDraft(draft)).toEqual({
      valid: false,
      error: 'Included shares must be positive',
      remainingMinor: 0n
    })
  })
})
