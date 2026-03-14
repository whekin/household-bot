import type { FinanceCommandService, HouseholdOnboardingService } from '@household/application'
import { BillingPeriod } from '@household/domain'
import type { Logger } from '@household/observability'
import type { HouseholdConfigurationRepository } from '@household/ports'
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
  const payload = await readMiniAppRequestPayload(request)
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

async function readAddPurchasePayload(request: Request): Promise<{
  initData: string
  description: string
  amountMajor: string
  currency?: string
  split?: {
    mode: 'equal' | 'custom_amounts'
    participants: {
      memberId: string
      included?: boolean
      shareAmountMajor?: string
    }[]
  }
}> {
  const parsed = await parseJsonBody<{
    initData?: string
    description?: string
    amountMajor?: string
    currency?: string
    split?: {
      mode?: string
      participants?: {
        memberId?: string
        included?: boolean
        shareAmountMajor?: string
      }[]
    }
  }>(request)
  const initData = parsed.initData?.trim()
  if (!initData) {
    throw new Error('Missing initData')
  }
  const description = parsed.description?.trim()
  if (!description) {
    throw new Error('Missing description')
  }
  const amountMajor = parsed.amountMajor?.trim()
  if (!amountMajor) {
    throw new Error('Missing amountMajor')
  }

  return {
    initData,
    description,
    amountMajor,
    ...(parsed.currency !== undefined
      ? {
          currency: parsed.currency
        }
      : {}),
    ...(parsed.split !== undefined
      ? {
          split: {
            mode: (parsed.split.mode ?? 'equal') as 'equal' | 'custom_amounts',
            participants: (parsed.split.participants ?? []).filter(
              (p): p is { memberId: string; included?: boolean; shareAmountMajor?: string } =>
                p.memberId !== undefined
            )
          }
        }
      : {})
  }
}

async function readPurchaseMutationPayload(request: Request): Promise<{
  initData: string
  purchaseId: string
  description?: string
  amountMajor?: string
  currency?: string
  split?: {
    mode: 'equal' | 'custom_amounts'
    participants: {
      memberId: string
      shareAmountMajor?: string
    }[]
  }
}> {
  const parsed = await parseJsonBody<{
    initData?: string
    purchaseId?: string
    description?: string
    amountMajor?: string
    currency?: string
    split?: {
      mode?: string
      participants?: {
        memberId?: string
        shareAmountMajor?: string
      }[]
    }
  }>(request)
  const initData = parsed.initData?.trim()
  if (!initData) {
    throw new Error('Missing initData')
  }
  const purchaseId = parsed.purchaseId?.trim()
  if (!purchaseId) {
    throw new Error('Missing purchase id')
  }

  return {
    initData,
    purchaseId,
    ...(parsed.description !== undefined
      ? {
          description: parsed.description.trim()
        }
      : {}),
    ...(parsed.amountMajor !== undefined
      ? {
          amountMajor: parsed.amountMajor.trim()
        }
      : {}),
    ...(parsed.currency?.trim()
      ? {
          currency: parsed.currency.trim()
        }
      : {}),
    ...(parsed.split &&
    (parsed.split.mode === 'equal' || parsed.split.mode === 'custom_amounts') &&
    Array.isArray(parsed.split.participants)
      ? {
          split: {
            mode: parsed.split.mode,
            participants: parsed.split.participants
              .map((participant) => {
                const memberId = participant.memberId?.trim()
                if (!memberId) {
                  return null
                }

                return {
                  memberId,
                  ...(participant.shareAmountMajor?.trim()
                    ? {
                        shareAmountMajor: participant.shareAmountMajor.trim()
                      }
                    : {})
                }
              })
              .filter((participant) => participant !== null)
          }
        }
      : {})
  }
}

