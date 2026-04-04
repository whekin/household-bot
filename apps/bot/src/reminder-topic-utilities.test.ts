import { describe, expect, test } from 'bun:test'

import type { FinanceCommandService } from '@household/application'
import { instantFromIso, Money, nowInstant } from '@household/domain'
import type { TelegramPendingActionRecord, TelegramPendingActionRepository } from '@household/ports'

import { createTelegramBot } from './bot'
import {
  registerReminderTopicUtilities,
  REMINDER_UTILITY_GUIDED_CALLBACK,
  REMINDER_UTILITY_TEMPLATE_CALLBACK
} from './reminder-topic-utilities'

function reminderCallbackUpdate(data: string, fromId = 10002) {
  return {
    update_id: 2001,
    callback_query: {
      id: 'callback-1',
      from: {
        id: fromId,
        is_bot: false,
        first_name: 'Mia'
      },
      chat_instance: 'instance-1',
      data,
      message: {
        message_id: 77,
        date: Math.floor(Date.now() / 1000),
        message_thread_id: 555,
        is_topic_message: true,
        chat: {
          id: -10012345,
          type: 'supergroup'
        },
        text: 'Utilities reminder'
      }
    }
  }
}

function reminderMessageUpdate(text: string, fromId = 10002) {
  return {
    update_id: 2002,
    message: {
      message_id: 88,
      date: Math.floor(Date.now() / 1000),
      message_thread_id: 555,
      is_topic_message: true,
      chat: {
        id: -10012345,
        type: 'supergroup'
      },
      from: {
        id: fromId,
        is_bot: false,
        first_name: 'Mia'
      },
      text
    }
  }
}

