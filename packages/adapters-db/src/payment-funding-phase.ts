import { and, eq, sql } from 'drizzle-orm'
import { createDbClient, schema } from '@household/db'

export type FinanceTransaction = Parameters<
  Parameters<ReturnType<typeof createDbClient>['db']['transaction']>[0]
>[0]

/** The cycle lock assigns receipt order independently of user-reported dates. */
export async function nextPaymentFundingPhase(
  tx: FinanceTransaction,
  householdId: string,
  cycleId: string
): Promise<bigint> {
  const [cycle] = await tx
    .select({ id: schema.billingCycles.id })
    .from(schema.billingCycles)
    .where(
      and(eq(schema.billingCycles.householdId, householdId), eq(schema.billingCycles.id, cycleId))
    )
    .for('update')
  if (!cycle) throw new Error('Payment cycle is unavailable')
  const [row] = await tx
    .select({ phase: sql<string>`coalesce(max(${schema.paymentRecords.fundingPhase}), 0)::text` })
    .from(schema.paymentRecords)
    .where(eq(schema.paymentRecords.cycleId, cycleId))
  return BigInt(row!.phase) + 1n
}
