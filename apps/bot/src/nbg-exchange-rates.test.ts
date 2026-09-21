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
})
