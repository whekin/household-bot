import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'

export interface DbClientOptions {
  max?: number
  prepare?: boolean
}

export function createDbClient(databaseUrl: string, options: DbClientOptions = {}) {
  const queryClient = postgres(databaseUrl, {
    max: options.max ?? 5,
    prepare: options.prepare ?? false
  })

  const db = drizzle(queryClient)

  return {
    db,
    queryClient
  }
}
