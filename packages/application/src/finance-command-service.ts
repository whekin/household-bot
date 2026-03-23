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

export interface FinanceDashboardMemberLine {
  memberId: string
  displayName: string
  status?: 'active' | 'away' | 'left'
  absencePolicy?: HouseholdMemberAbsencePolicy
  absencePolicyEffectiveFromPeriod?: string | null
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
  rentSourceAmount: Money
  rentDisplayAmount: Money
  rentFxRateMicros: bigint | null
  rentFxEffectiveDate: string | null
  members: readonly FinanceDashboardMemberLine[]
  paymentPeriods?: readonly FinanceDashboardPaymentPeriodSummary[]
  ledger: readonly FinanceDashboardLedgerEntry[]
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

interface FinanceCommandServiceDependencies {
  householdId: string
  repository: FinanceRepository
  householdConfigurationRepository: Pick<
    HouseholdConfigurationRepository,
    'getHouseholdBillingSettings' | 'listHouseholdMembers' | 'listHouseholdMemberAbsencePolicies'
  >
  exchangeRateProvider: ExchangeRateProvider
}

interface ResolvedMemberAbsencePolicy {
  memberId: string
  policy: HouseholdMemberAbsencePolicy
  effectiveFromPeriod: string | null
}

function resolveMemberAbsencePolicies(input: {
  members: readonly HouseholdMemberRecord[]
  policies: readonly HouseholdMemberAbsencePolicyRecord[]
  period: string
}): ReadonlyMap<string, ResolvedMemberAbsencePolicy> {
  const resolved = new Map<string, ResolvedMemberAbsencePolicy>()

  for (const member of input.members) {
    const applicable = input.policies
      .filter(
        (policy) =>
          policy.memberId === member.id &&
          policy.effectiveFromPeriod.localeCompare(input.period) <= 0
      )
      .sort((left, right) => left.effectiveFromPeriod.localeCompare(right.effectiveFromPeriod))
      .at(-1)

    resolved.set(member.id, {
      memberId: member.id,
      policy:
        applicable?.policy ?? (member.status === 'away' ? 'away_rent_and_utilities' : 'resident'),
      effectiveFromPeriod: applicable?.effectiveFromPeriod ?? null
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
    utilitySplitMode: 'equal',
    members: input.members.map((member) => ({
      memberId: MemberId.from(member.id),
      active: member.status !== 'left',
      participatesInRent:
        member.status === 'left'
          ? false
          : (resolvedAbsencePolicies.get(member.id)?.policy ?? 'resident') !== 'inactive',
      participatesInUtilities:
        member.status === 'away'
          ? (resolvedAbsencePolicies.get(member.id)?.policy ?? 'resident') ===
            'away_rent_and_utilities'
          : member.status !== 'left',
      participatesInPurchases: member.status === 'active',
      rentWeight: member.rentShareWeight
    })),
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

    const rentMembers = baseLines.map((line) => {
      const remainingMinor = effectiveRemainingMinor(
        line.rentShare.amountMinor,
        line.rentPaid.amountMinor
      )
      const baseDue = line.rentShare
      return {
        memberId: line.memberId,
        displayName: memberNameById.get(line.memberId) ?? line.memberId,
        suggestedAmount: Money.fromMinor(
          roundSuggestedPaymentMinor('rent', remainingMinor),
          cycle.currency
        ),
        baseDue,
        paid: line.rentPaid,
        remaining: Money.fromMinor(remainingMinor, cycle.currency),
        effectivelySettled: remainingMinor === 0n
      } satisfies FinanceDashboardPaymentMemberSummary
    })

    const utilitiesMembers = baseLines.map((line) => {
      const remainingMinor = effectiveRemainingMinor(
        line.utilityShare.amountMinor,
        line.utilityPaid.amountMinor
      )
      return {
        memberId: line.memberId,
        displayName: memberNameById.get(line.memberId) ?? line.memberId,
        suggestedAmount: Money.fromMinor(remainingMinor, cycle.currency),
        baseDue: line.utilityShare,
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
  periodArg?: string
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
  const [overduePaymentsByMemberId, paymentPeriods] = await Promise.all([
    computeMemberOverduePayments({
      dependencies,
      currentCycle: cycle,
      members,
      memberAbsencePolicies,
      settings
    }),
    buildPaymentPeriodSummaries({
      dependencies,
      currentCycle: cycle,
      members,
      memberAbsencePolicies,
      settings
    })
  ])
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
    utilitySplitMode: 'equal',
    members: members.map((member) => ({
      memberId: MemberId.from(member.id),
      active: member.status !== 'left',
      participatesInRent:
        member.status === 'left'
          ? false
          : (resolvedAbsencePolicies.get(member.id)?.policy ?? 'resident') !== 'inactive',
      participatesInUtilities:
        member.status === 'away'
          ? (resolvedAbsencePolicies.get(member.id)?.policy ?? 'resident') ===
            'away_rent_and_utilities'
          : member.status !== 'left',
      participatesInPurchases: member.status === 'active',
      rentWeight: member.rentShareWeight
    })),
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
    absencePolicyEffectiveFromPeriod:
      resolvedAbsencePolicies.get(line.memberId.toString())?.effectiveFromPeriod ?? null,
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
      return left.title.localeCompare(right.title)
    }

    return (left.occurredAt ?? '').localeCompare(right.occurredAt ?? '')
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
    periodArg?: string
  ): Promise<{
    amount: Money
    currency: CurrencyCode
    period: string
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
    payerMemberId?: string
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
    }
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
  generateDashboard(periodArg?: string): Promise<FinanceDashboard | null>
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

    async setRent(amountArg, currencyArg, periodArg) {
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

      return {
        amount,
        currency,
        period: BillingPeriod.fromString(period).toString()
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

    async updatePurchase(purchaseId, description, amountArg, currencyArg, split, payerMemberId) {
      const settings = await householdConfigurationRepository.getHouseholdBillingSettings(
        dependencies.householdId
      )
      const currency = parseCurrency(currencyArg, settings.settlementCurrency)
      const amount = Money.fromMajor(amountArg, currency)

      if (split?.mode === 'custom_amounts') {
        if (split.participants.some((p) => p.shareAmountMajor === undefined)) {
          throw new DomainError(
            DOMAIN_ERROR_CODE.INVALID_SETTLEMENT_INPUT,
            'Purchase custom split must include explicit share amounts for every participant'
          )
        }

        const totalMinor = split.participants.reduce(
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

      return {
        purchaseId: updated.id,
        amount,
        currency
      }
    },

    async addPurchase(description, amountArg, payerMemberId, currencyArg, split) {
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
        if (split.participants.some((p) => p.shareAmountMajor === undefined)) {
          throw new DomainError(
            DOMAIN_ERROR_CODE.INVALID_SETTLEMENT_INPUT,
            'Purchase custom split must include explicit share amounts for every participant'
          )
        }

        const totalMinor = split.participants.reduce(
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
        occurredAt: nowInstant(),
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

      return {
        purchaseId: created.id,
        amount,
        currency
      }
    },

    deletePurchase(purchaseId) {
      return repository.deleteParsedPurchase(purchaseId)
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

    generateDashboard(periodArg) {
      return periodArg
        ? buildFinanceDashboard(dependencies, periodArg)
        : ensureExpectedCycle().then(() => buildFinanceDashboard(dependencies))
    }
  }
}
