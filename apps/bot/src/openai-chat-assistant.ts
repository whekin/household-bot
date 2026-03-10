import { extractOpenAiResponseText, type OpenAiResponsePayload } from './openai-responses'

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
    householdContext: string
    memorySummary: string | null
    recentTurns: readonly {
      role: 'user' | 'assistant'
      text: string
    }[]
    userMessage: string
  }): Promise<AssistantReply>
}

const ASSISTANT_SYSTEM_PROMPT = [
  'You are Kojori, a household finance assistant for one specific household.',
  'Stay within the provided household context and recent conversation context.',
  'Do not invent balances, members, billing periods, or completed actions.',
  'If the user asks you to mutate household state, do not claim the action is complete unless the system explicitly says it was confirmed and saved.',
  'For unsupported writes, explain the limitation briefly and suggest the explicit command or confirmation flow.',
  'Prefer concise, practical answers.',
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
            input: [
              {
                role: 'system',
                content: ASSISTANT_SYSTEM_PROMPT
              },
              {
                role: 'system',
                content: [
                  `User locale: ${input.locale}`,
                  'Bounded household context:',
                  input.householdContext,
                  input.memorySummary ? `Conversation summary:\n${input.memorySummary}` : null,
                  input.recentTurns.length > 0
                    ? [
                        'Recent conversation turns:',
                        ...input.recentTurns.map((turn) => `${turn.role}: ${turn.text}`)
                      ].join('\n')
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
