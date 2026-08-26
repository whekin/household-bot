import { describe, expect, test } from 'bun:test'

import { createHouseholdOnboardingService, createMiniAppAdminService } from '@household/application'
import { instantFromIso } from '@household/domain'
import type {
  HouseholdConfigurationRepository,
  HouseholdFactRecord,
  HouseholdTopicBindingRecord
} from '@household/ports'

import {
  createMiniAppApproveMemberHandler,
  createMiniAppDeleteFactHandler,
  createMiniAppDemoteMemberHandler,
  createMiniAppRejectMemberHandler,
  createMiniAppPendingMembersHandler,
  createMiniAppPromoteMemberHandler,
  createMiniAppSettingsHandler,
  createMiniAppUpdateMemberDisplayNameHandler,
  createMiniAppUpdateMemberPresenceDaysHandler,
  createMiniAppUpdateOwnDisplayNameHandler,
  createMiniAppUpdateMemberStatusHandler,
  createMiniAppUpdateSettingsHandler,
  createMiniAppUpsertFactHandler
} from './miniapp-admin'
import { buildMiniAppInitData } from './telegram-miniapp-test-helpers'

function onboardingRepository(facts: HouseholdFactRecord[] = []): HouseholdConfigurationRepository {
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
    listHouseholdMembers: async () => [
      {
        id: 'member-123456',
        householdId: household.householdId,
        telegramUserId: '123456',
        displayName: 'Stan',
        status: 'active',
        preferredLocale: null,
        householdDefaultLocale: household.defaultLocale,
        rentShareWeight: 1,
        isAdmin: true
      }
    ],
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
    rejectPendingHouseholdMember: async (input) => input.telegramUserId === '555777',
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
    updateHouseholdMemberDisplayName: async (_householdId, memberId, displayName) =>
      memberId === 'member-123456' || memberId === 'member-555777'
        ? {
            id: memberId,
            householdId: 'household-1',
            telegramUserId: memberId === 'member-555777' ? '555777' : '123456',
            displayName,
            status: 'active',
            preferredLocale: null,
            householdDefaultLocale: 'ru',
            rentShareWeight: 1,
            isAdmin: memberId === 'member-123456'
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
      preferredUtilityPayerMemberId: null,
      timezone: 'Asia/Tbilisi',
      rentPaymentDestinations: null
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
      preferredUtilityPayerMemberId: input.preferredUtilityPayerMemberId ?? null,
      timezone: input.timezone ?? 'Asia/Tbilisi',
      rentPaymentDestinations: input.rentPaymentDestinations ?? null
    }),
    getHouseholdAssistantConfig: async (householdId) => ({
      householdId,
      assistantContext: 'House in Kojori',
      assistantTone: 'Playful'
    }),
    updateHouseholdAssistantConfig: async (input) => ({
      householdId: input.householdId,
      assistantContext: input.assistantContext ?? 'House in Kojori',
      assistantTone: input.assistantTone ?? 'Playful'
    }),
    listHouseholdFacts: async () => facts,
    upsertHouseholdFact: async (input) => {
      const fact: HouseholdFactRecord = {
        id: `fact-${input.key}`,
        householdId: input.householdId,
        key: input.key,
        title: input.title,
        body: input.body,
        updatedByMemberId: input.updatedByMemberId ?? null,
        createdAt: instantFromIso('2026-07-01T10:00:00.000Z'),
        updatedAt: instantFromIso('2026-07-01T10:00:00.000Z')
      }
      const index = facts.findIndex((entry) => entry.key === input.key)
      if (index >= 0) {
        facts[index] = fact
      } else {
        facts.push(fact)
      }
      return fact
    },
    deleteHouseholdFact: async (_householdId, key) => {
      const index = facts.findIndex((entry) => entry.key === key)
      if (index < 0) {
        return false
      }
      facts.splice(index, 1)
      return true
    },
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
    demoteHouseholdAdmin: async (householdId, memberId) => {
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
          isAdmin: true
        }
      ].find((entry) => entry.id === memberId)

      return member
        ? {
            ...member,
            isAdmin: false
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
        : null,
    listHouseholdMemberPresenceDays: async () => [],
    upsertHouseholdMemberPresenceDays: async (input) => ({
      householdId: input.householdId,
      memberId: input.memberId,
      period: input.period,
      daysPresent: input.daysPresent
    })
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
      miniAppAdminService: createMiniAppAdminService(repository, undefined, {
        resolveEffectiveFromPeriod: async () => '2026-03'
      })
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

describe('createMiniAppRejectMemberHandler', () => {
  test('rejects a pending member for an authenticated admin', async () => {
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

    const handler = createMiniAppRejectMemberHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      onboardingService: createHouseholdOnboardingService({
        repository
      }),
      miniAppAdminService: createMiniAppAdminService(repository)
    })

    const response = await handler.handler(
      new Request('http://localhost/api/miniapp/admin/reject-member', {
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
      authorized: true
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
      householdName: 'Kojori House',
      settings: {
        householdId: 'household-1',
        settlementCurrency: 'GEL',
        rentAmountMinor: '70000',
        rentCurrency: 'USD',
        rentDueDay: 20,
        rentWarningDay: 17,
        utilitiesDueDay: 4,
        utilitiesReminderDay: 3,
        preferredUtilityPayerMemberId: null,
        timezone: 'Asia/Tbilisi',
        paymentBalanceAdjustmentPolicy: 'utilities',
        rentPaymentDestinations: null
      },
      assistantConfig: {
        householdId: 'household-1',
        assistantContext: 'House in Kojori',
        assistantTone: 'Playful'
      },
      notificationSettings: {
        householdId: 'household-1',
        periodEvents: true,
        planEvents: true,
        purchaseEvents: true,
        paymentEvents: true
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
      facts: [],
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
          preferredUtilityPayerMemberId: 'member-123456',
          timezone: 'Asia/Tbilisi'
        })
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      authorized: true,
      householdName: 'Kojori House',
      settings: {
        householdId: 'household-1',
        settlementCurrency: 'GEL',
        rentAmountMinor: '75000',
        rentCurrency: 'USD',
        rentDueDay: 22,
        rentWarningDay: 19,
        utilitiesDueDay: 6,
        utilitiesReminderDay: 5,
        preferredUtilityPayerMemberId: 'member-123456',
        timezone: 'Asia/Tbilisi',
        paymentBalanceAdjustmentPolicy: 'utilities',
        rentPaymentDestinations: null
      },
      assistantConfig: {
        householdId: 'household-1',
        assistantContext: 'House in Kojori',
        assistantTone: 'Playful'
      },
      notificationSettings: {
        householdId: 'household-1',
        periodEvents: true,
        planEvents: true,
        purchaseEvents: true,
        paymentEvents: true
      }
    })
  })

  test('rejects invalid timezone updates for an authenticated admin', async () => {
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
          preferredUtilityPayerMemberId: null,
          timezone: 'Moon/Base'
        })
      })
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      ok: false,
      error: 'Invalid billing settings'
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

