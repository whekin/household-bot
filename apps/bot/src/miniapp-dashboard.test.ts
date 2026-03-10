import { describe, expect, test } from 'bun:test'

import {
  createFinanceCommandService,
  createHouseholdOnboardingService
} from '@household/application'
import { instantFromIso } from '@household/domain'
import type {
  ExchangeRateProvider,
  FinanceRepository,
  HouseholdConfigurationRepository,
  HouseholdTopicBindingRecord
} from '@household/ports'

import { createMiniAppDashboardHandler } from './miniapp-dashboard'
import { buildMiniAppInitData } from './telegram-miniapp-test-helpers'

function repository(
  member: Awaited<ReturnType<FinanceRepository['getMemberByTelegramUserId']>>
): FinanceRepository {
  return {
    getMemberByTelegramUserId: async () => member,
    listMembers: async () => [
      member ?? {
        id: 'member-1',
        telegramUserId: '123456',
        displayName: 'Stan',
        rentShareWeight: 1,
        isAdmin: true
      }
    ],
    getOpenCycle: async () => ({
      id: 'cycle-1',
      period: '2026-03',
      currency: 'GEL'
    }),
    getCycleByPeriod: async () => null,
    getLatestCycle: async () => ({
      id: 'cycle-1',
      period: '2026-03',
      currency: 'GEL'
    }),
    openCycle: async () => {},
    closeCycle: async () => {},
    saveRentRule: async () => {},
    getCycleExchangeRate: async () => null,
    saveCycleExchangeRate: async (input) => input,
    addUtilityBill: async () => {},
    getRentRuleForPeriod: async () => ({
      amountMinor: 70000n,
      currency: 'USD'
    }),
    getUtilityTotalForCycle: async () => 12000n,
    listUtilityBillsForCycle: async () => [
      {
        id: 'utility-1',
        billName: 'Electricity',
        amountMinor: 12000n,
        currency: 'GEL',
        createdByMemberId: member?.id ?? 'member-1',
        createdAt: instantFromIso('2026-03-12T12:00:00.000Z')
      }
    ],
    listPaymentRecordsForCycle: async () => [],
    listParsedPurchasesForRange: async () => [
      {
        id: 'purchase-1',
        payerMemberId: member?.id ?? 'member-1',
        amountMinor: 3000n,
        currency: 'GEL',
        description: 'Soap',
        occurredAt: instantFromIso('2026-03-12T11:00:00.000Z')
      }
    ],
    getSettlementSnapshotLines: async () => [],
    savePaymentConfirmation: async () =>
      ({
        status: 'needs_review',
        reviewReason: 'settlement_not_ready'
      }) as const,
    replaceSettlementSnapshot: async () => {}
  }
}

const exchangeRateProvider: ExchangeRateProvider = {
  async getRate(input) {
    if (input.baseCurrency === input.quoteCurrency) {
      return {
        baseCurrency: input.baseCurrency,
        quoteCurrency: input.quoteCurrency,
        rateMicros: 1_000_000n,
        effectiveDate: input.effectiveDate,
        source: 'nbg'
      }
    }

    return {
      baseCurrency: input.baseCurrency,
      quoteCurrency: input.quoteCurrency,
      rateMicros: 2_700_000n,
      effectiveDate: input.effectiveDate,
      source: 'nbg'
    }
  }
}

function onboardingRepository(): HouseholdConfigurationRepository {
  const household = {
    householdId: 'household-1',
    householdName: 'Kojori House',
    telegramChatId: '-100123',
    telegramChatType: 'supergroup',
    title: 'Kojori House',
    defaultLocale: 'ru' as const
  }

  return {
    registerTelegramHouseholdChat: async () => ({
      status: 'existing',
      household
    }),
    getTelegramHouseholdChat: async () => household,
    getHouseholdChatByHouseholdId: async () => household,
    bindHouseholdTopic: async (input) =>
      ({
        householdId: input.householdId,
        role: input.role,
        telegramThreadId: input.telegramThreadId,
        topicName: input.topicName?.trim() || null
      }) satisfies HouseholdTopicBindingRecord,
    getHouseholdTopicBinding: async () => null,
    findHouseholdTopicByTelegramContext: async () => null,
    listHouseholdTopicBindings: async () => [],
    listReminderTargets: async () => [],
    upsertHouseholdJoinToken: async (input) => ({
      householdId: household.householdId,
      householdName: household.householdName,
      token: input.token,
      createdByTelegramUserId: input.createdByTelegramUserId ?? null
    }),
    getHouseholdJoinToken: async () => null,
    getHouseholdByJoinToken: async () => null,
    upsertPendingHouseholdMember: async (input) => ({
      householdId: household.householdId,
      householdName: household.householdName,
      telegramUserId: input.telegramUserId,
      displayName: input.displayName,
      username: input.username?.trim() || null,
      languageCode: input.languageCode?.trim() || null,
      householdDefaultLocale: household.defaultLocale
    }),
    getPendingHouseholdMember: async () => null,
    findPendingHouseholdMemberByTelegramUserId: async () => null,
    ensureHouseholdMember: async (input) => ({
      id: `member-${input.telegramUserId}`,
      householdId: household.householdId,
      telegramUserId: input.telegramUserId,
      displayName: input.displayName,
      preferredLocale: input.preferredLocale ?? null,
      householdDefaultLocale: household.defaultLocale,
      rentShareWeight: 1,
      isAdmin: input.isAdmin === true
    }),
    getHouseholdMember: async () => null,
    listHouseholdMembers: async () => [],
    listHouseholdMembersByTelegramUserId: async () => [],
    listPendingHouseholdMembers: async () => [],
    approvePendingHouseholdMember: async () => null,
    updateHouseholdDefaultLocale: async (_householdId, locale) => ({
      ...household,
      defaultLocale: locale
    }),
    updateMemberPreferredLocale: async () => null,
    getHouseholdBillingSettings: async (householdId) => ({
      householdId,
      settlementCurrency: 'GEL',
      rentAmountMinor: null,
      rentCurrency: 'USD',
      rentDueDay: 20,
      rentWarningDay: 17,
      utilitiesDueDay: 4,
      utilitiesReminderDay: 3,
      timezone: 'Asia/Tbilisi'
    }),
    updateHouseholdBillingSettings: async (input) => ({
      householdId: input.householdId,
      settlementCurrency: input.settlementCurrency ?? 'GEL',
      rentAmountMinor: input.rentAmountMinor ?? null,
      rentCurrency: input.rentCurrency ?? 'USD',
      rentDueDay: input.rentDueDay ?? 20,
      rentWarningDay: input.rentWarningDay ?? 17,
      utilitiesDueDay: input.utilitiesDueDay ?? 4,
      utilitiesReminderDay: input.utilitiesReminderDay ?? 3,
      timezone: input.timezone ?? 'Asia/Tbilisi'
    }),
    listHouseholdUtilityCategories: async () => [],
    upsertHouseholdUtilityCategory: async (input) => ({
      id: input.slug ?? 'utility-category-1',
      householdId: input.householdId,
      slug: input.slug ?? 'custom',
      name: input.name,
      sortOrder: input.sortOrder,
      isActive: input.isActive
    }),
    promoteHouseholdAdmin: async () => null,
    updateHouseholdMemberRentShareWeight: async () => null
  }
}

