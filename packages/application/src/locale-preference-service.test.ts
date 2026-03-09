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
    preferredLocale: null,
    householdDefaultLocale: 'ru',
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
        : null
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
