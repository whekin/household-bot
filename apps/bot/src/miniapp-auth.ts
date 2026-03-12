import type { HouseholdOnboardingService } from '@household/application'
import type { SupportedLocale } from '@household/domain'
import type { Logger } from '@household/observability'

import { verifyTelegramMiniAppInitData } from './telegram-miniapp-auth'

export interface MiniAppRequestPayload {
  initData: string | null
  joinToken?: string
}

export function miniAppJsonResponse(body: object, status = 200, origin?: string): Response {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8'
  })

  if (origin) {
    headers.set('access-control-allow-origin', origin)
    headers.set('access-control-allow-methods', 'POST, OPTIONS')
    headers.set('access-control-allow-headers', 'content-type')
    headers.set('vary', 'origin')
  }

  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers
  })
}

export function allowedMiniAppOrigin(
  request: Request,
  allowedOrigins: readonly string[],
  options: {
    allowDynamicOrigin?: boolean
  } = {}
): string | undefined {
  const origin = request.headers.get('origin')

  if (!origin) {
    return undefined
  }

  if (allowedOrigins.length === 0) {
    const allowDynamicOrigin = options.allowDynamicOrigin ?? process.env.NODE_ENV !== 'production'
    return allowDynamicOrigin ? origin : undefined
  }

  return allowedOrigins.includes(origin) ? origin : undefined
}

export async function readMiniAppRequestPayload(request: Request): Promise<MiniAppRequestPayload> {
  const text = await request.text()

  if (text.trim().length === 0) {
    return {
      initData: null
    }
  }

  let parsed: { initData?: string; joinToken?: string }
  try {
    parsed = JSON.parse(text) as { initData?: string; joinToken?: string }
  } catch {
    throw new Error('Invalid JSON body')
  }

  const initData = parsed.initData?.trim()
  const joinToken = parsed.joinToken?.trim()

  return {
    initData: initData && initData.length > 0 ? initData : null,
    ...(joinToken && joinToken.length > 0
      ? {
          joinToken
        }
      : {})
  }
}

export function miniAppErrorResponse(error: unknown, origin?: string, logger?: Logger): Response {
  const message = error instanceof Error ? error.message : 'Unknown mini app error'

  if (message === 'Invalid JSON body') {
    return miniAppJsonResponse({ ok: false, error: message }, 400, origin)
  }

  logger?.error(
    {
      event: 'miniapp.request_failed',
      error: message
    },
    'Mini app request failed'
  )

  return miniAppJsonResponse({ ok: false, error: 'Internal Server Error' }, 500, origin)
}

export interface MiniAppSessionResult {
  authorized: boolean
  member?: {
    id: string
    householdId: string
    householdName: string
    displayName: string
    status: 'active' | 'away' | 'left'
    isAdmin: boolean
    preferredLocale: SupportedLocale | null
    householdDefaultLocale: SupportedLocale
  }
  telegramUser?: ReturnType<typeof verifyTelegramMiniAppInitData>
  onboarding?: {
    status: 'join_required' | 'pending' | 'open_from_group'
    householdName?: string
    householdDefaultLocale?: SupportedLocale
  }
}

export function createMiniAppSessionService(options: {
  botToken: string
  onboardingService: HouseholdOnboardingService
}): {
  authenticate: (payload: MiniAppRequestPayload) => Promise<MiniAppSessionResult | null>
} {
  return {
    authenticate: async (payload) => {
      if (!payload.initData) {
        return null
      }

      const telegramUser = verifyTelegramMiniAppInitData(payload.initData, options.botToken)
      if (!telegramUser) {
        return null
      }

      const access = await options.onboardingService.getMiniAppAccess({
        identity: {
          telegramUserId: telegramUser.id,
          displayName:
            telegramUser.firstName ?? telegramUser.username ?? `Telegram ${telegramUser.id}`,
          username: telegramUser.username,
          languageCode: telegramUser.languageCode
        },
        ...(payload.joinToken
          ? {
              joinToken: payload.joinToken
            }
          : {})
      })

      switch (access.status) {
        case 'active':
          return {
            authorized: true,
            member: access.member,
            telegramUser
          }
        case 'pending':
          return {
            authorized: false,
            telegramUser,
            onboarding: {
              status: 'pending',
              householdName: access.household.name,
              householdDefaultLocale: access.household.defaultLocale
            }
          }
        case 'join_required':
          return {
            authorized: false,
            telegramUser,
            onboarding: {
              status: 'join_required',
              householdName: access.household.name,
              householdDefaultLocale: access.household.defaultLocale
            }
          }
        case 'open_from_group':
          return {
            authorized: false,
            telegramUser,
            onboarding: {
              status: 'open_from_group'
            }
          }
      }
    }
  }
}

export function createMiniAppAuthHandler(options: {
  allowedOrigins: readonly string[]
  botToken: string
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
              onboarding: session.onboarding,
              telegramUser: session.telegramUser
            },
            200,
            origin
          )
        }

        return miniAppJsonResponse(
          {
            ok: true,
            authorized: true,
            member: session.member,
            telegramUser: session.telegramUser,
            features: {
              balances: true,
              ledger: true
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

export function createMiniAppJoinHandler(options: {
  allowedOrigins: readonly string[]
  botToken: string
  onboardingService: HouseholdOnboardingService
  logger?: Logger
}): {
  handler: (request: Request) => Promise<Response>
} {
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

        if (!payload.joinToken) {
          return miniAppJsonResponse(
            { ok: false, error: 'Missing household join token' },
            400,
            origin
          )
        }

        const telegramUser = verifyTelegramMiniAppInitData(payload.initData, options.botToken)
        if (!telegramUser) {
          return miniAppJsonResponse(
            { ok: false, error: 'Invalid Telegram init data' },
            401,
            origin
          )
        }

        const result = await options.onboardingService.joinHousehold({
          identity: {
            telegramUserId: telegramUser.id,
            displayName:
              telegramUser.firstName ?? telegramUser.username ?? `Telegram ${telegramUser.id}`,
            username: telegramUser.username,
            languageCode: telegramUser.languageCode
          },
          joinToken: payload.joinToken
        })

        if (result.status === 'invalid_token') {
          return miniAppJsonResponse(
            { ok: false, error: 'Invalid household join token' },
            404,
            origin
          )
        }

        if (result.status === 'active') {
          return miniAppJsonResponse(
            {
              ok: true,
              authorized: true,
              member: result.member,
              telegramUser
            },
            200,
            origin
          )
        }

        return miniAppJsonResponse(
          {
            ok: true,
            authorized: false,
            onboarding: {
              status: 'pending',
              householdName: result.household.name,
              householdDefaultLocale: result.household.defaultLocale
            },
            telegramUser
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
