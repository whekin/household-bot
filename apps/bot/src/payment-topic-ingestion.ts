import type { FinanceCommandService, PaymentConfirmationService } from '@household/application'
import { instantFromEpochSeconds, nowInstant, type Instant } from '@household/domain'
import type { Bot, Context } from 'grammy'
import type { Logger } from '@household/observability'
import type {
  HouseholdConfigurationRepository,
  HouseholdTopicBindingRecord,
  TelegramPendingActionRepository,
  TopicMessageHistoryRepository
} from '@household/ports'

import { getBotTranslations, type BotLocale } from './i18n'
import type { AssistantConversationMemoryStore } from './assistant-state'
import { conversationMemoryKey } from './assistant-state'
import {
  formatPaymentBalanceReplyText,
  formatPaymentProposalText,
  maybeCreatePaymentBalanceReply,
  maybeCreatePaymentProposal,
  parsePaymentProposalPayload,
  synthesizePaymentConfirmationText
} from './payment-proposals'
import {
  cacheTopicMessageRoute,
  getCachedTopicMessageRoute,
  looksLikeDirectBotAddress,
  type TopicMessageRouter
} from './topic-message-router'
import { historyRecordToTurn } from './topic-history'
import { stripExplicitBotMention } from './telegram-mentions'

const PAYMENT_TOPIC_CONFIRM_CALLBACK_PREFIX = 'payment_topic:confirm:'
const PAYMENT_TOPIC_CANCEL_CALLBACK_PREFIX = 'payment_topic:cancel:'
const PAYMENT_TOPIC_CLARIFICATION_ACTION = 'payment_topic_clarification' as const
const PAYMENT_TOPIC_CONFIRMATION_ACTION = 'payment_topic_confirmation' as const
const PAYMENT_TOPIC_ACTION_TTL_MS = 30 * 60_000

export interface PaymentTopicCandidate {
  updateId: number
  chatId: string
  messageId: string
  threadId: string
  senderTelegramUserId: string
  rawText: string
  attachmentCount: number
  messageSentAt: Instant
}

export interface PaymentTopicRecord extends PaymentTopicCandidate {
  householdId: string
}

interface PaymentTopicClarificationPayload {
  threadId: string
  rawText: string
}

interface PaymentTopicConfirmationPayload {
  proposalId: string
  householdId: string
  memberId: string
  kind: 'rent' | 'utilities'
  amountMinor: string
  currency: 'GEL' | 'USD'
  rawText: string
  senderTelegramUserId: string
  telegramChatId: string
  telegramMessageId: string
  telegramThreadId: string
  telegramUpdateId: string
  attachmentCount: number
  messageSentAt: Instant | null
}

function readMessageText(ctx: Context): string | null {
  const message = ctx.message
  if (!message) {
    return null
  }

  if ('text' in message && typeof message.text === 'string') {
    return message.text
  }

  if ('caption' in message && typeof message.caption === 'string') {
    return message.caption
  }

  return null
}

function attachmentCount(ctx: Context): number {
  const message = ctx.message
  if (!message) {
    return 0
  }

  if ('photo' in message && Array.isArray(message.photo)) {
    return message.photo.length
  }

  if ('document' in message && message.document) {
    return 1
  }

  return 0
}

function isReplyToBotMessage(ctx: Context): boolean {
  const replyAuthor = ctx.msg?.reply_to_message?.from
  if (!replyAuthor) {
    return false
  }

  return replyAuthor.id === ctx.me.id
}

