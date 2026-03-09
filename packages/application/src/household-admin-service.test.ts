import { describe, expect, test } from 'bun:test'

import type {
  HouseholdConfigurationRepository,
  HouseholdJoinTokenRecord,
  HouseholdMemberRecord,
  HouseholdPendingMemberRecord,
  HouseholdTelegramChatRecord,
  HouseholdTopicBindingRecord
} from '@household/ports'

import { createHouseholdAdminService } from './household-admin-service'

function createRepositoryStub() {
  const household: HouseholdTelegramChatRecord = {
    householdId: 'household-1',
    householdName: 'Kojori House',
    telegramChatId: '-100123',
    telegramChatType: 'supergroup',
    title: 'Kojori House',
    defaultLocale: 'ru'
  }
  const members = new Map<string, HouseholdMemberRecord>()
  const pendingMembers = new Map<string, HouseholdPendingMemberRecord>()

  members.set('1', {
    id: 'member-1',
    householdId: household.householdId,
    telegramUserId: '1',
    displayName: 'Stan',
    preferredLocale: null,
    householdDefaultLocale: household.defaultLocale,
    isAdmin: true
  })
  pendingMembers.set('2', {
    householdId: household.householdId,
    householdName: household.householdName,
    telegramUserId: '2',
    displayName: 'Alice',
    username: 'alice',
    languageCode: 'en',
    householdDefaultLocale: household.defaultLocale
  })

  const repository: HouseholdConfigurationRepository = {
    registerTelegramHouseholdChat: async () => ({
      status: 'existing',
      household
    }),
    getTelegramHouseholdChat: async () => household,
    getHouseholdChatByHouseholdId: async () => household,
    bindHouseholdTopic: async (input) =>
      ({
        householdId: input.householdId,
        role: input.role,
        telegramThreadId: input.telegramThreadId,
        topicName: input.topicName?.trim() || null
      }) satisfies HouseholdTopicBindingRecord,
    getHouseholdTopicBinding: async () => null,
    findHouseholdTopicByTelegramContext: async () => null,
    listHouseholdTopicBindings: async () => [],
    listReminderTargets: async () => [],
    upsertHouseholdJoinToken: async (input) =>
      ({
        householdId: household.householdId,
        householdName: household.householdName,
        token: input.token,
        createdByTelegramUserId: input.createdByTelegramUserId ?? null
      }) satisfies HouseholdJoinTokenRecord,
    getHouseholdJoinToken: async () => null,
    getHouseholdByJoinToken: async () => household,
    upsertPendingHouseholdMember: async (input) => {
      const record: HouseholdPendingMemberRecord = {
        householdId: household.householdId,
        householdName: household.householdName,
        telegramUserId: input.telegramUserId,
        displayName: input.displayName,
        username: input.username?.trim() || null,
        languageCode: input.languageCode?.trim() || null,
        householdDefaultLocale: household.defaultLocale
      }
      pendingMembers.set(input.telegramUserId, record)
      return record
    },
    getPendingHouseholdMember: async (_householdId, telegramUserId) =>
      pendingMembers.get(telegramUserId) ?? null,
    findPendingHouseholdMemberByTelegramUserId: async (telegramUserId) =>
      pendingMembers.get(telegramUserId) ?? null,
    ensureHouseholdMember: async (input) => {
      const record: HouseholdMemberRecord = {
        id: `member-${input.telegramUserId}`,
        householdId: input.householdId,
        telegramUserId: input.telegramUserId,
        displayName: input.displayName,
        preferredLocale: input.preferredLocale ?? null,
        householdDefaultLocale: household.defaultLocale,
        isAdmin: input.isAdmin === true
      }
      members.set(input.telegramUserId, record)
      return record
    },
    getHouseholdMember: async (_householdId, telegramUserId) => members.get(telegramUserId) ?? null,
    listHouseholdMembers: async (householdId) =>
      [...members.values()].filter((member) => member.householdId === householdId),
    listHouseholdMembersByTelegramUserId: async (telegramUserId) =>
      [...members.values()].filter((member) => member.telegramUserId === telegramUserId),
    listPendingHouseholdMembers: async () => [...pendingMembers.values()],
    approvePendingHouseholdMember: async (input) => {
      const pending = pendingMembers.get(input.telegramUserId)
      if (!pending) {
        return null
      }

      pendingMembers.delete(input.telegramUserId)

      const member: HouseholdMemberRecord = {
        id: `member-${pending.telegramUserId}`,
        householdId: pending.householdId,
        telegramUserId: pending.telegramUserId,
        displayName: pending.displayName,
        preferredLocale: null,
        householdDefaultLocale: household.defaultLocale,
        isAdmin: input.isAdmin === true
      }
      members.set(member.telegramUserId, member)
      return member
    },
    updateHouseholdDefaultLocale: async (_householdId, locale) => ({
      ...household,
      defaultLocale: locale
    }),
    updateMemberPreferredLocale: async (_householdId, telegramUserId, locale) => {
      const member = members.get(telegramUserId)
      return member
        ? {
            ...member,
            preferredLocale: locale
          }
        : null
    },
    getHouseholdBillingSettings: async (householdId) => ({
      householdId,
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
    promoteHouseholdAdmin: async () => null
  }

  return {
    repository
  }
}

describe('createHouseholdAdminService', () => {
  test('lists pending members for a household admin', async () => {
    const { repository } = createRepositoryStub()
    const service = createHouseholdAdminService(repository)

    const result = await service.listPendingMembers({
      actorTelegramUserId: '1',
      telegramChatId: '-100123'
    })

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') {
      return
    }

    expect(result.members).toEqual([
      {
        householdId: 'household-1',
        householdName: 'Kojori House',
        telegramUserId: '2',
        displayName: 'Alice',
        username: 'alice',
        languageCode: 'en',
        householdDefaultLocale: 'ru'
      }
    ])
  })

  test('rejects pending list for a non-admin member', async () => {
    const { repository } = createRepositoryStub()
    const service = createHouseholdAdminService(repository)

    const result = await service.listPendingMembers({
      actorTelegramUserId: '2',
      telegramChatId: '-100123'
    })

    expect(result).toEqual({
      status: 'rejected',
      reason: 'not_admin'
    })
  })

  test('approves a pending member into active members', async () => {
    const { repository } = createRepositoryStub()
    const service = createHouseholdAdminService(repository)

    const result = await service.approvePendingMember({
      actorTelegramUserId: '1',
      telegramChatId: '-100123',
      pendingTelegramUserId: '2'
    })

    expect(result).toEqual({
      status: 'approved',
      householdName: 'Kojori House',
      member: {
        id: 'member-2',
        householdId: 'household-1',
        telegramUserId: '2',
        displayName: 'Alice',
        preferredLocale: null,
        householdDefaultLocale: 'ru',
        isAdmin: false
      }
    })
  })
})
