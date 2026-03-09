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
            isAdmin: false
          }
        : null
  }
}

describe('createMiniAppAdminService', () => {
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
        isAdmin: false
      }
    })
  })
})
