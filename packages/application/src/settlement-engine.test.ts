import { describe, expect, test } from 'bun:test'

import {
  BillingCycleId,
  BillingPeriod,
  DomainError,
  MemberId,
  Money,
  PurchaseEntryId
} from '@household/domain'

import { calculateMonthlySettlement } from './settlement-engine'

function fixtureBase() {
  return {
    cycleId: BillingCycleId.from('cycle-2026-03'),
    period: BillingPeriod.fromString('2026-03'),
    rent: Money.fromMajor('700.00', 'USD'),
    utilities: Money.fromMajor('120.00', 'USD')
  }
}

describe('calculateMonthlySettlement', () => {
  test('3-member equal split with purchase offsets', () => {
    const input = {
      ...fixtureBase(),
      utilitySplitMode: 'equal' as const,
      members: [
        { memberId: MemberId.from('alice'), active: true },
        { memberId: MemberId.from('bob'), active: true },
        { memberId: MemberId.from('carol'), active: true }
      ],
      purchases: [
        {
          purchaseId: PurchaseEntryId.from('p1'),
          payerId: MemberId.from('alice'),
          amount: Money.fromMajor('30.00', 'USD')
        }
      ]
    }

    const result = calculateMonthlySettlement(input)

    expect(result.lines.map((line) => line.memberId.toString())).toEqual(['alice', 'bob', 'carol'])
    expect(result.lines.map((line) => line.rentShare.amountMinor)).toEqual([23334n, 23333n, 23333n])
    expect(result.lines.map((line) => line.utilityShare.amountMinor)).toEqual([4000n, 4000n, 4000n])
    expect(result.lines.map((line) => line.purchaseOffset.amountMinor)).toEqual([
      -2000n,
      1000n,
      1000n
    ])
    expect(result.lines.map((line) => line.netDue.amountMinor)).toEqual([25334n, 28333n, 28333n])
    expect(result.totalDue.amountMinor).toBe(82000n)
  })

  test('4-member weighted utility split by days', () => {
    const input = {
      ...fixtureBase(),
      utilitySplitMode: 'weighted_by_days' as const,
      members: [
        { memberId: MemberId.from('a'), active: true, utilityDays: 31 },
        { memberId: MemberId.from('b'), active: true, utilityDays: 31 },
        { memberId: MemberId.from('c'), active: true, utilityDays: 20 },
        { memberId: MemberId.from('d'), active: true, utilityDays: 10 }
      ],
      purchases: []
    }

    const result = calculateMonthlySettlement(input)

    expect(result.lines.map((line) => line.utilityShare.amountMinor)).toEqual([
      4044n,
      4043n,
      2609n,
      1304n
    ])
    expect(result.lines.map((line) => line.rentShare.amountMinor)).toEqual([
      17500n,
      17500n,
      17500n,
      17500n
    ])
    expect(result.totalDue.amountMinor).toBe(82000n)
  })

  test('supports weighted rent split by member weights', () => {
    const input = {
      ...fixtureBase(),
      utilitySplitMode: 'equal' as const,
      members: [
        { memberId: MemberId.from('a'), active: true, rentWeight: 3 },
        { memberId: MemberId.from('b'), active: true, rentWeight: 2 },
        { memberId: MemberId.from('c'), active: true, rentWeight: 1 }
      ],
      purchases: []
    }

    const result = calculateMonthlySettlement(input)

    expect(result.lines.map((line) => line.rentShare.amountMinor)).toEqual([35000n, 23333n, 11667n])
    expect(result.lines.map((line) => line.utilityShare.amountMinor)).toEqual([4000n, 4000n, 4000n])
    expect(result.totalDue.amountMinor).toBe(82000n)
  })

  test('5-member scenario with two purchases remains deterministic', () => {
    const input = {
      ...fixtureBase(),
      utilitySplitMode: 'equal' as const,
      members: [
        { memberId: MemberId.from('m1'), active: true },
        { memberId: MemberId.from('m2'), active: true },
        { memberId: MemberId.from('m3'), active: true },
        { memberId: MemberId.from('m4'), active: true },
        { memberId: MemberId.from('m5'), active: true }
      ],
      purchases: [
        {
          purchaseId: PurchaseEntryId.from('p1'),
          payerId: MemberId.from('m1'),
          amount: Money.fromMajor('25.00', 'USD')
        },
        {
          purchaseId: PurchaseEntryId.from('p2'),
          payerId: MemberId.from('m4'),
          amount: Money.fromMajor('41.00', 'USD')
        }
      ]
    }

    const result = calculateMonthlySettlement(input)

    expect(result.lines.map((line) => line.netDue.amountMinor)).toEqual([
      15220n,
      17720n,
      17720n,
      13620n,
      17720n
    ])
    expect(result.totalDue.amountMinor).toBe(82000n)
  })

  test('throws if weighted split is selected without valid utility days', () => {
    const input = {
      ...fixtureBase(),
      utilitySplitMode: 'weighted_by_days' as const,
      members: [
        { memberId: MemberId.from('a'), active: true, utilityDays: 31 },
        { memberId: MemberId.from('b'), active: true }
      ],
      purchases: []
    }

    expect(() => calculateMonthlySettlement(input)).toThrow(DomainError)
  })

  test('throws if purchase payer is not active', () => {
    const input = {
      ...fixtureBase(),
      utilitySplitMode: 'equal' as const,
      members: [{ memberId: MemberId.from('a'), active: true }],
      purchases: [
        {
          purchaseId: PurchaseEntryId.from('p1'),
          payerId: MemberId.from('ghost'),
          amount: Money.fromMajor('10.00', 'USD')
        }
      ]
    }

    expect(() => calculateMonthlySettlement(input)).toThrow(DomainError)
  })

  test('throws if rent split is selected with invalid rent weights', () => {
    const input = {
      ...fixtureBase(),
      utilitySplitMode: 'equal' as const,
      members: [
        { memberId: MemberId.from('a'), active: true, rentWeight: 1 },
        { memberId: MemberId.from('b'), active: true, rentWeight: 0 }
      ],
      purchases: []
    }

    expect(() => calculateMonthlySettlement(input)).toThrow(DomainError)
  })

  test('excludes away members from utilities and purchases when policy requires it', () => {
    const input = {
      ...fixtureBase(),
      utilitySplitMode: 'equal' as const,
      members: [
        { memberId: MemberId.from('resident-a'), active: true },
        { memberId: MemberId.from('resident-b'), active: true },
        {
          memberId: MemberId.from('away-member'),
          active: true,
          participatesInUtilities: false,
          participatesInPurchases: false
        }
      ],
      purchases: [
        {
          purchaseId: PurchaseEntryId.from('p1'),
          payerId: MemberId.from('resident-a'),
          amount: Money.fromMajor('30.00', 'USD')
        }
      ]
    }

    const result = calculateMonthlySettlement(input)

    expect(result.lines.map((line) => line.utilityShare.amountMinor)).toEqual([6000n, 6000n, 0n])
    expect(result.lines.map((line) => line.purchaseOffset.amountMinor)).toEqual([-1500n, 1500n, 0n])
    expect(result.lines.map((line) => line.netDue.amountMinor)).toEqual([27834n, 30833n, 23333n])
  })

  test('excludes inactive members from all future charges', () => {
    const input = {
      ...fixtureBase(),
      utilitySplitMode: 'equal' as const,
      members: [
        { memberId: MemberId.from('resident-a'), active: true },
        {
          memberId: MemberId.from('inactive-member'),
          active: true,
          participatesInRent: false,
          participatesInUtilities: false,
          participatesInPurchases: false
        }
      ],
      purchases: []
    }

    const result = calculateMonthlySettlement(input)

    expect(result.lines.map((line) => line.rentShare.amountMinor)).toEqual([70000n, 0n])
    expect(result.lines.map((line) => line.utilityShare.amountMinor)).toEqual([12000n, 0n])
    expect(result.lines.map((line) => line.netDue.amountMinor)).toEqual([82000n, 0n])
  })
})
