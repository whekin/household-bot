import { extractOpenAiResponseText, type OpenAiResponsePayload } from './openai-responses'
import type { TopicMessageRole } from './topic-message-router'

const ASSISTANT_MAX_OUTPUT_TOKENS = 220

export interface AssistantUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export interface AssistantReply {
  text: string
  usage: AssistantUsage
}

export interface ConversationalAssistant {
  respond(input: {
    locale: 'en' | 'ru'
    topicRole: TopicMessageRole
    householdContext: string
    authoritativeFacts?: readonly string[]
    memorySummary: string | null
    recentTurns: readonly {
      role: 'user' | 'assistant'
      text: string
    }[]
    recentThreadMessages?: readonly {
      role: 'user' | 'assistant'
      speaker: string
      text: string
      threadId: string | null
    }[]
    sameDayChatMessages?: readonly {
      role: 'user' | 'assistant'
      speaker: string
      text: string
      threadId: string | null
    }[]
    responseInstructions?: string | null
    userMessage: string
  }): Promise<AssistantReply>
}

function topicCapabilityNotes(topicRole: TopicMessageRole): string {
  switch (topicRole) {
    case 'purchase':
      return [
        'Purchase topic capabilities:',
        '- You can discuss shared household purchases, clarify intent, and help with purchase recording flow.',
        '- You cannot claim a purchase was saved unless the system explicitly confirmed it.',
        '- You cannot create unrelated reminders, tasks, or household settings changes.'
      ].join('\n')
    case 'payments':
      return [
        'Payments topic capabilities:',
        '- You can discuss rent and utility payment status and supported payment confirmation flows.',
        '- You cannot claim a payment was recorded unless the system explicitly confirmed it.',
        '- You cannot schedule reminders or create arbitrary tasks.'
      ].join('\n')
    case 'reminders':
      return [
        'Reminders topic capabilities:',
        '- You can discuss existing household rent/utilities reminder timing and the supported utility-bill collection flow.',
        '- You cannot create, schedule, snooze, or manage arbitrary personal reminders.',
        '- You cannot promise future reminder setup. If asked, say that this feature is not supported.'
      ].join('\n')
    case 'feedback':
      return [
        'Feedback topic capabilities:',
        '- You can discuss the anonymous feedback flow and household feedback context.',
        '- You cannot claim a submission was posted unless the system explicitly confirmed it.',
        '- You cannot schedule reminders or create unrelated workflow items.'
      ].join('\n')
    case 'generic':
    default:
      return [
        'General household chat capabilities:',
        '- You can answer household finance and context questions using the provided information.',
        '- You cannot create arbitrary reminders, scheduled tasks, or background jobs.',
        '- Never imply unsupported features exist.'
      ].join('\n')
  }
}

const ASSISTANT_SYSTEM_PROMPT = [
  'You are Kojori, a household finance assistant for one specific household.',
  'Stay within the provided household context and recent conversation context.',
  'Be calm, concise, playful when appropriate, and quiet by default.',
  'Do not act like a form validator or aggressive parser.',
  'Do not invent balances, members, billing periods, or completed actions.',
  'Any authoritative facts provided by the system are true and must be preserved exactly.',
  'If the user asks you to mutate household state, do not claim the action is complete unless the system explicitly says it was confirmed and saved.',
  'For unsupported writes, explain the limitation briefly and suggest the explicit command or confirmation flow.',
  'Prefer concise, practical answers.',
  'Default to one to three short sentences.',
  'For a bare summon such as “bot?”, “pss bot”, or “ты тут?”, acknowledge briefly instead of acting confused.',
  'Do not assume the user is addressing you just because they mention "bot" or use an attention-grabbing word; they may be talking about the bot or to someone else.',
  'For simple greetings or small talk, reply in a single short sentence unless the user asks for more.',
  'If the user is joking or testing you, you may answer playfully in one short sentence.',
  'Do not tack on “how can I help” style follow-up questions after every casual or successful turn.',
  'If the exchange is already playful, keep that tone for the next turn instead of snapping back to generic assistant phrasing.',
  'Treat obviously impossible or fantastical purchases, payments, and travel plans as jokes or hypotheticals unless the user clearly turns them into a real household action.',
  'When the user refers to something said above, earlier, already mentioned, or in the dialog, answer from the provided conversation history if the answer is there.',
  'For dialogue-memory questions, prioritize recent topic thread messages first, then same-day chat history, then per-user memory summary.',
  'Do not ask the user to repeat information that is already present in the provided conversation history.',
  'Treat wishes, plans, tomorrow-talk, approximate future prices, and thinking aloud as plans, not completed purchases or payments.',
  'If the user is only discussing a possible future purchase, respond naturally instead of collecting missing purchase fields.',
  'If the user tells you to stop, back off briefly and do not keep asking follow-up questions.',
  'Do not repeat the same clarification after the user declines, backs off, or says they are only thinking.',
  'Do not restate the full household context unless the user explicitly asks for details.',
  'Do not imply capabilities that are not explicitly provided in the system context.',
  'There is no general feature for creating or scheduling arbitrary personal reminders unless the system explicitly says so.',
  'Avoid bullet lists unless the user asked for a list or several distinct items.',
  'Reply in the user language inferred from the latest user message and locale context.'
].join(' ')

