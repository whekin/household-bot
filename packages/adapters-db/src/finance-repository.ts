import { paymentPricingRevision } from './payment-pricing-revision'
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm'

import { createDbClient, schema } from '@household/db'
import type {
  FinanceParsedPurchaseRecord,
  FinancePurchaseTopicMessageRecord,
  FinanceRepository,
  SettlementSnapshotRecord,
  SettlementSnapshotLineRecord,
  FinanceSavedPurchaseParticipantToggleResult,
  FinanceUtilityBillingPlanPayload,
  FinanceUtilityBillingPlanRecord
} from '@household/ports'
import {
  Money,
  convertMoney,
  instantFromDatabaseValue,
  instantToDate,
  nowInstant,
  paymentFundingRevision,
  parsePaymentFundingContext,
  type CurrencyCode
} from '@household/domain'
import { createRepaymentRepository } from './repayment-repository'
import { createUtilityBillImportRepository } from './utility-bill-import-repository'
import { randomUUID } from 'node:crypto'
import { nextPaymentFundingPhase } from './payment-funding-phase'

type FinanceTransaction = Parameters<
  Parameters<ReturnType<typeof createDbClient>['db']['transaction']>[0]
>[0]

async function utilityBillMinorInCurrency(
  tx: FinanceTransaction,
  bill: typeof schema.utilityBills.$inferSelect,
  currency: CurrencyCode
): Promise<bigint> {
  if (bill.currency === currency) return bill.amountMinor
  const [rate] = await tx
    .select()
    .from(schema.billingCycleExchangeRates)
    .where(
      and(
        eq(schema.billingCycleExchangeRates.cycleId, bill.cycleId),
        eq(schema.billingCycleExchangeRates.sourceCurrency, bill.currency),
        eq(schema.billingCycleExchangeRates.targetCurrency, currency)
      )
    )
  if (!rate) throw new Error('The utility bill has no fixed exchange rate for this currency')
  return convertMoney(
    Money.fromMinor(bill.amountMinor, toCurrencyCode(bill.currency)),
    currency,
    rate.rateMicros
  ).amountMinor
}

function toCurrencyCode(raw: string): CurrencyCode {
  const normalized = raw.trim().toUpperCase()

  if (normalized !== 'USD' && normalized !== 'GEL') {
    throw new Error(`Unsupported currency in finance repository: ${raw}`)
  }

  return normalized
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {}
}

function paymentFundingFields(value: unknown) {
  const row = asRecord(value)
  const context = parsePaymentFundingContext(row.purchaseFundingContext)
  if (row.purchaseFundingContext && !context) throw new Error('Invalid payment funding context')
  return {
    ...(typeof row.fundingPhase === 'bigint' ? { fundingPhase: row.fundingPhase } : {}),
    ...(context ? { purchaseFundingContext: context } : {}),
    purchaseReconciliationPending: row.purchaseReconciliationPending === 1
  }
}

function mapUtilityBillingPlanPayload(raw: unknown): FinanceUtilityBillingPlanPayload {
  const payload = asRecord(raw)

  const arrayOfObjects = (value: unknown): Record<string, unknown>[] =>
    Array.isArray(value)
      ? value.filter(
          (item): item is Record<string, unknown> =>
            Boolean(item) && typeof item === 'object' && !Array.isArray(item)
        )
      : []

  return {
    fairShareByMember: arrayOfObjects(payload.fairShareByMember).map((entry) => ({
      memberId: String(entry.memberId ?? ''),
      amountMinor: String(entry.amountMinor ?? '0')
    })),
    categories: arrayOfObjects(payload.categories).map((entry) => ({
      utilityBillId: String(entry.utilityBillId ?? ''),
      billName: String(entry.billName ?? ''),
      billTotalMinor: String(entry.billTotalMinor ?? entry.amountMinor ?? '0'),
      assignedAmountMinor: String(entry.assignedAmountMinor ?? entry.amountMinor ?? '0'),
      ...(entry.remainingAmountMinor === undefined || entry.remainingAmountMinor === null
        ? {}
        : { remainingAmountMinor: String(entry.remainingAmountMinor) }),
      assignedMemberId: String(entry.assignedMemberId ?? ''),
      paidAmountMinor: String(entry.paidAmountMinor ?? '0'),
      isFullAssignment:
        entry.isFullAssignment === true ||
        (entry.isFullAssignment === undefined && entry.fullCategoryPayment === true),
      splitGroupId:
        entry.splitGroupId === null || entry.splitGroupId === undefined
          ? entry.splitSourceBillId === null || entry.splitSourceBillId === undefined
            ? null
            : String(entry.splitSourceBillId)
          : String(entry.splitGroupId)
    })),
    memberSummaries: arrayOfObjects(payload.memberSummaries).map((entry) => ({
      memberId: String(entry.memberId ?? ''),
      fairShareMinor: String(entry.fairShareMinor ?? '0'),
      vendorPaidMinor: String(entry.vendorPaidMinor ?? '0'),
      assignedThisCycleMinor:
        entry.assignedThisCycleMinor === undefined
          ? (
              BigInt(String(entry.assignedVendorMinor ?? entry.vendorPaidMinor ?? '0')) -
              BigInt(String(entry.vendorPaidMinor ?? '0'))
            ).toString()
          : String(entry.assignedThisCycleMinor),
      projectedDeltaAfterPlanMinor:
        entry.projectedDeltaAfterPlanMinor === undefined
          ? (
              BigInt(String(entry.assignedVendorMinor ?? entry.vendorPaidMinor ?? '0')) -
              BigInt(String(entry.fairShareMinor ?? '0'))
            ).toString()
          : String(entry.projectedDeltaAfterPlanMinor)
    })),
    carryForwardCredits: arrayOfObjects(payload.carryForwardCredits).map((entry) => ({
      memberId: String(entry.memberId ?? ''),
      creditCreatedMinor: String(entry.creditCreatedMinor ?? '0'),
      creditConsumedMinor: String(entry.creditConsumedMinor ?? '0'),
      policyTarget: entry.policyTarget === 'rent' ? 'rent' : 'utilities'
    })),
    purchaseIds: Array.isArray(payload.purchaseIds)
      ? payload.purchaseIds.map((purchaseId) => String(purchaseId))
      : [],
    preferredUtilityPayerMemberId:
      payload.preferredUtilityPayerMemberId === null ||
      payload.preferredUtilityPayerMemberId === undefined
        ? null
        : String(payload.preferredUtilityPayerMemberId)
  }
}

function mapUtilityBillingPlanRecord(row: {
  id: string
  householdId: string
  cycleId: string
  version: number
  status: string
  dueDate: string
  currency: string
  maxCategoriesPerMemberApplied: number
  updatedFromPlanId: string | null
  reason: string | null
  payload: unknown
  createdAt: Date | string
}): FinanceUtilityBillingPlanRecord {
  return {
    id: row.id,
    householdId: row.householdId,
    cycleId: row.cycleId,
    version: row.version,
    status:
      row.status === 'diverged' || row.status === 'superseded' || row.status === 'settled'
        ? row.status
        : 'active',
    dueDate: row.dueDate,
    currency: toCurrencyCode(row.currency),
    maxCategoriesPerMemberApplied: row.maxCategoriesPerMemberApplied,
    updatedFromPlanId: row.updatedFromPlanId,
    reason: row.reason,
    payload: mapUtilityBillingPlanPayload(row.payload),
    createdAt: instantFromDatabaseValue(row.createdAt)!
  }
}

