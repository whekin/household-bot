import { describe, expect, test } from 'bun:test'
import { createHmac } from 'node:crypto'

import type { FinanceRepository } from '@household/ports'

import { createMiniAppAuthHandler } from './miniapp-auth'

function buildInitData(botToken: string, authDate: number, user: object): string {
  const params = new URLSearchParams()
  params.set('auth_date', authDate.toString())
  params.set('query_id', 'AAHdF6IQAAAAAN0XohDhrOrc')
  params.set('user', JSON.stringify(user))

  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest()
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex')
  params.set('hash', hash)

  return params.toString()
}

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
          initData: buildInitData('test-bot-token', authDate, {
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
          initData: buildInitData('test-bot-token', authDate, {
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
})
