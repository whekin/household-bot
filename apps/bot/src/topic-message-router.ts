import type { Context } from 'grammy'

export type TopicMessageRole = 'generic' | 'purchase' | 'payments' | 'reminders' | 'feedback'
export type TopicWorkflowState =
  | 'purchase_clarification'
  | 'payment_clarification'
  | 'payment_confirmation'
  | null
export type TopicMessageRoute =
  | 'silent'
  | 'chat_reply'
  | 'purchase_candidate'
  | 'purchase_followup'
  | 'payment_candidate'
  | 'payment_followup'
  | 'topic_helper'
  | 'dismiss_workflow'

export interface TopicMessageRoutingInput {
  locale: 'en' | 'ru'
  topicRole: TopicMessageRole
  messageText: string
  isExplicitMention: boolean
  isReplyToBot: boolean
  activeWorkflow: TopicWorkflowState
  engagementAssessment?: {
    engaged: boolean
    reason: string
    strongReference: boolean
    weakSessionActive: boolean
    hasOpenBotQuestion: boolean
  }
  assistantContext?: string | null
  assistantTone?: string | null
  recentTurns?: readonly {
    role: 'user' | 'assistant'
    text: string
  }[]
  recentThreadMessages?: readonly {
    role: 'user' | 'assistant'
    speaker: string
    text: string
    threadId: string | null
  }[]
  recentChatMessages?: readonly {
    role: 'user' | 'assistant'
    speaker: string
    text: string
    threadId: string | null
  }[]
}

export interface TopicMessageRoutingResult {
  route: TopicMessageRoute
  replyText: string | null
  helperKind: 'assistant' | 'purchase' | 'payment' | 'reminder' | null
  shouldStartTyping: boolean
  shouldClearWorkflow: boolean
  confidence: number
  reason: string | null
}

export type TopicMessageRouter = (
  input: TopicMessageRoutingInput
) => Promise<TopicMessageRoutingResult>

const topicMessageRouteCacheKey = Symbol('topic-message-route-cache')

type CachedTopicMessageRole = Extract<TopicMessageRole, 'purchase' | 'payments'>

type TopicMessageRouteCacheEntry = {
  topicRole: CachedTopicMessageRole
  route: TopicMessageRoutingResult
}

type ContextWithTopicMessageRouteCache = Context & {
  [topicMessageRouteCacheKey]?: TopicMessageRouteCacheEntry
}

export function fallbackTopicMessageRoute(
  input: TopicMessageRoutingInput
): TopicMessageRoutingResult {
  const normalized = input.messageText.trim()

  if (normalized.length === 0) {
    return {
      route: 'silent',
      replyText: null,
      helperKind: null,
      shouldStartTyping: false,
      shouldClearWorkflow: false,
      confidence: 100,
      reason: 'empty'
    }
  }

  if (input.topicRole === 'purchase') {
    if (input.activeWorkflow === 'purchase_clarification') {
      return {
        route: 'purchase_followup',
        replyText: null,
        helperKind: 'purchase',
        shouldStartTyping: true,
        shouldClearWorkflow: false,
        confidence: 72,
        reason: 'active_purchase_workflow'
      }
    }
  }

  if (input.topicRole === 'payments') {
    if (
      input.activeWorkflow === 'payment_clarification' ||
      input.activeWorkflow === 'payment_confirmation'
    ) {
      return {
        route: 'payment_followup',
        replyText: null,
        helperKind: 'payment',
        shouldStartTyping: false,
        shouldClearWorkflow: false,
        confidence: 72,
        reason: 'active_payment_workflow'
      }
    }
  }

  if (
    input.engagementAssessment?.strongReference ||
    input.engagementAssessment?.weakSessionActive
  ) {
    return {
      route: 'topic_helper',
      replyText: null,
      helperKind: 'assistant',
      shouldStartTyping: true,
      shouldClearWorkflow: false,
      confidence: 62,
      reason: 'engaged_context'
    }
  }

  if (input.isExplicitMention || input.isReplyToBot) {
    return {
      route: 'topic_helper',
      replyText: null,
      helperKind: 'assistant',
      shouldStartTyping: true,
      shouldClearWorkflow: false,
      confidence: 60,
      reason: 'addressed'
    }
  }

  return {
    route: 'silent',
    replyText: null,
    helperKind: null,
    shouldStartTyping: false,
    shouldClearWorkflow: false,
    confidence: 70,
    reason: 'quiet_default'
  }
}

export function cacheTopicMessageRoute(
  ctx: Context,
  topicRole: CachedTopicMessageRole,
  route: TopicMessageRoutingResult
): void {
  ;(ctx as ContextWithTopicMessageRouteCache)[topicMessageRouteCacheKey] = {
    topicRole,
    route
  }
}

export function getCachedTopicMessageRoute(
  ctx: Context,
  topicRole: CachedTopicMessageRole
): TopicMessageRoutingResult | null {
  const cached = (ctx as ContextWithTopicMessageRouteCache)[topicMessageRouteCacheKey]
  return cached?.topicRole === topicRole ? cached.route : null
}
