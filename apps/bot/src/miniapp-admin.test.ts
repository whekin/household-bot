import { describe, expect, test } from 'bun:test'

import { createHouseholdOnboardingService, createMiniAppAdminService } from '@household/application'
import type {
  HouseholdConfigurationRepository,
  HouseholdTopicBindingRecord
} from '@household/ports'

import {
  createMiniAppApproveMemberHandler,
  createMiniAppPendingMembersHandler,
  createMiniAppPromoteMemberHandler,
  createMiniAppSettingsHandler,
  createMiniAppUpdateMemberStatusHandler,
  createMiniAppUpdateSettingsHandler
} from './miniapp-admin'
import { buildMiniAppInitData } from './telegram-miniapp-test-helpers'

function onboardingRepository(): HouseholdConfigurationRepository {
  const household = {
    householdId: 'household-1',
    householdName: 'Kojori House',
    telegramChatId: '-100123',
    telegramChatType: 'supergroup',
    title: 'Kojori House',
    defaultLocale: 'ru' as const
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
    listHouseholdTopicBindings: async () => [
      {
        householdId: household.householdId,
        role: 'purchase',
        telegramThreadId: '2',
        topicName: 'Общие покупки'
      }
    ],
    clearHouseholdTopicBindings: async () => {},
    listReminderTargets: async () => [],
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
      languageCode: input.languageCode?.trim() || null,
      householdDefaultLocale: household.defaultLocale
    }),
    getPendingHouseholdMember: async () => null,
    findPendingHouseholdMemberByTelegramUserId: async () => null,
    ensureHouseholdMember: async (input) => ({
      id: `member-${input.telegramUserId}`,
      householdId: household.householdId,
      telegramUserId: input.telegramUserId,
      displayName: input.displayName,
      status: input.status ?? 'active',
      preferredLocale: input.preferredLocale ?? null,
      householdDefaultLocale: household.defaultLocale,
      rentShareWeight: 1,
      isAdmin: input.isAdmin === true
    }),
    getHouseholdMember: async () => null,
    listHouseholdMembers: async () => [],
    listHouseholdMembersByTelegramUserId: async () => [],
    listPendingHouseholdMembers: async () => [
      {
        householdId: household.householdId,
        householdName: household.householdName,
        telegramUserId: '555777',
        displayName: 'Mia',
        username: 'mia',
        languageCode: 'ru',
        householdDefaultLocale: household.defaultLocale
      }
    ],
    approvePendingHouseholdMember: async (input) =>
      input.telegramUserId === '555777'
        ? {
            id: 'member-555777',
            householdId: household.householdId,
            telegramUserId: '555777',
            displayName: 'Mia',
            status: 'active',
            preferredLocale: null,
            householdDefaultLocale: household.defaultLocale,
            rentShareWeight: 1,
            isAdmin: false
          }
        : null,
    updateHouseholdDefaultLocale: async (_householdId, locale) => ({
      ...household,
      defaultLocale: locale
    }),
    updateMemberPreferredLocale: async (_householdId, telegramUserId, locale) =>
      telegramUserId === '555777'
        ? {
            id: 'member-555777',
            householdId: household.householdId,
            telegramUserId,
            displayName: 'Mia',
            status: 'active',
            preferredLocale: locale,
            householdDefaultLocale: household.defaultLocale,
            rentShareWeight: 1,
            isAdmin: false
          }
        : null,
    getHouseholdBillingSettings: async (householdId) => ({
      householdId,
      settlementCurrency: 'GEL',
      rentAmountMinor: 70000n,
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
      rentAmountMinor: input.rentAmountMinor ?? 70000n,
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
    promoteHouseholdAdmin: async (householdId, memberId) => {
      const member = [
        {
          id: 'member-123456',
          householdId,
          telegramUserId: '123456',
          displayName: 'Stan',
          status: 'active' as const,
          preferredLocale: null,
          householdDefaultLocale: household.defaultLocale,
          rentShareWeight: 1,
          isAdmin: false
        }
      ].find((entry) => entry.id === memberId)

      return member
        ? {
            ...member,
            isAdmin: true
          }
        : null
    },
    updateHouseholdMemberRentShareWeight: async (_householdId, memberId, rentShareWeight) =>
      memberId === 'member-123456'
        ? {
            id: memberId,
            householdId: household.householdId,
            telegramUserId: '123456',
            displayName: 'Stan',
            status: 'active',
            preferredLocale: null,
            householdDefaultLocale: household.defaultLocale,
            rentShareWeight,
            isAdmin: false
          }
        : null,
    updateHouseholdMemberStatus: async (_householdId, memberId, status) =>
      memberId === 'member-123456'
        ? {
            id: memberId,
            householdId: household.householdId,
            telegramUserId: '123456',
            displayName: 'Stan',
            status,
            preferredLocale: null,
            householdDefaultLocale: household.defaultLocale,
            rentShareWeight: 1,
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
        status: 'active',
        preferredLocale: null,
        householdDefaultLocale: 'ru',
        rentShareWeight: 1,
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
          languageCode: 'ru',
          householdDefaultLocale: 'ru'
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
        status: 'active',
        preferredLocale: null,
        householdDefaultLocale: 'ru',
        rentShareWeight: 1,
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
        status: 'active',
        preferredLocale: null,
        householdDefaultLocale: 'ru',
        rentShareWeight: 1,
        isAdmin: false
      }
    })
  })
})

