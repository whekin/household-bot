import { webhookCallback } from 'grammy'
import type { InlineKeyboardMarkup } from 'grammy/types'

import {
  createAnonymousFeedbackService,
  createHouseholdAdminService,
  createFinanceCommandService,
  createHouseholdOnboardingService,
  createLocalePreferenceService,
  createMiniAppAdminService,
  createHouseholdSetupService,
  createReminderJobService,
  createPaymentConfirmationService
} from '@household/application'
import {
  createDbAnonymousFeedbackRepository,
  createDbFinanceRepository,
  createDbHouseholdConfigurationRepository,
  createDbProcessedBotMessageRepository,
  createDbReminderDispatchRepository,
  createDbTelegramPendingActionRepository
} from '@household/adapters-db'
import { configureLogger, getLogger } from '@household/observability'

import { registerAnonymousFeedback } from './anonymous-feedback'
import {
  createInMemoryAssistantConversationMemoryStore,
  createInMemoryAssistantRateLimiter,
  createInMemoryAssistantUsageTracker,
  registerDmAssistant
} from './dm-assistant'
import { createFinanceCommandsService } from './finance-commands'
import { createTelegramBot } from './bot'
import { getBotRuntimeConfig } from './config'
import { registerHouseholdSetupCommands } from './household-setup'
import { createOpenAiChatAssistant } from './openai-chat-assistant'
import { createOpenAiPurchaseInterpreter } from './openai-purchase-interpreter'
import {
  createPurchaseMessageRepository,
  registerConfiguredPurchaseTopicIngestion
} from './purchase-topic-ingestion'
import { registerConfiguredPaymentTopicIngestion } from './payment-topic-ingestion'
import { createReminderJobsHandler } from './reminder-jobs'
import { registerReminderTopicUtilities } from './reminder-topic-utilities'
import { createSchedulerRequestAuthorizer } from './scheduler-auth'
import { createBotWebhookServer } from './server'
import { createMiniAppAuthHandler, createMiniAppJoinHandler } from './miniapp-auth'
import { createMiniAppDashboardHandler } from './miniapp-dashboard'
import {
  createMiniAppApproveMemberHandler,
  createMiniAppPendingMembersHandler,
  createMiniAppPromoteMemberHandler,
  createMiniAppSettingsHandler,
  createMiniAppUpdateMemberDisplayNameHandler,
  createMiniAppUpdateMemberAbsencePolicyHandler,
  createMiniAppUpdateOwnDisplayNameHandler,
  createMiniAppUpdateMemberStatusHandler,
  createMiniAppUpdateMemberRentWeightHandler,
  createMiniAppUpdateSettingsHandler,
  createMiniAppUpsertUtilityCategoryHandler
} from './miniapp-admin'
import {
  createMiniAppAddPaymentHandler,
  createMiniAppAddUtilityBillHandler,
  createMiniAppBillingCycleHandler,
  createMiniAppCloseCycleHandler,
  createMiniAppDeletePaymentHandler,
  createMiniAppDeletePurchaseHandler,
  createMiniAppDeleteUtilityBillHandler,
  createMiniAppOpenCycleHandler,
  createMiniAppRentUpdateHandler,
  createMiniAppUpdatePaymentHandler,
  createMiniAppUpdatePurchaseHandler,
  createMiniAppUpdateUtilityBillHandler
} from './miniapp-billing'
import { createMiniAppLocalePreferenceHandler } from './miniapp-locale'
import { createNbgExchangeRateProvider } from './nbg-exchange-rates'

const runtime = getBotRuntimeConfig()
configureLogger({
  level: runtime.logLevel,
  service: '@household/bot'
})

const logger = getLogger('runtime')
const shutdownTasks: Array<() => Promise<void>> = []
const householdConfigurationRepositoryClient = runtime.databaseUrl
  ? createDbHouseholdConfigurationRepository(runtime.databaseUrl)
  : null
const bot = createTelegramBot(
  runtime.telegramBotToken,
  getLogger('telegram'),
  householdConfigurationRepositoryClient?.repository
)
bot.botInfo = await bot.api.getMe()
const webhookHandler = webhookCallback(bot, 'std/http', {
  onTimeout: 'return'
})
const financeRepositoryClients = new Map<string, ReturnType<typeof createDbFinanceRepository>>()
const financeServices = new Map<string, ReturnType<typeof createFinanceCommandService>>()
const paymentConfirmationServices = new Map<
  string,
  ReturnType<typeof createPaymentConfirmationService>
