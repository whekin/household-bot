import { extractOpenAiResponseText, parseJsonFromResponseText } from './openai-responses'

export type PurchaseInterpretationDecision = 'purchase' | 'clarification' | 'not_purchase'

export interface PurchaseInterpretation {
  decision: PurchaseInterpretationDecision
  amountMinor: bigint | null
  currency: 'GEL' | 'USD' | null
  itemDescription: string | null
  confidence: number
  parserMode: 'llm'
  clarificationQuestion: string | null
}

export interface PurchaseClarificationContext {
  recentMessages: readonly string[]
}

export type PurchaseMessageInterpreter = (
  rawText: string,
  options: {
    defaultCurrency: 'GEL' | 'USD'
    clarificationContext?: PurchaseClarificationContext
  }
) => Promise<PurchaseInterpretation | null>

interface OpenAiStructuredResult {
  decision: PurchaseInterpretationDecision
  amountMinor: string | null
  currency: 'GEL' | 'USD' | null
  itemDescription: string | null
  confidence: number
  clarificationQuestion: string | null
}

function asOptionalBigInt(value: string | null): bigint | null {
  if (value === null || !/^[0-9]+$/.test(value)) {
    return null
  }

  const parsed = BigInt(value)
  return parsed > 0n ? parsed : null
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : null
}

function normalizeCurrency(value: string | null): 'GEL' | 'USD' | null {
  return value === 'GEL' || value === 'USD' ? value : null
}

function normalizeConfidence(value: number): number {
  const scaled = value >= 0 && value <= 1 ? value * 100 : value
  return Math.max(0, Math.min(100, Math.round(scaled)))
}

function resolveMissingCurrency(input: {
  decision: PurchaseInterpretationDecision
  amountMinor: bigint | null
  currency: 'GEL' | 'USD' | null
  itemDescription: string | null
  defaultCurrency: 'GEL' | 'USD'
}): 'GEL' | 'USD' | null {
  if (input.currency !== null) {
    return input.currency
  }

  if (
    input.decision === 'not_purchase' ||
    input.amountMinor === null ||
    input.itemDescription === null
  ) {
    return null
  }

  return input.defaultCurrency
}

export function buildPurchaseInterpretationInput(
  rawText: string,
  clarificationContext?: PurchaseClarificationContext
): string {
  if (!clarificationContext || clarificationContext.recentMessages.length === 0) {
    return rawText
  }

  const history = clarificationContext.recentMessages
    .map((message, index) => `${index + 1}. ${message}`)
    .join('\n')

  return [
    'Recent relevant messages from the same sender in this purchase topic:',
    history,
    '',
    'Latest message to interpret:',
    rawText
  ].join('\n')
}

export function createOpenAiPurchaseInterpreter(
  apiKey: string | undefined,
  model: string
): PurchaseMessageInterpreter | undefined {
  if (!apiKey) {
    return undefined
  }

  return async (rawText, options) => {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: 'system',
            content: [
              'You classify a purchase candidate from a household shared-purchases topic.',
              'Decide whether the latest message is a real shared purchase, needs clarification, or is not a shared purchase at all.',
              `The household default currency is ${options.defaultCurrency}. If a real purchase clearly omits currency, use ${options.defaultCurrency}.`,
              'If recent messages from the same sender are provided, treat them as clarification context for the latest message.',
              'If the latest message is a complete standalone purchase on its own, ignore the earlier clarification context.',
              'If the latest message answers a previous clarification, combine it with the earlier messages to resolve the purchase.',
              'Use clarification when the amount, currency, item, or overall intent is missing or uncertain.',
              'Return a clarification question in the same language as the user message when clarification is needed.',
              'Return only JSON that matches the schema.'
            ].join(' ')
          },
          {
            role: 'user',
            content: buildPurchaseInterpretationInput(rawText, options.clarificationContext)
          }
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'purchase_interpretation',
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                decision: {
                  type: 'string',
                  enum: ['purchase', 'clarification', 'not_purchase']
                },
                amountMinor: {
                  anyOf: [{ type: 'string' }, { type: 'null' }]
                },
                currency: {
                  anyOf: [
                    {
                      type: 'string',
                      enum: ['GEL', 'USD']
                    },
                    { type: 'null' }
                  ]
                },
                itemDescription: {
                  anyOf: [{ type: 'string' }, { type: 'null' }]
                },
                confidence: {
                  type: 'number',
                  minimum: 0,
                  maximum: 100
                },
                clarificationQuestion: {
                  anyOf: [{ type: 'string' }, { type: 'null' }]
                }
              },
              required: [
                'decision',
                'amountMinor',
                'currency',
                'itemDescription',
                'confidence',
                'clarificationQuestion'
              ]
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

    if (
      parsedJson.decision !== 'purchase' &&
      parsedJson.decision !== 'clarification' &&
      parsedJson.decision !== 'not_purchase'
    ) {
      return null
    }

    const amountMinor = asOptionalBigInt(parsedJson.amountMinor)
    const itemDescription = normalizeOptionalText(parsedJson.itemDescription)
    const currency = resolveMissingCurrency({
      decision: parsedJson.decision,
      amountMinor,
      currency: normalizeCurrency(parsedJson.currency),
      itemDescription,
      defaultCurrency: options.defaultCurrency
    })
    const decision =
      parsedJson.decision === 'clarification' &&
      amountMinor !== null &&
      currency !== null &&
      itemDescription
        ? 'purchase'
        : parsedJson.decision
    const clarificationQuestion = normalizeOptionalText(parsedJson.clarificationQuestion)
    if (decision === 'clarification' && !clarificationQuestion) {
      return null
    }

    return {
      decision,
      amountMinor,
      currency,
      itemDescription,
      confidence: normalizeConfidence(parsedJson.confidence),
      parserMode: 'llm',
      clarificationQuestion: decision === 'clarification' ? clarificationQuestion : null
    }
  }
}
