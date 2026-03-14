import type { Context } from 'grammy'

import { extractOpenAiResponseText, parseJsonFromResponseText } from './openai-responses'

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

function normalizeRoute(value: string): TopicMessageRoute {
  return value === 'chat_reply' ||
    value === 'purchase_candidate' ||
    value === 'purchase_followup' ||
    value === 'payment_candidate' ||
    value === 'payment_followup' ||
    value === 'topic_helper' ||
    value === 'dismiss_workflow'
    ? value
    : 'silent'
}

function normalizeHelperKind(value: string | null): TopicMessageRoutingResult['helperKind'] {
  return value === 'assistant' ||
    value === 'purchase' ||
    value === 'payment' ||
    value === 'reminder'
    ? value
    : null
}

function normalizeConfidence(value: number | null | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0
  }

  return Math.max(0, Math.min(100, Math.round(value)))
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

function buildRecentTurns(input: TopicMessageRoutingInput): string | null {
  const recentTurns = input.recentTurns
    ?.slice(-4)
    .map((turn) => `${turn.role}: ${turn.text.trim()}`)
    .filter((line) => line.length > 0)

  return recentTurns && recentTurns.length > 0
    ? ['Recent conversation with this user in the household chat:', ...recentTurns].join('\n')
    : null
}

function buildRecentThreadMessages(input: TopicMessageRoutingInput): string | null {
  const recentMessages = input.recentThreadMessages
    ?.slice(-8)
    .map((message) => `${message.speaker} (${message.role}): ${message.text.trim()}`)
    .filter((line) => line.length > 0)

  return recentMessages && recentMessages.length > 0
    ? ['Recent messages in this topic thread:', ...recentMessages].join('\n')
    : null
}

