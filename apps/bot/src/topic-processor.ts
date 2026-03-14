import { extractOpenAiResponseText, parseJsonFromResponseText } from './openai-responses'
import type { TopicWorkflowState } from './topic-message-router'
import type { EngagementAssessment } from './conversation-orchestrator'

export type TopicProcessorRoute =
  | 'silent'
  | 'chat_reply'
  | 'purchase'
  | 'purchase_clarification'
  | 'payment'
  | 'payment_clarification'
  | 'topic_helper'
  | 'dismiss_workflow'

export interface TopicProcessorPurchaseResult {
  route: 'purchase'
  amountMinor: string
  currency: 'GEL' | 'USD'
  itemDescription: string
  amountSource: 'explicit' | 'calculated'
  calculationExplanation: string | null
  participantMemberIds: string[] | null
  confidence: number
  reason: string
}

export interface TopicProcessorPaymentResult {
  route: 'payment'
  kind: 'rent' | 'utilities'
  amountMinor: string
  currency: 'GEL' | 'USD'
  confidence: number
  reason: string
}

export interface TopicProcessorChatReplyResult {
  route: 'chat_reply'
  replyText: string
  reason: string
}

export interface TopicProcessorSilentResult {
  route: 'silent'
  reason: string
}

export interface TopicProcessorClarificationResult {
  route: 'purchase_clarification' | 'payment_clarification'
  clarificationQuestion: string
  reason: string
}

export interface TopicProcessorTopicHelperResult {
  route: 'topic_helper'
  reason: string
}

export interface TopicProcessorDismissWorkflowResult {
  route: 'dismiss_workflow'
  replyText: string | null
  reason: string
}

export type TopicProcessorResult =
  | TopicProcessorSilentResult
  | TopicProcessorChatReplyResult
  | TopicProcessorPurchaseResult
  | TopicProcessorClarificationResult
  | TopicProcessorPaymentResult
  | TopicProcessorTopicHelperResult
  | TopicProcessorDismissWorkflowResult

export interface TopicProcessorHouseholdMember {
  memberId: string
  displayName: string
  status: 'active' | 'away' | 'left'
}

export interface TopicProcessorMessage {
  role: 'user' | 'assistant'
  speaker: string
  text: string
}

export interface TopicProcessorTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface TopicProcessorInput {
  locale: 'en' | 'ru'
  topicRole: 'purchase' | 'payments' | 'generic'
  messageText: string
  isExplicitMention: boolean
  isReplyToBot: boolean
  activeWorkflow: TopicWorkflowState
  defaultCurrency: 'GEL' | 'USD'
  householdContext: string | null
  assistantTone: string | null
  householdMembers: readonly TopicProcessorHouseholdMember[]
  senderMemberId: string | null
  recentThreadMessages: readonly TopicProcessorMessage[]
  recentChatMessages: readonly TopicProcessorMessage[]
  recentTurns: readonly TopicProcessorTurn[]
  engagementAssessment: EngagementAssessment
}

export type TopicProcessor = (input: TopicProcessorInput) => Promise<TopicProcessorResult | null>

export function asOptionalBigInt(value: string | null): bigint | null {
  if (value === null || !/^[0-9]+$/.test(value)) {
    return null
  }

  const parsed = BigInt(value)
  return parsed > 0n ? parsed : null
}

export function normalizeCurrency(value: string | null): 'GEL' | 'USD' | null {
  return value === 'GEL' || value === 'USD' ? value : null
}

export function normalizeConfidence(value: number): number {
  const scaled = value >= 0 && value <= 1 ? value * 100 : value
  return Math.max(0, Math.min(100, Math.round(scaled)))
}

export function normalizeParticipantMemberIds(
  value: readonly string[] | null | undefined,
  householdMembers: readonly TopicProcessorHouseholdMember[]
): readonly string[] | null {
  if (!value || value.length === 0) {
    return null
  }

  const allowedMemberIds = new Set(householdMembers.map((member) => member.memberId))
  const normalized = value
    .map((memberId) => memberId.trim())
    .filter((memberId) => memberId.length > 0)
    .filter((memberId, index, all) => all.indexOf(memberId) === index)
    .filter((memberId) => allowedMemberIds.has(memberId))

  return normalized.length > 0 ? normalized : null
}

