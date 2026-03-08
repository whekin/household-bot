import { webhookCallback } from 'grammy'

import { createFinanceCommandService, createReminderJobService } from '@household/application'
import {
  createDbFinanceRepository,
  createDbReminderDispatchRepository
} from '@household/adapters-db'

import { createFinanceCommandsService } from './finance-commands'
import { createTelegramBot } from './bot'
import { getBotRuntimeConfig } from './config'
import { createOpenAiParserFallback } from './openai-parser-fallback'
import {
  createPurchaseMessageRepository,
  registerPurchaseTopicIngestion
} from './purchase-topic-ingestion'
import { createReminderJobsHandler } from './reminder-jobs'
import { createBotWebhookServer } from './server'

const runtime = getBotRuntimeConfig()
const bot = createTelegramBot(runtime.telegramBotToken)
const webhookHandler = webhookCallback(bot, 'std/http')

const shutdownTasks: Array<() => Promise<void>> = []

if (runtime.purchaseTopicIngestionEnabled) {
  const purchaseRepositoryClient = createPurchaseMessageRepository(runtime.databaseUrl!)
  shutdownTasks.push(purchaseRepositoryClient.close)
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

if (runtime.financeCommandsEnabled) {
  const financeRepositoryClient = createDbFinanceRepository(
    runtime.databaseUrl!,
    runtime.householdId!
  )
  const financeService = createFinanceCommandService(financeRepositoryClient.repository)
  const financeCommands = createFinanceCommandsService(financeService)

  financeCommands.register(bot)
  shutdownTasks.push(financeRepositoryClient.close)
} else {
  console.warn('Finance commands are disabled. Set DATABASE_URL and HOUSEHOLD_ID to enable.')
}

const reminderJobs = runtime.reminderJobsEnabled
  ? (() => {
      const reminderRepositoryClient = createDbReminderDispatchRepository(runtime.databaseUrl!)
      const reminderService = createReminderJobService(reminderRepositoryClient.repository)

      shutdownTasks.push(reminderRepositoryClient.close)

      return createReminderJobsHandler({
        householdId: runtime.householdId!,
        reminderService
      })
    })()
  : null

if (!runtime.reminderJobsEnabled) {
  console.warn(
    'Reminder jobs are disabled. Set DATABASE_URL, HOUSEHOLD_ID, and SCHEDULER_SHARED_SECRET to enable.'
  )
}

const server = createBotWebhookServer({
  webhookPath: runtime.telegramWebhookPath,
  webhookSecret: runtime.telegramWebhookSecret,
  webhookHandler,
  scheduler:
    reminderJobs && runtime.schedulerSharedSecret
      ? {
          sharedSecret: runtime.schedulerSharedSecret,
          handler: reminderJobs.handle
        }
      : undefined
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
    for (const close of shutdownTasks) {
      void close()
    }
  })
}

export { server }
