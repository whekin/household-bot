import type { FinanceCommandService, HouseholdOnboardingService } from '@household/application'
import { BillingPeriod } from '@household/domain'
import type { Logger } from '@household/observability'
import type { MiniAppSessionResult } from './miniapp-auth'

import {
  allowedMiniAppOrigin,
  createMiniAppSessionService,
  miniAppErrorResponse,
  miniAppJsonResponse,
  readMiniAppRequestPayload
} from './miniapp-auth'

function serializeCycleState(
  state: Awaited<ReturnType<FinanceCommandService['getAdminCycleState']>>
) {
  return {
    cycle: state.cycle,
    rentRule: state.rentRule
      ? {
          amountMinor: state.rentRule.amountMinor.toString(),
          currency: state.rentRule.currency
        }
      : null,
    utilityBills: state.utilityBills.map((bill) => ({
      id: bill.id,
      billName: bill.billName,
      amountMinor: bill.amount.amountMinor.toString(),
      currency: bill.currency,
      createdByMemberId: bill.createdByMemberId,
      createdAt: bill.createdAt.toString()
    }))
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

  if (!session.member.isAdmin) {
    return miniAppJsonResponse({ ok: false, error: 'Admin access required' }, 403, origin)
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

async function readCycleQueryPayload(request: Request): Promise<{
  initData: string
  period?: string
}> {
  const parsed = await parseJsonBody<{
    initData?: string
    period?: string
  }>(request)
  const initData = parsed.initData?.trim()
  if (!initData) {
    throw new Error('Missing initData')
  }
  const period = parsed.period?.trim()

  return {
    initData,
    ...(period
      ? {
          period: BillingPeriod.fromString(period).toString()
        }
      : {})
  }
}

async function readOpenCyclePayload(request: Request): Promise<{
  initData: string
  period: string
  currency?: string
}> {
  const parsed = await parseJsonBody<{ initData?: string; period?: string; currency?: string }>(
    request
  )
  const initData = parsed.initData?.trim()
  if (!initData) {
    throw new Error('Missing initData')
  }
  if (typeof parsed.period !== 'string' || parsed.period.trim().length === 0) {
    throw new Error('Missing billing cycle period')
  }

  const currency = parsed.currency?.trim()

  return {
    initData,
    period: BillingPeriod.fromString(parsed.period.trim()).toString(),
    ...(currency
      ? {
          currency
        }
      : {})
  }
}

async function readRentUpdatePayload(request: Request): Promise<{
  initData: string
  amountMajor: string
  currency?: string
  period?: string
}> {
  const parsed = await parseJsonBody<{
    initData?: string
    amountMajor?: string
    currency?: string
    period?: string
  }>(request)
  const initData = parsed.initData?.trim()
  if (!initData) {
    throw new Error('Missing initData')
  }
  const amountMajor = parsed.amountMajor?.trim()
  if (!amountMajor) {
    throw new Error('Missing rent amount')
  }

  const currency = parsed.currency?.trim()
  const period = parsed.period?.trim()

  return {
    initData,
    amountMajor,
    ...(currency
      ? {
          currency
        }
      : {}),
    ...(period
      ? {
          period: BillingPeriod.fromString(period).toString()
        }
      : {})
  }
}

async function readUtilityBillPayload(request: Request): Promise<{
  initData: string
  billName: string
  amountMajor: string
  currency?: string
}> {
  const parsed = await parseJsonBody<{
    initData?: string
    billName?: string
    amountMajor?: string
    currency?: string
  }>(request)
  const initData = parsed.initData?.trim()
  if (!initData) {
    throw new Error('Missing initData')
  }
  const billName = parsed.billName?.trim()
  const amountMajor = parsed.amountMajor?.trim()

  if (!billName) {
    throw new Error('Missing utility bill name')
  }

  if (!amountMajor) {
    throw new Error('Missing utility bill amount')
  }

  const currency = parsed.currency?.trim()

  return {
    initData,
    billName,
    amountMajor,
    ...(currency
      ? {
          currency
        }
      : {})
  }
}

async function readUtilityBillUpdatePayload(request: Request): Promise<{
  initData: string
  billId: string
  billName: string
  amountMajor: string
  currency?: string
}> {
  const parsed = await parseJsonBody<{
    initData?: string
    billId?: string
    billName?: string
    amountMajor?: string
    currency?: string
  }>(request)
  const initData = parsed.initData?.trim()
  if (!initData) {
    throw new Error('Missing initData')
  }
  const billId = parsed.billId?.trim()
  const billName = parsed.billName?.trim()
  const amountMajor = parsed.amountMajor?.trim()

  if (!billId) {
    throw new Error('Missing utility bill id')
  }
  if (!billName) {
    throw new Error('Missing utility bill name')
  }
  if (!amountMajor) {
    throw new Error('Missing utility bill amount')
  }

  const currency = parsed.currency?.trim()

  return {
    initData,
    billId,
    billName,
    amountMajor,
    ...(currency ? { currency } : {})
  }
}

async function readUtilityBillDeletePayload(request: Request): Promise<{
  initData: string
  billId: string
}> {
  const parsed = await parseJsonBody<{
    initData?: string
    billId?: string
  }>(request)
  const initData = parsed.initData?.trim()
  if (!initData) {
    throw new Error('Missing initData')
  }
  const billId = parsed.billId?.trim()
  if (!billId) {
    throw new Error('Missing utility bill id')
  }

  return {
    initData,
    billId
  }
}

export function createMiniAppBillingCycleHandler(options: {
  allowedOrigins: readonly string[]
  botToken: string
  financeServiceForHousehold: (householdId: string) => FinanceCommandService
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
        const auth = await authenticateAdminSession(
          request.clone() as Request,
          sessionService,
          origin
        )
        if (auth instanceof Response) {
          return auth
        }

        const payload = await readCycleQueryPayload(request)
        const cycleState = await options
          .financeServiceForHousehold(auth.member.householdId)
          .getAdminCycleState(payload.period)

        return miniAppJsonResponse(
          {
            ok: true,
            authorized: true,
            cycleState: serializeCycleState(cycleState)
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

export function createMiniAppOpenCycleHandler(options: {
  allowedOrigins: readonly string[]
  botToken: string
  financeServiceForHousehold: (householdId: string) => FinanceCommandService
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
        const auth = await authenticateAdminSession(
          request.clone() as Request,
          sessionService,
          origin
        )
        if (auth instanceof Response) {
          return auth
        }

        const payload = await readOpenCyclePayload(request)
        const service = options.financeServiceForHousehold(auth.member.householdId)
        await service.openCycle(payload.period, payload.currency)
        const cycleState = await service.getAdminCycleState(payload.period)

        return miniAppJsonResponse(
          {
            ok: true,
            authorized: true,
            cycleState: serializeCycleState(cycleState)
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

export function createMiniAppCloseCycleHandler(options: {
  allowedOrigins: readonly string[]
  botToken: string
  financeServiceForHousehold: (householdId: string) => FinanceCommandService
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
        const auth = await authenticateAdminSession(
          request.clone() as Request,
          sessionService,
          origin
        )
        if (auth instanceof Response) {
          return auth
        }

        const payload = await readCycleQueryPayload(request)
        const service = options.financeServiceForHousehold(auth.member.householdId)
        await service.closeCycle(payload.period)
        const cycleState = await service.getAdminCycleState()

        return miniAppJsonResponse(
          {
            ok: true,
            authorized: true,
            cycleState: serializeCycleState(cycleState)
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

export function createMiniAppRentUpdateHandler(options: {
  allowedOrigins: readonly string[]
  botToken: string
  financeServiceForHousehold: (householdId: string) => FinanceCommandService
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
        const auth = await authenticateAdminSession(
          request.clone() as Request,
          sessionService,
          origin
        )
        if (auth instanceof Response) {
          return auth
        }

        const payload = await readRentUpdatePayload(request)
        const service = options.financeServiceForHousehold(auth.member.householdId)
        const result = await service.setRent(payload.amountMajor, payload.currency, payload.period)
        if (!result) {
          return miniAppJsonResponse(
            { ok: false, error: 'No billing cycle available' },
            404,
            origin
          )
        }

        const cycleState = await service.getAdminCycleState(result.period)

        return miniAppJsonResponse(
          {
            ok: true,
            authorized: true,
            cycleState: serializeCycleState(cycleState)
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

export function createMiniAppAddUtilityBillHandler(options: {
  allowedOrigins: readonly string[]
  botToken: string
  financeServiceForHousehold: (householdId: string) => FinanceCommandService
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
        const auth = await authenticateAdminSession(
          request.clone() as Request,
          sessionService,
          origin
        )
        if (auth instanceof Response) {
          return auth
        }

        const payload = await readUtilityBillPayload(request)
        const service = options.financeServiceForHousehold(auth.member.householdId)
        const result = await service.addUtilityBill(
          payload.billName,
          payload.amountMajor,
          auth.member.id,
          payload.currency
        )

        if (!result) {
          return miniAppJsonResponse(
            { ok: false, error: 'No billing cycle available' },
            404,
            origin
          )
        }

        const cycleState = await service.getAdminCycleState(result.period)

        return miniAppJsonResponse(
          {
            ok: true,
            authorized: true,
            cycleState: serializeCycleState(cycleState)
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

export function createMiniAppUpdateUtilityBillHandler(options: {
  allowedOrigins: readonly string[]
  botToken: string
  financeServiceForHousehold: (householdId: string) => FinanceCommandService
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
        const auth = await authenticateAdminSession(
          request.clone() as Request,
          sessionService,
          origin
        )
        if (auth instanceof Response) {
          return auth
        }

        const payload = await readUtilityBillUpdatePayload(request)
        const service = options.financeServiceForHousehold(auth.member.householdId)
        const result = await service.updateUtilityBill(
          payload.billId,
          payload.billName,
          payload.amountMajor,
          payload.currency
        )

        if (!result) {
          return miniAppJsonResponse({ ok: false, error: 'Utility bill not found' }, 404, origin)
        }

        const cycleState = await service.getAdminCycleState()

        return miniAppJsonResponse(
          {
            ok: true,
            authorized: true,
            cycleState: serializeCycleState(cycleState)
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

export function createMiniAppDeleteUtilityBillHandler(options: {
  allowedOrigins: readonly string[]
  botToken: string
  financeServiceForHousehold: (householdId: string) => FinanceCommandService
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
        const auth = await authenticateAdminSession(
          request.clone() as Request,
          sessionService,
          origin
        )
        if (auth instanceof Response) {
          return auth
        }

        const payload = await readUtilityBillDeletePayload(request)
        const service = options.financeServiceForHousehold(auth.member.householdId)
        const deleted = await service.deleteUtilityBill(payload.billId)

        if (!deleted) {
          return miniAppJsonResponse({ ok: false, error: 'Utility bill not found' }, 404, origin)
        }

        const cycleState = await service.getAdminCycleState()

        return miniAppJsonResponse(
          {
            ok: true,
            authorized: true,
            cycleState: serializeCycleState(cycleState)
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
