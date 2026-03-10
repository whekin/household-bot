export interface BotRuntimeConfig {
  port: number
  logLevel: 'debug' | 'info' | 'warn' | 'error'
  telegramBotToken: string
  telegramWebhookSecret: string
  telegramWebhookPath: string
  databaseUrl?: string
  purchaseTopicIngestionEnabled: boolean
  financeCommandsEnabled: boolean
  anonymousFeedbackEnabled: boolean
  assistantEnabled: boolean
  miniAppAllowedOrigins: readonly string[]
  miniAppAuthEnabled: boolean
  schedulerSharedSecret?: string
  schedulerOidcAllowedEmails: readonly string[]
  reminderJobsEnabled: boolean
  openaiApiKey?: string
  parserModel: string
  purchaseParserModel: string
  assistantModel: string
  assistantTimeoutMs: number
  assistantMemoryMaxTurns: number
  assistantRateLimitBurst: number
  assistantRateLimitBurstWindowMs: number
  assistantRateLimitRolling: number
  assistantRateLimitRollingWindowMs: number
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined) {
    return 3000
  }

  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`Invalid PORT value: ${raw}`)
  }

  return parsed
}

function parseLogLevel(raw: string | undefined): 'debug' | 'info' | 'warn' | 'error' {
  if (raw === undefined) {
    return 'info'
  }

  const normalized = raw.trim().toLowerCase()

  if (
    normalized === 'debug' ||
    normalized === 'info' ||
    normalized === 'warn' ||
    normalized === 'error'
  ) {
    return normalized
  }

  throw new Error(`Invalid LOG_LEVEL value: ${raw}`)
}

function requireValue(value: string | undefined, key: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`${key} environment variable is required`)
  }

  return value
}

function parseOptionalValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : undefined
}

function parseOptionalCsv(value: string | undefined): readonly string[] {
  const trimmed = value?.trim()

  if (!trimmed) {
    return []
  }

  return trimmed
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function parsePositiveInteger(raw: string | undefined, fallback: number, key: string): number {
  if (raw === undefined) {
    return fallback
  }

  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${key} value: ${raw}`)
  }

  return parsed
}

export function getBotRuntimeConfig(env: NodeJS.ProcessEnv = process.env): BotRuntimeConfig {
  const databaseUrl = parseOptionalValue(env.DATABASE_URL)
  const schedulerSharedSecret = parseOptionalValue(env.SCHEDULER_SHARED_SECRET)
  const schedulerOidcAllowedEmails = parseOptionalCsv(env.SCHEDULER_OIDC_ALLOWED_EMAILS)
  const miniAppAllowedOrigins = parseOptionalCsv(env.MINI_APP_ALLOWED_ORIGINS)

  const purchaseTopicIngestionEnabled = databaseUrl !== undefined

  const financeCommandsEnabled = databaseUrl !== undefined
  const anonymousFeedbackEnabled = databaseUrl !== undefined
  const assistantEnabled = databaseUrl !== undefined
  const miniAppAuthEnabled = databaseUrl !== undefined
  const hasSchedulerOidcConfig = schedulerOidcAllowedEmails.length > 0
  const reminderJobsEnabled =
    databaseUrl !== undefined && (schedulerSharedSecret !== undefined || hasSchedulerOidcConfig)

  const runtime: BotRuntimeConfig = {
    port: parsePort(env.PORT),
    logLevel: parseLogLevel(env.LOG_LEVEL),
    telegramBotToken: requireValue(env.TELEGRAM_BOT_TOKEN, 'TELEGRAM_BOT_TOKEN'),
    telegramWebhookSecret: requireValue(env.TELEGRAM_WEBHOOK_SECRET, 'TELEGRAM_WEBHOOK_SECRET'),
    telegramWebhookPath: env.TELEGRAM_WEBHOOK_PATH ?? '/webhook/telegram',
    purchaseTopicIngestionEnabled,
    financeCommandsEnabled,
    anonymousFeedbackEnabled,
    assistantEnabled,
    miniAppAllowedOrigins,
    miniAppAuthEnabled,
    schedulerOidcAllowedEmails,
    reminderJobsEnabled,
    parserModel: env.PARSER_MODEL?.trim() || 'gpt-4.1-mini',
    purchaseParserModel:
      env.PURCHASE_PARSER_MODEL?.trim() || env.PARSER_MODEL?.trim() || 'gpt-5-mini',
    assistantModel: env.ASSISTANT_MODEL?.trim() || 'gpt-5-mini',
    assistantTimeoutMs: parsePositiveInteger(
      env.ASSISTANT_TIMEOUT_MS,
      20_000,
      'ASSISTANT_TIMEOUT_MS'
    ),
    assistantMemoryMaxTurns: parsePositiveInteger(
      env.ASSISTANT_MEMORY_MAX_TURNS,
      12,
      'ASSISTANT_MEMORY_MAX_TURNS'
    ),
    assistantRateLimitBurst: parsePositiveInteger(
      env.ASSISTANT_RATE_LIMIT_BURST,
      5,
      'ASSISTANT_RATE_LIMIT_BURST'
    ),
    assistantRateLimitBurstWindowMs: parsePositiveInteger(
      env.ASSISTANT_RATE_LIMIT_BURST_WINDOW_MS,
      60_000,
      'ASSISTANT_RATE_LIMIT_BURST_WINDOW_MS'
    ),
    assistantRateLimitRolling: parsePositiveInteger(
      env.ASSISTANT_RATE_LIMIT_ROLLING,
      50,
      'ASSISTANT_RATE_LIMIT_ROLLING'
    ),
    assistantRateLimitRollingWindowMs: parsePositiveInteger(
      env.ASSISTANT_RATE_LIMIT_ROLLING_WINDOW_MS,
      86_400_000,
      'ASSISTANT_RATE_LIMIT_ROLLING_WINDOW_MS'
    )
  }

  if (databaseUrl !== undefined) {
    runtime.databaseUrl = databaseUrl
  }
  if (schedulerSharedSecret !== undefined) {
    runtime.schedulerSharedSecret = schedulerSharedSecret
  }
  const openaiApiKey = parseOptionalValue(env.OPENAI_API_KEY)
  if (openaiApiKey !== undefined) {
    runtime.openaiApiKey = openaiApiKey
  }

  return runtime
}
