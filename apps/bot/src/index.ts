import { webhookCallback } from 'grammy'

import {
  createAnonymousFeedbackService,
  createHouseholdAdminService,
  createFinanceCommandService,
  createHouseholdOnboardingService,
  createHouseholdSetupService,
  createReminderJobService
} from '@household/application'
import {
  createDbAnonymousFeedbackRepository,
  createDbFinanceRepository,
  createDbHouseholdConfigurationRepository,
  createDbReminderDispatchRepository,
  createDbTelegramPendingActionRepository
} from '@household/adapters-db'
import { configureLogger, getLogger } from '@household/observability'

import { registerAnonymousFeedback } from './anonymous-feedback'
import { createFinanceCommandsService } from './finance-commands'
import { createTelegramBot } from './bot'
import { getBotRuntimeConfig } from './config'
import { registerHouseholdSetupCommands } from './household-setup'
import { createOpenAiParserFallback } from './openai-parser-fallback'
import {
  createPurchaseMessageRepository,
  registerConfiguredPurchaseTopicIngestion
} from './purchase-topic-ingestion'
import { createReminderJobsHandler } from './reminder-jobs'
import { createSchedulerRequestAuthorizer } from './scheduler-auth'
import { createBotWebhookServer } from './server'
import { createMiniAppAuthHandler, createMiniAppJoinHandler } from './miniapp-auth'
import { createMiniAppDashboardHandler } from './miniapp-dashboard'

const runtime = getBotRuntimeConfig()
configureLogger({
  level: runtime.logLevel,
  service: '@household/bot'
})

const logger = getLogger('runtime')
const bot = createTelegramBot(runtime.telegramBotToken, getLogger('telegram'))
const webhookHandler = webhookCallback(bot, 'std/http')

const shutdownTasks: Array<() => Promise<void>> = []
const householdConfigurationRepositoryClient = runtime.databaseUrl
  ? createDbHouseholdConfigurationRepository(runtime.databaseUrl)
  : null
const financeRepositoryClient =
  runtime.financeCommandsEnabled || runtime.miniAppAuthEnabled
    ? createDbFinanceRepository(runtime.databaseUrl!, runtime.householdId!)
    : null
const financeService = financeRepositoryClient
  ? createFinanceCommandService(financeRepositoryClient.repository)
  : null
const householdOnboardingService = householdConfigurationRepositoryClient
  ? createHouseholdOnboardingService({
      repository: householdConfigurationRepositoryClient.repository,
      ...(financeRepositoryClient
        ? {
            getMemberByTelegramUserId: financeRepositoryClient.repository.getMemberByTelegramUserId
          }
        : {})
    })
  : null
const anonymousFeedbackRepositoryClient = runtime.anonymousFeedbackEnabled
  ? createDbAnonymousFeedbackRepository(runtime.databaseUrl!, runtime.householdId!)
  : null
const telegramPendingActionRepositoryClient =
  runtime.databaseUrl && runtime.anonymousFeedbackEnabled
    ? createDbTelegramPendingActionRepository(runtime.databaseUrl!)
    : null
const anonymousFeedbackService = anonymousFeedbackRepositoryClient
  ? createAnonymousFeedbackService(anonymousFeedbackRepositoryClient.repository)
  : null

if (financeRepositoryClient) {
  shutdownTasks.push(financeRepositoryClient.close)
}

if (householdConfigurationRepositoryClient) {
  shutdownTasks.push(householdConfigurationRepositoryClient.close)
}

if (anonymousFeedbackRepositoryClient) {
  shutdownTasks.push(anonymousFeedbackRepositoryClient.close)
}

if (telegramPendingActionRepositoryClient) {
  shutdownTasks.push(telegramPendingActionRepositoryClient.close)
}

if (runtime.databaseUrl && householdConfigurationRepositoryClient) {
  const purchaseRepositoryClient = createPurchaseMessageRepository(runtime.databaseUrl!)
  shutdownTasks.push(purchaseRepositoryClient.close)
  const llmFallback = createOpenAiParserFallback(runtime.openaiApiKey, runtime.parserModel)

  registerConfiguredPurchaseTopicIngestion(
    bot,
    householdConfigurationRepositoryClient.repository,
    purchaseRepositoryClient.repository,
    {
      ...(llmFallback
        ? {
            llmFallback
          }
        : {}),
      logger: getLogger('purchase-ingestion')
    }
  )
} else {
  logger.warn(
    {
      event: 'runtime.feature_disabled',
      feature: 'purchase-topic-ingestion'
    },
    'Purchase topic ingestion is disabled. Set DATABASE_URL to enable Telegram topic lookups.'
  )
}

