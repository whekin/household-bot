import { describe, expect, test } from 'bun:test'
import { createHmac } from 'node:crypto'

import { createFinanceCommandService } from '@household/application'
import type { FinanceRepository } from '@household/ports'

import { createMiniAppDashboardHandler } from './miniapp-dashboard'

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
    listMembers: async () => [
      member ?? {
        id: 'member-1',
        telegramUserId: '123456',
        displayName: 'Stan',
        isAdmin: true
      }
    ],
    getOpenCycle: async () => ({
      id: 'cycle-1',
      period: '2026-03',
      currency: 'USD'
    }),
    getCycleByPeriod: async () => null,
    getLatestCycle: async () => ({
      id: 'cycle-1',
      period: '2026-03',
      currency: 'USD'
    }),
    openCycle: async () => {},
    closeCycle: async () => {},
    saveRentRule: async () => {},
    addUtilityBill: async () => {},
    getRentRuleForPeriod: async () => ({
      amountMinor: 70000n,
      currency: 'USD'
    }),
    getUtilityTotalForCycle: async () => 12000n,
    listUtilityBillsForCycle: async () => [
      {
        id: 'utility-1',
        billName: 'Electricity',
        amountMinor: 12000n,
        currency: 'USD',
        createdByMemberId: member?.id ?? 'member-1',
        createdAt: new Date('2026-03-12T12:00:00.000Z')
      }
    ],
    listParsedPurchasesForRange: async () => [
      {
        id: 'purchase-1',
        payerMemberId: member?.id ?? 'member-1',
        amountMinor: 3000n,
        description: 'Soap',
        occurredAt: new Date('2026-03-12T11:00:00.000Z')
      }
    ],
    replaceSettlementSnapshot: async () => {}
  }
}

describe('createMiniAppDashboardHandler', () => {
  test('returns a dashboard for an authenticated household member', async () => {
    const authDate = Math.floor(Date.now() / 1000)
    const financeService = createFinanceCommandService(
      repository({
        id: 'member-1',
        telegramUserId: '123456',
        displayName: 'Stan',
        isAdmin: true
      })
    )

    const dashboard = createMiniAppDashboardHandler({
      allowedOrigins: ['http://localhost:5173'],
      botToken: 'test-bot-token',
      financeService
    })

    const response = await dashboard.handler(
      new Request('http://localhost/api/miniapp/dashboard', {
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
    expect(await response.json()).toMatchObject({
      ok: true,
      authorized: true,
      dashboard: {
        period: '2026-03',
        currency: 'USD',
        totalDueMajor: '820.00',
        members: [
          {
            displayName: 'Stan',
            netDueMajor: '820.00',
            rentShareMajor: '700.00',
            utilityShareMajor: '120.00',
            purchaseOffsetMajor: '0.00'
          }
        ],
        ledger: [
          {
            title: 'Soap'
          },
          {
            title: 'Electricity'
          }
        ]
      }
    })
  })
})
