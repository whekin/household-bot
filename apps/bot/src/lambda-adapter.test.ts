import { describe, expect, test } from 'bun:test'

import {
  handleLambdaFunctionUrlEvent,
  requestFromLambdaEvent,
  responseToLambdaResult,
  type LambdaFunctionUrlRequest
} from './lambda-adapter'

function baseEvent(overrides: Partial<LambdaFunctionUrlRequest> = {}): LambdaFunctionUrlRequest {
  return {
    version: '2.0',
    rawPath: '/healthz',
    rawQueryString: '',
    headers: {
      host: 'api.example.com',
      'x-forwarded-proto': 'https'
    },
    requestContext: {
      http: {
        method: 'GET'
      }
    },
    ...overrides
  }
}

describe('lambda adapter', () => {
  test('translates a function url event into a request', async () => {
    const request = requestFromLambdaEvent(
      baseEvent({
        rawPath: '/webhook/telegram',
        rawQueryString: 'foo=bar',
        headers: {
          host: 'api.example.com',
          'x-forwarded-proto': 'https',
          'x-telegram-bot-api-secret-token': 'secret-token'
        },
        requestContext: {
          http: {
            method: 'POST'
          }
        },
        body: JSON.stringify({ update_id: 1 })
      })
    )

    expect(request.method).toBe('POST')
    expect(request.url).toBe('https://api.example.com/webhook/telegram?foo=bar')
    expect(request.headers.get('x-telegram-bot-api-secret-token')).toBe('secret-token')
    expect(await request.json()).toEqual({ update_id: 1 })
  })

  test('translates a response into a lambda result', async () => {
    const response = await responseToLambdaResult(
      new Response(JSON.stringify({ ok: true }), {
        status: 201,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store'
        }
      })
    )

    expect(response).toEqual({
      statusCode: 201,
      headers: {
        'cache-control': 'no-store',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ ok: true })
    })
  })

  test('preserves health endpoint behavior through the adapter', async () => {
    const response = await handleLambdaFunctionUrlEvent(
      baseEvent(),
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8'
          }
        })
    )

    expect(response.statusCode).toBe(200)
    expect(response.headers).toEqual({
      'content-type': 'application/json; charset=utf-8'
    })
    expect(response.body).toBe(JSON.stringify({ ok: true }))
  })

  test('decodes base64 request bodies', async () => {
    const event = baseEvent({
      rawPath: '/api/miniapp/session',
      requestContext: {
        http: {
          method: 'POST'
        }
      },
      headers: {
        host: 'api.example.com',
        'x-forwarded-proto': 'https',
        'content-type': 'application/json'
      },
      body: btoa(JSON.stringify({ hello: 'world' })),
      isBase64Encoded: true
    })

    const request = requestFromLambdaEvent(event)

    expect(await request.json()).toEqual({ hello: 'world' })
  })
})
