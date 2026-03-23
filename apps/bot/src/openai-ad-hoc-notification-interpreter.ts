import { extractOpenAiResponseText, parseJsonFromResponseText } from './openai-responses'

export type AdHocNotificationResolutionMode = 'exact' | 'fuzzy_window' | 'date_only' | 'ambiguous'

export interface AdHocNotificationInterpreterMember {
  memberId: string
  displayName: string
  status: 'active' | 'away' | 'left'
}

export interface AdHocNotificationInterpretation {
  decision: 'notification' | 'clarification' | 'not_notification'
  notificationText: string | null
  assigneeMemberId: string | null
  resolvedLocalDate: string | null
  resolvedHour: number | null
  resolvedMinute: number | null
  resolutionMode: AdHocNotificationResolutionMode | null
  clarificationQuestion: string | null
  confidence: number
  parserMode: 'llm'
}

export interface AdHocNotificationScheduleInterpretation {
  decision: 'parsed' | 'clarification'
  resolvedLocalDate: string | null
  resolvedHour: number | null
  resolvedMinute: number | null
  resolutionMode: AdHocNotificationResolutionMode | null
  clarificationQuestion: string | null
  confidence: number
  parserMode: 'llm'
}

interface ReminderInterpretationResult {
  decision: 'notification' | 'clarification' | 'not_notification'
  notificationText: string | null
  assigneeMemberId: string | null
  resolvedLocalDate: string | null
  resolvedHour: number | null
  resolvedMinute: number | null
  resolutionMode: AdHocNotificationResolutionMode | null
  confidence: number
  clarificationQuestion: string | null
}

interface ReminderScheduleResult {
  decision: 'parsed' | 'clarification'
  resolvedLocalDate: string | null
  resolvedHour: number | null
  resolvedMinute: number | null
  resolutionMode: AdHocNotificationResolutionMode | null
  confidence: number
  clarificationQuestion: string | null
}

interface ReminderDeliveryTextResult {
  text: string | null
}

export interface AdHocNotificationInterpreter {
  interpretRequest(input: {
    locale: 'en' | 'ru'
    timezone: string
    localNow: string
    text: string
    members: readonly AdHocNotificationInterpreterMember[]
    senderMemberId: string
    assistantContext?: string | null
    assistantTone?: string | null
  }): Promise<AdHocNotificationInterpretation | null>
  interpretSchedule(input: {
    locale: 'en' | 'ru'
    timezone: string
    localNow: string
    text: string
  }): Promise<AdHocNotificationScheduleInterpretation | null>
  renderDeliveryText(input: {
    locale: 'en' | 'ru'
    originalRequestText: string
    notificationText: string
    requesterDisplayName?: string | null
    assigneeDisplayName?: string | null
    assistantContext?: string | null
    assistantTone?: string | null
  }): Promise<string | null>
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : null
}

function normalizeConfidence(value: number): number {
  const scaled = value >= 0 && value <= 1 ? value * 100 : value
  return Math.max(0, Math.min(100, Math.round(scaled)))
}

function normalizeResolutionMode(
  value: string | null | undefined
): AdHocNotificationResolutionMode | null {
  return value === 'exact' ||
    value === 'fuzzy_window' ||
    value === 'date_only' ||
    value === 'ambiguous'
    ? value
    : null
}

function normalizeHour(value: number | null | undefined): number | null {
  if (
    value === null ||
    value === undefined ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 23
  ) {
    return null
  }

  return value
}

function normalizeMinute(value: number | null | undefined): number | null {
  if (
    value === null ||
    value === undefined ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 59
  ) {
    return null
  }

  return value
}

function normalizeMemberId(
  value: string | null | undefined,
  members: readonly AdHocNotificationInterpreterMember[]
): string | null {
  const trimmed = value?.trim()
  if (!trimmed) {
    return null
  }

  return members.some((member) => member.memberId === trimmed) ? trimmed : null
}

function promptWindowRules(): string {
  return [
    'Resolve fuzzy windows using these exact defaults:',
    '- morning / утром / с утра => 09:00',
    '- before lunch / до обеда => 11:00',
    '- afternoon / днём / днем => 14:00',
    '- evening / вечером => 19:00',
    '- plain date-only without time => 12:00'
  ].join('\n')
}

