import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'

import { env } from '@household/config'

const queryClient = postgres(env.DATABASE_URL, {
  prepare: false,
  max: 5
})

export const db = drizzle(queryClient)
export { queryClient }
