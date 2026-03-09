import type { HouseholdOnboardingService, LocalePreferenceService } from '@household/application'
import { normalizeSupportedLocale } from '@household/domain'
import type { Logger } from '@household/observability'

import {
  allowedMiniAppOrigin,
  createMiniAppSessionService,
  miniAppErrorResponse,
  miniAppJsonResponse
} from './miniapp-auth'

interface LocalePreferenceRequest {
  initData: string
  locale: 'en' | 'ru'
  scope: 'member' | 'household'
}

async function readLocalePreferenceRequest(request: Request): Promise<LocalePreferenceRequest> {
  const text = await request.text()
  if (text.trim().length === 0) {
    throw new Error('Missing initData')
  }

  let parsed: { initData?: string; locale?: string; scope?: string }
  try {
    parsed = JSON.parse(text) as { initData?: string; locale?: string; scope?: string }
  } catch {
    throw new Error('Invalid JSON body')
  }

  const initData = parsed.initData?.trim()
  if (!initData) {
    throw new Error('Missing initData')
  }

  const locale = normalizeSupportedLocale(parsed.locale)
  if (!locale) {
    throw new Error('Invalid locale')
  }

  const scope = parsed.scope?.trim()
  if (scope !== 'member' && scope !== 'household') {
    throw new Error('Invalid locale scope')
  }

  return {
    initData,
    locale,
    scope
  }
}

export function createMiniAppLocalePreferenceHandler(options: {
  allowedOrigins: readonly string[]
  botToken: string
  onboardingService: HouseholdOnboardingService
  localePreferenceService: LocalePreferenceService
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
        const payload = await readLocalePreferenceRequest(request)
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

        if (!session.authorized || !session.member || !session.telegramUser) {
          return miniAppJsonResponse(
            { ok: false, error: 'Access limited to active household members' },
            403,
            origin
          )
        }

        let memberPreferredLocale = session.member.preferredLocale
        let householdDefaultLocale = session.member.householdDefaultLocale

        if (payload.scope === 'member') {
          const result = await options.localePreferenceService.updateMemberLocale({
            householdId: session.member.householdId,
            telegramUserId: session.telegramUser.id,
            locale: payload.locale
          })

          if (result.status === 'rejected') {
            return miniAppJsonResponse({ ok: false, error: 'Member not found' }, 404, origin)
          }

          memberPreferredLocale = result.member.preferredLocale
          householdDefaultLocale = result.member.householdDefaultLocale
        } else {
          const result = await options.localePreferenceService.updateHouseholdLocale({
            householdId: session.member.householdId,
            actorIsAdmin: session.member.isAdmin,
            locale: payload.locale
          })

          if (result.status === 'rejected') {
            return miniAppJsonResponse({ ok: false, error: 'Admin access required' }, 403, origin)
          }

          householdDefaultLocale = result.household.defaultLocale
        }

        return miniAppJsonResponse(
          {
            ok: true,
            authorized: true,
            locale: {
              scope: payload.scope,
              effectiveLocale: memberPreferredLocale ?? householdDefaultLocale,
              memberPreferredLocale,
              householdDefaultLocale
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
