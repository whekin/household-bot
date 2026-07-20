import { describe, expect, test } from 'bun:test'

import type { FinanceCommandService, FinanceDashboard } from '@household/application'
import { Money, nowInstant } from '@household/domain'
import type { TelegramPaymentCardRecord, TelegramPaymentCardRepository } from '@household/ports'

import { createLivePaymentCardService } from './live-payment-cards'

function paidRentDashboard(): FinanceDashboard {
  const amount = Money.fromMajor('527.00', 'GEL')
  const zero = Money.zero('GEL')

  return {
    period: '2026-07',
    currency: 'GEL',
    timezone: 'Asia/Tbilisi',
    rentWarningDay: 17,
    rentDueDay: 20,
    utilitiesReminderDay: 3,
    utilitiesDueDay: 5,
    paymentBalanceAdjustmentPolicy: 'utilities',
    rentPaymentDestinations: [
      {
        label: 'Аренда дома',
        recipientName: 'Magda C.',
        bankName: 'BOG',
        account: 'GE98',
        note: null,
        link: null
      }
    ],
    totalDue: amount,
    totalPaid: amount,
    totalRemaining: zero,
    billingStage: 'idle',
    rentSourceAmount: amount,
    rentDisplayAmount: amount,
    rentFxRateMicros: null,
    rentFxEffectiveDate: null,
    utilityBillingPlan: null,
    rentBillingState: {
      dueDate: '2026-07-20',
      paymentDestinations: null,
      memberSummaries: [
        {
          memberId: 'member-1',
          displayName: 'Ион',
          due: amount,
          paid: amount,
          remaining: zero
        }
      ]
    },
    members: [],
    paymentPeriods: [
      {
        period: '2026-07',
        utilityTotal: zero,
        hasOverdueBalance: false,
        isCurrentPeriod: true,
        kinds: [
          {
            kind: 'rent',
            totalDue: amount,
            totalPaid: amount,
            totalRemaining: zero,
            unresolvedMembers: []
          }
        ]
      }
    ],
    ledger: []
  }
}

describe('live payment cards', () => {
  test('re-renders every persisted card after payment state changes', async () => {
    const cards: TelegramPaymentCardRecord[] = []
    const repository: TelegramPaymentCardRepository = {
      async upsertPaymentCard(input) {
        const existing = cards.find(
          (card) =>
            card.telegramChatId === input.telegramChatId &&
            card.telegramMessageId === input.telegramMessageId
        )
        if (existing) {
          Object.assign(existing, input)
          return
        }
        cards.push({
          ...input,
          createdAt: nowInstant()
        })
      },
      async listPaymentCards() {
        return cards
      },
      async deletePaymentCard() {}
    }
    const edits: Array<{ messageId: string; text: string; replyMarkup?: unknown }> = []
    const service = createLivePaymentCardService({
      repository,
      financeServiceForHousehold: () =>
        ({
          generateDashboard: async () => paidRentDashboard()
        }) as FinanceCommandService,
      editMessage: async (input) => {
        edits.push(input)
      }
    })

    await service.register({
      householdId: 'household-1',
      kind: 'rent',
      period: '2026-07',
      surface: 'bill',
      locale: 'ru',
      telegramChatId: '-1001',
      telegramThreadId: '10',
      telegramMessageId: '101'
    })
    await service.register({
      householdId: 'household-1',
      kind: 'rent',
      period: '2026-07',
      surface: 'reminder',
      locale: 'ru',
      telegramChatId: '-1001',
      telegramThreadId: '10',
      telegramMessageId: '102'
    })

    await service.refresh({
      householdId: 'household-1',
      kind: 'rent',
      period: '2026-07'
    })

    expect(edits.map((edit) => edit.messageId)).toEqual(['101', '102'])
    expect(edits.every((edit) => edit.text.includes('полностью оплачена'))).toBe(true)
    expect(edits.every((edit) => JSON.stringify(edit.replyMarkup).includes('GE98'))).toBe(true)
  })
})
