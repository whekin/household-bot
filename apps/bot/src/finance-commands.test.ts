import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { FinanceCommandService, FinanceDashboard } from '@household/application'
import { Money, instantFromIso, nowInstant } from '@household/domain'
import type {
  HouseholdConfigurationRepository,
  TelegramPendingActionRecord,
  TelegramPendingActionRepository
} from '@household/ports'

import { createTelegramBot } from './bot'
import { createFinanceCommandsService } from './finance-commands'
import type { LivePaymentCardService } from './live-payment-cards'

type SentMessagePayload = {
  text?: string
  parse_mode?: string
  reply_markup?: {
    inline_keyboard?: Array<
      Array<{
        text: string
        callback_data?: string
        url?: string
        web_app?: { url: string }
        copy_text?: { text: string }
      }>
    >
  }
}

/** The first message the bot sent or edited, skipping callback acknowledgements. */
function firstMessagePayload(
  calls: ReadonlyArray<{ method: string; payload: unknown }>
): SentMessagePayload | undefined {
  return calls.find((call) => call.method === 'sendMessage' || call.method === 'editMessageText')
    ?.payload as SentMessagePayload | undefined
}

function privateCommandUpdate(text: string, languageCode: string) {
  return {
    update_id: 9101,
    message: {
      message_id: 10,
      date: Math.floor(Date.now() / 1000),
      chat: {
        id: 123456,
        type: 'private'
      },
      from: {
        id: 123456,
        is_bot: false,
        first_name: 'Stan',
        language_code: languageCode
      },
      text,
      entities: [
        {
          offset: 0,
          length: text.split(' ')[0]?.length ?? text.length,
          type: 'bot_command'
        }
      ]
    }
  }
}

function callbackUpdate(data: string, languageCode: string, chatType: 'private' | 'supergroup') {
  return {
    update_id: 9102,
    callback_query: {
      id: 'callback-1',
      from: {
        id: 123456,
        is_bot: false,
        first_name: 'Stan',
        language_code: languageCode
      },
      message: {
        message_id: 10,
        date: Math.floor(Date.now() / 1000),
        chat:
          chatType === 'private'
            ? {
                id: 123456,
                type: 'private'
              }
            : {
                id: -100123456,
                type: 'supergroup',
                title: 'Kojori'
              },
        text: 'status'
      },
      chat_instance: 'chat-instance',
      data
    }
  }
}

function billUpdate(text: string, languageCode: string) {
  return {
    update_id: 9200,
    message: {
      message_id: 11,
      date: Math.floor(Date.now() / 1000),
      chat: {
        id: -100123456,
        type: 'supergroup',
        title: 'Kojori'
      },
      from: {
        id: 123456,
        is_bot: false,
        first_name: 'Stan',
        language_code: languageCode
      },
      text,
      entities: [
        {
          offset: 0,
          length: text.split(' ')[0]?.length ?? text.length,
          type: 'bot_command'
        }
      ]
    }
  }
}

