import { Money, type CurrencyCode } from '@household/domain'
import type { FinancePaymentKind, FinancePaymentConfirmationReviewReason } from '@household/ports'
import {
  explicitMoneyAmounts,
  hasExplicitMoneyUnit,
  hasInvalidMoneyAmount
} from './payment-amounts'

export interface ParsedPaymentConfirmation {
  normalizedText: string
  kind: FinancePaymentKind | null
  explicitAmount: Money | null
  reviewReason: FinancePaymentConfirmationReviewReason | null
}

const rentKeywords = [/\b(rent|housing|apartment|landlord)\b/i, /жиль[еёя]/i, /аренд/i] as const

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

const completedPaymentIntentKeywords = [
  /\b(paid|sent|done|transferred)\b/i,
  /оплатил[аи]?/i,
  /оплачен[аоы]?/i,
  /закинул[аи]?/i,
  /перев[её]л[аи]?/i,
  /перевела/i,
  /скинул[аи]?/i,
  /отправил[аи]?/i,
  /готово/i
] as const

const paymentIntentKeywords = [
  ...completedPaymentIntentKeywords,
  /\b(pay|transfer)\b/i,
  /оплат/i,
  /оплач/i
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

/** A routing hint; completed payment classification still happens in payment ingestion. */
export function hasCompletedPaymentCaption(rawText: string): boolean {
  return hasMatch(completedPaymentIntentKeywords, rawText)
}

function parseExplicitAmount(rawText: string, defaultCurrency: CurrencyCode): Money | null {
  const amounts = explicitMoneyAmounts(rawText)
  if (amounts.length > 0) return amounts[0]!
  if (hasExplicitMoneyUnit(rawText)) return null

  const bareAmountMatch = rawText.match(/(?:^|[^\d.,])(\d+(?:[.,]\d{1,2})?)(?![\d.,])(?:\s|$)/)
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
  if (hasInvalidMoneyAmount(normalizedText)) {
    return { normalizedText, kind: null, explicitAmount: null, reviewReason: 'invalid_amount' }
  }

  const explicit = explicitMoneyAmounts(normalizedText)
  if (explicit.length > 1)
    return { normalizedText, kind: null, explicitAmount: null, reviewReason: 'amount_ambiguous' }
  if (hasExplicitMoneyUnit(normalizedText) && /\d/.test(normalizedText) && explicit.length === 0)
    return { normalizedText, kind: null, explicitAmount: null, reviewReason: 'invalid_amount' }

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
