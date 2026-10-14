import { miniAppQueryClient } from '../app/query-client'
import { fetchMiniAppSession } from './session'
import type { MiniAppSession } from './types'

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
