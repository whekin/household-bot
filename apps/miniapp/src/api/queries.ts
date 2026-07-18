import { miniAppQueryClient } from '../app/query-client'
import { fetchMiniAppAdminSettings, fetchMiniAppPendingMembers } from './admin'
import { fetchMiniAppBillingCycle } from './billing'
import { fetchMiniAppDashboard } from './dashboard'
import { fetchMiniAppSession } from './session'
import type {
  MiniAppAdminCycleState,
  MiniAppAdminSettingsPayload,
  MiniAppDashboard,
  MiniAppPendingMember,
  MiniAppSession
} from './types'

export const miniAppQueryKeys = {
  session: (initData: string, joinToken?: string) =>
    ['miniapp', 'session', initData, joinToken ?? null] as const,
  dashboard: (initData: string, periodOverride?: string | null, todayOverride?: string | null) =>
    ['miniapp', 'dashboard', initData, periodOverride ?? null, todayOverride ?? null] as const,
  pendingMembers: (initData: string) => ['miniapp', 'pending-members', initData] as const,
  adminSettings: (initData: string) => ['miniapp', 'admin-settings', initData] as const,
  billingCycle: (initData: string, period?: string) =>
    ['miniapp', 'billing-cycle', initData, period ?? null] as const
}

export function fetchSessionQuery(initData: string, joinToken?: string): Promise<MiniAppSession> {
  return miniAppQueryClient.fetchQuery({
    queryKey: miniAppQueryKeys.session(initData, joinToken),
    queryFn: () => fetchMiniAppSession(initData, joinToken)
  })
}

export function fetchDashboardQuery(
  initData: string,
  options: {
    periodOverride?: string | null
    todayOverride?: string | null
  } = {}
): Promise<MiniAppDashboard> {
  return miniAppQueryClient.fetchQuery({
    queryKey: miniAppQueryKeys.dashboard(initData, options.periodOverride, options.todayOverride),
    queryFn: () =>
      fetchMiniAppDashboard(initData, {
        ...(options.periodOverride === undefined ? {} : { periodOverride: options.periodOverride }),
        ...(options.todayOverride === undefined ? {} : { todayOverride: options.todayOverride })
      })
  })
}

export function fetchPendingMembersQuery(
  initData: string
): Promise<readonly MiniAppPendingMember[]> {
  return miniAppQueryClient.fetchQuery({
    queryKey: miniAppQueryKeys.pendingMembers(initData),
    queryFn: () => fetchMiniAppPendingMembers(initData)
  })
}

export function fetchAdminSettingsQuery(initData: string): Promise<MiniAppAdminSettingsPayload> {
  return miniAppQueryClient.fetchQuery({
    queryKey: miniAppQueryKeys.adminSettings(initData),
    queryFn: () => fetchMiniAppAdminSettings(initData)
  })
}

export function fetchBillingCycleQuery(
  initData: string,
  period?: string
): Promise<MiniAppAdminCycleState> {
  return miniAppQueryClient.fetchQuery({
    queryKey: miniAppQueryKeys.billingCycle(initData, period),
    queryFn: () => fetchMiniAppBillingCycle(initData, period)
  })
}

export async function invalidateHouseholdQueries(initData: string) {
  await Promise.all([
    miniAppQueryClient.invalidateQueries({
      queryKey: ['miniapp', 'dashboard', initData]
    }),
    miniAppQueryClient.invalidateQueries({
      queryKey: miniAppQueryKeys.pendingMembers(initData)
    }),
    miniAppQueryClient.invalidateQueries({
      queryKey: miniAppQueryKeys.adminSettings(initData)
    }),
    miniAppQueryClient.invalidateQueries({
      queryKey: miniAppQueryKeys.billingCycle(initData)
    })
  ])
}
