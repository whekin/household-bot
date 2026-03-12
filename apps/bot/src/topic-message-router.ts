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

const BACKOFF_PATTERN =
  /\b(?:leave me alone|go away|stop|not now|back off|shut up)\b|(?:^|[^\p{L}])(?:отстань|хватит|не сейчас|замолчи|оставь(?:\s+меня)?\s+в\s+покое)(?=$|[^\p{L}])/iu
const PLANNING_PATTERN =
  /\b(?:want to buy|thinking about buying|thinking of buying|going to buy|plan to buy|might buy|tomorrow|later)\b|(?:^|[^\p{L}])(?:(?:хочу|думаю|планирую|может)\s+(?:купить|взять|заказать)|(?:подумаю|завтра|потом))(?=$|[^\p{L}])/iu
const LIKELY_PURCHASE_PATTERN =
  /\b(?:bought|ordered|picked up|spent|paid)\b|(?:^|[^\p{L}])(?:купил(?:а|и)?|взял(?:а|и)?|заказал(?:а|и)?|потратил(?:а|и)?|заплатил(?:а|и)?|сторговался(?:\s+до)?)(?=$|[^\p{L}])/iu
const LIKELY_PAYMENT_PATTERN =
  /\b(?:paid rent|paid utilities|rent paid|utilities paid)\b|(?:^|[^\p{L}])(?:оплатил(?:а|и)?|заплатил(?:а|и)?)(?=$|[^\p{L}])/iu
const CONTEXT_REFERENCE_PATTERN =
  /\b(?:already said(?: above)?|said above|question above|do you have context|from the dialog(?:ue)?|based on the dialog(?:ue)?)\b|(?:^|[^\p{L}])(?:контекст(?:\s+диалога)?|у\s+тебя\s+есть\s+контекст(?:\s+диалога)?|основываясь\s+на\s+диалоге|я\s+уже\s+сказал(?:\s+выше)?|уже\s+сказал(?:\s+выше)?|вопрос\s+выше|вопрос\s+уже\s+есть|это\s+вопрос|ответь\s+на\s+него)(?=$|[^\p{L}])/iu
const CONTEXT_REFERENCE_STRIP_PATTERN = new RegExp(CONTEXT_REFERENCE_PATTERN.source, 'giu')
const LETTER_PATTERN = /\p{L}/u
const DIRECT_BOT_ADDRESS_PATTERN =
  /^\s*(?:(?:ну|эй|слышь|слушай|hey|yo)\s*,?\s*)*(?:бот|bot)(?=$|[^\p{L}])/iu

