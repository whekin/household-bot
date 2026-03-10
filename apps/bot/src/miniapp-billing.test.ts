import { describe, expect, test } from 'bun:test'

import type { FinanceCommandService } from '@household/application'
import { createHouseholdOnboardingService } from '@household/application'
import { instantFromIso, Money } from '@household/domain'
import type {
  HouseholdConfigurationRepository,
  HouseholdTopicBindingRecord
} from '@household/ports'

import {
  createMiniAppAddUtilityBillHandler,
  createMiniAppBillingCycleHandler,
  createMiniAppDeleteUtilityBillHandler,
  createMiniAppOpenCycleHandler,
  createMiniAppRentUpdateHandler,
  createMiniAppUpdateUtilityBillHandler
} from './miniapp-billing'
import { buildMiniAppInitData } from './telegram-miniapp-test-helpers'

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
    getHouseholdBillingSettings: async (householdId) => ({
      householdId,
      settlementCurrency: 'GEL',
      rentAmountMinor: 70000n,
      rentCurrency: 'USD',
      rentDueDay: 20,
      rentWarningDay: 17,
      utilitiesDueDay: 4,
      utilitiesReminderDay: 3,
      timezone: 'Asia/Tbilisi'
    }),
    updateHouseholdBillingSettings: async (input) => ({
      householdId: input.householdId,
      settlementCurrency: 'GEL',
      rentAmountMinor: input.rentAmountMinor ?? 70000n,
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
    listHouseholdMembersByTelegramUserId: async () => [
      {
        id: 'member-123456',
        householdId: 'household-1',
        telegramUserId: '123456',
        displayName: 'Stan',
        preferredLocale: null,
        householdDefaultLocale: 'ru',
        rentShareWeight: 1,
        isAdmin: true
      }
    ],
    listPendingHouseholdMembers: async () => [],
    approvePendingHouseholdMember: async () => null,
    updateHouseholdDefaultLocale: async (_householdId, locale) => ({
      ...household,
      defaultLocale: locale
    }),
    updateMemberPreferredLocale: async () => null,
    promoteHouseholdAdmin: async () => null,
    updateHouseholdMemberRentShareWeight: async () => null
  }
}

function createFinanceServiceStub(): FinanceCommandService {
  return {
    getMemberByTelegramUserId: async () => null,
    getOpenCycle: async () => ({
      id: 'cycle-2026-03',
      period: '2026-03',
      currency: 'USD'
    }),
    getAdminCycleState: async () => ({
      cycle: {
        id: 'cycle-2026-03',
        period: '2026-03',
        currency: 'USD'
      },
      rentRule: {
        amountMinor: 70000n,
        currency: 'USD'
      },
      utilityBills: [
        {
          id: 'utility-1',
          billName: 'Electricity',
          amount: Money.fromMinor(12000n, 'USD'),
          currency: 'USD',
          createdByMemberId: 'member-123456',
          createdAt: instantFromIso('2026-03-12T12:00:00.000Z')
        }
      ]
    }),
    openCycle: async () => ({
      id: 'cycle-2026-03',
      period: '2026-03',
      currency: 'USD'
    }),
    closeCycle: async () => ({
      id: 'cycle-2026-03',
      period: '2026-03',
      currency: 'USD'
    }),
    setRent: async () => ({
      amount: Money.fromMinor(75000n, 'USD'),
      currency: 'USD',
      period: '2026-03'
    }),
    addUtilityBill: async () => ({
      amount: Money.fromMinor(4500n, 'USD'),
      currency: 'USD',
      period: '2026-03'
    }),
    updateUtilityBill: async () => ({
      billId: 'utility-1',
      amount: Money.fromMinor(4500n, 'USD'),
      currency: 'USD'
    }),
    deleteUtilityBill: async () => true,
    generateDashboard: async () => null,
    generateStatement: async () => null
  }
}

const authDate = Math.floor(Date.now() / 1000)

function initData() {
  return buildMiniAppInitData('test-bot-token', authDate, {
    id: 123456,
    first_name: 'Stan',
    username: 'stanislav',
    language_code: 'ru'
  })
}

describe('createMiniAppBillingCycleHandler', () => {
  test('returns the current cycle state for an authenticated admin', async () => {
    const repository = onboardingRepository()
    const handler = createMiniAppBillingCycleHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      onboardingService: createHouseholdOnboardingService({
        repository
      }),
      financeServiceForHousehold: () => createFinanceServiceStub()
    })

    const response = await handler.handler(
      new Request('http://localhost/api/miniapp/admin/billing-cycle', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          initData: initData()
        })
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      authorized: true,
      cycleState: {
        cycle: {
          id: 'cycle-2026-03',
          period: '2026-03',
          currency: 'USD'
        },
        rentRule: {
          amountMinor: '70000',
          currency: 'USD'
        },
        utilityBills: [
          {
            id: 'utility-1',
            billName: 'Electricity',
            amountMinor: '12000',
            currency: 'USD',
            createdByMemberId: 'member-123456',
            createdAt: '2026-03-12T12:00:00Z'
          }
        ]
      }
    })
  })
})

