import { describe, expect, test } from 'bun:test'

import type {
  FinanceClosePaymentPeriodResult,
  FinanceCommandService,
  FinanceDashboard,
  HouseholdAuditNotificationService
} from '@household/application'
import { Money } from '@household/domain'

import { createTelegramBot } from './bot'
import { registerPaymentReminderActions } from './payment-reminder-actions'

function rentReminderCallbackUpdate(data: string, threadId = 555) {
  return {
    update_id: 3001,
    callback_query: {
      id: `callback-${data}-${threadId}`,
      from: {
        id: 10002,
        is_bot: false,
        first_name: 'Mia'
      },
      chat_instance: 'instance-1',
      data,
      message: {
        message_id: 77,
        date: Math.floor(Date.now() / 1000),
        message_thread_id: threadId,
        is_topic_message: true,
        chat: {
          id: -10012345,
          type: 'supergroup'
        },
        text: 'Rent reminder'
      }
    }
  }
}

function paymentDashboard(remainingMinor = 46900n): FinanceDashboard {
  const gel = (minor: bigint) => Money.fromMinor(minor, 'GEL')

  return {
    period: '2026-05',
    currency: 'GEL',
    timezone: 'Asia/Tbilisi',
    rentWarningDay: 10,
    rentDueDay: 15,
    utilitiesReminderDay: 20,
    utilitiesDueDay: 25,
    paymentBalanceAdjustmentPolicy: 'utilities',
    rentPaymentDestinations: [
      {
        label: 'Rent',
        recipientName: 'Landlord',
        bankName: 'Bank',
        account: 'GE00',
        note: null,
        link: null
      }
    ],
    totalDue: gel(46900n),
    totalPaid: gel(46900n - remainingMinor),
    totalRemaining: gel(remainingMinor),
    billingStage: 'rent',
    rentSourceAmount: gel(46900n),
    rentDisplayAmount: gel(46900n),
    rentFxRateMicros: null,
    rentFxEffectiveDate: null,
    rentBillingState: {
      dueDate: '2026-05-15',
      paymentDestinations: null,
      memberSummaries: [
        {
          memberId: 'member-1',
          displayName: 'Mia',
          due: gel(46900n),
          paid: gel(46900n - remainingMinor),
          remaining: gel(remainingMinor)
        }
      ]
    },
    utilityBillingPlan: null,
    members: [
      {
        memberId: 'member-1',
        displayName: 'Mia',
        status: 'active',
        rentShare: gel(46900n),
        utilityShare: gel(0n),
        purchaseOffset: gel(0n),
        netDue: gel(46900n),
        paid: gel(46900n - remainingMinor),
        remaining: gel(remainingMinor),
        overduePayments: [],
        explanations: []
      }
    ],
    paymentPeriods: [
      {
        period: '2026-05',
        utilityTotal: gel(0n),
        hasOverdueBalance: false,
        isCurrentPeriod: true,
        kinds: [
          {
            kind: 'rent',
            totalDue: gel(46900n),
            totalPaid: gel(46900n - remainingMinor),
            totalRemaining: gel(remainingMinor),
            unresolvedMembers:
              remainingMinor > 0n
                ? [
                    {
                      memberId: 'member-1',
                      displayName: 'Mia',
                      suggestedAmount: gel(remainingMinor),
                      baseDue: gel(remainingMinor),
                      paid: gel(46900n - remainingMinor),
                      remaining: gel(remainingMinor),
                      effectivelySettled: false
                    }
                  ]
                : []
          },
          {
            kind: 'utilities',
            totalDue: gel(0n),
            totalPaid: gel(0n),
            totalRemaining: gel(0n),
            unresolvedMembers: []
          }
        ]
      }
    ],
    ledger: []
  }
}

