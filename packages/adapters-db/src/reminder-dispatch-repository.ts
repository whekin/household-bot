import { createDbClient, schema } from '@household/db'
import type { ReminderDispatchRepository } from '@household/ports'

export function createDbReminderDispatchRepository(databaseUrl: string): {
  repository: ReminderDispatchRepository
  close: () => Promise<void>
} {
  const { db, queryClient } = createDbClient(databaseUrl, {
    max: 3,
    prepare: false
  })

  const repository: ReminderDispatchRepository = {
    async claimReminderDispatch(input) {
      const dedupeKey = `${input.period}:${input.reminderType}`
      const rows = await db
        .insert(schema.processedBotMessages)
        .values({
          householdId: input.householdId,
          source: 'scheduler-reminder',
          sourceMessageKey: dedupeKey,
          payloadHash: input.payloadHash
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
        dedupeKey,
        claimed: rows.length > 0
      }
    }
  }

  return {
    repository,
    close: async () => {
      await queryClient.end({ timeout: 5 })
    }
  }
}
