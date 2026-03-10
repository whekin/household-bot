import { parsePaymentConfirmationMessage, type FinanceCommandService } from '@household/application'
import { Money } from '@household/domain'
import type { Logger } from '@household/observability'
import type {
  HouseholdConfigurationRepository,
  TelegramPendingActionRepository
} from '@household/ports'
import type { Bot, Context } from 'grammy'

import { resolveReplyLocale } from './bot-locale'
import { getBotTranslations, type BotLocale } from './i18n'
import type { AssistantReply, ConversationalAssistant } from './openai-chat-assistant'

const ASSISTANT_PAYMENT_ACTION = 'assistant_payment_confirmation' as const
const ASSISTANT_PAYMENT_CONFIRM_CALLBACK_PREFIX = 'assistant_payment:confirm:'
const ASSISTANT_PAYMENT_CANCEL_CALLBACK_PREFIX = 'assistant_payment:cancel:'
const MEMORY_SUMMARY_MAX_CHARS = 1200

interface AssistantConversationTurn {
  role: 'user' | 'assistant'
  text: string
}

interface AssistantConversationState {
  summary: string | null
  turns: AssistantConversationTurn[]
}

export interface AssistantConversationMemoryStore {
  get(key: string): AssistantConversationState
  appendTurn(key: string, turn: AssistantConversationTurn): AssistantConversationState
}

export interface AssistantRateLimitResult {
  allowed: boolean
  retryAfterMs: number
}

export interface AssistantRateLimiter {
  consume(key: string): AssistantRateLimitResult
}

export interface AssistantUsageSnapshot {
  householdId: string
  telegramUserId: string
  displayName: string
  requestCount: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  updatedAt: string
}

export interface AssistantUsageTracker {
  record(input: {
    householdId: string
    telegramUserId: string
    displayName: string
    usage: AssistantReply['usage']
  }): void
  listHouseholdUsage(householdId: string): readonly AssistantUsageSnapshot[]
}

interface PaymentProposalPayload {
  proposalId: string
  householdId: string
  memberId: string
  kind: 'rent' | 'utilities'
  amountMinor: string
  currency: 'GEL' | 'USD'
}

function isPrivateChat(ctx: Context): boolean {
  return ctx.chat?.type === 'private'
}

function isCommandMessage(ctx: Context): boolean {
  return typeof ctx.msg?.text === 'string' && ctx.msg.text.trim().startsWith('/')
}

function summarizeTurns(
  summary: string | null,
  turns: readonly AssistantConversationTurn[]
): string {
  const next = [summary, ...turns.map((turn) => `${turn.role}: ${turn.text}`)]
    .filter(Boolean)
    .join('\n')

  return next.length <= MEMORY_SUMMARY_MAX_CHARS
    ? next
    : next.slice(next.length - MEMORY_SUMMARY_MAX_CHARS)
}

export function createInMemoryAssistantConversationMemoryStore(
  maxTurns: number
): AssistantConversationMemoryStore {
  const memory = new Map<string, AssistantConversationState>()

  return {
    get(key) {
      return memory.get(key) ?? { summary: null, turns: [] }
    },

    appendTurn(key, turn) {
      const current = memory.get(key) ?? { summary: null, turns: [] }
      const nextTurns = [...current.turns, turn]

      if (nextTurns.length <= maxTurns) {
        const nextState = {
          summary: current.summary,
          turns: nextTurns
        }
        memory.set(key, nextState)
        return nextState
      }

      const overflowCount = nextTurns.length - maxTurns
      const overflow = nextTurns.slice(0, overflowCount)
      const retained = nextTurns.slice(overflowCount)
      const nextState = {
        summary: summarizeTurns(current.summary, overflow),
        turns: retained
      }
      memory.set(key, nextState)
      return nextState
    }
  }
}

