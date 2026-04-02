import type {
  AdHocNotificationService,
  FinanceCommandService,
  HouseholdOnboardingService
} from '@household/application'
import { Money } from '@household/domain'
import type { Logger } from '@household/observability'
import type { HouseholdConfigurationRepository } from '@household/ports'

import {
  allowedMiniAppOrigin,
  createMiniAppSessionService,
  miniAppErrorResponse,
  miniAppJsonResponse,
  readMiniAppRequestPayload
} from './miniapp-auth'

export function createMiniAppDashboardHandler(options: {
  allowedOrigins: readonly string[]
  botToken: string
  financeServiceForHousehold: (householdId: string) => FinanceCommandService
  adHocNotificationService: AdHocNotificationService
  onboardingService: HouseholdOnboardingService
  householdConfigurationRepository?: Pick<
    HouseholdConfigurationRepository,
    'listHouseholdUtilityCategories'
  >
  logger?: Logger
}): {
  handler: (request: Request) => Promise<Response>
} {
  const sessionService = createMiniAppSessionService({
    botToken: options.botToken,
    onboardingService: options.onboardingService
  })

  return {
    handler: async (request) => {
      const origin = allowedMiniAppOrigin(request, options.allowedOrigins)

      if (request.method === 'OPTIONS') {
        return miniAppJsonResponse({ ok: true }, 204, origin)
      }

      if (request.method !== 'POST') {
        return miniAppJsonResponse({ ok: false, error: 'Method Not Allowed' }, 405, origin)
      }

      try {
        const payload = await readMiniAppRequestPayload(request)
        if (!payload.initData) {
          return miniAppJsonResponse({ ok: false, error: 'Missing initData' }, 400, origin)
        }

        const session = await sessionService.authenticate(payload)
        if (!session) {
          return miniAppJsonResponse(
            { ok: false, error: 'Invalid Telegram init data' },
            401,
            origin
          )
        }

        if (!session.authorized) {
          return miniAppJsonResponse(
            {
              ok: true,
              authorized: false,
              onboarding: session.onboarding
            },
            403,
            origin
          )
        }

        if (!session.member) {
          return miniAppJsonResponse(
            { ok: false, error: 'Authenticated session is missing member context' },
            500,
            origin
          )
        }

        const dashboard = await loadMiniAppDashboardPayload({
          householdId: session.member.householdId,
          viewerMemberId: session.member.id,
          financeService: options.financeServiceForHousehold(session.member.householdId),
          adHocNotificationService: options.adHocNotificationService,
          ...(options.householdConfigurationRepository
            ? {
                householdConfigurationRepository: options.householdConfigurationRepository
              }
            : {}),
          ...(payload.periodOverride ? { periodOverride: payload.periodOverride } : {}),
          ...(payload.todayOverride ? { todayOverride: payload.todayOverride } : {})
        })

        if (!dashboard) {
          return miniAppJsonResponse(
            { ok: false, error: 'No billing cycle available' },
            404,
            origin
          )
        }

        return miniAppJsonResponse(
          {
            ok: true,
            authorized: true,
            dashboard
          },
          200,
          origin
        )
      } catch (error) {
        return miniAppErrorResponse(error, origin, options.logger)
      }
    }
  }
}

