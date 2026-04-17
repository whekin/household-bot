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
import type { TopicProcessor } from './topic-processor'

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

function paymentUpdate(text: string, threadId = 888) {
  return {
    update_id: 1001,
    message: {
      message_id: 55,
      date: Math.floor(Date.now() / 1000),
      message_thread_id: threadId,
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
  const pending = new Map<string, TelegramPendingActionRecord>()
  const key = (telegramChatId: string, telegramUserId: string) =>
    `${telegramChatId}:${telegramUserId}`

  return {
    async upsertPendingAction(input) {
      pending.set(key(input.telegramChatId, input.telegramUserId), input)
      return input
    },
    async getPendingAction(telegramChatId, telegramUserId) {
      return pending.get(key(telegramChatId, telegramUserId)) ?? null
    },
    async clearPendingAction(telegramChatId, telegramUserId) {
      pending.delete(key(telegramChatId, telegramUserId))
    },
    async clearPendingActionsForChat(telegramChatId, action) {
      for (const [entryKey, entry] of pending.entries()) {
        if (entry.telegramChatId !== telegramChatId) {
          continue
        }

        if (action && entry.action !== action) {
          continue
        }

        pending.delete(entryKey)
      }
    }
  }
}

function createFinanceService(): FinanceCommandService {
  return {
    getMemberByTelegramUserId: async (telegramUserId) =>
      telegramUserId === '20002'
        ? {
            id: 'member-2',
            telegramUserId: '20002',
            displayName: 'Ion',
            rentShareWeight: 1,
            isAdmin: false
          }
        : {
            id: 'member-1',
            telegramUserId: '10002',
            displayName: 'Mia',
            rentShareWeight: 1,
            isAdmin: false
          },
    listMembers: async () => [
      {
        id: 'member-1',
        telegramUserId: '10002',
        displayName: 'Mia',
        rentShareWeight: 1,
        isAdmin: false
      },
      {
        id: 'member-2',
        telegramUserId: '20002',
        displayName: 'Ion',
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
    generateDashboard: async () => ({
      period: '2026-03',
      currency: 'GEL',
      timezone: 'Asia/Tbilisi',
      rentWarningDay: 17,
      rentDueDay: 20,
      utilitiesReminderDay: 3,
      utilitiesDueDay: 4,
      paymentBalanceAdjustmentPolicy: 'utilities',
      rentPaymentDestinations: null,
      totalDue: Money.fromMajor('1000', 'GEL'),
      totalPaid: Money.zero('GEL'),
      totalRemaining: Money.fromMajor('1000', 'GEL'),
      billingStage: 'idle',
      rentSourceAmount: Money.fromMajor('700', 'USD'),
      rentDisplayAmount: Money.fromMajor('1890', 'GEL'),
      rentFxRateMicros: null,
      rentFxEffectiveDate: null,
      utilityBillingPlan: null,
      rentBillingState: {
        dueDate: '2026-03-20',
        memberSummaries: [],
        paymentDestinations: null
      },
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
          overduePayments: [],
          explanations: []
        },
        {
          memberId: 'member-2',
          displayName: 'Ion',
          rentShare: Money.fromMajor('472.50', 'GEL'),
          utilityShare: Money.fromMajor('40', 'GEL'),
          purchaseOffset: Money.fromMajor('-12', 'GEL'),
          netDue: Money.fromMajor('500.50', 'GEL'),
          paid: Money.zero('GEL'),
          remaining: Money.fromMajor('500.50', 'GEL'),
          overduePayments: [],
          explanations: []
        }
      ],
      ledger: []
    }),
    generateBillingAuditExport: async () => null,
    generateStatement: async () => null,
    manuallyResolvePurchase: async () => ({
      purchaseId: 'test-purchase',
      resolvedAmount: Money.fromMajor('0.00', 'GEL')
    })
  }
}

function createPaymentConfirmationService(): PaymentConfirmationService & {
  submitted: Array<{
    memberId?: string | null
    rawText: string
    telegramMessageId: string
    telegramThreadId: string
  }>
} {
  return {
    submitted: [],
    async submit(input) {
      this.submitted.push({
        memberId: input.memberId ?? null,
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

// Mock topic processor that mimics LLM responses for testing
function createMockPaymentTopicProcessor(
  route: 'payment' | 'silent' | 'topic_helper' | 'payment_clarification' | 'chat_reply' = 'payment'
): TopicProcessor {
  return async () => {
    if (route === 'silent') {
      return { route: 'silent', reason: 'test' }
    }
    if (route === 'topic_helper') {
      return { route: 'topic_helper', reason: 'test' }
    }
    if (route === 'chat_reply') {
      return { route: 'chat_reply', replyText: 'Hello!', reason: 'test' }
    }
    if (route === 'payment_clarification') {
      return {
        route: 'payment_clarification',
        clarificationQuestion: 'What kind of payment?',
        reason: 'test'
      }
    }
    // Default to payment route
    return {
      route: 'payment',
      kind: 'rent',
      amountMinor: '47250',
      currency: 'GEL',
      payerDisplayName: null,
      confidence: 95,
      reason: 'test'
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
    ).toBe('Оплата аренды сохранена: 472.50 ₾')
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
      () => paymentConfirmationService,
      { topicProcessor: createMockPaymentTopicProcessor() }
    )

    await bot.handleUpdate(paymentUpdate('за жилье закинул') as never)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.method).toBe('sendMessage')
    expect(calls[0]?.payload).toMatchObject({
      chat_id: -10012345,
      reply_parameters: {
        message_id: 55
      },
      text: expect.stringContaining('Я могу записать эту оплату аренды: 473.00 ₾.'),
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
    const payload = calls[0]?.payload as { text?: string } | undefined
    expect(String(payload?.text)).not.toContain('Аренда к оплате')
    expect(String(payload?.text)).not.toContain('Баланс по общим покупкам')

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

  test('falls back to a payment proposal when the topic processor stays silent on a clear rent payment', async () => {
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

    registerConfiguredPaymentTopicIngestion(
      bot,
      createHouseholdRepository() as never,
      promptRepository,
      () => createFinanceService(),
      () => createPaymentConfirmationService(),
      { topicProcessor: createMockPaymentTopicProcessor('silent') }
    )

    await bot.handleUpdate(paymentUpdate('я уже закинул за оплату жилья') as never)

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      method: 'sendMessage',
      payload: {
        text: expect.stringContaining('Я могу записать эту оплату аренды: 473.00 ₾.')
      }
    })
    expect(await promptRepository.getPendingAction('-10012345', '10002')).toMatchObject({
      action: 'payment_topic_confirmation'
    })
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

    // Smart mock that returns clarification for vague messages, payment for clear ones
    const smartTopicProcessor: TopicProcessor = async (input) => {
      const text = input.messageText.toLowerCase()
      // Vague messages like "готово" (done) need clarification
      if (text === 'готово' || text === 'done') {
        return {
          route: 'payment_clarification',
          clarificationQuestion:
            'Пока не могу подтвердить эту оплату. Уточните, это аренда или коммуналка, и при необходимости напишите сумму и валюту.',
          reason: 'test'
        }
      }
      // Messages with rent keywords can proceed as payment
      return {
        route: 'payment',
        kind: 'rent',
        amountMinor: '47250',
        currency: 'GEL',
        payerDisplayName: null,
        confidence: 95,
        reason: 'test'
      }
    }

    registerConfiguredPaymentTopicIngestion(
      bot,
      createHouseholdRepository() as never,
      promptRepository,
      () => createFinanceService(),
      () => paymentConfirmationService,
      { topicProcessor: smartTopicProcessor }
    )

    await bot.handleUpdate(paymentUpdate('готово') as never)
    await bot.handleUpdate(paymentUpdate('за жилье') as never)

    expect(calls).toHaveLength(2)
    expect(calls[0]?.payload).toMatchObject({
      text: 'Пока не могу подтвердить эту оплату. Уточните, это аренда или коммуналка, и при необходимости напишите сумму и валюту.'
    })
    expect(calls[1]?.payload).toMatchObject({
      text: expect.stringContaining('Я могу записать эту оплату аренды: 473.00 ₾.')
    })
  })

  test('creates a third-person payment proposal for the reported payer and lets either person confirm', async () => {
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

    registerConfiguredPaymentTopicIngestion(
      bot,
      createHouseholdRepository() as never,
      promptRepository,
      () => createFinanceService(),
      () => paymentConfirmationService,
      {
        topicProcessor: async () => ({
          route: 'payment',
          kind: 'rent',
          amountMinor: null,
          currency: null,
          payerDisplayName: 'Ion',
          confidence: 96,
          reason: 'third_party'
        })
      }
    )

    await bot.handleUpdate(paymentUpdate('Ион оплатил аренду') as never)

    expect(calls[0]?.payload).toMatchObject({
      text: expect.stringContaining('Похоже, Ion оплатил аренду: 473.00 ₾.')
    })
    const reporterPending = await promptRepository.getPendingAction('-10012345', '10002')
    const reportedPending = await promptRepository.getPendingAction('-10012345', '20002')
    expect(reporterPending?.action).toBe('payment_topic_confirmation')
    expect(reportedPending?.action).toBe('payment_topic_confirmation')

    const proposalId = (reportedPending?.payload as { proposalId?: string } | null)?.proposalId
    await bot.handleUpdate(
      paymentCallbackUpdate(`payment_topic:confirm:${proposalId ?? 'missing'}`, 20002) as never
    )

    expect(paymentConfirmationService.submitted.at(-1)).toMatchObject({
      memberId: 'member-2',
      rawText: 'Ion paid rent 473.00 GEL'
    })
    expect(calls.at(-2)).toMatchObject({
      method: 'answerCallbackQuery',
      payload: {
        text: 'Ion paid rent: 472.50 ₾'
      }
    })
    expect(await promptRepository.getPendingAction('-10012345', '10002')).toBeNull()
    expect(await promptRepository.getPendingAction('-10012345', '20002')).toBeNull()
  })

  test('rejects duplicate payment proposals when the target balance is already settled', async () => {
    const bot = createTelegramBot('000000:test-token')
    const calls: Array<{ method: string; payload: unknown }> = []
    const promptRepository = createPromptRepository()
    const financeService: FinanceCommandService = {
      ...createFinanceService(),
      generateDashboard: async () => ({
        period: '2026-03',
        currency: 'GEL',
        timezone: 'Asia/Tbilisi',
        rentWarningDay: 17,
        rentDueDay: 20,
        utilitiesReminderDay: 3,
        utilitiesDueDay: 4,
        paymentBalanceAdjustmentPolicy: 'utilities',
        rentPaymentDestinations: null,
        totalDue: Money.zero('GEL'),
        totalPaid: Money.fromMajor('1000', 'GEL'),
        totalRemaining: Money.zero('GEL'),
        billingStage: 'rent',
        rentSourceAmount: Money.fromMajor('700', 'USD'),
        rentDisplayAmount: Money.fromMajor('1890', 'GEL'),
        rentFxRateMicros: null,
        rentFxEffectiveDate: null,
        utilityBillingPlan: null,
        rentBillingState: {
          dueDate: '2026-03-20',
          memberSummaries: [],
          paymentDestinations: null
        },
        members: [
          {
            memberId: 'member-1',
            displayName: 'Mia',
            rentShare: Money.fromMajor('472.50', 'GEL'),
            utilityShare: Money.fromMajor('40', 'GEL'),
            purchaseOffset: Money.fromMajor('-12', 'GEL'),
            netDue: Money.fromMajor('500.50', 'GEL'),
            paid: Money.fromMajor('500.50', 'GEL'),
            remaining: Money.zero('GEL'),
            overduePayments: [],
            explanations: []
          }
        ],
        ledger: []
      })
    }

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

    registerConfiguredPaymentTopicIngestion(
      bot,
      createHouseholdRepository() as never,
      promptRepository,
      () => financeService,
      () => createPaymentConfirmationService(),
      {
        topicProcessor: async () => ({
          route: 'payment',
          kind: 'rent',
          amountMinor: null,
          currency: null,
          payerDisplayName: null,
          confidence: 96,
          reason: 'duplicate_attempt'
        })
      }
    )

    await bot.handleUpdate(paymentUpdate('я уже закинул за оплату жилья') as never)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.payload).toMatchObject({
      text: 'Аренда уже закрыта.'
    })
    expect(await promptRepository.getPendingAction('-10012345', '10002')).toBeNull()
  })

  test('does not record a stale third-person payment confirm after the balance is already settled', async () => {
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

    await promptRepository.upsertPendingAction({
      telegramUserId: '10002',
      telegramChatId: '-10012345',
      action: 'payment_topic_confirmation',
      payload: {
        proposalId: 'proposal-1',
        householdId: 'household-1',
        memberId: 'member-2',
        kind: 'rent',
        amountMinor: '47250',
        currency: 'GEL',
        rawText: 'Ион оплатил аренду',
        senderTelegramUserId: '10002',
        reportedTelegramUserId: '20002',
        reportedDisplayName: 'Ion',
        isThirdParty: true,
        telegramChatId: '-10012345',
        telegramMessageId: '55',
        telegramThreadId: '888',
        telegramUpdateId: '1001',
        attachmentCount: 0,
        messageSentAt: null
      },
      expiresAt: null
    })
    await promptRepository.upsertPendingAction({
      telegramUserId: '20002',
      telegramChatId: '-10012345',
      action: 'payment_topic_confirmation',
      payload: {
        proposalId: 'proposal-1',
        householdId: 'household-1',
        memberId: 'member-2',
        kind: 'rent',
        amountMinor: '47250',
        currency: 'GEL',
        rawText: 'Ион оплатил аренду',
        senderTelegramUserId: '10002',
        reportedTelegramUserId: '20002',
        reportedDisplayName: 'Ion',
        isThirdParty: true,
        telegramChatId: '-10012345',
        telegramMessageId: '55',
        telegramThreadId: '888',
        telegramUpdateId: '1001',
        attachmentCount: 0,
        messageSentAt: null
      },
      expiresAt: null
    })

    registerConfiguredPaymentTopicIngestion(
      bot,
      createHouseholdRepository() as never,
      promptRepository,
      () => createFinanceService(),
      () => ({
        async submit() {
          return {
            status: 'already_settled' as const,
            kind: 'rent' as const
          }
        }
      }),
      {}
    )

    await bot.handleUpdate(
      paymentCallbackUpdate('payment_topic:confirm:proposal-1', 20002) as never
    )

    expect(calls[0]).toMatchObject({
      method: 'answerCallbackQuery',
      payload: {
        show_alert: true
      }
    })
    expect(calls[1]).toMatchObject({
      method: 'editMessageText',
      payload: expect.objectContaining({
        text: expect.stringContaining('Ion')
      })
    })
    expect(await promptRepository.getPendingAction('-10012345', '10002')).toBeNull()
    expect(await promptRepository.getPendingAction('-10012345', '20002')).toBeNull()
  })

  test('clears a pending payment confirmation when a followup has no payment intent', async () => {
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

    await promptRepository.upsertPendingAction({
      telegramUserId: '10002',
      telegramChatId: '-10012345',
      action: 'payment_topic_confirmation',
      payload: {
        proposalId: 'proposal-1',
        householdId: 'household-1',
        memberId: 'member-1',
        kind: 'rent',
        amountMinor: '47250',
        currency: 'GEL',
        rawText: 'За жилье отправил',
        senderTelegramUserId: '10002',
        telegramChatId: '-10012345',
        telegramMessageId: '55',
        telegramThreadId: '888',
        telegramUpdateId: '1001',
        attachmentCount: 0,
        messageSentAt: null
      },
      expiresAt: null
    })

    registerConfiguredPaymentTopicIngestion(
      bot,
      createHouseholdRepository() as never,
      promptRepository,
      () => createFinanceService(),
      () => createPaymentConfirmationService(),
      {
        topicProcessor: async () => ({
          route: 'dismiss_workflow',
          replyText: null,
          reason: 'test'
        })
      }
    )

    await bot.handleUpdate(paymentUpdate('Я уже сказал выше') as never)

    expect(calls).toHaveLength(0)
    expect(await promptRepository.getPendingAction('-10012345', '10002')).toBeNull()
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
      () => paymentConfirmationService,
      { topicProcessor: createMockPaymentTopicProcessor() }
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
        memberId: 'member-1',
        rawText: 'paid rent 473.00 GEL',
        telegramMessageId: '55',
        telegramThreadId: '888'
      }
    ])
    expect(calls[0]).toMatchObject({
      method: 'answerCallbackQuery',
      payload: {
        callback_query_id: 'callback-1',
        text: 'Recorded rent payment: 472.50 ₾'
      }
    })
    expect(calls[1]).toMatchObject({
      method: 'editMessageText',
      payload: {
        chat_id: -10012345,
        message_id: 77,
        text: 'Recorded rent payment: 472.50 ₾'
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
      () => paymentConfirmationService,
      { topicProcessor: createMockPaymentTopicProcessor('silent') }
    )

    await bot.handleUpdate(paymentUpdate('Так так)') as never)

    expect(calls).toHaveLength(0)
  })

  test('playfully redirects purchase-like messages sent in the payments topic', async () => {
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
        result: {
          message_id: calls.length,
          date: Math.floor(Date.now() / 1000),
          chat: {
            id: -10012345,
            type: 'supergroup'
          },
          text: (payload as { text?: string }).text ?? 'ok'
        }
      } as never
    })

    registerConfiguredPaymentTopicIngestion(
      bot,
      createHouseholdRepository() as never,
      promptRepository,
      () => createFinanceService(),
      () => paymentConfirmationService,
      { topicProcessor: createMockPaymentTopicProcessor('silent') }
    )

    await bot.handleUpdate(
      paymentUpdate('Купила жигу большую и 2 ножика маленьких 10 лар') as never
    )

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      method: 'sendMessage',
      payload: {
        text: 'Похоже на общую покупку, но этот топик у меня про оплаты. Закиньте это в топик покупок, и я там всё красиво подтвержу.'
      }
    })
  })

  test('replies when explicitly mentioned even if the topic processor stays silent', async () => {
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

    registerConfiguredPaymentTopicIngestion(
      bot,
      createHouseholdRepository() as never,
      promptRepository,
      () => createFinanceService(),
      () => paymentConfirmationService,
      { topicProcessor: createMockPaymentTopicProcessor('silent') }
    )

    await bot.handleUpdate(paymentUpdate('@household_test_bot Значит игнор') as never)

    expect(paymentConfirmationService.submitted).toHaveLength(0)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      method: 'sendMessage',
      payload: {
        chat_id: -10012345,
        reply_parameters: {
          message_id: 55
        }
      }
    })
    expect(calls[0]?.payload).toHaveProperty('text')
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
      () => paymentConfirmationService,
      { topicProcessor: createMockPaymentTopicProcessor() }
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
      () => paymentConfirmationService,
      { topicProcessor: createMockPaymentTopicProcessor('topic_helper') }
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
      () => paymentConfirmationService,
      { topicProcessor: createMockPaymentTopicProcessor() }
    )

    await bot.handleUpdate(paymentUpdate('@household_test_bot за жилье закинул') as never)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.payload).toMatchObject({
      text: expect.stringContaining('Я могу записать эту оплату аренды: 473.00 ₾.')
    })
  })

  test('uses router for playful addressed replies in the payments topic', async () => {
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

    registerConfiguredPaymentTopicIngestion(
      bot,
      createHouseholdRepository() as never,
      promptRepository,
      () => createFinanceService(),
      () => createPaymentConfirmationService(),
      {
        topicProcessor: async () => ({
          route: 'chat_reply',
          replyText: 'Тут. Если это про оплату, разберёмся.',
          reason: 'smalltalk'
        })
      }
    )

    await bot.handleUpdate(paymentUpdate('@household_test_bot а ты тут?') as never)

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      method: 'sendMessage',
      payload: {
        text: 'Тут. Если это про оплату, разберёмся.'
      }
    })
  })

  test('keeps a pending payment workflow in another thread when dismissing here', async () => {
    const bot = createTelegramBot('000000:test-token')
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

    bot.api.config.use(async () => {
      return {
        ok: true,
        result: true
      } as never
    })

    await promptRepository.upsertPendingAction({
      telegramUserId: '10002',
      telegramChatId: '-10012345',
      action: 'payment_topic_clarification',
      payload: {
        threadId: '999',
        rawText: 'За жилье отправил'
      },
      expiresAt: null
    })

    registerConfiguredPaymentTopicIngestion(
      bot,
      createHouseholdRepository() as never,
      promptRepository,
      () => createFinanceService(),
      () => createPaymentConfirmationService(),
      {
        topicProcessor: async () => ({
          route: 'dismiss_workflow',
          replyText: 'Окей, молчу.',
          reason: 'backoff'
        })
      }
    )

    await bot.handleUpdate(paymentUpdate('@household_test_bot stop', 888) as never)

    expect(await promptRepository.getPendingAction('-10012345', '10002')).toMatchObject({
      action: 'payment_topic_clarification',
      payload: {
        threadId: '999',
        rawText: 'За жилье отправил'
      }
    })
  })
})
