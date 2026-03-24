import type { AdHocNotificationService, HouseholdOnboardingService } from '@household/application'
import { Temporal } from '@household/domain'
import type { Logger } from '@household/observability'
import type { AdHocNotificationDeliveryMode } from '@household/ports'

import {
  allowedMiniAppOrigin,
  createMiniAppSessionService,
  miniAppErrorResponse,
  miniAppJsonResponse,
  readMiniAppRequestPayload,
  type MiniAppSessionResult
} from './miniapp-auth'

async function authenticateMemberSession(
  request: Request,
  sessionService: ReturnType<typeof createMiniAppSessionService>,
  origin: string | undefined
): Promise<
  | Response
  | {
      member: NonNullable<MiniAppSessionResult['member']>
    }
> {
  const payload = await readMiniAppRequestPayload(request.clone())
  if (!payload.initData) {
    return miniAppJsonResponse({ ok: false, error: 'Missing initData' }, 400, origin)
  }

  const session = await sessionService.authenticate(payload)
  if (!session) {
    return miniAppJsonResponse({ ok: false, error: 'Invalid Telegram init data' }, 401, origin)
  }

  if (!session.authorized || !session.member || session.member.status !== 'active') {
    return miniAppJsonResponse(
      { ok: false, error: 'Access limited to active household members' },
      403,
      origin
    )
  }

  return {
    member: session.member
  }
}

async function parseJsonBody<T>(request: Request): Promise<T> {
  const text = await request.clone().text()
  if (text.trim().length === 0) {
    return {} as T
  }

  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error('Invalid JSON body')
  }
}

function parseScheduledLocal(localValue: string, timezone: string): Temporal.Instant {
  return Temporal.ZonedDateTime.from(`${localValue}[${timezone}]`).toInstant()
}

function isDeliveryMode(value: string | undefined): value is AdHocNotificationDeliveryMode {
  return value === 'topic' || value === 'dm_all' || value === 'dm_selected'
}

export function createMiniAppUpdateNotificationHandler(options: {
  allowedOrigins: readonly string[]
  botToken: string
  onboardingService: HouseholdOnboardingService
  adHocNotificationService: AdHocNotificationService
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
        const auth = await authenticateMemberSession(request, sessionService, origin)
        if (auth instanceof Response) {
          return auth
        }

        const parsed = await parseJsonBody<{
          notificationId?: string
          scheduledLocal?: string
          timezone?: string
          deliveryMode?: string
          dmRecipientMemberIds?: string[]
        }>(request)

        const notificationId = parsed.notificationId?.trim()
        if (!notificationId) {
          return miniAppJsonResponse({ ok: false, error: 'Missing notificationId' }, 400, origin)
        }

        const scheduledLocal = parsed.scheduledLocal?.trim()
        const timezone = parsed.timezone?.trim()
        const deliveryMode = parsed.deliveryMode?.trim()

        const result = await options.adHocNotificationService.updateNotification({
          notificationId,
          viewerMemberId: auth.member.id,
          ...(scheduledLocal && timezone
            ? {
                scheduledFor: parseScheduledLocal(scheduledLocal, timezone),
                timePrecision: 'exact' as const
              }
            : {}),
          ...(deliveryMode && isDeliveryMode(deliveryMode)
            ? {
                deliveryMode,
                dmRecipientMemberIds: parsed.dmRecipientMemberIds ?? []
              }
            : {})
        })

        switch (result.status) {
          case 'updated':
            return miniAppJsonResponse({ ok: true, authorized: true }, 200, origin)
          case 'invalid':
            return miniAppJsonResponse({ ok: false, error: result.reason }, 400, origin)
          case 'forbidden':
            return miniAppJsonResponse({ ok: false, error: 'Forbidden' }, 403, origin)
          case 'not_found':
            return miniAppJsonResponse({ ok: false, error: 'Notification not found' }, 404, origin)
          case 'already_handled':
          case 'past_due':
            return miniAppJsonResponse({ ok: false, error: result.status }, 409, origin)
        }
      } catch (error) {
        return miniAppErrorResponse(error, origin, options.logger)
      }
    }
  }
}

export function createMiniAppCancelNotificationHandler(options: {
  allowedOrigins: readonly string[]
  botToken: string
  onboardingService: HouseholdOnboardingService
  adHocNotificationService: AdHocNotificationService
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
        const auth = await authenticateMemberSession(request, sessionService, origin)
        if (auth instanceof Response) {
          return auth
        }

        const parsed = await parseJsonBody<{
          notificationId?: string
        }>(request)
        const notificationId = parsed.notificationId?.trim()
        if (!notificationId) {
          return miniAppJsonResponse({ ok: false, error: 'Missing notificationId' }, 400, origin)
        }

        const result = await options.adHocNotificationService.cancelNotification({
          notificationId,
          viewerMemberId: auth.member.id
        })

        switch (result.status) {
          case 'cancelled':
            return miniAppJsonResponse({ ok: true, authorized: true }, 200, origin)
          case 'forbidden':
            return miniAppJsonResponse({ ok: false, error: 'Forbidden' }, 403, origin)
          case 'not_found':
            return miniAppJsonResponse({ ok: false, error: 'Notification not found' }, 404, origin)
          case 'already_handled':
          case 'past_due':
            return miniAppJsonResponse({ ok: false, error: result.status }, 409, origin)
        }
      } catch (error) {
        return miniAppErrorResponse(error, origin, options.logger)
      }
    }
  }
}
