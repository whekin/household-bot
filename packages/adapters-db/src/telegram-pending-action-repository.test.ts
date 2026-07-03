import { afterAll, describe, expect, test } from 'bun:test'
import { and, eq } from 'drizzle-orm'

import { createDbClient, schema } from '@household/db'
import { nowInstant } from '@household/domain'

import { createDbTelegramPendingActionRepository } from './telegram-pending-action-repository'

const databaseUrl = process.env.DATABASE_URL
const testIfDatabase = databaseUrl ? test : test.skip

describe('createDbTelegramPendingActionRepository', () => {
  const telegramChatId = `-100${Date.now()}`
  const telegramUserId = `${Date.now()}`

  afterAll(async () => {
    if (!databaseUrl) {
      return
    }

    const { db, queryClient } = createDbClient(databaseUrl, {
      max: 1,
      prepare: false
    })

    await db
      .delete(schema.telegramPendingActions)
      .where(
        and(
          eq(schema.telegramPendingActions.telegramChatId, telegramChatId),
          eq(schema.telegramPendingActions.telegramUserId, telegramUserId)
        )
      )
    await queryClient.end({ timeout: 5 })
  })

  testIfDatabase(
    'consumes a not-yet-expired pending action by payload value',
    async () => {
      const client = createDbTelegramPendingActionRepository(databaseUrl!)

      await client.repository.upsertPendingAction({
        telegramUserId,
        telegramChatId,
        action: 'reminder_utility_entry',
        payload: { stage: 'confirm', proposalId: 'abc123' },
        expiresAt: nowInstant().add({ milliseconds: 30 * 60_000 })
      })

      // Exercises the expires_at comparison that previously bound a raw Date
      // into a sql template and crashed the postgres.js driver.
      const consumed = await client.repository.consumePendingActionByPayloadValue!(
        telegramChatId,
        telegramUserId,
        'reminder_utility_entry',
        'proposalId',
        'abc123'
      )

      expect(consumed?.action).toBe('reminder_utility_entry')
      expect(consumed?.payload.proposalId).toBe('abc123')

      // The row is gone, so a second consume returns null instead of throwing.
      const again = await client.repository.consumePendingActionByPayloadValue!(
        telegramChatId,
        telegramUserId,
        'reminder_utility_entry',
        'proposalId',
        'abc123'
      )
      expect(again).toBeNull()

      await client.close()
    },
    10000
  )
})
