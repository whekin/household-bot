import { describe, expect, test } from 'bun:test'

import type { FinanceCommandService, FinanceDashboard } from '@household/application'
import { Money } from '@household/domain'
import type { ProcessedBotMessageRepository } from '@household/ports'
import type { InlineKeyboardMarkup } from 'grammy/types'

import { createPaymentInstructionPublisher } from './payment-instruction-publisher'

function dashboard(): FinanceDashboard {
  const gel = (minor: bigint) => Money.fromMinor(minor, 'GEL')

  return {
    period: '2026-06',
    currency: 'GEL',
    timezone: 'Asia/Tbilisi',
    rentWarningDay: 1,
    rentDueDay: 5,
    utilitiesReminderDay: 1,
    utilitiesDueDay: 5,
    paymentBalanceAdjustmentPolicy: 'utilities',
    rentPaymentDestinations: [
      {
        label: 'Main rent',
        recipientName: 'Landlord',
        bankName: 'Bank',
        account: 'GE00RENT',
        note: 'June rent',
        link: null
      }
    ],
    totalDue: gel(30000n),
    totalPaid: gel(0n),
    totalRemaining: gel(30000n),
    billingStage: 'utilities',
    rentSourceAmount: gel(400000n),
    rentDisplayAmount: gel(400000n),
    rentFxRateMicros: null,
    rentFxEffectiveDate: null,
    utilityBillingPlan: {
      id: 'plan-1',
      version: 2,
      status: 'active',
      dueDate: '2026-06-05',
      updatedFromVersion: null,
      reason: null,
      categories: [
        {
          utilityBillId: 'internet',
          billName: 'Internet',
          billTotal: gel(3500n),
          assignedAmount: gel(2812n),
          assignedMemberId: 'stas',
          assignedDisplayName: 'Stas',
          paidAmount: gel(0n),
          isFullAssignment: false,
          splitGroupId: null
        },
        {
          utilityBillId: 'gas',
          billName: 'Gas (Water)',
          billTotal: gel(16566n),
          assignedAmount: gel(9306n),
          assignedMemberId: 'ion',
          assignedDisplayName: 'Ion',
          paidAmount: gel(0n),
          isFullAssignment: false,
          splitGroupId: 'gas'
        }
      ],
      memberSummaries: [
        {
          memberId: 'stas',
          displayName: 'Stas',
          fairShare: gel(6305n),
          vendorPaid: gel(0n),
          assignedThisCycle: gel(2812n),
          projectedDeltaAfterPlan: gel(0n)
        },
        {
          memberId: 'ion',
          displayName: 'Ion',
          fairShare: gel(6306n),
          vendorPaid: gel(0n),
          assignedThisCycle: gel(9306n),
          projectedDeltaAfterPlan: gel(0n)
        }
      ]
    },
    rentBillingState: {
      dueDate: '2026-06-05',
      paymentDestinations: [
        {
          label: 'Main rent',
          recipientName: 'Landlord',
          bankName: 'Bank',
          account: 'GE00RENT',
          note: 'June rent',
          link: null
        }
      ],
      memberSummaries: [
        {
          memberId: 'stas',
          displayName: 'Stas',
          due: gel(100000n),
          paid: gel(0n),
          remaining: gel(100000n)
        },
        {
          memberId: 'ion',
          displayName: 'Ion',
          due: gel(100000n),
          paid: gel(100000n),
          remaining: gel(0n)
        }
      ]
    },
    members: [
      {
        memberId: 'stas',
        displayName: 'Stas',
        status: 'active',
        rentShare: gel(100000n),
        utilityShare: gel(6305n),
        purchaseOffset: gel(0n),
        netDue: gel(106305n),
        paid: gel(0n),
        remaining: gel(106305n),
        overduePayments: [],
        explanations: []
      },
      {
        memberId: 'ion',
        displayName: 'Ion',
        status: 'active',
        rentShare: gel(100000n),
        utilityShare: gel(6306n),
        purchaseOffset: gel(0n),
        netDue: gel(106306n),
        paid: gel(100000n),
        remaining: gel(6306n),
        overduePayments: [],
        explanations: []
      }
    ],
    paymentPeriods: [
      {
        period: '2026-06',
        utilityTotal: gel(30000n),
        hasOverdueBalance: false,
        isCurrentPeriod: true,
        kinds: [
          {
            kind: 'utilities',
            totalDue: gel(30000n),
            totalPaid: gel(0n),
            totalRemaining: gel(30000n),
            unresolvedMembers: [
              {
                memberId: 'stas',
                displayName: 'Stas',
                suggestedAmount: gel(2812n),
                baseDue: gel(2812n),
                paid: gel(0n),
                remaining: gel(2812n),
                effectivelySettled: false
              },
              {
                memberId: 'ion',
                displayName: 'Ion',
                suggestedAmount: gel(9306n),
                baseDue: gel(9306n),
                paid: gel(0n),
                remaining: gel(9306n),
                effectivelySettled: false
              }
            ]
          },
          {
            kind: 'rent',
            totalDue: gel(200000n),
            totalPaid: gel(100000n),
            totalRemaining: gel(100000n),
            unresolvedMembers: [
              {
                memberId: 'stas',
                displayName: 'Stas',
                suggestedAmount: gel(100000n),
                baseDue: gel(100000n),
                paid: gel(0n),
                remaining: gel(100000n),
                effectivelySettled: false
              }
            ]
          }
        ]
      }
    ],
    ledger: []
  }
}

