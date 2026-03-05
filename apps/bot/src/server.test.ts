import { describe, expect, test } from 'bun:test'

import { createBotWebhookServer } from './server'

describe('createBotWebhookServer', () => {
  const server = createBotWebhookServer({
    webhookPath: '/webhook/telegram',
    webhookSecret: 'secret-token',
    webhookHandler: async () => new Response('ok', { status: 200 })
  })

  test('returns health payload', async () => {
    const response = await server.fetch(new Request('http://localhost/healthz'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })

  test('rejects unknown path', async () => {
    const response = await server.fetch(new Request('http://localhost/unknown'))

    expect(response.status).toBe(404)
  })

  test('rejects webhook request with missing secret', async () => {
    const response = await server.fetch(
      new Request('http://localhost/webhook/telegram', {
        method: 'POST'
      })
    )

    expect(response.status).toBe(401)
  })

  test('rejects non-post method for webhook endpoint', async () => {
    const response = await server.fetch(
      new Request('http://localhost/webhook/telegram', {
        method: 'GET',
        headers: {
          'x-telegram-bot-api-secret-token': 'secret-token'
        }
      })
    )

    expect(response.status).toBe(405)
  })

  test('accepts authorized webhook request', async () => {
    const response = await server.fetch(
      new Request('http://localhost/webhook/telegram', {
        method: 'POST',
        headers: {
          'x-telegram-bot-api-secret-token': 'secret-token'
        },
        body: JSON.stringify({ update_id: 1 })
      })
    )

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('ok')
  })
})