describe('createMiniAppDemoteMemberHandler', () => {
  test('removes admin access from a household member for an authenticated admin', async () => {
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
      },
      {
        id: 'member-555777',
        householdId: 'household-1',
        telegramUserId: '555777',
        displayName: 'Mia',
        status: 'active',
        preferredLocale: null,
        householdDefaultLocale: 'ru',
        rentShareWeight: 1,
        isAdmin: true
      }
    ]

    const handler = createMiniAppDemoteMemberHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      onboardingService: createHouseholdOnboardingService({
        repository
      }),
      miniAppAdminService: createMiniAppAdminService(repository)
    })

    const response = await handler.handler(
      new Request('http://localhost/api/miniapp/admin/members/demote', {
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
        isAdmin: false
      }
    })
  })
})

describe('createMiniAppUpdateOwnDisplayNameHandler', () => {
  test('updates the acting member display name for an authenticated member', async () => {
    const authDate = Math.floor(Date.now() / 1000)
    const repository = onboardingRepository()
    repository.listHouseholdMembersByTelegramUserId = async () => [
      {
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
    ]

    const handler = createMiniAppUpdateOwnDisplayNameHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      onboardingService: createHouseholdOnboardingService({
        repository
      }),
      miniAppAdminService: createMiniAppAdminService(repository)
    })

    const response = await handler.handler(
      new Request('http://localhost/api/miniapp/member/display-name', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          initData: buildMiniAppInitData('test-bot-token', authDate, {
            id: 555777,
            first_name: 'Mia',
            username: 'mia',
            language_code: 'ru'
          }),
          displayName: 'Mia Cozy'
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
        displayName: 'Mia Cozy',
        status: 'active',
        preferredLocale: null,
        householdDefaultLocale: 'ru',
        rentShareWeight: 1,
        isAdmin: false
      }
    })
  })
})

describe('createMiniAppUpdateMemberDisplayNameHandler', () => {
  test('updates a household member display name for an authenticated admin', async () => {
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

    const handler = createMiniAppUpdateMemberDisplayNameHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      onboardingService: createHouseholdOnboardingService({
        repository
      }),
      miniAppAdminService: createMiniAppAdminService(repository)
    })

    const response = await handler.handler(
      new Request('http://localhost/api/miniapp/admin/members/display-name', {
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
          memberId: 'member-555777',
          displayName: 'Mia Cozy'
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
        displayName: 'Mia Cozy',
        status: 'active',
        preferredLocale: null,
        householdDefaultLocale: 'ru',
        rentShareWeight: 1,
        isAdmin: false
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

  test('updates household member days present for an authenticated admin', async () => {
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

    const handler = createMiniAppUpdateMemberPresenceDaysHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      onboardingService: createHouseholdOnboardingService({
        repository
      }),
      miniAppAdminService: createMiniAppAdminService(repository)
    })

    const response = await handler.handler(
      new Request('http://localhost/api/miniapp/admin/members/presence-days', {
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
          period: '2026-03',
          daysPresent: 7
        })
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      authorized: true,
      presenceDays: {
        householdId: 'household-1',
        memberId: 'member-123456',
        period: '2026-03',
        daysPresent: 7
      }
    })
  })
})

