import { expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { createDbClient, schema } from '@household/db'
import { createRoutineService } from '@household/application'
import { routineActor, routineInput } from '@household/application/testing/routines'
import { createDbRoutineRepository } from './routine-repository'

// Deliberately separate from DATABASE_URL: this suite must target a disposable database.
const databaseUrl = process.env.ROUTINE_TEST_DATABASE_URL
const integration = databaseUrl ? test : test.skip
integration(
  'PostgreSQL serializes concurrent actions, rolls back failures and persists delivery intent',
  async () => {
    const client = createDbClient(databaseUrl!)
    const adapter = createDbRoutineRepository(databaseUrl!)
    const householdId = crypto.randomUUID()
    const actor = { ...routineActor, householdId }
    const id = crypto.randomUUID().replaceAll('-', '').slice(0, 16)
    try {
      await client.db
        .insert(schema.households)
        .values({ id: householdId, name: 'Routine integration test' })
      const service = createRoutineService(adapter.repository, () => '2026-09-10T04:00:00Z')
      const doc = await service.save(actor, { ...routineInput, id })
      const input = {
        id,
        rowId: doc.days[0]!.rows[0]!.id,
        version: 0,
        action: 'complete' as const,
        requestId: 'same-webhook'
      }
      const retries = await Promise.all([service.act(actor, input), service.act(actor, input)])
      expect(retries.map((d) => d.days[0]!.rows[0]!.version)).toEqual([1, 1])
      const race = await Promise.allSettled([
        service.act(actor, { ...input, version: 1, action: 'reopen', requestId: 'undo-a' }),
        service.act(
          { ...actor, id: 'sam' },
          { ...input, version: 1, action: 'reopen', requestId: 'undo-b' }
        )
      ])
      expect(race.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      expect((await adapter.repository.get(id))?.days[0]!.rows[0]!.version).toBe(2)
      await expect(
        adapter.repository.change(id, householdId, (d) => {
          d.paused = true
          throw new Error('rollback')
        })
      ).rejects.toThrow('rollback')
      expect((await adapter.repository.get(id))?.paused).toBe(false)
      await expect(adapter.repository.change(id, crypto.randomUUID(), () => {})).rejects.toThrow(
        'not found'
      )
      await adapter.repository.change(id, householdId, (d) => {
        d.messages.push({
          key: 'outbox',
          date: '2026-09-10',
          chatId: '100',
          threadId: null,
          rowId: null,
          messageId: null,
          status: 'unknown',
          fingerprint: '',
          error: null,
          retryAt: null
        })
      })
      const reopened = createDbRoutineRepository(databaseUrl!)
      expect((await reopened.repository.get(id))?.messages[0]?.status).toBe('unknown')
      await reopened.close()
    } finally {
      await client.db.delete(schema.households).where(eq(schema.households.id, householdId))
      await adapter.close()
      await client.close()
    }
  }
)
