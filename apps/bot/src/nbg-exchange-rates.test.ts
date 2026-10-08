import { describe, expect, test } from 'bun:test'

import { createNbgExchangeRateProvider } from './nbg-exchange-rates'

function nbgResponse(rate: number): Response {
  return new Response(
    JSON.stringify([
      {
        date: '2026-09-15T00:00:00.000Z',
        currencies: [
          {
            code: 'USD',
            quantity: 1,
            rateFormated: rate.toFixed(4),
            rate,
            validFromDate: '2026-09-15T00:00:00.000Z'
          }
        ]
      }
    ]),
    { status: 200, headers: { 'content-type': 'application/json' } }
  )
}

const usdToGel = {
  baseCurrency: 'USD',
  quoteCurrency: 'GEL',
  effectiveDate: '2026-09-15'
} as const

describe('createNbgExchangeRateProvider', () => {
  test('caches a successful rate instead of refetching it', async () => {
    let calls = 0
    const provider = createNbgExchangeRateProvider({
      fetchImpl: async () => {
        calls += 1
        return nbgResponse(2.6091)
      }
    })

    const first = await provider.getRate(usdToGel)
    const second = await provider.getRate(usdToGel)

    expect(first.rateMicros).toBe(2609100n)
    expect(second.rateMicros).toBe(2609100n)
    expect(calls).toBe(1)
  })

  test('refetches once the cached rate expires', async () => {
    let calls = 0
    let currentTime = 0
    const provider = createNbgExchangeRateProvider({
      now: () => currentTime,
      fetchImpl: async () => {
        calls += 1
        return nbgResponse(2.6091)
      }
    })

    await provider.getRate(usdToGel)
    currentTime += 13 * 60 * 60_000
    await provider.getRate(usdToGel)

    expect(calls).toBe(2)
  })

  test('retries a transient failure and keeps the rate', async () => {
    let calls = 0
    const provider = createNbgExchangeRateProvider({
      retryDelayMs: 1,
      fetchImpl: async () => {
        calls += 1
        if (calls === 1) {
          throw new Error('socket hang up')
        }
        return nbgResponse(2.6091)
      }
    })

    const quote = await provider.getRate(usdToGel)

    expect(calls).toBe(2)
    expect(quote.rateMicros).toBe(2609100n)
  })

  test('does not cache a failure: the next lookup tries again', async () => {
    let calls = 0
    const provider = createNbgExchangeRateProvider({
      maxAttempts: 3,
      retryDelayMs: 1,
      fetchImpl: async () => {
        calls += 1
        if (calls <= 3) {
          return new Response('nope', { status: 503 })
        }
        return nbgResponse(2.6091)
      }
    })

    await expect(provider.getRate(usdToGel)).rejects.toThrow('NBG request failed: 503')

    const quote = await provider.getRate(usdToGel)

    expect(quote.rateMicros).toBe(2609100n)
    expect(calls).toBe(4)
  })

  test('does not retry a permanent client error', async () => {
    let calls = 0
    const provider = createNbgExchangeRateProvider({
      fetchImpl: async () => {
        calls += 1
        return new Response('bad date', { status: 400 })
      }
    })

    await expect(provider.getRate(usdToGel)).rejects.toThrow('NBG request failed: 400')
    expect(calls).toBe(1)
  })

  test('aborts a request that hangs past the timeout', async () => {
    let calls = 0
    const provider = createNbgExchangeRateProvider({
      requestTimeoutMs: 20,
      maxAttempts: 3,
      retryDelayMs: 1,
      fetchImpl: (_url, init) => {
        calls += 1
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
      }
    })

    await expect(provider.getRate(usdToGel)).rejects.toThrow('NBG request failed')
    expect(calls).toBe(3)
  })

  test('keeps the attempt timeout active while reading the response body', async () => {
    let calls = 0
    let abortedBodies = 0
    const provider = createNbgExchangeRateProvider({
      requestTimeoutMs: 20,
      maxAttempts: 3,
      retryDelayMs: 1,
      fetchImpl: async (_url, { signal }) => {
        calls += 1
        return new Response(
          new ReadableStream({
            start(controller) {
              // Fail the test promptly if the provider abandons its timeout after headers.
              const watchdog = setTimeout(
                () => controller.error(new Error('response body outlived the attempt timeout')),
                150
              )
              signal.addEventListener(
                'abort',
                () => {
                  clearTimeout(watchdog)
                  abortedBodies += 1
                  controller.error(new Error('aborted'))
                },
                { once: true }
              )
            }
          })
        )
      }
    })

    await expect(provider.getRate(usdToGel)).rejects.toThrow('NBG request failed')
    expect(calls).toBe(3)
    expect(abortedBodies).toBe(3)
  })

  test('bounds a stalled body even when it ignores abort and handles its late rejection', async () => {
    const bodies: ReadableStreamDefaultController<Uint8Array>[] = []
    const provider = createNbgExchangeRateProvider({
      requestTimeoutMs: 20,
      maxAttempts: 1,
      fetchImpl: async () =>
        new Response(new ReadableStream({ start: (controller) => bodies.push(controller) }))
    })
    const watchdog = setTimeout(
      () => bodies.forEach((body) => body.error(new Error('body outlived the attempt timeout'))),
      150
    )

    try {
      await expect(provider.getRate(usdToGel)).rejects.toThrow('timed out after 20ms')
    } finally {
      clearTimeout(watchdog)
      bodies.forEach((body) => body.error(new Error('late body failure')))
    }
  })

  test('does not cache a late response from a fetch that ignored abort', async () => {
    let calls = 0
    let finishLateRequest: ((response: Response) => void) | undefined
    const provider = createNbgExchangeRateProvider({
      requestTimeoutMs: 20,
      maxAttempts: 1,
      fetchImpl: () => {
        calls += 1
        if (calls === 1) {
          return new Promise((resolve) => {
            finishLateRequest = resolve
          })
        }
        return Promise.resolve(nbgResponse(2.7))
      }
    })

    await expect(provider.getRate(usdToGel)).rejects.toThrow('timed out after 20ms')
    finishLateRequest?.(nbgResponse(2.6))
    await Bun.sleep(0)

    const quote = await provider.getRate(usdToGel)
    expect(quote.rateMicros).toBe(2700000n)
    expect(calls).toBe(2)
  })

  test('bounds the default retry budget to keep an unavailable provider off the UI critical path', async () => {
    let calls = 0
    let cleaningUp = false
    const cancelRequests: (() => void)[] = []
    const provider = createNbgExchangeRateProvider({
      fetchImpl: (_url, { signal }) => {
        calls += 1
        return new Promise((_resolve, reject) => {
          const cancel = () => reject(new Error('aborted'))
          cancelRequests.push(cancel)
          if (cleaningUp) {
            cancel()
          } else {
            signal.addEventListener('abort', cancel, { once: true })
          }
        })
      }
    })
    const lookup = provider.getRate(usdToGel)
    let watchdog: ReturnType<typeof setTimeout> | undefined

    try {
      const result = await Promise.race([
        lookup.catch((error: unknown) => error),
        new Promise((resolve) => {
          watchdog = setTimeout(() => resolve('provider exceeded the UI retry budget'), 2_600)
        })
      ])
      expect(result).toBeInstanceOf(Error)
      expect(calls).toBe(2)
    } finally {
      clearTimeout(watchdog)
      cleaningUp = true
      cancelRequests.forEach((cancel) => cancel())
      await lookup.catch(() => {})
    }
  })
})
