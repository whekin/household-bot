import { describe, expect, test } from 'bun:test'

import { BillingPeriod } from '@household/domain'
import type { FinanceCycleExchangeRateRecord } from '@household/ports'

import { resolveCycleExchangeRate } from './cycle-exchange-rate'

function createRepositoryStub(options: {
  cycleRate?: FinanceCycleExchangeRateRecord | null
  latestRate?: FinanceCycleExchangeRateRecord | null
}) {
  const saved: FinanceCycleExchangeRateRecord[] = []

  return {
    saved,
    async getCycleExchangeRate() {
      return options.cycleRate ?? null
    },
    async saveCycleExchangeRate(input: FinanceCycleExchangeRateRecord) {
      saved.push(input)
      return input
    },
    async getLatestExchangeRate() {
      return options.latestRate ?? null
    }
  }
}

const baseInput = {
  cycleId: 'cycle-september',
  sourceCurrency: 'USD' as const,
  targetCurrency: 'GEL' as const,
  period: BillingPeriod.fromString('2026-09'),
  lockDay: 15,
  timezone: 'Asia/Tbilisi'
}

const augustRate: FinanceCycleExchangeRateRecord = {
  cycleId: 'cycle-august',
  sourceCurrency: 'USD',
  targetCurrency: 'GEL',
  rateMicros: 2625900n,
  effectiveDate: '2026-08-15',
  source: 'nbg'
}

describe('resolveCycleExchangeRate', () => {
  test('uses the rate already locked on the cycle without calling the provider', async () => {
    let providerCalls = 0
    const repository = createRepositoryStub({
      cycleRate: { ...augustRate, cycleId: 'cycle-september', effectiveDate: '2026-09-15' }
    })

    const rate = await resolveCycleExchangeRate({
      ...baseInput,
      repository,
      exchangeRateProvider: {
        getRate: async () => {
          providerCalls += 1
          throw new Error('should not be called')
        }
      }
    })

    expect(rate).toEqual({ rateMicros: 2625900n, effectiveDate: '2026-09-15', stale: false })
    expect(providerCalls).toBe(0)
  })

  test('locks a fresh quote on the cycle once the lock date has passed', async () => {
    const repository = createRepositoryStub({})

    const rate = await resolveCycleExchangeRate({
      ...baseInput,
      repository,
      exchangeRateProvider: {
        getRate: async () => ({
          baseCurrency: 'USD',
          quoteCurrency: 'GEL',
          rateMicros: 2609100n,
          effectiveDate: '2026-09-15',
          source: 'nbg'
        })
      }
    })

    expect(rate).toEqual({ rateMicros: 2609100n, effectiveDate: '2026-09-15', stale: false })
    expect(repository.saved).toHaveLength(1)
    expect(repository.saved[0]?.rateMicros).toBe(2609100n)
  })

  test('falls back to the last stored rate when the provider is down', async () => {
    const repository = createRepositoryStub({ latestRate: augustRate })

    const rate = await resolveCycleExchangeRate({
      ...baseInput,
      repository,
      exchangeRateProvider: {
        getRate: async () => {
          throw new Error('NBG request failed: 503')
        }
      }
    })

    expect(rate).toEqual({ rateMicros: 2625900n, effectiveDate: '2026-08-15', stale: true })
  })

  test('never persists a stale fallback rate onto the cycle', async () => {
    const repository = createRepositoryStub({ latestRate: augustRate })

    await resolveCycleExchangeRate({
      ...baseInput,
      repository,
      exchangeRateProvider: {
        getRate: async () => {
          throw new Error('NBG request failed: 503')
        }
      }
    })

    expect(repository.saved).toHaveLength(0)
  })

  test('rethrows when the provider is down and nothing was ever stored', async () => {
    const repository = createRepositoryStub({})

    await expect(
      resolveCycleExchangeRate({
        ...baseInput,
        repository,
        exchangeRateProvider: {
          getRate: async () => {
            throw new Error('NBG request failed: 503')
          }
        }
      })
    ).rejects.toThrow('NBG request failed: 503')
  })
})
