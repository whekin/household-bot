import { buildMemberPaymentGuidance, type FinanceCommandService } from '@household/application'
import { instantFromEpochSeconds, Money } from '@household/domain'
import type { Logger } from '@household/observability'
import type {
  HouseholdConfigurationRepository,
  ProcessedBotMessageRepository,
  TelegramPendingActionRepository,
  TopicMessageHistoryRepository
} from '@household/ports'
import type { Bot, Context } from 'grammy'

import { resolveReplyLocale } from './bot-locale'
import { getBotTranslations, type BotLocale } from './i18n'
import type {
  AssistantConversationMemoryStore,
  AssistantRateLimiter,
  AssistantUsageTracker
} from './assistant-state'
import { conversationMemoryKey } from './assistant-state'
import type { ConversationalAssistant } from './openai-chat-assistant'
import type { PurchaseMessageInterpreter } from './openai-purchase-interpreter'
import {
  formatPaymentBalanceReplyText,
  formatPaymentProposalText,
  maybeCreatePaymentBalanceReply,
  maybeCreatePaymentProposal,
  parsePaymentProposalPayload
} from './payment-proposals'
import { maybeCreateMemberInsightReply } from './member-queries'
import type {
  PurchaseMessageIngestionRepository,
  PurchaseProposalActionResult,
  PurchaseTopicRecord
} from './purchase-topic-ingestion'
import type { TopicMessageRouter, TopicMessageRole } from './topic-message-router'
import {
  fallbackTopicMessageRoute,
  getCachedTopicMessageRoute,
  looksLikeDirectBotAddress
} from './topic-message-router'
import {
  historyRecordToTurn,
  shouldLoadExpandedChatHistory,
  startOfCurrentDayInTimezone
} from './topic-history'
import { startTypingIndicator } from './telegram-chat-action'
import { stripExplicitBotMention } from './telegram-mentions'

export type { AssistantConversationMemoryStore, AssistantUsageTracker } from './assistant-state'
export {
  createInMemoryAssistantConversationMemoryStore,
  createInMemoryAssistantRateLimiter,
  createInMemoryAssistantUsageTracker
} from './assistant-state'

const ASSISTANT_PAYMENT_ACTION = 'assistant_payment_confirmation' as const
const ASSISTANT_PAYMENT_CONFIRM_CALLBACK_PREFIX = 'assistant_payment:confirm:'
const ASSISTANT_PAYMENT_CANCEL_CALLBACK_PREFIX = 'assistant_payment:cancel:'
const ASSISTANT_PURCHASE_CONFIRM_CALLBACK_PREFIX = 'assistant_purchase:confirm:'
const ASSISTANT_PURCHASE_CANCEL_CALLBACK_PREFIX = 'assistant_purchase:cancel:'
const DM_ASSISTANT_MESSAGE_SOURCE = 'telegram-dm-assistant'
const GROUP_ASSISTANT_MESSAGE_SOURCE = 'telegram-group-assistant'
const PURCHASE_VERB_PATTERN =
  /\b(?:bought|buy|got|picked up|spent|купил(?:а|и)?|взял(?:а|и)?|выложил(?:а|и)?|отдал(?:а|и)?|потратил(?:а|и)?)\b/iu
const PURCHASE_MONEY_PATTERN =
  /(?:\d+(?:[.,]\d{1,2})?\s*(?:₾|gel|lari|лари|usd|\$|доллар(?:а|ов)?|кровн\p{L}*)|\b\d+(?:[.,]\d{1,2})\b)/iu

type PurchaseActionResult = Extract<
  PurchaseProposalActionResult,
  { status: 'confirmed' | 'already_confirmed' | 'cancelled' | 'already_cancelled' }
>

function describeError(error: unknown): {
  errorMessage?: string
  errorName?: string
} {
  if (error instanceof Error) {
    return {
      errorMessage: error.message,
      errorName: error.name
    }
  }

  if (typeof error === 'string') {
    return {
      errorMessage: error
    }
  }

  return {}
}

function isPrivateChat(ctx: Context): boolean {
  return ctx.chat?.type === 'private'
}

function isGroupChat(ctx: Context): boolean {
  return ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup'
}

function isCommandMessage(ctx: Context): boolean {
  return typeof ctx.msg?.text === 'string' && ctx.msg.text.trim().startsWith('/')
}