describe('createMiniAppSettingsHandler', () => {
  test('returns billing settings and admin members for an authenticated admin', async () => {
    const authDate = Math.floor(Date.now() / 1000)
    const repository = onboardingRepository()
    repository.listHouseholdMembersByTelegramUserId = async () => [
      {
        id: 'member-123456',
        householdId: 'household-1',
        telegramUserId: '123456',
        displayName: 'Stan',
        status: 'active',
        preferredLocale: null,
        householdDefaultLocale: 'ru',
        rentShareWeight: 1,
        isAdmin: true
      }
    ]
    repository.listHouseholdMembers = async () => [
      {
        id: 'member-123456',
        householdId: 'household-1',
        telegramUserId: '123456',
        displayName: 'Stan',
        status: 'active',
        preferredLocale: null,
        householdDefaultLocale: 'ru',
        rentShareWeight: 1,
        isAdmin: true
      }
    ]

    const handler = createMiniAppSettingsHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      onboardingService: createHouseholdOnboardingService({
        repository
      }),
      miniAppAdminService: createMiniAppAdminService(repository)
    })

    const response = await handler.handler(
      new Request('http://localhost/api/miniapp/admin/settings', {
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
      settings: {
        householdId: 'household-1',
        settlementCurrency: 'GEL',
        rentAmountMinor: '70000',
        rentCurrency: 'USD',
        rentDueDay: 20,
        rentWarningDay: 17,
        utilitiesDueDay: 4,
        utilitiesReminderDay: 3,
        timezone: 'Asia/Tbilisi'
      },
      topics: [
        {
          householdId: 'household-1',
          role: 'purchase',
          telegramThreadId: '2',
          topicName: 'Общие покупки'
        }
      ],
      categories: [],
      assistantUsage: [],
      members: [
        {
          id: 'member-123456',
          householdId: 'household-1',
          telegramUserId: '123456',
          displayName: 'Stan',
          status: 'active',
          preferredLocale: null,
          householdDefaultLocale: 'ru',
          rentShareWeight: 1,
          isAdmin: true
        }
      ]
    })
  })
})

describe('createMiniAppUpdateSettingsHandler', () => {
  test('updates billing settings for an authenticated admin', async () => {
    const authDate = Math.floor(Date.now() / 1000)
    const repository = onboardingRepository()
    repository.listHouseholdMembersByTelegramUserId = async () => [
      {
        id: 'member-123456',
        householdId: 'household-1',
        telegramUserId: '123456',
        displayName: 'Stan',
        status: 'active',
        preferredLocale: null,
        householdDefaultLocale: 'ru',
        rentShareWeight: 1,
        isAdmin: true
      }
    ]

    const handler = createMiniAppUpdateSettingsHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      onboardingService: createHouseholdOnboardingService({
        repository
      }),
      miniAppAdminService: createMiniAppAdminService(repository)
    })

    const response = await handler.handler(
      new Request('http://localhost/api/miniapp/admin/settings/update', {
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
          rentAmountMajor: '750',
          rentCurrency: 'USD',
          rentDueDay: 22,
          rentWarningDay: 19,
          utilitiesDueDay: 6,
          utilitiesReminderDay: 5,
          timezone: 'Asia/Tbilisi'
        })
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      authorized: true,
      settings: {
        householdId: 'household-1',
        settlementCurrency: 'GEL',
        rentAmountMinor: '75000',
        rentCurrency: 'USD',
        rentDueDay: 22,
        rentWarningDay: 19,
        utilitiesDueDay: 6,
        utilitiesReminderDay: 5,
        timezone: 'Asia/Tbilisi'
      }
    })
  })
})

describe('createMiniAppPromoteMemberHandler', () => {
  test('promotes a household member to admin for an authenticated admin', async () => {
    const authDate = Math.floor(Date.now() / 1000)
    const repository = onboardingRepository()
    repository.listHouseholdMembersByTelegramUserId = async () => [
      {
        id: 'member-123456',
        householdId: 'household-1',
        telegramUserId: '123456',
        displayName: 'Stan',
        status: 'active',
        preferredLocale: null,
        householdDefaultLocale: 'ru',
        rentShareWeight: 1,
        isAdmin: true
      }
    ]

    const handler = createMiniAppPromoteMemberHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      onboardingService: createHouseholdOnboardingService({
        repository
      }),
      miniAppAdminService: createMiniAppAdminService(repository)
    })

    const response = await handler.handler(
      new Request('http://localhost/api/miniapp/admin/members/promote', {
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
          memberId: 'member-123456'
        })
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      authorized: true,
      member: {
        id: 'member-123456',
        householdId: 'household-1',
        telegramUserId: '123456',
        displayName: 'Stan',
        status: 'active',
        preferredLocale: null,
        householdDefaultLocale: 'ru',
        rentShareWeight: 1,
        isAdmin: true
      }
    })
  })
})

describe('createMiniAppUpdateMemberStatusHandler', () => {
  test('updates a household member status for an authenticated admin', async () => {
    const authDate = Math.floor(Date.now() / 1000)
    const repository = onboardingRepository()
    repository.listHouseholdMembersByTelegramUserId = async () => [
      {
        id: 'member-123456',
        householdId: 'household-1',
        telegramUserId: '123456',
        displayName: 'Stan',
        status: 'active',
        preferredLocale: null,
        householdDefaultLocale: 'ru',
        rentShareWeight: 1,
        isAdmin: true
      }
    ]

    const handler = createMiniAppUpdateMemberStatusHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      onboardingService: createHouseholdOnboardingService({
        repository
      }),
      miniAppAdminService: createMiniAppAdminService(repository)
    })

    const response = await handler.handler(
      new Request('http://localhost/api/miniapp/admin/members/status', {
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
          memberId: 'member-123456',
          status: 'away'
        })
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      authorized: true,
      member: {
        id: 'member-123456',
        householdId: 'household-1',
        telegramUserId: '123456',
        displayName: 'Stan',
        status: 'away',
        preferredLocale: null,
        householdDefaultLocale: 'ru',
        rentShareWeight: 1,
        isAdmin: false
      }
    })
  })
})