function buildRecentChatMessages(input: TopicMessageRoutingInput): string | null {
  const recentMessages = input.recentChatMessages
    ?.slice(-12)
    .map((message) =>
      message.threadId
        ? `[thread ${message.threadId}] ${message.speaker} (${message.role}): ${message.text.trim()}`
        : `${message.speaker} (${message.role}): ${message.text.trim()}`
    )
    .filter((line) => line.length > 0)

  return recentMessages && recentMessages.length > 0
    ? ['Recent related chat messages:', ...recentMessages].join('\n')
    : null
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

export function createOpenAiTopicMessageRouter(
  apiKey: string | undefined,
  model: string,
  timeoutMs: number
): TopicMessageRouter | undefined {
  if (!apiKey) {
    return undefined
  }

  return async (input) => {
    const abortController = new AbortController()
    const timeout = setTimeout(() => abortController.abort(), timeoutMs)

    try {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        signal: abortController.signal,
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model,
          input: [
            {
              role: 'system',
              content: [
                'You are a first-pass router for a household Telegram bot in a group chat topic.',
                'Your job is to decide whether the bot should stay silent, send a short playful reply, continue a workflow, or invoke a heavier helper.',
                'When engaged=yes OR explicit_mention=yes OR reply_to_bot=yes, you MUST respond - never use silent route.',
                'Decide from context whether the user is actually addressing the bot, talking about the bot, or talking to another person.',
                'Treat "stop", "leave me alone", "just thinking", "not a purchase", and similar messages as backoff or dismissal signals.',
                'For a bare summon like "bot?", "pss bot", or "ты тут?", prefer a brief acknowledgment with chat_reply.',
                'When the user directly addresses the bot with small talk, joking, or testing, prefer chat_reply with one short sentence.',
                'Do not repeatedly end casual replies with "how can I help?" unless the user is clearly asking for assistance.',
                'Use topic_helper only when the message is a real question or request that likely needs household knowledge or a topic-specific helper.',
                'Use the recent conversation when writing replyText. Do not ignore the already-established subject.',
                'The recent thread messages are more important than the per-user memory summary.',
                'If the user asks what you think about a price or quantity, mention the actual item/price from context when possible.',
                'Set shouldStartTyping to true only if the chosen route will likely trigger a slower helper or assistant call.',
                '=== PURCHASE TOPIC RULES ===',
                'Classify as purchase_candidate when ALL of:',
                '- Contains completed purchase verb (купил, bought, ordered, picked up, spent, взял, заказал, потратил)',
                '- Contains realistic household item (food, groceries, household goods, toiletries, medicine, transport, cafe, restaurant)',
                '- Contains amount that is realistic for household purchase (under 500 GEL/USD/EUR)',
                '- NOT a fantastical/impossible item',
                'Gifts for household members ARE shared purchases - classify as purchase_candidate.',
                'Classify as chat_reply (NOT silent) with playful response when:',
                '- Item is fantastical (car, plane, rocket, island, castle, yacht, apartment renovation >1000)',
                '- Amount is excessively large (>500 GEL/USD/EUR)',
                '- User explicitly says it is a joke, gift for non-household member, or personal expense',
                'Examples of purchase_candidate: "купил бананов 10 лари", "bought groceries 50 gel", "взял такси 15 лари", "купил Диме игрушку 20 лари"',
                'Examples of chat_reply: "купил машину", "купил квартиру", "купил самолет" (respond playfully: "Ого, записывай сам!" or similar)',
                'Use purchase_followup only when there is active purchase clarification and the latest message looks like a real answer to it.',
                '=== PAYMENT TOPIC RULES ===',
                'Classify as payment_candidate when:',
                '- Contains payment verb (оплатил, paid, заплатил) + rent/utilities/bills',
                '- Amount is realistic (<500)',
                'Classify as chat_reply with playful response for fantastical amounts (>500).',
                'Use payment_followup only when there is active payment clarification/confirmation and the latest message looks like a real answer to it.',
                '=== GENERAL ===',
                'For absurd or playful messages, be light and short with chat_reply. Never loop or interrogate.',
                input.assistantTone ? `Use this tone lightly: ${input.assistantTone}.` : null,
                input.assistantContext
                  ? `Household flavor context: ${input.assistantContext}`
                  : null,
                'Return only JSON matching the schema.'
              ]
                .filter(Boolean)
                .join(' ')
            },
            {
              role: 'user',
              content: [
                `User locale: ${input.locale}`,
                `Topic role: ${input.topicRole}`,
                `Explicit mention: ${input.isExplicitMention ? 'yes' : 'no'}`,
                `Reply to bot: ${input.isReplyToBot ? 'yes' : 'no'}`,
                `Active workflow: ${input.activeWorkflow ?? 'none'}`,
                input.engagementAssessment
                  ? `Engagement assessment: engaged=${input.engagementAssessment.engaged ? 'yes' : 'no'}; reason=${input.engagementAssessment.reason}; strong_reference=${input.engagementAssessment.strongReference ? 'yes' : 'no'}; weak_session=${input.engagementAssessment.weakSessionActive ? 'yes' : 'no'}; open_bot_question=${input.engagementAssessment.hasOpenBotQuestion ? 'yes' : 'no'}`
                  : null,
                buildRecentThreadMessages(input),
                buildRecentChatMessages(input),
                buildRecentTurns(input),
                `Latest message:\n${input.messageText}`
              ]
                .filter(Boolean)
                .join('\n\n')
            }
          ],
          text: {
            format: {
              type: 'json_schema',
              name: 'topic_message_route',
              schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  route: {
                    type: 'string',
                    enum: [
                      'silent',
                      'chat_reply',
                      'purchase_candidate',
                      'purchase_followup',
                      'payment_candidate',
                      'payment_followup',
                      'topic_helper',
                      'dismiss_workflow'
                    ]
                  },
                  replyText: {
                    anyOf: [{ type: 'string' }, { type: 'null' }]
                  },
                  helperKind: {
                    anyOf: [
                      {
                        type: 'string',
                        enum: ['assistant', 'purchase', 'payment', 'reminder']
                      },
                      { type: 'null' }
                    ]
                  },
                  shouldStartTyping: {
                    type: 'boolean'
                  },
                  shouldClearWorkflow: {
                    type: 'boolean'
                  },
                  confidence: {
                    type: 'number',
                    minimum: 0,
                    maximum: 100
                  },
                  reason: {
                    anyOf: [{ type: 'string' }, { type: 'null' }]
                  }
                },
                required: [
                  'route',
                  'replyText',
                  'helperKind',
                  'shouldStartTyping',
                  'shouldClearWorkflow',
                  'confidence',
                  'reason'
                ]
              }
            }
          }
        })
      })

      if (!response.ok) {
        return fallbackTopicMessageRoute(input)
      }

      const payload = (await response.json()) as Record<string, unknown>
      const text = extractOpenAiResponseText(payload)
      const parsed = parseJsonFromResponseText(text ?? '')

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return fallbackTopicMessageRoute(input)
      }

      const parsedObject = parsed as Record<string, unknown>

      const route = normalizeRoute(
        typeof parsedObject.route === 'string' ? parsedObject.route : 'silent'
      )
      const replyText =
        typeof parsedObject.replyText === 'string' && parsedObject.replyText.trim().length > 0
          ? parsedObject.replyText.trim()
          : null

      return {
        route,
        replyText,
        helperKind:
          typeof parsedObject.helperKind === 'string' || parsedObject.helperKind === null
            ? normalizeHelperKind(parsedObject.helperKind)
            : null,
        shouldStartTyping: parsedObject.shouldStartTyping === true,
        shouldClearWorkflow: parsedObject.shouldClearWorkflow === true,
        confidence: normalizeConfidence(
          typeof parsedObject.confidence === 'number' ? parsedObject.confidence : null
        ),
        reason: typeof parsedObject.reason === 'string' ? parsedObject.reason : null
      }
    } catch {
      return fallbackTopicMessageRoute(input)
    } finally {
      clearTimeout(timeout)
    }
  }
}
