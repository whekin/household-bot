import { extractOpenAiResponseText, parseJsonFromResponseText } from './openai-responses'

export type WakeGateTopicRole = 'payments' | 'purchase' | 'reminders' | 'feedback' | 'generic'

export interface WakeGateDecision {
  wake: boolean
  reason:
    | 'mention'
    | 'reply_to_bot'
    | 'active_workflow'
    | 'addressed'
    | 'payment_fact'
    | 'purchase_fact'
    | 'notification_request'
    | 'silent'
}

export interface WakeClassifierVerdict {
  addressedToBot: boolean
  completedPaymentFact: boolean
  completedPurchaseFact: boolean
  notificationRequest: boolean
}

export interface WakeClassifierMessage {
  speaker: string
  isBot: boolean
  text: string
}

export type WakeClassifier = (input: {
  messageText: string
  topicRole: WakeGateTopicRole
  recentMessages: readonly WakeClassifierMessage[]
  replyToText: string | null
}) => Promise<WakeClassifierVerdict | null>

const BOT_NAME_PATTERN =
  /(?:^|[^\p{L}\p{N}])(?:бот[а-яё]{0,3}|кожур[а-яё]{0,3}|кожор[а-яё]{0,3}|bot|kojori)(?=$|[^\p{L}\p{N}])/iu

export function mentionsBotName(messageText: string, botUsername?: string | null): boolean {
  if (BOT_NAME_PATTERN.test(messageText)) {
    return true
  }

  return Boolean(botUsername && messageText.toLowerCase().includes(`@${botUsername.toLowerCase()}`))
}

const WAKE_CLASSIFIER_SYSTEM_PROMPT = `You watch one message in a shared household Telegram chat and answer three yes/no questions. Household members talk to each other here; the bot ("Кожур"/"Kojori") must stay out of human conversations.

1. addressedToBot — the sender is speaking TO the bot: summoning it, asking it something, answering its question, or giving it an instruction. Talking ABOUT the bot ("бот тупит", "this bot is gpt2.0"), addressing another person, or coordinating plans between people is NOT addressing the bot. When unsure, answer false.

2. completedPaymentFact — the message states a household member has COMPLETED a rent or utilities payment (e.g. "оплатил коммуналку", "закинул за себя и за Иона", "paid rent"). Future intent ("надо оплатить", "завтра закину", "могу оплатить"), offers, requests to others, and questions are NOT payment facts. When unsure, answer false.

3. completedPurchaseFact — the message states a COMPLETED shared household purchase with an item (e.g. "купил корм 12 лари"). Plans, wishes, and price chatter are NOT purchase facts. When unsure, answer false.

4. notificationRequest — the message asks to schedule, set, move, or cancel a household reminder/notification (e.g. "напомни завтра про уборку", "напомни оплатить свет 24-го"). Ordinary chatter about plans is NOT a request. When unsure, answer false.

Answer strictly from the message and short context. Return JSON only.`

export function createOpenAiWakeClassifier(
  apiKey: string | undefined,
  model: string,
  timeoutMs: number,
  logger?: {
    error: (obj: unknown, msg?: string) => void
  }
): WakeClassifier | undefined {
  if (!apiKey) {
    return undefined
  }

  return async (input) => {
    const abortController = new AbortController()
    const timeout = setTimeout(() => abortController.abort(), timeoutMs)

    try {
      const contextLines = input.recentMessages
        .slice(-6)
        .map((message) => `${message.isBot ? 'BOT' : message.speaker}: ${message.text}`)

      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        signal: abortController.signal,
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model,
          reasoning: { effort: 'none' },
          input: [
            {
              type: 'message',
              role: 'system',
              content: WAKE_CLASSIFIER_SYSTEM_PROMPT
            },
            {
              type: 'message',
              role: 'user',
              content: [
                `Topic role: ${input.topicRole}`,
                contextLines.length > 0 ? `Recent messages:\n${contextLines.join('\n')}` : null,
                input.replyToText ? `The new message replies to: ${input.replyToText}` : null,
                `New message:\n${input.messageText}`
              ]
                .filter(Boolean)
                .join('\n\n')
            }
          ],
          text: {
            format: {
              type: 'json_schema',
              name: 'wake_verdict',
              schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  addressedToBot: { type: 'boolean' },
                  completedPaymentFact: { type: 'boolean' },
                  completedPurchaseFact: { type: 'boolean' },
                  notificationRequest: { type: 'boolean' }
                },
                required: [
                  'addressedToBot',
                  'completedPaymentFact',
                  'completedPurchaseFact',
                  'notificationRequest'
                ]
              }
            }
          }
        })
      })

      if (!response.ok) {
        logger?.error(
          { event: 'wake_classifier.api_error', status: response.status },
          'Wake classifier API error'
        )
        return null
      }

      const payload = (await response.json()) as Record<string, unknown>
      const text = extractOpenAiResponseText(payload)
      const parsed = parseJsonFromResponseText<WakeClassifierVerdict>(text ?? '')
      if (!parsed || typeof parsed !== 'object') {
        return null
      }

      return {
        addressedToBot: parsed.addressedToBot === true,
        completedPaymentFact: parsed.completedPaymentFact === true,
        completedPurchaseFact: parsed.completedPurchaseFact === true,
        notificationRequest: parsed.notificationRequest === true
      }
    } catch (error) {
      logger?.error({ event: 'wake_classifier.failed', err: error }, 'Wake classifier failed')
      return null
    } finally {
      clearTimeout(timeout)
    }
  }
}

export async function assessWake(input: {
  messageText: string
  topicRole: WakeGateTopicRole
  isExplicitMention: boolean
  isReplyToBot: boolean
  hasActiveWorkflow: boolean
  botUsername?: string | null
  recentMessages: readonly WakeClassifierMessage[]
  replyToText?: string | null
  classifier?: WakeClassifier
}): Promise<WakeGateDecision> {
  if (input.isExplicitMention) {
    return { wake: true, reason: 'mention' }
  }

  if (input.isReplyToBot) {
    return { wake: true, reason: 'reply_to_bot' }
  }

  if (input.hasActiveWorkflow) {
    return { wake: true, reason: 'active_workflow' }
  }

  const namePresent = mentionsBotName(input.messageText, input.botUsername)
  const factCheckNeeded =
    input.topicRole === 'payments' ||
    input.topicRole === 'purchase' ||
    input.topicRole === 'reminders'

  if ((!namePresent && !factCheckNeeded) || !input.classifier) {
    return { wake: false, reason: 'silent' }
  }

  const verdict = await input.classifier({
    messageText: input.messageText,
    topicRole: input.topicRole,
    recentMessages: input.recentMessages,
    replyToText: input.replyToText ?? null
  })

  if (!verdict) {
    return { wake: false, reason: 'silent' }
  }

  if (namePresent && verdict.addressedToBot) {
    return { wake: true, reason: 'addressed' }
  }

  if (input.topicRole === 'payments' && verdict.completedPaymentFact) {
    return { wake: true, reason: 'payment_fact' }
  }

  if (input.topicRole === 'purchase' && verdict.completedPurchaseFact) {
    return { wake: true, reason: 'purchase_fact' }
  }

  if (input.topicRole === 'reminders' && verdict.notificationRequest) {
    return { wake: true, reason: 'notification_request' }
  }

  return { wake: false, reason: 'silent' }
}
