import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'

export interface DbClientOptions {
  /**
   * Give this client its own pool instead of the shared one. Tests use it to keep a
   * single connection they can reason about; production code should not need it.
   */
  dedicated?: boolean
  max?: number
  prepare?: boolean
}

export interface DbClient {
  db: ReturnType<typeof drizzle>
  queryClient: ReturnType<typeof postgres>
  /**
   * Release this client's hold on the pool. The shared pool is reference counted, so
   * it only really closes once every repository built on it has released.
   */
  close: (options?: { timeout?: number }) => Promise<void>
}

interface PooledClient {
  db: ReturnType<typeof drizzle>
  queryClient: ReturnType<typeof postgres>
  refs: number
}

// Every repository used to build its own pool, so a single bot process opened one pool
// per repository plus one more per household — dozens of connections against a database
// that hands out a limited number, and a fresh TCP/TLS handshake the first time each
// one was touched. They all talk to the same database, so they share one pool.
const sharedPools = new Map<string, PooledClient>()

function connectionSettings(databaseUrl: string): { key: string; url: string } {
  const dbSchema = process.env.DB_SCHEMA || 'public'
  const url = new URL(databaseUrl)

  // Remove schema and options params to avoid conflicts
  url.searchParams.delete('schema')
  url.searchParams.delete('options')

  // Set search_path via options parameter (required for PgBouncer compatibility)
  url.searchParams.set('options', `-c search_path=${dbSchema}`)

  const cleanUrl = url.toString()

  return { key: `${dbSchema}|${cleanUrl}`, url: cleanUrl }
}

function openPool(url: string, options: DbClientOptions) {
  const queryClient = postgres(url, {
    max: options.max ?? Number(process.env.DB_POOL_MAX ?? '10'),
    prepare: options.prepare ?? false,
    onnotice: () => {},
    transform: {
      ...postgres.camel,
      undefined: null
    }
  })

  return { queryClient, db: drizzle(queryClient) }
}

export function createDbClient(databaseUrl: string, options: DbClientOptions = {}): DbClient {
  const { key, url } = connectionSettings(databaseUrl)

  if (options.dedicated) {
    const { db, queryClient } = openPool(url, options)

    return {
      db,
      queryClient,
      close: (closeOptions) => queryClient.end({ timeout: closeOptions?.timeout ?? 5 })
    }
  }

  const existing = sharedPools.get(key)
  const pooled = existing ?? { ...openPool(url, options), refs: 0 }
  pooled.refs += 1
  sharedPools.set(key, pooled)

  let released = false

  return {
    db: pooled.db,
    queryClient: pooled.queryClient,
    close: async (closeOptions) => {
      // Repositories are closed independently and shutdown paths can run twice, so a
      // repeated release must not drop somebody else's reference.
      if (released) {
        return
      }
      released = true
      pooled.refs -= 1
      if (pooled.refs > 0) {
        return
      }

      sharedPools.delete(key)
      await pooled.queryClient.end({ timeout: closeOptions?.timeout ?? 5 })
    }
  }
}
