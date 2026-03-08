import { and, eq } from 'drizzle-orm'
import { createDbClient } from './client'
import {
  billingCycles,
  householdTelegramChats,
  householdTopicBindings,
  households,
  members,
  presenceOverrides,
  processedBotMessages,
  purchaseEntries,
  rentRules,
  settlementLines,
  settlements,
  utilityBills
} from './schema'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required for db seed')
}

const { db, queryClient } = createDbClient(databaseUrl, {
  max: 2,
  prepare: false
})

const FIXTURE_IDS = {
  household: '11111111-1111-4111-8111-111111111111',
  cycle: '22222222-2222-4222-8222-222222222222',
  memberAlice: '33333333-3333-4333-8333-333333333331',
  memberBob: '33333333-3333-4333-8333-333333333332',
  memberCarol: '33333333-3333-4333-8333-333333333333',
  settlement: '44444444-4444-4444-8444-444444444444'
} as const

async function seed(): Promise<void> {
  await db
    .insert(households)
    .values({
      id: FIXTURE_IDS.household,
      name: 'Kojori Demo Household'
    })
    .onConflictDoNothing()

  await db
    .insert(members)
    .values([
      {
        id: FIXTURE_IDS.memberAlice,
        householdId: FIXTURE_IDS.household,
        telegramUserId: '10001',
        displayName: 'Alice',
        isAdmin: 1
      },
      {
        id: FIXTURE_IDS.memberBob,
        householdId: FIXTURE_IDS.household,
        telegramUserId: '10002',
        displayName: 'Bob',
        isAdmin: 0
      },
      {
        id: FIXTURE_IDS.memberCarol,
        householdId: FIXTURE_IDS.household,
        telegramUserId: '10003',
        displayName: 'Carol',
        isAdmin: 0
      }
    ])
    .onConflictDoNothing()

  await db
    .insert(householdTelegramChats)
    .values({
      householdId: FIXTURE_IDS.household,
      telegramChatId: '-1001234567890',
      telegramChatType: 'supergroup',
      title: 'Kojori Demo Household'
    })
    .onConflictDoNothing()

  await db
    .insert(householdTopicBindings)
    .values([
      {
        householdId: FIXTURE_IDS.household,
        role: 'purchase',
        telegramThreadId: '777',
        topicName: 'Общие покупки'
      },
      {
        householdId: FIXTURE_IDS.household,
        role: 'feedback',
        telegramThreadId: '778',
        topicName: 'Anonymous feedback'
      }
    ])
    .onConflictDoNothing()

  await db
    .insert(billingCycles)
    .values({
      id: FIXTURE_IDS.cycle,
      householdId: FIXTURE_IDS.household,
      period: '2026-03',
      currency: 'USD'
    })
    .onConflictDoNothing()

  await db
    .insert(rentRules)
    .values({
      householdId: FIXTURE_IDS.household,
      amountMinor: 70000n,
      currency: 'USD',
      effectiveFromPeriod: '2026-03'
    })
    .onConflictDoNothing()

  await db
    .insert(utilityBills)
    .values({
      householdId: FIXTURE_IDS.household,
      cycleId: FIXTURE_IDS.cycle,
      billName: 'Electricity',
      amountMinor: 12000n,
      currency: 'USD',
      source: 'manual',
      createdByMemberId: FIXTURE_IDS.memberAlice
    })
    .onConflictDoNothing()

  await db
    .insert(presenceOverrides)
    .values([
      {
        cycleId: FIXTURE_IDS.cycle,
        memberId: FIXTURE_IDS.memberAlice,
        utilityDays: 31,
        reason: 'full month'
      },
      {
        cycleId: FIXTURE_IDS.cycle,
        memberId: FIXTURE_IDS.memberBob,
        utilityDays: 31,
        reason: 'full month'
      },
      {
        cycleId: FIXTURE_IDS.cycle,
        memberId: FIXTURE_IDS.memberCarol,
        utilityDays: 20,
        reason: 'partial month'
      }
    ])
    .onConflictDoNothing()

  await db
    .insert(purchaseEntries)
    .values({
      householdId: FIXTURE_IDS.household,
      cycleId: FIXTURE_IDS.cycle,
      payerMemberId: FIXTURE_IDS.memberAlice,
      amountMinor: 3000n,
      currency: 'USD',
      rawText: 'Bought toilet paper 30 gel',
      normalizedText: 'bought toilet paper 30 gel',
      parserMode: 'rules',
      parserConfidence: 93,
      telegramChatId: '-100householdchat',
      telegramMessageId: '501',
      telegramThreadId: 'general-buys'
    })
    .onConflictDoNothing()

  await db
    .insert(processedBotMessages)
    .values({
      householdId: FIXTURE_IDS.household,
      source: 'telegram',
      sourceMessageKey: 'chat:-100householdchat:message:501',
      payloadHash: 'demo-hash'
    })
    .onConflictDoNothing()

  await db
    .insert(settlements)
    .values({
      id: FIXTURE_IDS.settlement,
      householdId: FIXTURE_IDS.household,
      cycleId: FIXTURE_IDS.cycle,
      inputHash: 'demo-settlement-hash',
      totalDueMinor: 82000n,
      currency: 'USD'
    })
    .onConflictDoNothing()

  await db
    .insert(settlementLines)
    .values([
      {
        settlementId: FIXTURE_IDS.settlement,
        memberId: FIXTURE_IDS.memberAlice,
        rentShareMinor: 23334n,
        utilityShareMinor: 4000n,
        purchaseOffsetMinor: -2000n,
        netDueMinor: 25334n,
        explanations: ['rent_share_minor=23334', 'utility_share_minor=4000']
      },
      {
        settlementId: FIXTURE_IDS.settlement,
        memberId: FIXTURE_IDS.memberBob,
        rentShareMinor: 23333n,
        utilityShareMinor: 4000n,
        purchaseOffsetMinor: 1000n,
        netDueMinor: 28333n,
        explanations: ['rent_share_minor=23333', 'utility_share_minor=4000']
      },
      {
        settlementId: FIXTURE_IDS.settlement,
        memberId: FIXTURE_IDS.memberCarol,
        rentShareMinor: 23333n,
        utilityShareMinor: 4000n,
        purchaseOffsetMinor: 1000n,
        netDueMinor: 28333n,
        explanations: ['rent_share_minor=23333', 'utility_share_minor=4000']
      }
    ])
    .onConflictDoNothing()

  const seededCycle = await db
    .select({ period: billingCycles.period, currency: billingCycles.currency })
    .from(billingCycles)
    .where(
      and(
        eq(billingCycles.id, FIXTURE_IDS.cycle),
        eq(billingCycles.householdId, FIXTURE_IDS.household)
      )
    )
    .limit(1)

  if (seededCycle.length === 0) {
    throw new Error('Seed verification failed: billing cycle not found')
  }

  const seededChat = await db
    .select({ telegramChatId: householdTelegramChats.telegramChatId })
    .from(householdTelegramChats)
    .where(eq(householdTelegramChats.householdId, FIXTURE_IDS.household))
    .limit(1)

  if (seededChat.length === 0) {
    throw new Error('Seed verification failed: Telegram household chat not found')
  }
}

try {
  await seed()
  console.log('Seed completed')
} finally {
  await queryClient.end({ timeout: 5 })
}
