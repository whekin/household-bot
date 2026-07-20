import {
  buildMemberPaymentGuidance,
  type FinanceCommandService,
  type MemberPaymentGuidance
} from '@household/application'
import { convertMoney, Money, Temporal } from '@household/domain'
import type {
  FinanceMemberRecord,
  FinancePaymentKind,
  HouseholdConfigurationRepository
} from '@household/ports'

import { getBotTranslations, type BotLocale } from './i18n'

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

function shortProposalId(): string {
  return crypto.randomUUID().replaceAll('-', '').slice(0, 16)
}

function inferActivePaymentKind(input: {
  dashboard: Awaited<ReturnType<FinanceCommandService['generateDashboard']>>
  memberIds: readonly string[]
  settings: Parameters<typeof buildMemberPaymentGuidance>[0]['settings']
  referenceInstant?: Temporal.Instant
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

  if (unresolvedKinds.length > 1) {
    const latestOpenWindow = unresolvedKinds
      .map((kind) => {
        const memberLine = dashboard.members.find((member) => memberIds.has(member.memberId))
        if (!memberLine) {
          return null
        }
        const guidance = buildMemberPaymentGuidance({
          kind,
          period: dashboard.period,
          memberLine,
          settings: input.settings,
          paymentKindSummary: currentKindSummary({
            dashboard,
            period: dashboard.period,
            kind
          }),
          ...(input.referenceInstant ? { referenceInstant: input.referenceInstant } : {})
        })
        return guidance.paymentWindowOpen
          ? {
              kind,
              reminderDate: guidance.reminderDate
            }
          : null
      })
      .filter(
        (
          candidate
        ): candidate is {
          kind: FinancePaymentKind
          reminderDate: string
        } => candidate !== null
      )
      .sort((left, right) => right.reminderDate.localeCompare(left.reminderDate))[0]

    if (latestOpenWindow) {
      return latestOpenWindow.kind
    }
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
  referenceInstant?: Temporal.Instant
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
      settings,
      ...(input.referenceInstant ? { referenceInstant: input.referenceInstant } : {})
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

export function synthesizePaymentConfirmationText(payload: PaymentProposalPayload): string {
  const amount = Money.fromMinor(BigInt(payload.amountMinor), payload.currency)
  const kindText = payload.kind === 'rent' ? 'rent' : 'utilities'
  const subject =
    payload.isThirdParty && payload.reportedDisplayName ? payload.reportedDisplayName : 'paid'

  return subject === 'paid'
    ? `paid ${kindText} ${amount.toMajorString()} ${amount.currency}`
    : `${subject} paid ${kindText} ${amount.toMajorString()} ${amount.currency}`
}
