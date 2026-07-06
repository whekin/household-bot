import { runtimeBotApiUrl } from '../runtime-config'

export function apiBaseUrl(): string {
  const runtimeConfigured = runtimeBotApiUrl()
  if (runtimeConfigured) {
    return runtimeConfigured.replace(/\/$/, '')
  }

  const configured = import.meta.env.VITE_BOT_API_URL?.trim()

  if (configured) {
    return configured.replace(/\/$/, '')
  }

  if (import.meta.env.DEV) {
    return 'http://localhost:3000'
  }

  return window.location.origin
}

export type MiniAppErrorPayload = {
  error?: string
}

export class MiniAppApiError extends Error {
  readonly status: number
  readonly code: 'session_expired' | 'request_failed'

  constructor(
    message: string,
    options: {
      status: number
      code: 'session_expired' | 'request_failed'
    }
  ) {
    super(message)
    this.name = 'MiniAppApiError'
    this.status = options.status
    this.code = options.code
  }
}

export function isMiniAppSessionExpiredError(error: unknown): boolean {
  return error instanceof MiniAppApiError && error.code === 'session_expired'
}

export function miniAppApiError(
  response: Response,
  payload: MiniAppErrorPayload,
  fallbackMessage: string
): MiniAppApiError {
  const message = payload.error ?? fallbackMessage
  const sessionExpired = response.status === 401 && message === 'Invalid Telegram init data'

  return new MiniAppApiError(message, {
    status: response.status,
    code: sessionExpired ? 'session_expired' : 'request_failed'
  })
}

export async function postMiniApp<TPayload extends MiniAppErrorPayload>(
  path: string,
  body: Record<string, unknown>
): Promise<{ response: Response; payload: TPayload }> {
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  })

  const payload = (await response.json()) as TPayload

  return { response, payload }
}
