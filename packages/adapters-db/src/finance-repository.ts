import { and, desc, eq, gte, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm'

import { createDbClient, schema } from '@household/db'
import type { FinanceRepository } from '@household/ports'
import {
  instantFromDatabaseValue,
  instantToDate,
  nowInstant,
  type CurrencyCode
} from '@household/domain'

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

  const repository: FinanceRepository = {
    async getMemberByTelegramUserId(telegramUserId) {
      const rows = await db
        .select({
          id: schema.members.id,
          telegramUserId: schema.members.telegramUserId,
          displayName: schema.members.displayName,
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

    async listParsedPurchasesForRange(start, end) {
      const rows = await db
        .select({
          id: schema.purchaseMessages.id,
          payerMemberId: schema.purchaseMessages.senderMemberId,
          amountMinor: schema.purchaseMessages.parsedAmountMinor,
          description: schema.purchaseMessages.parsedItemDescription,
          occurredAt: schema.purchaseMessages.messageSentAt
        })
        .from(schema.purchaseMessages)
        .where(
          and(
            eq(schema.purchaseMessages.householdId, householdId),
            isNotNull(schema.purchaseMessages.senderMemberId),
            isNotNull(schema.purchaseMessages.parsedAmountMinor),
            gte(schema.purchaseMessages.messageSentAt, instantToDate(start)),
            lt(schema.purchaseMessages.messageSentAt, instantToDate(end))
          )
        )

      return rows.map((row) => ({
        id: row.id,
        payerMemberId: row.payerMemberId!,
        amountMinor: row.amountMinor!,
        description: row.description,
        occurredAt: instantFromDatabaseValue(row.occurredAt)
      }))
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