describe('household fact mini app handlers', () => {
  function adminRepository(facts: HouseholdFactRecord[]) {
    const repository = onboardingRepository(facts)
    repository.listHouseholdMembersByTelegramUserId = async (telegramUserId) => [
      {
        id: `member-${telegramUserId}`,
        householdId: 'household-1',
        telegramUserId,
        displayName: telegramUserId === '123456' ? 'Stan' : 'Mia',
        status: 'active',
        preferredLocale: null,
        householdDefaultLocale: 'ru',
        rentShareWeight: 1,
        isAdmin: telegramUserId === '123456'
      }
    ]
    return repository
  }

  function adminInitData() {
    return buildMiniAppInitData('test-bot-token', Math.floor(Date.now() / 1000), {
      id: 123456,
      first_name: 'Stan',
      username: 'stanislav',
      language_code: 'ru'
    })
  }

  function memberInitData() {
    return buildMiniAppInitData('test-bot-token', Math.floor(Date.now() / 1000), {
      id: 555777,
      first_name: 'Mia',
      username: 'mia',
      language_code: 'ru'
    })
  }

  function factRequest(path: string, body: Record<string, unknown>) {
    return new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: {
        origin: 'http://localhost:5173',
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    })
  }

  test('stores a fact and invalidates the agent context cache', async () => {
    const facts: HouseholdFactRecord[] = []
    const repository = adminRepository(facts)
    const invalidated: string[] = []
    const handler = createMiniAppUpsertFactHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      onboardingService: createHouseholdOnboardingService({ repository }),
      miniAppAdminService: createMiniAppAdminService(repository),
      onFactsUpdated: (householdId) => invalidated.push(householdId)
    })

    const response = await handler.handler(
      factRequest('/api/miniapp/admin/facts/upsert', {
        initData: adminInitData(),
        key: 'Wi-Fi',
        title: 'Пароль Wi-Fi',
        body: 'Сеть Kojori, пароль hunter2'
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      authorized: true,
      fact: {
        key: 'wi-fi',
        title: 'Пароль Wi-Fi',
        body: 'Сеть Kojori, пароль hunter2',
        updatedAt: '2026-07-01T10:00:00Z'
      }
    })
    expect(facts.map((fact) => fact.key)).toEqual(['wi-fi'])
    expect(invalidated).toEqual(['household-1'])
  })

  test('rejects a fact whose key cannot be slugged', async () => {
    const repository = adminRepository([])
    const handler = createMiniAppUpsertFactHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      onboardingService: createHouseholdOnboardingService({ repository }),
      miniAppAdminService: createMiniAppAdminService(repository)
    })

    const response = await handler.handler(
      factRequest('/api/miniapp/admin/facts/upsert', {
        initData: adminInitData(),
        title: 'Пароль',
        body: 'hunter2'
      })
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ ok: false, error: 'Invalid household fact' })
  })

  test('refuses non-admin members', async () => {
    const repository = adminRepository([])
    const handler = createMiniAppUpsertFactHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      onboardingService: createHouseholdOnboardingService({ repository }),
      miniAppAdminService: createMiniAppAdminService(repository)
    })

    const response = await handler.handler(
      factRequest('/api/miniapp/admin/facts/upsert', {
        initData: memberInitData(),
        key: 'wifi',
        title: 'Wi-Fi',
        body: 'hunter2'
      })
    )

    expect(response.status).toBe(403)
  })

  test('deletes a stored fact', async () => {
    const facts: HouseholdFactRecord[] = [
      {
        id: 'fact-wifi',
        householdId: 'household-1',
        key: 'wifi',
        title: 'Wi-Fi',
        body: 'hunter2',
        updatedByMemberId: null,
        createdAt: instantFromIso('2026-07-01T10:00:00.000Z'),
        updatedAt: instantFromIso('2026-07-01T10:00:00.000Z')
      }
    ]
    const repository = adminRepository(facts)
    const handler = createMiniAppDeleteFactHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      onboardingService: createHouseholdOnboardingService({ repository }),
      miniAppAdminService: createMiniAppAdminService(repository)
    })

    const response = await handler.handler(
      factRequest('/api/miniapp/admin/facts/delete', {
        initData: adminInitData(),
        key: 'WiFi'
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, authorized: true, deleted: true })
    expect(facts).toHaveLength(0)
  })
})
