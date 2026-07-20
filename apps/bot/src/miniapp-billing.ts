import type {
  AdHocNotificationService,
  FinanceCommandService,
  HouseholdAuditNotificationService,
  HouseholdOnboardingService
} from '@household/application'
import { BillingPeriod } from '@household/domain'
import type { Logger } from '@household/observability'
import type { LivePaymentCardService } from './live-payment-cards'
import type { HouseholdConfigurationRepository } from '@household/ports'
import type { MiniAppSessionResult } from './miniapp-auth'
import { formatUserFacingMoney } from './i18n/money'
import { loadMiniAppDashboardPayload } from './miniapp-dashboard'
import type { HouseholdAuditNotificationCategory } from '@household/ports'
import type { PurchaseTopicNoticeService } from './purchase-topic-notices'

import {
  allowedMiniAppOrigin,
  createMiniAppSessionService,
  miniAppErrorResponse,
  miniAppJsonResponse,
  readMiniAppRequestPayload,
  toMiniAppClientValidationError
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

async function recordMiniAppAuditEvent(input: {
  service: HouseholdAuditNotificationService | undefined
  logger: Logger | undefined
  authMember: NonNullable<MiniAppSessionResult['member']>
  category: HouseholdAuditNotificationCategory
  eventType: string
  summaryText: string
  metadata?: Record<string, unknown>
}) {
  if (!input.service) {
    return
  }

  try {
    await input.service.recordEvent({
      householdId: input.authMember.householdId,
      actorMemberId: input.authMember.id,
      actorDisplayName: input.authMember.displayName,
      eventType: input.eventType,
      category: input.category,
      summaryText: input.summaryText,
      metadata: input.metadata ?? {}
    })
  } catch (error) {
    input.logger?.warn(
      {
        event: 'miniapp.audit_event_failed',
        householdId: input.authMember.householdId,
        eventType: input.eventType,
        error: error instanceof Error ? error.message : String(error)
      },
      'Failed to record mini app audit event'
    )
  }
}

function formatUtilityResolutionSummaryText(input: {
  actorDisplayName: string
  period: string
  status: 'active' | 'diverged' | 'superseded' | 'settled' | null | undefined
  assignments: readonly {
    displayName: string
    billName: string
    amount: {
      toMajorString(): string
      currency: 'USD' | 'GEL'
    }
  }[]
}): string {
  const action =
    input.status === 'settled' ? 'settled planned utilities' : 'marked planned utilities paid'
  const memberNames = [...new Set(input.assignments.map((assignment) => assignment.displayName))]
  const objectText =
    memberNames.length === 1
      ? [
          memberNames[0],
          input.assignments
            .map(
              (assignment) =>
                `${assignment.billName} ${formatUserFacingMoney(
                  assignment.amount.toMajorString(),
                  assignment.amount.currency
                )}`
            )
            .join('; ')
        ]
          .filter(Boolean)
          .join(' · ')
      : memberNames.length > 1
        ? `${memberNames.length} members`
        : null

  return `${input.actorDisplayName} ${action}${objectText ? `: ${objectText}` : ''} (${input.period})`
}

function serializeUtilityResolutionAssignments(
  assignments: readonly {
    memberId: string
    displayName: string
    utilityBillId: string
    billName: string
    amount: {
      amountMinor: bigint
      currency: 'USD' | 'GEL'
    }
  }[]
): Record<string, unknown>[] {
  return assignments.map((assignment) => ({
    memberId: assignment.memberId,
    displayName: assignment.displayName,
    utilityBillId: assignment.utilityBillId,
    billName: assignment.billName,
    amountMinor: assignment.amount.amountMinor.toString(),
    currency: assignment.amount.currency
  }))
}

async function recordMiniAppPurchaseTopicNotice(input: {
  service: PurchaseTopicNoticeService | undefined
  logger: Logger | undefined
  action: 'publish' | 'sync' | 'delete'
  householdId: string
  purchaseId: string
}) {
  if (!input.service) {
    return
  }

  try {
    if (input.action === 'publish') {
      await input.service.publishPurchase({
        householdId: input.householdId,
        purchaseId: input.purchaseId
      })
      return
    }

    if (input.action === 'sync') {
      await input.service.syncPurchase({
        householdId: input.householdId,
        purchaseId: input.purchaseId
      })
      return
    }

    await input.service.markPurchaseDeleted({
      householdId: input.householdId,
      purchaseId: input.purchaseId
    })
  } catch (error) {
    input.logger?.warn(
      {
        event: 'miniapp.purchase_topic_notice_failed',
        householdId: input.householdId,
        purchaseId: input.purchaseId,
        action: input.action,
        error: error instanceof Error ? error.message : String(error)
      },
      'Failed to update purchase topic notice'
    )
  }
}

async function buildPurchaseAuditMetadata(input: {
  householdConfigurationRepository:
    | Pick<HouseholdConfigurationRepository, 'listHouseholdMembers'>
    | undefined
  householdId: string
  authMember: NonNullable<MiniAppSessionResult['member']>
  purchaseId: string
  description: string
  amountMinor: bigint
  currency: 'USD' | 'GEL'
  payerMemberId: string | null | undefined
  split:
    | {
        mode: 'equal' | 'custom_amounts'
        participants: readonly {
          memberId: string
          included?: boolean
          shareAmountMajor?: string | null | undefined
        }[]
      }
    | null
    | undefined
}) {
  const members =
    (await input.householdConfigurationRepository
      ?.listHouseholdMembers(input.householdId)
      .catch(() => [])) ?? []
  const memberNameById = new Map(members.map((member) => [member.id, member.displayName]))
  const payerMemberId = input.payerMemberId ?? input.authMember.id
  const payerDisplayName =
    memberNameById.get(payerMemberId) ??
    (payerMemberId === input.authMember.id ? input.authMember.displayName : null)

  return {
    purchaseId: input.purchaseId,
    description: input.description,
    amountMinor: input.amountMinor.toString(),
    currency: input.currency,
    payerMemberId,
    payerDisplayName,
    splitMode: input.split?.mode ?? null,
    participants:
      input.split?.participants.map((participant) => {
        const shareAmountText = participant.shareAmountMajor
          ? formatUserFacingMoney(participant.shareAmountMajor, input.currency)
          : null
        return {
          memberId: participant.memberId,
          displayName: memberNameById.get(participant.memberId) ?? participant.memberId,
          included: participant.included !== false,
          shareAmountMajor: participant.shareAmountMajor ?? null,
          shareAmountText
        }
      }) ?? []
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
  fxRateMicros?: string
}> {
  const parsed = await parseJsonBody<{
    initData?: string
    amountMajor?: string
    currency?: string
    period?: string
    fxRateMicros?: string
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
  const fxRateMicros = parsed.fxRateMicros?.trim()

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
      : {}),
    ...(fxRateMicros
      ? {
          fxRateMicros
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
  occurredOn?: string
  payerMemberId?: string
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
    occurredOn?: string
    payerMemberId?: string
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
    ...(parsed.occurredOn?.trim()
      ? {
          occurredOn: parsed.occurredOn.trim()
        }
      : {}),
    ...(parsed.payerMemberId !== undefined
      ? {
          payerMemberId: parsed.payerMemberId
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
  occurredOn?: string
  payerMemberId?: string
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
    purchaseId?: string
    description?: string
    amountMajor?: string
    currency?: string
    occurredOn?: string
    payerMemberId?: string
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
    ...(parsed.occurredOn?.trim()
      ? {
          occurredOn: parsed.occurredOn.trim()
        }
      : {}),
    ...(parsed.payerMemberId !== undefined
      ? {
          payerMemberId: parsed.payerMemberId
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
                  ...(participant.included !== undefined
                    ? {
                        included: participant.included
                      }
                    : {}),
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
  period?: string
}> {
  const parsed = await parseJsonBody<{
    initData?: string
    paymentId?: string
    memberId?: string
    kind?: 'rent' | 'utilities'
    amountMajor?: string
    currency?: string
    period?: string
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
      : {}),
    ...(parsed.period?.trim()
      ? {
          period: BillingPeriod.fromString(parsed.period.trim()).toString()
        }
      : {})
  }
}

async function readClosePaymentPeriodPayload(request: Request): Promise<{
  initData: string
  period: string
  kind: 'rent' | 'utilities'
  memberIds?: readonly string[]
  allMembers?: boolean
}> {
  const parsed = await parseJsonBody<{
    initData?: string
    period?: string
    kind?: 'rent' | 'utilities'
    memberIds?: string[]
    allMembers?: boolean
  }>(request)
  const initData = parsed.initData?.trim()
  const period = parsed.period?.trim()
  if (!initData) {
    throw new Error('Missing initData')
  }
  if (!period) {
    throw new Error('Missing payment period')
  }
  if (parsed.kind !== 'rent' && parsed.kind !== 'utilities') {
    throw new Error('Missing payment kind')
  }

  const memberIds = Array.isArray(parsed.memberIds)
    ? [...new Set(parsed.memberIds.map((memberId) => memberId.trim()).filter(Boolean))]
    : undefined

  return {
    initData,
    period: BillingPeriod.fromString(period).toString(),
    kind: parsed.kind,
    ...(memberIds && memberIds.length > 0 ? { memberIds } : {}),
    ...(parsed.allMembers ? { allMembers: true } : {})
  }
}

async function readResolveUtilityPlanPayload(request: Request): Promise<{
  initData: string
  memberId?: string
  period?: string
  allMembers?: boolean
}> {
  const parsed = await parseJsonBody<{
    initData?: string
    memberId?: string
    period?: string
    allMembers?: boolean
  }>(request)
  const initData = parsed.initData?.trim()
  if (!initData) {
    throw new Error('Missing initData')
  }

  return {
    initData,
    ...(parsed.memberId?.trim() ? { memberId: parsed.memberId.trim() } : {}),
    ...(parsed.allMembers ? { allMembers: true } : {}),
    ...(parsed.period?.trim()
      ? { period: BillingPeriod.fromString(parsed.period.trim()).toString() }
      : {})
  }
}

async function readUtilityVendorPaymentPayload(request: Request): Promise<{
  initData: string
  utilityBillId: string
  payerMemberId?: string
  amountMajor?: string
  currency?: string
  period?: string
}> {
  const parsed = await parseJsonBody<{
    initData?: string
    utilityBillId?: string
    payerMemberId?: string
    amountMajor?: string
    currency?: string
    period?: string
  }>(request)
  const initData = parsed.initData?.trim()
  const utilityBillId = parsed.utilityBillId?.trim()
  if (!initData) {
    throw new Error('Missing initData')
  }
  if (!utilityBillId) {
    throw new Error('Missing utility bill id')
  }

  return {
    initData,
    utilityBillId,
    ...(parsed.payerMemberId?.trim() ? { payerMemberId: parsed.payerMemberId.trim() } : {}),
    ...(parsed.amountMajor?.trim() ? { amountMajor: parsed.amountMajor.trim() } : {}),
    ...(parsed.currency?.trim() ? { currency: parsed.currency.trim() } : {}),
    ...(parsed.period?.trim()
      ? { period: BillingPeriod.fromString(parsed.period.trim()).toString() }
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
  auditNotificationService?: HouseholdAuditNotificationService
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
        await recordMiniAppAuditEvent({
          service: options.auditNotificationService,
          logger: options.logger,
          authMember: auth.member,
          category: 'period_events',
          eventType: 'cycle.opened',
          summaryText: `${auth.member.displayName} opened period ${payload.period}`,
          metadata: {
            period: payload.period,
            currency: payload.currency
          }
        })
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
  auditNotificationService?: HouseholdAuditNotificationService
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
        await recordMiniAppAuditEvent({
          service: options.auditNotificationService,
          logger: options.logger,
          authMember: auth.member,
          category: 'period_events',
          eventType: 'cycle.closed',
          summaryText: `${auth.member.displayName} closed period ${payload.period}`,
          metadata: {
            period: payload.period
          }
        })
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
  auditNotificationService?: HouseholdAuditNotificationService
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
        const result = await service.setRent(
          payload.amountMajor,
          payload.currency,
          payload.period,
          payload.fxRateMicros
        )
        if (!result) {
          return miniAppJsonResponse(
            { ok: false, error: 'No billing cycle available' },
            404,
            origin
          )
        }

        await recordMiniAppAuditEvent({
          service: options.auditNotificationService,
          logger: options.logger,
          authMember: auth.member,
          category: 'period_events',
          eventType: 'rent.updated',
          summaryText: `${auth.member.displayName} updated rent: ${formatUserFacingMoney(result.amount.toMajorString(), result.currency)} (${result.period})`,
          metadata: {
            amountMinor: result.amount.amountMinor.toString(),
            currency: result.currency,
            period: result.period,
            fxRateMicros: result.fxRateMicros?.toString() ?? null
          }
        })
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
  auditNotificationService?: HouseholdAuditNotificationService
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

        await recordMiniAppAuditEvent({
          service: options.auditNotificationService,
          logger: options.logger,
          authMember: auth.member,
          category: 'plan_events',
          eventType: 'utility_bill.added',
          summaryText: `${auth.member.displayName} added utility bill: ${payload.billName} ${formatUserFacingMoney(result.amount.toMajorString(), result.currency)} (${result.period})`,
          metadata: {
            billName: payload.billName,
            amountMinor: result.amount.amountMinor.toString(),
            currency: result.currency,
            period: result.period
          }
        })
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
  auditNotificationService?: HouseholdAuditNotificationService
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

        await recordMiniAppAuditEvent({
          service: options.auditNotificationService,
          logger: options.logger,
          authMember: auth.member,
          category: 'plan_events',
          eventType: 'utility_bill.added',
          summaryText: `${auth.member.displayName} added utility bill: ${payload.billName} ${formatUserFacingMoney(result.amount.toMajorString(), result.currency)} (${result.period})`,
          metadata: {
            billName: payload.billName,
            amountMinor: result.amount.amountMinor.toString(),
            currency: result.currency,
            period: result.period
          }
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

export function createMiniAppSubmitPaymentHandler(options: {
  allowedOrigins: readonly string[]
  botToken: string
  financeServiceForHousehold: (householdId: string) => FinanceCommandService
  onboardingService: HouseholdOnboardingService
  householdConfigurationRepository: HouseholdConfigurationRepository
  auditNotificationService?: HouseholdAuditNotificationService
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
        text: `${input.memberName} recorded a ${input.kind} payment: ${formatUserFacingMoney(input.amountMajor, input.currency)} (${input.period})`
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
        options.logger?.info(
          {
            event: 'miniapp.payment.record_requested',
            householdId: auth.member.householdId,
            actorMemberId: auth.member.id,
            memberId: auth.member.id,
            kind: payload.kind,
            amountMajor: payload.amountMajor,
            currency: payload.currency ?? null,
            period: payload.period ?? null,
            route: 'member'
          },
          'Mini app payment record requested'
        )
        const payment = await service.addPayment(
          auth.member.id,
          payload.kind,
          payload.amountMajor,
          payload.currency,
          payload.period
        )

        if (!payment) {
          return miniAppJsonResponse({ ok: false, error: 'Failed to record payment' }, 500, origin)
        }

        if (options.auditNotificationService) {
          await recordMiniAppAuditEvent({
            service: options.auditNotificationService,
            logger: options.logger,
            authMember: auth.member,
            category: 'payment_events',
            eventType: 'payment.recorded',
            summaryText: `${auth.member.displayName} recorded ${payload.kind} payment: ${formatUserFacingMoney(payment.amount.toMajorString(), payment.currency)} (${payment.period})`,
            metadata: {
              paymentId: payment.paymentId,
              memberId: auth.member.id,
              memberDisplayName: auth.member.displayName,
              kind: payload.kind,
              amountMinor: payment.amount.amountMinor.toString(),
              currency: payment.currency,
              period: payment.period
            }
          })
        } else {
          await notifyPaymentRecorded({
            householdId: auth.member.householdId,
            memberName: auth.member.displayName,
            kind: payload.kind,
            amountMajor: payment.amount.toMajorString(),
            currency: payment.currency,
            period: payment.period
          })
        }
        options.logger?.info(
          {
            event: 'miniapp.payment.record_completed',
            householdId: auth.member.householdId,
            actorMemberId: auth.member.id,
            memberId: auth.member.id,
            kind: payload.kind,
            amountMinor: payment.amount.amountMinor.toString(),
            currency: payment.currency,
            period: payment.period,
            route: 'member'
          },
          'Mini app payment record completed'
        )

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
  auditNotificationService?: HouseholdAuditNotificationService
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

        await recordMiniAppAuditEvent({
          service: options.auditNotificationService,
          logger: options.logger,
          authMember: auth.member,
          category: 'plan_events',
          eventType: 'utility_bill.updated',
          summaryText: `${auth.member.displayName} updated utility bill: ${payload.billName} ${formatUserFacingMoney(result.amount.toMajorString(), result.currency)}`,
          metadata: {
            billId: result.billId,
            billName: payload.billName,
            amountMinor: result.amount.amountMinor.toString(),
            currency: result.currency
          }
        })
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
  auditNotificationService?: HouseholdAuditNotificationService
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

        await recordMiniAppAuditEvent({
          service: options.auditNotificationService,
          logger: options.logger,
          authMember: auth.member,
          category: 'plan_events',
          eventType: 'utility_bill.deleted',
          summaryText: `${auth.member.displayName} deleted utility bill`,
          metadata: {
            billId: payload.billId
          }
        })
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
  adHocNotificationService: AdHocNotificationService
  onboardingService: HouseholdOnboardingService
  auditNotificationService?: HouseholdAuditNotificationService
  purchaseTopicNoticeService?: PurchaseTopicNoticeService
  householdConfigurationRepository?: Pick<
    HouseholdConfigurationRepository,
    'listHouseholdUtilityCategories' | 'listHouseholdMembers'
  >
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
        const payerMemberId = payload.payerMemberId ?? auth.member.id
        const purchase = await service
          .addPurchase(
            payload.description,
            payload.amountMajor,
            payerMemberId,
            payload.currency,
            payload.split,
            payload.occurredOn
          )
          .catch((error) => {
            throw toMiniAppClientValidationError(error)
          })
        await recordMiniAppAuditEvent({
          service: options.auditNotificationService,
          logger: options.logger,
          authMember: auth.member,
          category: 'purchase_events',
          eventType: 'purchase.added',
          summaryText: `${auth.member.displayName} added purchase: ${payload.description} ${formatUserFacingMoney(purchase.amount.toMajorString(), purchase.currency)}`,
          metadata: await buildPurchaseAuditMetadata({
            householdConfigurationRepository: options.householdConfigurationRepository,
            householdId: auth.member.householdId,
            authMember: auth.member,
            purchaseId: purchase.purchaseId,
            description: payload.description,
            amountMinor: purchase.amount.amountMinor,
            currency: purchase.currency,
            payerMemberId,
            split: payload.split
          })
        })
        await recordMiniAppPurchaseTopicNotice({
          service: options.purchaseTopicNoticeService,
          logger: options.logger,
          action: 'publish',
          householdId: auth.member.householdId,
          purchaseId: purchase.purchaseId
        })

        const dashboard = await loadMiniAppDashboardPayload({
          householdId: auth.member.householdId,
          viewerMemberId: auth.member.id,
          financeService: service,
          adHocNotificationService: options.adHocNotificationService,
          ...(options.householdConfigurationRepository
            ? {
                householdConfigurationRepository: options.householdConfigurationRepository
              }
            : {})
        })
        if (!dashboard) {
          return miniAppJsonResponse(
            { ok: false, error: 'No billing cycle available' },
            404,
            origin
          )
        }

        return miniAppJsonResponse({ ok: true, authorized: true, dashboard }, 200, origin)
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
  adHocNotificationService: AdHocNotificationService
  onboardingService: HouseholdOnboardingService
  auditNotificationService?: HouseholdAuditNotificationService
  purchaseTopicNoticeService?: PurchaseTopicNoticeService
  householdConfigurationRepository?: Pick<
    HouseholdConfigurationRepository,
    'listHouseholdUtilityCategories' | 'listHouseholdMembers'
  >
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
        const payerMemberId = payload.payerMemberId
        const updated = await service
          .updatePurchase(
            payload.purchaseId,
            payload.description,
            payload.amountMajor,
            payload.currency,
            payload.split,
            payerMemberId,
            payload.occurredOn
          )
          .catch((error) => {
            throw toMiniAppClientValidationError(error)
          })

        if (!updated) {
          return miniAppJsonResponse({ ok: false, error: 'Purchase not found' }, 404, origin)
        }

        await recordMiniAppAuditEvent({
          service: options.auditNotificationService,
          logger: options.logger,
          authMember: auth.member,
          category: 'purchase_events',
          eventType: 'purchase.updated',
          summaryText: `${auth.member.displayName} updated purchase: ${payload.description} ${formatUserFacingMoney(updated.amount.toMajorString(), updated.currency)}`,
          metadata: await buildPurchaseAuditMetadata({
            householdConfigurationRepository: options.householdConfigurationRepository,
            householdId: auth.member.householdId,
            authMember: auth.member,
            purchaseId: updated.purchaseId,
            description: payload.description,
            amountMinor: updated.amount.amountMinor,
            currency: updated.currency,
            payerMemberId,
            split: payload.split
          })
        })
        await recordMiniAppPurchaseTopicNotice({
          service: options.purchaseTopicNoticeService,
          logger: options.logger,
          action: 'sync',
          householdId: auth.member.householdId,
          purchaseId: updated.purchaseId
        })
        const dashboard = await loadMiniAppDashboardPayload({
          householdId: auth.member.householdId,
          viewerMemberId: auth.member.id,
          financeService: service,
          adHocNotificationService: options.adHocNotificationService,
          ...(options.householdConfigurationRepository
            ? {
                householdConfigurationRepository: options.householdConfigurationRepository
              }
            : {})
        })
        if (!dashboard) {
          return miniAppJsonResponse(
            { ok: false, error: 'No billing cycle available' },
            404,
            origin
          )
        }

        return miniAppJsonResponse({ ok: true, authorized: true, dashboard }, 200, origin)
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
  adHocNotificationService: AdHocNotificationService
  onboardingService: HouseholdOnboardingService
  auditNotificationService?: HouseholdAuditNotificationService
  purchaseTopicNoticeService?: PurchaseTopicNoticeService
  householdConfigurationRepository?: Pick<
    HouseholdConfigurationRepository,
    'listHouseholdUtilityCategories' | 'listHouseholdMembers'
  >
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

        await recordMiniAppAuditEvent({
          service: options.auditNotificationService,
          logger: options.logger,
          authMember: auth.member,
          category: 'purchase_events',
          eventType: 'purchase.deleted',
          summaryText: `${auth.member.displayName} deleted purchase`,
          metadata: {
            purchaseId: payload.purchaseId
          }
        })
        await recordMiniAppPurchaseTopicNotice({
          service: options.purchaseTopicNoticeService,
          logger: options.logger,
          action: 'delete',
          householdId: auth.member.householdId,
          purchaseId: payload.purchaseId
        })
        const dashboard = await loadMiniAppDashboardPayload({
          householdId: auth.member.householdId,
          viewerMemberId: auth.member.id,
          financeService: service,
          adHocNotificationService: options.adHocNotificationService,
          ...(options.householdConfigurationRepository
            ? {
                householdConfigurationRepository: options.householdConfigurationRepository
              }
            : {})
        })
        if (!dashboard) {
          return miniAppJsonResponse(
            { ok: false, error: 'No billing cycle available' },
            404,
            origin
          )
        }

        return miniAppJsonResponse({ ok: true, authorized: true, dashboard }, 200, origin)
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
  auditNotificationService?: HouseholdAuditNotificationService
  livePaymentCardService?: LivePaymentCardService
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
        options.logger?.info(
          {
            event: 'miniapp.payment.record_requested',
            householdId: auth.member.householdId,
            actorMemberId: auth.member.id,
            memberId: payload.memberId,
            kind: payload.kind,
            amountMajor: payload.amountMajor,
            currency: payload.currency ?? null,
            period: payload.period ?? null,
            route: 'admin'
          },
          'Mini app payment record requested'
        )
        const members = await service.listMembers()
        const targetMember = members.find((member) => member.id === payload.memberId)
        const payment = await service.addPayment(
          payload.memberId,
          payload.kind,
          payload.amountMajor,
          payload.currency,
          payload.period
        )

        if (!payment) {
          return miniAppJsonResponse({ ok: false, error: 'No open billing cycle' }, 409, origin)
        }

        await recordMiniAppAuditEvent({
          service: options.auditNotificationService,
          logger: options.logger,
          authMember: auth.member,
          category: 'payment_events',
          eventType: 'payment.recorded',
          summaryText: `${auth.member.displayName} recorded ${payload.kind} payment: ${formatUserFacingMoney(payment.amount.toMajorString(), payment.currency)} (${payment.period})`,
          metadata: {
            paymentId: payment.paymentId,
            memberId: payload.memberId,
            memberDisplayName: targetMember?.displayName ?? payload.memberId,
            kind: payload.kind,
            amountMinor: payment.amount.amountMinor.toString(),
            currency: payment.currency,
            period: payment.period
          }
        })
        await options.livePaymentCardService?.refresh({
          householdId: auth.member.householdId,
          kind: payload.kind,
          period: payment.period
        })
        options.logger?.info(
          {
            event: 'miniapp.payment.record_completed',
            householdId: auth.member.householdId,
            actorMemberId: auth.member.id,
            memberId: payload.memberId,
            kind: payload.kind,
            amountMinor: payment.amount.amountMinor.toString(),
            currency: payment.currency,
            period: payment.period,
            route: 'admin'
          },
          'Mini app payment record completed'
        )

        return miniAppJsonResponse({ ok: true, authorized: true }, 200, origin)
      } catch (error) {
        return miniAppErrorResponse(error, origin, options.logger)
      }
    }
  }
}

export function createMiniAppClosePaymentPeriodHandler(options: {
  allowedOrigins: readonly string[]
  botToken: string
  financeServiceForHousehold: (householdId: string) => FinanceCommandService
  onboardingService: HouseholdOnboardingService
  adHocNotificationService: AdHocNotificationService
  auditNotificationService?: HouseholdAuditNotificationService
  livePaymentCardService?: LivePaymentCardService
  householdConfigurationRepository?: Pick<
    HouseholdConfigurationRepository,
    'listHouseholdUtilityCategories'
  >
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

        const payload = await readClosePaymentPeriodPayload(request)
        const memberIds = payload.allMembers
          ? []
          : payload.memberIds && payload.memberIds.length > 0
            ? payload.memberIds
            : [auth.member.id]

        if (
          !auth.member.isAdmin &&
          (payload.allMembers || memberIds.some((memberId) => memberId !== auth.member.id))
        ) {
          return miniAppJsonResponse({ ok: false, error: 'Admin access required' }, 403, origin)
        }

        const service = options.financeServiceForHousehold(auth.member.householdId)
        options.logger?.info(
          {
            event: 'miniapp.payment_period.close_requested',
            householdId: auth.member.householdId,
            actorMemberId: auth.member.id,
            kind: payload.kind,
            period: payload.period,
            allMembers: payload.allMembers === true,
            memberIds
          },
          'Mini app payment period close requested'
        )
        const result = await service.closePaymentPeriod({
          periodArg: payload.period,
          kind: payload.kind,
          actorMemberId: auth.member.id,
          ...(payload.allMembers ? { allMembers: true } : { memberIds })
        })

        if (!result) {
          return miniAppJsonResponse(
            { ok: false, authorized: true, error: 'No open payment period is available' },
            409,
            origin
          )
        }

        const dashboard = await loadMiniAppDashboardPayload({
          householdId: auth.member.householdId,
          viewerMemberId: auth.member.id,
          financeService: service,
          adHocNotificationService: options.adHocNotificationService,
          ...(options.householdConfigurationRepository
            ? {
                householdConfigurationRepository: options.householdConfigurationRepository
              }
            : {}),
          periodOverride: result.period
        })

        if (!dashboard) {
          return miniAppJsonResponse(
            { ok: false, authorized: true, error: 'No billing cycle available' },
            404,
            origin
          )
        }

        if (result.closedMembers.length > 0) {
          await recordMiniAppAuditEvent({
            service: options.auditNotificationService,
            logger: options.logger,
            authMember: auth.member,
            category: 'payment_events',
            eventType: 'payment_period.closed',
            summaryText: `${auth.member.displayName} closed ${payload.kind} for ${result.period}`,
            metadata: {
              period: result.period,
              kind: result.kind,
              closedMembers: result.closedMembers.map((member) => ({
                memberId: member.memberId,
                displayName: member.displayName,
                amountMinor: member.amount.amountMinor.toString(),
                currency: member.amount.currency
              })),
              skippedMembers: result.skippedMembers
            }
          })
          await options.livePaymentCardService?.refresh({
            householdId: auth.member.householdId,
            kind: result.kind,
            period: result.period
          })
        }

        return miniAppJsonResponse(
          {
            ok: true,
            authorized: true,
            dashboard,
            closeSummary: {
              period: result.period,
              kind: result.kind,
              closedMembers: result.closedMembers.map((member) => ({
                memberId: member.memberId,
                displayName: member.displayName,
                amountMajor: member.amount.toMajorString(),
                currency: member.amount.currency
              })),
              skippedMembers: result.skippedMembers
            }
          },
          200,
          origin
        )
      } catch (error) {
        return miniAppErrorResponse(error, origin, options.logger, {
          route: 'miniapp.billing.payment_period.close'
        })
      }
    }
  }
}

export function createMiniAppUpdatePaymentHandler(options: {
  allowedOrigins: readonly string[]
  botToken: string
  financeServiceForHousehold: (householdId: string) => FinanceCommandService
  onboardingService: HouseholdOnboardingService
  auditNotificationService?: HouseholdAuditNotificationService
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

        await recordMiniAppAuditEvent({
          service: options.auditNotificationService,
          logger: options.logger,
          authMember: auth.member,
          category: 'payment_events',
          eventType: 'payment.updated',
          summaryText: `${auth.member.displayName} updated ${payload.kind} payment: ${formatUserFacingMoney(payment.amount.toMajorString(), payment.currency)}`,
          metadata: {
            paymentId: payment.paymentId,
            memberId: payload.memberId,
            kind: payload.kind,
            amountMinor: payment.amount.amountMinor.toString(),
            currency: payment.currency
          }
        })
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
  auditNotificationService?: HouseholdAuditNotificationService
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

        await recordMiniAppAuditEvent({
          service: options.auditNotificationService,
          logger: options.logger,
          authMember: auth.member,
          category: 'payment_events',
          eventType: 'payment.deleted',
          summaryText: `${auth.member.displayName} deleted payment`,
          metadata: {
            paymentId: payload.paymentId
          }
        })
        return miniAppJsonResponse({ ok: true, authorized: true }, 200, origin)
      } catch (error) {
        return miniAppErrorResponse(error, origin, options.logger)
      }
    }
  }
}

export function createMiniAppResolveUtilityPlanHandler(options: {
  allowedOrigins: readonly string[]
  botToken: string
  financeServiceForHousehold: (householdId: string) => FinanceCommandService
  onboardingService: HouseholdOnboardingService
  auditNotificationService?: HouseholdAuditNotificationService
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

        const payload = await readResolveUtilityPlanPayload(request)
        const memberId = payload.allMembers ? undefined : (payload.memberId ?? auth.member.id)
        if (!auth.member.isAdmin && (payload.allMembers || memberId !== auth.member.id)) {
          return miniAppJsonResponse({ ok: false, error: 'Admin access required' }, 403, origin)
        }

        const service = options.financeServiceForHousehold(auth.member.householdId)
        options.logger?.info(
          {
            event: 'miniapp.utility_plan.resolve_requested',
            householdId: auth.member.householdId,
            memberId: memberId ?? null,
            allMembers: payload.allMembers === true,
            actorMemberId: auth.member.id,
            period: payload.period ?? null
          },
          'Mini app utility plan resolve requested'
        )
        const result = await service.resolveUtilityBillAsPlanned({
          ...(memberId ? { memberId } : {}),
          ...(payload.allMembers ? { allMembers: true } : {}),
          actorMemberId: auth.member.id,
          ...(payload.period ? { periodArg: payload.period } : {})
        })
        if (!result) {
          options.logger?.warn(
            {
              event: 'miniapp.utility_plan.resolve_unavailable',
              householdId: auth.member.householdId,
              memberId: memberId ?? null,
              allMembers: payload.allMembers === true,
              actorMemberId: auth.member.id,
              period: payload.period ?? null
            },
            'Mini app utility plan resolve requested without an active plan'
          )
          return miniAppJsonResponse(
            {
              ok: false,
              authorized: true,
              error: 'No active utility plan is available for this member'
            },
            409,
            origin
          )
        }
        await recordMiniAppAuditEvent({
          service: options.auditNotificationService,
          logger: options.logger,
          authMember: auth.member,
          category: 'plan_events',
          eventType:
            result.plan?.status === 'settled' ? 'utility_plan.settled' : 'utility_plan.resolved',
          summaryText: formatUtilityResolutionSummaryText({
            actorDisplayName: auth.member.displayName,
            period: result.period,
            status: result.plan?.status,
            assignments: result.resolvedAssignments
          }),
          metadata: {
            period: result.period,
            memberId: memberId ?? null,
            allMembers: payload.allMembers === true,
            resolvedAssignments: serializeUtilityResolutionAssignments(result.resolvedAssignments),
            resolvedBillIds: result.resolvedBillIds,
            planVersion: result.plan?.version ?? null,
            planStatus: result.plan?.status ?? null
          }
        })

        if (result.settledJustNow) {
          await recordMiniAppAuditEvent({
            service: options.auditNotificationService,
            logger: options.logger,
            authMember: auth.member,
            category: 'plan_events',
            eventType: 'utility_plan.fully_paid',
            summaryText: `Utilities for ${result.period} are fully settled`,
            metadata: { period: result.period }
          })
        }
        options.logger?.info(
          {
            event: 'miniapp.utility_plan.resolve_completed',
            householdId: auth.member.householdId,
            memberId: memberId ?? null,
            allMembers: payload.allMembers === true,
            actorMemberId: auth.member.id,
            period: payload.period ?? null
          },
          'Mini app utility plan resolve completed'
        )

        return miniAppJsonResponse({ ok: true, authorized: true }, 200, origin)
      } catch (error) {
        return miniAppErrorResponse(error, origin, options.logger)
      }
    }
  }
}

export function createMiniAppRecordUtilityVendorPaymentHandler(options: {
  allowedOrigins: readonly string[]
  botToken: string
  financeServiceForHousehold: (householdId: string) => FinanceCommandService
  onboardingService: HouseholdOnboardingService
  auditNotificationService?: HouseholdAuditNotificationService
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

        const payload = await readUtilityVendorPaymentPayload(request)
        const payerMemberId = payload.payerMemberId ?? auth.member.id
        if (!auth.member.isAdmin && payerMemberId !== auth.member.id) {
          return miniAppJsonResponse({ ok: false, error: 'Admin access required' }, 403, origin)
        }

        const service = options.financeServiceForHousehold(auth.member.householdId)
        const result = await service.recordUtilityVendorPayment({
          utilityBillId: payload.utilityBillId,
          payerMemberId,
          actorMemberId: auth.member.id,
          ...(payload.amountMajor ? { amountArg: payload.amountMajor } : {}),
          ...(payload.currency ? { currencyArg: payload.currency } : {}),
          ...(payload.period ? { periodArg: payload.period } : {})
        })

        if (result) {
          await recordMiniAppAuditEvent({
            service: options.auditNotificationService,
            logger: options.logger,
            authMember: auth.member,
            category: 'plan_events',
            eventType: 'utility_vendor_payment.recorded',
            summaryText: `${auth.member.displayName} recorded utility bill payment (${result.period})`,
            metadata: {
              utilityBillId: payload.utilityBillId,
              payerMemberId,
              amountMajor: payload.amountMajor ?? null,
              currency: payload.currency ?? null,
              period: result.period,
              planVersion: result.plan?.version ?? null,
              planStatus: result.plan?.status ?? null
            }
          })

          if (result.settledJustNow) {
            await recordMiniAppAuditEvent({
              service: options.auditNotificationService,
              logger: options.logger,
              authMember: auth.member,
              category: 'plan_events',
              eventType: 'utility_plan.fully_paid',
              summaryText: `Utilities for ${result.period} are fully settled`,
              metadata: { period: result.period }
            })
          }
        }
        return miniAppJsonResponse({ ok: true, authorized: true }, 200, origin)
      } catch (error) {
        return miniAppErrorResponse(error, origin, options.logger)
      }
    }
  }
}
