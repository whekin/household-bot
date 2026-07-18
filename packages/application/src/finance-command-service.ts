import { createHash } from 'node:crypto'

import type {
  ExchangeRateProvider,
  FinanceCycleRecord,
  FinanceBalanceLedgerEntryRecord,
  FinanceMemberRecord,
  FinanceMemberOverduePaymentRecord,
  FinancePaymentKind,
  FinancePaymentPurchaseAllocationRecord,
  FinancePaymentRecord,
  FinanceParsedPurchaseRecord,
  FinanceRentRuleRecord,
  FinanceRepository,
  FinanceUtilityBillingPlanPayload,
  FinanceUtilityBillingPlanStatus,
  HouseholdBillingSettingsRecord,
  HouseholdConfigurationRepository,
  HouseholdMemberPresenceDaysRecord,
  HouseholdMemberRecord,
  HouseholdRentPaymentDestination
} from '@household/ports'
import {
  BillingCycleId,
  BillingPeriod,
  DomainError,
  DOMAIN_ERROR_CODE,
  MemberId,
  Money,
  PurchaseEntryId,
  Temporal,
  convertMoney,
  nowInstant,
  type CurrencyCode,
  type Instant
} from '@household/domain'

import { calculateMonthlySettlement } from './settlement-engine'
import {
  computeUtilityBillingPlan,
  materializeUtilityBillingPlanRecord,
  serializeUtilityBillingPlanPayload,
  type UtilityBillingPlanComputed
} from './utilities-billing-plan'

function parseCurrency(raw: string | undefined, fallback: CurrencyCode): CurrencyCode {
  if (!raw || raw.trim().length === 0) {
    return fallback
  }

  const normalized = raw.trim().toUpperCase()
  if (normalized !== 'USD' && normalized !== 'GEL') {
    throw new Error(`Unsupported currency: ${raw}`)
  }

  return normalized
}

function monthRange(period: BillingPeriod): {
  start: Temporal.Instant
  end: Temporal.Instant
} {
  return {
    start: Temporal.Instant.from(`${period.toString()}-01T00:00:00Z`),
    end: Temporal.Instant.from(`${period.next().toString()}-01T00:00:00Z`)
  }
}

function computeInputHash(payload: object): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

async function getCycleByPeriodOrLatest(
  repository: FinanceRepository,
  periodArg?: string
): Promise<FinanceCycleRecord | null> {
  if (periodArg) {
    return repository.getCycleByPeriod(BillingPeriod.fromString(periodArg).toString())
  }

  return (await repository.getOpenCycle()) ?? repository.getLatestCycle()
}

function billingPeriodLockDate(period: BillingPeriod, day: number): Temporal.PlainDate {
  const firstDay = Temporal.PlainDate.from({
    year: period.year,
    month: period.month,
    day: 1
  })
  const clampedDay = Math.min(day, firstDay.daysInMonth)

  return Temporal.PlainDate.from({
    year: period.year,
    month: period.month,
    day: clampedDay
  })
}

function localDateInTimezone(timezone: string): Temporal.PlainDate {
  return nowInstant().toZonedDateTimeISO(timezone).toPlainDate()
}

function periodFromLocalDate(localDate: Temporal.PlainDate): BillingPeriod {
  return BillingPeriod.fromString(`${localDate.year}-${String(localDate.month).padStart(2, '0')}`)
}

function expectedOpenCyclePeriod(
  settings: {
    rentDueDay: number
    timezone: string
  },
  instant: Temporal.Instant
): BillingPeriod {
  const localDate = instant.toZonedDateTimeISO(settings.timezone).toPlainDate()
  const currentPeriod = periodFromLocalDate(localDate)

  return localDate.day > settings.rentDueDay ? currentPeriod.next() : currentPeriod
}

function purchaseOccurredAtFromDate(input: {
  occurredOn: string
  timezone: string
}): Temporal.Instant {
  const date = Temporal.PlainDate.from(input.occurredOn)

  return date
    .toZonedDateTime({
      timeZone: input.timezone,
      plainTime: Temporal.PlainTime.from('12:00:00')
    })
    .toInstant()
}

type PurchaseMutationSplit = {
  mode: 'equal' | 'custom_amounts'
  participants: readonly {
    memberId: string
    included?: boolean
    shareAmountMajor?: string
  }[]
}

interface NormalizedPurchaseParticipant {
  memberId: string
  included: boolean
  shareAmountMinor: bigint | null
}

function invalidPurchaseInput(message: string): never {
  throw new DomainError(DOMAIN_ERROR_CODE.INVALID_SETTLEMENT_INPUT, message)
}

function validatePositivePurchaseAmount(amount: Money): void {
  if (amount.amountMinor <= 0n) {
    invalidPurchaseInput('Purchase amount must be positive')
  }
}

function activePurchaseMemberIds(members: readonly HouseholdMemberRecord[]): ReadonlySet<string> {
  return new Set(members.filter((member) => member.status === 'active').map((member) => member.id))
}

function normalizePurchaseMutationSplit(input: {
  amount: Money
  payerMemberId: string
  split: PurchaseMutationSplit | undefined
  members: readonly HouseholdMemberRecord[]
}): {
  splitMode?: 'equal' | 'custom_amounts'
  participants?: readonly NormalizedPurchaseParticipant[]
} {
  validatePositivePurchaseAmount(input.amount)

  const memberIds = new Set(input.members.map((member) => member.id))
  const activeMemberIds = activePurchaseMemberIds(input.members)

  if (!activeMemberIds.has(input.payerMemberId)) {
    invalidPurchaseInput('Purchase payer must be an active household member')
  }

  if (!input.split) {
    return {}
  }

  const seenParticipantIds = new Set<string>()
  const normalizedParticipants = input.split.participants.map((participant) => {
    if (seenParticipantIds.has(participant.memberId)) {
      invalidPurchaseInput(`Purchase split contains duplicate participant: ${participant.memberId}`)
    }
    seenParticipantIds.add(participant.memberId)

    if (!memberIds.has(participant.memberId)) {
      invalidPurchaseInput(
        `Purchase participant is not a household member: ${participant.memberId}`
      )
    }

    const included = participant.included !== false
    if (included && !activeMemberIds.has(participant.memberId)) {
      invalidPurchaseInput(
        `Purchase participant must be an active household member: ${participant.memberId}`
      )
    }

    return {
      memberId: participant.memberId,
      included,
      shareAmountMinor: null
    } satisfies NormalizedPurchaseParticipant
  })

  const includedParticipants = normalizedParticipants.filter((participant) => participant.included)
  if (input.split.participants.length > 0 && includedParticipants.length === 0) {
    invalidPurchaseInput('Purchase split must include at least one active participant')
  }

  const splitMode = input.split.mode as string
  if (splitMode !== 'equal' && splitMode !== 'custom_amounts') {
    invalidPurchaseInput('Purchase split mode is not supported')
  }

  if (splitMode === 'equal') {
    return {
      splitMode: 'equal',
      participants: normalizedParticipants
    }
  }

  if (includedParticipants.length === 0) {
    invalidPurchaseInput('Purchase custom split must include at least one active participant')
  }

  let totalMinor = 0n
  const participants = input.split.participants.map((participant, index) => {
    const normalized = normalizedParticipants[index]!
    if (!normalized.included) {
      return normalized
    }

    if (participant.shareAmountMajor === undefined) {
      invalidPurchaseInput(
        'Purchase custom split must include explicit share amounts for every included participant'
      )
    }

    const share = Money.fromMajor(participant.shareAmountMajor, input.amount.currency)
    if (share.amountMinor <= 0n) {
      invalidPurchaseInput('Purchase custom split shares must be positive')
    }

    totalMinor += share.amountMinor

    return {
      ...normalized,
      shareAmountMinor: share.amountMinor
    } satisfies NormalizedPurchaseParticipant
  })

  if (totalMinor !== input.amount.amountMinor) {
    invalidPurchaseInput('Purchase custom split must add up to the full amount')
  }

  return {
    splitMode: 'custom_amounts',
    participants
  }
}

function preventImplicitCustomPurchaseAmountChange(input: {
  existingPurchase: FinanceParsedPurchaseRecord | null
  amount: Money
  currency: CurrencyCode
  split: PurchaseMutationSplit | undefined
}): void {
  if (
    input.split ||
    !input.existingPurchase ||
    input.existingPurchase.splitMode !== 'custom_amounts'
  ) {
    return
  }

  if (
    input.existingPurchase.amountMinor === input.amount.amountMinor &&
    input.existingPurchase.currency === input.currency
  ) {
    return
  }

  invalidPurchaseInput('Purchase custom split must be resubmitted when changing amount or currency')
}

export interface FinanceDashboardMemberLine {
  memberId: string
  displayName: string
  status?: 'active' | 'away' | 'left'
  daysPresent?: number
  predictedUtilityShare?: Money | null
  rentShare: Money
  utilityShare: Money
  purchaseOffset: Money
  carryForwardCredit?: Money
  effectivePurchaseBalance?: Money
  netDue: Money
  paid: Money
  remaining: Money
  overduePayments: readonly FinanceMemberOverduePaymentRecord[]
  explanations: readonly string[]
}

export interface FinanceDashboardPaymentMemberSummary {
  memberId: string
  displayName: string
  suggestedAmount: Money
  baseDue: Money
  paid: Money
  remaining: Money
  effectivelySettled: boolean
}

export interface FinanceDashboardPaymentKindSummary {
  kind: FinancePaymentKind
  totalDue: Money
  totalPaid: Money
  totalRemaining: Money
  unresolvedMembers: readonly FinanceDashboardPaymentMemberSummary[]
}

export interface FinanceDashboardPaymentPeriodSummary {
  period: string
  utilityTotal: Money
  hasOverdueBalance: boolean
  isCurrentPeriod: boolean
  kinds: readonly FinanceDashboardPaymentKindSummary[]
}

export interface FinanceClosePaymentPeriodResult {
  period: string
  kind: FinancePaymentKind
  closedMembers: readonly {
    memberId: string
    displayName: string
    amount: Money
  }[]
  skippedMembers: readonly {
    memberId: string
    displayName: string
    reason: 'already_settled' | 'not_found'
  }[]
  dashboard: FinanceDashboard
}

export interface FinanceDashboardLedgerEntry {
  id: string
  kind: 'purchase' | 'utility' | 'payment'
  title: string
  memberId: string | null
  amount: Money
  currency: CurrencyCode
  displayAmount: Money
  displayCurrency: CurrencyCode
  fxRateMicros: bigint | null
  fxEffectiveDate: string | null
  actorDisplayName: string | null
  occurredAt: string | null
  paymentKind: FinancePaymentKind | null
  purchaseSplitMode?: 'equal' | 'custom_amounts'
  purchaseParticipants?: readonly {
    memberId: string
    included: boolean
    shareAmount: Money | null
  }[]
  payerMemberId?: string
  originPeriod?: string | null
  isCurrentCyclePurchase?: boolean
  resolutionStatus?: 'unresolved' | 'resolved'
  resolvedAt?: string | null
  outstandingByMember?: readonly {
    memberId: string
    amount: Money
  }[]
}

export interface FinanceDashboard {
  period: string
  currency: CurrencyCode
  timezone: string
  rentWarningDay: number
  rentDueDay: number
  utilitiesReminderDay: number
  utilitiesDueDay: number
  paymentBalanceAdjustmentPolicy: 'utilities' | 'rent' | 'separate'
  rentPaymentDestinations: readonly HouseholdRentPaymentDestination[] | null
  totalDue: Money
  totalPaid: Money
  totalRemaining: Money
  billingStage: 'utilities' | 'rent' | 'idle'
  rentSourceAmount: Money
  rentDisplayAmount: Money
  rentFxRateMicros: bigint | null
  rentFxEffectiveDate: string | null
  utilityBillingPlan: FinanceDashboardUtilityBillingPlan | null
  rentBillingState: FinanceDashboardRentBillingState
  members: readonly FinanceDashboardMemberLine[]
  paymentPeriods?: readonly FinanceDashboardPaymentPeriodSummary[]
  ledger: readonly FinanceDashboardLedgerEntry[]
}

export interface FinanceDashboardUtilityBillingPlan {
  id: string
  version: number
  status: FinanceUtilityBillingPlanStatus
  dueDate: string
  updatedFromVersion: number | null
  reason: string | null
  categories: readonly {
    utilityBillId: string
    billName: string
    billTotal: Money
    assignedAmount: Money
    assignedMemberId: string
    assignedDisplayName: string
    paidAmount: Money
    isFullAssignment: boolean
    splitGroupId: string | null
  }[]
  memberSummaries: readonly {
    memberId: string
    displayName: string
    fairShare: Money
    vendorPaid: Money
    assignedThisCycle: Money
    projectedDeltaAfterPlan: Money
  }[]
  carryForwardCredits?: readonly {
    memberId: string
    creditCreated: Money
    creditConsumed: Money
    policyTarget: 'utilities' | 'rent'
  }[]
  // The current-cycle purchases whose shares this plan folded into member fair
  // shares. Used to prevent plan-matched payments from auto-resolving same-cycle
  // purchases that were logged after the plan and never priced into anyone's share.
  accountedPurchaseIds?: readonly string[]
}

export interface FinanceDashboardRentBillingState {
  dueDate: string
  memberSummaries: readonly {
    memberId: string
    displayName: string
    due: Money
    paid: Money
    remaining: Money
  }[]
  paymentDestinations: readonly HouseholdRentPaymentDestination[] | null
}

export interface FinanceAdminCycleState {
  cycle: FinanceCycleRecord | null
  rentRule: FinanceRentRuleRecord | null
  utilityBills: readonly {
    id: string
    billName: string
    amount: Money
    currency: CurrencyCode
    createdByMemberId: string | null
    createdAt: Temporal.Instant
  }[]
}

export interface FinanceCurrentBillPlan {
  period: string
  currency: CurrencyCode
  timezone: string
  billingStage: 'utilities' | 'rent' | 'idle'
  rentConversion: {
    sourceAmount: Money
    settlementAmount: Money
    rateMicros: bigint | null
    effectiveDate: string | null
  }
  utilityBillingPlan: FinanceDashboardUtilityBillingPlan | null
  rentBillingState: FinanceDashboardRentBillingState
  members?: readonly {
    memberId: string
    displayName: string
    utilityShare: Money
    purchaseOffset: Money
    carryForwardCredit?: Money
    purchaseDrivers: readonly {
      purchaseId: string
      title: string
      amount: Money
      direction: 'credit' | 'debit'
      payerMemberId: string | null
      occurredAt: string | null
      originPeriod: string | null
    }[]
  }[]
}

export interface FinanceAuditMoney {
  amountMinor: string
  amountMajor: string
  currency: CurrencyCode
  display: string
}

export interface FinanceAuditJsonObject {
  [key: string]: unknown
}

export interface FinanceBillingAuditExport {
  meta: {
    exportVersion: string
    exportedAt: string
    period: string
    billingStage: 'utilities' | 'rent' | 'idle'
    adjustmentPolicy: 'utilities' | 'rent' | 'separate'
    householdId: string
    currency: CurrencyCode
    timezone: string
  }
  descriptions: {
    sections: Record<string, string>
    adjustmentPolicies: Record<'utilities' | 'rent' | 'separate', string>
    derivedFields: Record<string, string>
    snapshotSemantics: {
      settlementSnapshotLines: string
      utilityPlanPayloadFairShareByMember: string
    }
  }
  warnings: readonly {
    code: string
    severity: 'info' | 'warning'
    section: string
    message: string
  }[]
  household: {
    householdId: string
  }
  settings: {
    settlementCurrency: CurrencyCode
    timezone: string
    rentDueDay: number
    rentWarningDay: number
    utilitiesDueDay: number
    utilitiesReminderDay: number
    paymentBalanceAdjustmentPolicy: 'utilities' | 'rent' | 'separate'
    rentAmount: FinanceAuditMoney | null
    rentPaymentDestinations: readonly HouseholdRentPaymentDestination[] | null
    utilityCategories: readonly {
      id: string
      slug: string
      name: string
      sortOrder: number
      isActive: boolean
      providerName: string | null
      customerNumber: string | null
      paymentLink: string | null
      note: string | null
    }[]
  }
  cycle: {
    openCycle: {
      id: string
      period: string
      currency: CurrencyCode
    } | null
    selectedCycle: {
      id: string
      period: string
      currency: CurrencyCode
    }
    rentRule: {
      amount: FinanceAuditMoney
      sourceCurrency: CurrencyCode
    } | null
    rentFx: {
      sourceAmount: FinanceAuditMoney
      settlementAmount: FinanceAuditMoney
      rateMicros: string | null
      effectiveDate: string | null
    }
  }
  members: readonly {
    memberId: string
    displayName: string
    status: 'active' | 'away' | 'left'
    isAdmin: boolean
    rentShareWeight: number
    preferredLocale: string | null
    householdDefaultLocale: string
    daysPresent: number
  }[]
  presenceDays: readonly {
    memberId: string
    period: string
    daysPresent: number
  }[]
  rawInputs: {
    utilityBills: readonly {
      id: string
      billName: string
      amount: FinanceAuditMoney
      createdByMemberId: string | null
      createdAt: string
    }[]
    parsedPurchases: readonly {
      id: string
      cycleId: string | null
      cyclePeriod: string | null
      payerMemberId: string
      amount: FinanceAuditMoney
      description: string | null
      occurredAt: string | null
      splitMode: 'equal' | 'custom_amounts'
      participants: readonly {
        id?: string
        memberId: string
        included: boolean
        shareAmount: FinanceAuditMoney | null
      }[]
    }[]
    paymentRecords: readonly {
      id: string
      cycleId: string
      cyclePeriod: string | null
      memberId: string
      kind: FinancePaymentKind
      amount: FinanceAuditMoney
      recordedAt: string
    }[]
    utilityVendorPaymentFacts: readonly {
      id: string
      cycleId: string
      utilityBillId: string | null
      billName: string
      payerMemberId: string
      amount: FinanceAuditMoney
      plannedForMemberId: string | null
      planVersion: number | null
      matchedPlan: boolean
      recordedByMemberId: string | null
      recordedAt: string
      createdAt: string
    }[]
    utilityReimbursementFacts: readonly {
      id: string
      cycleId: string
      fromMemberId: string
      toMemberId: string
      amount: FinanceAuditMoney
      plannedFromMemberId: string | null
      plannedToMemberId: string | null
      planVersion: number | null
      matchedPlan: boolean
      recordedByMemberId: string | null
      recordedAt: string
      createdAt: string
    }[]
    utilityPlanVersions: readonly {
      id: string
      version: number
      status: FinanceUtilityBillingPlanStatus
      dueDate: string
      currency: CurrencyCode
      maxCategoriesPerMemberApplied: number
      updatedFromPlanId: string | null
      reason: string | null
      createdAt: string
      payload: FinanceUtilityBillingPlanPayload
    }[]
    settlementSnapshot: {
      isFrozenHistoricalSnapshot: boolean
      description: string
      lines: readonly {
        memberId: string
        rentShare: FinanceAuditMoney
        utilityShare: FinanceAuditMoney
        purchaseOffset: FinanceAuditMoney
        netDue: FinanceAuditMoney
      }[]
    }
  }
  derived: {
    totals: {
      totalDue: FinanceAuditMoney
      totalPaid: FinanceAuditMoney
      totalRemaining: FinanceAuditMoney
    }
    members: readonly {
      memberId: string
      displayName: string
      rawUtilityFairShare: FinanceAuditMoney
      adjustedUtilityTarget: FinanceAuditMoney
      rawRentShare: FinanceAuditMoney
      adjustedRentTarget: FinanceAuditMoney
      purchaseOffset: FinanceAuditMoney
      netDue: FinanceAuditMoney
      paid: FinanceAuditMoney
      remaining: FinanceAuditMoney
      overduePayments: readonly {
        kind: FinancePaymentKind
        amountMinor: string
        periods: readonly string[]
      }[]
      explanations: readonly string[]
    }[]
    paymentPeriods: readonly FinanceAuditJsonObject[] | undefined
  }
  utilityPlan: {
    explanation: string
    fieldSemantics: {
      rawCycleFairShareByMember: string
      adjustedTargetByMember: string
      planPayloadFairShareByMember: string
    }
    rawCycleFairShareByMember: readonly {
      memberId: string
      displayName: string
      amount: FinanceAuditMoney
    }[]
    adjustedTargetByMember: readonly {
      memberId: string
      displayName: string
      amount: FinanceAuditMoney
    }[]
    plan: FinanceAuditJsonObject | null
  }
  rentState: {
    explanation: string
    state: FinanceAuditJsonObject
  }
  dashboard: {
    snapshot: FinanceAuditJsonObject
  }
}

interface FinanceCommandServiceDependencies {
  householdId: string
  repository: FinanceRepository
  householdConfigurationRepository: Pick<
    HouseholdConfigurationRepository,
    | 'getHouseholdBillingSettings'
    | 'listHouseholdMembers'
    | 'listHouseholdMemberPresenceDays'
    | 'listHouseholdUtilityCategories'
  >
  exchangeRateProvider: ExchangeRateProvider
}

interface ResolvedMemberCycleParticipation {
  memberId: string
  daysPresent: number
}

function cycleDateRange(period: BillingPeriod): {
  start: Temporal.PlainDate
  endExclusive: Temporal.PlainDate
  daysInMonth: number
} {
  const start = Temporal.PlainDate.from({
    year: period.year,
    month: period.month,
    day: 1
  })

  return {
    start,
    endExclusive: start.add({ months: 1 }),
    daysInMonth: start.daysInMonth
  }
}

function resolveMemberCycleParticipation(input: {
  members: readonly HouseholdMemberRecord[]
  presenceDays: readonly HouseholdMemberPresenceDaysRecord[]
  period: string
}): ReadonlyMap<string, ResolvedMemberCycleParticipation> {
  const period = BillingPeriod.fromString(input.period)
  const { daysInMonth } = cycleDateRange(period)
  const resolved = new Map<string, ResolvedMemberCycleParticipation>()
  const presenceByMemberId = new Map(
    input.presenceDays
      .filter((entry) => entry.period === input.period)
      .map((entry) => [entry.memberId, entry])
  )

  for (const member of input.members) {
    const defaultUtilityParticipationDays = member.status === 'active' ? daysInMonth : 0
    const override = presenceByMemberId.get(member.id)
    const daysPresent = Math.max(
      0,
      Math.min(override?.daysPresent ?? defaultUtilityParticipationDays, daysInMonth)
    )

    resolved.set(member.id, {
      memberId: member.id,
      daysPresent
    })
  }

  return resolved
}