export function createOpenAiChatAssistant(
  apiKey: string | undefined,
  model: string,
  timeoutMs: number
): ConversationalAssistant | undefined {
  if (!apiKey) {
    return undefined
  }

  return {
    async respond(input) {
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
            max_output_tokens: ASSISTANT_MAX_OUTPUT_TOKENS,
            input: [
              {
                role: 'system',
                content: ASSISTANT_SYSTEM_PROMPT
              },
              {
                role: 'system',
                content: [
                  `User locale: ${input.locale}`,
                  `Topic role: ${input.topicRole}`,
                  topicCapabilityNotes(input.topicRole),
                  'Bounded household context:',
                  input.householdContext,
                  input.authoritativeFacts && input.authoritativeFacts.length > 0
                    ? [
                        'Authoritative facts:',
                        ...input.authoritativeFacts.map((fact) => `- ${fact}`)
                      ].join('\n')
                    : null,
                  input.recentThreadMessages && input.recentThreadMessages.length > 0
                    ? [
                        'Recent topic thread messages:',
                        ...input.recentThreadMessages.map(
                          (message) => `${message.speaker} (${message.role}): ${message.text}`
                        )
                      ].join('\n')
                    : null,
                  input.sameDayChatMessages && input.sameDayChatMessages.length > 0
                    ? [
                        'Additional same-day household chat history:',
                        ...input.sameDayChatMessages.map((message) =>
                          message.threadId
                            ? `[thread ${message.threadId}] ${message.speaker} (${message.role}): ${message.text}`
                            : `${message.speaker} (${message.role}): ${message.text}`
                        )
                      ].join('\n')
                    : null,
                  input.recentTurns.length > 0
                    ? [
                        'Recent conversation turns:',
                        ...input.recentTurns.map((turn) => `${turn.role}: ${turn.text}`)
                      ].join('\n')
                    : null,
                  input.memorySummary ? `Conversation summary:\n${input.memorySummary}` : null,
                  input.responseInstructions
                    ? `Response instructions:\n${input.responseInstructions}`
                    : null
                ]
                  .filter(Boolean)
                  .join('\n\n')
              },
              {
                role: 'user',
                content: input.userMessage
              }
            ]
          })
        })

        if (!response.ok) {
          throw new Error(`Assistant request failed with status ${response.status}`)
        }

        const payload = (await response.json()) as OpenAiResponsePayload & {
          usage?: {
            input_tokens?: number
            output_tokens?: number
            total_tokens?: number
          }
        }
        const text = extractOpenAiResponseText(payload)
        if (!text) {
          throw new Error('Assistant response did not contain text')
        }

        return {
          text,
          usage: {
            inputTokens: payload.usage?.input_tokens ?? 0,
            outputTokens: payload.usage?.output_tokens ?? 0,
            totalTokens: payload.usage?.total_tokens ?? 0
          }
        }
      } finally {
        clearTimeout(timeout)
      }
    }
  }
}
