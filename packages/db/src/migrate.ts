import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import path from 'path'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set')
}

const dbSchema = process.env.DB_SCHEMA || 'public'

console.log(`Running migrations for schema: ${dbSchema}...`)

const migrationClient = postgres(databaseUrl, {
  max: 1,
  onnotice: () => {}
})

// Explicitly set search_path to the target schema
// This ensures that 'CREATE TABLE "x"' goes into the right schema
await migrationClient.unsafe(`SET search_path TO ${dbSchema}`)

const db = drizzle(migrationClient)

// This runs migrations from the 'drizzle' folder
await migrate(db, {
  migrationsFolder: path.resolve(__dirname, '../drizzle'),
  migrationsSchema: dbSchema,
  migrationsTable: '__drizzle_migrations'
})

console.log('Migrations applied successfully!')
await migrationClient.end()
process.exit(0)
