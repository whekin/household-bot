import type { FinanceCommandService } from '@household/application'
import { instantFromEpochSeconds, nowInstant, Temporal } from '@household/domain'
import type { Bot, Context } from 'grammy'
import type { Logger } from '@household/observability'
import type {
  HouseholdConfigurationRepository,
  ProcessedBotMessageRepository,
  TelegramPendingActionRepository,
  TopicMessageHistoryRepository
} from '@household/ports'

import {
  agentToolDefinitions,
  executeAgentTool,
  type AgentMessageRecord,
  type AgentToolContext
} from './agent-tools'
import {
  conversationMemoryKey,
  type AssistantConversationMemoryStore,
  type AssistantRateLimiter,
  type AssistantUsageTracker
} from './assistant-state'
import type { HouseholdContextCache } from './household-context-cache'
import { getBotTranslations, resolveBotLocale, type BotLocale } from './i18n'
import { runToolSession } from './openai-tool-session'
import type { PurchaseMessageIngestionRepository } from './purchase-topic-ingestion'
import { availableAssistantCommandCatalog } from './telegram-commands'
import { startTypingIndicator } from './telegram-chat-action'
import { stripExplicitBotMention } from './telegram-mentions'
import {
  isReplyToCurrentBotMessage,
  readTelegramMessageTextWithoutBotMention,
  telegramMessageAttachmentCount
} from './topic-ingestion/topic-message-primitives'
import {
  persistTopicHistoryMessage,
  telegramMessageIdFromMessage,
  telegramMessageSentAtFromMessage
} from './topic-history'
import { assessWake, type WakeClassifier, type WakeGateTopicRole } from './wake-gate'

const AGENT_HISTORY_LIMIT = 12

const AGENT_SYSTEM_PROMPT = [
  'You are Kojori (Кожур), the assistant of one shared household on Telegram (group topics and private chats).',
  'You help members track rent, utilities, and shared purchases, and you can chat casually when addressed.',
  '',
  'Hard rules:',
  '- Facts about money, balances, dates, members, and instructions come ONLY from tool results. If a tool does not provide the answer, say you do not know and point to a relevant command (e.g. /bill).',
  '- Never state that a payment, purchase, or change was recorded, cancelled, or edited. Your write-tools only post confirmation cards; a human presses the button. After posting a card, add nothing.',
  '- Never agree to, approve, or arrange anything on behalf of household members. Deals between people are theirs to make; if humans are coordinating with each other, you only help with facts when asked.',
  '- Never invent capabilities, commands, accounts, or payment methods.',
  '',
  'Behavior:',
  '- Reply in the language of the user message (household members mostly speak Russian).',
  '- Be brief: one to three short sentences. No follow-up questions after finishing a task. No bullet lists unless asked.',
  '- Playful banter is fine when someone chats with you; keep it to one sentence.',
  '- When a member reports a completed payment, use propose_payment. "за себя и за X" means covered_member_ids includes X. If the payer is someone else ("Ион оплатил"), set payer_member_id to that member.',
  '- When a member reports a completed shared purchase, use propose_purchase.',
  '- Plans, intentions, and future talk ("надо оплатить", "завтра закину") are NOT completed facts: do not post cards for them; reply briefly only if addressed.',
  '- To edit or delete saved records, find the exact record via list_ledger first.',
  '- When a member asks for a reminder/notification in the reminders topic, use propose_notification with the date computed from the current local time. If they change their mind before confirming, call it again with the corrected values.',
  '- If a request is ambiguous (which member, which payment), ask one short question instead of guessing.'
].join('\n')

export interface HouseholdAgentOptions {
  householdConfigurationRepository: HouseholdConfigurationRepository
  financeServiceForHousehold: (householdId: string) => FinanceCommandService
  promptRepository: TelegramPendingActionRepository
  apiKey: string
  model: string
  timeoutMs: number
  purchaseRepository?: PurchaseMessageIngestionRepository
  notificationDraftPublisher?: import('./ad-hoc-notifications').NotificationDraftPublisher
  historyRepository?: TopicMessageHistoryRepository
  memoryStore?: AssistantConversationMemoryStore
  rateLimiter?: AssistantRateLimiter
  usageTracker?: AssistantUsageTracker
  contextCache?: HouseholdContextCache
  processedBotMessageRepository?: ProcessedBotMessageRepository
  wakeClassifier?: WakeClassifier
  logger?: Logger
}