interface ConvertedCycleMoney {
  originalAmount: Money
  settlementAmount: Money
  fxRateMicros: bigint | null
  fxEffectiveDate: string | null
}

interface PurchaseHistoryState {
  purchase: Awaited<ReturnType<FinanceRepository['listParsedPurchases']>>[number]
  converted: ConvertedCycleMoney
  outstandingByMemberId: ReadonlyMap<string, Money>
  outstandingTotal: Money
  resolvedAt: string | null
}

interface CycleBaseMemberLine {
  memberId: string
  rentShare: Money
  utilityShare: Money
  purchaseOffset: Money
  rentPaid: Money
  utilityPaid: Money
}

interface MutableOverdueSummary {
  rent: { amountMinor: bigint; periods: string[] }
  utilities: { amountMinor: bigint; periods: string[] }
}

interface UtilityPlanPaymentMemberSummary {
  baseDue: Money
  paid: Money
  remaining: Money
  isSettled: boolean
}

const PAYMENT_SETTLEMENT_TOLERANCE_MINOR = 200n

function effectiveRemainingMinor(expectedMinor: bigint, paidMinor: bigint): bigint {
  const shortfallMinor = expectedMinor - paidMinor

  if (shortfallMinor <= PAYMENT_SETTLEMENT_TOLERANCE_MINOR) {
    return 0n
  }

  return shortfallMinor
}

function roundSuggestedPaymentMinor(kind: FinancePaymentKind, amountMinor: bigint): bigint {
  if (kind !== 'rent') {
    return amountMinor
  }

  if (amountMinor <= 0n) {
    return 0n
  }

  const wholeMinor = amountMinor / 100n
  const remainderMinor = amountMinor % 100n

  return (remainderMinor >= 50n ? wholeMinor + 1n : wholeMinor) * 100n
}

function resolvedPaymentBalanceAdjustmentPolicy(
  settings: HouseholdBillingSettingsRecord
): 'utilities' | 'rent' | 'separate' {
  return settings.paymentBalanceAdjustmentPolicy ?? 'utilities'
}

function clampNonNegativeMinor(amountMinor: bigint): bigint {
  return amountMinor > 0n ? amountMinor : 0n
}

function adjustedPaymentBaseMinor(input: {
  kind: FinancePaymentKind
  baseMinor: bigint
  purchaseOffsetMinor: bigint
  carryoverCreditMinor?: bigint
  settings: HouseholdBillingSettingsRecord
}): bigint {
  const policy = resolvedPaymentBalanceAdjustmentPolicy(input.settings)
  const adjustedMinor =
    policy === input.kind
      ? input.baseMinor + input.purchaseOffsetMinor - (input.carryoverCreditMinor ?? 0n)
      : input.baseMinor

  return clampNonNegativeMinor(adjustedMinor)
}

function paymentBalanceCarryForward(input: {
  kind: FinancePaymentKind
  baseMinor: bigint
  purchaseOffsetMinor: bigint
  activeCarryoverCreditMinor: bigint
  settings: HouseholdBillingSettingsRecord
}): {
  dueMinor: bigint
  creditCreatedMinor: bigint
  creditConsumedMinor: bigint
} {
  const policy = resolvedPaymentBalanceAdjustmentPolicy(input.settings)
  if (policy !== input.kind) {
    return {
      dueMinor: input.baseMinor,
      creditCreatedMinor: 0n,
      creditConsumedMinor: 0n
    }
  }

  const preCarryoverMinor = input.baseMinor + input.purchaseOffsetMinor
  const creditConsumedMinor =
    preCarryoverMinor > 0n
      ? preCarryoverMinor < input.activeCarryoverCreditMinor
        ? preCarryoverMinor
        : input.activeCarryoverCreditMinor
      : 0n
  const dueMinor = clampNonNegativeMinor(preCarryoverMinor - input.activeCarryoverCreditMinor)
  const creditCreatedMinor = preCarryoverMinor < 0n ? -preCarryoverMinor : 0n

  return {
    dueMinor,
    creditCreatedMinor,
    creditConsumedMinor
  }
}

function activeBalanceCreditByMember(input: {
  entries: readonly FinanceBalanceLedgerEntryRecord[]
  beforePeriod: string
  currency: CurrencyCode
  reservedCreditByMemberId?: ReadonlyMap<string, bigint>
}): ReadonlyMap<string, bigint> {
  const balances = new Map<string, bigint>()
  for (const entry of input.entries) {
    if (entry.sourceCyclePeriod >= input.beforePeriod || entry.currency !== input.currency) {
      continue
    }

    const signedMinor =
      entry.entryType === 'credit_consumed' ? -entry.amountMinor : entry.amountMinor
    balances.set(entry.memberId, (balances.get(entry.memberId) ?? 0n) + signedMinor)
  }

  return new Map(
    [...balances.entries()].map(([memberId, amountMinor]) => [
      memberId,
      amountMinor > (input.reservedCreditByMemberId?.get(memberId) ?? 0n)
        ? amountMinor - (input.reservedCreditByMemberId?.get(memberId) ?? 0n)
        : 0n
    ])
  )
}

async function reservedCarryoverCreditByMember(input: {
  repository: FinanceRepository
  cycles: readonly FinanceCycleRecord[]
  beforePeriod: string
  currency: CurrencyCode
}): Promise<ReadonlyMap<string, bigint>> {
  const priorCycles = input.cycles.filter((cycle) => cycle.period < input.beforePeriod)
  const planGroups = await Promise.all(
    priorCycles.map((cycle) => input.repository.listUtilityBillingPlansForCycle(cycle.id))
  )
  const reserved = new Map<string, bigint>()

  for (const plan of planGroups.flat()) {
    if (plan.status !== 'active' || plan.currency !== input.currency) {
      continue
    }

    for (const credit of plan.payload.carryForwardCredits ?? []) {
      const amountMinor = BigInt(credit.creditConsumedMinor)
      if (amountMinor <= 0n) {
        continue
      }

      reserved.set(credit.memberId, (reserved.get(credit.memberId) ?? 0n) + amountMinor)
    }
  }

  return reserved
}

function actionablePaymentDueMinor(input: {
  kind: FinancePaymentKind
  baseMinor: bigint
  purchaseOffsetMinor: bigint
  carryoverCreditMinor?: bigint
  settings: HouseholdBillingSettingsRecord
}): bigint {
  return roundSuggestedPaymentMinor(
    input.kind,
    adjustedPaymentBaseMinor({
      kind: input.kind,
      baseMinor: input.baseMinor,
      purchaseOffsetMinor: input.purchaseOffsetMinor,
      carryoverCreditMinor: input.carryoverCreditMinor ?? 0n,
      settings: input.settings
    })
  )
}

function serializeMoney(amount: Money): FinanceAuditMoney {
  return {
    amountMinor: amount.amountMinor.toString(),
    amountMajor: amount.toMajorString(),
    currency: amount.currency,
    display:
      amount.currency === 'USD' ? `$${amount.toMajorString()}` : `${amount.toMajorString()} ₾`
  }
}

function serializeOptionalMoney(amount: Money | null): FinanceAuditMoney | null {
  return amount ? serializeMoney(amount) : null
}

function serializeBigInt(value: bigint | null): string | null {
  return value === null ? null : value.toString()
}

function serializeDashboardUtilityBillingPlan(
  plan: FinanceDashboardUtilityBillingPlan | null
): FinanceAuditJsonObject | null {
  if (!plan) {
    return null
  }

  return {
    version: plan.version,
    status: plan.status,
    dueDate: plan.dueDate,
    updatedFromVersion: plan.updatedFromVersion,
    reason: plan.reason,
    categories: plan.categories.map((category) => ({
      utilityBillId: category.utilityBillId,
      billName: category.billName,
      billTotal: serializeMoney(category.billTotal),
      assignedAmount: serializeMoney(category.assignedAmount),
      assignedMemberId: category.assignedMemberId,
      assignedDisplayName: category.assignedDisplayName,
      paidAmount: serializeMoney(category.paidAmount),
      isFullAssignment: category.isFullAssignment,
      splitGroupId: category.splitGroupId
    })),
    memberSummaries: plan.memberSummaries.map((summary) => ({
      memberId: summary.memberId,
      displayName: summary.displayName,
      fairShare: serializeMoney(summary.fairShare),
      vendorPaid: serializeMoney(summary.vendorPaid),
      assignedThisCycle: serializeMoney(summary.assignedThisCycle),
      projectedDeltaAfterPlan: serializeMoney(summary.projectedDeltaAfterPlan)
    }))
  }
}

function auditWarning(input: {
  code: string
  severity: 'info' | 'warning'
  section: string
  message: string
}): FinanceBillingAuditExport['warnings'][number] {
  return input
}

function serializeDashboardRentBillingState(
  state: FinanceDashboardRentBillingState
): FinanceAuditJsonObject {
  return {
    dueDate: state.dueDate,
    paymentDestinations: state.paymentDestinations,
    memberSummaries: state.memberSummaries.map((summary) => ({
      memberId: summary.memberId,
      displayName: summary.displayName,
      due: serializeMoney(summary.due),
      paid: serializeMoney(summary.paid),
      remaining: serializeMoney(summary.remaining)
    }))
  }
}

function serializeDashboardPaymentPeriods(
  paymentPeriods: FinanceDashboard['paymentPeriods']
): readonly FinanceAuditJsonObject[] | undefined {
  return paymentPeriods?.map((period) => ({
    period: period.period,
    utilityTotal: serializeMoney(period.utilityTotal),
    hasOverdueBalance: period.hasOverdueBalance,
    isCurrentPeriod: period.isCurrentPeriod,
    kinds: period.kinds.map((kind) => ({
      kind: kind.kind,
      totalDue: serializeMoney(kind.totalDue),
      totalPaid: serializeMoney(kind.totalPaid),
      totalRemaining: serializeMoney(kind.totalRemaining),
      unresolvedMembers: kind.unresolvedMembers.map((member) => ({
        memberId: member.memberId,
        displayName: member.displayName,
        suggestedAmount: serializeMoney(member.suggestedAmount),
        baseDue: serializeMoney(member.baseDue),
        paid: serializeMoney(member.paid),
        remaining: serializeMoney(member.remaining),
        effectivelySettled: member.effectivelySettled
      }))
    }))
  }))
}

function serializeDashboard(dashboard: FinanceDashboard): FinanceAuditJsonObject {
  return {
    period: dashboard.period,
    currency: dashboard.currency,
    timezone: dashboard.timezone,
    rentWarningDay: dashboard.rentWarningDay,
    rentDueDay: dashboard.rentDueDay,
    utilitiesReminderDay: dashboard.utilitiesReminderDay,
    utilitiesDueDay: dashboard.utilitiesDueDay,
    paymentBalanceAdjustmentPolicy: dashboard.paymentBalanceAdjustmentPolicy,
    rentPaymentDestinations: dashboard.rentPaymentDestinations,
    totalDue: serializeMoney(dashboard.totalDue),
    totalPaid: serializeMoney(dashboard.totalPaid),
    totalRemaining: serializeMoney(dashboard.totalRemaining),
    billingStage: dashboard.billingStage,
    rentSourceAmount: serializeMoney(dashboard.rentSourceAmount),
    rentDisplayAmount: serializeMoney(dashboard.rentDisplayAmount),
    rentFxRateMicros: serializeBigInt(dashboard.rentFxRateMicros),
    rentFxEffectiveDate: dashboard.rentFxEffectiveDate,
    utilityBillingPlan: serializeDashboardUtilityBillingPlan(dashboard.utilityBillingPlan),
    rentBillingState: serializeDashboardRentBillingState(dashboard.rentBillingState),
    members: dashboard.members.map((member) => ({
      memberId: member.memberId,
      displayName: member.displayName,
      status: member.status,
      daysPresent: member.daysPresent,
      predictedUtilityShare: serializeOptionalMoney(member.predictedUtilityShare ?? null),
      rentShare: serializeMoney(member.rentShare),
      utilityShare: serializeMoney(member.utilityShare),
      purchaseOffset: serializeMoney(member.purchaseOffset),
      netDue: serializeMoney(member.netDue),
      paid: serializeMoney(member.paid),
      remaining: serializeMoney(member.remaining),
      overduePayments: member.overduePayments.map((payment) => ({
        kind: payment.kind,
        amountMinor: payment.amountMinor.toString(),
        periods: payment.periods
      })),
      explanations: member.explanations
    })),
    paymentPeriods: serializeDashboardPaymentPeriods(dashboard.paymentPeriods),
    ledger: dashboard.ledger.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      title: entry.title,
      memberId: entry.memberId,
      amount: serializeMoney(entry.amount),
      currency: entry.currency,
      displayAmount: serializeMoney(entry.displayAmount),
      displayCurrency: entry.displayCurrency,
      fxRateMicros: serializeBigInt(entry.fxRateMicros),
      fxEffectiveDate: entry.fxEffectiveDate,
      actorDisplayName: entry.actorDisplayName,
      occurredAt: entry.occurredAt,
      paymentKind: entry.paymentKind,
      purchaseSplitMode: entry.purchaseSplitMode,
      purchaseParticipants: entry.purchaseParticipants?.map((participant) => ({
        memberId: participant.memberId,
        included: participant.included,
        shareAmount: serializeOptionalMoney(participant.shareAmount)
      })),
      payerMemberId: entry.payerMemberId,
      originPeriod: entry.originPeriod,
      resolutionStatus: entry.resolutionStatus,
      resolvedAt: entry.resolvedAt,
      outstandingByMember: entry.outstandingByMember?.map((item) => ({
        memberId: item.memberId,
        amount: serializeMoney(item.amount)
      }))
    }))
  }
}

function utilityPlanPayloadChanged(
  left: UtilityBillingPlanComputed,
  right: UtilityBillingPlanComputed
): boolean {
  const leftPayload = serializeUtilityBillingPlanPayload(left)
  const rightPayload = serializeUtilityBillingPlanPayload(right)

  // Ignore paidAmountMinor in categories when comparing to avoid creating new versions
  // just because a planned payment was recorded. Assignments and fair shares are what matter.
  const stripPaidAmount = (payload: FinanceUtilityBillingPlanPayload) => ({
    ...payload,
    categories: payload.categories.map(({ paidAmountMinor: _paidAmountMinor, ...rest }) => rest)
  })

  return (
    JSON.stringify(stripPaidAmount(leftPayload)) !==
      JSON.stringify(stripPaidAmount(rightPayload)) ||
    left.status !== right.status ||
    left.maxCategoriesPerMemberApplied !== right.maxCategoriesPerMemberApplied
  )
}

function utilityPlanInputsChangedAfterPlan(input: {
  activePlan: Awaited<ReturnType<FinanceRepository['listUtilityBillingPlansForCycle']>>[number]
  preferredUtilityPayerMemberId: string | null
  convertedUtilityBills: readonly {
    bill: Awaited<ReturnType<FinanceRepository['listUtilityBillsForCycle']>>[number]
    converted: ConvertedCycleMoney
  }[]
  purchaseIds?: readonly string[]
}): {
  utilityBillsChanged: boolean
  purchasesChanged: boolean
  preferredUtilityPayerChanged: boolean
  anyChanged: boolean
} {
  const plannedUtilityBillIds = new Set(
    input.activePlan.payload.categories.map((category) => category.utilityBillId)
  )
  const utilityBillsChanged = input.convertedUtilityBills.some(
    ({ bill }) => !plannedUtilityBillIds.has(bill.id)
  )
  const currentPurchaseIds = new Set(input.purchaseIds ?? [])
  const plannedPurchaseIds = new Set(input.activePlan.payload.purchaseIds ?? [])
  const purchasesChanged =
    currentPurchaseIds.size !== plannedPurchaseIds.size ||
    [...currentPurchaseIds].some((purchaseId) => !plannedPurchaseIds.has(purchaseId))
  const preferredUtilityPayerChanged =
    (input.activePlan.payload.preferredUtilityPayerMemberId ?? null) !==
    (input.preferredUtilityPayerMemberId ?? null)

  return {
    utilityBillsChanged,
    purchasesChanged,
    preferredUtilityPayerChanged,
    anyChanged: utilityBillsChanged || purchasesChanged || preferredUtilityPayerChanged
  }
}

function utilityMatchedPlanPaidMinor(input: {
  plan: {
    id: string
    version: number
  }
  vendorFacts: readonly {
    planId?: string | null
    utilityBillId: string | null
    payerMemberId: string
    plannedForMemberId: string | null
    planVersion: number | null
    matchedPlan: boolean
    amountMinor: bigint
  }[]
  utilityBillId: string
  payerMemberId: string
}): bigint {
  return input.vendorFacts
    .filter(
      (fact) =>
        fact.matchedPlan &&
        (fact.planId ? fact.planId === input.plan.id : fact.planVersion === input.plan.version) &&
        fact.utilityBillId === input.utilityBillId &&
        fact.payerMemberId === input.payerMemberId &&
        fact.plannedForMemberId === input.payerMemberId
    )
    .reduce((sum, fact) => sum + fact.amountMinor, 0n)
}

function utilityFactMatchesPlan(
  fact: {
    planId?: string | null
    planVersion: number | null
    matchedPlan: boolean
  },
  plan: {
    id: string
    version: number
  }
): boolean {
  if (!fact.matchedPlan) {
    return false
  }

  return fact.planId ? fact.planId === plan.id : fact.planVersion === plan.version
}

// True once every plan category is fully covered by on-plan vendor facts,
// i.e. the last member paid their assigned share. Empty plans never count.
function utilityPlanFullyCovered(input: {
  plan: FinanceDashboardUtilityBillingPlan
  vendorFacts: Parameters<typeof utilityMatchedPlanPaidMinor>[0]['vendorFacts']
}): boolean {
  if (input.plan.categories.length === 0) {
    return false
  }

  return input.plan.categories.every((category) => {
    if (category.assignedAmount.amountMinor <= 0n) {
      return true
    }

    const paidMinor = utilityMatchedPlanPaidMinor({
      plan: input.plan,
      vendorFacts: input.vendorFacts,
      utilityBillId: category.utilityBillId,
      payerMemberId: category.assignedMemberId
    })

    return paidMinor >= category.assignedAmount.amountMinor
  })
}

function currentUtilityBillingPlanRecord(
  plans: readonly Awaited<
    ReturnType<FinanceRepository['listUtilityBillingPlansForCycle']>
  >[number][]
): Awaited<ReturnType<FinanceRepository['listUtilityBillingPlansForCycle']>>[number] | null {
  return (
    [...plans].reverse().find((plan) => plan.status === 'active' || plan.status === 'settled') ??
    null
  )
}

function utilityPlanHasPaymentTargets(computed: UtilityBillingPlanComputed): boolean {
  return (
    computed.categories.length > 0 ||
    computed.memberSummaries.some(
      (summary) =>
        summary.assignedThisCycle.amountMinor > 0n ||
        summary.fairShare.amountMinor > 0n ||
        summary.vendorPaid.amountMinor > 0n
    )
  )
}

function utilityPlanPaymentSummariesByMemberId(input: {
  plan: Awaited<ReturnType<FinanceRepository['listUtilityBillingPlansForCycle']>>[number]
  vendorFacts: readonly Awaited<
    ReturnType<FinanceRepository['listUtilityVendorPaymentFactsForCycle']>
  >[number][]
}): ReadonlyMap<string, UtilityPlanPaymentMemberSummary> | null {
  const computed = materializeUtilityBillingPlanRecord(input.plan)
  if (!utilityPlanHasPaymentTargets(computed)) {
    return null
  }

  const matchedPaidByMemberId = input.vendorFacts
    .filter((fact) => utilityFactMatchesPlan(fact, input.plan))
    .reduce((totals, fact) => {
      totals.set(fact.payerMemberId, (totals.get(fact.payerMemberId) ?? 0n) + fact.amountMinor)
      return totals
    }, new Map<string, bigint>())

  return new Map(
    computed.memberSummaries.map((summary) => {
      const baseDueMinor = summary.assignedThisCycle.amountMinor
      const matchedPaidMinor = matchedPaidByMemberId.get(summary.memberId) ?? 0n
      const paidMinor =
        input.plan.status === 'settled'
          ? matchedPaidMinor > baseDueMinor
            ? matchedPaidMinor
            : baseDueMinor
          : matchedPaidMinor
      const remainingMinor =
        input.plan.status === 'settled'
          ? 0n
          : baseDueMinor > matchedPaidMinor
            ? baseDueMinor - matchedPaidMinor
            : 0n

      return [
        summary.memberId,
        {
          baseDue: Money.fromMinor(baseDueMinor, input.plan.currency),
          paid: Money.fromMinor(paidMinor, input.plan.currency),
          remaining: Money.fromMinor(remainingMinor, input.plan.currency),
          isSettled: input.plan.status === 'settled'
        }
      ] as const
    })
  )
}

function utilityPlanRemainingAfterRecordedPayments(input: {
  plannedSummary: UtilityPlanPaymentMemberSummary
  recordedPaid: Money
}): UtilityPlanPaymentMemberSummary {
  if (input.plannedSummary.isSettled) {
    return input.plannedSummary
  }

  const effectivePaidMinor =
    input.recordedPaid.amountMinor > input.plannedSummary.paid.amountMinor
      ? input.recordedPaid.amountMinor
      : input.plannedSummary.paid.amountMinor
  const remainingMinor =
    input.plannedSummary.baseDue.amountMinor > effectivePaidMinor
      ? input.plannedSummary.baseDue.amountMinor - effectivePaidMinor
      : 0n

  return {
    ...input.plannedSummary,
    paid: Money.fromMinor(effectivePaidMinor, input.plannedSummary.paid.currency),
    remaining: Money.fromMinor(remainingMinor, input.plannedSummary.remaining.currency)
  }
}

