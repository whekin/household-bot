import { expect, test } from 'bun:test'
import { explicitMoneyAmounts, hasInvalidMoneyAmount } from './payment-amounts'

test.each([
  ['paid electricity 4 tetri', ['0.04']],
  ['оплатил 4 тетри', ['0.04']],
  ['paid 4 lari 70 tetri', ['4.70']],
  ['оплатил 4 лари и 70 тетри', ['4.70']],
  ['4ლარი 70თეთრი', ['4.70']],
  ['докинул 4 лари. Итого за эл-во 15.7₾', ['4.00', '15.70']],
  ['paid 15,70₾', ['15.70']],
  ['paid $175', ['175.00']]
])('keeps exact units in %s', (text, expected) => {
  expect(explicitMoneyAmounts(text).map((m) => m.toMajorString())).toEqual(expected)
})

test.each(['paid -4 GEL', 'paid ₾-4', 'paid 4.001 GEL', 'paid .5 GEL', 'paid $.5'])(
  'malformed money cannot be read as a positive amount: %s',
  (text) => {
    expect(hasInvalidMoneyAmount(text)).toBe(true)
    expect(explicitMoneyAmounts(text)).toEqual([])
  }
)
