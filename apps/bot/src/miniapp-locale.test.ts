import { describe, expect, test } from 'bun:test'

import {
  createHouseholdOnboardingService,
  createLocalePreferenceService
} from '@household/application'
import type {
  HouseholdConfigurationRepository,
  HouseholdMemberRecord,
  HouseholdTopicBindingRecord
} from '@household/ports'

import { createMiniAppLocalePreferenceHandler } from './miniapp-locale'
import { buildMiniAppInitData } from './telegram-miniapp-test-helpers'

function repository(): HouseholdConfigurationRepository {
  const household = {
    householdId: 'household-1',
    householdName: 'Kojori House',
    telegramChatId: '-100123',
    telegramChatType: 'supergroup',
    title: 'Kojori House',
    defaultLocale: 'ru' as 'en' | 'ru'
  }

  const members = new Map<string, HouseholdMemberRecord>([
    [
      '123456',
      {
        id: 'member-123456',
        householdId: household.householdId,
        telegramUserId: '123456',
        displayName: 'Stan',
        preferredLocale: null,
        householdDefaultLocale: household.defaultLocale,
        isAdmin: true
      }
    ],
    [
      '222222',
      {
        id: 'member-222222',
        householdId: household.householdId,
        telegramUserId: '222222',
        displayName: 'Mia',
        preferredLocale: null,
        householdDefaultLocale: household.defaultLocale,
        isAdmin: false
      }
    ]
  ])

  return {
    registerTelegramHouseholdChat: async () => ({ status: 'existing', household }),
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
    upsertHouseholdJoinToken: async () => ({
      householdId: household.householdId,
      householdName: household.householdName,
      token: 'join-token',
      createdByTelegramUserId: null
    }),
    getHouseholdJoinToken: async () => null,
    getHouseholdByJoinToken: async () => null,
    upsertPendingHouseholdMember: async (input) => ({
      householdId: input.householdId,
      householdName: household.householdName,
      telegramUserId: input.telegramUserId,
      displayName: input.displayName,
      username: input.username?.trim() || null,
      languageCode: input.languageCode?.trim() || null,
      householdDefaultLocale: household.defaultLocale
    }),
    getPendingHouseholdMember: async () => null,
    findPendingHouseholdMemberByTelegramUserId: async () => null,
    ensureHouseholdMember: async (input) =>
      members.get(input.telegramUserId) ?? {
        id: `member-${input.telegramUserId}`,
        householdId: input.householdId,
        telegramUserId: input.telegramUserId,
        displayName: input.displayName,
        preferredLocale: input.preferredLocale ?? null,
        householdDefaultLocale: household.defaultLocale,
        isAdmin: input.isAdmin === true
      },
    getHouseholdMember: async (_householdId, telegramUserId) => members.get(telegramUserId) ?? null,
    listHouseholdMembers: async () => [...members.values()],
    listHouseholdMembersByTelegramUserId: async (telegramUserId) => {
      const member = members.get(telegramUserId)
      return member ? [member] : []
    },
    listPendingHouseholdMembers: async () => [],
    approvePendingHouseholdMember: async () => null,
    updateHouseholdDefaultLocale: async (_householdId, locale) => {
      household.defaultLocale = locale
      for (const [id, member] of members.entries()) {
        members.set(id, {
          ...member,
          householdDefaultLocale: locale
        })
      }
      return household
    },
    updateMemberPreferredLocale: async (_householdId, telegramUserId, locale) => {
      const member = members.get(telegramUserId)
      if (!member) {
        return null
      }

      const next = {
        ...member,
        preferredLocale: locale
      }
      members.set(telegramUserId, next)
      return next
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
}

describe('createMiniAppLocalePreferenceHandler', () => {
  test('updates member locale preference', async () => {
    const authDate = Math.floor(Date.now() / 1000)
    const householdRepository = repository()
    const handler = createMiniAppLocalePreferenceHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      onboardingService: createHouseholdOnboardingService({
        repository: householdRepository
      }),
      localePreferenceService: createLocalePreferenceService(householdRepository)
    })

    const response = await handler.handler(
      new Request('http://localhost/api/miniapp/preferences/locale', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          initData: buildMiniAppInitData('test-bot-token', authDate, {
            id: 123456,
            first_name: 'Stan',
            language_code: 'ru'
          }),
          locale: 'en',
          scope: 'member'
        })
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      authorized: true,
      locale: {
        scope: 'member',
        effectiveLocale: 'en',
        memberPreferredLocale: 'en',
        householdDefaultLocale: 'ru'
      }
    })
  })

  test('rejects household locale updates for non-admin members', async () => {
    const authDate = Math.floor(Date.now() / 1000)
    const householdRepository = repository()
    const handler = createMiniAppLocalePreferenceHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      onboardingService: createHouseholdOnboardingService({
        repository: householdRepository
      }),
      localePreferenceService: createLocalePreferenceService(householdRepository)
    })

    const response = await handler.handler(
      new Request('http://localhost/api/miniapp/preferences/locale', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:5173',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          initData: buildMiniAppInitData('test-bot-token', authDate, {
            id: 222222,
            first_name: 'Mia',
            language_code: 'ru'
          }),
          locale: 'en',
          scope: 'household'
        })
      })
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      ok: false,
      error: 'Admin access required'
    })
  })
})
