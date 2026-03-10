import { eq, inArray } from 'drizzle-orm'
import { createDbClient } from './client'
import {
  billingCycleExchangeRates,
  billingCycles,
  householdBillingSettings,
  householdTelegramChats,
  householdTopicBindings,
  householdUtilityCategories,
  households,
  members,
  paymentConfirmations,
  paymentRecords,
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

const LEGACY_FIXTURE_HOUSEHOLD_IDS = ['11111111-1111-4111-8111-111111111111'] as const

const FIXTURE_IDS = {
  household: '9f9aa111-1111-4c11-8111-111111111111',
  cycle: '9f9aa222-2222-4c22-8222-222222222222',
  memberDima: '9f9aa333-3333-4c33-8333-333333333331',
  memberStas: '9f9aa333-3333-4c33-8333-333333333332',
  memberIon: '9f9aa333-3333-4c33-8333-333333333333',
  settlement: '9f9aa444-4444-4c44-8444-444444444444',
  paymentConfirmation: '9f9aa555-5555-4c55-8555-555555555555'
} as const

async function seed(): Promise<void> {
  await db
    .delete(households)
    .where(inArray(households.id, [...LEGACY_FIXTURE_HOUSEHOLD_IDS, FIXTURE_IDS.household]))

  await db.insert(households).values({
    id: FIXTURE_IDS.household,
    name: 'Kojori Fixture Household',
    defaultLocale: 'ru'
  })

  await db.insert(householdBillingSettings).values({
    householdId: FIXTURE_IDS.household,
    settlementCurrency: 'GEL',
    rentAmountMinor: 70000n,
    rentCurrency: 'USD',
    rentDueDay: 20,
    rentWarningDay: 17,
    utilitiesDueDay: 4,
    utilitiesReminderDay: 3,
    timezone: 'Asia/Tbilisi'
  })

  await db.insert(members).values([
    {
      id: FIXTURE_IDS.memberDima,
      householdId: FIXTURE_IDS.household,
      telegramUserId: '10001',
      displayName: 'Dima',
      preferredLocale: 'ru',
      rentShareWeight: 1,
      isAdmin: 1
    },
    {
      id: FIXTURE_IDS.memberStas,
      householdId: FIXTURE_IDS.household,
      telegramUserId: '10002',
      displayName: 'Stas',
      preferredLocale: 'en',
      rentShareWeight: 1,
      isAdmin: 0
    },
    {
      id: FIXTURE_IDS.memberIon,
      householdId: FIXTURE_IDS.household,
      telegramUserId: '10003',
      displayName: 'Ion',
      preferredLocale: 'ru',
      rentShareWeight: 1,
      isAdmin: 0
    }
  ])

  await db.insert(householdTelegramChats).values({
    householdId: FIXTURE_IDS.household,
    telegramChatId: '-1003000000001',
    telegramChatType: 'supergroup',
    title: 'Kojori Fixture Household'
  })

  await db.insert(householdTopicBindings).values([
    {
      householdId: FIXTURE_IDS.household,
      role: 'purchase',
      telegramThreadId: '1001',
      topicName: 'Общие покупки'
    },
    {
      householdId: FIXTURE_IDS.household,
      role: 'feedback',
      telegramThreadId: '1002',
      topicName: 'Анонимно'
    },
    {
      householdId: FIXTURE_IDS.household,
      role: 'reminders',
      telegramThreadId: '1003',
      topicName: 'Напоминания'
    },
    {
      householdId: FIXTURE_IDS.household,
      role: 'payments',
      telegramThreadId: '1004',
      topicName: 'Быт или не быт'
    }
  ])

  await db.insert(householdUtilityCategories).values([
    {
      householdId: FIXTURE_IDS.household,
      slug: 'internet',
      name: 'Internet',
      sortOrder: 0,
      isActive: 1
    },
    {
      householdId: FIXTURE_IDS.household,
      slug: 'gas-water',
      name: 'Gas (water included)',
      sortOrder: 1,
      isActive: 1
    },
    {
      householdId: FIXTURE_IDS.household,
      slug: 'cleaning',
      name: 'Cleaning',
      sortOrder: 2,
      isActive: 1
    },
    {
      householdId: FIXTURE_IDS.household,
      slug: 'electricity',
      name: 'Electricity',
      sortOrder: 3,
      isActive: 1
    }
  ])

  await db.insert(billingCycles).values({
    id: FIXTURE_IDS.cycle,
    householdId: FIXTURE_IDS.household,
    period: '2026-03',
    currency: 'GEL'
  })

  await db.insert(rentRules).values({
    householdId: FIXTURE_IDS.household,
    amountMinor: 70000n,
    currency: 'USD',
    effectiveFromPeriod: '2026-03'
  })

  await db.insert(billingCycleExchangeRates).values({
    cycleId: FIXTURE_IDS.cycle,
    sourceCurrency: 'USD',
    targetCurrency: 'GEL',
    rateMicros: 2760000n,
    effectiveDate: '2026-03-17',
    source: 'nbg'
  })

  await db.insert(utilityBills).values([
    {
      householdId: FIXTURE_IDS.household,
      cycleId: FIXTURE_IDS.cycle,
      billName: 'Internet',
      amountMinor: 3200n,
      currency: 'GEL',
      source: 'manual',
      createdByMemberId: FIXTURE_IDS.memberDima
    },
    {
      householdId: FIXTURE_IDS.household,
      cycleId: FIXTURE_IDS.cycle,
      billName: 'Cleaning',
      amountMinor: 1000n,
      currency: 'GEL',
      source: 'manual',
      createdByMemberId: FIXTURE_IDS.memberDima
    },
    {
      householdId: FIXTURE_IDS.household,
      cycleId: FIXTURE_IDS.cycle,
      billName: 'Electricity',
      amountMinor: 4000n,
      currency: 'GEL',
      source: 'manual',
      createdByMemberId: FIXTURE_IDS.memberDima
    }
  ])

  await db.insert(presenceOverrides).values([
    {
      cycleId: FIXTURE_IDS.cycle,
      memberId: FIXTURE_IDS.memberDima,
      utilityDays: 31,
      reason: 'full month'
    },
    {
      cycleId: FIXTURE_IDS.cycle,
      memberId: FIXTURE_IDS.memberStas,
      utilityDays: 31,
      reason: 'full month'
    },
    {
      cycleId: FIXTURE_IDS.cycle,
      memberId: FIXTURE_IDS.memberIon,
      utilityDays: 31,
      reason: 'full month'
    }
  ])

  await db.insert(purchaseEntries).values({
    householdId: FIXTURE_IDS.household,
    cycleId: FIXTURE_IDS.cycle,
    payerMemberId: FIXTURE_IDS.memberDima,
    amountMinor: 3000n,
    currency: 'GEL',
    rawText: 'Купил туалетную бумагу. 30 gel',
    normalizedText: 'купил туалетную бумагу 30 gel',
    parserMode: 'rules',
    parserConfidence: 93,
    telegramChatId: '-1003000000001',
    telegramMessageId: '501',
    telegramThreadId: '1001'
  })

  await db.insert(processedBotMessages).values({
    householdId: FIXTURE_IDS.household,
    source: 'telegram',
    sourceMessageKey: 'chat:-1003000000001:message:501',
    payloadHash: 'fixture-purchase-hash'
  })

  await db.insert(settlements).values({
    id: FIXTURE_IDS.settlement,
    householdId: FIXTURE_IDS.household,
    cycleId: FIXTURE_IDS.cycle,
    inputHash: 'fixture-settlement-hash',
    totalDueMinor: 201400n,
    currency: 'GEL',
    metadata: {
      fixture: true,
      rentSourceCurrency: 'USD',
      settlementCurrency: 'GEL'
    }
  })

  await db.insert(settlementLines).values([
    {
      settlementId: FIXTURE_IDS.settlement,
      memberId: FIXTURE_IDS.memberDima,
      rentShareMinor: 64400n,
      utilityShareMinor: 2734n,
      purchaseOffsetMinor: -2000n,
      netDueMinor: 65134n,
      explanations: ['rent_share_minor=64400', 'utility_share_minor=2734']
    },
    {
      settlementId: FIXTURE_IDS.settlement,
      memberId: FIXTURE_IDS.memberStas,
      rentShareMinor: 64400n,
      utilityShareMinor: 2733n,
      purchaseOffsetMinor: 1000n,
      netDueMinor: 68133n,
      explanations: ['rent_share_minor=64400', 'utility_share_minor=2733']
    },
    {
      settlementId: FIXTURE_IDS.settlement,
      memberId: FIXTURE_IDS.memberIon,
      rentShareMinor: 64400n,
      utilityShareMinor: 2733n,
      purchaseOffsetMinor: 1000n,
      netDueMinor: 68133n,
      explanations: ['rent_share_minor=64400', 'utility_share_minor=2733']
    }
  ])

  await db.insert(paymentConfirmations).values({
    id: FIXTURE_IDS.paymentConfirmation,
    householdId: FIXTURE_IDS.household,
    cycleId: FIXTURE_IDS.cycle,
    memberId: FIXTURE_IDS.memberStas,
    senderTelegramUserId: '10002',
    rawText: 'за жилье закинул',
    normalizedText: 'за жилье закинул',
    detectedKind: 'rent',
    explicitAmountMinor: null,
    explicitCurrency: null,
    resolvedAmountMinor: 68133n,
    resolvedCurrency: 'GEL',
    status: 'recorded',
    reviewReason: null,
    attachmentCount: 1,
    telegramChatId: '-1003000000001',
    telegramMessageId: '601',
    telegramThreadId: '1004',
    telegramUpdateId: '9001'
  })

  await db.insert(paymentRecords).values({
    householdId: FIXTURE_IDS.household,
    cycleId: FIXTURE_IDS.cycle,
    memberId: FIXTURE_IDS.memberStas,
    kind: 'rent',
    amountMinor: 68133n,
    currency: 'GEL',
    confirmationId: FIXTURE_IDS.paymentConfirmation,
    recordedAt: new Date('2026-03-19T10:00:00.000Z')
  })

  const seededCycle = await db
    .select({ period: billingCycles.period, currency: billingCycles.currency })
    .from(billingCycles)
    .where(eq(billingCycles.id, FIXTURE_IDS.cycle))
    .limit(1)

  if (seededCycle.length === 0) {
    throw new Error('Seed verification failed: billing cycle not found')
  }

  const seededSettings = await db
    .select({ settlementCurrency: householdBillingSettings.settlementCurrency })
    .from(householdBillingSettings)
    .where(eq(householdBillingSettings.householdId, FIXTURE_IDS.household))
    .limit(1)

  if (seededSettings.length === 0) {
    throw new Error('Seed verification failed: billing settings not found')
  }
}

try {
  await seed()
  console.log('Seed completed')
} finally {
  await queryClient.end({ timeout: 5 })
}