interface ResolvedAgentTarget {
  householdId: string
  topicRole: WakeGateTopicRole
  locale: BotLocale
  isPrivate: boolean
}

type AgentTargetResolution =
  | { status: 'ok'; target: ResolvedAgentTarget }
  | { status: 'no_household' }
  | { status: 'multiple_households' }
  | { status: 'not_applicable' }

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

function toAgentTopicRole(role: string): WakeGateTopicRole {
  switch (role) {
    case 'purchase':
    case 'payments':
    case 'reminders':
    case 'feedback':
      return role
    default:
      return 'generic'
  }
}

async function resolveAgentTarget(
  ctx: Context,
  repository: HouseholdConfigurationRepository
): Promise<AgentTargetResolution> {
  const chatId = ctx.chat?.id?.toString()
  if (!chatId) {
    return { status: 'not_applicable' }
  }

  if (ctx.chat?.type === 'private') {
    const telegramUserId = ctx.from?.id?.toString()
    if (!telegramUserId) {
      return { status: 'not_applicable' }
    }

    const memberships = await repository.listHouseholdMembersByTelegramUserId(telegramUserId)
    const activeMemberships = memberships.filter((member) => member.status !== 'left')
    if (activeMemberships.length === 0) {
      return { status: 'no_household' }
    }
    if (activeMemberships.length > 1) {
      return { status: 'multiple_households' }
    }

    const member = activeMemberships[0]!
    return {
      status: 'ok',
      target: {
        householdId: member.householdId,
        topicRole: 'generic',
        locale: resolveBotLocale(
          member.preferredLocale ?? member.householdDefaultLocale ?? ctx.from?.language_code ?? null
        ),
        isPrivate: true
      }
    }
  }

  const message = ctx.msg
  const threadId =
    message && 'message_thread_id' in message && message.message_thread_id !== undefined
      ? message.message_thread_id.toString()
      : null

  if (threadId) {
    const binding = await repository.findHouseholdTopicByTelegramContext({
      telegramChatId: chatId,
      telegramThreadId: threadId
    })
    if (binding) {
      const chat = await repository.getHouseholdChatByHouseholdId(binding.householdId)
      return {
        status: 'ok',
        target: {
          householdId: binding.householdId,
          topicRole: toAgentTopicRole(binding.role),
          locale: resolveBotLocale(chat?.defaultLocale),
          isPrivate: false
        }
      }
    }
  }

  const chat = await repository.getTelegramHouseholdChat(chatId)
  if (!chat) {
    return { status: 'not_applicable' }
  }

  return {
    status: 'ok',
    target: {
      householdId: chat.householdId,
      topicRole: 'generic',
      locale: resolveBotLocale(chat.defaultLocale),
      isPrivate: false
    }
  }
}

function toAgentMessageRecord(ctx: Context, rawText: string): AgentMessageRecord | null {
  const message = ctx.message
  const senderTelegramUserId = ctx.from?.id?.toString()
  if (!message || !senderTelegramUserId) {
    return null
  }

  const senderDisplayName = [ctx.from?.first_name, ctx.from?.last_name]
    .filter((part) => !!part && part.trim().length > 0)
    .join(' ')

  return {
    updateId: ctx.update.update_id,
    chatId: message.chat.id.toString(),
    messageId: message.message_id.toString(),
    threadId:
      'message_thread_id' in message && message.message_thread_id !== undefined
        ? message.message_thread_id.toString()
        : null,
    senderTelegramUserId,
    senderDisplayName: senderDisplayName.length > 0 ? senderDisplayName : null,
    rawText,
    attachmentCount: telegramMessageAttachmentCount(ctx),
    messageSentAt: instantFromEpochSeconds(message.date)
  }
}

