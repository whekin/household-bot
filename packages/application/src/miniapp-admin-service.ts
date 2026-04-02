import type {
  HouseholdAssistantConfigRecord,
  HouseholdBillingSettingsRecord,
  HouseholdConfigurationRepository,
  HouseholdMemberLifecycleStatus,
  HouseholdMemberRecord,
  HouseholdPendingMemberRecord,
  HouseholdRentPaymentDestination,
  HouseholdTopicBindingRecord,
  HouseholdUtilityCategoryRecord
} from '@household/ports'
import { BillingPeriod, Money, type CurrencyCode } from '@household/domain'
import type { ScheduledDispatchService } from './scheduled-dispatch-service'

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

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeRentPaymentDestinations(
  value: unknown
): readonly HouseholdRentPaymentDestination[] | null {
  if (value === null) return null
  if (!Array.isArray(value)) {
    throw new Error('Invalid rent payment destinations')
  }

  return value
    .map((entry): HouseholdRentPaymentDestination | null => {
      if (!entry || typeof entry !== 'object') return null
      const record = entry as Record<string, unknown>
      const label = normalizeOptionalString(record.label)
      const account = normalizeOptionalString(record.account)
      if (!label || !account) return null

      return {
        label,
        recipientName: normalizeOptionalString(record.recipientName),
        bankName: normalizeOptionalString(record.bankName),
        account,
        note: normalizeOptionalString(record.note),
        link: normalizeOptionalString(record.link)
      }
    })
    .filter((entry): entry is HouseholdRentPaymentDestination => Boolean(entry))
}

