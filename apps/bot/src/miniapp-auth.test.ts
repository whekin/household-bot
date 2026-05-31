import { describe, expect, test } from 'bun:test'

import { createHouseholdOnboardingService } from '@household/application'
import { DOMAIN_ERROR_CODE, DomainError } from '@household/domain'
import type { Logger } from '@household/observability'
import type {
  HouseholdConfigurationRepository,
  HouseholdMemberRecord,
  HouseholdTopicBindingRecord
} from '@household/ports'

import {
  createMiniAppAuthHandler,
  createMiniAppJoinHandler,
  miniAppErrorResponse,
  toMiniAppClientValidationError
} from './miniapp-auth'
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
  let joinToken: string | null = 'join-token'
  const members = new Map<string, HouseholdMemberRecord>()
  let pending: {
    householdId: string
    householdName: string
    telegramUserId: string
    displayName: string
    username: string | null
    languageCode: string | null
    householdDefaultLocale: 'ru'
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
    clearHouseholdTopicBindings: async () => {},
    listReminderTargets: async () => [],
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
        languageCode: input.languageCode?.trim() || null,
        householdDefaultLocale: household.defaultLocale
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
        status: input.status ?? 'active',
        preferredLocale: input.preferredLocale ?? null,
        householdDefaultLocale: household.defaultLocale,
        rentShareWeight: 1,
        isAdmin: input.isAdmin === true
      }
      members.set(input.telegramUserId, member)
      return member
    },
    getHouseholdMember: async (_householdId, telegramUserId) => members.get(telegramUserId) ?? null,
    listHouseholdMembers: async (householdId) =>
      [...members.values()].filter((member) => member.householdId === householdId),
    listHouseholdMembersByTelegramUserId: async (telegramUserId) => {
      const member = members.get(telegramUserId)
      return member ? [member] : []
    },
    listPendingHouseholdMembers: async () => (pending ? [pending] : []),
    approvePendingHouseholdMember: async (input) => {
      if (!pending || pending.telegramUserId !== input.telegramUserId) {
        return null
      }

      const member: HouseholdMemberRecord = {
        id: `member-${pending.telegramUserId}`,
        householdId: household.householdId,
        telegramUserId: pending.telegramUserId,
        displayName: pending.displayName,
        status: 'active',
        preferredLocale: null,
        householdDefaultLocale: household.defaultLocale,
        rentShareWeight: 1,
        isAdmin: input.isAdmin === true
      }
      members.set(pending.telegramUserId, member)
      pending = null
      return member
    },
    rejectPendingHouseholdMember: async () => false,
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
    updateHouseholdMemberDisplayName: async () => null,
    updateHouseholdMemberRentShareWeight: async (_householdId, memberId, rentShareWeight) => {
      const member = [...members.values()].find((entry) => entry.id === memberId)
      return member
        ? {
            ...member,
            rentShareWeight
          }
        : null
    },
    updateHouseholdMemberStatus: async (_householdId, memberId, status) => {
      const member = [...members.values()].find((entry) => entry.id === memberId)
      return member
        ? {
            ...member,
            status
          }
        : null
    },
    getHouseholdBillingSettings: async (householdId) => ({
      householdId,
      settlementCurrency: 'GEL',
      rentAmountMinor: null,
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
      rentAmountMinor: input.rentAmountMinor ?? null,
      rentCurrency: input.rentCurrency ?? 'USD',
      rentDueDay: input.rentDueDay ?? 20,
      rentWarningDay: input.rentWarningDay ?? 17,
      utilitiesDueDay: input.utilitiesDueDay ?? 4,
      utilitiesReminderDay: input.utilitiesReminderDay ?? 3,
      preferredUtilityPayerMemberId: input.preferredUtilityPayerMemberId ?? null,
      timezone: input.timezone ?? 'Asia/Tbilisi',
      rentPaymentDestinations: input.rentPaymentDestinations ?? null
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
    promoteHouseholdAdmin: async () => null,
    demoteHouseholdAdmin: async () => null
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
        status: 'active',
        isAdmin: true,
        preferredLocale: null,
        householdDefaultLocale: 'ru'
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
        householdName: 'Kojori House',
        householdDefaultLocale: 'ru'
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
        householdName: 'Kojori House',
        householdDefaultLocale: 'ru'
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

  test('logs sanitized nested error metadata for request failures', async () => {
    const logEntries: { payload: unknown; message: string }[] = []
    const logger = {
      error: (payload: unknown, message: string) => {
        logEntries.push({ payload, message })
      }
    } as Logger
    const databaseCause = Object.assign(new Error('column "idempotency_key" does not exist'), {
      code: '42703',
      table: 'payment_records',
      column: 'idempotency_key',
      constraint: 'payment_records_idempotency_unique'
    })
    const error = new Error(
      'Failed query for postgres://user:secret@db.example/app initData=query_id=abc&hash=secret',
      {
        cause: databaseCause
      }
    )

    const response = miniAppErrorResponse(error, 'http://localhost:5173', logger, {
      route: 'miniapp.billing.payment_period.close'
    })

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      ok: false,
      error: 'Internal Server Error'
    })
    expect(logEntries).toHaveLength(1)
    expect(logEntries[0]?.message).toBe('Mini app request failed')
    expect(logEntries[0]?.payload).toMatchObject({
      event: 'miniapp.request_failed',
      route: 'miniapp.billing.payment_period.close',
      errorDetails: {
        name: 'Error',
        cause: {
          name: 'Error',
          message: 'column "idempotency_key" does not exist',
          code: '42703',
          table: 'payment_records',
          column: 'idempotency_key',
          constraint: 'payment_records_idempotency_unique'
        }
      }
    })
    const serializedPayload = JSON.stringify(logEntries[0]?.payload)
    expect(serializedPayload).not.toContain('secret')
    expect(serializedPayload).not.toContain('user:secret')
    expect(serializedPayload).not.toContain('hash=')
  })

  test('returns 400 for scoped mutation validation errors without server-failure logging', async () => {
    const logEntries: { payload: unknown; message: string }[] = []
    const logger = {
      error: (payload: unknown, message: string) => {
        logEntries.push({ payload, message })
      }
    } as Logger

    const response = miniAppErrorResponse(
      toMiniAppClientValidationError(
        new DomainError(
          DOMAIN_ERROR_CODE.INVALID_SETTLEMENT_INPUT,
          'Purchase split cannot include inactive members'
        )
      ),
      'http://localhost:5173',
      logger,
      {
        route: 'miniapp.billing.purchase.add'
      }
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      ok: false,
      error: 'Purchase split cannot include inactive members'
    })
    expect(logEntries).toEqual([])
  })

  test('logs raw settlement input domain errors by default', async () => {
    const logEntries: { payload: unknown; message: string }[] = []
    const logger = {
      error: (payload: unknown, message: string) => {
        logEntries.push({ payload, message })
      }
    } as Logger

    const response = miniAppErrorResponse(
      new DomainError(
        DOMAIN_ERROR_CODE.INVALID_SETTLEMENT_INPUT,
        'Purchase participant is not an active member: member-left'
      ),
      'http://localhost:5173',
      logger,
      {
        route: 'miniapp.dashboard'
      }
    )

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      ok: false,
      error: 'Internal Server Error'
    })
    expect(logEntries).toHaveLength(1)
    expect(logEntries[0]?.payload).toMatchObject({
      event: 'miniapp.request_failed',
      route: 'miniapp.dashboard',
      errorDetails: {
        name: 'DomainError',
        code: DOMAIN_ERROR_CODE.INVALID_SETTLEMENT_INPUT,
        message: 'Purchase participant is not an active member: member-left'
      }
    })
  })

  test('logs internal domain errors instead of exposing them as client validation', async () => {
    const logEntries: { payload: unknown; message: string }[] = []
    const logger = {
      error: (payload: unknown, message: string) => {
        logEntries.push({ payload, message })
      }
    } as Logger

    const response = miniAppErrorResponse(
      new DomainError(DOMAIN_ERROR_CODE.CURRENCY_MISMATCH, 'Money operation currency mismatch'),
      'http://localhost:5173',
      logger,
      {
        route: 'miniapp.dashboard'
      }
    )

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      ok: false,
      error: 'Internal Server Error'
    })
    expect(logEntries).toHaveLength(1)
    expect(logEntries[0]?.payload).toMatchObject({
      event: 'miniapp.request_failed',
      route: 'miniapp.dashboard',
      errorDetails: {
        name: 'DomainError',
        code: DOMAIN_ERROR_CODE.CURRENCY_MISMATCH,
        message: 'Money operation currency mismatch'
      }
    })
  })
})
