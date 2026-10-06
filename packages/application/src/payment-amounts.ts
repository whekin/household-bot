import { Money, type CurrencyCode } from '@household/domain'

const majorUnits = 'usd|dollars?|gel|lari|лари|лар|ლარი|ლარ|₾|\\$'
const minorUnits = 'tetri|тетри|თეთრი'
const number = '\\d+(?:[.,]\\d{1,2})?'

export function hasExplicitMoneyUnit(text: string): boolean {
  return new RegExp(`(?<!\\p{L})(?:${majorUnits}|${minorUnits})(?!\\p{L})`, 'iu').test(text)
}

export function hasInvalidMoneyAmount(text: string): boolean {
  return /\d[.,]\d{3,}|(?:^|[\s$₾])[.,]\d|(?:^|[^\p{L}\p{N}_])-\s*(?:[$₾]\s*)?\d|[$₾]\s*-\s*\d/iu.test(
    text
  )
}

/** Explicit currency/minor-unit expressions; compound lari + tetri stays one amount. */
export function explicitMoneyAmounts(text: string): readonly Money[] {
  if (hasInvalidMoneyAmount(text)) return []
  const found: { start: number; end: number; amount: Money }[] = []
  const add = (match: RegExpMatchArray, amount: Money) => {
    const start = match.index!
    const end = start + match[0].length
    if (!found.some((p) => start < p.end && end > p.start)) found.push({ start, end, amount })
  }
  const compound = new RegExp(
    `(?<![\\d.,])(\\d+)\\s*(?:gel|lari|лари|лар|ლარი|ლარ)(?!\\p{L})\\s*(?:(?:и|and)\\s*)?(\\d+)\\s*(?:${minorUnits})(?!\\p{L})`,
    'giu'
  )
  for (const match of text.matchAll(compound))
    add(match, Money.fromMajor(match[1]!, 'GEL').add(Money.fromMinor(match[2]!, 'GEL')))
  const minor = new RegExp(`(?<![\\d.,])(${number})\\s*(?:${minorUnits})(?!\\p{L})`, 'giu')
  for (const match of text.matchAll(minor)) {
    const value = match[1]!.replace(',', '.')
    if (value.includes('.') && !/^\d+\.0{1,2}$/.test(value)) continue
    add(match, Money.fromMinor(value.split('.')[0]!, 'GEL'))
  }
  const currency = (unit: string): CurrencyCode =>
    /^(usd|dollars?|\$)$/iu.test(unit) ? 'USD' : 'GEL'
  const suffix = new RegExp(`(?<![\\d.,])(${number})\\s*(${majorUnits})(?![\\p{L}\\p{N}_])`, 'giu')
  for (const match of text.matchAll(suffix))
    add(match, Money.fromMajor(match[1]!.replace(',', '.'), currency(match[2]!)))
  const prefix = new RegExp(`(?<![\\p{L}\\p{N}])(${majorUnits})\\s*(${number})(?![\\d.,])`, 'giu')
  for (const match of text.matchAll(prefix))
    add(match, Money.fromMajor(match[2]!.replace(',', '.'), currency(match[1]!)))
  return found.sort((a, b) => a.start - b.start).map((p) => p.amount)
}
