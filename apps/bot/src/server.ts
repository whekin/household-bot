export interface BotWebhookServerOptions {
  webhookPath: string
  webhookSecret: string
  webhookHandler: (request: Request) => Promise<Response> | Response
  miniAppAuth?:
    | {
        path?: string
        handler: (request: Request) => Promise<Response>
      }
    | undefined
  miniAppDashboard?:
    | {
        path?: string
        handler: (request: Request) => Promise<Response>
      }
    | undefined
  miniAppJoin?:
    | {
        path?: string
        handler: (request: Request) => Promise<Response>
      }
    | undefined
  miniAppPendingMembers?:
    | {
        path?: string
        handler: (request: Request) => Promise<Response>
      }
    | undefined
  miniAppApproveMember?:
    | {
        path?: string
        handler: (request: Request) => Promise<Response>
      }
    | undefined
  miniAppLocalePreference?:
    | {
        path?: string
        handler: (request: Request) => Promise<Response>
      }
    | undefined
  scheduler?:
    | {
        pathPrefix?: string
        authorize: (request: Request) => Promise<boolean>
        handler: (request: Request, reminderType: string) => Promise<Response>
      }
    | undefined
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
  const miniAppAuthPath = options.miniAppAuth?.path ?? '/api/miniapp/session'
  const miniAppDashboardPath = options.miniAppDashboard?.path ?? '/api/miniapp/dashboard'
  const miniAppJoinPath = options.miniAppJoin?.path ?? '/api/miniapp/join'
  const miniAppPendingMembersPath =
    options.miniAppPendingMembers?.path ?? '/api/miniapp/admin/pending-members'
  const miniAppApproveMemberPath =
    options.miniAppApproveMember?.path ?? '/api/miniapp/admin/approve-member'
  const miniAppLocalePreferencePath =
    options.miniAppLocalePreference?.path ?? '/api/miniapp/preferences/locale'
  const schedulerPathPrefix = options.scheduler
    ? (options.scheduler.pathPrefix ?? '/jobs/reminder')
    : null

  return {
    fetch: async (request: Request) => {
      const url = new URL(request.url)

      if (url.pathname === '/healthz') {
        return json({ ok: true })
      }

      if (options.miniAppAuth && url.pathname === miniAppAuthPath) {
        return await options.miniAppAuth.handler(request)
      }

      if (options.miniAppDashboard && url.pathname === miniAppDashboardPath) {
        return await options.miniAppDashboard.handler(request)
      }

      if (options.miniAppJoin && url.pathname === miniAppJoinPath) {
        return await options.miniAppJoin.handler(request)
      }

      if (options.miniAppPendingMembers && url.pathname === miniAppPendingMembersPath) {
        return await options.miniAppPendingMembers.handler(request)
      }

      if (options.miniAppApproveMember && url.pathname === miniAppApproveMemberPath) {
        return await options.miniAppApproveMember.handler(request)
      }

      if (options.miniAppLocalePreference && url.pathname === miniAppLocalePreferencePath) {
        return await options.miniAppLocalePreference.handler(request)
      }

      if (url.pathname !== normalizedWebhookPath) {
        if (schedulerPathPrefix && url.pathname.startsWith(`${schedulerPathPrefix}/`)) {
          if (request.method !== 'POST') {
            return new Response('Method Not Allowed', { status: 405 })
          }

          if (!(await options.scheduler!.authorize(request))) {
            return new Response('Unauthorized', { status: 401 })
          }

          const reminderType = url.pathname.slice(`${schedulerPathPrefix}/`.length)
          return await options.scheduler!.handler(request, reminderType)
        }

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
