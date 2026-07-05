import {
  buildMemberPaymentGuidance,
  parsePaymentConfirmationMessage,
  type FinanceCommandService,
  type MemberPaymentGuidance
} from '@household/application'
import { convertMoney, Money } from '@household/domain'
import type {
  FinanceMemberRecord,
  FinancePaymentKind,
  HouseholdConfigurationRepository
} from '@household/ports'

import { getBotTranslations, type BotLocale } from './i18n'
import { formatUserFacingMoney } from './i18n/money'

const RENT_BALANCE_KEYWORDS = [
  /\b(rent|housing|apartment|landlord)\b/i,
  /аренд/i,
  /жиль[еёя]/i,
  /квартир/i,
  /хозяин/i
]
const UTILITIES_BALANCE_KEYWORDS = [
  /\b(utilities|utility|gas|water|electricity|internet|cleaning)\b/i,
  /коммун/i,
  /газ/i,
  /вод/i,
  /элект/i,
  /свет/i,
  /интернет/i,
  /уборк/i,
  /услуг/i,
  /провайдер/i
]
const BALANCE_QUESTION_KEYWORDS = [
  /\?/,
  /\b(how much|where|which|what|owe|due|balance|remaining)\b/i,
  /сколько/i,
  /долж/i,
  /баланс/i,
  /остат/i,
  /куда/i,
  /какие/i,
  /ч[её]/i
]
const CYRILLIC_NAME_ALIASES: ReadonlyMap<string, readonly string[]> = new Map([
  ['alisa', ['алиса', 'алису']],
  ['alice', ['алиса', 'алису']],
  ['dima', ['дима', 'диму']],
  ['stas', ['стас']]
])

export interface PaymentProposalPayload {
  proposalId: string
  householdId: string
  memberId: string
  kind: 'rent' | 'utilities'
  period?: string
  amountMinor: string
  currency: 'GEL' | 'USD'
  reporterTelegramUserId?: string
  reportedTelegramUserId?: string | null
  reportedDisplayName?: string | null
  isThirdParty?: boolean
}

export interface PaymentProposalBreakdown {
  guidance: MemberPaymentGuidance
  explicitAmount: Money | null
}

export interface PaymentBalanceReply {
  kind: 'rent' | 'utilities'
  guidance: MemberPaymentGuidance
  categoryLines?: readonly string[]
}

export interface MultiMemberPaymentProposalMember {
  memberId: string
  telegramUserId: string
  displayName: string
  paymentStatus: 'paid' | 'unpaid'
  amountMinor: string
  currency: 'GEL' | 'USD'
  selected: boolean
}

