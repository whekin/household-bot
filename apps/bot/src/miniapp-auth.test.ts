import { describe, expect, test } from 'bun:test'

import { createHouseholdOnboardingService } from '@household/application'
import type {
  HouseholdConfigurationRepository,
  HouseholdTopicBindingRecord
} from '@household/ports'

import { createMiniAppAuthHandler, createMiniAppJoinHandler } from './miniapp-auth'
import { buildMiniAppInitData } from './telegram-miniapp-test-helpers'

function onboardingRepository(): HouseholdConfigurationRepository {
  const household = {
    householdId: 'household-1',
    householdName: 'Kojori House',
    telegramChatId: '-100123',
    telegramChatType: 'supergroup',
    title: 'Kojori House'
  }
  let joinToken: string | null = 'join-token'
  const members = new Map<
    string,
    {
      id: string
      householdId: string
      telegramUserId: string
      displayName: string
      isAdmin: boolean
    }
  >()
  let pending: {
    householdId: string
    householdName: string
    telegramUserId: string
    displayName: string
    username: string | null
    languageCode: string | null
  } | null = null

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
    getHouseholdJoinToken: async () =>
      joinToken
        ? {
            householdId: household.householdId,
            householdName: household.householdName,
            token: joinToken,
            createdByTelegramUserId: null
          }
        : null,
    getHouseholdByJoinToken: async (token) => (token === joinToken ? household : null),
    upsertPendingHouseholdMember: async (input) => {
      pending = {
        householdId: household.householdId,
        householdName: household.householdName,
        telegramUserId: input.telegramUserId,
        displayName: input.displayName,
        username: input.username?.trim() || null,
        languageCode: input.languageCode?.trim() || null
      }
      return pending
    },
    getPendingHouseholdMember: async () => pending,
    findPendingHouseholdMemberByTelegramUserId: async () => pending,
    ensureHouseholdMember: async (input) => {
      const member = {
        id: `member-${input.telegramUserId}`,
        householdId: household.householdId,
        telegramUserId: input.telegramUserId,
        displayName: input.displayName,
        isAdmin: input.isAdmin === true
      }
      members.set(input.telegramUserId, member)
      return member
    },
    getHouseholdMember: async (_householdId, telegramUserId) => members.get(telegramUserId) ?? null,
    listHouseholdMembersByTelegramUserId: async (telegramUserId) => {
      const member = members.get(telegramUserId)
      return member ? [member] : []
    },
    listPendingHouseholdMembers: async () => (pending ? [pending] : []),
    approvePendingHouseholdMember: async (input) => {
      if (!pending || pending.telegramUserId !== input.telegramUserId) {
        return null
      }

      const member = {
        id: `member-${pending.telegramUserId}`,
        householdId: household.householdId,
        telegramUserId: pending.telegramUserId,
        displayName: pending.displayName,
        isAdmin: input.isAdmin === true
      }
      members.set(pending.telegramUserId, member)
      pending = null
      return member
    }
  }
}

describe('createMiniAppAuthHandler', () => {
  test('returns an authorized session for a household member', async () => {
    const authDate = Math.floor(Date.now() / 1000)
    const repository = onboardingRepository()
    await repository.ensureHouseholdMember({
      householdId: 'household-1',
      telegramUserId: '123456',
      displayName: 'Stan',
      isAdmin: true
    })
    const auth = createMiniAppAuthHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      onboardingService: createHouseholdOnboardingService({
        repository
      })
    })

    const response = await auth.handler(
      new Request('http://localhost/api/miniapp/session', {
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
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')
    expect(await response.json()).toMatchObject({
      ok: true,
      authorized: true,
      member: {
        displayName: 'Stan',
        isAdmin: true
      },
      telegramUser: {
        id: '123456',
        firstName: 'Stan',
        username: 'stanislav',
        languageCode: 'ru'
      }
    })
  })

  test('returns onboarding state for a non-member with a valid household token', async () => {
    const authDate = Math.floor(Date.now() / 1000)
    const auth = createMiniAppAuthHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      onboardingService: createHouseholdOnboardingService({
        repository: onboardingRepository()
      })
    })

    const response = await auth.handler(
      new Request('http://localhost/api/miniapp/session', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          initData: buildMiniAppInitData('test-bot-token', authDate, {
            id: 123456,
            first_name: 'Stan'
          }),
          joinToken: 'join-token'
        })
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      authorized: false,
      onboarding: {
        status: 'join_required',
        householdName: 'Kojori House'
      }
    })
  })

  test('creates a pending join request from the mini app', async () => {
    const authDate = Math.floor(Date.now() / 1000)
    const join = createMiniAppJoinHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      onboardingService: createHouseholdOnboardingService({
        repository: onboardingRepository()
      })
    })

    const response = await join.handler(
      new Request('http://localhost/api/miniapp/join', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          initData: buildMiniAppInitData('test-bot-token', authDate, {
            id: 123456,
            first_name: 'Stan'
          }),
          joinToken: 'join-token'
        })
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      authorized: false,
      onboarding: {
        status: 'pending',
        householdName: 'Kojori House'
      }
    })
  })

  test('returns 400 for malformed JSON bodies', async () => {
    const auth = createMiniAppAuthHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      onboardingService: createHouseholdOnboardingService({
        repository: onboardingRepository()
      })
    })

    const response = await auth.handler(
      new Request('http://localhost/api/miniapp/session', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          'content-type': 'application/json'
        },
        body: '{"initData":'
      })
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      ok: false,
      error: 'Invalid JSON body'
    })
  })
})
