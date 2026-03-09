import { describe, expect, test } from 'bun:test'

import type {
  HouseholdConfigurationRepository,
  HouseholdMemberRecord,
  HouseholdJoinTokenRecord,
  HouseholdPendingMemberRecord,
  HouseholdTelegramChatRecord,
  HouseholdTopicBindingRecord
} from '@household/ports'

import { createHouseholdOnboardingService } from './household-onboarding-service'

function createRepositoryStub() {
  const household: HouseholdTelegramChatRecord = {
    householdId: 'household-1',
    householdName: 'Kojori House',
    telegramChatId: '-100123',
    telegramChatType: 'supergroup',
    title: 'Kojori House'
  }
  let joinToken: HouseholdJoinTokenRecord | null = null
  const pendingMembers = new Map<string, HouseholdPendingMemberRecord>()
  const members = new Map<string, HouseholdMemberRecord>()

  const repository: HouseholdConfigurationRepository = {
    async registerTelegramHouseholdChat() {
      return {
        status: 'existing',
        household
      }
    },
    async getTelegramHouseholdChat() {
      return household
    },
    async getHouseholdChatByHouseholdId() {
      return household
    },
    async bindHouseholdTopic(input) {
      const binding: HouseholdTopicBindingRecord = {
        householdId: input.householdId,
        role: input.role,
        telegramThreadId: input.telegramThreadId,
        topicName: input.topicName?.trim() || null
      }
      return binding
    },
    async getHouseholdTopicBinding() {
      return null
    },
    async findHouseholdTopicByTelegramContext() {
      return null
    },
    async listHouseholdTopicBindings() {
      return []
    },
    async upsertHouseholdJoinToken(input) {
      joinToken = {
        householdId: household.householdId,
        householdName: household.householdName,
        token: input.token,
        createdByTelegramUserId: input.createdByTelegramUserId ?? null
      }
      return joinToken
    },
    async getHouseholdJoinToken() {
      return joinToken
    },
    async getHouseholdByJoinToken(token) {
      return joinToken?.token === token ? household : null
    },
    async upsertPendingHouseholdMember(input) {
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
    async getPendingHouseholdMember(_householdId, telegramUserId) {
      return pendingMembers.get(telegramUserId) ?? null
    },
    async findPendingHouseholdMemberByTelegramUserId(telegramUserId) {
      return pendingMembers.get(telegramUserId) ?? null
    },
    async ensureHouseholdMember(input) {
      const member = {
        id: `member-${input.telegramUserId}`,
        householdId: input.householdId,
        telegramUserId: input.telegramUserId,
        displayName: input.displayName,
        isAdmin: input.isAdmin === true
      }
      members.set(input.telegramUserId, member)
      return member
    },
    async getHouseholdMember(_householdId, telegramUserId) {
      return members.get(telegramUserId) ?? null
    },
    async listHouseholdMembers(householdId) {
      return [...members.values()].filter((member) => member.householdId === householdId)
    },
    async listHouseholdMembersByTelegramUserId(telegramUserId) {
      const member = members.get(telegramUserId)
      return member ? [member] : []
    },
    async listPendingHouseholdMembers() {
      return [...pendingMembers.values()]
    },
    async approvePendingHouseholdMember(input) {
      const pending = pendingMembers.get(input.telegramUserId)
      if (!pending) {
        return null
      }

      pendingMembers.delete(input.telegramUserId)

      return {
        id: `member-${pending.telegramUserId}`,
        householdId: pending.householdId,
        telegramUserId: pending.telegramUserId,
        displayName: pending.displayName,
        isAdmin: input.isAdmin === true
      }
    }
  }

  return {
    repository
  }
}

describe('createHouseholdOnboardingService', () => {
  test('creates and reuses a stable join token for a household', async () => {
    const { repository } = createRepositoryStub()
    const service = createHouseholdOnboardingService({
      repository,
      tokenFactory: () => 'join-token'
    })

    const created = await service.ensureHouseholdJoinToken({
      householdId: 'household-1',
      actorTelegramUserId: '1'
    })
    const reused = await service.ensureHouseholdJoinToken({
      householdId: 'household-1'
    })

    expect(created.token).toBe('join-token')
    expect(reused.token).toBe('join-token')
  })

  test('reports join_required for a valid token and non-member', async () => {
    const { repository } = createRepositoryStub()
    const service = createHouseholdOnboardingService({
      repository,
      tokenFactory: () => 'join-token'
    })
    await service.ensureHouseholdJoinToken({
      householdId: 'household-1'
    })

    const access = await service.getMiniAppAccess({
      identity: {
        telegramUserId: '42',
        displayName: 'Stan'
      },
      joinToken: 'join-token'
    })

    expect(access).toEqual({
      status: 'join_required',
      household: {
        id: 'household-1',
        name: 'Kojori House'
      }
    })
  })

  test('creates a pending join request', async () => {
    const { repository } = createRepositoryStub()
    const service = createHouseholdOnboardingService({
      repository,
      tokenFactory: () => 'join-token'
    })
    await service.ensureHouseholdJoinToken({
      householdId: 'household-1'
    })

    const result = await service.joinHousehold({
      identity: {
        telegramUserId: '42',
        displayName: 'Stan',
        username: 'stan'
      },
      joinToken: 'join-token'
    })

    expect(result).toEqual({
      status: 'pending',
      household: {
        id: 'household-1',
        name: 'Kojori House'
      }
    })

    const access = await service.getMiniAppAccess({
      identity: {
        telegramUserId: '42',
        displayName: 'Stan'
      }
    })

    expect(access).toEqual({
      status: 'pending',
      household: {
        id: 'household-1',
        name: 'Kojori House'
      }
    })
  })

  test('returns active when the user is already a household member', async () => {
    const { repository } = createRepositoryStub()
    await repository.ensureHouseholdMember({
      householdId: 'household-1',
      telegramUserId: '42',
      displayName: 'Stan',
      isAdmin: true
    })
    const service = createHouseholdOnboardingService({
      repository
    })

    const access = await service.getMiniAppAccess({
      identity: {
        telegramUserId: '42',
        displayName: 'Stan'
      },
      joinToken: 'anything'
    })

    expect(access).toEqual({
      status: 'active',
      member: {
        id: 'member-42',
        householdId: 'household-1',
        displayName: 'Stan',
        isAdmin: true
      }
    })
  })

  test('returns open_from_group when user belongs to multiple households and no join token is provided', async () => {
    const { repository } = createRepositoryStub()
    const member: HouseholdMemberRecord = {
      id: 'member-1',
      householdId: 'household-1',
      telegramUserId: '42',
      displayName: 'Stan',
      isAdmin: true
    }
    const service = createHouseholdOnboardingService({ repository })
    const duplicateRepository = repository as HouseholdConfigurationRepository & {
      listHouseholdMembersByTelegramUserId: (
        telegramUserId: string
      ) => Promise<readonly HouseholdMemberRecord[]>
    }
    duplicateRepository.listHouseholdMembersByTelegramUserId = async () => [
      member,
      {
        id: 'member-2',
        householdId: 'household-2',
        telegramUserId: '42',
        displayName: 'Stan elsewhere',
        isAdmin: false
      }
    ]

    const access = await service.getMiniAppAccess({
      identity: {
        telegramUserId: '42',
        displayName: 'Stan'
      }
    })

    expect(access).toEqual({
      status: 'open_from_group'
    })
  })
})