export interface MultiMemberPaymentProposal {
  proposalId: string
  householdId: string
  kind: FinancePaymentKind
  period: string
  members: readonly MultiMemberPaymentProposalMember[]
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
    ...(typeof payload.period === 'string' ? { period: payload.period } : {}),
    amountMinor: payload.amountMinor,
    currency: payload.currency,
    ...(typeof payload.reporterTelegramUserId === 'string'
      ? {
          reporterTelegramUserId: payload.reporterTelegramUserId
        }
      : {}),
    ...(typeof payload.reportedTelegramUserId === 'string' ||
    payload.reportedTelegramUserId === null
      ? {
          reportedTelegramUserId:
            typeof payload.reportedTelegramUserId === 'string'
              ? payload.reportedTelegramUserId
              : null
        }
      : {}),
    ...(typeof payload.reportedDisplayName === 'string' || payload.reportedDisplayName === null
      ? {
          reportedDisplayName:
            typeof payload.reportedDisplayName === 'string' ? payload.reportedDisplayName : null
        }
      : {}),
    ...(typeof payload.isThirdParty === 'boolean'
      ? {
          isThirdParty: payload.isThirdParty
        }
      : {})
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

function looksLikeReceiptPaidCaption(rawText: string): boolean {
  return /(?:^|[^\p{L}])оплачен[аоы]?(?=$|[^\p{L}])/iu.test(rawText)
}

function normalizeNameToken(value: string): string {
  return value
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim()
}

function memberAliases(member: FinanceMemberRecord): readonly string[] {
  const normalized = normalizeNameToken(member.displayName)
  if (!normalized) {
    return []
  }

  const first = normalized.split(' ')[0] ?? normalized
  const aliases = new Set([normalized, first])
  for (const value of [normalized, first]) {
    for (const alias of CYRILLIC_NAME_ALIASES.get(value) ?? []) {
      aliases.add(alias)
    }
    if (/[а-я]$/u.test(value)) {
      if (value.endsWith('а')) aliases.add(`${value.slice(0, -1)}у`)
      if (value.endsWith('я')) aliases.add(`${value.slice(0, -1)}ю`)
    }
  }

  return [...aliases].filter((alias) => alias.length > 1)
}

function textHasToken(normalizedText: string, token: string): boolean {
  return new RegExp(`(?:^|\\s)${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`, 'iu').test(
    normalizedText
  )
}

function resolveMentionedMembers(input: {
  rawText: string
  members: readonly FinanceMemberRecord[]
  senderMemberId: string
}): readonly FinanceMemberRecord[] | null {
  const normalized = normalizeNameToken(input.rawText)
  const matched = new Map<string, FinanceMemberRecord>()
  const ambiguousAliases = new Set<string>()
  const selfPattern = /(?:^|\s)(себя|сам|сама|меня|me|myself)(?:\s|$)/iu

  if (selfPattern.test(normalized)) {
    const sender = input.members.find((member) => member.id === input.senderMemberId)
    if (sender) {
      matched.set(sender.id, sender)
    }
  }

  const aliasOwners = new Map<string, FinanceMemberRecord[]>()
  for (const member of input.members) {
    for (const alias of memberAliases(member)) {
      aliasOwners.set(alias, [...(aliasOwners.get(alias) ?? []), member])
    }
  }

  for (const [alias, owners] of aliasOwners.entries()) {
    if (!textHasToken(normalized, alias)) {
      continue
    }
    if (owners.length !== 1) {
      ambiguousAliases.add(alias)
      continue
    }
    matched.set(owners[0]!.id, owners[0]!)
  }

  if (ambiguousAliases.size > 0 || matched.size < 2) {
    return null
  }

  return [...matched.values()]
}

function hasPerPersonAmount(rawText: string): boolean {
  return /(?:^|[^\p{L}])(?:по|each|per\s+person)(?=$|[^\p{L}])/iu.test(rawText)
}

function shortProposalId(): string {
  return crypto.randomUUID().replaceAll('-', '').slice(0, 16)
}

function inferActivePaymentKind(input: {
  dashboard: Awaited<ReturnType<FinanceCommandService['generateDashboard']>>
  memberIds: readonly string[]
  settings: Parameters<typeof buildMemberPaymentGuidance>[0]['settings']
}): FinancePaymentKind | null {
  const dashboard = input.dashboard
  if (!dashboard) {
    return null
  }

  const memberIds = new Set(input.memberIds)
  const currentPeriod = dashboard.paymentPeriods?.find(
    (period) => period.isCurrentPeriod || period.period === dashboard.period
  )
  const unresolvedKinds =
    currentPeriod?.kinds
      .filter(
        (kindSummary) =>
          kindSummary.totalRemaining.amountMinor > 0n &&
          kindSummary.unresolvedMembers.some((member) => memberIds.has(member.memberId))
      )
      .map((kindSummary) => kindSummary.kind) ?? []

  if (unresolvedKinds.length === 1) {
    return unresolvedKinds[0]!
  }

  if (dashboard.billingStage === 'rent' || dashboard.billingStage === 'utilities') {
    return dashboard.billingStage
  }

  const payableKinds: FinancePaymentKind[] = []
  for (const kind of ['rent', 'utilities'] as const) {
    const hasPayableMember = dashboard.members
      .filter((member) => memberIds.has(member.memberId))
      .some(
        (memberLine) =>
          buildMemberPaymentGuidance({
            kind,
            period: dashboard.period,
            memberLine,
            settings: input.settings,
            paymentKindSummary: currentKindSummary({ dashboard, period: dashboard.period, kind })
          }).proposalAmount.amountMinor > 0n
      )
    if (hasPayableMember) {
      payableKinds.push(kind)
    }
  }

  return payableKinds.length === 1 ? payableKinds[0]! : null
}

function currentKindSummary(input: {
  dashboard: NonNullable<Awaited<ReturnType<FinanceCommandService['generateDashboard']>>>
  period: string
  kind: FinancePaymentKind
}) {
  return (
    input.dashboard.paymentPeriods
      ?.find((period) => period.period === input.period)
      ?.kinds.find((kindSummary) => kindSummary.kind === input.kind) ?? null
  )
}

function findPaymentPeriodKindSummary(input: {
  dashboard: NonNullable<Awaited<ReturnType<FinanceCommandService['generateDashboard']>>>
  period: string
  kind: FinancePaymentKind
}) {
  const periodSummary = input.dashboard.paymentPeriods?.find(
    (period) => period.period === input.period
  )

  return periodSummary?.kinds.find((kindSummary) => kindSummary.kind === input.kind) ?? null
}

function isMemberUnpaidForKind(input: {
  dashboard: NonNullable<Awaited<ReturnType<FinanceCommandService['generateDashboard']>>>
  period: string
  kind: FinancePaymentKind
  memberId: string
  fallbackAmount: Money
}): boolean {
  const kindSummary = findPaymentPeriodKindSummary(input)
  if (kindSummary) {
    return kindSummary.unresolvedMembers.some((member) => member.memberId === input.memberId)
  }

  return input.fallbackAmount.amountMinor > 0n
}

function inferSinglePayableKind(input: {
  rawText: string
  period: string
  memberLine: Parameters<typeof buildMemberPaymentGuidance>[0]['memberLine']
  settings: Parameters<typeof buildMemberPaymentGuidance>[0]['settings']
}): 'rent' | 'utilities' | null {
  if (!looksLikeReceiptPaidCaption(input.rawText)) {
    return null
  }

  const rentGuidance = buildMemberPaymentGuidance({
    kind: 'rent',
    period: input.period,
    memberLine: input.memberLine,
    settings: input.settings
  })
  const utilitiesGuidance = buildMemberPaymentGuidance({
    kind: 'utilities',
    period: input.period,
    memberLine: input.memberLine,
    settings: input.settings
  })
  const payableKinds = [rentGuidance, utilitiesGuidance]
    .filter((guidance) => guidance.proposalAmount.amountMinor > 0n)
    .map((guidance) => guidance.kind)

  return payableKinds.length === 1 ? payableKinds[0]! : null
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
  const lines =
    breakdown.guidance.source === 'payment_period'
      ? [
          t.breakdownPlannedBase(
            breakdown.guidance.kind,
            breakdown.guidance.baseAmount.toMajorString(),
            breakdown.guidance.baseAmount.currency
          ),
          t.breakdownRemaining(
            breakdown.guidance.totalRemaining.toMajorString(),
            breakdown.guidance.totalRemaining.currency
          )
        ]
      : [
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

  if (input.breakdown.guidance.source === 'payment_period') {
    return (
      input.breakdown.explicitAmount === null ||
      input.breakdown.explicitAmount.equals(input.breakdown.guidance.proposalAmount)
    )
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
      : input.proposal.payload.isThirdParty && input.proposal.payload.reportedDisplayName
        ? getBotTranslations(input.locale).payments.proposalReported(
            input.proposal.payload.reportedDisplayName,
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

  const lines = [
    t.balanceReply(reply.kind),
    formatPaymentBreakdown(locale, {
      guidance: reply.guidance,
      explicitAmount: null
    })
  ]

  if (reply.categoryLines && reply.categoryLines.length > 0) {
    lines.push(
      [
        locale === 'ru' ? 'По услугам:' : 'By service:',
        ...reply.categoryLines.map((line) => `• ${line}`)
      ].join('\n')
    )
  }

  return lines.join('\n\n')
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
      status: 'already_settled'
      kind: 'rent' | 'utilities'
    }
  | {
      status: 'multi_member_proposal'
      proposal: MultiMemberPaymentProposal
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

  const members = await input.financeService.listMembers()
  const mentionedMembers = resolveMentionedMembers({
    rawText: input.rawText,
    members,
    senderMemberId: input.memberId
  })

  if (mentionedMembers) {
    if (parsed.explicitAmount && !hasPerPersonAmount(parsed.normalizedText)) {
      return {
        status: 'clarification'
      }
    }

    const inferredKind = parsed.kind
      ? parsed.kind
      : inferActivePaymentKind({
          dashboard,
          memberIds: mentionedMembers.map((member) => member.id),
          settings
        })

    if (!inferredKind) {
      return {
        status: 'clarification'
      }
    }

    if (parsed.explicitAmount && parsed.explicitAmount.currency !== dashboard.currency) {
      return {
        status: 'unsupported_currency'
      }
    }

    const proposalMembers = mentionedMembers
      .map((member): MultiMemberPaymentProposalMember | null => {
        const line = dashboard.members.find((candidate) => candidate.memberId === member.id)
        if (!line) {
          return null
        }
        const guidance = buildMemberPaymentGuidance({
          kind: inferredKind,
          period: dashboard.period,
          memberLine: line,
          settings,
          paymentKindSummary: currentKindSummary({
            dashboard,
            period: dashboard.period,
            kind: inferredKind
          })
        })
        const amount = parsed.explicitAmount ?? guidance.proposalAmount
        const unpaid = isMemberUnpaidForKind({
          dashboard,
          period: dashboard.period,
          kind: inferredKind,
          memberId: member.id,
          fallbackAmount: guidance.proposalAmount
        })

        return {
          memberId: member.id,
          telegramUserId: member.telegramUserId,
          displayName: member.displayName,
          paymentStatus: unpaid ? 'unpaid' : 'paid',
          amountMinor: unpaid ? amount.amountMinor.toString() : '0',
          currency: unpaid ? amount.currency : dashboard.currency,
          selected: unpaid
        }
      })
      .filter((member): member is MultiMemberPaymentProposalMember => member !== null)

    if (proposalMembers.length < 2) {
      return {
        status: 'clarification'
      }
    }

    if (!proposalMembers.some((member) => member.paymentStatus === 'unpaid')) {
      return {
        status: 'already_settled',
        kind: inferredKind
      }
    }

    return {
      status: 'multi_member_proposal',
      proposal: {
        proposalId: shortProposalId(),
        householdId: input.householdId,
        kind: inferredKind,
        period: dashboard.period,
        members: proposalMembers
      }
    }
  }

  const inferredKind =
    !parsed.kind && parsed.reviewReason === 'kind_ambiguous'
      ? inferSinglePayableKind({
          rawText: parsed.normalizedText,
          period: dashboard.period,
          memberLine,
          settings
        })
      : null
  const kind = parsed.kind ?? inferredKind

  if (!kind || (parsed.reviewReason && !inferredKind)) {
    return {
      status: 'clarification'
    }
  }

  if (memberLine.remaining.amountMinor <= 0n) {
    return {
      status: 'already_settled',
      kind
    }
  }

  if (parsed.explicitAmount && parsed.explicitAmount.currency !== dashboard.currency) {
    return {
      status: 'unsupported_currency'
    }
  }

  const guidance = buildMemberPaymentGuidance({
    kind,
    period: dashboard.period,
    memberLine,
    settings,
    paymentKindSummary: currentKindSummary({ dashboard, period: dashboard.period, kind })
  })
  if (
    !isMemberUnpaidForKind({
      dashboard,
      period: dashboard.period,
      kind,
      memberId: input.memberId,
      fallbackAmount: guidance.proposalAmount
    })
  ) {
    return {
      status: 'already_settled',
      kind
    }
  }
  const amount = parsed.explicitAmount ?? guidance.proposalAmount

  if (amount.amountMinor <= 0n) {
    return {
      status: 'already_settled',
      kind
    }
  }

  return {
    status: 'proposal',
    payload: {
      proposalId: crypto.randomUUID(),
      householdId: input.householdId,
      memberId: input.memberId,
      kind,
      period: dashboard.period,
      amountMinor: amount.amountMinor.toString(),
      currency: amount.currency
    },
    breakdown: {
      guidance,
      explicitAmount: parsed.explicitAmount
    }
  }
}

export type AgentPaymentProposalResult =
  | {
      status: 'no_action'
      reason: string
    }
  | {
      status: 'unsupported_currency'
    }
  | {
      status: 'already_settled'
      kind: 'rent' | 'utilities'
    }
  | {
      status: 'multi_member_proposal'
      proposal: MultiMemberPaymentProposal
    }
  | {
      status: 'proposal'
      payload: PaymentProposalPayload
      breakdown: PaymentProposalBreakdown
    }

export async function createAgentPaymentProposal(input: {
  householdId: string
  payerMemberId: string
  additionalMemberIds: readonly string[]
  kind: FinancePaymentKind | null
  explicitAmount: Money | null
  perMemberAmount: Money | null
  financeService: FinanceCommandService
  householdConfigurationRepository: HouseholdConfigurationRepository
}): Promise<AgentPaymentProposalResult> {
  const [settings, dashboard, members] = await Promise.all([
    input.householdConfigurationRepository.getHouseholdBillingSettings(input.householdId),
    input.financeService.generateDashboard(),
    input.financeService.listMembers()
  ])

  if (!dashboard) {
    return { status: 'no_action', reason: 'no_open_billing_cycle' }
  }

  const targetMemberIds = [...new Set([input.payerMemberId, ...input.additionalMemberIds])]
  const targetMembers = targetMemberIds.map((memberId) =>
    members.find((member) => member.id === memberId)
  )
  if (targetMembers.some((member) => member === undefined)) {
    return { status: 'no_action', reason: 'unknown_member_id' }
  }

  const kind =
    input.kind ??
    inferActivePaymentKind({
      dashboard,
      memberIds: targetMemberIds,
      settings
    })
  if (!kind) {
    return { status: 'no_action', reason: 'payment_kind_ambiguous' }
  }

  let explicitAmount = targetMemberIds.length > 1 ? input.perMemberAmount : input.explicitAmount
  if (explicitAmount && explicitAmount.currency !== dashboard.currency) {
    // Rent is often quoted in its source currency ("оплатил аренду 175usd");
    // convert with the cycle's own FX rate so the recorded amount matches billing.
    if (
      kind === 'rent' &&
      dashboard.rentFxRateMicros &&
      dashboard.rentFxRateMicros > 0n &&
      explicitAmount.currency === dashboard.rentSourceAmount.currency
    ) {
      explicitAmount = convertMoney(explicitAmount, dashboard.currency, dashboard.rentFxRateMicros)
    } else {
      return { status: 'unsupported_currency' }
    }
  }

  if (targetMemberIds.length > 1) {
    const proposalMembers = (targetMembers as FinanceMemberRecord[])
      .map((member): MultiMemberPaymentProposalMember | null => {
        const line = dashboard.members.find((candidate) => candidate.memberId === member.id)
        if (!line) {
          return null
        }

        const guidance = buildMemberPaymentGuidance({
          kind,
          period: dashboard.period,
          memberLine: line,
          settings,
          paymentKindSummary: currentKindSummary({
            dashboard,
            period: dashboard.period,
            kind
          })
        })
        const amount = explicitAmount ?? guidance.proposalAmount
        const unpaid = isMemberUnpaidForKind({
          dashboard,
          period: dashboard.period,
          kind,
          memberId: member.id,
          fallbackAmount: guidance.proposalAmount
        })

        return {
          memberId: member.id,
          telegramUserId: member.telegramUserId,
          displayName: member.displayName,
          paymentStatus: unpaid ? 'unpaid' : 'paid',
          amountMinor: unpaid ? amount.amountMinor.toString() : '0',
          currency: unpaid ? amount.currency : dashboard.currency,
          selected: unpaid
        }
      })
      .filter((member): member is MultiMemberPaymentProposalMember => member !== null)

    if (proposalMembers.length < 2) {
      return { status: 'no_action', reason: 'members_missing_from_dashboard' }
    }

    if (!proposalMembers.some((member) => member.paymentStatus === 'unpaid')) {
      return { status: 'already_settled', kind }
    }

    return {
      status: 'multi_member_proposal',
      proposal: {
        proposalId: shortProposalId(),
        householdId: input.householdId,
        kind,
        period: dashboard.period,
        members: proposalMembers
      }
    }
  }

  const memberLine = dashboard.members.find((line) => line.memberId === input.payerMemberId)
  if (!memberLine) {
    return { status: 'no_action', reason: 'members_missing_from_dashboard' }
  }

  const guidance = buildMemberPaymentGuidance({
    kind,
    period: dashboard.period,
    memberLine,
    settings,
    paymentKindSummary: currentKindSummary({ dashboard, period: dashboard.period, kind })
  })

  if (
    !isMemberUnpaidForKind({
      dashboard,
      period: dashboard.period,
      kind,
      memberId: input.payerMemberId,
      fallbackAmount: guidance.proposalAmount
    })
  ) {
    return { status: 'already_settled', kind }
  }

  const amount = explicitAmount ?? guidance.proposalAmount
  if (amount.amountMinor <= 0n) {
    return { status: 'already_settled', kind }
  }

  return {
    status: 'proposal',
    payload: {
      proposalId: crypto.randomUUID(),
      householdId: input.householdId,
      memberId: input.payerMemberId,
      kind,
      period: dashboard.period,
      amountMinor: amount.amountMinor.toString(),
      currency: amount.currency
    },
    breakdown: {
      guidance,
      explicitAmount
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

  const categoryLines =
    kind === 'utilities'
      ? (dashboard.utilityBillingPlan?.categories
          .filter(
            (category) =>
              category.assignedMemberId === input.memberId &&
              category.assignedAmount.amountMinor > 0n
          )
          .map(
            (category) =>
              `${category.billName}: ${formatUserFacingMoney(
                category.assignedAmount.toMajorString(),
                category.assignedAmount.currency
              )}`
          ) ?? [])
      : []

  return {
    kind,
    guidance: buildMemberPaymentGuidance({
      kind,
      period: dashboard.period,
      memberLine,
      settings,
      paymentKindSummary: currentKindSummary({ dashboard, period: dashboard.period, kind })
    }),
    ...(categoryLines.length > 0 ? { categoryLines } : {})
  }
}

export function synthesizePaymentConfirmationText(payload: PaymentProposalPayload): string {
  const amount = Money.fromMinor(BigInt(payload.amountMinor), payload.currency)
  const kindText = payload.kind === 'rent' ? 'rent' : 'utilities'
  const subject =
    payload.isThirdParty && payload.reportedDisplayName ? payload.reportedDisplayName : 'paid'

  return subject === 'paid'
    ? `paid ${kindText} ${amount.toMajorString()} ${amount.currency}`
    : `${subject} paid ${kindText} ${amount.toMajorString()} ${amount.currency}`
}
