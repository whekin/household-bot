import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'

export interface DbClientOptions {
  max?: number
  prepare?: boolean
}

export function createDbClient(databaseUrl: string, options: DbClientOptions = {}) {
  const dbSchema = process.env.DB_SCHEMA || 'public'

  const queryClient = postgres(databaseUrl, {
    max: options.max ?? 5,
    prepare: options.prepare ?? false,
    onnotice: () => {},
    connection: {
      search_path: dbSchema
    },
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
