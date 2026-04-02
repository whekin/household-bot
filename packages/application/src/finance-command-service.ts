import { createHash } from 'node:crypto'

import type {
  ExchangeRateProvider,
  FinanceCycleRecord,
  FinanceMemberRecord,
  FinanceMemberOverduePaymentRecord,
  FinancePaymentKind,
  FinancePaymentPurchaseAllocationRecord,
  FinanceRentRuleRecord,
  FinanceRepository,
  FinanceUtilityBillingPlanPayload,
  FinanceUtilityBillingPlanStatus,
  HouseholdBillingSettingsRecord,
  HouseholdConfigurationRepository,
  HouseholdMemberAbsencePolicy,
  HouseholdMemberAbsencePolicyRecord,
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
  type CurrencyCode
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

export interface FinanceDashboardMemberLine {
  memberId: string
  displayName: string
  status?: 'active' | 'away' | 'left'
  absencePolicy?: HouseholdMemberAbsencePolicy
  absenceIntervalStartsOn?: string | null
  absenceIntervalEndsOn?: string | null
  utilityParticipationDays?: number
  predictedUtilityShare?: Money | null
  rentShare: Money
  utilityShare: Money
  purchaseOffset: Money
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
  utilityBillingPlan: FinanceDashboardUtilityBillingPlan | null
  rentBillingState: FinanceDashboardRentBillingState
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
    activeAbsencePolicy: HouseholdMemberAbsencePolicy
    absenceIntervalStartsOn: string | null
    absenceIntervalEndsOn: string | null
    utilityParticipationDays: number
  }[]
  absencePolicies: readonly {
    memberId: string
    policy: HouseholdMemberAbsencePolicy
    startsOn: string | null
    endsOn: string | null
    effectiveFromPeriod: string | null
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
    | 'listHouseholdMemberAbsencePolicies'
    | 'listHouseholdUtilityCategories'
  >
  exchangeRateProvider: ExchangeRateProvider
}

interface ResolvedMemberAbsencePolicy {
  memberId: string
  policy: HouseholdMemberAbsencePolicy
  startsOn: string | null
  endsOn: string | null
  utilityParticipationDays: number
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

function defaultAbsencePolicyForMember(
  member: HouseholdMemberRecord
): HouseholdMemberAbsencePolicy {
  return member.status === 'left' ? 'inactive' : 'resident'
}

function policyParticipatesInRent(policy: HouseholdMemberAbsencePolicy): boolean {
  return policy !== 'inactive'
}

function policyParticipatesInUtilities(policy: HouseholdMemberAbsencePolicy): boolean {
  return policy === 'resident' || policy === 'away_rent_and_utilities'
}

function policyParticipatesInPurchases(policy: HouseholdMemberAbsencePolicy): boolean {
  return policy !== 'inactive'
}

function intervalContainsDate(
  interval: HouseholdMemberAbsencePolicyRecord,
  date: Temporal.PlainDate
): boolean {
  const startsOn = absencePolicyStartsOn(interval)
  const endsOn = absencePolicyEndsOn(interval)

  return (
    Temporal.PlainDate.compare(startsOn, date) <= 0 &&
    (!endsOn || Temporal.PlainDate.compare(date, endsOn) <= 0)
  )
}

function intervalOverlapsCycle(
  interval: HouseholdMemberAbsencePolicyRecord,
  period: BillingPeriod
): boolean {
  const { start, endExclusive } = cycleDateRange(period)
  const startsOn = absencePolicyStartsOn(interval)
  const endsOn = absencePolicyEndsOn(interval)

  return (
    Temporal.PlainDate.compare(startsOn, endExclusive) < 0 &&
    (!endsOn || Temporal.PlainDate.compare(endsOn, start) >= 0)
  )
}

function absencePolicyStartsOn(interval: HouseholdMemberAbsencePolicyRecord): Temporal.PlainDate {
  if (interval.startsOn) {
    return Temporal.PlainDate.from(interval.startsOn)
  }

  if (interval.effectiveFromPeriod) {
    return Temporal.PlainDate.from(`${interval.effectiveFromPeriod}-01`)
  }

  throw new Error(`Absence policy record is missing startsOn for member ${interval.memberId}`)
}

function absencePolicyEndsOn(
  interval: HouseholdMemberAbsencePolicyRecord
): Temporal.PlainDate | null {
  return interval.endsOn ? Temporal.PlainDate.from(interval.endsOn) : null
}

function latestPolicyForDate(input: {
  member: HouseholdMemberRecord
  policies: readonly HouseholdMemberAbsencePolicyRecord[]
  date: Temporal.PlainDate
}): HouseholdMemberAbsencePolicy {
  const applicable = input.policies
    .filter(
      (policy) => policy.memberId === input.member.id && intervalContainsDate(policy, input.date)
    )
    .sort((left, right) =>
      absencePolicyStartsOn(left).toString().localeCompare(absencePolicyStartsOn(right).toString())
    )
    .at(-1)

  return applicable?.policy ?? defaultAbsencePolicyForMember(input.member)
}

function resolveMemberAbsencePolicies(input: {
  members: readonly HouseholdMemberRecord[]
  policies: readonly HouseholdMemberAbsencePolicyRecord[]
  period: string
  today?: Temporal.PlainDate
}): ReadonlyMap<string, ResolvedMemberAbsencePolicy> {
  const period = BillingPeriod.fromString(input.period)
  const { start, daysInMonth } = cycleDateRange(period)
  const cycleToday =
    input.today && input.today.year === period.year && input.today.month === period.month
      ? input.today
      : start
  const resolved = new Map<string, ResolvedMemberAbsencePolicy>()

  for (const member of input.members) {
    const overlapping = input.policies
      .filter((policy) => policy.memberId === member.id && intervalOverlapsCycle(policy, period))
      .sort((left, right) =>
        absencePolicyStartsOn(left)
          .toString()
          .localeCompare(absencePolicyStartsOn(right).toString())
      )
    const activeInterval =
      overlapping.find((interval) => intervalContainsDate(interval, cycleToday)) ??
      overlapping.at(-1) ??
      null

    let utilityParticipationDays = 0
    for (let day = 1; day <= daysInMonth; day += 1) {
      const currentDate = Temporal.PlainDate.from({
        year: period.year,
        month: period.month,
        day
      })
      const policy = latestPolicyForDate({
        member,
        policies: input.policies,
        date: currentDate
      })
      if (member.status !== 'left' && policyParticipatesInUtilities(policy)) {
        utilityParticipationDays += 1
      }
    }

    resolved.set(member.id, {
      memberId: member.id,
      policy: activeInterval?.policy ?? defaultAbsencePolicyForMember(member),
      startsOn:
        activeInterval?.startsOn ??
        (activeInterval?.effectiveFromPeriod ? `${activeInterval.effectiveFromPeriod}-01` : null),
      endsOn: activeInterval?.endsOn ?? null,
      utilityParticipationDays
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
  settings: HouseholdBillingSettingsRecord
}): bigint {
  const policy = resolvedPaymentBalanceAdjustmentPolicy(input.settings)
  const adjustedMinor =
    policy === input.kind ? input.baseMinor + input.purchaseOffsetMinor : input.baseMinor

  return clampNonNegativeMinor(adjustedMinor)
}

function actionablePaymentDueMinor(input: {
  kind: FinancePaymentKind
  baseMinor: bigint
  purchaseOffsetMinor: bigint
  settings: HouseholdBillingSettingsRecord
}): bigint {
  return roundSuggestedPaymentMinor(
    input.kind,
    adjustedPaymentBaseMinor({
      kind: input.kind,
      baseMinor: input.baseMinor,
      purchaseOffsetMinor: input.purchaseOffsetMinor,
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
      absencePolicy: member.absencePolicy,
      absenceIntervalStartsOn: member.absenceIntervalStartsOn,
      absenceIntervalEndsOn: member.absenceIntervalEndsOn,
      utilityParticipationDays: member.utilityParticipationDays,
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
  return (
    JSON.stringify(serializeUtilityBillingPlanPayload(left)) !==
      JSON.stringify(serializeUtilityBillingPlanPayload(right)) ||
    left.status !== right.status ||
    left.maxCategoriesPerMemberApplied !== right.maxCategoriesPerMemberApplied
  )
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
  convertedUtilityBills: readonly {
    bill: Awaited<ReturnType<FinanceRepository['listUtilityBillsForCycle']>>[number]
    converted: ConvertedCycleMoney
  }[]
}): Promise<{
  record: Awaited<ReturnType<FinanceRepository['saveUtilityBillingPlan']>>
  computed: UtilityBillingPlanComputed
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

  const computed = computeUtilityBillingPlan({
    currency: input.cycle.currency,
    members: input.settlementLines.map((line) => ({
      memberId: line.memberId,
      displayName:
        input.members.find((member) => member.id === line.memberId)?.displayName ?? line.memberId,
      fairShare: Money.fromMinor(
        adjustmentPolicy === 'utilities'
          ? adjustedPaymentBaseMinor({
              kind: 'utilities',
              baseMinor: line.utilityShare.amountMinor,
              purchaseOffsetMinor: line.purchaseOffset.amountMinor,
              settings: input.settings
            })
          : line.utilityShare.amountMinor,
        input.cycle.currency
      )
    })),
    bills: input.convertedUtilityBills.map(({ bill, converted }) => ({
      utilityBillId: bill.id,
      billName: bill.billName,
      amount: converted.settlementAmount
    })),
    vendorPayments: vendorFacts.map((fact) => ({
      utilityBillId: fact.utilityBillId,
      billName: fact.billName,
      payerMemberId: fact.payerMemberId,
      amount: Money.fromMinor(fact.amountMinor, fact.currency)
    })),
    strategy: adjustmentPolicy === 'rent' ? 'whole_bills_first' : 'same_cycle'
  })

  if (activePlan) {
    const materialized = materializeUtilityBillingPlanRecord(activePlan)
    if (!utilityPlanPayloadChanged(materialized, computed)) {
      return {
        record: activePlan,
        computed: materialized
      }
    }

    const hadOffPlanFact = vendorFacts.some((fact) => !fact.matchedPlan)
    await input.dependencies.repository.updateUtilityBillingPlanStatus(
      activePlan.id,
      hadOffPlanFact ? 'diverged' : 'superseded'
    )
  }

  const nextVersion =
    existingPlans.reduce((max, plan) => (plan.version > max ? plan.version : max), 0) + 1
  const dueDate = billingPeriodLockDate(
    BillingPeriod.fromString(input.cycle.period),
    input.settings.utilitiesDueDay
  ).toString()
  const record = await input.dependencies.repository.saveUtilityBillingPlan({
    cycleId: input.cycle.id,
    version: nextVersion,
    status: computed.status,
    dueDate,
    currency: input.cycle.currency,
    maxCategoriesPerMemberApplied: computed.maxCategoriesPerMemberApplied,
    updatedFromPlanId: activePlan?.id ?? null,
    reason:
      activePlan && vendorFacts.some((fact) => !fact.matchedPlan)
        ? 'rebalanced_after_off_plan_change'
        : activePlan
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
    memberSummaries: input.computed.memberSummaries.map((summary) => ({
      memberId: summary.memberId,
      displayName: input.memberNameById.get(summary.memberId) ?? summary.memberId,
      fairShare: summary.fairShare,
      vendorPaid: summary.vendorPaid,
      assignedThisCycle: summary.assignedThisCycle,
      projectedDeltaAfterPlan: summary.projectedDeltaAfterPlan
    }))
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
    input.utilityBillingPlan.categories.length > 0 &&
    Temporal.PlainDate.compare(localDate, utilitiesReminder) >= 0 &&
    Temporal.PlainDate.compare(localDate, rentReminder) < 0

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

  const plans = await repository.listUtilityBillingPlansForCycle(cycle.id)
  const activePlan =
    [...plans].reverse().find((plan) => plan.status === 'active' || plan.status === 'settled') ??
    null

  if (!activePlan) {
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
  memberAbsencePolicies: readonly HouseholdMemberAbsencePolicyRecord[]
  settings: HouseholdBillingSettingsRecord
}): Promise<readonly CycleBaseMemberLine[]> {
  const period = BillingPeriod.fromString(input.cycle.period)
  const resolvedAbsencePolicies = resolveMemberAbsencePolicies({
    members: input.members,
    policies: input.memberAbsencePolicies,
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
      const resolvedPolicy = resolvedAbsencePolicies.get(member.id)

      return {
        memberId: MemberId.from(member.id),
        active: member.status !== 'left',
        participatesInRent:
          member.status !== 'left' &&
          policyParticipatesInRent(resolvedPolicy?.policy ?? 'resident'),
        participatesInUtilities:
          member.status !== 'left' && (resolvedPolicy?.utilityParticipationDays ?? 0) > 0,
        participatesInPurchases:
          member.status !== 'left' &&
          policyParticipatesInPurchases(resolvedPolicy?.policy ?? 'resident'),
        rentWeight: member.rentShareWeight,
        utilityDays: Math.max(resolvedPolicy?.utilityParticipationDays ?? 0, 1)
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
  memberAbsencePolicies: readonly HouseholdMemberAbsencePolicyRecord[]
  settings: HouseholdBillingSettingsRecord
}): Promise<ReadonlyMap<string, readonly FinanceMemberOverduePaymentRecord[]>> {
  const localDate = localDateInTimezone(input.settings.timezone)
  const overdueByMemberId = new Map<string, MutableOverdueSummary>()
  const cycles = (await input.dependencies.repository.listCycles()).filter(
    (cycle) => cycle.period.localeCompare(input.currentCycle.period) <= 0
  )

  for (const cycle of cycles) {
    const baseLines = await buildCycleBaseMemberLines({
      dependencies: input.dependencies,
      cycle,
      members: input.members,
      memberAbsencePolicies: input.memberAbsencePolicies,
      settings: input.settings
    })
    const rentDueDate = billingPeriodLockDate(
      BillingPeriod.fromString(cycle.period),
      input.settings.rentDueDay
    )
    const utilitiesDueDate = billingPeriodLockDate(
      BillingPeriod.fromString(cycle.period),
      input.settings.utilitiesDueDay
    )

    for (const line of baseLines) {
      const current = overdueByMemberId.get(line.memberId) ?? {
        rent: { amountMinor: 0n, periods: [] },
        utilities: { amountMinor: 0n, periods: [] }
      }

      const rentRemainingMinor = effectiveRemainingMinor(
        line.rentShare.amountMinor,
        line.rentPaid.amountMinor
      )
      if (Temporal.PlainDate.compare(localDate, rentDueDate) > 0 && rentRemainingMinor > 0n) {
        current.rent.amountMinor += rentRemainingMinor
        current.rent.periods.push(cycle.period)
      }

      const utilityRemainingMinor = effectiveRemainingMinor(
        line.utilityShare.amountMinor,
        line.utilityPaid.amountMinor
      )
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
  memberAbsencePolicies: readonly HouseholdMemberAbsencePolicyRecord[]
  settings: HouseholdBillingSettingsRecord
  currentUtilityPlan: UtilityBillingPlanComputed | null
}): Promise<readonly FinanceDashboardPaymentPeriodSummary[]> {
  const localDate = localDateInTimezone(input.settings.timezone)
  const memberNameById = new Map(input.members.map((member) => [member.id, member.displayName]))
  const cycles = (await input.dependencies.repository.listCycles())
    .filter((cycle) => cycle.period.localeCompare(input.currentCycle.period) <= 0)
    .sort((left, right) => right.period.localeCompare(left.period))

  const summaries: FinanceDashboardPaymentPeriodSummary[] = []

  for (const cycle of cycles) {
    const [baseLines, utilityBills] = await Promise.all([
      buildCycleBaseMemberLines({
        dependencies: input.dependencies,
        cycle,
        members: input.members,
        memberAbsencePolicies: input.memberAbsencePolicies,
        settings: input.settings
      }),
      input.dependencies.repository.listUtilityBillsForCycle(cycle.id)
    ])

    const utilityTotal = utilityBills.reduce(
      (sum, bill) => sum.add(Money.fromMinor(bill.amountMinor, bill.currency)),
      Money.zero(cycle.currency)
    )
    const rentDueDate = billingPeriodLockDate(
      BillingPeriod.fromString(cycle.period),
      input.settings.rentDueDay
    )
    const utilitiesDueDate = billingPeriodLockDate(
      BillingPeriod.fromString(cycle.period),
      input.settings.utilitiesDueDay
    )
    const utilityPlanSummaryByMemberId =
      cycle.period === input.currentCycle.period && input.currentUtilityPlan
        ? new Map(
            input.currentUtilityPlan.memberSummaries.map(
              (summary) => [summary.memberId, summary] as const
            )
          )
        : null

    const rentMembers = baseLines.map((line) => {
      const dueMinor = actionablePaymentDueMinor({
        kind: 'rent',
        baseMinor: line.rentShare.amountMinor,
        purchaseOffsetMinor: line.purchaseOffset.amountMinor,
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

    const utilitiesMembers = baseLines.map((line) => {
      const plannedAssignedMinor =
        utilityPlanSummaryByMemberId?.get(line.memberId)?.assignedThisCycle.amountMinor ?? null
      const dueMinor =
        plannedAssignedMinor ??
        adjustedPaymentBaseMinor({
          kind: 'utilities',
          baseMinor: line.utilityShare.amountMinor,
          purchaseOffsetMinor: line.purchaseOffset.amountMinor,
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
          unresolvedMembers: rentMembers.filter((member) => !member.effectivelySettled)
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
  memberAbsencePolicies: readonly HouseholdMemberAbsencePolicyRecord[]
  settings: HouseholdBillingSettingsRecord
  memberId: string
  kind: FinancePaymentKind
}): Promise<bigint> {
  const baseLine = (
    await buildCycleBaseMemberLines({
      dependencies: input.dependencies,
      cycle: input.cycle,
      members: input.members,
      memberAbsencePolicies: input.memberAbsencePolicies,
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
  memberAbsencePolicies: readonly HouseholdMemberAbsencePolicyRecord[]
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
        memberAbsencePolicies: input.memberAbsencePolicies,
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
  } = {}
): Promise<FinanceDashboard | null> {
  const cycle = await getCycleByPeriodOrLatest(dependencies.repository, periodArg)
  if (!cycle) {
    return null
  }

  const [members, memberAbsencePolicies, rentRule, settings] = await Promise.all([
    dependencies.householdConfigurationRepository.listHouseholdMembers(dependencies.householdId),
    dependencies.householdConfigurationRepository.listHouseholdMemberAbsencePolicies(
      dependencies.householdId
    ),
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
  const resolvedAbsencePolicies = resolveMemberAbsencePolicies({
    members,
    policies: memberAbsencePolicies,
    period: cycle.period
  })
  const [allPurchases, utilityBills, paymentPurchaseAllocations] = await Promise.all([
    dependencies.repository.listParsedPurchases(),
    dependencies.repository.listUtilityBillsForCycle(cycle.id),
    dependencies.repository.listPaymentPurchaseAllocations()
  ])
  const paymentRecords = await dependencies.repository.listPaymentRecordsForCycle(cycle.id)
  const previousCycle = await dependencies.repository.getCycleByPeriod(period.previous().toString())
  const previousSnapshotLines = previousCycle
    ? await dependencies.repository.getSettlementSnapshotLines(previousCycle.id)
    : []
  const overduePaymentsByMemberId = await computeMemberOverduePayments({
    dependencies,
    currentCycle: cycle,
    members,
    memberAbsencePolicies,
    settings
  })
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
    .filter(
      (member) =>
        member.status !== 'left' &&
        policyParticipatesInPurchases(resolvedAbsencePolicies.get(member.id)?.policy ?? 'resident')
    )
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
      const resolvedPolicy = resolvedAbsencePolicies.get(member.id)

      return {
        memberId: MemberId.from(member.id),
        active: member.status !== 'left',
        participatesInRent:
          member.status !== 'left' &&
          policyParticipatesInRent(resolvedPolicy?.policy ?? 'resident'),
        participatesInUtilities:
          member.status !== 'left' && (resolvedPolicy?.utilityParticipationDays ?? 0) > 0,
        participatesInPurchases:
          member.status !== 'left' &&
          policyParticipatesInPurchases(resolvedPolicy?.policy ?? 'resident'),
        rentWeight: member.rentShareWeight,
        utilityDays: Math.max(resolvedPolicy?.utilityParticipationDays ?? 0, 1)
      }
    }),
    purchases: purchaseHistory
      .filter(
        ({ purchase, outstandingTotal }) =>
          currentCyclePurchaseIds.has(purchase.id) || outstandingTotal.amountMinor > 0n
      )
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
  const dashboardMembers = settlement.lines.map((line) => ({
    memberId: line.memberId.toString(),
    displayName: memberNameById.get(line.memberId.toString()) ?? line.memberId.toString(),
    status: members.find((member) => member.id === line.memberId.toString())?.status ?? 'active',
    absencePolicy: resolvedAbsencePolicies.get(line.memberId.toString())?.policy ?? 'resident',
    absenceIntervalStartsOn:
      resolvedAbsencePolicies.get(line.memberId.toString())?.startsOn ?? null,
    absenceIntervalEndsOn: resolvedAbsencePolicies.get(line.memberId.toString())?.endsOn ?? null,
    utilityParticipationDays:
      resolvedAbsencePolicies.get(line.memberId.toString())?.utilityParticipationDays ?? 0,
    predictedUtilityShare: previousUtilityShareByMemberId.get(line.memberId.toString()) ?? null,
    rentShare: line.rentShare,
    utilityShare: line.utilityShare,
    purchaseOffset: line.purchaseOffset,
    netDue: line.netDue,
    paid: paymentsByMemberId.get(line.memberId.toString()) ?? Money.zero(cycle.currency),
    remaining: line.netDue.subtract(
      paymentsByMemberId.get(line.memberId.toString()) ?? Money.zero(cycle.currency)
    ),
    overduePayments:
      overduePaymentsByMemberId.get(line.memberId.toString())?.map((overdue) => ({
        kind: overdue.kind,
        amountMinor: overdue.amountMinor,
        periods: overdue.periods
      })) ?? [],
    explanations: line.explanations
  }))
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
    convertedUtilityBills
  })
  const paymentPeriods = await buildPaymentPeriodSummaries({
    dependencies,
    currentCycle: cycle,
    members,
    memberAbsencePolicies,
    settings,
    currentUtilityPlan: ensuredUtilityPlan.computed
  })
  const utilityPlanVersions = await dependencies.repository.listUtilityBillingPlansForCycle(
    cycle.id
  )
  const utilityPlanVersionById = new Map(
    utilityPlanVersions.map((plan) => [plan.id, plan.version] as const)
  )
  const dashboardUtilityBillingPlan = buildDashboardUtilityBillingPlan({
    planRecord: ensuredUtilityPlan.record,
    computed: ensuredUtilityPlan.computed,
    memberNameById,
    priorVersionByPlanId: utilityPlanVersionById
  })
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
}): Promise<
  readonly {
    purchaseId: string
    memberId: string
    amountMinor: bigint
  }[]
> {
  const policy = input.settings.paymentBalanceAdjustmentPolicy ?? 'utilities'
  if (policy === 'separate' || policy !== input.kind) {
    return []
  }

  const dashboard = await buildFinanceDashboard(input.dependencies, input.cyclePeriod)
  if (!dashboard) {
    return []
  }

  const memberLine = dashboard.members.find((member) => member.memberId === input.memberId)
  if (!memberLine) {
    return []
  }

  const baseAmount = input.kind === 'rent' ? memberLine.rentShare : memberLine.utilityShare
  const baseThresholdMinor = roundSuggestedPaymentMinor(input.kind, baseAmount.amountMinor)
  let remainingMinor = input.paymentAmount.amountMinor - baseThresholdMinor
  if (remainingMinor <= 0n) {
    return []
  }

  const purchaseEntries = dashboard.ledger
    .filter(
      (
        entry
      ): entry is FinanceDashboardLedgerEntry & {
        kind: 'purchase'
        outstandingByMember: readonly { memberId: string; amount: Money }[]
      } =>
        entry.kind === 'purchase' &&
        entry.resolutionStatus === 'unresolved' &&
        Array.isArray(entry.outstandingByMember)
    )
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
    const memberOutstanding = entry.outstandingByMember.find(
      (outstanding) => outstanding.memberId === input.memberId
    )
    if (!memberOutstanding || memberOutstanding.amount.amountMinor <= 0n) {
      continue
    }

    const allocatedMinor =
      remainingMinor >= memberOutstanding.amount.amountMinor
        ? memberOutstanding.amount.amountMinor
        : remainingMinor

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

  return allocations
}

export interface FinanceCommandService {
  getMemberByTelegramUserId(telegramUserId: string): Promise<FinanceMemberRecord | null>
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
    currencyArg?: string
  ): Promise<{
    amount: Money
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
  generateCurrentBillPlan(periodArg?: string): Promise<FinanceCurrentBillPlan | null>
  resolveUtilityBillAsPlanned(input: {
    memberId: string
    actorMemberId?: string
    periodArg?: string
  }): Promise<{
    period: string
    resolvedBillIds: readonly string[]
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
  generateDashboard(
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
      await repository.saveRentRule(period, settings.rentAmountMinor, settings.rentCurrency)
    }

    return cycle
  }

  return {
    getMemberByTelegramUserId(telegramUserId) {
      return repository.getMemberByTelegramUserId(telegramUserId)
    },

    getOpenCycle() {
      return repository.getOpenCycle()
    },

    ensureExpectedCycle(referenceInstant) {
      return ensureExpectedCycle(referenceInstant)
    },

    async getAdminCycleState(periodArg) {
      const cycle = periodArg
        ? await repository.getCycleByPeriod(BillingPeriod.fromString(periodArg).toString())
        : await ensureExpectedCycle()

      if (!cycle) {
        return {
          cycle: null,
          rentRule: null,
          utilityBills: []
        }
      }

      const [rentRule, utilityBills] = await Promise.all([
        repository.getRentRuleForPeriod(cycle.period),
        repository.listUtilityBillsForCycle(cycle.id)
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

    async addUtilityBill(billName, amountArg, createdByMemberId, currencyArg) {
      const [openCycle, settings] = await Promise.all([
        ensureExpectedCycle(),
        householdConfigurationRepository.getHouseholdBillingSettings(dependencies.householdId)
      ])

      const currency = parseCurrency(currencyArg, settings.settlementCurrency)
      const amount = Money.fromMajor(amountArg, currency)

      await repository.addUtilityBill({
        cycleId: openCycle.id,
        billName,
        amountMinor: amount.amountMinor,
        currency,
        createdByMemberId
      })

      return {
        amount,
        currency,
        period: openCycle.period
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

      return {
        billId: updated.id,
        amount,
        currency
      }
    },

    deleteUtilityBill(billId) {
      return repository.deleteUtilityBill(billId)
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
      const settings = await householdConfigurationRepository.getHouseholdBillingSettings(
        dependencies.householdId
      )
      const currency = parseCurrency(currencyArg, settings.settlementCurrency)
      const amount = Money.fromMajor(amountArg, currency)

      if (split?.mode === 'custom_amounts') {
        const includedParticipants = split.participants.filter((p) => p.included !== false)

        if (includedParticipants.some((p) => p.shareAmountMajor === undefined)) {
          throw new DomainError(
            DOMAIN_ERROR_CODE.INVALID_SETTLEMENT_INPUT,
            'Purchase custom split must include explicit share amounts for every included participant'
          )
        }

        const totalMinor = includedParticipants.reduce(
          (sum, p) => sum + Money.fromMajor(p.shareAmountMajor!, currency).amountMinor,
          0n
        )
        if (totalMinor !== amount.amountMinor) {
          throw new DomainError(
            DOMAIN_ERROR_CODE.INVALID_SETTLEMENT_INPUT,
            'Purchase custom split must add up to the full amount'
          )
        }
      }

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
              splitMode: split.mode,
              participants: split.participants.map((participant) => ({
                memberId: participant.memberId,
                included: participant.included ?? true,
                shareAmountMinor:
                  participant.shareAmountMajor !== undefined
                    ? Money.fromMajor(participant.shareAmountMajor, currency).amountMinor
                    : null
              }))
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
      const settings = await householdConfigurationRepository.getHouseholdBillingSettings(
        dependencies.householdId
      )
      const currency = parseCurrency(currencyArg, settings.settlementCurrency)
      const amount = Money.fromMajor(amountArg, currency)

      const openCycle = await repository.getOpenCycle()
      if (!openCycle) {
        throw new DomainError(DOMAIN_ERROR_CODE.INVALID_SETTLEMENT_INPUT, 'No open billing cycle')
      }

      if (split?.mode === 'custom_amounts') {
        const includedParticipants = split.participants.filter((p) => p.included !== false)

        if (includedParticipants.some((p) => p.shareAmountMajor === undefined)) {
          throw new DomainError(
            DOMAIN_ERROR_CODE.INVALID_SETTLEMENT_INPUT,
            'Purchase custom split must include explicit share amounts for every included participant'
          )
        }

        const totalMinor = includedParticipants.reduce(
          (sum, p) => sum + Money.fromMajor(p.shareAmountMajor!, currency).amountMinor,
          0n
        )
        if (totalMinor !== amount.amountMinor) {
          throw new DomainError(
            DOMAIN_ERROR_CODE.INVALID_SETTLEMENT_INPUT,
            'Purchase custom split must add up to the full amount'
          )
        }
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
              splitMode: split.mode,
              participants: split.participants.map((participant) => ({
                memberId: participant.memberId,
                included: participant.included ?? true,
                shareAmountMinor:
                  participant.shareAmountMajor !== undefined
                    ? Money.fromMajor(participant.shareAmountMajor, currency).amountMinor
                    : null
              }))
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

    async addPayment(memberId, kind, amountArg, currencyArg, periodArg) {
      const [settings, members, memberAbsencePolicies] = await Promise.all([
        householdConfigurationRepository.getHouseholdBillingSettings(dependencies.householdId),
        householdConfigurationRepository.listHouseholdMembers(dependencies.householdId),
        householdConfigurationRepository.listHouseholdMemberAbsencePolicies(
          dependencies.householdId
        )
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
          memberAbsencePolicies,
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
            memberAbsencePolicies,
            settings,
            memberId,
            kind
          })

      if (
        !periodArg &&
        paymentTargets.every(
          (target) => target.baseRemainingMinor <= 0n && target.cycle.id === currentCycle.id
        )
      ) {
        throw new Error('Payment period is already settled')
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

        const allocations = target.allowOverflow
          ? await allocatePaymentPurchaseOverage({
              dependencies,
              cyclePeriod: target.cycle.period,
              memberId,
              kind,
              paymentAmount: Money.fromMinor(amountMinor, currency),
              settings
            })
          : []
        await repository.replacePaymentPurchaseAllocations({
          paymentRecordId: payment.id,
          allocations
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
        allocations: []
      })

      const allocations = await allocatePaymentPurchaseOverage({
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
        allocations
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
        utilityBillingPlan: dashboard.utilityBillingPlan,
        rentBillingState: dashboard.rentBillingState
      }
    },

    async resolveUtilityBillAsPlanned(input) {
      const dashboard = await (input.periodArg
        ? buildFinanceDashboard(dependencies, input.periodArg)
        : ensureExpectedCycle().then(() => buildFinanceDashboard(dependencies)))

      if (!dashboard?.utilityBillingPlan) {
        return null
      }

      const categories = dashboard.utilityBillingPlan.categories.filter(
        (category) =>
          category.assignedMemberId === input.memberId && category.assignedAmount.amountMinor > 0n
      )
      if (categories.length === 0) {
        throw new Error('No planned utility bills assigned to this member')
      }

      const cycle = await repository.getCycleByPeriod(dashboard.period)
      if (!cycle) {
        return null
      }

      for (const category of categories) {
        await repository.addUtilityVendorPaymentFact({
          cycleId: cycle.id,
          utilityBillId: category.utilityBillId,
          billName: category.billName,
          payerMemberId: input.memberId,
          amountMinor: category.assignedAmount.amountMinor,
          currency: dashboard.currency,
          plannedForMemberId: input.memberId,
          planVersion: dashboard.utilityBillingPlan.version,
          matchedPlan: true,
          recordedByMemberId: input.actorMemberId ?? input.memberId,
          recordedAt: nowInstant()
        })
      }

      const nextDashboard = await buildFinanceDashboard(dependencies, dashboard.period)
      return {
        period: dashboard.period,
        resolvedBillIds: [...new Set(categories.map((category) => category.utilityBillId))],
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
        plannedForMemberId: matchingCategory?.assignedMemberId ?? null,
        planVersion: dashboard.utilityBillingPlan?.version ?? null,
        matchedPlan: Boolean(matchingCategory),
        recordedByMemberId: input.actorMemberId ?? input.payerMemberId,
        recordedAt: nowInstant()
      })

      const nextDashboard = await buildFinanceDashboard(dependencies, dashboard.period)
      return {
        period: dashboard.period,
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

      const [cycle, openCycle, settings, members, absencePolicies, utilityCategories] =
        await Promise.all([
          repository.getCycleByPeriod(dashboard.period),
          repository.getOpenCycle(),
          householdConfigurationRepository.getHouseholdBillingSettings(dependencies.householdId),
          householdConfigurationRepository.listHouseholdMembers(dependencies.householdId),
          householdConfigurationRepository.listHouseholdMemberAbsencePolicies(
            dependencies.householdId
          ),
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
            activeAbsencePolicy:
              dashboardMember?.absencePolicy ?? defaultAbsencePolicyForMember(member),
            absenceIntervalStartsOn: dashboardMember?.absenceIntervalStartsOn ?? null,
            absenceIntervalEndsOn: dashboardMember?.absenceIntervalEndsOn ?? null,
            utilityParticipationDays: dashboardMember?.utilityParticipationDays ?? 0
          }
        }),
        absencePolicies: absencePolicies.map((policy) => ({
          memberId: policy.memberId,
          policy: policy.policy,
          startsOn: policy.startsOn ?? null,
          endsOn: policy.endsOn ?? null,
          effectiveFromPeriod: policy.effectiveFromPeriod ?? null
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
      return periodArg
        ? buildFinanceDashboard(dependencies, periodArg, options)
        : ensureExpectedCycle().then(() => buildFinanceDashboard(dependencies, undefined, options))
    }
  }
}