function utilityPaymentDashboard(): FinanceDashboard {
  const base = paymentDashboard()
  const gel = (minor: bigint) => Money.fromMinor(minor, 'GEL')

  return {
    ...base,
    billingStage: 'utilities',
    totalDue: gel(12000n),
    totalPaid: gel(0n),
    totalRemaining: gel(12000n),
    utilityBillingPlan: {
      id: 'plan-1',
      version: 1,
      status: 'active',
      dueDate: '2026-05-25',
      updatedFromVersion: null,
      reason: null,
      categories: [
        {
          utilityBillId: 'gas',
          billName: 'Gas',
          billTotal: gel(12000n),
          assignedAmount: gel(12000n),
          assignedMemberId: 'member-1',
          assignedDisplayName: 'Mia',
          paidAmount: gel(0n),
          isFullAssignment: true,
          splitGroupId: null
        }
      ],
      memberSummaries: [
        {
          memberId: 'member-1',
          displayName: 'Mia',
          fairShare: gel(12000n),
          vendorPaid: gel(0n),
          assignedThisCycle: gel(12000n),
          projectedDeltaAfterPlan: gel(0n)
        }
      ]
    },
    paymentPeriods: [
      {
        period: '2026-05',
        utilityTotal: gel(12000n),
        hasOverdueBalance: false,
        isCurrentPeriod: true,
        kinds: [
          {
            kind: 'rent',
            totalDue: gel(0n),
            totalPaid: gel(0n),
            totalRemaining: gel(0n),
            unresolvedMembers: []
          },
          {
            kind: 'utilities',
            totalDue: gel(12000n),
            totalPaid: gel(0n),
            totalRemaining: gel(12000n),
            unresolvedMembers: [
              {
                memberId: 'member-1',
                displayName: 'Mia',
                suggestedAmount: gel(12000n),
                baseDue: gel(12000n),
                paid: gel(0n),
                remaining: gel(12000n),
                effectivelySettled: false
              }
            ]
          }
        ]
      }
    ]
  }
}

function createHouseholdRepository(
  options: { reminderThreadId?: string; paymentsThreadId?: string } = {}
) {
  const reminderThreadId = options.reminderThreadId ?? '555'
  const paymentsThreadId = options.paymentsThreadId ?? '777'
  const chat = {
    householdId: 'household-1',
    householdName: 'Kojori House',
    telegramChatId: '-10012345',
    telegramChatType: 'supergroup',
    title: 'Kojori House',
    defaultLocale: 'en' as const
  }

  return {
    getTelegramHouseholdChat: async () => chat,
    getHouseholdChatByHouseholdId: async () => chat,
    getHouseholdTopicBinding: async (_householdId: string, role: string) => ({
      householdId: 'household-1',
      role: role === 'payments' ? ('payments' as const) : ('reminders' as const),
      telegramThreadId: role === 'payments' ? paymentsThreadId : reminderThreadId,
      topicName: role === 'payments' ? 'Payments' : 'Reminders'
    }),
    findHouseholdTopicByTelegramContext: async (input: { telegramThreadId: string }) =>
      input.telegramThreadId === reminderThreadId
        ? {
            householdId: 'household-1',
            role: 'reminders' as const,
            telegramThreadId: reminderThreadId,
            topicName: 'Reminders'
          }
        : input.telegramThreadId === paymentsThreadId
          ? {
              householdId: 'household-1',
              role: 'payments' as const,
              telegramThreadId: paymentsThreadId,
              topicName: 'Payments'
            }
          : null,
    getHouseholdMember: async () => null,
    listHouseholdMembersByTelegramUserId: async () => []
  }
}

function createFinanceService(): FinanceCommandService & {
  closeInputs: Parameters<FinanceCommandService['closePaymentPeriod']>[0][]
  duplicateMode: boolean
} {
  const service = {
    closeInputs: [] as Parameters<FinanceCommandService['closePaymentPeriod']>[0][],
    duplicateMode: false,
    getMemberByTelegramUserId: async () => ({
      id: 'member-1',
      telegramUserId: '10002',
      displayName: 'Mia',
      rentShareWeight: 1,
      isAdmin: false
    }),
    generateDashboard: async () => paymentDashboard(),
    closePaymentPeriod: async (
      input: Parameters<FinanceCommandService['closePaymentPeriod']>[0]
    ) => {
      service.closeInputs.push(input)
      const alreadyPaid = service.duplicateMode || service.closeInputs.length > 1
      return {
        period: '2026-05',
        kind: input.kind,
        closedMembers: alreadyPaid
          ? []
          : [
              {
                memberId: 'member-1',
                displayName: 'Mia',
                amount: Money.fromMinor(46900n, 'GEL')
              }
            ],
        skippedMembers: alreadyPaid
          ? [
              {
                memberId: 'member-1',
                displayName: 'Mia',
                reason: 'already_settled' as const
              }
            ]
          : [],
        dashboard: paymentDashboard(0n)
      } satisfies FinanceClosePaymentPeriodResult
    }
  }

  return service as unknown as FinanceCommandService & {
    closeInputs: Parameters<FinanceCommandService['closePaymentPeriod']>[0][]
    duplicateMode: boolean
  }
}

