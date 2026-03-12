import { describe, expect, test } from 'bun:test'

import type { FinanceCommandService, PaymentConfirmationService } from '@household/application'
import { instantFromIso, Money } from '@household/domain'
import type { TelegramPendingActionRecord, TelegramPendingActionRepository } from '@household/ports'
import { createTelegramBot } from './bot'
import {
  buildPaymentAcknowledgement,
  registerConfiguredPaymentTopicIngestion,
  resolveConfiguredPaymentTopicRecord,
  type PaymentTopicCandidate
} from './payment-topic-ingestion'

function candidate(overrides: Partial<PaymentTopicCandidate> = {}): PaymentTopicCandidate {
  return {
    updateId: 1,
    chatId: '-10012345',
    messageId: '10',
    threadId: '888',
    senderTelegramUserId: '10002',
    rawText: 'за жилье закинул',
    attachmentCount: 0,
    messageSentAt: instantFromIso('2026-03-20T00:00:00.000Z'),
    ...overrides
  }
}

function paymentUpdate(text: string) {
  return {
    update_id: 1001,
    message: {
      message_id: 55,
      date: Math.floor(Date.now() / 1000),
      message_thread_id: 888,
      is_topic_message: true,
      chat: {
        id: -10012345,
        type: 'supergroup'
      },
      from: {
        id: 10002,
        is_bot: false,
        first_name: 'Mia'
      },
      text
    }
  }
}

function createHouseholdRepository() {
  return {
    getHouseholdChatByHouseholdId: async () => ({
      householdId: 'household-1',
      householdName: 'Test bot',
      telegramChatId: '-10012345',
      telegramChatType: 'supergroup',
      title: 'Test bot',
      defaultLocale: 'ru' as const
    }),
    findHouseholdTopicByTelegramContext: async () => ({
      householdId: 'household-1',
      role: 'payments' as const,
      telegramThreadId: '888',
      topicName: 'Быт'
    }),
    getHouseholdBillingSettings: async () => ({
      householdId: 'household-1',
      settlementCurrency: 'GEL' as const,
      rentAmountMinor: 70000n,
      rentCurrency: 'USD' as const,
      rentDueDay: 20,
      rentWarningDay: 17,
      utilitiesDueDay: 4,
      utilitiesReminderDay: 3,
      timezone: 'Asia/Tbilisi'
    })
  }
}

function paymentCallbackUpdate(data: string, fromId = 10002) {
  return {
    update_id: 1002,
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
        chat: {
          id: -10012345,
          type: 'supergroup'
        },
        text: 'placeholder'
      }
    }
  }
}