function rosterText(
  members: readonly AdHocNotificationInterpreterMember[],
  senderMemberId: string
): string {
  if (members.length === 0) {
    return 'No household roster provided.'
  }

  return [
    'Household members:',
    ...members.map(
      (member) =>
        `- ${member.memberId}: ${member.displayName} (status=${member.status}${member.memberId === senderMemberId ? ', sender=yes' : ''})`
    )
  ].join('\n')
}

async function fetchStructuredResult<T>(input: {
  apiKey: string
  model: string
  schemaName: string
  schema: object
  prompt: string
  timeoutMs: number
}): Promise<T | null> {
  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), input.timeoutMs)

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: abortController.signal,
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: input.model,
        input: [
          {
            role: 'system',
            content: input.prompt
          }
        ],
        text: {
          format: {
            type: 'json_schema',
            name: input.schemaName,
            schema: input.schema
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

    return parseJsonFromResponseText<T>(responseText)
  } finally {
    clearTimeout(timeout)
  }
}

export function createOpenAiAdHocNotificationInterpreter(input: {
  apiKey: string | undefined
  parserModel: string
  rendererModel: string
  timeoutMs: number
}): AdHocNotificationInterpreter | undefined {
  if (!input.apiKey) {
    return undefined
  }

  const apiKey = input.apiKey
  const parserModel = input.parserModel
  const rendererModel = input.rendererModel
  const timeoutMs = input.timeoutMs

  return {
    async interpretRequest(options) {
      const parsed = await fetchStructuredResult<ReminderInterpretationResult>({
        apiKey,
        model: parserModel,
        schemaName: 'ad_hoc_notification_interpretation',
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            decision: {
              type: 'string',
              enum: ['notification', 'clarification', 'not_notification']
            },
            notificationText: {
              anyOf: [{ type: 'string' }, { type: 'null' }]
            },
            assigneeMemberId: {
              anyOf: [{ type: 'string' }, { type: 'null' }]
            },
            resolvedLocalDate: {
              anyOf: [{ type: 'string' }, { type: 'null' }]
            },
            resolvedHour: {
              anyOf: [{ type: 'integer' }, { type: 'null' }]
            },
            resolvedMinute: {
              anyOf: [{ type: 'integer' }, { type: 'null' }]
            },
            resolutionMode: {
              anyOf: [
                {
                  type: 'string',
                  enum: ['exact', 'fuzzy_window', 'date_only', 'ambiguous']
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
            'notificationText',
            'assigneeMemberId',
            'resolvedLocalDate',
            'resolvedHour',
            'resolvedMinute',
            'resolutionMode',
            'confidence',
            'clarificationQuestion'
          ]
        },
        prompt: [
          'You interpret messages from a household reminders topic.',
          'Decide whether the latest message is an ad hoc reminder request, needs clarification, or is not a reminder request.',
          'Return notificationText as the normalized reminder meaning, without schedule words.',
          'Use the provided member ids when a reminder is clearly aimed at a specific household member.',
          'resolvedLocalDate must be YYYY-MM-DD in the provided household timezone.',
          'resolvedHour and resolvedMinute must be in 24-hour local time when a reminder can be scheduled.',
          'Use resolutionMode exact for explicit clock time, fuzzy_window for phrases like morning/evening, date_only for plain day/date without an explicit time, ambiguous when the request is still too vague to schedule.',
          'If schedule information is missing or ambiguous, return decision clarification and a short clarificationQuestion in the user language.',
          'If the message is not a reminder request, return decision not_notification.',
          promptWindowRules(),
          options.assistantContext ? `Household context: ${options.assistantContext}` : null,
          options.assistantTone ? `Preferred tone: ${options.assistantTone}` : null,
          `Household timezone: ${options.timezone}`,
          `Current local date/time in that timezone: ${options.localNow}`,
          rosterText(options.members, options.senderMemberId),
          '',
          'Latest user message:',
          options.text
        ]
          .filter(Boolean)
          .join('\n'),
        timeoutMs
      })

      if (!parsed) {
        return null
      }

      return {
        decision:
          parsed.decision === 'notification' ||
          parsed.decision === 'clarification' ||
          parsed.decision === 'not_notification'
            ? parsed.decision
            : 'not_notification',
        notificationText: normalizeOptionalText(parsed.notificationText),
        assigneeMemberId: normalizeMemberId(parsed.assigneeMemberId, options.members),
        resolvedLocalDate: normalizeOptionalText(parsed.resolvedLocalDate),
        resolvedHour: normalizeHour(parsed.resolvedHour),
        resolvedMinute: normalizeMinute(parsed.resolvedMinute),
        resolutionMode: normalizeResolutionMode(parsed.resolutionMode),
        clarificationQuestion: normalizeOptionalText(parsed.clarificationQuestion),
        confidence: normalizeConfidence(parsed.confidence),
        parserMode: 'llm'
      }
    },

    async interpretSchedule(options) {
      const parsed = await fetchStructuredResult<ReminderScheduleResult>({
        apiKey,
        model: parserModel,
        schemaName: 'ad_hoc_notification_schedule',
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            decision: {
              type: 'string',
              enum: ['parsed', 'clarification']
            },
            resolvedLocalDate: {
              anyOf: [{ type: 'string' }, { type: 'null' }]
            },
            resolvedHour: {
              anyOf: [{ type: 'integer' }, { type: 'null' }]
            },
            resolvedMinute: {
              anyOf: [{ type: 'integer' }, { type: 'null' }]
            },
            resolutionMode: {
              anyOf: [
                {
                  type: 'string',
                  enum: ['exact', 'fuzzy_window', 'date_only', 'ambiguous']
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
            'resolvedLocalDate',
            'resolvedHour',
            'resolvedMinute',
            'resolutionMode',
            'confidence',
            'clarificationQuestion'
          ]
        },
        prompt: [
          'You interpret only the schedule part of a reminder follow-up.',
          'Decide whether the message contains enough schedule information to produce a local date/time or whether you need clarification.',
          'resolvedLocalDate must be YYYY-MM-DD in the provided household timezone.',
          'resolvedHour and resolvedMinute must be local 24-hour time when parsed.',
          'Use resolutionMode exact for explicit clock time, fuzzy_window for phrases like morning/evening, date_only for plain day/date without explicit time, ambiguous when still unclear.',
          'If the schedule is missing or ambiguous, return clarification and ask a short question in the user language.',
          promptWindowRules(),
          `Household timezone: ${options.timezone}`,
          `Current local date/time in that timezone: ${options.localNow}`,
          '',
          'Latest user message:',
          options.text
        ].join('\n'),
        timeoutMs
      })

      if (!parsed) {
        return null
      }

      return {
        decision: parsed.decision === 'parsed' ? 'parsed' : 'clarification',
        resolvedLocalDate: normalizeOptionalText(parsed.resolvedLocalDate),
        resolvedHour: normalizeHour(parsed.resolvedHour),
        resolvedMinute: normalizeMinute(parsed.resolvedMinute),
        resolutionMode: normalizeResolutionMode(parsed.resolutionMode),
        clarificationQuestion: normalizeOptionalText(parsed.clarificationQuestion),
        confidence: normalizeConfidence(parsed.confidence),
        parserMode: 'llm'
      }
    },

    async renderDeliveryText(options) {
      const parsed = await fetchStructuredResult<ReminderDeliveryTextResult>({
        apiKey,
        model: rendererModel,
        schemaName: 'ad_hoc_notification_delivery_text',
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            text: {
              anyOf: [{ type: 'string' }, { type: 'null' }]
            }
          },
          required: ['text']
        },
        prompt: [
          'You write the final text of a scheduled household reminder message.',
          'Be helpful and lightly playful by default.',
          'Keep the meaning very close to the underlying reminder intent.',
          'Do not mention the schedule or time; the reminder is being sent now.',
          'Prefer one short sentence.',
          'This reminder is being delivered to the requester and/or household chat, not automatically to the assignee.',
          'If requesterDisplayName is provided, prefer addressing the requester or keeping the line neutral.',
          'If assigneeDisplayName is provided, treat that person as the subject of the reminder unless the original request clearly says the reminder should speak directly to them.',
          'Do not accidentally address the assignee as the recipient when the reminder is actually for someone else to act on.',
          'Do not use bullet lists or explanations.',
          options.assistantContext ? `Household context: ${options.assistantContext}` : null,
          options.assistantTone ? `Preferred tone: ${options.assistantTone}` : null,
          `Locale: ${options.locale}`,
          options.requesterDisplayName
            ? `Requester display name: ${options.requesterDisplayName}`
            : null,
          options.assigneeDisplayName
            ? `Assignee display name: ${options.assigneeDisplayName}`
            : null,
          `Original user request: ${options.originalRequestText}`,
          `Normalized reminder intent: ${options.notificationText}`,
          'Return only JSON.'
        ]
          .filter(Boolean)
          .join('\n'),
        timeoutMs
      })

      return normalizeOptionalText(parsed?.text)
    }
  }
}