async function readPaymentMutationPayload(request: Request): Promise<{
  initData: string
  paymentId?: string
  memberId?: string
  kind?: 'rent' | 'utilities'
  amountMajor?: string
  currency?: string
}> {
  const parsed = await parseJsonBody<{
    initData?: string
    paymentId?: string
    memberId?: string
    kind?: 'rent' | 'utilities'
    amountMajor?: string
    currency?: string
  }>(request)
  const initData = parsed.initData?.trim()
  if (!initData) {
    throw new Error('Missing initData')
  }

  return {
    initData,
    ...(parsed.paymentId?.trim()
      ? {
          paymentId: parsed.paymentId.trim()
        }
      : {}),
    ...(parsed.memberId?.trim()
      ? {
          memberId: parsed.memberId.trim()
        }
      : {}),
    ...(parsed.kind
      ? {
          kind: parsed.kind
        }
      : {}),
    ...(parsed.amountMajor?.trim()
      ? {
          amountMajor: parsed.amountMajor.trim()
        }
      : {}),
    ...(parsed.currency?.trim()
      ? {
          currency: parsed.currency.trim()
        }
      : {})
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

export function createMiniAppSubmitUtilityBillHandler(options: {
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
        const auth = await authenticateMemberSession(
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

export function createMiniAppSubmitPaymentHandler(options: {
  allowedOrigins: readonly string[]
  botToken: string
  financeServiceForHousehold: (householdId: string) => FinanceCommandService
  onboardingService: HouseholdOnboardingService
  householdConfigurationRepository: HouseholdConfigurationRepository
  logger?: Logger
}): {
  handler: (request: Request) => Promise<Response>
} {
  const sessionService = createMiniAppSessionService({
    botToken: options.botToken,
    onboardingService: options.onboardingService
  })

  async function notifyPaymentRecorded(input: {
    householdId: string
    memberName: string
    kind: 'rent' | 'utilities'
    amountMajor: string
    currency: string
    period: string
  }) {
    const [chat, topic] = await Promise.all([
      options.householdConfigurationRepository.getHouseholdChatByHouseholdId(input.householdId),
      options.householdConfigurationRepository.getHouseholdTopicBinding(
        input.householdId,
        'reminders'
      )
    ])

    if (!chat || !topic) {
      return
    }

    const threadId = Number.parseInt(topic.telegramThreadId, 10)
    if (!Number.isFinite(threadId)) {
      return
    }

    const response = await fetch(`https://api.telegram.org/bot${options.botToken}/sendMessage`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        chat_id: chat.telegramChatId,
        message_thread_id: threadId,
        text: `${input.memberName} recorded a ${input.kind} payment: ${input.amountMajor} ${input.currency} (${input.period})`
      })
    })

    if (!response.ok && options.logger) {
      options.logger.warn(
        {
          event: 'miniapp.payment_notification_failed',
          householdId: input.householdId,
          status: response.status
        },
        'Failed to notify payment topic'
      )
    }
  }

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
        const auth = await authenticateMemberSession(
          request.clone() as Request,
          sessionService,
          origin
        )
        if (auth instanceof Response) {
          return auth
        }

        const payload = await readPaymentMutationPayload(request)
        if (!payload.kind || !payload.amountMajor) {
          return miniAppJsonResponse({ ok: false, error: 'Missing payment fields' }, 400, origin)
        }

        const service = options.financeServiceForHousehold(auth.member.householdId)
        const payment = await service.addPayment(
          auth.member.id,
          payload.kind,
          payload.amountMajor,
          payload.currency
        )

        if (!payment) {
          return miniAppJsonResponse({ ok: false, error: 'Failed to record payment' }, 500, origin)
        }

        await notifyPaymentRecorded({
          householdId: auth.member.householdId,
          memberName: auth.member.displayName,
          kind: payload.kind,
          amountMajor: payment.amount.toMajorString(),
          currency: payment.currency,
          period: payment.period
        })

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

export function createMiniAppAddPurchaseHandler(options: {
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

        const payload = await readAddPurchasePayload(request)
        if (!payload.description || !payload.amountMajor) {
          return miniAppJsonResponse({ ok: false, error: 'Missing purchase fields' }, 400, origin)
        }

        const service = options.financeServiceForHousehold(auth.member.householdId)
        await service.addPurchase(
          payload.description,
          payload.amountMajor,
          auth.member.id,
          payload.currency,
          payload.split
        )

        return miniAppJsonResponse({ ok: true, authorized: true }, 200, origin)
      } catch (error) {
        return miniAppErrorResponse(error, origin, options.logger)
      }
    }
  }
}

export function createMiniAppUpdatePurchaseHandler(options: {
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

        const payload = await readPurchaseMutationPayload(request)
        if (!payload.description || !payload.amountMajor) {
          return miniAppJsonResponse({ ok: false, error: 'Missing purchase fields' }, 400, origin)
        }

        const service = options.financeServiceForHousehold(auth.member.householdId)
        const updated = await service.updatePurchase(
          payload.purchaseId,
          payload.description,
          payload.amountMajor,
          payload.currency,
          payload.split
        )

        if (!updated) {
          return miniAppJsonResponse({ ok: false, error: 'Purchase not found' }, 404, origin)
        }

        return miniAppJsonResponse({ ok: true, authorized: true }, 200, origin)
      } catch (error) {
        return miniAppErrorResponse(error, origin, options.logger)
      }
    }
  }
}

