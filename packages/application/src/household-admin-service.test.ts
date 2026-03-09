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
    title: 'Kojori House'
  }
  const members = new Map<string, HouseholdMemberRecord>()
  const pendingMembers = new Map<string, HouseholdPendingMemberRecord>()

  members.set('1', {
    id: 'member-1',
    householdId: household.householdId,
    telegramUserId: '1',
    displayName: 'Stan',
    isAdmin: true
  })
  pendingMembers.set('2', {
    householdId: household.householdId,
    householdName: household.householdName,
    telegramUserId: '2',
    displayName: 'Alice',
    username: 'alice',
    languageCode: 'en'
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
        languageCode: input.languageCode?.trim() || null
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
        isAdmin: input.isAdmin === true
      }
      members.set(input.telegramUserId, record)
      return record
    },
    getHouseholdMember: async (_householdId, telegramUserId) => members.get(telegramUserId) ?? null,
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
        isAdmin: input.isAdmin === true
      }
      members.set(member.telegramUserId, member)
      return member
    }
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
        languageCode: 'en'
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
        isAdmin: false
      }
    })
  })
})