export function createInMemoryAssistantRateLimiter(config: {
  burstLimit: number
  burstWindowMs: number
  rollingLimit: number
  rollingWindowMs: number
}): AssistantRateLimiter {
  const timestamps = new Map<string, number[]>()

  return {
    consume(key) {
      const now = Date.now()
      const events = (timestamps.get(key) ?? []).filter(
        (timestamp) => now - timestamp < config.rollingWindowMs
      )
      const burstEvents = events.filter((timestamp) => now - timestamp < config.burstWindowMs)

      if (burstEvents.length >= config.burstLimit) {
        const oldestBurstEvent = burstEvents[0] ?? now
        return {
          allowed: false,
          retryAfterMs: Math.max(1, config.burstWindowMs - (now - oldestBurstEvent))
        }
      }

      if (events.length >= config.rollingLimit) {
        const oldestEvent = events[0] ?? now
        return {
          allowed: false,
          retryAfterMs: Math.max(1, config.rollingWindowMs - (now - oldestEvent))
        }
      }

      events.push(now)
      timestamps.set(key, events)

      return {
        allowed: true,
        retryAfterMs: 0
      }
    }
  }
}

export function createInMemoryAssistantUsageTracker(): AssistantUsageTracker {
  const usage = new Map<string, AssistantUsageSnapshot>()

  return {
    record(input) {
      const key = `${input.householdId}:${input.telegramUserId}`
      const current = usage.get(key)

      usage.set(key, {
        householdId: input.householdId,
        telegramUserId: input.telegramUserId,
        displayName: input.displayName,
        requestCount: (current?.requestCount ?? 0) + 1,
        inputTokens: (current?.inputTokens ?? 0) + input.usage.inputTokens,
        outputTokens: (current?.outputTokens ?? 0) + input.usage.outputTokens,
        totalTokens: (current?.totalTokens ?? 0) + input.usage.totalTokens,
        updatedAt: new Date().toISOString()
      })
    },

    listHouseholdUsage(householdId) {
      return [...usage.values()]
        .filter((entry) => entry.householdId === householdId)
        .sort((left, right) => right.totalTokens - left.totalTokens)
    }
  }
}

function formatRetryDelay(locale: BotLocale, retryAfterMs: number): string {
  const t = getBotTranslations(locale).assistant
  const roundedMinutes = Math.ceil(retryAfterMs / 60_000)

  if (roundedMinutes <= 1) {
    return t.retryInLessThanMinute
  }

  const hours = Math.floor(roundedMinutes / 60)
  const minutes = roundedMinutes % 60
  const parts = [hours > 0 ? t.hour(hours) : null, minutes > 0 ? t.minute(minutes) : null].filter(
    Boolean
  )

  return t.retryIn(parts.join(' '))
}

function paymentProposalReplyMarkup(locale: BotLocale, proposalId: string) {
  const t = getBotTranslations(locale).assistant

  return {
    inline_keyboard: [
      [
        {
          text: t.paymentConfirmButton,
          callback_data: `${ASSISTANT_PAYMENT_CONFIRM_CALLBACK_PREFIX}${proposalId}`
        },
        {
          text: t.paymentCancelButton,
          callback_data: `${ASSISTANT_PAYMENT_CANCEL_CALLBACK_PREFIX}${proposalId}`
        }
      ]
    ]
  }
}

function parsePaymentProposalPayload(
  payload: Record<string, unknown>
): PaymentProposalPayload | null {
  if (
    typeof payload.proposalId !== 'string' ||
    typeof payload.householdId !== 'string' ||
    typeof payload.memberId !== 'string' ||
    (payload.kind !== 'rent' && payload.kind !== 'utilities') ||
    typeof payload.amountMinor !== 'string' ||
    (payload.currency !== 'USD' && payload.currency !== 'GEL')
  ) {
    return null
  }

  if (!/^[0-9]+$/.test(payload.amountMinor)) {
    return null
  }

  return {
    proposalId: payload.proposalId,
    householdId: payload.householdId,
    memberId: payload.memberId,
    kind: payload.kind,
    amountMinor: payload.amountMinor,
    currency: payload.currency
  }
}

function formatAssistantLedger(
  dashboard: NonNullable<Awaited<ReturnType<FinanceCommandService['generateDashboard']>>>
) {
  const recentLedger = dashboard.ledger.slice(-5)
  if (recentLedger.length === 0) {
    return 'No recent ledger activity.'
  }

  return recentLedger
    .map(
      (entry) =>
        `- ${entry.kind}: ${entry.title} ${entry.displayAmount.toMajorString()} ${entry.displayCurrency} by ${entry.actorDisplayName ?? 'unknown'} on ${entry.occurredAt ?? 'unknown date'}`
    )
    .join('\n')
}

