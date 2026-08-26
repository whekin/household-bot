import { describe, expect, test } from 'bun:test'

import { currentQueryMetrics, instrumentRepository, withQueryMetrics } from './query-metrics'

function createRepository() {
  return {
    calls: 0,
    async listThings(): Promise<readonly string[]> {
      this.calls += 1
      await new Promise((resolve) => setTimeout(resolve, 5))
      return ['a']
    },
    async explode(): Promise<never> {
      await new Promise((resolve) => setTimeout(resolve, 1))
      throw new Error('boom')
    },
    plainValue: 7
  }
}

describe('query metrics', () => {
  test('counts and times instrumented calls inside a context', async () => {
    const repository = instrumentRepository('things', createRepository())

    const { result, metrics } = await withQueryMetrics(async () => {
      await repository.listThings()
      await repository.listThings()
      return 'done'
    })

    expect(result).toBe('done')
    expect(metrics.queryCount).toBe(2)
    expect(metrics.queryMs).toBeGreaterThanOrEqual(5)
    expect(metrics.byMethod).toEqual({ 'things.listThings': 2 })
  })

  test('counts a failed call and still lets the error through', async () => {
    const repository = instrumentRepository('things', createRepository())

    const { metrics } = await withQueryMetrics(async () => {
      await expect(repository.explode()).rejects.toThrow('boom')
    })

    expect(metrics.byMethod).toEqual({ 'things.explode': 1 })
  })

  test('is inert outside a context so scripts and tests are unaffected', async () => {
    const underlying = createRepository()
    const repository = instrumentRepository('things', underlying)

    await repository.listThings()

    expect(underlying.calls).toBe(1)
    expect(currentQueryMetrics()).toBeUndefined()
  })

  test('keeps non-function members reachable', () => {
    expect(instrumentRepository('things', createRepository()).plainValue).toBe(7)
  })

  test('does not leak counts between concurrent contexts', async () => {
    const repository = instrumentRepository('things', createRepository())

    const [first, second] = await Promise.all([
      withQueryMetrics(async () => {
        await repository.listThings()
      }),
      withQueryMetrics(async () => {
        await repository.listThings()
        await repository.listThings()
      })
    ])

    expect(first.metrics.queryCount).toBe(1)
    expect(second.metrics.queryCount).toBe(2)
  })
})
