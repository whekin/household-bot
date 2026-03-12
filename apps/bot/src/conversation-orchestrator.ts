import { Temporal, nowInstant, type Instant } from '@household/domain'
import type { TopicMessageHistoryRecord, TopicMessageHistoryRepository } from '@household/ports'

import type { AssistantConversationMemoryStore } from './assistant-state'
import { conversationMemoryKey } from './assistant-state'
import { type TopicMessageRole, type TopicWorkflowState } from './topic-message-router'

const ROLLING_CONTEXT_WINDOW_MS = 24 * 60 * 60_000
const WEAK_SESSION_TTL_MS = 20 * 60_000
const STRONG_CONTEXT_REFERENCE_PATTERN =
  /\b(?:question above|already said(?: above)?|you did not answer|from the dialog(?:ue)?|based on the dialog(?:ue)?)\b|(?:^|[^\p{L}])(?:вопрос\s+выше|выше|я\s+уже\s+ответил|я\s+уже\s+сказал|ты\s+не\s+ответил|ответь|контекст(?:\s+диалога)?|основываясь\s+на\s+диалоге)(?=$|[^\p{L}])/iu
const SUMMARY_REQUEST_PATTERN =
  /\b(?:summarize|summary|what happened in (?:the )?chat|what were we talking about|what did we say|what did i want to buy|what am i thinking about)\b|(?:^|[^\p{L}])(?:сводк|что\s+происходило\s+в\s+чате|о\s+чем\s+мы\s+говорили|о\s+чем\s+была\s+речь|что\s+я\s+хотел\s+купить|о\s+чем\s+я\s+думаю)(?=$|[^\p{L}])/iu

export interface ConversationHistoryMessage {
  role: 'user' | 'assistant'
  speaker: string
  text: string
  threadId: string | null
  senderTelegramUserId: string | null
  isBot: boolean
  messageSentAt: Instant | null
}

export interface EngagementAssessment {
  engaged: boolean
  reason:
    | 'explicit_mention'
    | 'reply_to_bot'
    | 'active_workflow'
    | 'strong_reference'
    | 'open_bot_question'
    | 'weak_session'
    | 'none'
  strongReference: boolean
  weakSessionActive: boolean
  hasOpenBotQuestion: boolean
  lastBotQuestion: string | null
  recentBotReply: string | null
}

export interface ConversationContext {
  topicRole: TopicMessageRole
  activeWorkflow: TopicWorkflowState
  explicitMention: boolean
  replyToBot: boolean
  directBotAddress: boolean
  rollingChatMessages: readonly ConversationHistoryMessage[]
  recentThreadMessages: readonly ConversationHistoryMessage[]
  recentSessionMessages: readonly ConversationHistoryMessage[]
  recentTurns: readonly {
    role: 'user' | 'assistant'
    text: string
  }[]
  shouldLoadExpandedContext: boolean
  engagement: EngagementAssessment
}

function toConversationHistoryMessage(
  record: TopicMessageHistoryRecord
): ConversationHistoryMessage {
  return {
    role: record.isBot ? 'assistant' : 'user',
    speaker: record.senderDisplayName ?? (record.isBot ? 'Kojori Bot' : 'Unknown'),
    text: record.rawText.trim(),
    threadId: record.telegramThreadId,
    senderTelegramUserId: record.senderTelegramUserId,
    isBot: record.isBot,
    messageSentAt: record.messageSentAt
  }
}

function compareConversationHistoryMessages(
  left: ConversationHistoryMessage,
  right: ConversationHistoryMessage
): number {
  const leftSentAt = left.messageSentAt?.epochMilliseconds ?? Number.MIN_SAFE_INTEGER
  const rightSentAt = right.messageSentAt?.epochMilliseconds ?? Number.MIN_SAFE_INTEGER

  if (leftSentAt !== rightSentAt) {
    return leftSentAt - rightSentAt
  }

  if (left.isBot !== right.isBot) {
    return left.isBot ? 1 : -1
  }

  return 0
}

export function rollingWindowStart(
  windowMs = ROLLING_CONTEXT_WINDOW_MS,
  referenceInstant = nowInstant()
): Instant {
  return Temporal.Instant.fromEpochMilliseconds(referenceInstant.epochMilliseconds - windowMs)
}

function lastBotMessageForUser(
  messages: readonly ConversationHistoryMessage[],
  telegramUserId: string,
  predicate: (message: ConversationHistoryMessage) => boolean
): ConversationHistoryMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message?.isBot || !predicate(message)) {
      continue
    }

    for (let previousIndex = index - 1; previousIndex >= 0; previousIndex -= 1) {
      const previousMessage = messages[previousIndex]
      if (!previousMessage || previousMessage.isBot) {
        continue
      }

      return previousMessage.senderTelegramUserId === telegramUserId ? message : null
    }

    return null
  }

  return null
}

function isQuestionLike(text: string): boolean {
  return (
    text.includes('?') ||
    /(?:^|[^\p{L}])(что|какой|какая|какие|когда|why|what|which|who|where|how)(?=$|[^\p{L}])/iu.test(
      text
    )
  )
}

