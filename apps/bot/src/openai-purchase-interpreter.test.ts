import { describe, expect, test } from 'bun:test'

import {
  createOpenAiPurchaseInterpreter,
  type PurchaseInterpretation
} from './openai-purchase-interpreter'

function successfulResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'content-type': 'application/json'
    }
  })
}

describe('createOpenAiPurchaseInterpreter', () => {
  test('parses nested responses api content output', async () => {
    const interpreter = createOpenAiPurchaseInterpreter('test-key', 'gpt-5-mini')
    expect(interpreter).toBeDefined()

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      successfulResponse({
        output: [
          {
            content: [
              {
                text: JSON.stringify({
                  decision: 'purchase',
                  amountMinor: '100000',
                  currency: 'GEL',
                  itemDescription: 'армянская золотая швабра',
                  confidence: 93,
                  clarificationQuestion: null
                })
              }
            ]
          }
        ]
      })) as unknown as typeof fetch

    try {
      const result = await interpreter!('Купил швабру, Армянскую, золотую. 1000 лари', {
        defaultCurrency: 'GEL'
      })

      expect(result).toEqual<PurchaseInterpretation>({
        decision: 'purchase',
        amountMinor: 100000n,
        currency: 'GEL',
        itemDescription: 'армянская золотая швабра',
        confidence: 93,
        parserMode: 'llm',
        clarificationQuestion: null
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('parses fenced json responses', async () => {
    const interpreter = createOpenAiPurchaseInterpreter('test-key', 'gpt-5-mini')
    expect(interpreter).toBeDefined()

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      successfulResponse({
        output: [
          {
            content: [
              {
                text: '```json\n{"decision":"purchase","amountMinor":"1000","currency":"GEL","itemDescription":"сухари","confidence":88,"clarificationQuestion":null}\n```'
              }
            ]
          }
        ]
      })) as unknown as typeof fetch

    try {
      const result = await interpreter!('Купил сухари на стол за 10 лари', {
        defaultCurrency: 'GEL'
      })

      expect(result).toEqual<PurchaseInterpretation>({
        decision: 'purchase',
        amountMinor: 1000n,
        currency: 'GEL',
        itemDescription: 'сухари',
        confidence: 88,
        parserMode: 'llm',
        clarificationQuestion: null
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