>()
const exchangeRateProvider = createNbgExchangeRateProvider({
  logger: getLogger('fx')
})
const householdOnboardingService = householdConfigurationRepositoryClient
  ? createHouseholdOnboardingService({
      repository: householdConfigurationRepositoryClient.repository
    })
  : null
const miniAppAdminService = householdConfigurationRepositoryClient
  ? createMiniAppAdminService(householdConfigurationRepositoryClient.repository)
  : null
const localePreferenceService = householdConfigurationRepositoryClient
  ? createLocalePreferenceService(householdConfigurationRepositoryClient.repository)
  : null
const telegramPendingActionRepositoryClient = runtime.databaseUrl
  ? createDbTelegramPendingActionRepository(runtime.databaseUrl!)
  : null
const processedBotMessageRepositoryClient =
  runtime.databaseUrl && runtime.assistantEnabled
    ? createDbProcessedBotMessageRepository(runtime.databaseUrl!)
    : null
const purchaseRepositoryClient = runtime.databaseUrl
  ? createPurchaseMessageRepository(runtime.databaseUrl!)
  : null
const purchaseInterpreter = createOpenAiPurchaseInterpreter(
  runtime.openaiApiKey,
  runtime.purchaseParserModel
)
const assistantMemoryStore = createInMemoryAssistantConversationMemoryStore(
  runtime.assistantMemoryMaxTurns
)
const assistantRateLimiter = createInMemoryAssistantRateLimiter({
  burstLimit: runtime.assistantRateLimitBurst,
  burstWindowMs: runtime.assistantRateLimitBurstWindowMs,
  rollingLimit: runtime.assistantRateLimitRolling,
  rollingWindowMs: runtime.assistantRateLimitRollingWindowMs
})
const assistantUsageTracker = createInMemoryAssistantUsageTracker()
const conversationalAssistant = createOpenAiChatAssistant(
  runtime.openaiApiKey,
  runtime.assistantModel,
  runtime.assistantTimeoutMs
)
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

  const repositoryClient = financeRepositoryForHousehold(householdId)
  const service = createFinanceCommandService({
    householdId,
    repository: repositoryClient.repository,
    householdConfigurationRepository: householdConfigurationRepositoryClient!.repository,
    exchangeRateProvider
  })
  financeServices.set(householdId, service)
  return service
}

function financeRepositoryForHousehold(householdId: string) {
  const existing = financeRepositoryClients.get(householdId)
  if (existing) {
    return existing
  }

  const repositoryClient = createDbFinanceRepository(runtime.databaseUrl!, householdId)
  financeRepositoryClients.set(householdId, repositoryClient)
  shutdownTasks.push(repositoryClient.close)
  return repositoryClient
}

