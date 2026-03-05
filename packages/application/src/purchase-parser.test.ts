import { describe, expect, test } from 'bun:test'

import { parsePurchaseMessage } from './purchase-parser'

describe('parsePurchaseMessage', () => {
  test('parses explicit currency with rules', async () => {
    const result = await parsePurchaseMessage({
      rawText: 'Купил туалетную бумагу 30 gel'
    })

    expect(result).not.toBeNull()
    expect(result?.amountMinor).toBe(3000n)
    expect(result?.currency).toBe('GEL')
    expect(result?.parserMode).toBe('rules')
    expect(result?.needsReview).toBe(false)
  })

  test('defaults to GEL when currency is omitted and marks review', async () => {
    const result = await parsePurchaseMessage({
      rawText: 'Bought soap 12.5'
    })

    expect(result).not.toBeNull()
    expect(result?.amountMinor).toBe(1250n)
    expect(result?.currency).toBe('GEL')
    expect(result?.needsReview).toBe(true)
  })

  test('uses llm fallback for ambiguous message with multiple amounts', async () => {
    const result = await parsePurchaseMessage(
      {
        rawText: 'Купил пасту 10 и мыло 5'
      },
      {
        llmFallback: async () => ({
          amountMinor: 1500n,
          currency: 'GEL',
          itemDescription: 'паста и мыло',
          confidence: 67,
          parserMode: 'llm',
          needsReview: true
        })
      }
    )

    expect(result).not.toBeNull()
    expect(result?.parserMode).toBe('llm')
    expect(result?.amountMinor).toBe(1500n)
  })

  test('returns null when both rules and llm fail', async () => {
    const result = await parsePurchaseMessage(
      {
        rawText: 'без суммы вообще'
      },
      {
        llmFallback: async () => null
      }
    )

    expect(result).toBeNull()
  })
})