function toCandidateFromContext(ctx: Context): PaymentTopicCandidate | null {
  const message = ctx.message
  const rawText = stripExplicitBotMention(ctx)?.strippedText ?? readMessageText(ctx)
  if (!message || !rawText) {
    return null
  }

  if (!('is_topic_message' in message) || message.is_topic_message !== true) {
    return null
  }

  if (!('message_thread_id' in message) || message.message_thread_id === undefined) {
    return null
  }

  const senderTelegramUserId = ctx.from?.id?.toString()
  if (!senderTelegramUserId) {
    return null
  }

  return {
    updateId: ctx.update.update_id,
    chatId: message.chat.id.toString(),
    messageId: message.message_id.toString(),
    threadId: message.message_thread_id.toString(),
    senderTelegramUserId,
    rawText,
    attachmentCount: attachmentCount(ctx),
    messageSentAt: instantFromEpochSeconds(message.date)
  }
}

export function resolveConfiguredPaymentTopicRecord(
  value: PaymentTopicCandidate,
  binding: HouseholdTopicBindingRecord
): PaymentTopicRecord | null {
  const normalizedText = value.rawText.trim()
  if (normalizedText.length === 0) {
    return null
  }

  if (normalizedText.startsWith('/')) {
    return null
  }

  if (binding.role !== 'payments') {
    return null
  }

  return {
    ...value,
    rawText: normalizedText,
    householdId: binding.householdId
  }
}

async function resolveAssistantConfig(
  householdConfigurationRepository: HouseholdConfigurationRepository,
  householdId: string
): Promise<{
  assistantContext: string | null
  assistantTone: string | null
}> {
  const config = householdConfigurationRepository.getHouseholdAssistantConfig
    ? await householdConfigurationRepository.getHouseholdAssistantConfig(householdId)
    : null

  return {
    assistantContext: config?.assistantContext ?? null,
    assistantTone: config?.assistantTone ?? null
  }
}

function memoryKeyForRecord(record: PaymentTopicRecord): string {
  return conversationMemoryKey({
    telegramUserId: record.senderTelegramUserId,
    telegramChatId: record.chatId,
    isPrivateChat: false
  })
}

function appendConversation(
  memoryStore: AssistantConversationMemoryStore | undefined,
  record: PaymentTopicRecord,
  userText: string,
  assistantText: string
): void {
  if (!memoryStore) {
    return
  }

  const key = memoryKeyForRecord(record)
  memoryStore.appendTurn(key, {
    role: 'user',
    text: userText
  })
  memoryStore.appendTurn(key, {
    role: 'assistant',
    text: assistantText
  })
}

async function listRecentThreadMessages(
  repository: TopicMessageHistoryRepository | undefined,
  record: PaymentTopicRecord
) {
  if (!repository) {
    return []
  }

  const messages = await repository.listRecentThreadMessages({
    householdId: record.householdId,
    telegramChatId: record.chatId,
    telegramThreadId: record.threadId,
    limit: 8
  })

  return messages.map(historyRecordToTurn)
}

async function persistIncomingTopicMessage(
  repository: TopicMessageHistoryRepository | undefined,
  record: PaymentTopicRecord
) {
  if (!repository || record.rawText.trim().length === 0) {
    return
  }

  await repository.saveMessage({
    householdId: record.householdId,
    telegramChatId: record.chatId,
    telegramThreadId: record.threadId,
    telegramMessageId: record.messageId,
    telegramUpdateId: String(record.updateId),
    senderTelegramUserId: record.senderTelegramUserId,
    senderDisplayName: null,
    isBot: false,
    rawText: record.rawText.trim(),
    messageSentAt: record.messageSentAt
  })
}

