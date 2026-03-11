import { describe, expect, test } from 'bun:test'

import {
  buildPurchaseInterpretationInput,
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
  test('includes clarification context when provided', () => {
    expect(
      buildPurchaseInterpretationInput('лари', {
        recentMessages: ['Купил сосисоны, отдал 45 кровных']
      })
    ).toBe(
      [
        'Recent relevant messages from the same sender in this purchase topic:',
        '1. Купил сосисоны, отдал 45 кровных',
        '',
        'Latest message to interpret:',
        'лари'
      ].join('\n')
    )
  })

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

  test('scales 0-1 confidence values into 0-100', async () => {
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
                  amountMinor: '5000',
                  currency: 'GEL',
                  itemDescription: 'шампунь',
                  confidence: 0.92,
                  clarificationQuestion: null
                })
              }
            ]
          }
        ]
      })) as unknown as typeof fetch

    try {
      const result = await interpreter!('Купил шампунь на 50 лари', {
        defaultCurrency: 'GEL'
      })

      expect(result).toEqual<PurchaseInterpretation>({
        decision: 'purchase',
        amountMinor: 5000n,
        currency: 'GEL',
        itemDescription: 'шампунь',
        confidence: 92,
        parserMode: 'llm',
        clarificationQuestion: null
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('defaults omitted purchase currency to the household currency', async () => {
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
                  decision: 'clarification',
                  amountMinor: '4500',
                  currency: null,
                  itemDescription: 'сосисоны',
                  confidence: 85,
                  clarificationQuestion: 'В какой валюте 45?'
                })
              }
            ]
          }
        ]
      })) as unknown as typeof fetch

    try {
      const result = await interpreter!('Купил сосисоны, отдал 45 кровных', {
        defaultCurrency: 'GEL'
      })

      expect(result).toEqual<PurchaseInterpretation>({
        decision: 'purchase',
        amountMinor: 4500n,
        currency: 'GEL',
        itemDescription: 'сосисоны',
        confidence: 85,
        parserMode: 'llm',
        clarificationQuestion: null
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('corrects mis-scaled amountMinor when the source text contains a clear money amount', async () => {
    const interpreter = createOpenAiPurchaseInterpreter('test-key', 'gpt-4o-mini')
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
                  amountMinor: '350',
                  currency: 'GEL',
                  itemDescription: 'обои, 100 рулонов',
                  confidence: 86,
                  clarificationQuestion: null
                })
              }
            ]
          }
        ]
      })) as unknown as typeof fetch

    try {
      const result = await interpreter!(
        'Купил обои, 100 рулонов, чтобы клеить в 3 слоя. Выложил 350 кровных',
        {
          defaultCurrency: 'GEL'
        }
      )

      expect(result).toEqual<PurchaseInterpretation>({
        decision: 'purchase',
        amountMinor: 35000n,
        currency: 'GEL',
        itemDescription: 'обои, 100 рулонов',
        confidence: 86,
        parserMode: 'llm',
        clarificationQuestion: null
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('corrects mis-scaled amountMinor for simple clarification replies', async () => {
    const interpreter = createOpenAiPurchaseInterpreter('test-key', 'gpt-4o-mini')
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
                  amountMinor: '350',
                  currency: 'GEL',
                  itemDescription: 'Рулоны обоев',
                  confidence: 89,
                  clarificationQuestion: null
                })
              }
            ]
          }
        ]
      })) as unknown as typeof fetch

    try {
      const result = await interpreter!('350', {
        defaultCurrency: 'GEL',
        clarificationContext: {
          recentMessages: ['Купил обои, 100 рулонов, чтобы клеить в 3 слоя. Выложил 350 кровных']
        }
      })

      expect(result).toEqual<PurchaseInterpretation>({
        decision: 'purchase',
        amountMinor: 35000n,
        currency: 'GEL',
        itemDescription: 'Рулоны обоев',
        confidence: 89,
        parserMode: 'llm',
        clarificationQuestion: null
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