function isReplyToBotMessage(ctx: Context): boolean {
  const replyAuthor = ctx.msg?.reply_to_message?.from
  if (!replyAuthor) {
    return false
  }

  return replyAuthor.id === ctx.me.id
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

function purchaseProposalReplyMarkup(locale: BotLocale, purchaseMessageId: string) {
  const t = getBotTranslations(locale).purchase

  return {
    inline_keyboard: [
      [
        {
          text: t.confirmButton,
          callback_data: `${ASSISTANT_PURCHASE_CONFIRM_CALLBACK_PREFIX}${purchaseMessageId}`
        },
        {
          text: t.cancelButton,
          callback_data: `${ASSISTANT_PURCHASE_CANCEL_CALLBACK_PREFIX}${purchaseMessageId}`
        }
      ]
    ]
  }
}

function formatPurchaseSummary(
  locale: BotLocale,
  result: {
    parsedAmountMinor: bigint | null
    parsedCurrency: 'GEL' | 'USD' | null
    parsedItemDescription: string | null
  }
): string {
  if (
    result.parsedAmountMinor === null ||
    result.parsedCurrency === null ||
    result.parsedItemDescription === null
  ) {
    return getBotTranslations(locale).purchase.sharedPurchaseFallback
  }

  const amount = Money.fromMinor(result.parsedAmountMinor, result.parsedCurrency)
  return `${result.parsedItemDescription} - ${amount.toMajorString()} ${result.parsedCurrency}`
}

function buildPurchaseActionMessage(locale: BotLocale, result: PurchaseActionResult): string {
  const t = getBotTranslations(locale).purchase
  const summary = formatPurchaseSummary(locale, result)

  if (result.status === 'confirmed' || result.status === 'already_confirmed') {
    return t.confirmed(summary)
  }

  return t.cancelled(summary)
}

function buildPurchaseClarificationText(
  locale: BotLocale,
  result: {
    clarificationQuestion: string | null
    parsedAmountMinor: bigint | null
    parsedCurrency: 'GEL' | 'USD' | null
    parsedItemDescription: string | null
  }
): string {
  const t = getBotTranslations(locale).purchase
  if (result.clarificationQuestion) {
    return t.clarification(result.clarificationQuestion)
  }

  if (result.parsedAmountMinor === null && result.parsedCurrency === null) {
    return t.clarificationMissingAmountAndCurrency
  }

  if (result.parsedAmountMinor === null) {
    return t.clarificationMissingAmount
  }

  if (result.parsedCurrency === null) {
    return t.clarificationMissingCurrency
  }

  if (result.parsedItemDescription === null) {
    return t.clarificationMissingItem
  }

  return t.clarificationLowConfidence
}

function createDmPurchaseRecord(ctx: Context, householdId: string): PurchaseTopicRecord | null {
  if (!isPrivateChat(ctx) || !ctx.msg || !('text' in ctx.msg) || !ctx.from) {
    return null
  }

  const chat = ctx.chat
  if (!chat) {
    return null
  }

  const senderDisplayName = [ctx.from.first_name, ctx.from.last_name]
    .filter((part) => !!part && part.trim().length > 0)
    .join(' ')

  return {
    updateId: ctx.update.update_id,
    householdId,
    chatId: chat.id.toString(),
    messageId: ctx.msg.message_id.toString(),
    threadId: chat.id.toString(),
    senderTelegramUserId: ctx.from.id.toString(),
    rawText: ctx.msg.text.trim(),
    messageSentAt: instantFromEpochSeconds(ctx.msg.date),
    ...(senderDisplayName.length > 0
      ? {
          senderDisplayName
        }
      : {})
  }
}

function createGroupPurchaseRecord(
  ctx: Context,
  householdId: string,
  rawText: string
): PurchaseTopicRecord | null {
  if (!isGroupChat(ctx) || !ctx.msg || !ctx.from) {
    return null
  }

  const normalized = rawText.trim()
  if (normalized.length === 0) {
    return null
  }

  const senderDisplayName = [ctx.from.first_name, ctx.from.last_name]
    .filter((part) => !!part && part.trim().length > 0)
    .join(' ')

  return {
    updateId: ctx.update.update_id,
    householdId,
    chatId: ctx.chat!.id.toString(),
    messageId: ctx.msg.message_id.toString(),
    threadId:
      'message_thread_id' in ctx.msg && ctx.msg.message_thread_id !== undefined
        ? ctx.msg.message_thread_id.toString()
        : ctx.chat!.id.toString(),
    senderTelegramUserId: ctx.from.id.toString(),
    rawText: normalized,
    messageSentAt: instantFromEpochSeconds(ctx.msg.date),
    ...(senderDisplayName.length > 0
      ? {
          senderDisplayName
        }
      : {})
  }
}

function looksLikePurchaseIntent(rawText: string): boolean {
  const normalized = rawText.trim()
  if (normalized.length === 0) {
    return false
  }

  if (PURCHASE_VERB_PATTERN.test(normalized)) {
    return true
  }

  return PURCHASE_MONEY_PATTERN.test(normalized) && /\p{L}/u.test(normalized)
}

async function resolveAssistantConfig(
  householdConfigurationRepository: HouseholdConfigurationRepository,
  householdId: string
) {
  return householdConfigurationRepository.getHouseholdAssistantConfig
    ? await householdConfigurationRepository.getHouseholdAssistantConfig(householdId)
    : {
        householdId,
        assistantContext: null,
        assistantTone: null
      }
}

function currentThreadId(ctx: Context): string | null {
  return ctx.msg && 'message_thread_id' in ctx.msg && ctx.msg.message_thread_id !== undefined
    ? ctx.msg.message_thread_id.toString()
    : null
}

function currentMessageId(ctx: Context): string | null {
  return ctx.msg?.message_id?.toString() ?? null
}

function currentMessageSentAt(ctx: Context) {
  return typeof ctx.msg?.date === 'number' ? instantFromEpochSeconds(ctx.msg.date) : null
}

async function listRecentThreadMessages(input: {
  repository: TopicMessageHistoryRepository | undefined
  householdId: string
  telegramChatId: string
  telegramThreadId: string | null
}) {
  if (!input.repository || !input.telegramThreadId) {
    return []
  }

  const messages = await input.repository.listRecentThreadMessages({
    householdId: input.householdId,
    telegramChatId: input.telegramChatId,
    telegramThreadId: input.telegramThreadId,
    limit: 8
  })

  return messages.map(historyRecordToTurn)
}

async function listExpandedChatMessages(input: {
  repository: TopicMessageHistoryRepository | undefined
  householdId: string
  telegramChatId: string
  timezone: string
  shouldLoad: boolean
}) {
  if (!input.repository || !input.shouldLoad) {
    return []
  }

  const messages = await input.repository.listRecentChatMessages({
    householdId: input.householdId,
    telegramChatId: input.telegramChatId,
    sentAtOrAfter: startOfCurrentDayInTimezone(input.timezone),
    limit: 40
  })

  return messages.map(historyRecordToTurn)
}

async function persistIncomingTopicMessage(input: {
  repository: TopicMessageHistoryRepository | undefined
  householdId: string
  telegramChatId: string
  telegramThreadId: string | null
  telegramMessageId: string | null
  telegramUpdateId: string | null
  senderTelegramUserId: string
  senderDisplayName: string | null
  rawText: string
  messageSentAt: ReturnType<typeof currentMessageSentAt>
}) {
  const normalizedText = input.rawText.trim()
  if (!input.repository || normalizedText.length === 0) {
    return
  }

  await input.repository.saveMessage({
    householdId: input.householdId,
    telegramChatId: input.telegramChatId,
    telegramThreadId: input.telegramThreadId,
    telegramMessageId: input.telegramMessageId,
    telegramUpdateId: input.telegramUpdateId,
    senderTelegramUserId: input.senderTelegramUserId,
    senderDisplayName: input.senderDisplayName,
    isBot: false,
    rawText: normalizedText,
    messageSentAt: input.messageSentAt
  })
}

async function routeGroupAssistantMessage(input: {
  router: TopicMessageRouter | undefined
  locale: BotLocale
  topicRole: TopicMessageRole
  messageText: string
  isExplicitMention: boolean
  isReplyToBot: boolean
  assistantContext: string | null
  assistantTone: string | null
  memoryStore: AssistantConversationMemoryStore
  memoryKey: string
  recentThreadMessages: readonly {
    role: 'user' | 'assistant'
    speaker: string
    text: string
    threadId: string | null
  }[]
}) {
  if (!input.router) {
    return fallbackTopicMessageRoute({
      locale: input.locale,
      topicRole: input.topicRole,
      messageText: input.messageText,
      isExplicitMention: input.isExplicitMention,
      isReplyToBot: input.isReplyToBot,
      activeWorkflow: null,
      assistantContext: input.assistantContext,
      assistantTone: input.assistantTone,
      recentTurns: input.memoryStore.get(input.memoryKey).turns,
      recentThreadMessages: input.recentThreadMessages
    })
  }

  return input.router({
    locale: input.locale,
    topicRole: input.topicRole,
    messageText: input.messageText,
    isExplicitMention: input.isExplicitMention,
    isReplyToBot: input.isReplyToBot,
    activeWorkflow: null,
    assistantContext: input.assistantContext,
    assistantTone: input.assistantTone,
    recentTurns: input.memoryStore.get(input.memoryKey).turns,
    recentThreadMessages: input.recentThreadMessages
  })
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
  const [household, settings, assistantConfig, dashboard, members] = await Promise.all([
    input.householdConfigurationRepository.getHouseholdChatByHouseholdId(input.householdId),
    input.householdConfigurationRepository.getHouseholdBillingSettings(input.householdId),
    resolveAssistantConfig(input.householdConfigurationRepository, input.householdId),
    input.financeService.generateDashboard(),
    input.householdConfigurationRepository.listHouseholdMembers(input.householdId)
  ])

  const lines = [
    `Household: ${household?.householdName ?? input.householdId}`,
    `User display name: ${input.memberDisplayName}`,
    `Locale: ${input.locale}`,
    `Settlement currency: ${settings.settlementCurrency}`,
    `Timezone: ${settings.timezone}`,
    `Current billing cycle: ${dashboard?.period ?? 'not available'}`
  ]

  if (assistantConfig.assistantTone) {
    lines.push(`Preferred assistant tone: ${assistantConfig.assistantTone}`)
  }

  if (assistantConfig.assistantContext) {
    lines.push(`Household narrative context: ${assistantConfig.assistantContext}`)
  }

  if (!dashboard) {
    lines.push('No current dashboard data is available yet.')
    return lines.join('\n')
  }

  const memberLine = dashboard.members.find((line) => line.memberId === input.memberId)
  if (memberLine) {
    const rentGuidance = buildMemberPaymentGuidance({
      kind: 'rent',
      period: dashboard.period,
      memberLine,
      settings
    })
    const utilitiesGuidance = buildMemberPaymentGuidance({
      kind: 'utilities',
      period: dashboard.period,
      memberLine,
      settings
    })

    lines.push(
      `Member balance: due ${memberLine.netDue.toMajorString()} ${dashboard.currency}, paid ${memberLine.paid.toMajorString()} ${dashboard.currency}, remaining ${memberLine.remaining.toMajorString()} ${dashboard.currency}`
    )
    lines.push(
      `Rent share: ${memberLine.rentShare.toMajorString()} ${dashboard.currency}; utility share: ${memberLine.utilityShare.toMajorString()} ${dashboard.currency}; purchase offset: ${memberLine.purchaseOffset.toMajorString()} ${dashboard.currency}`
    )
    lines.push(
      `Payment adjustment policy: ${settings.paymentBalanceAdjustmentPolicy ?? 'utilities'}`
    )
    lines.push(
      `Rent payment guidance: base ${rentGuidance.baseAmount.toMajorString()} ${dashboard.currency}; purchase offset ${rentGuidance.purchaseOffset.toMajorString()} ${dashboard.currency}; suggested payment ${rentGuidance.proposalAmount.toMajorString()} ${dashboard.currency}; reminder ${rentGuidance.reminderDate}; due ${rentGuidance.dueDate}`
    )
    lines.push(
      `Utilities payment guidance: base ${utilitiesGuidance.baseAmount.toMajorString()} ${dashboard.currency}; purchase offset ${utilitiesGuidance.purchaseOffset.toMajorString()} ${dashboard.currency}; suggested payment ${utilitiesGuidance.proposalAmount.toMajorString()} ${dashboard.currency}; reminder ${utilitiesGuidance.reminderDate}; due ${utilitiesGuidance.dueDate}; payment_window_open=${utilitiesGuidance.paymentWindowOpen}`
    )
  }

  if (members.length > 0) {
    const memberLines = members.map((member) => {
      const dashboardMember = dashboard.members.find((line) => line.memberId === member.id)

      if (!dashboardMember) {
        return `- ${member.displayName}: status=${member.status}, dashboard_line=missing`
      }

      return `- ${member.displayName}: status=${member.status}, rent=${dashboardMember.rentShare.toMajorString()} ${dashboard.currency}, utilities=${dashboardMember.utilityShare.toMajorString()} ${dashboard.currency}, purchases=${dashboardMember.purchaseOffset.toMajorString()} ${dashboard.currency}, remaining=${dashboardMember.remaining.toMajorString()} ${dashboard.currency}`
    })

    lines.push(`Household roster and balances:\n${memberLines.join('\n')}`)
  }

  lines.push(
    `Household total remaining: ${dashboard.totalRemaining.toMajorString()} ${dashboard.currency}`
  )
  lines.push(`Recent ledger activity:\n${formatAssistantLedger(dashboard)}`)

  return lines.join('\n')
}

async function replyWithAssistant(input: {
  ctx: Context
  assistant: ConversationalAssistant | undefined
  topicRole: TopicMessageRole
  householdId: string
  memberId: string
  memberDisplayName: string
  telegramUserId: string
  telegramChatId: string
  locale: BotLocale
  userMessage: string
  householdConfigurationRepository: HouseholdConfigurationRepository
  financeService: FinanceCommandService
  memoryStore: AssistantConversationMemoryStore
  usageTracker: AssistantUsageTracker
  logger: Logger | undefined
  recentThreadMessages: readonly {
    role: 'user' | 'assistant'
    speaker: string
    text: string
    threadId: string | null
  }[]
  sameDayChatMessages: readonly {
    role: 'user' | 'assistant'
    speaker: string
    text: string
    threadId: string | null
  }[]
}): Promise<void> {
  const t = getBotTranslations(input.locale).assistant

  if (!input.assistant) {
    await input.ctx.reply(t.unavailable)
    return
  }

  const memoryKey = conversationMemoryKey({
    telegramUserId: input.telegramUserId,
    telegramChatId: input.telegramChatId,
    isPrivateChat: isPrivateChat(input.ctx)
  })
  const memory = input.memoryStore.get(memoryKey)
  const typingIndicator = startTypingIndicator(input.ctx)
  const assistantStartedAt = Date.now()
  let stage: 'household_context' | 'assistant_response' = 'household_context'
  let contextBuildMs: number | null = null
  let assistantResponseMs: number | null = null

  try {
    const contextStartedAt = Date.now()
    const householdContext = await buildHouseholdContext({
      householdId: input.householdId,
      memberId: input.memberId,
      memberDisplayName: input.memberDisplayName,
      locale: input.locale,
      householdConfigurationRepository: input.householdConfigurationRepository,
      financeService: input.financeService
    })
    contextBuildMs = Date.now() - contextStartedAt
    stage = 'assistant_response'
    const assistantResponseStartedAt = Date.now()
    const reply = await input.assistant.respond({
      locale: input.locale,
      topicRole: input.topicRole,
      householdContext,
      memorySummary: memory.summary,
      recentTurns: memory.turns,
      recentThreadMessages: input.recentThreadMessages,
      sameDayChatMessages: input.sameDayChatMessages,
      userMessage: input.userMessage
    })
    assistantResponseMs = Date.now() - assistantResponseStartedAt

    input.usageTracker.record({
      householdId: input.householdId,
      telegramUserId: input.telegramUserId,
      displayName: input.memberDisplayName,
      usage: reply.usage
    })
    input.memoryStore.appendTurn(memoryKey, {
      role: 'user',
      text: input.userMessage
    })
    input.memoryStore.appendTurn(memoryKey, {
      role: 'assistant',
      text: reply.text
    })

    input.logger?.info(
      {
        event: 'assistant.reply',
        householdId: input.householdId,
        telegramUserId: input.telegramUserId,
        contextBuildMs,
        assistantResponseMs,
        totalDurationMs: Date.now() - assistantStartedAt,
        householdContextChars: householdContext.length,
        recentTurnsCount: memory.turns.length,
        memorySummaryChars: memory.summary?.length ?? 0,
        inputTokens: reply.usage.inputTokens,
        outputTokens: reply.usage.outputTokens,
        totalTokens: reply.usage.totalTokens
      },
      'Assistant reply generated'
    )

    await input.ctx.reply(reply.text)
  } catch (error) {
    input.logger?.error(
      {
        event: 'assistant.reply_failed',
        householdId: input.householdId,
        telegramUserId: input.telegramUserId,
        stage,
        contextBuildMs,
        assistantResponseMs,
        totalDurationMs: Date.now() - assistantStartedAt,
        ...describeError(error),
        error
      },
      'Assistant reply failed'
    )
    await input.ctx.reply(t.unavailable)
  } finally {
    typingIndicator.stop()
  }
}

export function registerDmAssistant(options: {
  bot: Bot
  assistant?: ConversationalAssistant
  topicRouter?: TopicMessageRouter
  topicMessageHistoryRepository?: TopicMessageHistoryRepository
  purchaseRepository?: PurchaseMessageIngestionRepository
  purchaseInterpreter?: PurchaseMessageInterpreter
  householdConfigurationRepository: HouseholdConfigurationRepository
  messageProcessingRepository?: ProcessedBotMessageRepository
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

  options.bot.callbackQuery(
    new RegExp(`^${ASSISTANT_PURCHASE_CONFIRM_CALLBACK_PREFIX}([^:]+)$`),
    async (ctx) => {
      if (!isPrivateChat(ctx) || !options.purchaseRepository) {
        await ctx.answerCallbackQuery({
          text: getBotTranslations('en').purchase.proposalUnavailable,
          show_alert: true
        })
        return
      }

      const purchaseMessageId = ctx.match[1]
      const actorTelegramUserId = ctx.from?.id?.toString()
      if (!actorTelegramUserId || !purchaseMessageId) {
        await ctx.answerCallbackQuery({
          text: getBotTranslations('en').purchase.proposalUnavailable,
          show_alert: true
        })
        return
      }

      const result = await options.purchaseRepository.confirm(
        purchaseMessageId,
        actorTelegramUserId
      )
      const locale =
        'householdId' in result
          ? await resolveReplyLocale({
              ctx,
              repository: options.householdConfigurationRepository
            })
          : 'en'
      const t = getBotTranslations(locale).purchase

      if (result.status === 'not_found' || result.status === 'not_pending') {
        await ctx.answerCallbackQuery({
          text: t.proposalUnavailable,
          show_alert: true
        })
        return
      }

      if (result.status === 'forbidden') {
        await ctx.answerCallbackQuery({
          text: t.notYourProposal,
          show_alert: true
        })
        return
      }

      await ctx.answerCallbackQuery({
        text: result.status === 'confirmed' ? t.confirmedToast : t.alreadyConfirmed
      })

      if (ctx.msg) {
        await ctx.editMessageText(buildPurchaseActionMessage(locale, result), {
          reply_markup: {
            inline_keyboard: []
          }
        })
      }
    }
  )

  options.bot.callbackQuery(
    new RegExp(`^${ASSISTANT_PURCHASE_CANCEL_CALLBACK_PREFIX}([^:]+)$`),
    async (ctx) => {
      if (!isPrivateChat(ctx) || !options.purchaseRepository) {
        await ctx.answerCallbackQuery({
          text: getBotTranslations('en').purchase.proposalUnavailable,
          show_alert: true
        })
        return
      }

      const purchaseMessageId = ctx.match[1]
      const actorTelegramUserId = ctx.from?.id?.toString()
      if (!actorTelegramUserId || !purchaseMessageId) {
        await ctx.answerCallbackQuery({
          text: getBotTranslations('en').purchase.proposalUnavailable,
          show_alert: true
        })
        return
      }

      const result = await options.purchaseRepository.cancel(purchaseMessageId, actorTelegramUserId)
      const locale =
        'householdId' in result
          ? await resolveReplyLocale({
              ctx,
              repository: options.householdConfigurationRepository
            })
          : 'en'
      const t = getBotTranslations(locale).purchase

      if (result.status === 'not_found' || result.status === 'not_pending') {
        await ctx.answerCallbackQuery({
          text: t.proposalUnavailable,
          show_alert: true
        })
        return
      }

      if (result.status === 'forbidden') {
        await ctx.answerCallbackQuery({
          text: t.notYourProposal,
          show_alert: true
        })
        return
      }

      await ctx.answerCallbackQuery({
        text: result.status === 'cancelled' ? t.cancelledToast : t.alreadyCancelled
      })

      if (ctx.msg) {
        await ctx.editMessageText(buildPurchaseActionMessage(locale, result), {
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
    const memoryKey = conversationMemoryKey({
      telegramUserId,
      telegramChatId,
      isPrivateChat: true
    })

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
    const updateId = ctx.update.update_id?.toString()
    const dedupeClaim =
      options.messageProcessingRepository && typeof updateId === 'string'
        ? {
            repository: options.messageProcessingRepository,
            updateId
          }
        : null

    if (dedupeClaim) {
      const claim = await dedupeClaim.repository.claimMessage({
        householdId: member.householdId,
        source: DM_ASSISTANT_MESSAGE_SOURCE,
        sourceMessageKey: dedupeClaim.updateId
      })

      if (!claim.claimed) {
        options.logger?.info(
          {
            event: 'assistant.duplicate_update',
            householdId: member.householdId,
            telegramUserId,
            updateId: dedupeClaim.updateId
          },
          'Duplicate DM assistant update ignored'
        )
        return
      }
    }

    try {
      const rateLimit = options.rateLimiter.consume(`${member.householdId}:${telegramUserId}`)
      if (!rateLimit.allowed) {
        await ctx.reply(t.rateLimited(formatRetryDelay(locale, rateLimit.retryAfterMs)))
        return
      }

      const purchaseRecord = createDmPurchaseRecord(ctx, member.householdId)
      const shouldAttemptPurchase =
        purchaseRecord &&
        options.purchaseRepository &&
        (looksLikePurchaseIntent(purchaseRecord.rawText) ||
          (await options.purchaseRepository.hasClarificationContext(purchaseRecord)))

      if (purchaseRecord && options.purchaseRepository && shouldAttemptPurchase) {
        const typingIndicator = startTypingIndicator(ctx)

        try {
          const [settings, assistantConfig] = await Promise.all([
            options.householdConfigurationRepository.getHouseholdBillingSettings(
              member.householdId
            ),
            resolveAssistantConfig(options.householdConfigurationRepository, member.householdId)
          ])
          const purchaseResult = await options.purchaseRepository.save(
            purchaseRecord,
            options.purchaseInterpreter,
            settings.settlementCurrency,
            {
              householdContext: assistantConfig.assistantContext,
              assistantTone: assistantConfig.assistantTone
            }
          )

          if (purchaseResult.status !== 'ignored_not_purchase') {
            const purchaseText =
              purchaseResult.status === 'pending_confirmation'
                ? getBotTranslations(locale).purchase.proposal(
                    formatPurchaseSummary(locale, purchaseResult),
                    null,
                    null
                  )
                : purchaseResult.status === 'clarification_needed'
                  ? buildPurchaseClarificationText(locale, purchaseResult)
                  : getBotTranslations(locale).purchase.parseFailed

            options.memoryStore.appendTurn(memoryKey, {
              role: 'user',
              text: ctx.msg.text
            })
            options.memoryStore.appendTurn(memoryKey, {
              role: 'assistant',
              text: purchaseText
            })

            const replyOptions =
              purchaseResult.status === 'pending_confirmation'
                ? {
                    reply_markup: purchaseProposalReplyMarkup(
                      locale,
                      purchaseResult.purchaseMessageId
                    )
                  }
                : undefined

            await ctx.reply(purchaseText, replyOptions)
            return
          }
        } finally {
          typingIndicator.stop()
        }
      }

      const financeService = options.financeServiceForHousehold(member.householdId)
      const paymentBalanceReply = await maybeCreatePaymentBalanceReply({
        rawText: ctx.msg.text,
        householdId: member.householdId,
        memberId: member.id,
        financeService,
        householdConfigurationRepository: options.householdConfigurationRepository
      })

      if (paymentBalanceReply) {
        const replyText = formatPaymentBalanceReplyText(locale, paymentBalanceReply)
        options.memoryStore.appendTurn(memoryKey, {
          role: 'user',
          text: ctx.msg.text
        })
        options.memoryStore.appendTurn(memoryKey, {
          role: 'assistant',
          text: replyText
        })

        await ctx.reply(replyText)
        return
      }

      const memberInsightReply = await maybeCreateMemberInsightReply({
        rawText: ctx.msg.text,
        locale,
        householdId: member.householdId,
        currentMemberId: member.id,
        householdConfigurationRepository: options.householdConfigurationRepository,
        financeService,
        recentTurns: options.memoryStore.get(memoryKey).turns
      })

      if (memberInsightReply) {
        options.memoryStore.appendTurn(memoryKey, {
          role: 'user',
          text: ctx.msg.text
        })
        options.memoryStore.appendTurn(memoryKey, {
          role: 'assistant',
          text: memberInsightReply
        })

        await ctx.reply(memberInsightReply)
        return
      }

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

        const proposalText = formatPaymentProposalText({
          locale,
          surface: 'assistant',
          proposal: paymentProposal
        })
        options.memoryStore.appendTurn(memoryKey, {
          role: 'user',
          text: ctx.msg.text
        })
        options.memoryStore.appendTurn(memoryKey, {
          role: 'assistant',
          text: proposalText
        })

        await ctx.reply(proposalText, {
          reply_markup: paymentProposalReplyMarkup(locale, paymentProposal.payload.proposalId)
        })
        return
      }

      await replyWithAssistant({
        ctx,
        assistant: options.assistant,
        topicRole: 'generic',
        householdId: member.householdId,
        memberId: member.id,
        memberDisplayName: member.displayName,
        telegramUserId,
        telegramChatId,
        locale,
        userMessage: ctx.msg.text,
        householdConfigurationRepository: options.householdConfigurationRepository,
        financeService,
        memoryStore: options.memoryStore,
        usageTracker: options.usageTracker,
        logger: options.logger,
        recentThreadMessages: [],
        sameDayChatMessages: []
      })
    } catch (error) {
      if (dedupeClaim) {
        await dedupeClaim.repository.releaseMessage({
          householdId: member.householdId,
          source: DM_ASSISTANT_MESSAGE_SOURCE,
          sourceMessageKey: dedupeClaim.updateId
        })
      }

      throw error
    }
  })

  options.bot.on('message:text', async (ctx, next) => {
    if (!isGroupChat(ctx) || isCommandMessage(ctx)) {
      await next()
      return
    }

    const mention = stripExplicitBotMention(ctx)
    const directAddressByText = looksLikeDirectBotAddress(ctx.msg.text)
    const isAddressed = Boolean(
      (mention && mention.strippedText.length > 0) ||
      directAddressByText ||
      isReplyToBotMessage(ctx)
    )

    const telegramUserId = ctx.from?.id?.toString()
    const telegramChatId = ctx.chat?.id?.toString()
    if (!telegramUserId || !telegramChatId) {
      await next()
      return
    }

    const household =
      await options.householdConfigurationRepository.getTelegramHouseholdChat(telegramChatId)
    if (!household) {
      await next()
      return
    }
    const binding =
      ctx.msg &&
      'is_topic_message' in ctx.msg &&
      ctx.msg.is_topic_message === true &&
      'message_thread_id' in ctx.msg &&
      ctx.msg.message_thread_id !== undefined
        ? await options.householdConfigurationRepository.findHouseholdTopicByTelegramContext({
            telegramChatId,
            telegramThreadId: ctx.msg.message_thread_id.toString()
          })
        : null

    if (binding && !isAddressed) {
      await next()
      return
    }

    const member = await options.householdConfigurationRepository.getHouseholdMember(
      household.householdId,
      telegramUserId
    )
    if (!member) {
      await next()
      return
    }

    const locale = member.preferredLocale ?? household.defaultLocale ?? 'en'

    const updateId = ctx.update.update_id?.toString()
    const dedupeClaim =
      options.messageProcessingRepository && typeof updateId === 'string'
        ? {
            repository: options.messageProcessingRepository,
            updateId
          }
        : null

    if (dedupeClaim) {
      const claim = await dedupeClaim.repository.claimMessage({
        householdId: household.householdId,
        source: GROUP_ASSISTANT_MESSAGE_SOURCE,
        sourceMessageKey: dedupeClaim.updateId
      })

      if (!claim.claimed) {
        options.logger?.info(
          {
            event: 'assistant.duplicate_update',
            householdId: household.householdId,
            telegramUserId,
            updateId: dedupeClaim.updateId
          },
          'Duplicate group assistant mention ignored'
        )
        return
      }
    }

    try {
      const memoryKey = conversationMemoryKey({
        telegramUserId,
        telegramChatId,
        isPrivateChat: false
      })
      const telegramThreadId = currentThreadId(ctx)
      const messageText = mention?.strippedText ?? ctx.msg.text.trim()
      const assistantConfig = await resolveAssistantConfig(
        options.householdConfigurationRepository,
        household.householdId
      )
      const topicRole: TopicMessageRole =
        binding?.role === 'purchase' ||
        binding?.role === 'payments' ||
        binding?.role === 'reminders' ||
        binding?.role === 'feedback'
          ? binding.role
          : 'generic'
      const cachedRoute =
        topicRole === 'purchase' || topicRole === 'payments'
          ? getCachedTopicMessageRoute(ctx, topicRole)
          : null
      const recentThreadMessages = await listRecentThreadMessages({
        repository: options.topicMessageHistoryRepository,
        householdId: household.householdId,
        telegramChatId,
        telegramThreadId
      })
      const route =
        cachedRoute ??
        (options.topicRouter
          ? await routeGroupAssistantMessage({
              router: options.topicRouter,
              locale,
              topicRole,
              messageText,
              isExplicitMention: Boolean(mention) || directAddressByText,
              isReplyToBot: isReplyToBotMessage(ctx),
              assistantContext: assistantConfig.assistantContext,
              assistantTone: assistantConfig.assistantTone,
              memoryStore: options.memoryStore,
              memoryKey,
              recentThreadMessages
            })
          : null)

      if (route) {
        if (route.route === 'chat_reply' || route.route === 'dismiss_workflow') {
          if (route.replyText) {
            options.memoryStore.appendTurn(memoryKey, {
              role: 'user',
              text: messageText
            })
            options.memoryStore.appendTurn(memoryKey, {
              role: 'assistant',
              text: route.replyText
            })
            await ctx.reply(route.replyText)
          }
          return
        }

        if (route.route === 'silent') {
          await next()
          return
        }
      }

      const financeService = options.financeServiceForHousehold(household.householdId)
      const settings = await options.householdConfigurationRepository.getHouseholdBillingSettings(
        household.householdId
      )

      if (!binding && options.purchaseRepository && options.purchaseInterpreter) {
        const purchaseRecord = createGroupPurchaseRecord(ctx, household.householdId, messageText)

        if (
          purchaseRecord &&
          (!route || route.route === 'purchase_candidate' || route.route === 'topic_helper')
        ) {
          const purchaseResult = await options.purchaseRepository.save(
            purchaseRecord,
            options.purchaseInterpreter,
            settings.settlementCurrency,
            {
              householdContext: assistantConfig.assistantContext,
              assistantTone: assistantConfig.assistantTone
            }
          )

          if (purchaseResult.status === 'pending_confirmation') {
            const purchaseText = getBotTranslations(locale).purchase.proposal(
              formatPurchaseSummary(locale, purchaseResult),
              null,
              null
            )

            await ctx.reply(purchaseText, {
              reply_markup: purchaseProposalReplyMarkup(locale, purchaseResult.purchaseMessageId)
            })
            return
          }

          if (purchaseResult.status === 'clarification_needed') {
            await ctx.reply(buildPurchaseClarificationText(locale, purchaseResult))
            return
          }
        }
      }

      if (!isAddressed || messageText.length === 0) {
        await next()
        return
      }

      const rateLimit = options.rateLimiter.consume(`${household.householdId}:${telegramUserId}`)
      const t = getBotTranslations(locale).assistant

      if (!rateLimit.allowed) {
        await ctx.reply(t.rateLimited(formatRetryDelay(locale, rateLimit.retryAfterMs)))
        return
      }

      const paymentBalanceReply = await maybeCreatePaymentBalanceReply({
        rawText: messageText,
        householdId: household.householdId,
        memberId: member.id,
        financeService,
        householdConfigurationRepository: options.householdConfigurationRepository
      })

      if (paymentBalanceReply) {
        await ctx.reply(formatPaymentBalanceReplyText(locale, paymentBalanceReply))
        return
      }

      const memberInsightReply = await maybeCreateMemberInsightReply({
        rawText: messageText,
        locale,
        householdId: household.householdId,
        currentMemberId: member.id,
        householdConfigurationRepository: options.householdConfigurationRepository,
        financeService,
        recentTurns: options.memoryStore.get(memoryKey).turns
      })

      if (memberInsightReply) {
        options.memoryStore.appendTurn(memoryKey, {
          role: 'user',
          text: messageText
        })
        options.memoryStore.appendTurn(memoryKey, {
          role: 'assistant',
          text: memberInsightReply
        })

        await ctx.reply(memberInsightReply)
        return
      }

      await replyWithAssistant({
        ctx,
        assistant: options.assistant,
        topicRole,
        householdId: household.householdId,
        memberId: member.id,
        memberDisplayName: member.displayName,
        telegramUserId,
        telegramChatId,
        locale,
        userMessage: messageText,
        householdConfigurationRepository: options.householdConfigurationRepository,
        financeService,
        memoryStore: options.memoryStore,
        usageTracker: options.usageTracker,
        logger: options.logger,
        recentThreadMessages,
        sameDayChatMessages: await listExpandedChatMessages({
          repository: options.topicMessageHistoryRepository,
          householdId: household.householdId,
          telegramChatId,
          timezone: settings.timezone,
          shouldLoad: shouldLoadExpandedChatHistory(messageText)
        })
      })
    } catch (error) {
      if (dedupeClaim) {
        await dedupeClaim.repository.releaseMessage({
          householdId: household.householdId,
          source: GROUP_ASSISTANT_MESSAGE_SOURCE,
          sourceMessageKey: dedupeClaim.updateId
        })
      }

      throw error
    } finally {
      await persistIncomingTopicMessage({
        repository: options.topicMessageHistoryRepository,
        householdId: household.householdId,
        telegramChatId,
        telegramThreadId: currentThreadId(ctx),
        telegramMessageId: currentMessageId(ctx),
        telegramUpdateId: ctx.update.update_id?.toString() ?? null,
        senderTelegramUserId: telegramUserId,
        senderDisplayName: ctx.from?.first_name ?? member.displayName ?? ctx.from?.username ?? null,
        rawText: mention?.strippedText ?? ctx.msg.text.trim(),
        messageSentAt: currentMessageSentAt(ctx)
      })
    }
  })
}