test('createMiniAppUpdateUtilityBillHandler updates a utility bill for the current cycle', async () => {
  const repository = onboardingRepository()
  const handler = createMiniAppUpdateUtilityBillHandler({
    allowedOrigins: ['http://localhost:5173'],
    botToken: 'test-bot-token',
    onboardingService: createHouseholdOnboardingService({
      repository
    }),
    financeServiceForHousehold: () => createFinanceServiceStub()
  })

  const response = await handler.handler(
    new Request('http://localhost/api/miniapp/admin/utility-bills/update', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:5173',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        initData: initData(),
        billId: 'utility-1',
        billName: 'Electricity',
        amountMajor: '45.00',
        currency: 'GEL'
      })
    })
  )

  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    ok: true,
    authorized: true,
    cycleState: {
      utilityBills: [
        {
          id: 'utility-1'
        }
      ]
    }
  })
})

test('createMiniAppDeleteUtilityBillHandler deletes a utility bill for the current cycle', async () => {
  const repository = onboardingRepository()
  const handler = createMiniAppDeleteUtilityBillHandler({
    allowedOrigins: ['http://localhost:5173'],
    botToken: 'test-bot-token',
    onboardingService: createHouseholdOnboardingService({
      repository
    }),
    financeServiceForHousehold: () => createFinanceServiceStub()
  })

  const response = await handler.handler(
    new Request('http://localhost/api/miniapp/admin/utility-bills/delete', {
      method: 'POST',
      headers: {
        origin: 'http://localhost:5173',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        initData: initData(),
        billId: 'utility-1'
      })
    })
  )

  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({
    ok: true,
    authorized: true,
    cycleState: {
      utilityBills: [
        {
          id: 'utility-1'
        }
      ]
    }
  })
})

describe('createMiniAppOpenCycleHandler', () => {
  test('opens a billing cycle for an authenticated admin', async () => {
    const repository = onboardingRepository()
    const handler = createMiniAppOpenCycleHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      onboardingService: createHouseholdOnboardingService({
        repository
      }),
      financeServiceForHousehold: () => createFinanceServiceStub()
    })

    const response = await handler.handler(
      new Request('http://localhost/api/miniapp/admin/billing-cycle/open', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          initData: initData(),
          period: '2026-03',
          currency: 'USD'
        })
      })
    )

    expect(response.status).toBe(200)
    const payload = (await response.json()) as { cycleState: { cycle: unknown } }

    expect(payload.cycleState.cycle).toEqual({
      id: 'cycle-2026-03',
      period: '2026-03',
      currency: 'USD'
    })
  })
})

describe('createMiniAppRentUpdateHandler', () => {
  test('updates rent for the current billing cycle', async () => {
    const repository = onboardingRepository()
    const handler = createMiniAppRentUpdateHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      onboardingService: createHouseholdOnboardingService({
        repository
      }),
      financeServiceForHousehold: () => createFinanceServiceStub()
    })

    const response = await handler.handler(
      new Request('http://localhost/api/miniapp/admin/rent/update', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          initData: initData(),
          amountMajor: '750',
          currency: 'USD'
        })
      })
    )

    expect(response.status).toBe(200)
    const payload = (await response.json()) as { cycleState: { rentRule: unknown } }

    expect(payload.cycleState.rentRule).toEqual({
      amountMinor: '70000',
      currency: 'USD'
    })
  })
})

describe('createMiniAppAddUtilityBillHandler', () => {
  test('adds a utility bill for the current billing cycle', async () => {
    const repository = onboardingRepository()
    const handler = createMiniAppAddUtilityBillHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      onboardingService: createHouseholdOnboardingService({
        repository
      }),
      financeServiceForHousehold: () => createFinanceServiceStub()
    })

    const response = await handler.handler(
      new Request('http://localhost/api/miniapp/admin/utility-bills/add', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          initData: initData(),
          billName: 'Internet',
          amountMajor: '45',
          currency: 'USD'
        })
      })
    )

    expect(response.status).toBe(200)
    const payload = (await response.json()) as { cycleState: { utilityBills: unknown[] } }

    expect(payload.cycleState.utilityBills).toHaveLength(1)
  })
})