async function ensureUtilityBillingPlan(input: {
  dependencies: FinanceCommandServiceDependencies
  cycle: FinanceCycleRecord
  members: readonly HouseholdMemberRecord[]
  settings: HouseholdBillingSettingsRecord
  settlementLines: readonly {
    memberId: string
    utilityShare: Money
    purchaseOffset: Money
  }[]
  activeCarryoverCreditByMemberId: ReadonlyMap<string, bigint>
  skipRebalance?: boolean
  convertedUtilityBills: readonly {
    bill: Awaited<ReturnType<FinanceRepository['listUtilityBillsForCycle']>>[number]
    converted: ConvertedCycleMoney
  }[]
  purchaseIds?: readonly string[]
}): Promise<{
  record: Awaited<ReturnType<FinanceRepository['saveUtilityBillingPlan']>> | null
  computed: UtilityBillingPlanComputed | null
}> {
  const adjustmentPolicy = resolvedPaymentBalanceAdjustmentPolicy(input.settings)
  const [existingPlans, vendorFacts] = await Promise.all([
    input.dependencies.repository.listUtilityBillingPlansForCycle(input.cycle.id),
    input.dependencies.repository.listUtilityVendorPaymentFactsForCycle(input.cycle.id)
  ])

  const activePlan =
    [...existingPlans]
      .reverse()
      .find((plan) => plan.status === 'active' || plan.status === 'settled') ?? null
  const inputChangeStatus = activePlan
    ? utilityPlanInputsChangedAfterPlan({
        activePlan,
        preferredUtilityPayerMemberId: input.settings.preferredUtilityPayerMemberId,
        convertedUtilityBills: input.convertedUtilityBills,
        ...(input.purchaseIds === undefined ? {} : { purchaseIds: input.purchaseIds })
      })
    : {
        anyChanged: false,
        utilityBillsChanged: false,
        purchasesChanged: false,
        preferredUtilityPayerChanged: false
      }

  const validMatchedFacts = activePlan
    ? vendorFacts.filter((fact) => utilityFactMatchesPlan(fact, activePlan))
    : []
  const activePlanHasCategories = (activePlan?.payload.categories.length ?? 0) > 0
  const isLocked =
    activePlan &&
    (validMatchedFacts.length > 0 || (activePlan.status === 'settled' && activePlanHasCategories))

  // On-plan payments lock the plan; off-plan facts only rebalance draft plans.
  const offPlanFacts = vendorFacts.filter((fact) => !fact.matchedPlan)
  const hadOffPlanFact = offPlanFacts.length > 0
  const hasPendingOffPlanFact =
    !activePlan ||
    offPlanFacts.some((fact) => {
      if (fact.planVersion !== null && fact.planVersion !== undefined) {
        return fact.planVersion >= activePlan.version
      }

      return Temporal.Instant.compare(fact.createdAt, activePlan.createdAt) >= 0
    })

  // Decide whether to recompute the plan assignments.
  // We MUST recompute if:
  // - There is no active plan yet.
  // - Someone paid "off-plan" before the plan froze.
  // We SHOULD recompute if:
  // - Inputs changed (new bills, changed purchases, etc.) AND the plan is NOT locked yet.
  const shouldRecompute =
    !activePlan ||
    (!isLocked && !input.skipRebalance && hasPendingOffPlanFact) ||
    (!isLocked && inputChangeStatus.anyChanged)

  // Orphan matched facts are ignored unless they reference the selected current plan.
  const vendorPaymentsForCompute = offPlanFacts
  const billCoveragePaymentsForCompute = activePlan ? offPlanFacts : []

  let computed = shouldRecompute
    ? (() => {
        const carryForwards = input.settlementLines.map((line) =>
          paymentBalanceCarryForward({
            kind: 'utilities',
            baseMinor: line.utilityShare.amountMinor,
            purchaseOffsetMinor: line.purchaseOffset.amountMinor,
            activeCarryoverCreditMinor:
              input.activeCarryoverCreditByMemberId.get(line.memberId) ?? 0n,
            settings: input.settings
          })
        )

        return computeUtilityBillingPlan({
          currency: input.cycle.currency,
          members: input.settlementLines.map((line, index) => ({
            memberId: line.memberId,
            displayName:
              input.members.find((member) => member.id === line.memberId)?.displayName ??
              line.memberId,
            fairShare: Money.fromMinor(
              adjustmentPolicy === 'utilities'
                ? carryForwards[index]!.dueMinor
                : line.utilityShare.amountMinor,
              input.cycle.currency
            )
          })),
          carryForwardCredits:
            adjustmentPolicy === 'utilities'
              ? input.settlementLines
                  .map((line, index) => ({
                    memberId: line.memberId,
                    creditCreated: Money.fromMinor(
                      carryForwards[index]!.creditCreatedMinor,
                      input.cycle.currency
                    ),
                    creditConsumed: Money.fromMinor(
                      carryForwards[index]!.creditConsumedMinor,
                      input.cycle.currency
                    ),
                    policyTarget: 'utilities' as const
                  }))
                  .filter(
                    (credit) =>
                      credit.creditCreated.amountMinor > 0n ||
                      credit.creditConsumed.amountMinor > 0n
                  )
              : [],
          bills: input.convertedUtilityBills.map(({ bill, converted }) => ({
            utilityBillId: bill.id,
            billName: bill.billName,
            amount: converted.settlementAmount
          })),
          vendorPayments: vendorPaymentsForCompute.map((fact) => ({
            utilityBillId: fact.utilityBillId,
            billName: fact.billName,
            payerMemberId: fact.payerMemberId,
            amount: Money.fromMinor(fact.amountMinor, fact.currency)
          })),
          billCoveragePayments: billCoveragePaymentsForCompute.map((fact) => ({
            utilityBillId: fact.utilityBillId,
            billName: fact.billName,
            payerMemberId: fact.payerMemberId,
            amount: Money.fromMinor(fact.amountMinor, fact.currency)
          })),
          strategy: adjustmentPolicy === 'rent' ? 'whole_bills_first' : 'same_cycle',
          preferredUtilityPayerMemberId: input.settings.preferredUtilityPayerMemberId,
          purchaseIds: input.purchaseIds ?? []
        })
      })()
    : materializeUtilityBillingPlanRecord(activePlan)

  const progressFacts = [...offPlanFacts, ...validMatchedFacts]
  const plannedPaidByMemberId = validMatchedFacts.reduce((totals, fact) => {
    totals.set(fact.payerMemberId, (totals.get(fact.payerMemberId) ?? 0n) + fact.amountMinor)
    return totals
  }, new Map<string, bigint>())

  // Overlay immutable plan assignments with payment progress from facts that belong to this plan.
  computed = {
    ...computed,
    categories: computed.categories.map((category) => {
      const totalPaidMinor = progressFacts
        .filter((fact) => {
          if (fact.utilityBillId) {
            return fact.utilityBillId === category.utilityBillId
          }
          return fact.billName.trim().toLowerCase() === category.billName.trim().toLowerCase()
        })
        .reduce((sum, fact) => sum + fact.amountMinor, 0n)

      return {
        ...category,
        paidAmount: Money.fromMinor(totalPaidMinor, category.paidAmount.currency)
      }
    }),
    memberSummaries: computed.memberSummaries.map((summary) => {
      const plannedPaidMinor = plannedPaidByMemberId.get(summary.memberId) ?? 0n
      const remainingAssignedMinor =
        summary.assignedThisCycle.amountMinor > plannedPaidMinor
          ? summary.assignedThisCycle.amountMinor - plannedPaidMinor
          : 0n

      return {
        ...summary,
        vendorPaid: Money.fromMinor(
          summary.vendorPaid.amountMinor + plannedPaidMinor,
          summary.vendorPaid.currency
        ),
        assignedThisCycle: Money.fromMinor(
          remainingAssignedMinor,
          summary.assignedThisCycle.currency
        )
      }
    })
  }

  if (computed.categories.length === 0 && input.convertedUtilityBills.length === 0) {
    return {
      record: null,
      computed: null
    }
  }

  if (activePlan && isLocked) {
    return {
      record: activePlan,
      computed
    }
  }

  if (activePlan) {
    const materialized = materializeUtilityBillingPlanRecord(activePlan)
    if (!utilityPlanPayloadChanged(materialized, computed)) {
      return {
        record: activePlan,
        computed
      }
    }
  }

  // Another concurrent request may have already materialized the exact same plan
  // after we loaded `activePlan`. Reuse that latest plan instead of minting a
  // duplicate version with identical assignments.
  const latestPlans = await input.dependencies.repository.listUtilityBillingPlansForCycle(
    input.cycle.id
  )
  const latestActivePlan =
    [...latestPlans]
      .reverse()
      .find((plan) => plan.status === 'active' || plan.status === 'settled') ?? null

  if (latestActivePlan) {
    const latestMaterialized = materializeUtilityBillingPlanRecord(latestActivePlan)
    if (!utilityPlanPayloadChanged(latestMaterialized, computed)) {
      return {
        record: latestActivePlan,
        computed
      }
    }
  }

  const dueDate = billingPeriodLockDate(
    BillingPeriod.fromString(input.cycle.period),
    input.settings.utilitiesDueDay
  ).toString()
  const planToSupersede = latestActivePlan ?? activePlan
  const record = await input.dependencies.repository.replaceCurrentUtilityBillingPlan({
    cycleId: input.cycle.id,
    status: computed.status,
    dueDate,
    currency: input.cycle.currency,
    maxCategoriesPerMemberApplied: computed.maxCategoriesPerMemberApplied,
    previousPlanId: planToSupersede?.id ?? null,
    previousPlanReplacementStatus: planToSupersede
      ? hadOffPlanFact
        ? 'diverged'
        : 'superseded'
      : null,
    reason:
      planToSupersede && vendorFacts.some((fact) => !fact.matchedPlan)
        ? 'rebalanced_after_off_plan_change'
        : planToSupersede
          ? 'rebalanced_after_cycle_change'
          : null,
    payload: serializeUtilityBillingPlanPayload(computed)
  })

  return {
    record,
    computed
  }
}

function buildDashboardUtilityBillingPlan(input: {
  planRecord: Awaited<ReturnType<FinanceRepository['saveUtilityBillingPlan']>>
  computed: UtilityBillingPlanComputed
  memberNameById: ReadonlyMap<string, string>
  priorVersionByPlanId: ReadonlyMap<string, number>
}): FinanceDashboardUtilityBillingPlan {
  return {
    id: input.planRecord.id,
    version: input.planRecord.version,
    status: input.planRecord.status,
    dueDate: input.planRecord.dueDate,
    updatedFromVersion: input.planRecord.updatedFromPlanId
      ? (input.priorVersionByPlanId.get(input.planRecord.updatedFromPlanId) ?? null)
      : null,
    reason: input.planRecord.reason,
    categories: input.computed.categories.map((category) => ({
      utilityBillId: category.utilityBillId,
      billName: category.billName,
      billTotal: category.billTotal,
      assignedAmount: category.assignedAmount,
      assignedMemberId: category.assignedMemberId,
      assignedDisplayName:
        input.memberNameById.get(category.assignedMemberId) ?? category.assignedMemberId,
      paidAmount: category.paidAmount,
      isFullAssignment: category.isFullAssignment,
      splitGroupId: category.splitGroupId
    })),
    memberSummaries: input.computed.memberSummaries.map((summary) => {
      return {
        memberId: summary.memberId,
        displayName: input.memberNameById.get(summary.memberId) ?? summary.memberId,
        fairShare: summary.fairShare,
        vendorPaid: summary.vendorPaid,
        assignedThisCycle: summary.assignedThisCycle,
        projectedDeltaAfterPlan: summary.projectedDeltaAfterPlan
      }
    }),
    carryForwardCredits: input.computed.carryForwardCredits,
    accountedPurchaseIds: input.planRecord.payload.purchaseIds ?? []
  }
}

function purchaseShareForMember(input: {
  entry: FinanceDashboardLedgerEntry
  memberId: string
}): Money | null {
  if (input.entry.kind !== 'purchase') {
    return null
  }

  const participants = (input.entry.purchaseParticipants ?? []).filter(
    (participant) => participant.included
  )
  const participantIndex = participants.findIndex(
    (participant) => participant.memberId === input.memberId
  )
  if (participantIndex === -1) {
    return null
  }

  const participant = participants[participantIndex]
  if (participant?.shareAmount) {
    return participant.shareAmount
  }

  return input.entry.displayAmount.splitEvenly(participants.length)[participantIndex] ?? null
}

function purchaseDriverForMember(input: {
  entry: FinanceDashboardLedgerEntry
  memberId: string
  period: string
  currency: CurrencyCode
}): {
  purchaseId: string
  title: string
  amount: Money
  direction: 'credit' | 'debit'
  payerMemberId: string | null
  occurredAt: string | null
  originPeriod: string | null
} | null {
  if (input.entry.kind !== 'purchase' || input.entry.resolutionStatus === 'resolved') {
    return null
  }

  const payerMemberId = input.entry.payerMemberId ?? input.entry.memberId
  const isCurrentPeriod = (input.entry.originPeriod ?? input.period) === input.period
  const hasParticipantData = (input.entry.purchaseParticipants?.length ?? 0) > 0
  let impactMinor = 0n

  if (isCurrentPeriod && hasParticipantData) {
    const shareMinor =
      purchaseShareForMember({ entry: input.entry, memberId: input.memberId })?.amountMinor ?? null
    const paidMinor = payerMemberId === input.memberId ? input.entry.displayAmount.amountMinor : 0n
    if (shareMinor === null && paidMinor === 0n) {
      return null
    }
    impactMinor = (shareMinor ?? 0n) - paidMinor
  } else {
    const outstanding = input.entry.outstandingByMember ?? []
    const memberOutstandingMinor =
      outstanding.find((item) => item.memberId === input.memberId)?.amount.amountMinor ?? 0n
    const payerCreditMinor =
      payerMemberId === input.memberId
        ? outstanding.reduce((sum, item) => sum - item.amount.amountMinor, 0n)
        : 0n
    impactMinor = memberOutstandingMinor + payerCreditMinor
  }

  if (impactMinor === 0n) {
    return null
  }

  return {
    purchaseId: input.entry.id,
    title: input.entry.title,
    amount: Money.fromMinor(impactMinor < 0n ? -impactMinor : impactMinor, input.currency),
    direction: impactMinor < 0n ? 'credit' : 'debit',
    payerMemberId,
    occurredAt: input.entry.occurredAt ?? null,
    originPeriod: input.entry.originPeriod ?? null
  }
}

function resolveBillingStage(input: {
  period: string
  settings: HouseholdBillingSettingsRecord
  utilityBillingPlan: FinanceDashboardUtilityBillingPlan | null
  rentBillingState: FinanceDashboardRentBillingState
  todayOverride?: string
}): 'utilities' | 'rent' | 'idle' {
  const localDate = input.todayOverride
    ? Temporal.PlainDate.from(input.todayOverride)
    : localDateInTimezone(input.settings.timezone)
  const period = BillingPeriod.fromString(input.period)
  const utilitiesReminder = billingPeriodLockDate(period, input.settings.utilitiesReminderDay)
  const rentReminder = billingPeriodLockDate(period, input.settings.rentWarningDay)
  const utilitiesOpen =
    input.utilityBillingPlan &&
    input.utilityBillingPlan.status !== 'settled' &&
    input.utilityBillingPlan.memberSummaries.some(
      (member) => member.assignedThisCycle.amountMinor > 0n
    ) &&
    (Temporal.PlainDate.compare(localDate, utilitiesReminder) >= 0 ||
      Temporal.PlainDate.compare(localDate, rentReminder) >= 0)

  if (utilitiesOpen) {
    return 'utilities'
  }

  const rentOpen =
    input.rentBillingState.memberSummaries.some((member) => member.remaining.amountMinor > 0n) &&
    Temporal.PlainDate.compare(localDate, rentReminder) >= 0

  return rentOpen ? 'rent' : 'idle'
}

async function invalidateCurrentUtilityBillingPlan(repository: FinanceRepository): Promise<void> {
  const cycle = (await repository.getOpenCycle()) ?? (await repository.getLatestCycle())
  if (!cycle) {
    return
  }

  await invalidateUtilityBillingPlanForCycle(repository, cycle.id)
}

async function invalidateUtilityBillingPlanForCycle(
  repository: FinanceRepository,
  cycleId: string
): Promise<void> {
  const plans = await repository.listUtilityBillingPlansForCycle(cycleId)
  const activePlan =
    [...plans].reverse().find((plan) => plan.status === 'active' || plan.status === 'settled') ??
    null

  if (!activePlan) {
    return
  }

  const vendorFacts = await repository.listUtilityVendorPaymentFactsForCycle(cycleId)
  if (activePlan.status === 'settled') {
    const hasCategories = activePlan.payload.categories.length > 0
    if (hasCategories || vendorFacts.length > 0) {
      return
    }
  }

  if (vendorFacts.some((fact) => utilityFactMatchesPlan(fact, activePlan))) {
    return
  }

  await repository.updateUtilityBillingPlanStatus(activePlan.id, 'superseded')
}

function periodFromInstant(instant: Temporal.Instant | null | undefined): string | null {
  if (!instant) {
    return null
  }

  const zdt = instant.toZonedDateTimeISO('UTC')
  return `${zdt.year}-${String(zdt.month).padStart(2, '0')}`
}

function purchaseOriginPeriod(
  purchase: Awaited<ReturnType<FinanceRepository['listParsedPurchases']>>[number]
): string | null {
  return purchase.cyclePeriod ?? periodFromInstant(purchase.occurredAt)
}

function buildPurchaseShareMap(input: {
  purchase: Awaited<ReturnType<FinanceRepository['listParsedPurchases']>>[number]
  amount: Money
  activePurchaseParticipantIds: readonly string[]
}): ReadonlyMap<string, Money> {
  const shares = new Map<string, Money>()
  const explicitParticipants =
    input.purchase.participants?.filter((participant) => participant.included !== false) ?? []

  if (explicitParticipants.length > 0) {
    const explicitShares = explicitParticipants.filter(
      (participant) => participant.shareAmountMinor !== null
    )
    if (explicitShares.length > 0) {
      for (const participant of explicitShares) {
        shares.set(
          participant.memberId,
          Money.fromMinor(participant.shareAmountMinor!, input.amount.currency)
        )
      }

      return shares
    }

    const splitShares = input.amount.splitEvenly(explicitParticipants.length)
    for (const [index, participant] of explicitParticipants.entries()) {
      shares.set(participant.memberId, splitShares[index] ?? Money.zero(input.amount.currency))
    }

    return shares
  }

  const fallbackIds = input.activePurchaseParticipantIds
  const splitShares = input.amount.splitEvenly(fallbackIds.length)
  for (const [index, memberId] of fallbackIds.entries()) {
    shares.set(memberId, splitShares[index] ?? Money.zero(input.amount.currency))
  }

  return shares
}

function sumAllocationMinor(
  allocations: readonly FinancePaymentPurchaseAllocationRecord[],
  purchaseId: string,
  memberId: string
): bigint {
  return allocations
    .filter(
      (allocation) => allocation.purchaseId === purchaseId && allocation.memberId === memberId
    )
    .reduce((sum, allocation) => sum + allocation.amountMinor, 0n)
}

async function convertIntoCycleCurrency(
  dependencies: FinanceCommandServiceDependencies,
  input: {
    cycle: FinanceCycleRecord
    period: BillingPeriod
    lockDay: number
    timezone: string
    amount: Money
  }
): Promise<ConvertedCycleMoney> {
  if (input.amount.currency === input.cycle.currency) {
    return {
      originalAmount: input.amount,
      settlementAmount: input.amount,
      fxRateMicros: null,
      fxEffectiveDate: null
    }
  }

  const existingRate = await dependencies.repository.getCycleExchangeRate(
    input.cycle.id,
    input.amount.currency,
    input.cycle.currency
  )

  if (existingRate) {
    return {
      originalAmount: input.amount,
      settlementAmount: convertMoney(input.amount, input.cycle.currency, existingRate.rateMicros),
      fxRateMicros: existingRate.rateMicros,
      fxEffectiveDate: existingRate.effectiveDate
    }
  }

  const lockDate = billingPeriodLockDate(input.period, input.lockDay)
  const currentLocalDate = localDateInTimezone(input.timezone)
  const shouldPersist = Temporal.PlainDate.compare(currentLocalDate, lockDate) >= 0
  const quote = await dependencies.exchangeRateProvider.getRate({
    baseCurrency: input.amount.currency,
    quoteCurrency: input.cycle.currency,
    effectiveDate: lockDate.toString()
  })

  if (shouldPersist) {
    await dependencies.repository.saveCycleExchangeRate({
      cycleId: input.cycle.id,
      sourceCurrency: quote.baseCurrency,
      targetCurrency: quote.quoteCurrency,
      rateMicros: quote.rateMicros,
      effectiveDate: quote.effectiveDate,
      source: quote.source
    })
  }

  return {
    originalAmount: input.amount,
    settlementAmount: convertMoney(input.amount, input.cycle.currency, quote.rateMicros),
    fxRateMicros: quote.rateMicros,
    fxEffectiveDate: quote.effectiveDate
  }
}

