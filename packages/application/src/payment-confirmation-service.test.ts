import { describe, expect, test } from 'bun:test'

import { Money, instantFromIso, type CurrencyCode } from '@household/domain'
import type {
  ExchangeRateProvider,
  FinancePaymentConfirmationSaveInput,
  FinancePaymentConfirmationSaveResult,
  FinanceRepository,
  HouseholdConfigurationRepository
} from '@household/ports'

import { createPaymentConfirmationService } from './payment-confirmation-service'

const settingsRepository: Pick<HouseholdConfigurationRepository, 'getHouseholdBillingSettings'> = {
  async getHouseholdBillingSettings(householdId) {
    return {
      householdId,
      settlementCurrency: 'GEL',
      rentAmountMinor: 70000n,
      rentCurrency: 'USD',
      rentDueDay: 20,
      rentWarningDay: 17,
      utilitiesDueDay: 4,
      utilitiesReminderDay: 3,
      timezone: 'Asia/Tbilisi',
      rentPaymentDestinations: null
    }
  }
}

const exchangeRateProvider: ExchangeRateProvider = {
  async getRate(input) {
    return {
      baseCurrency: input.baseCurrency,
      quoteCurrency: input.quoteCurrency,
      rateMicros: input.baseCurrency === input.quoteCurrency ? 1_000_000n : 2_700_000n,
      effectiveDate: input.effectiveDate,
      source: 'nbg'
    }
  }
}

function createRepositoryStub(): Pick<
  FinanceRepository,
  | 'getOpenCycle'
  | 'getLatestCycle'
  | 'getCycleExchangeRate'
  | 'saveCycleExchangeRate'
  | 'savePaymentConfirmation'
> & {
  saved: FinancePaymentConfirmationSaveInput[]
} {
  return {
    saved: [],
    async getOpenCycle() {
      return {
        id: 'cycle-1',
        period: '2026-03',
        currency: 'GEL' as CurrencyCode
      }
    },
    async getLatestCycle() {
      return {
        id: 'cycle-1',
        period: '2026-03',
        currency: 'GEL' as CurrencyCode
      }
    },
    async getCycleExchangeRate() {
      return null
    },
    async saveCycleExchangeRate(input) {
      return input
    },
    async savePaymentConfirmation(input): Promise<FinancePaymentConfirmationSaveResult> {
      this.saved.push(input)

      if (input.status === 'needs_review') {
        return {
          status: 'needs_review',
          reviewReason: input.reviewReason
        }
      }

      return {
        status: 'recorded',
        paymentRecord: {
          id: 'payment-1',
          cycleId: input.cycleId,
          cyclePeriod: null,
          memberId: input.memberId,
          kind: input.kind,
          amountMinor: input.amountMinor,
          currency: input.currency,
          recordedAt: input.recordedAt
        }
      }
    }
  }
}

