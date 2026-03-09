import type {
  HouseholdBillingSettingsRecord,
  HouseholdConfigurationRepository,
  HouseholdMemberRecord,
  HouseholdPendingMemberRecord,
  HouseholdUtilityCategoryRecord
} from '@household/ports'
import { Money, type CurrencyCode } from '@household/domain'

function isValidDay(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 31
}

function parseCurrency(raw: string): CurrencyCode {
  const normalized = raw.trim().toUpperCase()
  if (normalized !== 'USD' && normalized !== 'GEL') {
    throw new Error(`Unsupported currency: ${raw}`)
  }

  return normalized
}

export interface MiniAppAdminService {
  getSettings(input: { householdId: string; actorIsAdmin: boolean }): Promise<
    | {
        status: 'ok'
        settings: HouseholdBillingSettingsRecord
        categories: readonly HouseholdUtilityCategoryRecord[]
        members: readonly HouseholdMemberRecord[]
      }
    | {
        status: 'rejected'
        reason: 'not_admin'
      }
  >
  updateSettings(input: {
    householdId: string
    actorIsAdmin: boolean
    rentAmountMajor?: string
    rentCurrency?: string
    rentDueDay: number
    rentWarningDay: number
    utilitiesDueDay: number
    utilitiesReminderDay: number
    timezone: string
  }): Promise<
    | {
        status: 'ok'
        settings: HouseholdBillingSettingsRecord
      }
    | {
        status: 'rejected'
        reason: 'not_admin' | 'invalid_settings'
      }
  >
  upsertUtilityCategory(input: {
    householdId: string
    actorIsAdmin: boolean
    slug?: string
    name: string
    sortOrder: number
    isActive: boolean
  }): Promise<
    | {
        status: 'ok'
        category: HouseholdUtilityCategoryRecord
      }
    | {
        status: 'rejected'
        reason: 'not_admin' | 'invalid_category'
      }
  >
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
  promoteMemberToAdmin(input: {
    householdId: string
    actorIsAdmin: boolean
    memberId: string
  }): Promise<
    | {
        status: 'ok'
        member: HouseholdMemberRecord
      }
    | {
        status: 'rejected'
        reason: 'not_admin' | 'member_not_found'
      }
  >
}

export function createMiniAppAdminService(
  repository: HouseholdConfigurationRepository
): MiniAppAdminService {
  return {
    async getSettings(input) {
      if (!input.actorIsAdmin) {
        return {
          status: 'rejected',
          reason: 'not_admin'
        }
      }

      const [settings, categories, members] = await Promise.all([
        repository.getHouseholdBillingSettings(input.householdId),
        repository.listHouseholdUtilityCategories(input.householdId),
        repository.listHouseholdMembers(input.householdId)
      ])

      return {
        status: 'ok',
        settings,
        categories,
        members
      }
    },

    async updateSettings(input) {
      if (!input.actorIsAdmin) {
        return {
          status: 'rejected',
          reason: 'not_admin'
        }
      }

      if (
        !isValidDay(input.rentDueDay) ||
        !isValidDay(input.rentWarningDay) ||
        !isValidDay(input.utilitiesDueDay) ||
        !isValidDay(input.utilitiesReminderDay) ||
        input.timezone.trim().length === 0 ||
        input.rentWarningDay > input.rentDueDay ||
        input.utilitiesReminderDay > input.utilitiesDueDay
      ) {
        return {
          status: 'rejected',
          reason: 'invalid_settings'
        }
      }

      let rentAmountMinor: bigint | null | undefined
      let rentCurrency: CurrencyCode | undefined

      if (input.rentAmountMajor && input.rentAmountMajor.trim().length > 0) {
        rentCurrency = parseCurrency(input.rentCurrency ?? 'USD')
        rentAmountMinor = Money.fromMajor(input.rentAmountMajor, rentCurrency).amountMinor
      } else if (input.rentAmountMajor === '') {
        rentAmountMinor = null
        rentCurrency = parseCurrency(input.rentCurrency ?? 'USD')
      }

      const settings = await repository.updateHouseholdBillingSettings({
        householdId: input.householdId,
        ...(rentAmountMinor !== undefined
          ? {
              rentAmountMinor
            }
          : {}),
        ...(rentCurrency
          ? {
              rentCurrency
            }
          : {}),
        rentDueDay: input.rentDueDay,
        rentWarningDay: input.rentWarningDay,
        utilitiesDueDay: input.utilitiesDueDay,
        utilitiesReminderDay: input.utilitiesReminderDay,
        timezone: input.timezone.trim()
      })

      return {
        status: 'ok',
        settings
      }
    },

    async upsertUtilityCategory(input) {
      if (!input.actorIsAdmin) {
        return {
          status: 'rejected',
          reason: 'not_admin'
        }
      }

      if (
        input.name.trim().length === 0 ||
        !Number.isInteger(input.sortOrder) ||
        input.sortOrder < 0
      ) {
        return {
          status: 'rejected',
          reason: 'invalid_category'
        }
      }

      const category = await repository.upsertHouseholdUtilityCategory({
        householdId: input.householdId,
        ...(input.slug
          ? {
              slug: input.slug
            }
          : {}),
        name: input.name.trim(),
        sortOrder: input.sortOrder,
        isActive: input.isActive
      })

      return {
        status: 'ok',
        category
      }
    },

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
    },

    async promoteMemberToAdmin(input) {
      if (!input.actorIsAdmin) {
        return {
          status: 'rejected',
          reason: 'not_admin'
        }
      }

      const member = await repository.promoteHouseholdAdmin(input.householdId, input.memberId)
      if (!member) {
        return {
          status: 'rejected',
          reason: 'member_not_found'
        }
      }

      return {
        status: 'ok',
        member
      }
    }
  }
}
