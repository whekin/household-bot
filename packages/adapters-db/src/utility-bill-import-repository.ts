import { createHash } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'

import { schema, type createDbClient } from '@household/db'
import type { UtilityBillImportRepository, UtilityBillImportSnapshot } from '@household/ports'

export function createUtilityBillImportRepository(
  db: ReturnType<typeof createDbClient>['db'],
  householdId: string
): UtilityBillImportRepository {
  async function snapshot(
    reader: Pick<ReturnType<typeof createDbClient>['db'], 'select'>,
    period: string
  ): Promise<UtilityBillImportSnapshot> {
    const [cycle] = await reader
      .select()
      .from(schema.billingCycles)
      .where(
        and(
          eq(schema.billingCycles.householdId, householdId),
          eq(schema.billingCycles.period, period)
        )
      )
    const categories = await reader
      .select()
      .from(schema.householdUtilityCategories)
      .where(eq(schema.householdUtilityCategories.householdId, householdId))
    const bills = cycle
      ? await reader
          .select()
          .from(schema.utilityBills)
          .where(
            and(
              eq(schema.utilityBills.householdId, householdId),
              eq(schema.utilityBills.cycleId, cycle.id)
            )
          )
      : []
    const payments = cycle
      ? await reader
          .select()
          .from(schema.paymentRecords)
          .where(
            and(
              eq(schema.paymentRecords.householdId, householdId),
              eq(schema.paymentRecords.cycleId, cycle.id),
              eq(schema.paymentRecords.kind, 'utilities')
            )
          )
      : []
    const facts = cycle
      ? await reader
          .select()
          .from(schema.utilityVendorPaymentFacts)
          .where(
            and(
              eq(schema.utilityVendorPaymentFacts.householdId, householdId),
              eq(schema.utilityVendorPaymentFacts.cycleId, cycle.id)
            )
          )
      : []
    const plans = cycle
      ? await reader
          .select({ id: schema.utilityBillingPlans.id, status: schema.utilityBillingPlans.status })
          .from(schema.utilityBillingPlans)
          .where(
            and(
              eq(schema.utilityBillingPlans.householdId, householdId),
              eq(schema.utilityBillingPlans.cycleId, cycle.id),
              inArray(schema.utilityBillingPlans.status, ['active', 'settled'])
            )
          )
      : []
    const closed = Boolean(cycle?.closedAt)
    const paidByBillId: Record<string, string> = {}
    for (const fact of facts) {
      const billId =
        fact.utilityBillId ??
        bills.find(
          (bill) => bill.billName.trim().toLowerCase() === fact.billName.trim().toLowerCase()
        )?.id
      if (billId && fact.currency === 'GEL')
        paidByBillId[billId] = (BigInt(paidByBillId[billId] ?? '0') + fact.amountMinor).toString()
    }
    const sorted = <T extends { id: string }>(rows: T[]) =>
      rows.toSorted((a, b) => a.id.localeCompare(b.id))
    const revision = createHash('sha256')
      .update(
        JSON.stringify({
          closed,
          bills: sorted(bills).map((row) => [
            row.id,
            row.billName,
            row.amountMinor.toString(),
            row.currency
          ]),
          payments: sorted(payments).map((row) => [
            row.id,
            row.amountMinor.toString(),
            row.currency
          ]),
          facts: sorted(facts).map((row) => [row.id, row.amountMinor.toString(), row.currency]),
          plans: sorted(plans),
          categories: sorted(categories).map((row) => [
            row.id,
            row.name,
            row.slug,
            row.isActive,
            row.providerName,
            row.customerNumber
          ])
        })
      )
      .digest('hex')
    return {
      revision,
      closed,
      paidByBillId,
      categories: categories.map((row) => ({ ...row, isActive: row.isActive === 1 })),
      hasPayments:
        payments.some((row) => row.amountMinor !== 0n) ||
        facts.some((row) => row.amountMinor !== 0n),
      bills: bills.map((row) => {
        if (row.currency !== 'GEL' && row.currency !== 'USD')
          throw new Error('Invalid bill currency')
        return {
          id: row.id,
          billName: row.billName,
          amountMinor: row.amountMinor.toString(),
          currency: row.currency
        }
      })
    }
  }

  return {
    getSnapshot: (period) =>
      db.transaction((tx) => snapshot(tx, period), { isolationLevel: 'repeatable read' }),
    async apply(input) {
      try {
        return await db.transaction(
          async (tx) => {
            const reviewed = await snapshot(tx, input.period)
            if (reviewed.revision !== input.expectedRevision || reviewed.closed)
              return 'stale' as const
            const [settings] = await tx
              .select()
              .from(schema.householdBillingSettings)
              .where(eq(schema.householdBillingSettings.householdId, householdId))
            await tx
              .insert(schema.billingCycles)
              .values({
                householdId,
                period: input.period,
                currency: settings?.settlementCurrency ?? 'GEL'
              })
              .onConflictDoNothing()
            const [cycle] = await tx
              .select()
              .from(schema.billingCycles)
              .where(
                and(
                  eq(schema.billingCycles.householdId, householdId),
                  eq(schema.billingCycles.period, input.period)
                )
              )
              .for('update')
            if (!cycle) throw new Error('Missing import cycle')
            const current = await snapshot(tx, input.period)
            if (current.revision !== input.expectedRevision || current.closed)
              return 'stale' as const
            if (
              current.hasPayments &&
              input.changes.some(
                (change) =>
                  change.billId &&
                  BigInt(
                    current.bills.find((bill) => bill.id === change.billId)?.amountMinor ?? '0'
                  ) > 0n
              )
            )
              return 'stale' as const
            for (const change of input.changes) {
              if (change.billId) {
                await tx
                  .update(schema.utilityBills)
                  .set({
                    amountMinor: BigInt(change.amountMinor),
                    currency: 'GEL',
                    source: 'bank_screenshot'
                  })
                  .where(
                    and(
                      eq(schema.utilityBills.householdId, householdId),
                      eq(schema.utilityBills.cycleId, cycle.id),
                      eq(schema.utilityBills.id, change.billId)
                    )
                  )
              } else {
                await tx.insert(schema.utilityBills).values({
                  householdId,
                  cycleId: cycle.id,
                  billName: change.billName,
                  amountMinor: BigInt(change.amountMinor),
                  currency: 'GEL',
                  source: 'bank_screenshot',
                  createdByMemberId: input.createdByMemberId
                })
              }
            }
            if (!current.hasPayments)
              await tx
                .update(schema.utilityBillingPlans)
                .set({ status: 'superseded' })
                .where(
                  and(
                    eq(schema.utilityBillingPlans.householdId, householdId),
                    eq(schema.utilityBillingPlans.cycleId, cycle.id),
                    inArray(schema.utilityBillingPlans.status, ['active', 'settled'])
                  )
                )
            return 'applied' as const
          },
          { isolationLevel: 'serializable' }
        )
      } catch (error) {
        const cause = error && typeof error === 'object' && 'cause' in error ? error.cause : error
        if (cause && typeof cause === 'object' && 'code' in cause && cause.code === '40001')
          return 'stale'
        throw error
      }
    }
  }
}
