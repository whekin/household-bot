import type { HouseholdOnboardingService } from '@household/application'
import { DOMAIN_ERROR_CODE, type SupportedLocale } from '@household/domain'
import type { Logger } from '@household/observability'

import { verifyTelegramMiniAppInitData } from './telegram-miniapp-auth'

export interface MiniAppRequestPayload {
  initData: string | null
  joinToken?: string
  periodOverride?: string
  todayOverride?: string
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

export async function readMiniAppRequestPayload(request: {
  text(): Promise<string>
}): Promise<MiniAppRequestPayload> {
  const text = await request.text()

  if (text.trim().length === 0) {
    return {
      initData: null
    }
  }

  let parsed: {
    initData?: string
    joinToken?: string
    periodOverride?: string
    todayOverride?: string
  }
  try {
    parsed = JSON.parse(text) as { initData?: string; joinToken?: string }
  } catch {
    throw new Error('Invalid JSON body')
  }

  const initData = parsed.initData?.trim()
  const joinToken = parsed.joinToken?.trim()
  const periodOverride = parsed.periodOverride?.trim()
  const todayOverride = parsed.todayOverride?.trim()

  return {
    initData: initData && initData.length > 0 ? initData : null,
    ...(joinToken && joinToken.length > 0
      ? {
          joinToken
        }
      : {}),
    ...(periodOverride && /^\d{4}-\d{2}$/.test(periodOverride)
      ? {
          periodOverride
        }
      : {}),
    ...(todayOverride && /^\d{4}-\d{2}-\d{2}$/.test(todayOverride)
      ? {
          todayOverride
        }
      : {})
  }
}

type MiniAppErrorLogContext = Record<string, string | number | boolean | null>

interface SerializedMiniAppError {
  name?: string
  message: string
  code?: string
  detail?: string
  hint?: string
  constraint?: string
  table?: string
  column?: string
  schema?: string
  severity?: string
  routine?: string
  cause?: SerializedMiniAppError
}

const miniAppErrorMetadataFields = [
  'code',
  'detail',
  'hint',
  'constraint',
  'table',
  'column',
  'schema',
  'severity',
  'routine'
] as const

const databaseUrlCredentialsPattern = /\b(postgres(?:ql)?:\/\/)([^:@\s/]+):([^@\s/]+)@/gi
const telegramBotTokenPattern = /\b\d{6,12}:[A-Za-z0-9_-]{20,}\b/g
const bearerTokenPattern = /\b(authorization:\s*bearer\s+)[^\s,]+/gi
const telegramInitDataPattern = /\b(initData=)[^\s]+/gi
const clientDomainErrorCodes = new Set<string>([
  DOMAIN_ERROR_CODE.INVALID_MONEY_MAJOR_FORMAT,
  DOMAIN_ERROR_CODE.INVALID_SETTLEMENT_INPUT
])
const MINIAPP_CLIENT_VALIDATION_ERROR_CODE = 'MINIAPP_CLIENT_VALIDATION'

class MiniAppClientValidationError extends Error {
  readonly code = MINIAPP_CLIENT_VALIDATION_ERROR_CODE

  constructor(message: string, cause: unknown) {
    super(message, { cause })
    this.name = 'MiniAppClientValidationError'
  }
}

function redactSensitiveText(value: string): string {
  return value
    .replace(databaseUrlCredentialsPattern, '$1[redacted]:[redacted]@')
    .replace(telegramBotTokenPattern, '[redacted-bot-token]')
    .replace(bearerTokenPattern, '$1[redacted]')
    .replace(telegramInitDataPattern, '$1[redacted]')
}

function errorObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function errorTextField(value: Record<string, unknown>, key: string): string | undefined {
  const raw = value[key]
  if (typeof raw === 'string') {
    return redactSensitiveText(raw)
  }

  if (typeof raw === 'number' || typeof raw === 'bigint') {
    return raw.toString()
  }

  return undefined
}

function serializeMiniAppError(error: unknown, depth = 0): SerializedMiniAppError {
  const object = errorObject(error)
  const serialized: SerializedMiniAppError = {
    message:
      error instanceof Error
        ? redactSensitiveText(error.message)
        : object
          ? (errorTextField(object, 'message') ?? 'Unknown mini app error')
          : 'Unknown mini app error'
  }

  if (error instanceof Error && error.name.trim().length > 0) {
    serialized.name = redactSensitiveText(error.name)
  } else if (object) {
    const name = errorTextField(object, 'name')
    if (name) {
      serialized.name = name
    }
  }

  if (object) {
    for (const key of miniAppErrorMetadataFields) {
      const text = errorTextField(object, key)
      if (text) {
        serialized[key] = text
      }
    }

    if (depth < 2 && 'cause' in object && object.cause !== undefined) {
      serialized.cause = serializeMiniAppError(object.cause, depth + 1)
    }
  }

  return serialized
}

function isClientMiniAppError(error: SerializedMiniAppError): boolean {
  return error.code === MINIAPP_CLIENT_VALIDATION_ERROR_CODE
}

export function toMiniAppClientValidationError(error: unknown): unknown {
  const errorDetails = serializeMiniAppError(error)
  if (!errorDetails.code || !clientDomainErrorCodes.has(errorDetails.code)) {
    return error
  }

  return new MiniAppClientValidationError(errorDetails.message, error)
}

export function miniAppErrorResponse(
  error: unknown,
  origin?: string,
  logger?: Logger,
  context: MiniAppErrorLogContext = {}
): Response {
  const errorDetails = serializeMiniAppError(error)
  const message = errorDetails.message

  if (message === 'Invalid JSON body') {
    return miniAppJsonResponse({ ok: false, error: message }, 400, origin)
  }

  if (isClientMiniAppError(errorDetails)) {
    return miniAppJsonResponse({ ok: false, error: message }, 400, origin)
  }

  logger?.error(
    {
      event: 'miniapp.request_failed',
      ...context,
      error: message,
      errorDetails
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
