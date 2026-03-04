import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'

const server = {
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  APP_URL: z.string().url(),
  DATABASE_URL: z.string().url(),
  SUPABASE_URL: z.string().url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1),
  TELEGRAM_BOT_USERNAME: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  PARSER_MODEL: z.string().min(1).default('gpt-4.1-mini'),
  SENTRY_DSN: z.string().url().optional(),
  GCP_PROJECT_ID: z.string().min(1),
  GCP_REGION: z.string().min(1).default('europe-west1'),
  CLOUD_RUN_SERVICE_BOT: z.string().min(1).default('household-bot'),
  SCHEDULER_SHARED_SECRET: z.string().min(1)
}

export const env = createEnv({
  server,
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  onValidationError: (issues) => {
    console.error('Invalid environment variables:')
    console.error(JSON.stringify(issues, null, 2))
    throw new Error('Environment validation failed')
  }
})
