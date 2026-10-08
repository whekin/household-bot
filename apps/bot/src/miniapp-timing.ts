import type { QueryMetricsSnapshot } from '@household/observability'

export function withMiniAppTiming(
  response: Response,
  durationMs: number,
  metrics: QueryMetricsSnapshot
): Response {
  const headers = new Headers(response.headers)
  headers.set(
    'server-timing',
    `app;dur=${Math.round(durationMs)}, repo;dur=${metrics.queryMs};desc="Summed repository time", repo_calls;desc="${metrics.queryCount}"`
  )
  const origin = headers.get('access-control-allow-origin')
  if (origin) {
    headers.set('timing-allow-origin', origin)
    const exposed = headers.get('access-control-expose-headers')
    headers.set(
      'access-control-expose-headers',
      [exposed, 'Server-Timing'].filter(Boolean).join(', ')
    )
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  })
}
