import type { FinanceCommandService, HouseholdOnboardingService } from '@household/application'
import type { Logger } from '@household/observability'

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
  onboardingService: HouseholdOnboardingService
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

        const dashboard = await options
          .financeServiceForHousehold(session.member.householdId)
          .generateDashboard()
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
            dashboard: {
              period: dashboard.period,
              currency: dashboard.currency,
              totalDueMajor: dashboard.totalDue.toMajorString(),
              totalPaidMajor: dashboard.totalPaid.toMajorString(),
              totalRemainingMajor: dashboard.totalRemaining.toMajorString(),
              rentSourceAmountMajor: dashboard.rentSourceAmount.toMajorString(),
              rentSourceCurrency: dashboard.rentSourceAmount.currency,
              rentDisplayAmountMajor: dashboard.rentDisplayAmount.toMajorString(),
              rentFxRateMicros: dashboard.rentFxRateMicros?.toString() ?? null,
              rentFxEffectiveDate: dashboard.rentFxEffectiveDate,
              members: dashboard.members.map((line) => ({
                memberId: line.memberId,
                displayName: line.displayName,
                rentShareMajor: line.rentShare.toMajorString(),
                utilityShareMajor: line.utilityShare.toMajorString(),
                purchaseOffsetMajor: line.purchaseOffset.toMajorString(),
                netDueMajor: line.netDue.toMajorString(),
                paidMajor: line.paid.toMajorString(),
                remainingMajor: line.remaining.toMajorString(),
                explanations: line.explanations
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
                occurredAt: entry.occurredAt
              }))
            }
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
