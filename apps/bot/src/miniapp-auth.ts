import type { FinanceRepository } from '@household/ports'

import { verifyTelegramMiniAppInitData } from './telegram-miniapp-auth'

function json(body: object, status = 200, origin?: string): Response {
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

function allowedOrigin(request: Request, allowedOrigins: readonly string[]): string | undefined {
  const origin = request.headers.get('origin')

  if (!origin) {
    return undefined
  }

  if (allowedOrigins.length === 0) {
    return origin
  }

  return allowedOrigins.includes(origin) ? origin : undefined
}

async function readInitData(request: Request): Promise<string | null> {
  const text = await request.text()

  if (text.trim().length === 0) {
    return null
  }

  const parsed = JSON.parse(text) as { initData?: string }
  const initData = parsed.initData?.trim()

  return initData && initData.length > 0 ? initData : null
}

export function createMiniAppAuthHandler(options: {
  allowedOrigins: readonly string[]
  botToken: string
  repository: FinanceRepository
}): {
  handler: (request: Request) => Promise<Response>
} {
  return {
    handler: async (request) => {
      const origin = allowedOrigin(request, options.allowedOrigins)

      if (request.method === 'OPTIONS') {
        return json({ ok: true }, 204, origin)
      }

      if (request.method !== 'POST') {
        return json({ ok: false, error: 'Method Not Allowed' }, 405, origin)
      }

      try {
        const initData = await readInitData(request)
        if (!initData) {
          return json({ ok: false, error: 'Missing initData' }, 400, origin)
        }

        const telegramUser = verifyTelegramMiniAppInitData(initData, options.botToken)
        if (!telegramUser) {
          return json({ ok: false, error: 'Invalid Telegram init data' }, 401, origin)
        }

        const member = await options.repository.getMemberByTelegramUserId(telegramUser.id)
        if (!member) {
          return json(
            {
              ok: true,
              authorized: false,
              reason: 'not_member'
            },
            403,
            origin
          )
        }

        return json(
          {
            ok: true,
            authorized: true,
            member: {
              id: member.id,
              displayName: member.displayName,
              isAdmin: member.isAdmin
            },
            telegramUser,
            features: {
              balances: false,
              ledger: false
            }
          },
          200,
          origin
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown mini app auth error'
        return json({ ok: false, error: message }, 400, origin)
      }
    }
  }
}
