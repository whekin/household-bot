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
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<{ response: Response; payload: TPayload }> {
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {})
  })

  const payload = (await response.json()) as TPayload

  return { response, payload }
}

// Bound reads so a lost response can leave loading and offer a retry. Financial writes
// deliberately use postMiniApp without a timeout: aborting cannot undo a saved payment.
export async function readMiniApp<TPayload extends MiniAppErrorPayload>(
  path: string,
  body: Record<string, unknown>,
  timeoutMs = 8_000
): Promise<{ response: Response; payload: TPayload }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await postMiniApp<TPayload>(path, body, controller.signal)
  } catch (error) {
    if (controller.signal.aborted) {
      throw new MiniAppApiError('The request timed out. Please try again.', {
        status: 408,
        code: 'request_failed'
      })
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

export function shouldRetryMiniAppQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof MiniAppApiError && error.status >= 400 && error.status < 500) {
    return false
  }
  return failureCount < 1
}
