import type { FinanceCommandService } from '@household/application'

import {
  allowedMiniAppOrigin,
  createMiniAppSessionService,
  miniAppErrorResponse,
  miniAppJsonResponse,
  readMiniAppInitData
} from './miniapp-auth'

export function createMiniAppDashboardHandler(options: {
  allowedOrigins: readonly string[]
  botToken: string
  financeService: FinanceCommandService
}): {
  handler: (request: Request) => Promise<Response>
} {
  const sessionService = createMiniAppSessionService({
    botToken: options.botToken,
    getMemberByTelegramUserId: options.financeService.getMemberByTelegramUserId
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
        const initData = await readMiniAppInitData(request)
        if (!initData) {
          return miniAppJsonResponse({ ok: false, error: 'Missing initData' }, 400, origin)
        }

        const session = await sessionService.authenticate(initData)
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
              reason: 'not_member'
            },
            403,
            origin
          )
        }

        const dashboard = await options.financeService.generateDashboard()
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
              members: dashboard.members.map((line) => ({
                memberId: line.memberId,
                displayName: line.displayName,
                rentShareMajor: line.rentShare.toMajorString(),
                utilityShareMajor: line.utilityShare.toMajorString(),
                purchaseOffsetMajor: line.purchaseOffset.toMajorString(),
                netDueMajor: line.netDue.toMajorString(),
                explanations: line.explanations
              })),
              ledger: dashboard.ledger.map((entry) => ({
                id: entry.id,
                kind: entry.kind,
                title: entry.title,
                amountMajor: entry.amount.toMajorString(),
                actorDisplayName: entry.actorDisplayName,
                occurredAt: entry.occurredAt
              }))
            }
          },
          200,
          origin
        )
      } catch (error) {
        return miniAppErrorResponse(error, origin)
      }
    }
  }
}
