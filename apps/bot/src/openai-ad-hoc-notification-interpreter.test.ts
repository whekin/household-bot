import { describe, expect, test } from 'bun:test'

import {
  createOpenAiAdHocNotificationInterpreter,
  type AdHocNotificationInterpretation
} from './openai-ad-hoc-notification-interpreter'

function successfulResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'content-type': 'application/json'
    }
  })
}

function nestedJsonResponse(payload: unknown): Response {
  return successfulResponse({
    output: [
      {
        content: [
          {
            text: JSON.stringify(payload)
          }
        ]
      }
    ]
  })
}

describe('createOpenAiAdHocNotificationInterpreter', () => {
  test('parses exact datetime requests through the llm', async () => {
    const interpreter = createOpenAiAdHocNotificationInterpreter({
      apiKey: 'test-key',
      parserModel: 'gpt-5-mini',
      rendererModel: 'gpt-5-mini',
      timeoutMs: 5000
    })
    expect(interpreter).toBeDefined()

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      nestedJsonResponse({
        decision: 'notification',
        notificationText: 'пошпынять Георгия о том, позвонил ли он',
        assigneeMemberId: 'georgiy',
        resolvedLocalDate: '2026-03-24',
        resolvedHour: 15,
        resolvedMinute: 30,
        resolutionMode: 'exact',
        confidence: 93,
        clarificationQuestion: null
      })) as unknown as typeof fetch

    try {
      const result = await interpreter!.interpretRequest({
        locale: 'ru',
        timezone: 'Asia/Tbilisi',
        localNow: '2026-03-23 13:00',
        text: 'Железяка, напомни пошпынять Георгия завтра в 15:30',
        members: [
          { memberId: 'dima', displayName: 'Дима', status: 'active' },
          { memberId: 'georgiy', displayName: 'Георгий', status: 'active' }
        ],
        senderMemberId: 'dima'
      })

      expect(result).toEqual<AdHocNotificationInterpretation>({
        decision: 'notification',
        notificationText: 'пошпынять Георгия о том, позвонил ли он',
        assigneeMemberId: 'georgiy',
        resolvedLocalDate: '2026-03-24',
        resolvedHour: 15,
        resolvedMinute: 30,
        resolutionMode: 'exact',
        clarificationQuestion: null,
        confidence: 93,
        parserMode: 'llm'
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('parses fuzzy windows like tomorrow morning', async () => {
    const interpreter = createOpenAiAdHocNotificationInterpreter({
      apiKey: 'test-key',
      parserModel: 'gpt-5-mini',
      rendererModel: 'gpt-5-mini',
      timeoutMs: 5000
    })
    expect(interpreter).toBeDefined()

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      nestedJsonResponse({
        decision: 'notification',
        notificationText: 'remind me about the call',
        assigneeMemberId: null,
        resolvedLocalDate: '2026-03-24',
        resolvedHour: 9,
        resolvedMinute: 0,
        resolutionMode: 'fuzzy_window',
        confidence: 90,
        clarificationQuestion: null
      })) as unknown as typeof fetch

    try {
      const result = await interpreter!.interpretRequest({
        locale: 'en',
        timezone: 'Asia/Tbilisi',
        localNow: '2026-03-23 13:00',
        text: 'remind me tomorrow morning about the call',
        members: [],
        senderMemberId: 'sender'
      })

      expect(result?.resolutionMode).toBe('fuzzy_window')
      expect(result?.resolvedHour).toBe(9)
      expect(result?.resolvedMinute).toBe(0)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('returns clarification for missing or ambiguous schedule', async () => {
    const interpreter = createOpenAiAdHocNotificationInterpreter({
      apiKey: 'test-key',
      parserModel: 'gpt-5-mini',
      rendererModel: 'gpt-5-mini',
      timeoutMs: 5000
    })
    expect(interpreter).toBeDefined()

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      nestedJsonResponse({
        decision: 'clarification',
        notificationText: 'пошпынять Георгия о том, позвонил ли он',
        assigneeMemberId: 'georgiy',
        resolvedLocalDate: null,
        resolvedHour: null,
        resolvedMinute: null,
        resolutionMode: 'ambiguous',
        confidence: 82,
        clarificationQuestion: 'Когда напомнить: завтра утром, днем или вечером?'
      })) as unknown as typeof fetch

    try {
      const result = await interpreter!.interpretRequest({
        locale: 'ru',
        timezone: 'Asia/Tbilisi',
        localNow: '2026-03-23 13:00',
        text: 'напомни пошпынять Георгия',
        members: [
          { memberId: 'dima', displayName: 'Дима', status: 'active' },
          { memberId: 'georgiy', displayName: 'Георгий', status: 'active' }
        ],
        senderMemberId: 'dima'
      })

      expect(result?.decision).toBe('clarification')
      expect(result?.clarificationQuestion).toContain('Когда напомнить')
      expect(result?.notificationText).toContain('пошпынять Георгия')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('returns not_notification for unrelated text', async () => {
    const interpreter = createOpenAiAdHocNotificationInterpreter({
      apiKey: 'test-key',
      parserModel: 'gpt-5-mini',
      rendererModel: 'gpt-5-mini',
      timeoutMs: 5000
    })
    expect(interpreter).toBeDefined()

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      nestedJsonResponse({
        decision: 'not_notification',
        notificationText: null,
        assigneeMemberId: null,
        resolvedLocalDate: null,
        resolvedHour: null,
        resolvedMinute: null,
        resolutionMode: null,
        confidence: 96,
        clarificationQuestion: null
      })) as unknown as typeof fetch

    try {
      const result = await interpreter!.interpretRequest({
        locale: 'ru',
        timezone: 'Asia/Tbilisi',
        localNow: '2026-03-23 13:00',
        text: 'как дела',
        members: [],
        senderMemberId: 'sender'
      })

      expect(result?.decision).toBe('not_notification')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('interprets draft edits as partial updates', async () => {
    const interpreter = createOpenAiAdHocNotificationInterpreter({
      apiKey: 'test-key',
      parserModel: 'gpt-5-mini',
      rendererModel: 'gpt-5-mini',
      timeoutMs: 5000
    })
    expect(interpreter).toBeDefined()

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      nestedJsonResponse({
        decision: 'updated',
        notificationText: null,
        assigneeChanged: false,
        assigneeMemberId: null,
        resolvedLocalDate: '2026-03-24',
        resolvedHour: 10,
        resolvedMinute: 0,
        resolutionMode: 'exact',
        deliveryMode: null,
        dmRecipientMemberIds: null,
        confidence: 88,
        clarificationQuestion: null
      })) as unknown as typeof fetch

    try {
      const result = await interpreter!.interpretDraftEdit({
        locale: 'ru',
        timezone: 'Asia/Tbilisi',
        localNow: '2026-03-23 23:30',
        text: 'Давай на 10 часов лучше',
        members: [
          { memberId: 'dima', displayName: 'Дима', status: 'active' },
          { memberId: 'georgiy', displayName: 'Георгий', status: 'active' }
        ],
        senderMemberId: 'dima',
        currentNotificationText: 'пошпынять Георгия о том, позвонил ли он',
        currentAssigneeMemberId: 'georgiy',
        currentScheduledLocalDate: '2026-03-24',
        currentScheduledHour: 9,
        currentScheduledMinute: 0,
        currentDeliveryMode: 'topic',
        currentDmRecipientMemberIds: []
      })

      expect(result).toMatchObject({
        decision: 'updated',
        resolvedHour: 10,
        resolvedMinute: 0,
        resolutionMode: 'exact',
        notificationText: null,
        deliveryMode: null
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('interprets draft edit cancellation requests', async () => {
    const interpreter = createOpenAiAdHocNotificationInterpreter({
      apiKey: 'test-key',
      parserModel: 'gpt-5-mini',
      rendererModel: 'gpt-5-mini',
      timeoutMs: 5000
    })
    expect(interpreter).toBeDefined()

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      nestedJsonResponse({
        decision: 'cancel',
        notificationText: null,
        assigneeChanged: false,
        assigneeMemberId: null,
        resolvedLocalDate: null,
        resolvedHour: null,
        resolvedMinute: null,
        resolutionMode: null,
        deliveryMode: null,
        dmRecipientMemberIds: null,
        confidence: 95,
        clarificationQuestion: null
      })) as unknown as typeof fetch

    try {
      const result = await interpreter!.interpretDraftEdit({
        locale: 'ru',
        timezone: 'Asia/Tbilisi',
        localNow: '2026-03-23 23:30',
        text: 'А вообще, я не буду кушать',
        members: [{ memberId: 'dima', displayName: 'Дима', status: 'active' }],
        senderMemberId: 'dima',
        currentNotificationText: 'покушать',
        currentAssigneeMemberId: 'dima',
        currentScheduledLocalDate: '2026-03-24',
        currentScheduledHour: 11,
        currentScheduledMinute: 0,
        currentDeliveryMode: 'topic',
        currentDmRecipientMemberIds: []
      })

      expect(result?.decision).toBe('cancel')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('renders the final delivery text that should be persisted', async () => {
    const interpreter = createOpenAiAdHocNotificationInterpreter({
      apiKey: 'test-key',
      parserModel: 'gpt-5-mini',
      rendererModel: 'gpt-5-mini',
      timeoutMs: 5000
    })
    expect(interpreter).toBeDefined()

    const originalFetch = globalThis.fetch
    let capturedPrompt = ''
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      const body =
        typeof init?.body === 'string'
          ? (JSON.parse(init.body) as {
              input?: Array<{ content?: string }>
            })
          : null
      capturedPrompt = body?.input?.[0]?.content ?? ''

      return nestedJsonResponse({
        text: 'Дима, пора пошпынять Георгия и проверить, позвонил ли он уже.'
      })
    }) as unknown as typeof fetch

    try {
      const result = await interpreter!.renderDeliveryText({
        locale: 'ru',
        originalRequestText: 'Железяка, напомни пошпынять Георгия о том позвонил ли он.',
        notificationText: 'пошпынять Георгия о том, позвонил ли он',
        requesterDisplayName: 'Дима',
        assigneeDisplayName: 'Георгий'
      })

      expect(capturedPrompt).toContain('Requester display name: Дима')
      expect(capturedPrompt).toContain('Assignee display name: Георгий')
      expect(capturedPrompt).toContain('Do not accidentally address the assignee as the recipient')
      expect(result).toBe('Дима, пора пошпынять Георгия и проверить, позвонил ли он уже.')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
