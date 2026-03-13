import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm'

import { createDbClient, schema } from '@household/db'
import type { FinanceRepository } from '@household/ports'
import {
  instantFromDatabaseValue,
  instantToDate,
  nowInstant,
  type CurrencyCode
} from '@household/domain'
import { randomUUID } from 'node:crypto'

function toCurrencyCode(raw: string): CurrencyCode {
  const normalized = raw.trim().toUpperCase()

  if (normalized !== 'USD' && normalized !== 'GEL') {
    throw new Error(`Unsupported currency in finance repository: ${raw}`)
  }

  return normalized
}

export function createDbFinanceRepository(
  databaseUrl: string,
  householdId: string
): {
  repository: FinanceRepository
  close: () => Promise<void>
} {
  const { db, queryClient } = createDbClient(databaseUrl, {
    max: 5,
    prepare: false
  })

  async function loadPurchaseParticipants(purchaseIds: readonly string[]): Promise<
    ReadonlyMap<
      string,
      readonly {
        id: string
        memberId: string
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

  const repository: FinanceRepository = {
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
        currency: toCurrencyCode(row.currency)
      }
    },

    async getCycleByPeriod(period) {
      const rows = await db
        .select({
          id: schema.billingCycles.id,
          period: schema.billingCycles.period,
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
        currency: toCurrencyCode(row.currency)
      }
    },

    async getLatestCycle() {
      const rows = await db
        .select({
          id: schema.billingCycles.id,
          period: schema.billingCycles.period,
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

    async closeCycle(cycleId, closedAt) {
      await db
        .update(schema.billingCycles)
        .set({
          closedAt: instantToDate(closedAt)
        })
        .where(eq(schema.billingCycles.id, cycleId))
    },

    async saveRentRule(period, amountMinor, currency) {
      await db
        .insert(schema.rentRules)
        .values({
          householdId,
          amountMinor,
          currency,
          effectiveFromPeriod: period
        })
        .onConflictDoUpdate({
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
        senderMemberId: input.payerMemberId,
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
          payerMemberId: schema.purchaseMessages.senderMemberId,
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
        payerMemberId: row.payerMemberId,
        amountMinor: row.amountMinor,
        currency: toCurrencyCode(row.currency),
        description: row.description,
        occurredAt: row.occurredAt ? instantFromDatabaseValue(row.occurredAt) : null,
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
        const rows = await tx
          .update(schema.purchaseMessages)
          .set({
            parsedAmountMinor: input.amountMinor,
            parsedCurrency: input.currency,
            parsedItemDescription: input.description,
            ...(input.splitMode
              ? {
                  participantSplitMode: input.splitMode
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
            payerMemberId: schema.purchaseMessages.senderMemberId,
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
          payerMemberId: row.payerMemberId,
          amountMinor: row.amountMinor,
          currency: toCurrencyCode(row.currency),
          description: row.description,
          occurredAt: instantFromDatabaseValue(row.occurredAt),
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
      const rows = await db
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
      const rows = await db
        .insert(schema.paymentRecords)
        .values({
          householdId,
          cycleId: input.cycleId,
          memberId: input.memberId,
          kind: input.kind,
          amountMinor: input.amountMinor,
          currency: input.currency,
          recordedAt: instantToDate(input.recordedAt)
        })
        .returning({
          id: schema.paymentRecords.id,
          memberId: schema.paymentRecords.memberId,
          kind: schema.paymentRecords.kind,
          amountMinor: schema.paymentRecords.amountMinor,
          currency: schema.paymentRecords.currency,
          recordedAt: schema.paymentRecords.recordedAt
        })

      const row = rows[0]
      if (!row) {
        throw new Error('Failed to add payment record')
      }

      return {
        id: row.id,
        memberId: row.memberId,
        kind: row.kind === 'utilities' ? 'utilities' : 'rent',
        amountMinor: row.amountMinor,
        currency: toCurrencyCode(row.currency),
        recordedAt: instantFromDatabaseValue(row.recordedAt)!
      }
    },

    async updatePaymentRecord(input) {
      const rows = await db
        .update(schema.paymentRecords)
        .set({
          memberId: input.memberId,
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
          memberId: schema.paymentRecords.memberId,
          kind: schema.paymentRecords.kind,
          amountMinor: schema.paymentRecords.amountMinor,
          currency: schema.paymentRecords.currency,
          recordedAt: schema.paymentRecords.recordedAt
        })

      const row = rows[0]
      if (!row) {
        return null
      }

      return {
        id: row.id,
        memberId: row.memberId,
        kind: row.kind === 'utilities' ? 'utilities' : 'rent',
        amountMinor: row.amountMinor,
        currency: toCurrencyCode(row.currency),
        recordedAt: instantFromDatabaseValue(row.recordedAt)!
      }
    },

    async deletePaymentRecord(paymentId) {
      const rows = await db
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
      const rows = await db
        .select({
          id: schema.utilityBills.id,
          billName: schema.utilityBills.billName,
          amountMinor: schema.utilityBills.amountMinor,
          currency: schema.utilityBills.currency,
          createdByMemberId: schema.utilityBills.createdByMemberId,
          createdAt: schema.utilityBills.createdAt
        })
        .from(schema.utilityBills)
        .where(eq(schema.utilityBills.cycleId, cycleId))
        .orderBy(schema.utilityBills.createdAt)

      return rows.map((row) => ({
        ...row,
        currency: toCurrencyCode(row.currency),
        createdAt: instantFromDatabaseValue(row.createdAt)!
      }))
    },

    async listPaymentRecordsForCycle(cycleId) {
      const rows = await db
        .select({
          id: schema.paymentRecords.id,
          memberId: schema.paymentRecords.memberId,
          kind: schema.paymentRecords.kind,
          amountMinor: schema.paymentRecords.amountMinor,
          currency: schema.paymentRecords.currency,
          recordedAt: schema.paymentRecords.recordedAt
        })
        .from(schema.paymentRecords)
        .where(eq(schema.paymentRecords.cycleId, cycleId))
        .orderBy(schema.paymentRecords.recordedAt)

      return rows.map((row) => ({
        id: row.id,
        memberId: row.memberId,
        kind: row.kind === 'utilities' ? 'utilities' : 'rent',
        amountMinor: row.amountMinor,
        currency: toCurrencyCode(row.currency),
        recordedAt: instantFromDatabaseValue(row.recordedAt)!
      }))
    },

    async listParsedPurchasesForRange(start, end) {
      const rows = await db
        .select({
          id: schema.purchaseMessages.id,
          payerMemberId: schema.purchaseMessages.senderMemberId,
          amountMinor: schema.purchaseMessages.parsedAmountMinor,
          currency: schema.purchaseMessages.parsedCurrency,
          description: schema.purchaseMessages.parsedItemDescription,
          occurredAt: schema.purchaseMessages.messageSentAt,
          splitMode: schema.purchaseMessages.participantSplitMode
        })
        .from(schema.purchaseMessages)
        .where(
          and(
            eq(schema.purchaseMessages.householdId, householdId),
            isNotNull(schema.purchaseMessages.senderMemberId),
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
        payerMemberId: row.payerMemberId!,
        amountMinor: row.amountMinor!,
        currency: toCurrencyCode(row.currency!),
        description: row.description,
        occurredAt: instantFromDatabaseValue(row.occurredAt),
        splitMode: row.splitMode === 'custom_amounts' ? 'custom_amounts' : 'equal',
        participants: participantsByPurchaseId.get(row.id) ?? []
      }))
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

    async savePaymentConfirmation(input) {
      return db.transaction(async (tx) => {
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
              schema.paymentConfirmations.telegramMessageId
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

        const insertedPayment = await tx
          .insert(schema.paymentRecords)
          .values({
            householdId,
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
            recordedAt: schema.paymentRecords.recordedAt
          })

        const paymentRow = insertedPayment[0]
        if (!paymentRow) {
          throw new Error('Failed to persist payment record')
        }

        return {
          status: 'recorded' as const,
          paymentRecord: {
            id: paymentRow.id,
            memberId: paymentRow.memberId,
            kind: paymentRow.kind === 'utilities' ? 'utilities' : 'rent',
            amountMinor: paymentRow.amountMinor,
            currency: toCurrencyCode(paymentRow.currency),
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
    close: async () => {
      await queryClient.end({ timeout: 5 })
    }
  }
}
