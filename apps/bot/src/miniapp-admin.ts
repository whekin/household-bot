import type { HouseholdOnboardingService, MiniAppAdminService } from '@household/application'
import type { Logger } from '@household/observability'
import {
  HOUSEHOLD_MEMBER_ABSENCE_POLICIES,
  HOUSEHOLD_MEMBER_LIFECYCLE_STATUSES,
  type HouseholdBillingSettingsRecord,
  type HouseholdMemberAbsencePolicy,
  type HouseholdMemberLifecycleStatus
} from '@household/ports'
import type { MiniAppSessionResult } from './miniapp-auth'
import type { AssistantUsageTracker } from './dm-assistant'

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
  householdName?: string
  settlementCurrency?: string
  paymentBalanceAdjustmentPolicy?: string
  rentAmountMajor?: string
  rentCurrency?: string
  rentDueDay: number
  rentWarningDay: number
  utilitiesDueDay: number
  utilitiesReminderDay: number
  timezone: string
  assistantContext?: string
  assistantTone?: string
}> {
  const clonedRequest = request.clone()
  const payload = await readMiniAppRequestPayload(request)
  if (!payload.initData) {
    throw new Error('Missing initData')
  }

  const text = await clonedRequest.text()
  let parsed: {
    householdName?: string
    settlementCurrency?: string
    paymentBalanceAdjustmentPolicy?: string
    rentAmountMajor?: string
    rentCurrency?: string
    rentDueDay?: number
    rentWarningDay?: number
    utilitiesDueDay?: number
    utilitiesReminderDay?: number
    timezone?: string
    assistantContext?: string
    assistantTone?: string
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
    ...(typeof parsed.householdName === 'string'
      ? {
          householdName: parsed.householdName
        }
      : {}),
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
    ...(typeof parsed.paymentBalanceAdjustmentPolicy === 'string'
      ? {
          paymentBalanceAdjustmentPolicy: parsed.paymentBalanceAdjustmentPolicy
        }
      : {}),
    ...(typeof parsed.rentCurrency === 'string'
      ? {
          rentCurrency: parsed.rentCurrency
        }
      : {}),
    ...(typeof parsed.assistantContext === 'string'
      ? {
          assistantContext: parsed.assistantContext
        }
      : {}),
    ...(typeof parsed.assistantTone === 'string'
      ? {
          assistantTone: parsed.assistantTone
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

async function readDisplayNamePayload(request: Request): Promise<{
  initData: string
  displayName: string
  memberId?: string
}> {
  const clonedRequest = request.clone()
  const payload = await readMiniAppRequestPayload(request)
  if (!payload.initData) {
    throw new Error('Missing initData')
  }

  const text = await clonedRequest.text()
  let parsed: { memberId?: string; displayName?: string }
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Invalid JSON body')
  }

  const displayName = parsed.displayName?.trim()
  if (!displayName) {
    throw new Error('Missing displayName')
  }

  return {
    initData: payload.initData,
    displayName,
    ...(typeof parsed.memberId === 'string' && parsed.memberId.trim().length > 0
      ? {
          memberId: parsed.memberId.trim()
        }
      : {})
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

async function readMemberStatusPayload(request: Request): Promise<{
  initData: string
  memberId: string
  status: HouseholdMemberLifecycleStatus
}> {
  const clonedRequest = request.clone()
  const payload = await readMiniAppRequestPayload(request)
  if (!payload.initData) {
    throw new Error('Missing initData')
  }

  const text = await clonedRequest.text()
  let parsed: { memberId?: string; status?: string }
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Invalid JSON body')
  }

  const memberId = parsed.memberId?.trim()
  const status = parsed.status?.trim().toLowerCase()
  if (!memberId || !status) {
    throw new Error('Missing member status fields')
  }

  if (!(HOUSEHOLD_MEMBER_LIFECYCLE_STATUSES as readonly string[]).includes(status)) {
    throw new Error('Invalid member status')
  }

  return {
    initData: payload.initData,
    memberId,
    status: status as HouseholdMemberLifecycleStatus
  }
}

async function readMemberAbsencePolicyPayload(request: Request): Promise<{
  initData: string
  memberId: string
  policy: HouseholdMemberAbsencePolicy
}> {
  const clonedRequest = request.clone()
  const payload = await readMiniAppRequestPayload(request)
  if (!payload.initData) {
    throw new Error('Missing initData')
  }

  const text = await clonedRequest.text()
  let parsed: { memberId?: string; policy?: string }
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Invalid JSON body')
  }

  const memberId = parsed.memberId?.trim()
  const policy = parsed.policy?.trim().toLowerCase()
  if (!memberId || !policy) {
    throw new Error('Missing member absence policy fields')
  }

  if (!(HOUSEHOLD_MEMBER_ABSENCE_POLICIES as readonly string[]).includes(policy)) {
    throw new Error('Invalid member absence policy')
  }

  return {
    initData: payload.initData,
    memberId,
    policy: policy as HouseholdMemberAbsencePolicy
  }
}

function serializeBillingSettings(settings: HouseholdBillingSettingsRecord) {
  return {
    householdId: settings.householdId,
    settlementCurrency: settings.settlementCurrency,
    paymentBalanceAdjustmentPolicy: settings.paymentBalanceAdjustmentPolicy ?? 'utilities',
    rentAmountMinor: settings.rentAmountMinor?.toString() ?? null,
    rentCurrency: settings.rentCurrency,
    rentDueDay: settings.rentDueDay,
    rentWarningDay: settings.rentWarningDay,
    utilitiesDueDay: settings.utilitiesDueDay,
    utilitiesReminderDay: settings.utilitiesReminderDay,
    timezone: settings.timezone
  }
}

function serializeAssistantConfig(config: {
  householdId: string
  assistantContext: string | null
  assistantTone: string | null
}) {
  return {
    householdId: config.householdId,
    assistantContext: config.assistantContext,
    assistantTone: config.assistantTone
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
      { ok: false, error: 'Admin access required for active household members' },
      403,
      origin
    )
  }

  if (session.member.status !== 'active' || !session.member.isAdmin) {
    return miniAppJsonResponse(
      { ok: false, error: 'Admin access required for active household members' },
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

        if (
          !session.authorized ||
          !session.member ||
          session.member.status !== 'active' ||
          !session.member.isAdmin
        ) {
          return miniAppJsonResponse(
            { ok: false, error: 'Admin access required for active household members' },
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
  assistantUsageTracker?: AssistantUsageTracker
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
            householdName: result.householdName,
            settings: serializeBillingSettings(result.settings),
            assistantConfig: serializeAssistantConfig(result.assistantConfig),
            topics: result.topics,
            categories: result.categories,
            members: result.members,
            memberAbsencePolicies: result.memberAbsencePolicies,
            assistantUsage:
              options.assistantUsageTracker?.listHouseholdUsage(member.householdId) ?? []
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

        if (
          !session.authorized ||
          !session.member ||
          session.member.status !== 'active' ||
          !session.member.isAdmin
        ) {
          return miniAppJsonResponse(
            { ok: false, error: 'Admin access required for active household members' },
            403,
            origin
          )
        }

        const result = await options.miniAppAdminService.updateSettings({
          householdId: session.member.householdId,
          actorIsAdmin: session.member.isAdmin,
          ...(payload.householdName !== undefined
            ? {
                householdName: payload.householdName
              }
            : {}),
          ...(payload.settlementCurrency
            ? {
                settlementCurrency: payload.settlementCurrency
              }
            : {}),
          ...(payload.paymentBalanceAdjustmentPolicy
            ? {
                paymentBalanceAdjustmentPolicy: payload.paymentBalanceAdjustmentPolicy
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
          timezone: payload.timezone,
          ...(payload.assistantContext !== undefined
            ? {
                assistantContext: payload.assistantContext
              }
            : {}),
          ...(payload.assistantTone !== undefined
            ? {
                assistantTone: payload.assistantTone
              }
            : {})
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
            householdName: result.householdName,
            settings: serializeBillingSettings(result.settings),
            assistantConfig: serializeAssistantConfig(result.assistantConfig)
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

        if (
          !session.authorized ||
          !session.member ||
          session.member.status !== 'active' ||
          !session.member.isAdmin
        ) {
          return miniAppJsonResponse(
            { ok: false, error: 'Admin access required for active household members' },
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

        if (
          !session.authorized ||
          !session.member ||
          session.member.status !== 'active' ||
          !session.member.isAdmin
        ) {
          return miniAppJsonResponse(
            { ok: false, error: 'Admin access required for active household members' },
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

export function createMiniAppUpdateOwnDisplayNameHandler(options: {
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
        const payload = await readDisplayNamePayload(request)
        const session = await sessionService.authenticate({
          initData: payload.initData
        })

        if (!session || !session.authorized || !session.member) {
          return miniAppJsonResponse(
            { ok: false, error: 'Active household membership required' },
            session ? 403 : 401,
            origin
          )
        }

        const result = await options.miniAppAdminService.updateOwnDisplayName({
          householdId: session.member.householdId,
          actorMemberId: session.member.id,
          displayName: payload.displayName
        })

        if (result.status === 'rejected') {
          return miniAppJsonResponse(
            {
              ok: false,
              error:
                result.reason === 'invalid_display_name'
                  ? 'Invalid display name'
                  : 'Member not found'
            },
            result.reason === 'invalid_display_name' ? 400 : 404,
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

        if (
          !session.authorized ||
          !session.member ||
          session.member.status !== 'active' ||
          !session.member.isAdmin
        ) {
          return miniAppJsonResponse(
            { ok: false, error: 'Admin access required for active household members' },
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

export function createMiniAppUpdateMemberDisplayNameHandler(options: {
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
        const payload = await readDisplayNamePayload(request)
        const session = await sessionService.authenticate({
          initData: payload.initData
        })

        if (
          !session ||
          !session.authorized ||
          !session.member ||
          session.member.status !== 'active' ||
          !session.member.isAdmin
        ) {
          return miniAppJsonResponse(
            { ok: false, error: 'Admin access required for active household members' },
            session ? 403 : 401,
            origin
          )
        }

        if (!payload.memberId) {
          return miniAppJsonResponse({ ok: false, error: 'Missing memberId' }, 400, origin)
        }

        const result = await options.miniAppAdminService.updateMemberDisplayName({
          householdId: session.member.householdId,
          actorIsAdmin: session.member.isAdmin,
          memberId: payload.memberId,
          displayName: payload.displayName
        })

        if (result.status === 'rejected') {
          return miniAppJsonResponse(
            {
              ok: false,
              error:
                result.reason === 'invalid_display_name'
                  ? 'Invalid display name'
                  : result.reason === 'member_not_found'
                    ? 'Member not found'
                    : 'Admin access required'
            },
            result.reason === 'invalid_display_name'
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

export function createMiniAppUpdateMemberStatusHandler(options: {
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
        const payload = await readMemberStatusPayload(request)
        const session = await sessionService.authenticate({
          initData: payload.initData
        })

        if (
          !session ||
          !session.authorized ||
          !session.member ||
          session.member.status !== 'active' ||
          !session.member.isAdmin
        ) {
          return miniAppJsonResponse(
            { ok: false, error: 'Admin access required for active household members' },
            session ? 403 : 401,
            origin
          )
        }

        const result = await options.miniAppAdminService.updateMemberStatus({
          householdId: session.member.householdId,
          actorIsAdmin: session.member.isAdmin,
          memberId: payload.memberId,
          status: payload.status
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

export function createMiniAppUpdateMemberAbsencePolicyHandler(options: {
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
        const payload = await readMemberAbsencePolicyPayload(request)
        const session = await sessionService.authenticate({
          initData: payload.initData
        })

        if (
          !session ||
          !session.authorized ||
          !session.member ||
          session.member.status !== 'active' ||
          !session.member.isAdmin
        ) {
          return miniAppJsonResponse(
            { ok: false, error: 'Admin access required for active household members' },
            session ? 403 : 401,
            origin
          )
        }

        const result = await options.miniAppAdminService.updateMemberAbsencePolicy({
          householdId: session.member.householdId,
          actorIsAdmin: session.member.isAdmin,
          memberId: payload.memberId,
          policy: payload.policy
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
            policy: result.policy
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

        if (
          !session.authorized ||
          !session.member ||
          session.member.status !== 'active' ||
          !session.member.isAdmin
        ) {
          return miniAppJsonResponse(
            { ok: false, error: 'Admin access required for active household members' },
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

export function createMiniAppRejectMemberHandler(options: {
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

        if (
          !session.authorized ||
          !session.member ||
          session.member.status !== 'active' ||
          !session.member.isAdmin
        ) {
          return miniAppJsonResponse(
            { ok: false, error: 'Admin access required for active household members' },
            403,
            origin
          )
        }

        const result = await options.miniAppAdminService.rejectPendingMember({
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
            authorized: true
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
