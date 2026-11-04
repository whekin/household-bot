import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, test } from 'bun:test'
import { eq, inArray } from 'drizzle-orm'

import { createDbClient, schema } from '@household/db'
import { instantFromIso } from '@household/domain'

import { createPurchaseMessageRepository } from './purchase-message-repository'

const databaseUrl = process.env.DATABASE_URL
const runDbIntegration =
  process.env.RUN_DB_INTEGRATION_TESTS === '1' || process.env.RUN_DB_INTEGRATION_TESTS === 'true'
const testIfDatabase = databaseUrl && runDbIntegration ? test : test.skip

describe('createPurchaseMessageRepository auto-confirm', () => {
  const createdHouseholdIds: string[] = []

  afterAll(async () => {
    if (!databaseUrl || createdHouseholdIds.length === 0) {
      return
    }

    const { db, close } = createDbClient(databaseUrl)
    await db.delete(schema.households).where(inArray(schema.households.id, createdHouseholdIds))
    await close()
  })

  testIfDatabase(
    'confirms only unanswered proposals the bot posted a message for, within the window',
    async () => {
      const { db, close } = createDbClient(databaseUrl!)
      const [household] = await db
        .insert(schema.households)
        .values({ name: `Auto confirm ${randomUUID()}` })
        .returning({ id: schema.households.id })
      const householdId = household!.id
      createdHouseholdIds.push(householdId)

      const [payer, other] = await db
        .insert(schema.members)
        .values([
          { householdId, telegramUserId: `p-${randomUUID()}`, displayName: 'Стас' },
          { householdId, telegramUserId: `o-${randomUUID()}`, displayName: 'Ион' }
        ])
        .returning({ id: schema.members.id })

      const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000)
      async function proposal(input: { ingestedAt: Date; withMessage: boolean; label: string }) {
        const [row] = await db
          .insert(schema.purchaseMessages)
          .values({
            householdId,
            senderMemberId: payer!.id,
            payerMemberId: payer!.id,
            senderTelegramUserId: 'sender',
            rawText: input.label,
            telegramChatId: 'chat',
            telegramMessageId: randomUUID(),
            telegramThreadId: 'thread',
            telegramUpdateId: randomUUID(),
            parsedAmountMinor: 1700n,
            parsedCurrency: 'GEL',
            parsedItemDescription: input.label,
            processingStatus: 'pending_confirmation',
            ingestedAt: input.ingestedAt
          })
          .returning({ id: schema.purchaseMessages.id })
        await db.insert(schema.purchaseMessageParticipants).values([
          { purchaseMessageId: row!.id, memberId: payer!.id, included: 1 },
          { purchaseMessageId: row!.id, memberId: other!.id, included: 1 }
        ])
        if (input.withMessage) {
          await db.insert(schema.purchaseTopicMessages).values({
            purchaseMessageId: row!.id,
            householdId,
            telegramChatId: 'chat',
            telegramThreadId: 'thread',
            telegramMessageId: randomUUID()
          })
        }
        return row!.id
      }

      const due = await proposal({ ingestedAt: hoursAgo(30), withMessage: true, label: 'due' })
      const fresh = await proposal({ ingestedAt: hoursAgo(2), withMessage: true, label: 'fresh' })
      const unrecorded = await proposal({
        ingestedAt: hoursAgo(30),
        withMessage: false,
        label: 'no message'
      })
      const ancient = await proposal({
        ingestedAt: hoursAgo(24 * 20),
        withMessage: true,
        label: 'ancient'
      })

      const client = createPurchaseMessageRepository(databaseUrl!)
      const now = instantFromIso(new Date().toISOString())
      const confirmed = await client.autoConfirm.autoConfirmStale({
        olderThan: now.subtract({ hours: 24 }),
        notOlderThan: now.subtract({ hours: 24 * 7 })
      })

      expect(confirmed.map((purchase) => purchase.purchaseMessageId)).toEqual([due])
      expect(confirmed[0]).toMatchObject({
        status: 'confirmed',
        householdId,
        payerMemberId: payer!.id,
        payerDisplayName: 'Стас',
        parsedAmountMinor: 1700n
      })

      const statuses = await db
        .select({
          id: schema.purchaseMessages.id,
          status: schema.purchaseMessages.processingStatus,
          needsReview: schema.purchaseMessages.needsReview
        })
        .from(schema.purchaseMessages)
        .where(eq(schema.purchaseMessages.householdId, householdId))
      const statusOf = (id: string) => statuses.find((row) => row.id === id)
      expect(statusOf(due)).toMatchObject({ status: 'confirmed', needsReview: 0 })
      expect(statusOf(fresh)?.status).toBe('pending_confirmation')
      expect(statusOf(unrecorded)?.status).toBe('pending_confirmation')
      expect(statusOf(ancient)?.status).toBe('pending_confirmation')

      // A second sweep finds nothing left to confirm.
      await expect(
        client.autoConfirm.autoConfirmStale({
          olderThan: now.subtract({ hours: 24 }),
          notOlderThan: now.subtract({ hours: 24 * 7 })
        })
      ).resolves.toEqual([])

      await client.close()
      await close()
    }
  )

  testIfDatabase('remembers where a proposal was posted, once', async () => {
    const { db, close } = createDbClient(databaseUrl!)
    const [household] = await db
      .insert(schema.households)
      .values({ name: `Proposal message ${randomUUID()}` })
      .returning({ id: schema.households.id })
    const householdId = household!.id
    createdHouseholdIds.push(householdId)
    const [row] = await db
      .insert(schema.purchaseMessages)
      .values({
        householdId,
        senderTelegramUserId: 'sender',
        rawText: 'x',
        telegramChatId: 'chat',
        telegramMessageId: randomUUID(),
        telegramThreadId: 'thread',
        telegramUpdateId: randomUUID()
      })
      .returning({ id: schema.purchaseMessages.id })

    const client = createPurchaseMessageRepository(databaseUrl!)
    const message = {
      householdId,
      telegramChatId: 'chat',
      telegramThreadId: 'thread',
      telegramMessageId: '501'
    }
    await client.repository.recordProposalMessage!(row!.id, message)
    await client.repository.recordProposalMessage!(row!.id, {
      ...message,
      telegramMessageId: '999'
    })

    const stored = await db
      .select()
      .from(schema.purchaseTopicMessages)
      .where(eq(schema.purchaseTopicMessages.purchaseMessageId, row!.id))
    expect(stored).toHaveLength(1)
    expect(stored[0]?.telegramMessageId).toBe('501')

    await client.close()
    await close()
  })
})
