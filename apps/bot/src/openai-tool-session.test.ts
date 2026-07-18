import { afterEach, describe, expect, test } from 'bun:test'

import { runToolSession } from './openai-tool-session'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function mockOpenAi(responses: unknown[]) {
  const requests: Array<Record<string, unknown>> = []
  let index = 0

  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    requests.push(JSON.parse(init?.body ?? '{}') as Record<string, unknown>)
    const payload = responses[Math.min(index, responses.length - 1)]
    index += 1
    return new Response(JSON.stringify(payload), { status: 200 })
  }) as typeof fetch

  return requests
}

const baseInput = {
  apiKey: 'test-key',
  model: 'test-model',
  timeoutMs: 5000,
  systemPrompt: 'system',
  contextPrompt: 'context',
  userMessage: 'сколько я должен?',
  tools: [
    {
      name: 'get_bill_status',
      description: 'bill',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    }
  ]
}

describe('runToolSession', () => {
  test('returns plain text when the model does not call tools', async () => {
    mockOpenAi([
      {
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'Привет!' }] }],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }
      }
    ])

    const result = await runToolSession({
      ...baseInput,
      executeTool: async () => ({ result: {} })
    })

    expect(result.text).toBe('Привет!')
    expect(result.toolCallCount).toBe(0)
    expect(result.usage.totalTokens).toBe(15)
  })

  test('executes a tool call, feeds the output back, and returns the final text', async () => {
    const requests = mockOpenAi([
      {
        output: [
          {
            type: 'function_call',
            name: 'get_bill_status',
            call_id: 'call-1',
            arguments: '{}'
          }
        ],
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }
      },
      {
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'Остаток 469 GEL.' }] }],
        usage: { input_tokens: 20, output_tokens: 6, total_tokens: 26 }
      }
    ])

    const toolCalls: string[] = []
    const result = await runToolSession({
      ...baseInput,
      executeTool: async (call) => {
        toolCalls.push(call.name)
        return { result: { remaining: '469 GEL' } }
      }
    })

    expect(toolCalls).toEqual(['get_bill_status'])
    expect(result.text).toBe('Остаток 469 GEL.')
    expect(result.toolCallCount).toBe(1)
    expect(result.usage.totalTokens).toBe(41)

    const secondRequest = requests[1] as { input: Array<{ type?: string; output?: string }> }
    const toolOutput = secondRequest.input.find((item) => item.type === 'function_call_output')
    expect(toolOutput?.output).toBe(JSON.stringify({ remaining: '469 GEL' }))
  })

  test('reports cardPosted and suppress-worthy sessions', async () => {
    mockOpenAi([
      {
        output: [
          {
            type: 'function_call',
            name: 'propose_payment',
            call_id: 'call-1',
            arguments: '{"kind":"rent"}'
          }
        ]
      },
      {
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'Готово, записал!' }] }]
      }
    ])

    const result = await runToolSession({
      ...baseInput,
      executeTool: async () => ({ result: { status: 'card_posted' }, cardPosted: true })
    })

    expect(result.cardPosted).toBe(true)
    expect(result.text).toBe('Готово, записал!')
  })

  test('passes an error result to the model when tool arguments are invalid JSON', async () => {
    const requests = mockOpenAi([
      {
        output: [
          {
            type: 'function_call',
            name: 'get_bill_status',
            call_id: 'call-1',
            arguments: '{broken'
          }
        ]
      },
      {
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'Не вышло.' }] }]
      }
    ])

    const result = await runToolSession({
      ...baseInput,
      executeTool: async () => {
        throw new Error('should not be called')
      }
    })

    expect(result.text).toBe('Не вышло.')
    const secondRequest = requests[1] as { input: Array<{ type?: string; output?: string }> }
    const toolOutput = secondRequest.input.find((item) => item.type === 'function_call_output')
    expect(toolOutput?.output).toBe(JSON.stringify({ error: 'invalid_arguments_json' }))
  })

  test('logs the status and request id for failed API requests', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          error: {
            message: 'Incorrect API key provided'
          }
        }),
        {
          status: 401,
          headers: {
            'x-request-id': 'req_test_123'
          }
        }
      )) as unknown as typeof fetch
    const errors: unknown[] = []

    const request = runToolSession({
      ...baseInput,
      executeTool: async () => ({ result: {} }),
      logger: {
        info() {},
        warn() {},
        error(obj) {
          errors.push(obj)
        }
      }
    })

    await expect(request).rejects.toThrow(
      'Tool session request failed with status 401 (request req_test_123): Incorrect API key provided'
    )
    expect(errors).toEqual([
      {
        event: 'tool_session.api_error',
        status: 401,
        requestId: 'req_test_123',
        errorMessage: 'Incorrect API key provided'
      }
    ])
  })

  test('stops at the iteration limit and returns no text', async () => {
    mockOpenAi([
      {
        output: [
          {
            type: 'function_call',
            name: 'get_bill_status',
            call_id: 'call-loop',
            arguments: '{}'
          }
        ]
      }
    ])

    const result = await runToolSession({
      ...baseInput,
      maxIterations: 3,
      executeTool: async () => ({ result: {} })
    })

    expect(result.text).toBeNull()
    expect(result.toolCallCount).toBe(3)
  })
})
