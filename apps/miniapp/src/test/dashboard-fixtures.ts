import type { MiniAppDashboard } from '../api'

/** Minimal dashboards for view-model tests: one member, "me", unless overridden. */
type PeriodSummary = NonNullable<MiniAppDashboard['paymentPeriods']>[number]

export function unresolved(memberId: string, remainingMajor: string) {
  return {
    memberId,
    displayName: memberId,
    suggestedAmountMajor: remainingMajor,
    baseDueMajor: remainingMajor,
    paidMajor: '0.00',
    remainingMajor,
    effectivelySettled: false
  }
}

export function period(
  value: string,
  input: { rent?: string; utilities?: string; current?: boolean } = {}
): PeriodSummary {
  return {
    period: value,
    utilityTotalMajor: '100.00',
    hasOverdueBalance: false,
    isCurrentPeriod: input.current ?? true,
    kinds: [
      {
        kind: 'rent',
        totalDueMajor: '0.00',
        totalPaidMajor: '0.00',
        totalRemainingMajor: input.rent ?? '0.00',
        unresolvedMembers: input.rent ? [unresolved('me', input.rent)] : []
      },
      {
        kind: 'utilities',
        totalDueMajor: '0.00',
        totalPaidMajor: '0.00',
        totalRemainingMajor: input.utilities ?? '0.00',
        unresolvedMembers: input.utilities ? [unresolved('me', input.utilities)] : []
      }
    ]
  }
}

export function dashboard(overrides: Partial<MiniAppDashboard> = {}): MiniAppDashboard {
  return {
    period: '2026-10',
    currency: 'GEL',
    timezone: 'Asia/Tbilisi',
    rentWarningDay: 15,
    rentDueDay: 20,
    utilitiesReminderDay: 1,
    utilitiesDueDay: 10,
    paymentBalanceAdjustmentPolicy: 'utilities',
    rentPaymentDestinations: null,
    totalDueMajor: '0.00',
    totalPaidMajor: '0.00',
    totalRemainingMajor: '0.00',
    billingStage: 'idle',
    rentSourceAmountMajor: '0.00',
    rentSourceCurrency: 'GEL',
    rentDisplayAmountMajor: '0.00',
    rentFxRateMicros: null,
    rentFxEffectiveDate: null,
    utilityBillingPlan: null,
    rentBillingState: {
      dueDate: '2026-10-20',
      paymentDestinations: null,
      memberSummaries: [
        {
          memberId: 'me',
          displayName: 'me',
          dueMajor: '800.00',
          paidMajor: '0.00',
          remainingMajor: '800.00'
        }
      ]
    },
    members: [
      {
        memberId: 'me',
        displayName: 'me',
        predictedUtilityShareMajor: '100.00',
        rentShareMajor: '800.00',
        utilityShareMajor: '100.00',
        purchaseOffsetMajor: '0.00',
        netDueMajor: '900.00',
        paidMajor: '0.00',
        remainingMajor: '900.00',
        overduePayments: [],
        explanations: []
      }
    ],
    paymentPeriods: [],
    ledger: [],
    notifications: [],
    ...overrides
  }
}

export function memberLine(
  memberId: string,
  overrides: Partial<MiniAppDashboard['members'][number]> = {}
): MiniAppDashboard['members'][number] {
  return {
    memberId,
    displayName: memberId,
    predictedUtilityShareMajor: '100.00',
    rentShareMajor: '800.00',
    utilityShareMajor: '100.00',
    purchaseOffsetMajor: '0.00',
    netDueMajor: '900.00',
    paidMajor: '0.00',
    remainingMajor: '900.00',
    overduePayments: [],
    explanations: [],
    ...overrides
  }
}