function setupBot(
  options: {
    reminderThreadId?: string
    paymentsThreadId?: string
    dashboard?: FinanceDashboard
  } = {}
) {
  const bot = createTelegramBot('000000:test-token')
  const calls: Array<{ method: string; payload: unknown }> = []
  const financeService = createFinanceService()
  if (options.dashboard) {
    financeService.generateDashboard = async () => options.dashboard!
  }
  const auditEvents: unknown[] = []
  const auditNotificationService = {
    recordEvent: async (input: Parameters<HouseholdAuditNotificationService['recordEvent']>[0]) => {
      auditEvents.push(input)
      return {} as never
    }
  } as unknown as HouseholdAuditNotificationService

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

  registerPaymentReminderActions({
    bot,
    householdConfigurationRepository: createHouseholdRepository(options),
    financeServiceForHousehold: () => financeService,
    auditNotificationService
  })

  return {
    bot,
    calls,
    financeService,
    auditEvents
  }
}

describe('registerPaymentReminderActions', () => {
  test('records the clicking member as paid and refreshes the reminder', async () => {
    const { bot, calls, financeService, auditEvents } = setupBot()

    await bot.handleUpdate(rentReminderCallbackUpdate('pr:p:rent:2026-05') as never)

    expect(financeService.closeInputs).toEqual([
      {
        kind: 'rent',
        memberIds: ['member-1'],
        actorMemberId: 'member-1',
        periodArg: '2026-05'
      }
    ])
    expect(calls[0]).toMatchObject({
      method: 'answerCallbackQuery',
      payload: {
        text: 'Payment marked as paid.'
      }
    })
    expect(calls.some((call) => call.method === 'editMessageText')).toBe(true)
    expect(auditEvents).toHaveLength(1)
  })

  test('accepts payment buttons from the payments topic', async () => {
    const { bot, calls, financeService } = setupBot()

    await bot.handleUpdate(rentReminderCallbackUpdate('pr:p:rent:2026-05', 777) as never)

    expect(financeService.closeInputs).toEqual([
      {
        kind: 'rent',
        memberIds: ['member-1'],
        actorMemberId: 'member-1',
        periodArg: '2026-05'
      }
    ])
    expect(calls[0]).toMatchObject({
      method: 'answerCallbackQuery',
      payload: {
        text: 'Payment marked as paid.'
      }
    })
  })

  test('keeps utility entry buttons hidden when payment-topic instructions refresh', async () => {
    const { bot, calls } = setupBot({ dashboard: utilityPaymentDashboard() })

    await bot.handleUpdate(
      rentReminderCallbackUpdate('pr:d:utilities:2026-05:details', 777) as never
    )

    const editCall = calls.find((call) => call.method === 'editMessageText')
    expect(JSON.stringify(editCall?.payload)).toContain('pr:p:utilities:2026-05')
    expect(JSON.stringify(editCall?.payload)).not.toContain('reminder_util:guided')
    expect(JSON.stringify(editCall?.payload)).not.toContain('reminder_util:template')
  })

  test('treats duplicate paid clicks as already paid without a duplicate audit event', async () => {
    const { bot, calls, auditEvents } = setupBot()

    await bot.handleUpdate(rentReminderCallbackUpdate('pr:p:rent:2026-05') as never)
    calls.length = 0
    auditEvents.length = 0

    await bot.handleUpdate(rentReminderCallbackUpdate('pr:p:rent:2026-05') as never)

    expect(calls[0]).toMatchObject({
      method: 'answerCallbackQuery',
      payload: {
        text: 'Already marked as paid.'
      }
    })
    expect(auditEvents).toEqual([])
  })

  test('rejects payment buttons outside configured reminder and payments topics', async () => {
    const { bot, calls, financeService } = setupBot()

    await bot.handleUpdate(rentReminderCallbackUpdate('pr:p:rent:2026-05', 999) as never)

    expect(financeService.closeInputs).toEqual([])
    expect(calls).toEqual([
      {
        method: 'answerCallbackQuery',
        payload: {
          callback_query_id: 'callback-pr:p:rent:2026-05-999',
          text: 'Reminder unavailable.',
          show_alert: true
        }
      }
    ])
  })
})
