import {
  createDbAdHocNotificationRepository,
  createDbAuditNotificationRepository,
  createDbHouseholdConfigurationRepository,
  createDbProcessedBotMessageRepository,
  createDbScheduledDispatchRepository,
  createDbTelegramPendingActionRepository,
  createDbTelegramPaymentCardRepository,
  createDbTopicMessageHistoryRepository
} from '@household/adapters-db'

import type { BotRuntimeConfig } from '../config'
import { createPurchaseMessageRepository } from '../adapters/purchase-message-repository'

export function createBotRepositoryClients(
  runtime: Pick<BotRuntimeConfig, 'databaseUrl' | 'scheduledDispatch'>
) {
  const householdConfiguration = runtime.databaseUrl
    ? createDbHouseholdConfigurationRepository(runtime.databaseUrl)
    : null
  const scheduledDispatch =
    runtime.databaseUrl && runtime.scheduledDispatch
      ? createDbScheduledDispatchRepository(runtime.databaseUrl)
      : null
  const telegramPendingAction = runtime.databaseUrl
    ? createDbTelegramPendingActionRepository(runtime.databaseUrl)
    : null
  const processedBotMessage = runtime.databaseUrl
    ? createDbProcessedBotMessageRepository(runtime.databaseUrl)
    : null
  const purchaseMessages = runtime.databaseUrl
    ? createPurchaseMessageRepository(runtime.databaseUrl)
    : null
  const topicMessageHistory = runtime.databaseUrl
    ? createDbTopicMessageHistoryRepository(runtime.databaseUrl)
    : null
  const adHocNotification = runtime.databaseUrl
    ? createDbAdHocNotificationRepository(runtime.databaseUrl)
    : null
  const auditNotification = runtime.databaseUrl
    ? createDbAuditNotificationRepository(runtime.databaseUrl)
    : null
  const paymentCards = runtime.databaseUrl
    ? createDbTelegramPaymentCardRepository(runtime.databaseUrl)
    : null

  const closeableClients = [
    householdConfiguration,
    scheduledDispatch,
    telegramPendingAction,
    processedBotMessage,
    purchaseMessages,
    topicMessageHistory,
    adHocNotification,
    auditNotification,
    paymentCards
  ]

  return {
    householdConfiguration,
    scheduledDispatch,
    telegramPendingAction,
    processedBotMessage,
    purchaseMessages,
    topicMessageHistory,
    adHocNotification,
    auditNotification,
    paymentCards,
    close: async () => {
      await Promise.allSettled(closeableClients.map((client) => client?.close()))
    }
  }
}
