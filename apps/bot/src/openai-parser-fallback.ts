import { extractOpenAiResponseText, parseJsonFromResponseText } from './openai-responses'

import type { PurchaseParserLlmFallback } from '@household/application'

interface OpenAiStructuredResult {
  amountMinor: string
  currency: 'GEL' | 'USD'
  itemDescription: string
  confidence: number
  needsReview: boolean
}

function asBigInt(value: string): bigint | null {
  if (!/^[0-9]+$/.test(value)) {
    return null
  }

  const parsed = BigInt(value)
  return parsed > 0n ? parsed : null
}

function normalizeConfidence(value: number): number {
  const scaled = value >= 0 && value <= 1 ? value * 100 : value
  return Math.max(0, Math.min(100, Math.round(scaled)))
}

export function createOpenAiParserFallback(
  apiKey: string | undefined,
  model: string
): PurchaseParserLlmFallback | undefined {
  if (!apiKey) {
    return undefined
  }

  return async (rawText: string) => {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model,
        reasoning: { effort: 'none', summary: 'auto' },
        input: [
          {
            role: 'system',
            content:
              'Extract a shared household purchase from text. Return only valid JSON with amountMinor, currency, itemDescription, confidence, needsReview.'
          },
          {
            role: 'user',
            content: rawText
          }
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'purchase_parse',
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                amountMinor: {
                  type: 'string'
                },
                currency: {
                  type: 'string',
                  enum: ['GEL', 'USD']
                },
                itemDescription: {
                  type: 'string'
                },
                confidence: {
                  type: 'number',
                  minimum: 0,
                  maximum: 100
                },
                needsReview: {
                  type: 'boolean'
                }
              },
              required: ['amountMinor', 'currency', 'itemDescription', 'confidence', 'needsReview']
            }
          }
        }
      })
    })

    if (!response.ok) {
      return null
    }

    const payload = (await response.json()) as {
      output_text?: string | null
      output?: Array<{
        content?: Array<{
          text?: string | { value?: string | null } | null
        }> | null
      }> | null
    }
    const responseText = extractOpenAiResponseText(payload)
    if (!responseText) {
      return null
    }

    const parsedJson = parseJsonFromResponseText<OpenAiStructuredResult>(responseText)
    if (!parsedJson) {
      return null
    }

    const amountMinor = asBigInt(parsedJson.amountMinor)
    if (!amountMinor) {
      return null
    }

    if (parsedJson.itemDescription.trim().length === 0) {
      return null
    }

    return {
      amountMinor,
      currency: parsedJson.currency,
      itemDescription: parsedJson.itemDescription,
      confidence: normalizeConfidence(parsedJson.confidence),
      parserMode: 'llm',
      needsReview: parsedJson.needsReview
    }
  }
}
