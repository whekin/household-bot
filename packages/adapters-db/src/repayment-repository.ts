import { and, eq } from 'drizzle-orm'
import { createDbClient, schema } from '@household/db'
import type { MemberRepayment, RepaymentRepository } from '@household/ports'

type Db = ReturnType<typeof createDbClient>['db']
function map(row: typeof schema.memberRepayments.$inferSelect): MemberRepayment {
  return {
    ...row,
    kind: row.kind as MemberRepayment['kind'],
    status: row.status as MemberRepayment['status'],
    currency: row.currency as MemberRepayment['currency'],
    createdAt: row.createdAt.toISOString()
  }
}
export function createRepaymentRepository(db: Db, householdId: string): RepaymentRepository {
  const table = schema.memberRepayments
  return {
    async listRepayments() {
      return (
        await db
          .select()
          .from(table)
          .where(eq(table.householdId, householdId))
          .orderBy(table.createdAt, table.id)
      ).map(map)
    },
    async addRepayment(input) {
      const inserted = await db
        .insert(table)
        .values({ ...input, householdId })
        .onConflictDoNothing()
        .returning()
      if (inserted[0]) return map(inserted[0])
      const [existing] = await db
        .select()
        .from(table)
        .where(and(eq(table.id, input.id), eq(table.householdId, householdId)))
      if (!existing) throw new Error('Repayment identifier already used')
      const record = map(existing)
      for (const key of [
        'kind',
        'fromMemberId',
        'toMemberId',
        'amountMinor',
        'currency',
        'occurredOn',
        'requestId'
      ] as const) {
        if (record[key] !== input[key])
          throw new Error('Repayment identifier already used for different details')
      }
      return record
    },
    async transitionRepayment(id, expected, next) {
      const rows = await db
        .update(table)
        .set({ status: next })
        .where(
          and(eq(table.householdId, householdId), eq(table.id, id), eq(table.status, expected))
        )
        .returning({ id: table.id })
      return rows.length === 1
    }
  }
}
