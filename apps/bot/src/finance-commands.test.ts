import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import type { FinanceCommandService } from '@household/application'
import { Money, instantFromIso, nowInstant } from '@household/domain'
import type {
  HouseholdConfigurationRepository,
  TelegramPendingActionRecord,
  TelegramPendingActionRepository
} from '@household/ports'

import { createTelegramBot } from './bot'
import { createFinanceCommandsService } from './finance-commands'
import { registerReminderTopicUtilities } from './reminder-topic-utilities'

function householdStatusUpdate(languageCode: string) {
  return {
    update_id: 9100,
    message: {
      message_id: 10,
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
      text: '/household_status',
      entities: [
        {
          offset: 0,
          length: 17,
          type: 'bot_command'
        }
      ]
    }
  }
}

function privateHouseholdStatusUpdate(text: string, languageCode: string) {
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

function topicCommandUpdate(text: string, languageCode: string) {
  return {
    update_id: 9300,
    message: {
      message_id: 12,
      date: Math.floor(Date.now() / 1000),
      message_thread_id: 555,
      is_topic_message: true,
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

function topicMessageUpdate(text: string, languageCode: string) {
  return {
    update_id: 9301,
    message: {
      message_id: 13,
      date: Math.floor(Date.now() / 1000),
      message_thread_id: 555,
      is_topic_message: true,
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
      text
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

function createFinanceService(): FinanceCommandService {
  return {
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
    getOpenCycle: async () => ({
      id: 'cycle-1',
      period: '2026-03',
      currency: 'GEL'
    }),
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

    await bot.handleUpdate(householdStatusUpdate('ru') as never)

    const payload = calls[0]?.payload as
      | {
          text?: string
          reply_markup?: {
            inline_keyboard?: Array<Array<{ text: string; callback_data?: string }>>
          }
        }
      | undefined
    const text = payload?.text ?? ''
    expect(text).toContain('🏠 Kojori House · май 2026')
    expect(text).toContain('💡 Сейчас: коммуналка · до 6 мая')
    expect(text).toContain('🏡 Аренда: $700.00 (~1890.00 ₾)')
    expect(text).toContain('💡 Коммуналка: 312.69 ₾ · до 6 мая · сейчас 312.69 ₾')
    expect(text).toContain('📊 Итого осталось: 2195.62 ₾')
    expect(text).toContain('🛒 Покупки → коммуналка')
    expect(text).toContain('🧾 Последнее')
    expect(text).toContain('Покупки:')
    expect(text).toContain('• 2 мая · Стас: Не показывать как начисление · 407.50 ₾')
    expect(text).toContain('Оплаты:')
    expect(text).toContain('• 4 мая · Ион: коммуналка · 50.00 ₾')
    expect(text).toContain('👥 Участники: 4 активн.')
    expect(text).toContain('• Ион: 608.15 ₾')
    expect(text).toContain('• Дима: 570.83 ₾')
    expect(text).toContain('• Алиса: 568.84 ₾')
    expect(text).toContain('• Стас: 447.80 ₾')
    expect(payload?.reply_markup?.inline_keyboard?.[0]).toEqual([
      { text: 'Детали', callback_data: 'status:details:current' },
      { text: 'Балансы', callback_data: 'status:balances:current' }
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

    await bot.handleUpdate(householdStatusUpdate('ru') as never)

    const text = (calls[0]?.payload as { text?: string } | undefined)?.text ?? ''
    expect(text).toContain('🏡 Сейчас: аренда · до 20 мая')
    expect(text).toContain('🏡 Аренда: $700.00 (~1890.00 ₾) · до 20 мая · осталось 608.15 ₾')
    expect(text).toContain('• Ион: 608.15 ₾')
    expect(text).toContain('• Стас: 447.80 ₾')
    expect(text).toContain('🛒 Покупки → аренда')
    expect(text).toContain('💡 Коммуналка:')
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

    await bot.handleUpdate(householdStatusUpdate('ru') as never)

    const text = (calls[0]?.payload as { text?: string } | undefined)?.text ?? ''
    expect(text).not.toContain('🧾 Последнее')
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

    await bot.handleUpdate(privateHouseholdStatusUpdate('/household_status', 'ru') as never)

    const payload = calls[0]?.payload as
      | {
          text?: string
          reply_markup?: {
            inline_keyboard?: Array<
              Array<{ text: string; callback_data?: string; web_app?: { url: string } }>
            >
          }
        }
      | undefined
    expect(payload?.text).toContain('🏠 Kojori House · март 2026')
    expect(payload?.reply_markup?.inline_keyboard?.[0]).toEqual([
      { text: 'Детали', callback_data: 'status:details:current' },
      { text: 'Балансы', callback_data: 'status:balances:current' }
    ])
    expect(payload?.reply_markup?.inline_keyboard?.[1]?.[0]).toEqual({
      text: 'Открыть мини-приложение',
      web_app: { url: 'https://app.example/mini?bot=household_test_bot' }
    })
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
    expect(messagePayload?.text).toContain('🛒 Покупки')
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

    await bot.handleUpdate(privateHouseholdStatusUpdate('/household_status 2026-05', 'ru') as never)

    const chooserPayload = calls[0]?.payload as
      | {
          text?: string
          reply_markup?: {
            inline_keyboard?: Array<Array<{ text: string; callback_data: string }>>
          }
        }
      | undefined
    expect(chooserPayload?.text).toBe('Выберите дом для статуса:')
    expect(chooserPayload?.reply_markup?.inline_keyboard).toEqual([
      [{ text: 'Kojori House', callback_data: 'status:show:0' }],
      [{ text: 'City Flat', callback_data: 'status:show:1' }],
      [{ text: '🏡 Меню', callback_data: 'home:menu' }]
    ])
    expect(promptRepository.current()?.payload).toMatchObject({
      kind: 'status_choose',
      periodArg: '2026-05'
    })

    await bot.handleUpdate(callbackUpdate('status:show:1', 'ru', 'private') as never)

    const editPayload = calls.find((call) => call.method === 'editMessageText')?.payload as
      | { text?: string }
      | undefined
    expect(editPayload?.text).toContain('🏠 City Flat')
    expect(promptRepository.current()?.payload).toMatchObject({
      kind: 'status_action',
      householdId: 'household-2',
      memberId: 'member-2',
      periodArg: '2026-05'
    })
  })

  test('status quick actions preserve the requested period', async () => {
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

    await bot.handleUpdate({
      ...householdStatusUpdate('ru'),
      message: {
        ...householdStatusUpdate('ru').message,
        text: '/household_status 2026-05'
      }
    } as never)
    await bot.handleUpdate(callbackUpdate('status:details:2026-05', 'ru', 'supergroup') as never)
    await bot.handleUpdate(callbackUpdate('status:balances:2026-05', 'ru', 'supergroup') as never)

    expect(dashboardPeriods).toEqual(['2026-05', '2026-05'])
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

    await bot.handleUpdate(billUpdate('/balance', 'ru') as never)

    const text = (calls[0]?.payload as { text?: string } | undefined)?.text ?? ''
    const lines = text.split('\n')
    const stasIndex = lines.indexOf('👤 Стас')
    const dimaIndex = lines.indexOf('👤 Дима')
    expect(text).toContain('🛒 Покупки · май 2026')
    expect(stasIndex).toBeGreaterThanOrEqual(0)
    expect(lines[stasIndex + 1]).toBe('Покупки: остаток 15.00 ₾')
    expect(dimaIndex).toBeGreaterThanOrEqual(0)
    expect(lines[dimaIndex + 1]).toBe('Покупки: в плюсе 15.00 ₾')
    expect(text).not.toContain('👤 Стас ·')
    expect(text).not.toContain('👤 Дима ·')
    expect(text).not.toContain('По покупкам к доплате')
    expect(text).not.toContain('По покупкам в плюсе')
    expect(text).toContain('  • Корм: -30.00 ₾ 👥')
  })

  test('renders English purchase balance wording through a command path', async () => {
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

    await bot.handleUpdate(privateHouseholdStatusUpdate('/balance', 'en') as never)

    const text = (calls[0]?.payload as { text?: string } | undefined)?.text ?? ''
    expect(text).toContain('Purchases: credit 10.00 ₾')
    expect(text).toContain('Purchases: remaining 10.00 ₾')
    expect(text).not.toContain('Purchase credit:')
    expect(text).not.toContain('Purchase due:')
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

    await bot.handleUpdate(billUpdate('/my_bill utilities', 'ru') as never)

    const payload = calls[0]?.payload as
      | {
          text?: string
          reply_markup?: {
            inline_keyboard?: Array<Array<{ text: string; callback_data: string }>>
          }
        }
      | undefined

    expect(payload?.text).toContain('Коммуналка')
    expect(payload?.text).toContain('👤 Стас')
    expect(payload?.text).toContain('К оплате: 300.00 ₾')
    expect(payload?.text).not.toContain('Gas: 300.00 ₾')
    expect(payload?.text).toContain('Детали: /bill_full')
    expect(payload?.reply_markup?.inline_keyboard).toEqual([
      [
        {
          text: 'Оплачено по плану',
          callback_data: 'bill:resolve:current'
        }
      ],
      [
        {
          text: '🏡 Меню',
          callback_data: 'home:menu'
        }
      ]
    ])
    expect(promptRepository.current()?.action).toBe('bill_command')
  })

  test('renders plain /my_bill as a personal finance summary with navigation buttons', async () => {
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

    await bot.handleUpdate(privateHouseholdStatusUpdate('/my_bill', 'ru') as never)

    const payload = calls.find((call) => call.method === 'sendMessage')?.payload as
      | {
          text?: string
          reply_markup?: {
            inline_keyboard?: Array<Array<{ text: string; callback_data: string }>>
          }
        }
      | undefined
    expect(payload?.text).toContain('💸 Мой счёт')
    expect(payload?.text).toContain('Остаток: 110.00 ₾')
    expect(payload?.text).not.toContain('К оплате: 110.00 ₾')
    expect(payload?.text).toContain('Начислено: 210.00 ₾')
    expect(payload?.text).toContain('Покупки: в плюсе 10.00 ₾')
    expect(payload?.text).toContain('\nАренда: 200.00 ₾\nКоммуналка: 20.00 ₾')
    expect(payload?.reply_markup?.inline_keyboard).toEqual([
      [
        {
          text: '🔎 Весь счёт',
          callback_data: 'home:my_bill_full'
        },
        {
          text: '🛒 Балансы',
          callback_data: 'home:balances'
        }
      ],
      [
        {
          text: '🏠 Статус',
          callback_data: 'home:status'
        },
        {
          text: '🏡 Меню',
          callback_data: 'home:menu'
        }
      ]
    ])
  })

  test('renders plain /my_bill in English with neutral summary wording', async () => {
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

    await bot.handleUpdate(privateHouseholdStatusUpdate('/my_bill', 'en') as never)

    const payload = calls.find((call) => call.method === 'sendMessage')?.payload as
      | {
          text?: string
        }
      | undefined
    expect(payload?.text).toContain('💸 My bill')
    expect(payload?.text).toContain('Remaining: 110.00 ₾')
    expect(payload?.text).not.toContain('To pay: 110.00 ₾')
    expect(payload?.text).toContain('Total due: 210.00 ₾')
    expect(payload?.text).toContain('Purchases: credit 10.00 ₾')
    expect(payload?.text).toContain('\nRent: 200.00 ₾\nUtilities: 20.00 ₾')
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
        utilityBillingPlan: {
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

    await bot.handleUpdate(billUpdate('/bill', 'ru') as never)

    const payload = calls[0]?.payload as { text?: string } | undefined
    const text = payload?.text ?? ''
    expect(text).toContain('Коммуналка')
    expect(text.indexOf('👤 Стас')).toBeLessThan(text.indexOf('👤 Ион'))
    expect(text).toContain('К оплате: 300.00 ₾')
    expect(text).toContain('К оплате: 80.00 ₾')
    expect(text).not.toContain('Gas: 300.00 ₾')
    expect(text).not.toContain('Internet: 80.00 ₾')
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

    await bot.handleUpdate(billUpdate('/bill utilities', 'ru') as never)

    const text = (calls[0]?.payload as { text?: string } | undefined)?.text ?? ''
    expect(text).toContain('💰 Счета: 310.19 ₾')
    expect(text).toContain('доля 103.40 ₾')
    expect(text).toContain('👤 Дима')
    expect(text).toContain('К оплате: 77.17 ₾')
    expect(text).toContain('Счета: Electricity 56.86 ₾; Gas (Water) 20.31 ₾')
    expect(text).toContain('Покупки: в плюсе 1.00 ₾')
    expect(text).not.toContain('Electricity: 56.86 ₾')
    expect(text).not.toContain('Gas (Water): 20.31 ₾')
    expect(text).toContain('👤 Стас')
    expect(text).toContain('✅ Закрыто твоим плюсом')
    expect(text).toContain('В плюсе после коммуналки: 22.93 ₾')
    expect(text).toContain('👤 Ион')
    expect(text).toContain('✅ Уже оплачено')

    calls.length = 0
    await bot.handleUpdate(billUpdate('/bill_full utilities', 'ru') as never)

    const fullText = (calls[0]?.payload as { text?: string } | undefined)?.text ?? ''
    expect(fullText).toContain('Electricity — 56.86 ₾')
    expect(fullText).toContain('Gas (Water) — 20.31 ₾ из 253.33 ₾')
    expect(fullText).toContain('Покупки: Four +4.00 ₾; Three +3.00 ₾; Two +2.00 ₾; One +1.00 ₾')
    expect(fullText).not.toContain('ещё 1')
  })

  test('renders carry-forward utility credit in plan details', async () => {
    const repository = createRepository()
    const financeService: FinanceCommandService = {
      ...createFinanceService(),
      generateCurrentBillPlan: async () => ({
        period: '2026-06',
        currency: 'GEL',
        timezone: 'Asia/Tbilisi',
        billingStage: 'utilities',
        members: [
          {
            memberId: 'member-1',
            displayName: 'Стас',
            utilityShare: Money.fromMajor('63.05', 'GEL'),
            purchaseOffset: Money.fromMajor('-12.00', 'GEL'),
            carryForwardCredit: Money.fromMajor('99.99', 'GEL'),
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
          ],
          carryForwardCredits: [
            {
              memberId: 'member-1',
              creditCreated: Money.zero('GEL'),
              creditConsumed: Money.fromMajor('22.93', 'GEL'),
              policyTarget: 'utilities'
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

    await bot.handleUpdate(billUpdate('/bill_full utilities', 'ru') as never)

    const fullText = (calls[0]?.payload as { text?: string } | undefined)?.text ?? ''
    expect(fullText).toContain(
      'Доля: 63.05 ₾ · Покупки: в плюсе 12.00 ₾ · Перенос: 22.93 ₾ · План: 28.12 ₾'
    )
    expect(fullText).toContain('Осталось оплатить: 28.12 ₾')
    expect(fullText).toContain('Internet — 28.12 ₾ из 35.00 ₾')
  })

  test('compact utility bill does not describe recorded planned payments as balance-covered', async () => {
    const repository = createRepository()
    const financeService: FinanceCommandService = {
      ...createFinanceService(),
      generateCurrentBillPlan: async () => ({
        period: '2026-06',
        currency: 'GEL',
        timezone: 'Asia/Tbilisi',
        billingStage: 'utilities',
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

    await bot.handleUpdate(billUpdate('/bill utilities', 'ru') as never)

    const text = (calls[0]?.payload as { text?: string } | undefined)?.text ?? ''
    expect(text).toContain('👤 Дима')
    expect(text).toContain('✅ Уже оплачено')
    expect(text).toContain('Покупки: в плюсе 18.00 ₾')
    expect(text).not.toContain('Закрыто твоим плюсом')
    expect(text).not.toContain('После коммуналки к доплате')
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
              label: 'Landlord',
              recipientName: 'Nino',
              bankName: 'TBC',
              account: 'GE00TB123',
              note: 'April rent',
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

    await bot.handleUpdate(billUpdate('/my_bill rent', 'ru') as never)

    const text = (calls[0]?.payload as { text?: string } | undefined)?.text ?? ''
    expect(text).toContain('Аренда')
    expect(text).toContain('Осталось оплатить: 500.00 ₾')
    expect(text).toContain('- Landlord')
    expect(text).toContain('получатель: Nino')
    expect(text).toContain('счёт: GE00TB123')
  })

  test('renders /bill rent with shared payment details once and natural settled wording', async () => {
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

    const text = (calls[0]?.payload as { text?: string } | undefined)?.text ?? ''
    expect(text).toContain('Реквизиты для оплаты:')
    expect(text.match(/получатель: Magda C\./g)?.length ?? 0).toBe(1)
    expect(text).toContain('Стас\nУже оплачено.')
    expect(text).not.toContain('Стас\nК оплате')
    expect(text).toContain('Алиса\nОсталось оплатить: 472.00 ₾')
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

    await bot.handleUpdate(billUpdate('/my_bill utilities', 'ru') as never)

    const payload = calls[0]?.payload as
      | {
          reply_markup?: {
            inline_keyboard?: Array<Array<{ text: string; callback_data: string }>>
          }
        }
      | undefined

    expect(
      payload?.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data.length
    ).toBeLessThanOrEqual(64)
    expect(payload?.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data).toBe(
      'bill:resolve:current'
    )
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

    await bot.handleUpdate(billUpdate('/my_bill utilities', 'ru') as never)

    const payload = calls[0]?.payload as
      | {
          reply_markup?: {
            inline_keyboard?: Array<Array<{ text: string; callback_data?: string }>>
          }
        }
      | undefined
    const buttons = payload?.reply_markup?.inline_keyboard?.flat() ?? []

    expect(buttons.some((button) => button.callback_data === 'bill:resolve:current')).toBe(false)
    expect(promptRepository.current()).toBeNull()
  })

  test('does not handle removed /bill_all command', async () => {
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

    await bot.handleUpdate(billUpdate('/bill_all', 'ru') as never)

    expect(calls).toHaveLength(0)
  })

  test('arms the template reply flow for /utilities in the reminders topic', async () => {
    const promptRepository = createPromptRepository()
    const repository: HouseholdConfigurationRepository = {
      ...createRepository(),
      findHouseholdTopicByTelegramContext: async () => ({
        householdId: 'household-1',
        role: 'reminders',
        telegramThreadId: '555',
        topicName: 'Напоминания'
      }),
      listHouseholdUtilityCategories: async () => [
        {
          id: 'cat-1',
          householdId: 'household-1',
          slug: 'internet',
          name: 'Internet',
          sortOrder: 1,
          isActive: true
        },
        {
          id: 'cat-2',
          householdId: 'household-1',
          slug: 'gas-water',
          name: 'Gas (Water)',
          sortOrder: 2,
          isActive: true
        },
        {
          id: 'cat-3',
          householdId: 'household-1',
          slug: 'cleaning',
          name: 'Cleaning',
          sortOrder: 3,
          isActive: true
        },
        {
          id: 'cat-4',
          householdId: 'household-1',
          slug: 'electricity',
          name: 'Electricity',
          sortOrder: 4,
          isActive: true
        }
      ]
    }
    const addedUtilityBills: Array<{ billName: string; amountMajor: string }> = []
    const financeService: FinanceCommandService = {
      ...createFinanceService(),
      addUtilityBill: async (billName, amountMajor) => {
        addedUtilityBills.push({ billName, amountMajor })
        return null
      }
    }
    const bot = createTelegramBot('000000:test-token', undefined, repository)
    createFinanceCommandsService({
      householdConfigurationRepository: repository,
      financeServiceForHousehold: () => financeService,
      promptRepository
    }).register(bot)
    registerReminderTopicUtilities({
      bot,
      householdConfigurationRepository: repository,
      promptRepository,
      financeServiceForHousehold: () => financeService
    })

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

    await bot.handleUpdate(topicCommandUpdate('/utilities', 'ru') as never)

    const pendingPayload = promptRepository.current()?.payload as
      | {
          stage?: string
          categories?: string[]
        }
      | undefined
    expect(pendingPayload?.stage).toBe('template')
    expect(pendingPayload?.categories).toEqual([
      'Internet',
      'Gas (Water)',
      'Cleaning',
      'Electricity'
    ])

    calls.length = 0
    await bot.handleUpdate(
      topicMessageUpdate(
        'Internet:\nGas (Water): 321.07\nCleaning: 2.50\nElectricity: 83.09',
        'ru'
      ) as never
    )

    const payload = calls[0]?.payload as { text?: string } | undefined
    expect(payload?.text).toContain('- Gas (Water): 321.07 ₾')
    expect(payload?.text).toContain('- Cleaning: 2.50 ₾')
    expect(payload?.text).toContain('- Electricity: 83.09 ₾')
    expect(addedUtilityBills).toEqual([])
  })

  test('exports billing audit json as a document for admins', async () => {
    const repository = createRepository()
    const financeService: FinanceCommandService = {
      ...createFinanceService(),
      generateBillingAuditExport: async () => ({
        meta: {
          exportVersion: 'billing-audit/v1',
          exportedAt: '2026-04-02T12:00:00.000Z',
          period: '2026-04',
          billingStage: 'utilities',
          adjustmentPolicy: 'utilities',
          householdId: 'household-1',
          currency: 'GEL',
          timezone: 'Asia/Tbilisi'
        },
        descriptions: {
          sections: {
            meta: 'Meta',
            warnings: 'Warnings',
            settings: 'Settings',
            rawInputs: 'Raw inputs',
            derived: 'Derived',
            utilityPlan: 'Plan',
            rentState: 'Rent',
            dashboard: 'Dashboard'
          },
          adjustmentPolicies: {
            utilities: 'Utilities mode',
            rent: 'Rent mode',
            separate: 'Manual mode'
          },
          derivedFields: {
            purchaseOffset: 'offset',
            rawUtilityFairShare: 'share',
            adjustedUtilityTarget: 'adjusted utility',
            rawRentShare: 'rent share',
            adjustedRentTarget: 'adjusted rent',
            assignedThisCycle: 'assigned',
            projectedDeltaAfterPlan: 'delta',
            remaining: 'remaining'
          },
          snapshotSemantics: {
            settlementSnapshotLines: 'Frozen historical snapshot.',
            utilityPlanPayloadFairShareByMember: 'Plan input semantics.'
          }
        },
        warnings: [],
        household: {
          householdId: 'household-1'
        },
        settings: {
          settlementCurrency: 'GEL',
          timezone: 'Asia/Tbilisi',
          rentDueDay: 20,
          rentWarningDay: 17,
          utilitiesDueDay: 4,
          utilitiesReminderDay: 3,
          preferredUtilityPayerMemberId: null,
          paymentBalanceAdjustmentPolicy: 'utilities',
          rentAmount: {
            amountMinor: '241500',
            amountMajor: '2415.00',
            currency: 'GEL',
            display: '2415.00 ₾'
          },
          rentPaymentDestinations: null,
          utilityCategories: []
        },
        cycle: {
          openCycle: {
            id: 'cycle-1',
            period: '2026-04',
            currency: 'GEL'
          },
          selectedCycle: {
            id: 'cycle-1',
            period: '2026-04',
            currency: 'GEL'
          },
          rentRule: null,
          rentFx: {
            sourceAmount: {
              amountMinor: '70000',
              amountMajor: '700.00',
              currency: 'USD',
              display: '$700.00'
            },
            settlementAmount: {
              amountMinor: '241500',
              amountMajor: '2415.00',
              currency: 'GEL',
              display: '2415.00 ₾'
            },
            rateMicros: '3450000',
            effectiveDate: '2026-04-01'
          }
        },
        members: [],
        presenceDays: [],
        rawInputs: {
          utilityBills: [],
          parsedPurchases: [],
          paymentRecords: [],
          utilityVendorPaymentFacts: [],
          utilityReimbursementFacts: [],
          utilityPlanVersions: [],
          settlementSnapshot: {
            isFrozenHistoricalSnapshot: true,
            description: 'Frozen historical snapshot.',
            lines: []
          }
        },
        derived: {
          totals: {
            totalDue: {
              amountMinor: '0',
              amountMajor: '0.00',
              currency: 'GEL',
              display: '0.00 ₾'
            },
            totalPaid: {
              amountMinor: '0',
              amountMajor: '0.00',
              currency: 'GEL',
              display: '0.00 ₾'
            },
            totalRemaining: {
              amountMinor: '0',
              amountMajor: '0.00',
              currency: 'GEL',
              display: '0.00 ₾'
            }
          },
          members: [],
          paymentPeriods: []
        },
        utilityPlan: {
          explanation: 'Utility explanation',
          fieldSemantics: {
            rawCycleFairShareByMember: 'raw',
            adjustedTargetByMember: 'adjusted',
            planPayloadFairShareByMember: 'input'
          },
          rawCycleFairShareByMember: [],
          adjustedTargetByMember: [],
          plan: null
        },
        rentState: {
          explanation: 'Rent explanation',
          state: {
            dueDate: '2026-04-20',
            memberSummaries: [],
            paymentDestinations: null
          }
        },
        dashboard: {
          snapshot: {
            period: '2026-04'
          }
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
          document: {
            file_id: 'doc-1',
            file_unique_id: 'doc-unique',
            file_name: 'billing-audit-2026-04.json',
            file_size: 1024
          }
        }
      } as never
    })

    await bot.handleUpdate(billUpdate('/bill_json', 'ru') as never)

    const call = calls[0]
    expect(call?.method).toBe('sendDocument')
    const payload = call?.payload as { caption?: string; document?: { filename?: string } }
    expect(payload?.caption).toContain('Аудит расчётов')
    expect(payload?.document).toBeTruthy()
  })
})
