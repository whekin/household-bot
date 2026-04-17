import {
  buildMemberPaymentGuidance,
  parsePaymentConfirmationMessage,
  type FinanceCommandService,
  type MemberPaymentGuidance
} from '@household/application'
import { Money } from '@household/domain'
import type { HouseholdConfigurationRepository } from '@household/ports'

import { getBotTranslations, type BotLocale } from './i18n'

const RENT_BALANCE_KEYWORDS = [
  /\b(rent|housing|apartment|landlord)\b/i,
  /аренд/i,
  /жиль[еёя]/i
]
const UTILITIES_BALANCE_KEYWORDS = [
  /\b(utilities|utility|gas|water|electricity|internet|cleaning)\b/i,
  /коммун/i,
  /газ/i,
  /вод/i,
  /элект/i,
  /свет/i,
  /интернет/i,
  /уборк/i
]
const BALANCE_QUESTION_KEYWORDS = [
  /\?/,
  /\b(how much|owe|due|balance|remaining)\b/i,
  /сколько/i,
  /долж/i,
  /баланс/i,
  /остат/i
]

export interface PaymentProposalPayload {
  proposalId: string
  householdId: string
  memberId: string
  kind: 'rent' | 'utilities'
  amountMinor: string
  currency: 'GEL' | 'USD'
}

export interface PaymentProposalBreakdown {
  guidance: MemberPaymentGuidance
  explicitAmount: Money | null
}

export interface PaymentBalanceReply {
  kind: 'rent' | 'utilities'
  guidance: MemberPaymentGuidance
}

export function parsePaymentProposalPayload(
  payload: Record<string, unknown>
): PaymentProposalPayload | null {
  if (
    typeof payload.proposalId !== 'string' ||
    typeof payload.householdId !== 'string' ||
    typeof payload.memberId !== 'string' ||
    (payload.kind !== 'rent' && payload.kind !== 'utilities') ||
    typeof payload.amountMinor !== 'string' ||
    (payload.currency !== 'USD' && payload.currency !== 'GEL')
  ) {
    return null
  }

  if (!/^[0-9]+$/.test(payload.amountMinor)) {
    return null
  }

  return {
    proposalId: payload.proposalId,
    householdId: payload.householdId,
    memberId: payload.memberId,
    kind: payload.kind,
    amountMinor: payload.amountMinor,
    currency: payload.currency
  }
}

function hasMatch(patterns: readonly RegExp[], value: string): boolean {
  return patterns.some((pattern) => pattern.test(value))
}

function detectBalanceQuestionKind(rawText: string): 'rent' | 'utilities' | null {
  const normalized = rawText.trim()
  if (normalized.length === 0 || !hasMatch(BALANCE_QUESTION_KEYWORDS, normalized)) {
    return null
  }

  const mentionsRent = hasMatch(RENT_BALANCE_KEYWORDS, normalized)
  const mentionsUtilities = hasMatch(UTILITIES_BALANCE_KEYWORDS, normalized)

  if (mentionsRent === mentionsUtilities) {
    return null
  }

  return mentionsRent ? 'rent' : 'utilities'
}

function formatDateLabel(locale: BotLocale, rawDate: string): string {
  const [yearRaw, monthRaw, dayRaw] = rawDate.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  const day = Number(dayRaw)

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return rawDate
  }

  return new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-US', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC'
  }).format(new Date(Date.UTC(year, month - 1, day)))
}

function formatPaymentBreakdown(locale: BotLocale, breakdown: PaymentProposalBreakdown): string {
  const t = getBotTranslations(locale).payments
  const policyLabel = t.adjustmentPolicy(breakdown.guidance.adjustmentPolicy)
  const lines = [
    t.breakdownBase(
      breakdown.guidance.kind,
      breakdown.guidance.baseAmount.toMajorString(),
      breakdown.guidance.baseAmount.currency
    ),
    t.breakdownPurchaseBalance(
      breakdown.guidance.purchaseOffset.toMajorString(),
      breakdown.guidance.purchaseOffset.currency
    ),
    t.breakdownSuggestedTotal(
      breakdown.guidance.proposalAmount.toMajorString(),
      breakdown.guidance.proposalAmount.currency,
      policyLabel
    ),
    t.breakdownRemaining(
      breakdown.guidance.totalRemaining.toMajorString(),
      breakdown.guidance.totalRemaining.currency
    )
  ]

  if (
    breakdown.explicitAmount &&
    !breakdown.explicitAmount.equals(breakdown.guidance.proposalAmount)
  ) {
    lines.push(
      t.breakdownRecordingAmount(
        breakdown.explicitAmount.toMajorString(),
        breakdown.explicitAmount.currency
      )
    )
  }

  if (!breakdown.guidance.paymentWindowOpen) {
    lines.push(
      t.timingBeforeWindow(
        breakdown.guidance.kind,
        formatDateLabel(locale, breakdown.guidance.reminderDate),
        formatDateLabel(locale, breakdown.guidance.dueDate)
      )
    )
  } else if (breakdown.guidance.paymentDue) {
    lines.push(
      t.timingDueNow(breakdown.guidance.kind, formatDateLabel(locale, breakdown.guidance.dueDate))
    )
  }

  return lines.join('\n')
}

