export interface BotRuntimeConfig {
  port: number
  telegramBotToken: string
  telegramWebhookSecret: string
  telegramWebhookPath: string
  databaseUrl?: string
  householdId?: string
  telegramHouseholdChatId?: string
  telegramPurchaseTopicId?: number
  purchaseTopicIngestionEnabled: boolean
  financeCommandsEnabled: boolean
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
    throw new Error(`Invalid TELEGRAM_PURCHASE_TOPIC_ID value: ${raw}`)
  }

  return parsed
}

function parseOptionalValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : undefined
}

export function getBotRuntimeConfig(env: NodeJS.ProcessEnv = process.env): BotRuntimeConfig {
  const databaseUrl = parseOptionalValue(env.DATABASE_URL)
  const householdId = parseOptionalValue(env.HOUSEHOLD_ID)
  const telegramHouseholdChatId = parseOptionalValue(env.TELEGRAM_HOUSEHOLD_CHAT_ID)
  const telegramPurchaseTopicId = parseOptionalTopicId(env.TELEGRAM_PURCHASE_TOPIC_ID)

  const purchaseTopicIngestionEnabled =
    databaseUrl !== undefined &&
    householdId !== undefined &&
    telegramHouseholdChatId !== undefined &&
    telegramPurchaseTopicId !== undefined

  const financeCommandsEnabled = databaseUrl !== undefined && householdId !== undefined

  const runtime: BotRuntimeConfig = {
    port: parsePort(env.PORT),
    telegramBotToken: requireValue(env.TELEGRAM_BOT_TOKEN, 'TELEGRAM_BOT_TOKEN'),
    telegramWebhookSecret: requireValue(env.TELEGRAM_WEBHOOK_SECRET, 'TELEGRAM_WEBHOOK_SECRET'),
    telegramWebhookPath: env.TELEGRAM_WEBHOOK_PATH ?? '/webhook/telegram',
    purchaseTopicIngestionEnabled,
    financeCommandsEnabled,
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
  const openaiApiKey = parseOptionalValue(env.OPENAI_API_KEY)
  if (openaiApiKey !== undefined) {
    runtime.openaiApiKey = openaiApiKey
  }

  return runtime
}
