import { describe, expect, test } from 'bun:test'

import type {
  FinanceCommandService,
  HouseholdAuditNotificationService,
  PaymentConfirmationService,
  PaymentConfirmationSubmitResult
} from '@household/application'
import { instantFromIso, Money } from '@household/domain'
import type { TelegramPendingActionRecord, TelegramPendingActionRepository } from '@household/ports'
import { createTelegramBot } from './bot'
import {
  buildPaymentAcknowledgement,
  publishAgentPaymentProposal,
  registerPaymentTopicCallbacks,
  resolveConfiguredPaymentTopicRecord,
  type PaymentTopicCandidate
} from './payment-topic-ingestion'
import { createAgentPaymentProposal } from './payment-proposals'

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
    getPayment: async () => null,
    getPurchase: async () => null,
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
    kind?: 'rent' | 'utilities'
  } = {}
): FinanceCommandService {
  const activeKind = options.kind ?? 'rent'
  const shareMajor = activeKind === 'rent' ? '469.00' : '40.00'
  const shareMinor = activeKind === 'rent' ? 46900n : 4000n
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
          netDue: Money.fromMajor(shareMajor, 'GEL'),
          paid: memberSettled ? Money.fromMajor(shareMajor, 'GEL') : Money.zero('GEL'),
          remaining: memberSettled ? Money.zero('GEL') : Money.fromMajor(shareMajor, 'GEL'),
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
            kinds: (['rent', 'utilities'] as const).map((kind) =>
              kind === activeKind
                ? {
                    kind,
                    totalDue: Money.fromMinor(3n * shareMinor, 'GEL'),
                    totalPaid: Money.fromMinor(
                      BigInt(3 - unresolvedMembers.length) * shareMinor,
                      'GEL'
                    ),
                    totalRemaining: Money.fromMinor(
                      BigInt(unresolvedMembers.length) * shareMinor,
                      'GEL'
                    ),
                    unresolvedMembers: unresolvedMembers.map((member) => ({
                      memberId: member.memberId,
                      displayName: member.displayName,
                      suggestedAmount: Money.fromMajor(shareMajor, 'GEL'),
                      baseDue: Money.fromMajor(shareMajor, 'GEL'),
                      paid: Money.zero('GEL'),
                      remaining: Money.fromMajor(shareMajor, 'GEL'),
                      effectivelySettled: false
                    }))
                  }
                : {
                    kind,
                    totalDue: Money.zero('GEL'),
                    totalPaid: Money.zero('GEL'),
                    totalRemaining: Money.zero('GEL'),
                    unresolvedMembers: []
                  }
            )
          }
        ],
        ledger: []
      }
    }
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

function createAgentTestBot(
  calls: Array<{ method: string; payload: unknown }>,
  options: { throwOnAnswerCallback?: boolean } = {}
) {
  const bot = createTelegramBot('000000:test-token')

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
    if (options.throwOnAnswerCallback && method === 'answerCallbackQuery') {
      throw new Error('Bad Request: query is too old and response timeout expired')
    }

    return {
      ok: true,
      result: {
        message_id: calls.length + 100,
        date: Math.floor(Date.now() / 1000),
        chat: {
          id: -10012345,
          type: 'supergroup'
        },
        text: 'ok'
      }
    } as never
  })

  return bot
}

function agentPaymentRecord(rawText: string, senderTelegramUserId = '10002') {
  return {
    ...candidate({ rawText, senderTelegramUserId }),
    householdId: 'household-1'
  }
}