async function routePaymentTopicMessage(input: {
  record: PaymentTopicRecord
  locale: BotLocale
  topicRole: 'payments'
  isExplicitMention: boolean
  isReplyToBot: boolean
  activeWorkflow: 'payment_clarification' | 'payment_confirmation' | null
  assistantContext: string | null
  assistantTone: string | null
  memoryStore: AssistantConversationMemoryStore | undefined
  historyRepository: TopicMessageHistoryRepository | undefined
  router: TopicMessageRouter | undefined
}) {
  if (!input.router) {
    return input.activeWorkflow
      ? {
          route: 'payment_followup' as const,
          replyText: null,
          helperKind: 'payment' as const,
          shouldStartTyping: false,
          shouldClearWorkflow: false,
          confidence: 75,
          reason: 'legacy_payment_followup'
        }
      : {
          route: 'payment_candidate' as const,
          replyText: null,
          helperKind: 'payment' as const,
          shouldStartTyping: false,
          shouldClearWorkflow: false,
          confidence: 75,
          reason: 'legacy_payment_candidate'
        }
  }

  const recentThreadMessages = await listRecentThreadMessages(input.historyRepository, input.record)

  return input.router({
    locale: input.locale,
    topicRole: input.topicRole,
    messageText: input.record.rawText,
    isExplicitMention: input.isExplicitMention || looksLikeDirectBotAddress(input.record.rawText),
    isReplyToBot: input.isReplyToBot,
    activeWorkflow: input.activeWorkflow,
    assistantContext: input.assistantContext,
    assistantTone: input.assistantTone,
    recentTurns: input.memoryStore?.get(memoryKeyForRecord(input.record)).turns ?? [],
    recentThreadMessages
  })
}

export function buildPaymentAcknowledgement(
  locale: BotLocale,
  result:
    | { status: 'duplicate' }
    | {
        status: 'recorded'
        kind: 'rent' | 'utilities'
        amountMajor: string
        currency: 'USD' | 'GEL'
      }
    | { status: 'needs_review' }
): string | null {
  const t = getBotTranslations(locale).payments

  switch (result.status) {
    case 'duplicate':
      return null
    case 'recorded':
      return t.recorded(result.kind, result.amountMajor, result.currency)
    case 'needs_review':
      return null
  }
}

function parsePaymentClarificationPayload(
  payload: Record<string, unknown>
): PaymentTopicClarificationPayload | null {
  if (typeof payload.threadId !== 'string' || typeof payload.rawText !== 'string') {
    return null
  }

  return {
    threadId: payload.threadId,
    rawText: payload.rawText
  }
}

function parsePaymentTopicConfirmationPayload(
  payload: Record<string, unknown>
): PaymentTopicConfirmationPayload | null {
  const proposal = parsePaymentProposalPayload(payload)
  if (
    !proposal ||
    typeof payload.rawText !== 'string' ||
    typeof payload.senderTelegramUserId !== 'string' ||
    typeof payload.telegramChatId !== 'string' ||
    typeof payload.telegramMessageId !== 'string' ||
    typeof payload.telegramThreadId !== 'string' ||
    typeof payload.telegramUpdateId !== 'string' ||
    typeof payload.attachmentCount !== 'number'
  ) {
    return null
  }

  return {
    ...proposal,
    rawText: payload.rawText,
    senderTelegramUserId: payload.senderTelegramUserId,
    telegramChatId: payload.telegramChatId,
    telegramMessageId: payload.telegramMessageId,
    telegramThreadId: payload.telegramThreadId,
    telegramUpdateId: payload.telegramUpdateId,
    attachmentCount: payload.attachmentCount,
    messageSentAt: null
  }
}

function paymentProposalReplyMarkup(locale: BotLocale, proposalId: string) {
  const t = getBotTranslations(locale).payments

  return {
    inline_keyboard: [
      [
        {
          text: t.confirmButton,
          callback_data: `${PAYMENT_TOPIC_CONFIRM_CALLBACK_PREFIX}${proposalId}`
        },
        {
          text: t.cancelButton,
          callback_data: `${PAYMENT_TOPIC_CANCEL_CALLBACK_PREFIX}${proposalId}`
        }
      ]
    ]
  }
}

async function replyToPaymentMessage(
  ctx: Context,
  text: string,
  replyMarkup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }
): Promise<void> {
  const message = ctx.msg
  if (!message) {
    return
  }

  await ctx.reply(text, {
    reply_parameters: {
      message_id: message.message_id
    },
    ...(replyMarkup
      ? {
          reply_markup: replyMarkup
        }
      : {})
  })
}

