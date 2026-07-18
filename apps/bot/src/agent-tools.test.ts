import { describe, expect, test } from 'bun:test'

import { instantFromIso, Money } from '@household/domain'
import type { Context } from 'grammy'

import type { FinanceCommandService } from '@household/application'
import type {
  HouseholdConfigurationRepository,
  TelegramPendingActionRecord,
  TelegramPendingActionRepository
} from '@household/ports'

import {
  executeAgentTool,
  agentToolDefinitions,
  explicitAmountFromMessage,
  paymentKindDueDate,
  splitMoneyByWeights,
  type AgentMessageRecord,
  type AgentToolContext
} from './agent-tools'
import { canResolveAgentAction, type AgentActionPayload } from './agent-confirmations'

describe('explicitAmountFromMessage', () => {
  test('accepts an amount with currency written in the message', () => {
    const amount = explicitAmountFromMessage({
      rawText: 'оплатил коммуналку 100 лари',
      amountMajor: '100',
      currency: 'GEL'
    })

    expect(amount?.amountMinor).toBe(10000n)
  })

  test('accepts a bare number from the message', () => {
    const amount = explicitAmountFromMessage({
      rawText: 'Закинул 465 за аренду',
      amountMajor: '465',
      currency: 'GEL'
    })

    expect(amount?.amountMinor).toBe(46500n)
  })

  test('accepts comma decimal variants', () => {
    const amount = explicitAmountFromMessage({
      rawText: 'перевёл 18,48',
      amountMajor: '18.48',
      currency: 'GEL'
    })

    expect(amount?.amountMinor).toBe(1848n)
  })

  test('rejects amounts that are not present in the message', () => {
    expect(
      explicitAmountFromMessage({
        rawText: 'Так, сегодня надо бы дооплатить',
        amountMajor: '18.48',
        currency: 'GEL'
      })
    ).toBeNull()
  })

  test('rejects partial digit matches', () => {
    expect(
      explicitAmountFromMessage({
        rawText: 'взял 1465 бонусов',
        amountMajor: '465',
        currency: 'GEL'
      })
    ).toBeNull()
  })

  test('rejects non-positive and malformed amounts', () => {
    expect(
      explicitAmountFromMessage({ rawText: '0', amountMajor: '0', currency: 'GEL' })
    ).toBeNull()
    expect(
      explicitAmountFromMessage({ rawText: 'сто', amountMajor: 'сто', currency: 'GEL' })
    ).toBeNull()
  })
})

describe('paymentKindDueDate', () => {
  const settings = { rentDueDay: 20, utilitiesDueDay: 5 }

  test('builds per-kind due dates inside the period', () => {
    expect(paymentKindDueDate('2026-07', 'rent', settings)).toBe('2026-07-20')
    expect(paymentKindDueDate('2026-06', 'utilities', settings)).toBe('2026-06-05')
  })

  test('clamps the due day to the month length', () => {
    expect(paymentKindDueDate('2026-02', 'rent', { rentDueDay: 31, utilitiesDueDay: 5 })).toBe(
      '2026-02-28'
    )
  })

  test('rejects malformed periods', () => {
    expect(paymentKindDueDate('июнь', 'rent', settings)).toBeNull()
  })
})

describe('splitMoneyByWeights', () => {
  test('splits evenly and deterministically distributes the remainder', () => {
    const shares = splitMoneyByWeights(Money.fromMajor('700', 'USD'), [
      { memberId: 'a', weight: 1 },
      { memberId: 'b', weight: 1 },
      { memberId: 'c', weight: 1 },
      { memberId: 'd', weight: 1 }
    ])

    expect(shares.get('a')?.toMajorString()).toBe('175.00')
    expect(shares.get('d')?.toMajorString()).toBe('175.00')
  })

  test('gives leftover minor units to the first members', () => {
    const shares = splitMoneyByWeights(Money.fromMinor(100n, 'GEL'), [
      { memberId: 'a', weight: 1 },
      { memberId: 'b', weight: 1 },
      { memberId: 'c', weight: 1 }
    ])

    const total = [...shares.values()].reduce((sum, amount) => sum + amount.amountMinor, 0n)
    expect(total).toBe(100n)
    expect(shares.get('a')?.amountMinor).toBe(34n)
    expect(shares.get('b')?.amountMinor).toBe(33n)
  })

  test('respects uneven weights and skips zero-weight members', () => {
    const shares = splitMoneyByWeights(Money.fromMajor('300', 'GEL'), [
      { memberId: 'a', weight: 2 },
      { memberId: 'b', weight: 1 },
      { memberId: 'c', weight: 0 }
    ])

    expect(shares.get('a')?.toMajorString()).toBe('200.00')
    expect(shares.get('b')?.toMajorString()).toBe('100.00')
    expect(shares.has('c')).toBe(false)
  })
})