function paymentConfirmationServiceForHousehold(householdId: string) {
  const existing = paymentConfirmationServices.get(householdId)
  if (existing) {
    return existing
  }

  const service = createPaymentConfirmationService({
    householdId,
    financeService: financeServiceForHousehold(householdId),
    repository: financeRepositoryForHousehold(householdId).repository,
    householdConfigurationRepository: householdConfigurationRepositoryClient!.repository,
    exchangeRateProvider
  })
  paymentConfirmationServices.set(householdId, service)
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

if (processedBotMessageRepositoryClient) {
  shutdownTasks.push(processedBotMessageRepositoryClient.close)
}

if (purchaseRepositoryClient) {
  shutdownTasks.push(purchaseRepositoryClient.close)
}

if (purchaseRepositoryClient && householdConfigurationRepositoryClient) {
  registerConfiguredPurchaseTopicIngestion(
    bot,
    householdConfigurationRepositoryClient.repository,
    purchaseRepositoryClient.repository,
    {
      ...(purchaseInterpreter
        ? {
            interpreter: purchaseInterpreter
          }
        : {}),
      logger: getLogger('purchase-ingestion')
    }
  )

  registerConfiguredPaymentTopicIngestion(
    bot,
    householdConfigurationRepositoryClient.repository,
    telegramPendingActionRepositoryClient!.repository,
    financeServiceForHousehold,
    paymentConfirmationServiceForHousehold,
    {
      logger: getLogger('payment-ingestion')
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
    householdConfigurationRepository: householdConfigurationRepositoryClient.repository,
    ...(telegramPendingActionRepositoryClient
      ? {
          promptRepository: telegramPendingActionRepositoryClient.repository
        }
      : {}),
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
        listReminderTargets: () =>
          householdConfigurationRepositoryClient!.repository.listReminderTargets(),
        ensureBillingCycle: async ({ householdId, at }) => {
          await financeServiceForHousehold(householdId).ensureExpectedCycle(at)
        },
        releaseReminderDispatch: (input) =>
          reminderRepositoryClient.repository.releaseReminderDispatch(input),
        sendReminderMessage: async (target, content) => {
          const threadId =
            target.telegramThreadId !== null ? Number(target.telegramThreadId) : undefined

          if (target.telegramThreadId !== null && (!threadId || !Number.isInteger(threadId))) {
            throw new Error(
              `Invalid reminder thread id for household ${target.householdId}: ${target.telegramThreadId}`
            )
          }

          await bot.api.sendMessage(target.telegramChatId, content.text, {
            ...(threadId
              ? {
                  message_thread_id: threadId
                }
              : {}),
            ...(content.replyMarkup
              ? {
                  reply_markup: content.replyMarkup as InlineKeyboardMarkup
                }
              : {})
          })
        },
        reminderService,
        ...(runtime.miniAppAllowedOrigins[0]
          ? {
              miniAppUrl: runtime.miniAppAllowedOrigins[0]
            }
          : {}),
        ...(bot.botInfo?.username
          ? {
              botUsername: bot.botInfo.username
            }
          : {}),
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
    'Reminder jobs are disabled. Set DATABASE_URL and either SCHEDULER_SHARED_SECRET or SCHEDULER_OIDC_ALLOWED_EMAILS to enable.'
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

if (
  runtime.assistantEnabled &&
  householdConfigurationRepositoryClient &&
  telegramPendingActionRepositoryClient
) {
  if (processedBotMessageRepositoryClient) {
    registerDmAssistant({
      bot,
      householdConfigurationRepository: householdConfigurationRepositoryClient.repository,
      messageProcessingRepository: processedBotMessageRepositoryClient.repository,
      promptRepository: telegramPendingActionRepositoryClient.repository,
      financeServiceForHousehold,
      memoryStore: assistantMemoryStore,
      rateLimiter: assistantRateLimiter,
      usageTracker: assistantUsageTracker,
      ...(purchaseRepositoryClient
        ? {
            purchaseRepository: purchaseRepositoryClient.repository
          }
        : {}),
      ...(purchaseInterpreter
        ? {
            purchaseInterpreter
          }
        : {}),
      ...(conversationalAssistant
        ? {
            assistant: conversationalAssistant
          }
        : {}),
      logger: getLogger('dm-assistant')
    })
  } else {
    registerDmAssistant({
      bot,
      householdConfigurationRepository: householdConfigurationRepositoryClient.repository,
      promptRepository: telegramPendingActionRepositoryClient.repository,
      financeServiceForHousehold,
      memoryStore: assistantMemoryStore,
      rateLimiter: assistantRateLimiter,
      usageTracker: assistantUsageTracker,
      ...(purchaseRepositoryClient
        ? {
            purchaseRepository: purchaseRepositoryClient.repository
          }
        : {}),
      ...(purchaseInterpreter
        ? {
            purchaseInterpreter
          }
        : {}),
      ...(conversationalAssistant
        ? {
            assistant: conversationalAssistant
          }
        : {}),
      logger: getLogger('dm-assistant')
    })
  }
}

if (householdConfigurationRepositoryClient && telegramPendingActionRepositoryClient) {
  registerReminderTopicUtilities({
    bot,
    householdConfigurationRepository: householdConfigurationRepositoryClient.repository,
    promptRepository: telegramPendingActionRepositoryClient.repository,
    financeServiceForHousehold,
    logger: getLogger('reminder-utilities')
  })
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
  miniAppSettings: householdOnboardingService
    ? createMiniAppSettingsHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingService: householdOnboardingService,
        miniAppAdminService: miniAppAdminService!,
        assistantUsageTracker,
        logger: getLogger('miniapp-admin')
      })
    : undefined,
  miniAppUpdateSettings: householdOnboardingService
    ? createMiniAppUpdateSettingsHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingService: householdOnboardingService,
        miniAppAdminService: miniAppAdminService!,
        logger: getLogger('miniapp-admin')
      })
    : undefined,
  miniAppUpsertUtilityCategory: householdOnboardingService
    ? createMiniAppUpsertUtilityCategoryHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingService: householdOnboardingService,
        miniAppAdminService: miniAppAdminService!,
        logger: getLogger('miniapp-admin')
      })
    : undefined,
  miniAppPromoteMember: householdOnboardingService
    ? createMiniAppPromoteMemberHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingService: householdOnboardingService,
        miniAppAdminService: miniAppAdminService!,
        logger: getLogger('miniapp-admin')
      })
    : undefined,
  miniAppUpdateOwnDisplayName: householdOnboardingService
    ? createMiniAppUpdateOwnDisplayNameHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingService: householdOnboardingService,
        miniAppAdminService: miniAppAdminService!,
        logger: getLogger('miniapp-admin')
      })
    : undefined,
  miniAppUpdateMemberDisplayName: householdOnboardingService
    ? createMiniAppUpdateMemberDisplayNameHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingService: householdOnboardingService,
        miniAppAdminService: miniAppAdminService!,
        logger: getLogger('miniapp-admin')
      })
    : undefined,
  miniAppUpdateMemberRentWeight: householdOnboardingService
    ? createMiniAppUpdateMemberRentWeightHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingService: householdOnboardingService,
        miniAppAdminService: miniAppAdminService!,
        logger: getLogger('miniapp-admin')
      })
    : undefined,
  miniAppUpdateMemberStatus: householdOnboardingService
    ? createMiniAppUpdateMemberStatusHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingService: householdOnboardingService,
        miniAppAdminService: miniAppAdminService!,
        logger: getLogger('miniapp-admin')
      })
    : undefined,
  miniAppUpdateMemberAbsencePolicy: householdOnboardingService
    ? createMiniAppUpdateMemberAbsencePolicyHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingService: householdOnboardingService,
        miniAppAdminService: miniAppAdminService!,
        logger: getLogger('miniapp-admin')
      })
    : undefined,
  miniAppBillingCycle: householdOnboardingService
    ? createMiniAppBillingCycleHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingService: householdOnboardingService,
        financeServiceForHousehold,
        logger: getLogger('miniapp-billing')
      })
    : undefined,
  miniAppOpenCycle: householdOnboardingService
    ? createMiniAppOpenCycleHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingService: householdOnboardingService,
        financeServiceForHousehold,
        logger: getLogger('miniapp-billing')
      })
    : undefined,
  miniAppCloseCycle: householdOnboardingService
    ? createMiniAppCloseCycleHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingService: householdOnboardingService,
        financeServiceForHousehold,
        logger: getLogger('miniapp-billing')
      })
    : undefined,
  miniAppRentUpdate: householdOnboardingService
    ? createMiniAppRentUpdateHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingService: householdOnboardingService,
        financeServiceForHousehold,
        logger: getLogger('miniapp-billing')
      })
    : undefined,
  miniAppAddUtilityBill: householdOnboardingService
    ? createMiniAppAddUtilityBillHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingService: householdOnboardingService,
        financeServiceForHousehold,
        logger: getLogger('miniapp-billing')
      })
    : undefined,
  miniAppUpdateUtilityBill: householdOnboardingService
    ? createMiniAppUpdateUtilityBillHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingService: householdOnboardingService,
        financeServiceForHousehold,
        logger: getLogger('miniapp-billing')
      })
    : undefined,
  miniAppDeleteUtilityBill: householdOnboardingService
    ? createMiniAppDeleteUtilityBillHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingService: householdOnboardingService,
        financeServiceForHousehold,
        logger: getLogger('miniapp-billing')
      })
    : undefined,
  miniAppUpdatePurchase: householdOnboardingService
    ? createMiniAppUpdatePurchaseHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingService: householdOnboardingService,
        financeServiceForHousehold,
        logger: getLogger('miniapp-billing')
      })
    : undefined,
  miniAppDeletePurchase: householdOnboardingService
    ? createMiniAppDeletePurchaseHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingService: householdOnboardingService,
        financeServiceForHousehold,
        logger: getLogger('miniapp-billing')
      })
    : undefined,
  miniAppAddPayment: householdOnboardingService
    ? createMiniAppAddPaymentHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingService: householdOnboardingService,
        financeServiceForHousehold,
        logger: getLogger('miniapp-billing')
      })
    : undefined,
  miniAppUpdatePayment: householdOnboardingService
    ? createMiniAppUpdatePaymentHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingService: householdOnboardingService,
        financeServiceForHousehold,
        logger: getLogger('miniapp-billing')
      })
    : undefined,
  miniAppDeletePayment: householdOnboardingService
    ? createMiniAppDeletePaymentHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingService: householdOnboardingService,
        financeServiceForHousehold,
        logger: getLogger('miniapp-billing')
      })
    : undefined,
  miniAppLocalePreference: householdOnboardingService
    ? createMiniAppLocalePreferenceHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingService: householdOnboardingService,
        localePreferenceService: localePreferenceService!,
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
