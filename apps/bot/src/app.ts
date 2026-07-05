import { webhookCallback } from 'grammy'

import {
  createAdHocNotificationService,
  createHouseholdAuditNotificationService,
  createHouseholdAdminService,
  createHouseholdOnboardingService,
  createHouseholdSetupService,
  createLocalePreferenceService,
  createMiniAppAdminService
} from '@household/application'
import { configureLogger, getLogger } from '@household/observability'

import { registerAdHocNotifications } from './ad-hoc-notifications'
import { registerAuditNotificationCallbacks } from './audit-notifications'
import { registerAnonymousFeedback } from './anonymous-feedback'
import {
  createInMemoryAssistantConversationMemoryStore,
  createInMemoryAssistantRateLimiter,
  createInMemoryAssistantUsageTracker
} from './assistant-state'
import { createFinanceCommandsService } from './finance-commands'
import { createTelegramBot } from './bot'
import { getBotRuntimeConfig, type BotRuntimeConfig } from './config'
import { registerHouseholdSetupCommands } from './household-setup'
import { HouseholdContextCache } from './household-context-cache'
import { createMiniAppAuthHandler, createMiniAppJoinHandler } from './miniapp-auth'
import {
  createMiniAppApproveMemberHandler,
  createMiniAppPendingMembersHandler,
  createMiniAppPromoteMemberHandler,
  createMiniAppDemoteMemberHandler,
  createMiniAppRejectMemberHandler,
  createMiniAppSettingsHandler,
  createMiniAppUpdateMemberDisplayNameHandler,
  createMiniAppUpdateMemberRentWeightHandler,
  createMiniAppUpdateMemberStatusHandler,
  createMiniAppUpdateMemberPresenceDaysHandler,
  createMiniAppUpdateOwnDisplayNameHandler,
  createMiniAppUpdateSettingsHandler,
  createMiniAppUpsertUtilityCategoryHandler
} from './miniapp-admin'
import { createMiniAppDashboardHandler } from './miniapp-dashboard'
import {
  createMiniAppAddPaymentHandler,
  createMiniAppAddPurchaseHandler,
  createMiniAppAddUtilityBillHandler,
  createMiniAppBillingCycleHandler,
  createMiniAppClosePaymentPeriodHandler,
  createMiniAppCloseCycleHandler,
  createMiniAppDeletePaymentHandler,
  createMiniAppDeletePurchaseHandler,
  createMiniAppDeleteUtilityBillHandler,
  createMiniAppOpenCycleHandler,
  createMiniAppRecordUtilityVendorPaymentHandler,
  createMiniAppRentUpdateHandler,
  createMiniAppResolveUtilityPlanHandler,
  createMiniAppSubmitUtilityBillHandler,
  createMiniAppUpdatePaymentHandler,
  createMiniAppUpdatePurchaseHandler,
  createMiniAppUpdateUtilityBillHandler
} from './miniapp-billing'
import { createMiniAppLocalePreferenceHandler } from './miniapp-locale'
import {
  createMiniAppCancelNotificationHandler,
  createMiniAppUpdateNotificationHandler
} from './miniapp-notifications'
import { createOpenAiAdHocNotificationInterpreter } from './openai-ad-hoc-notification-interpreter'
import { registerAgentActionCallbacks } from './agent-confirmations'
import { registerHouseholdAgent } from './household-agent'
import { registerPurchaseTopicCallbacks } from './purchase-topic-ingestion'
import { createPurchaseTopicNoticeService } from './purchase-topic-notices'
import { registerPaymentTopicCallbacks } from './payment-topic-ingestion'
import { createOpenAiWakeClassifier } from './wake-gate'
import { createPaymentInstructionPublisher } from './payment-instruction-publisher'
import { registerPaymentReminderActions } from './payment-reminder-actions'
import { registerReminderTopicUtilities } from './reminder-topic-utilities'
import { createSchedulerRequestAuthorizer } from './scheduler-auth'
import { createScheduledDispatchHandler } from './scheduled-dispatch-handler'
import { createBotWebhookServer } from './server'
import { createTelegramTransport } from './runtime/telegram-transport'
import { createFinanceServiceRegistry } from './runtime/finance-service-registry'
import { createBotRepositoryClients } from './runtime/repositories'
import { createScheduledDispatchRuntime } from './runtime/scheduled-dispatch-runtime'
import { createAnonymousFeedbackServiceRegistry } from './runtime/anonymous-feedback-registry'

