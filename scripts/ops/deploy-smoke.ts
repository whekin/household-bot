function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`${name} is required`)
  }

  return value
}

function toUrl(base: string, path: string): URL {
  const normalizedBase = base.endsWith('/') ? base : `${base}/`
  return new URL(path.replace(/^\//, ''), normalizedBase)
}

async function expectStatus(url: URL, init: RequestInit, expectedStatus: number): Promise<any> {
  const response = await fetch(url, init)
  const text = await response.text()

  if (response.status !== expectedStatus) {
    throw new Error(
      `${url.toString()} expected ${expectedStatus}, received ${response.status}: ${text}`
    )
  }

  if (text.length === 0) {
    return null
  }

  // The bot answers routing/auth failures with a plain-text body, so only the
  // status matters once it matches; callers that need a payload check it themselves.
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

async function fetchWebhookInfo(botToken: string): Promise<any> {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`)
  const payload = (await response.json()) as {
    ok?: boolean
    result?: unknown
  }

  if (!response.ok || payload.ok !== true) {
    throw new Error(`Telegram getWebhookInfo failed: ${JSON.stringify(payload)}`)
  }

  return payload.result
}

async function run(): Promise<void> {
  const botApiUrl = requireEnv('BOT_API_URL')
  const miniAppUrl = requireEnv('MINI_APP_URL')

  const health = await expectStatus(toUrl(botApiUrl, '/healthz'), {}, 200)
  if (health?.ok !== true) {
    throw new Error('Bot health check returned unexpected payload')
  }

  await expectStatus(
    toUrl(botApiUrl, '/api/miniapp/session'),
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({})
    },
    400
  )

  await expectStatus(
    toUrl(botApiUrl, '/jobs/dispatch/test-dispatch'),
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify({})
    },
    401
  )

  const miniAppResponse = await fetch(miniAppUrl)
  const miniAppHtml = await miniAppResponse.text()
  if (!miniAppResponse.ok) {
    throw new Error(`Mini app root returned ${miniAppResponse.status}`)
  }
  if (!miniAppHtml.includes('/config.js')) {
    throw new Error('Mini app root does not reference runtime config')
  }

  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN?.trim()
  const expectedWebhookUrl = process.env.TELEGRAM_EXPECTED_WEBHOOK_URL?.trim()

  if (telegramBotToken && expectedWebhookUrl) {
    const webhookInfo = await fetchWebhookInfo(telegramBotToken)

    if (webhookInfo.url !== expectedWebhookUrl) {
      throw new Error(
        `Telegram webhook mismatch: expected ${expectedWebhookUrl}, received ${webhookInfo.url}`
      )
    }

    if (
      typeof webhookInfo.last_error_message === 'string' &&
      webhookInfo.last_error_message.length > 0
    ) {
      throw new Error(
        `Telegram webhook reports last_error_message=${webhookInfo.last_error_message}`
      )
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        botApiUrl,
        miniAppUrl,
        checkedWebhook: telegramBotToken !== undefined && expectedWebhookUrl !== undefined
      },
      null,
      2
    )
  )
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