async function hasAgentRelevantWorkflow(input: {
  promptRepository: TelegramPendingActionRepository
  purchaseRepository?: PurchaseMessageIngestionRepository
  record: AgentMessageRecord
  householdId: string
  topicRole: WakeGateTopicRole
}): Promise<boolean> {
  const workflowActions = [
    'payment_topic_confirmation',
    'payment_topic_clarification',
    'agent_action',
    'ad_hoc_notification'
  ] as const
  for (const action of workflowActions) {
    const pending = await input.promptRepository.getPendingAction(
      input.record.chatId,
      input.record.senderTelegramUserId,
      action
    )
    if (!pending) {
      continue
    }

    const payloadThreadId =
      typeof pending.payload.telegramThreadId === 'string'
        ? pending.payload.telegramThreadId
        : typeof pending.payload.threadId === 'string'
          ? pending.payload.threadId
          : null
    if (payloadThreadId === null || payloadThreadId === (input.record.threadId ?? '')) {
      return true
    }
  }

  if (input.topicRole === 'purchase' && input.purchaseRepository) {
    return input.purchaseRepository.hasClarificationContext({
      updateId: input.record.updateId,
      chatId: input.record.chatId,
      messageId: input.record.messageId,
      threadId: input.record.threadId ?? '',
      senderTelegramUserId: input.record.senderTelegramUserId,
      rawText: input.record.rawText,
      messageSentAt: input.record.messageSentAt,
      householdId: input.householdId
    })
  }

  return false
}

