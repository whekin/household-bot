import { describe, expect, test } from 'bun:test'

import type { FinanceCommandService } from '@household/application'
import { Money } from '@household/domain'
import type { HouseholdConfigurationRepository } from '@household/ports'

import { formatPaymentProposalText, createAgentPaymentProposal } from './payment-proposals'

const settings = {
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
}

const householdConfigurationRepository = {
  getHouseholdBillingSettings: async () => settings
} as unknown as HouseholdConfigurationRepository

function financeServiceWithUtilityPlan(): FinanceCommandService {
  return {
    generateDashboard: async () => ({
      period: '2026-06',
      currency: 'GEL',
      timezone: 'Asia/Tbilisi',
      rentWarningDay: 17,
      rentDueDay: 20,
      utilitiesReminderDay: 3,
      utilitiesDueDay: 5,
      paymentBalanceAdjustmentPolicy: 'utilities',
      rentPaymentDestinations: null,
      totalDue: Money.fromMajor('600.00', 'GEL'),
      totalPaid: Money.zero('GEL'),
      totalRemaining: Money.fromMajor('600.00', 'GEL'),
      billingStage: 'utilities',
      rentSourceAmount: Money.fromMajor('700.00', 'USD'),
      rentDisplayAmount: Money.fromMajor('1900.00', 'GEL'),
      rentFxRateMicros: null,
      rentFxEffectiveDate: null,
      utilityBillingPlan: null,
      rentBillingState: {
        dueDate: '2026-06-20',
        memberSummaries: [],
        paymentDestinations: null
      },
      members: [
        {
          memberId: 'dima',
          displayName: 'Дима',
          rentShare: Money.fromMajor('469.00', 'GEL'),
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
                  memberId: 'dima',
                  displayName: 'Дима',
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
    }),
    listMembers: async () => [
      {
        id: 'dima',
        telegramUserId: '10001',
        displayName: 'Dima',
        rentShareWeight: 1,
        isAdmin: false
      }
    ]
  } as unknown as FinanceCommandService
}

function financeServiceWithUsdRent(): FinanceCommandService {
  return {
    generateDashboard: async () => ({
      period: '2026-06',
      currency: 'GEL',
      timezone: 'Asia/Tbilisi',
      rentWarningDay: 17,
      rentDueDay: 20,
      utilitiesReminderDay: 3,
      utilitiesDueDay: 5,
      paymentBalanceAdjustmentPolicy: 'utilities',
      rentPaymentDestinations: null,
      totalDue: Money.fromMajor('1890.00', 'GEL'),
      totalPaid: Money.zero('GEL'),
      totalRemaining: Money.fromMajor('1890.00', 'GEL'),
      billingStage: 'rent',
      rentSourceAmount: Money.fromMajor('700.00', 'USD'),
      rentDisplayAmount: Money.fromMajor('1890.00', 'GEL'),
      rentFxRateMicros: 2_700_000n,
      rentFxEffectiveDate: '2026-06-01',
      utilityBillingPlan: null,
      rentBillingState: {
        dueDate: '2026-06-20',
        memberSummaries: [],
        paymentDestinations: null
      },
      members: [
        {
          memberId: 'dima',
          displayName: 'Дима',
          rentShare: Money.fromMajor('472.50', 'GEL'),
          utilityShare: Money.zero('GEL'),
          purchaseOffset: Money.zero('GEL'),
          netDue: Money.fromMajor('472.50', 'GEL'),
          paid: Money.zero('GEL'),
          remaining: Money.fromMajor('472.50', 'GEL'),
          overduePayments: [],
          explanations: []
        }
      ],
      paymentPeriods: [
        {
          period: '2026-06',
          utilityTotal: Money.zero('GEL'),
          hasOverdueBalance: false,
          isCurrentPeriod: true,
          kinds: [
            {
              kind: 'rent',
              totalDue: Money.fromMajor('1890.00', 'GEL'),
              totalPaid: Money.zero('GEL'),
              totalRemaining: Money.fromMajor('1890.00', 'GEL'),
              unresolvedMembers: [
                {
                  memberId: 'dima',
                  displayName: 'Дима',
                  suggestedAmount: Money.fromMajor('472.50', 'GEL'),
                  baseDue: Money.fromMajor('472.50', 'GEL'),
                  paid: Money.zero('GEL'),
                  remaining: Money.fromMajor('472.50', 'GEL'),
                  effectivelySettled: false
                }
              ]
            }
          ]
        }
      ],
      ledger: []
    }),
    listMembers: async () => [
      {
        id: 'dima',
        telegramUserId: '10001',
        displayName: 'Dima',
        rentShareWeight: 1,
        isAdmin: false
      }
    ]
  } as unknown as FinanceCommandService
}

describe('payment proposals', () => {
  test('uses the active utility payment-period amount instead of recomputing from purchase offset', async () => {
    const result = await createAgentPaymentProposal({
      householdId: 'household-1',
      payerMemberId: 'dima',
      additionalMemberIds: [],
      kind: 'utilities',
      explicitAmount: null,
      perMemberAmount: null,
      financeService: financeServiceWithUtilityPlan(),
      householdConfigurationRepository
    })

    expect(result.status).toBe('proposal')
    if (result.status !== 'proposal') return

    expect(result.payload.amountMinor).toBe('6644')
    expect(result.breakdown.guidance.source).toBe('payment_period')

    const text = formatPaymentProposalText({
      locale: 'ru',
      surface: 'topic',
      proposal: result
    })
    expect(text).toContain('66.44 ₾')
    expect(text).not.toContain('Сумма по плану коммуналки')
    expect(text).not.toContain('Баланс по общим покупкам')
  })

  test('converts a USD rent amount with the cycle FX rate', async () => {
    const result = await createAgentPaymentProposal({
      householdId: 'household-1',
      payerMemberId: 'dima',
      additionalMemberIds: [],
      kind: 'rent',
      explicitAmount: Money.fromMajor('175', 'USD'),
      perMemberAmount: null,
      financeService: financeServiceWithUsdRent(),
      householdConfigurationRepository
    })

    expect(result.status).toBe('proposal')
    if (result.status !== 'proposal') return

    expect(result.payload.currency).toBe('GEL')
    expect(result.payload.amountMinor).toBe('47250')
  })

  test('rejects foreign-currency amounts when no rent FX rate applies', async () => {
    const result = await createAgentPaymentProposal({
      householdId: 'household-1',
      payerMemberId: 'dima',
      additionalMemberIds: [],
      kind: 'utilities',
      explicitAmount: Money.fromMajor('20', 'USD'),
      perMemberAmount: null,
      financeService: financeServiceWithUtilityPlan(),
      householdConfigurationRepository
    })

    expect(result).toEqual({ status: 'unsupported_currency' })
  })
})
