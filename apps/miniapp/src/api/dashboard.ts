import { miniAppApiError, readMiniApp } from './client'
import type { MiniAppDashboard } from './types'

export async function fetchMiniAppDashboard(
  initData: string,
  options: {
    periodOverride?: string | null
    todayOverride?: string | null
  } = {}
): Promise<MiniAppDashboard> {
  const { response, payload } = await readMiniApp<{
    ok: boolean
    authorized?: boolean
    dashboard?: MiniAppDashboard
    error?: string
  }>('/api/miniapp/dashboard', {
    initData,
    ...(options.periodOverride ? { periodOverride: options.periodOverride } : {}),
    ...(options.todayOverride ? { todayOverride: options.todayOverride } : {})
  })

  if (!response.ok || !payload.authorized || !payload.dashboard) {
    throw miniAppApiError(response, payload, 'Failed to load dashboard')
  }

  return payload.dashboard
}
