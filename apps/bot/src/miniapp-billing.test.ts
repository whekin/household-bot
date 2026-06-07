import { describe, expect, test } from 'bun:test'

import type {
  AdHocNotificationService,
  FinanceCommandService,
  HouseholdAuditNotificationService
} from '@household/application'
import { createHouseholdOnboardingService } from '@household/application'
import { DOMAIN_ERROR_CODE, DomainError, instantFromIso, Money } from '@household/domain'
import type {
  HouseholdConfigurationRepository,
  HouseholdTopicBindingRecord
} from '@household/ports'

import {
  createMiniAppAddPurchaseHandler,
  createMiniAppAddUtilityBillHandler,
  createMiniAppBillingCycleHandler,
  createMiniAppClosePaymentPeriodHandler,
  createMiniAppDeletePurchaseHandler,
  createMiniAppDeleteUtilityBillHandler,
  createMiniAppOpenCycleHandler,
  createMiniAppRecordUtilityVendorPaymentHandler,
  createMiniAppRentUpdateHandler,
  createMiniAppResolveUtilityPlanHandler,
  createMiniAppUpdatePurchaseHandler,
  createMiniAppUpdateUtilityBillHandler
} from './miniapp-billing'
import type { PurchaseTopicNoticeService } from './purchase-topic-notices'
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
      preferredUtilityPayerMemberId: null,
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
      preferredUtilityPayerMemberId: input.preferredUtilityPayerMemberId ?? null,
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
    updateHouseholdMemberStatus: async () => null
  }
}

const adHocNotificationService = {
  listUpcomingNotifications: async () => []
} as unknown as AdHocNotificationService

function createAuditNotificationServiceStub() {
  const events: Parameters<HouseholdAuditNotificationService['recordEvent']>[0][] = []
  const service: HouseholdAuditNotificationService = {
    recordEvent: async (input) => {
      events.push(input)
      return {
        id: `audit-${events.length}`,
        householdId: input.householdId,
        actorMemberId: input.actorMemberId ?? null,
        actorDisplayName: input.actorDisplayName,
        eventType: input.eventType,
        category: input.category,
        summaryText: input.summaryText,
        metadata: input.metadata ?? {},
        deliveryStatus: 'pending',
        deliveredTelegramChatId: null,
        deliveredTelegramThreadId: null,
        deliveredTelegramMessageId: null,
        deliveryError: null,
        createdAt: instantFromIso('2026-03-12T12:00:00.000Z')
      }
    }
  }
  return { service, events }
}

function createPurchaseTopicNoticeServiceStub(input?: {
  fail?: boolean
}): PurchaseTopicNoticeService & {
  calls: Array<{ action: 'publish' | 'sync' | 'delete'; householdId: string; purchaseId: string }>
} {
  const calls: Array<{
    action: 'publish' | 'sync' | 'delete'
    householdId: string
    purchaseId: string
  }> = []
  const maybeFail = () => {
    if (input?.fail) {
      throw new Error('Telegram failed')
    }
  }

  return {
    calls,
    publishPurchase: async (call) => {
      calls.push({ action: 'publish', ...call })
      maybeFail()
    },
    syncPurchase: async (call) => {
      calls.push({ action: 'sync', ...call })
      maybeFail()
    },
    markPurchaseDeleted: async (call) => {
      calls.push({ action: 'delete', ...call })
      maybeFail()
    },
    replaceExistingPurchaseMessage: async () => true
  }
}

