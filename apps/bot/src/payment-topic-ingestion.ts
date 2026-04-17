import {
  parsePaymentConfirmationMessage,
  type FinanceCommandService,
  type PaymentConfirmationService
} from '@household/application'
import { instantFromEpochSeconds, Money, nowInstant, type Instant } from '@household/domain'
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
import { cacheTopicMessageRoute, type TopicMessageRouter } from './topic-message-router'
import {
  persistTopicHistoryMessage,
  telegramMessageIdFromMessage,
  telegramMessageSentAtFromMessage
} from './topic-history'
import { looksLikeLikelyCompletedPurchase } from './purchase-topic-ingestion'
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

async function persistIncomingTopicMessage(
  repository: TopicMessageHistoryRepository | undefined,
  record: PaymentTopicRecord
) {
  await persistTopicHistoryMessage({
    repository,
    householdId: record.householdId,
    telegramChatId: record.chatId,
    telegramThreadId: record.threadId,
    telegramMessageId: record.messageId,
    telegramUpdateId: String(record.updateId),
    senderTelegramUserId: record.senderTelegramUserId,
    senderDisplayName: null,
    isBot: false,
    rawText: record.rawText,
    messageSentAt: record.messageSentAt
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

function buildWrongTopicPurchaseReply(locale: BotLocale): string {
  return getBotTranslations(locale).payments.purchaseRedirect
}

function hasClearPaymentTopicIntent(
  rawText: string,
  defaultCurrency: 'GEL' | 'USD'
): boolean {
  return parsePaymentConfirmationMessage(rawText, defaultCurrency).kind !== null
}

async function replyWithTopicPaymentProposal(input: {
  ctx: Context
  locale: BotLocale
  record: PaymentTopicRecord
  combinedText: string
  financeService: FinanceCommandService
  householdConfigurationRepository: HouseholdConfigurationRepository
  promptRepository: TelegramPendingActionRepository
  memoryStore?: AssistantConversationMemoryStore
  historyRepository?: TopicMessageHistoryRepository
}) {
  const t = getBotTranslations(input.locale).payments
  const senderMember = await input.financeService.getMemberByTelegramUserId(
    input.record.senderTelegramUserId
  )

  if (!senderMember) {
    return false
  }

  const proposal = await maybeCreatePaymentProposal({
    rawText: input.combinedText,
    householdId: input.record.householdId,
    memberId: senderMember.id,
    financeService: input.financeService,
    householdConfigurationRepository: input.householdConfigurationRepository
  })

  if (proposal.status === 'no_intent') {
    return false
  }

  if (proposal.status === 'clarification') {
    await input.promptRepository.upsertPendingAction({
      telegramUserId: input.record.senderTelegramUserId,
      telegramChatId: input.record.chatId,
      action: PAYMENT_TOPIC_CLARIFICATION_ACTION,
      payload: {
        threadId: input.record.threadId,
        rawText: input.combinedText
      },
      expiresAt: nowInstant().add({ milliseconds: PAYMENT_TOPIC_ACTION_TTL_MS })
    })

    await replyToPaymentMessage(input.ctx, t.clarification, undefined, {
      repository: input.historyRepository,
      record: input.record
    })
    appendConversation(input.memoryStore, input.record, input.record.rawText, t.clarification)
    return true
  }

  await input.promptRepository.clearPendingAction(
    input.record.chatId,
    input.record.senderTelegramUserId
  )

  if (proposal.status === 'unsupported_currency') {
    await replyToPaymentMessage(input.ctx, t.unsupportedCurrency, undefined, {
      repository: input.historyRepository,
      record: input.record
    })
    appendConversation(
      input.memoryStore,
      input.record,
      input.record.rawText,
      t.unsupportedCurrency
    )
    return true
  }

  if (proposal.status === 'no_balance') {
    await replyToPaymentMessage(input.ctx, t.noBalance, undefined, {
      repository: input.historyRepository,
      record: input.record
    })
    appendConversation(input.memoryStore, input.record, input.record.rawText, t.noBalance)
    return true
  }

  await input.promptRepository.upsertPendingAction({
    telegramUserId: input.record.senderTelegramUserId,
    telegramChatId: input.record.chatId,
    action: PAYMENT_TOPIC_CONFIRMATION_ACTION,
    payload: {
      ...proposal.payload,
      senderTelegramUserId: input.record.senderTelegramUserId,
      rawText: input.combinedText,
      telegramChatId: input.record.chatId,
      telegramMessageId: input.record.messageId,
      telegramThreadId: input.record.threadId,
      telegramUpdateId: String(input.record.updateId),
      attachmentCount: input.record.attachmentCount
    },
    expiresAt: nowInstant().add({ milliseconds: PAYMENT_TOPIC_ACTION_TTL_MS })
  })

  const proposalText = formatPaymentProposalText({
    locale: input.locale,
    surface: 'topic',
    proposal
  })
  await replyToPaymentMessage(
    input.ctx,
    proposalText,
    paymentProposalReplyMarkup(input.locale, proposal.payload.proposalId),
    {
      repository: input.historyRepository,
      record: input.record
    }
  )
  appendConversation(input.memoryStore, input.record, input.record.rawText, proposalText)
  return true
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

function isLikelyUtilityTemplate(rawText: string): boolean {
  const lines = rawText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (lines.length < 2) {
    return false
  }

  const templateLineCount = lines.filter((line) =>
    /^[^:\n]{2,}:\s*(?:\d+(?:[.,]\d{1,2})?|0|skip|пропуск|нет|-)?(?:\s+(?:USD|GEL))?$/i.test(line)
  ).length

  return templateLineCount >= 2
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
  replyMarkup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> },
  history?: {
    repository: TopicMessageHistoryRepository | undefined
    record: PaymentTopicRecord
  }
): Promise<void> {
  const message = ctx.msg
  if (!message) {
    return
  }

  const reply = await ctx.reply(text, {
    reply_parameters: {
      message_id: message.message_id
    },
    ...(replyMarkup
      ? {
          reply_markup: replyMarkup
        }
      : {})
  })

  await persistTopicHistoryMessage({
    repository: history?.repository,
    householdId: history?.record.householdId ?? '',
    telegramChatId: history?.record.chatId ?? '',
    telegramThreadId: history?.record.threadId ?? null,
    telegramMessageId: telegramMessageIdFromMessage(reply),
    telegramUpdateId: null,
    senderTelegramUserId: ctx.me?.id?.toString() ?? null,
    senderDisplayName: null,
    isBot: true,
    rawText: text,
    messageSentAt: telegramMessageSentAtFromMessage(reply)
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
    topicProcessor?: import('./topic-processor').TopicProcessor
    contextCache?: import('./household-context-cache').HouseholdContextCache
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
      if (isLikelyUtilityTemplate(record.rawText)) {
        await next()
        return
      }
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

      // Load household context (cached)
      const householdContext = options.contextCache
        ? await options.contextCache.get(record.householdId, async () => {
            const billingSettings =
              await householdConfigurationRepository.getHouseholdBillingSettings(record.householdId)
            const assistantConfig = await resolveAssistantConfig(
              householdConfigurationRepository,
              record.householdId
            )
            return {
              householdContext: assistantConfig.assistantContext,
              assistantTone: assistantConfig.assistantTone,
              defaultCurrency: billingSettings.settlementCurrency,
              locale: (await resolveTopicLocale(ctx, householdConfigurationRepository)) as
                | 'en'
                | 'ru',
              cachedAt: Date.now()
            }
          })
        : {
            householdContext: null as string | null,
            assistantTone: null as string | null,
            defaultCurrency: 'GEL' as const,
            locale: 'en' as const,
            cachedAt: Date.now()
          }

      const activeWorkflow =
        clarificationPayload && clarificationPayload.threadId === record.threadId
          ? 'payment_clarification'
          : confirmationPayload && confirmationPayload.telegramThreadId === record.threadId
            ? 'payment_confirmation'
            : null

      // Use topic processor if available
      if (options.topicProcessor) {
        const { buildConversationContext } = await import('./conversation-orchestrator')
        const { stripExplicitBotMention } = await import('./telegram-mentions')

        const conversationContext = await buildConversationContext({
          repository: options.historyRepository,
          householdId: record.householdId,
          telegramChatId: record.chatId,
          telegramThreadId: record.threadId,
          telegramUserId: record.senderTelegramUserId,
          topicRole: 'payments',
          activeWorkflow,
          messageText: record.rawText,
          explicitMention: stripExplicitBotMention(ctx) !== null,
          replyToBot: isReplyToBotMessage(ctx),
          directBotAddress: false,
          memoryStore: options.memoryStore ?? {
            get() {
              return { summary: null, turns: [] }
            },
            appendTurn() {
              return { summary: null, turns: [] }
            }
          }
        })

        const processorResult = await options.topicProcessor({
          locale: locale === 'ru' ? 'ru' : 'en',
          topicRole: 'payments',
          messageText: combinedText,
          isExplicitMention: conversationContext.explicitMention,
          isReplyToBot: conversationContext.replyToBot,
          activeWorkflow,
          defaultCurrency: householdContext.defaultCurrency,
          householdContext: householdContext.householdContext,
          assistantTone: householdContext.assistantTone,
          householdMembers: [],
          senderMemberId: null,
          recentThreadMessages: conversationContext.recentThreadMessages.map((m) => ({
            role: m.role,
            speaker: m.speaker,
            text: m.text
          })),
          recentChatMessages: conversationContext.recentSessionMessages.map((m) => ({
            role: m.role,
            speaker: m.speaker,
            text: m.text
          })),
          recentTurns: conversationContext.recentTurns,
          engagementAssessment: conversationContext.engagement
        })

        options.logger?.info(
          { event: 'payment.topic_processor_result', result: processorResult },
          'Topic processor finished'
        )

        // Handle processor failure - only if explicitly mentioned
        if (!processorResult) {
          if (conversationContext.explicitMention) {
            const { botSleepsMessage } = await import('./topic-processor')
            await replyToPaymentMessage(
              ctx,
              botSleepsMessage(locale === 'ru' ? 'ru' : 'en'),
              undefined,
              {
                repository: options.historyRepository,
                record
              }
            )
          } else {
            await next()
          }
          return
        }

        // Handle different routes
        switch (processorResult.route) {
          case 'silent': {
            if (hasClearPaymentTopicIntent(combinedText, householdContext.defaultCurrency)) {
              const handled = await replyWithTopicPaymentProposal({
                ctx,
                locale,
                record,
                combinedText,
                financeService: financeServiceForHousehold(record.householdId),
                householdConfigurationRepository,
                promptRepository,
                memoryStore: options.memoryStore,
                historyRepository: options.historyRepository
              })

              if (handled) {
                return
              }
            }

            if (looksLikeLikelyCompletedPurchase(record.rawText)) {
              const replyText = buildWrongTopicPurchaseReply(locale)

              options.logger?.info(
                {
                  event: 'payment.topic_processor_purchase_redirect',
                  reason: processorResult.reason,
                  messageText: record.rawText
                },
                'Redirecting purchase-like message out of the payments topic'
              )

              await replyToPaymentMessage(ctx, replyText, undefined, {
                repository: options.historyRepository,
                record
              })
              appendConversation(options.memoryStore, record, record.rawText, replyText)
              return
            }

            if (conversationContext.explicitMention) {
              const { botSleepsMessage } = await import('./topic-processor')
              const replyText = botSleepsMessage(locale === 'ru' ? 'ru' : 'en')

              options.logger?.info(
                {
                  event: 'payment.topic_processor_explicit_fallback',
                  reason: processorResult.reason,
                  messageText: record.rawText
                },
                'Replying after topic processor stayed silent on an explicit mention'
              )

              await replyToPaymentMessage(ctx, replyText, undefined, {
                repository: options.historyRepository,
                record
              })
              appendConversation(options.memoryStore, record, record.rawText, replyText)
              return
            }

            cacheTopicMessageRoute(ctx, 'payments', {
              route: 'silent',
              replyText: null,
              helperKind: null,
              shouldStartTyping: false,
              shouldClearWorkflow: false,
              confidence: processorResult.reason === 'test' ? 0 : 80,
              reason: processorResult.reason
            })
            await next()
            return
          }

          case 'chat_reply': {
            await replyToPaymentMessage(ctx, processorResult.replyText, undefined, {
              repository: options.historyRepository,
              record
            })
            appendConversation(
              options.memoryStore,
              record,
              record.rawText,
              processorResult.replyText
            )
            return
          }

          case 'dismiss_workflow': {
            if (activeWorkflow !== null) {
              await promptRepository.clearPendingAction(record.chatId, record.senderTelegramUserId)
            }
            if (processorResult.replyText) {
              await replyToPaymentMessage(ctx, processorResult.replyText, undefined, {
                repository: options.historyRepository,
                record
              })
              appendConversation(
                options.memoryStore,
                record,
                record.rawText,
                processorResult.replyText
              )
            }
            return
          }

          case 'topic_helper': {
            const financeService = financeServiceForHousehold(record.householdId)
            const member = await financeService.getMemberByTelegramUserId(
              record.senderTelegramUserId
            )
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
            await replyToPaymentMessage(ctx, helperText, undefined, {
              repository: options.historyRepository,
              record
            })
            appendConversation(options.memoryStore, record, record.rawText, helperText)
            return
          }

          case 'payment_clarification': {
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

            await replyToPaymentMessage(ctx, processorResult.clarificationQuestion, undefined, {
              repository: options.historyRepository,
              record
            })
            appendConversation(
              options.memoryStore,
              record,
              record.rawText,
              processorResult.clarificationQuestion
            )
            return
          }

          case 'payment': {
            const t = getBotTranslations(locale).payments
            const financeService = financeServiceForHousehold(record.householdId)
            const senderMember = await financeService.getMemberByTelegramUserId(
              record.senderTelegramUserId
            )

            if (!senderMember) {
              await next()
              return
            }

            // Resolve the payer: if payerDisplayName is provided, try to find that member
            // Otherwise, the sender is the payer
            let payerMember = senderMember
            if (processorResult.payerDisplayName) {
              const allMembers = await financeService.listMembers()
              const matchedMember = allMembers.find(
                (m) =>
                  m.displayName.toLowerCase() === processorResult.payerDisplayName?.toLowerCase()
              )
              if (matchedMember) {
                payerMember = matchedMember
              }
              // If we can't find the member, fall back to sender (maybe they misspelled)
            }

            // Create payment proposal using the parsed data from topic processor
            // Only trust the AI-extracted amount if the user's message actually contains a number.
            // The AI may hallucinate amounts from conversation history (bill summaries, other members' figures).
            const userMessageHasAmount = /\d+(?:[.,]\d{1,2})?/.test(record.rawText)
            const effectiveAmountMinor = userMessageHasAmount ? processorResult.amountMinor : null
            const effectiveCurrency = userMessageHasAmount ? processorResult.currency : null

            const amountMajor =
              effectiveAmountMinor && effectiveCurrency
                ? Money.fromMinor(BigInt(effectiveAmountMinor), effectiveCurrency).toMajorString()
                : null

            const synthesizedText =
              amountMajor && effectiveCurrency
                ? `paid ${processorResult.kind} ${amountMajor} ${effectiveCurrency}`
                : `paid ${processorResult.kind}`

            const proposal = await maybeCreatePaymentProposal({
              rawText: synthesizedText,
              householdId: record.householdId,
              memberId: payerMember.id,
              financeService,
              householdConfigurationRepository
            })

            if (proposal.status === 'no_intent' || proposal.status === 'clarification') {
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

              await replyToPaymentMessage(ctx, t.clarification, undefined, {
                repository: options.historyRepository,
                record
              })
              appendConversation(options.memoryStore, record, record.rawText, t.clarification)
              return
            }

            await promptRepository.clearPendingAction(record.chatId, record.senderTelegramUserId)

            if (proposal.status === 'unsupported_currency') {
              await replyToPaymentMessage(ctx, t.unsupportedCurrency, undefined, {
                repository: options.historyRepository,
                record
              })
              appendConversation(options.memoryStore, record, record.rawText, t.unsupportedCurrency)
              return
            }

            if (proposal.status === 'no_balance') {
              await replyToPaymentMessage(ctx, t.noBalance, undefined, {
                repository: options.historyRepository,
                record
              })
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
                paymentProposalReplyMarkup(locale, proposal.payload.proposalId),
                {
                  repository: options.historyRepository,
                  record
                }
              )
              appendConversation(options.memoryStore, record, record.rawText, proposalText)
            }
            return
          }

          default: {
            await next()
            return
          }
        }
      }

      // No topic processor available
      if (stripExplicitBotMention(ctx) !== null) {
        const { botSleepsMessage } = await import('./topic-processor')
        await replyToPaymentMessage(
          ctx,
          botSleepsMessage(locale === 'ru' ? 'ru' : 'en'),
          undefined,
          {
            repository: options.historyRepository,
            record
          }
        )
      } else {
        await next()
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
