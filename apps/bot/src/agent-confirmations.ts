import type {
  FinanceCommandService,
  HouseholdAuditNotificationService
} from '@household/application'
import { BillingPeriod, Money, nowInstant } from '@household/domain'
import type { Bot, Context } from 'grammy'
import type { Logger } from '@household/observability'
import type { TelegramPendingActionRepository } from '@household/ports'

import { getBotTranslations, type BotLocale } from './i18n'

export const AGENT_ACTION = 'agent_action' as const
const AGENT_CONFIRM_CALLBACK_PREFIX = 'agent:confirm:'
const AGENT_CANCEL_CALLBACK_PREFIX = 'agent:cancel:'
const AGENT_ACTION_TTL_MS = 30 * 60_000

export type AgentActionType =
  | 'update_payment'
  | 'delete_payment'
  | 'update_purchase'
  | 'delete_purchase'
  | 'set_purchase_participants'
  | 'set_period_rent'

export interface AgentActionPayload {
  actionId: string
  actionType: AgentActionType
  householdId: string
  requesterTelegramUserId: string
  locale: BotLocale
  summaryText: string
  params: Record<string, unknown>
}

export function canResolveAgentAction(input: {
  payload: AgentActionPayload
  actorTelegramUserId: string
  actorIsAdmin: boolean
}): boolean {
  if (input.payload.actionType === 'set_period_rent') {
    return input.actorIsAdmin
  }
  return input.actorTelegramUserId === input.payload.requesterTelegramUserId || input.actorIsAdmin
}

export function agentActionReplyMarkup(locale: BotLocale, actionId: string) {
  const t = getBotTranslations(locale).agent

  return {
    inline_keyboard: [
      [
        {
          text: t.confirmButton,
          callback_data: `${AGENT_CONFIRM_CALLBACK_PREFIX}${actionId}`
        },
        {
          text: t.cancelButton,
          callback_data: `${AGENT_CANCEL_CALLBACK_PREFIX}${actionId}`
        }
      ]
    ]
  }
}

export function shortAgentActionId(): string {
  return crypto.randomUUID().replaceAll('-', '').slice(0, 16)
}

export async function upsertAgentActionPendingAction(input: {
  promptRepository: TelegramPendingActionRepository
  telegramChatId: string
  payload: AgentActionPayload
}): Promise<void> {
  await input.promptRepository.upsertPendingAction({
    telegramUserId: input.payload.requesterTelegramUserId,
    telegramChatId: input.telegramChatId,
    action: AGENT_ACTION,
    payload: { ...input.payload },
    expiresAt: nowInstant().add({ milliseconds: AGENT_ACTION_TTL_MS })
  })
}

export function parseAgentActionPayload(
  payload: Record<string, unknown>
): AgentActionPayload | null {
  if (
    typeof payload.actionId !== 'string' ||
    typeof payload.householdId !== 'string' ||
    typeof payload.requesterTelegramUserId !== 'string' ||
    typeof payload.summaryText !== 'string' ||
    (payload.locale !== 'en' && payload.locale !== 'ru') ||
    (payload.actionType !== 'update_payment' &&
      payload.actionType !== 'delete_payment' &&
      payload.actionType !== 'update_purchase' &&
      payload.actionType !== 'delete_purchase' &&
      payload.actionType !== 'set_purchase_participants' &&
      payload.actionType !== 'set_period_rent') ||
    !payload.params ||
    typeof payload.params !== 'object' ||
    Array.isArray(payload.params)
  ) {
    return null
  }

  return {
    actionId: payload.actionId,
    actionType: payload.actionType,
    householdId: payload.householdId,
    requesterTelegramUserId: payload.requesterTelegramUserId,
    locale: payload.locale,
    summaryText: payload.summaryText,
    params: payload.params as Record<string, unknown>
  }
}

