import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'

function parseOptionalCsv(value: string | undefined): readonly string[] | undefined {
  const trimmed = value?.trim()

  if (!trimmed) {
    return undefined
  }

  return trimmed
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

const server = {
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url(),
  HOUSEHOLD_ID: z.string().uuid().optional(),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1),
  TELEGRAM_WEBHOOK_PATH: z.string().min(1).default('/webhook/telegram'),
  TELEGRAM_HOUSEHOLD_CHAT_ID: z.string().min(1).optional(),
  TELEGRAM_PURCHASE_TOPIC_ID: z.coerce.number().int().positive().optional(),
  TELEGRAM_FEEDBACK_TOPIC_ID: z.coerce.number().int().positive().optional(),
  MINI_APP_ALLOWED_ORIGINS: z
    .string()
    .optional()
    .transform((value) => parseOptionalCsv(value)),
  SCHEDULER_OIDC_ALLOWED_EMAILS: z
    .string()
    .optional()
    .transform((value) => parseOptionalCsv(value)),
  OPENAI_API_KEY: z.string().min(1).optional(),
  PARSER_MODEL: z.string().min(1).default('gpt-4.1-mini'),
  SENTRY_DSN: z.string().url().optional(),
  GCP_PROJECT_ID: z.string().min(1).optional(),
  GCP_REGION: z.string().min(1).default('europe-west1'),
  CLOUD_RUN_SERVICE_BOT: z.string().min(1).default('household-bot'),
  SCHEDULER_SHARED_SECRET: z.string().min(1).optional()
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
