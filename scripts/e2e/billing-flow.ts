import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'

import { e2eEnv } from '@household/config'
import { createDbClient, schema } from '@household/db'

import { createTelegramBot } from '../../apps/bot/src/bot'
import { createFinanceCommandsService } from '../../apps/bot/src/finance-commands'
import {
  createPurchaseMessageRepository,
  registerPurchaseTopicIngestion
} from '../../apps/bot/src/purchase-topic-ingestion'

if (!e2eEnv.E2E_SMOKE_ALLOW_WRITE) {
  throw new Error('Set E2E_SMOKE_ALLOW_WRITE=true to run e2e smoke test')
}

const databaseUrl: string = e2eEnv.DATABASE_URL

const chatId = '-100123456'
const purchaseTopicId = 77
const commandChatIdNumber = -100123456

function unixSeconds(year: number, month: number, day: number): number {
  return Math.floor(Date.UTC(year, month - 1, day, 12, 0, 0) / 1000)
}

function commandUpdate(params: {
  updateId: number
  fromUserId: string
  fromName: string
  text: string
  unixTime: number
}) {
  const commandToken = params.text.split(' ')[0] ?? params.text

  return {
    update_id: params.updateId,
    message: {
      message_id: params.updateId,
      date: params.unixTime,
      chat: {
        id: commandChatIdNumber,
        type: 'supergroup'
      },
      from: {
        id: Number(params.fromUserId),
        is_bot: false,
        first_name: params.fromName
      },
      text: params.text,
      entities: [
        {
          offset: 0,
          length: commandToken.length,
          type: 'bot_command'
        }
      ]
    }
  }
}

function topicPurchaseUpdate(params: {
  updateId: number
  fromUserId: string
  fromName: string
  text: string
  unixTime: number
}) {
  return {
    update_id: params.updateId,
    message: {
      message_id: params.updateId,
      date: params.unixTime,
      chat: {
        id: commandChatIdNumber,
        type: 'supergroup'
      },
      from: {
        id: Number(params.fromUserId),
        is_bot: false,
        first_name: params.fromName
      },
      is_topic_message: true,
      message_thread_id: purchaseTopicId,
      text: params.text
    }
  }
}

function parseStatement(text: string): Map<string, string> {
  const lines = text.split('\n').slice(1)
  const amounts = new Map<string, string>()

  for (const line of lines) {
    const match = /^-\s(.+?):\s([+-]?\d+\.\d{2})\s(?:USD|GEL)$/.exec(line.trim())
    if (!match) {
      continue
    }

    amounts.set(match[1]!, match[2]!)
  }

  return amounts
}

