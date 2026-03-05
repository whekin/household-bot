export interface BotRuntimeConfig {
  port: number
  telegramBotToken: string
  telegramWebhookSecret: string
  telegramWebhookPath: string
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

export function getBotRuntimeConfig(env: NodeJS.ProcessEnv = process.env): BotRuntimeConfig {
  return {
    port: parsePort(env.PORT),
    telegramBotToken: requireValue(env.TELEGRAM_BOT_TOKEN, 'TELEGRAM_BOT_TOKEN'),
    telegramWebhookSecret: requireValue(env.TELEGRAM_WEBHOOK_SECRET, 'TELEGRAM_WEBHOOK_SECRET'),
    telegramWebhookPath: env.TELEGRAM_WEBHOOK_PATH ?? '/webhook/telegram'
  }
}
