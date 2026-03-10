import { describe, expect, test } from 'bun:test'

import type { HouseholdConfigurationRepository } from '@household/ports'

import { createMiniAppAdminService } from './miniapp-admin-service'

function repository(): HouseholdConfigurationRepository {
  return {
    registerTelegramHouseholdChat: async () => ({
      status: 'existing',
      household: {
        householdId: 'household-1',
        householdName: 'Kojori House',
        telegramChatId: '-100123',
        telegramChatType: 'supergroup',
        title: 'Kojori House',
        defaultLocale: 'ru'
      }
    }),
    getTelegramHouseholdChat: async () => null,
    getHouseholdChatByHouseholdId: async () => null,
    bindHouseholdTopic: async (input) => ({
      householdId: input.householdId,
      role: input.role,
      telegramThreadId: input.telegramThreadId,
      topicName: input.topicName?.trim() || null
    }),
    getHouseholdTopicBinding: async () => null,
    findHouseholdTopicByTelegramContext: async () => null,
    listHouseholdTopicBindings: async () => [],
    listReminderTargets: async () => [],
    upsertHouseholdJoinToken: async () => ({
      householdId: 'household-1',
      householdName: 'Kojori House',
      token: 'join-token',
      createdByTelegramUserId: null
    }),
    getHouseholdJoinToken: async () => null,
    getHouseholdByJoinToken: async () => null,
    upsertPendingHouseholdMember: async (input) => ({
      householdId: input.householdId,
      householdName: 'Kojori House',
      telegramUserId: input.telegramUserId,
      displayName: input.displayName,
      username: input.username?.trim() || null,
      languageCode: input.languageCode?.trim() || null,
      householdDefaultLocale: 'ru'
    }),
    getPendingHouseholdMember: async () => null,
    findPendingHouseholdMemberByTelegramUserId: async () => null,
    ensureHouseholdMember: async (input) => ({
      id: `member-${input.telegramUserId}`,
      householdId: input.householdId,
      telegramUserId: input.telegramUserId,
      displayName: input.displayName,
      preferredLocale: input.preferredLocale ?? null,
      householdDefaultLocale: 'ru',
      rentShareWeight: 1,
      isAdmin: input.isAdmin === true
    }),
    getHouseholdMember: async () => null,
    listHouseholdMembers: async () => [],
    listHouseholdMembersByTelegramUserId: async () => [],
    listPendingHouseholdMembers: async () => [
      {
        householdId: 'household-1',
        householdName: 'Kojori House',
        telegramUserId: '123456',
        displayName: 'Stan',
        username: 'stan',
        languageCode: 'ru',
        householdDefaultLocale: 'ru'
      }
    ],
    approvePendingHouseholdMember: async (input) =>
      input.telegramUserId === '123456'
        ? {
            id: 'member-123456',
            householdId: input.householdId,
            telegramUserId: input.telegramUserId,
            displayName: 'Stan',
            preferredLocale: null,
            householdDefaultLocale: 'ru',
            rentShareWeight: 1,
            isAdmin: false
          }
        : null,
    updateHouseholdDefaultLocale: async (_householdId, locale) => ({
      householdId: 'household-1',
      householdName: 'Kojori House',
      telegramChatId: '-100123',
      telegramChatType: 'supergroup',
      title: 'Kojori House',
      defaultLocale: locale
    }),
    updateMemberPreferredLocale: async (_householdId, telegramUserId, locale) =>
      telegramUserId === '123456'
        ? {
            id: 'member-123456',
            householdId: 'household-1',
            telegramUserId,
            displayName: 'Stan',
            preferredLocale: locale,
            householdDefaultLocale: 'ru',
            rentShareWeight: 1,
            isAdmin: false
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
    promoteHouseholdAdmin: async (householdId, memberId) =>
      memberId === 'member-123456'
        ? {
            id: memberId,
            householdId,
            telegramUserId: '123456',
            displayName: 'Stan',
            preferredLocale: null,
            householdDefaultLocale: 'ru',
            rentShareWeight: 1,
            isAdmin: true
          }
        : null,
    updateHouseholdMemberRentShareWeight: async (_householdId, memberId, rentShareWeight) =>
      memberId === 'member-123456'
        ? {
            id: memberId,
            householdId: 'household-1',
            telegramUserId: '123456',
            displayName: 'Stan',
            preferredLocale: null,
            householdDefaultLocale: 'ru',
            rentShareWeight,
            isAdmin: false
          }
        : null
  }
}

describe('createMiniAppAdminService', () => {
  test('returns billing settings, utility categories, and members for admins', async () => {
    const service = createMiniAppAdminService(repository())

    const result = await service.getSettings({
      householdId: 'household-1',
      actorIsAdmin: true
    })

    expect(result).toEqual({
      status: 'ok',
      settings: {
        householdId: 'household-1',
        settlementCurrency: 'GEL',
        rentAmountMinor: null,
        rentCurrency: 'USD',
        rentDueDay: 20,
        rentWarningDay: 17,
        utilitiesDueDay: 4,
        utilitiesReminderDay: 3,
        timezone: 'Asia/Tbilisi'
      },
      categories: [],
      members: []
    })
  })

  test('updates billing settings for admins', async () => {
    const service = createMiniAppAdminService(repository())

    const result = await service.updateSettings({
      householdId: 'household-1',
      actorIsAdmin: true,
      rentAmountMajor: '700',
      rentCurrency: 'USD',
      rentDueDay: 21,
      rentWarningDay: 18,
      utilitiesDueDay: 5,
      utilitiesReminderDay: 4,
      timezone: 'Asia/Tbilisi'
    })

    expect(result).toEqual({
      status: 'ok',
      settings: {
        householdId: 'household-1',
        settlementCurrency: 'GEL',
        rentAmountMinor: 70000n,
        rentCurrency: 'USD',
        rentDueDay: 21,
        rentWarningDay: 18,
        utilitiesDueDay: 5,
        utilitiesReminderDay: 4,
        timezone: 'Asia/Tbilisi'
      }
    })
  })

  test('upserts utility categories for admins', async () => {
    const service = createMiniAppAdminService(repository())

    const result = await service.upsertUtilityCategory({
      householdId: 'household-1',
      actorIsAdmin: true,
      name: 'Internet',
      sortOrder: 0,
      isActive: true
    })

    expect(result).toEqual({
      status: 'ok',
      category: {
        id: 'utility-category-1',
        householdId: 'household-1',
        slug: 'custom',
        name: 'Internet',
        sortOrder: 0,
        isActive: true
      }
    })
  })

  test('lists pending members for admins', async () => {
    const service = createMiniAppAdminService(repository())

    const result = await service.listPendingMembers({
      householdId: 'household-1',
      actorIsAdmin: true
    })

    expect(result).toEqual({
      status: 'ok',
      members: [
        {
          householdId: 'household-1',
          householdName: 'Kojori House',
          telegramUserId: '123456',
          displayName: 'Stan',
          username: 'stan',
          languageCode: 'ru',
          householdDefaultLocale: 'ru'
        }
      ]
    })
  })

  test('rejects pending member listing for non-admins', async () => {
    const service = createMiniAppAdminService(repository())

    const result = await service.listPendingMembers({
      householdId: 'household-1',
      actorIsAdmin: false
    })

    expect(result).toEqual({
      status: 'rejected',
      reason: 'not_admin'
    })
  })

  test('approves a pending member for admins', async () => {
    const service = createMiniAppAdminService(repository())

    const result = await service.approvePendingMember({
      householdId: 'household-1',
      actorIsAdmin: true,
      pendingTelegramUserId: '123456'
    })

    expect(result).toEqual({
      status: 'approved',
      member: {
        id: 'member-123456',
        householdId: 'household-1',
        telegramUserId: '123456',
        displayName: 'Stan',
        preferredLocale: null,
        householdDefaultLocale: 'ru',
        rentShareWeight: 1,
        isAdmin: false
      }
    })
  })

  test('promotes an active member to household admin', async () => {
    const service = createMiniAppAdminService(repository())

    const result = await service.promoteMemberToAdmin({
      householdId: 'household-1',
      actorIsAdmin: true,
      memberId: 'member-123456'
    })

    expect(result).toEqual({
      status: 'ok',
      member: {
        id: 'member-123456',
        householdId: 'household-1',
        telegramUserId: '123456',
        displayName: 'Stan',
        preferredLocale: null,
        householdDefaultLocale: 'ru',
        rentShareWeight: 1,
        isAdmin: true
      }
    })
  })
})