export function createDbFinanceRepository(
  databaseUrl: string,
  householdId: string
): {
  repository: FinanceRepository
  utilityBillImports: ReturnType<typeof createUtilityBillImportRepository>
  close: () => Promise<void>
} {
  const { db, close: closeDbClient } = createDbClient(databaseUrl)

  async function loadPurchaseParticipants(purchaseIds: readonly string[]): Promise<
    ReadonlyMap<
      string,
      readonly {
        id: string
        memberId: string
        included: boolean
        shareAmountMinor: bigint | null
      }[]
    >
  > {
    if (purchaseIds.length === 0) {
      return new Map()
    }

    const rows = await db
      .select({
        id: schema.purchaseMessageParticipants.id,
        purchaseMessageId: schema.purchaseMessageParticipants.purchaseMessageId,
        memberId: schema.purchaseMessageParticipants.memberId,
        included: schema.purchaseMessageParticipants.included,
        shareAmountMinor: schema.purchaseMessageParticipants.shareAmountMinor
      })
      .from(schema.purchaseMessageParticipants)
      .where(inArray(schema.purchaseMessageParticipants.purchaseMessageId, [...purchaseIds]))

    const grouped = new Map<
      string,
      { id: string; memberId: string; included: boolean; shareAmountMinor: bigint | null }[]
    >()
    for (const row of rows) {
      const current = grouped.get(row.purchaseMessageId) ?? []
      current.push({
        id: row.id,
        memberId: row.memberId,
        included: row.included === 1,
        shareAmountMinor: row.shareAmountMinor
      })
      grouped.set(row.purchaseMessageId, current)
    }

    return grouped
  }

  async function getParsedPurchaseById(
    purchaseId: string
  ): Promise<FinanceParsedPurchaseRecord | null> {
    const rows = await db
      .select({
        id: schema.purchaseMessages.id,
        cycleId: schema.purchaseMessages.cycleId,
        cyclePeriod: schema.billingCycles.period,
        createdByMemberId: schema.purchaseMessages.senderMemberId,
        payerMemberId: schema.purchaseMessages.payerMemberId,
        amountMinor: schema.purchaseMessages.parsedAmountMinor,
        currency: schema.purchaseMessages.parsedCurrency,
        description: schema.purchaseMessages.parsedItemDescription,
        occurredAt: schema.purchaseMessages.messageSentAt,
        splitMode: schema.purchaseMessages.participantSplitMode
      })
      .from(schema.purchaseMessages)
      .leftJoin(schema.billingCycles, eq(schema.purchaseMessages.cycleId, schema.billingCycles.id))
      .where(
        and(
          eq(schema.purchaseMessages.householdId, householdId),
          eq(schema.purchaseMessages.id, purchaseId),
          isNotNull(schema.purchaseMessages.payerMemberId),
          isNotNull(schema.purchaseMessages.parsedAmountMinor),
          isNotNull(schema.purchaseMessages.parsedCurrency),
          or(
            eq(schema.purchaseMessages.processingStatus, 'parsed'),
            eq(schema.purchaseMessages.processingStatus, 'confirmed')
          )
        )
      )
      .limit(1)

    const row = rows[0]
    if (!row || !row.payerMemberId || row.amountMinor == null || row.currency == null) {
      return null
    }

    const participantsByPurchaseId = await loadPurchaseParticipants([row.id])
    return {
      id: row.id,
      cycleId: row.cycleId,
      cyclePeriod: row.cyclePeriod,
      createdByMemberId: row.createdByMemberId,
      payerMemberId: row.payerMemberId,
      amountMinor: row.amountMinor,
      currency: toCurrencyCode(row.currency),
      description: row.description,
      occurredAt: instantFromDatabaseValue(row.occurredAt),
      splitMode: row.splitMode === 'custom_amounts' ? 'custom_amounts' : 'equal',
      participants: participantsByPurchaseId.get(row.id) ?? []
    }
  }

  function mapPurchaseTopicMessage(row: {
    purchaseMessageId: string
    householdId: string
    telegramChatId: string
    telegramThreadId: string
    telegramMessageId: string
    status: string
    lastError: string | null
  }): FinancePurchaseTopicMessageRecord {
    return {
      purchaseMessageId: row.purchaseMessageId,
      householdId: row.householdId,
      telegramChatId: row.telegramChatId,
      telegramThreadId: row.telegramThreadId,
      telegramMessageId: row.telegramMessageId,
      status: row.status === 'failed' || row.status === 'deleted' ? row.status : 'sent',
      lastError: row.lastError
    }
  }

  // A dashboard reads bills, payments, plans and vendor facts for every billing cycle the
  // household has ever had. Fetching them one cycle at a time turned a single button press
  // into hundreds of round trips, so every per-cycle read is expressed as a batch and the
  // single-cycle entry points are thin wrappers over it.
  async function selectUtilityBillsForCycles(cycleIds: readonly string[]) {
    if (cycleIds.length === 0) {
      return []
    }

    const rows = await db
      .select({
        id: schema.utilityBills.id,
        cycleId: schema.utilityBills.cycleId,
        billName: schema.utilityBills.billName,
        amountMinor: schema.utilityBills.amountMinor,
        currency: schema.utilityBills.currency,
        createdByMemberId: schema.utilityBills.createdByMemberId,
        createdAt: schema.utilityBills.createdAt
      })
      .from(schema.utilityBills)
      .where(inArray(schema.utilityBills.cycleId, [...cycleIds]))
      .orderBy(schema.utilityBills.createdAt)

    return rows.map((row) => ({
      cycleId: row.cycleId,
      bill: {
        id: row.id,
        billName: row.billName,
        amountMinor: row.amountMinor,
        currency: toCurrencyCode(row.currency),
        createdByMemberId: row.createdByMemberId,
        createdAt: instantFromDatabaseValue(row.createdAt)!
      }
    }))
  }

  async function selectUtilityBillingPlansForCycles(cycleIds: readonly string[]) {
    if (cycleIds.length === 0) {
      return []
    }

    const rows = await db
      .select({
        id: schema.utilityBillingPlans.id,
        householdId: schema.utilityBillingPlans.householdId,
        cycleId: schema.utilityBillingPlans.cycleId,
        version: schema.utilityBillingPlans.version,
        status: schema.utilityBillingPlans.status,
        dueDate: schema.utilityBillingPlans.dueDate,
        currency: schema.utilityBillingPlans.currency,
        maxCategoriesPerMemberApplied: schema.utilityBillingPlans.maxCategoriesPerMemberApplied,
        updatedFromPlanId: schema.utilityBillingPlans.updatedFromPlanId,
        reason: schema.utilityBillingPlans.reason,
        payload: schema.utilityBillingPlans.payload,
        createdAt: schema.utilityBillingPlans.createdAt
      })
      .from(schema.utilityBillingPlans)
      .where(inArray(schema.utilityBillingPlans.cycleId, [...cycleIds]))
      .orderBy(schema.utilityBillingPlans.version)

    return rows.map(mapUtilityBillingPlanRecord)
  }

  async function selectUtilityVendorPaymentFactsForCycles(cycleIds: readonly string[]) {
    if (cycleIds.length === 0) {
      return []
    }

    const rows = await db
      .select({
        id: schema.utilityVendorPaymentFacts.id,
        cycleId: schema.utilityVendorPaymentFacts.cycleId,
        planId: schema.utilityVendorPaymentFacts.planId,
        utilityBillId: schema.utilityVendorPaymentFacts.utilityBillId,
        billName: schema.utilityVendorPaymentFacts.billName,
        payerMemberId: schema.utilityVendorPaymentFacts.payerMemberId,
        amountMinor: schema.utilityVendorPaymentFacts.amountMinor,
        currency: schema.utilityVendorPaymentFacts.currency,
        plannedForMemberId: schema.utilityVendorPaymentFacts.plannedForMemberId,
        planVersion: schema.utilityVendorPaymentFacts.planVersion,
        matchedPlan: schema.utilityVendorPaymentFacts.matchedPlan,
        recordedByMemberId: schema.utilityVendorPaymentFacts.recordedByMemberId,
        paymentRecordId: schema.utilityVendorPaymentFacts.paymentRecordId,
        recordedAt: schema.utilityVendorPaymentFacts.recordedAt,
        createdAt: schema.utilityVendorPaymentFacts.createdAt
      })
      .from(schema.utilityVendorPaymentFacts)
      .where(inArray(schema.utilityVendorPaymentFacts.cycleId, [...cycleIds]))
      .orderBy(schema.utilityVendorPaymentFacts.recordedAt, schema.utilityVendorPaymentFacts.id)

    return rows.map((row) => ({
      ...row,
      currency: toCurrencyCode(row.currency),
      matchedPlan: row.matchedPlan === 1,
      recordedAt: instantFromDatabaseValue(row.recordedAt)!,
      createdAt: instantFromDatabaseValue(row.createdAt)!
    }))
  }

  async function selectPaymentRecordsForCycles(cycleIds: readonly string[]) {
    if (cycleIds.length === 0) {
      return []
    }

    const rows = await db
      .select({
        id: schema.paymentRecords.id,
        cycleId: schema.paymentRecords.cycleId,
        cyclePeriod: schema.billingCycles.period,
        memberId: schema.paymentRecords.memberId,
        kind: schema.paymentRecords.kind,
        amountMinor: schema.paymentRecords.amountMinor,
        currency: schema.paymentRecords.currency,
        idempotencyKey: schema.paymentRecords.idempotencyKey,
        fundingPhase: schema.paymentRecords.fundingPhase,
        purchaseFundingContext: schema.paymentRecords.purchaseFundingContext,
        purchaseReconciliationPending: schema.paymentRecords.purchaseReconciliationPending,
        recordedAt: schema.paymentRecords.recordedAt
      })
      .from(schema.paymentRecords)
      .innerJoin(schema.billingCycles, eq(schema.paymentRecords.cycleId, schema.billingCycles.id))
      .where(inArray(schema.paymentRecords.cycleId, [...cycleIds]))
      .orderBy(schema.paymentRecords.recordedAt)

    return rows.map((row) => ({
      id: row.id,
      cycleId: row.cycleId,
      cyclePeriod: row.cyclePeriod,
      memberId: row.memberId,
      kind: row.kind === 'utilities' ? ('utilities' as const) : ('rent' as const),
      amountMinor: row.amountMinor,
      currency: toCurrencyCode(row.currency),
      isRoundingAdjustment: row.idempotencyKey?.startsWith('utility-rounding:') ?? false,
      ...paymentFundingFields(row),
      recordedAt: instantFromDatabaseValue(row.recordedAt)!
    }))
  }

  async function markOpenPaymentBalancesPending(tx: FinanceTransaction) {
    const cycles = await tx
      .select({ id: schema.billingCycles.id })
      .from(schema.billingCycles)
      .where(
        and(
          eq(schema.billingCycles.householdId, householdId),
          isNull(schema.billingCycles.closedAt)
        )
      )
      .orderBy(schema.billingCycles.period)
      .for('update')
    if (cycles.length)
      await tx
        .update(schema.paymentRecords)
        .set({ purchaseReconciliationPending: 1 })
        .where(
          and(
            inArray(
              schema.paymentRecords.cycleId,
              cycles.map((c) => c.id)
            ),
            sql`NOT EXISTS (SELECT 1 FROM payment_purchase_allocations a WHERE a.payment_record_id = ${schema.paymentRecords.id} AND a.resolution_method = 'manual')`
          )
        )
  }

  async function selectSettlementSnapshotsForCycles(
    cycleIds: readonly string[]
  ): Promise<readonly SettlementSnapshotRecord[]> {
    if (cycleIds.length === 0) return []
    const rows = await db
      .select({
        cycleId: schema.settlements.cycleId,
        inputHash: schema.settlements.inputHash,
        totalDueMinor: schema.settlements.totalDueMinor,
        currency: schema.settlements.currency,
        metadata: schema.settlements.metadata,
        memberId: schema.settlementLines.memberId,
        rentShareMinor: schema.settlementLines.rentShareMinor,
        utilityShareMinor: schema.settlementLines.utilityShareMinor,
        purchaseOffsetMinor: schema.settlementLines.purchaseOffsetMinor,
        netDueMinor: schema.settlementLines.netDueMinor,
        explanations: schema.settlementLines.explanations
      })
      .from(schema.settlements)
      .leftJoin(
        schema.settlementLines,
        eq(schema.settlementLines.settlementId, schema.settlements.id)
      )
      .where(
        and(
          eq(schema.settlements.householdId, householdId),
          inArray(schema.settlements.cycleId, [...cycleIds])
        )
      )
      .orderBy(schema.settlements.cycleId, schema.settlementLines.memberId)
    const snapshots = new Map<
      string,
      Omit<SettlementSnapshotRecord, 'lines'> & { lines: SettlementSnapshotLineRecord[] }
    >()
    for (const row of rows) {
      let snapshot = snapshots.get(row.cycleId)
      if (!snapshot) {
        snapshot = {
          cycleId: row.cycleId,
          inputHash: row.inputHash,
          totalDueMinor: row.totalDueMinor,
          currency: toCurrencyCode(row.currency),
          metadata: asRecord(row.metadata),
          lines: []
        }
        snapshots.set(row.cycleId, snapshot)
      }
      if (row.memberId !== null) {
        snapshot.lines.push({
          memberId: row.memberId,
          rentShareMinor: row.rentShareMinor!,
          utilityShareMinor: row.utilityShareMinor!,
          purchaseOffsetMinor: row.purchaseOffsetMinor!,
          netDueMinor: row.netDueMinor!,
          explanations: Array.isArray(row.explanations)
            ? row.explanations.filter((value): value is string => typeof value === 'string')
            : []
        })
      }
    }
    return [...snapshots.values()]
  }

  const repository: FinanceRepository = {
    ...createRepaymentRepository(db, householdId),
    async getMemberByTelegramUserId(telegramUserId) {
      const rows = await db
        .select({
          id: schema.members.id,
          telegramUserId: schema.members.telegramUserId,
          displayName: schema.members.displayName,
          rentShareWeight: schema.members.rentShareWeight,
          isAdmin: schema.members.isAdmin
        })
        .from(schema.members)
        .where(
          and(
            eq(schema.members.householdId, householdId),
            eq(schema.members.telegramUserId, telegramUserId)
          )
        )
        .limit(1)

      const row = rows[0]
      if (!row) {
        return null
      }

      return {
        ...row,
        isAdmin: row.isAdmin === 1
      }
    },

    async listMembers() {
      const rows = await db
        .select({
          id: schema.members.id,
          telegramUserId: schema.members.telegramUserId,
          displayName: schema.members.displayName,
          rentShareWeight: schema.members.rentShareWeight,
          isAdmin: schema.members.isAdmin
        })
        .from(schema.members)
        .where(eq(schema.members.householdId, householdId))
        .orderBy(schema.members.displayName)

      return rows.map((row) => ({
        ...row,
        isAdmin: row.isAdmin === 1
      }))
    },

    async getOpenCycle() {
      const rows = await db
        .select({
          id: schema.billingCycles.id,
          period: schema.billingCycles.period,
          closedAt: schema.billingCycles.closedAt,
          currency: schema.billingCycles.currency
        })
        .from(schema.billingCycles)
        .where(
          and(
            eq(schema.billingCycles.householdId, householdId),
            isNull(schema.billingCycles.closedAt)
          )
        )
        .orderBy(desc(schema.billingCycles.startedAt))
        .limit(1)

      const row = rows[0]

      if (!row) {
        return null
      }

      return {
        ...row,
        closedAt: instantFromDatabaseValue(row.closedAt),
        currency: toCurrencyCode(row.currency)
      }
    },

    async listCycles() {
      const rows = await db
        .select({
          id: schema.billingCycles.id,
          period: schema.billingCycles.period,
          closedAt: schema.billingCycles.closedAt,
          currency: schema.billingCycles.currency
        })
        .from(schema.billingCycles)
        .where(eq(schema.billingCycles.householdId, householdId))
        .orderBy(schema.billingCycles.period)

      return rows.map((row) => ({
        ...row,
        closedAt: instantFromDatabaseValue(row.closedAt),
        currency: toCurrencyCode(row.currency)
      }))
    },

    async getCycleByPeriod(period) {
      const rows = await db
        .select({
          id: schema.billingCycles.id,
          period: schema.billingCycles.period,
          closedAt: schema.billingCycles.closedAt,
          currency: schema.billingCycles.currency
        })
        .from(schema.billingCycles)
        .where(
          and(
            eq(schema.billingCycles.householdId, householdId),
            eq(schema.billingCycles.period, period)
          )
        )
        .limit(1)

      const row = rows[0]

      if (!row) {
        return null
      }

      return {
        ...row,
        closedAt: instantFromDatabaseValue(row.closedAt),
        currency: toCurrencyCode(row.currency)
      }
    },

    async getLatestCycle() {
      const rows = await db
        .select({
          id: schema.billingCycles.id,
          period: schema.billingCycles.period,
          closedAt: schema.billingCycles.closedAt,
          currency: schema.billingCycles.currency
        })
        .from(schema.billingCycles)
        .where(eq(schema.billingCycles.householdId, householdId))
        .orderBy(desc(schema.billingCycles.period))
        .limit(1)

      const row = rows[0]

      if (!row) {
        return null
      }

      return {
        ...row,
        closedAt: instantFromDatabaseValue(row.closedAt),
        currency: toCurrencyCode(row.currency)
      }
    },

    async openCycle(period, currency) {
      await db
        .insert(schema.billingCycles)
        .values({
          householdId,
          period,
          currency
        })
        .onConflictDoNothing({
          target: [schema.billingCycles.householdId, schema.billingCycles.period]
        })
    },

    async closeCyclesBeforePeriod(period, closedAt) {
      return db.transaction(async (tx) => {
        const cycles = await tx
          .select({ id: schema.billingCycles.id })
          .from(schema.billingCycles)
          .where(
            and(
              eq(schema.billingCycles.householdId, householdId),
              isNull(schema.billingCycles.closedAt),
              lt(schema.billingCycles.period, period)
            )
          )
          .orderBy(schema.billingCycles.period)
          .for('update')
        if (!cycles.length) return []
        const ids = cycles.map((c) => c.id)
        const pending = await tx
          .select({ id: schema.paymentRecords.id })
          .from(schema.paymentRecords)
          .where(
            and(
              inArray(schema.paymentRecords.cycleId, ids),
              eq(schema.paymentRecords.purchaseReconciliationPending, 1)
            )
          )
          .limit(1)
        if (pending.length)
          throw new Error('Pending balance reconciliation prevents closing the period')
        await tx
          .update(schema.billingCycles)
          .set({ closedAt: instantToDate(closedAt) })
          .where(inArray(schema.billingCycles.id, ids))
        return ids
      })
    },
    async closeCycle(cycleId, closedAt, expectedPricingRevision) {
      await db.transaction(async (tx) => {
        const [cycle] = await tx
          .select()
          .from(schema.billingCycles)
          .where(
            and(
              eq(schema.billingCycles.householdId, householdId),
              eq(schema.billingCycles.id, cycleId)
            )
          )
          .for('update')
        if (!cycle || cycle.closedAt) return
        if (
          expectedPricingRevision &&
          expectedPricingRevision !== (await paymentPricingRevision(tx, householdId, cycleId))
        )
          throw new Error('Payment pricing changed; retry closing the period')
        const pending = await tx
          .select({ id: schema.paymentRecords.id })
          .from(schema.paymentRecords)
          .where(
            and(
              eq(schema.paymentRecords.cycleId, cycleId),
              eq(schema.paymentRecords.purchaseReconciliationPending, 1)
            )
          )
          .limit(1)
        if (pending.length)
          throw new Error('Pending balance reconciliation prevents closing the period')
        await tx
          .update(schema.billingCycles)
          .set({ closedAt: instantToDate(closedAt) })
          .where(eq(schema.billingCycles.id, cycleId))
      })
    },

    async saveRentRule(period, amountMinor, currency, options) {
      const insert = db.insert(schema.rentRules).values({
        householdId,
        amountMinor,
        currency,
        effectiveFromPeriod: period
      })

      if (options?.overwriteExisting === false) {
        await insert.onConflictDoNothing({
          target: [schema.rentRules.householdId, schema.rentRules.effectiveFromPeriod]
        })
        return
      }

      await insert.onConflictDoUpdate({
        target: [schema.rentRules.householdId, schema.rentRules.effectiveFromPeriod],
        set: {
          amountMinor,
          currency
        }
      })
    },

    async getCycleExchangeRate(cycleId, sourceCurrency, targetCurrency) {
      const rows = await db
        .select({
          cycleId: schema.billingCycleExchangeRates.cycleId,
          sourceCurrency: schema.billingCycleExchangeRates.sourceCurrency,
          targetCurrency: schema.billingCycleExchangeRates.targetCurrency,
          rateMicros: schema.billingCycleExchangeRates.rateMicros,
          effectiveDate: schema.billingCycleExchangeRates.effectiveDate,
          source: schema.billingCycleExchangeRates.source
        })
        .from(schema.billingCycleExchangeRates)
        .where(
          and(
            eq(schema.billingCycleExchangeRates.cycleId, cycleId),
            eq(schema.billingCycleExchangeRates.sourceCurrency, sourceCurrency),
            eq(schema.billingCycleExchangeRates.targetCurrency, targetCurrency)
          )
        )
        .limit(1)

      const row = rows[0]
      if (!row) {
        return null
      }

      return {
        cycleId: row.cycleId,
        sourceCurrency: toCurrencyCode(row.sourceCurrency),
        targetCurrency: toCurrencyCode(row.targetCurrency),
        rateMicros: row.rateMicros,
        effectiveDate: row.effectiveDate,
        source: 'nbg'
      }
    },

    async saveCycleExchangeRate(input) {
      const rows = await db
        .insert(schema.billingCycleExchangeRates)
        .values({
          cycleId: input.cycleId,
          sourceCurrency: input.sourceCurrency,
          targetCurrency: input.targetCurrency,
          rateMicros: input.rateMicros,
          effectiveDate: input.effectiveDate,
          source: input.source
        })
        .onConflictDoUpdate({
          target: [
            schema.billingCycleExchangeRates.cycleId,
            schema.billingCycleExchangeRates.sourceCurrency,
            schema.billingCycleExchangeRates.targetCurrency
          ],
          set: {
            rateMicros: input.rateMicros,
            effectiveDate: input.effectiveDate,
            source: input.source,
            updatedAt: instantToDate(nowInstant())
          }
        })
        .returning({
          cycleId: schema.billingCycleExchangeRates.cycleId,
          sourceCurrency: schema.billingCycleExchangeRates.sourceCurrency,
          targetCurrency: schema.billingCycleExchangeRates.targetCurrency,
          rateMicros: schema.billingCycleExchangeRates.rateMicros,
          effectiveDate: schema.billingCycleExchangeRates.effectiveDate,
          source: schema.billingCycleExchangeRates.source
        })

      const row = rows[0]
      if (!row) {
        throw new Error('Failed to save billing cycle exchange rate')
      }

      return {
        cycleId: row.cycleId,
        sourceCurrency: toCurrencyCode(row.sourceCurrency),
        targetCurrency: toCurrencyCode(row.targetCurrency),
        rateMicros: row.rateMicros,
        effectiveDate: row.effectiveDate,
        source: 'nbg'
      }
    },

    async getLatestExchangeRate(sourceCurrency, targetCurrency) {
      const rows = await db
        .select({
          cycleId: schema.billingCycleExchangeRates.cycleId,
          sourceCurrency: schema.billingCycleExchangeRates.sourceCurrency,
          targetCurrency: schema.billingCycleExchangeRates.targetCurrency,
          rateMicros: schema.billingCycleExchangeRates.rateMicros,
          effectiveDate: schema.billingCycleExchangeRates.effectiveDate
        })
        .from(schema.billingCycleExchangeRates)
        .innerJoin(
          schema.billingCycles,
          eq(schema.billingCycles.id, schema.billingCycleExchangeRates.cycleId)
        )
        .where(
          and(
            eq(schema.billingCycles.householdId, householdId),
            eq(schema.billingCycleExchangeRates.sourceCurrency, sourceCurrency),
            eq(schema.billingCycleExchangeRates.targetCurrency, targetCurrency)
          )
        )
        .orderBy(desc(schema.billingCycleExchangeRates.effectiveDate))
        .limit(1)

      const row = rows[0]
      if (!row) {
        return null
      }

      return {
        cycleId: row.cycleId,
        sourceCurrency: toCurrencyCode(row.sourceCurrency),
        targetCurrency: toCurrencyCode(row.targetCurrency),
        rateMicros: row.rateMicros,
        effectiveDate: row.effectiveDate,
        source: 'nbg'
      }
    },

    async addUtilityBill(input) {
      await db.insert(schema.utilityBills).values({
        householdId,
        cycleId: input.cycleId,
        billName: input.billName,
        amountMinor: input.amountMinor,
        currency: input.currency,
        source: 'manual',
        createdByMemberId: input.createdByMemberId
      })
    },

    async addParsedPurchase(input) {
      const purchaseId = randomUUID()

      const memberRows = await db
        .select({ displayName: schema.members.displayName })
        .from(schema.members)
        .where(eq(schema.members.id, input.payerMemberId))
        .limit(1)

      const member = memberRows[0]

      await db.insert(schema.purchaseMessages).values({
        id: purchaseId,
        householdId,
        cycleId: input.cycleId,
        senderMemberId: input.createdByMemberId,
        payerMemberId: input.payerMemberId,
        senderTelegramUserId: 'miniapp',
        senderDisplayName: member?.displayName ?? 'Mini App',
        telegramChatId: 'miniapp',
        telegramMessageId: purchaseId,
        telegramThreadId: 'miniapp',
        telegramUpdateId: purchaseId,
        rawText: input.description ?? '',
        messageSentAt: instantToDate(input.occurredAt),
        parsedItemDescription: input.description,
        parsedAmountMinor: input.amountMinor,
        parsedCurrency: input.currency,
        participantSplitMode: input.splitMode ?? 'equal',
        processingStatus: 'confirmed',
        parserError: null,
        needsReview: 0
      })

      if (input.participants && input.participants.length > 0) {
        await db.insert(schema.purchaseMessageParticipants).values(
          input.participants.map(
            (p: { memberId: string; included?: boolean; shareAmountMinor: bigint | null }) => ({
              purchaseMessageId: purchaseId,
              memberId: p.memberId,
              included: (p.included ?? true) ? 1 : 0,
              shareAmountMinor: p.shareAmountMinor
            })
          )
        )
      }

      const rows = await db
        .select({
          id: schema.purchaseMessages.id,
          payerMemberId: schema.purchaseMessages.payerMemberId,
          amountMinor: schema.purchaseMessages.parsedAmountMinor,
          currency: schema.purchaseMessages.parsedCurrency,
          description: schema.purchaseMessages.parsedItemDescription,
          occurredAt: schema.purchaseMessages.messageSentAt,
          splitMode: schema.purchaseMessages.participantSplitMode
        })
        .from(schema.purchaseMessages)
        .where(eq(schema.purchaseMessages.id, purchaseId))

      const row = rows[0]
      if (!row || !row.payerMemberId || row.amountMinor == null || row.currency == null) {
        throw new Error('Failed to create purchase')
      }

      const participantRows = await db
        .select({
          memberId: schema.purchaseMessageParticipants.memberId,
          included: schema.purchaseMessageParticipants.included,
          shareAmountMinor: schema.purchaseMessageParticipants.shareAmountMinor
        })
        .from(schema.purchaseMessageParticipants)
        .where(eq(schema.purchaseMessageParticipants.purchaseMessageId, purchaseId))

      return {
        id: row.id,
        cycleId: input.cycleId,
        createdByMemberId: input.createdByMemberId,
        payerMemberId: row.payerMemberId,
        amountMinor: row.amountMinor,
        currency: toCurrencyCode(row.currency),
        description: row.description,
        occurredAt: row.occurredAt ? instantFromDatabaseValue(row.occurredAt) : null,
        cyclePeriod: null,
        splitMode: row.splitMode as 'equal' | 'custom_amounts',
        participants: participantRows.map((p) => ({
          memberId: p.memberId,
          included: p.included === 1,
          shareAmountMinor: p.shareAmountMinor
        }))
      }
    },

    async updateParsedPurchase(input) {
      return await db.transaction(async (tx) => {
        await markOpenPaymentBalancesPending(tx)
        const rows = await tx
          .update(schema.purchaseMessages)
          .set({
            parsedAmountMinor: input.amountMinor,
            parsedCurrency: input.currency,
            parsedItemDescription: input.description,
            ...(input.occurredAt
              ? {
                  messageSentAt: instantToDate(input.occurredAt)
                }
              : {}),
            ...(input.splitMode
              ? {
                  participantSplitMode: input.splitMode
                }
              : {}),
            ...(input.payerMemberId
              ? {
                  payerMemberId: input.payerMemberId
                }
              : {}),
            needsReview: 0,
            processingStatus: 'confirmed',
            parserError: null
          })
          .where(
            and(
              eq(schema.purchaseMessages.householdId, householdId),
              eq(schema.purchaseMessages.id, input.purchaseId)
            )
          )
          .returning({
            id: schema.purchaseMessages.id,
            createdByMemberId: schema.purchaseMessages.senderMemberId,
            payerMemberId: schema.purchaseMessages.payerMemberId,
            amountMinor: schema.purchaseMessages.parsedAmountMinor,
            currency: schema.purchaseMessages.parsedCurrency,
            description: schema.purchaseMessages.parsedItemDescription,
            occurredAt: schema.purchaseMessages.messageSentAt,
            splitMode: schema.purchaseMessages.participantSplitMode
          })

        const row = rows[0]
        if (!row || !row.payerMemberId || row.amountMinor == null || row.currency == null) {
          return null
        }

        if (input.participants) {
          await tx
            .delete(schema.purchaseMessageParticipants)
            .where(eq(schema.purchaseMessageParticipants.purchaseMessageId, input.purchaseId))

          if (input.participants.length > 0) {
            await tx.insert(schema.purchaseMessageParticipants).values(
              input.participants.map((participant) => ({
                purchaseMessageId: input.purchaseId,
                memberId: participant.memberId,
                included: participant.included === false ? 0 : 1,
                shareAmountMinor: participant.shareAmountMinor
              }))
            )
          }
        }

        const participants = await tx
          .select({
            id: schema.purchaseMessageParticipants.id,
            memberId: schema.purchaseMessageParticipants.memberId,
            included: schema.purchaseMessageParticipants.included,
            shareAmountMinor: schema.purchaseMessageParticipants.shareAmountMinor
          })
          .from(schema.purchaseMessageParticipants)
          .where(eq(schema.purchaseMessageParticipants.purchaseMessageId, input.purchaseId))

        return {
          id: row.id,
          cycleId: null,
          createdByMemberId: row.createdByMemberId,
          payerMemberId: row.payerMemberId,
          amountMinor: row.amountMinor,
          currency: toCurrencyCode(row.currency),
          description: row.description,
          occurredAt: instantFromDatabaseValue(row.occurredAt),
          cyclePeriod: null,
          splitMode: row.splitMode === 'custom_amounts' ? 'custom_amounts' : 'equal',
          participants: participants.map((participant) => ({
            id: participant.id,
            memberId: participant.memberId,
            included: participant.included === 1,
            shareAmountMinor: participant.shareAmountMinor
          }))
        }
      })
    },

    async deleteParsedPurchase(purchaseId) {
      return db.transaction(async (tx) => {
        await markOpenPaymentBalancesPending(tx)
        const rows = await tx
          .delete(schema.purchaseMessages)
          .where(
            and(
              eq(schema.purchaseMessages.householdId, householdId),
              eq(schema.purchaseMessages.id, purchaseId)
            )
          )
          .returning({
            id: schema.purchaseMessages.id
          })

        return rows.length > 0
      })
    },

    async getParsedPurchase(purchaseId) {
      return getParsedPurchaseById(purchaseId)
    },

    async ensureEqualPurchaseParticipants(purchaseId) {
      const purchase = await getParsedPurchaseById(purchaseId)
      if (!purchase || purchase.splitMode === 'custom_amounts') {
        return purchase
      }

      if (purchase.participants && purchase.participants.length > 0) {
        return purchase
      }

      const memberRows = await db
        .select({
          id: schema.members.id,
          lifecycleStatus: schema.members.lifecycleStatus
        })
        .from(schema.members)
        .where(eq(schema.members.householdId, householdId))

      const eligibleMembers = memberRows.filter((member) => member.lifecycleStatus !== 'left')
      if (eligibleMembers.length === 0) {
        return purchase
      }

      const hasActiveMember = eligibleMembers.some((member) => member.lifecycleStatus === 'active')
      await db
        .insert(schema.purchaseMessageParticipants)
        .values(
          eligibleMembers.map((member) => ({
            purchaseMessageId: purchase.id,
            memberId: member.id,
            included:
              member.lifecycleStatus === 'active' ||
              (!hasActiveMember && member.id === purchase.payerMemberId)
                ? 1
                : 0,
            shareAmountMinor: null
          }))
        )
        .onConflictDoNothing()

      return getParsedPurchaseById(purchaseId)
    },

    async toggleSavedPurchaseParticipant(
      participantId,
      actorTelegramUserId
    ): Promise<FinanceSavedPurchaseParticipantToggleResult> {
      const result = await db.transaction(
        async (
          tx
        ): Promise<
          | { status: 'updated'; purchaseId: string }
          | { status: 'not_found' | 'forbidden' | 'not_editable' | 'at_least_one_required' }
        > => {
          await markOpenPaymentBalancesPending(tx)
          const rows = await tx
            .select({
              participantId: schema.purchaseMessageParticipants.id,
              purchaseMessageId: schema.purchaseMessageParticipants.purchaseMessageId,
              memberId: schema.purchaseMessageParticipants.memberId,
              included: schema.purchaseMessageParticipants.included,
              purchaseHouseholdId: schema.purchaseMessages.householdId,
              splitMode: schema.purchaseMessages.participantSplitMode,
              processingStatus: schema.purchaseMessages.processingStatus
            })
            .from(schema.purchaseMessageParticipants)
            .innerJoin(
              schema.purchaseMessages,
              eq(schema.purchaseMessageParticipants.purchaseMessageId, schema.purchaseMessages.id)
            )
            .where(
              and(
                eq(schema.purchaseMessageParticipants.id, participantId),
                eq(schema.purchaseMessages.householdId, householdId)
              )
            )
            .limit(1)

          const row = rows[0]
          if (!row) {
            return { status: 'not_found' as const }
          }

          const actorRows = await tx
            .select({
              id: schema.members.id,
              lifecycleStatus: schema.members.lifecycleStatus
            })
            .from(schema.members)
            .where(
              and(
                eq(schema.members.householdId, row.purchaseHouseholdId),
                eq(schema.members.telegramUserId, actorTelegramUserId)
              )
            )
            .limit(1)

          const actor = actorRows[0]
          if (!actor || actor.lifecycleStatus !== 'active') {
            return { status: 'forbidden' as const }
          }

          const participantRows = await tx
            .select({
              lifecycleStatus: schema.members.lifecycleStatus
            })
            .from(schema.members)
            .where(
              and(
                eq(schema.members.householdId, row.purchaseHouseholdId),
                eq(schema.members.id, row.memberId)
              )
            )
            .limit(1)

          const participant = participantRows[0]
          if (!participant) {
            return { status: 'not_found' as const }
          }

          if (row.included !== 1 && participant.lifecycleStatus !== 'active') {
            return { status: 'not_editable' as const }
          }

          if (
            row.splitMode === 'custom_amounts' ||
            (row.processingStatus !== 'confirmed' && row.processingStatus !== 'parsed')
          ) {
            return { status: 'not_editable' as const }
          }

          if (row.included === 1) {
            const includedRows = await tx
              .select({ id: schema.purchaseMessageParticipants.id })
              .from(schema.purchaseMessageParticipants)
              .where(
                and(
                  eq(schema.purchaseMessageParticipants.purchaseMessageId, row.purchaseMessageId),
                  eq(schema.purchaseMessageParticipants.included, 1)
                )
              )

            if (includedRows.length <= 1) {
              return { status: 'at_least_one_required' as const }
            }
          }

          await tx
            .update(schema.purchaseMessageParticipants)
            .set({
              included: row.included === 1 ? 0 : 1,
              updatedAt: new Date()
            })
            .where(eq(schema.purchaseMessageParticipants.id, participantId))

          return { status: 'updated' as const, purchaseId: row.purchaseMessageId }
        }
      )

      if (result.status !== 'updated') {
        return result
      }

      const purchase = await getParsedPurchaseById(result.purchaseId)
      return purchase ? { status: 'updated' as const, purchase } : { status: 'not_found' as const }
    },

    async getPurchaseTopicMessage(purchaseId) {
      const rows = await db
        .select({
          purchaseMessageId: schema.purchaseTopicMessages.purchaseMessageId,
          householdId: schema.purchaseTopicMessages.householdId,
          telegramChatId: schema.purchaseTopicMessages.telegramChatId,
          telegramThreadId: schema.purchaseTopicMessages.telegramThreadId,
          telegramMessageId: schema.purchaseTopicMessages.telegramMessageId,
          status: schema.purchaseTopicMessages.status,
          lastError: schema.purchaseTopicMessages.lastError
        })
        .from(schema.purchaseTopicMessages)
        .where(
          and(
            eq(schema.purchaseTopicMessages.householdId, householdId),
            eq(schema.purchaseTopicMessages.purchaseMessageId, purchaseId)
          )
        )
        .limit(1)

      return rows[0] ? mapPurchaseTopicMessage(rows[0]) : null
    },

    async upsertPurchaseTopicMessage(input) {
      const rows = await db
        .insert(schema.purchaseTopicMessages)
        .values({
          purchaseMessageId: input.purchaseMessageId,
          householdId,
          telegramChatId: input.telegramChatId,
          telegramThreadId: input.telegramThreadId,
          telegramMessageId: input.telegramMessageId,
          status: input.status,
          lastError: input.lastError ?? null,
          updatedAt: new Date()
        })
        .onConflictDoUpdate({
          target: schema.purchaseTopicMessages.purchaseMessageId,
          set: {
            telegramChatId: input.telegramChatId,
            telegramThreadId: input.telegramThreadId,
            telegramMessageId: input.telegramMessageId,
            status: input.status,
            lastError: input.lastError ?? null,
            updatedAt: new Date()
          }
        })
        .returning({
          purchaseMessageId: schema.purchaseTopicMessages.purchaseMessageId,
          householdId: schema.purchaseTopicMessages.householdId,
          telegramChatId: schema.purchaseTopicMessages.telegramChatId,
          telegramThreadId: schema.purchaseTopicMessages.telegramThreadId,
          telegramMessageId: schema.purchaseTopicMessages.telegramMessageId,
          status: schema.purchaseTopicMessages.status,
          lastError: schema.purchaseTopicMessages.lastError
        })

      const row = rows[0]
      if (!row) {
        throw new Error('Failed to upsert purchase topic message')
      }

      return mapPurchaseTopicMessage(row)
    },

    async updateUtilityBill(input) {
      const rows = await db
        .update(schema.utilityBills)
        .set({
          billName: input.billName,
          amountMinor: input.amountMinor,
          currency: input.currency
        })
        .where(
          and(
            eq(schema.utilityBills.householdId, householdId),
            eq(schema.utilityBills.id, input.billId)
          )
        )
        .returning({
          id: schema.utilityBills.id,
          billName: schema.utilityBills.billName,
          amountMinor: schema.utilityBills.amountMinor,
          currency: schema.utilityBills.currency,
          createdByMemberId: schema.utilityBills.createdByMemberId,
          createdAt: schema.utilityBills.createdAt
        })

      const row = rows[0]
      if (!row) {
        return null
      }

      return {
        ...row,
        currency: toCurrencyCode(row.currency),
        createdAt: instantFromDatabaseValue(row.createdAt)!
      }
    },

    async deleteUtilityBill(billId) {
      const rows = await db
        .delete(schema.utilityBills)
        .where(
          and(eq(schema.utilityBills.householdId, householdId), eq(schema.utilityBills.id, billId))
        )
        .returning({
          id: schema.utilityBills.id
        })

      return rows.length > 0
    },

    async addPaymentRecord(input) {
      return db.transaction(async (tx) => {
        const phase = await nextPaymentFundingPhase(tx, householdId, input.cycleId)
        if (
          input.purchaseFundingContext?.inputRevision &&
          input.purchaseFundingContext.inputRevision !==
            (await paymentPricingRevision(tx, householdId, input.cycleId))
        )
          throw new Error('Payment pricing changed; retry confirmation')
        const rows = await tx
          .insert(schema.paymentRecords)
          .values({
            householdId,
            fundingPhase: phase,
            purchaseFundingContext: input.purchaseFundingContext ?? null,
            purchaseReconciliationPending: 1,
            cycleId: input.cycleId,
            memberId: input.memberId,
            kind: input.kind,
            amountMinor: input.amountMinor,
            currency: input.currency,
            recordedAt: instantToDate(input.recordedAt)
          })
          .returning({
            id: schema.paymentRecords.id,
            cycleId: schema.paymentRecords.cycleId,
            memberId: schema.paymentRecords.memberId,
            kind: schema.paymentRecords.kind,
            amountMinor: schema.paymentRecords.amountMinor,
            currency: schema.paymentRecords.currency,
            fundingPhase: schema.paymentRecords.fundingPhase,
            purchaseFundingContext: schema.paymentRecords.purchaseFundingContext,
            purchaseReconciliationPending: schema.paymentRecords.purchaseReconciliationPending,
            recordedAt: schema.paymentRecords.recordedAt
          })

        const row = rows[0]
        if (!row) {
          throw new Error('Failed to add payment record')
        }

        return {
          id: row.id,
          cycleId: row.cycleId,
          cyclePeriod: null,
          memberId: row.memberId,
          kind: row.kind === 'utilities' ? 'utilities' : 'rent',
          amountMinor: row.amountMinor,
          currency: toCurrencyCode(row.currency),
          ...paymentFundingFields(row),
          recordedAt: instantFromDatabaseValue(row.recordedAt)!
        }
      })
    },

    async addPaymentRecordIfNew(input) {
      return db.transaction(async (tx) => {
        const phase = await nextPaymentFundingPhase(tx, householdId, input.cycleId)
        if (
          input.purchaseFundingContext?.inputRevision &&
          input.purchaseFundingContext.inputRevision !==
            (await paymentPricingRevision(tx, householdId, input.cycleId))
        )
          throw new Error('Payment pricing changed; retry confirmation')
        const rows = await tx
          .insert(schema.paymentRecords)
          .values({
            householdId,
            fundingPhase: phase,
            purchaseFundingContext: input.purchaseFundingContext ?? null,
            purchaseReconciliationPending: 1,
            cycleId: input.cycleId,
            memberId: input.memberId,
            kind: input.kind,
            amountMinor: input.amountMinor,
            currency: input.currency,
            idempotencyKey: input.idempotencyKey,
            recordedAt: instantToDate(input.recordedAt)
          })
          .onConflictDoNothing({
            target: schema.paymentRecords.idempotencyKey
          })
          .returning({
            id: schema.paymentRecords.id,
            cycleId: schema.paymentRecords.cycleId,
            memberId: schema.paymentRecords.memberId,
            kind: schema.paymentRecords.kind,
            amountMinor: schema.paymentRecords.amountMinor,
            currency: schema.paymentRecords.currency,
            fundingPhase: schema.paymentRecords.fundingPhase,
            purchaseFundingContext: schema.paymentRecords.purchaseFundingContext,
            purchaseReconciliationPending: schema.paymentRecords.purchaseReconciliationPending,
            recordedAt: schema.paymentRecords.recordedAt
          })

        const row = rows[0]
        if (!row) {
          return null
        }

        return {
          id: row.id,
          cycleId: row.cycleId,
          cyclePeriod: null,
          memberId: row.memberId,
          kind: row.kind === 'utilities' ? 'utilities' : 'rent',
          amountMinor: row.amountMinor,
          currency: toCurrencyCode(row.currency),
          ...paymentFundingFields(row),
          recordedAt: instantFromDatabaseValue(row.recordedAt)!
        }
      })
    },

    async getPaymentRecord(paymentId) {
      const rows = await db
        .select({
          id: schema.paymentRecords.id,
          cycleId: schema.paymentRecords.cycleId,
          cyclePeriod: schema.billingCycles.period,
          memberId: schema.paymentRecords.memberId,
          kind: schema.paymentRecords.kind,
          amountMinor: schema.paymentRecords.amountMinor,
          currency: schema.paymentRecords.currency,
          idempotencyKey: schema.paymentRecords.idempotencyKey,
          fundingPhase: schema.paymentRecords.fundingPhase,
          purchaseFundingContext: schema.paymentRecords.purchaseFundingContext,
          purchaseReconciliationPending: schema.paymentRecords.purchaseReconciliationPending,
          recordedAt: schema.paymentRecords.recordedAt
        })
        .from(schema.paymentRecords)
        .innerJoin(schema.billingCycles, eq(schema.paymentRecords.cycleId, schema.billingCycles.id))
        .where(
          and(
            eq(schema.paymentRecords.householdId, householdId),
            eq(schema.paymentRecords.id, paymentId)
          )
        )
        .limit(1)

      const row = rows[0]
      if (!row) {
        return null
      }

      return {
        id: row.id,
        cycleId: row.cycleId,
        cyclePeriod: row.cyclePeriod,
        memberId: row.memberId,
        kind: row.kind === 'utilities' ? 'utilities' : 'rent',
        amountMinor: row.amountMinor,
        currency: toCurrencyCode(row.currency),
        isRoundingAdjustment: row.idempotencyKey?.startsWith('utility-rounding:') ?? false,
        ...paymentFundingFields(row),
        recordedAt: instantFromDatabaseValue(row.recordedAt)!
      }
    },

    async getPaymentRecordByConfirmationSource(telegramChatId, sourceKey) {
      const [row] = await db
        .select({ payment: schema.paymentRecords })
        .from(schema.paymentRecords)
        .innerJoin(
          schema.paymentConfirmations,
          eq(schema.paymentRecords.confirmationId, schema.paymentConfirmations.id)
        )
        .where(
          and(
            eq(schema.paymentRecords.householdId, householdId),
            eq(schema.paymentConfirmations.telegramChatId, telegramChatId),
            eq(schema.paymentConfirmations.sourceKey, sourceKey)
          )
        )
        .limit(1)
      if (!row) return null
      const p = row.payment
      return {
        id: p.id,
        cycleId: p.cycleId,
        memberId: p.memberId,
        kind: p.kind === 'rent' ? 'rent' : 'utilities',
        amountMinor: p.amountMinor,
        currency: toCurrencyCode(p.currency),
        recordedAt: instantFromDatabaseValue(p.recordedAt)!,
        ...paymentFundingFields(p)
      }
    },

    async clearPaymentReconciliationPending(paymentId) {
      await db
        .update(schema.paymentRecords)
        .set({ purchaseReconciliationPending: 0 })
        .where(
          and(
            eq(schema.paymentRecords.householdId, householdId),
            eq(schema.paymentRecords.id, paymentId)
          )
        )
    },
    async getPaymentPricingRevision(cycleId) {
      return paymentPricingRevision(db, householdId, cycleId)
    },
    async listPendingPaymentReconciliations(cycleId) {
      const rows = await db
        .select()
        .from(schema.paymentRecords)
        .where(
          and(
            eq(schema.paymentRecords.householdId, householdId),
            ...(cycleId ? [eq(schema.paymentRecords.cycleId, cycleId)] : []),
            eq(schema.paymentRecords.purchaseReconciliationPending, 1)
          )
        )
      return rows.map((p) => ({
        id: p.id,
        cycleId: p.cycleId,
        memberId: p.memberId,
        kind: p.kind === 'rent' ? ('rent' as const) : ('utilities' as const),
        amountMinor: p.amountMinor,
        currency: toCurrencyCode(p.currency),
        recordedAt: instantFromDatabaseValue(p.recordedAt)!,
        ...paymentFundingFields(p)
      }))
    },

    async setPaymentFundingContextIfMissing(paymentId, context) {
      if (!parsePaymentFundingContext(context)) throw new Error('Invalid payment pricing context')
      await db
        .update(schema.paymentRecords)
        .set({ purchaseFundingContext: context })
        .where(
          and(
            eq(schema.paymentRecords.householdId, householdId),
            eq(schema.paymentRecords.id, paymentId),
            isNull(schema.paymentRecords.purchaseFundingContext)
          )
        )
    },

    async replacePaymentPurchaseAllocations(input) {
      await db.transaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(schema.billingCycles)
          .where(
            and(
              eq(schema.billingCycles.householdId, householdId),
              eq(schema.billingCycles.id, input.cycleId)
            )
          )
          .for('update')
        if (!locked || locked.closedAt) throw new Error('Closed payment period is read-only')
        if (
          input.expectedPricingRevision &&
          input.expectedPricingRevision !==
            (await paymentPricingRevision(tx, householdId, input.cycleId))
        )
          throw new Error('Payment funding changed; retry reconciliation')
        if (input.replaceRecordIds && input.expectedPaymentRevision) {
          const [cycle] = await tx
            .select()
            .from(schema.billingCycles)
            .where(
              and(
                eq(schema.billingCycles.householdId, householdId),
                eq(schema.billingCycles.id, input.cycleId)
              )
            )
            .for('update')
          if (!cycle || cycle.closedAt)
            throw new Error('Payment funding changed; retry reconciliation')
          const [target] = await tx
            .select()
            .from(schema.paymentRecords)
            .where(
              and(
                eq(schema.paymentRecords.householdId, householdId),
                eq(schema.paymentRecords.id, input.paymentRecordId)
              )
            )
          if (!target || target.cycleId !== input.cycleId)
            throw new Error('Payment funding changed; retry reconciliation')
          const scopedRecords = await tx
            .select()
            .from(schema.paymentRecords)
            .where(
              and(
                eq(schema.paymentRecords.householdId, householdId),
                eq(schema.paymentRecords.cycleId, input.cycleId),
                eq(schema.paymentRecords.memberId, target.memberId),
                eq(schema.paymentRecords.kind, target.kind)
              )
            )
            .for('update')
          const manual = await tx
            .select({ paymentRecordId: schema.paymentPurchaseAllocations.paymentRecordId })
            .from(schema.paymentPurchaseAllocations)
            .where(
              and(
                inArray(
                  schema.paymentPurchaseAllocations.paymentRecordId,
                  scopedRecords.map((p) => p.id)
                ),
                eq(schema.paymentPurchaseAllocations.resolutionMethod, 'manual')
              )
            )
          const manualIds = new Set(manual.map((a) => a.paymentRecordId))
          const records = scopedRecords.filter((p) => !manualIds.has(p.id))
          if (
            paymentFundingRevision(records) !== input.expectedPaymentRevision ||
            records.length !== input.replaceRecordIds.length ||
            records.some((p) => !input.replaceRecordIds!.includes(p.id))
          )
            throw new Error('Payment funding changed; retry reconciliation')
          if (input.allocations.some((a) => a.memberId !== target.memberId || a.amountMinor <= 0n))
            throw new Error('Purchase allocation has an invalid payer or amount')
        }
        await tx
          .delete(schema.paymentPurchaseAllocations)
          .where(
            inArray(schema.paymentPurchaseAllocations.paymentRecordId, [
              ...(input.replaceRecordIds ?? [input.paymentRecordId])
            ])
          )

        await tx
          .update(schema.paymentRecords)
          .set({ purchaseReconciliationPending: 0 })
          .where(
            and(
              eq(schema.paymentRecords.householdId, householdId),
              inArray(schema.paymentRecords.id, [
                ...(input.replaceRecordIds ?? [input.paymentRecordId])
              ])
            )
          )
        if (input.allocations.length === 0) {
          return
        }

        await tx.insert(schema.paymentPurchaseAllocations).values(
          input.allocations.map((allocation) => ({
            paymentRecordId: input.paymentRecordId,
            purchaseId: allocation.sourceKind === 'transfer' ? null : allocation.purchaseId,
            transferId: allocation.sourceKind === 'transfer' ? allocation.purchaseId : null,
            memberId: allocation.memberId,
            amountMinor: allocation.amountMinor,
            resolutionCycleId: input.cycleId,
            resolutionMethod: input.resolutionMethod,
            resolutionPlanId: input.resolutionPlanId ?? null
          }))
        )
      })
    },

    async updatePaymentRecord(input) {
      return db.transaction(async (tx) => {
        const [candidate] = await tx
          .select({ cycleId: schema.paymentRecords.cycleId })
          .from(schema.paymentRecords)
          .where(
            and(
              eq(schema.paymentRecords.householdId, householdId),
              eq(schema.paymentRecords.id, input.paymentId)
            )
          )
        if (!candidate) return null
        const [lockedCycle] = await tx
          .select({ id: schema.billingCycles.id, closedAt: schema.billingCycles.closedAt })
          .from(schema.billingCycles)
          .where(
            and(
              eq(schema.billingCycles.householdId, householdId),
              eq(schema.billingCycles.id, candidate.cycleId)
            )
          )
          .for('update')

        if (!lockedCycle || lockedCycle.closedAt)
          throw new Error('Closed payment period is read-only')
        const [existing] = await tx
          .select()
          .from(schema.paymentRecords)
          .where(
            and(
              eq(schema.paymentRecords.householdId, householdId),
              eq(schema.paymentRecords.id, input.paymentId)
            )
          )
          .for('update')
        if (!existing) return null
        if (
          !(
            existing.idempotencyKey?.startsWith('utility-rounding:') ||
            existing.idempotencyKey?.startsWith('utility-confirmation:')
          ) &&
          (existing.amountMinor !== input.amountMinor ||
            existing.memberId !== input.memberId ||
            existing.kind !== input.kind ||
            existing.currency !== input.currency)
        ) {
          const linked = await tx
            .select({ id: schema.utilityVendorPaymentFacts.id })
            .from(schema.utilityVendorPaymentFacts)
            .where(
              and(
                eq(schema.utilityVendorPaymentFacts.householdId, householdId),
                eq(schema.utilityVendorPaymentFacts.paymentRecordId, existing.id)
              )
            )
            .limit(1)
          if (linked.length)
            throw new Error(
              'A combined utility receipt has a saved provider distribution; delete it and record corrected payments by provider'
            )
        }
        if (existing.memberId !== input.memberId || existing.kind !== input.kind)
          await tx
            .update(schema.paymentRecords)
            .set({ purchaseReconciliationPending: 1 })
            .where(
              and(
                eq(schema.paymentRecords.householdId, householdId),
                eq(schema.paymentRecords.cycleId, existing.cycleId),
                eq(schema.paymentRecords.memberId, existing.memberId),
                eq(schema.paymentRecords.kind, existing.kind)
              )
            )
        if (
          existing.idempotencyKey?.startsWith('utility-rounding:') ||
          existing.idempotencyKey?.startsWith('utility-confirmation:')
        ) {
          if (
            input.kind !== 'utilities' ||
            input.currency !== existing.currency ||
            input.amountMinor <= 0n
          )
            throw new Error(
              'A linked provider payment must remain positive utilities in its original currency; delete and re-record to change kind or currency'
            )
          const [actor] = await tx
            .select()
            .from(schema.members)
            .where(
              and(
                eq(schema.members.householdId, householdId),
                eq(schema.members.id, input.actorMemberId ?? existing.memberId)
              )
            )
          if (
            !actor ||
            actor.lifecycleStatus === 'left' ||
            (actor.isAdmin !== 1 && (existing.memberId !== actor.id || input.memberId !== actor.id))
          )
            throw new Error(
              'Provider-linked payment correction requires its payer or an administrator'
            )
          const [payer] = await tx
            .select({ id: schema.members.id, status: schema.members.lifecycleStatus })
            .from(schema.members)
            .where(
              and(
                eq(schema.members.householdId, householdId),
                eq(schema.members.id, input.memberId)
              )
            )
          if (!payer || payer.status === 'left')
            throw new Error('Payment member not found in this household')
          await tx
            .select({ id: schema.billingCycles.id })
            .from(schema.billingCycles)
            .where(
              and(
                eq(schema.billingCycles.householdId, householdId),
                eq(schema.billingCycles.id, existing.cycleId)
              )
            )
            .for('update')
          const linked = await tx
            .select()
            .from(schema.utilityVendorPaymentFacts)
            .where(
              and(
                eq(schema.utilityVendorPaymentFacts.householdId, householdId),
                eq(schema.utilityVendorPaymentFacts.paymentRecordId, existing.id)
              )
            )
          if (linked.length !== 1 || !linked[0]!.utilityBillId)
            throw new Error('Linked provider fact is missing or ambiguous')
          const [bill] = await tx
            .select()
            .from(schema.utilityBills)
            .where(
              and(
                eq(schema.utilityBills.householdId, householdId),
                eq(schema.utilityBills.id, linked[0]!.utilityBillId)
              )
            )
            .for('update')
          if (!bill) throw new Error('Linked provider bill is missing')
          const contributions = (
            await tx
              .select()
              .from(schema.utilityVendorPaymentFacts)
              .where(
                and(
                  eq(schema.utilityVendorPaymentFacts.householdId, householdId),
                  eq(schema.utilityVendorPaymentFacts.cycleId, existing.cycleId)
                )
              )
          ).filter(
            (fact) =>
              fact.id !== linked[0]!.id &&
              (fact.utilityBillId === bill.id ||
                (!fact.utilityBillId &&
                  fact.billName.trim().toLowerCase() === bill.billName.trim().toLowerCase()))
          )
          if (contributions.some((fact) => fact.currency !== input.currency))
            throw new Error('Provider payments have conflicting currencies')
          const remaining =
            (await utilityBillMinorInCurrency(tx, bill, input.currency)) -
            contributions.reduce((sum, fact) => sum + fact.amountMinor, 0n)
          if (
            (existing.idempotencyKey?.startsWith('utility-rounding:') &&
              input.amountMinor > 200n) ||
            input.amountMinor > remaining
          )
            throw new Error(
              'Rounding correction exceeds the shortcut limit or remaining supplier balance'
            )
          const facts = await tx
            .update(schema.utilityVendorPaymentFacts)
            .set({
              payerMemberId: input.memberId,
              amountMinor: input.amountMinor,
              currency: input.currency,
              matchedPlan: 0,
              planId: null,
              planVersion: null,
              plannedForMemberId: null
            })
            .where(
              and(
                eq(schema.utilityVendorPaymentFacts.householdId, householdId),
                eq(schema.utilityVendorPaymentFacts.paymentRecordId, existing.id)
              )
            )
            .returning({ id: schema.utilityVendorPaymentFacts.id })
          if (facts.length !== 1) throw new Error('Linked provider fact is missing or ambiguous')
          await tx
            .update(schema.utilityBillingPlans)
            .set({ status: 'diverged' })
            .where(
              and(
                eq(schema.utilityBillingPlans.householdId, householdId),
                eq(schema.utilityBillingPlans.cycleId, existing.cycleId),
                inArray(schema.utilityBillingPlans.status, ['active', 'settled'])
              )
            )
        }
        const rows = await tx
          .update(schema.paymentRecords)
          .set({
            memberId: input.memberId,
            purchaseReconciliationPending: 1,
            fundingPhase:
              existing.memberId !== input.memberId ||
              existing.kind !== input.kind ||
              existing.currency !== input.currency
                ? await nextPaymentFundingPhase(tx, householdId, existing.cycleId)
                : existing.fundingPhase,
            purchaseFundingContext:
              existing.memberId !== input.memberId ||
              existing.kind !== input.kind ||
              existing.currency !== input.currency
                ? null
                : existing.purchaseFundingContext,
            kind: input.kind,
            amountMinor: input.amountMinor,
            currency: input.currency
          })
          .where(
            and(
              eq(schema.paymentRecords.householdId, householdId),
              eq(schema.paymentRecords.id, input.paymentId)
            )
          )
          .returning({
            id: schema.paymentRecords.id,
            cycleId: schema.paymentRecords.cycleId,
            memberId: schema.paymentRecords.memberId,
            kind: schema.paymentRecords.kind,
            amountMinor: schema.paymentRecords.amountMinor,
            currency: schema.paymentRecords.currency,
            fundingPhase: schema.paymentRecords.fundingPhase,
            purchaseFundingContext: schema.paymentRecords.purchaseFundingContext,
            purchaseReconciliationPending: schema.paymentRecords.purchaseReconciliationPending,
            recordedAt: schema.paymentRecords.recordedAt
          })

        const row = rows[0]
        if (!row) {
          return null
        }

        return {
          id: row.id,
          cycleId: row.cycleId,
          cyclePeriod: null,
          memberId: row.memberId,
          kind: row.kind === 'utilities' ? 'utilities' : 'rent',
          amountMinor: row.amountMinor,
          currency: toCurrencyCode(row.currency),
          ...paymentFundingFields(row),
          recordedAt: instantFromDatabaseValue(row.recordedAt)!
        }
      })
    },

    async deletePaymentRecord(paymentId) {
      return db.transaction(async (tx) => {
        const [candidate] = await tx
          .select({ cycleId: schema.paymentRecords.cycleId })
          .from(schema.paymentRecords)
          .where(
            and(
              eq(schema.paymentRecords.householdId, householdId),
              eq(schema.paymentRecords.id, paymentId)
            )
          )
        if (!candidate) return false
        const [lockedCycle] = await tx
          .select({ id: schema.billingCycles.id, closedAt: schema.billingCycles.closedAt })
          .from(schema.billingCycles)
          .where(
            and(
              eq(schema.billingCycles.householdId, householdId),
              eq(schema.billingCycles.id, candidate.cycleId)
            )
          )
          .for('update')

        if (!lockedCycle || lockedCycle.closedAt)
          throw new Error('Closed payment period is read-only')
        const [existing] = await tx
          .select()
          .from(schema.paymentRecords)
          .where(
            and(
              eq(schema.paymentRecords.householdId, householdId),
              eq(schema.paymentRecords.id, paymentId)
            )
          )
          .for('update')
        if (
          existing &&
          (existing.idempotencyKey?.startsWith('utility-rounding:') ||
            existing.idempotencyKey?.startsWith('utility-confirmation:'))
        )
          await tx
            .update(schema.utilityBillingPlans)
            .set({ status: 'diverged' })
            .where(
              and(
                eq(schema.utilityBillingPlans.householdId, householdId),
                eq(schema.utilityBillingPlans.cycleId, existing.cycleId),
                inArray(schema.utilityBillingPlans.status, ['active', 'settled'])
              )
            )
        if (existing)
          await tx
            .update(schema.paymentRecords)
            .set({ purchaseReconciliationPending: 1 })
            .where(
              and(
                eq(schema.paymentRecords.householdId, householdId),
                eq(schema.paymentRecords.cycleId, existing.cycleId),
                eq(schema.paymentRecords.memberId, existing.memberId),
                eq(schema.paymentRecords.kind, existing.kind)
              )
            )
        const rows = await tx
          .delete(schema.paymentRecords)
          .where(
            and(
              eq(schema.paymentRecords.householdId, householdId),
              eq(schema.paymentRecords.id, paymentId)
            )
          )
          .returning({
            id: schema.paymentRecords.id
          })

        return rows.length > 0
      })
    },

    async getRentRuleForPeriod(period) {
      const rows = await db
        .select({
          amountMinor: schema.rentRules.amountMinor,
          currency: schema.rentRules.currency
        })
        .from(schema.rentRules)
        .where(
          and(
            eq(schema.rentRules.householdId, householdId),
            lte(schema.rentRules.effectiveFromPeriod, period),
            or(
              isNull(schema.rentRules.effectiveToPeriod),
              gte(schema.rentRules.effectiveToPeriod, period)
            )
          )
        )
        .orderBy(desc(schema.rentRules.effectiveFromPeriod))
        .limit(1)

      const row = rows[0]

      if (!row) {
        return null
      }

      return {
        ...row,
        currency: toCurrencyCode(row.currency)
      }
    },

    async listRentRuleRanges() {
      const rows = await db
        .select({
          amountMinor: schema.rentRules.amountMinor,
          currency: schema.rentRules.currency,
          effectiveFromPeriod: schema.rentRules.effectiveFromPeriod,
          effectiveToPeriod: schema.rentRules.effectiveToPeriod
        })
        .from(schema.rentRules)
        .where(eq(schema.rentRules.householdId, householdId))
        .orderBy(desc(schema.rentRules.effectiveFromPeriod))

      return rows.map((row) => ({
        ...row,
        currency: toCurrencyCode(row.currency)
      }))
    },

    async getRentRuleStartingAtPeriod(period) {
      const rows = await db
        .select({
          amountMinor: schema.rentRules.amountMinor,
          currency: schema.rentRules.currency
        })
        .from(schema.rentRules)
        .where(
          and(
            eq(schema.rentRules.householdId, householdId),
            eq(schema.rentRules.effectiveFromPeriod, period)
          )
        )
        .limit(1)

      const row = rows[0]
      return row ? { ...row, currency: toCurrencyCode(row.currency) } : null
    },

    async getUtilityTotalForCycle(cycleId) {
      const rows = await db
        .select({
          totalMinor: sql<string>`coalesce(sum(${schema.utilityBills.amountMinor}), 0)`
        })
        .from(schema.utilityBills)
        .where(eq(schema.utilityBills.cycleId, cycleId))

      return BigInt(rows[0]?.totalMinor ?? '0')
    },

    async listUtilityBillsForCycle(cycleId) {
      const rows = await selectUtilityBillsForCycles([cycleId])
      return rows.map((row) => row.bill)
    },

    async listUtilityBillsForCycles(cycleIds) {
      const rows = await selectUtilityBillsForCycles(cycleIds)
      const billsByCycleId = new Map<string, (typeof rows)[number]['bill'][]>()
      for (const row of rows) {
        const bills = billsByCycleId.get(row.cycleId)
        if (bills) {
          bills.push(row.bill)
          continue
        }
        billsByCycleId.set(row.cycleId, [row.bill])
      }

      // Every requested cycle gets an entry, so a caller can tell "no bills" apart from
      // "not fetched" without re-checking its own request.
      return cycleIds.map((cycleId) => ({
        cycleId,
        bills: billsByCycleId.get(cycleId) ?? []
      }))
    },

    async getActiveUtilityBillingPlan(cycleId) {
      const rows = await db
        .select({
          id: schema.utilityBillingPlans.id,
          householdId: schema.utilityBillingPlans.householdId,
          cycleId: schema.utilityBillingPlans.cycleId,
          version: schema.utilityBillingPlans.version,
          status: schema.utilityBillingPlans.status,
          dueDate: schema.utilityBillingPlans.dueDate,
          currency: schema.utilityBillingPlans.currency,
          maxCategoriesPerMemberApplied: schema.utilityBillingPlans.maxCategoriesPerMemberApplied,
          updatedFromPlanId: schema.utilityBillingPlans.updatedFromPlanId,
          reason: schema.utilityBillingPlans.reason,
          payload: schema.utilityBillingPlans.payload,
          createdAt: schema.utilityBillingPlans.createdAt
        })
        .from(schema.utilityBillingPlans)
        .where(
          and(
            eq(schema.utilityBillingPlans.cycleId, cycleId),
            or(
              eq(schema.utilityBillingPlans.status, 'active'),
              eq(schema.utilityBillingPlans.status, 'settled')
            )
          )
        )
        .orderBy(desc(schema.utilityBillingPlans.version))
        .limit(1)

      const row = rows[0]
      return row ? mapUtilityBillingPlanRecord(row) : null
    },

    async listUtilityBillingPlansForCycle(cycleId) {
      return await selectUtilityBillingPlansForCycles([cycleId])
    },

    async listUtilityBillingPlansForCycles(cycleIds) {
      return await selectUtilityBillingPlansForCycles(cycleIds)
    },

    async saveUtilityBillingPlan(input) {
      const rows = await db
        .insert(schema.utilityBillingPlans)
        .values({
          householdId,
          cycleId: input.cycleId,
          version: input.version,
          status: input.status,
          dueDate: input.dueDate,
          currency: input.currency,
          maxCategoriesPerMemberApplied: input.maxCategoriesPerMemberApplied,
          updatedFromPlanId: input.updatedFromPlanId,
          reason: input.reason,
          payload: input.payload
        })
        .returning({
          id: schema.utilityBillingPlans.id,
          householdId: schema.utilityBillingPlans.householdId,
          cycleId: schema.utilityBillingPlans.cycleId,
          version: schema.utilityBillingPlans.version,
          status: schema.utilityBillingPlans.status,
          dueDate: schema.utilityBillingPlans.dueDate,
          currency: schema.utilityBillingPlans.currency,
          maxCategoriesPerMemberApplied: schema.utilityBillingPlans.maxCategoriesPerMemberApplied,
          updatedFromPlanId: schema.utilityBillingPlans.updatedFromPlanId,
          reason: schema.utilityBillingPlans.reason,
          payload: schema.utilityBillingPlans.payload,
          createdAt: schema.utilityBillingPlans.createdAt
        })

      const row = rows[0]
      if (!row) {
        throw new Error('Utility billing plan insert did not return a row')
      }

      return mapUtilityBillingPlanRecord(row)
    },

    async replaceCurrentUtilityBillingPlan(input) {
      return db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.cycleId}))`)

        const currentRows = await tx
          .select({
            id: schema.utilityBillingPlans.id,
            householdId: schema.utilityBillingPlans.householdId,
            cycleId: schema.utilityBillingPlans.cycleId,
            version: schema.utilityBillingPlans.version,
            status: schema.utilityBillingPlans.status,
            dueDate: schema.utilityBillingPlans.dueDate,
            currency: schema.utilityBillingPlans.currency,
            maxCategoriesPerMemberApplied: schema.utilityBillingPlans.maxCategoriesPerMemberApplied,
            updatedFromPlanId: schema.utilityBillingPlans.updatedFromPlanId,
            reason: schema.utilityBillingPlans.reason,
            payload: schema.utilityBillingPlans.payload,
            createdAt: schema.utilityBillingPlans.createdAt
          })
          .from(schema.utilityBillingPlans)
          .where(
            and(
              eq(schema.utilityBillingPlans.cycleId, input.cycleId),
              or(
                eq(schema.utilityBillingPlans.status, 'active'),
                eq(schema.utilityBillingPlans.status, 'settled')
              )
            )
          )
          .orderBy(desc(schema.utilityBillingPlans.version))
          .limit(1)
        const current = currentRows[0] ? mapUtilityBillingPlanRecord(currentRows[0]) : null

        if (
          current &&
          current.status === input.status &&
          current.dueDate === input.dueDate &&
          current.currency === input.currency &&
          current.maxCategoriesPerMemberApplied === input.maxCategoriesPerMemberApplied &&
          JSON.stringify(current.payload) ===
            JSON.stringify(mapUtilityBillingPlanPayload(input.payload))
        ) {
          return current
        }

        // A concurrent request can have committed a newer plan while this caller
        // was computing. Never replace that plan with the caller's stale snapshot.
        if (current && current.id !== input.previousPlanId) return current
        const planToReplace = current
        if (planToReplace && input.previousPlanReplacementStatus) {
          await tx
            .update(schema.utilityBillingPlans)
            .set({ status: input.previousPlanReplacementStatus })
            .where(
              and(
                eq(schema.utilityBillingPlans.id, planToReplace.id),
                eq(schema.utilityBillingPlans.householdId, householdId)
              )
            )
        }

        const versionRows = await tx
          .select({ version: schema.utilityBillingPlans.version })
          .from(schema.utilityBillingPlans)
          .where(eq(schema.utilityBillingPlans.cycleId, input.cycleId))
          .orderBy(desc(schema.utilityBillingPlans.version))
          .limit(1)
        const nextVersion = (versionRows[0]?.version ?? 0) + 1

        const rows = await tx
          .insert(schema.utilityBillingPlans)
          .values({
            householdId,
            cycleId: input.cycleId,
            version: nextVersion,
            status: input.status,
            dueDate: input.dueDate,
            currency: input.currency,
            maxCategoriesPerMemberApplied: input.maxCategoriesPerMemberApplied,
            updatedFromPlanId: planToReplace?.id ?? input.previousPlanId,
            reason: input.reason,
            payload: input.payload
          })
          .returning({
            id: schema.utilityBillingPlans.id,
            householdId: schema.utilityBillingPlans.householdId,
            cycleId: schema.utilityBillingPlans.cycleId,
            version: schema.utilityBillingPlans.version,
            status: schema.utilityBillingPlans.status,
            dueDate: schema.utilityBillingPlans.dueDate,
            currency: schema.utilityBillingPlans.currency,
            maxCategoriesPerMemberApplied: schema.utilityBillingPlans.maxCategoriesPerMemberApplied,
            updatedFromPlanId: schema.utilityBillingPlans.updatedFromPlanId,
            reason: schema.utilityBillingPlans.reason,
            payload: schema.utilityBillingPlans.payload,
            createdAt: schema.utilityBillingPlans.createdAt
          })

        const row = rows[0]
        if (!row) {
          throw new Error('Utility billing plan replacement did not return a row')
        }

        return mapUtilityBillingPlanRecord(row)
      })
    },

    async updateUtilityBillingPlanStatus(planId, status) {
      const rows = await db
        .update(schema.utilityBillingPlans)
        .set({ status })
        .where(
          and(
            eq(schema.utilityBillingPlans.id, planId),
            eq(schema.utilityBillingPlans.householdId, householdId)
          )
        )
        .returning({
          id: schema.utilityBillingPlans.id,
          householdId: schema.utilityBillingPlans.householdId,
          cycleId: schema.utilityBillingPlans.cycleId,
          version: schema.utilityBillingPlans.version,
          status: schema.utilityBillingPlans.status,
          dueDate: schema.utilityBillingPlans.dueDate,
          currency: schema.utilityBillingPlans.currency,
          maxCategoriesPerMemberApplied: schema.utilityBillingPlans.maxCategoriesPerMemberApplied,
          updatedFromPlanId: schema.utilityBillingPlans.updatedFromPlanId,
          reason: schema.utilityBillingPlans.reason,
          payload: schema.utilityBillingPlans.payload,
          createdAt: schema.utilityBillingPlans.createdAt
        })

      const row = rows[0]
      return row ? mapUtilityBillingPlanRecord(row) : null
    },

    async listUtilityVendorPaymentFactsForCycle(cycleId) {
      return await selectUtilityVendorPaymentFactsForCycles([cycleId])
    },

    async listUtilityVendorPaymentFactsForCycles(cycleIds) {
      return await selectUtilityVendorPaymentFactsForCycles(cycleIds)
    },

    async getUtilityVendorPaymentFact(factId) {
      const rows = await db
        .select({
          id: schema.utilityVendorPaymentFacts.id,
          cycleId: schema.utilityVendorPaymentFacts.cycleId,
          planId: schema.utilityVendorPaymentFacts.planId,
          utilityBillId: schema.utilityVendorPaymentFacts.utilityBillId,
          billName: schema.utilityVendorPaymentFacts.billName,
          payerMemberId: schema.utilityVendorPaymentFacts.payerMemberId,
          amountMinor: schema.utilityVendorPaymentFacts.amountMinor,
          currency: schema.utilityVendorPaymentFacts.currency,
          plannedForMemberId: schema.utilityVendorPaymentFacts.plannedForMemberId,
          planVersion: schema.utilityVendorPaymentFacts.planVersion,
          matchedPlan: schema.utilityVendorPaymentFacts.matchedPlan,
          recordedByMemberId: schema.utilityVendorPaymentFacts.recordedByMemberId,
          paymentRecordId: schema.utilityVendorPaymentFacts.paymentRecordId,
          recordedAt: schema.utilityVendorPaymentFacts.recordedAt,
          createdAt: schema.utilityVendorPaymentFacts.createdAt
        })
        .from(schema.utilityVendorPaymentFacts)
        .where(
          and(
            eq(schema.utilityVendorPaymentFacts.householdId, householdId),
            eq(schema.utilityVendorPaymentFacts.id, factId)
          )
        )
        .limit(1)

      const row = rows[0]
      if (!row) {
        return null
      }

      return {
        ...row,
        currency: toCurrencyCode(row.currency),
        matchedPlan: row.matchedPlan === 1,
        recordedAt: instantFromDatabaseValue(row.recordedAt)!,
        createdAt: instantFromDatabaseValue(row.createdAt)!
      }
    },

    async deleteUtilityVendorPaymentFact(factId) {
      return db.transaction(async (tx) => {
        const [fact] = await tx
          .select()
          .from(schema.utilityVendorPaymentFacts)
          .where(
            and(
              eq(schema.utilityVendorPaymentFacts.householdId, householdId),
              eq(schema.utilityVendorPaymentFacts.id, factId)
            )
          )
        if (!fact) return false
        const [lockedCycle] = await tx
          .select({ id: schema.billingCycles.id, closedAt: schema.billingCycles.closedAt })
          .from(schema.billingCycles)
          .where(
            and(
              eq(schema.billingCycles.householdId, householdId),
              eq(schema.billingCycles.id, fact.cycleId)
            )
          )
          .for('update')

        if (!lockedCycle || lockedCycle.closedAt)
          throw new Error('Closed supplier period is read-only')
        if (fact.paymentRecordId) {
          const [payment] = await tx
            .select()
            .from(schema.paymentRecords)
            .where(
              and(
                eq(schema.paymentRecords.householdId, householdId),
                eq(schema.paymentRecords.id, fact.paymentRecordId)
              )
            )
            .for('update')
          if (
            payment &&
            !(
              payment.idempotencyKey?.startsWith('utility-rounding:') ||
              payment.idempotencyKey?.startsWith('utility-confirmation:')
            )
          )
            throw new Error(
              'A combined utility receipt has a saved provider distribution; delete the entire receipt to correct it'
            )
          if (
            payment &&
            (payment.idempotencyKey?.startsWith('utility-rounding:') ||
              payment.idempotencyKey?.startsWith('utility-confirmation:'))
          ) {
            await tx
              .update(schema.utilityBillingPlans)
              .set({ status: 'diverged' })
              .where(
                and(
                  eq(schema.utilityBillingPlans.householdId, householdId),
                  eq(schema.utilityBillingPlans.cycleId, payment.cycleId),
                  inArray(schema.utilityBillingPlans.status, ['active', 'settled'])
                )
              )
            await tx
              .update(schema.paymentRecords)
              .set({ purchaseReconciliationPending: 1 })
              .where(
                and(
                  eq(schema.paymentRecords.householdId, householdId),
                  eq(schema.paymentRecords.cycleId, payment.cycleId),
                  eq(schema.paymentRecords.memberId, payment.memberId),
                  eq(schema.paymentRecords.kind, payment.kind)
                )
              )
            const deleted = await tx
              .delete(schema.paymentRecords)
              .where(
                and(
                  eq(schema.paymentRecords.householdId, householdId),
                  eq(schema.paymentRecords.id, payment.id)
                )
              )
              .returning({ id: schema.paymentRecords.id })
            return deleted.length > 0 // Its linked fact and allocations cascade with it.
          }
        }
        const rows = await tx
          .delete(schema.utilityVendorPaymentFacts)
          .where(
            and(
              eq(schema.utilityVendorPaymentFacts.householdId, householdId),
              eq(schema.utilityVendorPaymentFacts.id, factId)
            )
          )
          .returning({
            id: schema.utilityVendorPaymentFacts.id
          })

        return rows.length > 0
      })
    },

    async attachUtilityVendorPaymentFactsToPayment(input) {
      await db.transaction(async (tx) => {
        const [candidate] = await tx
          .select({ cycleId: schema.paymentRecords.cycleId })
          .from(schema.paymentRecords)
          .where(
            and(
              eq(schema.paymentRecords.householdId, householdId),
              eq(schema.paymentRecords.id, input.paymentRecordId)
            )
          )
        if (!candidate) throw new Error('Payment receipt is unavailable')
        const [cycle] = await tx
          .select()
          .from(schema.billingCycles)
          .where(
            and(
              eq(schema.billingCycles.householdId, householdId),
              eq(schema.billingCycles.id, candidate.cycleId)
            )
          )
          .for('update')
        if (!cycle || cycle.closedAt) throw new Error('Closed payment period is read-only')
        const [receipt] = await tx
          .select()
          .from(schema.paymentRecords)
          .where(
            and(
              eq(schema.paymentRecords.householdId, householdId),
              eq(schema.paymentRecords.id, input.paymentRecordId)
            )
          )
          .for('update')
        if (!receipt || receipt.kind !== 'utilities')
          throw new Error('Utility receipt is unavailable')
        if (input.factIds.length > 0) {
          const facts = await tx
            .select()
            .from(schema.utilityVendorPaymentFacts)
            .where(
              and(
                eq(schema.utilityVendorPaymentFacts.householdId, householdId),
                inArray(schema.utilityVendorPaymentFacts.id, [...input.factIds])
              )
            )
            .for('update')
          if (
            facts.length !== new Set(input.factIds).size ||
            facts.some(
              (f) =>
                f.cycleId !== receipt.cycleId ||
                f.payerMemberId !== receipt.memberId ||
                (f.paymentRecordId && f.paymentRecordId !== receipt.id)
            )
          )
            throw new Error('Provider contribution does not belong to this receipt')
          await tx
            .update(schema.utilityVendorPaymentFacts)
            .set({ paymentRecordId: receipt.id })
            .where(
              inArray(
                schema.utilityVendorPaymentFacts.id,
                facts.map((f) => f.id)
              )
            )
        }
        await tx
          .update(schema.paymentRecords)
          .set({ purchaseReconciliationPending: 1 })
          .where(eq(schema.paymentRecords.id, receipt.id))
      })
    },

    async addUtilityVendorPaymentFact(input) {
      const rows = await db
        .insert(schema.utilityVendorPaymentFacts)
        .values({
          householdId,
          cycleId: input.cycleId,
          planId: input.planId ?? null,
          utilityBillId: input.utilityBillId ?? null,
          billName: input.billName,
          payerMemberId: input.payerMemberId,
          amountMinor: input.amountMinor,
          currency: input.currency,
          plannedForMemberId: input.plannedForMemberId ?? null,
          planVersion: input.planVersion ?? null,
          matchedPlan: input.matchedPlan ? 1 : 0,
          recordedByMemberId: input.recordedByMemberId ?? null,
          paymentRecordId: input.paymentRecordId ?? null,
          recordedAt: instantToDate(input.recordedAt)
        })
        .returning({
          id: schema.utilityVendorPaymentFacts.id,
          cycleId: schema.utilityVendorPaymentFacts.cycleId,
          planId: schema.utilityVendorPaymentFacts.planId,
          utilityBillId: schema.utilityVendorPaymentFacts.utilityBillId,
          billName: schema.utilityVendorPaymentFacts.billName,
          payerMemberId: schema.utilityVendorPaymentFacts.payerMemberId,
          amountMinor: schema.utilityVendorPaymentFacts.amountMinor,
          currency: schema.utilityVendorPaymentFacts.currency,
          plannedForMemberId: schema.utilityVendorPaymentFacts.plannedForMemberId,
          planVersion: schema.utilityVendorPaymentFacts.planVersion,
          matchedPlan: schema.utilityVendorPaymentFacts.matchedPlan,
          recordedByMemberId: schema.utilityVendorPaymentFacts.recordedByMemberId,
          paymentRecordId: schema.utilityVendorPaymentFacts.paymentRecordId,
          recordedAt: schema.utilityVendorPaymentFacts.recordedAt,
          createdAt: schema.utilityVendorPaymentFacts.createdAt
        })

      const row = rows[0]
      if (!row) {
        throw new Error('Utility vendor payment fact insert did not return a row')
      }

      return {
        ...row,
        currency: toCurrencyCode(row.currency),
        matchedPlan: row.matchedPlan === 1,
        recordedAt: instantFromDatabaseValue(row.recordedAt)!,
        createdAt: instantFromDatabaseValue(row.createdAt)!
      }
    },

    async addUtilityVendorPaymentFactIfNew(input) {
      return db.transaction(async (tx) => {
        const [cycle] = await tx
          .select()
          .from(schema.billingCycles)
          .where(
            and(
              eq(schema.billingCycles.householdId, householdId),
              eq(schema.billingCycles.id, input.cycleId)
            )
          )
          .for('update')
        if (!cycle) throw new Error('Utility payment cycle is missing')
        const [duplicate] = await tx
          .select({ id: schema.utilityVendorPaymentFacts.id })
          .from(schema.utilityVendorPaymentFacts)
          .where(
            and(
              eq(schema.utilityVendorPaymentFacts.householdId, householdId),
              eq(schema.utilityVendorPaymentFacts.idempotencyKey, input.idempotencyKey)
            )
          )
        if (duplicate) return null
        if (cycle.closedAt) throw new Error('Utility payment cycle is closed')
        if (input.utilityBillId) {
          const [bill] = await tx
            .select()
            .from(schema.utilityBills)
            .where(
              and(
                eq(schema.utilityBills.householdId, householdId),
                eq(schema.utilityBills.cycleId, cycle.id),
                eq(schema.utilityBills.id, input.utilityBillId)
              )
            )
            .for('update')
          if (!bill || input.currency !== cycle.currency)
            throw new Error('Utility payment bill or currency is invalid')
          let total = Money.fromMinor(bill.amountMinor, toCurrencyCode(bill.currency))
          if (bill.currency !== input.currency) {
            const [rate] = await tx
              .select()
              .from(schema.billingCycleExchangeRates)
              .where(
                and(
                  eq(schema.billingCycleExchangeRates.cycleId, cycle.id),
                  eq(schema.billingCycleExchangeRates.sourceCurrency, bill.currency),
                  eq(schema.billingCycleExchangeRates.targetCurrency, input.currency)
                )
              )
            if (!rate) throw new Error('Utility bill exchange rate is not locked')
            total = convertMoney(total, input.currency, rate.rateMicros)
          }
          const facts = (
            await tx
              .select()
              .from(schema.utilityVendorPaymentFacts)
              .where(
                and(
                  eq(schema.utilityVendorPaymentFacts.householdId, householdId),
                  eq(schema.utilityVendorPaymentFacts.cycleId, cycle.id)
                )
              )
          ).filter(
            (fact) =>
              fact.utilityBillId === bill.id ||
              (!fact.utilityBillId &&
                fact.billName.trim().toLowerCase() === bill.billName.trim().toLowerCase())
          )
          if (facts.some((fact) => fact.currency !== input.currency))
            throw new Error('Provider payment currencies conflict')
          const remaining =
            total.amountMinor - facts.reduce((sum, fact) => sum + fact.amountMinor, 0n)
          if (input.amountMinor <= 0n || input.amountMinor > remaining)
            throw new Error('Payment cannot exceed the remaining bill amount')
        }
        const rows = await tx
          .insert(schema.utilityVendorPaymentFacts)
          .values({
            householdId,
            cycleId: input.cycleId,
            planId: input.planId ?? null,
            utilityBillId: input.utilityBillId ?? null,
            billName: input.billName,
            payerMemberId: input.payerMemberId,
            amountMinor: input.amountMinor,
            currency: input.currency,
            plannedForMemberId: input.plannedForMemberId ?? null,
            planVersion: input.planVersion ?? null,
            matchedPlan: input.matchedPlan ? 1 : 0,
            recordedByMemberId: input.recordedByMemberId ?? null,
            idempotencyKey: input.idempotencyKey,
            recordedAt: instantToDate(input.recordedAt)
          })
          .onConflictDoNothing({
            target: schema.utilityVendorPaymentFacts.idempotencyKey
          })
          .returning({
            id: schema.utilityVendorPaymentFacts.id,
            cycleId: schema.utilityVendorPaymentFacts.cycleId,
            planId: schema.utilityVendorPaymentFacts.planId,
            utilityBillId: schema.utilityVendorPaymentFacts.utilityBillId,
            billName: schema.utilityVendorPaymentFacts.billName,
            payerMemberId: schema.utilityVendorPaymentFacts.payerMemberId,
            amountMinor: schema.utilityVendorPaymentFacts.amountMinor,
            currency: schema.utilityVendorPaymentFacts.currency,
            plannedForMemberId: schema.utilityVendorPaymentFacts.plannedForMemberId,
            planVersion: schema.utilityVendorPaymentFacts.planVersion,
            matchedPlan: schema.utilityVendorPaymentFacts.matchedPlan,
            recordedByMemberId: schema.utilityVendorPaymentFacts.recordedByMemberId,
            paymentRecordId: schema.utilityVendorPaymentFacts.paymentRecordId,
            recordedAt: schema.utilityVendorPaymentFacts.recordedAt,
            createdAt: schema.utilityVendorPaymentFacts.createdAt
          })

        const row = rows[0]
        if (!row) {
          return null
        }

        return {
          ...row,
          currency: toCurrencyCode(row.currency),
          matchedPlan: row.matchedPlan === 1,
          recordedAt: instantFromDatabaseValue(row.recordedAt)!,
          createdAt: instantFromDatabaseValue(row.createdAt)!
        }
      })
    },

    async listUtilityReimbursementFactsForCycle(cycleId) {
      const rows = await db
        .select({
          id: schema.utilityReimbursementFacts.id,
          cycleId: schema.utilityReimbursementFacts.cycleId,
          fromMemberId: schema.utilityReimbursementFacts.fromMemberId,
          toMemberId: schema.utilityReimbursementFacts.toMemberId,
          amountMinor: schema.utilityReimbursementFacts.amountMinor,
          currency: schema.utilityReimbursementFacts.currency,
          plannedFromMemberId: schema.utilityReimbursementFacts.plannedFromMemberId,
          plannedToMemberId: schema.utilityReimbursementFacts.plannedToMemberId,
          planVersion: schema.utilityReimbursementFacts.planVersion,
          matchedPlan: schema.utilityReimbursementFacts.matchedPlan,
          recordedByMemberId: schema.utilityReimbursementFacts.recordedByMemberId,
          recordedAt: schema.utilityReimbursementFacts.recordedAt,
          createdAt: schema.utilityReimbursementFacts.createdAt
        })
        .from(schema.utilityReimbursementFacts)
        .where(eq(schema.utilityReimbursementFacts.cycleId, cycleId))
        .orderBy(schema.utilityReimbursementFacts.recordedAt, schema.utilityReimbursementFacts.id)

      return rows.map((row) => ({
        ...row,
        currency: toCurrencyCode(row.currency),
        matchedPlan: row.matchedPlan === 1,
        recordedAt: instantFromDatabaseValue(row.recordedAt)!,
        createdAt: instantFromDatabaseValue(row.createdAt)!
      }))
    },

    async addUtilityReimbursementFact(input) {
      const rows = await db
        .insert(schema.utilityReimbursementFacts)
        .values({
          householdId,
          cycleId: input.cycleId,
          fromMemberId: input.fromMemberId,
          toMemberId: input.toMemberId,
          amountMinor: input.amountMinor,
          currency: input.currency,
          plannedFromMemberId: input.plannedFromMemberId ?? null,
          plannedToMemberId: input.plannedToMemberId ?? null,
          planVersion: input.planVersion ?? null,
          matchedPlan: input.matchedPlan ? 1 : 0,
          recordedByMemberId: input.recordedByMemberId ?? null,
          recordedAt: instantToDate(input.recordedAt)
        })
        .returning({
          id: schema.utilityReimbursementFacts.id,
          cycleId: schema.utilityReimbursementFacts.cycleId,
          fromMemberId: schema.utilityReimbursementFacts.fromMemberId,
          toMemberId: schema.utilityReimbursementFacts.toMemberId,
          amountMinor: schema.utilityReimbursementFacts.amountMinor,
          currency: schema.utilityReimbursementFacts.currency,
          plannedFromMemberId: schema.utilityReimbursementFacts.plannedFromMemberId,
          plannedToMemberId: schema.utilityReimbursementFacts.plannedToMemberId,
          planVersion: schema.utilityReimbursementFacts.planVersion,
          matchedPlan: schema.utilityReimbursementFacts.matchedPlan,
          recordedByMemberId: schema.utilityReimbursementFacts.recordedByMemberId,
          recordedAt: schema.utilityReimbursementFacts.recordedAt,
          createdAt: schema.utilityReimbursementFacts.createdAt
        })

      const row = rows[0]
      if (!row) {
        throw new Error('Utility reimbursement fact insert did not return a row')
      }

      return {
        ...row,
        currency: toCurrencyCode(row.currency),
        matchedPlan: row.matchedPlan === 1,
        recordedAt: instantFromDatabaseValue(row.recordedAt)!,
        createdAt: instantFromDatabaseValue(row.createdAt)!
      }
    },

    async listPaymentRecordsForCycle(cycleId) {
      return await selectPaymentRecordsForCycles([cycleId])
    },

    async listPaymentRecordsForCycles(cycleIds) {
      return await selectPaymentRecordsForCycles(cycleIds)
    },

    async listParsedPurchasesForRange(start, end) {
      const rows = await db
        .select({
          id: schema.purchaseMessages.id,
          cycleId: schema.purchaseMessages.cycleId,
          cyclePeriod: schema.billingCycles.period,
          createdByMemberId: schema.purchaseMessages.senderMemberId,
          payerMemberId: schema.purchaseMessages.payerMemberId,
          amountMinor: schema.purchaseMessages.parsedAmountMinor,
          currency: schema.purchaseMessages.parsedCurrency,
          description: schema.purchaseMessages.parsedItemDescription,
          occurredAt: schema.purchaseMessages.messageSentAt,
          splitMode: schema.purchaseMessages.participantSplitMode
        })
        .from(schema.purchaseMessages)
        .leftJoin(
          schema.billingCycles,
          eq(schema.purchaseMessages.cycleId, schema.billingCycles.id)
        )
        .where(
          and(
            eq(schema.purchaseMessages.householdId, householdId),
            isNotNull(schema.purchaseMessages.payerMemberId),
            isNotNull(schema.purchaseMessages.parsedAmountMinor),
            isNotNull(schema.purchaseMessages.parsedCurrency),
            or(
              eq(schema.purchaseMessages.processingStatus, 'parsed'),
              eq(schema.purchaseMessages.processingStatus, 'confirmed')
            ),
            gte(schema.purchaseMessages.messageSentAt, instantToDate(start)),
            lt(schema.purchaseMessages.messageSentAt, instantToDate(end))
          )
        )

      const participantsByPurchaseId = await loadPurchaseParticipants(rows.map((row) => row.id))

      return rows.map((row) => ({
        id: row.id,
        cycleId: row.cycleId,
        cyclePeriod: row.cyclePeriod,
        createdByMemberId: row.createdByMemberId,
        payerMemberId: row.payerMemberId!,
        amountMinor: row.amountMinor!,
        currency: toCurrencyCode(row.currency!),
        description: row.description,
        occurredAt: instantFromDatabaseValue(row.occurredAt),
        splitMode: row.splitMode === 'custom_amounts' ? 'custom_amounts' : 'equal',
        participants: participantsByPurchaseId.get(row.id) ?? []
      }))
    },

    async listParsedPurchases() {
      const rows = await db
        .select({
          id: schema.purchaseMessages.id,
          cycleId: schema.purchaseMessages.cycleId,
          cyclePeriod: schema.billingCycles.period,
          createdByMemberId: schema.purchaseMessages.senderMemberId,
          payerMemberId: schema.purchaseMessages.payerMemberId,
          amountMinor: schema.purchaseMessages.parsedAmountMinor,
          currency: schema.purchaseMessages.parsedCurrency,
          description: schema.purchaseMessages.parsedItemDescription,
          occurredAt: schema.purchaseMessages.messageSentAt,
          splitMode: schema.purchaseMessages.participantSplitMode
        })
        .from(schema.purchaseMessages)
        .leftJoin(
          schema.billingCycles,
          eq(schema.purchaseMessages.cycleId, schema.billingCycles.id)
        )
        .where(
          and(
            eq(schema.purchaseMessages.householdId, householdId),
            isNotNull(schema.purchaseMessages.payerMemberId),
            isNotNull(schema.purchaseMessages.parsedAmountMinor),
            isNotNull(schema.purchaseMessages.parsedCurrency),
            or(
              eq(schema.purchaseMessages.processingStatus, 'parsed'),
              eq(schema.purchaseMessages.processingStatus, 'confirmed')
            )
          )
        )
        .orderBy(schema.purchaseMessages.messageSentAt, schema.purchaseMessages.id)

      const participantsByPurchaseId = await loadPurchaseParticipants(rows.map((row) => row.id))

      return rows.map((row) => ({
        id: row.id,
        cycleId: row.cycleId,
        cyclePeriod: row.cyclePeriod,
        createdByMemberId: row.createdByMemberId,
        payerMemberId: row.payerMemberId!,
        amountMinor: row.amountMinor!,
        currency: toCurrencyCode(row.currency!),
        description: row.description,
        occurredAt: instantFromDatabaseValue(row.occurredAt),
        splitMode: row.splitMode === 'custom_amounts' ? 'custom_amounts' : 'equal',
        participants: participantsByPurchaseId.get(row.id) ?? []
      }))
    },

    async listPaymentPurchaseAllocations() {
      const rows = await db
        .select({
          id: schema.paymentPurchaseAllocations.id,
          paymentRecordId: schema.paymentPurchaseAllocations.paymentRecordId,
          purchaseId: sql<string>`coalesce(${schema.paymentPurchaseAllocations.purchaseId}, ${schema.paymentPurchaseAllocations.transferId})`,
          memberId: schema.paymentPurchaseAllocations.memberId,
          amountMinor: schema.paymentPurchaseAllocations.amountMinor,
          resolutionCycleId: schema.paymentPurchaseAllocations.resolutionCycleId,
          resolutionMethod: schema.paymentPurchaseAllocations.resolutionMethod,
          resolutionPlanId: schema.paymentPurchaseAllocations.resolutionPlanId,
          fundingPhase: schema.paymentRecords.fundingPhase,
          purchaseFundingContext: schema.paymentRecords.purchaseFundingContext,
          purchaseReconciliationPending: schema.paymentRecords.purchaseReconciliationPending,
          recordedAt: schema.paymentRecords.recordedAt
        })
        .from(schema.paymentPurchaseAllocations)
        .innerJoin(
          schema.paymentRecords,
          eq(schema.paymentPurchaseAllocations.paymentRecordId, schema.paymentRecords.id)
        )
        .where(eq(schema.paymentRecords.householdId, householdId))
        .orderBy(
          schema.paymentPurchaseAllocations.purchaseId,
          schema.paymentPurchaseAllocations.memberId,
          schema.paymentPurchaseAllocations.createdAt
        )

      return rows.map((row) => ({
        ...row,
        resolutionMethod: row.resolutionMethod as 'utilities_plan' | 'rent_plan' | 'manual' | null,
        recordedAt: instantFromDatabaseValue(row.recordedAt)!
      }))
    },

    async createManualPurchaseAllocations(input) {
      if (input.allocations.length === 0) {
        return
      }

      await db.transaction(async (tx) => {
        await markOpenPaymentBalancesPending(tx)
        const [cycle] = await tx
          .select()
          .from(schema.billingCycles)
          .where(
            and(
              eq(schema.billingCycles.householdId, householdId),
              eq(schema.billingCycles.id, input.cycleId)
            )
          )
          .for('update')
        if (!cycle || cycle.closedAt) throw new Error('Closed payment period is read-only')
        if (
          input.expectedPricingRevision &&
          input.expectedPricingRevision !==
            (await paymentPricingRevision(tx, householdId, input.cycleId))
        )
          throw new Error('Payment pricing changed; retry manual resolution')
        // Create a synthetic payment record to track manual allocations
        const paymentRecord = await tx
          .insert(schema.paymentRecords)
          .values({
            householdId,
            cycleId: input.cycleId,
            memberId: sql`(SELECT payer_member_id FROM purchase_messages WHERE id = ${input.purchaseId})`,
            kind: 'utilities',
            amountMinor: 0n,
            currency: sql`(SELECT parsed_currency FROM purchase_messages WHERE id = ${input.purchaseId})`,
            recordedAt: instantToDate(input.recordedAt)
          })
          .returning({ id: schema.paymentRecords.id })

        const paymentRecordId = paymentRecord[0]?.id
        if (!paymentRecordId) {
          throw new Error('Failed to create manual payment record')
        }

        await tx.insert(schema.paymentPurchaseAllocations).values(
          input.allocations.map((allocation) => ({
            paymentRecordId,
            purchaseId: input.purchaseId,
            memberId: allocation.memberId,
            amountMinor: allocation.amountMinor,
            resolutionCycleId: input.cycleId,
            resolutionMethod: 'manual' as const,
            resolutionPlanId: null
          }))
        )
      })
    },

    async getSettlementSnapshotLines(cycleId) {
      const rows = await db
        .select({
          memberId: schema.settlementLines.memberId,
          rentShareMinor: schema.settlementLines.rentShareMinor,
          utilityShareMinor: schema.settlementLines.utilityShareMinor,
          purchaseOffsetMinor: schema.settlementLines.purchaseOffsetMinor,
          netDueMinor: schema.settlementLines.netDueMinor
        })
        .from(schema.settlementLines)
        .innerJoin(
          schema.settlements,
          eq(schema.settlementLines.settlementId, schema.settlements.id)
        )
        .where(eq(schema.settlements.cycleId, cycleId))

      return rows.map((row) => ({
        memberId: row.memberId,
        rentShareMinor: row.rentShareMinor,
        utilityShareMinor: row.utilityShareMinor,
        purchaseOffsetMinor: row.purchaseOffsetMinor,
        netDueMinor: row.netDueMinor
      }))
    },

    async getSettlementSnapshot(cycleId) {
      return (await selectSettlementSnapshotsForCycles([cycleId]))[0] ?? null
    },

    async listSettlementSnapshotsForCycles(cycleIds) {
      return selectSettlementSnapshotsForCycles(cycleIds)
    },

    async savePaymentConfirmation(input) {
      return db.transaction(async (tx) => {
        let providerBill: typeof schema.utilityBills.$inferSelect | undefined
        let providerPlan: typeof schema.utilityBillingPlans.$inferSelect | undefined
        let providerMatched = false
        if (input.status === 'recorded' && input.utilityBillId) {
          const [cycle] = await tx
            .select()
            .from(schema.billingCycles)
            .where(
              and(
                eq(schema.billingCycles.householdId, householdId),
                eq(schema.billingCycles.id, input.cycleId)
              )
            )
            .for('update')
          if (!cycle || cycle.closedAt)
            throw new Error('The utility period is unavailable or closed')
          const [duplicate] = await tx
            .select({ id: schema.paymentConfirmations.id })
            .from(schema.paymentConfirmations)
            .where(
              and(
                eq(schema.paymentConfirmations.householdId, householdId),
                eq(schema.paymentConfirmations.telegramChatId, input.telegramChatId),
                eq(
                  schema.paymentConfirmations.sourceKey,
                  input.sourceKey?.trim() || input.telegramMessageId
                )
              )
            )
          if (duplicate) return { status: 'duplicate' as const }
          const [payer] = await tx
            .select()
            .from(schema.members)
            .where(
              and(
                eq(schema.members.householdId, householdId),
                eq(schema.members.id, input.memberId)
              )
            )
          if (!payer || payer.lifecycleStatus === 'left')
            throw new Error('Utility payer is unavailable')
          const [bill] = await tx
            .select()
            .from(schema.utilityBills)
            .where(
              and(
                eq(schema.utilityBills.householdId, householdId),
                eq(schema.utilityBills.cycleId, input.cycleId),
                eq(schema.utilityBills.id, input.utilityBillId)
              )
            )
            .for('update')
          if (!bill || input.kind !== 'utilities' || input.amountMinor <= 0n)
            throw new Error('The named utility bill or payment currency is invalid')
          const facts = await tx
            .select()
            .from(schema.utilityVendorPaymentFacts)
            .where(
              and(
                eq(schema.utilityVendorPaymentFacts.householdId, householdId),
                eq(schema.utilityVendorPaymentFacts.cycleId, input.cycleId)
              )
            )
          const billFacts = facts.filter(
            (f) =>
              f.utilityBillId === bill.id ||
              (!f.utilityBillId &&
                f.billName.trim().toLowerCase() === bill.billName.trim().toLowerCase())
          )
          if (
            billFacts.some((f) => f.currency !== input.currency) ||
            input.amountMinor >
              (await utilityBillMinorInCurrency(tx, bill, input.currency)) -
                billFacts.reduce((n, f) => n + f.amountMinor, 0n)
          )
            throw new Error('Payment exceeds the remaining supplier balance')
          const [plan] = await tx
            .select()
            .from(schema.utilityBillingPlans)
            .where(
              and(
                eq(schema.utilityBillingPlans.householdId, householdId),
                eq(schema.utilityBillingPlans.cycleId, input.cycleId),
                inArray(schema.utilityBillingPlans.status, ['active', 'settled'])
              )
            )
            .orderBy(desc(schema.utilityBillingPlans.version))
            .limit(1)
          const category = plan
            ? mapUtilityBillingPlanPayload(plan.payload).categories.find(
                (c) => c.utilityBillId === bill.id && c.assignedMemberId === input.memberId
              )
            : undefined
          const currentPaid = plan
            ? billFacts
                .filter(
                  (f) =>
                    f.planId === plan.id &&
                    f.matchedPlan === 1 &&
                    f.payerMemberId === input.memberId
                )
                .reduce((n, f) => n + f.amountMinor, 0n)
            : 0n
          providerMatched = Boolean(
            category &&
            input.amountMinor <=
              BigInt(category.remainingAmountMinor ?? category.assignedAmountMinor) - currentPaid
          )
          providerBill = bill
          providerPlan = plan
        }
        const insertedConfirmation = await tx
          .insert(schema.paymentConfirmations)
          .values({
            householdId,
            cycleId: input.cycleId,
            memberId: input.memberId,
            senderTelegramUserId: input.senderTelegramUserId,
            rawText: input.rawText,
            normalizedText: input.normalizedText,
            detectedKind: input.kind,
            explicitAmountMinor: input.explicitAmountMinor,
            explicitCurrency: input.explicitCurrency,
            resolvedAmountMinor: input.amountMinor,
            resolvedCurrency: input.currency,
            status: input.status,
            reviewReason: input.status === 'needs_review' ? input.reviewReason : null,
            attachmentCount: input.attachmentCount,
            sourceKey: input.sourceKey?.trim() || input.telegramMessageId,
            telegramChatId: input.telegramChatId,
            telegramMessageId: input.telegramMessageId,
            telegramThreadId: input.telegramThreadId,
            telegramUpdateId: input.telegramUpdateId,
            messageSentAt: input.messageSentAt ? instantToDate(input.messageSentAt) : null
          })
          .onConflictDoNothing({
            target: [
              schema.paymentConfirmations.householdId,
              schema.paymentConfirmations.telegramChatId,
              schema.paymentConfirmations.sourceKey
            ]
          })
          .returning({
            id: schema.paymentConfirmations.id
          })

        const confirmationId = insertedConfirmation[0]?.id
        if (!confirmationId) {
          return {
            status: 'duplicate' as const
          }
        }

        if (input.status === 'needs_review') {
          return {
            status: 'needs_review' as const,
            reviewReason: input.reviewReason
          }
        }

        const phase = await nextPaymentFundingPhase(tx, householdId, input.cycleId)
        if (
          input.purchaseFundingContext?.inputRevision &&
          input.purchaseFundingContext.inputRevision !==
            (await paymentPricingRevision(tx, householdId, input.cycleId))
        )
          throw new Error('Payment pricing changed; retry confirmation')
        const insertedPayment = await tx
          .insert(schema.paymentRecords)
          .values({
            householdId,
            fundingPhase: phase,
            purchaseFundingContext: input.purchaseFundingContext ?? null,
            purchaseReconciliationPending: 1,
            cycleId: input.cycleId,
            memberId: input.memberId,
            kind: input.kind,
            amountMinor: input.amountMinor,
            currency: input.currency,
            confirmationId,
            recordedAt: instantToDate(input.recordedAt)
          })
          .returning({
            id: schema.paymentRecords.id,
            memberId: schema.paymentRecords.memberId,
            kind: schema.paymentRecords.kind,
            amountMinor: schema.paymentRecords.amountMinor,
            currency: schema.paymentRecords.currency,
            fundingPhase: schema.paymentRecords.fundingPhase,
            purchaseFundingContext: schema.paymentRecords.purchaseFundingContext,
            purchaseReconciliationPending: schema.paymentRecords.purchaseReconciliationPending,
            recordedAt: schema.paymentRecords.recordedAt
          })

        const paymentRow = insertedPayment[0]
        if (!paymentRow) {
          throw new Error('Failed to persist payment record')
        }

        if (input.utilityBillId && providerBill) {
          await tx.insert(schema.utilityVendorPaymentFacts).values({
            householdId,
            cycleId: input.cycleId,
            utilityBillId: providerBill.id,
            billName: providerBill.billName,
            payerMemberId: input.memberId,
            amountMinor: input.amountMinor,
            currency: input.currency,
            planId: providerMatched ? providerPlan?.id : null,
            planVersion: providerMatched ? providerPlan?.version : null,
            plannedForMemberId: providerMatched ? input.memberId : null,
            matchedPlan: providerMatched ? 1 : 0,
            paymentRecordId: paymentRow.id,
            recordedByMemberId: input.memberId,
            recordedAt: instantToDate(input.recordedAt),
            idempotencyKey: `utility-confirmation:${confirmationId}`
          })
          await tx
            .update(schema.paymentRecords)
            .set({ idempotencyKey: `utility-confirmation:${confirmationId}` })
            .where(eq(schema.paymentRecords.id, paymentRow.id))
        }

        return {
          status: 'recorded' as const,
          paymentRecord: {
            id: paymentRow.id,
            cycleId: input.cycleId,
            cyclePeriod: null,
            memberId: paymentRow.memberId,
            kind: paymentRow.kind === 'utilities' ? 'utilities' : 'rent',
            amountMinor: paymentRow.amountMinor,
            currency: toCurrencyCode(paymentRow.currency),
            ...paymentFundingFields(paymentRow),
            recordedAt: instantFromDatabaseValue(paymentRow.recordedAt)!
          }
        }
      })
    },

    async replaceSettlementSnapshot(snapshot) {
      await db.transaction(async (tx) => {
        const upserted = await tx
          .insert(schema.settlements)
          .values({
            householdId,
            cycleId: snapshot.cycleId,
            inputHash: snapshot.inputHash,
            totalDueMinor: snapshot.totalDueMinor,
            currency: snapshot.currency,
            metadata: snapshot.metadata
          })
          .onConflictDoUpdate({
            target: [schema.settlements.cycleId],
            set: {
              inputHash: snapshot.inputHash,
              totalDueMinor: snapshot.totalDueMinor,
              currency: snapshot.currency,
              computedAt: instantToDate(nowInstant()),
              metadata: snapshot.metadata
            }
          })
          .returning({ id: schema.settlements.id })

        const settlementId = upserted[0]?.id
        if (!settlementId) {
          throw new Error('Failed to persist settlement snapshot')
        }

        await tx
          .delete(schema.settlementLines)
          .where(eq(schema.settlementLines.settlementId, settlementId))

        if (snapshot.lines.length === 0) {
          return
        }

        await tx.insert(schema.settlementLines).values(
          snapshot.lines.map((line) => ({
            settlementId,
            memberId: line.memberId,
            rentShareMinor: line.rentShareMinor,
            utilityShareMinor: line.utilityShareMinor,
            purchaseOffsetMinor: line.purchaseOffsetMinor,
            netDueMinor: line.netDueMinor,
            explanations: line.explanations
          }))
        )
      })
    }
  }

  return {
    repository,
    utilityBillImports: createUtilityBillImportRepository(db, householdId),
    close: async () => {
      await closeDbClient()
    }
  }
}