function readString(params: Record<string, unknown>, key: string): string | null {
  const value = params[key]
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function readStringArray(params: Record<string, unknown>, key: string): readonly string[] | null {
  const value = params[key]
  if (!Array.isArray(value)) {
    return null
  }

  const entries = value.filter((entry): entry is string => typeof entry === 'string')
  return entries.length === value.length ? entries : null
}

export async function executeAgentAction(
  financeService: FinanceCommandService,
  payload: AgentActionPayload
): Promise<boolean> {
  const params = payload.params

  switch (payload.actionType) {
    case 'update_payment': {
      const paymentId = readString(params, 'paymentId')
      const memberId = readString(params, 'memberId')
      const kind = readString(params, 'kind')
      const amountMajor = readString(params, 'amountMajor')
      const currency = readString(params, 'currency')
      if (!paymentId || !memberId || (kind !== 'rent' && kind !== 'utilities') || !amountMajor) {
        return false
      }

      const updated = await financeService.updatePayment(
        paymentId,
        memberId,
        kind,
        amountMajor,
        currency ?? undefined
      )
      return updated !== null
    }

    case 'delete_payment': {
      const paymentId = readString(params, 'paymentId')
      if (!paymentId) {
        return false
      }

      return financeService.deletePayment(paymentId)
    }

    case 'update_purchase': {
      const purchaseId = readString(params, 'purchaseId')
      const description = readString(params, 'description')
      const amountMajor = readString(params, 'amountMajor')
      const currency = readString(params, 'currency')
      const payerMemberId = readString(params, 'payerMemberId')
      if (!purchaseId || !description || !amountMajor) {
        return false
      }

      const updated = await financeService.updatePurchase(
        purchaseId,
        description,
        amountMajor,
        currency ?? undefined,
        undefined,
        payerMemberId ?? undefined
      )
      return updated !== null
    }

    case 'delete_purchase': {
      const purchaseId = readString(params, 'purchaseId')
      if (!purchaseId) {
        return false
      }

      return financeService.deletePurchase(purchaseId)
    }

    case 'set_purchase_participants': {
      const purchaseId = readString(params, 'purchaseId')
      const description = readString(params, 'description')
      const amountMajor = readString(params, 'amountMajor')
      const currency = readString(params, 'currency')
      const participantMemberIds = readStringArray(params, 'participantMemberIds')
      if (!purchaseId || !description || !amountMajor || !participantMemberIds) {
        return false
      }

      const members = await financeService.listMembers()
      const included = new Set(participantMemberIds)
      const updated = await financeService.updatePurchase(
        purchaseId,
        description,
        amountMajor,
        currency ?? undefined,
        {
          mode: 'equal',
          participants: members.map((member) => ({
            memberId: member.id,
            included: included.has(member.id)
          }))
        }
      )
      return updated !== null
    }

    case 'set_period_rent': {
      const amountMajor = readString(params, 'amountMajor')
      const currency = readString(params, 'currency')
      const periods = readStringArray(params, 'periods')
      if (!amountMajor || (currency !== 'USD' && currency !== 'GEL') || !periods?.length) {
        return false
      }

      let normalizedPeriods: readonly string[]
      try {
        const amount = Money.fromMajor(amountMajor, currency)
        if (amount.amountMinor <= 0n) return false
        normalizedPeriods = periods.map((period) => BillingPeriod.fromString(period).toString())
      } catch {
        return false
      }

      for (const period of normalizedPeriods) {
        const updated = await financeService.setRent(amountMajor, currency, period)
        if (!updated) return false
      }
      return true
    }
  }
}

async function findAgentActionPayload(input: {
  promptRepository: TelegramPendingActionRepository
  telegramChatId: string
  actorTelegramUserId: string
  actionId: string
}): Promise<AgentActionPayload | null> {
  const actorPending = await input.promptRepository.getPendingAction(
    input.telegramChatId,
    input.actorTelegramUserId,
    AGENT_ACTION
  )
  const actorPayload =
    actorPending?.action === AGENT_ACTION ? parseAgentActionPayload(actorPending.payload) : null
  if (actorPayload?.actionId === input.actionId) {
    return actorPayload
  }

  const found = await input.promptRepository.findPendingActionByPayloadValue?.(
    input.telegramChatId,
    AGENT_ACTION,
    'actionId',
    input.actionId
  )

  const payload = found?.action === AGENT_ACTION ? parseAgentActionPayload(found.payload) : null
  return payload?.actionId === input.actionId ? payload : null
}

export function registerAgentActionCallbacks(
  bot: Bot,
  options: {
    promptRepository: TelegramPendingActionRepository
    financeServiceForHousehold: (householdId: string) => FinanceCommandService
    auditNotificationService?: HouseholdAuditNotificationService
    logger?: Logger
  }
): void {
  async function resolveCallbackAction(ctx: Context, actionId: string) {
    if (
      ctx.chat?.type !== 'group' &&
      ctx.chat?.type !== 'supergroup' &&
      ctx.chat?.type !== 'private'
    ) {
      return null
    }

    const actorTelegramUserId = ctx.from?.id?.toString()
    if (!actorTelegramUserId) {
      return null
    }

    const telegramChatId = ctx.chat.id.toString()
    const payload = await findAgentActionPayload({
      promptRepository: options.promptRepository,
      telegramChatId,
      actorTelegramUserId,
      actionId
    })

    return { actorTelegramUserId, telegramChatId, payload }
  }

  async function actorMember(householdId: string, actorTelegramUserId: string) {
    return options
      .financeServiceForHousehold(householdId)
      .getMemberByTelegramUserId(actorTelegramUserId)
  }

  bot.callbackQuery(new RegExp(`^${AGENT_CONFIRM_CALLBACK_PREFIX}([0-9a-f]+)$`), async (ctx) => {
    const resolved = await resolveCallbackAction(ctx, ctx.match[1] ?? '')
    if (!resolved) {
      return
    }

    const fallbackT = getBotTranslations('en').agent
    if (!resolved.payload) {
      await ctx.answerCallbackQuery({ text: fallbackT.actionUnavailable, show_alert: true })
      return
    }

    const payload = resolved.payload
    const t = getBotTranslations(payload.locale).agent
    const actor = await actorMember(payload.householdId, resolved.actorTelegramUserId)
    const allowed = canResolveAgentAction({
      payload,
      actorTelegramUserId: resolved.actorTelegramUserId,
      actorIsAdmin: actor?.isAdmin === true
    })
    if (!allowed) {
      await ctx.answerCallbackQuery({ text: t.notYourAction, show_alert: true })
      return
    }

    let succeeded = false
    try {
      succeeded = await executeAgentAction(
        options.financeServiceForHousehold(payload.householdId),
        payload
      )
    } catch (error) {
      options.logger?.error(
        { event: 'agent_action.execute_failed', actionType: payload.actionType, error },
        'Agent action execution failed'
      )
    }

    await options.promptRepository.clearPendingAction(
      resolved.telegramChatId,
      payload.requesterTelegramUserId,
      AGENT_ACTION
    )

    const resultText = succeeded ? t.actionConfirmed(payload.summaryText) : t.actionFailed
    await ctx.answerCallbackQuery({ text: resultText })
    await ctx.editMessageText(resultText, {
      reply_markup: { inline_keyboard: [] }
    })

    if (succeeded && options.auditNotificationService && actor) {
      await options.auditNotificationService.recordEvent({
        householdId: payload.householdId,
        actorMemberId: actor.id,
        actorDisplayName: actor.displayName,
        eventType: `agent.${payload.actionType}`,
        category:
          payload.actionType === 'set_period_rent'
            ? 'period_events'
            : payload.actionType.endsWith('payment')
              ? 'payment_events'
              : 'purchase_events',
        summaryText: resultText,
        metadata: { actionId: payload.actionId, params: payload.params }
      })
    }
  })

  bot.callbackQuery(new RegExp(`^${AGENT_CANCEL_CALLBACK_PREFIX}([0-9a-f]+)$`), async (ctx) => {
    const resolved = await resolveCallbackAction(ctx, ctx.match[1] ?? '')
    if (!resolved) {
      return
    }

    const fallbackT = getBotTranslations('en').agent
    if (!resolved.payload) {
      await ctx.answerCallbackQuery({ text: fallbackT.actionUnavailable, show_alert: true })
      return
    }

    const payload = resolved.payload
    const t = getBotTranslations(payload.locale).agent
    const actor = await actorMember(payload.householdId, resolved.actorTelegramUserId)
    const allowed = canResolveAgentAction({
      payload,
      actorTelegramUserId: resolved.actorTelegramUserId,
      actorIsAdmin: actor?.isAdmin === true
    })
    if (!allowed) {
      await ctx.answerCallbackQuery({ text: t.notYourAction, show_alert: true })
      return
    }

    await options.promptRepository.clearPendingAction(
      resolved.telegramChatId,
      payload.requesterTelegramUserId,
      AGENT_ACTION
    )
    await ctx.answerCallbackQuery({ text: t.actionCancelled })
    await ctx.editMessageText(t.actionCancelled, {
      reply_markup: { inline_keyboard: [] }
    })
  })
}
