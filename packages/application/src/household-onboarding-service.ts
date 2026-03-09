import { randomBytes } from 'node:crypto'

import type { HouseholdConfigurationRepository, HouseholdMemberRecord } from '@household/ports'

export interface HouseholdOnboardingIdentity {
  telegramUserId: string
  displayName: string
  username?: string | null
  languageCode?: string | null
}

export type HouseholdMiniAppAccess =
  | {
      status: 'active'
      member: {
        id: string
        householdId: string
        displayName: string
        isAdmin: boolean
      }
    }
  | {
      status: 'pending'
      household: {
        id: string
        name: string
      }
    }
  | {
      status: 'join_required'
      household: {
        id: string
        name: string
      }
    }
  | {
      status: 'open_from_group'
    }

export interface HouseholdOnboardingService {
  ensureHouseholdJoinToken(input: { householdId: string; actorTelegramUserId?: string }): Promise<{
    householdId: string
    householdName: string
    token: string
  }>
  getMiniAppAccess(input: {
    identity: HouseholdOnboardingIdentity
    joinToken?: string
  }): Promise<HouseholdMiniAppAccess>
  joinHousehold(input: { identity: HouseholdOnboardingIdentity; joinToken: string }): Promise<
    | {
        status: 'pending'
        household: {
          id: string
          name: string
        }
      }
    | {
        status: 'active'
        member: {
          id: string
          householdId: string
          displayName: string
          isAdmin: boolean
        }
      }
    | {
        status: 'invalid_token'
      }
  >
}

function toMember(member: HouseholdMemberRecord): {
  id: string
  householdId: string
  displayName: string
  isAdmin: boolean
} {
  return {
    id: member.id,
    householdId: member.householdId,
    displayName: member.displayName,
    isAdmin: member.isAdmin
  }
}

function generateJoinToken(): string {
  return randomBytes(24).toString('base64url')
}

export function createHouseholdOnboardingService(options: {
  repository: HouseholdConfigurationRepository
  tokenFactory?: () => string
}): HouseholdOnboardingService {
  const createToken = options.tokenFactory ?? generateJoinToken

  return {
    async ensureHouseholdJoinToken(input) {
      const existing = await options.repository.getHouseholdJoinToken(input.householdId)
      if (existing) {
        return {
          householdId: existing.householdId,
          householdName: existing.householdName,
          token: existing.token
        }
      }

      const token = createToken()
      const created = await options.repository.upsertHouseholdJoinToken({
        householdId: input.householdId,
        token,
        ...(input.actorTelegramUserId
          ? {
              createdByTelegramUserId: input.actorTelegramUserId
            }
          : {})
      })

      return {
        householdId: created.householdId,
        householdName: created.householdName,
        token: created.token
      }
    },

    async getMiniAppAccess(input) {
      const activeMemberships = await options.repository.listHouseholdMembersByTelegramUserId(
        input.identity.telegramUserId
      )
      const requestedHousehold =
        input.joinToken !== undefined
          ? await options.repository.getHouseholdByJoinToken(input.joinToken)
          : null
      const matchingActiveMember =
        requestedHousehold === null
          ? activeMemberships.length === 1
            ? activeMemberships[0]!
            : null
          : (activeMemberships.find(
              (member) => member.householdId === requestedHousehold.householdId
            ) ?? null)

      if (matchingActiveMember) {
        return {
          status: 'active',
          member: toMember(matchingActiveMember)
        }
      }

      const existingPending = await options.repository.findPendingHouseholdMemberByTelegramUserId(
        input.identity.telegramUserId
      )
      if (existingPending) {
        return {
          status: 'pending',
          household: {
            id: existingPending.householdId,
            name: existingPending.householdName
          }
        }
      }

      if (!input.joinToken) {
        return {
          status: 'open_from_group'
        }
      }

      const household = requestedHousehold
      if (!household) {
        return {
          status: 'open_from_group'
        }
      }

      const pending = await options.repository.getPendingHouseholdMember(
        household.householdId,
        input.identity.telegramUserId
      )
      if (pending) {
        return {
          status: 'pending',
          household: {
            id: pending.householdId,
            name: pending.householdName
          }
        }
      }

      return {
        status: 'join_required',
        household: {
          id: household.householdId,
          name: household.householdName
        }
      }
    },

    async joinHousehold(input) {
      const household = await options.repository.getHouseholdByJoinToken(input.joinToken)
      if (!household) {
        return {
          status: 'invalid_token'
        }
      }

      const activeMember = (
        await options.repository.listHouseholdMembersByTelegramUserId(input.identity.telegramUserId)
      ).find((member) => member.householdId === household.householdId)

      if (activeMember) {
        return {
          status: 'active',
          member: toMember(activeMember)
        }
      }

      const pending = await options.repository.upsertPendingHouseholdMember({
        householdId: household.householdId,
        telegramUserId: input.identity.telegramUserId,
        displayName: input.identity.displayName,
        ...(input.identity.username
          ? {
              username: input.identity.username
            }
          : {}),
        ...(input.identity.languageCode
          ? {
              languageCode: input.identity.languageCode
            }
          : {})
      })

      return {
        status: 'pending',
        household: {
          id: pending.householdId,
          name: pending.householdName
        }
      }
    }
  }
}
