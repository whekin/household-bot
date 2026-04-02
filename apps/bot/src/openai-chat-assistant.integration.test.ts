import { describe, expect, test } from 'bun:test'

import { createOpenAiChatAssistant } from './openai-chat-assistant'

const RUN = !!process.env.OPENAI_API_KEY && !!process.env.RUN_INTEGRATION_TESTS

describe('openai-chat-assistant integration', () => {
  test.skipIf(!RUN)('responds successfully with full DM assistant prompt shape', async () => {
    const assistant = createOpenAiChatAssistant(process.env.OPENAI_API_KEY, 'gpt-5.4-mini', 20_000)
    expect(assistant).toBeDefined()

    const reply = await assistant!.respond({
      locale: 'ru',
      topicRole: 'generic',
      householdContext: 'Household: Test\nMembers: Alice (active), Bob (active)',
      memorySummary: null,
      recentTurns: [],
      userMessage: 'Привет!'
    })

    expect(reply.text.length).toBeGreaterThan(0)
    expect(reply.usage.inputTokens).toBeGreaterThan(0)
    expect(reply.usage.outputTokens).toBeGreaterThan(0)
  })

  test.skipIf(!RUN)('handles conversation history in the prompt', async () => {
    const assistant = createOpenAiChatAssistant(process.env.OPENAI_API_KEY, 'gpt-5.4-mini', 20_000)
    expect(assistant).toBeDefined()

    const reply = await assistant!.respond({
      locale: 'en',
      topicRole: 'generic',
      householdContext: 'Household: Test\nMembers: Alice (active), Bob (active)',
      memorySummary: null,
      recentTurns: [
        { role: 'user', text: 'What is 2+2?' },
        { role: 'assistant', text: '4.' }
      ],
      userMessage: 'And 3+3?'
    })

    expect(reply.text.length).toBeGreaterThan(0)
  })

  test.skipIf(!RUN)('handles all optional fields populated', async () => {
    const assistant = createOpenAiChatAssistant(process.env.OPENAI_API_KEY, 'gpt-5.4-mini', 20_000)
    expect(assistant).toBeDefined()

    const reply = await assistant!.respond({
      locale: 'ru',
      topicRole: 'purchase',
      householdContext: 'Household: Test\nMembers: Alice (active), Bob (active)',
      memorySummary: 'User previously asked about groceries.',
      authoritativeFacts: ['Alice owes Bob 50 GEL'],
      recentTurns: [{ role: 'user', text: 'Привет' }],
      recentThreadMessages: [
        { role: 'user', speaker: 'Alice', text: 'Купила хлеб за 3 лари', threadId: '1' }
      ],
      sameDayChatMessages: [{ role: 'user', speaker: 'Bob', text: 'Окей', threadId: null }],
      responseInstructions: 'Keep it very short.',
      userMessage: 'Всё понятно?'
    })

    expect(reply.text.length).toBeGreaterThan(0)
  })
})
