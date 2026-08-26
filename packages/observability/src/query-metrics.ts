import { AsyncLocalStorage } from 'node:async_hooks'

export interface QueryMetricsSnapshot {
  /** Repository calls that actually reached the database. */
  queryCount: number
  /** Wall time spent inside those calls, in milliseconds. */
  queryMs: number
  /** Per-method counts, so a hot spot is identifiable without a profiler. */
  byMethod: Record<string, number>
}

interface QueryMetricsState {
  queryCount: number
  queryMs: number
  byMethod: Map<string, number>
}

const storage = new AsyncLocalStorage<QueryMetricsState>()

/**
 * Collect database timings for the duration of one request or one Telegram update.
 *
 * Callers outside a context are unaffected: `recordQuery` becomes a no-op, so
 * instrumented repositories are safe to use from scripts and tests.
 */
export async function withQueryMetrics<T>(
  run: () => Promise<T>
): Promise<{ result: T; metrics: QueryMetricsSnapshot }> {
  const state: QueryMetricsState = { queryCount: 0, queryMs: 0, byMethod: new Map() }
  const result = await storage.run(state, run)

  return { result, metrics: snapshot(state) }
}

export function recordQuery(method: string, durationMs: number): void {
  const state = storage.getStore()
  if (!state) {
    return
  }

  state.queryCount += 1
  state.queryMs += durationMs
  state.byMethod.set(method, (state.byMethod.get(method) ?? 0) + 1)
}

export function currentQueryMetrics(): QueryMetricsSnapshot | undefined {
  const state = storage.getStore()

  return state ? snapshot(state) : undefined
}

function snapshot(state: QueryMetricsState): QueryMetricsSnapshot {
  return {
    queryCount: state.queryCount,
    queryMs: Math.round(state.queryMs),
    byMethod: Object.fromEntries(
      // Loudest first — a long tail of single calls is rarely the problem.
      [...state.byMethod.entries()].sort(([, left], [, right]) => right - left)
    )
  }
}

/**
 * Wrap a repository so every method call is timed into the active metrics context.
 *
 * Apply this at the adapter boundary, below any caching layer, so what gets counted is
 * real database work rather than cache hits.
 */
export function instrumentRepository<T extends object>(label: string, repository: T): T {
  const wrapped = new Map<PropertyKey, unknown>()

  return new Proxy(repository, {
    get(source, property, receiver) {
      const value = Reflect.get(source, property, receiver)
      if (typeof value !== 'function' || typeof property !== 'string') {
        return value
      }

      const cached = wrapped.get(property)
      if (cached) {
        return cached
      }

      const method = `${label}.${property}`
      const instrumented = (...args: unknown[]) => {
        // Skip the timing machinery entirely when nothing is collecting.
        if (!storage.getStore()) {
          return value.apply(source, args)
        }

        const startedAt = performance.now()
        let settled = false
        const finish = () => {
          if (settled) {
            return
          }
          settled = true
          recordQuery(method, performance.now() - startedAt)
        }

        try {
          const outcome = value.apply(source, args)
          if (outcome instanceof Promise) {
            return outcome.finally(finish)
          }
          finish()
          return outcome
        } catch (error) {
          finish()
          throw error
        }
      }

      wrapped.set(property, instrumented)
      return instrumented
    }
  })
}