describe('createAgentPaymentProposal', () => {
  test('builds a multi-member proposal with per-member billed amounts', async () => {
    const financeService = createMultiMemberRentFinanceService()
    const proposal = await createAgentPaymentProposal({
      householdId: 'household-1',
      payerMemberId: 'member-1',
      additionalMemberIds: ['member-2'],
      kind: 'rent',
      explicitAmount: null,
      perMemberAmount: null,
      financeService,
      householdConfigurationRepository: createHouseholdRepository() as unknown as Parameters<
        typeof createAgentPaymentProposal
      >[0]['householdConfigurationRepository']
    })

    expect(proposal.status).toBe('multi_member_proposal')
    if (proposal.status !== 'multi_member_proposal') {
      return
    }
    expect(proposal.proposal.members).toHaveLength(2)
    expect(proposal.proposal.members.every((member) => member.amountMinor === '46900')).toBe(true)
    expect(proposal.proposal.members.every((member) => member.selected)).toBe(true)
  })

  test('returns already_settled when the payer has nothing to pay', async () => {
    const financeService = createMultiMemberRentFinanceService({
      paidMemberIds: ['member-1']
    })
    const proposal = await createAgentPaymentProposal({
      householdId: 'household-1',
      payerMemberId: 'member-1',
      additionalMemberIds: [],
      kind: 'rent',
      explicitAmount: null,
      perMemberAmount: null,
      financeService,
      householdConfigurationRepository: createHouseholdRepository() as unknown as Parameters<
        typeof createAgentPaymentProposal
      >[0]['householdConfigurationRepository']
    })

    expect(proposal.status).toBe('already_settled')
  })

  test('rejects unknown member ids', async () => {
    const financeService = createMultiMemberRentFinanceService()
    const proposal = await createAgentPaymentProposal({
      householdId: 'household-1',
      payerMemberId: 'member-1',
      additionalMemberIds: ['member-x'],
      kind: 'rent',
      explicitAmount: null,
      perMemberAmount: null,
      financeService,
      householdConfigurationRepository: createHouseholdRepository() as unknown as Parameters<
        typeof createAgentPaymentProposal
      >[0]['householdConfigurationRepository']
    })

    expect(proposal).toEqual({ status: 'no_action', reason: 'unknown_member_id' })
  })
})

