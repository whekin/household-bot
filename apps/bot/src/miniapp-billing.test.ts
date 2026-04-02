import { describe, expect, test } from 'bun:test'

import type { AdHocNotificationService, FinanceCommandService } from '@household/application'
import { createHouseholdOnboardingService } from '@household/application'
import { instantFromIso, Money } from '@household/domain'
import type {
  HouseholdConfigurationRepository,
  HouseholdTopicBindingRecord
} from '@household/ports'

import {
  createMiniAppAddPurchaseHandler,
  createMiniAppAddUtilityBillHandler,
  createMiniAppBillingCycleHandler,
  createMiniAppDeletePurchaseHandler,
  createMiniAppDeleteUtilityBillHandler,
  createMiniAppOpenCycleHandler,
  createMiniAppRecordUtilityVendorPaymentHandler,
  createMiniAppRentUpdateHandler,
  createMiniAppResolveUtilityPlanHandler,
  createMiniAppUpdatePurchaseHandler,
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
    clearHouseholdTopicBindings: async () => {},
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
      status: input.status ?? 'active',
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
      timezone: 'Asia/Tbilisi',
      rentPaymentDestinations: null
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
      timezone: input.timezone ?? 'Asia/Tbilisi',
      rentPaymentDestinations: input.rentPaymentDestinations ?? null
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
        status: 'active',
        preferredLocale: null,
        householdDefaultLocale: 'ru',
        rentShareWeight: 1,
        isAdmin: true
      }
    ],
    listPendingHouseholdMembers: async () => [],
    approvePendingHouseholdMember: async () => null,
    rejectPendingHouseholdMember: async () => false,
    updateHouseholdDefaultLocale: async (_householdId, locale) => ({
      ...household,
      defaultLocale: locale
    }),
    updateMemberPreferredLocale: async () => null,
    updateHouseholdMemberDisplayName: async () => null,
    promoteHouseholdAdmin: async () => null,
    demoteHouseholdAdmin: async () => null,
    updateHouseholdMemberRentShareWeight: async () => null,
    updateHouseholdMemberStatus: async () => null,
    listHouseholdMemberAbsencePolicies: async () => [],
    upsertHouseholdMemberAbsencePolicy: async () => null
  }
}

const adHocNotificationService = {
  listUpcomingNotifications: async () => []
} as unknown as AdHocNotificationService

function createDashboardStub() {
  return {
    period: '2026-03',
    currency: 'GEL' as const,
    timezone: 'Asia/Tbilisi',
    rentWarningDay: 17,
    rentDueDay: 20,
    utilitiesReminderDay: 3,
    utilitiesDueDay: 4,
    paymentBalanceAdjustmentPolicy: 'utilities' as const,
    rentPaymentDestinations: null,
    totalDue: Money.fromMinor(3000n, 'GEL'),
    totalPaid: Money.fromMinor(0n, 'GEL'),
    totalRemaining: Money.fromMinor(3000n, 'GEL'),
    billingStage: 'utilities' as const,
    rentSourceAmount: Money.fromMinor(70000n, 'USD'),
    rentDisplayAmount: Money.fromMinor(188958n, 'GEL'),
    rentFxRateMicros: null,
    rentFxEffectiveDate: null,
    utilityBillingPlan: null,
    rentBillingState: {
      dueDate: '2026-03-20',
      paymentDestinations: null,
      memberSummaries: []
    },
    members: [
      {
        memberId: 'member-123456',
        displayName: 'Stan',
        predictedUtilityShare: null,
        rentShare: Money.fromMinor(0n, 'GEL'),
        utilityShare: Money.fromMinor(0n, 'GEL'),
        purchaseOffset: Money.fromMinor(0n, 'GEL'),
        netDue: Money.fromMinor(0n, 'GEL'),
        paid: Money.fromMinor(0n, 'GEL'),
        remaining: Money.fromMinor(0n, 'GEL'),
        overduePayments: [],
        explanations: []
      }
    ],
    paymentPeriods: [],
    ledger: []
  }
}