export interface MiniAppAdminService {
  getSettings(input: { householdId: string; actorIsAdmin: boolean }): Promise<
    | {
        status: 'ok'
        householdName: string
        settings: HouseholdBillingSettingsRecord
        assistantConfig: HouseholdAssistantConfigRecord
        categories: readonly HouseholdUtilityCategoryRecord[]
        members: readonly HouseholdMemberRecord[]
        topics: readonly HouseholdTopicBindingRecord[]
      }
    | {
        status: 'rejected'
        reason: 'not_admin'
      }
  >
  updateSettings(input: {
    householdId: string
    actorIsAdmin: boolean
    householdName?: string
    settlementCurrency?: string
    paymentBalanceAdjustmentPolicy?: string
    rentAmountMajor?: string
    rentCurrency?: string
    rentDueDay: number
    rentWarningDay: number
    utilitiesDueDay: number
    utilitiesReminderDay: number
    timezone: string
    rentPaymentDestinations?: unknown
    assistantContext?: string
    assistantTone?: string
  }): Promise<
    | {
        status: 'ok'
        householdName: string
        settings: HouseholdBillingSettingsRecord
        assistantConfig: HouseholdAssistantConfigRecord
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
    providerName?: string | null
    customerNumber?: string | null
    paymentLink?: string | null
    note?: string | null
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
  rejectPendingMember(input: {
    householdId: string
    actorIsAdmin: boolean
    pendingTelegramUserId: string
  }): Promise<
    | {
        status: 'rejected_member'
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
  demoteMemberFromAdmin(input: {
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
        reason: 'not_admin' | 'member_not_found' | 'last_admin'
      }
  >
  updateMemberRentShareWeight(input: {
    householdId: string
    actorIsAdmin: boolean
    memberId: string
    rentShareWeight: number
  }): Promise<
    | {
        status: 'ok'
        member: HouseholdMemberRecord
      }
    | {
        status: 'rejected'
        reason: 'not_admin' | 'invalid_weight' | 'member_not_found'
      }
  >
  updateMemberStatus(input: {
    householdId: string
    actorIsAdmin: boolean
    memberId: string
    status: HouseholdMemberLifecycleStatus
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
  updateMemberPresenceDays(input: {
    householdId: string
    actorIsAdmin: boolean
    memberId: string
    period: string
    daysPresent: number
  }): Promise<
    | {
        status: 'ok'
        presenceDays: {
          householdId: string
          memberId: string
          period: string
          daysPresent: number
        }
      }
    | {
        status: 'rejected'
        reason: 'not_admin' | 'member_not_found' | 'invalid_days'
      }
  >
  updateOwnDisplayName(input: {
    householdId: string
    actorMemberId: string
    displayName: string
  }): Promise<
    | {
        status: 'ok'
        member: HouseholdMemberRecord
      }
    | {
        status: 'rejected'
        reason: 'invalid_display_name' | 'member_not_found'
      }
  >
  updateMemberDisplayName(input: {
    householdId: string
    actorIsAdmin: boolean
    memberId: string
    displayName: string
  }): Promise<
    | {
        status: 'ok'
        member: HouseholdMemberRecord
      }
    | {
        status: 'rejected'
        reason: 'not_admin' | 'invalid_display_name' | 'member_not_found'
      }
  >
}

function normalizeDisplayName(raw: string): string | null {
  const trimmed = raw.trim()

  if (trimmed.length < 2 || trimmed.length > 80) {
    return null
  }

  return trimmed.replace(/\s+/g, ' ')
}

function normalizeHouseholdName(raw: string | undefined): string | null | undefined {
  if (raw === undefined) {
    return undefined
  }

  const trimmed = raw.trim()
  if (trimmed.length < 2 || trimmed.length > 120) {
    return null
  }

  return trimmed.replace(/\s+/g, ' ')
}

function normalizeTimezone(raw: string): string | null {
  const trimmed = raw.trim()

  if (trimmed.length === 0) {
    return null
  }

  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: trimmed
    }).resolvedOptions().timeZone
  } catch {
    return null
  }
}

function defaultAssistantConfig(householdId: string): HouseholdAssistantConfigRecord {
  return {
    householdId,
    assistantContext: null,
    assistantTone: null
  }
}

function normalizeAssistantText(
  raw: string | undefined,
  maxLength: number
): string | null | undefined {
  if (raw === undefined) {
    return undefined
  }

  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    return null
  }

  if (trimmed.length > maxLength) {
    return null
  }

  return trimmed
}

export function createMiniAppAdminService(
  repository: HouseholdConfigurationRepository,
  scheduledDispatchService?: ScheduledDispatchService,
  _options?: {
    resolveEffectiveFromPeriod?: (householdId: string) => Promise<string | null>
  }
): MiniAppAdminService {
  return {
    async getSettings(input) {
      if (!input.actorIsAdmin) {
        return {
          status: 'rejected',
          reason: 'not_admin'
        }
      }

      const household = await repository.getHouseholdChatByHouseholdId(input.householdId)
      if (!household) {
        throw new Error('Failed to resolve household chat for mini app settings')
      }

      const [settings, assistantConfig, categories, members, topics] = await Promise.all([
        repository.getHouseholdBillingSettings(input.householdId),
        repository.getHouseholdAssistantConfig
          ? repository.getHouseholdAssistantConfig(input.householdId)
          : Promise.resolve(defaultAssistantConfig(input.householdId)),
        repository.listHouseholdUtilityCategories(input.householdId),
        repository.listHouseholdMembers(input.householdId),
        repository.listHouseholdTopicBindings(input.householdId)
      ])

      return {
        status: 'ok',
        householdName: household.householdName,
        settings,
        assistantConfig,
        categories,
        members,
        topics
      }
    },

    async updateSettings(input) {
      if (!input.actorIsAdmin) {
        return {
          status: 'rejected',
          reason: 'not_admin'
        }
      }

      const timezone = normalizeTimezone(input.timezone)

      if (
        !isValidDay(input.rentDueDay) ||
        !isValidDay(input.rentWarningDay) ||
        !isValidDay(input.utilitiesDueDay) ||
        !isValidDay(input.utilitiesReminderDay) ||
        timezone === null ||
        input.rentWarningDay > input.rentDueDay ||
        input.utilitiesReminderDay > input.utilitiesDueDay
      ) {
        return {
          status: 'rejected',
          reason: 'invalid_settings'
        }
      }

      const assistantContext = normalizeAssistantText(input.assistantContext, 1200)
      const assistantTone = normalizeAssistantText(input.assistantTone, 160)
      const householdName = normalizeHouseholdName(input.householdName)
      const nextHouseholdName = householdName ?? undefined

      if (
        (input.householdName !== undefined && householdName === null) ||
        (input.assistantContext !== undefined &&
          assistantContext === null &&
          input.assistantContext.trim().length > 0) ||
        (input.assistantTone !== undefined &&
          assistantTone === null &&
          input.assistantTone.trim().length > 0)
      ) {
        return {
          status: 'rejected',
          reason: 'invalid_settings'
        }
      }

      let rentAmountMinor: bigint | null | undefined
      let rentCurrency: CurrencyCode | undefined
      const settlementCurrency = input.settlementCurrency
        ? parseCurrency(input.settlementCurrency)
        : undefined
      const paymentBalanceAdjustmentPolicy = input.paymentBalanceAdjustmentPolicy
        ? input.paymentBalanceAdjustmentPolicy === 'utilities' ||
          input.paymentBalanceAdjustmentPolicy === 'rent' ||
          input.paymentBalanceAdjustmentPolicy === 'separate'
          ? input.paymentBalanceAdjustmentPolicy
          : null
        : undefined

      if (paymentBalanceAdjustmentPolicy === null) {
        return {
          status: 'rejected',
          reason: 'invalid_settings'
        }
      }

      if (input.rentAmountMajor && input.rentAmountMajor.trim().length > 0) {
        rentCurrency = parseCurrency(input.rentCurrency ?? 'USD')
        rentAmountMinor = Money.fromMajor(input.rentAmountMajor, rentCurrency).amountMinor
      } else if (input.rentAmountMajor === '') {
        rentAmountMinor = null
        rentCurrency = parseCurrency(input.rentCurrency ?? 'USD')
      }

      let rentPaymentDestinations: readonly HouseholdRentPaymentDestination[] | null | undefined
      if (input.rentPaymentDestinations !== undefined) {
        try {
          rentPaymentDestinations = normalizeRentPaymentDestinations(input.rentPaymentDestinations)
        } catch {
          return {
            status: 'rejected',
            reason: 'invalid_settings'
          }
        }
      }

      const shouldUpdateAssistantConfig =
        assistantContext !== undefined || assistantTone !== undefined

      const [settings, nextAssistantConfig, household] = await Promise.all([
        repository.updateHouseholdBillingSettings({
          householdId: input.householdId,
          ...(settlementCurrency
            ? {
                settlementCurrency
              }
            : {}),
          ...(paymentBalanceAdjustmentPolicy
            ? {
                paymentBalanceAdjustmentPolicy
              }
            : {}),
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
          timezone,
          ...(rentPaymentDestinations !== undefined
            ? {
                rentPaymentDestinations
              }
            : {})
        }),
        repository.updateHouseholdAssistantConfig && shouldUpdateAssistantConfig
          ? repository.updateHouseholdAssistantConfig({
              householdId: input.householdId,
              ...(assistantContext !== undefined
                ? {
                    assistantContext
                  }
                : {}),
              ...(assistantTone !== undefined
                ? {
                    assistantTone
                  }
                : {})
            })
          : repository.getHouseholdAssistantConfig
            ? repository.getHouseholdAssistantConfig(input.householdId)
            : Promise.resolve({
                householdId: input.householdId,
                assistantContext: assistantContext ?? null,
                assistantTone: assistantTone ?? null
              }),
        nextHouseholdName !== undefined && repository.updateHouseholdName
          ? repository.updateHouseholdName(input.householdId, nextHouseholdName)
          : repository.getHouseholdChatByHouseholdId(input.householdId)
      ])

      if (!household) {
        throw new Error('Failed to resolve household chat after settings update')
      }

      if (scheduledDispatchService) {
        await scheduledDispatchService.reconcileHouseholdBuiltInDispatches(input.householdId)
      }

      return {
        status: 'ok',
        householdName: household.householdName,
        settings,
        assistantConfig: nextAssistantConfig
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
        isActive: input.isActive,
        providerName: normalizeOptionalString(input.providerName),
        customerNumber: normalizeOptionalString(input.customerNumber),
        paymentLink: normalizeOptionalString(input.paymentLink),
        note: normalizeOptionalString(input.note)
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

    async rejectPendingMember(input) {
      if (!input.actorIsAdmin) {
        return {
          status: 'rejected',
          reason: 'not_admin'
        }
      }

      const success = await repository.rejectPendingHouseholdMember({
        householdId: input.householdId,
        telegramUserId: input.pendingTelegramUserId
      })

      if (!success) {
        return {
          status: 'rejected',
          reason: 'pending_not_found'
        }
      }

      return {
        status: 'rejected_member'
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
    },

    async demoteMemberFromAdmin(input) {
      if (!input.actorIsAdmin) {
        return {
          status: 'rejected',
          reason: 'not_admin'
        }
      }

      const members = await repository.listHouseholdMembers(input.householdId)
      const targetMember = members.find((member) => member.id === input.memberId)
      if (!targetMember) {
        return {
          status: 'rejected',
          reason: 'member_not_found'
        }
      }

      const adminCount = members.filter((member) => member.isAdmin).length
      if (targetMember.isAdmin && adminCount <= 1) {
        return {
          status: 'rejected',
          reason: 'last_admin'
        }
      }

      const member = targetMember.isAdmin
        ? await repository.demoteHouseholdAdmin(input.householdId, input.memberId)
        : targetMember
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
    },

    async updateMemberRentShareWeight(input) {
      if (!input.actorIsAdmin) {
        return {
          status: 'rejected',
          reason: 'not_admin'
        }
      }

      if (!Number.isInteger(input.rentShareWeight) || input.rentShareWeight <= 0) {
        return {
          status: 'rejected',
          reason: 'invalid_weight'
        }
      }

      const member = await repository.updateHouseholdMemberRentShareWeight(
        input.householdId,
        input.memberId,
        input.rentShareWeight
      )
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
    },

    async updateMemberStatus(input) {
      if (!input.actorIsAdmin) {
        return {
          status: 'rejected',
          reason: 'not_admin'
        }
      }

      const member = await repository.updateHouseholdMemberStatus(
        input.householdId,
        input.memberId,
        input.status
      )
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
    },

    async updateMemberPresenceDays(input) {
      if (!input.actorIsAdmin) {
        return {
          status: 'rejected',
          reason: 'not_admin'
        }
      }

      const members = await repository.listHouseholdMembers(input.householdId)
      const target = members.find((candidate) => candidate.id === input.memberId)
      if (!target) {
        return {
          status: 'rejected',
          reason: 'member_not_found'
        }
      }

      const period = BillingPeriod.fromString(input.period)
      const daysInMonth = new Date(period.year, period.month, 0).getDate()
      if (
        !Number.isInteger(input.daysPresent) ||
        input.daysPresent < 0 ||
        input.daysPresent > daysInMonth
      ) {
        return {
          status: 'rejected',
          reason: 'invalid_days'
        }
      }

      const defaultDaysPresent = target.status === 'active' ? daysInMonth : 0
      if (
        input.daysPresent === defaultDaysPresent &&
        repository.deleteHouseholdMemberPresenceDays
      ) {
        await repository.deleteHouseholdMemberPresenceDays(
          input.householdId,
          input.memberId,
          input.period
        )

        return {
          status: 'ok',
          presenceDays: {
            householdId: input.householdId,
            memberId: input.memberId,
            period: input.period,
            daysPresent: defaultDaysPresent
          }
        }
      }

      if (!repository.upsertHouseholdMemberPresenceDays) {
        throw new Error('Member presence days repository is not configured')
      }

      const presenceDays = await repository.upsertHouseholdMemberPresenceDays({
        householdId: input.householdId,
        memberId: input.memberId,
        period: input.period,
        daysPresent: input.daysPresent
      })

      if (!presenceDays) {
        throw new Error('Failed to update member presence days')
      }

      return {
        status: 'ok',
        presenceDays
      }
    },

    async updateOwnDisplayName(input) {
      const displayName = normalizeDisplayName(input.displayName)
      if (!displayName) {
        return {
          status: 'rejected',
          reason: 'invalid_display_name'
        }
      }

      const member = await repository.updateHouseholdMemberDisplayName(
        input.householdId,
        input.actorMemberId,
        displayName
      )

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
    },

    async updateMemberDisplayName(input) {
      if (!input.actorIsAdmin) {
        return {
          status: 'rejected',
          reason: 'not_admin'
        }
      }

      const displayName = normalizeDisplayName(input.displayName)
      if (!displayName) {
        return {
          status: 'rejected',
          reason: 'invalid_display_name'
        }
      }

      const member = await repository.updateHouseholdMemberDisplayName(
        input.householdId,
        input.memberId,
        displayName
      )

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