function normalizeRoute(value: string): TopicProcessorRoute {
  switch (value) {
    case 'silent':
    case 'chat_reply':
    case 'purchase':
    case 'purchase_clarification':
    case 'payment':
    case 'payment_clarification':
    case 'topic_helper':
    case 'dismiss_workflow':
      return value
    default:
      return 'silent'
  }
}

interface OpenAiStructuredResult {
  route: TopicProcessorRoute
  replyText?: string | null
  clarificationQuestion?: string | null
  amountMinor?: string | null
  currency?: 'GEL' | 'USD' | null
  itemDescription?: string | null
  amountSource?: 'explicit' | 'calculated' | null
  calculationExplanation?: string | null
  participantMemberIds?: string[] | null
  kind?: 'rent' | 'utilities' | null
  confidence?: number
  reason?: string | null
}

function buildContextSection(input: TopicProcessorInput): string {
  const parts: string[] = []

  parts.push(`User locale: ${input.locale}`)
  parts.push(`Topic role: ${input.topicRole}`)
  parts.push(`Default currency: ${input.defaultCurrency}`)
  parts.push(`Explicit mention: ${input.isExplicitMention ? 'yes' : 'no'}`)
  parts.push(`Reply to bot: ${input.isReplyToBot ? 'yes' : 'no'}`)
  parts.push(`Active workflow: ${input.activeWorkflow ?? 'none'}`)
  parts.push(
    `Engagement: engaged=${input.engagementAssessment.engaged ? 'yes' : 'no'}; reason=${input.engagementAssessment.reason}`
  )

  if (input.householdContext) {
    parts.push(`Household context: ${input.householdContext}`)
  }

  if (input.householdMembers.length > 0) {
    parts.push(
      'Household members:\n' +
        input.householdMembers
          .map(
            (m) =>
              `- ${m.memberId}: ${m.displayName} (status=${m.status}${m.memberId === input.senderMemberId ? ', sender=yes' : ''})`
          )
          .join('\n')
    )
  }

  return parts.join('\n')
}

function buildRecentMessagesSection(input: TopicProcessorInput): string | null {
  const parts: string[] = []

  if (input.recentThreadMessages.length > 0) {
    parts.push(
      'Recent messages in this thread:\n' +
        input.recentThreadMessages
          .slice(-8)
          .map((m) => `${m.speaker} (${m.role}): ${m.text}`)
          .join('\n')
    )
  }

  if (input.recentChatMessages.length > 0) {
    parts.push(
      'Recent chat messages:\n' +
        input.recentChatMessages
          .slice(-6)
          .map((m) => `${m.speaker} (${m.role}): ${m.text}`)
          .join('\n')
    )
  }

  if (input.recentTurns.length > 0) {
    parts.push(
      'Recent conversation with this user:\n' +
        input.recentTurns
          .slice(-4)
          .map((t) => `${t.role}: ${t.text}`)
          .join('\n')
    )
  }

  return parts.length > 0 ? parts.join('\n\n') : null
}

