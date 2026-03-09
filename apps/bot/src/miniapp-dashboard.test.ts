import { describe, expect, test } from 'bun:test'

import {
  createFinanceCommandService,
  createHouseholdOnboardingService
} from '@household/application'
import { instantFromIso } from '@household/domain'
import type {
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
        isAdmin: true
      }
    ],
    getOpenCycle: async () => ({
      id: 'cycle-1',
      period: '2026-03',
      currency: 'USD'
    }),
    getCycleByPeriod: async () => null,
    getLatestCycle: async () => ({
      id: 'cycle-1',
      period: '2026-03',
      currency: 'USD'
    }),
    openCycle: async () => {},
    closeCycle: async () => {},
    saveRentRule: async () => {},
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
        currency: 'USD',
        createdByMemberId: member?.id ?? 'member-1',
        createdAt: instantFromIso('2026-03-12T12:00:00.000Z')
      }
    ],
    listParsedPurchasesForRange: async () => [
      {
        id: 'purchase-1',
        payerMemberId: member?.id ?? 'member-1',
        amountMinor: 3000n,
        description: 'Soap',
        occurredAt: instantFromIso('2026-03-12T11:00:00.000Z')
      }
    ],
    replaceSettlementSnapshot: async () => {}
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
    updateMemberPreferredLocale: async () => null
  }
}

describe('createMiniAppDashboardHandler', () => {
  test('returns a dashboard for an authenticated household member', async () => {
    const authDate = Math.floor(Date.now() / 1000)
    const financeService = createFinanceCommandService(
      repository({
        id: 'member-1',
        telegramUserId: '123456',
        displayName: 'Stan',
        isAdmin: true
      })
    )
    const householdRepository = onboardingRepository()
    householdRepository.listHouseholdMembersByTelegramUserId = async () => [
      {
        id: 'member-1',
        householdId: 'household-1',
        telegramUserId: '123456',
        displayName: 'Stan',
        preferredLocale: null,
        householdDefaultLocale: 'ru',
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
        currency: 'USD',
        totalDueMajor: '820.00',
        members: [
          {
            displayName: 'Stan',
            netDueMajor: '820.00',
            rentShareMajor: '700.00',
            utilityShareMajor: '120.00',
            purchaseOffsetMajor: '0.00'
          }
        ],
        ledger: [
          {
            title: 'Soap'
          },
          {
            title: 'Electricity'
          }
        ]
      }
    })
  })

  test('returns 400 for malformed JSON bodies', async () => {
    const financeService = createFinanceCommandService(
      repository({
        id: 'member-1',
        telegramUserId: '123456',
        displayName: 'Stan',
        isAdmin: true
      })
    )
    const householdRepository = onboardingRepository()
    householdRepository.listHouseholdMembersByTelegramUserId = async () => [
      {
        id: 'member-1',
        householdId: 'household-1',
        telegramUserId: '123456',
        displayName: 'Stan',
        preferredLocale: null,
        householdDefaultLocale: 'ru',
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