export function registerHouseholdAgent(bot: Bot, options: HouseholdAgentOptions): void {
  bot.on('message', async (ctx, next) => {
    const chatType = ctx.chat?.type
    if (chatType !== 'group' && chatType !== 'supergroup' && chatType !== 'private') {
      await next()
      return
    }

    const rawText = readTelegramMessageTextWithoutBotMention(ctx)
    if (!rawText || rawText.trim().length === 0 || rawText.trim().startsWith('/')) {
      await next()
      return
    }

    const resolution = await resolveAgentTarget(ctx, options.householdConfigurationRepository)
    if (resolution.status === 'no_household' || resolution.status === 'multiple_households') {
      const t = getBotTranslations(resolveBotLocale(ctx.from?.language_code)).assistant
      await ctx.reply(resolution.status === 'no_household' ? t.noHousehold : t.multipleHouseholds)
      return
    }
    if (resolution.status !== 'ok') {
      await next()
      return
    }
    const target = resolution.target

    const record = toAgentMessageRecord(ctx, rawText.trim())
    if (!record) {
      await next()
      return
    }

    const persistIncoming = async () => {
      await persistTopicHistoryMessage({
        repository: options.historyRepository,
        householdId: target.householdId,
        telegramChatId: record.chatId,
        telegramThreadId: record.threadId,
        telegramMessageId: record.messageId,
        telegramUpdateId: String(record.updateId),
        senderTelegramUserId: record.senderTelegramUserId,
        senderDisplayName: record.senderDisplayName,
        isBot: false,
        rawText: record.rawText,
        messageSentAt: record.messageSentAt
      })
    }

    try {
      const financeService = options.financeServiceForHousehold(target.householdId)
      const senderMember = await financeService.getMemberByTelegramUserId(
        record.senderTelegramUserId
      )
      if (!senderMember) {
        await persistIncoming()
        return
      }

      if (options.processedBotMessageRepository) {
        const claim = await options.processedBotMessageRepository.claimMessage({
          householdId: target.householdId,
          source: 'household-agent',
          sourceMessageKey: `${record.chatId}:${record.updateId}`
        })
        if (!claim.claimed) {
          return
        }
      }

      const historyRecords = options.historyRepository
        ? record.threadId !== null
          ? await options.historyRepository.listRecentThreadMessages({
              householdId: target.householdId,
              telegramChatId: record.chatId,
              telegramThreadId: record.threadId,
              limit: AGENT_HISTORY_LIMIT
            })
          : (
              await options.historyRepository.listRecentChatMessages({
                householdId: target.householdId,
                telegramChatId: record.chatId,
                sentAtOrAfter: Temporal.Instant.fromEpochMilliseconds(
                  nowInstant().epochMilliseconds - 24 * 60 * 60_000
                ),
                limit: AGENT_HISTORY_LIMIT * 3
              })
            )
              .filter((message) => message.telegramThreadId === null)
              .slice(-AGENT_HISTORY_LIMIT)
        : []
      const recentMessages = historyRecords.map((message) => ({
        speaker: message.senderDisplayName ?? (message.isBot ? 'BOT' : 'member'),
        isBot: message.isBot,
        text: message.rawText
      }))

      const replyToMessage = ctx.msg?.reply_to_message
      const replyToText =
        replyToMessage && 'text' in replyToMessage && typeof replyToMessage.text === 'string'
          ? replyToMessage.text
          : null

      // Private chats are always addressed to the bot; the wake gate only
      // guards group topics where members talk to each other.
      const wake = target.isPrivate
        ? ({ wake: true, reason: 'private_chat' } as const)
        : await assessWake({
            messageText: record.rawText,
            topicRole: target.topicRole,
            isExplicitMention: stripExplicitBotMention(ctx) !== null,
            isReplyToBot: isReplyToCurrentBotMessage(ctx),
            hasActiveWorkflow: await hasAgentRelevantWorkflow({
              promptRepository: options.promptRepository,
              record,
              householdId: target.householdId,
              topicRole: target.topicRole,
              ...(options.purchaseRepository
                ? { purchaseRepository: options.purchaseRepository }
                : {})
            }),
            botUsername: ctx.me?.username ?? null,
            recentMessages,
            replyToText,
            ...(options.wakeClassifier ? { classifier: options.wakeClassifier } : {})
          })

      options.logger?.info(
        {
          event: 'agent.wake',
          wake: wake.wake,
          reason: wake.reason,
          topicRole: target.topicRole,
          chatId: record.chatId,
          threadId: record.threadId
        },
        'Agent wake decision'
      )

      if (!wake.wake) {
        await persistIncoming()
        return
      }

      const memoryKey = conversationMemoryKey({
        telegramUserId: record.senderTelegramUserId,
        telegramChatId: record.chatId,
        isPrivateChat: target.isPrivate
      })
      if (options.rateLimiter) {
        const rate = options.rateLimiter.consume(memoryKey)
        if (!rate.allowed) {
          if (target.isPrivate) {
            const t = getBotTranslations(target.locale).assistant
            await ctx.reply(t.rateLimited(formatRetryDelay(target.locale, rate.retryAfterMs)))
          }
          await persistIncoming()
          return
        }
      }

      const cachedContext = options.contextCache
        ? await options.contextCache.get(target.householdId, async () => {
            const [settings, assistantConfig] = await Promise.all([
              options.householdConfigurationRepository.getHouseholdBillingSettings(
                target.householdId
              ),
              options.householdConfigurationRepository.getHouseholdAssistantConfig
                ? options.householdConfigurationRepository.getHouseholdAssistantConfig(
                    target.householdId
                  )
                : Promise.resolve(null)
            ])
            return {
              householdContext: assistantConfig?.assistantContext ?? null,
              assistantTone: assistantConfig?.assistantTone ?? null,
              defaultCurrency: settings.settlementCurrency === 'USD' ? 'USD' : ('GEL' as const),
              timezone: settings.timezone,
              locale: target.locale,
              cachedAt: Date.now()
            }
          })
        : null

      const members = await financeService.listMembers()
      const memoryTurns = options.memoryStore?.get(memoryKey).turns ?? []
      const commandCatalog = availableAssistantCommandCatalog({
        locale: target.locale,
        chatType: target.isPrivate ? 'private' : 'group',
        isMember: true,
        isAdmin: senderMember.isAdmin
      })

      const timezone = cachedContext?.timezone ?? 'Asia/Tbilisi'
      const localNow = nowInstant().toZonedDateTimeISO(timezone)
      const contextPrompt = [
        target.isPrivate
          ? 'Chat type: private chat between the bot and this member. Every message is addressed to you.'
          : `Topic role: ${target.topicRole}`,
        `Current local date and time (${timezone}): ${localNow.toPlainDate().toString()} ${localNow.toPlainTime().toString({ smallestUnit: 'minute' })} (${localNow.dayOfWeek === 7 ? 'Sunday' : ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][localNow.dayOfWeek - 1]})`,
        `Household locale: ${target.locale}`,
        `Settlement currency: ${cachedContext?.defaultCurrency ?? 'GEL'}`,
        `Sender: ${senderMember.displayName} (memberId=${senderMember.id}${senderMember.isAdmin ? ', admin' : ''})`,
        `Household members: ${members
          .map((member) => `${member.displayName} (memberId=${member.id})`)
          .join('; ')}`,
        cachedContext?.householdContext
          ? `Household context:\n${cachedContext.householdContext}`
          : null,
        cachedContext?.assistantTone ? `Tone preference:\n${cachedContext.assistantTone}` : null,
        recentMessages.length > 0
          ? `Recent messages in this thread:\n${recentMessages
              .map((message) => `${message.isBot ? 'BOT' : message.speaker}: ${message.text}`)
              .join('\n')}`
          : null,
        memoryTurns.length > 0
          ? `Recent exchanges with this member:\n${memoryTurns
              .slice(-6)
              .map((turn) => `${turn.role}: ${turn.text}`)
              .join('\n')}`
          : null,
        replyToText ? `The user's message replies to: ${replyToText}` : null
      ]
        .filter(Boolean)
        .join('\n\n')

      const typing = startTypingIndicator(ctx)
      try {
        const toolContext: AgentToolContext = {
          householdId: target.householdId,
          locale: target.locale,
          topicRole: target.topicRole,
          senderMember,
          record,
          ctx,
          financeService,
          householdConfigurationRepository: options.householdConfigurationRepository,
          promptRepository: options.promptRepository,
          ...(options.purchaseRepository ? { purchaseRepository: options.purchaseRepository } : {}),
          ...(options.historyRepository ? { historyRepository: options.historyRepository } : {}),
          ...(options.memoryStore ? { memoryStore: options.memoryStore } : {}),
          commandCatalog,
          postCard: async (text, replyMarkup) => {
            const reply = await ctx.reply(text, {
              reply_parameters: { message_id: Number(record.messageId) },
              ...(replyMarkup ? { reply_markup: replyMarkup } : {})
            })
            await persistTopicHistoryMessage({
              repository: options.historyRepository,
              householdId: target.householdId,
              telegramChatId: record.chatId,
              telegramThreadId: record.threadId,
              telegramMessageId: telegramMessageIdFromMessage(reply),
              telegramUpdateId: null,
              senderTelegramUserId: ctx.me?.id?.toString() ?? null,
              senderDisplayName: null,
              isBot: true,
              rawText: text,
              messageSentAt: telegramMessageSentAtFromMessage(reply)
            })
          },
          ...(options.logger ? { logger: options.logger } : {})
        }

        const session = await runToolSession({
          apiKey: options.apiKey,
          model: options.model,
          timeoutMs: options.timeoutMs,
          systemPrompt: AGENT_SYSTEM_PROMPT,
          contextPrompt,
          userMessage: record.rawText,
          tools: agentToolDefinitions({
            purchaseToolsAvailable: options.purchaseRepository !== undefined
          }),
          executeTool: (call) => executeAgentTool(toolContext, call),
          ...(options.logger ? { logger: options.logger } : {})
        })

        options.usageTracker?.record({
          householdId: target.householdId,
          telegramUserId: record.senderTelegramUserId,
          displayName: senderMember.displayName,
          usage: session.usage
        })

        options.logger?.info(
          {
            event: 'agent.reply',
            cardPosted: session.cardPosted,
            toolCallCount: session.toolCallCount,
            hasText: session.text !== null,
            totalTokens: session.usage.totalTokens
          },
          'Agent session finished'
        )

        if (!session.cardPosted && session.text) {
          const reply = await ctx.reply(session.text, {
            reply_parameters: { message_id: Number(record.messageId) }
          })
          await persistTopicHistoryMessage({
            repository: options.historyRepository,
            householdId: target.householdId,
            telegramChatId: record.chatId,
            telegramThreadId: record.threadId,
            telegramMessageId: telegramMessageIdFromMessage(reply),
            telegramUpdateId: null,
            senderTelegramUserId: ctx.me?.id?.toString() ?? null,
            senderDisplayName: null,
            isBot: true,
            rawText: session.text,
            messageSentAt: telegramMessageSentAtFromMessage(reply)
          })
          options.memoryStore?.appendTurn(memoryKey, { role: 'user', text: record.rawText })
          options.memoryStore?.appendTurn(memoryKey, { role: 'assistant', text: session.text })
        }
      } finally {
        typing.stop()
      }

      await persistIncoming()
    } catch (error) {
      options.logger?.error(
        {
          event: 'agent.failed',
          chatId: record.chatId,
          threadId: record.threadId,
          updateId: record.updateId,
          error
        },
        'Household agent failed'
      )
      if (options.processedBotMessageRepository) {
        await options.processedBotMessageRepository
          .releaseMessage({
            householdId: target.householdId,
            source: 'household-agent',
            sourceMessageKey: `${record.chatId}:${record.updateId}`
          })
          .catch(() => {})
      }
      await persistIncoming().catch(() => {})
    }
  })
}
