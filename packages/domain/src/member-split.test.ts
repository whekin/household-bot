import { expect, test } from 'bun:test'
import { Money } from './money'
import { splitEvenlyByMember } from './member-split'

test('member split assigns remainder units by stable ID for every input order', () => {
  for (const ids of [
    ['a', 'b', 'c'],
    ['b', 'a', 'c'],
    ['c', 'b', 'a'],
    ['a', 'c', 'b'],
    ['b', 'c', 'a'],
    ['c', 'a', 'b']
  ]) {
    for (const amount of [1n, 10n, 1000n, -1000n, 0n]) {
      const result = splitEvenlyByMember(Money.fromMinor(amount, 'GEL'), ids)
      const expected = splitEvenlyByMember(Money.fromMinor(amount, 'GEL'), ['a', 'b', 'c'])
      expect([...result]).toEqual([...expected])
      expect([...result.values()].reduce((n, m) => n + m.amountMinor, 0n)).toBe(amount)
    }
  }
  expect(
    [...splitEvenlyByMember(Money.fromMinor(1000n, 'GEL'), ['c', 'b', 'a'])].map(([id, m]) => [
      id,
      m.amountMinor
    ])
  ).toEqual([
    ['a', 334n],
    ['b', 333n],
    ['c', 333n]
  ])
})

test('duplicate members cannot silently lose part of an allocation', () => {
  expect(() => splitEvenlyByMember(Money.fromMinor(1000n, 'GEL'), ['a', 'a', 'b'])).toThrow(
    'unique'
  )
})