function createProcessedRepository(): ProcessedBotMessageRepository & { claimedKeys: string[] } {
  const claimed = new Set<string>()
  const claimedKeys: string[] = []
  return {
    claimedKeys,
    async claimMessage(input) {
      const key = `${input.source}:${input.sourceMessageKey}`
      if (claimed.has(key)) {
        return { claimed: false }
      }
      claimed.add(key)
      claimedKeys.push(key)
      return { claimed: true }
    },
    async releaseMessage(input) {
      claimed.delete(`${input.source}:${input.sourceMessageKey}`)
    }
  }
}

function createPublisher() {
  const sent: Array<{
    threadId: string | null
    text: string
    replyMarkup?: InlineKeyboardMarkup
  }> = []
  const processed = createProcessedRepository()
  const publisher = createPaymentInstructionPublisher({
    householdConfigurationRepository: {
      async getHouseholdChatByHouseholdId() {
        return {
          householdId: 'household-1',
          householdName: 'Kojori',
          telegramChatId: '-100123',
          telegramChatType: 'supergroup',
          title: 'Kojori',
          defaultLocale: 'en' as const
        }
      },
      async getHouseholdTopicBinding(_householdId, role) {
        if (role !== 'payments') {
          return null
        }
        return {
          householdId: 'household-1',
          role: 'payments' as const,
          telegramThreadId: '777',
          topicName: 'Payments'
        }
      }
    },
    financeServiceForHousehold: () =>
      ({
        generateDashboard: async () => dashboard()
      }) as unknown as FinanceCommandService,
    processedBotMessageRepository: processed,
    sendTopicMessage: async (input) => {
      sent.push({
        threadId: input.threadId,
        text: input.text,
        ...(input.replyMarkup ? { replyMarkup: input.replyMarkup } : {})
      })
    }
  })

  return { publisher, sent, processed }
}

describe('createPaymentInstructionPublisher', () => {
  test('sends utility payment instructions with all assigned categories and no entry buttons', async () => {
    const { publisher, sent, processed } = createPublisher()

    const result = await publisher.sendPaymentInstruction({
      householdId: 'household-1',
      kind: 'utilities',
      period: '2026-06'
    })

    expect(result.status).toBe('sent')
    expect(sent).toHaveLength(1)
    expect(sent[0]?.threadId).toBe('777')
    expect(sent[0]?.text).toContain('Internet')
    expect(sent[0]?.text).toContain('Gas (Water)')
    expect(sent[0]?.text).toContain('Stas')
    expect(sent[0]?.text).toContain('Ion')
    expect(JSON.stringify(sent[0]?.replyMarkup)).not.toContain('reminder_util:guided')
    expect(JSON.stringify(sent[0]?.replyMarkup)).not.toContain('reminder_util:template')
    expect(processed.claimedKeys).toEqual(['payment-instruction:utilities:2026-06:plan-1:v2'])
  })

  test('deduplicates repeated sends for the same instruction source key', async () => {
    const { publisher, sent } = createPublisher()

    await publisher.sendPaymentInstruction({
      householdId: 'household-1',
      kind: 'utilities',
      period: '2026-06'
    })
    const duplicate = await publisher.sendPaymentInstruction({
      householdId: 'household-1',
      kind: 'utilities',
      period: '2026-06'
    })

    expect(duplicate.status).toBe('skipped_duplicate')
    expect(sent).toHaveLength(1)
  })

  test('sends rent instructions with credentials and GEL amount per member', async () => {
    const { publisher, sent } = createPublisher()

    const result = await publisher.sendPaymentInstruction({
      householdId: 'household-1',
      kind: 'rent',
      period: '2026-06'
    })

    expect(result.status).toBe('sent')
    expect(sent[0]?.text).toContain('GE00RENT')
    expect(sent[0]?.text).toContain('Stas')
    expect(sent[0]?.text).toContain('1000.00 ₾')
    expect(sent[0]?.text).toContain('Ion')
  })
})
