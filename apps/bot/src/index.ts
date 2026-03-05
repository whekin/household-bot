import { webhookCallback } from 'grammy'

import { createTelegramBot } from './bot'
import { getBotRuntimeConfig } from './config'
import { createOpenAiParserFallback } from './openai-parser-fallback'
import {
  createPurchaseMessageRepository,
  registerPurchaseTopicIngestion
} from './purchase-topic-ingestion'
import { createBotWebhookServer } from './server'

const runtime = getBotRuntimeConfig()
const bot = createTelegramBot(runtime.telegramBotToken)
const webhookHandler = webhookCallback(bot, 'std/http')

let closePurchaseRepository: (() => Promise<void>) | undefined

if (runtime.purchaseTopicIngestionEnabled) {
  const purchaseRepositoryClient = createPurchaseMessageRepository(runtime.databaseUrl!)
  closePurchaseRepository = purchaseRepositoryClient.close
  const llmFallback = createOpenAiParserFallback(runtime.openaiApiKey, runtime.parserModel)

  registerPurchaseTopicIngestion(
    bot,
    {
      householdId: runtime.householdId!,
      householdChatId: runtime.telegramHouseholdChatId!,
      purchaseTopicId: runtime.telegramPurchaseTopicId!
    },
    purchaseRepositoryClient.repository,
    llmFallback
      ? {
          llmFallback
        }
      : {}
  )
} else {
  console.warn(
    'Purchase topic ingestion is disabled. Set DATABASE_URL, HOUSEHOLD_ID, TELEGRAM_HOUSEHOLD_CHAT_ID, and TELEGRAM_PURCHASE_TOPIC_ID to enable.'
  )
}

const server = createBotWebhookServer({
  webhookPath: runtime.telegramWebhookPath,
  webhookSecret: runtime.telegramWebhookSecret,
  webhookHandler
})

if (import.meta.main) {
  Bun.serve({
    port: runtime.port,
    fetch: server.fetch
  })

  console.log(
    `@household/bot webhook server started on :${runtime.port} path=${runtime.telegramWebhookPath}`
  )

  process.on('SIGTERM', () => {
    void closePurchaseRepository?.()
  })
}

export { server }