export interface BotRuntimeApp {
  readonly fetch: (request: Request) => Promise<Response>
  readonly shutdown: () => Promise<void>
  readonly runtime: BotRuntimeConfig
}

export async function createBotRuntimeApp(): Promise<BotRuntimeApp> {
  const runtime = getBotRuntimeConfig()

  configureLogger({
    level: runtime.logLevel,
    service: '@household/bot'
  })

  const logger = getLogger('runtime')
  const shutdownTasks: Array<() => Promise<void>> = []
  const repositoryClients = createBotRepositoryClients(runtime)
  shutdownTasks.push(repositoryClients.close)
  const {
    householdConfiguration: householdConfigurationRepositoryClient,
    scheduledDispatch: scheduledDispatchRepositoryClient,
    telegramPendingAction: telegramPendingActionRepositoryClient,
    processedBotMessage: processedBotMessageRepositoryClient,
    purchaseMessages: purchaseRepositoryClient,
    topicMessageHistory: topicMessageHistoryRepositoryClient,
    adHocNotification: adHocNotificationRepositoryClient,
    auditNotification: auditNotificationRepositoryClient
  } = repositoryClients
  const bot = createTelegramBot(
    runtime.telegramBotToken,
    getLogger('telegram'),
    householdConfigurationRepositoryClient?.repository,
    {
      homeMenuAvailable: Boolean(householdConfigurationRepositoryClient),
      miniAppAvailable: Boolean(runtime.miniAppUrl),
      anonymousFeedbackAvailable: runtime.anonymousFeedbackEnabled,
      financeCommandsAvailable: runtime.financeCommandsEnabled,
      setupCommandsAvailable: Boolean(householdConfigurationRepositoryClient)
    }
  )
  bot.botInfo = await bot.api.getMe()
  const webhookHandler = webhookCallback(bot, 'std/http', {
    onTimeout: 'return'
  })
  const telegramTransport = createTelegramTransport(bot)
  const financeServiceRegistry =
    runtime.databaseUrl && householdConfigurationRepositoryClient
      ? createFinanceServiceRegistry({
          databaseUrl: runtime.databaseUrl,
          householdConfigurationRepository: householdConfigurationRepositoryClient.repository,
          exchangeRateLogger: getLogger('fx'),
          onClose: (task) => shutdownTasks.push(task)
        })
      : null
  const financeRepositoryForHousehold = (householdId: string) =>
    financeServiceRegistry!.financeRepositoryForHousehold(householdId)
  const financeServiceForHousehold = (householdId: string) =>
    financeServiceRegistry!.financeServiceForHousehold(householdId)
  const paymentConfirmationServiceForHousehold = (householdId: string) =>
    financeServiceRegistry!.paymentConfirmationServiceForHousehold(householdId)
  const householdOnboardingService = householdConfigurationRepositoryClient
    ? createHouseholdOnboardingService({
        repository: householdConfigurationRepositoryClient.repository
      })
    : null
  const scheduledDispatchRuntime = createScheduledDispatchRuntime({
    runtime,
    repository: scheduledDispatchRepositoryClient?.repository ?? null,
    householdConfigurationRepository: householdConfigurationRepositoryClient?.repository ?? null
  })
  const scheduledDispatchService = scheduledDispatchRuntime.service
  const localePreferenceService = householdConfigurationRepositoryClient
    ? createLocalePreferenceService(householdConfigurationRepositoryClient.repository)
    : null
  const adHocNotificationInterpreter = createOpenAiAdHocNotificationInterpreter({
    apiKey: runtime.openaiApiKey,
    parserModel: runtime.purchaseParserModel,
    rendererModel: runtime.assistantModel,
    timeoutMs: runtime.assistantTimeoutMs
  })
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
  const wakeClassifier = createOpenAiWakeClassifier(
    runtime.openaiApiKey,
    runtime.assistantModel,
    runtime.assistantTimeoutMs,
    getLogger('wake-gate')
  )
  const householdContextCache = new HouseholdContextCache()
  const anonymousFeedbackServiceRegistry = runtime.databaseUrl
    ? createAnonymousFeedbackServiceRegistry({
        databaseUrl: runtime.databaseUrl,
        onClose: (task) => shutdownTasks.push(task)
      })
    : null
  const auditNotificationService =
    auditNotificationRepositoryClient && householdConfigurationRepositoryClient
      ? createHouseholdAuditNotificationService({
          repository: auditNotificationRepositoryClient.repository,
          householdConfigurationRepository: householdConfigurationRepositoryClient.repository,
          sendTopicMessage: async (input) => {
            return telegramTransport.sendTopicMessage(input)
          },
          logger: getLogger('audit-notifications')
        })
      : null
  if (auditNotificationRepositoryClient) {
    registerAuditNotificationCallbacks({
      bot,
      repository: auditNotificationRepositoryClient.repository,
      logger: getLogger('audit-notifications')
    })
  }
  const adHocNotificationService =
    adHocNotificationRepositoryClient && householdConfigurationRepositoryClient
      ? createAdHocNotificationService({
          repository: adHocNotificationRepositoryClient.repository,
          householdConfigurationRepository: householdConfigurationRepositoryClient.repository,
          ...(scheduledDispatchService
            ? {
                scheduledDispatchService
              }
            : {})
        })
      : null
  const miniAppAdminService = householdConfigurationRepositoryClient
    ? createMiniAppAdminService(
        householdConfigurationRepositoryClient.repository,
        scheduledDispatchService ?? undefined,
        {
          resolveEffectiveFromPeriod: async (householdId) => {
            const repository = financeRepositoryForHousehold(householdId)
            const cycle = (await repository.getOpenCycle()) ?? (await repository.getLatestCycle())
            return cycle?.period ?? null
          }
        },
        auditNotificationRepositoryClient?.repository
      )
    : null

  const anonymousFeedbackServiceForHousehold = (householdId: string) =>
    anonymousFeedbackServiceRegistry!.serviceForHousehold(householdId)

  const paymentInstructionPublisher =
    householdConfigurationRepositoryClient && processedBotMessageRepositoryClient
      ? createPaymentInstructionPublisher({
          householdConfigurationRepository: householdConfigurationRepositoryClient.repository,
          financeServiceForHousehold,
          processedBotMessageRepository: processedBotMessageRepositoryClient.repository,
          sendTopicMessage: async (input) => {
            await telegramTransport.sendTopicMessage(input)
          },
          ...(runtime.miniAppUrl ? { miniAppUrl: runtime.miniAppUrl } : {}),
          ...(bot.botInfo?.username ? { botUsername: bot.botInfo.username } : {}),
          logger: getLogger('payment-instructions')
        })
      : null

  const purchaseTopicNoticeService =
    runtime.databaseUrl && householdConfigurationRepositoryClient
      ? createPurchaseTopicNoticeService({
          bot,
          householdConfigurationRepository: householdConfigurationRepositoryClient.repository,
          financeRepositoryForHousehold: (householdId) =>
            financeRepositoryForHousehold(householdId),
          financeServiceForHousehold,
          logger: getLogger('purchase-topic-notices')
        })
      : null

  if (purchaseRepositoryClient && householdConfigurationRepositoryClient) {
    registerPurchaseTopicCallbacks(
      bot,
      householdConfigurationRepositoryClient.repository,
      purchaseRepositoryClient.repository,
      {
        ...(topicMessageHistoryRepositoryClient
          ? {
              historyRepository: topicMessageHistoryRepositoryClient.repository
            }
          : {}),
        ...(auditNotificationService ? { auditNotificationService } : {}),
        ...(purchaseTopicNoticeService ? { purchaseTopicNoticeService } : {}),
        logger: getLogger('purchase-ingestion')
      }
    )

    registerPaymentTopicCallbacks(
      bot,
      householdConfigurationRepositoryClient.repository,
      telegramPendingActionRepositoryClient!.repository,
      financeServiceForHousehold,
      paymentConfirmationServiceForHousehold,
      {
        memoryStore: assistantMemoryStore,
        ...(topicMessageHistoryRepositoryClient
          ? {
              historyRepository: topicMessageHistoryRepositoryClient.repository
            }
          : {}),
        logger: getLogger('payment-ingestion'),
        ...(auditNotificationService ? { auditNotificationService } : {})
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
      financeServiceForHousehold,
      ...(telegramPendingActionRepositoryClient
        ? {
            promptRepository: telegramPendingActionRepositoryClient.repository
          }
        : {}),
      ...(runtime.miniAppUrl
        ? {
            miniAppUrl: runtime.miniAppUrl,
            botUsername: bot.botInfo?.username
          }
        : {}),
      ...(auditNotificationService ? { auditNotificationService } : {})
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
        householdConfigurationRepositoryClient.repository,
        scheduledDispatchService ?? undefined
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
      ...(runtime.miniAppUrl
        ? {
            miniAppUrl: runtime.miniAppUrl
          }
        : {}),
      anonymousFeedbackAvailable: runtime.anonymousFeedbackEnabled,
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

  if (householdConfigurationRepositoryClient && telegramPendingActionRepositoryClient) {
    registerReminderTopicUtilities({
      bot,
      householdConfigurationRepository: householdConfigurationRepositoryClient.repository,
      promptRepository: telegramPendingActionRepositoryClient.repository,
      financeServiceForHousehold,
      ...(paymentInstructionPublisher ? { paymentInstructionPublisher } : {}),
      logger: getLogger('reminder-utilities')
    })
  }

  if (
    householdConfigurationRepositoryClient &&
    telegramPendingActionRepositoryClient &&
    adHocNotificationService
  ) {
    registerAdHocNotifications({
      bot,
      householdConfigurationRepository: householdConfigurationRepositoryClient.repository,
      promptRepository: telegramPendingActionRepositoryClient.repository,
      notificationService: adHocNotificationService,
      reminderInterpreter: adHocNotificationInterpreter,
      logger: getLogger('ad-hoc-notifications')
    })
  }

  const scheduledDispatchHandler =
    scheduledDispatchService &&
    adHocNotificationRepositoryClient &&
    householdConfigurationRepositoryClient
      ? createScheduledDispatchHandler({
          scheduledDispatchService,
          adHocNotificationRepository: adHocNotificationRepositoryClient.repository,
          householdConfigurationRepository: householdConfigurationRepositoryClient.repository,
          sendTopicMessage: async (input) => {
            await telegramTransport.sendTopicMessage(input)
          },
          sendDirectMessage: async (input) => {
            await telegramTransport.sendDirectMessage(input)
          },
          financeServiceForHousehold,
          ...(paymentInstructionPublisher ? { paymentInstructionPublisher } : {}),
          ...(auditNotificationService
            ? {
                auditNotificationService
              }
            : {}),
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
      : null

  if (!scheduledDispatchHandler) {
    logger.warn(
      {
        event: 'runtime.feature_disabled',
        feature: 'scheduled-dispatch'
      },
      'Scheduled dispatch is disabled. Configure DATABASE_URL and SCHEDULED_DISPATCH_PROVIDER to enable reminder delivery.'
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
      householdConfigurationRepository: householdConfigurationRepositoryClient.repository,
      promptRepository: telegramPendingActionRepositoryClient.repository,
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
    runtime.openaiApiKey &&
    householdConfigurationRepositoryClient &&
    telegramPendingActionRepositoryClient
  ) {
    registerAgentActionCallbacks(bot, {
      promptRepository: telegramPendingActionRepositoryClient.repository,
      financeServiceForHousehold,
      ...(auditNotificationService ? { auditNotificationService } : {}),
      logger: getLogger('agent-actions')
    })

    registerHouseholdAgent(bot, {
      householdConfigurationRepository: householdConfigurationRepositoryClient.repository,
      financeServiceForHousehold,
      promptRepository: telegramPendingActionRepositoryClient.repository,
      apiKey: runtime.openaiApiKey,
      model: runtime.assistantModel,
      timeoutMs: runtime.assistantTimeoutMs,
      ...(purchaseRepositoryClient
        ? { purchaseRepository: purchaseRepositoryClient.repository }
        : {}),
      ...(topicMessageHistoryRepositoryClient
        ? { historyRepository: topicMessageHistoryRepositoryClient.repository }
        : {}),
      memoryStore: assistantMemoryStore,
      rateLimiter: assistantRateLimiter,
      usageTracker: assistantUsageTracker,
      contextCache: householdContextCache,
      ...(processedBotMessageRepositoryClient
        ? { processedBotMessageRepository: processedBotMessageRepositoryClient.repository }
        : {}),
      ...(wakeClassifier ? { wakeClassifier } : {}),
      logger: getLogger('household-agent')
    })
  } else {
    logger.warn(
      {
        event: 'runtime.feature_disabled',
        feature: 'household-agent'
      },
      'Household agent is disabled. Set DATABASE_URL and OPENAI_API_KEY to enable group chat handling.'
    )
  }

  if (householdConfigurationRepositoryClient && telegramPendingActionRepositoryClient) {
    registerPaymentReminderActions({
      bot,
      householdConfigurationRepository: householdConfigurationRepositoryClient.repository,
      financeServiceForHousehold,
      ...(auditNotificationService ? { auditNotificationService } : {}),
      ...(runtime.miniAppUrl ? { miniAppUrl: runtime.miniAppUrl } : {}),
      ...(bot.botInfo?.username ? { botUsername: bot.botInfo.username } : {}),
      logger: getLogger('payment-reminders')
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
          adHocNotificationService: adHocNotificationService!,
          onboardingService: householdOnboardingService,
          ...(householdConfigurationRepositoryClient
            ? {
                householdConfigurationRepository: householdConfigurationRepositoryClient.repository
              }
            : {}),
          logger: getLogger('miniapp-dashboard')
        })
      : undefined,
    miniAppUpdateNotification:
      householdOnboardingService && adHocNotificationService
        ? createMiniAppUpdateNotificationHandler({
            allowedOrigins: runtime.miniAppAllowedOrigins,
            botToken: runtime.telegramBotToken,
            onboardingService: householdOnboardingService,
            adHocNotificationService,
            logger: getLogger('miniapp-notifications')
          })
        : undefined,
    miniAppCancelNotification:
      householdOnboardingService && adHocNotificationService
        ? createMiniAppCancelNotificationHandler({
            allowedOrigins: runtime.miniAppAllowedOrigins,
            botToken: runtime.telegramBotToken,
            onboardingService: householdOnboardingService,
            adHocNotificationService,
            logger: getLogger('miniapp-notifications')
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
    miniAppRejectMember: householdOnboardingService
      ? createMiniAppRejectMemberHandler({
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
          onSettingsUpdated: (householdId) => householdContextCache.invalidate(householdId),
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
    miniAppDemoteMember: householdOnboardingService
      ? createMiniAppDemoteMemberHandler({
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
    miniAppUpdateMemberPresenceDays: householdOnboardingService
      ? createMiniAppUpdateMemberPresenceDaysHandler({
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
          ...(auditNotificationService ? { auditNotificationService } : {}),
          logger: getLogger('miniapp-billing')
        })
      : undefined,
    miniAppOpenCycle: householdOnboardingService
      ? createMiniAppOpenCycleHandler({
          allowedOrigins: runtime.miniAppAllowedOrigins,
          botToken: runtime.telegramBotToken,
          onboardingService: householdOnboardingService,
          financeServiceForHousehold,
          ...(auditNotificationService ? { auditNotificationService } : {}),
          logger: getLogger('miniapp-billing')
        })
      : undefined,
    miniAppCloseCycle: householdOnboardingService
      ? createMiniAppCloseCycleHandler({
          allowedOrigins: runtime.miniAppAllowedOrigins,
          botToken: runtime.telegramBotToken,
          onboardingService: householdOnboardingService,
          financeServiceForHousehold,
          ...(auditNotificationService ? { auditNotificationService } : {}),
          logger: getLogger('miniapp-billing')
        })
      : undefined,
    miniAppRentUpdate: householdOnboardingService
      ? createMiniAppRentUpdateHandler({
          allowedOrigins: runtime.miniAppAllowedOrigins,
          botToken: runtime.telegramBotToken,
          onboardingService: householdOnboardingService,
          financeServiceForHousehold,
          ...(auditNotificationService ? { auditNotificationService } : {}),
          logger: getLogger('miniapp-billing')
        })
      : undefined,
    miniAppAddUtilityBill: householdOnboardingService
      ? createMiniAppAddUtilityBillHandler({
          allowedOrigins: runtime.miniAppAllowedOrigins,
          botToken: runtime.telegramBotToken,
          onboardingService: householdOnboardingService,
          financeServiceForHousehold,
          ...(auditNotificationService ? { auditNotificationService } : {}),
          logger: getLogger('miniapp-billing')
        })
      : undefined,
    miniAppSubmitUtilityBill: householdOnboardingService
      ? createMiniAppSubmitUtilityBillHandler({
          allowedOrigins: runtime.miniAppAllowedOrigins,
          botToken: runtime.telegramBotToken,
          onboardingService: householdOnboardingService,
          financeServiceForHousehold,
          ...(auditNotificationService ? { auditNotificationService } : {}),
          logger: getLogger('miniapp-billing')
        })
      : undefined,
    miniAppUpdateUtilityBill: householdOnboardingService
      ? createMiniAppUpdateUtilityBillHandler({
          allowedOrigins: runtime.miniAppAllowedOrigins,
          botToken: runtime.telegramBotToken,
          onboardingService: householdOnboardingService,
          financeServiceForHousehold,
          ...(auditNotificationService ? { auditNotificationService } : {}),
          logger: getLogger('miniapp-billing')
        })
      : undefined,
    miniAppDeleteUtilityBill: householdOnboardingService
      ? createMiniAppDeleteUtilityBillHandler({
          allowedOrigins: runtime.miniAppAllowedOrigins,
          botToken: runtime.telegramBotToken,
          onboardingService: householdOnboardingService,
          financeServiceForHousehold,
          ...(auditNotificationService ? { auditNotificationService } : {}),
          logger: getLogger('miniapp-billing')
        })
      : undefined,
    miniAppAddPurchase:
      householdOnboardingService && adHocNotificationService
        ? createMiniAppAddPurchaseHandler({
            allowedOrigins: runtime.miniAppAllowedOrigins,
            botToken: runtime.telegramBotToken,
            onboardingService: householdOnboardingService,
            financeServiceForHousehold,
            adHocNotificationService,
            ...(auditNotificationService ? { auditNotificationService } : {}),
            ...(purchaseTopicNoticeService ? { purchaseTopicNoticeService } : {}),
            ...(householdConfigurationRepositoryClient
              ? {
                  householdConfigurationRepository:
                    householdConfigurationRepositoryClient.repository
                }
              : {}),
            logger: getLogger('miniapp-billing')
          })
        : undefined,
    miniAppUpdatePurchase:
      householdOnboardingService && adHocNotificationService
        ? createMiniAppUpdatePurchaseHandler({
            allowedOrigins: runtime.miniAppAllowedOrigins,
            botToken: runtime.telegramBotToken,
            onboardingService: householdOnboardingService,
            financeServiceForHousehold,
            adHocNotificationService,
            ...(auditNotificationService ? { auditNotificationService } : {}),
            ...(purchaseTopicNoticeService ? { purchaseTopicNoticeService } : {}),
            ...(householdConfigurationRepositoryClient
              ? {
                  householdConfigurationRepository:
                    householdConfigurationRepositoryClient.repository
                }
              : {}),
            logger: getLogger('miniapp-billing')
          })
        : undefined,
    miniAppDeletePurchase:
      householdOnboardingService && adHocNotificationService
        ? createMiniAppDeletePurchaseHandler({
            allowedOrigins: runtime.miniAppAllowedOrigins,
            botToken: runtime.telegramBotToken,
            onboardingService: householdOnboardingService,
            financeServiceForHousehold,
            adHocNotificationService,
            ...(auditNotificationService ? { auditNotificationService } : {}),
            ...(purchaseTopicNoticeService ? { purchaseTopicNoticeService } : {}),
            ...(householdConfigurationRepositoryClient
              ? {
                  householdConfigurationRepository:
                    householdConfigurationRepositoryClient.repository
                }
              : {}),
            logger: getLogger('miniapp-billing')
          })
        : undefined,
    miniAppAddPayment: householdOnboardingService
      ? createMiniAppAddPaymentHandler({
          allowedOrigins: runtime.miniAppAllowedOrigins,
          botToken: runtime.telegramBotToken,
          onboardingService: householdOnboardingService,
          financeServiceForHousehold,
          ...(auditNotificationService ? { auditNotificationService } : {}),
          logger: getLogger('miniapp-billing')
        })
      : undefined,
    miniAppClosePaymentPeriod:
      householdOnboardingService && adHocNotificationService
        ? createMiniAppClosePaymentPeriodHandler({
            allowedOrigins: runtime.miniAppAllowedOrigins,
            botToken: runtime.telegramBotToken,
            onboardingService: householdOnboardingService,
            financeServiceForHousehold,
            adHocNotificationService,
            ...(auditNotificationService ? { auditNotificationService } : {}),
            ...(householdConfigurationRepositoryClient
              ? {
                  householdConfigurationRepository:
                    householdConfigurationRepositoryClient.repository
                }
              : {}),
            logger: getLogger('miniapp-billing')
          })
        : undefined,
    miniAppUpdatePayment: householdOnboardingService
      ? createMiniAppUpdatePaymentHandler({
          allowedOrigins: runtime.miniAppAllowedOrigins,
          botToken: runtime.telegramBotToken,
          onboardingService: householdOnboardingService,
          financeServiceForHousehold,
          ...(auditNotificationService ? { auditNotificationService } : {}),
          logger: getLogger('miniapp-billing')
        })
      : undefined,
    miniAppDeletePayment: householdOnboardingService
      ? createMiniAppDeletePaymentHandler({
          allowedOrigins: runtime.miniAppAllowedOrigins,
          botToken: runtime.telegramBotToken,
          onboardingService: householdOnboardingService,
          financeServiceForHousehold,
          ...(auditNotificationService ? { auditNotificationService } : {}),
          logger: getLogger('miniapp-billing')
        })
      : undefined,
    miniAppResolveUtilityPlan: householdOnboardingService
      ? createMiniAppResolveUtilityPlanHandler({
          allowedOrigins: runtime.miniAppAllowedOrigins,
          botToken: runtime.telegramBotToken,
          onboardingService: householdOnboardingService,
          financeServiceForHousehold,
          ...(auditNotificationService ? { auditNotificationService } : {}),
          logger: getLogger('miniapp-billing')
        })
      : undefined,
    miniAppRecordUtilityVendorPayment: householdOnboardingService
      ? createMiniAppRecordUtilityVendorPaymentHandler({
          allowedOrigins: runtime.miniAppAllowedOrigins,
          botToken: runtime.telegramBotToken,
          onboardingService: householdOnboardingService,
          financeServiceForHousehold,
          ...(auditNotificationService ? { auditNotificationService } : {}),
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
      scheduledDispatchHandler && runtime.schedulerSharedSecret
        ? {
            pathPrefix: '/jobs',
            authorize: createSchedulerRequestAuthorizer({
              sharedSecret: runtime.schedulerSharedSecret,
              oidcAllowedEmails: runtime.schedulerOidcAllowedEmails
            }).authorize,
            handler: async (request, jobPath) => {
              if (jobPath === 'dispatch-due') {
                return scheduledDispatchHandler
                  ? scheduledDispatchHandler.handleDueDispatches(request)
                  : new Response('Not Found', { status: 404 })
              }

              if (jobPath.startsWith('dispatch/')) {
                return scheduledDispatchHandler
                  ? scheduledDispatchHandler.handle(request, jobPath.slice('dispatch/'.length))
                  : new Response('Not Found', { status: 404 })
              }

              return new Response('Not Found', { status: 404 })
            }
          }
        : scheduledDispatchHandler
          ? {
              pathPrefix: '/jobs',
              authorize: createSchedulerRequestAuthorizer({
                oidcAllowedEmails: runtime.schedulerOidcAllowedEmails
              }).authorize,
              handler: async (request, jobPath) => {
                if (jobPath === 'dispatch-due') {
                  return scheduledDispatchHandler
                    ? scheduledDispatchHandler.handleDueDispatches(request)
                    : new Response('Not Found', { status: 404 })
                }

                if (jobPath.startsWith('dispatch/')) {
                  return scheduledDispatchHandler
                    ? scheduledDispatchHandler.handle(request, jobPath.slice('dispatch/'.length))
                    : new Response('Not Found', { status: 404 })
                }

                return new Response('Not Found', { status: 404 })
              }
            }
          : undefined
  })

  if (scheduledDispatchService) {
    await scheduledDispatchService.reconcileAllBuiltInDispatches()
  }

  // The self-hosted provider has no external scheduler, so poll for due
  // dispatches in-process. gcp/aws are driven by their own scheduler calling
  // /jobs/dispatch-due, so we must not double-poll there.
  if (scheduledDispatchHandler && runtime.scheduledDispatch?.provider === 'self-hosted') {
    const schedulerLogger = getLogger('scheduler')
    const intervalMs = runtime.schedulerPollIntervalMs
    let pollTimer: ReturnType<typeof setTimeout> | undefined
    let stopped = false

    const tick = async () => {
      try {
        await scheduledDispatchHandler.handleDueDispatches(
          new Request('http://internal/jobs/dispatch-due?limit=25')
        )
      } catch (error) {
        schedulerLogger.error(
          {
            event: 'scheduler.in_process_tick_failed',
            error: error instanceof Error ? error.message : String(error)
          },
          'In-process scheduled dispatch poll failed'
        )
      } finally {
        if (!stopped) {
          pollTimer = setTimeout(() => void tick(), intervalMs)
        }
      }
    }

    pollTimer = setTimeout(() => void tick(), intervalMs)
    shutdownTasks.push(async () => {
      stopped = true
      if (pollTimer) {
        clearTimeout(pollTimer)
      }
    })

    schedulerLogger.info(
      { event: 'scheduler.in_process_poller_started', intervalMs },
      'In-process scheduled dispatch poller started'
    )
  }

  return {
    fetch: server.fetch,
    runtime,
    shutdown: async () => {
      await Promise.allSettled(shutdownTasks.map((close) => close()))
    }
  }
}
