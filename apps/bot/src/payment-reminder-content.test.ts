import { describe, expect, test } from 'bun:test'

import type { FinanceDashboard } from '@household/application'
import { Money } from '@household/domain'

import { buildBillingReminderPromptContent } from './billing-reminder-prompt-content'
import { buildPaymentInstructionContent } from './payment-instruction-content'
import {
  buildScheduledPaymentReminderContent,
  formatBillingMonth
} from './payment-reminder-content'

function dashboard(): FinanceDashboard {
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
        label: 'Main <rent>',
        recipientName: 'Landlord & Co',
        bankName: 'Bank',
        account: 'GE00<123>',
        note: 'Use May rent',
        link: null
      }
    ],
    totalDue: gel(70000n),
    totalPaid: gel(35000n),
    totalRemaining: gel(35000n),
    billingStage: 'rent',
    rentSourceAmount: gel(70000n),
    rentDisplayAmount: gel(70000n),
    rentFxRateMicros: null,
    rentFxEffectiveDate: null,
    rentBillingState: {
      dueDate: '2026-05-15',
      paymentDestinations: null,
      memberSummaries: [
        {
          memberId: 'alice',
          displayName: 'Alice <A>',
          due: gel(35000n),
          paid: gel(0n),
          remaining: gel(35000n)
        },
        {
          memberId: 'bob',
          displayName: 'Bob',
          due: gel(35000n),
          paid: gel(35000n),
          remaining: gel(0n)
        }
      ]
    },
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
          billName: 'Gas <main>',
          billTotal: gel(12000n),
          assignedAmount: gel(12000n),
          assignedMemberId: 'alice',
          assignedDisplayName: 'Alice <A>',
          paidAmount: gel(0n),
          isFullAssignment: true,
          splitGroupId: null
        }
      ],
      memberSummaries: [
        {
          memberId: 'alice',
          displayName: 'Alice <A>',
          fairShare: gel(12000n),
          vendorPaid: gel(0n),
          assignedThisCycle: gel(12000n),
          projectedDeltaAfterPlan: gel(0n)
        }
      ]
    },
    members: [
      {
        memberId: 'alice',
        displayName: 'Alice <A>',
        status: 'active',
        rentShare: gel(35000n),
        utilityShare: gel(12000n),
        purchaseOffset: gel(0n),
        netDue: gel(47000n),
        paid: gel(0n),
        remaining: gel(47000n),
        overduePayments: [],
        explanations: []
      },
      {
        memberId: 'bob',
        displayName: 'Bob',
        status: 'active',
        rentShare: gel(35000n),
        utilityShare: gel(0n),
        purchaseOffset: gel(0n),
        netDue: gel(35000n),
        paid: gel(35000n),
        remaining: gel(0n),
        overduePayments: [],
        explanations: []
      }
    ],
    paymentPeriods: [
      {
        period: '2026-05',
        utilityTotal: gel(12000n),
        hasOverdueBalance: false,
        isCurrentPeriod: true,
        kinds: [
          {
            kind: 'rent',
            totalDue: gel(70000n),
            totalPaid: gel(35000n),
            totalRemaining: gel(35000n),
            unresolvedMembers: [
              {
                memberId: 'alice',
                displayName: 'Alice <A>',
                suggestedAmount: gel(35000n),
                baseDue: gel(35000n),
                paid: gel(0n),
                remaining: gel(35000n),
                effectivelySettled: false
              }
            ]
          },
          {
            kind: 'utilities',
            totalDue: gel(12000n),
            totalPaid: gel(0n),
            totalRemaining: gel(12000n),
            unresolvedMembers: [
              {
                memberId: 'alice',
                displayName: 'Alice <A>',
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
    ],
    ledger: []
  }
}

describe('payment reminder content', () => {
  test('formats month names instead of raw periods', () => {
    expect(formatBillingMonth('en', '2026-05')).toBe('May 2026')
    expect(formatBillingMonth('ru', '2026-05')).toContain('2026')
  })

  test('renders rent details with escaped member names and requisites', () => {
    const content = buildBillingReminderPromptContent({
      locale: 'en',
      kind: 'rent',
      dispatchKind: 'rent_due',
      period: '2026-05',
      dashboard: dashboard(),
      viewMode: 'details'
    })

    expect(content.parseMode).toBe('HTML')
    expect(content.text).toContain('May 2026')
    expect(content.text).toContain('May 15')
    expect(content.text).toContain('Alice &lt;A&gt;')
    expect(content.text).toContain('GE00&lt;123&gt;')
    expect(content.text).toContain('Amount due')
    expect(content.text).not.toContain('<b>Status</b>')
    expect(JSON.stringify(content.replyMarkup)).toContain('"copy_text":{"text":"GE00<123>"}')
    expect(content.text).not.toContain('2026-05-15')
    expect(content.text).not.toContain('2026-05 · due')
  })

  test('renders paid-state fallback text in Russian', () => {
    const content = buildBillingReminderPromptContent({
      locale: 'ru',
      kind: 'utilities',
      dispatchKind: 'utilities',
      period: '2026-05',
      dashboard: {
        ...dashboard(),
        utilityBillingPlan: null,
        paymentPeriods: [
          {
            period: '2026-05',
            utilityTotal: Money.fromMinor(0n, 'GEL'),
            hasOverdueBalance: false,
            isCurrentPeriod: true,
            kinds: [
              {
                kind: 'utilities',
                totalDue: Money.fromMinor(100n, 'GEL'),
                totalPaid: Money.fromMinor(0n, 'GEL'),
                totalRemaining: Money.fromMinor(100n, 'GEL'),
                unresolvedMembers: []
              }
            ]
          }
        ]
      },
      viewMode: 'details'
    })

    expect(content.text).toContain('План коммуналки пока не готов.')
    expect(content.text).not.toContain('No utility plan is ready yet.')
  })

  test('renders utility provider assignments and action buttons', () => {
    const content = buildBillingReminderPromptContent({
      locale: 'en',
      kind: 'utilities',
      dispatchKind: 'utilities',
      period: '2026-05',
      dashboard: dashboard(),
      viewMode: 'compact'
    })

    expect(content.text).toContain('Who pays what')
    // Grouped by member: the assignee heading, then their bill nested beneath.
    expect(content.text).toContain('Alice &lt;A&gt;')
    expect(content.text).toContain('Gas &lt;main&gt;')
    expect(content.text).not.toContain('Gas &lt;main&gt; → ')
    expect(JSON.stringify(content.replyMarkup)).toContain('pr:p:utilities:2026-05')
    expect(JSON.stringify(content.replyMarkup)).toContain('I paid my bills')
  })

  test('does not tick a split bill as paid for the member who did not pay it', () => {
    const baseDashboard = dashboard()
    const gel = (major: string) => Money.fromMajor(major, 'GEL')
    const content = buildScheduledPaymentReminderContent({
      locale: 'ru',
      kind: 'utilities',
      dispatchKind: 'utilities',
      period: '2026-05',
      dashboard: {
        ...baseDashboard,
        utilityBillingPlan: {
          ...baseDashboard.utilityBillingPlan!,
          // One bill split two ways. Bob covered his part; Alice has not paid.
          categories: [
            {
              utilityBillId: 'gas',
              billName: 'Gas',
              billTotal: gel('120.00'),
              assignedAmount: gel('20.00'),
              assignedMemberId: 'alice',
              assignedDisplayName: 'Alice <A>',
              paidAmount: gel('100.00'),
              isFullAssignment: false,
              splitGroupId: 'gas'
            },
            {
              utilityBillId: 'gas',
              billName: 'Gas',
              billTotal: gel('120.00'),
              assignedAmount: gel('100.00'),
              assignedMemberId: 'bob',
              assignedDisplayName: 'Bob',
              paidAmount: gel('100.00'),
              isFullAssignment: false,
              splitGroupId: 'gas'
            }
          ],
          vendorPayments: [
            {
              id: 'fact-1',
              utilityBillId: 'gas',
              billName: 'Gas',
              payerMemberId: 'bob',
              payerDisplayName: 'Bob',
              amount: gel('100.00'),
              matchedPlan: true,
              recordedAt: baseDashboard.utilityBillingPlan!.categories[0]!.billTotal
                ? new Date().toISOString()
                : new Date().toISOString()
            }
          ]
        }
      },
      viewMode: 'compact'
    } as never)

    // Bob's line is ticked, Alice's is not — the bill total says 100.00 is paid,
    // but none of it came from her.
    expect(content.text).toContain('✅ Gas · 100.00 ₾')
    expect(content.text).toContain('• Gas · 20.00 ₾')
  })

  test('flags a shared-purchase balance once nothing is left to pay on the plan', () => {
    const baseDashboard = dashboard()
    const utilitiesPeriod = baseDashboard.paymentPeriods!.find(
      (summary) => summary.period === '2026-05'
    )!
    const content = buildScheduledPaymentReminderContent({
      locale: 'ru',
      kind: 'utilities',
      dispatchKind: 'utilities',
      period: '2026-05',
      dashboard: {
        ...baseDashboard,
        // Alice covered every bill routed to her, but shared purchases left her
        // owing the household 34.78 that no bill could carry.
        members: baseDashboard.members.map((member) =>
          member.memberId === 'alice'
            ? { ...member, purchaseOffset: Money.fromMajor('34.78', 'GEL') }
            : member
        ),
        paymentPeriods: [
          {
            ...utilitiesPeriod,
            kinds: utilitiesPeriod.kinds.map((kind) =>
              kind.kind === 'utilities' ? { ...kind, unresolvedMembers: [] } : kind
            )
          }
        ]
      },
      viewMode: 'compact'
    })

    expect(content.text).toContain('34.78 ₾ долг по покупкам')
  })

  test('states the credit side when the household owes the member instead', () => {
    const baseDashboard = dashboard()
    const utilitiesPeriod = baseDashboard.paymentPeriods!.find(
      (summary) => summary.period === '2026-05'
    )!
    const content = buildScheduledPaymentReminderContent({
      locale: 'ru',
      kind: 'utilities',
      dispatchKind: 'utilities',
      period: '2026-05',
      dashboard: {
        ...baseDashboard,
        members: baseDashboard.members.map((member) =>
          member.memberId === 'alice'
            ? { ...member, purchaseOffset: Money.fromMajor('-46.28', 'GEL') }
            : member
        ),
        paymentPeriods: [
          {
            ...utilitiesPeriod,
            kinds: utilitiesPeriod.kinds.map((kind) =>
              kind.kind === 'utilities' ? { ...kind, unresolvedMembers: [] } : kind
            )
          }
        ]
      },
      viewMode: 'compact'
    })

    // Shown absolute, not as a negative debt.
    expect(content.text).toContain('46.28 ₾ в плюсе по покупкам')
    expect(content.text).not.toContain('-46.28')
  })

  test('states a purchase balance next to a member who still owes on the plan', () => {
    const baseDashboard = dashboard()
    const content = buildScheduledPaymentReminderContent({
      locale: 'ru',
      kind: 'utilities',
      dispatchKind: 'utilities',
      period: '2026-05',
      dashboard: {
        ...baseDashboard,
        // Alice owes 120.00 on the plan and 32.25 on shared purchases. They are
        // separate debts, and only the second one outlives the cycle.
        members: baseDashboard.members.map((member) =>
          member.memberId === 'alice'
            ? { ...member, purchaseOffset: Money.fromMajor('32.25', 'GEL') }
            : member
        )
      },
      viewMode: 'compact'
    })

    expect(content.text).toContain('120.00 ₾')
    expect(content.text).toContain('32.25 ₾ долг по покупкам')
  })

  test('says up front how much of the cycle no bill can carry', () => {
    const baseDashboard = dashboard()
    const content = buildScheduledPaymentReminderContent({
      locale: 'ru',
      kind: 'utilities',
      dispatchKind: 'utilities',
      period: '2026-05',
      dashboard: {
        ...baseDashboard,
        // Targets come to 170.00 against 120.00 of bills: Alice 120.00 + 50.00,
        // Bob clamped to zero by being owed. 50.00 has nowhere to go this cycle.
        members: baseDashboard.members.map((member) =>
          member.memberId === 'alice'
            ? { ...member, purchaseOffset: Money.fromMajor('50.00', 'GEL') }
            : { ...member, purchaseOffset: Money.fromMajor('-50.00', 'GEL') }
        )
      },
      viewMode: 'compact'
    })

    expect(content.text).toContain('Покупок сверх счетов: 50.00 ₾')
  })

  test('lists a member who holds a purchase balance but no plan assignment', () => {
    const baseDashboard = dashboard()
    const utilitiesPeriod = baseDashboard.paymentPeriods!.find(
      (summary) => summary.period === '2026-05'
    )!
    const content = buildScheduledPaymentReminderContent({
      locale: 'ru',
      kind: 'utilities',
      dispatchKind: 'utilities',
      period: '2026-05',
      dashboard: {
        ...baseDashboard,
        // Bob is owed, so he has nothing to pay and no bill assigned to him. He
        // reaches the list through the balance alone.
        members: baseDashboard.members.map((member) =>
          member.memberId === 'bob'
            ? { ...member, purchaseOffset: Money.fromMajor('-46.28', 'GEL') }
            : member
        ),
        paymentPeriods: [
          {
            ...utilitiesPeriod,
            kinds: utilitiesPeriod.kinds.map((kind) =>
              kind.kind === 'utilities'
                ? {
                    ...kind,
                    unresolvedMembers: kind.unresolvedMembers.filter(
                      (member) => member.memberId !== 'bob'
                    )
                  }
                : kind
            )
          }
        ]
      },
      viewMode: 'compact'
    })

    expect(content.text).toContain('<b>Bob</b>')
    expect(content.text).toContain('46.28 ₾ в плюсе по покупкам')
  })

  test('keeps only shared actions on scheduled reminder cards', () => {
    const content = buildScheduledPaymentReminderContent({
      locale: 'ru',
      kind: 'utilities',
      dispatchKind: 'utilities',
      period: '2026-05',
      dashboard: dashboard(),
      viewMode: 'compact',
      botUsername: 'household_test_bot'
    })

    const markup = JSON.stringify(content.replyMarkup)
    expect(content.text).toContain('Подробности и история платежей — в дашборде.')
    expect(markup).toContain('pr:p:utilities:2026-05')
    expect(markup).toContain('start=dashboard')
    expect(markup).not.toContain('pr:d:')
    expect(markup).not.toContain('pr:c:')
    expect(markup).not.toContain('reminder_util:guided')
    expect(markup).not.toContain('reminder_util:template')
  })

  test('renders utility entry controls for reminder-topic utility prompts by default', () => {
    const content = buildBillingReminderPromptContent({
      locale: 'en',
      kind: 'utilities',
      dispatchKind: 'utilities',
      period: '2026-05',
      dashboard: dashboard(),
      viewMode: 'compact'
    })

    const markup = JSON.stringify(content.replyMarkup)
    expect(markup).toContain('reminder_util:guided:2026-05')
    expect(markup).toContain('reminder_util:template:2026-05')
  })

  test('hides utility entry controls for payments-topic instruction refreshes', () => {
    const content = buildPaymentInstructionContent({
      locale: 'en',
      kind: 'utilities',
      dispatchKind: 'utilities',
      period: '2026-05',
      dashboard: dashboard(),
      viewMode: 'details',
      botUsername: 'household_test_bot'
    })

    const markup = JSON.stringify(content.replyMarkup)
    expect(content.text).toContain('Details and payment history are available in the dashboard.')
    expect(markup).toContain('pr:p:utilities:2026-05')
    expect(markup).toContain('start=dashboard')
    expect(markup).not.toContain('pr:d:')
    expect(markup).not.toContain('reminder_util:guided')
    expect(markup).not.toContain('reminder_util:template')
  })
})
