import { describe, expect, test } from 'bun:test'

import { createBotWebhookServer } from './server'

describe('createBotWebhookServer', () => {
  const server = createBotWebhookServer({
    webhookPath: '/webhook/telegram',
    webhookSecret: 'secret-token',
    webhookHandler: async () => new Response('ok', { status: 200 }),
    scheduler: {
      authorize: async (request) =>
        request.headers.get('x-household-scheduler-secret') === 'scheduler-secret',
      handler: async (_request, reminderType) =>
        new Response(JSON.stringify({ ok: true, reminderType }), {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8'
          }
        })
    }
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

  test('rejects scheduler request with missing secret', async () => {
    const response = await server.fetch(
      new Request('http://localhost/jobs/reminder/utilities', {
        method: 'POST',
        body: JSON.stringify({ period: '2026-03' })
      })
    )

    expect(response.status).toBe(401)
  })

  test('rejects non-post method for scheduler endpoint', async () => {
    const response = await server.fetch(
      new Request('http://localhost/jobs/reminder/utilities', {
        method: 'GET',
        headers: {
          'x-household-scheduler-secret': 'scheduler-secret'
        }
      })
    )

    expect(response.status).toBe(405)
  })

  test('accepts authorized scheduler request', async () => {
    const response = await server.fetch(
      new Request('http://localhost/jobs/reminder/rent-due', {
        method: 'POST',
        headers: {
          'x-household-scheduler-secret': 'scheduler-secret'
        },
        body: JSON.stringify({ period: '2026-03' })
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      reminderType: 'rent-due'
    })
  })
})
