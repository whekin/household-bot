import { describe, expect, test } from 'bun:test'

import type { FinanceRepository } from '@household/ports'

import { createMiniAppAuthHandler } from './miniapp-auth'
import { buildMiniAppInitData } from './telegram-miniapp-test-helpers'

function repository(
  member: Awaited<ReturnType<FinanceRepository['getMemberByTelegramUserId']>>
): FinanceRepository {
  return {
    getMemberByTelegramUserId: async () => member,
    listMembers: async () => [],
    getOpenCycle: async () => null,
    getCycleByPeriod: async () => null,
    getLatestCycle: async () => null,
    openCycle: async () => {},
    closeCycle: async () => {},
    saveRentRule: async () => {},
    addUtilityBill: async () => {},
    getRentRuleForPeriod: async () => null,
    getUtilityTotalForCycle: async () => 0n,
    listUtilityBillsForCycle: async () => [],
    listParsedPurchasesForRange: async () => [],
    replaceSettlementSnapshot: async () => {}
  }
}

describe('createMiniAppAuthHandler', () => {
  test('returns an authorized session for a household member', async () => {
    const authDate = Math.floor(Date.now() / 1000)
    const auth = createMiniAppAuthHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      repository: repository({
        id: 'member-1',
        telegramUserId: '123456',
        displayName: 'Stan',
        isAdmin: true
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
      features: {
        balances: true,
        ledger: true
      },
      telegramUser: {
        id: '123456',
        firstName: 'Stan',
        username: 'stanislav',
        languageCode: 'ru'
      }
    })
  })

  test('returns membership gate failure for a non-member', async () => {
    const authDate = Math.floor(Date.now() / 1000)
    const auth = createMiniAppAuthHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      repository: repository(null)
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
          })
        })
      })
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      ok: true,
      authorized: false,
      reason: 'not_member'
    })
  })

  test('returns 400 for malformed JSON bodies', async () => {
    const auth = createMiniAppAuthHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      repository: repository(null)
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

  test('does not reflect arbitrary origins in production without an allow-list', async () => {
    const previousNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'

    try {
      const authDate = Math.floor(Date.now() / 1000)
      const auth = createMiniAppAuthHandler({
        allowedOrigins: [],
        botToken: 'test-bot-token',
        repository: repository({
          id: 'member-1',
          telegramUserId: '123456',
          displayName: 'Stan',
          isAdmin: true
        })
      })

      const response = await auth.handler(
        new Request('http://localhost/api/miniapp/session', {
          method: 'POST',
          headers: {
            origin: 'https://unknown.example',
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            initData: buildMiniAppInitData('test-bot-token', authDate, {
              id: 123456,
              first_name: 'Stan'
            })
          })
        })
      )

      expect(response.status).toBe(200)
      expect(response.headers.get('access-control-allow-origin')).toBeNull()
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV
      } else {
        process.env.NODE_ENV = previousNodeEnv
      }
    }
  })
})
