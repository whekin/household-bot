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
  createDbTelegramPendingActionRepository,
  createDbTopicMessageHistoryRepository
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
import { createTopicProcessor } from './topic-processor'
import { HouseholdContextCache } from './household-context-cache'
import {
  createPurchaseMessageRepository,
  registerConfiguredPurchaseTopicIngestion
} from './purchase-topic-ingestion'
import { registerConfiguredPaymentTopicIngestion } from './payment-topic-ingestion'
import { createReminderJobsHandler } from './reminder-jobs'
import { registerReminderTopicUtilities } from './reminder-topic-utilities'
import { createSchedulerRequestAuthorizer } from './scheduler-auth'
import { createBotWebhookServer } from './server'
import {
  createMiniAppAuthHandler,
  createMiniAppJoinHandler,
  type MiniAppAuthorizedSession
} from './miniapp-auth'
import { createMiniAppDashboardHandler } from './miniapp-dashboard'
import {
  createMiniAppApproveMemberHandler,
  createMiniAppRejectMemberHandler,
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
  createMiniAppAddPurchaseHandler,
  createMiniAppAddUtilityBillHandler,
  createMiniAppBillingCycleHandler,
  createMiniAppCloseCycleHandler,
  createMiniAppDeletePaymentHandler,
  createMiniAppDeletePurchaseHandler,
  createMiniAppDeleteUtilityBillHandler,
  createMiniAppOpenCycleHandler,
  createMiniAppRentUpdateHandler,
  createMiniAppSubmitUtilityBillHandler,
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
const workerHouseholdConfigurationRepositoryClient = runtime.workerDatabaseUrl
  ? createDbHouseholdConfigurationRepository(runtime.workerDatabaseUrl)
  : null
const bot = createTelegramBot(
  runtime.telegramBotToken,
  getLogger('telegram'),
  workerHouseholdConfigurationRepositoryClient?.repository
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
const householdOnboardingService = workerHouseholdConfigurationRepositoryClient
  ? createHouseholdOnboardingService({
      repository: workerHouseholdConfigurationRepositoryClient.repository
    })
  : null
const telegramPendingActionRepositoryClient = runtime.workerDatabaseUrl
  ? createDbTelegramPendingActionRepository(runtime.workerDatabaseUrl!)
  : null
const processedBotMessageRepositoryClient =
  runtime.workerDatabaseUrl && runtime.assistantEnabled
    ? createDbProcessedBotMessageRepository(runtime.workerDatabaseUrl!)
    : null
const purchaseRepositoryClient = runtime.workerDatabaseUrl
  ? createPurchaseMessageRepository(runtime.workerDatabaseUrl!)
  : null
const topicMessageHistoryRepositoryClient = runtime.workerDatabaseUrl
  ? createDbTopicMessageHistoryRepository(runtime.workerDatabaseUrl!)
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
const topicProcessor = createTopicProcessor(
  runtime.openaiApiKey,
  runtime.topicProcessorModel,
  runtime.topicProcessorTimeoutMs,
  getLogger('topic-processor')
)
const householdContextCache = new HouseholdContextCache()
const anonymousFeedbackRepositoryClients = new Map<
  string,
  ReturnType<typeof createDbAnonymousFeedbackRepository>
>()
const anonymousFeedbackServices = new Map<
  string,
  ReturnType<typeof createAnonymousFeedbackService>
>()
const appHouseholdConfigurationRepositoryClients = new Map<
  string,
  ReturnType<typeof createDbHouseholdConfigurationRepository>
>()
const appOnboardingServices = new Map<string, ReturnType<typeof createHouseholdOnboardingService>>()
const appFinanceRepositoryClients = new Map<string, ReturnType<typeof createDbFinanceRepository>>()
const appFinanceServices = new Map<string, ReturnType<typeof createFinanceCommandService>>()
const appMiniAppAdminServices = new Map<string, ReturnType<typeof createMiniAppAdminService>>()
const appLocalePreferenceServices = new Map<
  string,
  ReturnType<typeof createLocalePreferenceService>
>()

function miniAppSessionKey(session: MiniAppAuthorizedSession): string {
  return [
    session.telegramUserId,
    session.member.householdId,
    session.member.id,
    session.member.isAdmin ? 'admin' : 'member'
  ].join(':')
}

function appHouseholdConfigurationRepositoryKey(input: {
  telegramUserId: string
  householdId?: string
  memberId?: string
  isAdmin?: boolean
}): string {
  return [
    input.telegramUserId,
    input.householdId ?? 'none',
    input.memberId ?? 'none',
    input.isAdmin === true ? 'admin' : 'member'
  ].join(':')
}

function appHouseholdConfigurationRepositoryForContext(input: {
  telegramUserId: string
  householdId?: string
  memberId?: string
  isAdmin?: boolean
}) {
  const key = appHouseholdConfigurationRepositoryKey(input)
  const existing = appHouseholdConfigurationRepositoryClients.get(key)
  if (existing) {
    return existing
  }

  const repositoryClient = createDbHouseholdConfigurationRepository(runtime.appDatabaseUrl!, {
    sessionContext: {
      telegramUserId: input.telegramUserId,
      ...(input.householdId
        ? {
            householdId: input.householdId
          }
        : {}),
      ...(input.memberId
        ? {
            memberId: input.memberId
          }
        : {}),
      ...(input.isAdmin !== undefined
        ? {
            isAdmin: input.isAdmin
          }
        : {})
    }
  })
  appHouseholdConfigurationRepositoryClients.set(key, repositoryClient)
  shutdownTasks.push(repositoryClient.close)
  return repositoryClient
}

function appOnboardingServiceForTelegramUserId(telegramUserId: string) {
  const existing = appOnboardingServices.get(telegramUserId)
  if (existing) {
    return existing
  }

  const service = createHouseholdOnboardingService({
    repository: appHouseholdConfigurationRepositoryForContext({
      telegramUserId
    }).repository
  })
  appOnboardingServices.set(telegramUserId, service)
  return service
}

function appHouseholdConfigurationRepositoryForSession(session: MiniAppAuthorizedSession) {
  return appHouseholdConfigurationRepositoryForContext({
    telegramUserId: session.telegramUserId,
    householdId: session.member.householdId,
    memberId: session.member.id,
    isAdmin: session.member.isAdmin
  })
}

function appFinanceServiceForSession(session: MiniAppAuthorizedSession) {
  const key = miniAppSessionKey(session)
  const existing = appFinanceServices.get(key)
  if (existing) {
    return existing
  }

  const repositoryClient = createDbFinanceRepository(
    runtime.appDatabaseUrl!,
    session.member.householdId,
    {
      sessionContext: {
        telegramUserId: session.telegramUserId,
        householdId: session.member.householdId,
        memberId: session.member.id,
        ...(session.member.isAdmin !== undefined
          ? {
              isAdmin: session.member.isAdmin
            }
          : {})
      }
    }
  )
  appFinanceRepositoryClients.set(key, repositoryClient)
  shutdownTasks.push(repositoryClient.close)

  const service = createFinanceCommandService({
    householdId: session.member.householdId,
    repository: repositoryClient.repository,
    householdConfigurationRepository:
      appHouseholdConfigurationRepositoryForSession(session).repository,
    exchangeRateProvider
  })
  appFinanceServices.set(key, service)
  return service
}

function appMiniAppAdminServiceForSession(session: MiniAppAuthorizedSession) {
  const key = miniAppSessionKey(session)
  const existing = appMiniAppAdminServices.get(key)
  if (existing) {
    return existing
  }

  const service = createMiniAppAdminService(
    appHouseholdConfigurationRepositoryForSession(session).repository
  )
  appMiniAppAdminServices.set(key, service)
  return service
}

function appLocalePreferenceServiceForSession(session: MiniAppAuthorizedSession) {
  const key = miniAppSessionKey(session)
  const existing = appLocalePreferenceServices.get(key)
  if (existing) {
    return existing
  }

  const service = createLocalePreferenceService(
    appHouseholdConfigurationRepositoryForSession(session).repository
  )
  appLocalePreferenceServices.set(key, service)
  return service
}

function financeServiceForHousehold(householdId: string) {
  const existing = financeServices.get(householdId)
  if (existing) {
    return existing
  }

  const repositoryClient = financeRepositoryForHousehold(householdId)
  const service = createFinanceCommandService({
    householdId,
    repository: repositoryClient.repository,
    householdConfigurationRepository: workerHouseholdConfigurationRepositoryClient!.repository,
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

  const repositoryClient = createDbFinanceRepository(runtime.workerDatabaseUrl!, householdId)
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
    householdConfigurationRepository: workerHouseholdConfigurationRepositoryClient!.repository,
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

  const repositoryClient = createDbAnonymousFeedbackRepository(
    runtime.workerDatabaseUrl!,
    householdId
  )
  anonymousFeedbackRepositoryClients.set(householdId, repositoryClient)
  shutdownTasks.push(repositoryClient.close)

  const service = createAnonymousFeedbackService(repositoryClient.repository)
  anonymousFeedbackServices.set(householdId, service)
  return service
}

if (workerHouseholdConfigurationRepositoryClient) {
  shutdownTasks.push(workerHouseholdConfigurationRepositoryClient.close)
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

if (topicMessageHistoryRepositoryClient) {
  shutdownTasks.push(topicMessageHistoryRepositoryClient.close)
}

if (purchaseRepositoryClient && workerHouseholdConfigurationRepositoryClient) {
  registerConfiguredPurchaseTopicIngestion(
    bot,
    workerHouseholdConfigurationRepositoryClient.repository,
    purchaseRepositoryClient.repository,
    {
      ...(topicProcessor
        ? {
            topicProcessor,
            contextCache: householdContextCache,
            memoryStore: assistantMemoryStore,
            ...(topicMessageHistoryRepositoryClient
              ? {
                  historyRepository: topicMessageHistoryRepositoryClient.repository
                }
              : {})
          }
        : {}),
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
    workerHouseholdConfigurationRepositoryClient.repository,
    telegramPendingActionRepositoryClient!.repository,
    financeServiceForHousehold,
    paymentConfirmationServiceForHousehold,
    {
      ...(topicProcessor
        ? {
            topicProcessor,
            contextCache: householdContextCache,
            memoryStore: assistantMemoryStore,
            ...(topicMessageHistoryRepositoryClient
              ? {
                  historyRepository: topicMessageHistoryRepositoryClient.repository
                }
              : {})
          }
        : {}),
      logger: getLogger('payment-ingestion')
    }
  )
} else {
  logger.warn(
    {
      event: 'runtime.feature_disabled',
      feature: 'purchase-topic-ingestion'
    },
    'Purchase topic ingestion is disabled. Set WORKER_DATABASE_URL to enable Telegram topic lookups.'
  )
}

if (runtime.financeCommandsEnabled) {
  const financeCommands = createFinanceCommandsService({
    householdConfigurationRepository: workerHouseholdConfigurationRepositoryClient!.repository,
    financeServiceForHousehold,
    ...(runtime.miniAppUrl
      ? {
          miniAppUrl: runtime.miniAppUrl,
          botUsername: bot.botInfo?.username
        }
      : {})
  })

  financeCommands.register(bot)
} else {
  logger.warn(
    {
      event: 'runtime.feature_disabled',
      feature: 'finance-commands'
    },
    'Finance commands are disabled. Set WORKER_DATABASE_URL to enable household lookups.'
  )
}

if (workerHouseholdConfigurationRepositoryClient) {
  registerHouseholdSetupCommands({
    bot,
    householdSetupService: createHouseholdSetupService(
      workerHouseholdConfigurationRepositoryClient.repository
    ),
    householdAdminService: createHouseholdAdminService(
      workerHouseholdConfigurationRepositoryClient.repository
    ),
    householdOnboardingService: householdOnboardingService!,
    householdConfigurationRepository: workerHouseholdConfigurationRepositoryClient.repository,
    ...(telegramPendingActionRepositoryClient
      ? {
          promptRepository: telegramPendingActionRepositoryClient.repository
        }
      : {}),
    ...(runtime.miniAppUrl
      ? {
          miniAppUrl: runtime.miniAppUrl
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
    'Household setup commands are disabled. Set WORKER_DATABASE_URL to enable.'
  )
}

const reminderJobs = runtime.reminderJobsEnabled
  ? (() => {
      const reminderRepositoryClient = createDbReminderDispatchRepository(
        runtime.workerDatabaseUrl!
      )
      const reminderService = createReminderJobService(reminderRepositoryClient.repository)

      shutdownTasks.push(reminderRepositoryClient.close)

      return createReminderJobsHandler({
        listReminderTargets: () =>
          workerHouseholdConfigurationRepositoryClient!.repository.listReminderTargets(),
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
        ...(runtime.miniAppUrl
          ? {
              miniAppUrl: runtime.miniAppUrl
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
    'Reminder jobs are disabled. Set WORKER_DATABASE_URL and either SCHEDULER_SHARED_SECRET or SCHEDULER_OIDC_ALLOWED_EMAILS to enable.'
  )
}

if (
  runtime.anonymousFeedbackEnabled &&
  workerHouseholdConfigurationRepositoryClient &&
  telegramPendingActionRepositoryClient
) {
  registerAnonymousFeedback({
    bot,
    anonymousFeedbackServiceForHousehold,
    householdConfigurationRepository: workerHouseholdConfigurationRepositoryClient!.repository,
    promptRepository: telegramPendingActionRepositoryClient!.repository,
    logger: getLogger('anonymous-feedback')
  })
} else {
  logger.warn(
    {
      event: 'runtime.feature_disabled',
      feature: 'anonymous-feedback'
    },
    'Anonymous feedback is disabled. Set WORKER_DATABASE_URL to enable household and topic lookups.'
  )
}

if (
  runtime.assistantEnabled &&
  workerHouseholdConfigurationRepositoryClient &&
  telegramPendingActionRepositoryClient
) {
  if (processedBotMessageRepositoryClient) {
    registerDmAssistant({
      bot,
      householdConfigurationRepository: workerHouseholdConfigurationRepositoryClient.repository,
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
      ...(topicMessageHistoryRepositoryClient
        ? {
            topicMessageHistoryRepository: topicMessageHistoryRepositoryClient.repository
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
      householdConfigurationRepository: workerHouseholdConfigurationRepositoryClient.repository,
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
      ...(topicMessageHistoryRepositoryClient
        ? {
            topicMessageHistoryRepository: topicMessageHistoryRepositoryClient.repository
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

if (workerHouseholdConfigurationRepositoryClient && telegramPendingActionRepositoryClient) {
  registerReminderTopicUtilities({
    bot,
    householdConfigurationRepository: workerHouseholdConfigurationRepositoryClient.repository,
    promptRepository: telegramPendingActionRepositoryClient.repository,
    financeServiceForHousehold,
    logger: getLogger('reminder-utilities')
  })
}

const server = createBotWebhookServer({
  webhookPath: runtime.telegramWebhookPath,
  webhookSecret: runtime.telegramWebhookSecret,
  webhookHandler,
  miniAppAuth: runtime.miniAppAuthEnabled
    ? createMiniAppAuthHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingServiceForTelegramUserId: appOnboardingServiceForTelegramUserId,
        logger: getLogger('miniapp-auth')
      })
    : undefined,
  miniAppJoin: runtime.miniAppAuthEnabled
    ? createMiniAppJoinHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingServiceForTelegramUserId: appOnboardingServiceForTelegramUserId,
        logger: getLogger('miniapp-auth')
      })
    : undefined,
  miniAppDashboard: runtime.miniAppAuthEnabled
    ? createMiniAppDashboardHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        financeServiceForSession: appFinanceServiceForSession,
        onboardingServiceForTelegramUserId: appOnboardingServiceForTelegramUserId,
        logger: getLogger('miniapp-dashboard')
      })
    : undefined,
  miniAppPendingMembers: runtime.miniAppAuthEnabled
    ? createMiniAppPendingMembersHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingServiceForTelegramUserId: appOnboardingServiceForTelegramUserId,
        miniAppAdminServiceForSession: appMiniAppAdminServiceForSession,
        logger: getLogger('miniapp-admin')
      })
    : undefined,
  miniAppApproveMember: runtime.miniAppAuthEnabled
    ? createMiniAppApproveMemberHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingServiceForTelegramUserId: appOnboardingServiceForTelegramUserId,
        miniAppAdminServiceForSession: appMiniAppAdminServiceForSession,
        logger: getLogger('miniapp-admin')
      })
    : undefined,
  miniAppRejectMember: runtime.miniAppAuthEnabled
    ? createMiniAppRejectMemberHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingServiceForTelegramUserId: appOnboardingServiceForTelegramUserId,
        miniAppAdminServiceForSession: appMiniAppAdminServiceForSession,
        logger: getLogger('miniapp-admin')
      })
    : undefined,
  miniAppSettings: runtime.miniAppAuthEnabled
    ? createMiniAppSettingsHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingServiceForTelegramUserId: appOnboardingServiceForTelegramUserId,
        miniAppAdminServiceForSession: appMiniAppAdminServiceForSession,
        assistantUsageTracker,
        logger: getLogger('miniapp-admin')
      })
    : undefined,
  miniAppUpdateSettings: runtime.miniAppAuthEnabled
    ? createMiniAppUpdateSettingsHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingServiceForTelegramUserId: appOnboardingServiceForTelegramUserId,
        miniAppAdminServiceForSession: appMiniAppAdminServiceForSession,
        logger: getLogger('miniapp-admin')
      })
    : undefined,
  miniAppUpsertUtilityCategory: runtime.miniAppAuthEnabled
    ? createMiniAppUpsertUtilityCategoryHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingServiceForTelegramUserId: appOnboardingServiceForTelegramUserId,
        miniAppAdminServiceForSession: appMiniAppAdminServiceForSession,
        logger: getLogger('miniapp-admin')
      })
    : undefined,
  miniAppPromoteMember: runtime.miniAppAuthEnabled
    ? createMiniAppPromoteMemberHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingServiceForTelegramUserId: appOnboardingServiceForTelegramUserId,
        miniAppAdminServiceForSession: appMiniAppAdminServiceForSession,
        logger: getLogger('miniapp-admin')
      })
    : undefined,
  miniAppUpdateOwnDisplayName: runtime.miniAppAuthEnabled
    ? createMiniAppUpdateOwnDisplayNameHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingServiceForTelegramUserId: appOnboardingServiceForTelegramUserId,
        miniAppAdminServiceForSession: appMiniAppAdminServiceForSession,
        logger: getLogger('miniapp-admin')
      })
    : undefined,
  miniAppUpdateMemberDisplayName: runtime.miniAppAuthEnabled
    ? createMiniAppUpdateMemberDisplayNameHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingServiceForTelegramUserId: appOnboardingServiceForTelegramUserId,
        miniAppAdminServiceForSession: appMiniAppAdminServiceForSession,
        logger: getLogger('miniapp-admin')
      })
    : undefined,
  miniAppUpdateMemberRentWeight: runtime.miniAppAuthEnabled
    ? createMiniAppUpdateMemberRentWeightHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingServiceForTelegramUserId: appOnboardingServiceForTelegramUserId,
        miniAppAdminServiceForSession: appMiniAppAdminServiceForSession,
        logger: getLogger('miniapp-admin')
      })
    : undefined,
  miniAppUpdateMemberStatus: runtime.miniAppAuthEnabled
    ? createMiniAppUpdateMemberStatusHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingServiceForTelegramUserId: appOnboardingServiceForTelegramUserId,
        miniAppAdminServiceForSession: appMiniAppAdminServiceForSession,
        logger: getLogger('miniapp-admin')
      })
    : undefined,
  miniAppUpdateMemberAbsencePolicy: runtime.miniAppAuthEnabled
    ? createMiniAppUpdateMemberAbsencePolicyHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingServiceForTelegramUserId: appOnboardingServiceForTelegramUserId,
        miniAppAdminServiceForSession: appMiniAppAdminServiceForSession,
        logger: getLogger('miniapp-admin')
      })
    : undefined,
  miniAppBillingCycle: runtime.miniAppAuthEnabled
    ? createMiniAppBillingCycleHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingServiceForTelegramUserId: appOnboardingServiceForTelegramUserId,
        financeServiceForSession: appFinanceServiceForSession,
        logger: getLogger('miniapp-billing')
      })
    : undefined,
  miniAppOpenCycle: runtime.miniAppAuthEnabled
    ? createMiniAppOpenCycleHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingServiceForTelegramUserId: appOnboardingServiceForTelegramUserId,
        financeServiceForSession: appFinanceServiceForSession,
        logger: getLogger('miniapp-billing')
      })
    : undefined,
  miniAppCloseCycle: runtime.miniAppAuthEnabled
    ? createMiniAppCloseCycleHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingServiceForTelegramUserId: appOnboardingServiceForTelegramUserId,
        financeServiceForSession: appFinanceServiceForSession,
        logger: getLogger('miniapp-billing')
      })
    : undefined,
  miniAppRentUpdate: runtime.miniAppAuthEnabled
    ? createMiniAppRentUpdateHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingServiceForTelegramUserId: appOnboardingServiceForTelegramUserId,
        financeServiceForSession: appFinanceServiceForSession,
        logger: getLogger('miniapp-billing')
      })
    : undefined,
  miniAppAddUtilityBill: runtime.miniAppAuthEnabled
    ? createMiniAppAddUtilityBillHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingServiceForTelegramUserId: appOnboardingServiceForTelegramUserId,
        financeServiceForSession: appFinanceServiceForSession,
        logger: getLogger('miniapp-billing')
      })
    : undefined,
  miniAppSubmitUtilityBill: runtime.miniAppAuthEnabled
    ? createMiniAppSubmitUtilityBillHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingServiceForTelegramUserId: appOnboardingServiceForTelegramUserId,
        financeServiceForSession: appFinanceServiceForSession,
        logger: getLogger('miniapp-billing')
      })
    : undefined,
  miniAppUpdateUtilityBill: runtime.miniAppAuthEnabled
    ? createMiniAppUpdateUtilityBillHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingServiceForTelegramUserId: appOnboardingServiceForTelegramUserId,
        financeServiceForSession: appFinanceServiceForSession,
        logger: getLogger('miniapp-billing')
      })
    : undefined,
  miniAppDeleteUtilityBill: runtime.miniAppAuthEnabled
    ? createMiniAppDeleteUtilityBillHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingServiceForTelegramUserId: appOnboardingServiceForTelegramUserId,
        financeServiceForSession: appFinanceServiceForSession,
        logger: getLogger('miniapp-billing')
      })
    : undefined,
  miniAppAddPurchase: runtime.miniAppAuthEnabled
    ? createMiniAppAddPurchaseHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingServiceForTelegramUserId: appOnboardingServiceForTelegramUserId,
        financeServiceForSession: appFinanceServiceForSession,
        logger: getLogger('miniapp-billing')
      })
    : undefined,
  miniAppUpdatePurchase: runtime.miniAppAuthEnabled
    ? createMiniAppUpdatePurchaseHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingServiceForTelegramUserId: appOnboardingServiceForTelegramUserId,
        financeServiceForSession: appFinanceServiceForSession,
        logger: getLogger('miniapp-billing')
      })
    : undefined,
  miniAppDeletePurchase: runtime.miniAppAuthEnabled
    ? createMiniAppDeletePurchaseHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingServiceForTelegramUserId: appOnboardingServiceForTelegramUserId,
        financeServiceForSession: appFinanceServiceForSession,
        logger: getLogger('miniapp-billing')
      })
    : undefined,
  miniAppAddPayment: runtime.miniAppAuthEnabled
    ? createMiniAppAddPaymentHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingServiceForTelegramUserId: appOnboardingServiceForTelegramUserId,
        financeServiceForSession: appFinanceServiceForSession,
        logger: getLogger('miniapp-billing')
      })
    : undefined,
  miniAppUpdatePayment: runtime.miniAppAuthEnabled
    ? createMiniAppUpdatePaymentHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingServiceForTelegramUserId: appOnboardingServiceForTelegramUserId,
        financeServiceForSession: appFinanceServiceForSession,
        logger: getLogger('miniapp-billing')
      })
    : undefined,
  miniAppDeletePayment: runtime.miniAppAuthEnabled
    ? createMiniAppDeletePaymentHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingServiceForTelegramUserId: appOnboardingServiceForTelegramUserId,
        financeServiceForSession: appFinanceServiceForSession,
        logger: getLogger('miniapp-billing')
      })
    : undefined,
  miniAppLocalePreference: runtime.miniAppAuthEnabled
    ? createMiniAppLocalePreferenceHandler({
        allowedOrigins: runtime.miniAppAllowedOrigins,
        botToken: runtime.telegramBotToken,
        onboardingServiceForTelegramUserId: appOnboardingServiceForTelegramUserId,
        localePreferenceServiceForSession: appLocalePreferenceServiceForSession,
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
