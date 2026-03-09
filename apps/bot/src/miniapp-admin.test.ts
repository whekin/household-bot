import { describe, expect, test } from 'bun:test'

import { createHouseholdOnboardingService, createMiniAppAdminService } from '@household/application'
import type {
  HouseholdConfigurationRepository,
  HouseholdTopicBindingRecord
} from '@household/ports'

import {
  createMiniAppApproveMemberHandler,
  createMiniAppPendingMembersHandler
} from './miniapp-admin'
import { buildMiniAppInitData } from './telegram-miniapp-test-helpers'

function onboardingRepository(): HouseholdConfigurationRepository {
  const household = {
    householdId: 'household-1',
    householdName: 'Kojori House',
    telegramChatId: '-100123',
    telegramChatType: 'supergroup',
    title: 'Kojori House'
  }

  return {
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
    upsertHouseholdJoinToken: async (input) => ({
      householdId: household.householdId,
      householdName: household.householdName,
      token: input.token,
      createdByTelegramUserId: input.createdByTelegramUserId ?? null
    }),
    getHouseholdJoinToken: async () => null,
    getHouseholdByJoinToken: async () => null,
    upsertPendingHouseholdMember: async (input) => ({
      householdId: household.householdId,
      householdName: household.householdName,
      telegramUserId: input.telegramUserId,
      displayName: input.displayName,
      username: input.username?.trim() || null,
      languageCode: input.languageCode?.trim() || null
    }),
    getPendingHouseholdMember: async () => null,
    findPendingHouseholdMemberByTelegramUserId: async () => null,
    ensureHouseholdMember: async (input) => ({
      id: `member-${input.telegramUserId}`,
      householdId: household.householdId,
      telegramUserId: input.telegramUserId,
      displayName: input.displayName,
      isAdmin: input.isAdmin === true
    }),
    getHouseholdMember: async () => null,
    listHouseholdMembersByTelegramUserId: async () => [],
    listPendingHouseholdMembers: async () => [
      {
        householdId: household.householdId,
        householdName: household.householdName,
        telegramUserId: '555777',
        displayName: 'Mia',
        username: 'mia',
        languageCode: 'ru'
      }
    ],
    approvePendingHouseholdMember: async (input) =>
      input.telegramUserId === '555777'
        ? {
            id: 'member-555777',
            householdId: household.householdId,
            telegramUserId: '555777',
            displayName: 'Mia',
            isAdmin: false
          }
        : null
  }
}

describe('createMiniAppPendingMembersHandler', () => {
  test('lists pending members for an authenticated admin', async () => {
    const authDate = Math.floor(Date.now() / 1000)
    const repository = onboardingRepository()
    repository.listHouseholdMembersByTelegramUserId = async () => [
      {
        id: 'member-123456',
        householdId: 'household-1',
        telegramUserId: '123456',
        displayName: 'Stan',
        isAdmin: true
      }
    ]

    const handler = createMiniAppPendingMembersHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      onboardingService: createHouseholdOnboardingService({
        repository
      }),
      miniAppAdminService: createMiniAppAdminService(repository)
    })

    const response = await handler.handler(
      new Request('http://localhost/api/miniapp/admin/pending-members', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          initData: buildMiniAppInitData('test-bot-token', authDate, {
            id: 123456,
            first_name: 'Stan',
            username: 'stanislav',
            language_code: 'ru'
          })
        })
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      authorized: true,
      members: [
        {
          householdId: 'household-1',
          householdName: 'Kojori House',
          telegramUserId: '555777',
          displayName: 'Mia',
          username: 'mia',
          languageCode: 'ru'
        }
      ]
    })
  })
})

describe('createMiniAppApproveMemberHandler', () => {
  test('approves a pending member for an authenticated admin', async () => {
    const authDate = Math.floor(Date.now() / 1000)
    const repository = onboardingRepository()
    repository.listHouseholdMembersByTelegramUserId = async () => [
      {
        id: 'member-123456',
        householdId: 'household-1',
        telegramUserId: '123456',
        displayName: 'Stan',
        isAdmin: true
      }
    ]

    const handler = createMiniAppApproveMemberHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      onboardingService: createHouseholdOnboardingService({
        repository
      }),
      miniAppAdminService: createMiniAppAdminService(repository)
    })

    const response = await handler.handler(
      new Request('http://localhost/api/miniapp/admin/approve-member', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          initData: buildMiniAppInitData('test-bot-token', authDate, {
            id: 123456,
            first_name: 'Stan',
            username: 'stanislav',
            language_code: 'ru'
          }),
          pendingTelegramUserId: '555777'
        })
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      authorized: true,
      member: {
        id: 'member-555777',
        householdId: 'household-1',
        telegramUserId: '555777',
        displayName: 'Mia',
        isAdmin: false
      }
    })
  })
})
