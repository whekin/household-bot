import { describe, expect, test } from 'bun:test'

import { createOpenAiTopicMessageRouter } from './topic-message-router'

function successfulResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'content-type': 'application/json'
    }
  })
}

describe('createOpenAiTopicMessageRouter', () => {
  test('overrides purchase workflow routes for planning chatter', async () => {
    const router = createOpenAiTopicMessageRouter('test-key', 'gpt-5-mini', 20_000)
    expect(router).toBeDefined()

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      successfulResponse({
        output_text: JSON.stringify({
          route: 'purchase_candidate',
          replyText: null,
          helperKind: 'purchase',
          shouldStartTyping: true,
          shouldClearWorkflow: false,
          confidence: 92,
          reason: 'llm_purchase_guess'
        })
      })) as unknown as typeof fetch

    try {
      const route = await router!({
        locale: 'ru',
        topicRole: 'purchase',
        messageText: 'Я хочу рыбу. Завтра подумаю, примерно 20 лари.',
        isExplicitMention: true,
        isReplyToBot: false,
        activeWorkflow: null
      })

      expect(route).toMatchObject({
        route: 'topic_helper',
        helperKind: 'assistant',
        shouldStartTyping: true,
        shouldClearWorkflow: false,
        reason: 'planning_guard'
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('overrides purchase followups for meta references to prior context', async () => {
    const router = createOpenAiTopicMessageRouter('test-key', 'gpt-5-mini', 20_000)
    expect(router).toBeDefined()

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      successfulResponse({
        output_text: JSON.stringify({
          route: 'purchase_followup',
          replyText: null,
          helperKind: 'purchase',
          shouldStartTyping: false,
          shouldClearWorkflow: false,
          confidence: 89,
          reason: 'llm_followup_guess'
        })
      })) as unknown as typeof fetch

    try {
      const route = await router!({
        locale: 'ru',
        topicRole: 'purchase',
        messageText: 'Я уже сказал выше',
        isExplicitMention: false,
        isReplyToBot: true,
        activeWorkflow: 'purchase_clarification'
      })

      expect(route).toMatchObject({
        route: 'topic_helper',
        helperKind: 'assistant',
        shouldStartTyping: true,
        shouldClearWorkflow: true,
        reason: 'context_reference'
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('keeps payment followups when a context reference also includes payment details', async () => {
    const router = createOpenAiTopicMessageRouter('test-key', 'gpt-5-mini', 20_000)
    expect(router).toBeDefined()

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      successfulResponse({
        output_text: JSON.stringify({
          route: 'payment_followup',
          replyText: null,
          helperKind: 'payment',
          shouldStartTyping: false,
          shouldClearWorkflow: false,
          confidence: 90,
          reason: 'llm_payment_followup'
        })
      })) as unknown as typeof fetch

    try {
      const route = await router!({
        locale: 'ru',
        topicRole: 'payments',
        messageText: 'Я уже сказал выше, оплатил 100 лари',
        isExplicitMention: false,
        isReplyToBot: true,
        activeWorkflow: 'payment_clarification'
      })

      expect(route).toMatchObject({
        route: 'payment_followup',
        helperKind: 'payment',
        shouldStartTyping: false,
        shouldClearWorkflow: false,
        reason: 'llm_payment_followup'
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('keeps purchase followups for approximate clarification answers', async () => {
    const router = createOpenAiTopicMessageRouter('test-key', 'gpt-5-mini', 20_000)
    expect(router).toBeDefined()

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      successfulResponse({
        output_text: JSON.stringify({
          route: 'purchase_followup',
          replyText: null,
          helperKind: 'purchase',
          shouldStartTyping: true,
          shouldClearWorkflow: false,
          confidence: 86,
          reason: 'llm_purchase_followup'
        })
      })) as unknown as typeof fetch

    try {
      const route = await router!({
        locale: 'ru',
        topicRole: 'purchase',
        messageText: 'примерно 20 лари',
        isExplicitMention: false,
        isReplyToBot: true,
        activeWorkflow: 'purchase_clarification'
      })

      expect(route).toMatchObject({
        route: 'purchase_followup',
        helperKind: 'purchase',
        shouldStartTyping: true,
        shouldClearWorkflow: false,
        reason: 'llm_purchase_followup'
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