export async function loadMiniAppDashboardPayload(input: {
  householdId: string
  viewerMemberId: string
  financeService: FinanceCommandService
  adHocNotificationService: AdHocNotificationService
  householdConfigurationRepository?: Pick<
    HouseholdConfigurationRepository,
    'listHouseholdUtilityCategories'
  >
  periodOverride?: string
  todayOverride?: string
}) {
  const dashboard = await input.financeService.generateDashboard(
    input.periodOverride,
    input.todayOverride ? { todayOverride: input.todayOverride } : {}
  )
  if (!dashboard) {
    return null
  }

  const [notifications, utilityCategories] = await Promise.all([
    input.adHocNotificationService.listUpcomingNotifications({
      householdId: input.householdId,
      viewerMemberId: input.viewerMemberId
    }),
    input.householdConfigurationRepository
      ? input.householdConfigurationRepository.listHouseholdUtilityCategories(input.householdId)
      : Promise.resolve([])
  ])

  return {
    period: dashboard.period,
    currency: dashboard.currency,
    timezone: dashboard.timezone,
    rentWarningDay: dashboard.rentWarningDay,
    rentDueDay: dashboard.rentDueDay,
    utilitiesReminderDay: dashboard.utilitiesReminderDay,
    utilitiesDueDay: dashboard.utilitiesDueDay,
    paymentBalanceAdjustmentPolicy: dashboard.paymentBalanceAdjustmentPolicy,
    rentPaymentDestinations: dashboard.rentPaymentDestinations,
    totalDueMajor: dashboard.totalDue.toMajorString(),
    totalPaidMajor: dashboard.totalPaid.toMajorString(),
    totalRemainingMajor: dashboard.totalRemaining.toMajorString(),
    billingStage: dashboard.billingStage,
    rentSourceAmountMajor: dashboard.rentSourceAmount.toMajorString(),
    rentSourceCurrency: dashboard.rentSourceAmount.currency,
    rentDisplayAmountMajor: dashboard.rentDisplayAmount.toMajorString(),
    rentFxRateMicros: dashboard.rentFxRateMicros?.toString() ?? null,
    rentFxEffectiveDate: dashboard.rentFxEffectiveDate,
    utilityBillingPlan: dashboard.utilityBillingPlan
      ? {
          version: dashboard.utilityBillingPlan.version,
          status: dashboard.utilityBillingPlan.status,
          dueDate: dashboard.utilityBillingPlan.dueDate,
          updatedFromVersion: dashboard.utilityBillingPlan.updatedFromVersion,
          reason: dashboard.utilityBillingPlan.reason,
          categories: dashboard.utilityBillingPlan.categories.map((category) => ({
            utilityBillId: category.utilityBillId,
            billName: category.billName,
            billTotalMajor: category.billTotal.toMajorString(),
            assignedAmountMajor: category.assignedAmount.toMajorString(),
            assignedMemberId: category.assignedMemberId,
            assignedDisplayName: category.assignedDisplayName,
            paidAmountMajor: category.paidAmount.toMajorString(),
            isFullAssignment: category.isFullAssignment,
            splitGroupId: category.splitGroupId
          })),
          memberSummaries: dashboard.utilityBillingPlan.memberSummaries.map((summary) => ({
            memberId: summary.memberId,
            displayName: summary.displayName,
            fairShareMajor: summary.fairShare.toMajorString(),
            vendorPaidMajor: summary.vendorPaid.toMajorString(),
            assignedThisCycleMajor: summary.assignedThisCycle.toMajorString(),
            projectedDeltaAfterPlanMajor: summary.projectedDeltaAfterPlan.toMajorString()
          }))
        }
      : null,
    rentBillingState: {
      dueDate: dashboard.rentBillingState.dueDate,
      paymentDestinations: dashboard.rentBillingState.paymentDestinations,
      memberSummaries: dashboard.rentBillingState.memberSummaries.map((summary) => ({
        memberId: summary.memberId,
        displayName: summary.displayName,
        dueMajor: summary.due.toMajorString(),
        paidMajor: summary.paid.toMajorString(),
        remainingMajor: summary.remaining.toMajorString()
      }))
    },
    utilityCategories: utilityCategories
      .filter((category) => category.isActive)
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((category) => ({
        slug: category.slug,
        name: category.name,
        providerName: category.providerName,
        customerNumber: category.customerNumber,
        paymentLink: category.paymentLink,
        note: category.note
      })),
    members: dashboard.members.map((line) => ({
      memberId: line.memberId,
      displayName: line.displayName,
      status: line.status,
      absencePolicy: line.absencePolicy,
      absenceIntervalStartsOn: line.absenceIntervalStartsOn ?? null,
      absenceIntervalEndsOn: line.absenceIntervalEndsOn ?? null,
      utilityParticipationDays: line.utilityParticipationDays ?? 0,
      predictedUtilityShareMajor: line.predictedUtilityShare?.toMajorString() ?? null,
      rentShareMajor: line.rentShare.toMajorString(),
      utilityShareMajor: line.utilityShare.toMajorString(),
      purchaseOffsetMajor: line.purchaseOffset.toMajorString(),
      netDueMajor: line.netDue.toMajorString(),
      paidMajor: line.paid.toMajorString(),
      remainingMajor: line.remaining.toMajorString(),
      overduePayments: line.overduePayments.map((overdue) => ({
        kind: overdue.kind,
        amountMajor: Money.fromMinor(overdue.amountMinor, dashboard.currency).toMajorString(),
        periods: overdue.periods
      })),
      explanations: line.explanations
    })),
    paymentPeriods: (dashboard.paymentPeriods ?? []).map((period) => ({
      period: period.period,
      utilityTotalMajor: period.utilityTotal.toMajorString(),
      hasOverdueBalance: period.hasOverdueBalance,
      isCurrentPeriod: period.isCurrentPeriod,
      kinds: period.kinds.map((kind) => ({
        kind: kind.kind,
        totalDueMajor: kind.totalDue.toMajorString(),
        totalPaidMajor: kind.totalPaid.toMajorString(),
        totalRemainingMajor: kind.totalRemaining.toMajorString(),
        unresolvedMembers: kind.unresolvedMembers.map((member) => ({
          memberId: member.memberId,
          displayName: member.displayName,
          suggestedAmountMajor: member.suggestedAmount.toMajorString(),
          baseDueMajor: member.baseDue.toMajorString(),
          paidMajor: member.paid.toMajorString(),
          remainingMajor: member.remaining.toMajorString(),
          effectivelySettled: member.effectivelySettled
        }))
      }))
    })),
    ledger: dashboard.ledger.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      title: entry.title,
      memberId: entry.memberId,
      paymentKind: entry.paymentKind,
      amountMajor: entry.amount.toMajorString(),
      currency: entry.currency,
      displayAmountMajor: entry.displayAmount.toMajorString(),
      displayCurrency: entry.displayCurrency,
      fxRateMicros: entry.fxRateMicros?.toString() ?? null,
      fxEffectiveDate: entry.fxEffectiveDate,
      actorDisplayName: entry.actorDisplayName,
      occurredAt: entry.occurredAt,
      ...(entry.kind === 'purchase'
        ? {
            payerMemberId: entry.payerMemberId ?? undefined,
            purchaseSplitMode: entry.purchaseSplitMode ?? 'equal',
            originPeriod: entry.originPeriod ?? null,
            resolutionStatus: entry.resolutionStatus ?? 'unresolved',
            resolvedAt: entry.resolvedAt ?? null,
            outstandingByMember:
              entry.outstandingByMember?.map((outstanding) => ({
                memberId: outstanding.memberId,
                amountMajor: outstanding.amount.toMajorString()
              })) ?? [],
            purchaseParticipants:
              entry.purchaseParticipants?.map((participant) => ({
                memberId: participant.memberId,
                included: participant.included,
                shareAmountMajor: participant.shareAmount?.toMajorString() ?? null
              })) ?? []
          }
        : {})
    })),
    notifications: notifications.map((notification) => ({
      id: notification.id,
      summaryText: notification.notificationText,
      scheduledFor: notification.scheduledFor.toString(),
      status: notification.status,
      deliveryMode: notification.deliveryMode,
      dmRecipientMemberIds: notification.dmRecipientMemberIds,
      dmRecipientDisplayNames: notification.dmRecipientDisplayNames,
      creatorMemberId: notification.creatorMemberId,
      creatorDisplayName: notification.creatorDisplayName,
      assigneeMemberId: notification.assigneeMemberId,
      assigneeDisplayName: notification.assigneeDisplayName,
      canCancel: notification.canCancel,
      canEdit: notification.canEdit
    }))
  }
}