function createFinanceServiceStub(): FinanceCommandService & {
  resolvedUtilityPlans: Array<{ memberId: string; actorMemberId?: string; periodArg?: string }>
  utilityVendorPayments: Array<{
    utilityBillId: string
    payerMemberId: string
    actorMemberId?: string
    amountArg?: string
    currencyArg?: string
    periodArg?: string
  }>
} {
  return {
    resolvedUtilityPlans: [],
    utilityVendorPayments: [],
    getMemberByTelegramUserId: async () => null,
    ensureExpectedCycle: async () => ({
      id: 'cycle-2026-03',
      period: '2026-03',
      currency: 'USD'
    }),
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
    updatePurchase: async () => ({
      purchaseId: 'purchase-1',
      amount: Money.fromMinor(3000n, 'USD'),
      currency: 'USD'
    }),
    deletePurchase: async () => true,
    addPayment: async () => ({
      paymentId: 'payment-1',
      amount: Money.fromMinor(10000n, 'USD'),
      currency: 'USD',
      period: '2026-03'
    }),
    addPurchase: async () => ({
      purchaseId: 'test-purchase',
      amount: Money.fromMinor(0n, 'GEL'),
      currency: 'GEL'
    }),
    updatePayment: async () => ({
      paymentId: 'payment-1',
      amount: Money.fromMinor(10000n, 'USD'),
      currency: 'USD'
    }),
    deletePayment: async () => true,
    generateCurrentBillPlan: async () => null,
    resolveUtilityBillAsPlanned: async function (input) {
      this.resolvedUtilityPlans.push(input)
      return {
        period: input.periodArg ?? '2026-03',
        resolvedBillIds: ['utility-1'],
        plan: null
      }
    },
    recordUtilityVendorPayment: async function (input) {
      this.utilityVendorPayments.push(input)
      return {
        period: input.periodArg ?? '2026-03',
        plan: null
      }
    },
    recordUtilityReimbursement: async () => ({
      period: '2026-03',
      plan: null
    }),
    rebalanceUtilityPlan: async () => null,
    generateDashboard: async () => createDashboardStub(),
    generateBillingAuditExport: async () => null,
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

describe('createMiniAppUpdatePurchaseHandler', () => {
  test('forwards purchase split edits to the finance service', async () => {
    const repository = onboardingRepository()
    let capturedSplit: Parameters<FinanceCommandService['updatePurchase']>[4] | undefined

    const handler = createMiniAppUpdatePurchaseHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      onboardingService: createHouseholdOnboardingService({
        repository
      }),
      adHocNotificationService,
      financeServiceForHousehold: () => ({
        ...createFinanceServiceStub(),
        updatePurchase: async (_purchaseId, _description, _amountArg, _currencyArg, split) => {
          capturedSplit = split
          return {
            purchaseId: 'purchase-1',
            amount: Money.fromMinor(3000n, 'GEL'),
            currency: 'GEL'
          }
        }
      })
    })

    const response = await handler.handler(
      new Request('http://localhost/api/miniapp/admin/purchases/update', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          initData: initData(),
          purchaseId: 'purchase-1',
          description: 'Kettle',
          amountMajor: '30',
          currency: 'GEL',
          split: {
            mode: 'custom_amounts',
            participants: [
              {
                memberId: 'member-123456',
                included: true,
                shareAmountMajor: '20'
              },
              {
                memberId: 'member-999',
                included: false
              },
              {
                memberId: 'member-888',
                included: true,
                shareAmountMajor: '10'
              }
            ]
          }
        })
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      authorized: true,
      dashboard: {
        period: '2026-03'
      }
    })
    expect(capturedSplit).toEqual({
      mode: 'custom_amounts',
      participants: [
        {
          memberId: 'member-123456',
          included: true,
          shareAmountMajor: '20'
        },
        {
          memberId: 'member-999',
          included: false
        },
        {
          memberId: 'member-888',
          included: true,
          shareAmountMajor: '10'
        }
      ]
    })
  })
})