if (runtime.financeCommandsEnabled) {
  const financeCommands = createFinanceCommandsService(financeService!)

  financeCommands.register(bot)
} else {
  logger.warn(
    {
      event: 'runtime.feature_disabled',
      feature: 'finance-commands'
    },
    'Finance commands are disabled. Set DATABASE_URL and HOUSEHOLD_ID to enable.'
  )
}

if (householdConfigurationRepositoryClient) {
  registerHouseholdSetupCommands({
    bot,
    householdSetupService: createHouseholdSetupService(
      householdConfigurationRepositoryClient.repository
    ),
    householdAdminService: createHouseholdAdminService(
      householdConfigurationRepositoryClient.repository
    ),
    householdOnboardingService: householdOnboardingService!,
    logger: getLogger('household-setup')
  })
} else {
  logger.warn(
    {
      event: 'runtime.feature_disabled',
      feature: 'household-setup'
    },
    'Household setup commands are disabled. Set DATABASE_URL to enable.'
  )
}

const reminderJobs = runtime.reminderJobsEnabled
  ? (() => {
      const reminderRepositoryClient = createDbReminderDispatchRepository(runtime.databaseUrl!)
      const reminderService = createReminderJobService(reminderRepositoryClient.repository)

      shutdownTasks.push(reminderRepositoryClient.close)

      return createReminderJobsHandler({
        householdId: runtime.householdId!,
        reminderService,
        logger: getLogger('scheduler')
      })
    })()
  : null

if (!runtime.reminderJobsEnabled) {
  logger.warn(
    {
      event: 'runtime.feature_disabled',
      feature: 'reminder-jobs'
    },
    'Reminder jobs are disabled. Set DATABASE_URL, HOUSEHOLD_ID, and either SCHEDULER_SHARED_SECRET or SCHEDULER_OIDC_ALLOWED_EMAILS to enable.'
  )
}

if (anonymousFeedbackService) {
  registerAnonymousFeedback({
    bot,
    anonymousFeedbackService,
    promptRepository: telegramPendingActionRepositoryClient!.repository,
    householdChatId: runtime.telegramHouseholdChatId!,
    feedbackTopicId: runtime.telegramFeedbackTopicId!,
    logger: getLogger('anonymous-feedback')
  })
} else {
  logger.warn(
    {
      event: 'runtime.feature_disabled',
      feature: 'anonymous-feedback'
    },
    'Anonymous feedback is disabled. Set DATABASE_URL, HOUSEHOLD_ID, TELEGRAM_HOUSEHOLD_CHAT_ID, and TELEGRAM_FEEDBACK_TOPIC_ID to enable.'
  )
}

const server = createBotWebhookServer({
  webhookPath: runtime.telegramWebhookPath,
  webhookSecret: runtime.telegramWebhookSecret,
  webhookHandler,
  miniAppAuth: householdOnboardingService
    ? createMiniAppAuthHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingService: householdOnboardingService,
        logger: getLogger('miniapp-auth')
      })
    : undefined,
  miniAppJoin: householdOnboardingService
    ? createMiniAppJoinHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingService: householdOnboardingService,
        logger: getLogger('miniapp-auth')
      })
    : undefined,
  miniAppDashboard: financeService
    ? createMiniAppDashboardHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        financeService,
        onboardingService: householdOnboardingService!,
        logger: getLogger('miniapp-dashboard')
      })
    : undefined,
  scheduler:
    reminderJobs && runtime.schedulerSharedSecret
      ? {
          authorize: createSchedulerRequestAuthorizer({
            sharedSecret: runtime.schedulerSharedSecret,
            oidcAllowedEmails: runtime.schedulerOidcAllowedEmails
          }).authorize,
          handler: reminderJobs.handle
        }
      : reminderJobs
        ? {
            authorize: createSchedulerRequestAuthorizer({
              oidcAllowedEmails: runtime.schedulerOidcAllowedEmails
            }).authorize,
            handler: reminderJobs.handle
          }
        : undefined
})

if (import.meta.main) {
  Bun.serve({
    port: runtime.port,
    fetch: server.fetch
  })

  logger.info(
    {
      event: 'runtime.started',
      port: runtime.port,
      webhookPath: runtime.telegramWebhookPath
    },
    'Bot webhook server started'
  )

  process.on('SIGTERM', () => {
    logger.info(
      {
        event: 'runtime.shutdown',
        signal: 'SIGTERM'
      },
      'Bot shutdown requested'
    )

    for (const close of shutdownTasks) {
      void close()
    }
  })
}

export { server }
