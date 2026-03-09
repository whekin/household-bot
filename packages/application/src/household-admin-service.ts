import type {
  HouseholdConfigurationRepository,
  HouseholdMemberRecord,
  HouseholdPendingMemberRecord
} from '@household/ports'

export interface HouseholdAdminService {
  listPendingMembers(input: { actorTelegramUserId: string; telegramChatId: string }): Promise<
    | {
        status: 'ok'
        householdName: string
        members: readonly HouseholdPendingMemberRecord[]
      }
    | {
        status: 'rejected'
        reason: 'household_not_found' | 'not_admin'
      }
  >
  approvePendingMember(input: {
    actorTelegramUserId: string
    telegramChatId: string
    pendingTelegramUserId: string
  }): Promise<
    | {
        status: 'approved'
        householdName: string
        member: HouseholdMemberRecord
      }
    | {
        status: 'rejected'
        reason: 'household_not_found' | 'not_admin' | 'pending_not_found'
      }
  >
}

export function createHouseholdAdminService(
  repository: HouseholdConfigurationRepository
): HouseholdAdminService {
  async function resolveAuthorizedHousehold(input: {
    actorTelegramUserId: string
    telegramChatId: string
  }) {
    const household = await repository.getTelegramHouseholdChat(input.telegramChatId)
    if (!household) {
      return {
        status: 'rejected' as const,
        reason: 'household_not_found' as const
      }
    }

    const actor = await repository.getHouseholdMember(
      household.householdId,
      input.actorTelegramUserId
    )
    if (!actor?.isAdmin) {
      return {
        status: 'rejected' as const,
        reason: 'not_admin' as const
      }
    }

    return {
      status: 'ok' as const,
      household
    }
  }

  return {
    async listPendingMembers(input) {
      const access = await resolveAuthorizedHousehold(input)
      if (access.status === 'rejected') {
        return access
      }

      const members = await repository.listPendingHouseholdMembers(access.household.householdId)

      return {
        status: 'ok',
        householdName: access.household.householdName,
        members
      }
    },

    async approvePendingMember(input) {
      const access = await resolveAuthorizedHousehold(input)
      if (access.status === 'rejected') {
        return access
      }

      const member = await repository.approvePendingHouseholdMember({
        householdId: access.household.householdId,
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
        householdName: access.household.householdName,
        member
      }
    }
  }
}
