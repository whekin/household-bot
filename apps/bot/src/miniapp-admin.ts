import type { HouseholdOnboardingService, MiniAppAdminService } from '@household/application'
import type { Logger } from '@household/observability'
import type { HouseholdBillingSettingsRecord } from '@household/ports'
import type { MiniAppSessionResult } from './miniapp-auth'

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

async function readSettingsUpdatePayload(request: Request): Promise<{
  initData: string
  settlementCurrency?: string
  rentAmountMajor?: string
  rentCurrency?: string
  rentDueDay: number
  rentWarningDay: number
  utilitiesDueDay: number
  utilitiesReminderDay: number
  timezone: string
}> {
  const clonedRequest = request.clone()
  const payload = await readMiniAppRequestPayload(request)
  if (!payload.initData) {
    throw new Error('Missing initData')
  }

  const text = await clonedRequest.text()
  let parsed: {
    settlementCurrency?: string
    rentAmountMajor?: string
    rentCurrency?: string
    rentDueDay?: number
    rentWarningDay?: number
    utilitiesDueDay?: number
    utilitiesReminderDay?: number
    timezone?: string
  }
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Invalid JSON body')
  }

  if (
    typeof parsed.rentDueDay !== 'number' ||
    typeof parsed.rentWarningDay !== 'number' ||
    typeof parsed.utilitiesDueDay !== 'number' ||
    typeof parsed.utilitiesReminderDay !== 'number' ||
    typeof parsed.timezone !== 'string'
  ) {
    throw new Error('Missing billing settings fields')
  }

  return {
    initData: payload.initData,
    ...(typeof parsed.rentAmountMajor === 'string'
      ? {
          rentAmountMajor: parsed.rentAmountMajor
        }
      : {}),
    ...(typeof parsed.settlementCurrency === 'string'
      ? {
          settlementCurrency: parsed.settlementCurrency
        }
      : {}),
    ...(typeof parsed.rentCurrency === 'string'
      ? {
          rentCurrency: parsed.rentCurrency
        }
      : {}),
    rentDueDay: parsed.rentDueDay,
    rentWarningDay: parsed.rentWarningDay,
    utilitiesDueDay: parsed.utilitiesDueDay,
    utilitiesReminderDay: parsed.utilitiesReminderDay,
    timezone: parsed.timezone
  }
}

async function readUtilityCategoryPayload(request: Request): Promise<{
  initData: string
  slug?: string
  name: string
  sortOrder: number
  isActive: boolean
}> {
  const clonedRequest = request.clone()
  const payload = await readMiniAppRequestPayload(request)
  if (!payload.initData) {
    throw new Error('Missing initData')
  }

  const text = await clonedRequest.text()
  let parsed: {
    slug?: string
    name?: string
    sortOrder?: number
    isActive?: boolean
  }
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Invalid JSON body')
  }

  if (
    typeof parsed.name !== 'string' ||
    typeof parsed.sortOrder !== 'number' ||
    typeof parsed.isActive !== 'boolean'
  ) {
    throw new Error('Missing utility category fields')
  }

  return {
    initData: payload.initData,
    ...(typeof parsed.slug === 'string' && parsed.slug.trim().length > 0
      ? {
          slug: parsed.slug.trim()
        }
      : {}),
    name: parsed.name,
    sortOrder: parsed.sortOrder,
    isActive: parsed.isActive
  }
}

async function readPromoteMemberPayload(request: Request): Promise<{
  initData: string
  memberId: string
}> {
  const clonedRequest = request.clone()
  const payload = await readMiniAppRequestPayload(request)
  if (!payload.initData) {
    throw new Error('Missing initData')
  }

  const text = await clonedRequest.text()
  let parsed: { memberId?: string }
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Invalid JSON body')
  }

  const memberId = parsed.memberId?.trim()
  if (!memberId) {
    throw new Error('Missing memberId')
  }

  return {
    initData: payload.initData,
    memberId
  }
}

async function readRentWeightPayload(request: Request): Promise<{
  initData: string
  memberId: string
  rentShareWeight: number
}> {
  const clonedRequest = request.clone()
  const payload = await readMiniAppRequestPayload(request)
  if (!payload.initData) {
    throw new Error('Missing initData')
  }

  const text = await clonedRequest.text()
  let parsed: { memberId?: string; rentShareWeight?: number }
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Invalid JSON body')
  }

  const memberId = parsed.memberId?.trim()
  if (!memberId || typeof parsed.rentShareWeight !== 'number') {
    throw new Error('Missing member rent weight fields')
  }

  return {
    initData: payload.initData,
    memberId,
    rentShareWeight: parsed.rentShareWeight
  }
}

function serializeBillingSettings(settings: HouseholdBillingSettingsRecord) {
  return {
    householdId: settings.householdId,
    settlementCurrency: settings.settlementCurrency,
    rentAmountMinor: settings.rentAmountMinor?.toString() ?? null,
    rentCurrency: settings.rentCurrency,
    rentDueDay: settings.rentDueDay,
    rentWarningDay: settings.rentWarningDay,
    utilitiesDueDay: settings.utilitiesDueDay,
    utilitiesReminderDay: settings.utilitiesReminderDay,
    timezone: settings.timezone
  }
}

