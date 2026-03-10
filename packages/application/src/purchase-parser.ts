export type PurchaseParserMode = 'rules' | 'llm'

export interface ParsedPurchaseResult {
  amountMinor: bigint
  currency: 'GEL' | 'USD'
  itemDescription: string
  confidence: number
  parserMode: PurchaseParserMode
  needsReview: boolean
}

export type PurchaseParserLlmFallback = (rawText: string) => Promise<ParsedPurchaseResult | null>

export interface ParsePurchaseInput {
  rawText: string
}

export interface ParsePurchaseOptions {
  llmFallback?: PurchaseParserLlmFallback
  defaultCurrency?: 'GEL' | 'USD'
}

const CURRENCY_PATTERN = '(?:₾|gel|lari|лари|usd|\\$|доллар(?:а|ов)?)'
const AMOUNT_WITH_OPTIONAL_CURRENCY = new RegExp(
  `(?<amount>\\d+(?:[.,]\\d{1,2})?)\\s*(?<currency>${CURRENCY_PATTERN})?`,
  'giu'
)

function normalizeCurrency(raw: string | undefined): 'GEL' | 'USD' | null {
  if (!raw) {
    return null
  }

  const value = raw.trim().toLowerCase()
  if (value === '₾' || value === 'gel' || value === 'lari' || value === 'лари') {
    return 'GEL'
  }

  if (value === 'usd' || value === '$' || value.startsWith('доллар')) {
    return 'USD'
  }

  return null
}

function toMinorUnits(rawAmount: string): bigint {
  const normalized = rawAmount.replace(',', '.')
  const [wholePart, fractionalPart = ''] = normalized.split('.')
  const cents = fractionalPart.padEnd(2, '0').slice(0, 2)

  return BigInt(`${wholePart}${cents}`)
}

function normalizeDescription(rawText: string, matchedFragment: string): string {
  const cleaned = rawText.replace(matchedFragment, ' ').replace(/\s+/g, ' ').trim()

  if (cleaned.length === 0) {
    return 'shared purchase'
  }

  return cleaned
}

function parseWithRules(
  rawText: string,
  defaultCurrency: 'GEL' | 'USD'
): ParsedPurchaseResult | null {
  const matches = Array.from(rawText.matchAll(AMOUNT_WITH_OPTIONAL_CURRENCY))

  if (matches.length !== 1) {
    return null
  }

  const [match] = matches
  if (!match?.groups?.amount) {
    return null
  }

  const currency = normalizeCurrency(match.groups.currency)
  const amountMinor = toMinorUnits(match.groups.amount)

  const explicitCurrency = currency !== null
  const resolvedCurrency = currency ?? defaultCurrency
  const confidence = explicitCurrency ? 92 : 78

  return {
    amountMinor,
    currency: resolvedCurrency,
    itemDescription: normalizeDescription(rawText, match[0] ?? ''),
    confidence,
    parserMode: 'rules',
    needsReview: !explicitCurrency
  }
}

function validateLlmResult(result: ParsedPurchaseResult | null): ParsedPurchaseResult | null {
  if (!result) {
    return null
  }

  if (result.amountMinor <= 0n) {
    return null
  }

  if (result.confidence < 0 || result.confidence > 100) {
    return null
  }

  if (result.itemDescription.trim().length === 0) {
    return null
  }

  return result
}

export async function parsePurchaseMessage(
  input: ParsePurchaseInput,
  options: ParsePurchaseOptions = {}
): Promise<ParsedPurchaseResult | null> {
  const rawText = input.rawText.trim()
  if (rawText.length === 0) {
    return null
  }

  const rulesResult = parseWithRules(rawText, options.defaultCurrency ?? 'GEL')
  if (rulesResult) {
    return rulesResult
  }

  if (!options.llmFallback) {
    return null
  }

  const llmResult = await options.llmFallback(rawText)
  return validateLlmResult(llmResult)
}
