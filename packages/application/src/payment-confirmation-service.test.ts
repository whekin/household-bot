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
      timezone: 'Asia/Tbilisi'
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
          rentDueDay: 20,
          utilitiesDueDay: 4,
          paymentBalanceAdjustmentPolicy: 'utilities',
          totalDue: Money.fromMajor('1030', 'GEL'),
          totalPaid: Money.zero('GEL'),
          totalRemaining: Money.fromMajor('1030', 'GEL'),
          rentSourceAmount: Money.fromMajor('700', 'USD'),
          rentDisplayAmount: Money.fromMajor('1890', 'GEL'),
          rentFxRateMicros: 2_700_000n,
          rentFxEffectiveDate: '2026-03-17',
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
      amount: Money.fromMajor('472.50', 'GEL')
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
          rentDueDay: 20,
          utilitiesDueDay: 4,
          paymentBalanceAdjustmentPolicy: 'utilities',
          totalDue: Money.fromMajor('1030', 'GEL'),
          totalPaid: Money.zero('GEL'),
          totalRemaining: Money.fromMajor('1030', 'GEL'),
          rentSourceAmount: Money.fromMajor('700', 'USD'),
          rentDisplayAmount: Money.fromMajor('1890', 'GEL'),
          rentFxRateMicros: 2_700_000n,
          rentFxEffectiveDate: '2026-03-17',
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
})
