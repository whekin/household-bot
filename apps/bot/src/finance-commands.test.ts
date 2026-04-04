import { describe, expect, test } from 'bun:test'
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
    generateBillingAuditExport: async () => null,
    generateStatement: async () => null,
    manuallyResolvePurchase: async () => ({
      purchaseId: 'test-purchase',
      resolvedAmount: Money.fromMajor('0.00', 'GEL')
    })
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
    expect(payload?.text).toContain('Аренда: $700.00 (~1890.00 ₾)')
    expect(payload?.text).toContain('Коммуналка: 82.00 ₾')
    expect(payload?.text).toContain('Общие покупки: 30.00 ₾')
    expect(payload?.text).toContain('Срок оплаты аренды: до 20 марта')
    expect(payload?.text).toContain('Расчёты')
    expect(payload?.text).toContain('Общий баланс: 400.00 ₾')
    expect(payload?.text).toContain('Уже оплачено: 100.00 ₾')
    expect(payload?.text).toContain('Осталось оплатить: 300.00 ₾')
    expect(payload?.text).toContain('Участники')
    expect(payload?.text).toContain('- Ион: остаток 190.00 ₾')
    expect(payload?.text).toContain('- Стас: остаток 110.00 ₾ (210.00 ₾ баланс, 100.00 ₾ оплачено)')
    expect(payload?.text).not.toContain('- Ион: остаток 190.00 ₾ (')
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
    expect(payload?.text).toContain('Сейчас тебе оплатить: 300.00 ₾')
    expect(payload?.text).toContain('- Gas — 300.00 ₾')
    expect(payload?.text).not.toContain('FULL ·')
    expect(payload?.text).not.toContain('Сводка:')
    expect(payload?.reply_markup?.inline_keyboard).toEqual([
      [
        {
          text: 'Оплатил по плану',
          callback_data: 'bill:resolve:current'
        }
      ]
    ])
    expect(promptRepository.current()?.action).toBe('bill_command')
  })

  test('renders /bill all for group admins with the current member first', async () => {
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

    await bot.handleUpdate(billUpdate('/bill all', 'ru') as never)

    const payload = calls[0]?.payload as { text?: string } | undefined
    const text = payload?.text ?? ''
    expect(text).toContain('Коммуналка')
    expect(text.indexOf('Стас\nК оплате сейчас: 300.00 ₾')).toBeLessThan(
      text.indexOf('Ион\nК оплате сейчас: 80.00 ₾')
    )
    expect(text).toContain('- Gas — 300.00 ₾')
    expect(text).toContain('- Internet — 80.00 ₾')
    expect(text).not.toContain('цель 95.00 ₾')
    expect(text).not.toContain('FULL ·')
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

    await bot.handleUpdate(billUpdate('/bill rent', 'ru') as never)

    const text = (calls[0]?.payload as { text?: string } | undefined)?.text ?? ''
    expect(text).toContain('Аренда')
    expect(text).toContain('Сейчас тебе оплатить: 500.00 ₾')
    expect(text).toContain('- Landlord')
    expect(text).toContain('получатель: Nino')
    expect(text).toContain('счёт: GE00TB123')
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

    await bot.handleUpdate(billUpdate('/bill utilities', 'ru') as never)

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
