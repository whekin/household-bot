export interface BotRuntimeConfig {
  port: number
  logLevel: 'debug' | 'info' | 'warn' | 'error'
  telegramBotToken: string
  telegramWebhookSecret: string
  telegramWebhookPath: string
  databaseUrl?: string
  householdId?: string
  telegramHouseholdChatId?: string
  telegramPurchaseTopicId?: number
  telegramFeedbackTopicId?: number
  purchaseTopicIngestionEnabled: boolean
  financeCommandsEnabled: boolean
  anonymousFeedbackEnabled: boolean
  miniAppAllowedOrigins: readonly string[]
  miniAppAuthEnabled: boolean
  schedulerSharedSecret?: string
  schedulerOidcAllowedEmails: readonly string[]
  reminderJobsEnabled: boolean
  openaiApiKey?: string
  parserModel: string
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

function parseOptionalTopicId(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined
  }

  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid Telegram topic id value: ${raw}`)
  }

  return parsed
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

export function getBotRuntimeConfig(env: NodeJS.ProcessEnv = process.env): BotRuntimeConfig {
  const databaseUrl = parseOptionalValue(env.DATABASE_URL)
  const householdId = parseOptionalValue(env.HOUSEHOLD_ID)
  const telegramHouseholdChatId = parseOptionalValue(env.TELEGRAM_HOUSEHOLD_CHAT_ID)
  const telegramPurchaseTopicId = parseOptionalTopicId(env.TELEGRAM_PURCHASE_TOPIC_ID)
  const telegramFeedbackTopicId = parseOptionalTopicId(env.TELEGRAM_FEEDBACK_TOPIC_ID)
  const schedulerSharedSecret = parseOptionalValue(env.SCHEDULER_SHARED_SECRET)
  const schedulerOidcAllowedEmails = parseOptionalCsv(env.SCHEDULER_OIDC_ALLOWED_EMAILS)
  const miniAppAllowedOrigins = parseOptionalCsv(env.MINI_APP_ALLOWED_ORIGINS)

  const purchaseTopicIngestionEnabled = databaseUrl !== undefined

  const financeCommandsEnabled = databaseUrl !== undefined
  const anonymousFeedbackEnabled = databaseUrl !== undefined
  const miniAppAuthEnabled = databaseUrl !== undefined
  const hasSchedulerOidcConfig = schedulerOidcAllowedEmails.length > 0
  const reminderJobsEnabled =
    databaseUrl !== undefined &&
    householdId !== undefined &&
    (schedulerSharedSecret !== undefined || hasSchedulerOidcConfig)

  const runtime: BotRuntimeConfig = {
    port: parsePort(env.PORT),
    logLevel: parseLogLevel(env.LOG_LEVEL),
    telegramBotToken: requireValue(env.TELEGRAM_BOT_TOKEN, 'TELEGRAM_BOT_TOKEN'),
    telegramWebhookSecret: requireValue(env.TELEGRAM_WEBHOOK_SECRET, 'TELEGRAM_WEBHOOK_SECRET'),
    telegramWebhookPath: env.TELEGRAM_WEBHOOK_PATH ?? '/webhook/telegram',
    purchaseTopicIngestionEnabled,
    financeCommandsEnabled,
    anonymousFeedbackEnabled,
    miniAppAllowedOrigins,
    miniAppAuthEnabled,
    schedulerOidcAllowedEmails,
    reminderJobsEnabled,
    parserModel: env.PARSER_MODEL?.trim() || 'gpt-4.1-mini'
  }

  if (databaseUrl !== undefined) {
    runtime.databaseUrl = databaseUrl
  }
  if (householdId !== undefined) {
    runtime.householdId = householdId
  }
  if (telegramHouseholdChatId !== undefined) {
    runtime.telegramHouseholdChatId = telegramHouseholdChatId
  }
  if (telegramPurchaseTopicId !== undefined) {
    runtime.telegramPurchaseTopicId = telegramPurchaseTopicId
  }
  if (telegramFeedbackTopicId !== undefined) {
    runtime.telegramFeedbackTopicId = telegramFeedbackTopicId
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