async function buildCycleBaseMemberLines(input: {
  dependencies: FinanceCommandServiceDependencies
  cycle: FinanceCycleRecord
  members: readonly HouseholdMemberRecord[]
  memberPresenceDays: readonly HouseholdMemberPresenceDaysRecord[]
  settings: HouseholdBillingSettingsRecord
}): Promise<readonly CycleBaseMemberLine[]> {
  const period = BillingPeriod.fromString(input.cycle.period)
  const resolvedParticipation = resolveMemberCycleParticipation({
    members: input.members,
    presenceDays: input.memberPresenceDays,
    period: input.cycle.period
  })
  const [rentRule, utilityBills, paymentRecords] = await Promise.all([
    input.dependencies.repository.getRentRuleForPeriod(input.cycle.period),
    input.dependencies.repository.listUtilityBillsForCycle(input.cycle.id),
    input.dependencies.repository.listPaymentRecordsForCycle(input.cycle.id)
  ])

  const rentAmountMinor = rentRule?.amountMinor ?? 0n
  const rentCurrency = rentRule?.currency ?? input.cycle.currency
  const convertedRent = await convertIntoCycleCurrency(input.dependencies, {
    cycle: input.cycle,
    period,
    lockDay: input.settings.rentWarningDay,
    timezone: input.settings.timezone,
    amount: Money.fromMinor(rentAmountMinor, rentCurrency)
  })
  const convertedUtilityBills = await Promise.all(
    utilityBills.map(async (bill) => {
      const converted = await convertIntoCycleCurrency(input.dependencies, {
        cycle: input.cycle,
        period,
        lockDay: input.settings.utilitiesReminderDay,
        timezone: input.settings.timezone,
        amount: Money.fromMinor(bill.amountMinor, bill.currency)
      })

      return converted.settlementAmount
    })
  )

  const utilities = convertedUtilityBills.reduce(
    (sum, amount) => sum.add(amount),
    Money.zero(input.cycle.currency)
  )
  const settlement = calculateMonthlySettlement({
    cycleId: BillingCycleId.from(input.cycle.id),
    period,
    rent: convertedRent.settlementAmount,
    utilities,
    utilitySplitMode: 'weighted_by_days',
    members: input.members.map((member) => {
      const participation = resolvedParticipation.get(member.id)

      return {
        memberId: MemberId.from(member.id),
        active: member.status !== 'left',
        participatesInRent: member.status !== 'left',
        participatesInUtilities: member.status !== 'left' && (participation?.daysPresent ?? 0) > 0,
        participatesInPurchases: member.status === 'active',
        rentWeight: member.rentShareWeight,
        utilityDays: Math.max(participation?.daysPresent ?? 0, 1)
      }
    }),
    purchases: []
  })

  const rentPaidByMemberId = new Map<string, Money>()
  const utilityPaidByMemberId = new Map<string, Money>()
  for (const payment of paymentRecords) {
    const targetMap = payment.kind === 'rent' ? rentPaidByMemberId : utilityPaidByMemberId
    const current = targetMap.get(payment.memberId) ?? Money.zero(input.cycle.currency)
    targetMap.set(
      payment.memberId,
      current.add(Money.fromMinor(payment.amountMinor, payment.currency))
    )
  }

  return settlement.lines.map((line) => ({
    memberId: line.memberId.toString(),
    rentShare: line.rentShare,
    utilityShare: line.utilityShare,
    purchaseOffset: line.purchaseOffset,
    rentPaid: rentPaidByMemberId.get(line.memberId.toString()) ?? Money.zero(input.cycle.currency),
    utilityPaid:
      utilityPaidByMemberId.get(line.memberId.toString()) ?? Money.zero(input.cycle.currency)
  }))
}

async function computeMemberOverduePayments(input: {
  dependencies: FinanceCommandServiceDependencies
  currentCycle: FinanceCycleRecord
  members: readonly HouseholdMemberRecord[]
  memberPresenceDays: readonly HouseholdMemberPresenceDaysRecord[]
  settings: HouseholdBillingSettingsRecord
  activeCarryoverCreditByMemberId?: ReadonlyMap<string, bigint>
  todayOverride?: string
}): Promise<ReadonlyMap<string, readonly FinanceMemberOverduePaymentRecord[]>> {
  const localDate = input.todayOverride
    ? Temporal.PlainDate.from(input.todayOverride)
    : localDateInTimezone(input.settings.timezone)
  const overdueByMemberId = new Map<string, MutableOverdueSummary>()
  const cycles = (await input.dependencies.repository.listCycles()).filter(
    (cycle) => cycle.period.localeCompare(input.currentCycle.period) <= 0
  )

  for (const cycle of cycles) {
    const [baseLines, utilityPlans, vendorFacts] = await Promise.all([
      buildCycleBaseMemberLines({
        dependencies: input.dependencies,
        cycle,
        members: input.members,
        memberPresenceDays: input.memberPresenceDays,
        settings: input.settings
      }),
      input.dependencies.repository.listUtilityBillingPlansForCycle(cycle.id),
      input.dependencies.repository.listUtilityVendorPaymentFactsForCycle(cycle.id)
    ])
    const rentDueDate = billingPeriodLockDate(
      BillingPeriod.fromString(cycle.period),
      input.settings.rentDueDay
    )
    const utilitiesDueDate = billingPeriodLockDate(
      BillingPeriod.fromString(cycle.period),
      input.settings.utilitiesDueDay
    )
    const utilityPlanSummaryByMemberId = (() => {
      const plan = currentUtilityBillingPlanRecord(utilityPlans)
      return plan ? utilityPlanPaymentSummariesByMemberId({ plan, vendorFacts }) : null
    })()

    for (const line of baseLines) {
      const current = overdueByMemberId.get(line.memberId) ?? {
        rent: { amountMinor: 0n, periods: [] },
        utilities: { amountMinor: 0n, periods: [] }
      }

      const rentDueMinor = adjustedPaymentBaseMinor({
        kind: 'rent',
        baseMinor: line.rentShare.amountMinor,
        purchaseOffsetMinor: line.purchaseOffset.amountMinor,
        carryoverCreditMinor:
          cycle.id === input.currentCycle.id
            ? (input.activeCarryoverCreditByMemberId?.get(line.memberId) ?? 0n)
            : 0n,
        settings: input.settings
      })
      const rentRemainingMinor = effectiveRemainingMinor(rentDueMinor, line.rentPaid.amountMinor)
      if (Temporal.PlainDate.compare(localDate, rentDueDate) > 0 && rentRemainingMinor > 0n) {
        current.rent.amountMinor += rentRemainingMinor
        current.rent.periods.push(cycle.period)
      }

      const plannedSummary = utilityPlanSummaryByMemberId?.get(line.memberId) ?? null
      const plannedUtilityRemainingMinor = plannedSummary
        ? utilityPlanRemainingAfterRecordedPayments({
            plannedSummary,
            recordedPaid: line.utilityPaid
          }).remaining.amountMinor
        : null
      const utilityRemainingMinor =
        plannedUtilityRemainingMinor ??
        effectiveRemainingMinor(line.utilityShare.amountMinor, line.utilityPaid.amountMinor)
      if (
        Temporal.PlainDate.compare(localDate, utilitiesDueDate) > 0 &&
        utilityRemainingMinor > 0n
      ) {
        current.utilities.amountMinor += utilityRemainingMinor
        current.utilities.periods.push(cycle.period)
      }

      overdueByMemberId.set(line.memberId, current)
    }
  }

  return new Map(
    [...overdueByMemberId.entries()].map(([memberId, overdue]) => {
      const items: FinanceMemberOverduePaymentRecord[] = []
      if (overdue.rent.amountMinor > 0n) {
        items.push({
          kind: 'rent',
          amountMinor: overdue.rent.amountMinor,
          periods: overdue.rent.periods
        })
      }
      if (overdue.utilities.amountMinor > 0n) {
        items.push({
          kind: 'utilities',
          amountMinor: overdue.utilities.amountMinor,
          periods: overdue.utilities.periods
        })
      }

      return [memberId, items] as const
    })
  )
}

async function buildPaymentPeriodSummaries(input: {
  dependencies: FinanceCommandServiceDependencies
  currentCycle: FinanceCycleRecord
  members: readonly HouseholdMemberRecord[]
  memberPresenceDays: readonly HouseholdMemberPresenceDaysRecord[]
  settings: HouseholdBillingSettingsRecord
  activeCarryoverCreditByMemberId?: ReadonlyMap<string, bigint>
  todayOverride?: string
}): Promise<readonly FinanceDashboardPaymentPeriodSummary[]> {
  const localDate = input.todayOverride
    ? Temporal.PlainDate.from(input.todayOverride)
    : localDateInTimezone(input.settings.timezone)
  const memberNameById = new Map(input.members.map((member) => [member.id, member.displayName]))
  const cycles = (await input.dependencies.repository.listCycles())
    .filter((cycle) => cycle.period.localeCompare(input.currentCycle.period) <= 0)
    .sort((left, right) => right.period.localeCompare(left.period))

  const summaries: FinanceDashboardPaymentPeriodSummary[] = []

  for (const cycle of cycles) {
    const [baseLines, utilityBills, utilityPlans, vendorFacts] = await Promise.all([
      buildCycleBaseMemberLines({
        dependencies: input.dependencies,
        cycle,
        members: input.members,
        memberPresenceDays: input.memberPresenceDays,
        settings: input.settings
      }),
      input.dependencies.repository.listUtilityBillsForCycle(cycle.id),
      input.dependencies.repository.listUtilityBillingPlansForCycle(cycle.id),
      input.dependencies.repository.listUtilityVendorPaymentFactsForCycle(cycle.id)
    ])

    const utilityTotal = utilityBills.reduce(
      (sum, bill) => sum.add(Money.fromMinor(bill.amountMinor, bill.currency)),
      Money.zero(cycle.currency)
    )
    const rentDueDate = billingPeriodLockDate(
      BillingPeriod.fromString(cycle.period),
      input.settings.rentDueDay
    )
    const rentReminderDate = billingPeriodLockDate(
      BillingPeriod.fromString(cycle.period),
      input.settings.rentWarningDay
    )
    const utilitiesDueDate = billingPeriodLockDate(
      BillingPeriod.fromString(cycle.period),
      input.settings.utilitiesDueDay
    )
    const utilityPlanSummaryByMemberId = (() => {
      const plan = currentUtilityBillingPlanRecord(utilityPlans)
      return plan ? utilityPlanPaymentSummariesByMemberId({ plan, vendorFacts }) : null
    })()
    const rentIsActionable =
      cycle.period !== input.currentCycle.period ||
      Temporal.PlainDate.compare(localDate, rentReminderDate) >= 0

    const rentMembers = baseLines.map((line) => {
      const dueMinor = actionablePaymentDueMinor({
        kind: 'rent',
        baseMinor: line.rentShare.amountMinor,
        purchaseOffsetMinor: line.purchaseOffset.amountMinor,
        carryoverCreditMinor:
          cycle.id === input.currentCycle.id
            ? (input.activeCarryoverCreditByMemberId?.get(line.memberId) ?? 0n)
            : 0n,
        settings: input.settings
      })
      const remainingMinor = effectiveRemainingMinor(dueMinor, line.rentPaid.amountMinor)
      return {
        memberId: line.memberId,
        displayName: memberNameById.get(line.memberId) ?? line.memberId,
        suggestedAmount: Money.fromMinor(
          roundSuggestedPaymentMinor('rent', remainingMinor),
          cycle.currency
        ),
        baseDue: Money.fromMinor(dueMinor, cycle.currency),
        paid: line.rentPaid,
        remaining: Money.fromMinor(remainingMinor, cycle.currency),
        effectivelySettled: remainingMinor === 0n
      } satisfies FinanceDashboardPaymentMemberSummary
    })
    const visibleRentMembers = rentIsActionable ? rentMembers : []

    const utilitiesMembers = baseLines.map((line) => {
      const plannedSummary = utilityPlanSummaryByMemberId?.get(line.memberId) ?? null
      if (plannedSummary) {
        const effectivePlannedSummary = utilityPlanRemainingAfterRecordedPayments({
          plannedSummary,
          recordedPaid: line.utilityPaid
        })

        return {
          memberId: line.memberId,
          displayName: memberNameById.get(line.memberId) ?? line.memberId,
          suggestedAmount: effectivePlannedSummary.remaining,
          baseDue: effectivePlannedSummary.baseDue,
          paid: effectivePlannedSummary.paid,
          remaining: effectivePlannedSummary.remaining,
          effectivelySettled: effectivePlannedSummary.remaining.amountMinor === 0n
        } satisfies FinanceDashboardPaymentMemberSummary
      }

      const dueMinor = adjustedPaymentBaseMinor({
        kind: 'utilities',
        baseMinor: line.utilityShare.amountMinor,
        purchaseOffsetMinor: line.purchaseOffset.amountMinor,
        carryoverCreditMinor:
          cycle.id === input.currentCycle.id
            ? (input.activeCarryoverCreditByMemberId?.get(line.memberId) ?? 0n)
            : 0n,
        settings: input.settings
      })
      const remainingMinor = effectiveRemainingMinor(dueMinor, line.utilityPaid.amountMinor)
      return {
        memberId: line.memberId,
        displayName: memberNameById.get(line.memberId) ?? line.memberId,
        suggestedAmount: Money.fromMinor(remainingMinor, cycle.currency),
        baseDue: Money.fromMinor(dueMinor, cycle.currency),
        paid: line.utilityPaid,
        remaining: Money.fromMinor(remainingMinor, cycle.currency),
        effectivelySettled: remainingMinor === 0n
      } satisfies FinanceDashboardPaymentMemberSummary
    })

    const hasOverdueBalance =
      (Temporal.PlainDate.compare(localDate, rentDueDate) > 0 &&
        rentMembers.some((member) => !member.effectivelySettled)) ||
      (Temporal.PlainDate.compare(localDate, utilitiesDueDate) > 0 &&
        utilitiesMembers.some((member) => !member.effectivelySettled))

    summaries.push({
      period: cycle.period,
      utilityTotal,
      hasOverdueBalance,
      isCurrentPeriod: cycle.period === input.currentCycle.period,
      kinds: [
        {
          kind: 'rent',
          totalDue: rentMembers.reduce(
            (sum, member) => sum.add(member.baseDue),
            Money.zero(cycle.currency)
          ),
          totalPaid: rentMembers.reduce(
            (sum, member) => sum.add(member.paid),
            Money.zero(cycle.currency)
          ),
          totalRemaining: rentMembers.reduce(
            (sum, member) => sum.add(member.remaining),
            Money.zero(cycle.currency)
          ),
          unresolvedMembers: visibleRentMembers.filter((member) => !member.effectivelySettled)
        },
        {
          kind: 'utilities',
          totalDue: utilitiesMembers.reduce(
            (sum, member) => sum.add(member.baseDue),
            Money.zero(cycle.currency)
          ),
          totalPaid: utilitiesMembers.reduce(
            (sum, member) => sum.add(member.paid),
            Money.zero(cycle.currency)
          ),
          totalRemaining: utilitiesMembers.reduce(
            (sum, member) => sum.add(member.remaining),
            Money.zero(cycle.currency)
          ),
          unresolvedMembers: utilitiesMembers.filter((member) => !member.effectivelySettled)
        }
      ]
    })
  }

  return summaries
}

async function getCycleKindBaseRemaining(input: {
  dependencies: FinanceCommandServiceDependencies
  cycle: FinanceCycleRecord
  members: readonly HouseholdMemberRecord[]
  memberPresenceDays: readonly HouseholdMemberPresenceDaysRecord[]
  settings: HouseholdBillingSettingsRecord
  memberId: string
  kind: FinancePaymentKind
}): Promise<bigint> {
  const baseLine = (
    await buildCycleBaseMemberLines({
      dependencies: input.dependencies,
      cycle: input.cycle,
      members: input.members,
      memberPresenceDays: input.memberPresenceDays,
      settings: input.settings
    })
  ).find((line) => line.memberId === input.memberId)

  if (!baseLine) {
    return 0n
  }

  return input.kind === 'rent'
    ? effectiveRemainingMinor(baseLine.rentShare.amountMinor, baseLine.rentPaid.amountMinor)
    : effectiveRemainingMinor(baseLine.utilityShare.amountMinor, baseLine.utilityPaid.amountMinor)
}

async function resolveAutomaticPaymentTargets(input: {
  dependencies: FinanceCommandServiceDependencies
  currentCycle: FinanceCycleRecord
  members: readonly HouseholdMemberRecord[]
  memberPresenceDays: readonly HouseholdMemberPresenceDaysRecord[]
  settings: HouseholdBillingSettingsRecord
  memberId: string
  kind: FinancePaymentKind
}): Promise<
  readonly {
    cycle: FinanceCycleRecord
    baseRemainingMinor: bigint
    allowOverflow: boolean
  }[]
> {
  const localDate = localDateInTimezone(input.settings.timezone)
  const cycles = (await input.dependencies.repository.listCycles()).filter(
    (cycle) => cycle.period.localeCompare(input.currentCycle.period) <= 0
  )
  const overdueTargets: {
    cycle: FinanceCycleRecord
    baseRemainingMinor: bigint
    allowOverflow: boolean
  }[] = []

  for (const cycle of cycles) {
    const baseLine = (
      await buildCycleBaseMemberLines({
        dependencies: input.dependencies,
        cycle,
        members: input.members,
        memberPresenceDays: input.memberPresenceDays,
        settings: input.settings
      })
    ).find((line) => line.memberId === input.memberId)

    if (!baseLine) {
      continue
    }

    const dueDate = billingPeriodLockDate(
      BillingPeriod.fromString(cycle.period),
      input.kind === 'rent' ? input.settings.rentDueDay : input.settings.utilitiesDueDay
    )
    if (Temporal.PlainDate.compare(localDate, dueDate) <= 0) {
      continue
    }

    const remainingMinor =
      input.kind === 'rent'
        ? effectiveRemainingMinor(baseLine.rentShare.amountMinor, baseLine.rentPaid.amountMinor)
        : effectiveRemainingMinor(
            baseLine.utilityShare.amountMinor,
            baseLine.utilityPaid.amountMinor
          )

    if (remainingMinor <= 0n) {
      continue
    }

    overdueTargets.push({
      cycle,
      baseRemainingMinor: remainingMinor,
      allowOverflow: false
    })
  }

  const currentCycleAlreadyIncluded = overdueTargets.some(
    (target) => target.cycle.id === input.currentCycle.id
  )

  if (currentCycleAlreadyIncluded) {
    return overdueTargets.map((target, index) => ({
      ...target,
      allowOverflow: index === overdueTargets.length - 1
    }))
  }

  return [
    ...overdueTargets,
    {
      cycle: input.currentCycle,
      baseRemainingMinor: 0n,
      allowOverflow: true
    }
  ]
}

