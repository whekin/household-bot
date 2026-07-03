import { describe, expect, test } from 'bun:test'

import type {
  FinanceCommandService,
  PaymentConfirmationService,
  PaymentConfirmationSubmitResult
} from '@household/application'
import { instantFromIso, Money } from '@household/domain'
import type { TelegramPendingActionRecord, TelegramPendingActionRepository } from '@household/ports'
import { createTelegramBot } from './bot'
import {
  buildPaymentAcknowledgement,
  registerConfiguredPaymentTopicIngestion,
  resolveConfiguredPaymentTopicRecord,
  type PaymentTopicCandidate
} from './payment-topic-ingestion'
import { getCachedTopicMessageRoute } from './topic-message-router'
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

function paymentReplyToBotUpdate(text: string, threadId = 888) {
  const update = paymentUpdate(text, threadId)
  return {
    ...update,
    message: {
      ...update.message,
      reply_to_message: {
        message_id: 44,
        date: Math.floor(Date.now() / 1000),
        chat: update.message.chat,
        from: {
          id: 999000,
          is_bot: true,
          first_name: 'Household Test Bot',
          username: 'household_test_bot'
        },
        text: 'Подтвердите оплату аренды'
      }
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
      preferredUtilityPayerMemberId: null,
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
    async findPendingActionByPayloadValue(telegramChatId, action, payloadKey, value) {
      return (
        [...pending.values()].find(
          (entry) =>
            entry.telegramChatId === telegramChatId &&
            entry.action === action &&
            entry.payload[payloadKey] === value
        ) ?? null
      )
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
      preferredUtilityPayerMemberId: null,
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
    ensureDashboardMaterialized: async () => null,
    generateBillingAuditExport: async () => null,
    generateStatement: async () => null,
    manuallyResolvePurchase: async () => ({
      purchaseId: 'test-purchase',
      resolvedAmount: Money.fromMajor('0.00', 'GEL')
    })
  }
}

function createMultiMemberRentFinanceService(
  options: {
    settleAfterFirstDashboard?: boolean
    paidMemberIds?: readonly string[]
    payMemberAfterFirstDashboard?: string
  } = {}
): FinanceCommandService {
  const base = createFinanceService()
  let dashboardCalls = 0
  const initiallyPaidMemberIds = new Set(options.paidMemberIds ?? [])
  const members = [
    {
      id: 'member-1',
      telegramUserId: '10002',
      displayName: 'Stas',
      rentShareWeight: 1,
      isAdmin: false
    },
    {
      id: 'member-2',
      telegramUserId: '20002',
      displayName: 'Dima',
      rentShareWeight: 1,
      isAdmin: false
    },
    {
      id: 'member-3',
      telegramUserId: '30003',
      displayName: 'Alisa',
      rentShareWeight: 1,
      isAdmin: false
    }
  ]

  return {
    ...base,
    getMemberByTelegramUserId: async (telegramUserId) =>
      members.find((member) => member.telegramUserId === telegramUserId) ?? null,
    listMembers: async () => members,
    generateDashboard: async () => {
      dashboardCalls += 1
      const settled = options.settleAfterFirstDashboard && dashboardCalls > 2
      const paidMemberIds = new Set(initiallyPaidMemberIds)
      if (options.payMemberAfterFirstDashboard && dashboardCalls > 2) {
        paidMemberIds.add(options.payMemberAfterFirstDashboard)
      }
      const dashboardMembers = members.map((member) => {
        const memberSettled = settled || paidMemberIds.has(member.id)
        return {
          memberId: member.id,
          displayName: member.displayName,
          rentShare: Money.fromMajor('469.00', 'GEL'),
          utilityShare: Money.fromMajor('40.00', 'GEL'),
          purchaseOffset: Money.zero('GEL'),
          netDue: Money.fromMajor('469.00', 'GEL'),
          paid: memberSettled ? Money.fromMajor('469.00', 'GEL') : Money.zero('GEL'),
          remaining: memberSettled ? Money.zero('GEL') : Money.fromMajor('469.00', 'GEL'),
          overduePayments: [],
          explanations: []
        }
      })
      const unresolvedMembers = dashboardMembers.filter(
        (member) => member.remaining.amountMinor > 0n
      )

      return {
        period: '2026-05',
        currency: 'GEL',
        timezone: 'Asia/Tbilisi',
        rentWarningDay: 17,
        rentDueDay: 20,
        utilitiesReminderDay: 3,
        preferredUtilityPayerMemberId: null,
        utilitiesDueDay: 4,
        paymentBalanceAdjustmentPolicy: 'utilities',
        rentPaymentDestinations: null,
        totalDue: Money.fromMajor('1407.00', 'GEL'),
        totalPaid: Money.fromMinor(BigInt(3 - unresolvedMembers.length) * 46900n, 'GEL'),
        totalRemaining: Money.fromMinor(BigInt(unresolvedMembers.length) * 46900n, 'GEL'),
        billingStage: 'rent',
        rentSourceAmount: Money.fromMajor('1407.00', 'GEL'),
        rentDisplayAmount: Money.fromMajor('1407.00', 'GEL'),
        rentFxRateMicros: null,
        rentFxEffectiveDate: null,
        utilityBillingPlan: null,
        rentBillingState: {
          dueDate: '2026-05-20',
          memberSummaries: [],
          paymentDestinations: null
        },
        members: dashboardMembers,
        paymentPeriods: [
          {
            period: '2026-05',
            utilityTotal: Money.zero('GEL'),
            hasOverdueBalance: false,
            isCurrentPeriod: true,
            kinds: [
              {
                kind: 'rent',
                totalDue: Money.fromMajor('1407.00', 'GEL'),
                totalPaid: Money.fromMinor(BigInt(3 - unresolvedMembers.length) * 46900n, 'GEL'),
                totalRemaining: Money.fromMinor(BigInt(unresolvedMembers.length) * 46900n, 'GEL'),
                unresolvedMembers: unresolvedMembers.map((member) => ({
                  memberId: member.memberId,
                  displayName: member.displayName,
                  suggestedAmount: Money.fromMajor('469.00', 'GEL'),
                  baseDue: Money.fromMajor('469.00', 'GEL'),
                  paid: Money.zero('GEL'),
                  remaining: Money.fromMajor('469.00', 'GEL'),
                  effectivelySettled: false
                }))
              },
              {
                kind: 'utilities',
                totalDue: Money.zero('GEL'),
                totalPaid: Money.zero('GEL'),
                totalRemaining: Money.zero('GEL'),
                unresolvedMembers: []
              }
            ]
          }
        ],
        ledger: []
      }
    }
  }
}

function withAdminMember(service: FinanceCommandService): FinanceCommandService {
  const admin = {
    id: 'admin-member',
    telegramUserId: '90009',
    displayName: 'Admin',
    rentShareWeight: 0,
    isAdmin: true
  }

  return {
    ...service,
    getMemberByTelegramUserId: async (telegramUserId) =>
      telegramUserId === admin.telegramUserId
        ? admin
        : service.getMemberByTelegramUserId(telegramUserId),
    listMembers: async () => [...(await service.listMembers()), admin]
  }
}

function createPaymentConfirmationService(
  resultForMember?: (memberId: string | null | undefined) => PaymentConfirmationSubmitResult
): PaymentConfirmationService & {
  submitted: Array<{
    memberId?: string | null
    rawText: string
    parseText?: string | null
    sourceKey?: string | null
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
        parseText: input.parseText ?? null,
        sourceKey: input.sourceKey ?? null,
        telegramMessageId: input.telegramMessageId,
        telegramThreadId: input.telegramThreadId
      })

      return (
        resultForMember?.(input.memberId) ?? {
          status: 'recorded',
          kind: 'rent',
          amount: Money.fromMajor('472.50', 'GEL')
        }
      )
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
      evidence: 'explicit_text',
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

  test('answers utility amount/location questions instead of opening a payment proposal', async () => {
    const bot = createTelegramBot('000000:test-token')
    const calls: Array<{ method: string; payload: unknown }> = []
    const promptRepository = createPromptRepository()
    const paymentConfirmationService = createPaymentConfirmationService()
    const financeService: FinanceCommandService = {
      ...createFinanceService(),
      generateDashboard: async () => ({
        period: '2026-06',
        currency: 'GEL',
        timezone: 'Asia/Tbilisi',
        rentWarningDay: 17,
        rentDueDay: 20,
        utilitiesReminderDay: 3,
        preferredUtilityPayerMemberId: null,
        utilitiesDueDay: 4,
        paymentBalanceAdjustmentPolicy: 'utilities',
        rentPaymentDestinations: null,
        totalDue: Money.fromMajor('600.00', 'GEL'),
        totalPaid: Money.zero('GEL'),
        totalRemaining: Money.fromMajor('600.00', 'GEL'),
        billingStage: 'utilities',
        rentSourceAmount: Money.fromMajor('700', 'USD'),
        rentDisplayAmount: Money.fromMajor('1900', 'GEL'),
        rentFxRateMicros: null,
        rentFxEffectiveDate: null,
        utilityBillingPlan: {
          id: 'plan-1',
          version: 1,
          status: 'active',
          dueDate: '2026-06-04',
          updatedFromVersion: null,
          reason: null,
          categories: [
            {
              utilityBillId: 'gas',
              billName: 'Gas (Water)',
              billTotal: Money.fromMajor('165.66', 'GEL'),
              assignedAmount: Money.fromMajor('21.54', 'GEL'),
              assignedMemberId: 'member-1',
              assignedDisplayName: 'Mia',
              paidAmount: Money.zero('GEL'),
              isFullAssignment: false,
              splitGroupId: 'gas'
            },
            {
              utilityBillId: 'electricity',
              billName: 'Electricity',
              billTotal: Money.fromMajor('49.07', 'GEL'),
              assignedAmount: Money.fromMajor('35.52', 'GEL'),
              assignedMemberId: 'member-1',
              assignedDisplayName: 'Mia',
              paidAmount: Money.zero('GEL'),
              isFullAssignment: false,
              splitGroupId: 'electricity'
            },
            {
              utilityBillId: 'internet',
              billName: 'Internet',
              billTotal: Money.fromMajor('35.00', 'GEL'),
              assignedAmount: Money.fromMajor('6.88', 'GEL'),
              assignedMemberId: 'member-1',
              assignedDisplayName: 'Mia',
              paidAmount: Money.zero('GEL'),
              isFullAssignment: false,
              splitGroupId: 'internet'
            },
            {
              utilityBillId: 'cleaning',
              billName: 'Cleaning',
              billTotal: Money.fromMajor('2.50', 'GEL'),
              assignedAmount: Money.fromMajor('2.50', 'GEL'),
              assignedMemberId: 'member-1',
              assignedDisplayName: 'Mia',
              paidAmount: Money.zero('GEL'),
              isFullAssignment: true,
              splitGroupId: null
            }
          ],
          memberSummaries: [
            {
              memberId: 'member-1',
              displayName: 'Mia',
              fairShare: Money.fromMajor('63.06', 'GEL'),
              vendorPaid: Money.zero('GEL'),
              assignedThisCycle: Money.fromMajor('66.44', 'GEL'),
              projectedDeltaAfterPlan: Money.fromMajor('9.38', 'GEL')
            }
          ]
        },
        rentBillingState: {
          dueDate: '2026-06-20',
          memberSummaries: [],
          paymentDestinations: null
        },
        members: [
          {
            memberId: 'member-1',
            displayName: 'Mia',
            rentShare: Money.fromMajor('472.50', 'GEL'),
            utilityShare: Money.fromMajor('63.06', 'GEL'),
            purchaseOffset: Money.fromMajor('3.00', 'GEL'),
            netDue: Money.fromMajor('532.49', 'GEL'),
            paid: Money.zero('GEL'),
            remaining: Money.fromMajor('532.49', 'GEL'),
            overduePayments: [],
            explanations: []
          }
        ],
        paymentPeriods: [
          {
            period: '2026-06',
            utilityTotal: Money.fromMajor('252.23', 'GEL'),
            hasOverdueBalance: false,
            isCurrentPeriod: true,
            kinds: [
              {
                kind: 'utilities',
                totalDue: Money.fromMajor('66.44', 'GEL'),
                totalPaid: Money.zero('GEL'),
                totalRemaining: Money.fromMajor('66.44', 'GEL'),
                unresolvedMembers: [
                  {
                    memberId: 'member-1',
                    displayName: 'Mia',
                    suggestedAmount: Money.fromMajor('66.44', 'GEL'),
                    baseDue: Money.fromMajor('66.44', 'GEL'),
                    paid: Money.zero('GEL'),
                    remaining: Money.fromMajor('66.44', 'GEL'),
                    effectivelySettled: false
                  }
                ]
              },
              {
                kind: 'rent',
                totalDue: Money.zero('GEL'),
                totalPaid: Money.zero('GEL'),
                totalRemaining: Money.zero('GEL'),
                unresolvedMembers: []
              }
            ]
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
      () => paymentConfirmationService,
      { topicProcessor: createMockPaymentTopicProcessor() }
    )

    await bot.handleUpdate(
      paymentUpdate('@household_test_bot За какие услуги сколько скинуть?') as never
    )

    expect(paymentConfirmationService.submitted).toHaveLength(0)
    expect(await promptRepository.getPendingAction('-10012345', '10002')).toBeNull()
    expect(calls).toHaveLength(1)
    const payload = calls[0]?.payload as { text?: string; reply_markup?: unknown } | undefined
    expect(payload?.text).toContain('Текущая сводка по коммуналке')
    expect(payload?.text).toContain('Сумма по плану коммуналки: 66.44 ₾')
    expect(payload?.text).toContain('По услугам:')
    expect(payload?.text).toContain('Gas (Water): 21.54 ₾')
    expect(payload?.text).toContain('Electricity: 35.52 ₾')
    expect(payload?.reply_markup).toBeUndefined()
  })

  test('answers amount/location questions instead of cancelling an active payment workflow', async () => {
    const bot = createTelegramBot('000000:test-token')
    const calls: Array<{ method: string; payload: unknown }> = []
    const promptRepository = createPromptRepository()

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
      {
        topicProcessor: async () => ({
          route: 'dismiss_workflow',
          replyText: 'Предложение оплаты отменено.',
          reason: 'test'
        })
      }
    )

    await bot.handleUpdate(paymentUpdate('@household_test_bot чё куда за аренду кидать?') as never)

    expect(calls).toHaveLength(1)
    const payload = calls[0]?.payload as { text?: string } | undefined
    expect(payload?.text).toContain('Текущая сводка по аренде')
    expect(payload?.text).not.toContain('Предложение оплаты отменено')
    expect(await promptRepository.getPendingAction('-10012345', '10002')).toBeNull()
  })

  test('does not let regex fallback override topic processor silence for a clear rent payment', async () => {
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

    expect(calls).toHaveLength(0)
    expect(await promptRepository.getPendingAction('-10012345', '10002')).toBeNull()
  })

  test('stays silent for future, ability, and help-offer payment chatter from the real transcript', async () => {
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
      () => createMultiMemberRentFinanceService(),
      () => createPaymentConfirmationService(),
      { topicProcessor: createMockPaymentTopicProcessor('silent') }
    )

    const messages = [
      'Блин, мне чтоб закинуть надо в город гнать( На карте 0',
      'Я могу закинуть',
      'могу закинуть',
      'надо закинуть',
      'завтра закину',
      'если надо, закину',
      'кто может закинуть?',
      'на карте 0',
      'мне надо в город гнать'
    ]

    for (const message of messages) {
      await bot.handleUpdate(paymentUpdate(message) as never)
    }

    expect(calls).toHaveLength(0)
    expect(await promptRepository.getPendingAction('-10012345', '10002')).toBeNull()
  })

  test('uses active rent context for clear completed payment assertions without clarification', async () => {
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
      () => createMultiMemberRentFinanceService(),
      () => createPaymentConfirmationService(),
      {
        topicProcessor: async (input) => ({
          route: 'payment',
          kind: input.messageText.includes('аренд') ? 'rent' : null,
          amountMinor: null,
          currency: null,
          payerDisplayName: null,
          confidence: 95,
          evidence: 'explicit_text',
          reason: 'completed_payment'
        })
      }
    )

    for (const message of ['закинул', 'оплатил', 'перевёл', 'отправил за аренду']) {
      calls.length = 0
      await bot.handleUpdate(paymentUpdate(message) as never)
      expect(calls).toHaveLength(1)
      expect(calls[0]).toMatchObject({
        method: 'sendMessage',
        payload: {
          text: expect.stringContaining('Я могу записать эту оплату аренды: 469.00 ₾.'),
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
        }
      })
      expect(String((calls[0]?.payload as { text?: string } | undefined)?.text)).not.toContain(
        'Уточните'
      )
    }
  })

  test('creates and confirms a sender-owned multi-member rent proposal with per-member source keys', async () => {
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
        result:
          method === 'sendMessage'
            ? {
                message_id: calls.length,
                date: Math.floor(Date.now() / 1000),
                chat: {
                  id: -10012345,
                  type: 'supergroup'
                },
                text: 'ok'
              }
            : true
      } as never
    })

    registerConfiguredPaymentTopicIngestion(
      bot,
      createHouseholdRepository() as never,
      promptRepository,
      () => createMultiMemberRentFinanceService(),
      () => paymentConfirmationService,
      { topicProcessor: createMockPaymentTopicProcessor() }
    )

    await bot.handleUpdate(paymentUpdate('Перевел за Себя, Диму и Алису.') as never)

    expect(calls[0]).toMatchObject({
      method: 'sendMessage',
      payload: {
        text: expect.stringContaining('Я могу записать оплату аренды за май 2026')
      }
    })
    const proposalPayload = calls[0]?.payload as
      | {
          reply_markup?: {
            inline_keyboard?: Array<Array<{ text: string; callback_data: string }>>
          }
        }
      | undefined
    const rows = proposalPayload?.reply_markup?.inline_keyboard ?? []
    expect(rows.map((row) => row[0]?.text)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Stas'),
        expect.stringContaining('Dima'),
        expect.stringContaining('Alisa')
      ])
    )
    expect(rows.at(-1)).toEqual([
      {
        text: 'Подтвердить выбранных',
        callback_data: expect.stringMatching(/^pt:mc:[^:]+$/)
      },
      {
        text: 'Отменить',
        callback_data: expect.stringMatching(/^pt:cancel:[^:]+$/)
      }
    ])

    const pending = await promptRepository.getPendingAction('-10012345', '10002')
    const proposalId = (pending?.payload as { proposalId?: string } | null)?.proposalId
    calls.length = 0

    await bot.handleUpdate(
      paymentCallbackUpdate(`pt:mt:${proposalId ?? 'missing'}:member-2`, 20002) as never
    )
    expect(paymentConfirmationService.submitted).toHaveLength(0)
    expect(calls[0]).toMatchObject({
      method: 'answerCallbackQuery',
      payload: {
        callback_query_id: 'callback-1',
        text: 'Управлять этим предложением оплаты может только отправитель сообщения.',
        show_alert: true
      }
    })
    calls.length = 0

    await bot.handleUpdate(
      paymentCallbackUpdate(`pt:cancel:${proposalId ?? 'missing'}`, 20002) as never
    )
    expect(calls[0]).toMatchObject({
      method: 'answerCallbackQuery',
      payload: {
        callback_query_id: 'callback-1',
        text: 'Управлять этим предложением оплаты может только отправитель сообщения.',
        show_alert: true
      }
    })
    expect(await promptRepository.getPendingAction('-10012345', '10002')).not.toBeNull()
    calls.length = 0

    await bot.handleUpdate(
      paymentCallbackUpdate(`pt:mt:${proposalId ?? 'missing'}:member-2`) as never
    )
    expect(calls[1]).toMatchObject({
      method: 'editMessageText',
      payload: {
        text: expect.stringContaining('⬜ Dima')
      }
    })
    const toggledOffPending = await promptRepository.getPendingAction('-10012345', '10002')
    const toggledOffPayload = toggledOffPending?.payload as
      | { members?: Array<{ memberId: string; selected: boolean }> }
      | undefined
    expect(
      toggledOffPayload?.members?.find((member) => member.memberId === 'member-2')?.selected
    ).toBe(false)
    calls.length = 0

    await bot.handleUpdate(
      paymentCallbackUpdate(`pt:mt:${proposalId ?? 'missing'}:member-2`) as never
    )
    const toggledOnPending = await promptRepository.getPendingAction('-10012345', '10002')
    const toggledOnPayload = toggledOnPending?.payload as
      | { members?: Array<{ memberId: string; selected: boolean }> }
      | undefined
    expect(
      toggledOnPayload?.members?.find((member) => member.memberId === 'member-2')?.selected
    ).toBe(true)
    calls.length = 0

    await bot.handleUpdate(paymentCallbackUpdate(`pt:mc:${proposalId ?? 'missing'}`) as never)

    expect(paymentConfirmationService.submitted).toEqual([
      {
        memberId: 'member-1',
        rawText: 'Перевел за Себя, Диму и Алису.',
        parseText: 'paid rent 469.00 GEL',
        sourceKey: `55:${proposalId}:member-1`,
        telegramMessageId: '55',
        telegramThreadId: '888'
      },
      {
        memberId: 'member-2',
        rawText: 'Перевел за Себя, Диму и Алису.',
        parseText: 'paid rent 469.00 GEL',
        sourceKey: `55:${proposalId}:member-2`,
        telegramMessageId: '55',
        telegramThreadId: '888'
      },
      {
        memberId: 'member-3',
        rawText: 'Перевел за Себя, Диму и Алису.',
        parseText: 'paid rent 469.00 GEL',
        sourceKey: `55:${proposalId}:member-3`,
        telegramMessageId: '55',
        telegramThreadId: '888'
      }
    ])
    expect(calls[0]).toMatchObject({
      method: 'answerCallbackQuery',
      payload: {
        callback_query_id: 'callback-1',
        text: 'Записал оплату аренды для: Stas, Dima, Alisa.'
      }
    })
    expect(await promptRepository.getPendingAction('-10012345', '10002')).toBeNull()

    calls.length = 0
    await bot.handleUpdate(paymentCallbackUpdate(`pt:mc:${proposalId ?? 'missing'}`) as never)

    expect(paymentConfirmationService.submitted).toHaveLength(3)
    expect(calls[0]).toMatchObject({
      method: 'answerCallbackQuery',
      payload: {
        text: 'This payment proposal is no longer available.',
        show_alert: true
      }
    })
  })

  test('lets an admin cancel another sender multi-member payment proposal', async () => {
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
        result:
          method === 'sendMessage'
            ? {
                message_id: calls.length,
                date: Math.floor(Date.now() / 1000),
                chat: {
                  id: -10012345,
                  type: 'supergroup'
                },
                text: 'ok'
              }
            : true
      } as never
    })

    const financeService = withAdminMember(createMultiMemberRentFinanceService())
    registerConfiguredPaymentTopicIngestion(
      bot,
      createHouseholdRepository() as never,
      promptRepository,
      () => financeService,
      () => createPaymentConfirmationService(),
      { topicProcessor: createMockPaymentTopicProcessor() }
    )

    await bot.handleUpdate(paymentUpdate('Перевел за Себя, Диму и Алису.') as never)
    const pending = await promptRepository.getPendingAction('-10012345', '10002')
    const proposalId = (pending?.payload as { proposalId?: string } | null)?.proposalId
    calls.length = 0

    await bot.handleUpdate(
      paymentCallbackUpdate(`pt:cancel:${proposalId ?? 'missing'}`, 90009) as never
    )

    expect(calls[0]).toMatchObject({
      method: 'answerCallbackQuery',
      payload: {
        callback_query_id: 'callback-1',
        text: 'Предложение оплаты отменено.'
      }
    })
    expect(await promptRepository.getPendingAction('-10012345', '10002')).toBeNull()
  })

  test('stays silent for ambiguous aggregate multi-member amounts even on the payment route', async () => {
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
      () => createMultiMemberRentFinanceService(),
      () => paymentConfirmationService,
      { topicProcessor: createMockPaymentTopicProcessor() }
    )

    await bot.handleUpdate(paymentUpdate('Перевел 100 за себя и Диму') as never)

    expect(paymentConfirmationService.submitted).toHaveLength(0)
    expect(calls).toHaveLength(0)
    expect(await promptRepository.getPendingAction('-10012345', '10002')).toBeNull()
  })

  test('accepts explicit per-person amounts for multi-member proposals', async () => {
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
      () => createMultiMemberRentFinanceService(),
      () => createPaymentConfirmationService(),
      { topicProcessor: createMockPaymentTopicProcessor() }
    )

    await bot.handleUpdate(paymentUpdate('Перевел по 100 за себя и Диму') as never)

    const proposalText = String((calls[0]?.payload as { text?: string } | undefined)?.text)
    expect(proposalText).toContain('✅ Stas — не оплачено')
    expect(proposalText).toContain('✅ Dima — не оплачено')
    expect(proposalText).not.toContain('100.00 ₾')
  })

  test('keeps already-paid mentioned members out of multi-member payment writes', async () => {
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
        result:
          method === 'sendMessage'
            ? {
                message_id: calls.length,
                date: Math.floor(Date.now() / 1000),
                chat: {
                  id: -10012345,
                  type: 'supergroup'
                },
                text: 'ok'
              }
            : true
      } as never
    })

    registerConfiguredPaymentTopicIngestion(
      bot,
      createHouseholdRepository() as never,
      promptRepository,
      () => createMultiMemberRentFinanceService({ paidMemberIds: ['member-2'] }),
      () => paymentConfirmationService,
      { topicProcessor: createMockPaymentTopicProcessor() }
    )

    await bot.handleUpdate(paymentUpdate('Перевел за Себя, Диму и Алису.') as never)

    const proposalPayload = calls[0]?.payload as
      | {
          text?: string
          reply_markup?: {
            inline_keyboard?: Array<Array<{ text: string; callback_data: string }>>
          }
        }
      | undefined
    expect(proposalPayload?.text).toContain('✓ Dima — уже оплачено')
    const callbackData = (proposalPayload?.reply_markup?.inline_keyboard ?? [])
      .flat()
      .map((button) => button.callback_data)
    expect(callbackData.some((value) => value.includes(':member-2'))).toBe(false)

    const proposalId = (
      (await promptRepository.getPendingAction('-10012345', '10002'))?.payload as {
        proposalId?: string
      } | null
    )?.proposalId
    calls.length = 0

    await bot.handleUpdate(paymentCallbackUpdate(`pt:mc:${proposalId ?? 'missing'}`) as never)

    expect(paymentConfirmationService.submitted.map((input) => input.memberId)).toEqual([
      'member-1',
      'member-3'
    ])
    expect(calls[0]).toMatchObject({
      method: 'answerCallbackQuery',
      payload: {
        text: expect.stringContaining('Dima')
      }
    })
  })

  test('rechecks paid state before multi-member confirmation to avoid stale duplicate writes', async () => {
    const bot = createTelegramBot('000000:test-token')
    const calls: Array<{ method: string; payload: unknown }> = []
    const promptRepository = createPromptRepository()
    const paymentConfirmationService = createPaymentConfirmationService()
    const financeService = createMultiMemberRentFinanceService({
      payMemberAfterFirstDashboard: 'member-2'
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

    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })

      return {
        ok: true,
        result:
          method === 'sendMessage'
            ? {
                message_id: calls.length,
                date: Math.floor(Date.now() / 1000),
                chat: {
                  id: -10012345,
                  type: 'supergroup'
                },
                text: 'ok'
              }
            : true
      } as never
    })

    registerConfiguredPaymentTopicIngestion(
      bot,
      createHouseholdRepository() as never,
      promptRepository,
      () => financeService,
      () => paymentConfirmationService,
      { topicProcessor: createMockPaymentTopicProcessor() }
    )

    await bot.handleUpdate(paymentUpdate('Перевел за Себя, Диму и Алису.') as never)
    const proposalId = (
      (await promptRepository.getPendingAction('-10012345', '10002'))?.payload as {
        proposalId?: string
      } | null
    )?.proposalId
    calls.length = 0

    await bot.handleUpdate(paymentCallbackUpdate(`pt:mc:${proposalId ?? 'missing'}`) as never)

    expect(paymentConfirmationService.submitted.map((input) => input.memberId)).toEqual([
      'member-1',
      'member-3'
    ])
    expect(calls[0]).toMatchObject({
      method: 'answerCallbackQuery',
      payload: {
        text: expect.stringContaining('Dima')
      }
    })
  })

  test('reports partial multi-member confirmation failures and clears pending state', async () => {
    const bot = createTelegramBot('000000:test-token')
    const calls: Array<{ method: string; payload: unknown }> = []
    const promptRepository = createPromptRepository()
    const paymentConfirmationService = createPaymentConfirmationService((memberId) =>
      memberId === 'member-2'
        ? {
            status: 'needs_review',
            reason: 'cycle_not_found'
          }
        : {
            status: 'recorded',
            kind: 'rent',
            amount: Money.fromMajor('469.00', 'GEL')
          }
    )

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
        result:
          method === 'sendMessage'
            ? {
                message_id: calls.length,
                date: Math.floor(Date.now() / 1000),
                chat: {
                  id: -10012345,
                  type: 'supergroup'
                },
                text: 'ok'
              }
            : true
      } as never
    })

    registerConfiguredPaymentTopicIngestion(
      bot,
      createHouseholdRepository() as never,
      promptRepository,
      () => createMultiMemberRentFinanceService(),
      () => paymentConfirmationService,
      { topicProcessor: createMockPaymentTopicProcessor() }
    )

    await bot.handleUpdate(paymentUpdate('Перевел за Себя, Диму и Алису.') as never)
    const proposalId = (
      (await promptRepository.getPendingAction('-10012345', '10002'))?.payload as {
        proposalId?: string
      } | null
    )?.proposalId
    calls.length = 0

    await bot.handleUpdate(paymentCallbackUpdate(`pt:mc:${proposalId ?? 'missing'}`) as never)

    expect(calls[0]).toMatchObject({
      method: 'answerCallbackQuery',
      payload: {
        text: 'Записал оплату аренды для: Stas, Alisa. Не удалось записать: Dima.'
      }
    })
    expect(await promptRepository.getPendingAction('-10012345', '10002')).toBeNull()
  })

  test('shows a fully-paid message when a multi-member confirmation settles the period', async () => {
    const bot = createTelegramBot('000000:test-token')
    const calls: Array<{ method: string; payload: unknown }> = []
    const promptRepository = createPromptRepository()
    const paymentConfirmationService = createPaymentConfirmationService()
    const financeService = createMultiMemberRentFinanceService({
      settleAfterFirstDashboard: true
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

    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload })

      return {
        ok: true,
        result:
          method === 'sendMessage'
            ? {
                message_id: calls.length,
                date: Math.floor(Date.now() / 1000),
                chat: {
                  id: -10012345,
                  type: 'supergroup'
                },
                text: 'ok'
              }
            : true
      } as never
    })

    registerConfiguredPaymentTopicIngestion(
      bot,
      createHouseholdRepository() as never,
      promptRepository,
      () => financeService,
      () => paymentConfirmationService,
      { topicProcessor: createMockPaymentTopicProcessor() }
    )

    await bot.handleUpdate(paymentUpdate('Перевел за Себя, Диму и Алису.') as never)
    const proposalId = (
      (await promptRepository.getPendingAction('-10012345', '10002'))?.payload as {
        proposalId?: string
      } | null
    )?.proposalId
    calls.length = 0

    await bot.handleUpdate(paymentCallbackUpdate(`pt:mc:${proposalId ?? 'missing'}`) as never)

    expect(calls[0]).toMatchObject({
      method: 'answerCallbackQuery',
      payload: {
        text: 'Аренда за май 2026 г. полностью закрыта.'
      }
    })
  })

  test('falls back to a utilities proposal for receipt-style paid captions when utilities are the only payable kind', async () => {
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
        preferredUtilityPayerMemberId: null,
        utilitiesDueDay: 4,
        paymentBalanceAdjustmentPolicy: 'utilities',
        rentPaymentDestinations: null,
        totalDue: Money.fromMajor('40', 'GEL'),
        totalPaid: Money.zero('GEL'),
        totalRemaining: Money.fromMajor('40', 'GEL'),
        billingStage: 'utilities',
        rentSourceAmount: Money.zero('GEL'),
        rentDisplayAmount: Money.zero('GEL'),
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
            rentShare: Money.zero('GEL'),
            utilityShare: Money.fromMajor('40', 'GEL'),
            purchaseOffset: Money.zero('GEL'),
            netDue: Money.fromMajor('40', 'GEL'),
            paid: Money.zero('GEL'),
            remaining: Money.fromMajor('40', 'GEL'),
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
          kind: null,
          amountMinor: null,
          currency: null,
          payerDisplayName: null,
          confidence: 95,
          evidence: 'explicit_text',
          reason: 'receipt_caption'
        })
      }
    )

    await bot.handleUpdate(paymentUpdate('🖼 оплачено') as never)

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      method: 'sendMessage',
      payload: {
        text: expect.stringContaining('Я могу записать эту оплату коммуналки: 40.00 ₾.')
      }
    })
    expect(await promptRepository.getPendingAction('-10012345', '10002')).toMatchObject({
      action: 'payment_topic_confirmation'
    })
  })

  test('silences free-standing done and still handles a later clear payment assertion', async () => {
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

    const smartTopicProcessor: TopicProcessor = async (input) => {
      const text = input.messageText.toLowerCase()
      if (text === 'готово' || text === 'done') {
        return {
          route: 'payment',
          kind: 'rent',
          amountMinor: null,
          currency: null,
          payerDisplayName: null,
          confidence: 95,
          evidence: 'explicit_text',
          reason: 'test'
        }
      }
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

    expect(calls).toHaveLength(1)
    expect(calls[0]?.payload).toMatchObject({
      text: expect.stringContaining('Я могу записать эту оплату аренды: 473.00 ₾.')
    })
    expect(await promptRepository.getPendingAction('-10012345', '10002')).toMatchObject({
      action: 'payment_topic_confirmation'
    })
  })

  test('accepts done only when reply context anchors it to a payment prompt', async () => {
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
      () => createMultiMemberRentFinanceService(),
      () => createPaymentConfirmationService(),
      {
        topicProcessor: async () => ({
          route: 'payment',
          kind: null,
          amountMinor: null,
          currency: null,
          payerDisplayName: null,
          confidence: 95,
          evidence: 'reply_context',
          reason: 'reply_done'
        })
      }
    )

    await bot.handleUpdate(paymentReplyToBotUpdate('Готово') as never)

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      method: 'sendMessage',
      payload: {
        text: expect.stringContaining('Я могу записать эту оплату аренды: 469.00 ₾.')
      }
    })
  })

  test('rejects llm-provided reply evidence for free-standing done acknowledgements', async () => {
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
      () => createMultiMemberRentFinanceService(),
      () => createPaymentConfirmationService(),
      {
        topicProcessor: async () => ({
          route: 'payment',
          kind: null,
          amountMinor: null,
          currency: null,
          payerDisplayName: null,
          confidence: 95,
          evidence: 'reply_context',
          reason: 'bad_evidence'
        })
      }
    )

    await bot.handleUpdate(paymentUpdate('Готово') as never)

    expect(calls).toHaveLength(0)
    expect(await promptRepository.getPendingAction('-10012345', '10002')).toBeNull()
  })

  test('ignores llm amount when current message has unrelated numbers without explicit amount currency', async () => {
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
      () => createMultiMemberRentFinanceService(),
      () => createPaymentConfirmationService(),
      {
        topicProcessor: async () => ({
          route: 'payment',
          kind: 'rent',
          amountMinor: '12345',
          currency: 'GEL',
          payerDisplayName: null,
          confidence: 95,
          evidence: 'explicit_text',
          reason: 'hallucinated_amount'
        })
      }
    )

    await bot.handleUpdate(paymentUpdate('оплатил 1 мая') as never)

    expect(calls[0]).toMatchObject({
      method: 'sendMessage',
      payload: {
        text: expect.stringContaining('Я могу записать эту оплату аренды: 469.00 ₾.')
      }
    })
    expect(String((calls[0]?.payload as { text?: string } | undefined)?.text)).not.toContain(
      '123.45'
    )
  })

  test('accepts llm amount only when exact amount and currency are in the current message', async () => {
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
      () => createMultiMemberRentFinanceService(),
      () => createPaymentConfirmationService(),
      {
        topicProcessor: async () => ({
          route: 'payment',
          kind: 'rent',
          amountMinor: '12345',
          currency: 'GEL',
          payerDisplayName: null,
          confidence: 95,
          evidence: 'explicit_text',
          reason: 'explicit_amount'
        })
      }
    )

    await bot.handleUpdate(paymentUpdate('оплатил 123.45 GEL') as never)

    expect(calls[0]).toMatchObject({
      method: 'sendMessage',
      payload: {
        text: expect.stringContaining('Я могу записать эту оплату аренды: 123.45 ₾.')
      }
    })
  })

  test.each([
    ['оплатил 100 GEL', '100.00 ₾'],
    ['оплатил 100 lari', '100.00 ₾'],
    ['оплатил 100 ₾', '100.00 ₾']
  ])(
    'accepts whole-unit explicit amounts with currency in the current message: %s',
    async (text, expectedAmount) => {
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
        () => createMultiMemberRentFinanceService(),
        () => createPaymentConfirmationService(),
        {
          topicProcessor: async () => ({
            route: 'payment',
            kind: 'rent',
            amountMinor: '10000',
            currency: 'GEL',
            payerDisplayName: null,
            confidence: 95,
            evidence: 'explicit_text',
            reason: 'explicit_whole_amount'
          })
        }
      )

      await bot.handleUpdate(paymentUpdate(text) as never)

      expect(calls[0]).toMatchObject({
        method: 'sendMessage',
        payload: {
          text: expect.stringContaining(`Я могу записать эту оплату аренды: ${expectedAmount}.`)
        }
      })
    }
  )

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
      text: expect.stringContaining('Похоже, это оплата аренды от Ion: 473.00 ₾.')
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
      rawText: 'Ион оплатил аренду',
      parseText: 'Ion paid rent 473.00 GEL'
    })
    expect(calls.at(-2)).toMatchObject({
      method: 'answerCallbackQuery',
      payload: {
        text: 'Оплата аренды от Ion: 472.50 ₾'
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
        preferredUtilityPayerMemberId: null,
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

  test('lets an admin cancel another member single payment proposal by proposal id', async () => {
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
        rawText: 'закинул',
        senderTelegramUserId: '10002',
        reportedTelegramUserId: '10002',
        reportedDisplayName: null,
        isThirdParty: false,
        telegramChatId: '-10012345',
        telegramMessageId: '55',
        telegramThreadId: '888',
        telegramUpdateId: '1001',
        attachmentCount: 0,
        messageSentAt: null
      },
      expiresAt: null
    })

    const financeService = withAdminMember(createFinanceService())
    registerConfiguredPaymentTopicIngestion(
      bot,
      createHouseholdRepository() as never,
      promptRepository,
      () => financeService,
      () => createPaymentConfirmationService(),
      {}
    )

    await bot.handleUpdate(paymentCallbackUpdate('payment_topic:cancel:proposal-1', 90009) as never)

    expect(calls[0]).toMatchObject({
      method: 'answerCallbackQuery',
      payload: {
        callback_query_id: 'callback-1',
        text: 'Предложение оплаты отменено.'
      }
    })
    expect(await promptRepository.getPendingAction('-10012345', '10002')).toBeNull()
  })

  test('lets an admin dismiss a stale clarification prompt owned by another member', async () => {
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
      action: 'payment_topic_clarification',
      payload: {
        householdId: 'household-1',
        threadId: '888',
        rawText: 'готово'
      },
      expiresAt: null
    })

    const financeService = withAdminMember(createFinanceService())
    registerConfiguredPaymentTopicIngestion(
      bot,
      createHouseholdRepository() as never,
      promptRepository,
      () => financeService,
      () => createPaymentConfirmationService(),
      {}
    )

    await bot.handleUpdate(paymentCallbackUpdate('pt:cc:10002', 90009) as never)

    expect(calls[0]).toMatchObject({
      method: 'answerCallbackQuery',
      payload: {
        callback_query_id: 'callback-1',
        text: 'Предложение оплаты отменено.'
      }
    })
    expect(await promptRepository.getPendingAction('-10012345', '10002')).toBeNull()
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
        rawText: 'за жилье закинул',
        parseText: 'paid rent 473.00 GEL',
        sourceKey: null,
        telegramMessageId: '55',
        telegramThreadId: '888'
      }
    ])
    expect(calls[0]).toMatchObject({
      method: 'answerCallbackQuery',
      payload: {
        callback_query_id: 'callback-1',
        text: 'Оплата аренды сохранена: 472.50 ₾'
      }
    })
    expect(calls[1]).toMatchObject({
      method: 'editMessageText',
      payload: {
        chat_id: -10012345,
        message_id: 77,
        text: 'Оплата аренды сохранена: 472.50 ₾'
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

  test('ignores clarification replies for conversational payment chatter in the payments topic', async () => {
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
      { topicProcessor: createMockPaymentTopicProcessor('payment_clarification') }
    )

    await bot.handleUpdate(
      paymentUpdate('Учитывая что ты сам оплатил интернет, наверное это даже логичнее') as never
    )

    expect(calls).toHaveLength(0)
    expect(await promptRepository.getPendingAction('-10012345', '10002')).toBeNull()
  })

  test('stays silent for unaddressed purchase-like messages sent in the payments topic', async () => {
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

    expect(calls).toHaveLength(0)
    expect(paymentConfirmationService.submitted).toHaveLength(0)
  })

  test('uses the topic processor reply for addressed wrong-topic purchases', async () => {
    const bot = createTelegramBot('000000:test-token')
    const calls: Array<{ method: string; payload: unknown }> = []
    const promptRepository = createPromptRepository()
    const paymentConfirmationService = createPaymentConfirmationService()
    const replyText =
      'Похоже на общую покупку, но этот топик у меня про оплаты. Закиньте это в топик покупок, и я там всё красиво подтвержу.'

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
      {
        topicProcessor: async (input) => {
          expect(input.topicRole).toBe('payments')
          expect(input.isExplicitMention).toBe(true)
          expect(input.messageText).toBe('купила жигу большую и 2 ножика маленьких 10 лар')

          return {
            route: 'chat_reply',
            replyText,
            reason: 'llm_wrong_topic_purchase'
          }
        }
      }
    )

    await bot.handleUpdate(
      paymentUpdate('@household_test_bot купила жигу большую и 2 ножика маленьких 10 лар') as never
    )

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      method: 'sendMessage',
      payload: {
        text: replyText
      }
    })
  })

  test('stays silent for shopping requests with prices in the payments topic', async () => {
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
      { topicProcessor: createMockPaymentTopicProcessor('silent') }
    )

    await bot.handleUpdate(
      paymentUpdate(
        'можешь залететь в спар - там милка по скидке за 3 лари\nвозьми с миндалем, плиз'
      ) as never
    )

    expect(calls).toHaveLength(0)
    expect(paymentConfirmationService.submitted).toHaveLength(0)
  })

  test('hands explicit processor silence to deterministic fallback without sleep replies', async () => {
    const bot = createTelegramBot('000000:test-token')
    const calls: Array<{ method: string; payload: unknown }> = []
    const promptRepository = createPromptRepository()
    const paymentConfirmationService = createPaymentConfirmationService()
    let downstreamRoute: ReturnType<typeof getCachedTopicMessageRoute> | null = null

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
    bot.on('message', (ctx) => {
      downstreamRoute = getCachedTopicMessageRoute(ctx, 'payments')
    })

    await bot.handleUpdate(paymentUpdate('@household_test_bot Значит игнор') as never)

    expect(paymentConfirmationService.submitted).toHaveLength(0)
    expect(calls).toHaveLength(0)
    expect(downstreamRoute).toMatchObject({
      route: 'topic_helper',
      helperKind: 'assistant',
      reason: 'addressed_finance_topic'
    })
  })

  test('hands explicit mentions to deterministic fallback when the topic processor is absent', async () => {
    const bot = createTelegramBot('000000:test-token')
    const calls: Array<{ method: string; payload: unknown }> = []
    const promptRepository = createPromptRepository()
    let downstreamRoute: ReturnType<typeof getCachedTopicMessageRoute> | null = null

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
      () => createPaymentConfirmationService()
    )
    bot.on('message', (ctx) => {
      downstreamRoute = getCachedTopicMessageRoute(ctx, 'payments')
    })

    await bot.handleUpdate(paymentUpdate('@household_test_bot куда платить?') as never)

    expect(calls).toHaveLength(0)
    expect(await promptRepository.getPendingAction('-10012345', '10002')).toBeNull()
    expect(downstreamRoute).toMatchObject({
      route: 'topic_helper',
      helperKind: 'assistant',
      reason: 'addressed_finance_topic'
    })
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
