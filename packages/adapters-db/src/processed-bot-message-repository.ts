import { and, eq } from 'drizzle-orm'

import { createDbClient, schema } from '@household/db'
import type { ProcessedBotMessageRepository } from '@household/ports'

export function createDbProcessedBotMessageRepository(databaseUrl: string): {
  repository: ProcessedBotMessageRepository
  close: () => Promise<void>
} {
  const { db, queryClient } = createDbClient(databaseUrl, {
    max: 3,
    prepare: false
  })

  const repository: ProcessedBotMessageRepository = {
    async claimMessage(input) {
      const rows = await db
        .insert(schema.processedBotMessages)
        .values({
          householdId: input.householdId,
          source: input.source,
          sourceMessageKey: input.sourceMessageKey,
          payloadHash: input.payloadHash ?? null
        })
        .onConflictDoNothing({
          target: [
            schema.processedBotMessages.householdId,
            schema.processedBotMessages.source,
            schema.processedBotMessages.sourceMessageKey
          ]
        })
        .returning({ id: schema.processedBotMessages.id })

      return {
        claimed: rows.length > 0
      }
    },

    async releaseMessage(input) {
      await db
        .delete(schema.processedBotMessages)
        .where(
          and(
            eq(schema.processedBotMessages.householdId, input.householdId),
            eq(schema.processedBotMessages.source, input.source),
            eq(schema.processedBotMessages.sourceMessageKey, input.sourceMessageKey)
          )
        )
    }
  }

  return {
    repository,
    close: async () => {
      await queryClient.end({ timeout: 5 })
    }
  }
}