async function buildFinanceDashboard(
  dependencies: FinanceCommandServiceDependencies,
  periodArg?: string,
  options: {
    todayOverride?: string
    skipPlanRebalance?: boolean
  } = {}
): Promise<FinanceDashboard | null> {
  const cycle = await getCycleByPeriodOrLatest(dependencies.repository, periodArg)
  if (!cycle) {
    return null
  }

  const [members, memberPresenceDays, rentRule, settings] = await Promise.all([
    dependencies.householdConfigurationRepository.listHouseholdMembers(dependencies.householdId),
    dependencies.householdConfigurationRepository.listHouseholdMemberPresenceDays?.(
      dependencies.householdId
    ) ?? Promise.resolve([]),
    dependencies.repository.getRentRuleForPeriod(cycle.period),
    dependencies.householdConfigurationRepository.getHouseholdBillingSettings(
      dependencies.householdId
    )
  ])

  if (members.length === 0) {
    throw new Error('No household members configured')
  }

  const rentAmountMinor = rentRule?.amountMinor ?? 0n
  const rentCurrency = rentRule?.currency ?? cycle.currency

  const period = BillingPeriod.fromString(cycle.period)
  const { start, end } = monthRange(period)
  const resolvedParticipation = resolveMemberCycleParticipation({
    members,
    presenceDays: memberPresenceDays,
    period: cycle.period
  })
  const [allPurchases, utilityBills, paymentPurchaseAllocations, balanceLedgerEntries] =
    await Promise.all([
      dependencies.repository.listParsedPurchases(),
      dependencies.repository.listUtilityBillsForCycle(cycle.id),
      dependencies.repository.listPaymentPurchaseAllocations(),
      dependencies.repository.listBalanceLedgerEntries()
    ])
  const allCyclesForCarryover = await dependencies.repository.listCycles()
  const reservedCarryoverCreditByMemberId = await reservedCarryoverCreditByMember({
    repository: dependencies.repository,
    cycles: allCyclesForCarryover,
    beforePeriod: cycle.period,
    currency: cycle.currency
  })
  const activeCarryoverCreditByMemberId = activeBalanceCreditByMember({
    entries: balanceLedgerEntries,
    beforePeriod: cycle.period,
    currency: cycle.currency,
    reservedCreditByMemberId: reservedCarryoverCreditByMemberId
  })
  const paymentRecords = await dependencies.repository.listPaymentRecordsForCycle(cycle.id)
  const previousCycle = await dependencies.repository.getCycleByPeriod(period.previous().toString())
  const previousSnapshotLines = previousCycle
    ? await dependencies.repository.getSettlementSnapshotLines(previousCycle.id)
    : []
  const previousUtilityShareByMemberId = new Map(
    previousSnapshotLines.map((line) => [
      line.memberId,
      Money.fromMinor(line.utilityShareMinor, cycle.currency)
    ])
  )

  const convertedRent = await convertIntoCycleCurrency(dependencies, {
    cycle,
    period,
    lockDay: settings.rentWarningDay,
    timezone: settings.timezone,
    amount: Money.fromMinor(rentAmountMinor, rentCurrency)
  })

  const convertedUtilityBills = await Promise.all(
    utilityBills.map(async (bill) => {
      const converted = await convertIntoCycleCurrency(dependencies, {
        cycle,
        period,
        lockDay: settings.utilitiesReminderDay,
        timezone: settings.timezone,
        amount: Money.fromMinor(bill.amountMinor, bill.currency)
      })

      return {
        bill,
        converted
      }
    })
  )

  const convertedPurchases = await Promise.all(
    allPurchases.map(async (purchase) => {
      const converted = await convertIntoCycleCurrency(dependencies, {
        cycle,
        period,
        lockDay: settings.rentWarningDay,
        timezone: settings.timezone,
        amount: Money.fromMinor(purchase.amountMinor, purchase.currency)
      })

      return {
        purchase,
        converted
      }
    })
  )

  const currentCyclePurchaseIds = new Set(
    allPurchases
      .filter((purchase) => {
        if (purchase.cycleId === cycle.id || purchase.cyclePeriod === cycle.period) {
          return true
        }

        if (purchase.cycleId) {
          return false
        }

        if (!purchase.occurredAt) {
          return false
        }

        return (
          Temporal.Instant.compare(purchase.occurredAt, start) >= 0 &&
          Temporal.Instant.compare(purchase.occurredAt, end) < 0
        )
      })
      .map((purchase) => purchase.id)
  )

  const activePurchaseParticipantIds = members
    .filter((member) => member.status === 'active')
    .map((member) => member.id)

  const purchaseHistory: PurchaseHistoryState[] = convertedPurchases.map(
    ({ purchase, converted }) => {
      const shareMap = buildPurchaseShareMap({
        purchase,
        amount: converted.settlementAmount,
        activePurchaseParticipantIds
      })
      const outstandingEntries = [...shareMap.entries()]
        .filter(([memberId]) => memberId !== purchase.payerMemberId)
        .map(([memberId, shareAmount]) => {
          const allocatedMinor = sumAllocationMinor(
            paymentPurchaseAllocations,
            purchase.id,
            memberId
          )
          const outstandingMinor =
            shareAmount.amountMinor > allocatedMinor ? shareAmount.amountMinor - allocatedMinor : 0n

          return [
            memberId,
            Money.fromMinor(outstandingMinor, converted.settlementAmount.currency)
          ] as const
        })
        .filter(([, amount]) => amount.amountMinor > 0n)

      const outstandingByMemberId = new Map<string, Money>(outstandingEntries)
      const outstandingTotal = outstandingEntries.reduce(
        (sum, [, amount]) => sum.add(amount),
        Money.zero(converted.settlementAmount.currency)
      )
      const resolvedAt =
        outstandingEntries.length === 0
          ? (paymentPurchaseAllocations
              .filter((allocation) => allocation.purchaseId === purchase.id)
              .map((allocation) => allocation.recordedAt.toString())
              .sort()
              .at(-1) ?? null)
          : null

      return {
        purchase,
        converted,
        outstandingByMemberId,
        outstandingTotal,
        resolvedAt
      }
    }
  )

  const utilities = convertedUtilityBills.reduce(
    (sum, current) => sum.add(current.converted.settlementAmount),
    Money.zero(cycle.currency)
  )

  const settlement = calculateMonthlySettlement({
    cycleId: BillingCycleId.from(cycle.id),
    period,
    rent: convertedRent.settlementAmount,
    utilities,
    utilitySplitMode: 'weighted_by_days',
    members: members.map((member) => {
      const participation = resolvedParticipation.get(member.id)

      return {
        memberId: MemberId.from(member.id),
        active: member.status !== 'left',
        participatesInRent: member.status !== 'left',
        participatesInUtilities: member.status !== 'left' && (participation?.daysPresent ?? 0) > 0,
        participatesInPurchases: member.status === 'active',
        rentWeight: member.rentShareWeight,
        utilityDays: Math.max(participation?.daysPresent ?? 0, 1)
      }
    }),
    purchases: purchaseHistory
      .filter(({ outstandingTotal }) => outstandingTotal.amountMinor > 0n)
      .map(({ purchase, converted, outstandingByMemberId, outstandingTotal }) => {
        const nextPurchase: {
          purchaseId: PurchaseEntryId
          payerId: MemberId
          amount: Money
          splitMode: 'equal' | 'custom_amounts'
          participants?: {
            memberId: MemberId
            shareAmount?: Money
          }[]
        } = {
          purchaseId: PurchaseEntryId.from(purchase.id),
          payerId: MemberId.from(purchase.payerMemberId),
          amount: currentCyclePurchaseIds.has(purchase.id)
            ? converted.settlementAmount
            : outstandingTotal,
          splitMode: 'custom_amounts'
        }

        const participantShareMap = currentCyclePurchaseIds.has(purchase.id)
          ? buildPurchaseShareMap({
              purchase,
              amount: converted.settlementAmount,
              activePurchaseParticipantIds
            })
          : outstandingByMemberId

        nextPurchase.participants = [...participantShareMap.entries()]
          .filter(([memberId]) =>
            currentCyclePurchaseIds.has(purchase.id) ? true : memberId !== purchase.payerMemberId
          )
          .map(([memberId, shareAmount]) => ({
            memberId: MemberId.from(memberId),
            shareAmount
          }))

        return nextPurchase
      })
  })

  await dependencies.repository.replaceSettlementSnapshot({
    cycleId: cycle.id,
    inputHash: computeInputHash({
      cycleId: cycle.id,
      rentMinor: convertedRent.settlementAmount.amountMinor.toString(),
      utilitiesMinor: utilities.amountMinor.toString(),
      purchaseMinors: convertedPurchases.map(({ purchase, converted }) => ({
        id: purchase.id,
        minor: converted.settlementAmount.amountMinor.toString(),
        currency: converted.settlementAmount.currency
      })),
      memberCount: members.length
    }),
    totalDueMinor: settlement.totalDue.amountMinor,
    currency: cycle.currency,
    metadata: {
      generatedBy: 'bot-command',
      source: 'finance-service',
      rentSourceMinor: convertedRent.originalAmount.amountMinor.toString(),
      rentSourceCurrency: convertedRent.originalAmount.currency,
      rentFxRateMicros: convertedRent.fxRateMicros?.toString() ?? null,
      rentFxEffectiveDate: convertedRent.fxEffectiveDate
    },
    lines: settlement.lines.map((line) => ({
      memberId: line.memberId.toString(),
      rentShareMinor: line.rentShare.amountMinor,
      utilityShareMinor: line.utilityShare.amountMinor,
      purchaseOffsetMinor: line.purchaseOffset.amountMinor,
      netDueMinor: line.netDue.amountMinor,
      explanations: line.explanations
    }))
  })

  const memberNameById = new Map(members.map((member) => [member.id, member.displayName]))
  const paymentsByMemberId = new Map<string, Money>()

  for (const payment of paymentRecords) {
    const current = paymentsByMemberId.get(payment.memberId) ?? Money.zero(cycle.currency)
    paymentsByMemberId.set(
      payment.memberId,
      current.add(Money.fromMinor(payment.amountMinor, payment.currency))
    )
  }
  const ensuredUtilityPlan = await ensureUtilityBillingPlan({
    dependencies,
    cycle,
    members,
    settings,
    settlementLines: settlement.lines.map((line) => ({
      memberId: line.memberId.toString(),
      utilityShare: line.utilityShare,
      purchaseOffset: line.purchaseOffset
    })),
    activeCarryoverCreditByMemberId,
    convertedUtilityBills,
    purchaseIds: [...currentCyclePurchaseIds],
    ...(options.skipPlanRebalance ? { skipRebalance: true } : {})
  })
  const overduePaymentsByMemberId = await computeMemberOverduePayments({
    dependencies,
    currentCycle: cycle,
    members,
    memberPresenceDays,
    settings,
    activeCarryoverCreditByMemberId,
    ...(options.todayOverride ? { todayOverride: options.todayOverride } : {})
  })
  const currentPlanCarryForwardCreditByMemberId = new Map<string, bigint>()
  if (ensuredUtilityPlan.record?.status === 'settled' && ensuredUtilityPlan.computed) {
    for (const credit of ensuredUtilityPlan.computed.carryForwardCredits ?? []) {
      const signedCreditMinor = credit.creditCreated.amountMinor - credit.creditConsumed.amountMinor
      if (signedCreditMinor !== 0n) {
        currentPlanCarryForwardCreditByMemberId.set(
          credit.memberId,
          (currentPlanCarryForwardCreditByMemberId.get(credit.memberId) ?? 0n) + signedCreditMinor
        )
      }
    }
  }
  const dashboardMembers = settlement.lines.map((line) => {
    const memberId = line.memberId.toString()
    const carryForwardCredit = Money.fromMinor(
      clampNonNegativeMinor(
        (activeCarryoverCreditByMemberId.get(memberId) ?? 0n) +
          (currentPlanCarryForwardCreditByMemberId.get(memberId) ?? 0n)
      ),
      cycle.currency
    )
    const paid = paymentsByMemberId.get(memberId) ?? Money.zero(cycle.currency)

    return {
      memberId,
      displayName: memberNameById.get(memberId) ?? memberId,
      status: members.find((member) => member.id === memberId)?.status ?? 'active',
      daysPresent: resolvedParticipation.get(memberId)?.daysPresent ?? 0,
      predictedUtilityShare: previousUtilityShareByMemberId.get(memberId) ?? null,
      rentShare: line.rentShare,
      utilityShare: line.utilityShare,
      purchaseOffset: line.purchaseOffset,
      carryForwardCredit,
      effectivePurchaseBalance: line.purchaseOffset.subtract(carryForwardCredit),
      netDue: line.netDue,
      paid,
      remaining: line.netDue.subtract(paid),
      overduePayments:
        overduePaymentsByMemberId.get(memberId)?.map((overdue) => ({
          kind: overdue.kind,
          amountMinor: overdue.amountMinor,
          periods: overdue.periods
        })) ?? [],
      explanations: line.explanations
    }
  })
  const paymentPeriods = await buildPaymentPeriodSummaries({
    dependencies,
    currentCycle: cycle,
    members,
    memberPresenceDays,
    settings,
    activeCarryoverCreditByMemberId,
    ...(options.todayOverride ? { todayOverride: options.todayOverride } : {})
  })
  const utilityPlanVersions = await dependencies.repository.listUtilityBillingPlansForCycle(
    cycle.id
  )
  const utilityPlanVersionById = new Map(
    utilityPlanVersions.map((plan) => [plan.id, plan.version] as const)
  )
  const dashboardUtilityBillingPlan =
    ensuredUtilityPlan.record && ensuredUtilityPlan.computed
      ? buildDashboardUtilityBillingPlan({
          planRecord: ensuredUtilityPlan.record,
          computed: ensuredUtilityPlan.computed,
          memberNameById,
          priorVersionByPlanId: utilityPlanVersionById
        })
      : null
  const rentPaidByMemberId = new Map<string, Money>()
  for (const payment of paymentRecords.filter((payment) => payment.kind === 'rent')) {
    rentPaidByMemberId.set(
      payment.memberId,
      (rentPaidByMemberId.get(payment.memberId) ?? Money.zero(cycle.currency)).add(
        Money.fromMinor(payment.amountMinor, payment.currency)
      )
    )
  }
  const rentBillingState: FinanceDashboardRentBillingState = {
    dueDate: billingPeriodLockDate(period, settings.rentDueDay).toString(),
    paymentDestinations: settings.rentPaymentDestinations ?? null,
    memberSummaries: dashboardMembers.map((member) => {
      const paid = rentPaidByMemberId.get(member.memberId) ?? Money.zero(cycle.currency)
      const dueMinor = actionablePaymentDueMinor({
        kind: 'rent',
        baseMinor: member.rentShare.amountMinor,
        purchaseOffsetMinor: member.purchaseOffset.amountMinor,
        carryoverCreditMinor: activeCarryoverCreditByMemberId.get(member.memberId) ?? 0n,
        settings
      })
      return {
        memberId: member.memberId,
        displayName: member.displayName,
        due: Money.fromMinor(dueMinor, cycle.currency),
        paid,
        remaining: Money.fromMinor(
          effectiveRemainingMinor(dueMinor, paid.amountMinor),
          cycle.currency
        )
      }
    })
  }
  const billingStage = resolveBillingStage({
    period: cycle.period,
    settings,
    utilityBillingPlan: dashboardUtilityBillingPlan,
    rentBillingState,
    ...(options.todayOverride ? { todayOverride: options.todayOverride } : {})
  })

  const ledger: FinanceDashboardLedgerEntry[] = [
    ...convertedUtilityBills.map(({ bill, converted }) => ({
      id: bill.id,
      kind: 'utility' as const,
      title: bill.billName,
      memberId: bill.createdByMemberId,
      amount: converted.originalAmount,
      currency: bill.currency,
      displayAmount: converted.settlementAmount,
      displayCurrency: cycle.currency,
      fxRateMicros: converted.fxRateMicros,
      fxEffectiveDate: converted.fxEffectiveDate,
      actorDisplayName: bill.createdByMemberId
        ? (memberNameById.get(bill.createdByMemberId) ?? null)
        : null,
      occurredAt: bill.createdAt.toString(),
      paymentKind: null
    })),
    ...purchaseHistory.map(({ purchase, converted, outstandingByMemberId, resolvedAt }) => {
      const entry: FinanceDashboardLedgerEntry = {
        id: purchase.id,
        kind: 'purchase',
        title: purchase.description ?? 'Shared purchase',
        memberId: purchase.payerMemberId,
        payerMemberId: purchase.payerMemberId,
        amount: converted.originalAmount,
        currency: purchase.currency,
        displayAmount: converted.settlementAmount,
        displayCurrency: cycle.currency,
        fxRateMicros: converted.fxRateMicros,
        fxEffectiveDate: converted.fxEffectiveDate,
        actorDisplayName: memberNameById.get(purchase.payerMemberId) ?? null,
        occurredAt: purchase.occurredAt?.toString() ?? null,
        paymentKind: null,
        purchaseSplitMode: purchase.splitMode ?? 'equal',
        originPeriod: purchaseOriginPeriod(purchase),
        isCurrentCyclePurchase: currentCyclePurchaseIds.has(purchase.id),
        resolutionStatus: outstandingByMemberId.size === 0 ? 'resolved' : 'unresolved',
        resolvedAt,
        outstandingByMember: [...outstandingByMemberId.entries()].map(([memberId, amount]) => ({
          memberId,
          amount
        }))
      }

      if (purchase.participants) {
        entry.purchaseParticipants = purchase.participants.map((participant) => ({
          memberId: participant.memberId,
          included: participant.included !== false,
          shareAmount:
            participant.shareAmountMinor !== null
              ? Money.fromMinor(participant.shareAmountMinor, converted.settlementAmount.currency)
              : null
        }))
      }

      return entry
    }),
    ...paymentRecords.map((payment) => ({
      id: payment.id,
      kind: 'payment' as const,
      title: payment.kind,
      memberId: payment.memberId,
      amount: Money.fromMinor(payment.amountMinor, payment.currency),
      currency: payment.currency,
      displayAmount: Money.fromMinor(payment.amountMinor, payment.currency),
      displayCurrency: payment.currency,
      fxRateMicros: null,
      fxEffectiveDate: null,
      actorDisplayName: memberNameById.get(payment.memberId) ?? null,
      occurredAt: payment.recordedAt.toString(),
      paymentKind: payment.kind
    }))
  ].sort((left, right) => {
    if (left.occurredAt === right.occurredAt) {
      return right.title.localeCompare(left.title)
    }

    return (right.occurredAt ?? '').localeCompare(left.occurredAt ?? '')
  })

  return {
    period: cycle.period,
    currency: cycle.currency,
    timezone: settings.timezone,
    rentWarningDay: settings.rentWarningDay,
    rentDueDay: settings.rentDueDay,
    utilitiesReminderDay: settings.utilitiesReminderDay,
    utilitiesDueDay: settings.utilitiesDueDay,
    paymentBalanceAdjustmentPolicy: settings.paymentBalanceAdjustmentPolicy ?? 'utilities',
    rentPaymentDestinations: settings.rentPaymentDestinations ?? null,
    totalDue: settlement.totalDue,
    totalPaid: paymentRecords.reduce(
      (sum, payment) => sum.add(Money.fromMinor(payment.amountMinor, payment.currency)),
      Money.zero(cycle.currency)
    ),
    totalRemaining: dashboardMembers.reduce(
      (sum, member) => sum.add(member.remaining),
      Money.zero(cycle.currency)
    ),
    rentSourceAmount: convertedRent.originalAmount,
    rentDisplayAmount: convertedRent.settlementAmount,
    rentFxRateMicros: convertedRent.fxRateMicros,
    rentFxEffectiveDate: convertedRent.fxEffectiveDate,
    billingStage,
    utilityBillingPlan: dashboardUtilityBillingPlan,
    rentBillingState,
    members: dashboardMembers,
    paymentPeriods,
    ledger
  }
}

async function allocatePaymentPurchaseOverage(input: {
  dependencies: FinanceCommandServiceDependencies
  cyclePeriod: string
  memberId: string
  kind: FinancePaymentKind
  paymentAmount: Money
  settings: HouseholdBillingSettingsRecord
  // When re-resolving an existing payment, the allocations it already holds have
  // reduced the outstanding balances visible in the dashboard. Pass the payment id
  // so its own prior allocations are added back, letting the recompute reproduce
  // the full allocation set. Without this, a re-resolve only sees newly-found debt
  // and the subsequent replace silently drops the earlier (still valid) resolutions.
  reresolvePaymentRecordId?: string
}): Promise<{
  allocations: readonly {
    purchaseId: string
    memberId: string
    amountMinor: bigint
  }[]
  resolutionMethod: 'utilities_plan' | 'rent_plan'
  resolutionPlanId: string | null
}> {
  const policy = input.settings.paymentBalanceAdjustmentPolicy ?? 'utilities'
  if (policy === 'separate' || policy !== input.kind) {
    return {
      allocations: [],
      resolutionMethod: input.kind === 'utilities' ? 'utilities_plan' : 'rent_plan',
      resolutionPlanId: null
    }
  }

  const dashboard = await buildFinanceDashboard(input.dependencies, input.cyclePeriod, {
    skipPlanRebalance: true
  })
  if (!dashboard) {
    return {
      allocations: [],
      resolutionMethod: input.kind === 'utilities' ? 'utilities_plan' : 'rent_plan',
      resolutionPlanId: null
    }
  }

  const memberLine = dashboard.members.find((member) => member.memberId === input.memberId)
  if (!memberLine) {
    return {
      allocations: [],
      resolutionMethod: input.kind === 'utilities' ? 'utilities_plan' : 'rent_plan',
      resolutionPlanId: null
    }
  }

  // Check if there's an active utility billing plan with rebalanced amounts
  const utilityPlan = dashboard.utilityBillingPlan
  const plannedSummary = utilityPlan?.memberSummaries.find(
    (summary) => summary.memberId === input.memberId
  )

  // A plan-matched payment only covers purchases the plan actually priced into
  // member fair shares: the current-cycle purchases recorded on the plan, plus any
  // carried-over purchases from earlier cycles (folded in via purchase offset).
  // A current-cycle purchase that is NOT on the plan was logged after the plan was
  // materialized and was never paid for, so it must not be auto-resolved here —
  // otherwise a buy made on an already-settled plan closes itself for free.
  const planAccountedPurchaseIds = new Set(utilityPlan?.accountedPurchaseIds ?? [])
  const isPurchaseCoveredByPlan = (
    entry: FinanceDashboardLedgerEntry & { kind: 'purchase' }
  ): boolean => {
    if (!utilityPlan) {
      return true
    }
    if (planAccountedPurchaseIds.has(entry.id)) {
      return true
    }
    // Carried over from an earlier cycle — its offset is baked into this plan.
    return entry.isCurrentCyclePurchase !== true
  }

  // Add back this payment's own prior allocations (see reresolvePaymentRecordId).
  const priorAllocationByPurchaseId = new Map<string, bigint>()
  if (input.reresolvePaymentRecordId) {
    const allAllocations = await input.dependencies.repository.listPaymentPurchaseAllocations()
    for (const allocation of allAllocations) {
      if (
        allocation.paymentRecordId === input.reresolvePaymentRecordId &&
        allocation.memberId === input.memberId
      ) {
        priorAllocationByPurchaseId.set(
          allocation.purchaseId,
          (priorAllocationByPurchaseId.get(allocation.purchaseId) ?? 0n) + allocation.amountMinor
        )
      }
    }
  }
  const memberOutstandingMinor = (
    entry: FinanceDashboardLedgerEntry & {
      kind: 'purchase'
      outstandingByMember: readonly { memberId: string; amount: Money }[]
    }
  ): bigint => {
    const current =
      entry.outstandingByMember.find((o) => o.memberId === input.memberId)?.amount.amountMinor ?? 0n
    return current + (priorAllocationByPurchaseId.get(entry.id) ?? 0n)
  }
  const isPurchaseEntry = (
    entry: FinanceDashboardLedgerEntry
  ): entry is FinanceDashboardLedgerEntry & {
    kind: 'purchase'
    outstandingByMember: readonly { memberId: string; amount: Money }[]
  } => entry.kind === 'purchase' && Array.isArray(entry.outstandingByMember)

  let remainingMinor: bigint

  if (plannedSummary && input.kind === 'utilities') {
    // When paying utilities with an active plan, check if payment matches the planned amount
    const plannedAmountMinor = plannedSummary.fairShare.amountMinor
    const paymentMatchesPlan =
      input.paymentAmount.amountMinor >= plannedAmountMinor &&
      input.paymentAmount.amountMinor <= plannedAmountMinor + 100n // Allow small rounding differences

    if (paymentMatchesPlan) {
      // Payment matches plan - allocate based on gross outstanding purchase debt.
      // The net purchaseOffset can be 0 when paid/owed purchases cancel out,
      // but individual purchases still need resolution. The plan's fairShare
      // guarantees all debts are covered when every member pays their share.
      const grossOutstandingMinor = dashboard.ledger
        .filter(isPurchaseEntry)
        .filter((entry) => isPurchaseCoveredByPlan(entry))
        .reduce((sum, entry) => sum + memberOutstandingMinor(entry), 0n)

      remainingMinor = grossOutstandingMinor
    } else {
      // Payment doesn't match plan - use traditional overage calculation with BASE amount
      const baseAmount = memberLine.utilityShare
      const baseThresholdMinor = roundSuggestedPaymentMinor(input.kind, baseAmount.amountMinor)
      remainingMinor = input.paymentAmount.amountMinor - baseThresholdMinor
    }
  } else {
    // No plan or not utilities - use traditional overage calculation
    const baseAmount = input.kind === 'rent' ? memberLine.rentShare : memberLine.utilityShare
    const baseThresholdMinor = roundSuggestedPaymentMinor(input.kind, baseAmount.amountMinor)
    remainingMinor = input.paymentAmount.amountMinor - baseThresholdMinor
  }

  if (remainingMinor <= 0n) {
    return {
      allocations: [],
      resolutionMethod: input.kind === 'utilities' ? 'utilities_plan' : 'rent_plan',
      resolutionPlanId: utilityPlan?.id ?? null
    }
  }

  const purchaseEntries = dashboard.ledger
    .filter(isPurchaseEntry)
    .filter((entry) => isPurchaseCoveredByPlan(entry))
    .sort((left, right) => {
      const leftKey = `${left.originPeriod ?? ''}:${left.occurredAt ?? ''}:${left.id}`
      const rightKey = `${right.originPeriod ?? ''}:${right.occurredAt ?? ''}:${right.id}`
      return leftKey.localeCompare(rightKey)
    })

  const allocations: {
    purchaseId: string
    memberId: string
    amountMinor: bigint
  }[] = []

  for (const entry of purchaseEntries) {
    const outstandingMinor = memberOutstandingMinor(entry)
    if (outstandingMinor <= 0n) {
      continue
    }

    const allocatedMinor = remainingMinor >= outstandingMinor ? outstandingMinor : remainingMinor

    if (allocatedMinor <= 0n) {
      continue
    }

    allocations.push({
      purchaseId: entry.id,
      memberId: input.memberId,
      amountMinor: allocatedMinor
    })
    remainingMinor -= allocatedMinor

    if (remainingMinor === 0n) {
      break
    }
  }

  return {
    allocations,
    resolutionMethod: input.kind === 'utilities' ? 'utilities_plan' : 'rent_plan',
    resolutionPlanId: utilityPlan?.id ?? null
  }
}