describe('createPaymentConfirmationService', () => {
  test('resolves rent confirmations against the current member due', async () => {
    const repository = createRepositoryStub()
    const service = createPaymentConfirmationService({
      householdId: 'household-1',
      financeService: {
        getMemberByTelegramUserId: async () => ({
          id: 'member-1',
          telegramUserId: '123',
          displayName: 'Stas',
          rentShareWeight: 1,
          isAdmin: false
        }),
        generateDashboard: async () => ({
          period: '2026-03',
          currency: 'GEL',
          timezone: 'Asia/Tbilisi',
          rentWarningDay: 17,
          rentDueDay: 20,
          utilitiesReminderDay: 3,
          utilitiesDueDay: 4,
          paymentBalanceAdjustmentPolicy: 'utilities',
          rentPaymentDestinations: null,
          totalDue: Money.fromMajor('1030', 'GEL'),
          totalPaid: Money.zero('GEL'),
          totalRemaining: Money.fromMajor('1030', 'GEL'),
          billingStage: 'rent',
          rentSourceAmount: Money.fromMajor('700', 'USD'),
          rentDisplayAmount: Money.fromMajor('1890', 'GEL'),
          rentFxRateMicros: 2_700_000n,
          rentFxEffectiveDate: '2026-03-17',
          utilityBillingPlan: null,
          rentBillingState: {
            dueDate: '2026-03-20',
            paymentDestinations: null,
            memberSummaries: []
          },
          members: [
            {
              memberId: 'member-1',
              displayName: 'Stas',
              rentShare: Money.fromMajor('472.50', 'GEL'),
              utilityShare: Money.fromMajor('40', 'GEL'),
              purchaseOffset: Money.fromMajor('-12', 'GEL'),
              netDue: Money.fromMajor('500.50', 'GEL'),
              paid: Money.zero('GEL'),
              remaining: Money.fromMajor('500.50', 'GEL'),
              overduePayments: [],
              explanations: []
            }
          ],
          ledger: []
        })
      },
      repository,
      householdConfigurationRepository: settingsRepository,
      exchangeRateProvider
    })

    const result = await service.submit({
      senderTelegramUserId: '123',
      rawText: 'за жилье закинул',
      telegramChatId: '-1001',
      telegramMessageId: '10',
      telegramThreadId: '4',
      telegramUpdateId: '200',
      attachmentCount: 0,
      messageSentAt: instantFromIso('2026-03-20T09:00:00.000Z')
    })

    expect(result).toEqual({
      status: 'recorded',
      kind: 'rent',
      amount: Money.fromMajor('473.00', 'GEL')
    })
    expect(repository.saved[0]?.status).toBe('recorded')
  })

  test('converts explicit rent amounts into cycle currency', async () => {
    const repository = createRepositoryStub()
    const service = createPaymentConfirmationService({
      householdId: 'household-1',
      financeService: {
        getMemberByTelegramUserId: async () => ({
          id: 'member-1',
          telegramUserId: '123',
          displayName: 'Stas',
          rentShareWeight: 1,
          isAdmin: false
        }),
        generateDashboard: async () => ({
          period: '2026-03',
          currency: 'GEL',
          timezone: 'Asia/Tbilisi',
          rentWarningDay: 17,
          rentDueDay: 20,
          utilitiesReminderDay: 3,
          utilitiesDueDay: 4,
          paymentBalanceAdjustmentPolicy: 'utilities',
          rentPaymentDestinations: null,
          totalDue: Money.fromMajor('1030', 'GEL'),
          totalPaid: Money.zero('GEL'),
          totalRemaining: Money.fromMajor('1030', 'GEL'),
          billingStage: 'rent',
          rentSourceAmount: Money.fromMajor('700', 'USD'),
          rentDisplayAmount: Money.fromMajor('1890', 'GEL'),
          rentFxRateMicros: 2_700_000n,
          rentFxEffectiveDate: '2026-03-17',
          utilityBillingPlan: null,
          rentBillingState: {
            dueDate: '2026-03-20',
            paymentDestinations: null,
            memberSummaries: []
          },
          members: [
            {
              memberId: 'member-1',
              displayName: 'Stas',
              rentShare: Money.fromMajor('472.50', 'GEL'),
              utilityShare: Money.fromMajor('40', 'GEL'),
              purchaseOffset: Money.fromMajor('-12', 'GEL'),
              netDue: Money.fromMajor('500.50', 'GEL'),
              paid: Money.zero('GEL'),
              remaining: Money.fromMajor('500.50', 'GEL'),
              overduePayments: [],
              explanations: []
            }
          ],
          ledger: []
        })
      },
      repository,
      householdConfigurationRepository: settingsRepository,
      exchangeRateProvider
    })

    const result = await service.submit({
      senderTelegramUserId: '123',
      rawText: 'paid rent $175',
      telegramChatId: '-1001',
      telegramMessageId: '11',
      telegramThreadId: '4',
      telegramUpdateId: '201',
      attachmentCount: 0,
      messageSentAt: instantFromIso('2026-03-20T09:00:00.000Z')
    })

    expect(result).toEqual({
      status: 'recorded',
      kind: 'rent',
      amount: Money.fromMajor('472.50', 'GEL')
    })
  })

  test('keeps ambiguous confirmations for review', async () => {
    const repository = createRepositoryStub()
    const service = createPaymentConfirmationService({
      householdId: 'household-1',
      financeService: {
        getMemberByTelegramUserId: async () => ({
          id: 'member-1',
          telegramUserId: '123',
          displayName: 'Stas',
          rentShareWeight: 1,
          isAdmin: false
        }),
        generateDashboard: async () => null
      },
      repository,
      householdConfigurationRepository: settingsRepository,
      exchangeRateProvider
    })

    const result = await service.submit({
      senderTelegramUserId: '123',
      rawText: 'готово',
      telegramChatId: '-1001',
      telegramMessageId: '12',
      telegramThreadId: '4',
      telegramUpdateId: '202',
      attachmentCount: 1,
      messageSentAt: instantFromIso('2026-03-20T09:00:00.000Z')
    })

    expect(result).toEqual({
      status: 'needs_review',
      reason: 'kind_ambiguous'
    })
  })

  test('records third-person confirmations against the reported member id', async () => {
    const repository = createRepositoryStub()
    const service = createPaymentConfirmationService({
      householdId: 'household-1',
      financeService: {
        getMemberByTelegramUserId: async () => ({
          id: 'member-reporter',
          telegramUserId: '123',
          displayName: 'Stas',
          rentShareWeight: 1,
          isAdmin: false
        }),
        generateDashboard: async () => ({
          period: '2026-03',
          currency: 'GEL',
          timezone: 'Asia/Tbilisi',
          rentWarningDay: 17,
          rentDueDay: 20,
          utilitiesReminderDay: 3,
          utilitiesDueDay: 4,
          paymentBalanceAdjustmentPolicy: 'utilities',
          rentPaymentDestinations: null,
          totalDue: Money.fromMajor('1030', 'GEL'),
          totalPaid: Money.zero('GEL'),
          totalRemaining: Money.fromMajor('1030', 'GEL'),
          billingStage: 'rent',
          rentSourceAmount: Money.fromMajor('700', 'USD'),
          rentDisplayAmount: Money.fromMajor('1890', 'GEL'),
          rentFxRateMicros: 2_700_000n,
          rentFxEffectiveDate: '2026-03-17',
          utilityBillingPlan: null,
          rentBillingState: {
            dueDate: '2026-03-20',
            paymentDestinations: null,
            memberSummaries: []
          },
          members: [
            {
              memberId: 'member-ion',
              displayName: 'Ion',
              rentShare: Money.fromMajor('472.50', 'GEL'),
              utilityShare: Money.fromMajor('40', 'GEL'),
              purchaseOffset: Money.fromMajor('-12', 'GEL'),
              netDue: Money.fromMajor('500.50', 'GEL'),
              paid: Money.zero('GEL'),
              remaining: Money.fromMajor('500.50', 'GEL'),
              overduePayments: [],
              explanations: []
            }
          ],
          ledger: []
        })
      },
      repository,
      householdConfigurationRepository: settingsRepository,
      exchangeRateProvider
    })

    const result = await service.submit({
      senderTelegramUserId: '123',
      memberId: 'member-ion',
      rawText: 'Ion paid rent',
      telegramChatId: '-1001',
      telegramMessageId: '13',
      telegramThreadId: '4',
      telegramUpdateId: '203',
      attachmentCount: 0,
      messageSentAt: instantFromIso('2026-03-20T09:00:00.000Z')
    })

    expect(result).toEqual({
      status: 'recorded',
      kind: 'rent',
      amount: Money.fromMajor('473.00', 'GEL')
    })
    expect(repository.saved[0]).toMatchObject({
      status: 'recorded',
      memberId: 'member-ion'
    })
  })

  test('returns already_settled when the target member balance is already closed', async () => {
    const repository = createRepositoryStub()
    const service = createPaymentConfirmationService({
      householdId: 'household-1',
      financeService: {
        getMemberByTelegramUserId: async () => ({
          id: 'member-1',
          telegramUserId: '123',
          displayName: 'Stas',
          rentShareWeight: 1,
          isAdmin: false
        }),
        generateDashboard: async () => ({
          period: '2026-03',
          currency: 'GEL',
          timezone: 'Asia/Tbilisi',
          rentWarningDay: 17,
          rentDueDay: 20,
          utilitiesReminderDay: 3,
          utilitiesDueDay: 4,
          paymentBalanceAdjustmentPolicy: 'utilities',
          rentPaymentDestinations: null,
          totalDue: Money.zero('GEL'),
          totalPaid: Money.fromMajor('500.50', 'GEL'),
          totalRemaining: Money.zero('GEL'),
          billingStage: 'rent',
          rentSourceAmount: Money.fromMajor('700', 'USD'),
          rentDisplayAmount: Money.fromMajor('1890', 'GEL'),
          rentFxRateMicros: 2_700_000n,
          rentFxEffectiveDate: '2026-03-17',
          utilityBillingPlan: null,
          rentBillingState: {
            dueDate: '2026-03-20',
            paymentDestinations: null,
            memberSummaries: []
          },
          members: [
            {
              memberId: 'member-1',
              displayName: 'Stas',
              rentShare: Money.fromMajor('472.50', 'GEL'),
              utilityShare: Money.fromMajor('40', 'GEL'),
              purchaseOffset: Money.fromMajor('-12', 'GEL'),
              netDue: Money.fromMajor('500.50', 'GEL'),
              paid: Money.fromMajor('500.50', 'GEL'),
              remaining: Money.zero('GEL'),
              overduePayments: [],
              explanations: []
            }
          ],
          ledger: []
        })
      },
      repository,
      householdConfigurationRepository: settingsRepository,
      exchangeRateProvider
    })

    const result = await service.submit({
      senderTelegramUserId: '123',
      rawText: 'я уже закинул за жилье',
      telegramChatId: '-1001',
      telegramMessageId: '14',
      telegramThreadId: '4',
      telegramUpdateId: '204',
      attachmentCount: 0,
      messageSentAt: instantFromIso('2026-03-20T09:00:00.000Z')
    })

    expect(result).toEqual({
      status: 'already_settled',
      kind: 'rent'
    })
    expect(repository.saved).toHaveLength(0)
  })
})
