import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'

export interface DbClientOptions {
  max?: number
  prepare?: boolean
}

export function createDbClient(databaseUrl: string, options: DbClientOptions = {}) {
  const dbSchema = process.env.DB_SCHEMA || 'public'

  // Parse and clean the URL to set search_path properly
  const url = new URL(databaseUrl)

  // Remove schema and options params to avoid conflicts
  url.searchParams.delete('schema')
  url.searchParams.delete('options')

  // Set search_path via options parameter (required for PgBouncer compatibility)
  url.searchParams.set('options', `-c search_path=${dbSchema}`)

  const cleanUrl = url.toString()

  const queryClient = postgres(cleanUrl, {
    max: options.max ?? 5,
    prepare: options.prepare ?? false,
    onnotice: () => {},
    transform: {
      ...postgres.camel,
      undefined: null
    }
  })

  const db = drizzle(queryClient)

  return {
    db,
    queryClient
  }
}