export function createMiniAppDeletePurchaseHandler(options: {
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

        const payload = await readPurchaseMutationPayload(request)
        const service = options.financeServiceForHousehold(auth.member.householdId)
        const deleted = await service.deletePurchase(payload.purchaseId)

        if (!deleted) {
          return miniAppJsonResponse({ ok: false, error: 'Purchase not found' }, 404, origin)
        }

        return miniAppJsonResponse({ ok: true, authorized: true }, 200, origin)
      } catch (error) {
        return miniAppErrorResponse(error, origin, options.logger)
      }
    }
  }
}

export function createMiniAppAddPaymentHandler(options: {
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

        const payload = await readPaymentMutationPayload(request)
        if (!payload.memberId || !payload.kind || !payload.amountMajor) {
          return miniAppJsonResponse({ ok: false, error: 'Missing payment fields' }, 400, origin)
        }

        const service = options.financeServiceForHousehold(auth.member.householdId)
        const payment = await service.addPayment(
          payload.memberId,
          payload.kind,
          payload.amountMajor,
          payload.currency
        )

        if (!payment) {
          return miniAppJsonResponse({ ok: false, error: 'No open billing cycle' }, 409, origin)
        }

        return miniAppJsonResponse({ ok: true, authorized: true }, 200, origin)
      } catch (error) {
        return miniAppErrorResponse(error, origin, options.logger)
      }
    }
  }
}

export function createMiniAppUpdatePaymentHandler(options: {
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

        const payload = await readPaymentMutationPayload(request)
        if (!payload.paymentId || !payload.memberId || !payload.kind || !payload.amountMajor) {
          return miniAppJsonResponse({ ok: false, error: 'Missing payment fields' }, 400, origin)
        }

        const service = options.financeServiceForHousehold(auth.member.householdId)
        const payment = await service.updatePayment(
          payload.paymentId,
          payload.memberId,
          payload.kind,
          payload.amountMajor,
          payload.currency
        )

        if (!payment) {
          return miniAppJsonResponse({ ok: false, error: 'Payment not found' }, 404, origin)
        }

        return miniAppJsonResponse({ ok: true, authorized: true }, 200, origin)
      } catch (error) {
        return miniAppErrorResponse(error, origin, options.logger)
      }
    }
  }
}

export function createMiniAppDeletePaymentHandler(options: {
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

        const payload = await readPaymentMutationPayload(request)
        if (!payload.paymentId) {
          return miniAppJsonResponse({ ok: false, error: 'Missing payment id' }, 400, origin)
        }

        const service = options.financeServiceForHousehold(auth.member.householdId)
        const deleted = await service.deletePayment(payload.paymentId)

        if (!deleted) {
          return miniAppJsonResponse({ ok: false, error: 'Payment not found' }, 404, origin)
        }

        return miniAppJsonResponse({ ok: true, authorized: true }, 200, origin)
      } catch (error) {
        return miniAppErrorResponse(error, origin, options.logger)
      }
    }
  }
}