async function run(): Promise<void> {
  const ids = {
    household: randomUUID(),
    admin: randomUUID(),
    bob: randomUUID(),
    carol: randomUUID()
  }

  const telegram = {
    admin: '900001',
    bob: '900002',
    carol: '900003'
  }

  let coreClient: ReturnType<typeof createDbClient> | undefined
  let ingestionClient: ReturnType<typeof createPurchaseMessageRepository> | undefined
  let financeService: ReturnType<typeof createFinanceCommandsService> | undefined

  const bot = createTelegramBot('000000:test-token')
  const replies: string[] = []

  bot.api.config.use(async (_prev, method, payload) => {
    if (method === 'sendMessage') {
      const p = payload as any
      const messageText = typeof p?.text === 'string' ? p.text : ''
      replies.push(messageText)

      return {
        ok: true,
        result: {
          message_id: replies.length,
          date: Math.floor(Date.now() / 1000),
          chat: {
            id: commandChatIdNumber,
            type: 'supergroup'
          },
          text: messageText
        }
      } as any
    }

    return { ok: true, result: true } as any
  })

  try {
    coreClient = createDbClient(databaseUrl, {
      max: 2,
      prepare: false
    })

    ingestionClient = createPurchaseMessageRepository(databaseUrl)
    financeService = createFinanceCommandsService(databaseUrl, {
      householdId: ids.household
    })

    registerPurchaseTopicIngestion(
      bot,
      {
        householdId: ids.household,
        householdChatId: chatId,
        purchaseTopicId
      },
      ingestionClient.repository
    )

    financeService.register(bot)

    await coreClient.db.insert(schema.households).values({
      id: ids.household,
      name: 'E2E Smoke Household'
    })

    await coreClient.db.insert(schema.members).values([
      {
        id: ids.admin,
        householdId: ids.household,
        telegramUserId: telegram.admin,
        displayName: 'Alice',
        isAdmin: 1
      },
      {
        id: ids.bob,
        householdId: ids.household,
        telegramUserId: telegram.bob,
        displayName: 'Bob',
        isAdmin: 0
      },
      {
        id: ids.carol,
        householdId: ids.household,
        telegramUserId: telegram.carol,
        displayName: 'Carol',
        isAdmin: 0
      }
    ])

    let updateId = 1000
    const march12 = unixSeconds(2026, 3, 12)

    await bot.handleUpdate(
      commandUpdate({
        updateId: ++updateId,
        fromUserId: telegram.admin,
        fromName: 'Alice',
        text: '/cycle_open 2026-03 USD',
        unixTime: march12
      }) as never
    )

    await bot.handleUpdate(
      commandUpdate({
        updateId: ++updateId,
        fromUserId: telegram.admin,
        fromName: 'Alice',
        text: '/rent_set 700 USD 2026-03',
        unixTime: march12
      }) as never
    )

    await bot.handleUpdate(
      topicPurchaseUpdate({
        updateId: ++updateId,
        fromUserId: telegram.bob,
        fromName: 'Bob',
        text: 'Bought soap 30 USD',
        unixTime: march12
      }) as never
    )

    await bot.handleUpdate(
      commandUpdate({
        updateId: ++updateId,
        fromUserId: telegram.admin,
        fromName: 'Alice',
        text: '/utility_add electricity 120 USD',
        unixTime: march12
      }) as never
    )

    await bot.handleUpdate(
      commandUpdate({
        updateId: ++updateId,
        fromUserId: telegram.admin,
        fromName: 'Alice',
        text: '/statement 2026-03',
        unixTime: march12
      }) as never
    )

    const firstStatement = replies.find((entry) => entry.startsWith('Statement for 2026-03'))
    assert.ok(firstStatement, 'First statement message was not emitted')

    const firstTotals = parseStatement(firstStatement)
    assert.equal(firstTotals.get('Alice'), '283.34')
    assert.equal(firstTotals.get('Bob'), '253.33')
    assert.equal(firstTotals.get('Carol'), '283.33')

    await bot.handleUpdate(
      commandUpdate({
        updateId: ++updateId,
        fromUserId: telegram.admin,
        fromName: 'Alice',
        text: '/utility_add water 30 USD',
        unixTime: march12
      }) as never
    )

    await bot.handleUpdate(
      commandUpdate({
        updateId: ++updateId,
        fromUserId: telegram.admin,
        fromName: 'Alice',
        text: '/statement 2026-03',
        unixTime: march12
      }) as never
    )

    const secondStatement = replies.at(-1)
    assert.ok(secondStatement?.startsWith('Statement for 2026-03'), 'Second statement missing')

    const secondTotals = parseStatement(secondStatement ?? '')
    assert.equal(secondTotals.get('Alice'), '293.34')
    assert.equal(secondTotals.get('Bob'), '263.33')
    assert.equal(secondTotals.get('Carol'), '293.33')

    const purchaseRows = await coreClient.db
      .select({
        status: schema.purchaseMessages.processingStatus,
        amountMinor: schema.purchaseMessages.parsedAmountMinor,
        senderMemberId: schema.purchaseMessages.senderMemberId
      })
      .from(schema.purchaseMessages)
      .where(eq(schema.purchaseMessages.householdId, ids.household))

    assert.equal(purchaseRows.length, 1, 'Expected one ingested purchase message')
    assert.equal(purchaseRows[0]?.status, 'parsed')
    assert.equal(purchaseRows[0]?.amountMinor, 3000n)
    assert.equal(purchaseRows[0]?.senderMemberId, ids.bob)

    console.log(
      'E2E smoke passed: purchase ingestion, utility updates, and statements are deterministic'
    )
  } finally {
    await Promise.allSettled([
      coreClient
        ? coreClient.db.delete(schema.households).where(eq(schema.households.id, ids.household))
        : undefined,
      coreClient?.queryClient.end({ timeout: 5 }),
      ingestionClient?.close(),
      financeService?.close()
    ])
  }
}

try {
  await run()
} catch (error) {
  console.error('E2E smoke failed', error)
  process.exitCode = 1
}