export function registerConfiguredPaymentTopicIngestion(
  bot: Bot,
  householdConfigurationRepository: HouseholdConfigurationRepository,
  promptRepository: TelegramPendingActionRepository,
  financeServiceForHousehold: (householdId: string) => FinanceCommandService,
  paymentServiceForHousehold: (householdId: string) => PaymentConfirmationService,
  options: {
    router?: TopicMessageRouter
    memoryStore?: AssistantConversationMemoryStore
    historyRepository?: TopicMessageHistoryRepository
    logger?: Logger
  } = {}
): void {
  bot.callbackQuery(
    new RegExp(`^${PAYMENT_TOPIC_CONFIRM_CALLBACK_PREFIX}([^:]+)$`),
    async (ctx) => {
      if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') {
        return
      }

      const actorTelegramUserId = ctx.from?.id?.toString()
      const proposalId = ctx.match[1]
      if (!actorTelegramUserId || !proposalId) {
        return
      }

      const locale = await resolveTopicLocale(ctx, householdConfigurationRepository)
      const t = getBotTranslations(locale).payments

      const pending = await promptRepository.getPendingAction(
        ctx.chat.id.toString(),
        actorTelegramUserId
      )
      const payload =
        pending?.action === PAYMENT_TOPIC_CONFIRMATION_ACTION
          ? parsePaymentTopicConfirmationPayload(pending.payload)
          : null

      if (!payload || payload.proposalId !== proposalId) {
        await ctx.answerCallbackQuery({
          text: t.proposalUnavailable,
          show_alert: true
        })
        return
      }

      if (payload.senderTelegramUserId !== actorTelegramUserId) {
        await ctx.answerCallbackQuery({
          text: t.notYourProposal,
          show_alert: true
        })
        return
      }

      const paymentService = paymentServiceForHousehold(payload.householdId)
      const result = await paymentService.submit({
        ...payload,
        rawText: synthesizePaymentConfirmationText(payload)
      })

      await promptRepository.clearPendingAction(ctx.chat.id.toString(), actorTelegramUserId)

      if (result.status !== 'recorded') {
        await ctx.answerCallbackQuery({
          text: t.proposalUnavailable,
          show_alert: true
        })
        return
      }

      const recordedText = t.recorded(
        result.kind,
        result.amount.toMajorString(),
        result.amount.currency
      )
      await ctx.answerCallbackQuery({
        text: recordedText
      })

      if (ctx.msg) {
        await ctx.editMessageText(recordedText, {
          reply_markup: {
            inline_keyboard: []
          }
        })
      }
    }
  )

  bot.callbackQuery(new RegExp(`^${PAYMENT_TOPIC_CANCEL_CALLBACK_PREFIX}([^:]+)$`), async (ctx) => {
    if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') {
      return
    }

    const actorTelegramUserId = ctx.from?.id?.toString()
    const proposalId = ctx.match[1]
    if (!actorTelegramUserId || !proposalId) {
      return
    }

    const locale = await resolveTopicLocale(ctx, householdConfigurationRepository)
    const t = getBotTranslations(locale).payments

    const pending = await promptRepository.getPendingAction(
      ctx.chat.id.toString(),
      actorTelegramUserId
    )
    const payload =
      pending?.action === PAYMENT_TOPIC_CONFIRMATION_ACTION
        ? parsePaymentTopicConfirmationPayload(pending.payload)
        : null

    if (!payload || payload.proposalId !== proposalId) {
      await ctx.answerCallbackQuery({
        text: t.proposalUnavailable,
        show_alert: true
      })
      return
    }

    if (payload.senderTelegramUserId !== actorTelegramUserId) {
      await ctx.answerCallbackQuery({
        text: t.notYourProposal,
        show_alert: true
      })
      return
    }

    await promptRepository.clearPendingAction(ctx.chat.id.toString(), actorTelegramUserId)
    await ctx.answerCallbackQuery({
      text: t.cancelled
    })

    if (ctx.msg) {
      await ctx.editMessageText(t.cancelled, {
        reply_markup: {
          inline_keyboard: []
        }
      })
    }
  })

  bot.on('message', async (ctx, next) => {
    const candidate = toCandidateFromContext(ctx)
    if (!candidate) {
      await next()
      return
    }

    const binding = await householdConfigurationRepository.findHouseholdTopicByTelegramContext({
      telegramChatId: candidate.chatId,
      telegramThreadId: candidate.threadId
    })

    if (!binding) {
      await next()
      return
    }

    const record = resolveConfiguredPaymentTopicRecord(candidate, binding)
    if (!record) {
      await next()
      return
    }

    try {
      const locale = await resolveTopicLocale(ctx, householdConfigurationRepository)
      const pending = await promptRepository.getPendingAction(
        record.chatId,
        record.senderTelegramUserId
      )
      const clarificationPayload =
        pending?.action === PAYMENT_TOPIC_CLARIFICATION_ACTION
          ? parsePaymentClarificationPayload(pending.payload)
          : null
      const combinedText =
        clarificationPayload && clarificationPayload.threadId === record.threadId
          ? `${clarificationPayload.rawText}\n${record.rawText}`
          : record.rawText
      const confirmationPayload =
        pending?.action === PAYMENT_TOPIC_CONFIRMATION_ACTION
          ? parsePaymentTopicConfirmationPayload(pending.payload)
          : null
      const assistantConfig = await resolveAssistantConfig(
        householdConfigurationRepository,
        record.householdId
      )
      const activeWorkflow =
        clarificationPayload && clarificationPayload.threadId === record.threadId
          ? 'payment_clarification'
          : confirmationPayload && confirmationPayload.telegramThreadId === record.threadId
            ? 'payment_confirmation'
            : null
      const route =
        getCachedTopicMessageRoute(ctx, 'payments') ??
        (await routePaymentTopicMessage({
          record,
          locale,
          topicRole: 'payments',
          isExplicitMention: stripExplicitBotMention(ctx) !== null,
          isReplyToBot: isReplyToBotMessage(ctx),
          activeWorkflow,
          assistantContext: assistantConfig.assistantContext,
          assistantTone: assistantConfig.assistantTone,
          memoryStore: options.memoryStore,
          historyRepository: options.historyRepository,
          router: options.router
        }))
      cacheTopicMessageRoute(ctx, 'payments', route)

      if (route.route === 'silent') {
        await next()
        return
      }

      if (route.shouldClearWorkflow && activeWorkflow !== null) {
        await promptRepository.clearPendingAction(record.chatId, record.senderTelegramUserId)
      }

      if (route.route === 'chat_reply' || route.route === 'dismiss_workflow') {
        if (route.replyText) {
          await replyToPaymentMessage(ctx, route.replyText)
          appendConversation(options.memoryStore, record, record.rawText, route.replyText)
        }
        return
      }

      if (route.route === 'topic_helper') {
        const financeService = financeServiceForHousehold(record.householdId)
        const member = await financeService.getMemberByTelegramUserId(record.senderTelegramUserId)
        if (!member) {
          await next()
          return
        }

        const balanceReply = await maybeCreatePaymentBalanceReply({
          rawText: combinedText,
          householdId: record.householdId,
          memberId: member.id,
          financeService,
          householdConfigurationRepository
        })

        if (!balanceReply) {
          await next()
          return
        }

        const helperText = formatPaymentBalanceReplyText(locale, balanceReply)
        await replyToPaymentMessage(ctx, helperText)
        appendConversation(options.memoryStore, record, record.rawText, helperText)
        return
      }

      if (route.route !== 'payment_candidate' && route.route !== 'payment_followup') {
        await next()
        return
      }

      const t = getBotTranslations(locale).payments
      const financeService = financeServiceForHousehold(record.householdId)
      const member = await financeService.getMemberByTelegramUserId(record.senderTelegramUserId)

      if (!member) {
        await next()
        return
      }

      const proposal = await maybeCreatePaymentProposal({
        rawText: combinedText,
        householdId: record.householdId,
        memberId: member.id,
        financeService,
        householdConfigurationRepository
      })

      if (proposal.status === 'no_intent') {
        await next()
        return
      }

      if (proposal.status === 'clarification') {
        await promptRepository.upsertPendingAction({
          telegramUserId: record.senderTelegramUserId,
          telegramChatId: record.chatId,
          action: PAYMENT_TOPIC_CLARIFICATION_ACTION,
          payload: {
            threadId: record.threadId,
            rawText: combinedText
          },
          expiresAt: nowInstant().add({ milliseconds: PAYMENT_TOPIC_ACTION_TTL_MS })
        })

        await replyToPaymentMessage(ctx, t.clarification)
        appendConversation(options.memoryStore, record, record.rawText, t.clarification)
        return
      }

      await promptRepository.clearPendingAction(record.chatId, record.senderTelegramUserId)

      if (proposal.status === 'unsupported_currency') {
        await replyToPaymentMessage(ctx, t.unsupportedCurrency)
        appendConversation(options.memoryStore, record, record.rawText, t.unsupportedCurrency)
        return
      }

      if (proposal.status === 'no_balance') {
        await replyToPaymentMessage(ctx, t.noBalance)
        appendConversation(options.memoryStore, record, record.rawText, t.noBalance)
        return
      }

      if (proposal.status === 'proposal') {
        await promptRepository.upsertPendingAction({
          telegramUserId: record.senderTelegramUserId,
          telegramChatId: record.chatId,
          action: PAYMENT_TOPIC_CONFIRMATION_ACTION,
          payload: {
            ...proposal.payload,
            senderTelegramUserId: record.senderTelegramUserId,
            rawText: combinedText,
            telegramChatId: record.chatId,
            telegramMessageId: record.messageId,
            telegramThreadId: record.threadId,
            telegramUpdateId: String(record.updateId),
            attachmentCount: record.attachmentCount
          },
          expiresAt: nowInstant().add({ milliseconds: PAYMENT_TOPIC_ACTION_TTL_MS })
        })

        const proposalText = formatPaymentProposalText({
          locale,
          surface: 'topic',
          proposal
        })
        await replyToPaymentMessage(
          ctx,
          proposalText,
          paymentProposalReplyMarkup(locale, proposal.payload.proposalId)
        )
        appendConversation(options.memoryStore, record, record.rawText, proposalText)
      }
    } catch (error) {
      options.logger?.error(
        {
          event: 'payment.ingest_failed',
          chatId: record.chatId,
          threadId: record.threadId,
          messageId: record.messageId,
          updateId: record.updateId,
          error
        },
        'Failed to ingest payment confirmation'
      )
    } finally {
      await persistIncomingTopicMessage(options.historyRepository, record)
    }
  })
}

async function resolveTopicLocale(
  ctx: Context,
  householdConfigurationRepository: HouseholdConfigurationRepository
): Promise<BotLocale> {
  const binding =
    ctx.chat && ctx.msg && 'message_thread_id' in ctx.msg && ctx.msg.message_thread_id !== undefined
      ? await householdConfigurationRepository.findHouseholdTopicByTelegramContext({
          telegramChatId: ctx.chat.id.toString(),
          telegramThreadId: ctx.msg.message_thread_id.toString()
        })
      : null

  if (!binding) {
    return 'en'
  }

  const householdChat = await householdConfigurationRepository.getHouseholdChatByHouseholdId(
    binding.householdId
  )

  return householdChat?.defaultLocale ?? 'en'
}
