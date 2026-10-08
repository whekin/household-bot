/// <reference types="bun" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  MiniAppApiError,
  isMiniAppSessionExpiredError,
  miniAppApiError,
  postMiniApp,
  readMiniApp,
  shouldRetryMiniAppQuery
} from './client'

const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
const originalFetch = globalThis.fetch

function mockFetch(handler: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>) {
  globalThis.fetch = handler as typeof fetch
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { __HOUSEHOLD_CONFIG__: { botApiUrl: 'https://miniapp-api.example' } }
  })
})

afterEach(() => {
  globalThis.fetch = originalFetch
  if (windowDescriptor) {
    Object.defineProperty(globalThis, 'window', windowDescriptor)
  } else {
    Reflect.deleteProperty(globalThis, 'window')
  }
})

describe('mini app read requests', () => {
  test('returns a successful response and clears the read deadline', async () => {
    let signal: AbortSignal | null | undefined
    mockFetch(async (_url, init) => {
      signal = init?.signal
      return Response.json({ authorized: true })
    })

    const result = await readMiniApp<{ authorized: boolean; error?: string }>(
      '/api/miniapp/session',
      { initData: 'test' },
      5
    )
    expect(result.payload).toEqual({ authorized: true })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(signal?.aborted).toBe(false)
  })

  test('releases a stalled fetch with a recoverable error and no automatic retry', async () => {
    mockFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError'))
          )
        })
    )

    const error = await readMiniApp('/api/miniapp/dashboard', { initData: 'test' }, 1).catch(
      (error: unknown) => error
    )
    expect(error).toBeInstanceOf(MiniAppApiError)
    expect((error as MiniAppApiError).status).toBe(408)
    expect(isMiniAppSessionExpiredError(error)).toBe(false)
    expect(shouldRetryMiniAppQuery(0, error)).toBe(false)
  })

  test('also bounds a stalled response body', async () => {
    mockFetch(
      async (_url, init) =>
        new Response(
          new ReadableStream({
            start(controller) {
              init?.signal?.addEventListener('abort', () =>
                controller.error(new Error('Body aborted'))
              )
            }
          })
        )
    )

    await expect(
      readMiniApp('/api/miniapp/session', { initData: 'test' }, 1)
    ).rejects.toMatchObject({
      status: 408
    })
  })

  test('keeps financial writes outside the read deadline', async () => {
    let signal: AbortSignal | null | undefined
    mockFetch(async (_url, init) => {
      signal = init?.signal
      return Response.json({ ok: true })
    })

    await postMiniApp('/api/miniapp/admin/payments/add', { initData: 'test' })
    expect(signal).toBeUndefined()
  })
})

describe('mini app query retries', () => {
  test('surfaces an expired Telegram session immediately', () => {
    const error = miniAppApiError(
      new Response(null, { status: 401 }),
      { error: 'Invalid Telegram init data' },
      'Failed to load dashboard'
    )
    expect(isMiniAppSessionExpiredError(error)).toBe(true)
    expect(shouldRetryMiniAppQuery(0, error)).toBe(false)
  })

  test('retries transient server and network failures once', () => {
    const serverError = miniAppApiError(
      new Response(null, { status: 503 }),
      {},
      'Service unavailable'
    )
    expect(shouldRetryMiniAppQuery(0, serverError)).toBe(true)
    expect(shouldRetryMiniAppQuery(1, serverError)).toBe(false)
    expect(shouldRetryMiniAppQuery(0, new TypeError('Failed to fetch'))).toBe(true)
    expect(shouldRetryMiniAppQuery(1, new TypeError('Failed to fetch'))).toBe(false)
  })
})