describe('createMiniAppDashboardHandler', () => {
  test('returns a dashboard for an authenticated household member', async () => {
    const authDate = Math.floor(Date.now() / 1000)
    const householdRepository = onboardingRepository()
    const financeService = createFinanceCommandService({
      householdId: 'household-1',
      repository: repository({
        id: 'member-1',
        telegramUserId: '123456',
        displayName: 'Stan',
        rentShareWeight: 1,
        isAdmin: true
      }),
      householdConfigurationRepository: householdRepository,
      exchangeRateProvider
    })

    householdRepository.listHouseholdMembersByTelegramUserId = async () => [
      {
        id: 'member-1',
        householdId: 'household-1',
        telegramUserId: '123456',
        displayName: 'Stan',
        preferredLocale: null,
        householdDefaultLocale: 'ru',
        rentShareWeight: 1,
        isAdmin: true
      }
    ]

    const dashboard = createMiniAppDashboardHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      financeServiceForHousehold: () => financeService,
      onboardingService: createHouseholdOnboardingService({
        repository: householdRepository
      })
    })

    const response = await dashboard.handler(
      new Request('http://localhost/api/miniapp/dashboard', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          initData: buildMiniAppInitData('test-bot-token', authDate, {
            id: 123456,
            first_name: 'Stan',
            username: 'stanislav',
            language_code: 'ru'
          })
        })
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      authorized: true,
      dashboard: {
        period: '2026-03',
        currency: 'GEL',
        totalDueMajor: '2010.00',
        rentSourceAmountMajor: '700.00',
        rentSourceCurrency: 'USD',
        rentDisplayAmountMajor: '1890.00',
        members: [
          {
            displayName: 'Stan',
            netDueMajor: '2010.00',
            rentShareMajor: '1890.00',
            utilityShareMajor: '120.00',
            purchaseOffsetMajor: '0.00'
          }
        ],
        ledger: [
          {
            title: 'Soap',
            currency: 'GEL',
            displayCurrency: 'GEL'
          },
          {
            title: 'Electricity',
            currency: 'GEL',
            displayCurrency: 'GEL'
          }
        ]
      }
    })
  })

  test('returns 400 for malformed JSON bodies', async () => {
    const householdRepository = onboardingRepository()
    const financeService = createFinanceCommandService({
      householdId: 'household-1',
      repository: repository({
        id: 'member-1',
        telegramUserId: '123456',
        displayName: 'Stan',
        rentShareWeight: 1,
        isAdmin: true
      }),
      householdConfigurationRepository: householdRepository,
      exchangeRateProvider
    })

    householdRepository.listHouseholdMembersByTelegramUserId = async () => [
      {
        id: 'member-1',
        householdId: 'household-1',
        telegramUserId: '123456',
        displayName: 'Stan',
        preferredLocale: null,
        householdDefaultLocale: 'ru',
        rentShareWeight: 1,
        isAdmin: true
      }
    ]

    const dashboard = createMiniAppDashboardHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      financeServiceForHousehold: () => financeService,
      onboardingService: createHouseholdOnboardingService({
        repository: householdRepository
      })
    })

    const response = await dashboard.handler(
      new Request('http://localhost/api/miniapp/dashboard', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          'content-type': 'application/json'
        },
        body: '{"initData":'
      })
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      ok: false,
      error: 'Invalid JSON body'
    })
  })
})
