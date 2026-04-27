import { extractOpenAiResponseText, parseJsonFromResponseText } from './openai-responses'

export type PurchaseInterpretationDecision = 'purchase' | 'clarification' | 'not_purchase'
export type PurchaseInterpretationAmountSource = 'explicit' | 'calculated'

export interface PurchaseInterpreterHouseholdMember {
  memberId: string
  displayName: string
  status: 'active' | 'away' | 'left'
}

export interface PurchaseInterpretation {
  decision: PurchaseInterpretationDecision
  amountMinor: bigint | null
  currency: 'GEL' | 'USD' | null
  itemDescription: string | null
  payerMemberId?: string | null
  amountSource?: PurchaseInterpretationAmountSource | null
  calculationExplanation?: string | null
  participantMemberIds?: readonly string[] | null
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
    householdMembers?: readonly PurchaseInterpreterHouseholdMember[]
    senderMemberId?: string | null
  }
) => Promise<PurchaseInterpretation | null>

interface OpenAiStructuredResult {
  decision: PurchaseInterpretationDecision
  amountMinor: string | null
  currency: 'GEL' | 'USD' | null
  itemDescription: string | null
  payerMemberId: string | null
  amountSource: PurchaseInterpretationAmountSource | null
  calculationExplanation: string | null
  participantMemberIds: string[] | null
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

function normalizeParticipantMemberIds(
  value: readonly string[] | null | undefined,
  householdMembers: readonly PurchaseInterpreterHouseholdMember[] | undefined
): readonly string[] | null {
  if (!value || value.length === 0) {
    return null
  }

  const allowedMemberIds = householdMembers
    ? new Set(householdMembers.map((member) => member.memberId))
    : null
  const normalized = value
    .map((memberId) => memberId.trim())
    .filter((memberId) => memberId.length > 0)
    .filter((memberId, index, all) => all.indexOf(memberId) === index)
    .filter((memberId) => (allowedMemberIds ? allowedMemberIds.has(memberId) : true))

  return normalized.length > 0 ? normalized : null
}

function normalizePayerMemberId(
  value: string | null | undefined,
  householdMembers: readonly PurchaseInterpreterHouseholdMember[] | undefined
): string | null {
  if (!value) {
    return null
  }

  const normalized = value.trim()
  if (normalized.length === 0) {
    return null
  }

  if (!householdMembers) {
    return normalized
  }

  return householdMembers.some((member) => member.memberId === normalized) ? normalized : null
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
    if (rawText.trim().length === 0) {
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
        reasoning: { effort: 'none', summary: 'auto' },
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
              'Infer intent from the message together with any provided context instead of relying on isolated keywords.',
              'Treat colloquial completed-buy phrasing like "взял", "сходил и взял", or "сторговался до X" as a completed purchase when the message reports a real buy fact.',
              'Treat Russian item-first completed purchases like "стиральный порошок уже купил 12 лари" as completed purchases when item, completed buy verb, amount, and currency are all present.',
              'Plans, wishes, future intent, tomorrow-talk, and approximate future prices are not purchases. Return not_purchase for those.',
              'Meta replies like "I already said above", "the question is above", or "do you have context" are not purchase details. Return not_purchase unless the latest message clearly supplies the missing purchase fact.',
              'If recent messages from the same sender are provided, treat them as clarification context for the latest message.',
              'If the latest message is a complete standalone purchase on its own, ignore the earlier clarification context.',
              'If the latest message answers a previous clarification, combine it with the earlier messages to resolve the purchase.',
              'If a household member roster is provided and the user explicitly says who shares the purchase, return participantMemberIds as the included member IDs.',
              'If a household member roster is provided and the user explicitly says who paid for the purchase, return payerMemberId.',
              'For phrases like "split with Dima", "for me and Alice", or similar, include the sender and the explicitly mentioned household members in participantMemberIds.',
              'If the message does not clearly specify a participant subset, return participantMemberIds as null. Do not return only the sender just because they paid.',
              'Away members may still be included when the user explicitly names them.',
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
            content: [
              options.householdMembers && options.householdMembers.length > 0
                ? [
                    'Household members:',
                    ...options.householdMembers.map(
                      (member) =>
                        `- ${member.memberId}: ${member.displayName} (status=${member.status}${member.memberId === options.senderMemberId ? ', sender=yes' : ''})`
                    )
                  ].join('\n')
                : null,
              buildPurchaseInterpretationInput(rawText, options.clarificationContext)
            ]
              .filter(Boolean)
              .join('\n\n')
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
                payerMemberId: {
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
                participantMemberIds: {
                  anyOf: [
                    {
                      type: 'array',
                      items: { type: 'string' }
                    },
                    { type: 'null' }
                  ]
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
                'payerMemberId',
                'amountSource',
                'calculationExplanation',
                'participantMemberIds',
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
    const payerMemberId = normalizePayerMemberId(parsedJson.payerMemberId, options.householdMembers)
    const amountSource = normalizeAmountSource(parsedJson.amountSource, amountMinor)
    const calculationExplanation = normalizeOptionalText(parsedJson.calculationExplanation)
    const participantMemberIds = normalizeParticipantMemberIds(
      parsedJson.participantMemberIds,
      options.householdMembers
    )
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

    const result: PurchaseInterpretation = {
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

    if (payerMemberId) {
      result.payerMemberId = payerMemberId
    }

    if (participantMemberIds) {
      result.participantMemberIds = participantMemberIds
    }

    return result
  }
}
