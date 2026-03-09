import type { SupportedLocale } from '@household/domain'
import type { HouseholdConfigurationRepository } from '@household/ports'

export interface LocalePreferenceService {
  updateMemberLocale(input: {
    householdId: string
    telegramUserId: string
    locale: SupportedLocale
  }): Promise<
    | {
        status: 'updated'
        member: {
          householdId: string
          telegramUserId: string
          preferredLocale: SupportedLocale | null
          householdDefaultLocale: SupportedLocale
        }
      }
    | {
        status: 'rejected'
        reason: 'member_not_found'
      }
  >
  updateHouseholdLocale(input: {
    householdId: string
    actorIsAdmin: boolean
    locale: SupportedLocale
  }): Promise<
    | {
        status: 'updated'
        household: {
          householdId: string
          defaultLocale: SupportedLocale
        }
      }
    | {
        status: 'rejected'
        reason: 'not_admin'
      }
  >
}

export function createLocalePreferenceService(
  repository: HouseholdConfigurationRepository
): LocalePreferenceService {
  return {
    async updateMemberLocale(input) {
      const member = await repository.updateMemberPreferredLocale(
        input.householdId,
        input.telegramUserId,
        input.locale
      )

      if (!member) {
        return {
          status: 'rejected',
          reason: 'member_not_found' as const
        }
      }

      return {
        status: 'updated',
        member: {
          householdId: member.householdId,
          telegramUserId: member.telegramUserId,
          preferredLocale: member.preferredLocale,
          householdDefaultLocale: member.householdDefaultLocale
        }
      }
    },

    async updateHouseholdLocale(input) {
      if (!input.actorIsAdmin) {
        return {
          status: 'rejected',
          reason: 'not_admin' as const
        }
      }

      const household = await repository.updateHouseholdDefaultLocale(
        input.householdId,
        input.locale
      )

      return {
        status: 'updated',
        household: {
          householdId: household.householdId,
          defaultLocale: household.defaultLocale
        }
      }
    }
  }
}
