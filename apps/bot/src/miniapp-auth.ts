import type { FinanceMemberRecord, FinanceRepository } from '@household/ports'
import type { Logger } from '@household/observability'

import { verifyTelegramMiniAppInitData } from './telegram-miniapp-auth'

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

  return new Response(JSON.stringify(body), {
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

export async function readMiniAppInitData(request: Request): Promise<string | null> {
  const text = await request.text()

  if (text.trim().length === 0) {
    return null
  }

  let parsed: { initData?: string }
  try {
    parsed = JSON.parse(text) as { initData?: string }
  } catch {
    throw new Error('Invalid JSON body')
  }

  const initData = parsed.initData?.trim()

  return initData && initData.length > 0 ? initData : null
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
  reason?: 'not_member'
  member?: {
    id: string
    displayName: string
    isAdmin: boolean
  }
  telegramUser?: ReturnType<typeof verifyTelegramMiniAppInitData>
}

type MiniAppMemberLookup = (telegramUserId: string) => Promise<FinanceMemberRecord | null>

export function createMiniAppSessionService(options: {
  botToken: string
  getMemberByTelegramUserId: MiniAppMemberLookup
}): {
  authenticate: (initData: string) => Promise<MiniAppSessionResult | null>
} {
  return {
    authenticate: async (initData) => {
      const telegramUser = verifyTelegramMiniAppInitData(initData, options.botToken)
      if (!telegramUser) {
        return null
      }

      const member = await options.getMemberByTelegramUserId(telegramUser.id)
      if (!member) {
        return {
          authorized: false,
          reason: 'not_member'
        }
      }

      return {
        authorized: true,
        member: {
          id: member.id,
          displayName: member.displayName,
          isAdmin: member.isAdmin
        },
        telegramUser
      }
    }
  }
}

export function createMiniAppAuthHandler(options: {
  allowedOrigins: readonly string[]
  botToken: string
  repository: FinanceRepository
  logger?: Logger
}): {
  handler: (request: Request) => Promise<Response>
} {
  const sessionService = createMiniAppSessionService({
    botToken: options.botToken,
    getMemberByTelegramUserId: options.repository.getMemberByTelegramUserId
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
