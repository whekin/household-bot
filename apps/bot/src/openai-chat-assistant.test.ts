import { describe, expect, test } from 'bun:test'

import { createOpenAiChatAssistant } from './openai-chat-assistant'

interface CapturedAssistantRequest {
  model: string
  max_output_tokens: number
  input: Array<{ role: string; content: string }>
}

function successfulResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'content-type': 'application/json'
    }
  })
}

describe('createOpenAiChatAssistant', () => {
  test('caps output tokens and asks for concise replies', async () => {
    const assistant = createOpenAiChatAssistant('test-key', 'gpt-5-mini', 20_000)
    expect(assistant).toBeDefined()

    const originalFetch = globalThis.fetch
    let capturedBody: CapturedAssistantRequest | null = null

    globalThis.fetch = (async (_input: Request | string | URL, init?: RequestInit) => {
      capturedBody = init?.body ? (JSON.parse(String(init.body)) as CapturedAssistantRequest) : null

      return successfulResponse({
        output_text: 'Hi.',
        usage: {
          input_tokens: 100,
          output_tokens: 1,
          total_tokens: 101
        }
      })
    }) as unknown as typeof fetch

    try {
      const reply = await assistant!.respond({
        locale: 'en',
        topicRole: 'reminders',
        householdContext: 'Household: Kojori House',
        memorySummary: null,
        recentTurns: [],
        userMessage: 'Hello'
      })

      expect(reply.text).toBe('Hi.')
      expect(capturedBody).not.toBeNull()
      expect(capturedBody!.max_output_tokens).toBe(220)
      expect(capturedBody!.model).toBe('gpt-5-mini')
      expect(capturedBody!.input[0]?.role).toBe('system')
      expect(capturedBody!.input[0]?.content).toContain('Default to one to three short sentences.')
      expect(capturedBody!.input[0]?.content).toContain(
        'Do not ask the user to repeat information that is already present in the provided conversation history.'
      )
      expect(capturedBody!.input[0]?.content).toContain(
        'Treat wishes, plans, tomorrow-talk, approximate future prices, and thinking aloud as plans, not completed purchases or payments.'
      )
      expect(capturedBody!.input[0]?.content).toContain(
        'There is no general feature for creating or scheduling arbitrary personal reminders'
      )
      expect(capturedBody!.input[1]?.role).toBe('system')
      expect(capturedBody!.input[1]?.content).toContain('Topic role: reminders')
      expect(capturedBody!.input[1]?.content).toContain(
        'Members can ask the bot to schedule a future notification in this topic.'
      )
      expect(capturedBody!.input[1]?.content).toContain(
        'Never tell the user to set a reminder on their own device in this topic.'
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