function createRepository(): HouseholdConfigurationRepository {
  return {
    registerTelegramHouseholdChat: async () => {
      throw new Error('not implemented')
    },
    getTelegramHouseholdChat: async () => ({
      householdId: 'household-1',
      householdName: 'Kojori House',
      telegramChatId: '-100123456',
      telegramChatType: 'supergroup',
      title: 'Kojori',
      defaultLocale: 'ru'
    }),
    getHouseholdChatByHouseholdId: async () => null,
    bindHouseholdTopic: async () => {
      throw new Error('not implemented')
    },
    getHouseholdTopicBinding: async () => null,
    findHouseholdTopicByTelegramContext: async () => null,
    listHouseholdTopicBindings: async () => [],
    clearHouseholdTopicBindings: async () => {},
    listReminderTargets: async () => [],
    upsertHouseholdJoinToken: async () => {
      throw new Error('not implemented')
    },
    getHouseholdJoinToken: async () => null,
    getHouseholdByJoinToken: async () => null,
    upsertPendingHouseholdMember: async () => {
      throw new Error('not implemented')
    },
    getPendingHouseholdMember: async () => null,
    findPendingHouseholdMemberByTelegramUserId: async () => null,
    ensureHouseholdMember: async () => {
      throw new Error('not implemented')
    },
    getHouseholdMember: async () => null,
    listHouseholdMembers: async () => [],
    listHouseholdMembersByTelegramUserId: async () => [
      {
        id: 'member-1',
        householdId: 'household-1',
        telegramUserId: '123456',
        displayName: 'Stan',
        status: 'active',
        preferredLocale: 'ru',
        householdDefaultLocale: 'ru',
        rentShareWeight: 1,
        isAdmin: true
      }
    ],
    getHouseholdBillingSettings: async () => ({
      householdId: 'household-1',
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
    updateHouseholdBillingSettings: async () => {
      throw new Error('not implemented')
    },
    listHouseholdUtilityCategories: async () => [],
    upsertHouseholdUtilityCategory: async () => {
      throw new Error('not implemented')
    },
    listPendingHouseholdMembers: async () => [],
    approvePendingHouseholdMember: async () => null,
    rejectPendingHouseholdMember: async () => false,
    updateHouseholdDefaultLocale: async () => {
      throw new Error('not implemented')
    },
    updateMemberPreferredLocale: async () => null,
    updateHouseholdMemberDisplayName: async () => null,
    promoteHouseholdAdmin: async () => null,
    demoteHouseholdAdmin: async () => null,
    updateHouseholdMemberRentShareWeight: async () => null,
    updateHouseholdMemberStatus: async () => null
  }
}

function createEnglishRepository(): HouseholdConfigurationRepository {
  return {
    ...createRepository(),
    listHouseholdMembersByTelegramUserId: async () => [
      {
        id: 'member-1',
        householdId: 'household-1',
        telegramUserId: '123456',
        displayName: 'Stan',
        status: 'active',
        preferredLocale: 'en',
        householdDefaultLocale: 'en',
        rentShareWeight: 1,
        isAdmin: true
      }
    ]
  }
}

function createPromptRepository(): TelegramPendingActionRepository & {
  current: () => TelegramPendingActionRecord | null
} {
  let pending: TelegramPendingActionRecord | null = null

  return {
    current: () => pending,
    async upsertPendingAction(input) {
      pending = input
      return input
    },
    async getPendingAction(telegramChatId, telegramUserId) {
      if (
        !pending ||
        pending.telegramChatId !== telegramChatId ||
        pending.telegramUserId !== telegramUserId
      ) {
        return null
      }

      if (
        pending.expiresAt &&
        pending.expiresAt.epochMilliseconds <= nowInstant().epochMilliseconds
      ) {
        pending = null
        return null
      }

      return pending
    },
    async clearPendingAction(telegramChatId, telegramUserId) {
      if (
        pending &&
        pending.telegramChatId === telegramChatId &&
        pending.telegramUserId === telegramUserId
      ) {
        pending = null
      }
    },
    async clearPendingActionsForChat(telegramChatId, action) {
      if (!pending || pending.telegramChatId !== telegramChatId) {
        return
      }

      if (action && pending.action !== action) {
        return
      }

      pending = null
    }
  }
}

function createDashboard(): NonNullable<
  Awaited<ReturnType<FinanceCommandService['generateDashboard']>>
> {
  return {
    period: '2026-03',
    currency: 'GEL',
    timezone: 'Asia/Tbilisi',
    rentWarningDay: 17,
    rentDueDay: 20,
    utilitiesReminderDay: 3,
    utilitiesDueDay: 4,
    paymentBalanceAdjustmentPolicy: 'utilities',
    rentPaymentDestinations: null,
    totalDue: Money.fromMajor('400', 'GEL'),
    totalPaid: Money.fromMajor('100', 'GEL'),
    totalRemaining: Money.fromMajor('300', 'GEL'),
    billingStage: 'idle',
    rentSourceAmount: Money.fromMajor('700', 'USD'),
    rentDisplayAmount: Money.fromMajor('1890', 'GEL'),
    rentFxRateMicros: 2_700_000n,
    rentFxEffectiveDate: '2026-03-17',
    utilityBillingPlan: null,
    rentBillingState: {
      dueDate: '2026-03-20',
      memberSummaries: [
        {
          memberId: 'member-1',
          displayName: 'Стас',
          due: Money.fromMajor('200', 'GEL'),
          paid: Money.fromMajor('100', 'GEL'),
          remaining: Money.fromMajor('100', 'GEL')
        },
        {
          memberId: 'member-2',
          displayName: 'Ион',
          due: Money.fromMajor('200', 'GEL'),
          paid: Money.zero('GEL'),
          remaining: Money.fromMajor('200', 'GEL')
        }
      ],
      paymentDestinations: null
    },
    members: [
      {
        memberId: 'member-1',
        displayName: 'Стас',
        rentShare: Money.fromMajor('200', 'GEL'),
        utilityShare: Money.fromMajor('20', 'GEL'),
        purchaseOffset: Money.fromMajor('-10', 'GEL'),
        netDue: Money.fromMajor('210', 'GEL'),
        paid: Money.fromMajor('100', 'GEL'),
        remaining: Money.fromMajor('110', 'GEL'),
        overduePayments: [],
        explanations: []
      },
      {
        memberId: 'member-2',
        displayName: 'Ион',
        rentShare: Money.fromMajor('200', 'GEL'),
        utilityShare: Money.fromMajor('20', 'GEL'),
        purchaseOffset: Money.fromMajor('10', 'GEL'),
        netDue: Money.fromMajor('190', 'GEL'),
        paid: Money.zero('GEL'),
        remaining: Money.fromMajor('190', 'GEL'),
        overduePayments: [],
        explanations: []
      }
    ],
    ledger: [
      {
        id: 'utility-1',
        kind: 'utility',
        title: 'Electricity',
        memberId: 'member-1',
        amount: Money.fromMajor('82', 'GEL'),
        currency: 'GEL',
        displayAmount: Money.fromMajor('82', 'GEL'),
        displayCurrency: 'GEL',
        fxRateMicros: null,
        fxEffectiveDate: null,
        actorDisplayName: 'Стас',
        occurredAt: instantFromIso('2026-03-10T12:00:00.000Z').toString(),
        paymentKind: null
      },
      {
        id: 'purchase-1',
        kind: 'purchase',
        title: 'Туалетная бумага',
        memberId: 'member-1',
        amount: Money.fromMajor('30', 'GEL'),
        currency: 'GEL',
        displayAmount: Money.fromMajor('30', 'GEL'),
        displayCurrency: 'GEL',
        fxRateMicros: null,
        fxEffectiveDate: null,
        actorDisplayName: 'Стас',
        occurredAt: instantFromIso('2026-03-09T12:00:00.000Z').toString(),
        paymentKind: null
      }
    ]
  }
}

function sameCurrencyRentConversion() {
  return {
    sourceAmount: Money.zero('GEL'),
    settlementAmount: Money.zero('GEL'),
    rateMicros: null,
    effectiveDate: null
  }
}

function createFinanceService(): FinanceCommandService {
  return {
    capturePaymentFundingContext: async () => undefined,
    reconcilePaymentPurchaseAllocations: async () => {},
    repayments: { execute: async () => [] },
    getMemberByTelegramUserId: async (telegramUserId) =>
      telegramUserId === '123456'
        ? {
            id: 'member-1',
            telegramUserId,
            displayName: 'Стас',
            rentShareWeight: 1,
            isAdmin: true
          }
        : null,
    listMembers: async () => [
      {
        id: 'member-1',
        telegramUserId: '123456',
        displayName: 'Стас',
        rentShareWeight: 1,
        isAdmin: true
      }
    ],
    listCycleHistory: async () => [],
    getOpenCycle: async () => ({
      id: 'cycle-1',
      period: '2026-03',
      currency: 'GEL'
    }),
    preparePaymentPeriod: async () => null,
    ensureExpectedCycle: async () => ({
      id: 'cycle-1',
      period: '2026-03',
      currency: 'GEL'
    }),
    getAdminCycleState: async () => ({
      cycle: null,
      rentRule: null,
      utilityBills: []
    }),
    openCycle: async () => ({
      id: 'cycle-1',
      period: '2026-03',
      currency: 'GEL'
    }),
    closeCycle: async () => null,
    setRent: async () => null,
    addUtilityBill: async () => null,
    addUtilityBills: async () => null,
    updateUtilityBill: async () => null,
    deleteUtilityBill: async () => false,
    updatePurchase: async () => null,
    deletePurchase: async () => false,
    addPayment: async () => null,
    closePaymentPeriod: async () => null,
    addPurchase: async () => ({
      purchaseId: 'test-purchase',
      amount: Money.fromMinor(0n, 'GEL'),
      currency: 'GEL'
    }),
    updatePayment: async () => null,
    deleteUtilityVendorPaymentFact: async () => true,
    deletePayment: async () => false,
    getPayment: async () => null,
    getPurchase: async () => null,
    generateCurrentBillPlan: async () => null,
    resolveUtilityBillAsPlanned: async () => null,
    recordUtilityVendorPayment: async () => null,
    recordUtilityReimbursement: async () => null,
    rebalanceUtilityPlan: async () => null,
    generateDashboard: async () => createDashboard(),
    ensureDashboardMaterialized: async () => null,
    refreshUtilityBillingPlan: async () => null,
    previewUtilityBillingPlanRefresh: async () => null,
    generateBillingAuditExport: async () => null,
    generateStatement: async () => null,
    manuallyResolvePurchase: async () => ({
      purchaseId: 'test-purchase',
      resolvedAmount: Money.fromMajor('0.00', 'GEL')
    })
  }
}

describe('createFinanceCommandsService', () => {
  test('keeps finance commands independent from household setup feature imports', () => {
    const source = readFileSync(new URL('./finance-commands.ts', import.meta.url), 'utf8')
    expect(source).not.toContain("from './household-setup'")
    expect(source).not.toContain('from "./household-setup"')
  })

  test('replies with a clearer localized household status summary', async () => {
    const repository = createRepository()
    const financeService: FinanceCommandService = {
      ...createFinanceService(),
      generateDashboard: async () => ({
        ...createDashboard(),
        period: '2026-05',
        billingStage: 'utilities',
        totalRemaining: Money.fromMajor('2195.62', 'GEL'),
        paymentBalanceAdjustmentPolicy: 'utilities',
        members: [
          {
            memberId: 'member-1',
            displayName: 'Стас',
            rentShare: Money.fromMajor('470.73', 'GEL'),
            utilityShare: Money.fromMajor('78.17', 'GEL'),
            purchaseOffset: Money.fromMajor('-101.10', 'GEL'),
            netDue: Money.fromMajor('447.80', 'GEL'),
            paid: Money.zero('GEL'),
            remaining: Money.fromMajor('447.80', 'GEL'),
            overduePayments: [],
            explanations: []
          },
          {
            memberId: 'member-2',
            displayName: 'Ион',
            rentShare: Money.fromMajor('470.73', 'GEL'),
            utilityShare: Money.fromMajor('78.17', 'GEL'),
            purchaseOffset: Money.fromMajor('59.25', 'GEL'),
            netDue: Money.fromMajor('608.15', 'GEL'),
            paid: Money.zero('GEL'),
            remaining: Money.fromMajor('608.15', 'GEL'),
            overduePayments: [],
            explanations: []
          },
          {
            memberId: 'member-3',
            displayName: 'Дима',
            rentShare: Money.fromMajor('470.73', 'GEL'),
            utilityShare: Money.fromMajor('78.17', 'GEL'),
            purchaseOffset: Money.fromMajor('21.93', 'GEL'),
            netDue: Money.fromMajor('570.83', 'GEL'),
            paid: Money.zero('GEL'),
            remaining: Money.fromMajor('570.83', 'GEL'),
            overduePayments: [],
            explanations: []
          },
          {
            memberId: 'member-4',
            displayName: 'Алиса',
            rentShare: Money.fromMajor('470.73', 'GEL'),
            utilityShare: Money.fromMajor('78.17', 'GEL'),
            purchaseOffset: Money.fromMajor('19.94', 'GEL'),
            netDue: Money.fromMajor('568.84', 'GEL'),
            paid: Money.zero('GEL'),
            remaining: Money.fromMajor('568.84', 'GEL'),
            overduePayments: [],
            explanations: []
          }
        ],
        utilityBillingPlan: {
          id: 'utility-plan-1',
          version: 1,
          status: 'active',
          dueDate: '2026-05-06',
          updatedFromVersion: null,
          reason: null,
          categories: [],
          memberSummaries: [
            {
              memberId: 'member-1',
              displayName: 'Стас',
              fairShare: Money.fromMajor('78.17', 'GEL'),
              vendorPaid: Money.zero('GEL'),
              assignedThisCycle: Money.zero('GEL'),
              projectedDeltaAfterPlan: Money.fromMajor('-22.93', 'GEL')
            },
            {
              memberId: 'member-2',
              displayName: 'Ион',
              fairShare: Money.fromMajor('78.17', 'GEL'),
              vendorPaid: Money.zero('GEL'),
              assignedThisCycle: Money.fromMajor('137.42', 'GEL'),
              projectedDeltaAfterPlan: Money.zero('GEL')
            },
            {
              memberId: 'member-3',
              displayName: 'Дима',
              fairShare: Money.fromMajor('78.17', 'GEL'),
              vendorPaid: Money.zero('GEL'),
              assignedThisCycle: Money.fromMajor('77.17', 'GEL'),
              projectedDeltaAfterPlan: Money.zero('GEL')
            },
            {
              memberId: 'member-4',
              displayName: 'Алиса',
              fairShare: Money.fromMajor('78.17', 'GEL'),
              vendorPaid: Money.zero('GEL'),
              assignedThisCycle: Money.fromMajor('98.10', 'GEL'),
              projectedDeltaAfterPlan: Money.zero('GEL')
            }
          ]
        },
        ledger: [
          {
            id: 'utility-1',
            kind: 'utility',
            title: 'Utilities',
            memberId: 'member-1',
            amount: Money.fromMajor('312.69', 'GEL'),
            currency: 'GEL',
            displayAmount: Money.fromMajor('312.69', 'GEL'),
            displayCurrency: 'GEL',
            fxRateMicros: null,
            fxEffectiveDate: null,
            actorDisplayName: 'Стас',
            occurredAt: instantFromIso('2026-05-03T12:00:00.000Z').toString(),
            paymentKind: null
          },
          {
            id: 'purchase-1',
            kind: 'purchase',
            title: 'Не показывать как начисление',
            memberId: 'member-1',
            amount: Money.fromMajor('407.50', 'GEL'),
            currency: 'GEL',
            displayAmount: Money.fromMajor('407.50', 'GEL'),
            displayCurrency: 'GEL',
            fxRateMicros: null,
            fxEffectiveDate: null,
            actorDisplayName: 'Стас',
            occurredAt: instantFromIso('2026-05-02T12:00:00.000Z').toString(),
            paymentKind: null,
            payerMemberId: 'member-1',
            resolutionStatus: 'unresolved'
          },
          {
            id: 'payment-1',
            kind: 'payment',
            title: 'utilities',
            memberId: 'member-2',
            amount: Money.fromMajor('50', 'GEL'),
            currency: 'GEL',
            displayAmount: Money.fromMajor('50', 'GEL'),
            displayCurrency: 'GEL',
            fxRateMicros: null,
            fxEffectiveDate: null,
            actorDisplayName: 'Ион',
            occurredAt: instantFromIso('2026-05-04T12:00:00.000Z').toString(),
            paymentKind: 'utilities'
          }
        ]
      })
    }
    const bot = createTelegramBot('000000:test-token', undefined, repository)
    createFinanceCommandsService({
      householdConfigurationRepository: repository,
      financeServiceForHousehold: () => financeService
    }).register(bot)

    bot.botInfo = {
      id: 999000,
      is_bot: true,
      first_name: 'Household Test Bot',
      username: 'household_test_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: true,
      allows_users_to_create_topics: false
    }

    const calls: Array<{ method: string; payload: unknown }> = []
    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })
      return {
        ok: true,
        result: {
          message_id: calls.length,
          date: Math.floor(Date.now() / 1000),
          chat: {
            id: -100123456,
            type: 'supergroup'
          },
          text: 'ok'
        }
      } as never
    })

    await bot.handleUpdate(callbackUpdate('home:status', 'ru', 'supergroup') as never)

    const payload = firstMessagePayload(calls)
    const text = payload?.text ?? ''
    const lines = text.split('\n')
    expect(lines[0]).toBe('🏠 Kojori House · май')
    expect(lines[1]).toBe('Осталось 2 195.62 ₾ · коммуналка до 6 мая')
    expect(text).toContain('Аренда: $700 (~1 890 ₾)')
    expect(text).toContain('Коммуналка: 312.69 ₾ · до 6 мая · осталось 312.69 ₾')
    expect(text).toContain('Покупки идут в счёт коммуналки')
    expect(text).toContain('\nПоследнее:\n')
    expect(text).toContain('• Стас: Не показывать как начисление · 407.50 ₾ · 2 мая')
    expect(text).toContain('• Ион: оплата коммуналки · 50 ₾ · 4 мая')
    expect(text).toContain('\nУчастники:\n')
    // Largest remaining balance first.
    expect(text).toContain(
      '• Ион — 608.15 ₾\n• Дима — 570.83 ₾\n• Алиса — 568.84 ₾\n• Стас — 447.80 ₾'
    )
    expect(text).not.toContain('2026')
    expect(text).not.toContain('.00 ₾')
    expect(payload?.reply_markup?.inline_keyboard).toEqual([
      [
        { text: 'Подробнее', callback_data: 'status:details:current' },
        { text: 'Покупки', callback_data: 'status:balances:current' }
      ],
      [{ text: '‹ Меню', callback_data: 'home:menu' }]
    ])
    expect(text).not.toContain('Начисления')
    expect(text).not.toContain('Кто платит')
  })

  test('renders household status from rent member summaries during rent stage', async () => {
    const repository = createRepository()
    const financeService: FinanceCommandService = {
      ...createFinanceService(),
      generateDashboard: async () => ({
        ...createDashboard(),
        period: '2026-05',
        billingStage: 'rent',
        paymentBalanceAdjustmentPolicy: 'rent',
        utilityBillingPlan: null,
        rentBillingState: {
          dueDate: '2026-05-20',
          paymentDestinations: null,
          memberSummaries: [
            {
              memberId: 'member-1',
              displayName: 'Стас',
              due: Money.fromMajor('447.80', 'GEL'),
              paid: Money.zero('GEL'),
              remaining: Money.zero('GEL')
            },
            {
              memberId: 'member-2',
              displayName: 'Ион',
              due: Money.fromMajor('608.15', 'GEL'),
              paid: Money.zero('GEL'),
              remaining: Money.fromMajor('608.15', 'GEL')
            }
          ]
        },
        members: [
          {
            memberId: 'member-1',
            displayName: 'Стас',
            rentShare: Money.fromMajor('470.73', 'GEL'),
            utilityShare: Money.fromMajor('78.17', 'GEL'),
            purchaseOffset: Money.fromMajor('-101.10', 'GEL'),
            netDue: Money.fromMajor('447.80', 'GEL'),
            paid: Money.zero('GEL'),
            remaining: Money.fromMajor('447.80', 'GEL'),
            overduePayments: [],
            explanations: []
          },
          {
            memberId: 'member-2',
            displayName: 'Ион',
            rentShare: Money.fromMajor('470.73', 'GEL'),
            utilityShare: Money.fromMajor('78.17', 'GEL'),
            purchaseOffset: Money.fromMajor('59.25', 'GEL'),
            netDue: Money.fromMajor('608.15', 'GEL'),
            paid: Money.zero('GEL'),
            remaining: Money.fromMajor('608.15', 'GEL'),
            overduePayments: [],
            explanations: []
          }
        ]
      })
    }
    const bot = createTelegramBot('000000:test-token', undefined, repository)
    createFinanceCommandsService({
      householdConfigurationRepository: repository,
      financeServiceForHousehold: () => financeService
    }).register(bot)

    bot.botInfo = {
      id: 999000,
      is_bot: true,
      first_name: 'Household Test Bot',
      username: 'household_test_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: true,
      allows_users_to_create_topics: false
    }

    const calls: Array<{ method: string; payload: unknown }> = []
    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })
      return {
        ok: true,
        result: {
          message_id: calls.length,
          date: Math.floor(Date.now() / 1000),
          chat: {
            id: -100123456,
            type: 'supergroup'
          },
          text: 'ok'
        }
      } as never
    })

    await bot.handleUpdate(callbackUpdate('home:status', 'ru', 'supergroup') as never)

    const text = firstMessagePayload(calls)?.text ?? ''
    expect(text.split('\n')[1]).toEndWith(' · аренда до 20 мая')
    expect(text).toContain('\nАренда: $700 (~1 890 ₾) · до 20 мая · осталось 608.15 ₾\n')
    expect(text).toContain('• Ион — 608.15 ₾')
    expect(text).toContain('• Стас — 447.80 ₾')
    expect(text).toContain('Покупки идут в счёт аренды')
    expect(text).toContain('\nКоммуналка:')
  })

  test('omits recent activity when there are no recent purchases or payments', async () => {
    const repository = createRepository()
    const financeService: FinanceCommandService = {
      ...createFinanceService(),
      generateDashboard: async () => ({
        ...createDashboard(),
        ledger: [
          {
            id: 'utility-1',
            kind: 'utility',
            title: 'Electricity',
            memberId: 'member-1',
            amount: Money.fromMajor('82', 'GEL'),
            currency: 'GEL',
            displayAmount: Money.fromMajor('82', 'GEL'),
            displayCurrency: 'GEL',
            fxRateMicros: null,
            fxEffectiveDate: null,
            actorDisplayName: 'Стас',
            occurredAt: instantFromIso('2026-03-10T12:00:00.000Z').toString(),
            paymentKind: null
          }
        ]
      })
    }
    const bot = createTelegramBot('000000:test-token', undefined, repository)
    createFinanceCommandsService({
      householdConfigurationRepository: repository,
      financeServiceForHousehold: () => financeService
    }).register(bot)

    bot.botInfo = {
      id: 999000,
      is_bot: true,
      first_name: 'Household Test Bot',
      username: 'household_test_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: true,
      allows_users_to_create_topics: false
    }

    const calls: Array<{ method: string; payload: unknown }> = []
    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })
      return {
        ok: true,
        result: {
          message_id: calls.length,
          date: Math.floor(Date.now() / 1000),
          chat: {
            id: -100123456,
            type: 'supergroup'
          },
          text: 'ok'
        }
      } as never
    })

    await bot.handleUpdate(callbackUpdate('home:status', 'ru', 'supergroup') as never)

    const text = firstMessagePayload(calls)?.text ?? ''
    expect(text).toContain('🏠 Kojori House · март')
    expect(text).not.toContain('Последнее:')
  })

  test('renders private household status with read-only actions and mini app button', async () => {
    const repository: HouseholdConfigurationRepository = {
      ...createRepository(),
      getHouseholdChatByHouseholdId: async () => ({
        householdId: 'household-1',
        householdName: 'Kojori House',
        telegramChatId: '-100123456',
        telegramChatType: 'supergroup',
        title: 'Kojori',
        defaultLocale: 'ru'
      })
    }
    const promptRepository = createPromptRepository()
    const financeService = createFinanceService()
    const bot = createTelegramBot('000000:test-token', undefined, repository)
    createFinanceCommandsService({
      householdConfigurationRepository: repository,
      financeServiceForHousehold: () => financeService,
      promptRepository,
      miniAppUrl: 'https://app.example/mini'
    }).register(bot)

    bot.botInfo = {
      id: 999000,
      is_bot: true,
      first_name: 'Household Test Bot',
      username: 'household_test_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: true,
      allows_users_to_create_topics: false
    }

    const calls: Array<{ method: string; payload: unknown }> = []
    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })
      return {
        ok: true,
        result: {
          message_id: calls.length,
          date: Math.floor(Date.now() / 1000),
          chat: {
            id: 123456,
            type: 'private'
          },
          text: 'ok'
        }
      } as never
    })

    await bot.handleUpdate(callbackUpdate('home:status', 'ru', 'private') as never)

    const payload = firstMessagePayload(calls)
    expect(payload?.text?.split('\n')[0]).toBe('🏠 Kojori House · март')
    expect(payload?.reply_markup?.inline_keyboard).toEqual([
      [
        { text: 'Подробнее', callback_data: 'status:details:current' },
        { text: 'Покупки', callback_data: 'status:balances:current' }
      ],
      [
        {
          text: '📱 Приложение',
          web_app: { url: 'https://app.example/mini?bot=household_test_bot' }
        }
      ],
      [{ text: '‹ Меню', callback_data: 'home:menu' }]
    ])
    expect(promptRepository.current()?.payload).toMatchObject({
      kind: 'status_action',
      householdId: 'household-1',
      memberId: 'member-1'
    })
  })

  test('handles home finance navigation callbacks as read-only flows', async () => {
    const repository = createRepository()
    const financeService = createFinanceService()
    const bot = createTelegramBot('000000:test-token', undefined, repository)
    createFinanceCommandsService({
      householdConfigurationRepository: repository,
      financeServiceForHousehold: () => financeService
    }).register(bot)

    bot.botInfo = {
      id: 999000,
      is_bot: true,
      first_name: 'Household Test Bot',
      username: 'household_test_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: true,
      allows_users_to_create_topics: false
    }

    const calls: Array<{ method: string; payload: unknown }> = []
    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })
      return {
        ok: true,
        result: {
          message_id: calls.length,
          date: Math.floor(Date.now() / 1000),
          chat: {
            id: 123456,
            type: 'private'
          },
          text: 'ok'
        }
      } as never
    })

    await bot.handleUpdate(callbackUpdate('home:balances', 'ru', 'private') as never)

    const messagePayload = calls.find((call) => call.method === 'editMessageText')?.payload as
      | { text?: string }
      | undefined
    expect(messagePayload?.text).toContain('🛒 <b>Покупки за март</b>')
    expect(calls.some((call) => call.method === 'answerCallbackQuery')).toBe(true)
  })

  test('lets private users choose a household before rendering status', async () => {
    const repository: HouseholdConfigurationRepository = {
      ...createRepository(),
      listHouseholdMembersByTelegramUserId: async () => [
        {
          id: 'member-1',
          householdId: 'household-1',
          telegramUserId: '123456',
          displayName: 'Stan',
          status: 'active',
          preferredLocale: 'ru',
          householdDefaultLocale: 'ru',
          rentShareWeight: 1,
          isAdmin: true
        },
        {
          id: 'member-2',
          householdId: 'household-2',
          telegramUserId: '123456',
          displayName: 'Stan',
          status: 'active',
          preferredLocale: 'ru',
          householdDefaultLocale: 'ru',
          rentShareWeight: 1,
          isAdmin: false
        }
      ],
      getHouseholdChatByHouseholdId: async (householdId) => ({
        householdId,
        householdName: householdId === 'household-1' ? 'Kojori House' : 'City Flat',
        telegramChatId: householdId === 'household-1' ? '-100123456' : '-100987654',
        telegramChatType: 'supergroup',
        title: householdId === 'household-1' ? 'Kojori' : 'City',
        defaultLocale: 'ru'
      })
    }
    const promptRepository = createPromptRepository()
    const financeService = createFinanceService()
    const bot = createTelegramBot('000000:test-token', undefined, repository)
    createFinanceCommandsService({
      householdConfigurationRepository: repository,
      financeServiceForHousehold: () => financeService,
      promptRepository
    }).register(bot)

    bot.botInfo = {
      id: 999000,
      is_bot: true,
      first_name: 'Household Test Bot',
      username: 'household_test_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: true,
      allows_users_to_create_topics: false
    }

    const calls: Array<{ method: string; payload: unknown }> = []
    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })
      return {
        ok: true,
        result: {
          message_id: calls.length,
          date: Math.floor(Date.now() / 1000),
          chat: {
            id: 123456,
            type: 'private'
          },
          text: 'ok'
        }
      } as never
    })

    await bot.handleUpdate(callbackUpdate('home:status', 'ru', 'private') as never)

    const chooserPayload = firstMessagePayload(calls)
    expect(chooserPayload?.text).toBe('Какой дом показать?')
    expect(chooserPayload?.reply_markup?.inline_keyboard).toEqual([
      [{ text: 'Kojori House', callback_data: 'status:show:0' }],
      [{ text: 'City Flat', callback_data: 'status:show:1' }],
      [{ text: '‹ Меню', callback_data: 'home:menu' }]
    ])
    expect(promptRepository.current()?.payload).toMatchObject({
      kind: 'status_choose',
      choices: [
        { householdId: 'household-1', memberId: 'member-1' },
        { householdId: 'household-2', memberId: 'member-2' }
      ]
    })

    const callsBeforeChoice = calls.length
    await bot.handleUpdate(callbackUpdate('status:show:1', 'ru', 'private') as never)

    const statusPayload = firstMessagePayload(calls.slice(callsBeforeChoice))
    expect(statusPayload?.text?.split('\n')[0]).toBe('🏠 City Flat · март')
    expect(promptRepository.current()?.payload).toMatchObject({
      kind: 'status_action',
      householdId: 'household-2',
      memberId: 'member-2'
    })
  })

  test('status quick actions honour a period carried in the callback data', async () => {
    const repository = createRepository()
    const dashboardPeriods: Array<string | undefined> = []
    const billPlanPeriods: Array<string | undefined> = []
    const financeService: FinanceCommandService = {
      ...createFinanceService(),
      generateDashboard: async (periodArg) => {
        dashboardPeriods.push(periodArg)
        return {
          ...createDashboard(),
          period: periodArg ?? '2026-03'
        }
      },
      generateCurrentBillPlan: async (periodArg) => {
        billPlanPeriods.push(periodArg)
        return {
          period: periodArg ?? '2026-03',
          currency: 'GEL',
          timezone: 'Asia/Tbilisi',
          billingStage: 'rent',
          rentConversion: sameCurrencyRentConversion(),
          utilityBillingPlan: null,
          rentBillingState: {
            dueDate: '2026-05-20',
            paymentDestinations: null,
            memberSummaries: [
              {
                memberId: 'member-1',
                displayName: 'Стас',
                due: Money.fromMajor('200', 'GEL'),
                paid: Money.zero('GEL'),
                remaining: Money.fromMajor('200', 'GEL')
              }
            ]
          },
          members: []
        }
      }
    }
    const bot = createTelegramBot('000000:test-token', undefined, repository)
    createFinanceCommandsService({
      householdConfigurationRepository: repository,
      financeServiceForHousehold: () => financeService
    }).register(bot)

    bot.botInfo = {
      id: 999000,
      is_bot: true,
      first_name: 'Household Test Bot',
      username: 'household_test_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: true,
      allows_users_to_create_topics: false
    }

    const calls: Array<{ method: string; payload: unknown }> = []
    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })
      return {
        ok: true,
        result: {
          message_id: calls.length,
          date: Math.floor(Date.now() / 1000),
          chat: {
            id: -100123456,
            type: 'supergroup'
          },
          text: 'ok'
        }
      } as never
    })

    await bot.handleUpdate(callbackUpdate('status:details:2026-05', 'ru', 'supergroup') as never)
    await bot.handleUpdate(callbackUpdate('status:balances:2026-05', 'ru', 'supergroup') as never)

    expect(dashboardPeriods).toEqual(['2026-05'])
    expect(billPlanPeriods).toEqual(['2026-05'])
  })

  test('renders purchase balance lines only under the member who paid', async () => {
    const repository = createRepository()
    const financeService: FinanceCommandService = {
      ...createFinanceService(),
      generateDashboard: async () => ({
        ...createDashboard(),
        period: '2026-05',
        members: [
          {
            memberId: 'member-1',
            displayName: 'Стас',
            rentShare: Money.fromMajor('200', 'GEL'),
            utilityShare: Money.fromMajor('20', 'GEL'),
            purchaseOffset: Money.fromMajor('15', 'GEL'),
            netDue: Money.fromMajor('215', 'GEL'),
            paid: Money.zero('GEL'),
            remaining: Money.fromMajor('215', 'GEL'),
            overduePayments: [],
            explanations: []
          },
          {
            memberId: 'member-2',
            displayName: 'Дима',
            rentShare: Money.fromMajor('200', 'GEL'),
            utilityShare: Money.fromMajor('20', 'GEL'),
            purchaseOffset: Money.fromMajor('-15', 'GEL'),
            netDue: Money.fromMajor('185', 'GEL'),
            paid: Money.zero('GEL'),
            remaining: Money.fromMajor('185', 'GEL'),
            overduePayments: [],
            explanations: []
          }
        ],
        ledger: [
          {
            id: 'purchase-1',
            kind: 'purchase',
            title: 'Корм',
            memberId: 'member-2',
            amount: Money.fromMajor('30', 'GEL'),
            currency: 'GEL',
            displayAmount: Money.fromMajor('30', 'GEL'),
            displayCurrency: 'GEL',
            fxRateMicros: null,
            fxEffectiveDate: null,
            actorDisplayName: 'Дима',
            occurredAt: instantFromIso('2026-05-03T12:00:00.000Z').toString(),
            paymentKind: null,
            payerMemberId: 'member-2',
            resolutionStatus: 'unresolved',
            purchaseParticipants: [
              {
                memberId: 'member-1',
                included: true,
                shareAmount: Money.fromMajor('15', 'GEL')
              },
              {
                memberId: 'member-2',
                included: true,
                shareAmount: Money.fromMajor('15', 'GEL')
              }
            ]
          }
        ]
      })
    }
    const bot = createTelegramBot('000000:test-token', undefined, repository)
    createFinanceCommandsService({
      householdConfigurationRepository: repository,
      financeServiceForHousehold: () => financeService
    }).register(bot)

    bot.botInfo = {
      id: 999000,
      is_bot: true,
      first_name: 'Household Test Bot',
      username: 'household_test_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: true,
      allows_users_to_create_topics: false
    }

    const calls: Array<{ method: string; payload: unknown }> = []
    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })
      return {
        ok: true,
        result: {
          message_id: calls.length,
          date: Math.floor(Date.now() / 1000),
          chat: {
            id: -100123456,
            type: 'supergroup'
          },
          text: 'ok'
        }
      } as never
    })

    await bot.handleUpdate(callbackUpdate('home:balances', 'ru', 'supergroup') as never)

    const payload = firstMessagePayload(calls)
    const text = payload?.text ?? ''
    const lines = text.split('\n')
    const stasIndex = lines.indexOf('<b>Стас</b> · долг 15 ₾')
    const dimaIndex = lines.indexOf('<b>Дима</b> · в плюсе 15 ₾')
    expect(payload?.parse_mode).toBe('HTML')
    expect(lines[0]).toBe('🛒 <b>Покупки за май</b>')
    expect(stasIndex).toBeGreaterThanOrEqual(0)
    // Стас paid for nothing, so no purchase line sits under his name.
    expect(lines[stasIndex + 1]).toBe('')
    expect(dimaIndex).toBeGreaterThanOrEqual(0)
    expect(lines[dimaIndex + 1]).toBe('• Корм · 30 ₾ · на всех')
    expect(text.match(/Корм/g)?.length ?? 0).toBe(1)
    expect(text).not.toContain('👥')
  })

  test('renders English purchase balance wording from the home purchases button', async () => {
    const repository = createEnglishRepository()
    const financeService: FinanceCommandService = {
      ...createFinanceService(),
      generateDashboard: async () => createDashboard()
    }
    const bot = createTelegramBot('000000:test-token', undefined, repository)
    createFinanceCommandsService({
      householdConfigurationRepository: repository,
      financeServiceForHousehold: () => financeService
    }).register(bot)

    bot.botInfo = {
      id: 999000,
      is_bot: true,
      first_name: 'Household Test Bot',
      username: 'household_test_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: true,
      allows_users_to_create_topics: false
    }

    const calls: Array<{ method: string; payload: unknown }> = []
    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })
      return {
        ok: true,
        result: {
          message_id: calls.length,
          date: Math.floor(Date.now() / 1000),
          chat: {
            id: 123456,
            type: 'private'
          },
          text: 'ok'
        }
      } as never
    })

    await bot.handleUpdate(callbackUpdate('home:balances', 'en', 'private') as never)

    const text = firstMessagePayload(calls)?.text ?? ''
    expect(text).toContain('🛒 <b>Purchases for March</b>')
    expect(text).toContain('\n<b>Стас</b> · 10 ₾ in credit\n')
    expect(text).toContain('\n<b>Ион</b> · 10 ₾ owed')
    expect(text).not.toContain('Purchase credit:')
    expect(text).not.toContain('Purchase due:')
    expect(text).not.toMatch(/Покупки|в плюсе|долг/)
  })

  test('renders the utility bill plan and quick action button for assigned members', async () => {
    const repository = createRepository()
    const promptRepository = createPromptRepository()
    const financeService: FinanceCommandService = {
      ...createFinanceService(),
      generateCurrentBillPlan: async () => ({
        period: '2026-04',
        currency: 'GEL',
        timezone: 'Asia/Tbilisi',
        billingStage: 'utilities',
        rentConversion: sameCurrencyRentConversion(),
        utilityBillingPlan: {
          id: 'utility-plan-1',
          version: 1,
          status: 'active',
          dueDate: '2026-04-04',
          updatedFromVersion: null,
          reason: null,
          categories: [
            {
              utilityBillId: 'utility-gas',
              billName: 'Gas',
              billTotal: Money.fromMajor('300', 'GEL'),
              assignedAmount: Money.fromMajor('300', 'GEL'),
              remainingAmount: Money.fromMajor('300', 'GEL'),
              assignedMemberId: 'member-1',
              assignedDisplayName: 'Стас',
              paidAmount: Money.zero('GEL'),
              isFullAssignment: true,
              splitGroupId: null
            }
          ],
          memberSummaries: []
        },
        rentBillingState: {
          dueDate: '2026-04-20',
          memberSummaries: [],
          paymentDestinations: null
        }
      })
    }
    const bot = createTelegramBot('000000:test-token', undefined, repository)
    createFinanceCommandsService({
      householdConfigurationRepository: repository,
      financeServiceForHousehold: () => financeService,
      promptRepository
    }).register(bot)

    bot.botInfo = {
      id: 999000,
      is_bot: true,
      first_name: 'Household Test Bot',
      username: 'household_test_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: true,
      allows_users_to_create_topics: false
    }

    const calls: Array<{ method: string; payload: unknown }> = []
    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })
      return {
        ok: true,
        result: {
          message_id: calls.length,
          date: Math.floor(Date.now() / 1000),
          chat: {
            id: -100123456,
            type: 'supergroup'
          },
          text: 'ok'
        }
      } as never
    })

    await bot.handleUpdate(callbackUpdate('home:my_bill_full', 'ru', 'supergroup') as never)

    const payload = firstMessagePayload(calls)
    const text = payload?.text ?? ''

    expect(text.split('\n')[0]).toBe('💡 Коммуналка за апрель, подробно · до 4 апреля')
    expect(text).toContain('Осталось оплатить: 300 ₾')
    expect(text).toContain('• Gas — 300 ₾')
    expect(text).not.toContain('Gas: 300')
    expect(text).not.toContain('/bill_full')
    expect(payload?.reply_markup?.inline_keyboard).toEqual([
      [{ text: '✅ Оплачено', callback_data: 'bill:resolve:current' }],
      [
        { text: 'Общий счёт', callback_data: 'bill:view:household' },
        { text: 'Мой счёт', callback_data: 'bill:view:mine' }
      ]
    ])
    expect(promptRepository.current()?.action).toBe('bill_command')
    expect(promptRepository.current()?.payload).toMatchObject({
      kind: 'resolve',
      householdId: 'household-1',
      viewerMemberId: 'member-1'
    })
  })

  test('renders the home my bill button as a personal summary with navigation buttons', async () => {
    const repository = createRepository()
    const financeService: FinanceCommandService = {
      ...createFinanceService(),
      generateDashboard: async () => createDashboard()
    }
    const bot = createTelegramBot('000000:test-token', undefined, repository)
    createFinanceCommandsService({
      householdConfigurationRepository: repository,
      financeServiceForHousehold: () => financeService,
      promptRepository: createPromptRepository()
    }).register(bot)

    bot.botInfo = {
      id: 999000,
      is_bot: true,
      first_name: 'Household Test Bot',
      username: 'household_test_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: true,
      allows_users_to_create_topics: false
    }

    const calls: Array<{ method: string; payload: unknown }> = []
    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })
      return {
        ok: true,
        result: {
          message_id: calls.length,
          date: Math.floor(Date.now() / 1000),
          chat: {
            id: 123456,
            type: 'private'
          },
          text: 'ok'
        }
      } as never
    })

    await bot.handleUpdate(callbackUpdate('home:my_bill', 'ru', 'private') as never)

    const payload = firstMessagePayload(calls)
    const text = payload?.text ?? ''
    const [title, leadLine] = text.split('\n')
    expect(title).toStartWith('⏳ ')
    expect(title).toMatch(/мой счёт за март$/i)
    expect(leadLine).toBe('Осталось оплатить: 110 ₾')
    expect(text).toContain('\nЗа месяц: 210 ₾ · оплачено 100 ₾\n')
    expect(text).toContain('\nАренда: 200 ₾\nКоммуналка: 20 ₾\n')
    expect(text).toContain('Покупки: в плюсе 10 ₾, вернётся следующими коммуналками')
    expect(text).not.toContain('.00 ₾')
    expect(payload?.reply_markup?.inline_keyboard).toEqual([
      [
        { text: 'Общий счёт', callback_data: 'bill:view:household' },
        { text: 'Подробнее', callback_data: 'home:my_bill_full' }
      ],
      [
        { text: 'Покупки', callback_data: 'home:balances' },
        { text: 'Сводка', callback_data: 'home:status' }
      ],
      [{ text: '‹ Меню', callback_data: 'home:menu' }]
    ])
    // The household chat lookup returns nothing here; the title must not fall back to
    // the internal household id.
    expect(title).not.toContain('household-1')
  })

  test('renders the home my bill summary in English with neutral wording', async () => {
    const repository = createEnglishRepository()
    const financeService: FinanceCommandService = {
      ...createFinanceService(),
      generateDashboard: async () => createDashboard()
    }
    const bot = createTelegramBot('000000:test-token', undefined, repository)
    createFinanceCommandsService({
      householdConfigurationRepository: repository,
      financeServiceForHousehold: () => financeService,
      promptRepository: createPromptRepository()
    }).register(bot)

    bot.botInfo = {
      id: 999000,
      is_bot: true,
      first_name: 'Household Test Bot',
      username: 'household_test_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: true,
      allows_users_to_create_topics: false
    }

    const calls: Array<{ method: string; payload: unknown }> = []
    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })
      return {
        ok: true,
        result: {
          message_id: calls.length,
          date: Math.floor(Date.now() / 1000),
          chat: {
            id: 123456,
            type: 'private'
          },
          text: 'ok'
        }
      } as never
    })

    await bot.handleUpdate(callbackUpdate('home:my_bill', 'en', 'private') as never)

    const payload = firstMessagePayload(calls)
    const text = payload?.text ?? ''
    const [title, leadLine] = text.split('\n')
    expect(title).toStartWith('⏳ ')
    expect(title).toMatch(/my bill for March$/i)
    expect(leadLine).toBe('Left to pay: 110 ₾')
    expect(text).toContain('\nThis month: 210 ₾ · paid 100 ₾\n')
    expect(text).toContain('\nRent: 200 ₾\nUtilities: 20 ₾\n')
    expect(text).toContain('Purchases: 10 ₾ in credit, comes back through the next utilities bills')
    expect(text).not.toMatch(/[А-Яа-яЁё]/)
    expect(payload?.reply_markup?.inline_keyboard?.flat().map((button) => button.text)).toEqual([
      'Household bill',
      'Details',
      'Purchases',
      'Overview',
      '‹ Menu'
    ])
  })

  test('falls back to a reply when editing the home my bill result fails', async () => {
    const repository = createRepository()
    const financeService: FinanceCommandService = {
      ...createFinanceService(),
      generateDashboard: async () => createDashboard()
    }
    const bot = createTelegramBot('000000:test-token', undefined, repository)
    createFinanceCommandsService({
      householdConfigurationRepository: repository,
      financeServiceForHousehold: () => financeService,
      promptRepository: createPromptRepository()
    }).register(bot)

    bot.botInfo = {
      id: 999000,
      is_bot: true,
      first_name: 'Household Test Bot',
      username: 'household_test_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: true,
      allows_users_to_create_topics: false
    }

    const calls: Array<{ method: string; payload: unknown }> = []
    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })
      if (method === 'editMessageText') {
        throw new Error('message is not editable')
      }
      return {
        ok: true,
        result: {
          message_id: calls.length,
          date: Math.floor(Date.now() / 1000),
          chat: {
            id: 123456,
            type: 'private'
          },
          text: 'ok'
        }
      } as never
    })

    await bot.handleUpdate(callbackUpdate('home:my_bill', 'ru', 'private') as never)

    expect(calls.some((call) => call.method === 'editMessageText')).toBe(true)
    expect(calls.some((call) => call.method === 'sendMessage')).toBe(true)
    expect(calls.some((call) => call.method === 'answerCallbackQuery')).toBe(true)
  })

  test('renders /bill for non-admin members with the current member first', async () => {
    const repository = createRepository()
    const utilityPlan: NonNullable<FinanceDashboard['utilityBillingPlan']> = {
      id: 'utility-plan-1',
      version: 1,
      status: 'active',
      dueDate: '2026-04-04',
      updatedFromVersion: null,
      reason: null,
      categories: [
        {
          utilityBillId: 'utility-internet',
          billName: 'Internet',
          billTotal: Money.fromMajor('80', 'GEL'),
          assignedAmount: Money.fromMajor('80', 'GEL'),
          remainingAmount: Money.fromMajor('80', 'GEL'),
          assignedMemberId: 'member-2',
          assignedDisplayName: 'Ион',
          paidAmount: Money.zero('GEL'),
          isFullAssignment: true,
          splitGroupId: null
        },
        {
          utilityBillId: 'utility-gas',
          billName: 'Gas',
          billTotal: Money.fromMajor('300', 'GEL'),
          assignedAmount: Money.fromMajor('300', 'GEL'),
          remainingAmount: Money.fromMajor('300', 'GEL'),
          assignedMemberId: 'member-1',
          assignedDisplayName: 'Стас',
          paidAmount: Money.zero('GEL'),
          isFullAssignment: true,
          splitGroupId: null
        }
      ],
      memberSummaries: [
        {
          memberId: 'member-2',
          displayName: 'Ион',
          fairShare: Money.fromMajor('95', 'GEL'),
          vendorPaid: Money.zero('GEL'),
          assignedThisCycle: Money.fromMajor('80', 'GEL'),
          projectedDeltaAfterPlan: Money.fromMajor('-15', 'GEL')
        },
        {
          memberId: 'member-1',
          displayName: 'Стас',
          fairShare: Money.fromMajor('95', 'GEL'),
          vendorPaid: Money.zero('GEL'),
          assignedThisCycle: Money.fromMajor('300', 'GEL'),
          projectedDeltaAfterPlan: Money.fromMajor('205', 'GEL')
        }
      ]
    }
    const financeService: FinanceCommandService = {
      ...createFinanceService(),
      getMemberByTelegramUserId: async (telegramUserId) =>
        telegramUserId === '123456'
          ? {
              id: 'member-1',
              telegramUserId,
              displayName: 'Стас',
              rentShareWeight: 1,
              isAdmin: false
            }
          : null,
      generateCurrentBillPlan: async () => ({
        period: '2026-04',
        currency: 'GEL',
        timezone: 'Asia/Tbilisi',
        billingStage: 'utilities',
        rentConversion: sameCurrencyRentConversion(),
        utilityBillingPlan: utilityPlan,
        rentBillingState: {
          dueDate: '2026-04-20',
          memberSummaries: [],
          paymentDestinations: null
        }
      }),
      generateDashboard: async () => ({
        ...createDashboard(),
        period: '2026-04',
        billingStage: 'utilities',
        totalDue: Money.fromMajor('380', 'GEL'),
        totalPaid: Money.zero('GEL'),
        totalRemaining: Money.fromMajor('380', 'GEL'),
        utilityBillingPlan: utilityPlan,
        paymentPeriods: [
          {
            period: '2026-04',
            utilityTotal: Money.fromMajor('380', 'GEL'),
            hasOverdueBalance: false,
            isCurrentPeriod: true,
            kinds: [
              {
                kind: 'utilities',
                totalDue: Money.fromMajor('380', 'GEL'),
                totalPaid: Money.zero('GEL'),
                totalRemaining: Money.fromMajor('380', 'GEL'),
                unresolvedMembers: [
                  {
                    memberId: 'member-1',
                    displayName: 'Стас',
                    suggestedAmount: Money.fromMajor('300', 'GEL'),
                    baseDue: Money.fromMajor('300', 'GEL'),
                    paid: Money.zero('GEL'),
                    remaining: Money.fromMajor('300', 'GEL'),
                    effectivelySettled: false
                  },
                  {
                    memberId: 'member-2',
                    displayName: 'Ион',
                    suggestedAmount: Money.fromMajor('80', 'GEL'),
                    baseDue: Money.fromMajor('80', 'GEL'),
                    paid: Money.zero('GEL'),
                    remaining: Money.fromMajor('80', 'GEL'),
                    effectivelySettled: false
                  }
                ]
              }
            ]
          }
        ]
      })
    }
    const registeredCards: Parameters<LivePaymentCardService['register']>[0][] = []
    const livePaymentCardService: LivePaymentCardService = {
      register: async (input) => {
        registeredCards.push(input)
      },
      refresh: async () => {}
    }
    const bot = createTelegramBot('000000:test-token', undefined, repository)
    createFinanceCommandsService({
      householdConfigurationRepository: repository,
      financeServiceForHousehold: () => financeService,
      livePaymentCardService
    }).register(bot)

    bot.botInfo = {
      id: 999000,
      is_bot: true,
      first_name: 'Household Test Bot',
      username: 'household_test_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: true,
      allows_users_to_create_topics: false
    }

    const calls: Array<{ method: string; payload: unknown }> = []
    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })
      return {
        ok: true,
        result: {
          message_id: calls.length,
          date: Math.floor(Date.now() / 1000),
          chat: {
            id: -100123456,
            type: 'supergroup'
          },
          text: 'ok'
        }
      } as never
    })

    await bot.handleUpdate(billUpdate('/bill', 'ru') as never)

    const payload = firstMessagePayload(calls)
    const text = payload?.text ?? ''
    expect(payload?.parse_mode).toBe('HTML')
    expect(text.split('\n')[0]).toBe('💡 <b>Коммуналка за апрель · до 4 апреля</b>')
    expect(text).toContain('\nОсталось 380 ₾\n')
    expect(text.indexOf('<b>Стас</b>')).toBeLessThan(text.indexOf('<b>Ион</b>'))
    expect(text).toContain('⏳ <b>Стас</b> · 300 ₾\n   • Gas · 300 ₾')
    expect(text).toContain('⏳ <b>Ион</b> · 80 ₾\n   • Internet · 80 ₾')
    // No "details in the app" filler next to the app button.
    expect(text).not.toContain('дашборд')
    expect(text).not.toContain('приложени')
    expect(payload?.reply_markup?.inline_keyboard).toEqual([
      [{ text: '✅ Отметить оплату', callback_data: 'pr:p:utilities:2026-04' }],
      [{ text: '📱 Приложение', url: 'https://t.me/household_test_bot?start=dashboard' }],
      [
        { text: 'Мой счёт', callback_data: 'bill:view:mine' },
        { text: 'Подробнее', callback_data: 'bill:view:full' }
      ]
    ])
    expect(registeredCards).toMatchObject([
      {
        householdId: 'household-1',
        kind: 'utilities',
        period: '2026-04',
        surface: 'bill',
        telegramChatId: '-100123456'
      }
    ])
  })

  test('does not call a member paid when the plan simply assigns them nothing', async () => {
    const repository = createRepository()
    const financeService: FinanceCommandService = {
      ...createFinanceService(),
      getMemberByTelegramUserId: async () => ({
        id: 'member-1',
        telegramUserId: '123456',
        displayName: 'Стас',
        rentShareWeight: 1,
        isAdmin: false
      }),
      generateCurrentBillPlan: async () => ({
        period: '2026-08',
        currency: 'GEL',
        timezone: 'Asia/Tbilisi',
        billingStage: 'utilities',
        rentConversion: sameCurrencyRentConversion(),
        members: [
          {
            memberId: 'member-2',
            displayName: 'Ион',
            utilityShare: Money.fromMajor('18.57', 'GEL'),
            // Owed nothing back, so no credit is covering him either.
            purchaseOffset: Money.fromMajor('11.25', 'GEL'),
            purchaseDrivers: []
          }
        ],
        utilityBillingPlan: {
          id: 'utility-plan-8',
          version: 8,
          status: 'active',
          dueDate: '2026-08-05',
          updatedFromVersion: 7,
          reason: 'manual_refresh',
          categories: [],
          memberSummaries: [
            {
              memberId: 'member-2',
              displayName: 'Ион',
              fairShare: Money.fromMajor('29.82', 'GEL'),
              // Nothing assigned and nothing paid: a redraw took his bill away.
              vendorPaid: Money.zero('GEL'),
              assignedThisCycle: Money.zero('GEL'),
              projectedDeltaAfterPlan: Money.fromMajor('-29.82', 'GEL')
            }
          ]
        },
        rentBillingState: {
          dueDate: '2026-08-20',
          memberSummaries: [],
          paymentDestinations: null
        }
      })
    }
    const bot = createTelegramBot('000000:test-token', undefined, repository)
    createFinanceCommandsService({
      householdConfigurationRepository: repository,
      financeServiceForHousehold: () => financeService
    }).register(bot)
    bot.botInfo = {
      id: 999000,
      is_bot: true,
      first_name: 'Household Test Bot',
      username: 'household_test_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: true,
      allows_users_to_create_topics: false
    }

    const calls: Array<{ method: string; payload: unknown }> = []
    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })
      return {
        ok: true,
        result: {
          message_id: calls.length,
          date: Math.floor(Date.now() / 1000),
          chat: { id: -100123456, type: 'supergroup' },
          text: 'ok'
        }
      } as never
    })

    await bot.handleUpdate(privateCommandUpdate('/bill utilities', 'ru') as never)

    const householdText = firstMessagePayload(calls)?.text ?? ''
    expect(householdText).toContain(
      '\n• Ион — платить не нужно\n  Покупки: долг 11.25 ₾, войдёт в следующую коммуналку'
    )
    expect(householdText).not.toContain('оплачено')
    // No bills entered yet, so there is no zero total above the members.
    expect(householdText).not.toContain('Счета:')

    // The viewer's own detailed bill, reached from the /home menu.
    const callsBeforeViewer = calls.length
    await bot.handleUpdate(callbackUpdate('home:my_bill_full', 'ru', 'supergroup') as never)

    const viewerText = firstMessagePayload(calls.slice(callsBeforeViewer))?.text ?? ''
    expect(viewerText).toContain('\nВ этом месяце платить не нужно.')
    expect(viewerText).not.toContain('Уже оплачено')
  })

  test('renders utility totals and balance-covered members transparently', async () => {
    const repository = createRepository()
    const financeService: FinanceCommandService = {
      ...createFinanceService(),
      generateCurrentBillPlan: async () => ({
        period: '2026-05',
        currency: 'GEL',
        timezone: 'Asia/Tbilisi',
        billingStage: 'utilities',
        rentConversion: sameCurrencyRentConversion(),
        members: [
          {
            memberId: 'member-1',
            displayName: 'Стас',
            utilityShare: Money.fromMajor('78.17', 'GEL'),
            purchaseOffset: Money.fromMajor('-101.10', 'GEL'),
            purchaseDrivers: [
              {
                purchaseId: 'purchase-groceries',
                title: 'Groceries',
                amount: Money.fromMajor('72.00', 'GEL'),
                direction: 'credit',
                occurredAt: '2026-05-02T10:00:00.000Z',
                payerMemberId: 'member-1',
                originPeriod: '2026-05'
              },
              {
                purchaseId: 'purchase-soap',
                title: 'Soap',
                amount: Money.fromMajor('29.10', 'GEL'),
                direction: 'credit',
                occurredAt: '2026-05-03T10:00:00.000Z',
                payerMemberId: 'member-1',
                originPeriod: '2026-05'
              }
            ]
          },
          {
            memberId: 'member-2',
            displayName: 'Дима',
            utilityShare: Money.fromMajor('78.17', 'GEL'),
            purchaseOffset: Money.fromMajor('-1.00', 'GEL'),
            purchaseDrivers: [
              {
                purchaseId: 'purchase-groceries',
                title: 'Groceries',
                amount: Money.fromMajor('72.00', 'GEL'),
                direction: 'debit',
                occurredAt: '2026-05-02T10:00:00.000Z',
                payerMemberId: 'member-2',
                originPeriod: '2026-05'
              },
              {
                purchaseId: 'purchase-tea',
                title: 'Tea',
                amount: Money.fromMajor('73.00', 'GEL'),
                direction: 'credit',
                occurredAt: '2026-05-03T10:00:00.000Z',
                payerMemberId: 'member-2',
                originPeriod: '2026-05'
              }
            ]
          },
          {
            memberId: 'member-3',
            displayName: 'Ион',
            utilityShare: Money.fromMajor('78.17', 'GEL'),
            purchaseOffset: Money.zero('GEL'),
            purchaseDrivers: [
              {
                purchaseId: 'purchase-1',
                title: 'One',
                amount: Money.fromMajor('1.00', 'GEL'),
                direction: 'debit',
                occurredAt: '2026-05-01T10:00:00.000Z',
                payerMemberId: 'member-3',
                originPeriod: '2026-05'
              },
              {
                purchaseId: 'purchase-2',
                title: 'Two',
                amount: Money.fromMajor('2.00', 'GEL'),
                direction: 'debit',
                occurredAt: '2026-05-02T10:00:00.000Z',
                payerMemberId: 'member-3',
                originPeriod: '2026-05'
              },
              {
                purchaseId: 'purchase-3',
                title: 'Three',
                amount: Money.fromMajor('3.00', 'GEL'),
                direction: 'debit',
                occurredAt: '2026-05-03T10:00:00.000Z',
                payerMemberId: 'member-3',
                originPeriod: '2026-05'
              },
              {
                purchaseId: 'purchase-4',
                title: 'Four',
                amount: Money.fromMajor('4.00', 'GEL'),
                direction: 'debit',
                occurredAt: '2026-05-04T10:00:00.000Z',
                payerMemberId: 'member-3',
                originPeriod: '2026-05'
              }
            ]
          }
        ],
        utilityBillingPlan: {
          id: 'utility-plan-1',
          version: 1,
          status: 'active',
          dueDate: '2026-05-06',
          updatedFromVersion: null,
          reason: null,
          categories: [
            {
              utilityBillId: 'utility-electricity',
              billName: 'Electricity',
              billTotal: Money.fromMajor('56.86', 'GEL'),
              assignedAmount: Money.fromMajor('56.86', 'GEL'),
              remainingAmount: Money.fromMajor('56.86', 'GEL'),
              assignedMemberId: 'member-2',
              assignedDisplayName: 'Дима',
              paidAmount: Money.zero('GEL'),
              isFullAssignment: true,
              splitGroupId: null
            },
            {
              utilityBillId: 'utility-gas',
              billName: 'Gas (Water)',
              billTotal: Money.fromMajor('253.33', 'GEL'),
              assignedAmount: Money.fromMajor('20.31', 'GEL'),
              remainingAmount: Money.fromMajor('20.31', 'GEL'),
              assignedMemberId: 'member-2',
              assignedDisplayName: 'Дима',
              paidAmount: Money.zero('GEL'),
              isFullAssignment: false,
              splitGroupId: 'utility-gas'
            }
          ],
          memberSummaries: [
            {
              memberId: 'member-1',
              displayName: 'Стас',
              fairShare: Money.zero('GEL'),
              vendorPaid: Money.zero('GEL'),
              assignedThisCycle: Money.zero('GEL'),
              projectedDeltaAfterPlan: Money.zero('GEL')
            },
            {
              memberId: 'member-2',
              displayName: 'Дима',
              fairShare: Money.fromMajor('77.17', 'GEL'),
              vendorPaid: Money.zero('GEL'),
              assignedThisCycle: Money.fromMajor('77.17', 'GEL'),
              projectedDeltaAfterPlan: Money.zero('GEL')
            },
            {
              memberId: 'member-3',
              displayName: 'Ион',
              fairShare: Money.zero('GEL'),
              vendorPaid: Money.zero('GEL'),
              assignedThisCycle: Money.zero('GEL'),
              projectedDeltaAfterPlan: Money.zero('GEL')
            }
          ]
        },
        rentBillingState: {
          dueDate: '2026-05-20',
          memberSummaries: [],
          paymentDestinations: null
        }
      })
    }
    const bot = createTelegramBot('000000:test-token', undefined, repository)
    createFinanceCommandsService({
      householdConfigurationRepository: repository,
      financeServiceForHousehold: () => financeService
    }).register(bot)

    bot.botInfo = {
      id: 999000,
      is_bot: true,
      first_name: 'Household Test Bot',
      username: 'household_test_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: true,
      allows_users_to_create_topics: false
    }

    const calls: Array<{ method: string; payload: unknown }> = []
    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })
      return {
        ok: true,
        result: {
          message_id: calls.length,
          date: Math.floor(Date.now() / 1000),
          chat: {
            id: -100123456,
            type: 'supergroup'
          },
          text: 'ok'
        }
      } as never
    })

    await bot.handleUpdate(billUpdate('/bill full utilities', 'ru') as never)

    const text = firstMessagePayload(calls)?.text ?? ''
    const blocks = text.split('\n\n')
    expect(blocks[0]).toBe(
      '💡 Коммуналка за май, подробно · до 6 мая\nСчета: 310.19 ₾ · по 103.40 ₾ на человека'
    )
    // Members who still owe come first.
    expect(blocks[1]).toBe(
      [
        'Дима — осталось 77.17 ₾',
        'Доля: 78.17 ₾ · Покупки: в плюсе 1 ₾, вернётся следующими коммуналками',
        'По покупкам: Tea −73 ₾; Groceries +72 ₾',
        '• Electricity — 56.86 ₾',
        '• Gas (Water) — 20.31 ₾ из 253.33 ₾'
      ].join('\n')
    )
    expect(blocks[2]).toBe(
      [
        'Стас — закрыто покупками',
        'Доля: 78.17 ₾ · Покупки: в плюсе 101.10 ₾, вернётся следующими коммуналками',
        'После коммуналки в плюсе 22.93 ₾',
        'По покупкам: Groceries −72 ₾; Soap −29.10 ₾'
      ].join('\n')
    )
    expect(blocks[3]).toBe(
      [
        'Ион — платить не нужно',
        'Доля: 78.17 ₾',
        'По покупкам: Four +4 ₾; Three +3 ₾; Two +2 ₾; One +1 ₾'
      ].join('\n')
    )
    expect(text).not.toContain('Electricity: 56.86 ₾')
    expect(text).not.toContain('Gas (Water): 20.31 ₾')
    expect(text).not.toContain('ещё 1')
    expect(text).not.toContain('твоим')
  })

  test('renders the member utility balance breakdown in plan details', async () => {
    const repository = createRepository()
    const financeService: FinanceCommandService = {
      ...createFinanceService(),
      generateCurrentBillPlan: async () => ({
        period: '2026-06',
        currency: 'GEL',
        timezone: 'Asia/Tbilisi',
        billingStage: 'utilities',
        rentConversion: sameCurrencyRentConversion(),
        members: [
          {
            memberId: 'member-1',
            displayName: 'Стас',
            utilityShare: Money.fromMajor('63.05', 'GEL'),
            purchaseOffset: Money.fromMajor('-12.00', 'GEL'),
            purchaseDrivers: []
          }
        ],
        utilityBillingPlan: {
          id: 'utility-plan-1',
          version: 1,
          status: 'active',
          dueDate: '2026-06-05',
          updatedFromVersion: null,
          reason: null,
          categories: [
            {
              utilityBillId: 'internet',
              billName: 'Internet',
              billTotal: Money.fromMajor('35.00', 'GEL'),
              assignedAmount: Money.fromMajor('28.12', 'GEL'),
              remainingAmount: Money.fromMajor('28.12', 'GEL'),
              assignedMemberId: 'member-1',
              assignedDisplayName: 'Стас',
              paidAmount: Money.zero('GEL'),
              isFullAssignment: false,
              splitGroupId: null
            }
          ],
          memberSummaries: [
            {
              memberId: 'member-1',
              displayName: 'Стас',
              fairShare: Money.fromMajor('28.12', 'GEL'),
              vendorPaid: Money.zero('GEL'),
              assignedThisCycle: Money.fromMajor('28.12', 'GEL'),
              projectedDeltaAfterPlan: Money.zero('GEL')
            }
          ]
        },
        rentBillingState: {
          dueDate: '2026-06-20',
          memberSummaries: [],
          paymentDestinations: null
        }
      })
    }
    const bot = createTelegramBot('000000:test-token', undefined, repository)
    createFinanceCommandsService({
      householdConfigurationRepository: repository,
      financeServiceForHousehold: () => financeService
    }).register(bot)

    bot.botInfo = {
      id: 999000,
      is_bot: true,
      first_name: 'Household Test Bot',
      username: 'household_test_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: true,
      allows_users_to_create_topics: false
    }

    const calls: Array<{ method: string; payload: unknown }> = []
    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })
      return {
        ok: true,
        result: {
          message_id: calls.length,
          date: Math.floor(Date.now() / 1000),
          chat: {
            id: -100123456,
            type: 'supergroup'
          },
          text: 'ok'
        }
      } as never
    })

    await bot.handleUpdate(billUpdate('/bill full utilities', 'ru') as never)

    const fullText = firstMessagePayload(calls)?.text ?? ''
    expect(fullText).toContain(
      [
        'Стас — осталось 28.12 ₾',
        'Доля: 63.05 ₾ · Покупки: в плюсе 12 ₾, вернётся следующими коммуналками',
        '• Internet — 28.12 ₾ из 35 ₾'
      ].join('\n')
    )
  })

  test('detailed utility bill does not describe recorded planned payments as balance-covered', async () => {
    const repository = createRepository()
    const financeService: FinanceCommandService = {
      ...createFinanceService(),
      generateCurrentBillPlan: async () => ({
        period: '2026-06',
        currency: 'GEL',
        timezone: 'Asia/Tbilisi',
        billingStage: 'utilities',
        rentConversion: sameCurrencyRentConversion(),
        members: [
          {
            memberId: 'member-1',
            displayName: 'Дима',
            utilityShare: Money.fromMajor('63.06', 'GEL'),
            purchaseOffset: Money.fromMajor('-18.00', 'GEL'),
            purchaseDrivers: []
          }
        ],
        utilityBillingPlan: {
          id: 'utility-plan-1',
          version: 1,
          status: 'active',
          dueDate: '2026-06-05',
          updatedFromVersion: null,
          reason: null,
          categories: [
            {
              utilityBillId: 'gas',
              billName: 'Gas',
              billTotal: Money.fromMajor('63.06', 'GEL'),
              assignedAmount: Money.fromMajor('63.06', 'GEL'),
              remainingAmount: Money.fromMajor('63.06', 'GEL'),
              assignedMemberId: 'member-1',
              assignedDisplayName: 'Дима',
              paidAmount: Money.fromMajor('63.06', 'GEL'),
              isFullAssignment: false,
              splitGroupId: null
            }
          ],
          memberSummaries: [
            {
              memberId: 'member-1',
              displayName: 'Дима',
              fairShare: Money.fromMajor('63.06', 'GEL'),
              vendorPaid: Money.fromMajor('63.06', 'GEL'),
              assignedThisCycle: Money.zero('GEL'),
              projectedDeltaAfterPlan: Money.zero('GEL')
            }
          ]
        },
        rentBillingState: {
          dueDate: '2026-06-20',
          memberSummaries: [],
          paymentDestinations: null
        }
      })
    }
    const bot = createTelegramBot('000000:test-token', undefined, repository)
    createFinanceCommandsService({
      householdConfigurationRepository: repository,
      financeServiceForHousehold: () => financeService
    }).register(bot)

    bot.botInfo = {
      id: 999000,
      is_bot: true,
      first_name: 'Household Test Bot',
      username: 'household_test_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: true,
      allows_users_to_create_topics: false
    }

    const calls: Array<{ method: string; payload: unknown }> = []
    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })
      return {
        ok: true,
        result: {
          message_id: calls.length,
          date: Math.floor(Date.now() / 1000),
          chat: {
            id: -100123456,
            type: 'supergroup'
          },
          text: 'ok'
        }
      } as never
    })

    await bot.handleUpdate(billUpdate('/bill full utilities', 'ru') as never)

    const text = firstMessagePayload(calls)?.text ?? ''
    expect(text).toContain(
      '\nДима — оплачено\nДоля: 63.06 ₾ · Покупки: в плюсе 18 ₾, вернётся следующими коммуналками'
    )
    expect(text).not.toContain('закрыто покупками')
    expect(text).not.toMatch(/после коммуналки/i)
  })

  test('renders rent as short payment instructions with destinations', async () => {
    const repository: HouseholdConfigurationRepository = {
      ...createRepository(),
      getHouseholdBillingSettings: async () => ({
        householdId: 'household-1',
        settlementCurrency: 'GEL',
        paymentBalanceAdjustmentPolicy: 'rent',
        rentAmountMinor: 70000n,
        rentCurrency: 'USD',
        rentDueDay: 20,
        rentWarningDay: 17,
        utilitiesDueDay: 4,
        utilitiesReminderDay: 3,
        preferredUtilityPayerMemberId: null,
        timezone: 'Asia/Tbilisi',
        rentPaymentDestinations: [
          {
            label: 'Landlord',
            recipientName: 'Nino',
            bankName: 'TBC',
            account: 'GE00TB123',
            note: 'April rent',
            link: null
          }
        ]
      })
    }
    const financeService: FinanceCommandService = {
      ...createFinanceService(),
      generateCurrentBillPlan: async () => ({
        period: '2026-04',
        currency: 'GEL',
        timezone: 'Asia/Tbilisi',
        billingStage: 'rent',
        rentConversion: {
          sourceAmount: Money.fromMajor('700', 'USD'),
          settlementAmount: Money.fromMajor('1890', 'GEL'),
          rateMicros: 2_700_000n,
          effectiveDate: '2026-04-17'
        },
        utilityBillingPlan: null,
        rentBillingState: {
          dueDate: '2026-04-20',
          memberSummaries: [
            {
              memberId: 'member-1',
              displayName: 'Стас',
              due: Money.fromMajor('500', 'GEL'),
              paid: Money.zero('GEL'),
              remaining: Money.fromMajor('500', 'GEL')
            }
          ],
          paymentDestinations: [
            {
              label: 'Landlord & Co',
              recipientName: 'Nino <Owner>',
              bankName: 'TBC',
              account: 'GE00TB123',
              note: 'April <rent>',
              link: null
            }
          ]
        }
      })
    }
    const bot = createTelegramBot('000000:test-token', undefined, repository)
    createFinanceCommandsService({
      householdConfigurationRepository: repository,
      financeServiceForHousehold: () => financeService
    }).register(bot)

    bot.botInfo = {
      id: 999000,
      is_bot: true,
      first_name: 'Household Test Bot',
      username: 'household_test_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: true,
      allows_users_to_create_topics: false
    }

    const calls: Array<{ method: string; payload: unknown }> = []
    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })
      return {
        ok: true,
        result: {
          message_id: calls.length,
          date: Math.floor(Date.now() / 1000),
          chat: {
            id: -100123456,
            type: 'supergroup'
          },
          text: 'ok'
        }
      } as never
    })

    await bot.handleUpdate(callbackUpdate('home:my_bill_full', 'ru', 'supergroup') as never)

    const payload = firstMessagePayload(calls)
    const text = payload?.text ?? ''
    expect(payload?.parse_mode).toBe('HTML')
    expect(text).toBe(
      [
        '🏠 <b>Аренда за апрель</b> · до 20 апреля',
        'К оплате: <b>500 ₾</b>',
        'Курс: 1 USD = 2.7000 GEL на 17 апреля',
        '',
        '<b>Куда переводить</b>',
        '<b>TBC · Landlord &amp; Co</b>',
        'Получатель: Nino &lt;Owner&gt;',
        'Счёт: <code>GE00TB123</code>',
        'Примечание: April &lt;rent&gt;'
      ].join('\n')
    )
    expect(text).not.toContain('Nino <Owner>')
    expect(text).not.toContain('Осталось оплатить')
    expect(payload?.reply_markup?.inline_keyboard?.[0]?.[0]).toEqual({
      text: '📋 TBC',
      copy_text: { text: 'GE00TB123' }
    })
  })

  test('renders group /bill rent as the reminder-style shared card', async () => {
    const repository: HouseholdConfigurationRepository = {
      ...createRepository(),
      getHouseholdBillingSettings: async () => ({
        householdId: 'household-1',
        settlementCurrency: 'GEL',
        paymentBalanceAdjustmentPolicy: 'rent',
        rentAmountMinor: 70000n,
        rentCurrency: 'USD',
        rentDueDay: 20,
        rentWarningDay: 17,
        utilitiesDueDay: 4,
        utilitiesReminderDay: 3,
        preferredUtilityPayerMemberId: null,
        timezone: 'Asia/Tbilisi',
        rentPaymentDestinations: [
          {
            label: 'Аренда дома',
            recipientName: 'Magda C.',
            bankName: 'TBC',
            account: 'GE86TB7298445064300062',
            note: null,
            link: null
          }
        ]
      }),
      getHouseholdMember: async () => ({
        id: 'member-1',
        householdId: 'household-1',
        telegramUserId: '123456',
        displayName: 'Stan',
        status: 'active',
        preferredLocale: 'ru',
        householdDefaultLocale: 'ru',
        rentShareWeight: 1,
        isAdmin: false
      })
    }
    const financeService: FinanceCommandService = {
      ...createFinanceService(),
      getMemberByTelegramUserId: async (telegramUserId) =>
        telegramUserId === '123456'
          ? {
              id: 'member-1',
              telegramUserId,
              displayName: 'Стас',
              rentShareWeight: 1,
              isAdmin: false
            }
          : null,
      generateCurrentBillPlan: async () => ({
        period: '2026-04',
        currency: 'GEL',
        timezone: 'Asia/Tbilisi',
        billingStage: 'rent',
        rentConversion: sameCurrencyRentConversion(),
        utilityBillingPlan: null,
        rentBillingState: {
          dueDate: '2026-04-20',
          memberSummaries: [
            {
              memberId: 'member-1',
              displayName: 'Стас',
              due: Money.fromMajor('472.00', 'GEL'),
              paid: Money.fromMajor('472.00', 'GEL'),
              remaining: Money.zero('GEL')
            },
            {
              memberId: 'member-2',
              displayName: 'Алиса',
              due: Money.fromMajor('472.00', 'GEL'),
              paid: Money.zero('GEL'),
              remaining: Money.fromMajor('472.00', 'GEL')
            }
          ],
          paymentDestinations: [
            {
              label: 'Аренда дома',
              recipientName: 'Magda C.',
              bankName: 'TBC',
              account: 'GE86TB7298445064300062',
              note: null,
              link: null
            }
          ]
        }
      }),
      generateDashboard: async () => ({
        ...createDashboard(),
        period: '2026-04',
        billingStage: 'rent',
        totalDue: Money.fromMajor('944.00', 'GEL'),
        totalPaid: Money.fromMajor('472.00', 'GEL'),
        totalRemaining: Money.fromMajor('472.00', 'GEL'),
        rentPaymentDestinations: [
          {
            label: 'Аренда дома',
            recipientName: 'Magda C.',
            bankName: 'TBC',
            account: 'GE86TB7298445064300062',
            note: null,
            link: null
          }
        ],
        rentBillingState: {
          dueDate: '2026-04-20',
          memberSummaries: [
            {
              memberId: 'member-1',
              displayName: 'Стас',
              due: Money.fromMajor('472.00', 'GEL'),
              paid: Money.fromMajor('472.00', 'GEL'),
              remaining: Money.zero('GEL')
            },
            {
              memberId: 'member-2',
              displayName: 'Алиса',
              due: Money.fromMajor('472.00', 'GEL'),
              paid: Money.zero('GEL'),
              remaining: Money.fromMajor('472.00', 'GEL')
            }
          ],
          paymentDestinations: null
        },
        paymentPeriods: [
          {
            period: '2026-04',
            utilityTotal: Money.zero('GEL'),
            hasOverdueBalance: false,
            isCurrentPeriod: true,
            kinds: [
              {
                kind: 'rent',
                totalDue: Money.fromMajor('944.00', 'GEL'),
                totalPaid: Money.fromMajor('472.00', 'GEL'),
                totalRemaining: Money.fromMajor('472.00', 'GEL'),
                unresolvedMembers: [
                  {
                    memberId: 'member-2',
                    displayName: 'Алиса',
                    suggestedAmount: Money.fromMajor('472.00', 'GEL'),
                    baseDue: Money.fromMajor('472.00', 'GEL'),
                    paid: Money.zero('GEL'),
                    remaining: Money.fromMajor('472.00', 'GEL'),
                    effectivelySettled: false
                  }
                ]
              }
            ]
          }
        ]
      })
    }
    const bot = createTelegramBot('000000:test-token', undefined, repository)
    createFinanceCommandsService({
      householdConfigurationRepository: repository,
      financeServiceForHousehold: () => financeService
    }).register(bot)

    bot.botInfo = {
      id: 999000,
      is_bot: true,
      first_name: 'Household Test Bot',
      username: 'household_test_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: true,
      allows_users_to_create_topics: false
    }

    const calls: Array<{ method: string; payload: unknown }> = []
    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })
      return {
        ok: true,
        result: {
          message_id: calls.length,
          date: Math.floor(Date.now() / 1000),
          chat: {
            id: -100123456,
            type: 'supergroup'
          },
          text: 'ok'
        }
      } as never
    })

    await bot.handleUpdate(billUpdate('/bill rent', 'ru') as never)

    const payload = firstMessagePayload(calls)
    const text = payload?.text ?? ''
    expect(payload?.parse_mode).toBe('HTML')
    expect(text.split('\n')[0]).toBe('🏠 <b>Аренда за апрель · до 20 апреля</b>')
    expect(text).toContain('\nОплатили 1 из 2 · осталось 472 ₾\n')
    expect(text).toContain('\n✅ <s>Стас</s>\n⏳ <b>Алиса</b> · 472 ₾\n')
    expect(text).toContain('\n🏦 TBC · Аренда дома\n')
    expect(text.match(/Получатель: Magda C\./g)?.length ?? 0).toBe(1)
    expect(text).toContain('\n<code>GE86TB7298445064300062</code>')
    expect(text).not.toContain('дашборд')
    expect(text).not.toContain('Осталось оплатить')
    expect(text).not.toContain('💱')
    expect(text).not.toContain('оплатил ')
    expect(payload?.reply_markup?.inline_keyboard?.[0]).toEqual([
      { text: '✅ Отметить оплату', callback_data: 'pr:p:rent:2026-04' },
      { text: '📋 TBC', copy_text: { text: 'GE86TB7298445064300062' } }
    ])
    expect(JSON.stringify(payload?.reply_markup)).toContain('start=dashboard')
    expect(JSON.stringify(payload?.reply_markup)).not.toContain('home:menu')
  })

  test('uses short callback data for /bill quick actions with long ids', async () => {
    const promptRepository = createPromptRepository()
    const repository: HouseholdConfigurationRepository = {
      ...createRepository(),
      getTelegramHouseholdChat: async () => ({
        householdId: 'household-1-with-a-very-long-id-segment-for-regression-check',
        householdName: 'Kojori House',
        telegramChatId: '-100123456',
        telegramChatType: 'supergroup',
        title: 'Kojori',
        defaultLocale: 'ru'
      })
    }
    const financeService: FinanceCommandService = {
      ...createFinanceService(),
      getMemberByTelegramUserId: async (telegramUserId) =>
        telegramUserId === '123456'
          ? {
              id: 'member-1-with-a-very-long-id-segment-for-regression-check',
              telegramUserId,
              displayName: 'Стас',
              rentShareWeight: 1,
              isAdmin: true
            }
          : null,
      generateCurrentBillPlan: async () => ({
        period: '2026-04',
        currency: 'GEL',
        timezone: 'Asia/Tbilisi',
        billingStage: 'utilities',
        rentConversion: sameCurrencyRentConversion(),
        utilityBillingPlan: {
          id: 'utility-plan-1',
          version: 1,
          status: 'active',
          dueDate: '2026-04-04',
          updatedFromVersion: null,
          reason: null,
          categories: [
            {
              utilityBillId: 'utility-gas',
              billName: 'Gas',
              billTotal: Money.fromMajor('300', 'GEL'),
              assignedAmount: Money.fromMajor('300', 'GEL'),
              remainingAmount: Money.fromMajor('300', 'GEL'),
              assignedMemberId: 'member-1-with-a-very-long-id-segment-for-regression-check',
              assignedDisplayName: 'Стас',
              paidAmount: Money.zero('GEL'),
              isFullAssignment: true,
              splitGroupId: null
            }
          ],
          memberSummaries: []
        },
        rentBillingState: {
          dueDate: '2026-04-20',
          memberSummaries: [],
          paymentDestinations: null
        }
      })
    }
    const bot = createTelegramBot('000000:test-token', undefined, repository)
    createFinanceCommandsService({
      householdConfigurationRepository: repository,
      financeServiceForHousehold: () => financeService,
      promptRepository
    }).register(bot)

    bot.botInfo = {
      id: 999000,
      is_bot: true,
      first_name: 'Household Test Bot',
      username: 'household_test_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: true,
      allows_users_to_create_topics: false
    }

    const calls: Array<{ method: string; payload: unknown }> = []
    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })
      return {
        ok: true,
        result: {
          message_id: calls.length,
          date: Math.floor(Date.now() / 1000),
          chat: {
            id: -100123456,
            type: 'supergroup'
          },
          text: 'ok'
        }
      } as never
    })

    await bot.handleUpdate(callbackUpdate('home:my_bill_full', 'ru', 'supergroup') as never)

    const buttons = firstMessagePayload(calls)?.reply_markup?.inline_keyboard?.flat() ?? []

    expect(buttons[0]?.callback_data).toBe('bill:resolve:current')
    expect(buttons.length).toBeGreaterThan(0)
    for (const button of buttons) {
      expect(button.callback_data?.length ?? 0).toBeLessThanOrEqual(64)
    }
  })

  test('omits planned utility resolve button when the viewer has no unresolved plan amount', async () => {
    const promptRepository = createPromptRepository()
    const repository = createRepository()
    const financeService: FinanceCommandService = {
      ...createFinanceService(),
      generateCurrentBillPlan: async () => ({
        period: '2026-04',
        currency: 'GEL',
        timezone: 'Asia/Tbilisi',
        billingStage: 'utilities',
        rentConversion: sameCurrencyRentConversion(),
        utilityBillingPlan: {
          id: 'utility-plan-1',
          version: 1,
          status: 'active',
          dueDate: '2026-04-04',
          updatedFromVersion: null,
          reason: null,
          categories: [
            {
              utilityBillId: 'utility-gas',
              billName: 'Gas',
              billTotal: Money.fromMajor('300', 'GEL'),
              assignedAmount: Money.fromMajor('300', 'GEL'),
              remainingAmount: Money.fromMajor('300', 'GEL'),
              assignedMemberId: 'member-1',
              assignedDisplayName: 'Стас',
              paidAmount: Money.fromMajor('300', 'GEL'),
              isFullAssignment: true,
              splitGroupId: null
            }
          ],
          memberSummaries: [
            {
              memberId: 'member-1',
              displayName: 'Стас',
              fairShare: Money.fromMajor('300', 'GEL'),
              vendorPaid: Money.fromMajor('300', 'GEL'),
              assignedThisCycle: Money.zero('GEL'),
              projectedDeltaAfterPlan: Money.zero('GEL')
            }
          ]
        },
        rentBillingState: {
          dueDate: '2026-04-20',
          memberSummaries: [],
          paymentDestinations: null
        }
      })
    }
    const bot = createTelegramBot('000000:test-token', undefined, repository)
    createFinanceCommandsService({
      householdConfigurationRepository: repository,
      financeServiceForHousehold: () => financeService,
      promptRepository
    }).register(bot)

    bot.botInfo = {
      id: 999000,
      is_bot: true,
      first_name: 'Household Test Bot',
      username: 'household_test_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: true,
      allows_users_to_create_topics: false
    }

    const calls: Array<{ method: string; payload: unknown }> = []
    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })
      return {
        ok: true,
        result: {
          message_id: calls.length,
          date: Math.floor(Date.now() / 1000),
          chat: {
            id: -100123456,
            type: 'supergroup'
          },
          text: 'ok'
        }
      } as never
    })

    await bot.handleUpdate(callbackUpdate('home:my_bill_full', 'ru', 'supergroup') as never)

    const payload = firstMessagePayload(calls)
    const buttons = payload?.reply_markup?.inline_keyboard?.flat() ?? []

    expect(payload?.text).toContain('\nУже оплачено.')
    expect(buttons.length).toBeGreaterThan(0)
    expect(buttons.some((button) => button.callback_data === 'bill:resolve:current')).toBe(false)
    expect(promptRepository.current()).toBeNull()
  })

  test('does not answer removed finance commands', async () => {
    const repository = createRepository()
    const bot = createTelegramBot('000000:test-token', undefined, repository)
    createFinanceCommandsService({
      householdConfigurationRepository: repository,
      financeServiceForHousehold: () => createFinanceService()
    }).register(bot)

    bot.botInfo = {
      id: 999000,
      is_bot: true,
      first_name: 'Household Test Bot',
      username: 'household_test_bot',
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
      has_topics_enabled: true,
      allows_users_to_create_topics: false
    }

    const calls: Array<{ method: string; payload: unknown }> = []
    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })
      return {
        ok: true,
        result: true
      } as never
    })

    for (const command of [
      '/bill_all',
      '/bill_full',
      '/my_bill',
      '/my_bill_full',
      '/bill_json',
      '/household_status',
      '/balance',
      '/cycle_open 2026-05',
      '/cycle_close',
      '/rent_set 700 USD',
      '/utility_add Gas 30',
      '/payment_add rent',
      '/statement',
      '/utilities'
    ]) {
      await bot.handleUpdate(billUpdate(command, 'ru') as never)
      await bot.handleUpdate(privateCommandUpdate(command, 'ru') as never)
    }

    expect(calls).toHaveLength(0)
  })
})