function createAllMembersPaymentFinanceService(): FinanceCommandService {
  const members = [
    {
      id: 'dima',
      telegramUserId: '10001',
      displayName: 'Дима',
      rentShareWeight: 1,
      isAdmin: false
    },
    {
      id: 'alisa',
      telegramUserId: '10002',
      displayName: 'Алиса',
      rentShareWeight: 1,
      isAdmin: false
    },
    {
      id: 'ion',
      telegramUserId: '10003',
      displayName: 'Ион',
      rentShareWeight: 1,
      isAdmin: false
    },
    {
      id: 'stas',
      telegramUserId: '10004',
      displayName: 'Стас',
      rentShareWeight: 1,
      isAdmin: true
    }
  ]
  const unresolvedMemberIds = new Set(['alisa', 'ion', 'stas'])

  return {
    listMembers: async () => members,
    generateDashboard: async () => ({
      period: '2026-07',
      currency: 'GEL',
      timezone: 'Asia/Tbilisi',
      rentWarningDay: 17,
      rentDueDay: 20,
      utilitiesReminderDay: 3,
      utilitiesDueDay: 5,
      paymentBalanceAdjustmentPolicy: 'utilities',
      rentPaymentDestinations: null,
      totalDue: Money.fromMajor('160.00', 'GEL'),
      totalPaid: Money.fromMajor('40.00', 'GEL'),
      totalRemaining: Money.fromMajor('120.00', 'GEL'),
      billingStage: 'utilities',
      rentSourceAmount: Money.fromMajor('700.00', 'USD'),
      rentDisplayAmount: Money.fromMajor('1890.00', 'GEL'),
      rentFxRateMicros: null,
      rentFxEffectiveDate: null,
      utilityBillingPlan: null,
      rentBillingState: {
        dueDate: '2026-07-20',
        memberSummaries: [],
        paymentDestinations: null
      },
      members: members.map((member) => {
        const unpaid = unresolvedMemberIds.has(member.id)
        return {
          memberId: member.id,
          displayName: member.displayName,
          rentShare: Money.zero('GEL'),
          utilityShare: Money.fromMajor('40.00', 'GEL'),
          purchaseOffset: Money.zero('GEL'),
          netDue: Money.fromMajor('40.00', 'GEL'),
          paid: unpaid ? Money.zero('GEL') : Money.fromMajor('40.00', 'GEL'),
          remaining: unpaid ? Money.fromMajor('40.00', 'GEL') : Money.zero('GEL'),
          overduePayments: [],
          explanations: []
        }
      }),
      paymentPeriods: [
        {
          period: '2026-07',
          utilityTotal: Money.fromMajor('160.00', 'GEL'),
          hasOverdueBalance: false,
          isCurrentPeriod: true,
          kinds: [
            {
              kind: 'utilities',
              totalDue: Money.fromMajor('160.00', 'GEL'),
              totalPaid: Money.fromMajor('40.00', 'GEL'),
              totalRemaining: Money.fromMajor('120.00', 'GEL'),
              unresolvedMembers: members
                .filter((member) => unresolvedMemberIds.has(member.id))
                .map((member) => ({
                  memberId: member.id,
                  displayName: member.displayName,
                  suggestedAmount: Money.fromMajor('40.00', 'GEL'),
                  baseDue: Money.fromMajor('40.00', 'GEL'),
                  paid: Money.zero('GEL'),
                  remaining: Money.fromMajor('40.00', 'GEL'),
                  effectivelySettled: false
                }))
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
  } as unknown as FinanceCommandService
}

function createAllMembersPaymentToolContext(input: {
  rawText: string
  replies: Array<{ text: string; payload: unknown }>
  pending: TelegramPendingActionRecord[]
}): AgentToolContext {
  const record: AgentMessageRecord = {
    updateId: 1,
    chatId: '-10012345',
    messageId: '55',
    threadId: '888',
    senderTelegramUserId: '10004',
    senderDisplayName: 'Стас',
    rawText: input.rawText,
    attachmentCount: 0,
    messageSentAt: instantFromIso('2026-07-06T19:00:00.000Z')
  }
  const ctx = {
    msg: { message_id: 55 },
    me: { id: 999000 },
    reply: async (text: string, payload: unknown) => {
      input.replies.push({ text, payload })
      return {
        message_id: 101,
        date: 1783364400,
        chat: { id: -10012345, type: 'supergroup' },
        text
      }
    }
  } as unknown as Context
  const promptRepository: TelegramPendingActionRepository = {
    async upsertPendingAction(pendingAction) {
      input.pending.push(pendingAction)
      return pendingAction
    },
    async getPendingAction() {
      return null
    },
    async clearPendingAction() {},
    async clearPendingActionsForChat() {}
  }
  const householdConfigurationRepository = {
    getHouseholdBillingSettings: async () => ({
      householdId: 'household-1',
      settlementCurrency: 'GEL' as const,
      rentAmountMinor: 70000n,
      rentCurrency: 'USD' as const,
      rentDueDay: 20,
      rentWarningDay: 17,
      utilitiesDueDay: 5,
      utilitiesReminderDay: 3,
      preferredUtilityPayerMemberId: null,
      timezone: 'Asia/Tbilisi',
      paymentBalanceAdjustmentPolicy: 'utilities' as const,
      rentPaymentDestinations: null
    })
  } as unknown as HouseholdConfigurationRepository

  return {
    householdId: 'household-1',
    locale: 'ru',
    topicRole: 'payments',
    senderMember: {
      id: 'stas',
      telegramUserId: '10004',
      displayName: 'Стас',
      rentShareWeight: 1,
      isAdmin: true
    },
    record,
    ctx,
    financeService: createAllMembersPaymentFinanceService(),
    householdConfigurationRepository,
    promptRepository,
    commandCatalog: null,
    postCard: async () => {}
  }
}

describe('executeAgentTool propose_payment', () => {
  test('expands "за всех" to every other member even when the model omits covered_member_ids', async () => {
    const replies: Array<{ text: string; payload: unknown }> = []
    const pending: TelegramPendingActionRecord[] = []
    const context = createAllMembersPaymentToolContext({
      rawText: 'Дима оплатил комуналку за всех',
      replies,
      pending
    })

    const result = await executeAgentTool(context, {
      name: 'propose_payment',
      arguments: {
        kind: 'utilities',
        payer_member_id: 'dima'
      }
    })

    expect((result.result as { status?: string }).status).toBe('card_posted')
    expect(replies[0]?.text).toContain('Дима — уже оплачено')
    expect(replies[0]?.text).toContain('✅ Алиса — не оплачено')
    expect(replies[0]?.text).toContain('✅ Ион — не оплачено')
    expect(replies[0]?.text).toContain('✅ Стас — не оплачено')
    const payload = pending[0]?.payload as
      | {
          members?: Array<{ memberId: string; paymentStatus: string; selected: boolean }>
        }
      | undefined
    expect(payload?.members?.map((member) => member.memberId).sort()).toEqual([
      'alisa',
      'dima',
      'ion',
      'stas'
    ])
  })
})

describe('admin rent agent tool', () => {
  test('is only exposed to admins', () => {
    const adminTools = agentToolDefinitions({
      purchaseToolsAvailable: false,
      adminToolsAvailable: true
    })
    const memberTools = agentToolDefinitions({
      purchaseToolsAvailable: false,
      adminToolsAvailable: false
    })

    expect(adminTools.some((tool) => tool.name === 'propose_period_rent')).toBe(true)
    expect(memberTools.some((tool) => tool.name === 'propose_period_rent')).toBe(false)
  })

  test('creates one confirmation-gated action for multiple periods', async () => {
    const pending: TelegramPendingActionRecord[] = []
    const context = createAllMembersPaymentToolContext({
      rawText: 'Поставь аренду 800 долларов за июль и август',
      replies: [],
      pending
    })
    const cards: string[] = []
    context.postCard = async (text) => {
      cards.push(text)
    }

    const result = await executeAgentTool(context, {
      name: 'propose_period_rent',
      arguments: {
        amount_major: '800',
        currency: 'USD',
        periods: ['2026-07', '2026-08']
      }
    })

    expect(result.cardPosted).toBe(true)
    expect((result.result as { nothingChangedYet?: boolean }).nothingChangedYet).toBe(true)
    expect(cards[0]).toContain('$800.00')
    expect(pending[0]?.action).toBe('agent_action')
    expect(pending[0]?.payload).toMatchObject({
      actionType: 'set_period_rent',
      params: {
        amountMajor: '800.00',
        currency: 'USD',
        periods: ['2026-07', '2026-08']
      }
    })
  })

  test('rejects direct invocation for a non-admin', async () => {
    const context = createAllMembersPaymentToolContext({ rawText: '', replies: [], pending: [] })
    context.senderMember = { ...context.senderMember, isAdmin: false }

    const result = await executeAgentTool(context, {
      name: 'propose_period_rent',
      arguments: { amount_major: '800', currency: 'USD', periods: ['2026-07'] }
    })

    expect(result.result).toEqual({ error: 'admin_required' })
  })

  test('requires the confirming actor to still be an admin', () => {
    const payload: AgentActionPayload = {
      actionId: 'action-1',
      actionType: 'set_period_rent',
      householdId: 'household-1',
      requesterTelegramUserId: '10004',
      locale: 'en',
      summaryText: 'set rent',
      params: {}
    }

    expect(
      canResolveAgentAction({
        payload,
        actorTelegramUserId: '10004',
        actorIsAdmin: false
      })
    ).toBe(false)
    expect(
      canResolveAgentAction({
        payload,
        actorTelegramUserId: '10005',
        actorIsAdmin: true
      })
    ).toBe(true)
  })
})