function createDashboardStub() {
  return {
    period: '2026-03',
    currency: 'GEL' as const,
    timezone: 'Asia/Tbilisi',
    rentWarningDay: 17,
    rentDueDay: 20,
    utilitiesReminderDay: 3,
    preferredUtilityPayerMemberId: null,
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
  resolvedUtilityPlans: Array<Parameters<FinanceCommandService['resolveUtilityBillAsPlanned']>[0]>
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
    listMembers: async () => [],
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
    closePaymentPeriod: async (input) => ({
      period: input.periodArg,
      kind: input.kind,
      closedMembers: [
        {
          memberId: input.memberIds?.[0] ?? 'member-123456',
          displayName: 'Stan',
          amount: Money.fromMinor(3000n, 'GEL')
        }
      ],
      skippedMembers: [],
      dashboard: createDashboardStub()
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
        resolvedAssignments: [
          {
            memberId: input.memberId ?? 'member-123456',
            displayName: 'Stan',
            utilityBillId: 'utility-1',
            billName: 'Electricity',
            amount: Money.fromMinor(12000n, 'GEL')
          }
        ],
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
    ensureDashboardMaterialized: async () => null,
    generateBillingAuditExport: async () => null,
    generateStatement: async () => null,
    manuallyResolvePurchase: async () => ({
      purchaseId: 'test-purchase',
      resolvedAmount: Money.fromMajor('0.00', 'GEL')
    })
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
    const audit = createAuditNotificationServiceStub()
    const handler = createMiniAppOpenCycleHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      onboardingService: createHouseholdOnboardingService({
        repository
      }),
      financeServiceForHousehold: () => createFinanceServiceStub(),
      auditNotificationService: audit.service
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
    expect(audit.events).toMatchObject([
      {
        householdId: 'household-1',
        actorMemberId: 'member-123456',
        actorDisplayName: 'Stan',
        category: 'period_events',
        eventType: 'cycle.opened',
        summaryText: 'Stan opened period 2026-03'
      }
    ])
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
    const purchaseTopicNoticeService = createPurchaseTopicNoticeServiceStub()

    const handler = createMiniAppUpdatePurchaseHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      onboardingService: createHouseholdOnboardingService({
        repository
      }),
      adHocNotificationService,
      purchaseTopicNoticeService,
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
    expect(purchaseTopicNoticeService.calls).toEqual([
      {
        action: 'sync',
        householdId: 'household-1',
        purchaseId: 'purchase-1'
      }
    ])
  })
})

describe('createMiniAppAddPurchaseHandler', () => {
  test('rejects inactive admins before purchase creation', async () => {
    const repository = {
      ...onboardingRepository(),
      listHouseholdMembersByTelegramUserId: async () => [
        {
          id: 'member-123456',
          householdId: 'household-1',
          telegramUserId: '123456',
          displayName: 'Stan',
          status: 'away' as const,
          preferredLocale: null,
          householdDefaultLocale: 'ru' as const,
          rentShareWeight: 1,
          isAdmin: true
        }
      ]
    } satisfies HouseholdConfigurationRepository
    let serviceCalled = false

    const handler = createMiniAppAddPurchaseHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      onboardingService: createHouseholdOnboardingService({
        repository
      }),
      adHocNotificationService,
      financeServiceForHousehold: () => ({
        ...createFinanceServiceStub(),
        addPurchase: async () => {
          serviceCalled = true
          throw new Error('should not be called')
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
          currency: 'GEL'
        })
      })
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      ok: false,
      error: 'Access limited to active household members'
    })
    expect(serviceCalled).toBe(false)
  })

  test('forwards purchase creation with split to the finance service', async () => {
    const repository = onboardingRepository()
    let capturedArgs: any = null
    const audit = createAuditNotificationServiceStub()
    const purchaseTopicNoticeService = createPurchaseTopicNoticeServiceStub()

    const handler = createMiniAppAddPurchaseHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      onboardingService: createHouseholdOnboardingService({
        repository
      }),
      adHocNotificationService,
      auditNotificationService: audit.service,
      purchaseTopicNoticeService,
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
    expect(audit.events).toMatchObject([
      {
        householdId: 'household-1',
        actorMemberId: 'member-123456',
        actorDisplayName: 'Stan',
        category: 'purchase_events',
        eventType: 'purchase.added',
        summaryText: 'Stan added purchase: Pizza 30.00 ₾',
        metadata: {
          purchaseId: 'new-purchase-1',
          description: 'Pizza',
          amountMinor: '3000',
          currency: 'GEL',
          payerMemberId: 'member-123456'
        }
      }
    ])
    expect(purchaseTopicNoticeService.calls).toEqual([
      {
        action: 'publish',
        householdId: 'household-1',
        purchaseId: 'new-purchase-1'
      }
    ])
  })

  test('returns 400 for purchase mutation validation errors before dashboard refresh', async () => {
    const repository = onboardingRepository()
    const logEntries: { payload: unknown; message: string }[] = []
    let dashboardLoaded = false

    const handler = createMiniAppAddPurchaseHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      onboardingService: createHouseholdOnboardingService({
        repository
      }),
      adHocNotificationService,
      logger: {
        error: (payload: unknown, message: string) => {
          logEntries.push({ payload, message })
        }
      } as never,
      financeServiceForHousehold: () => ({
        ...createFinanceServiceStub(),
        addPurchase: async () => {
          throw new DomainError(
            DOMAIN_ERROR_CODE.INVALID_SETTLEMENT_INPUT,
            'Purchase participant must be an active household member: member-away'
          )
        },
        generateDashboard: async () => {
          dashboardLoaded = true
          return createDashboardStub()
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
          currency: 'GEL'
        })
      })
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      ok: false,
      error: 'Purchase participant must be an active household member: member-away'
    })
    expect(dashboardLoaded).toBe(false)
    expect(logEntries).toEqual([])
  })

  test('does not fail purchase creation when topic notice delivery fails', async () => {
    const repository = onboardingRepository()
    const purchaseTopicNoticeService = createPurchaseTopicNoticeServiceStub({ fail: true })

    const handler = createMiniAppAddPurchaseHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      onboardingService: createHouseholdOnboardingService({
        repository
      }),
      adHocNotificationService,
      purchaseTopicNoticeService,
      financeServiceForHousehold: () => createFinanceServiceStub()
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
          currency: 'GEL'
        })
      })
    )

    expect(response.status).toBe(200)
    expect(purchaseTopicNoticeService.calls).toEqual([
      {
        action: 'publish',
        householdId: 'household-1',
        purchaseId: 'test-purchase'
      }
    ])
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
    const purchaseTopicNoticeService = createPurchaseTopicNoticeServiceStub()
    const handler = createMiniAppDeletePurchaseHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      onboardingService: createHouseholdOnboardingService({
        repository
      }),
      adHocNotificationService,
      purchaseTopicNoticeService,
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
    expect(purchaseTopicNoticeService.calls).toEqual([
      {
        action: 'delete',
        householdId: 'household-1',
        purchaseId: 'purchase-1'
      }
    ])
  })
})

