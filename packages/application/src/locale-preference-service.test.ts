import { describe, expect, test } from 'bun:test'

import type { HouseholdConfigurationRepository, HouseholdMemberRecord } from '@household/ports'

import { createLocalePreferenceService } from './locale-preference-service'

function createRepository(): HouseholdConfigurationRepository {
  const household = {
    householdId: 'household-1',
    householdName: 'Kojori House',
    telegramChatId: '-100123',
    telegramChatType: 'supergroup',
    title: 'Kojori House',
    defaultLocale: 'ru' as const
  }

  const member: HouseholdMemberRecord = {
    id: 'member-1',
    householdId: 'household-1',
    telegramUserId: '123456',
    displayName: 'Stan',
    status: 'active',
    preferredLocale: null,
    householdDefaultLocale: 'ru',
    rentShareWeight: 1,
    isAdmin: true
  }

  return {
    registerTelegramHouseholdChat: async () => ({ status: 'existing', household }),
    getTelegramHouseholdChat: async () => household,
    getHouseholdChatByHouseholdId: async () => household,
    bindHouseholdTopic: async (input) => ({
      householdId: input.householdId,
      role: input.role,
      telegramThreadId: input.telegramThreadId,
      topicName: input.topicName?.trim() || null
    }),
    getHouseholdTopicBinding: async () => null,
    findHouseholdTopicByTelegramContext: async () => null,
    listHouseholdTopicBindings: async () => [],
    clearHouseholdTopicBindings: async () => {},
    listReminderTargets: async () => [],
    upsertHouseholdJoinToken: async () => ({
      householdId: household.householdId,
      householdName: household.householdName,
      token: 'join-token',
      createdByTelegramUserId: null
    }),
    getHouseholdJoinToken: async () => null,
    getHouseholdByJoinToken: async () => household,
    upsertPendingHouseholdMember: async (input) => ({
      householdId: input.householdId,
      householdName: household.householdName,
      telegramUserId: input.telegramUserId,
      displayName: input.displayName,
      username: input.username?.trim() || null,
      languageCode: input.languageCode?.trim() || null,
      householdDefaultLocale: 'ru'
    }),
    getPendingHouseholdMember: async () => null,
    findPendingHouseholdMemberByTelegramUserId: async () => null,
    ensureHouseholdMember: async () => member,
    getHouseholdMember: async () => member,
    listHouseholdMembers: async () => [member],
    listHouseholdMembersByTelegramUserId: async () => [member],
    listPendingHouseholdMembers: async () => [],
    approvePendingHouseholdMember: async () => member,
    updateHouseholdDefaultLocale: async (_householdId, locale) => ({
      ...household,
      defaultLocale: locale
    }),
    updateMemberPreferredLocale: async (_householdId, telegramUserId, locale) =>
      telegramUserId === member.telegramUserId
        ? {
            ...member,
            preferredLocale: locale,
            householdDefaultLocale: 'ru'
          }
        : null,
    getHouseholdBillingSettings: async (householdId) => ({
      householdId,
      settlementCurrency: 'GEL',
      rentAmountMinor: null,
      rentCurrency: 'USD',
      rentDueDay: 20,
      rentWarningDay: 17,
      utilitiesDueDay: 4,
      utilitiesReminderDay: 3,
      timezone: 'Asia/Tbilisi'
    }),
    updateHouseholdBillingSettings: async (input) => ({
      householdId: input.householdId,
      settlementCurrency: 'GEL',
      rentAmountMinor: input.rentAmountMinor ?? null,
      rentCurrency: input.rentCurrency ?? 'USD',
      rentDueDay: input.rentDueDay ?? 20,
      rentWarningDay: input.rentWarningDay ?? 17,
      utilitiesDueDay: input.utilitiesDueDay ?? 4,
      utilitiesReminderDay: input.utilitiesReminderDay ?? 3,
      timezone: input.timezone ?? 'Asia/Tbilisi'
    }),
    listHouseholdUtilityCategories: async () => [],
    upsertHouseholdUtilityCategory: async (input) => ({
      id: input.slug ?? 'utility-category-1',
      householdId: input.householdId,
      slug: input.slug ?? 'custom',
      name: input.name,
      sortOrder: input.sortOrder,
      isActive: input.isActive
    }),
    promoteHouseholdAdmin: async () => null,
    updateHouseholdMemberRentShareWeight: async () => null,
    updateHouseholdMemberStatus: async () => null
  }
}

describe('createLocalePreferenceService', () => {
  test('updates member locale preference', async () => {
    const service = createLocalePreferenceService(createRepository())

    const result = await service.updateMemberLocale({
      householdId: 'household-1',
      telegramUserId: '123456',
      locale: 'en'
    })

    expect(result).toEqual({
      status: 'updated',
      member: {
        householdId: 'household-1',
        telegramUserId: '123456',
        preferredLocale: 'en',
        householdDefaultLocale: 'ru'
      }
    })
  })

  test('rejects household locale update for non-admin actors', async () => {
    const service = createLocalePreferenceService(createRepository())

    const result = await service.updateHouseholdLocale({
      householdId: 'household-1',
      actorIsAdmin: false,
      locale: 'en'
    })

    expect(result).toEqual({
      status: 'rejected',
      reason: 'not_admin'
    })
  })
})
