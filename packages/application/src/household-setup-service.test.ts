import { describe, expect, test } from 'bun:test'

import type {
  HouseholdConfigurationRepository,
  HouseholdTelegramChatRecord,
  HouseholdTopicBindingRecord
} from '@household/ports'

import { createHouseholdSetupService } from './household-setup-service'

function createRepositoryStub() {
  const households = new Map<string, HouseholdTelegramChatRecord>()
  const bindings = new Map<string, HouseholdTopicBindingRecord[]>()

  const repository: HouseholdConfigurationRepository = {
    async registerTelegramHouseholdChat(input) {
      const existing = households.get(input.telegramChatId)
      if (existing) {
        const next = {
          ...existing,
          telegramChatType: input.telegramChatType,
          title: input.title?.trim() || existing.title
        }
        households.set(input.telegramChatId, next)
        return {
          status: 'existing',
          household: next
        }
      }

      const created: HouseholdTelegramChatRecord = {
        householdId: `household-${households.size + 1}`,
        householdName: input.householdName,
        telegramChatId: input.telegramChatId,
        telegramChatType: input.telegramChatType,
        title: input.title?.trim() || null
      }
      households.set(input.telegramChatId, created)

      return {
        status: 'created',
        household: created
      }
    },

    async getTelegramHouseholdChat(telegramChatId) {
      return households.get(telegramChatId) ?? null
    },

    async bindHouseholdTopic(input) {
      const next: HouseholdTopicBindingRecord = {
        householdId: input.householdId,
        role: input.role,
        telegramThreadId: input.telegramThreadId,
        topicName: input.topicName?.trim() || null
      }
      const existing = bindings.get(input.householdId) ?? []
      const filtered = existing.filter((entry) => entry.role !== input.role)
      bindings.set(input.householdId, [...filtered, next])
      return next
    },

    async getHouseholdTopicBinding(householdId, role) {
      return bindings.get(householdId)?.find((entry) => entry.role === role) ?? null
    },

    async findHouseholdTopicByTelegramContext(input) {
      const household = households.get(input.telegramChatId)
      if (!household) {
        return null
      }

      return (
        bindings
          .get(household.householdId)
          ?.find((entry) => entry.telegramThreadId === input.telegramThreadId) ?? null
      )
    },

    async listHouseholdTopicBindings(householdId) {
      return bindings.get(householdId) ?? []
    }
  }

  return {
    repository
  }
}

describe('createHouseholdSetupService', () => {
  test('creates a new household chat binding for a group admin', async () => {
    const { repository } = createRepositoryStub()
    const service = createHouseholdSetupService(repository)

    const result = await service.setupGroupChat({
      actorIsAdmin: true,
      telegramChatId: '-100123',
      telegramChatType: 'supergroup',
      title: 'Kojori House'
    })

    expect(result.status).toBe('created')
    if (result.status !== 'created') {
      return
    }
    expect(result.household.householdName).toBe('Kojori House')
    expect(result.household.telegramChatId).toBe('-100123')
  })

  test('rejects setup when the actor is not a group admin', async () => {
    const { repository } = createRepositoryStub()
    const service = createHouseholdSetupService(repository)

    const result = await service.setupGroupChat({
      actorIsAdmin: false,
      telegramChatId: '-100123',
      telegramChatType: 'supergroup',
      title: 'Kojori House'
    })

    expect(result).toEqual({
      status: 'rejected',
      reason: 'not_admin'
    })
  })

  test('binds a purchase topic for an existing household', async () => {
    const { repository } = createRepositoryStub()
    const service = createHouseholdSetupService(repository)
    const setup = await service.setupGroupChat({
      actorIsAdmin: true,
      telegramChatId: '-100123',
      telegramChatType: 'supergroup',
      title: 'Kojori House'
    })

    expect(setup.status).toBe('created')

    const result = await service.bindTopic({
      actorIsAdmin: true,
      telegramChatId: '-100123',
      role: 'purchase',
      telegramThreadId: '777',
      topicName: 'Общие покупки'
    })

    expect(result.status).toBe('bound')
    if (result.status !== 'bound') {
      return
    }
    expect(result.binding.role).toBe('purchase')
    expect(result.binding.telegramThreadId).toBe('777')
  })

  test('rejects topic binding when the household is not set up yet', async () => {
    const { repository } = createRepositoryStub()
    const service = createHouseholdSetupService(repository)

    const result = await service.bindTopic({
      actorIsAdmin: true,
      telegramChatId: '-100123',
      role: 'feedback',
      telegramThreadId: '778'
    })

    expect(result).toEqual({
      status: 'rejected',
      reason: 'household_not_found'
    })
  })

  test('rejects topic binding outside a topic thread', async () => {
    const { repository } = createRepositoryStub()
    const service = createHouseholdSetupService(repository)
    await service.setupGroupChat({
      actorIsAdmin: true,
      telegramChatId: '-100123',
      telegramChatType: 'supergroup',
      title: 'Kojori House'
    })

    const result = await service.bindTopic({
      actorIsAdmin: true,
      telegramChatId: '-100123',
      role: 'feedback'
    })

    expect(result).toEqual({
      status: 'rejected',
      reason: 'not_topic_message'
    })
  })
})
