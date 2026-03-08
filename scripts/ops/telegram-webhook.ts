type WebhookCommand = 'info' | 'set' | 'delete'

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`${name} is required`)
  }

  return value
}

function parseCommand(raw: string | undefined): WebhookCommand {
  const command = raw?.trim() || 'info'

  if (command === 'info' || command === 'set' || command === 'delete') {
    return command
  }

  throw new Error(`Unsupported command: ${command}`)
}

async function telegramRequest<T>(
  botToken: string,
  method: string,
  body?: URLSearchParams
): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: body ? 'POST' : 'GET',
    body
  })

  const payload = (await response.json()) as {
    ok?: boolean
    result?: unknown
  }
  if (!response.ok || payload.ok !== true) {
    throw new Error(`Telegram ${method} failed: ${JSON.stringify(payload)}`)
  }

  return payload.result as T
}

async function run(): Promise<void> {
  const command = parseCommand(process.argv[2])
  const botToken = requireEnv('TELEGRAM_BOT_TOKEN')

  switch (command) {
    case 'info': {
      const result = await telegramRequest(botToken, 'getWebhookInfo')
      console.log(JSON.stringify(result, null, 2))
      return
    }
    case 'set': {
      const params = new URLSearchParams({
        url: requireEnv('TELEGRAM_WEBHOOK_URL')
      })

      const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET?.trim()
      if (secretToken) {
        params.set('secret_token', secretToken)
      }

      const maxConnections = process.env.TELEGRAM_MAX_CONNECTIONS?.trim()
      if (maxConnections) {
        params.set('max_connections', maxConnections)
      }

      const dropPendingUpdates = process.env.TELEGRAM_DROP_PENDING_UPDATES?.trim()
      if (dropPendingUpdates) {
        params.set('drop_pending_updates', dropPendingUpdates)
      }

      const result = await telegramRequest(botToken, 'setWebhook', params)
      console.log(JSON.stringify({ ok: true, result }, null, 2))
      return
    }
    case 'delete': {
      const params = new URLSearchParams()
      const dropPendingUpdates = process.env.TELEGRAM_DROP_PENDING_UPDATES?.trim()
      if (dropPendingUpdates) {
        params.set('drop_pending_updates', dropPendingUpdates)
      }

      const result = await telegramRequest(botToken, 'deleteWebhook', params)
      console.log(JSON.stringify({ ok: true, result }, null, 2))
      return
    }
    default:
      throw new Error(`Unsupported command: ${command}`)
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