export function createTopicProcessor(
  apiKey: string | undefined,
  model: string,
  timeoutMs: number
): TopicProcessor | undefined {
  if (!apiKey) {
    return undefined
  }

  return async (input) => {
    const abortController = new AbortController()
    const timeout = setTimeout(() => abortController.abort(), timeoutMs)

    try {
      const contextSection = buildContextSection(input)
      const messagesSection = buildRecentMessagesSection(input)

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
              type: 'message',
              role: 'system',
              content: `You are the brain of Kojori, a household Telegram bot. You process every message in a topic and decide the right action.

=== WHEN TO STAY SILENT ===
- Default to silent in group topics unless one of the following is true:
  - The message reports a completed purchase or payment (your primary purpose in these topics)
  - The user addresses the bot (by @mention, reply to bot, or text reference in ANY language — бот, bot, kojori, кожори, or any recognizable variant)
  - There is an active clarification/confirmation workflow for this user
  - The user is clearly engaged with the bot (recent bot interaction, strong context reference)
- Regular chat between users (plans, greetings, discussion) → silent

=== PURCHASE TOPIC (topicRole=purchase) ===
Purchase detection is CONTENT-BASED — engagement signals are irrelevant for this decision.
If the message reports a completed purchase (past-tense buy verb + realistic item + amount), classify as "purchase" REGARDLESS of mention/engagement.
- Completed buy verbs: купил, bought, ordered, picked up, spent, взял, заказал, потратил, сходил взял, etc.
- Realistic household items: food, groceries, household goods, toiletries, medicine, transport, cafe, restaurant
- Amount under 500 currency units for household purchases
- Gifts for household members ARE shared purchases
- Plans, wishes, future intent → silent (NOT purchases)
- Fantastical items (car, plane, island) or excessive amounts (>500) → chat_reply with playful response

When classifying as "purchase":
- amountMinor in minor currency units (350 GEL → 35000, 3.50 → 350)
- Compute totals from quantity × price when needed, set amountSource="calculated"
- If user names specific household members as participants, return their memberIds
- Use clarification when amount, item, or intent is unclear but purchase seems likely

=== PAYMENT TOPIC (topicRole=payments) ===
If the message reports a completed rent or utility payment (payment verb + rent/utilities + amount), classify as "payment".
- Payment verbs: оплатил, paid, заплатил, перевёл, кинул, отправил
- Realistic amount for rent/utilities

=== CHAT REPLIES ===
CRITICAL: chat_reply replyText must NEVER claim a purchase or payment was saved, recorded, confirmed, or logged. The chat_reply route does NOT save anything. Only "purchase" and "payment" routes process real data.

=== BOT ADDRESSING ===
When the user addresses the bot (by any means), you MUST respond — never silent.
For bare summons ("бот?", "bot", "@kojori_bot"), use topic_helper to let the assistant greet.
For small talk or jokes directed at the bot, use chat_reply with a short playful response.
For questions that need household knowledge, use topic_helper.

=== WORKFLOWS ===
If there is an active clarification workflow and the user's message answers it, combine with context.
If user dismisses ("не, забей", "cancel"), use dismiss_workflow.`
            },
            {
              type: 'message',
              role: 'user',
              content: [contextSection, messagesSection, `Latest message:\n${input.messageText}`]
                .filter(Boolean)
                .join('\n\n')
            }
          ],
          text: {
            format: {
              type: 'json_schema',
              name: 'topic_processor_result',
              schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  route: {
                    type: 'string',
                    enum: [
                      'silent',
                      'chat_reply',
                      'purchase',
                      'purchase_clarification',
                      'payment',
                      'payment_clarification',
                      'topic_helper',
                      'dismiss_workflow'
                    ]
                  },
                  replyText: {
                    anyOf: [{ type: 'string' }, { type: 'null' }]
                  },
                  clarificationQuestion: {
                    anyOf: [{ type: 'string' }, { type: 'null' }]
                  },
                  amountMinor: {
                    anyOf: [{ type: 'string' }, { type: 'null' }]
                  },
                  currency: {
                    anyOf: [{ type: 'string', enum: ['GEL', 'USD'] }, { type: 'null' }]
                  },
                  itemDescription: {
                    anyOf: [{ type: 'string' }, { type: 'null' }]
                  },
                  amountSource: {
                    anyOf: [{ type: 'string', enum: ['explicit', 'calculated'] }, { type: 'null' }]
                  },
                  calculationExplanation: {
                    anyOf: [{ type: 'string' }, { type: 'null' }]
                  },
                  participantMemberIds: {
                    anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }]
                  },
                  kind: {
                    anyOf: [{ type: 'string', enum: ['rent', 'utilities'] }, { type: 'null' }]
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
                required: ['route', 'confidence', 'reason']
              }
            }
          }
        })
      })

      if (!response.ok) {
        return null
      }

      const payload = (await response.json()) as Record<string, unknown>
      const text = extractOpenAiResponseText(payload)
      const parsed = parseJsonFromResponseText<OpenAiStructuredResult>(text ?? '')

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null
      }

      const route = normalizeRoute(typeof parsed.route === 'string' ? parsed.route : 'silent')
      const confidence = normalizeConfidence(
        typeof parsed.confidence === 'number' ? parsed.confidence : 0
      )
      const reason = typeof parsed.reason === 'string' ? parsed.reason : 'unknown'

      switch (route) {
        case 'silent':
          return { route, reason }

        case 'chat_reply': {
          const replyText =
            typeof parsed.replyText === 'string' && parsed.replyText.trim().length > 0
              ? parsed.replyText.trim()
              : null
          if (!replyText) {
            return { route: 'silent', reason: 'empty_chat_reply' }
          }
          return { route, replyText, reason }
        }

        case 'purchase': {
          const amountMinor = asOptionalBigInt(parsed.amountMinor ?? null)
          const currency = normalizeCurrency(parsed.currency ?? null)
          const itemDescription =
            typeof parsed.itemDescription === 'string' && parsed.itemDescription.trim().length > 0
              ? parsed.itemDescription.trim()
              : null

          if (!amountMinor || !currency || !itemDescription) {
            return {
              route: 'purchase_clarification',
              clarificationQuestion: 'Could you clarify the purchase details?',
              reason: 'missing_required_fields'
            }
          }

          const participantMemberIds = normalizeParticipantMemberIds(
            parsed.participantMemberIds,
            input.householdMembers
          )

          return {
            route,
            amountMinor: amountMinor.toString(),
            currency,
            itemDescription,
            amountSource: parsed.amountSource === 'calculated' ? 'calculated' : 'explicit',
            calculationExplanation:
              typeof parsed.calculationExplanation === 'string' &&
              parsed.calculationExplanation.trim().length > 0
                ? parsed.calculationExplanation.trim()
                : null,
            participantMemberIds: participantMemberIds ? [...participantMemberIds] : null,
            confidence,
            reason
          }
        }

        case 'purchase_clarification':
        case 'payment_clarification': {
          const clarificationQuestion =
            typeof parsed.clarificationQuestion === 'string' &&
            parsed.clarificationQuestion.trim().length > 0
              ? parsed.clarificationQuestion.trim()
              : 'Could you clarify?'
          return { route, clarificationQuestion, reason }
        }

        case 'payment': {
          const amountMinor = asOptionalBigInt(parsed.amountMinor ?? null)
          const currency = normalizeCurrency(parsed.currency ?? null)
          const kind = parsed.kind === 'rent' || parsed.kind === 'utilities' ? parsed.kind : null

          if (!amountMinor || !currency || !kind) {
            return {
              route: 'payment_clarification',
              clarificationQuestion: 'Could you clarify the payment details?',
              reason: 'missing_required_fields'
            }
          }

          return {
            route,
            kind,
            amountMinor: amountMinor.toString(),
            currency,
            confidence,
            reason
          }
        }

        case 'topic_helper':
          return { route, reason }

        case 'dismiss_workflow': {
          const replyText =
            typeof parsed.replyText === 'string' && parsed.replyText.trim().length > 0
              ? parsed.replyText.trim()
              : null
          return { route, replyText, reason }
        }

        default:
          return { route: 'silent', reason: 'unknown_route' }
      }
    } catch {
      return null
    } finally {
      clearTimeout(timeout)
    }
  }
}

export function botSleepsMessage(locale: 'en' | 'ru' | string): string {
  const enMessages = [
    '😴 Kojori is taking a quick nap... try again in a moment!',
    '💤 The bot is recharging its circuits... be right back!',
    '🌙 Kojori went to grab some digital coffee...',
    '⚡ Power nap in progress... zzz...'
  ]
  const ruMessages = [
    '😴 Кожори немного вздремнул... попробуйте ещё раз через минутку!',
    '💤 Бот подзаряжает свои схемы... скоро вернётся!',
    '🌙 Кожори сбегал за цифровым кофе...',
    '⚡ Идёт подзарядка... zzz...'
  ]

  const messages = locale === 'ru' ? ruMessages : enMessages
  return messages[Math.floor(Math.random() * messages.length)]!
}
