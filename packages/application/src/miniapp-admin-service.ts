import type {
  HouseholdConfigurationRepository,
  HouseholdMemberRecord,
  HouseholdPendingMemberRecord
} from '@household/ports'

export interface MiniAppAdminService {
  listPendingMembers(input: { householdId: string; actorIsAdmin: boolean }): Promise<
    | {
        status: 'ok'
        members: readonly HouseholdPendingMemberRecord[]
      }
    | {
        status: 'rejected'
        reason: 'not_admin'
      }
  >
  approvePendingMember(input: {
    householdId: string
    actorIsAdmin: boolean
    pendingTelegramUserId: string
  }): Promise<
    | {
        status: 'approved'
        member: HouseholdMemberRecord
      }
    | {
        status: 'rejected'
        reason: 'not_admin' | 'pending_not_found'
      }
  >
}

export function createMiniAppAdminService(
  repository: HouseholdConfigurationRepository
): MiniAppAdminService {
  return {
    async listPendingMembers(input) {
      if (!input.actorIsAdmin) {
        return {
          status: 'rejected',
          reason: 'not_admin'
        }
      }

      return {
        status: 'ok',
        members: await repository.listPendingHouseholdMembers(input.householdId)
      }
    },

    async approvePendingMember(input) {
      if (!input.actorIsAdmin) {
        return {
          status: 'rejected',
          reason: 'not_admin'
        }
      }

      const member = await repository.approvePendingHouseholdMember({
        householdId: input.householdId,
        telegramUserId: input.pendingTelegramUserId
      })

      if (!member) {
        return {
          status: 'rejected',
          reason: 'pending_not_found'
        }
      }

      return {
        status: 'approved',
        member
      }
    }
  }
}
