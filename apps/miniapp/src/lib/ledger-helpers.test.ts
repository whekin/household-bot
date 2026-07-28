/// <reference types="bun" />

import { describe, expect, test } from 'bun:test'

import {
  canEditLedgerEntry,
  percentageStringToBasisPoints,
  rebalancePurchaseSplit,
  validatePurchaseDraft,
  type PurchaseDraft
} from './ledger-helpers'
import type { MiniAppDashboard } from '../api'

function purchaseLedgerEntry(
  input: Partial<MiniAppDashboard['ledger'][number]> = {}
): MiniAppDashboard['ledger'][number] {
  return {
    id: 'purchase-1',
    kind: 'purchase',
    title: 'Kettle',
    memberId: 'member-a',
    paymentKind: null,
    amountMajor: '30.00',
    currency: 'GEL',
    displayAmountMajor: '30.00',
    displayCurrency: 'GEL',
    fxRateMicros: null,
    fxEffectiveDate: null,
    actorDisplayName: 'Alice',
    occurredAt: '2026-07-10T12:00:00Z',
    createdByMemberId: 'member-a',
    isCurrentCyclePurchase: true,
    hasRecordedAllocations: false,
    ...input
  }
}

describe('canEditLedgerEntry', () => {
  test('allows an administrator to edit any ledger entry', () => {
    expect(
      canEditLedgerEntry({
        entry: purchaseLedgerEntry({
          createdByMemberId: 'member-other',
          isCurrentCyclePurchase: false,
          hasRecordedAllocations: true
        }),
        currentMemberId: 'member-a',
        isAdmin: true
      })
    ).toBe(true)
  })

  test('allows a member to edit their current unallocated purchase', () => {
    expect(
      canEditLedgerEntry({
        entry: purchaseLedgerEntry(),
        currentMemberId: 'member-a',
        isAdmin: false
      })
    ).toBe(true)
  })

  test('rejects non-owner, historical, and allocated member edits', () => {
    const variants = [
      purchaseLedgerEntry({ createdByMemberId: 'member-other' }),
      purchaseLedgerEntry({ isCurrentCyclePurchase: false }),
      purchaseLedgerEntry({ hasRecordedAllocations: true })
    ]

    expect(
      variants.map((entry) =>
        canEditLedgerEntry({
          entry,
          currentMemberId: 'member-a',
          isAdmin: false
        })
      )
    ).toEqual([false, false, false])
  })
})

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