async function buildHouseholdContext(input: {
  householdId: string
  memberId: string
  memberDisplayName: string
  locale: BotLocale
  householdConfigurationRepository: HouseholdConfigurationRepository
  financeService: FinanceCommandService
}): Promise<string> {
  const [household, settings, dashboard] = await Promise.all([
    input.householdConfigurationRepository.getHouseholdChatByHouseholdId(input.householdId),
    input.householdConfigurationRepository.getHouseholdBillingSettings(input.householdId),
    input.financeService.generateDashboard()
  ])

  const lines = [
    `Household: ${household?.householdName ?? input.householdId}`,
    `User display name: ${input.memberDisplayName}`,
    `Locale: ${input.locale}`,
    `Settlement currency: ${settings.settlementCurrency}`,
    `Timezone: ${settings.timezone}`,
    `Current billing cycle: ${dashboard?.period ?? 'not available'}`
  ]

  if (!dashboard) {
    lines.push('No current dashboard data is available yet.')
    return lines.join('\n')
  }

  const memberLine = dashboard.members.find((line) => line.memberId === input.memberId)
  if (memberLine) {
    lines.push(
      `Member balance: due ${memberLine.netDue.toMajorString()} ${dashboard.currency}, paid ${memberLine.paid.toMajorString()} ${dashboard.currency}, remaining ${memberLine.remaining.toMajorString()} ${dashboard.currency}`
    )
    lines.push(
      `Rent share: ${memberLine.rentShare.toMajorString()} ${dashboard.currency}; utility share: ${memberLine.utilityShare.toMajorString()} ${dashboard.currency}; purchase offset: ${memberLine.purchaseOffset.toMajorString()} ${dashboard.currency}`
    )
  }

  lines.push(
    `Household total remaining: ${dashboard.totalRemaining.toMajorString()} ${dashboard.currency}`
  )
  lines.push(`Recent ledger activity:\n${formatAssistantLedger(dashboard)}`)

  return lines.join('\n')
}

async function maybeCreatePaymentProposal(input: {
  rawText: string
  householdId: string
  memberId: string
  financeService: FinanceCommandService
  householdConfigurationRepository: HouseholdConfigurationRepository
}): Promise<
  | {
      status: 'no_intent'
    }
  | {
      status: 'clarification'
    }
  | {
      status: 'unsupported_currency'
    }
  | {
      status: 'no_balance'
    }
  | {
      status: 'proposal'
      payload: PaymentProposalPayload
    }
> {
  const settings = await input.householdConfigurationRepository.getHouseholdBillingSettings(
    input.householdId
  )
  const parsed = parsePaymentConfirmationMessage(input.rawText, settings.settlementCurrency)

  if (!parsed.kind && parsed.reviewReason === 'intent_missing') {
    return {
      status: 'no_intent'
    }
  }

  if (!parsed.kind || parsed.reviewReason) {
    return {
      status: 'clarification'
    }
  }

  const dashboard = await input.financeService.generateDashboard()
  if (!dashboard) {
    return {
      status: 'clarification'
    }
  }

  const memberLine = dashboard.members.find((line) => line.memberId === input.memberId)
  if (!memberLine) {
    return {
      status: 'clarification'
    }
  }

  if (parsed.explicitAmount && parsed.explicitAmount.currency !== dashboard.currency) {
    return {
      status: 'unsupported_currency'
    }
  }

  const amount =
    parsed.explicitAmount ??
    (parsed.kind === 'rent'
      ? memberLine.rentShare
      : memberLine.utilityShare.add(memberLine.purchaseOffset))

  if (amount.amountMinor <= 0n) {
    return {
      status: 'no_balance'
    }
  }

  return {
    status: 'proposal',
    payload: {
      proposalId: crypto.randomUUID(),
      householdId: input.householdId,
      memberId: input.memberId,
      kind: parsed.kind,
      amountMinor: amount.amountMinor.toString(),
      currency: amount.currency
    }
  }
}