describe('createMiniAppAddPurchaseHandler', () => {
  test('forwards purchase creation with split to the finance service', async () => {
    const repository = onboardingRepository()
    let capturedArgs: any = null

    const handler = createMiniAppAddPurchaseHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      onboardingService: createHouseholdOnboardingService({
        repository
      }),
      adHocNotificationService,
      financeServiceForHousehold: () => ({
        ...createFinanceServiceStub(),
        addPurchase: async (
          description: string,
          amountArg: string,
          payerMemberId: string,
          currencyArg?: string,
          split?: any
        ) => {
          capturedArgs = { description, amountArg, payerMemberId, currencyArg, split }
          return {
            purchaseId: 'new-purchase-1',
            amount: Money.fromMinor(3000n, 'GEL'),
            currency: 'GEL' as const
          }
        }
      })
    })

    const response = await handler.handler(
      new Request('http://localhost/api/miniapp/admin/purchases/add', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          initData: initData(),
          description: 'Pizza',
          amountMajor: '30',
          currency: 'GEL',
          split: {
            mode: 'equal',
            participants: [
              { memberId: 'member-123456', included: true },
              { memberId: 'member-999', included: true }
            ]
          }
        })
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      authorized: true,
      dashboard: {
        period: '2026-03'
      }
    })
    expect(capturedArgs).toEqual({
      description: 'Pizza',
      amountArg: '30',
      payerMemberId: 'member-123456',
      currencyArg: 'GEL',
      split: {
        mode: 'equal',
        participants: [
          { memberId: 'member-123456', included: true },
          { memberId: 'member-999', included: true }
        ]
      }
    })
  })

  test('accepts excluded participants without explicit share amounts in custom splits', async () => {
    const repository = onboardingRepository()
    let capturedArgs: any = null

    const handler = createMiniAppAddPurchaseHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      onboardingService: createHouseholdOnboardingService({
        repository
      }),
      adHocNotificationService,
      financeServiceForHousehold: () => ({
        ...createFinanceServiceStub(),
        addPurchase: async (
          description: string,
          amountArg: string,
          payerMemberId: string,
          currencyArg?: string,
          split?: any
        ) => {
          capturedArgs = { description, amountArg, payerMemberId, currencyArg, split }
          return {
            purchaseId: 'new-purchase-1',
            amount: Money.fromMinor(3000n, 'GEL'),
            currency: 'GEL' as const
          }
        }
      })
    })

    const response = await handler.handler(
      new Request('http://localhost/api/miniapp/admin/purchases/add', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          initData: initData(),
          description: 'Pizza',
          amountMajor: '30',
          currency: 'GEL',
          split: {
            mode: 'custom_amounts',
            participants: [
              {
                memberId: 'member-123456',
                included: true,
                shareAmountMajor: '20'
              },
              {
                memberId: 'member-999',
                included: false
              },
              {
                memberId: 'member-888',
                included: true,
                shareAmountMajor: '10'
              }
            ]
          }
        })
      })
    )

    expect(response.status).toBe(200)
    expect(capturedArgs?.split).toEqual({
      mode: 'custom_amounts',
      participants: [
        {
          memberId: 'member-123456',
          included: true,
          shareAmountMajor: '20'
        },
        {
          memberId: 'member-999',
          included: false
        },
        {
          memberId: 'member-888',
          included: true,
          shareAmountMajor: '10'
        }
      ]
    })
  })
})

describe('createMiniAppDeletePurchaseHandler', () => {
  test('returns a refreshed dashboard after deleting a purchase', async () => {
    const repository = onboardingRepository()
    const handler = createMiniAppDeletePurchaseHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      onboardingService: createHouseholdOnboardingService({
        repository
      }),
      adHocNotificationService,
      financeServiceForHousehold: () => createFinanceServiceStub()
    })

    const response = await handler.handler(
      new Request('http://localhost/api/miniapp/admin/purchases/delete', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          initData: initData(),
          purchaseId: 'purchase-1'
        })
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      authorized: true,
      dashboard: {
        period: '2026-03'
      }
    })
  })
})

describe('utility billing action handlers', () => {
  test('resolve planned utility payment records the selected member action', async () => {
    const repository = onboardingRepository()
    const financeService = createFinanceServiceStub()
    const handler = createMiniAppResolveUtilityPlanHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      onboardingService: createHouseholdOnboardingService({
        repository
      }),
      financeServiceForHousehold: () => financeService
    })

    const response = await handler.handler(
      new Request('http://localhost/api/miniapp/billing/utilities/resolve-planned', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          initData: initData(),
          memberId: 'member-123456',
          period: '2026-03'
        })
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, authorized: true })
    expect(financeService.resolvedUtilityPlans).toEqual([
      {
        memberId: 'member-123456',
        actorMemberId: 'member-123456',
        periodArg: '2026-03'
      }
    ])
  })

  test('custom vendor payment supports admin acting for another member', async () => {
    const repository = onboardingRepository()
    const financeService = createFinanceServiceStub()
    const handler = createMiniAppRecordUtilityVendorPaymentHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      onboardingService: createHouseholdOnboardingService({
        repository
      }),
      financeServiceForHousehold: () => financeService
    })

    const response = await handler.handler(
      new Request('http://localhost/api/miniapp/billing/utilities/vendor-payment', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          initData: initData(),
          utilityBillId: 'utility-1',
          payerMemberId: 'member-999',
          amountMajor: '45.50',
          currency: 'GEL',
          period: '2026-03'
        })
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, authorized: true })
    expect(financeService.utilityVendorPayments).toEqual([
      {
        utilityBillId: 'utility-1',
        payerMemberId: 'member-999',
        actorMemberId: 'member-123456',
        amountArg: '45.50',
        currencyArg: 'GEL',
        periodArg: '2026-03'
      }
    ])
  })
})