export function looksLikeDirectBotAddress(text: string): boolean {
  return DIRECT_BOT_ADDRESS_PATTERN.test(text.trim())
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

function fallbackReply(locale: 'en' | 'ru', kind: 'backoff' | 'watching'): string {
  if (locale === 'ru') {
    return kind === 'backoff'
      ? 'Окей, молчу.'
      : 'Я тут. Если будет реальная покупка или оплата, подключусь.'
  }

  return kind === 'backoff'
    ? "Okay, I'll back off."
    : "I'm here. If there's a real purchase or payment, I'll jump in."
}

function isBareContextReference(text: string): boolean {
  const normalized = text.trim()
  if (!CONTEXT_REFERENCE_PATTERN.test(normalized)) {
    return false
  }

  const stripped = normalized
    .replace(CONTEXT_REFERENCE_STRIP_PATTERN, ' ')
    .replace(/[\s,.:;!?()[\]{}"'`-]+/gu, ' ')
    .trim()

  return stripped.length === 0
}

function isPlanningMessage(text: string): boolean {
  const normalized = text.trim()
  return PLANNING_PATTERN.test(normalized) && !LIKELY_PURCHASE_PATTERN.test(normalized)
}

function assistantFallbackRoute(
  input: TopicMessageRoutingInput,
  reason: string,
  shouldClearWorkflow: boolean
): TopicMessageRoutingResult {
  const shouldReply = input.isExplicitMention || input.isReplyToBot || input.activeWorkflow !== null

  return shouldReply
    ? {
        route: 'topic_helper',
        replyText: null,
        helperKind: 'assistant',
        shouldStartTyping: true,
        shouldClearWorkflow,
        confidence: 88,
        reason
      }
    : {
        route: 'silent',
        replyText: null,
        helperKind: null,
        shouldStartTyping: false,
        shouldClearWorkflow,
        confidence: 88,
        reason
      }
}

function applyRouteGuards(
  input: TopicMessageRoutingInput,
  route: TopicMessageRoutingResult
): TopicMessageRoutingResult {
  const normalized = input.messageText.trim()
  if (normalized.length === 0) {
    return route
  }

  if (
    isBareContextReference(normalized) &&
    (route.route === 'purchase_candidate' ||
      route.route === 'purchase_followup' ||
      route.route === 'payment_candidate' ||
      route.route === 'payment_followup')
  ) {
    return assistantFallbackRoute(input, 'context_reference', input.activeWorkflow !== null)
  }

  if (
    input.topicRole === 'purchase' &&
    isPlanningMessage(normalized) &&
    (route.route === 'purchase_candidate' || route.route === 'purchase_followup')
  ) {
    return assistantFallbackRoute(input, 'planning_guard', input.activeWorkflow !== null)
  }

  return route
}

export function fallbackTopicMessageRoute(
  input: TopicMessageRoutingInput
): TopicMessageRoutingResult {
  const normalized = input.messageText.trim()
  const isAddressed =
    input.isExplicitMention || input.isReplyToBot || input.engagementAssessment?.engaged === true

  if (normalized.length === 0 || !LETTER_PATTERN.test(normalized)) {
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

  if (BACKOFF_PATTERN.test(normalized)) {
    return {
      route: 'dismiss_workflow',
      replyText: isAddressed ? fallbackReply(input.locale, 'backoff') : null,
      helperKind: null,
      shouldStartTyping: false,
      shouldClearWorkflow: input.activeWorkflow !== null,
      confidence: 94,
      reason: 'backoff'
    }
  }

  if (isBareContextReference(normalized)) {
    return assistantFallbackRoute(input, 'context_reference', input.activeWorkflow !== null)
  }

  if (input.topicRole === 'purchase') {
    if (input.activeWorkflow === 'purchase_clarification' && isPlanningMessage(normalized)) {
      return assistantFallbackRoute(input, 'planning_guard', true)
    }

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

    if (isAddressed && PLANNING_PATTERN.test(normalized)) {
      return {
        route: 'chat_reply',
        replyText:
          input.locale === 'ru'
            ? 'Похоже, ты пока прикидываешь. Когда захочешь мнение или реальную покупку записать, подключусь.'
            : "Sounds like you're still thinking it through. If you want an opinion or a real purchase recorded, I'm in.",
        helperKind: 'assistant',
        shouldStartTyping: false,
        shouldClearWorkflow: false,
        confidence: 66,
        reason: 'planning_advice'
      }
    }

    if (!PLANNING_PATTERN.test(normalized) && LIKELY_PURCHASE_PATTERN.test(normalized)) {
      return {
        route: 'purchase_candidate',
        replyText: null,
        helperKind: 'purchase',
        shouldStartTyping: true,
        shouldClearWorkflow: false,
        confidence: 70,
        reason: 'likely_purchase'
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

    if (!PLANNING_PATTERN.test(normalized) && LIKELY_PAYMENT_PATTERN.test(normalized)) {
      return {
        route: 'payment_candidate',
        replyText: null,
        helperKind: 'payment',
        shouldStartTyping: false,
        shouldClearWorkflow: false,
        confidence: 68,
        reason: 'likely_payment'
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

  if (isAddressed) {
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
                'Prefer silence over speaking.',
                'Do not start purchase or payment workflows for planning, hypotheticals, negotiations, tests, or obvious jokes.',
                'Treat “stop”, “leave me alone”, “just thinking”, “not a purchase”, and similar messages as backoff or dismissal signals.',
                'When the user directly addresses the bot with small talk, joking, or testing, prefer chat_reply with one short sentence.',
                'In a purchase topic, if the user is discussing a possible future purchase and asks for an opinion, prefer chat_reply with a short contextual opinion instead of a workflow.',
                'Use the recent conversation when writing replyText. Do not ignore the already-established subject.',
                'The recent thread messages are more important than the per-user memory summary.',
                'If the user asks what you think about a price or quantity, mention the actual item/price from context when possible.',
                'Use topic_helper only when the message is a real question or request that likely needs household knowledge or a topic-specific helper.',
                'Use purchase_candidate only for a clear completed shared purchase.',
                'Use purchase_followup only when there is active purchase clarification and the latest message looks like a real answer to it.',
                'Use payment_candidate only for a clear payment confirmation.',
                'Use payment_followup only when there is active payment clarification/confirmation and the latest message looks like a real answer to it.',
                'For absurd or playful messages, be light and short. Never loop or interrogate.',
                'Set shouldStartTyping to true only if the chosen route will likely trigger a slower helper or assistant call.',
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
                `Looks like direct address: ${looksLikeDirectBotAddress(input.messageText) ? 'yes' : 'no'}`,
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

      return applyRouteGuards(input, {
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
      })
    } catch {
      return fallbackTopicMessageRoute(input)
    } finally {
      clearTimeout(timeout)
    }
  }
}
