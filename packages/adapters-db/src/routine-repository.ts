import { and, eq } from 'drizzle-orm'
import { createDbClient, schema } from '@household/db'
import type { RoutineDocument, RoutineRepository } from '@household/ports'

export function createDbRoutineRepository(databaseUrl: string): {
  repository: RoutineRepository
  close: () => Promise<void>
} {
  const { db, close } = createDbClient(databaseUrl)
  const table = schema.householdRoutines
  return {
    close,
    repository: {
      async list(householdId) {
        const rows = await db
          .select()
          .from(table)
          .where(householdId ? eq(table.householdId, householdId) : undefined)
        return rows.map((row) => row.document as RoutineDocument)
      },
      async get(id) {
        const [row] = await db.select().from(table).where(eq(table.id, id))
        return row ? (row.document as RoutineDocument) : null
      },
      async create(document) {
        await db
          .insert(table)
          .values({ id: document.id, householdId: document.householdId, document })
          .onConflictDoNothing()
        const [row] = await db
          .select()
          .from(table)
          .where(and(eq(table.id, document.id), eq(table.householdId, document.householdId)))
        if (!row) throw new Error('Routine ID collision')
        return row.document as RoutineDocument
      },
      async change(id, householdId, change) {
        return db.transaction(async (tx) => {
          const [row] = await tx
            .select()
            .from(table)
            .where(and(eq(table.id, id), eq(table.householdId, householdId)))
            .for('update')
          if (!row) throw new Error('Routine not found')
          const document = row.document as RoutineDocument
          change(document)
          await tx.update(table).set({ document, updatedAt: new Date() }).where(eq(table.id, id))
          return document
        })
      }
    }
  }
}
