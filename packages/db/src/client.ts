import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'

export interface DbSessionContext {
  telegramUserId?: string
  householdId?: string
  memberId?: string
  isAdmin?: boolean
  isWorker?: boolean
}

export interface DbClientOptions {
  max?: number
  prepare?: boolean
  sessionContext?: DbSessionContext
}

function quoteRuntimeOptionValue(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
}

function appendRuntimeOption(
  options: string[],
  key: string,
  value: string | boolean | undefined
): void {
  if (value === undefined) {
    return
  }

  options.push(`-c ${key}=${quoteRuntimeOptionValue(String(value))}`)
}

export function createDbClient(databaseUrl: string, options: DbClientOptions = {}) {
  const dbSchema = process.env.DB_SCHEMA || 'public'

  // Parse and clean the URL to set search_path properly
  const url = new URL(databaseUrl)

  // Remove schema and options params to avoid conflicts
  url.searchParams.delete('schema')
  url.searchParams.delete('options')

  // Set search_path via options parameter (required for PgBouncer compatibility)
  const runtimeOptions = [`-c search_path=${dbSchema}`]
  appendRuntimeOption(
    runtimeOptions,
    'app.telegram_user_id',
    options.sessionContext?.telegramUserId
  )
  appendRuntimeOption(runtimeOptions, 'app.household_id', options.sessionContext?.householdId)
  appendRuntimeOption(runtimeOptions, 'app.member_id', options.sessionContext?.memberId)
  appendRuntimeOption(runtimeOptions, 'app.is_admin', options.sessionContext?.isAdmin)
  appendRuntimeOption(runtimeOptions, 'app.is_worker', options.sessionContext?.isWorker)
  url.searchParams.set('options', runtimeOptions.join(' '))

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
