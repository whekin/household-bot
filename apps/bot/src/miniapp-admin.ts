import type { HouseholdOnboardingService, MiniAppAdminService } from '@household/application'
import type { Logger } from '@household/observability'

import {
  allowedMiniAppOrigin,
  createMiniAppSessionService,
  miniAppErrorResponse,
  miniAppJsonResponse,
  readMiniAppRequestPayload
} from './miniapp-auth'

async function readApprovalPayload(request: Request): Promise<{
  initData: string
  pendingTelegramUserId: string
}> {
  const clonedRequest = request.clone()
  const payload = await readMiniAppRequestPayload(request)
  if (!payload.initData) {
    throw new Error('Missing initData')
  }

  const text = await clonedRequest.text()
  let parsed: { pendingTelegramUserId?: string }
  try {
    parsed = JSON.parse(text) as { pendingTelegramUserId?: string }
  } catch {
    throw new Error('Invalid JSON body')
  }

  const pendingTelegramUserId = parsed.pendingTelegramUserId?.trim()
  if (!pendingTelegramUserId) {
    throw new Error('Missing pendingTelegramUserId')
  }

  return {
    initData: payload.initData,
    pendingTelegramUserId
  }
}

export function createMiniAppPendingMembersHandler(options: {
  allowedOrigins: readonly string[]
  botToken: string
  onboardingService: HouseholdOnboardingService
  miniAppAdminService: MiniAppAdminService
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

        if (!session.authorized || !session.member) {
          return miniAppJsonResponse(
            { ok: false, error: 'Access limited to active household members' },
            403,
            origin
          )
        }

        const result = await options.miniAppAdminService.listPendingMembers({
          householdId: session.member.householdId,
          actorIsAdmin: session.member.isAdmin
        })

        if (result.status === 'rejected') {
          return miniAppJsonResponse({ ok: false, error: 'Admin access required' }, 403, origin)
        }

        return miniAppJsonResponse(
          {
            ok: true,
            authorized: true,
            members: result.members
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

export function createMiniAppApproveMemberHandler(options: {
  allowedOrigins: readonly string[]
  botToken: string
  onboardingService: HouseholdOnboardingService
  miniAppAdminService: MiniAppAdminService
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
        const payload = await readApprovalPayload(request)

        const session = await sessionService.authenticate({
          initData: payload.initData
        })
        if (!session) {
          return miniAppJsonResponse(
            { ok: false, error: 'Invalid Telegram init data' },
            401,
            origin
          )
        }

        if (!session.authorized || !session.member) {
          return miniAppJsonResponse(
            { ok: false, error: 'Access limited to active household members' },
            403,
            origin
          )
        }

        const result = await options.miniAppAdminService.approvePendingMember({
          householdId: session.member.householdId,
          actorIsAdmin: session.member.isAdmin,
          pendingTelegramUserId: payload.pendingTelegramUserId
        })

        if (result.status === 'rejected') {
          const status = result.reason === 'pending_not_found' ? 404 : 403
          const error =
            result.reason === 'pending_not_found'
              ? 'Pending member not found'
              : 'Admin access required'

          return miniAppJsonResponse({ ok: false, error }, status, origin)
        }

        return miniAppJsonResponse(
          {
            ok: true,
            authorized: true,
            member: result.member
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
