import { webhookCallback } from 'grammy'

import {
  createAnonymousFeedbackService,
  createHouseholdAdminService,
  createFinanceCommandService,
  createHouseholdOnboardingService,
  createMiniAppAdminService,
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
import {
  createMiniAppApproveMemberHandler,
  createMiniAppPendingMembersHandler
} from './miniapp-admin'

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
const financeRepositoryClients = new Map<string, ReturnType<typeof createDbFinanceRepository>>()
const financeServices = new Map<string, ReturnType<typeof createFinanceCommandService>>()
const householdOnboardingService = householdConfigurationRepositoryClient
  ? createHouseholdOnboardingService({
      repository: householdConfigurationRepositoryClient.repository
    })
  : null
const miniAppAdminService = householdConfigurationRepositoryClient
  ? createMiniAppAdminService(householdConfigurationRepositoryClient.repository)
  : null
const telegramPendingActionRepositoryClient =
  runtime.databaseUrl && runtime.anonymousFeedbackEnabled
    ? createDbTelegramPendingActionRepository(runtime.databaseUrl!)
    : null
const anonymousFeedbackRepositoryClients = new Map<
  string,
  ReturnType<typeof createDbAnonymousFeedbackRepository>
>()
const anonymousFeedbackServices = new Map<
  string,
  ReturnType<typeof createAnonymousFeedbackService>
>()

function financeServiceForHousehold(householdId: string) {
  const existing = financeServices.get(householdId)
  if (existing) {
    return existing
  }

  const repositoryClient = createDbFinanceRepository(runtime.databaseUrl!, householdId)
  financeRepositoryClients.set(householdId, repositoryClient)
  shutdownTasks.push(repositoryClient.close)

  const service = createFinanceCommandService(repositoryClient.repository)
  financeServices.set(householdId, service)
  return service
}

function anonymousFeedbackServiceForHousehold(householdId: string) {
  const existing = anonymousFeedbackServices.get(householdId)
  if (existing) {
    return existing
  }

  const repositoryClient = createDbAnonymousFeedbackRepository(runtime.databaseUrl!, householdId)
  anonymousFeedbackRepositoryClients.set(householdId, repositoryClient)
  shutdownTasks.push(repositoryClient.close)

  const service = createAnonymousFeedbackService(repositoryClient.repository)
  anonymousFeedbackServices.set(householdId, service)
  return service
}

if (householdConfigurationRepositoryClient) {
  shutdownTasks.push(householdConfigurationRepositoryClient.close)
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
  const financeCommands = createFinanceCommandsService({
    householdConfigurationRepository: householdConfigurationRepositoryClient!.repository,
    financeServiceForHousehold
  })

  financeCommands.register(bot)
} else {
  logger.warn(
    {
      event: 'runtime.feature_disabled',
      feature: 'finance-commands'
    },
    'Finance commands are disabled. Set DATABASE_URL to enable household lookups.'
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
    ...(runtime.miniAppAllowedOrigins[0]
      ? {
          miniAppUrl: runtime.miniAppAllowedOrigins[0]
        }
      : {}),
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

if (
  runtime.anonymousFeedbackEnabled &&
  householdConfigurationRepositoryClient &&
  telegramPendingActionRepositoryClient
) {
  registerAnonymousFeedback({
    bot,
    anonymousFeedbackServiceForHousehold,
    householdConfigurationRepository: householdConfigurationRepositoryClient!.repository,
    promptRepository: telegramPendingActionRepositoryClient!.repository,
    logger: getLogger('anonymous-feedback')
  })
} else {
  logger.warn(
    {
      event: 'runtime.feature_disabled',
      feature: 'anonymous-feedback'
    },
    'Anonymous feedback is disabled. Set DATABASE_URL to enable household and topic lookups.'
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
  miniAppDashboard: householdOnboardingService
    ? createMiniAppDashboardHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        financeServiceForHousehold,
        onboardingService: householdOnboardingService!,
        logger: getLogger('miniapp-dashboard')
      })
    : undefined,
  miniAppPendingMembers: householdOnboardingService
    ? createMiniAppPendingMembersHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingService: householdOnboardingService,
        miniAppAdminService: miniAppAdminService!,
        logger: getLogger('miniapp-admin')
      })
    : undefined,
  miniAppApproveMember: householdOnboardingService
    ? createMiniAppApproveMemberHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingService: householdOnboardingService,
        miniAppAdminService: miniAppAdminService!,
        logger: getLogger('miniapp-admin')
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
