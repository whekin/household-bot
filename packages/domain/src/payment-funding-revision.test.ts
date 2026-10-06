import { expect, test } from 'bun:test'
import {
  parsePaymentFundingContext,
  replayPaymentPurchaseFunding,
  type PaymentFundingContext
} from './payment-funding-revision'

function pricing(base: bigint, debt: bigint): PaymentFundingContext {
  return {
    policy: 'utilities',
    currency: 'GEL',
    rateMicros: '1000000',
    baseMinor: base.toString(),
    targetMinor: (base + debt).toString(),
    planId: 'issued',
    debts: [{ purchaseId: 'groceries', sourceKind: 'purchase', amountMinor: debt.toString() }]
  }
}
const receipt = (amount: bigint, context: PaymentFundingContext) => ({
  amountMinor: amount,
  currency: 'GEL' as const,
  kind: 'utilities',
  purchaseFundingContext: context
})

test('exact funding conserves purchase debt across 500 deterministic installment and correction scenarios', () => {
  for (let i = 1n; i <= 500n; i++) {
    const base = i * 17n
    const debt = i * 7n + 1n
    const first = base + debt / 3n
    const second = debt / 2n
    const context = pricing(base, debt)
    const available = new Map([['purchase:groceries', debt]])
    const total = (values: readonly ReturnType<typeof receipt>[]) =>
      replayPaymentPurchaseFunding(values, available).reduce((n, a) => n + a.amountMinor, 0n)
    const capped = (amount: bigint) =>
      amount <= base ? 0n : amount - base < debt ? amount - base : debt
    expect(total([receipt(first, context), receipt(second, context)])).toBe(capped(first + second))
    expect(total([receipt(first - i, context), receipt(second, context)])).toBe(
      capped(first - i + second)
    )
    expect(total([receipt(second, context)])).toBe(capped(second))
    expect(total([receipt(first + second + debt, context)])).toBe(debt)
    expect(total([receipt(first, context), receipt(second, context)])).toBe(
      total([receipt(first + second, context)])
    )
  }
})

test('later pricing cannot erase earlier funding, while deleting the earlier receipt restores the debt', () => {
  const old = pricing(2000n, 1000n)
  const late = pricing(4000n, 1000n)
  const available = new Map([['purchase:groceries', 1000n]])
  expect(
    replayPaymentPurchaseFunding([receipt(2500n, old), receipt(300n, late)], available)[0]
      ?.amountMinor
  ).toBe(500n)
  expect(
    replayPaymentPurchaseFunding([receipt(2400n, old), receipt(300n, late)], available)[0]
      ?.amountMinor
  ).toBe(400n)
  expect(replayPaymentPurchaseFunding([receipt(300n, late)], available)).toEqual([])
})

test('captured debt cannot consume newer purchases or exceed a debt settled by another means', () => {
  const context = pricing(100n, 200n)
  expect(
    replayPaymentPurchaseFunding(
      [receipt(1000n, context)],
      new Map([
        ['purchase:groceries', 50n],
        ['purchase:new-purchase', 10000n]
      ])
    )
  ).toEqual([{ purchaseId: 'groceries', sourceKind: 'purchase', amountMinor: 50n }])
})

test('saved pricing uses exact currency conversion and keeps separate settlement separate', () => {
  const context = { ...pricing(2000n, 1000n), rateMicros: '2700000' }
  expect(
    replayPaymentPurchaseFunding(
      [{ ...receipt(1000n, context), currency: 'USD' }],
      new Map([['purchase:groceries', 1000n]])
    )[0]?.amountMinor
  ).toBe(700n)
  expect(
    replayPaymentPurchaseFunding(
      [receipt(10000n, { ...context, policy: 'separate' })],
      new Map([['purchase:groceries', 1000n]])
    )
  ).toEqual([])
})

test('pricing rejects floating JSON money, invalid rates, and malformed references', () => {
  const context = pricing(2000n, 1000n)
  expect(parsePaymentFundingContext(context)).toEqual(context)
  for (const invalid of [
    { ...context, baseMinor: 2000 },
    { ...context, rateMicros: '0' },
    { ...context, targetMinor: '1.5' },
    { ...context, planId: 5 },
    { ...context, debts: [{ purchaseId: 'x', sourceKind: 'purchase', amountMinor: 0.1 }] }
  ]) {
    expect(parsePaymentFundingContext(invalid)).toBeUndefined()
  }
})
