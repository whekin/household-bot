import { Money, type CurrencyCode } from '@household/domain'
import type { FinancePaymentKind, FinancePaymentConfirmationReviewReason } from '@household/ports'

export interface ParsedPaymentConfirmation {
  normalizedText: string
  kind: FinancePaymentKind | null
  explicitAmount: Money | null
  reviewReason: FinancePaymentConfirmationReviewReason | null
}

const rentKeywords = [/\b(rent|housing|apartment|landlord)\b/i, /жиль[её]/i, /аренд/i] as const

const utilityKeywords = [
  /\b(utilities|utility|gas|water|electricity|internet|cleaning)\b/i,
  /коммун/i,
  /газ/i,
  /вод/i,
  /элект/i,
  /свет/i,
  /интернет/i,
  /уборк/i
] as const

const paymentIntentKeywords = [
  /\b(paid|pay|sent|done|transfer(red)?)\b/i,
  /оплат/i,
  /закинул/i,
  /закину/i,
  /перев[её]л/i,
  /перевела/i,
  /скинул/i,
  /скинула/i,
  /отправил/i,
  /отправила/i,
  /готово/i
] as const

const multiMemberKeywords = [
  /за\s+двоих/i,
  /\bfor\s+two\b/i,
  /за\s+.*\s+и\s+себя/i,
  /за\s+.*\s+и\s+меня/i
] as const

function hasMatch(patterns: readonly RegExp[], value: string): boolean {
  return patterns.some((pattern) => pattern.test(value))
}

function parseExplicitAmount(rawText: string, defaultCurrency: CurrencyCode): Money | null {
  const symbolMatch = rawText.match(/(?:^|[^\d])(\$|₾)\s*(\d+(?:[.,]\d{1,2})?)/i)
  if (symbolMatch) {
    const currency = symbolMatch[1] === '$' ? 'USD' : 'GEL'
    return Money.fromMajor(symbolMatch[2]!.replace(',', '.'), currency)
  }

  const suffixMatch = rawText.match(/(\d+(?:[.,]\d{1,2})?)\s*(usd|gel|лари|лар|ლარი|ლარ|₾|\$)\b/i)
  if (suffixMatch) {
    const rawCurrency = suffixMatch[2]!.toUpperCase()
    const currency = rawCurrency === 'USD' || rawCurrency === '$' ? 'USD' : 'GEL'

    return Money.fromMajor(suffixMatch[1]!.replace(',', '.'), currency)
  }

  const bareAmountMatch = rawText.match(/(?:^|[^\d])(\d+(?:[.,]\d{1,2})?)(?:\s|$)/)
  if (!bareAmountMatch) {
    return null
  }

  return Money.fromMajor(bareAmountMatch[1]!.replace(',', '.'), defaultCurrency)
}

export function parsePaymentConfirmationMessage(
  rawText: string,
  defaultCurrency: CurrencyCode
): ParsedPaymentConfirmation {
  const normalizedText = rawText.trim().replaceAll(/\s+/g, ' ')
  const lowercase = normalizedText.toLowerCase()

  if (normalizedText.length === 0) {
    return {
      normalizedText,
      kind: null,
      explicitAmount: null,
      reviewReason: 'intent_missing'
    }
  }

  if (hasMatch(multiMemberKeywords, lowercase)) {
    return {
      normalizedText,
      kind: null,
      explicitAmount: parseExplicitAmount(normalizedText, defaultCurrency),
      reviewReason: 'multiple_members'
    }
  }

  if (!hasMatch(paymentIntentKeywords, lowercase)) {
    return {
      normalizedText,
      kind: null,
      explicitAmount: parseExplicitAmount(normalizedText, defaultCurrency),
      reviewReason: 'intent_missing'
    }
  }

  const matchesRent = hasMatch(rentKeywords, lowercase)
  const matchesUtilities = hasMatch(utilityKeywords, lowercase)
  const explicitAmount = parseExplicitAmount(normalizedText, defaultCurrency)

  if (matchesRent && matchesUtilities) {
    return {
      normalizedText,
      kind: null,
      explicitAmount,
      reviewReason: 'kind_ambiguous'
    }
  }

  if (matchesRent) {
    return {
      normalizedText,
      kind: 'rent',
      explicitAmount,
      reviewReason: null
    }
  }

  if (matchesUtilities) {
    return {
      normalizedText,
      kind: 'utilities',
      explicitAmount,
      reviewReason: null
    }
  }

  return {
    normalizedText,
    kind: null,
    explicitAmount,
    reviewReason: 'kind_ambiguous'
  }
}
