import { describe, expect, test } from 'bun:test'

import { Money } from '@household/domain'
import type { FinanceCommandService } from '@household/application'

import { executeAgentAction, type AgentActionPayload } from './agent-confirmations'

function rentPayload(periods: readonly string[]): AgentActionPayload {
  return {
    actionId: 'action-1',
    actionType: 'set_period_rent',
    householdId: 'household-1',
    requesterTelegramUserId: '10004',
    locale: 'en',
    summaryText: 'set rent',
    params: { amountMajor: '800.00', currency: 'USD', periods }
  }
}

describe('executeAgentAction set_period_rent', () => {
  test('applies every validated period after confirmation', async () => {
    const calls: string[] = []
    const financeService = {
      setRent: async (amount: string, currency: 'USD' | 'GEL', period: string) => {
        calls.push(`${period}:${amount}:${currency}`)
        return { amount: Money.fromMajor(amount, currency), currency, period }
      }
    } as unknown as FinanceCommandService

    expect(await executeAgentAction(financeService, rentPayload(['2026-07', '2026-08']))).toBe(true)
    expect(calls).toEqual(['2026-07:800.00:USD', '2026-08:800.00:USD'])
  })

  test('rejects the entire action before writing when a period is malformed', async () => {
    let writes = 0
    const financeService = {
      setRent: async () => {
        writes += 1
        return null
      }
    } as unknown as FinanceCommandService

    expect(await executeAgentAction(financeService, rentPayload(['2026-07', 'July']))).toBe(false)
    expect(writes).toBe(0)
  })
})
