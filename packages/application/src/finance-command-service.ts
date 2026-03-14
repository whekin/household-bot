import { createHash } from 'node:crypto'

import type {
  ExchangeRateProvider,
  FinanceCycleRecord,
  FinanceMemberRecord,
  FinancePaymentKind,
  FinanceRentRuleRecord,
  FinanceRepository,
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
  explanations: readonly string[]
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

  if (!rentRule) {
    throw new Error('No rent rule configured for this cycle period')
  }

  const period = BillingPeriod.fromString(cycle.period)
  const { start, end } = monthRange(period)
  const resolvedAbsencePolicies = resolveMemberAbsencePolicies({
    members,
    policies: memberAbsencePolicies,
    period: cycle.period
  })
  const [purchases, utilityBills] = await Promise.all([
    dependencies.repository.listParsedPurchasesForRange(start, end),
    dependencies.repository.listUtilityBillsForCycle(cycle.id)
  ])
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
    amount: Money.fromMinor(rentRule.amountMinor, rentRule.currency)
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
    purchases.map(async (purchase) => {
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
    purchases: convertedPurchases.map(({ purchase, converted }) => {
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
        amount: converted.settlementAmount,
        splitMode: purchase.splitMode ?? 'equal'
      }

      if (purchase.participants) {
        nextPurchase.participants = purchase.participants
          .filter((participant) => participant.included !== false)
          .map((participant) => ({
            memberId: MemberId.from(participant.memberId),
            ...(participant.shareAmountMinor !== null
              ? {
                  shareAmount: Money.fromMinor(
                    participant.shareAmountMinor,
                    converted.settlementAmount.currency
                  )
                }
              : {})
          }))
      }

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
    ...convertedPurchases.map(({ purchase, converted }) => {
      const entry: FinanceDashboardLedgerEntry = {
        id: purchase.id,
        kind: 'purchase',
        title: purchase.description ?? 'Shared purchase',
        memberId: purchase.payerMemberId,
        amount: converted.originalAmount,
        currency: purchase.currency,
        displayAmount: converted.settlementAmount,
        displayCurrency: cycle.currency,
        fxRateMicros: converted.fxRateMicros,
        fxEffectiveDate: converted.fxEffectiveDate,
        actorDisplayName: memberNameById.get(purchase.payerMemberId) ?? null,
        occurredAt: purchase.occurredAt?.toString() ?? null,
        paymentKind: null,
        purchaseSplitMode: purchase.splitMode ?? 'equal'
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
    ledger
  }
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
    }
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
    currencyArg?: string
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

    async updatePurchase(purchaseId, description, amountArg, currencyArg, split) {
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

    async addPayment(memberId, kind, amountArg, currencyArg) {
      const [openCycle, settings] = await Promise.all([
        ensureExpectedCycle(),
        householdConfigurationRepository.getHouseholdBillingSettings(dependencies.householdId)
      ])

      const currency = parseCurrency(currencyArg, settings.settlementCurrency)
      const amount = Money.fromMajor(amountArg, currency)
      const payment = await repository.addPaymentRecord({
        cycleId: openCycle.id,
        memberId,
        kind,
        amountMinor: amount.amountMinor,
        currency,
        recordedAt: nowInstant()
      })

      return {
        paymentId: payment.id,
        amount,
        currency,
        period: openCycle.period
      }
    },

    async updatePayment(paymentId, memberId, kind, amountArg, currencyArg) {
      const settings = await householdConfigurationRepository.getHouseholdBillingSettings(
        dependencies.householdId
      )
      const currency = parseCurrency(currencyArg, settings.settlementCurrency)
      const amount = Money.fromMajor(amountArg, currency)
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