function createPromptRepository(): TelegramPendingActionRepository & {
  current: () => TelegramPendingActionRecord | null
  expire: () => void
} {
  let pending: TelegramPendingActionRecord | null = null

  return {
    current: () => pending,
    expire: () => {
      if (!pending) {
        return
      }

      pending = {
        ...pending,
        expiresAt: instantFromIso('2000-01-01T00:00:00.000Z')
      }
    },
    async upsertPendingAction(input) {
      pending = input
      return input
    },
    async getPendingAction() {
      if (!pending) {
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
    async clearPendingAction() {
      pending = null
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

function createHouseholdRepository() {
  return {
    getTelegramHouseholdChat: async () => ({
      householdId: 'household-1',
      householdName: 'Kojori House',
      telegramChatId: '-10012345',
      telegramChatType: 'supergroup',
      title: 'Kojori House',
      defaultLocale: 'ru' as const
    }),
    getHouseholdChatByHouseholdId: async () => ({
      householdId: 'household-1',
      householdName: 'Kojori House',
      telegramChatId: '-10012345',
      telegramChatType: 'supergroup',
      title: 'Kojori House',
      defaultLocale: 'ru' as const
    }),
    findHouseholdTopicByTelegramContext: async () => ({
      householdId: 'household-1',
      role: 'reminders' as const,
      telegramThreadId: '555',
      topicName: 'Напоминания'
    }),
    getHouseholdBillingSettings: async () => ({
      householdId: 'household-1',
      settlementCurrency: 'GEL' as const,
      paymentBalanceAdjustmentPolicy: 'utilities' as const,
      rentAmountMinor: null,
      rentCurrency: 'USD' as const,
      rentDueDay: 20,
      rentWarningDay: 17,
      utilitiesDueDay: 4,
      utilitiesReminderDay: 3,
      timezone: 'Asia/Tbilisi'
    }),
    listHouseholdUtilityCategories: async () => [
      {
        id: 'cat-1',
        householdId: 'household-1',
        slug: 'electricity',
        name: 'Electricity',
        sortOrder: 1,
        isActive: true
      },
      {
        id: 'cat-2',
        householdId: 'household-1',
        slug: 'water',
        name: 'Water',
        sortOrder: 2,
        isActive: true
      }
    ]
  }
}

function createFinanceService(): FinanceCommandService & {
  addedUtilityBills: Array<{
    billName: string
    amountMajor: string
    createdByMemberId: string
    currency?: string
  }>
} {
  return {
    addedUtilityBills: [],
    getMemberByTelegramUserId: async () => ({
      id: 'member-1',
      telegramUserId: '10002',
      displayName: 'Mia',
      rentShareWeight: 1,
      isAdmin: false
    }),
    listMembers: async () => [
      {
        id: 'member-1',
        telegramUserId: '10002',
        displayName: 'Mia',
        rentShareWeight: 1,
        isAdmin: false
      }
    ],
    getOpenCycle: async () => null,
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
    addUtilityBill: async function (billName, amountMajor, createdByMemberId, currencyArg) {
      if (currencyArg) {
        this.addedUtilityBills.push({
          billName,
          amountMajor,
          createdByMemberId,
          currency: currencyArg
        })
      } else {
        this.addedUtilityBills.push({
          billName,
          amountMajor,
          createdByMemberId
        })
      }

      return {
        amount: undefined as never,
        currency: 'GEL',
        period: '2026-03'
      }
    },
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
    generateDashboard: async () => null,
    generateBillingAuditExport: async () => null,
    generateStatement: async () => null,
    manuallyResolvePurchase: async () => ({
      purchaseId: 'test-purchase',
      resolvedAmount: Money.fromMajor('0.00', 'GEL')
    })
  }
}

function setupBot() {
  const bot = createTelegramBot('000000:test-token')
  const calls: Array<{ method: string; payload: unknown }> = []
  const promptRepository = createPromptRepository()
  const financeService = createFinanceService()

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

  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload })

    return {
      ok: true,
      result: true
    } as never
  })

  registerReminderTopicUtilities({
    bot,
    householdConfigurationRepository: createHouseholdRepository() as never,
    promptRepository,
    financeServiceForHousehold: () => financeService
  })

  return {
    bot,
    calls,
    promptRepository,
    financeService
  }
}

describe('registerReminderTopicUtilities', () => {
  test('runs the guided reminder flow and records utility bills on confirmation', async () => {
    const { bot, calls, financeService, promptRepository } = setupBot()

    await bot.handleUpdate(reminderCallbackUpdate(REMINDER_UTILITY_GUIDED_CALLBACK) as never)
    expect(calls[0]).toMatchObject({
      method: 'answerCallbackQuery',
      payload: {
        callback_query_id: 'callback-1',
        text: 'Пошаговый ввод коммуналки запущен.'
      }
    })
    expect(calls[1]).toMatchObject({
      method: 'sendMessage',
      payload: {
        text: expect.stringContaining('Electricity'),
        message_thread_id: 555
      }
    })

    calls.length = 0
    await bot.handleUpdate(reminderMessageUpdate('55') as never)
    expect(calls[0]).toMatchObject({
      method: 'sendMessage',
      payload: {
        text: expect.stringContaining('Water')
      }
    })

    calls.length = 0
    await bot.handleUpdate(reminderMessageUpdate('12.5') as never)
    expect(calls[0]).toMatchObject({
      method: 'sendMessage',
      payload: {
        text: expect.stringContaining('Коммунальные начисления за 2026-03'),
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: 'Сохранить коммуналку',
                callback_data: expect.stringMatching(/^reminder_util:confirm:[^:]+$/)
              },
              {
                text: 'Отменить',
                callback_data: expect.stringMatching(/^reminder_util:cancel:[^:]+$/)
              }
            ]
          ]
        }
      }
    })

    const confirmProposalId = (
      promptRepository.current()?.payload as {
        proposalId?: string
      } | null
    )?.proposalId
    const confirmCallbackData = `reminder_util:confirm:${confirmProposalId ?? 'missing'}`
    calls.length = 0
    await bot.handleUpdate(reminderCallbackUpdate(confirmCallbackData ?? 'missing') as never)

    expect(financeService.addedUtilityBills).toEqual([
      {
        billName: 'Electricity',
        amountMajor: '55.00',
        createdByMemberId: 'member-1',
        currency: 'GEL'
      },
      {
        billName: 'Water',
        amountMajor: '12.50',
        createdByMemberId: 'member-1',
        currency: 'GEL'
      }
    ])
    expect(calls[0]).toMatchObject({
      method: 'answerCallbackQuery',
      payload: {
        text: 'Сохранено 2 начислений коммуналки за 2026-03.'
      }
    })
  })

  test('parses the filled template and turns it into a confirmation proposal', async () => {
    const { bot, calls } = setupBot()

    await bot.handleUpdate(reminderCallbackUpdate(REMINDER_UTILITY_TEMPLATE_CALLBACK) as never)

    expect(calls[1]).toMatchObject({
      method: 'sendMessage',
      payload: {
        text: expect.stringContaining('<pre>Electricity: \nWater: </pre>'),
        parse_mode: 'HTML',
        message_thread_id: 555
      }
    })

    calls.length = 0
    await bot.handleUpdate(reminderMessageUpdate('Electricity: 22\nWater: 0') as never)

    expect(calls[0]).toMatchObject({
      method: 'sendMessage',
      payload: {
        text: expect.stringContaining('- Electricity: 22.00 ₾')
      }
    })
  })

  test('treats blank or removed template lines as skipped categories', async () => {
    const { bot, calls } = setupBot()

    await bot.handleUpdate(reminderCallbackUpdate(REMINDER_UTILITY_TEMPLATE_CALLBACK) as never)

    calls.length = 0
    await bot.handleUpdate(reminderMessageUpdate('Electricity: 22\nWater: ') as never)

    expect(calls[0]).toMatchObject({
      method: 'sendMessage',
      payload: {
        text: expect.stringContaining('- Electricity: 22.00 ₾')
      }
    })

    calls.length = 0
    await bot.handleUpdate(reminderCallbackUpdate(REMINDER_UTILITY_TEMPLATE_CALLBACK) as never)
    calls.length = 0
    await bot.handleUpdate(reminderMessageUpdate('Electricity: 22') as never)

    expect(calls[0]).toMatchObject({
      method: 'sendMessage',
      payload: {
        text: expect.stringContaining('- Electricity: 22.00 ₾')
      }
    })
  })

  test('treats expired pending reminder submissions as unavailable', async () => {
    const { bot, calls, promptRepository } = setupBot()

    await bot.handleUpdate(reminderCallbackUpdate(REMINDER_UTILITY_GUIDED_CALLBACK) as never)
    await bot.handleUpdate(reminderMessageUpdate('55') as never)
    await bot.handleUpdate(reminderMessageUpdate('12') as never)
    const confirmProposalId = (
      promptRepository.current()?.payload as {
        proposalId?: string
      } | null
    )?.proposalId
    const confirmCallbackData = `reminder_util:confirm:${confirmProposalId ?? 'missing'}`
    promptRepository.expire()
    calls.length = 0

    await bot.handleUpdate(reminderCallbackUpdate(confirmCallbackData ?? 'missing') as never)

    expect(calls[0]).toMatchObject({
      method: 'answerCallbackQuery',
      payload: {
        text: 'Это предложение по коммуналке уже недоступно.',
        show_alert: true
      }
    })
  })

  test('does not re-confirm after the pending submission was already cleared', async () => {
    const { bot, calls, promptRepository } = setupBot()

    await bot.handleUpdate(reminderCallbackUpdate(REMINDER_UTILITY_GUIDED_CALLBACK) as never)
    await bot.handleUpdate(reminderMessageUpdate('55') as never)
    await bot.handleUpdate(reminderMessageUpdate('12') as never)
    const confirmProposalId = (
      promptRepository.current()?.payload as {
        proposalId?: string
      } | null
    )?.proposalId
    const confirmCallbackData = `reminder_util:confirm:${confirmProposalId ?? 'missing'}`
    await bot.handleUpdate(reminderCallbackUpdate(confirmCallbackData ?? 'missing') as never)
    calls.length = 0

    await bot.handleUpdate(reminderCallbackUpdate(confirmCallbackData ?? 'missing') as never)

    expect(calls[0]).toMatchObject({
      method: 'answerCallbackQuery',
      payload: {
        text: 'Это предложение по коммуналке уже недоступно.',
        show_alert: true
      }
    })
  })
})
