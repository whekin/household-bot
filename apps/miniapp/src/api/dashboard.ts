import { miniAppApiError, postMiniApp } from './client'
import type { MiniAppDashboard } from './types'

export async function fetchMiniAppDashboard(
  initData: string,
  options: {
    periodOverride?: string | null
    todayOverride?: string | null
  } = {}
): Promise<MiniAppDashboard> {
  const { response, payload } = await postMiniApp<{
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

export async function updateMiniAppNotification(
  initData: string,
  input: {
    notificationId: string
    scheduledLocal?: string
    timezone?: string
    deliveryMode?: 'topic' | 'dm_all' | 'dm_selected'
    dmRecipientMemberIds?: readonly string[]
  }
): Promise<void> {
  const { response, payload } = await postMiniApp<{
    ok: boolean
    authorized?: boolean
    error?: string
  }>('/api/miniapp/notifications/update', {
    initData,
    ...input
  })

  if (!response.ok || !payload.authorized) {
    throw miniAppApiError(response, payload, 'Failed to update notification')
  }
}

export async function cancelMiniAppNotification(
  initData: string,
  notificationId: string
): Promise<void> {
  const { response, payload } = await postMiniApp<{
    ok: boolean
    authorized?: boolean
    error?: string
  }>('/api/miniapp/notifications/cancel', {
    initData,
    notificationId
  })

  if (!response.ok || !payload.authorized) {
    throw miniAppApiError(response, payload, 'Failed to cancel notification')
  }
}
