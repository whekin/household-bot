import { miniAppQueryClient } from './query-client'
import {
  fetchMiniAppAdminSettings,
  fetchMiniAppBillingCycle,
  fetchMiniAppDashboard,
  fetchMiniAppPendingMembers,
  fetchMiniAppSession,
  type MiniAppAdminCycleState,
  type MiniAppAdminSettingsPayload,
  type MiniAppDashboard,
  type MiniAppPendingMember,
  type MiniAppSession
} from '../miniapp-api'

export const miniAppQueryKeys = {
  session: (initData: string, joinToken?: string) =>
    ['miniapp', 'session', initData, joinToken ?? null] as const,
  dashboard: (initData: string) => ['miniapp', 'dashboard', initData] as const,
  pendingMembers: (initData: string) => ['miniapp', 'pending-members', initData] as const,
  adminSettings: (initData: string) => ['miniapp', 'admin-settings', initData] as const,
  billingCycle: (initData: string) => ['miniapp', 'billing-cycle', initData] as const
}

export function fetchSessionQuery(initData: string, joinToken?: string): Promise<MiniAppSession> {
  return miniAppQueryClient.fetchQuery({
    queryKey: miniAppQueryKeys.session(initData, joinToken),
    queryFn: () => fetchMiniAppSession(initData, joinToken)
  })
}

export function fetchDashboardQuery(initData: string): Promise<MiniAppDashboard> {
  return miniAppQueryClient.fetchQuery({
    queryKey: miniAppQueryKeys.dashboard(initData),
    queryFn: () => fetchMiniAppDashboard(initData)
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

export function fetchBillingCycleQuery(initData: string): Promise<MiniAppAdminCycleState> {
  return miniAppQueryClient.fetchQuery({
    queryKey: miniAppQueryKeys.billingCycle(initData),
    queryFn: () => fetchMiniAppBillingCycle(initData)
  })
}

export async function invalidateHouseholdQueries(initData: string) {
  await Promise.all([
    miniAppQueryClient.invalidateQueries({
      queryKey: miniAppQueryKeys.dashboard(initData)
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