function shouldUseCompactTopicProposal(input: {
  surface: 'assistant' | 'topic'
  breakdown: PaymentProposalBreakdown
}): boolean {
  if (input.surface !== 'topic') {
    return false
  }

  if (input.breakdown.guidance.kind !== 'rent') {
    return false
  }

  if (input.breakdown.guidance.adjustmentPolicy !== 'utilities') {
    return false
  }

  return (
    input.breakdown.explicitAmount === null ||
    input.breakdown.explicitAmount.equals(input.breakdown.guidance.proposalAmount)
  )
}

export function formatPaymentProposalText(input: {
  locale: BotLocale
  surface: 'assistant' | 'topic'
  proposal: {
    payload: PaymentProposalPayload
    breakdown: PaymentProposalBreakdown
  }
}): string {
  const amount = Money.fromMinor(
    BigInt(input.proposal.payload.amountMinor),
    input.proposal.payload.currency
  )
  const intro =
    input.surface === 'assistant'
      ? getBotTranslations(input.locale).assistant.paymentProposal(
          input.proposal.payload.kind,
          amount.toMajorString(),
          amount.currency
        )
      : getBotTranslations(input.locale).payments.proposal(
          input.proposal.payload.kind,
          amount.toMajorString(),
          amount.currency
        )

  if (
    shouldUseCompactTopicProposal({
      surface: input.surface,
      breakdown: input.proposal.breakdown
    })
  ) {
    return intro
  }

  return `${intro}\n\n${formatPaymentBreakdown(input.locale, input.proposal.breakdown)}`
}

export function formatPaymentBalanceReplyText(
  locale: BotLocale,
  reply: PaymentBalanceReply
): string {
  const t = getBotTranslations(locale).payments

  return [
    t.balanceReply(reply.kind),
    formatPaymentBreakdown(locale, {
      guidance: reply.guidance,
      explicitAmount: null
    })
  ].join('\n\n')
}

export async function maybeCreatePaymentProposal(input: {
  rawText: string
  householdId: string
  memberId: string
  financeService: FinanceCommandService
  householdConfigurationRepository: HouseholdConfigurationRepository
}): Promise<
  | {
      status: 'no_intent'
    }
  | {
      status: 'clarification'
    }
  | {
      status: 'unsupported_currency'
    }
  | {
      status: 'no_balance'
    }
  | {
      status: 'proposal'
      payload: PaymentProposalPayload
      breakdown: PaymentProposalBreakdown
    }
> {
  const settings = await input.householdConfigurationRepository.getHouseholdBillingSettings(
    input.householdId
  )
  const parsed = parsePaymentConfirmationMessage(input.rawText, settings.settlementCurrency)

  if (!parsed.kind && parsed.reviewReason === 'intent_missing') {
    return {
      status: 'no_intent'
    }
  }

  if (!parsed.kind || parsed.reviewReason) {
    return {
      status: 'clarification'
    }
  }

  const dashboard = await input.financeService.generateDashboard()
  if (!dashboard) {
    return {
      status: 'clarification'
    }
  }

  const memberLine = dashboard.members.find((line) => line.memberId === input.memberId)
  if (!memberLine) {
    return {
      status: 'clarification'
    }
  }

  if (parsed.explicitAmount && parsed.explicitAmount.currency !== dashboard.currency) {
    return {
      status: 'unsupported_currency'
    }
  }

  const guidance = buildMemberPaymentGuidance({
    kind: parsed.kind,
    period: dashboard.period,
    memberLine,
    settings
  })
  const amount = parsed.explicitAmount ?? guidance.proposalAmount

  if (amount.amountMinor <= 0n) {
    return {
      status: 'no_balance'
    }
  }

  return {
    status: 'proposal',
    payload: {
      proposalId: crypto.randomUUID(),
      householdId: input.householdId,
      memberId: input.memberId,
      kind: parsed.kind,
      amountMinor: amount.amountMinor.toString(),
      currency: amount.currency
    },
    breakdown: {
      guidance,
      explicitAmount: parsed.explicitAmount
    }
  }
}

export async function maybeCreatePaymentBalanceReply(input: {
  rawText: string
  householdId: string
  memberId: string
  financeService: FinanceCommandService
  householdConfigurationRepository: HouseholdConfigurationRepository
}): Promise<PaymentBalanceReply | null> {
  const kind = detectBalanceQuestionKind(input.rawText)
  if (!kind) {
    return null
  }

  const [settings, dashboard] = await Promise.all([
    input.householdConfigurationRepository.getHouseholdBillingSettings(input.householdId),
    input.financeService.generateDashboard()
  ])
  if (!dashboard) {
    return null
  }

  const memberLine = dashboard.members.find((line) => line.memberId === input.memberId)
  if (!memberLine) {
    return null
  }

  return {
    kind,
    guidance: buildMemberPaymentGuidance({
      kind,
      period: dashboard.period,
      memberLine,
      settings
    })
  }
}

export function synthesizePaymentConfirmationText(payload: PaymentProposalPayload): string {
  const amount = Money.fromMinor(BigInt(payload.amountMinor), payload.currency)
  const kindText = payload.kind === 'rent' ? 'rent' : 'utilities'

  return `paid ${kindText} ${amount.toMajorString()} ${amount.currency}`
}
