import {
  createDbRoutineRepository,
  createDbAdHocNotificationRepository,
  createDbAuditNotificationRepository,
  createDbHouseholdConfigurationRepository,
  createDbProcessedBotMessageRepository,
  createDbScheduledDispatchRepository,
  createDbTelegramPendingActionRepository,
  createDbTelegramPaymentCardRepository,
  createDbTopicMessageHistoryRepository
} from '@household/adapters-db'
import { instrumentRepository } from '@household/observability'

import type { BotRuntimeConfig } from '../config'
import { createPurchaseMessageRepository } from '../adapters/purchase-message-repository'

interface RepositoryClient<T> {
  repository: T
  close: () => Promise<void>
}

// Timed at the adapter boundary so the per-request log reflects real database work.
function instrumented<T extends object>(
  label: string,
  client: RepositoryClient<T> | null
): RepositoryClient<T> | null {
  return client ? { ...client, repository: instrumentRepository(label, client.repository) } : null
}

export function createBotRepositoryClients(
  runtime: Pick<BotRuntimeConfig, 'databaseUrl' | 'scheduledDispatch'>
) {
  const householdConfiguration = runtime.databaseUrl
    ? instrumented('householdConfig', createDbHouseholdConfigurationRepository(runtime.databaseUrl))
    : null
  const scheduledDispatch =
    runtime.databaseUrl && runtime.scheduledDispatch
      ? instrumented('scheduledDispatch', createDbScheduledDispatchRepository(runtime.databaseUrl))
      : null
  const telegramPendingAction = runtime.databaseUrl
    ? instrumented('pendingAction', createDbTelegramPendingActionRepository(runtime.databaseUrl))
    : null
  const processedBotMessage = runtime.databaseUrl
    ? instrumented('processedMessage', createDbProcessedBotMessageRepository(runtime.databaseUrl))
    : null
  const purchaseMessages = runtime.databaseUrl
    ? instrumented('purchaseMessages', createPurchaseMessageRepository(runtime.databaseUrl))
    : null
  const topicMessageHistory = runtime.databaseUrl
    ? instrumented('topicHistory', createDbTopicMessageHistoryRepository(runtime.databaseUrl))
    : null
  const adHocNotification = runtime.databaseUrl
    ? instrumented('adHocNotification', createDbAdHocNotificationRepository(runtime.databaseUrl))
    : null
  const auditNotification = runtime.databaseUrl
    ? instrumented('auditNotification', createDbAuditNotificationRepository(runtime.databaseUrl))
    : null
  const paymentCards = runtime.databaseUrl
    ? instrumented('paymentCards', createDbTelegramPaymentCardRepository(runtime.databaseUrl))
    : null

  const routines = runtime.databaseUrl
    ? instrumented('routines', createDbRoutineRepository(runtime.databaseUrl))
    : null

  const closeableClients = [
    routines,
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
    routines,
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
