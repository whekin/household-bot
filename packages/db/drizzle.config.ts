import { defineConfig } from 'drizzle-kit'

const dbCredentials = process.env.DATABASE_URL
  ? {
      url: process.env.DATABASE_URL
    }
  : undefined

export default defineConfig({
  dialect: 'postgresql',
  schema: './packages/db/src/schema.ts',
  out: './packages/db/drizzle',
  dbCredentials
})
