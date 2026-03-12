import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, test } from 'bun:test'
import { inArray } from 'drizzle-orm'

import { instantFromIso } from '@household/domain'
import { createDbClient, schema } from '@household/db'

import { createDbHouseholdConfigurationRepository } from './household-config-repository'
import { createDbTopicMessageHistoryRepository } from './topic-message-history-repository'

const databaseUrl = process.env.DATABASE_URL
const testIfDatabase = databaseUrl ? test : test.skip

describe('createDbTopicMessageHistoryRepository', () => {
  const createdHouseholdIds: string[] = []

  afterAll(async () => {
    if (!databaseUrl || createdHouseholdIds.length === 0) {
      return
    }

    const { db, queryClient } = createDbClient(databaseUrl, {
      max: 1,
      prepare: false
    })

    await db.delete(schema.households).where(inArray(schema.households.id, createdHouseholdIds))
    await queryClient.end({ timeout: 5 })
  })

  testIfDatabase('lists the latest same-day chat messages in chronological order', async () => {
    const householdClient = createDbHouseholdConfigurationRepository(databaseUrl!)
    const historyClient = createDbTopicMessageHistoryRepository(databaseUrl!)
    const telegramChatId = `-100${Date.now()}`
    const registered = await householdClient.repository.registerTelegramHouseholdChat({
      householdName: `History Household ${randomUUID()}`,
      telegramChatId,
      telegramChatType: 'supergroup',
      title: 'History Household'
    })

    createdHouseholdIds.push(registered.household.householdId)

    const baseMessage = {
      householdId: registered.household.householdId,
      telegramChatId,
      telegramThreadId: '777',
      senderTelegramUserId: '10002',
      senderDisplayName: 'Mia',
      isBot: false
    } as const

    await historyClient.repository.saveMessage({
      ...baseMessage,
      telegramMessageId: 'msg-1',
      telegramUpdateId: 'upd-1',
      rawText: '08:00',
      messageSentAt: instantFromIso('2026-03-05T08:00:00.000Z')
    })
    await historyClient.repository.saveMessage({
      ...baseMessage,
      telegramMessageId: 'msg-2',
      telegramUpdateId: 'upd-2',
      rawText: '10:00',
      messageSentAt: instantFromIso('2026-03-05T10:00:00.000Z')
    })
    await historyClient.repository.saveMessage({
      ...baseMessage,
      telegramMessageId: 'msg-3',
      telegramUpdateId: 'upd-3',
      rawText: '11:00',
      messageSentAt: instantFromIso('2026-03-05T11:00:00.000Z')
    })
    await historyClient.repository.saveMessage({
      ...baseMessage,
      telegramMessageId: 'msg-4',
      telegramUpdateId: 'upd-4',
      rawText: '12:00',
      messageSentAt: instantFromIso('2026-03-05T12:00:00.000Z')
    })

    const rows = await historyClient.repository.listRecentChatMessages({
      householdId: registered.household.householdId,
      telegramChatId,
      sentAtOrAfter: instantFromIso('2026-03-05T00:00:00.000Z'),
      limit: 2
    })

    expect(rows.map((row) => row.rawText)).toEqual(['11:00', '12:00'])

    await householdClient.close()
    await historyClient.close()
  })
})
