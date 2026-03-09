import { describe, expect, test } from 'bun:test'

import { createBotWebhookServer } from './server'

describe('createBotWebhookServer', () => {
  const server = createBotWebhookServer({
    webhookPath: '/webhook/telegram',
    webhookSecret: 'secret-token',
    webhookHandler: async () => new Response('ok', { status: 200 }),
    miniAppAuth: {
      handler: async () =>
        new Response(JSON.stringify({ ok: true, authorized: true }), {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8'
          }
        })
    },
    miniAppDashboard: {
      handler: async () =>
        new Response(JSON.stringify({ ok: true, authorized: true, dashboard: {} }), {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8'
          }
        })
    },
    miniAppPendingMembers: {
      handler: async () =>
        new Response(JSON.stringify({ ok: true, authorized: true, members: [] }), {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8'
          }
        })
    },
    miniAppSettings: {
      handler: async () =>
        new Response(
          JSON.stringify({ ok: true, authorized: true, settings: {}, categories: [], members: [] }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json; charset=utf-8'
            }
          }
        )
    },
    miniAppUpdateSettings: {
      handler: async () =>
        new Response(JSON.stringify({ ok: true, authorized: true, settings: {} }), {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8'
          }
        })
    },
    miniAppUpsertUtilityCategory: {
      handler: async () =>
        new Response(JSON.stringify({ ok: true, authorized: true, category: {} }), {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8'
          }
        })
    },
    miniAppPromoteMember: {
      handler: async () =>
        new Response(JSON.stringify({ ok: true, authorized: true, member: {} }), {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8'
          }
        })
    },
    miniAppUpdateMemberRentWeight: {
      handler: async () =>
        new Response(JSON.stringify({ ok: true, authorized: true, member: {} }), {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8'
          }
        })
    },
    miniAppBillingCycle: {
      handler: async () =>
        new Response(JSON.stringify({ ok: true, authorized: true, cycleState: {} }), {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8'
          }
        })
    },
    miniAppOpenCycle: {
      handler: async () =>
        new Response(JSON.stringify({ ok: true, authorized: true, cycleState: {} }), {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8'
          }
        })
    },
    miniAppCloseCycle: {
      handler: async () =>
        new Response(JSON.stringify({ ok: true, authorized: true, cycleState: {} }), {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8'
          }
        })
    },
    miniAppRentUpdate: {
      handler: async () =>
        new Response(JSON.stringify({ ok: true, authorized: true, cycleState: {} }), {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8'
          }
        })
    },
    miniAppAddUtilityBill: {
      handler: async () =>
        new Response(JSON.stringify({ ok: true, authorized: true, cycleState: {} }), {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8'
          }
        })
    },
    miniAppApproveMember: {
      handler: async () =>
        new Response(JSON.stringify({ ok: true, authorized: true, member: {} }), {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8'
          }
        })
    },
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

  test('accepts mini app auth request', async () => {
    const response = await server.fetch(
      new Request('http://localhost/api/miniapp/session', {
        method: 'POST',
        body: JSON.stringify({ initData: 'payload' })
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      authorized: true
    })
  })

  test('accepts mini app dashboard request', async () => {
    const response = await server.fetch(
      new Request('http://localhost/api/miniapp/dashboard', {
        method: 'POST',
        body: JSON.stringify({ initData: 'payload' })
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      authorized: true,
      dashboard: {}
    })
  })

  test('accepts mini app pending members request', async () => {
    const response = await server.fetch(
      new Request('http://localhost/api/miniapp/admin/pending-members', {
        method: 'POST',
        body: JSON.stringify({ initData: 'payload' })
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      authorized: true,
      members: []
    })
  })

  test('accepts mini app settings request', async () => {
    const response = await server.fetch(
      new Request('http://localhost/api/miniapp/admin/settings', {
        method: 'POST',
        body: JSON.stringify({ initData: 'payload' })
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      authorized: true,
      settings: {},
      categories: [],
      members: []
    })
  })

  test('accepts mini app settings update request', async () => {
    const response = await server.fetch(
      new Request('http://localhost/api/miniapp/admin/settings/update', {
        method: 'POST',
        body: JSON.stringify({ initData: 'payload' })
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      authorized: true,
      settings: {}
    })
  })

  test('accepts mini app utility category upsert request', async () => {
    const response = await server.fetch(
      new Request('http://localhost/api/miniapp/admin/utility-categories/upsert', {
        method: 'POST',
        body: JSON.stringify({ initData: 'payload' })
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      authorized: true,
      category: {}
    })
  })

  test('accepts mini app promote member request', async () => {
    const response = await server.fetch(
      new Request('http://localhost/api/miniapp/admin/members/promote', {
        method: 'POST',
        body: JSON.stringify({ initData: 'payload' })
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      authorized: true,
      member: {}
    })
  })

  test('accepts mini app rent weight update request', async () => {
    const response = await server.fetch(
      new Request('http://localhost/api/miniapp/admin/members/rent-weight', {
        method: 'POST',
        body: JSON.stringify({ initData: 'payload' })
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      authorized: true,
      member: {}
    })
  })

  test('accepts mini app billing cycle request', async () => {
    const response = await server.fetch(
      new Request('http://localhost/api/miniapp/admin/billing-cycle', {
        method: 'POST',
        body: JSON.stringify({ initData: 'payload' })
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      authorized: true,
      cycleState: {}
    })
  })

  test('accepts mini app open cycle request', async () => {
    const response = await server.fetch(
      new Request('http://localhost/api/miniapp/admin/billing-cycle/open', {
        method: 'POST',
        body: JSON.stringify({ initData: 'payload' })
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      authorized: true,
      cycleState: {}
    })
  })

  test('accepts mini app close cycle request', async () => {
    const response = await server.fetch(
      new Request('http://localhost/api/miniapp/admin/billing-cycle/close', {
        method: 'POST',
        body: JSON.stringify({ initData: 'payload' })
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      authorized: true,
      cycleState: {}
    })
  })

  test('accepts mini app rent update request', async () => {
    const response = await server.fetch(
      new Request('http://localhost/api/miniapp/admin/rent/update', {
        method: 'POST',
        body: JSON.stringify({ initData: 'payload' })
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      authorized: true,
      cycleState: {}
    })
  })

  test('accepts mini app utility bill add request', async () => {
    const response = await server.fetch(
      new Request('http://localhost/api/miniapp/admin/utility-bills/add', {
        method: 'POST',
        body: JSON.stringify({ initData: 'payload' })
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      authorized: true,
      cycleState: {}
    })
  })

  test('accepts mini app approve member request', async () => {
    const response = await server.fetch(
      new Request('http://localhost/api/miniapp/admin/approve-member', {
        method: 'POST',
        body: JSON.stringify({ initData: 'payload', pendingTelegramUserId: '123456' })
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      authorized: true,
      member: {}
    })
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
