import { expect, test } from 'bun:test'

import { miniAppJsonResponse } from './miniapp-auth'
import { withMiniAppTiming } from './miniapp-timing'

test('exposes aggregate timing to the allowed app without changing the response contract', async () => {
  const response = miniAppJsonResponse({ ok: true }, 200, 'https://miniapp.example')
  response.headers.set('access-control-expose-headers', 'X-Request-Id')
  const timed = withMiniAppTiming(response, 50.4, {
    queryCount: 4,
    queryMs: 80,
    byMethod: { 'finance.listMembers': 1 }
  })
  expect(timed.status).toBe(200)
  expect(await timed.json()).toEqual({ ok: true })
  expect(timed.headers.get('server-timing')).toBe(
    'app;dur=50, repo;dur=80;desc="Summed repository time", repo_calls;desc="4"'
  )
  expect(timed.headers.get('timing-allow-origin')).toBe('https://miniapp.example')
  expect(timed.headers.get('access-control-expose-headers')).toBe('X-Request-Id, Server-Timing')
  expect(timed.headers.get('cache-control')).toBe('no-store')
  expect(timed.headers.get('vary')).toBe('origin')
})

test('does not grant timing access to a rejected origin and preserves empty preflight bodies', async () => {
  const response = withMiniAppTiming(miniAppJsonResponse({}, 204), 1, {
    queryCount: 0,
    queryMs: 0,
    byMethod: {}
  })
  expect(response.status).toBe(204)
  expect(await response.text()).toBe('')
  expect(response.headers.get('timing-allow-origin')).toBeNull()
  expect(response.headers.get('access-control-expose-headers')).toBeNull()
})