export interface FinanceCommandService {
  getMemberByTelegramUserId(telegramUserId: string): Promise<FinanceMemberRecord | null>
  listMembers(): Promise<readonly FinanceMemberRecord[]>
  getOpenCycle(): Promise<FinanceCycleRecord | null>
  ensureExpectedCycle(referenceInstant?: Temporal.Instant): Promise<FinanceCycleRecord>
  getAdminCycleState(periodArg?: string): Promise<FinanceAdminCycleState>
  openCycle(periodArg: string, currencyArg?: string): Promise<FinanceCycleRecord>
  closeCycle(periodArg?: string): Promise<FinanceCycleRecord | null>
  setRent(
    amountArg: string,
    currencyArg?: string,
    periodArg?: string,
    fxRateMicrosArg?: string
  ): Promise<{
    amount: Money
    currency: CurrencyCode
    period: string
    fxRateMicros?: bigint | null
  } | null>
  addUtilityBill(
    billName: string,
    amountArg: string,
    createdByMemberId: string,
    currencyArg?: string,
    periodArg?: string
  ): Promise<{
    amount: Money
    currency: CurrencyCode
    period: string
  } | null>
  addUtilityBills(
    entries: readonly {
      billName: string
      amountMajor: string
    }[],
    createdByMemberId: string,
    currencyArg?: string,
    periodArg?: string
  ): Promise<{
    entries: readonly {
      billName: string
      amount: Money
    }[]
    currency: CurrencyCode
    period: string
  } | null>
  updateUtilityBill(
    billId: string,
    billName: string,
    amountArg: string,
    currencyArg?: string
  ): Promise<{
    billId: string
    amount: Money
    currency: CurrencyCode
  } | null>
  deleteUtilityBill(billId: string): Promise<boolean>
  updatePurchase(
    purchaseId: string,
    description: string,
    amountArg: string,
    currencyArg?: string,
    split?: {
      mode: 'equal' | 'custom_amounts'
      participants: readonly {
        memberId: string
        included?: boolean
        shareAmountMajor?: string
      }[]
    },
    payerMemberId?: string,
    occurredOnArg?: string
  ): Promise<{
    purchaseId: string
    amount: Money
    currency: CurrencyCode
  } | null>
  addPurchase(
    description: string,
    amountArg: string,
    payerMemberId: string,
    currencyArg?: string,
    split?: {
      mode: 'equal' | 'custom_amounts'
      participants: readonly {
        memberId: string
        included?: boolean
        shareAmountMajor?: string
      }[]
    },
    occurredOnArg?: string
  ): Promise<{
    purchaseId: string
    amount: Money
    currency: CurrencyCode
  }>
  deletePurchase(purchaseId: string): Promise<boolean>
  togglePurchaseParticipant?(
    participantId: string,
    actorTelegramUserId: string
  ): Promise<
    | {
        status: 'updated'
        purchase: FinanceParsedPurchaseRecord
      }
    | {
        status: 'not_found' | 'forbidden' | 'not_editable' | 'at_least_one_required'
      }
  >
  addPayment(
    memberId: string,
    kind: FinancePaymentKind,
    amountArg: string,
    currencyArg?: string,
    periodArg?: string
  ): Promise<{
    paymentId: string
    amount: Money
    currency: CurrencyCode
    period: string
  } | null>
  closePaymentPeriod(input: {
    periodArg: string
    kind: FinancePaymentKind
    actorMemberId: string
    memberIds?: readonly string[]
    allMembers?: boolean
  }): Promise<FinanceClosePaymentPeriodResult | null>
  updatePayment(
    paymentId: string,
    memberId: string,
    kind: FinancePaymentKind,
    amountArg: string,
    currencyArg?: string
  ): Promise<{
    paymentId: string
    amount: Money
    currency: CurrencyCode
  } | null>
  deletePayment(paymentId: string): Promise<boolean>
  getPayment(paymentId: string): Promise<FinancePaymentRecord | null>
  getPurchase(purchaseId: string): Promise<FinanceParsedPurchaseRecord | null>
  generateCurrentBillPlan(periodArg?: string): Promise<FinanceCurrentBillPlan | null>
  resolveUtilityBillAsPlanned(input: {
    memberId?: string
    actorMemberId?: string
    periodArg?: string
    allMembers?: boolean
  }): Promise<{
    period: string
    resolvedBillIds: readonly string[]
    resolvedAssignments: readonly {
      memberId: string
      displayName: string
      utilityBillId: string
      billName: string
      amount: Money
    }[]
    settledJustNow: boolean
    plan: FinanceDashboardUtilityBillingPlan | null
  } | null>
  recordUtilityVendorPayment(input: {
    utilityBillId: string
    payerMemberId: string
    actorMemberId?: string
    amountArg?: string
    currencyArg?: string
    periodArg?: string
  }): Promise<{
    period: string
    settledJustNow: boolean
    plan: FinanceDashboardUtilityBillingPlan | null
  } | null>
  recordUtilityReimbursement(input: {
    fromMemberId: string
    toMemberId: string
    actorMemberId?: string
    amountArg: string
    currencyArg?: string
    periodArg?: string
  }): Promise<{
    period: string
    plan: FinanceDashboardUtilityBillingPlan | null
  } | null>
  rebalanceUtilityPlan(periodArg?: string): Promise<FinanceDashboardUtilityBillingPlan | null>
  manuallyResolvePurchase(input: {
    purchaseId: string
    allocations: readonly {
      memberId: string
      amountMajor: string
    }[]
  }): Promise<{
    purchaseId: string
    resolvedAmount: Money
  }>
  generateDashboard(
    periodArg?: string,
    options?: {
      todayOverride?: string
    }
  ): Promise<FinanceDashboard | null>
  ensureDashboardMaterialized(
    periodArg?: string,
    options?: {
      todayOverride?: string
    }
  ): Promise<FinanceDashboard | null>
  generateBillingAuditExport(periodArg?: string): Promise<FinanceBillingAuditExport | null>
  generateStatement(periodArg?: string): Promise<string | null>
}

