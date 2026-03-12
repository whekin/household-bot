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

  test('delegates planning chatter to the llm', async () => {
    const interpreter = createOpenAiPurchaseInterpreter('test-key', 'gpt-5-mini')
    expect(interpreter).toBeDefined()

    const originalFetch = globalThis.fetch
    let fetchCalls = 0
    globalThis.fetch = (async () => {
      fetchCalls += 1
      return successfulResponse({
        output: [
          {
            content: [
              {
                text: JSON.stringify({
                  decision: 'not_purchase',
                  amountMinor: null,
                  currency: null,
                  itemDescription: null,
                  amountSource: null,
                  calculationExplanation: null,
                  participantMemberIds: null,
                  confidence: 94,
                  clarificationQuestion: null
                })
              }
            ]
          }
        ]
      })
    }) as unknown as typeof fetch

    try {
      const result = await interpreter!('Хочу рыбу. Завтра подумаю, примерно 20 лари.', {
        defaultCurrency: 'GEL'
      })

      expect(result).toEqual<PurchaseInterpretation>({
        decision: 'not_purchase',
        amountMinor: null,
        currency: null,
        itemDescription: null,
        amountSource: null,
        calculationExplanation: null,
        confidence: 94,
        parserMode: 'llm',
        clarificationQuestion: null
      })
      expect(fetchCalls).toBe(1)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('delegates bare meta references to the llm', async () => {
    const interpreter = createOpenAiPurchaseInterpreter('test-key', 'gpt-5-mini')
    expect(interpreter).toBeDefined()

    const originalFetch = globalThis.fetch
    let fetchCalls = 0
    globalThis.fetch = (async () => {
      fetchCalls += 1
      return successfulResponse({
        output: [
          {
            content: [
              {
                text: JSON.stringify({
                  decision: 'not_purchase',
                  amountMinor: null,
                  currency: null,
                  itemDescription: null,
                  amountSource: null,
                  calculationExplanation: null,
                  participantMemberIds: null,
                  confidence: 94,
                  clarificationQuestion: null
                })
              }
            ]
          }
        ]
      })
    }) as unknown as typeof fetch

    try {
      const result = await interpreter!('Я уже сказал выше', {
        defaultCurrency: 'GEL'
      })

      expect(result).toEqual<PurchaseInterpretation>({
        decision: 'not_purchase',
        amountMinor: null,
        currency: null,
        itemDescription: null,
        amountSource: null,
        calculationExplanation: null,
        confidence: 94,
        parserMode: 'llm',
        clarificationQuestion: null
      })
      expect(fetchCalls).toBe(1)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('does not short-circuit meta references that also include purchase details', async () => {
    const interpreter = createOpenAiPurchaseInterpreter('test-key', 'gpt-5-mini')
    expect(interpreter).toBeDefined()

    const originalFetch = globalThis.fetch
    let fetchCalls = 0
    globalThis.fetch = (async () => {
      fetchCalls += 1
      return successfulResponse({
        output: [
          {
            content: [
              {
                text: JSON.stringify({
                  decision: 'purchase',
                  amountMinor: '3200',
                  currency: 'GEL',
                  itemDescription: 'молоко',
                  confidence: 91,
                  clarificationQuestion: null
                })
              }
            ]
          }
        ]
      })
    }) as unknown as typeof fetch

    try {
      const result = await interpreter!('Я уже сказал выше, 32 лари за молоко', {
        defaultCurrency: 'GEL'
      })

      expect(fetchCalls).toBe(1)
      expect(result).toEqual<PurchaseInterpretation>({
        decision: 'purchase',
        amountMinor: 3200n,
        currency: 'GEL',
        itemDescription: 'молоко',
        amountSource: 'explicit',
        calculationExplanation: null,
        confidence: 91,
        parserMode: 'llm',
        clarificationQuestion: null
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('does not short-circuit approximate clarification answers', async () => {
    const interpreter = createOpenAiPurchaseInterpreter('test-key', 'gpt-5-mini')
    expect(interpreter).toBeDefined()

    const originalFetch = globalThis.fetch
    let fetchCalls = 0
    globalThis.fetch = (async () => {
      fetchCalls += 1
      return successfulResponse({
        output: [
          {
            content: [
              {
                text: JSON.stringify({
                  decision: 'purchase',
                  amountMinor: '2000',
                  currency: 'GEL',
                  itemDescription: 'молоко',
                  confidence: 87,
                  clarificationQuestion: null
                })
              }
            ]
          }
        ]
      })
    }) as unknown as typeof fetch

    try {
      const result = await interpreter!('примерно 20 лари', {
        defaultCurrency: 'GEL',
        clarificationContext: {
          recentMessages: ['Купил молоко']
        }
      })

      expect(fetchCalls).toBe(1)
      expect(result).toEqual<PurchaseInterpretation>({
        decision: 'purchase',
        amountMinor: 2000n,
        currency: 'GEL',
        itemDescription: 'молоко',
        amountSource: 'explicit',
        calculationExplanation: null,
        confidence: 87,
        parserMode: 'llm',
        clarificationQuestion: null
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('parses explicit participant member ids from the household roster', async () => {
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
                  amountMinor: '2000',
                  currency: 'GEL',
                  itemDescription: 'мороженое',
                  amountSource: 'explicit',
                  calculationExplanation: null,
                  participantMemberIds: ['member-stas', 'member-alice', 'unknown-member'],
                  confidence: 88,
                  clarificationQuestion: null
                })
              }
            ]
          }
        ]
      })) as unknown as typeof fetch

    try {
      const result = await interpreter!('Да, еще купил мороженного себе и Алисе на 20 лари', {
        defaultCurrency: 'GEL',
        senderMemberId: 'member-stas',
        householdMembers: [
          {
            memberId: 'member-stas',
            displayName: 'Stas',
            status: 'active'
          },
          {
            memberId: 'member-alice',
            displayName: 'Alice',
            status: 'away'
          },
          {
            memberId: 'member-dima',
            displayName: 'Dima',
            status: 'active'
          }
        ]
      })

      expect(result).toEqual<PurchaseInterpretation>({
        decision: 'purchase',
        amountMinor: 2000n,
        currency: 'GEL',
        itemDescription: 'мороженое',
        amountSource: 'explicit',
        calculationExplanation: null,
        participantMemberIds: ['member-stas', 'member-alice'],
        confidence: 88,
        parserMode: 'llm',
        clarificationQuestion: null
      })
    } finally {
      globalThis.fetch = originalFetch
    }
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
        amountSource: 'explicit',
        calculationExplanation: null,
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
        amountSource: 'explicit',
        calculationExplanation: null,
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
        amountSource: 'explicit',
        calculationExplanation: null,
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
        amountSource: 'explicit',
        calculationExplanation: null,
        confidence: 85,
        parserMode: 'llm',
        clarificationQuestion: null
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('keeps the llm provided amountMinor without local correction', async () => {
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
        amountMinor: 350n,
        currency: 'GEL',
        itemDescription: 'обои, 100 рулонов',
        amountSource: 'explicit',
        calculationExplanation: null,
        confidence: 86,
        parserMode: 'llm',
        clarificationQuestion: null
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('keeps llm provided amountMinor for clarification follow-ups without local correction', async () => {
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
        amountMinor: 350n,
        currency: 'GEL',
        itemDescription: 'Рулоны обоев',
        amountSource: 'explicit',
        calculationExplanation: null,
        confidence: 89,
        parserMode: 'llm',
        clarificationQuestion: null
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('preserves llm computed totals for quantity times unit-price purchases', async () => {
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
                  amountMinor: '3000',
                  currency: 'GEL',
                  itemDescription: 'бутылки воды',
                  amountSource: 'calculated',
                  calculationExplanation: '5 × 6 лари = 30 лари',
                  confidence: 94,
                  clarificationQuestion: null
                })
              }
            ]
          }
        ]
      })) as unknown as typeof fetch

    try {
      const result = await interpreter!('Купил 5 бутылок воды, 6 лари за бутылку', {
        defaultCurrency: 'GEL'
      })

      expect(result).toEqual<PurchaseInterpretation>({
        decision: 'purchase',
        amountMinor: 3000n,
        currency: 'GEL',
        itemDescription: 'бутылки воды',
        amountSource: 'calculated',
        calculationExplanation: '5 × 6 лари = 30 лари',
        confidence: 94,
        parserMode: 'llm',
        clarificationQuestion: null
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('tells the llm to total per-item pricing and accept colloquial completed purchase phrasing', async () => {
    const interpreter = createOpenAiPurchaseInterpreter('test-key', 'gpt-5-mini')
    expect(interpreter).toBeDefined()

    const originalFetch = globalThis.fetch
    let requestBody: unknown = null
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      requestBody = init?.body ? JSON.parse(String(init.body)) : null

      return successfulResponse({
        output: [
          {
            content: [
              {
                text: JSON.stringify({
                  decision: 'purchase',
                  amountMinor: '3000',
                  currency: 'GEL',
                  itemDescription: 'бутылки воды',
                  confidence: 94,
                  clarificationQuestion: null
                })
              }
            ]
          }
        ]
      })
    }) as unknown as typeof fetch

    try {
      await interpreter!('Купил 5 бутылок воды, 6 лари за бутылку', {
        defaultCurrency: 'GEL'
      })

      const systemMessage =
        (
          (requestBody as { input?: Array<{ role?: string; content?: string }> | null })?.input ??
          []
        ).find((entry) => entry.role === 'system')?.content ?? ''

      expect(systemMessage).toContain(
        'If the user gives quantity and per-item price, compute the total spend and return that total in amountMinor.'
      )
      expect(systemMessage).toContain(
        'Treat colloquial completed-buy phrasing like "взял", "сходил и взял", or "сторговался до X" as a completed purchase when the message reports a real buy fact.'
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