function assessEngagement(input: {
  explicitMention: boolean
  replyToBot: boolean
  activeWorkflow: TopicWorkflowState
  directBotAddress: boolean
  messageText: string
  telegramUserId: string
  recentThreadMessages: readonly ConversationHistoryMessage[]
  recentSessionMessages: readonly ConversationHistoryMessage[]
  referenceInstant?: Instant
  weakSessionTtlMs?: number
}): EngagementAssessment {
  if (input.explicitMention || input.directBotAddress) {
    return {
      engaged: true,
      reason: 'explicit_mention',
      strongReference: false,
      weakSessionActive: false,
      hasOpenBotQuestion: false,
      lastBotQuestion: null,
      recentBotReply: null
    }
  }

  if (input.replyToBot) {
    return {
      engaged: true,
      reason: 'reply_to_bot',
      strongReference: false,
      weakSessionActive: false,
      hasOpenBotQuestion: false,
      lastBotQuestion: null,
      recentBotReply: null
    }
  }

  if (input.activeWorkflow !== null) {
    return {
      engaged: true,
      reason: 'active_workflow',
      strongReference: false,
      weakSessionActive: false,
      hasOpenBotQuestion: true,
      lastBotQuestion: null,
      recentBotReply: null
    }
  }

  const normalized = input.messageText.trim()
  const strongReference = STRONG_CONTEXT_REFERENCE_PATTERN.test(normalized)
  const contextMessages =
    input.recentThreadMessages.length > 0 ? input.recentThreadMessages : input.recentSessionMessages
  const lastBotReply = lastBotMessageForUser(contextMessages, input.telegramUserId, () => true)
  const lastBotQuestion = lastBotMessageForUser(contextMessages, input.telegramUserId, (message) =>
    isQuestionLike(message.text)
  )
  const referenceInstant = input.referenceInstant ?? nowInstant()
  const weakSessionTtlMs = input.weakSessionTtlMs ?? WEAK_SESSION_TTL_MS
  const weakSessionActive =
    lastBotReply?.messageSentAt !== null &&
    lastBotReply?.messageSentAt !== undefined &&
    referenceInstant.epochMilliseconds - lastBotReply.messageSentAt.epochMilliseconds <=
      weakSessionTtlMs

  if (strongReference && (lastBotReply || lastBotQuestion)) {
    return {
      engaged: true,
      reason: 'strong_reference',
      strongReference,
      weakSessionActive,
      hasOpenBotQuestion: Boolean(lastBotQuestion),
      lastBotQuestion: lastBotQuestion?.text ?? null,
      recentBotReply: lastBotReply?.text ?? null
    }
  }

  if (lastBotQuestion) {
    return {
      engaged: false,
      reason: 'open_bot_question',
      strongReference,
      weakSessionActive,
      hasOpenBotQuestion: true,
      lastBotQuestion: lastBotQuestion.text,
      recentBotReply: lastBotReply?.text ?? null
    }
  }

  if (weakSessionActive) {
    return {
      engaged: true,
      reason: 'weak_session',
      strongReference,
      weakSessionActive,
      hasOpenBotQuestion: false,
      lastBotQuestion: null,
      recentBotReply: lastBotReply?.text ?? null
    }
  }

  return {
    engaged: false,
    reason: 'none',
    strongReference,
    weakSessionActive: false,
    hasOpenBotQuestion: false,
    lastBotQuestion: null,
    recentBotReply: null
  }
}

function shouldLoadExpandedContext(text: string, strongReference: boolean): boolean {
  return strongReference || SUMMARY_REQUEST_PATTERN.test(text.trim())
}

export async function buildConversationContext(input: {
  repository: TopicMessageHistoryRepository | undefined
  householdId: string
  telegramChatId: string
  telegramThreadId: string | null
  telegramUserId: string
  topicRole: TopicMessageRole
  activeWorkflow: TopicWorkflowState
  messageText: string
  explicitMention: boolean
  replyToBot: boolean
  directBotAddress: boolean
  memoryStore: AssistantConversationMemoryStore
  referenceInstant?: Instant
  weakSessionTtlMs?: number
}): Promise<ConversationContext> {
  const rollingChatMessages = input.repository
    ? (
        await input.repository.listRecentChatMessages({
          householdId: input.householdId,
          telegramChatId: input.telegramChatId,
          sentAtOrAfter: rollingWindowStart(ROLLING_CONTEXT_WINDOW_MS, input.referenceInstant),
          limit: 80
        })
      )
        .map(toConversationHistoryMessage)
        .sort(compareConversationHistoryMessages)
    : []

  const recentThreadMessages = input.telegramThreadId
    ? rollingChatMessages
        .filter((message) => message.threadId === input.telegramThreadId)
        .slice(-20)
    : rollingChatMessages.filter((message) => message.threadId === null).slice(-20)

  const recentSessionMessages = rollingChatMessages
    .filter(
      (message) =>
        message.senderTelegramUserId === input.telegramUserId ||
        message.isBot ||
        message.threadId === input.telegramThreadId
    )
    .slice(-20)

  const engagementInput: Parameters<typeof assessEngagement>[0] = {
    explicitMention: input.explicitMention,
    replyToBot: input.replyToBot,
    activeWorkflow: input.activeWorkflow,
    directBotAddress: input.directBotAddress,
    messageText: input.messageText,
    telegramUserId: input.telegramUserId,
    recentThreadMessages,
    recentSessionMessages
  }

  if (input.referenceInstant) {
    engagementInput.referenceInstant = input.referenceInstant
  }

  if (input.weakSessionTtlMs !== undefined) {
    engagementInput.weakSessionTtlMs = input.weakSessionTtlMs
  }

  const engagement = assessEngagement(engagementInput)

  return {
    topicRole: input.topicRole,
    activeWorkflow: input.activeWorkflow,
    explicitMention: input.explicitMention,
    replyToBot: input.replyToBot,
    directBotAddress: input.directBotAddress,
    rollingChatMessages,
    recentThreadMessages,
    recentSessionMessages,
    recentTurns: input.memoryStore.get(
      conversationMemoryKey({
        telegramUserId: input.telegramUserId,
        telegramChatId: input.telegramChatId,
        isPrivateChat: false
      })
    ).turns,
    shouldLoadExpandedContext: shouldLoadExpandedContext(
      input.messageText,
      engagement.strongReference
    ),
    engagement
  }
}