describe('utility billing action handlers', () => {
  test('close payment period records a resident self close and returns refreshed dashboard', async () => {
    const repository = onboardingRepository()
    const calls: Parameters<FinanceCommandService['closePaymentPeriod']>[0][] = []
    const financeService = {
      ...createFinanceServiceStub(),
      closePaymentPeriod: async (
        input: Parameters<FinanceCommandService['closePaymentPeriod']>[0]
      ) => {
        calls.push(input)
        return {
          period: input.periodArg,
          kind: input.kind,
          closedMembers: [
            {
              memberId: 'member-123456',
              displayName: 'Stan',
              amount: Money.fromMinor(3000n, 'GEL')
            }
          ],
          skippedMembers: [],
          dashboard: createDashboardStub()
        }
      }
    }
    const handler = createMiniAppClosePaymentPeriodHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      onboardingService: createHouseholdOnboardingService({ repository }),
      financeServiceForHousehold: () => financeService,
      adHocNotificationService
    })

    const response = await handler.handler(
      new Request('http://localhost/api/miniapp/billing/periods/close', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          initData: initData(),
          period: '2026-03',
          kind: 'rent',
          memberIds: ['member-123456']
        })
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      authorized: true,
      dashboard: {
        period: '2026-03'
      },
      closeSummary: {
        period: '2026-03',
        kind: 'rent',
        closedMembers: [
          {
            memberId: 'member-123456',
            displayName: 'Stan',
            amountMajor: '30.00',
            currency: 'GEL'
          }
        ]
      }
    })
    expect(calls).toEqual([
      {
        periodArg: '2026-03',
        kind: 'rent',
        actorMemberId: 'member-123456',
        memberIds: ['member-123456']
      }
    ])
  })

  test('close payment period rejects resident attempts to close another member', async () => {
    const repository = {
      ...onboardingRepository(),
      listHouseholdMembersByTelegramUserId: async () => [
        {
          id: 'member-123456',
          householdId: 'household-1',
          telegramUserId: '123456',
          displayName: 'Stan',
          status: 'active' as const,
          preferredLocale: null,
          householdDefaultLocale: 'ru' as const,
          rentShareWeight: 1,
          isAdmin: false
        }
      ]
    }
    const handler = createMiniAppClosePaymentPeriodHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      onboardingService: createHouseholdOnboardingService({ repository }),
      financeServiceForHousehold: () => createFinanceServiceStub(),
      adHocNotificationService
    })

    const response = await handler.handler(
      new Request('http://localhost/api/miniapp/billing/periods/close', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          initData: initData(),
          period: '2026-03',
          kind: 'rent',
          memberIds: ['member-other']
        })
      })
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ ok: false, error: 'Admin access required' })
  })

  test('close payment period supports admin all-members close', async () => {
    const repository = onboardingRepository()
    const audit = createAuditNotificationServiceStub()
    const calls: Parameters<FinanceCommandService['closePaymentPeriod']>[0][] = []
    const financeService = {
      ...createFinanceServiceStub(),
      closePaymentPeriod: async (
        input: Parameters<FinanceCommandService['closePaymentPeriod']>[0]
      ) => {
        calls.push(input)
        return {
          period: input.periodArg,
          kind: input.kind,
          closedMembers: [],
          skippedMembers: [],
          dashboard: createDashboardStub()
        }
      }
    }
    const handler = createMiniAppClosePaymentPeriodHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      onboardingService: createHouseholdOnboardingService({ repository }),
      financeServiceForHousehold: () => financeService,
      adHocNotificationService,
      auditNotificationService: audit.service
    })

    const response = await handler.handler(
      new Request('http://localhost/api/miniapp/billing/periods/close', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          initData: initData(),
          period: '2026-03',
          kind: 'utilities',
          allMembers: true
        })
      })
    )

    expect(response.status).toBe(200)
    expect(calls).toEqual([
      {
        periodArg: '2026-03',
        kind: 'utilities',
        actorMemberId: 'member-123456',
        allMembers: true
      }
    ])
    expect(audit.events).toEqual([])
  })

  test('resolve planned utility payment records the selected member action', async () => {
    const repository = onboardingRepository()
    const financeService = createFinanceServiceStub()
    const audit = createAuditNotificationServiceStub()
    const handler = createMiniAppResolveUtilityPlanHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      onboardingService: createHouseholdOnboardingService({
        repository
      }),
      financeServiceForHousehold: () => financeService,
      auditNotificationService: audit.service
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
    expect(audit.events).toMatchObject([
      {
        householdId: 'household-1',
        actorMemberId: 'member-123456',
        actorDisplayName: 'Stan',
        category: 'plan_events',
        eventType: 'utility_plan.resolved',
        summaryText: 'Stan marked planned utilities paid: Stan · Electricity 120.00 ₾ (2026-03)',
        metadata: {
          resolvedAssignments: [
            {
              memberId: 'member-123456',
              displayName: 'Stan',
              utilityBillId: 'utility-1',
              billName: 'Electricity',
              amountMinor: '12000',
              currency: 'GEL'
            }
          ]
        }
      }
    ])
  })

  test('resolve planned utility payment supports an admin full-plan action', async () => {
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
          allMembers: true,
          period: '2026-03'
        })
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, authorized: true })
    expect(financeService.resolvedUtilityPlans).toEqual([
      {
        allMembers: true,
        actorMemberId: 'member-123456',
        periodArg: '2026-03'
      }
    ])
  })

  test('resolve planned utility payment returns 409 when no active plan exists', async () => {
    const repository = onboardingRepository()
    const audit = createAuditNotificationServiceStub()
    const financeService = {
      ...createFinanceServiceStub(),
      resolveUtilityBillAsPlanned: async function (
        input: Parameters<FinanceCommandService['resolveUtilityBillAsPlanned']>[0]
      ) {
        this.resolvedUtilityPlans.push(input)
        return null
      }
    }
    const handler = createMiniAppResolveUtilityPlanHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      onboardingService: createHouseholdOnboardingService({
        repository
      }),
      financeServiceForHousehold: () => financeService,
      auditNotificationService: audit.service
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

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      ok: false,
      authorized: true,
      error: 'No active utility plan is available for this member'
    })
    expect(financeService.resolvedUtilityPlans).toEqual([
      {
        memberId: 'member-123456',
        actorMemberId: 'member-123456',
        periodArg: '2026-03'
      }
    ])
    expect(audit.events).toEqual([])
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