export function createFinanceCommandService(
  dependencies: FinanceCommandServiceDependencies
): FinanceCommandService {
  const { repository, householdConfigurationRepository } = dependencies

  async function ensureExpectedCycle(referenceInstant = nowInstant()): Promise<FinanceCycleRecord> {
    const settings = await householdConfigurationRepository.getHouseholdBillingSettings(
      dependencies.householdId
    )
    const period = expectedOpenCyclePeriod(settings, referenceInstant).toString()
    let cycle = await repository.getCycleByPeriod(period)

    if (!cycle) {
      await repository.openCycle(period, settings.settlementCurrency)
      cycle = await repository.getCycleByPeriod(period)
    }

    if (!cycle) {
      throw new Error(`Failed to ensure billing cycle for period ${period}`)
    }

    const openCycle = await repository.getOpenCycle()
    if (openCycle && openCycle.id !== cycle.id) {
      await repository.closeCycle(openCycle.id, referenceInstant)
    }

    if (settings.rentAmountMinor !== null) {
      await repository.saveRentRule(period, settings.rentAmountMinor, settings.rentCurrency, {
        overwriteExisting: false
      })
    }

    return cycle
  }

  async function ensureCycleForPeriod(
    settings: HouseholdBillingSettingsRecord,
    periodArg?: string
  ): Promise<FinanceCycleRecord> {
    if (!periodArg) {
      return ensureExpectedCycle()
    }

    const period = BillingPeriod.fromString(periodArg).toString()
    let cycle = await repository.getCycleByPeriod(period)
    if (!cycle) {
      await repository.openCycle(period, settings.settlementCurrency)
      cycle = await repository.getCycleByPeriod(period)
    }

    if (!cycle) {
      throw new Error(`Failed to ensure billing cycle for period ${period}`)
    }

    return cycle
  }

  function materializeDashboard(
    periodArg?: string,
    options?: {
      todayOverride?: string
    }
  ): Promise<FinanceDashboard | null> {
    return periodArg
      ? buildFinanceDashboard(dependencies, periodArg, {
          skipPlanRebalance: true,
          ...options
        })
      : ensureExpectedCycle().then(() =>
          buildFinanceDashboard(dependencies, undefined, {
            skipPlanRebalance: true,
            ...options
          })
        )
  }

  async function resolvePlannedUtilitiesForMember(input: {
    cycle: FinanceCycleRecord
    dashboard: FinanceDashboard
    utilityPlan: FinanceDashboardUtilityBillingPlan
    memberId: string
    actorMemberId?: string
    recordedAt: Instant
    existingVendorFacts: Awaited<
      ReturnType<FinanceRepository['listUtilityVendorPaymentFactsForCycle']>
    >
    existingPaymentRecords: Awaited<ReturnType<FinanceRepository['listPaymentRecordsForCycle']>>
  }): Promise<{ resolvedBillIds: readonly string[]; paymentRecorded: boolean }> {
    const plannedSummary = input.utilityPlan.memberSummaries.find(
      (summary) => summary.memberId === input.memberId
    )
    const categories = input.utilityPlan.categories.filter(
      (category) =>
        category.assignedMemberId === input.memberId && category.assignedAmount.amountMinor > 0n
    )
    if (!plannedSummary && categories.length === 0) {
      throw new Error('No planned utility bills assigned to this member')
    }

    const categoriesToRecord = categories
      .map((category) => {
        const alreadyPaidMinor = utilityMatchedPlanPaidMinor({
          plan: input.utilityPlan,
          vendorFacts: input.existingVendorFacts,
          utilityBillId: category.utilityBillId,
          payerMemberId: input.memberId
        })
        const remainingMinor = category.assignedAmount.amountMinor - alreadyPaidMinor

        return {
          category,
          remainingMinor: remainingMinor > 0n ? remainingMinor : 0n
        }
      })
      .filter((item) => item.remainingMinor > 0n)

    const existingMatchedPlanPaidMinor = input.existingVendorFacts
      .filter(
        (fact) =>
          utilityFactMatchesPlan(fact, input.utilityPlan) && fact.payerMemberId === input.memberId
      )
      .reduce((sum, fact) => sum + fact.amountMinor, 0n)
    const existingUtilityPaymentMinor = input.existingPaymentRecords
      .filter((payment) => payment.memberId === input.memberId && payment.kind === 'utilities')
      .reduce((sum, payment) => sum + payment.amountMinor, 0n)
    let insertedMatchedPlanPaidMinor = 0n
    const insertedBillIds: string[] = []
    for (const { category, remainingMinor } of categoriesToRecord) {
      const fact = await repository.addUtilityVendorPaymentFactIfNew({
        cycleId: input.cycle.id,
        planId: input.utilityPlan.id,
        utilityBillId: category.utilityBillId,
        billName: category.billName,
        payerMemberId: input.memberId,
        amountMinor: remainingMinor,
        currency: input.dashboard.currency,
        plannedForMemberId: input.memberId,
        planVersion: input.utilityPlan.version,
        matchedPlan: true,
        recordedByMemberId: input.actorMemberId ?? input.memberId,
        recordedAt: input.recordedAt,
        idempotencyKey: `close-payment-period:${dependencies.householdId}:${input.cycle.id}:utility-vendor:${input.utilityPlan.id}:${category.utilityBillId}:${input.memberId}`
      })
      if (fact) {
        insertedMatchedPlanPaidMinor += fact.amountMinor
        insertedBillIds.push(category.utilityBillId)
      }
    }

    const existingPaymentRecord = input.existingPaymentRecords
      .filter((payment) => payment.memberId === input.memberId && payment.kind === 'utilities')
      .sort((left, right) =>
        (right.recordedAt.toString() ?? '').localeCompare(left.recordedAt.toString() ?? '')
      )[0]
    const settings = await householdConfigurationRepository.getHouseholdBillingSettings(
      dependencies.householdId
    )
    const effectivePaymentAmountMinor =
      existingMatchedPlanPaidMinor + insertedMatchedPlanPaidMinor > existingUtilityPaymentMinor
        ? existingMatchedPlanPaidMinor + insertedMatchedPlanPaidMinor - existingUtilityPaymentMinor
        : 0n
    const allocationResult = await allocatePaymentPurchaseOverage({
      dependencies,
      cyclePeriod: input.dashboard.period,
      memberId: input.memberId,
      kind: 'utilities',
      paymentAmount:
        plannedSummary?.fairShare ??
        Money.fromMinor(effectivePaymentAmountMinor, input.dashboard.currency),
      settings,
      ...(existingPaymentRecord ? { reresolvePaymentRecordId: existingPaymentRecord.id } : {})
    })
    const payment =
      effectivePaymentAmountMinor > 0n
        ? await repository.addPaymentRecordIfNew({
            cycleId: input.cycle.id,
            memberId: input.memberId,
            kind: 'utilities',
            amountMinor: effectivePaymentAmountMinor,
            currency: input.dashboard.currency,
            recordedAt: input.recordedAt,
            idempotencyKey: `close-payment-period:${dependencies.householdId}:${input.cycle.id}:utilities:${input.utilityPlan.id}:${input.memberId}`
          })
        : (existingPaymentRecord ??
          (allocationResult.allocations.length > 0
            ? await repository.addPaymentRecordIfNew({
                cycleId: input.cycle.id,
                memberId: input.memberId,
                kind: 'utilities',
                amountMinor: 0n,
                currency: input.dashboard.currency,
                recordedAt: input.recordedAt,
                idempotencyKey: `close-payment-period:${dependencies.householdId}:${input.cycle.id}:utilities:${input.utilityPlan.id}:${input.memberId}`
              })
            : undefined))

    if (payment) {
      const existingAllocations = await repository.listPaymentPurchaseAllocations()
      const existingPaymentAllocations = existingAllocations.filter(
        (allocation) => allocation.paymentRecordId === payment.id
      )
      if (allocationResult.allocations.length > 0 || existingPaymentAllocations.length === 0) {
        await repository.replacePaymentPurchaseAllocations({
          paymentRecordId: payment.id,
          cycleId: input.cycle.id,
          resolutionMethod: allocationResult.resolutionMethod,
          resolutionPlanId: allocationResult.resolutionPlanId,
          allocations: allocationResult.allocations
        })
      }
    }

    const carryForward = (input.utilityPlan.carryForwardCredits ?? []).find(
      (credit) => credit.memberId === input.memberId
    )
    if (carryForward?.creditConsumed.amountMinor && carryForward.creditConsumed.amountMinor > 0n) {
      await repository.addBalanceLedgerEntry({
        memberId: input.memberId,
        sourceCycleId: input.cycle.id,
        sourceCyclePeriod: input.dashboard.period,
        planId: input.utilityPlan.id,
        entryType: 'credit_consumed',
        policyTarget: 'balance_policy',
        reason: 'payment_balance_credit_applied',
        amountMinor: carryForward.creditConsumed.amountMinor,
        currency: input.dashboard.currency,
        idempotencyKey: `utility-plan:${input.utilityPlan.id}:member:${input.memberId}:carryover-consumed`
      })
    }
    if (carryForward?.creditCreated.amountMinor && carryForward.creditCreated.amountMinor > 0n) {
      await repository.addBalanceLedgerEntry({
        memberId: input.memberId,
        sourceCycleId: input.cycle.id,
        sourceCyclePeriod: input.dashboard.period,
        planId: input.utilityPlan.id,
        entryType: 'credit_created',
        policyTarget: 'balance_policy',
        reason: 'excess_purchase_credit',
        amountMinor: carryForward.creditCreated.amountMinor,
        currency: input.dashboard.currency,
        idempotencyKey: `utility-plan:${input.utilityPlan.id}:member:${input.memberId}:carryover-created`
      })
    }

    return {
      resolvedBillIds: [...new Set(insertedBillIds)],
      paymentRecorded: Boolean(payment && !existingPaymentRecord)
    }
  }

  return {
    getMemberByTelegramUserId(telegramUserId) {
      return repository.getMemberByTelegramUserId(telegramUserId)
    },

    listMembers() {
      return repository.listMembers()
    },

    getOpenCycle() {
      return repository.getOpenCycle()
    },

    ensureExpectedCycle(referenceInstant) {
      return ensureExpectedCycle(referenceInstant)
    },

    async getAdminCycleState(periodArg) {
      const period = periodArg ? BillingPeriod.fromString(periodArg).toString() : null
      const cycle = period ? await repository.getCycleByPeriod(period) : await ensureExpectedCycle()
      const requestedPeriod = period ?? cycle?.period ?? null

      if (!requestedPeriod) {
        return {
          cycle: null,
          rentRule: null,
          utilityBills: []
        }
      }

      const [rentRule, utilityBills] = await Promise.all([
        repository.getRentRuleStartingAtPeriod(requestedPeriod),
        cycle ? repository.listUtilityBillsForCycle(cycle.id) : Promise.resolve([])
      ])

      return {
        cycle,
        rentRule,
        utilityBills: utilityBills.map((bill) => ({
          id: bill.id,
          billName: bill.billName,
          amount: Money.fromMinor(bill.amountMinor, bill.currency),
          currency: bill.currency,
          createdByMemberId: bill.createdByMemberId,
          createdAt: bill.createdAt
        }))
      }
    },

    async openCycle(periodArg, currencyArg) {
      const period = BillingPeriod.fromString(periodArg).toString()
      const settings = await householdConfigurationRepository.getHouseholdBillingSettings(
        dependencies.householdId
      )
      const currency = parseCurrency(currencyArg, settings.settlementCurrency)

      await repository.openCycle(period, currency)

      const cycle = await repository.getCycleByPeriod(period)
      if (!cycle) {
        throw new Error(`Failed to load billing cycle for period ${period}`)
      }

      return cycle
    },

    async closeCycle(periodArg) {
      const cycle = await getCycleByPeriodOrLatest(repository, periodArg)
      if (!cycle) {
        return null
      }

      await repository.closeCycle(cycle.id, nowInstant())
      return cycle
    },

    async setRent(amountArg, currencyArg, periodArg, fxRateMicrosArg) {
      const [settings, cycle] = await Promise.all([
        householdConfigurationRepository.getHouseholdBillingSettings(dependencies.householdId),
        periodArg ? Promise.resolve(null) : ensureExpectedCycle()
      ])
      const period = periodArg ?? cycle?.period
      if (!period) {
        return null
      }

      const currency = parseCurrency(currencyArg, settings.rentCurrency)
      const amount = Money.fromMajor(amountArg, currency)

      await repository.saveRentRule(
        BillingPeriod.fromString(period).toString(),
        amount.amountMinor,
        currency
      )

      const targetCycle =
        cycle ?? (await repository.getCycleByPeriod(BillingPeriod.fromString(period).toString()))
      const targetRateMicros =
        fxRateMicrosArg && /^\d+$/.test(fxRateMicrosArg) ? BigInt(fxRateMicrosArg) : null

      if (targetCycle && targetRateMicros && currency !== targetCycle.currency) {
        await repository.saveCycleExchangeRate({
          cycleId: targetCycle.id,
          sourceCurrency: currency,
          targetCurrency: targetCycle.currency,
          rateMicros: targetRateMicros,
          effectiveDate: billingPeriodLockDate(
            BillingPeriod.fromString(period),
            settings.rentWarningDay
          ).toString(),
          source: 'nbg'
        })
      }

      return {
        amount,
        currency,
        period: BillingPeriod.fromString(period).toString(),
        fxRateMicros: targetRateMicros
      }
    },

    async addUtilityBill(billName, amountArg, createdByMemberId, currencyArg, periodArg) {
      const settings = await householdConfigurationRepository.getHouseholdBillingSettings(
        dependencies.householdId
      )
      const targetCycle = await ensureCycleForPeriod(settings, periodArg)

      const currency = parseCurrency(currencyArg, settings.settlementCurrency)
      const amount = Money.fromMajor(amountArg, currency)

      await repository.addUtilityBill({
        cycleId: targetCycle.id,
        billName,
        amountMinor: amount.amountMinor,
        currency,
        createdByMemberId
      })
      await invalidateUtilityBillingPlanForCycle(repository, targetCycle.id)

      return {
        amount,
        currency,
        period: targetCycle.period
      }
    },

    async addUtilityBills(entries, createdByMemberId, currencyArg, periodArg) {
      if (entries.length === 0) {
        return null
      }

      const settings = await householdConfigurationRepository.getHouseholdBillingSettings(
        dependencies.householdId
      )
      const targetCycle = await ensureCycleForPeriod(settings, periodArg)
      const currency = parseCurrency(currencyArg, settings.settlementCurrency)

      const savedEntries: { billName: string; amount: Money }[] = []
      for (const entry of entries) {
        const amount = Money.fromMajor(entry.amountMajor, currency)
        await repository.addUtilityBill({
          cycleId: targetCycle.id,
          billName: entry.billName,
          amountMinor: amount.amountMinor,
          currency,
          createdByMemberId
        })
        savedEntries.push({ billName: entry.billName, amount })
      }

      // Recompute the plan once for the whole batch instead of per bill.
      await invalidateUtilityBillingPlanForCycle(repository, targetCycle.id)

      return {
        entries: savedEntries,
        currency,
        period: targetCycle.period
      }
    },

    async updateUtilityBill(billId, billName, amountArg, currencyArg) {
      const settings = await householdConfigurationRepository.getHouseholdBillingSettings(
        dependencies.householdId
      )
      const currency = parseCurrency(currencyArg, settings.settlementCurrency)
      const amount = Money.fromMajor(amountArg, currency)
      const updated = await repository.updateUtilityBill({
        billId,
        billName,
        amountMinor: amount.amountMinor,
        currency
      })

      if (!updated) {
        return null
      }
      await invalidateCurrentUtilityBillingPlan(repository)

      return {
        billId: updated.id,
        amount,
        currency
      }
    },

    async deleteUtilityBill(billId) {
      const deleted = await repository.deleteUtilityBill(billId)
      if (deleted) {
        await invalidateCurrentUtilityBillingPlan(repository)
      }

      return deleted
    },

    async updatePurchase(
      purchaseId,
      description,
      amountArg,
      currencyArg,
      split,
      payerMemberId,
      occurredOnArg
    ) {
      const [settings, members, existingPurchase] = await Promise.all([
        householdConfigurationRepository.getHouseholdBillingSettings(dependencies.householdId),
        householdConfigurationRepository.listHouseholdMembers(dependencies.householdId),
        repository.getParsedPurchase(purchaseId)
      ])
      if (!existingPurchase && !payerMemberId) {
        return null
      }

      const currency = parseCurrency(currencyArg, settings.settlementCurrency)
      const amount = Money.fromMajor(amountArg, currency)
      preventImplicitCustomPurchaseAmountChange({
        existingPurchase,
        amount,
        currency,
        split
      })
      const normalizedSplit = normalizePurchaseMutationSplit({
        amount,
        payerMemberId: payerMemberId ?? existingPurchase!.payerMemberId,
        split,
        members
      })

      const updated = await repository.updateParsedPurchase({
        purchaseId,
        amountMinor: amount.amountMinor,
        currency,
        description: description.trim().length > 0 ? description.trim() : null,
        ...(payerMemberId
          ? {
              payerMemberId
            }
          : {}),
        ...(occurredOnArg
          ? {
              occurredAt: purchaseOccurredAtFromDate({
                occurredOn: occurredOnArg,
                timezone: settings.timezone
              })
            }
          : {}),
        ...(split
          ? {
              splitMode: normalizedSplit.splitMode,
              participants: normalizedSplit.participants
            }
          : {})
      })

      if (!updated) {
        return null
      }

      await invalidateCurrentUtilityBillingPlan(repository)

      return {
        purchaseId: updated.id,
        amount,
        currency
      }
    },

    async addPurchase(description, amountArg, payerMemberId, currencyArg, split, occurredOnArg) {
      const [settings, members] = await Promise.all([
        householdConfigurationRepository.getHouseholdBillingSettings(dependencies.householdId),
        householdConfigurationRepository.listHouseholdMembers(dependencies.householdId)
      ])
      const currency = parseCurrency(currencyArg, settings.settlementCurrency)
      const amount = Money.fromMajor(amountArg, currency)
      const normalizedSplit = normalizePurchaseMutationSplit({
        amount,
        payerMemberId,
        split,
        members
      })

      const openCycle = await repository.getOpenCycle()
      if (!openCycle) {
        throw new DomainError(DOMAIN_ERROR_CODE.INVALID_SETTLEMENT_INPUT, 'No open billing cycle')
      }

      const created = await repository.addParsedPurchase({
        cycleId: openCycle.id,
        payerMemberId,
        amountMinor: amount.amountMinor,
        currency,
        description: description.trim().length > 0 ? description.trim() : null,
        occurredAt: occurredOnArg
          ? purchaseOccurredAtFromDate({
              occurredOn: occurredOnArg,
              timezone: settings.timezone
            })
          : nowInstant(),
        ...(split
          ? {
              splitMode: normalizedSplit.splitMode,
              participants: normalizedSplit.participants
            }
          : {})
      })

      await invalidateCurrentUtilityBillingPlan(repository)

      return {
        purchaseId: created.id,
        amount,
        currency
      }
    },

    async deletePurchase(purchaseId) {
      const deleted = await repository.deleteParsedPurchase(purchaseId)
      if (deleted) {
        await invalidateCurrentUtilityBillingPlan(repository)
      }

      return deleted
    },

    async togglePurchaseParticipant(participantId, actorTelegramUserId) {
      if (!repository.toggleSavedPurchaseParticipant) {
        return {
          status: 'not_editable'
        }
      }
      const result = await repository.toggleSavedPurchaseParticipant(
        participantId,
        actorTelegramUserId
      )
      if (result.status === 'updated') {
        await invalidateCurrentUtilityBillingPlan(repository)
      }

      return result
    },

    async addPayment(memberId, kind, amountArg, currencyArg, periodArg) {
      const [settings, members, memberPresenceDays] = await Promise.all([
        householdConfigurationRepository.getHouseholdBillingSettings(dependencies.householdId),
        householdConfigurationRepository.listHouseholdMembers(dependencies.householdId),
        householdConfigurationRepository.listHouseholdMemberPresenceDays?.(
          dependencies.householdId
        ) ?? Promise.resolve([])
      ])
      const currentCycle = periodArg
        ? await repository.getCycleByPeriod(BillingPeriod.fromString(periodArg).toString())
        : await ensureExpectedCycle()

      if (!currentCycle) {
        return null
      }

      const currency = parseCurrency(currencyArg, settings.settlementCurrency)
      const amount = Money.fromMajor(amountArg, currency)

      if (periodArg) {
        const explicitRemainingMinor = await getCycleKindBaseRemaining({
          dependencies,
          cycle: currentCycle,
          members,
          memberPresenceDays,
          settings,
          memberId,
          kind
        })
        if (explicitRemainingMinor === 0n) {
          throw new Error('Payment period is already settled')
        }
      }

      const paymentTargets = periodArg
        ? [
            {
              cycle: currentCycle,
              baseRemainingMinor: 0n,
              allowOverflow: true
            }
          ]
        : await resolveAutomaticPaymentTargets({
            dependencies,
            currentCycle,
            members,
            memberPresenceDays,
            settings,
            memberId,
            kind
          })

      if (!periodArg && paymentTargets.every((target) => target.cycle.id === currentCycle.id)) {
        const currentCycleRemainingMinor = await getCycleKindBaseRemaining({
          dependencies,
          cycle: currentCycle,
          members,
          memberPresenceDays,
          settings,
          memberId,
          kind
        })
        if (currentCycleRemainingMinor === 0n) {
          throw new Error('Payment period is already settled')
        }
      }

      let remainingMinor = amount.amountMinor
      let firstPayment: Awaited<ReturnType<FinanceRepository['addPaymentRecord']>> | null = null

      for (const target of paymentTargets) {
        if (remainingMinor <= 0n) {
          break
        }

        const amountMinor =
          target.allowOverflow || target.baseRemainingMinor <= 0n
            ? remainingMinor
            : remainingMinor > target.baseRemainingMinor
              ? target.baseRemainingMinor
              : remainingMinor

        if (amountMinor <= 0n) {
          continue
        }

        const payment = await repository.addPaymentRecord({
          cycleId: target.cycle.id,
          memberId,
          kind,
          amountMinor,
          currency,
          recordedAt: nowInstant()
        })
        if (!firstPayment) {
          firstPayment = payment
        }

        const allocationResult = target.allowOverflow
          ? await allocatePaymentPurchaseOverage({
              dependencies,
              cyclePeriod: target.cycle.period,
              memberId,
              kind,
              paymentAmount: Money.fromMinor(amountMinor, currency),
              settings
            })
          : {
              allocations: [],
              resolutionMethod:
                kind === 'utilities' ? ('utilities_plan' as const) : ('rent_plan' as const),
              resolutionPlanId: null
            }
        await repository.replacePaymentPurchaseAllocations({
          paymentRecordId: payment.id,
          cycleId: target.cycle.id,
          resolutionMethod: allocationResult.resolutionMethod,
          resolutionPlanId: allocationResult.resolutionPlanId,
          allocations: allocationResult.allocations
        })

        remainingMinor -= amountMinor
      }

      if (!firstPayment) {
        return null
      }

      return {
        paymentId: firstPayment.id,
        amount,
        currency,
        period: firstPayment.cyclePeriod ?? currentCycle.period
      }
    },

    async closePaymentPeriod(input) {
      const dashboard = await buildFinanceDashboard(dependencies, input.periodArg)
      if (!dashboard) {
        return null
      }

      const cycle = await repository.getCycleByPeriod(dashboard.period)
      if (!cycle) {
        return null
      }

      const kindSummary = dashboard.paymentPeriods
        ?.find((summary) => summary.period === dashboard.period)
        ?.kinds.find((summary) => summary.kind === input.kind)
      if (!kindSummary) {
        return null
      }

      const requestedMemberIds = new Set(input.memberIds ?? [])
      const requestedAll = input.allMembers === true
      const candidateMembers = kindSummary.unresolvedMembers.filter((member) =>
        requestedAll ? true : requestedMemberIds.has(member.memberId)
      )
      const memberNameById = new Map(
        dashboard.members.map((member) => [member.memberId, member.displayName])
      )
      const skippedMembers = [...requestedMemberIds]
        .filter(
          (memberId) =>
            !kindSummary.unresolvedMembers.some((member) => member.memberId === memberId)
        )
        .map((memberId) => ({
          memberId,
          displayName: memberNameById.get(memberId) ?? memberId,
          reason: memberNameById.has(memberId)
            ? ('already_settled' as const)
            : ('not_found' as const)
        }))

      if (candidateMembers.length === 0) {
        return {
          period: dashboard.period,
          kind: input.kind,
          closedMembers: [],
          skippedMembers,
          dashboard
        }
      }

      if (input.kind === 'utilities') {
        const utilityPlan = dashboard.utilityBillingPlan
        if (!utilityPlan) {
          return null
        }

        const recordedAt = nowInstant()
        const [existingVendorFacts, existingPaymentRecords] = await Promise.all([
          repository.listUtilityVendorPaymentFactsForCycle(cycle.id),
          repository.listPaymentRecordsForCycle(cycle.id)
        ])
        const closedMembers: {
          memberId: string
          displayName: string
          amount: Money
        }[] = []
        for (const member of candidateMembers) {
          const result = await resolvePlannedUtilitiesForMember({
            cycle,
            dashboard,
            utilityPlan,
            memberId: member.memberId,
            actorMemberId: input.actorMemberId,
            recordedAt,
            existingVendorFacts,
            existingPaymentRecords
          })
          if (result.resolvedBillIds.length > 0 || result.paymentRecorded) {
            closedMembers.push({
              memberId: member.memberId,
              displayName: member.displayName,
              amount: member.suggestedAmount
            })
          } else {
            skippedMembers.push({
              memberId: member.memberId,
              displayName: member.displayName,
              reason: 'already_settled'
            })
          }
        }

        const vendorFacts = await repository.listUtilityVendorPaymentFactsForCycle(cycle.id)
        const allCategoriesCovered = utilityPlan.categories.every((category) => {
          const paidMinor = utilityMatchedPlanPaidMinor({
            plan: utilityPlan,
            vendorFacts,
            utilityBillId: category.utilityBillId,
            payerMemberId: category.assignedMemberId
          })

          return paidMinor >= category.assignedAmount.amountMinor
        })
        if (allCategoriesCovered) {
          await repository.updateUtilityBillingPlanStatus(utilityPlan.id, 'settled')
        }

        const nextDashboard =
          (await buildFinanceDashboard(dependencies, dashboard.period, {
            skipPlanRebalance: true
          })) ?? dashboard

        return {
          period: dashboard.period,
          kind: input.kind,
          closedMembers,
          skippedMembers,
          dashboard: nextDashboard
        }
      }

      const settings = await householdConfigurationRepository.getHouseholdBillingSettings(
        dependencies.householdId
      )
      const recordedAt = nowInstant()
      const closedMembers: {
        memberId: string
        displayName: string
        amount: Money
      }[] = []
      for (const member of candidateMembers) {
        if (member.suggestedAmount.amountMinor <= 0n) {
          skippedMembers.push({
            memberId: member.memberId,
            displayName: member.displayName,
            reason: 'already_settled'
          })
          continue
        }

        const payment = await repository.addPaymentRecordIfNew({
          cycleId: cycle.id,
          memberId: member.memberId,
          kind: input.kind,
          amountMinor: member.suggestedAmount.amountMinor,
          currency: dashboard.currency,
          recordedAt,
          idempotencyKey: `close-payment-period:${dependencies.householdId}:${cycle.id}:${input.kind}:${member.memberId}`
        })
        if (!payment) {
          skippedMembers.push({
            memberId: member.memberId,
            displayName: member.displayName,
            reason: 'already_settled'
          })
          continue
        }
        const allocationResult = await allocatePaymentPurchaseOverage({
          dependencies,
          cyclePeriod: dashboard.period,
          memberId: member.memberId,
          kind: input.kind,
          paymentAmount: member.suggestedAmount,
          settings
        })
        await repository.replacePaymentPurchaseAllocations({
          paymentRecordId: payment.id,
          cycleId: cycle.id,
          resolutionMethod: allocationResult.resolutionMethod,
          resolutionPlanId: allocationResult.resolutionPlanId,
          allocations: allocationResult.allocations
        })
        closedMembers.push({
          memberId: member.memberId,
          displayName: member.displayName,
          amount: member.suggestedAmount
        })
      }

      return {
        period: dashboard.period,
        kind: input.kind,
        closedMembers,
        skippedMembers,
        dashboard: (await buildFinanceDashboard(dependencies, dashboard.period)) ?? dashboard
      }
    },

    async updatePayment(paymentId, memberId, kind, amountArg, currencyArg) {
      const settings = await householdConfigurationRepository.getHouseholdBillingSettings(
        dependencies.householdId
      )
      const currency = parseCurrency(currencyArg, settings.settlementCurrency)
      const amount = Money.fromMajor(amountArg, currency)
      const existingPayment = await repository.getPaymentRecord(paymentId)
      if (!existingPayment) {
        return null
      }
      const payment = await repository.updatePaymentRecord({
        paymentId,
        memberId,
        kind,
        amountMinor: amount.amountMinor,
        currency
      })

      if (!payment) {
        return null
      }

      await repository.replacePaymentPurchaseAllocations({
        paymentRecordId: paymentId,
        cycleId: existingPayment.cycleId,
        resolutionMethod: kind === 'utilities' ? 'utilities_plan' : 'rent_plan',
        resolutionPlanId: null,
        allocations: []
      })

      const allocationResult = await allocatePaymentPurchaseOverage({
        dependencies,
        cyclePeriod:
          existingPayment.cyclePeriod ?? expectedOpenCyclePeriod(settings, nowInstant()).toString(),
        memberId,
        kind,
        paymentAmount: amount,
        settings
      })
      await repository.replacePaymentPurchaseAllocations({
        paymentRecordId: paymentId,
        cycleId: existingPayment.cycleId,
        resolutionMethod: allocationResult.resolutionMethod,
        resolutionPlanId: allocationResult.resolutionPlanId,
        allocations: allocationResult.allocations
      })

      return {
        paymentId: payment.id,
        amount,
        currency
      }
    },

    deletePayment(paymentId) {
      return repository.deletePaymentRecord(paymentId)
    },

    getPayment(paymentId) {
      return repository.getPaymentRecord(paymentId)
    },

    getPurchase(purchaseId) {
      return repository.getParsedPurchase(purchaseId)
    },

    async generateCurrentBillPlan(periodArg) {
      const dashboard = await (periodArg
        ? buildFinanceDashboard(dependencies, periodArg)
        : ensureExpectedCycle().then(() => buildFinanceDashboard(dependencies)))

      if (!dashboard) {
        return null
      }

      return {
        period: dashboard.period,
        currency: dashboard.currency,
        timezone: dashboard.timezone,
        billingStage: dashboard.billingStage,
        rentConversion: {
          sourceAmount: dashboard.rentSourceAmount,
          settlementAmount: dashboard.rentDisplayAmount,
          rateMicros: dashboard.rentFxRateMicros,
          effectiveDate: dashboard.rentFxEffectiveDate
        },
        utilityBillingPlan: dashboard.utilityBillingPlan,
        rentBillingState: dashboard.rentBillingState,
        members: dashboard.members.map((member) => ({
          memberId: member.memberId,
          displayName: member.displayName,
          utilityShare: member.utilityShare,
          purchaseOffset: member.purchaseOffset,
          ...(member.carryForwardCredit
            ? {
                carryForwardCredit: member.carryForwardCredit
              }
            : {}),
          purchaseDrivers: dashboard.ledger
            .map((entry) =>
              purchaseDriverForMember({
                entry,
                memberId: member.memberId,
                period: dashboard.period,
                currency: dashboard.currency
              })
            )
            .filter(
              (driver): driver is NonNullable<typeof driver> =>
                driver !== null && driver.payerMemberId === member.memberId
            )
        }))
      }
    },

    async resolveUtilityBillAsPlanned(input) {
      const dashboard = await (input.periodArg
        ? buildFinanceDashboard(dependencies, input.periodArg)
        : ensureExpectedCycle().then(() => buildFinanceDashboard(dependencies)))

      if (!dashboard?.utilityBillingPlan) {
        return null
      }

      const utilityPlan = dashboard.utilityBillingPlan
      const memberIds = input.allMembers
        ? [
            ...new Set([
              ...utilityPlan.categories
                .filter((category) => category.assignedAmount.amountMinor > 0n)
                .map((category) => category.assignedMemberId),
              ...utilityPlan.memberSummaries.map((summary) => summary.memberId)
            ])
          ]
        : input.memberId
          ? [input.memberId]
          : []
      if (memberIds.length === 0) {
        throw new Error('No planned utility bills assigned')
      }
      const memberNameById = new Map(
        utilityPlan.memberSummaries.map((summary) => [summary.memberId, summary.displayName])
      )
      const resolvedAssignments = utilityPlan.categories
        .filter(
          (category) =>
            memberIds.includes(category.assignedMemberId) &&
            category.assignedAmount.amountMinor > 0n
        )
        .map((category) => ({
          memberId: category.assignedMemberId,
          displayName:
            memberNameById.get(category.assignedMemberId) ?? category.assignedDisplayName,
          utilityBillId: category.utilityBillId,
          billName: category.billName,
          amount: category.assignedAmount
        }))

      const cycle = await repository.getCycleByPeriod(dashboard.period)
      if (!cycle) {
        return null
      }

      const recordedAt = nowInstant()
      const [existingVendorFacts, existingPaymentRecords] = await Promise.all([
        repository.listUtilityVendorPaymentFactsForCycle(cycle.id),
        repository.listPaymentRecordsForCycle(cycle.id)
      ])

      const resolvedBillIds: string[] = []
      for (const memberId of memberIds) {
        const result = await resolvePlannedUtilitiesForMember({
          cycle,
          dashboard,
          utilityPlan,
          memberId,
          ...(input.actorMemberId ? { actorMemberId: input.actorMemberId } : {}),
          recordedAt,
          existingVendorFacts,
          existingPaymentRecords
        })
        resolvedBillIds.push(...result.resolvedBillIds)
      }

      // Settle the plan once the last assigned share is covered by on-plan facts.
      const vendorFacts = await repository.listUtilityVendorPaymentFactsForCycle(cycle.id)
      const settledJustNow =
        utilityPlan.status !== 'settled' &&
        utilityPlanFullyCovered({ plan: utilityPlan, vendorFacts })
      if (settledJustNow) {
        await repository.updateUtilityBillingPlanStatus(utilityPlan.id, 'settled')
      }

      const nextDashboard = await buildFinanceDashboard(dependencies, dashboard.period, {
        skipPlanRebalance: true
      })
      return {
        period: dashboard.period,
        resolvedBillIds: [...new Set(resolvedBillIds)],
        resolvedAssignments,
        settledJustNow,
        plan: nextDashboard?.utilityBillingPlan ?? null
      }
    },

    async recordUtilityVendorPayment(input) {
      const dashboard = await (input.periodArg
        ? buildFinanceDashboard(dependencies, input.periodArg)
        : ensureExpectedCycle().then(() => buildFinanceDashboard(dependencies)))
      if (!dashboard) {
        return null
      }

      const cycle = await repository.getCycleByPeriod(dashboard.period)
      if (!cycle) {
        return null
      }

      const utilityBills = await repository.listUtilityBillsForCycle(cycle.id)
      const bill = utilityBills.find((item) => item.id === input.utilityBillId)
      if (!bill) {
        throw new Error('Utility bill not found')
      }

      const assignedAmounts =
        dashboard.utilityBillingPlan?.categories.filter(
          (category) => category.utilityBillId === bill.id
        ) ?? []
      const defaultMinor = assignedAmounts
        .filter((category) => category.assignedMemberId === input.payerMemberId)
        .reduce((sum, category) => sum + category.assignedAmount.amountMinor, 0n)
      const currency = parseCurrency(input.currencyArg, dashboard.currency)
      const amount = input.amountArg
        ? Money.fromMajor(input.amountArg, currency)
        : Money.fromMinor(defaultMinor > 0n ? defaultMinor : bill.amountMinor, currency)
      const matchingCategory = assignedAmounts.find(
        (category) =>
          category.assignedMemberId === input.payerMemberId &&
          category.assignedAmount.amountMinor === amount.amountMinor
      )

      await repository.addUtilityVendorPaymentFact({
        cycleId: cycle.id,
        utilityBillId: bill.id,
        billName: bill.billName,
        payerMemberId: input.payerMemberId,
        amountMinor: amount.amountMinor,
        currency,
        planId: matchingCategory ? (dashboard.utilityBillingPlan?.id ?? null) : null,
        plannedForMemberId: matchingCategory?.assignedMemberId ?? null,
        planVersion: dashboard.utilityBillingPlan?.version ?? null,
        matchedPlan: Boolean(matchingCategory),
        recordedByMemberId: input.actorMemberId ?? input.payerMemberId,
        recordedAt: nowInstant()
      })

      // Settle the plan when this on-plan payment covers the last assigned share.
      const plan = dashboard.utilityBillingPlan
      let settledJustNow = false
      if (matchingCategory && plan && plan.status !== 'settled') {
        const vendorFacts = await repository.listUtilityVendorPaymentFactsForCycle(cycle.id)
        if (utilityPlanFullyCovered({ plan, vendorFacts })) {
          await repository.updateUtilityBillingPlanStatus(plan.id, 'settled')
          settledJustNow = true
        }
      }

      // Only skip rebalancing for on-plan payments.
      // Off-plan payments (when someone pays a bill not assigned to them) must trigger rebalancing.
      const nextDashboard = await buildFinanceDashboard(dependencies, dashboard.period, {
        skipPlanRebalance: Boolean(matchingCategory)
      })
      return {
        period: dashboard.period,
        settledJustNow,
        plan: nextDashboard?.utilityBillingPlan ?? null
      }
    },

    async recordUtilityReimbursement(input) {
      const dashboard = await (input.periodArg
        ? buildFinanceDashboard(dependencies, input.periodArg)
        : ensureExpectedCycle().then(() => buildFinanceDashboard(dependencies)))
      if (!dashboard) {
        return null
      }

      const cycle = await repository.getCycleByPeriod(dashboard.period)
      if (!cycle) {
        return null
      }

      const currency = parseCurrency(input.currencyArg, dashboard.currency)
      const amount = Money.fromMajor(input.amountArg, currency)
      await repository.addUtilityReimbursementFact({
        cycleId: cycle.id,
        fromMemberId: input.fromMemberId,
        toMemberId: input.toMemberId,
        amountMinor: amount.amountMinor,
        currency,
        plannedFromMemberId: null,
        plannedToMemberId: null,
        planVersion: dashboard.utilityBillingPlan?.version ?? null,
        matchedPlan: false,
        recordedByMemberId: input.actorMemberId ?? input.fromMemberId,
        recordedAt: nowInstant()
      })

      // Reimbursements are always off-plan, so don't skip rebalancing
      const nextDashboard = await buildFinanceDashboard(dependencies, dashboard.period)
      return {
        period: dashboard.period,
        plan: nextDashboard?.utilityBillingPlan ?? null
      }
    },

    async rebalanceUtilityPlan(periodArg) {
      const dashboard = await (periodArg
        ? buildFinanceDashboard(dependencies, periodArg)
        : ensureExpectedCycle().then(() => buildFinanceDashboard(dependencies)))

      return dashboard?.utilityBillingPlan ?? null
    },

    async generateBillingAuditExport(periodArg) {
      const dashboard = await (periodArg
        ? buildFinanceDashboard(dependencies, periodArg)
        : ensureExpectedCycle().then(() => buildFinanceDashboard(dependencies)))
      if (!dashboard) {
        return null
      }

      const [cycle, openCycle, settings, members, presenceDays, utilityCategories] =
        await Promise.all([
          repository.getCycleByPeriod(dashboard.period),
          repository.getOpenCycle(),
          householdConfigurationRepository.getHouseholdBillingSettings(dependencies.householdId),
          householdConfigurationRepository.listHouseholdMembers(dependencies.householdId),
          householdConfigurationRepository.listHouseholdMemberPresenceDays?.(
            dependencies.householdId
          ) ?? Promise.resolve([]),
          householdConfigurationRepository.listHouseholdUtilityCategories(dependencies.householdId)
        ])
      if (!cycle) {
        return null
      }

      const [
        rentRule,
        utilityBills,
        paymentRecords,
        parsedPurchases,
        utilityVendorPaymentFacts,
        utilityReimbursementFacts,
        utilityPlanVersions,
        settlementSnapshotLines
      ] = await Promise.all([
        repository.getRentRuleForPeriod(cycle.period),
        repository.listUtilityBillsForCycle(cycle.id),
        repository.listPaymentRecordsForCycle(cycle.id),
        repository.listParsedPurchases(),
        repository.listUtilityVendorPaymentFactsForCycle(cycle.id),
        repository.listUtilityReimbursementFactsForCycle(cycle.id),
        repository.listUtilityBillingPlansForCycle(cycle.id),
        repository.getSettlementSnapshotLines(cycle.id)
      ])

      const descriptions: FinanceBillingAuditExport['descriptions'] = {
        sections: {
          meta: 'Export metadata and cycle selection context.',
          warnings:
            'Non-fatal audit flags and interpretation notes that should be checked before trusting the cycle output.',
          settings: 'Billing settings and category metadata that shape the calculation.',
          rawInputs: 'Raw persisted finance facts and records used as calculation inputs.',
          derived:
            'Per-member derived balances, adjusted targets, and totals used for current guidance.',
          utilityPlan: 'Current utility execution plan derived from the selected adjustment mode.',
          rentState: 'Current rent dues and settlement routing for the selected cycle.',
          dashboard: 'Final public read model snapshot for comparison with the app and bot.'
        },
        adjustmentPolicies: {
          utilities:
            'Purchase balance is applied through utility targets and utility payment guidance.',
          rent: 'Utility assignments stay raw; purchase balance and residual adjustment move into rent.',
          separate:
            'Manual mode: rent and utilities stay raw; purchase balance is informational only.'
        },
        derivedFields: {
          purchaseOffset:
            'Net shared-purchase position for the member. Negative means the member is ahead; positive means others covered more.',
          rawUtilityFairShare:
            'Utility fair share before any automatic adjustment policy is applied.',
          adjustedUtilityTarget:
            'Utility amount after policy-based purchase-balance adjustment, if utilities mode is active.',
          rawRentShare: 'Base rent share before automatic adjustment.',
          adjustedRentTarget:
            'Rent amount after policy-based purchase-balance adjustment, if rent mode is active.',
          assignedThisCycle: 'Utility amount assigned in the current plan version for this cycle.',
          projectedDeltaAfterPlan:
            'Expected difference between the member target and total utility vendor payments after the plan completes.',
          remaining: 'Current unpaid remainder after recorded payments.'
        },
        snapshotSemantics: {
          settlementSnapshotLines:
            'Settlement snapshot lines are frozen historical settlement inputs captured at snapshot time. They are not guaranteed to match the latest active utility plan or current dashboard state.',
          utilityPlanPayloadFairShareByMember:
            'utilityPlanVersions[].payload.fairShareByMember stores the fair-share input passed into that plan version. In utilities mode this may already include purchase-balance adjustment. Use derived.members.rawUtilityFairShare for raw cycle utility share and derived.members.adjustedUtilityTarget for the current adjusted target.'
        }
      }

      const adjustmentPolicy = resolvedPaymentBalanceAdjustmentPolicy(settings)
      const auditCycleDays = cycleDateRange(BillingPeriod.fromString(dashboard.period)).daysInMonth
      const billedUtilityNames = new Set(
        utilityBills.map((bill) => bill.billName.trim().toLowerCase())
      )
      const warnings: FinanceBillingAuditExport['warnings'] = [
        ...utilityCategories
          .filter(
            (category) =>
              category.isActive && !billedUtilityNames.has(category.name.trim().toLowerCase())
          )
          .map((category) =>
            auditWarning({
              code: 'ACTIVE_UTILITY_CATEGORY_WITHOUT_BILL',
              severity: 'warning',
              section: 'rawInputs.utilityBills',
              message: `Active utility category "${category.name}" has no bill entered for cycle ${dashboard.period}.`
            })
          ),
        ...(settlementSnapshotLines.length > 0
          ? [
              auditWarning({
                code: 'SETTLEMENT_SNAPSHOT_IS_HISTORICAL',
                severity: 'info',
                section: 'rawInputs.settlementSnapshot',
                message:
                  'Settlement snapshot lines are frozen historical data and may differ from the latest active utility plan or dashboard-derived targets.'
              })
            ]
          : []),
        ...(utilityPlanVersions.length > 0
          ? [
              auditWarning({
                code: 'UTILITY_PLAN_PAYLOAD_FAIR_SHARE_IS_PLAN_INPUT',
                severity: 'info',
                section: 'rawInputs.utilityPlanVersions',
                message:
                  'utilityPlanVersions[].payload.fairShareByMember reflects the fair-share input passed into that plan version, not necessarily the raw cycle utility fair share.'
              })
            ]
          : []),
        adjustmentPolicy === 'utilities'
          ? auditWarning({
              code: 'UTILITIES_MODE_APPLIES_PURCHASE_BALANCE_TO_UTILITY_TARGETS',
              severity: 'info',
              section: 'derived.members',
              message:
                'Utilities mode is active, so purchase offsets are routed into adjusted utility targets instead of rent.'
            })
          : adjustmentPolicy === 'rent'
            ? auditWarning({
                code: 'RENT_MODE_DEFERS_BALANCE_ADJUSTMENT_TO_RENT',
                severity: 'info',
                section: 'derived.members',
                message:
                  'Rent mode is active, so utility assignments stay raw and purchase offsets are routed into adjusted rent targets.'
              })
            : auditWarning({
                code: 'MANUAL_MODE_DISABLES_AUTOMATIC_BALANCE_ADJUSTMENT',
                severity: 'info',
                section: 'derived.members',
                message:
                  'Manual mode is active, so utilities and rent stay raw and purchase offsets remain informational only.'
              })
      ]

      return {
        meta: {
          exportVersion: 'billing-audit/v1',
          exportedAt: nowInstant().toString(),
          period: dashboard.period,
          billingStage: dashboard.billingStage,
          adjustmentPolicy: dashboard.paymentBalanceAdjustmentPolicy,
          householdId: dependencies.householdId,
          currency: dashboard.currency,
          timezone: dashboard.timezone
        },
        descriptions,
        warnings,
        household: {
          householdId: dependencies.householdId
        },
        settings: {
          settlementCurrency: settings.settlementCurrency,
          timezone: settings.timezone,
          rentDueDay: settings.rentDueDay,
          rentWarningDay: settings.rentWarningDay,
          utilitiesDueDay: settings.utilitiesDueDay,
          utilitiesReminderDay: settings.utilitiesReminderDay,
          paymentBalanceAdjustmentPolicy: resolvedPaymentBalanceAdjustmentPolicy(settings),
          rentAmount:
            settings.rentAmountMinor === null
              ? null
              : serializeMoney(Money.fromMinor(settings.rentAmountMinor, settings.rentCurrency)),
          rentPaymentDestinations: settings.rentPaymentDestinations ?? null,
          utilityCategories: utilityCategories.map((category) => ({
            id: category.id,
            slug: category.slug,
            name: category.name,
            sortOrder: category.sortOrder,
            isActive: category.isActive,
            providerName: category.providerName ?? null,
            customerNumber: category.customerNumber ?? null,
            paymentLink: category.paymentLink ?? null,
            note: category.note ?? null
          }))
        },
        cycle: {
          openCycle: openCycle
            ? {
                id: openCycle.id,
                period: openCycle.period,
                currency: openCycle.currency
              }
            : null,
          selectedCycle: {
            id: cycle.id,
            period: cycle.period,
            currency: cycle.currency
          },
          rentRule: rentRule
            ? {
                amount: serializeMoney(Money.fromMinor(rentRule.amountMinor, rentRule.currency)),
                sourceCurrency: rentRule.currency
              }
            : null,
          rentFx: {
            sourceAmount: serializeMoney(dashboard.rentSourceAmount),
            settlementAmount: serializeMoney(dashboard.rentDisplayAmount),
            rateMicros: serializeBigInt(dashboard.rentFxRateMicros),
            effectiveDate: dashboard.rentFxEffectiveDate
          }
        },
        members: members.map((member) => {
          const dashboardMember = dashboard.members.find((item) => item.memberId === member.id)
          return {
            memberId: member.id,
            displayName: member.displayName,
            status: member.status,
            isAdmin: member.isAdmin,
            rentShareWeight: member.rentShareWeight,
            preferredLocale: member.preferredLocale ?? null,
            householdDefaultLocale: member.householdDefaultLocale,
            daysPresent:
              dashboardMember?.daysPresent ?? (member.status === 'active' ? auditCycleDays : 0)
          }
        }),
        presenceDays: presenceDays.map((entry) => ({
          memberId: entry.memberId,
          period: entry.period,
          daysPresent: entry.daysPresent
        })),
        rawInputs: {
          utilityBills: utilityBills.map((bill) => ({
            id: bill.id,
            billName: bill.billName,
            amount: serializeMoney(Money.fromMinor(bill.amountMinor, bill.currency)),
            createdByMemberId: bill.createdByMemberId ?? null,
            createdAt: bill.createdAt.toString()
          })),
          parsedPurchases: parsedPurchases.map((purchase) => ({
            id: purchase.id,
            cycleId: purchase.cycleId ?? null,
            cyclePeriod: purchase.cyclePeriod ?? null,
            payerMemberId: purchase.payerMemberId,
            amount: serializeMoney(Money.fromMinor(purchase.amountMinor, purchase.currency)),
            description: purchase.description ?? null,
            occurredAt: purchase.occurredAt?.toString() ?? null,
            splitMode: purchase.splitMode ?? 'equal',
            participants: (purchase.participants ?? []).map((participant) => ({
              ...(participant.id === undefined ? {} : { id: participant.id }),
              memberId: participant.memberId,
              included: participant.included !== false,
              shareAmount:
                participant.shareAmountMinor === null
                  ? null
                  : serializeMoney(Money.fromMinor(participant.shareAmountMinor, purchase.currency))
            }))
          })),
          paymentRecords: paymentRecords.map((payment) => ({
            id: payment.id,
            cycleId: payment.cycleId,
            cyclePeriod: payment.cyclePeriod ?? null,
            memberId: payment.memberId,
            kind: payment.kind,
            amount: serializeMoney(Money.fromMinor(payment.amountMinor, payment.currency)),
            recordedAt: payment.recordedAt.toString()
          })),
          utilityVendorPaymentFacts: utilityVendorPaymentFacts.map((fact) => ({
            id: fact.id,
            cycleId: fact.cycleId,
            utilityBillId: fact.utilityBillId ?? null,
            billName: fact.billName,
            payerMemberId: fact.payerMemberId,
            amount: serializeMoney(Money.fromMinor(fact.amountMinor, fact.currency)),
            plannedForMemberId: fact.plannedForMemberId ?? null,
            planVersion: fact.planVersion ?? null,
            matchedPlan: fact.matchedPlan,
            recordedByMemberId: fact.recordedByMemberId ?? null,
            recordedAt: fact.recordedAt.toString(),
            createdAt: fact.createdAt.toString()
          })),
          utilityReimbursementFacts: utilityReimbursementFacts.map((fact) => ({
            id: fact.id,
            cycleId: fact.cycleId,
            fromMemberId: fact.fromMemberId,
            toMemberId: fact.toMemberId,
            amount: serializeMoney(Money.fromMinor(fact.amountMinor, fact.currency)),
            plannedFromMemberId: fact.plannedFromMemberId ?? null,
            plannedToMemberId: fact.plannedToMemberId ?? null,
            planVersion: fact.planVersion ?? null,
            matchedPlan: fact.matchedPlan,
            recordedByMemberId: fact.recordedByMemberId ?? null,
            recordedAt: fact.recordedAt.toString(),
            createdAt: fact.createdAt.toString()
          })),
          utilityPlanVersions: utilityPlanVersions.map((plan) => ({
            id: plan.id,
            version: plan.version,
            status: plan.status,
            dueDate: plan.dueDate,
            currency: plan.currency,
            maxCategoriesPerMemberApplied: plan.maxCategoriesPerMemberApplied,
            updatedFromPlanId: plan.updatedFromPlanId ?? null,
            reason: plan.reason ?? null,
            createdAt: plan.createdAt.toString(),
            payload: plan.payload
          })),
          settlementSnapshot: {
            isFrozenHistoricalSnapshot: true,
            description: descriptions.snapshotSemantics.settlementSnapshotLines,
            lines: settlementSnapshotLines.map((line) => ({
              memberId: line.memberId,
              rentShare: serializeMoney(Money.fromMinor(line.rentShareMinor, dashboard.currency)),
              utilityShare: serializeMoney(
                Money.fromMinor(line.utilityShareMinor, dashboard.currency)
              ),
              purchaseOffset: serializeMoney(
                Money.fromMinor(line.purchaseOffsetMinor, dashboard.currency)
              ),
              netDue: serializeMoney(Money.fromMinor(line.netDueMinor, dashboard.currency))
            }))
          }
        },
        derived: {
          totals: {
            totalDue: serializeMoney(dashboard.totalDue),
            totalPaid: serializeMoney(dashboard.totalPaid),
            totalRemaining: serializeMoney(dashboard.totalRemaining)
          },
          members: dashboard.members.map((member) => ({
            memberId: member.memberId,
            displayName: member.displayName,
            rawUtilityFairShare: serializeMoney(member.utilityShare),
            adjustedUtilityTarget: serializeMoney(
              Money.fromMinor(
                actionablePaymentDueMinor({
                  kind: 'utilities',
                  baseMinor: member.utilityShare.amountMinor,
                  purchaseOffsetMinor: member.purchaseOffset.amountMinor,
                  settings
                }),
                dashboard.currency
              )
            ),
            rawRentShare: serializeMoney(member.rentShare),
            adjustedRentTarget: serializeMoney(
              Money.fromMinor(
                actionablePaymentDueMinor({
                  kind: 'rent',
                  baseMinor: member.rentShare.amountMinor,
                  purchaseOffsetMinor: member.purchaseOffset.amountMinor,
                  settings
                }),
                dashboard.currency
              )
            ),
            purchaseOffset: serializeMoney(member.purchaseOffset),
            netDue: serializeMoney(member.netDue),
            paid: serializeMoney(member.paid),
            remaining: serializeMoney(member.remaining),
            overduePayments: member.overduePayments.map((overdue) => ({
              kind: overdue.kind,
              amountMinor: overdue.amountMinor.toString(),
              periods: overdue.periods
            })),
            explanations: member.explanations
          })),
          paymentPeriods: serializeDashboardPaymentPeriods(dashboard.paymentPeriods)
        },
        utilityPlan: {
          explanation:
            adjustmentPolicy === 'utilities'
              ? 'Utility planning includes purchase-balance adjustment in the member targets.'
              : adjustmentPolicy === 'rent'
                ? 'Utility planning stays raw and convenience-first; purchase-balance adjustment is deferred to rent.'
                : 'Manual mode keeps utility planning raw with no automatic balance adjustment.',
          fieldSemantics: {
            rawCycleFairShareByMember:
              'Raw cycle utility fair share before automatic balance adjustment.',
            adjustedTargetByMember:
              'Current utility target after applying the selected adjustment policy.',
            planPayloadFairShareByMember:
              descriptions.snapshotSemantics.utilityPlanPayloadFairShareByMember
          },
          rawCycleFairShareByMember: dashboard.members.map((member) => ({
            memberId: member.memberId,
            displayName: member.displayName,
            amount: serializeMoney(member.utilityShare)
          })),
          adjustedTargetByMember: dashboard.members.map((member) => ({
            memberId: member.memberId,
            displayName: member.displayName,
            amount: serializeMoney(
              Money.fromMinor(
                actionablePaymentDueMinor({
                  kind: 'utilities',
                  baseMinor: member.utilityShare.amountMinor,
                  purchaseOffsetMinor: member.purchaseOffset.amountMinor,
                  settings
                }),
                dashboard.currency
              )
            )
          })),
          plan: serializeDashboardUtilityBillingPlan(dashboard.utilityBillingPlan)
        },
        rentState: {
          explanation:
            adjustmentPolicy === 'rent'
              ? 'Rent dues include purchase-balance adjustment in this mode.'
              : adjustmentPolicy === 'utilities'
                ? 'Rent dues stay close to raw rent share because purchase-balance adjustment happens through utilities.'
                : 'Manual mode keeps rent dues raw with no automatic balance adjustment.',
          state: serializeDashboardRentBillingState(dashboard.rentBillingState)
        },
        dashboard: {
          snapshot: serializeDashboard(dashboard)
        }
      }
    },

    async generateStatement(periodArg) {
      if (!periodArg) {
        await ensureExpectedCycle()
      }

      const dashboard = await buildFinanceDashboard(dependencies, periodArg)
      if (!dashboard) {
        return null
      }

      const statementLines = dashboard.members.map((line) => {
        return `- ${line.displayName}: due ${line.netDue.toMajorString()} ${dashboard.currency}, paid ${line.paid.toMajorString()} ${dashboard.currency}, remaining ${line.remaining.toMajorString()} ${dashboard.currency}`
      })

      const rentLine =
        dashboard.rentSourceAmount.currency === dashboard.rentDisplayAmount.currency
          ? `Rent: ${dashboard.rentDisplayAmount.toMajorString()} ${dashboard.currency}`
          : `Rent: ${dashboard.rentSourceAmount.toMajorString()} ${dashboard.rentSourceAmount.currency} (~${dashboard.rentDisplayAmount.toMajorString()} ${dashboard.currency})`

      return [
        `Statement for ${dashboard.period}`,
        rentLine,
        ...statementLines,
        `Total due: ${dashboard.totalDue.toMajorString()} ${dashboard.currency}`,
        `Total paid: ${dashboard.totalPaid.toMajorString()} ${dashboard.currency}`,
        `Total remaining: ${dashboard.totalRemaining.toMajorString()} ${dashboard.currency}`
      ].join('\n')
    },

    generateDashboard(periodArg, options) {
      return materializeDashboard(periodArg, options)
    },

    ensureDashboardMaterialized(periodArg, options) {
      return materializeDashboard(periodArg, options)
    },

    async manuallyResolvePurchase(input) {
      // Get the purchase to find its cycle
      const purchases = await dependencies.repository.listParsedPurchases()
      const purchase = purchases.find((p) => p.id === input.purchaseId)
      if (!purchase) {
        throw new Error(`Purchase not found: ${input.purchaseId}`)
      }

      // Use the current open cycle for resolution
      const cycle = await dependencies.repository.getOpenCycle()
      if (!cycle) {
        throw new Error('No open billing cycle')
      }

      // Parse and validate allocations
      const allocations = input.allocations.map((allocation) => {
        const amount = Money.fromMajor(allocation.amountMajor, 'GEL')
        return {
          memberId: allocation.memberId,
          amountMinor: amount.amountMinor
        }
      })

      const totalResolved = allocations.reduce((sum, alloc) => sum + alloc.amountMinor, 0n)

      // Create manual allocations
      await dependencies.repository.createManualPurchaseAllocations({
        purchaseId: input.purchaseId,
        cycleId: cycle.id,
        allocations,
        recordedAt: nowInstant()
      })

      return {
        purchaseId: input.purchaseId,
        resolvedAmount: Money.fromMinor(totalResolved, 'GEL')
      }
    }
  }
}