async function authenticateAdminSession(
  request: Request,
  sessionService: ReturnType<typeof createMiniAppSessionService>,
  origin: string | undefined
): Promise<
  | Response
  | {
      member: NonNullable<MiniAppSessionResult['member']>
    }
> {
  const payload = await readMiniAppRequestPayload(request)
  if (!payload.initData) {
    return miniAppJsonResponse({ ok: false, error: 'Missing initData' }, 400, origin)
  }

  const session = await sessionService.authenticate(payload)
  if (!session) {
    return miniAppJsonResponse({ ok: false, error: 'Invalid Telegram init data' }, 401, origin)
  }

  if (!session.authorized || !session.member) {
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

export function createMiniAppSettingsHandler(options: {
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
        const auth = await authenticateAdminSession(request, sessionService, origin)
        if (auth instanceof Response) {
          return auth
        }
        const { member } = auth

        const result = await options.miniAppAdminService.getSettings({
          householdId: member.householdId,
          actorIsAdmin: member.isAdmin
        })

        if (result.status === 'rejected') {
          return miniAppJsonResponse({ ok: false, error: 'Admin access required' }, 403, origin)
        }

        return miniAppJsonResponse(
          {
            ok: true,
            authorized: true,
            settings: serializeBillingSettings(result.settings),
            topics: result.topics,
            categories: result.categories,
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

export function createMiniAppUpdateSettingsHandler(options: {
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
        const payload = await readSettingsUpdatePayload(request)
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

        const result = await options.miniAppAdminService.updateSettings({
          householdId: session.member.householdId,
          actorIsAdmin: session.member.isAdmin,
          ...(payload.settlementCurrency
            ? {
                settlementCurrency: payload.settlementCurrency
              }
            : {}),
          ...(payload.rentAmountMajor !== undefined
            ? {
                rentAmountMajor: payload.rentAmountMajor
              }
            : {}),
          ...(payload.rentCurrency
            ? {
                rentCurrency: payload.rentCurrency
              }
            : {}),
          rentDueDay: payload.rentDueDay,
          rentWarningDay: payload.rentWarningDay,
          utilitiesDueDay: payload.utilitiesDueDay,
          utilitiesReminderDay: payload.utilitiesReminderDay,
          timezone: payload.timezone
        })

        if (result.status === 'rejected') {
          return miniAppJsonResponse(
            {
              ok: false,
              error:
                result.reason === 'invalid_settings'
                  ? 'Invalid billing settings'
                  : 'Admin access required'
            },
            result.reason === 'invalid_settings' ? 400 : 403,
            origin
          )
        }

        return miniAppJsonResponse(
          {
            ok: true,
            authorized: true,
            settings: serializeBillingSettings(result.settings)
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

export function createMiniAppUpsertUtilityCategoryHandler(options: {
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
        const payload = await readUtilityCategoryPayload(request)
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

        const result = await options.miniAppAdminService.upsertUtilityCategory({
          householdId: session.member.householdId,
          actorIsAdmin: session.member.isAdmin,
          ...(payload.slug
            ? {
                slug: payload.slug
              }
            : {}),
          name: payload.name,
          sortOrder: payload.sortOrder,
          isActive: payload.isActive
        })

        if (result.status === 'rejected') {
          return miniAppJsonResponse(
            {
              ok: false,
              error:
                result.reason === 'invalid_category'
                  ? 'Invalid utility category'
                  : 'Admin access required'
            },
            result.reason === 'invalid_category' ? 400 : 403,
            origin
          )
        }

        return miniAppJsonResponse(
          {
            ok: true,
            authorized: true,
            category: result.category
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

export function createMiniAppPromoteMemberHandler(options: {
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
        const payload = await readPromoteMemberPayload(request)
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

        const result = await options.miniAppAdminService.promoteMemberToAdmin({
          householdId: session.member.householdId,
          actorIsAdmin: session.member.isAdmin,
          memberId: payload.memberId
        })

        if (result.status === 'rejected') {
          return miniAppJsonResponse(
            {
              ok: false,
              error:
                result.reason === 'member_not_found' ? 'Member not found' : 'Admin access required'
            },
            result.reason === 'member_not_found' ? 404 : 403,
            origin
          )
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

export function createMiniAppUpdateMemberRentWeightHandler(options: {
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
        const payload = await readRentWeightPayload(request)
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

        const result = await options.miniAppAdminService.updateMemberRentShareWeight({
          householdId: session.member.householdId,
          actorIsAdmin: session.member.isAdmin,
          memberId: payload.memberId,
          rentShareWeight: payload.rentShareWeight
        })

        if (result.status === 'rejected') {
          return miniAppJsonResponse(
            {
              ok: false,
              error:
                result.reason === 'invalid_weight'
                  ? 'Invalid rent share weight'
                  : result.reason === 'member_not_found'
                    ? 'Member not found'
                    : 'Admin access required'
            },
            result.reason === 'invalid_weight'
              ? 400
              : result.reason === 'member_not_found'
                ? 404
                : 403,
            origin
          )
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
