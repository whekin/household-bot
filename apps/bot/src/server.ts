export interface BotWebhookServerOptions {
  webhookPath: string
  webhookSecret: string
  webhookHandler: (request: Request) => Promise<Response> | Response
}

function json(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8'
    }
  })
}

function isAuthorized(request: Request, expectedSecret: string): boolean {
  const secretHeader = request.headers.get('x-telegram-bot-api-secret-token')

  return secretHeader === expectedSecret
}

export function createBotWebhookServer(options: BotWebhookServerOptions): {
  fetch: (request: Request) => Promise<Response>
} {
  const normalizedWebhookPath = options.webhookPath.startsWith('/')
    ? options.webhookPath
    : `/${options.webhookPath}`

  return {
    fetch: async (request: Request) => {
      const url = new URL(request.url)

      if (url.pathname === '/healthz') {
        return json({ ok: true })
      }

      if (url.pathname !== normalizedWebhookPath) {
        return new Response('Not Found', { status: 404 })
      }

      if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 })
      }

      if (!isAuthorized(request, options.webhookSecret)) {
        return new Response('Unauthorized', { status: 401 })
      }

      return await options.webhookHandler(request)
    }
  }
}