function createPromptRepository(): TelegramPendingActionRepository {
  let pending: TelegramPendingActionRecord | null = null

  return {
    async upsertPendingAction(input) {
      pending = input
      return input
    },
    async getPendingAction() {
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

function createFinanceService(): FinanceCommandService {
  return {
    getMemberByTelegramUserId: async () => ({
      id: 'member-1',
      telegramUserId: '10002',
      displayName: 'Mia',
      rentShareWeight: 1,
      isAdmin: false
    }),
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
    addUtilityBill: async () => null,
    updateUtilityBill: async () => null,
    deleteUtilityBill: async () => false,
    updatePurchase: async () => null,
    deletePurchase: async () => false,
    addPayment: async () => null,
    updatePayment: async () => null,
    deletePayment: async () => false,
    generateDashboard: async () => ({
      period: '2026-03',
      currency: 'GEL',
      timezone: 'Asia/Tbilisi',
      rentDueDay: 20,
      utilitiesDueDay: 4,
      paymentBalanceAdjustmentPolicy: 'utilities',
      totalDue: Money.fromMajor('1000', 'GEL'),
      totalPaid: Money.zero('GEL'),
      totalRemaining: Money.fromMajor('1000', 'GEL'),
      rentSourceAmount: Money.fromMajor('700', 'USD'),
      rentDisplayAmount: Money.fromMajor('1890', 'GEL'),
      rentFxRateMicros: null,
      rentFxEffectiveDate: null,
      members: [
        {
          memberId: 'member-1',
          displayName: 'Mia',
          rentShare: Money.fromMajor('472.50', 'GEL'),
          utilityShare: Money.fromMajor('40', 'GEL'),
          purchaseOffset: Money.fromMajor('-12', 'GEL'),
          netDue: Money.fromMajor('500.50', 'GEL'),
          paid: Money.zero('GEL'),
          remaining: Money.fromMajor('500.50', 'GEL'),
          explanations: []
        }
      ],
      ledger: []
    }),
    generateStatement: async () => null
  }
}

function createPaymentConfirmationService(): PaymentConfirmationService & {
  submitted: Array<{
    rawText: string
    telegramMessageId: string
    telegramThreadId: string
  }>
} {
  return {
    submitted: [],
    async submit(input) {
      this.submitted.push({
        rawText: input.rawText,
        telegramMessageId: input.telegramMessageId,
        telegramThreadId: input.telegramThreadId
      })

      return {
        status: 'recorded',
        kind: 'rent',
        amount: Money.fromMajor('472.50', 'GEL')
      }
    }
  }
}

describe('resolveConfiguredPaymentTopicRecord', () => {
  test('returns record when the topic role is payments', () => {
    const record = resolveConfiguredPaymentTopicRecord(candidate(), {
      householdId: 'household-1',
      role: 'payments',
      telegramThreadId: '888',
      topicName: 'Быт'
    })

    expect(record).not.toBeNull()
    expect(record?.householdId).toBe('household-1')
  })

  test('skips non-payments topic bindings', () => {
    const record = resolveConfiguredPaymentTopicRecord(candidate(), {
      householdId: 'household-1',
      role: 'feedback',
      telegramThreadId: '888',
      topicName: 'Анонимно'
    })

    expect(record).toBeNull()
  })

  test('skips slash commands in payment topics', () => {
    const record = resolveConfiguredPaymentTopicRecord(candidate({ rawText: '/unsetup' }), {
      householdId: 'household-1',
      role: 'payments',
      telegramThreadId: '888',
      topicName: 'Быт'
    })

    expect(record).toBeNull()
  })
})

describe('buildPaymentAcknowledgement', () => {
  test('returns localized recorded acknowledgement', () => {
    expect(
      buildPaymentAcknowledgement('ru', {
        status: 'recorded',
        kind: 'rent',
        amountMajor: '472.50',
        currency: 'GEL'
      })
    ).toBe('Оплата аренды сохранена: 472.50 GEL')
  })

  test('returns review acknowledgement', () => {
    expect(
      buildPaymentAcknowledgement('en', {
        status: 'needs_review'
      })
    ).toBeNull()
  })
})

describe('registerConfiguredPaymentTopicIngestion', () => {
  test('replies in-topic with a payment proposal and buttons for a likely payment', async () => {
    const bot = createTelegramBot('000000:test-token')
    const calls: Array<{ method: string; payload: unknown }> = []
    const promptRepository = createPromptRepository()

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
        result: {
          message_id: calls.length,
          date: Math.floor(Date.now() / 1000),
          chat: {
            id: -10012345,
            type: 'supergroup'
          },
          text: 'ok'
        }
      } as never
    })

    const paymentConfirmationService = createPaymentConfirmationService()

    registerConfiguredPaymentTopicIngestion(
      bot,
      createHouseholdRepository() as never,
      promptRepository,
      () => createFinanceService(),
      () => paymentConfirmationService
    )

    await bot.handleUpdate(paymentUpdate('за жилье закинул') as never)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.method).toBe('sendMessage')
    expect(calls[0]?.payload).toMatchObject({
      chat_id: -10012345,
      reply_parameters: {
        message_id: 55
      },
      text: expect.stringContaining('Я могу записать эту оплату аренды: 472.50 GEL.'),
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: 'Подтвердить оплату',
              callback_data: expect.stringMatching(/^payment_topic:confirm:[^:]+$/)
            },
            {
              text: 'Отменить',
              callback_data: expect.stringMatching(/^payment_topic:cancel:[^:]+$/)
            }
          ]
        ]
      }
    })

    expect(await promptRepository.getPendingAction('-10012345', '10002')).toMatchObject({
      action: 'payment_topic_confirmation'
    })
    const proposalId = (
      (await promptRepository.getPendingAction('-10012345', '10002'))?.payload as {
        proposalId?: string
      } | null
    )?.proposalId
    expect(`payment_topic:confirm:${proposalId ?? ''}`.length).toBeLessThanOrEqual(64)
    expect(`payment_topic:cancel:${proposalId ?? ''}`.length).toBeLessThanOrEqual(64)
  })

  test('asks for clarification and resolves follow-up answers in the same payments topic', async () => {
    const bot = createTelegramBot('000000:test-token')
    const calls: Array<{ method: string; payload: unknown }> = []
    const promptRepository = createPromptRepository()

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

    const paymentConfirmationService = createPaymentConfirmationService()

    registerConfiguredPaymentTopicIngestion(
      bot,
      createHouseholdRepository() as never,
      promptRepository,
      () => createFinanceService(),
      () => paymentConfirmationService
    )

    await bot.handleUpdate(paymentUpdate('готово') as never)
    await bot.handleUpdate(paymentUpdate('за жилье') as never)

    expect(calls).toHaveLength(2)
    expect(calls[0]?.payload).toMatchObject({
      text: 'Пока не могу подтвердить эту оплату. Уточните, это аренда или коммуналка, и при необходимости напишите сумму и валюту.'
    })
    expect(calls[1]?.payload).toMatchObject({
      text: expect.stringContaining('Я могу записать эту оплату аренды: 472.50 GEL.')
    })
  })

  test('confirms a pending payment proposal from a topic callback', async () => {
    const bot = createTelegramBot('000000:test-token')
    const calls: Array<{ method: string; payload: unknown }> = []
    const promptRepository = createPromptRepository()

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

    const paymentConfirmationService = createPaymentConfirmationService()

    registerConfiguredPaymentTopicIngestion(
      bot,
      createHouseholdRepository() as never,
      promptRepository,
      () => createFinanceService(),
      () => paymentConfirmationService
    )

    await bot.handleUpdate(paymentUpdate('за жилье закинул') as never)
    const pending = await promptRepository.getPendingAction('-10012345', '10002')
    const proposalId = (pending?.payload as { proposalId?: string } | null)?.proposalId
    calls.length = 0

    await bot.handleUpdate(
      paymentCallbackUpdate(`payment_topic:confirm:${proposalId ?? 'missing'}`) as never
    )

    expect(paymentConfirmationService.submitted).toEqual([
      {
        rawText: 'paid rent 472.50 GEL',
        telegramMessageId: '55',
        telegramThreadId: '888'
      }
    ])
    expect(calls[0]).toMatchObject({
      method: 'answerCallbackQuery',
      payload: {
        callback_query_id: 'callback-1',
        text: 'Recorded rent payment: 472.50 GEL'
      }
    })
    expect(calls[1]).toMatchObject({
      method: 'editMessageText',
      payload: {
        chat_id: -10012345,
        message_id: 77,
        text: 'Recorded rent payment: 472.50 GEL'
      }
    })
  })

  test('does not reply for non-payment chatter in the payments topic', async () => {
    const bot = createTelegramBot('000000:test-token')
    const calls: Array<{ method: string; payload: unknown }> = []
    const promptRepository = createPromptRepository()

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

    const paymentConfirmationService = createPaymentConfirmationService()

    registerConfiguredPaymentTopicIngestion(
      bot,
      createHouseholdRepository() as never,
      promptRepository,
      () => createFinanceService(),
      () => paymentConfirmationService
    )

    await bot.handleUpdate(paymentUpdate('Так так)') as never)

    expect(calls).toHaveLength(0)
  })

  test('does not ingest slash commands sent in the payments topic', async () => {
    const bot = createTelegramBot('000000:test-token')
    const promptRepository = createPromptRepository()
    const paymentConfirmationService = createPaymentConfirmationService()

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

    registerConfiguredPaymentTopicIngestion(
      bot,
      createHouseholdRepository() as never,
      promptRepository,
      () => createFinanceService(),
      () => paymentConfirmationService
    )

    await bot.handleUpdate(paymentUpdate('/unsetup') as never)

    expect(paymentConfirmationService.submitted).toHaveLength(0)
  })

  test('skips explicitly tagged bot messages in the payments topic', async () => {
    const bot = createTelegramBot('000000:test-token')
    const calls: Array<{ method: string; payload: unknown }> = []
    const promptRepository = createPromptRepository()
    const paymentConfirmationService = createPaymentConfirmationService()

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

    registerConfiguredPaymentTopicIngestion(
      bot,
      createHouseholdRepository() as never,
      promptRepository,
      () => createFinanceService(),
      () => paymentConfirmationService
    )

    await bot.handleUpdate(paymentUpdate('@household_test_bot как жизнь?') as never)

    expect(calls).toHaveLength(0)
    expect(await promptRepository.getPendingAction('-10012345', '10002')).toBeNull()
  })

  test('still handles tagged payment-like messages in the payments topic', async () => {
    const bot = createTelegramBot('000000:test-token')
    const calls: Array<{ method: string; payload: unknown }> = []
    const promptRepository = createPromptRepository()
    const paymentConfirmationService = createPaymentConfirmationService()

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

    registerConfiguredPaymentTopicIngestion(
      bot,
      createHouseholdRepository() as never,
      promptRepository,
      () => createFinanceService(),
      () => paymentConfirmationService
    )

    await bot.handleUpdate(paymentUpdate('@household_test_bot за жилье закинул') as never)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.payload).toMatchObject({
      text: expect.stringContaining('Я могу записать эту оплату аренды: 472.50 GEL.')
    })
  })
})
