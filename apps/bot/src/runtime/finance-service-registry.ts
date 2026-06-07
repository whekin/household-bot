import {
  createFinanceCommandService,
  createPaymentConfirmationService
} from '@household/application'
import { createDbFinanceRepository } from '@household/adapters-db'
import type { Logger } from '@household/observability'
import type { HouseholdConfigurationRepository } from '@household/ports'

import { createNbgExchangeRateProvider } from '../nbg-exchange-rates'

type FinanceRepositoryClient = ReturnType<typeof createDbFinanceRepository>
type FinanceService = ReturnType<typeof createFinanceCommandService>
type PaymentConfirmationService = ReturnType<typeof createPaymentConfirmationService>

export interface FinanceServiceRegistry {
  financeRepositoryForHousehold(householdId: string): FinanceRepositoryClient['repository']
  financeServiceForHousehold(householdId: string): FinanceService
  paymentConfirmationServiceForHousehold(householdId: string): PaymentConfirmationService
}

export function createFinanceServiceRegistry(options: {
  databaseUrl: string
  householdConfigurationRepository: HouseholdConfigurationRepository
  exchangeRateLogger?: Logger
  onClose: (task: () => Promise<void>) => void
}): FinanceServiceRegistry {
  const financeRepositoryClients = new Map<string, FinanceRepositoryClient>()
  const financeServices = new Map<string, FinanceService>()
  const paymentConfirmationServices = new Map<string, PaymentConfirmationService>()
  const exchangeRateProvider = createNbgExchangeRateProvider(
    options.exchangeRateLogger ? { logger: options.exchangeRateLogger } : {}
  )

  function financeRepositoryClientForHousehold(householdId: string): FinanceRepositoryClient {
    const existing = financeRepositoryClients.get(householdId)
    if (existing) {
      return existing
    }

    const repositoryClient = createDbFinanceRepository(options.databaseUrl, householdId)
    financeRepositoryClients.set(householdId, repositoryClient)
    options.onClose(repositoryClient.close)
    return repositoryClient
  }

  function financeRepositoryForHousehold(
    householdId: string
  ): FinanceRepositoryClient['repository'] {
    return financeRepositoryClientForHousehold(householdId).repository
  }

  function financeServiceForHousehold(householdId: string): FinanceService {
    const existing = financeServices.get(householdId)
    if (existing) {
      return existing
    }

    const service = createFinanceCommandService({
      householdId,
      repository: financeRepositoryForHousehold(householdId),
      householdConfigurationRepository: options.householdConfigurationRepository,
      exchangeRateProvider
    })
    financeServices.set(householdId, service)
    return service
  }

  function paymentConfirmationServiceForHousehold(householdId: string): PaymentConfirmationService {
    const existing = paymentConfirmationServices.get(householdId)
    if (existing) {
      return existing
    }

    const service = createPaymentConfirmationService({
      householdId,
      financeService: financeServiceForHousehold(householdId),
      repository: financeRepositoryForHousehold(householdId),
      householdConfigurationRepository: options.householdConfigurationRepository,
      exchangeRateProvider
    })
    paymentConfirmationServices.set(householdId, service)
    return service
  }

  return {
    financeRepositoryForHousehold,
    financeServiceForHousehold,
    paymentConfirmationServiceForHousehold
  }
}
