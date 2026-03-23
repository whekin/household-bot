export interface LambdaFunctionUrlRequest {
  version: '2.0'
  rawPath: string
  rawQueryString?: string
  headers?: Record<string, string | undefined>
  cookies?: string[]
  body?: string
  isBase64Encoded?: boolean
  requestContext: {
    domainName?: string
    http: {
      method: string
    }
  }
}

export interface LambdaFunctionUrlResponse {
  statusCode: number
  headers?: Record<string, string>
  cookies?: string[]
  body: string
  isBase64Encoded?: boolean
}

function normalizeHeaders(
  headers: Record<string, string | undefined> | undefined
): Record<string, string> {
  const normalized: Record<string, string> = {}

  if (!headers) {
    return normalized
  }

  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue
    }

    normalized[key] = value
  }

  return normalized
}

function requestUrl(event: LambdaFunctionUrlRequest): string {
  const headers = normalizeHeaders(event.headers)
  const host = headers.host || event.requestContext.domainName || 'lambda-url.local'
  const protocol = headers['x-forwarded-proto'] || 'https'
  const query = event.rawQueryString?.length ? `?${event.rawQueryString}` : ''

  return `${protocol}://${host}${event.rawPath}${query}`
}

function requestBody(event: LambdaFunctionUrlRequest): string | Uint8Array | null {
  if (event.body === undefined) {
    return null
  }

  if (event.isBase64Encoded) {
    return Uint8Array.from(atob(event.body), (char) => char.charCodeAt(0))
  }

  return event.body
}

export function requestFromLambdaEvent(event: LambdaFunctionUrlRequest): Request {
  const headers = new Headers(normalizeHeaders(event.headers))

  if (event.cookies?.length) {
    headers.set('cookie', event.cookies.join('; '))
  }

  return new Request(requestUrl(event), {
    method: event.requestContext.http.method,
    headers,
    body: requestBody(event)
  })
}

export async function responseToLambdaResult(
  response: Response
): Promise<LambdaFunctionUrlResponse> {
  const headers: Record<string, string> = {}
  const cookies: string[] = []

  for (const [key, value] of response.headers.entries()) {
    if (key.toLowerCase() === 'set-cookie') {
      cookies.push(value)
      continue
    }

    headers[key] = value
  }

  return {
    statusCode: response.status,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    ...(cookies.length > 0 ? { cookies } : {}),
    body: await response.text()
  }
}

export async function handleLambdaFunctionUrlEvent(
  event: LambdaFunctionUrlRequest,
  handler: (request: Request) => Promise<Response>
): Promise<LambdaFunctionUrlResponse> {
  const request = requestFromLambdaEvent(event)
  const response = await handler(request)
  return responseToLambdaResult(response)
}
