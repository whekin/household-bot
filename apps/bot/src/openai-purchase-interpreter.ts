import { extractOpenAiResponseText, parseJsonFromResponseText } from './openai-responses'

export type PurchaseInterpretationDecision = 'purchase' | 'clarification' | 'not_purchase'
export type PurchaseInterpretationAmountSource = 'explicit' | 'calculated'

export interface PurchaseInterpretation {
  decision: PurchaseInterpretationDecision
  amountMinor: bigint | null
  currency: 'GEL' | 'USD' | null
  itemDescription: string | null
  amountSource?: PurchaseInterpretationAmountSource | null
  calculationExplanation?: string | null
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
    householdContext?: string | null
    assistantTone?: string | null
  }
) => Promise<PurchaseInterpretation | null>

interface OpenAiStructuredResult {
  decision: PurchaseInterpretationDecision
  amountMinor: string | null
  currency: 'GEL' | 'USD' | null
  itemDescription: string | null
  amountSource: PurchaseInterpretationAmountSource | null
  calculationExplanation: string | null
  confidence: number
  clarificationQuestion: string | null
}

const PLANNING_ONLY_PATTERN =
  /\b(?:want to buy|thinking about|thinking of|plan to buy|planning to buy|going to buy|might buy|tomorrow|later)\b|(?:^|[^\p{L}])(?:(?:хочу|хотим|думаю|планирую|планируем|может)\s+(?:купить|взять|заказать)|(?:подумаю|завтра|потом))(?=$|[^\p{L}])/iu
const COMPLETED_PURCHASE_PATTERN =
  /\b(?:bought|purchased|ordered|picked up|grabbed|got|spent|paid)\b|(?:^|[^\p{L}])(?:купил(?:а|и)?|взял(?:а|и)?|заказал(?:а|и)?|потратил(?:а|и)?|заплатил(?:а|и)?|сторговался(?:\s+до)?)(?=$|[^\p{L}])/iu
const META_REFERENCE_PATTERN =
  /\b(?:already said(?: above)?|said above|question above|have context|from the dialog(?:ue)?|based on the dialog(?:ue)?)\b|(?:^|[^\p{L}])(?:я\s+уже\s+сказал(?:\s+выше)?|уже\s+сказал(?:\s+выше)?|вопрос\s+выше|это\s+вопрос|контекст(?:\s+диалога)?|основываясь\s+на\s+диалоге)(?=$|[^\p{L}])/iu
const META_REFERENCE_STRIP_PATTERN = new RegExp(META_REFERENCE_PATTERN.source, 'giu')

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

function normalizeAmountSource(
  value: PurchaseInterpretationAmountSource | null,
  amountMinor: bigint | null
): PurchaseInterpretationAmountSource | null {
  if (amountMinor === null) {
    return null
  }

  return value === 'calculated' ? 'calculated' : 'explicit'
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

function isBareMetaReference(rawText: string): boolean {
  const normalized = rawText.trim()
  if (!META_REFERENCE_PATTERN.test(normalized)) {
    return false
  }

  const stripped = normalized
    .replace(META_REFERENCE_STRIP_PATTERN, ' ')
    .replace(/[\s,.:;!?()[\]{}"'`-]+/gu, ' ')
    .trim()

  return stripped.length === 0
}

function shouldReturnNotPurchase(rawText: string): boolean {
  const normalized = rawText.trim()
  if (normalized.length === 0) {
    return true
  }

  if (isBareMetaReference(normalized)) {
    return true
  }

  return PLANNING_ONLY_PATTERN.test(normalized) && !COMPLETED_PURCHASE_PATTERN.test(normalized)
}

export function createOpenAiPurchaseInterpreter(
  apiKey: string | undefined,
  model: string
): PurchaseMessageInterpreter | undefined {
  if (!apiKey) {
    return undefined
  }

  return async (rawText, options) => {
    if (shouldReturnNotPurchase(rawText)) {
      return {
        decision: 'not_purchase',
        amountMinor: null,
        currency: null,
        itemDescription: null,
        amountSource: null,
        calculationExplanation: null,
        confidence: 94,
        parserMode: 'llm',
        clarificationQuestion: null
      }
    }

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
              'amountMinor must be expressed in minor currency units. Example: 350 GEL -> 35000, 3.50 GEL -> 350, 45 lari -> 4500.',
              'If the user gives quantity and per-item price, compute the total spend and return that total in amountMinor.',
              'Set amountSource to "explicit" when the user directly states the total amount, or "calculated" when you compute it from quantity x price or similar arithmetic.',
              'When amountSource is "calculated", also return a short calculationExplanation in the user message language, such as "5 × 6 lari = 30 lari".',
              'Ignore item quantities like rolls, kilograms, or layers unless they are clearly the money amount.',
              'Treat colloquial completed-buy phrasing like "взял", "сходил и взял", or "сторговался до X" as a completed purchase when the message reports a real buy fact.',
              'Plans, wishes, future intent, tomorrow-talk, and approximate future prices are not purchases. Return not_purchase for those.',
              'Meta replies like "I already said above", "the question is above", or "do you have context" are not purchase details. Return not_purchase unless the latest message clearly supplies the missing purchase fact.',
              'If recent messages from the same sender are provided, treat them as clarification context for the latest message.',
              'If the latest message is a complete standalone purchase on its own, ignore the earlier clarification context.',
              'If the latest message answers a previous clarification, combine it with the earlier messages to resolve the purchase.',
              'Use clarification when the amount, currency, item, or overall intent is missing or uncertain.',
              'Return a short, natural clarification question in the same language as the user message when clarification is needed.',
              'The clarification should sound like a conversational household bot, not a form validator.',
              options.assistantTone
                ? `Use this tone lightly when asking clarification questions: ${options.assistantTone}.`
                : null,
              options.householdContext
                ? `Household flavor context: ${options.householdContext}`
                : null,
              'Return only JSON that matches the schema.'
            ]
              .filter(Boolean)
              .join(' ')
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
                amountSource: {
                  anyOf: [
                    {
                      type: 'string',
                      enum: ['explicit', 'calculated']
                    },
                    { type: 'null' }
                  ]
                },
                calculationExplanation: {
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
                'amountSource',
                'calculationExplanation',
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
    const amountSource = normalizeAmountSource(parsedJson.amountSource, amountMinor)
    const calculationExplanation = normalizeOptionalText(parsedJson.calculationExplanation)
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
      amountSource,
      calculationExplanation: amountSource === 'calculated' ? calculationExplanation : null,
      confidence: normalizeConfidence(parsedJson.confidence),
      parserMode: 'llm',
      clarificationQuestion: decision === 'clarification' ? clarificationQuestion : null
    }
  }
}
