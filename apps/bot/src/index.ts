import { webhookCallback } from 'grammy'

import { createTelegramBot } from './bot'
import { getBotRuntimeConfig } from './config'
import { createBotWebhookServer } from './server'

const runtime = getBotRuntimeConfig()
const bot = createTelegramBot(runtime.telegramBotToken)
const webhookHandler = webhookCallback(bot, 'std/http')

const server = createBotWebhookServer({
  webhookPath: runtime.telegramWebhookPath,
  webhookSecret: runtime.telegramWebhookSecret,
  webhookHandler
})

if (import.meta.main) {
  Bun.serve({
    port: runtime.port,
    fetch: server.fetch
  })

  console.log(
    `@household/bot webhook server started on :${runtime.port} path=${runtime.telegramWebhookPath}`
  )
}

export { server }