describe('publishAgentPaymentProposal', () => {
  test('posts a multi-member card and multi-confirm records every selected member', async () => {
    const calls: Array<{ method: string; payload: unknown }> = []
    const bot = createAgentTestBot(calls)
    const promptRepository = createPromptRepository()
    const financeService = createMultiMemberRentFinanceService()
    const paymentService = createPaymentConfirmationService()
    const householdRepository = createHouseholdRepository() as never

    const proposal = await createAgentPaymentProposal({
      householdId: 'household-1',
      payerMemberId: 'member-1',
      additionalMemberIds: ['member-2'],
      kind: 'rent',
      explicitAmount: null,
      perMemberAmount: null,
      financeService,
      householdConfigurationRepository: householdRepository
    })
    expect(proposal.status).toBe('multi_member_proposal')

    bot.on('message', async (ctx) => {
      await publishAgentPaymentProposal({
        ctx,
        locale: 'ru',
        record: agentPaymentRecord('Закинул за себя и за Диму'),
        proposal,
        payerTelegramUserId: '10002',
        payerDisplayName: 'Stas',
        isThirdParty: false,
        promptRepository
      })
    })
    registerPaymentTopicCallbacks(
      bot,
      householdRepository,
      promptRepository,
      () => financeService,
      () => paymentService
    )

    await bot.handleUpdate(paymentUpdate('Закинул за себя и за Диму') as never)

    const proposalMessage = calls.find((call) => call.method === 'sendMessage')
    expect(proposalMessage).toBeDefined()
    const markup = (
      proposalMessage!.payload as {
        reply_markup: { inline_keyboard: Array<Array<{ callback_data: string }>> }
      }
    ).reply_markup
    const callbackData = markup.inline_keyboard.flat().map((button) => button.callback_data)
    const proposalId =
      proposal.status === 'multi_member_proposal' ? proposal.proposal.proposalId : ''
    expect(callbackData).toContain(`pt:mc:${proposalId}`)

    await bot.handleUpdate(paymentCallbackUpdate(`pt:mc:${proposalId}`, 10002) as never)

    expect(paymentService.submitted.map((entry) => entry.memberId).sort()).toEqual([
      'member-1',
      'member-2'
    ])
    expect(
      paymentService.submitted.every((entry) => entry.parseText === 'paid rent 469.00 GEL')
    ).toBe(true)
  })

  test('multi-confirm marks planned utilities paid for recorded members', async () => {
    const calls: Array<{ method: string; payload: unknown }> = []
    const bot = createAgentTestBot(calls)
    const promptRepository = createPromptRepository()
    const resolvedMemberIds: string[] = []
    const financeService: FinanceCommandService = {
      ...createMultiMemberRentFinanceService({
        kind: 'utilities',
        settleAfterFirstDashboard: true
      }),
      resolveUtilityBillAsPlanned: async (input) => {
        resolvedMemberIds.push(input.memberId ?? '')
        return {
          period: '2026-05',
          resolvedBillIds: ['bill-1'],
          resolvedAssignments: [],
          settledJustNow: resolvedMemberIds.length === 2,
          plan: null
        }
      }
    }
    const paymentService = createPaymentConfirmationService(() => ({
      status: 'recorded',
      kind: 'utilities',
      amount: Money.fromMajor('40.00', 'GEL')
    }))
    const householdRepository = createHouseholdRepository() as never
    const auditNotificationService = {
      recordEvent: async (input: unknown) => {
        calls.push({ method: 'auditNotification', payload: input })
        return {} as never
      }
    } as HouseholdAuditNotificationService

    const proposal = await createAgentPaymentProposal({
      householdId: 'household-1',
      payerMemberId: 'member-1',
      additionalMemberIds: ['member-2'],
      kind: 'utilities',
      explicitAmount: null,
      perMemberAmount: null,
      financeService,
      householdConfigurationRepository: householdRepository
    })
    expect(proposal.status).toBe('multi_member_proposal')
    const proposalId =
      proposal.status === 'multi_member_proposal' ? proposal.proposal.proposalId : ''

    bot.on('message', async (ctx) => {
      await publishAgentPaymentProposal({
        ctx,
        locale: 'ru',
        record: agentPaymentRecord('Оплатил коммуналку за себя и за Диму'),
        proposal,
        payerTelegramUserId: '10002',
        payerDisplayName: 'Stas',
        isThirdParty: false,
        promptRepository
      })
    })
    registerPaymentTopicCallbacks(
      bot,
      householdRepository,
      promptRepository,
      () => financeService,
      () => paymentService,
      { auditNotificationService }
    )

    await bot.handleUpdate(paymentUpdate('Оплатил коммуналку за себя и за Диму') as never)
    await bot.handleUpdate(paymentCallbackUpdate(`pt:mc:${proposalId}`, 10002) as never)

    expect(paymentService.submitted.map((entry) => entry.memberId).sort()).toEqual([
      'member-1',
      'member-2'
    ])
    expect(resolvedMemberIds.sort()).toEqual(['member-1', 'member-2'])
    expect(calls.findIndex((call) => call.method === 'auditNotification')).toBeLessThan(
      calls.findLastIndex((call) => call.method === 'sendMessage')
    )
  })

  test('multi-confirm still records and edits when the callback answer is stale', async () => {
    const calls: Array<{ method: string; payload: unknown }> = []
    const bot = createAgentTestBot(calls, { throwOnAnswerCallback: true })
    const promptRepository = createPromptRepository()
    const financeService = createMultiMemberRentFinanceService({
      kind: 'utilities',
      settleAfterFirstDashboard: true
    })
    const paymentService = createPaymentConfirmationService(() => ({
      status: 'recorded',
      kind: 'utilities',
      amount: Money.fromMajor('40.00', 'GEL')
    }))
    const householdRepository = createHouseholdRepository() as never

    const proposal = await createAgentPaymentProposal({
      householdId: 'household-1',
      payerMemberId: 'member-1',
      additionalMemberIds: ['member-2'],
      kind: 'utilities',
      explicitAmount: null,
      perMemberAmount: null,
      financeService,
      householdConfigurationRepository: householdRepository
    })
    expect(proposal.status).toBe('multi_member_proposal')
    const proposalId =
      proposal.status === 'multi_member_proposal' ? proposal.proposal.proposalId : ''

    bot.on('message', async (ctx) => {
      await publishAgentPaymentProposal({
        ctx,
        locale: 'ru',
        record: agentPaymentRecord('Оплатил коммуналку за себя и за Диму'),
        proposal,
        payerTelegramUserId: '10002',
        payerDisplayName: 'Stas',
        isThirdParty: false,
        promptRepository
      })
    })
    registerPaymentTopicCallbacks(
      bot,
      householdRepository,
      promptRepository,
      () => financeService,
      () => paymentService
    )

    await bot.handleUpdate(paymentUpdate('Оплатил коммуналку за себя и за Диму') as never)
    await bot.handleUpdate(paymentCallbackUpdate(`pt:mc:${proposalId}`, 10002) as never)

    expect(paymentService.submitted.map((entry) => entry.memberId).sort()).toEqual([
      'member-1',
      'member-2'
    ])
    expect(calls.some((call) => call.method === 'answerCallbackQuery')).toBe(true)
    const edit = calls.findLast((call) => call.method === 'editMessageText')
    expect((edit?.payload as { text?: string } | undefined)?.text).toBe(
      'Записал оплату коммуналки для: Stas, Dima.'
    )
    const closure = calls.findLast((call) => call.method === 'sendMessage')
    expect((closure?.payload as { text?: string } | undefined)?.text).toBe(
      'Коммуналка за май 2026 г. полностью закрыта.'
    )
  })

  test('posts a third-person card that the reported payer can confirm', async () => {
    const calls: Array<{ method: string; payload: unknown }> = []
    const bot = createAgentTestBot(calls)
    const promptRepository = createPromptRepository()
    const financeService = createMultiMemberRentFinanceService()
    const paymentService = createPaymentConfirmationService()
    const householdRepository = createHouseholdRepository() as never

    const proposal = await createAgentPaymentProposal({
      householdId: 'household-1',
      payerMemberId: 'member-2',
      additionalMemberIds: [],
      kind: 'rent',
      explicitAmount: null,
      perMemberAmount: null,
      financeService,
      householdConfigurationRepository: householdRepository
    })
    expect(proposal.status).toBe('proposal')
    const proposalId = proposal.status === 'proposal' ? proposal.payload.proposalId : ''

    bot.on('message', async (ctx) => {
      await publishAgentPaymentProposal({
        ctx,
        locale: 'ru',
        record: agentPaymentRecord('Дима оплатил аренду'),
        proposal,
        payerTelegramUserId: '20002',
        payerDisplayName: 'Dima',
        isThirdParty: true,
        promptRepository
      })
    })
    registerPaymentTopicCallbacks(
      bot,
      householdRepository,
      promptRepository,
      () => financeService,
      () => paymentService
    )

    await bot.handleUpdate(paymentUpdate('Дима оплатил аренду') as never)

    const proposalMessage = calls.find((call) => call.method === 'sendMessage')
    expect(proposalMessage).toBeDefined()
    expect((proposalMessage!.payload as { text: string }).text).toContain('Dima')

    await bot.handleUpdate(
      paymentCallbackUpdate(`payment_topic:confirm:${proposalId}`, 20002) as never
    )

    expect(paymentService.submitted).toHaveLength(1)
    expect(paymentService.submitted[0]?.memberId).toBe('member-2')
  })

  test('replies with the fixed already-settled string instead of a card', async () => {
    const calls: Array<{ method: string; payload: unknown }> = []
    const bot = createAgentTestBot(calls)
    const promptRepository = createPromptRepository()

    bot.on('message', async (ctx) => {
      const result = await publishAgentPaymentProposal({
        ctx,
        locale: 'ru',
        record: agentPaymentRecord('оплатил аренду'),
        proposal: { status: 'already_settled', kind: 'rent' },
        payerTelegramUserId: '10002',
        payerDisplayName: 'Stas',
        isThirdParty: false,
        promptRepository
      })
      expect(result.status).toBe('already_settled')
    })

    await bot.handleUpdate(paymentUpdate('оплатил аренду') as never)

    const reply = calls.find((call) => call.method === 'sendMessage')
    expect((reply!.payload as { text: string }).text).toBe('Аренда уже закрыта.')
  })
})
