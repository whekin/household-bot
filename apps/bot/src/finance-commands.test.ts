import { describe, expect, test } from 'bun:test'
import type { FinanceCommandService } from '@household/application'
import { Money, instantFromIso } from '@household/domain'
import type { HouseholdConfigurationRepository } from '@household/ports'

import { createTelegramBot } from './bot'
import { createFinanceCommandsService } from './finance-commands'

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
    updateHouseholdMemberStatus: async () => null,
    listHouseholdMemberAbsencePolicies: async () => [],
    upsertHouseholdMemberAbsencePolicy: async () => null
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
    updateUtilityBill: async () => null,
    deleteUtilityBill: async () => false,
    updatePurchase: async () => null,
    deletePurchase: async () => false,
    addPayment: async () => null,
    addPurchase: async () => ({
      purchaseId: 'test-purchase',
      amount: Money.fromMinor(0n, 'GEL'),
      currency: 'GEL'
    }),
    updatePayment: async () => null,
    deletePayment: async () => false,
    generateCurrentBillPlan: async () => null,
    resolveUtilityBillAsPlanned: async () => null,
    recordUtilityVendorPayment: async () => null,
    recordUtilityReimbursement: async () => null,
    rebalanceUtilityPlan: async () => null,
    generateDashboard: async () => createDashboard(),
    generateStatement: async () => null
  }
}

describe('createFinanceCommandsService', () => {
  test('replies with a clearer localized household status summary', async () => {
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
            id: -100123456,
            type: 'supergroup'
          },
          text: 'ok'
        }
      } as never
    })

    await bot.handleUpdate(householdStatusUpdate('ru') as never)

    const payload = calls[0]?.payload as { text?: string } | undefined
    expect(payload?.text).toContain('Статус на март 2026')
    expect(payload?.text).toContain('\n\nНачисления\n')
    expect(payload?.text).toContain('Аренда: 700.00 USD (~1890.00 GEL)')
    expect(payload?.text).toContain('Коммуналка: 82.00 GEL')
    expect(payload?.text).toContain('Общие покупки: 30.00 GEL')
    expect(payload?.text).toContain('Срок оплаты аренды: до 20 марта')
    expect(payload?.text).toContain('Расчёты')
    expect(payload?.text).toContain('Общий баланс: 400.00 GEL')
    expect(payload?.text).toContain('Уже оплачено: 100.00 GEL')
    expect(payload?.text).toContain('Осталось оплатить: 300.00 GEL')
    expect(payload?.text).toContain('Участники')
    expect(payload?.text).toContain('- Ион: остаток 190.00 GEL')
    expect(payload?.text).toContain('- Стас: остаток 110.00 GEL (210.00 баланс, 100.00 оплачено)')
    expect(payload?.text).not.toContain('- Ион: остаток 190.00 GEL (')
  })

  test('renders the utility bill plan and quick action button for assigned members', async () => {
    const repository = createRepository()
    const financeService: FinanceCommandService = {
      ...createFinanceService(),
      generateCurrentBillPlan: async () => ({
        period: '2026-04',
        currency: 'GEL',
        timezone: 'Asia/Tbilisi',
        billingStage: 'utilities',
        utilityBillingPlan: {
          version: 1,
          status: 'active',
          dueDate: '2026-04-04',
          updatedFromVersion: null,
          reason: null,
          categories: [
            {
              utilityBillId: 'utility-gas',
              billName: 'Gas',
              amount: Money.fromMajor('300', 'GEL'),
              assignedMemberId: 'member-1',
              assignedDisplayName: 'Стас',
              paidAmount: Money.zero('GEL'),
              fullCategoryPayment: true,
              splitSourceBillId: null
            }
          ],
          transfers: [],
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

    const payload = calls[0]?.payload as
      | {
          text?: string
          reply_markup?: {
            inline_keyboard?: Array<Array<{ text: string; callback_data: string }>>
          }
        }
      | undefined

    expect(payload?.text).toContain('Коммуналка')
    expect(payload?.text).toContain('FULL · Gas: 300.00 GEL — Стас')
    expect(payload?.reply_markup?.inline_keyboard).toEqual([
      [
        {
          text: 'Оплатил по плану',
          callback_data: 'bill:resolve:household-1:member-1'
        }
      ]
    ])
  })
})
