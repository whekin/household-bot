import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, test } from 'bun:test'
import { eq, inArray } from 'drizzle-orm'

import { createDbClient, schema } from '@household/db'

import { createDbHouseholdConfigurationRepository } from './household-config-repository'

const databaseUrl = process.env.DATABASE_URL
const testIfDatabase = databaseUrl ? test : test.skip

describe('createDbHouseholdConfigurationRepository', () => {
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

  testIfDatabase('registers a Telegram household chat and binds topics', async () => {
    const repositoryClient = createDbHouseholdConfigurationRepository(databaseUrl!)
    const suffix = randomUUID()
    const telegramChatId = `-100${Date.now()}`

    const registered = await repositoryClient.repository.registerTelegramHouseholdChat({
      householdName: `Integration Household ${suffix}`,
      telegramChatId,
      telegramChatType: 'supergroup',
      title: 'Integration Household'
    })

    createdHouseholdIds.push(registered.household.householdId)

    expect(registered.status).toBe('created')
    expect(registered.household.telegramChatId).toBe(telegramChatId)

    const existing = await repositoryClient.repository.registerTelegramHouseholdChat({
      householdName: 'Ignored replacement title',
      telegramChatId,
      telegramChatType: 'supergroup',
      title: 'Updated Integration Household'
    })

    expect(existing.status).toBe('existing')
    expect(existing.household.householdId).toBe(registered.household.householdId)
    expect(existing.household.title).toBe('Updated Integration Household')

    const purchase = await repositoryClient.repository.bindHouseholdTopic({
      householdId: registered.household.householdId,
      role: 'purchase',
      telegramThreadId: '7001',
      topicName: 'Общие покупки'
    })

    const feedback = await repositoryClient.repository.bindHouseholdTopic({
      householdId: registered.household.householdId,
      role: 'feedback',
      telegramThreadId: '7002',
      topicName: 'Feedback'
    })

    expect(purchase.role).toBe('purchase')
    expect(feedback.role).toBe('feedback')

    const resolvedChat = await repositoryClient.repository.getTelegramHouseholdChat(telegramChatId)
    const resolvedPurchase = await repositoryClient.repository.findHouseholdTopicByTelegramContext({
      telegramChatId,
      telegramThreadId: '7001'
    })
    const bindings = await repositoryClient.repository.listHouseholdTopicBindings(
      registered.household.householdId
    )

    expect(resolvedChat?.householdId).toBe(registered.household.householdId)
    expect(resolvedPurchase?.role).toBe('purchase')
    expect(bindings).toHaveLength(2)

    const verificationClient = createDbClient(databaseUrl!, {
      max: 1,
      prepare: false
    })
    const storedChatRows = await verificationClient.db
      .select({ title: schema.householdTelegramChats.title })
      .from(schema.householdTelegramChats)
      .where(eq(schema.householdTelegramChats.telegramChatId, telegramChatId))
      .limit(1)

    expect(storedChatRows[0]?.title).toBe('Updated Integration Household')

    await verificationClient.queryClient.end({ timeout: 5 })
    await repositoryClient.close()
  })
})