export function registerDmAssistant(options: {
  bot: Bot
  assistant?: ConversationalAssistant
  householdConfigurationRepository: HouseholdConfigurationRepository
  promptRepository: TelegramPendingActionRepository
  financeServiceForHousehold: (householdId: string) => FinanceCommandService
  memoryStore: AssistantConversationMemoryStore
  rateLimiter: AssistantRateLimiter
  usageTracker: AssistantUsageTracker
  logger?: Logger
}): void {
  options.bot.callbackQuery(
    new RegExp(`^${ASSISTANT_PAYMENT_CONFIRM_CALLBACK_PREFIX}([^:]+)$`),
    async (ctx) => {
      if (!isPrivateChat(ctx)) {
        await ctx.answerCallbackQuery({
          text: getBotTranslations('en').assistant.paymentUnavailable,
          show_alert: true
        })
        return
      }

      const telegramUserId = ctx.from?.id?.toString()
      const telegramChatId = ctx.chat?.id?.toString()
      const proposalId = ctx.match[1]
      if (!telegramUserId || !telegramChatId || !proposalId) {
        await ctx.answerCallbackQuery({
          text: getBotTranslations('en').assistant.paymentUnavailable,
          show_alert: true
        })
        return
      }

      const pending = await options.promptRepository.getPendingAction(
        telegramChatId,
        telegramUserId
      )
      const locale = await resolveReplyLocale({
        ctx,
        repository: options.householdConfigurationRepository
      })
      const t = getBotTranslations(locale).assistant
      const payload =
        pending?.action === ASSISTANT_PAYMENT_ACTION
          ? parsePaymentProposalPayload(pending.payload)
          : null

      if (!payload || payload.proposalId !== proposalId) {
        await ctx.answerCallbackQuery({
          text: t.paymentUnavailable,
          show_alert: true
        })
        return
      }

      const amount = Money.fromMinor(BigInt(payload.amountMinor), payload.currency)
      const result = await options
        .financeServiceForHousehold(payload.householdId)
        .addPayment(payload.memberId, payload.kind, amount.toMajorString(), amount.currency)

      await options.promptRepository.clearPendingAction(telegramChatId, telegramUserId)

      if (!result) {
        await ctx.answerCallbackQuery({
          text: t.paymentNoBalance,
          show_alert: true
        })
        return
      }

      await ctx.answerCallbackQuery({
        text: t.paymentConfirmed(payload.kind, result.amount.toMajorString(), result.currency)
      })

      if (ctx.msg) {
        await ctx.editMessageText(
          t.paymentConfirmed(payload.kind, result.amount.toMajorString(), result.currency),
          {
            reply_markup: {
              inline_keyboard: []
            }
          }
        )
      }
    }
  )

  options.bot.callbackQuery(
    new RegExp(`^${ASSISTANT_PAYMENT_CANCEL_CALLBACK_PREFIX}([^:]+)$`),
    async (ctx) => {
      if (!isPrivateChat(ctx)) {
        await ctx.answerCallbackQuery({
          text: getBotTranslations('en').assistant.paymentUnavailable,
          show_alert: true
        })
        return
      }

      const telegramUserId = ctx.from?.id?.toString()
      const telegramChatId = ctx.chat?.id?.toString()
      const proposalId = ctx.match[1]
      if (!telegramUserId || !telegramChatId || !proposalId) {
        await ctx.answerCallbackQuery({
          text: getBotTranslations('en').assistant.paymentUnavailable,
          show_alert: true
        })
        return
      }

      const pending = await options.promptRepository.getPendingAction(
        telegramChatId,
        telegramUserId
      )
      const locale = await resolveReplyLocale({
        ctx,
        repository: options.householdConfigurationRepository
      })
      const t = getBotTranslations(locale).assistant
      const payload =
        pending?.action === ASSISTANT_PAYMENT_ACTION
          ? parsePaymentProposalPayload(pending.payload)
          : null

      if (!payload || payload.proposalId !== proposalId) {
        await ctx.answerCallbackQuery({
          text: t.paymentAlreadyHandled,
          show_alert: true
        })
        return
      }

      await options.promptRepository.clearPendingAction(telegramChatId, telegramUserId)
      await ctx.answerCallbackQuery({
        text: t.paymentCancelled
      })

      if (ctx.msg) {
        await ctx.editMessageText(t.paymentCancelled, {
          reply_markup: {
            inline_keyboard: []
          }
        })
      }
    }
  )

  options.bot.on('message:text', async (ctx, next) => {
    if (!isPrivateChat(ctx) || isCommandMessage(ctx)) {
      await next()
      return
    }

    const telegramUserId = ctx.from?.id?.toString()
    const telegramChatId = ctx.chat?.id?.toString()
    if (!telegramUserId || !telegramChatId) {
      await next()
      return
    }

    const memberships =
      await options.householdConfigurationRepository.listHouseholdMembersByTelegramUserId(
        telegramUserId
      )
    const locale = await resolveReplyLocale({
      ctx,
      repository: options.householdConfigurationRepository
    })
    const t = getBotTranslations(locale).assistant

    if (memberships.length === 0) {
      await ctx.reply(t.noHousehold)
      return
    }

    if (memberships.length > 1) {
      await ctx.reply(t.multipleHouseholds)
      return
    }

    const member = memberships[0]!
    const rateLimit = options.rateLimiter.consume(`${member.householdId}:${telegramUserId}`)
    if (!rateLimit.allowed) {
      await ctx.reply(t.rateLimited(formatRetryDelay(locale, rateLimit.retryAfterMs)))
      return
    }

    const financeService = options.financeServiceForHousehold(member.householdId)
    const paymentProposal = await maybeCreatePaymentProposal({
      rawText: ctx.msg.text,
      householdId: member.householdId,
      memberId: member.id,
      financeService,
      householdConfigurationRepository: options.householdConfigurationRepository
    })

    if (paymentProposal.status === 'clarification') {
      await ctx.reply(t.paymentClarification)
      return
    }

    if (paymentProposal.status === 'unsupported_currency') {
      await ctx.reply(t.paymentUnsupportedCurrency)
      return
    }

    if (paymentProposal.status === 'no_balance') {
      await ctx.reply(t.paymentNoBalance)
      return
    }

    if (paymentProposal.status === 'proposal') {
      await options.promptRepository.upsertPendingAction({
        telegramUserId,
        telegramChatId,
        action: ASSISTANT_PAYMENT_ACTION,
        payload: {
          ...paymentProposal.payload
        },
        expiresAt: null
      })

      const amount = Money.fromMinor(
        BigInt(paymentProposal.payload.amountMinor),
        paymentProposal.payload.currency
      )
      const proposalText = t.paymentProposal(
        paymentProposal.payload.kind,
        amount.toMajorString(),
        amount.currency
      )
      options.memoryStore.appendTurn(telegramUserId, {
        role: 'user',
        text: ctx.msg.text
      })
      options.memoryStore.appendTurn(telegramUserId, {
        role: 'assistant',
        text: proposalText
      })

      await ctx.reply(proposalText, {
        reply_markup: paymentProposalReplyMarkup(locale, paymentProposal.payload.proposalId)
      })
      return
    }

    if (!options.assistant) {
      await ctx.reply(t.unavailable)
      return
    }

    const memory = options.memoryStore.get(telegramUserId)
    const householdContext = await buildHouseholdContext({
      householdId: member.householdId,
      memberId: member.id,
      memberDisplayName: member.displayName,
      locale,
      householdConfigurationRepository: options.householdConfigurationRepository,
      financeService
    })

    try {
      const reply = await options.assistant.respond({
        locale,
        householdContext,
        memorySummary: memory.summary,
        recentTurns: memory.turns,
        userMessage: ctx.msg.text
      })

      options.usageTracker.record({
        householdId: member.householdId,
        telegramUserId,
        displayName: member.displayName,
        usage: reply.usage
      })
      options.memoryStore.appendTurn(telegramUserId, {
        role: 'user',
        text: ctx.msg.text
      })
      options.memoryStore.appendTurn(telegramUserId, {
        role: 'assistant',
        text: reply.text
      })

      options.logger?.info(
        {
          event: 'assistant.reply',
          householdId: member.householdId,
          telegramUserId,
          inputTokens: reply.usage.inputTokens,
          outputTokens: reply.usage.outputTokens,
          totalTokens: reply.usage.totalTokens
        },
        'DM assistant reply generated'
      )

      await ctx.reply(reply.text)
    } catch (error) {
      options.logger?.error(
        {
          event: 'assistant.reply_failed',
          householdId: member.householdId,
          telegramUserId,
          error
        },
        'DM assistant reply failed'
      )
      await ctx.reply(t.unavailable)
    }
  })
}
