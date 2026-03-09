import { describe, expect, test } from 'bun:test'

import { instantFromIso, type Instant } from '@household/domain'
import type {
  FinanceCycleRecord,
  FinanceMemberRecord,
  FinanceParsedPurchaseRecord,
  FinanceRentRuleRecord,
  FinanceRepository,
  SettlementSnapshotRecord
} from '@household/ports'

import { createFinanceCommandService } from './finance-command-service'

class FinanceRepositoryStub implements FinanceRepository {
  member: FinanceMemberRecord | null = null
  members: readonly FinanceMemberRecord[] = []
  openCycleRecord: FinanceCycleRecord | null = null
  cycleByPeriodRecord: FinanceCycleRecord | null = null
  latestCycleRecord: FinanceCycleRecord | null = null
  rentRule: FinanceRentRuleRecord | null = null
  utilityTotal: bigint = 0n
  purchases: readonly FinanceParsedPurchaseRecord[] = []
  utilityBills: readonly {
    id: string
    billName: string
    amountMinor: bigint
    currency: 'USD' | 'GEL'
    createdByMemberId: string | null
    createdAt: Instant
  }[] = []

  lastSavedRentRule: {
    period: string
    amountMinor: bigint
    currency: 'USD' | 'GEL'
  } | null = null

  lastUtilityBill: {
    cycleId: string
    billName: string
    amountMinor: bigint
    currency: 'USD' | 'GEL'
    createdByMemberId: string
  } | null = null

  replacedSnapshot: SettlementSnapshotRecord | null = null

  async getMemberByTelegramUserId(): Promise<FinanceMemberRecord | null> {
    return this.member
  }

  async listMembers(): Promise<readonly FinanceMemberRecord[]> {
    return this.members
  }

  async getOpenCycle(): Promise<FinanceCycleRecord | null> {
    return this.openCycleRecord
  }

  async getCycleByPeriod(): Promise<FinanceCycleRecord | null> {
    return this.cycleByPeriodRecord
  }

  async getLatestCycle(): Promise<FinanceCycleRecord | null> {
    return this.latestCycleRecord
  }

  async openCycle(period: string, currency: 'USD' | 'GEL'): Promise<void> {
    this.openCycleRecord = {
      id: 'opened-cycle',
      period,
      currency
    }
  }

  async closeCycle(): Promise<void> {}

  async saveRentRule(period: string, amountMinor: bigint, currency: 'USD' | 'GEL'): Promise<void> {
    this.lastSavedRentRule = {
      period,
      amountMinor,
      currency
    }
  }

  async addUtilityBill(input: {
    cycleId: string
    billName: string
    amountMinor: bigint
    currency: 'USD' | 'GEL'
    createdByMemberId: string
  }): Promise<void> {
    this.lastUtilityBill = input
  }

  async getRentRuleForPeriod(): Promise<FinanceRentRuleRecord | null> {
    return this.rentRule
  }

  async getUtilityTotalForCycle(): Promise<bigint> {
    return this.utilityTotal
  }

  async listUtilityBillsForCycle() {
    return this.utilityBills
  }

  async listParsedPurchasesForRange(): Promise<readonly FinanceParsedPurchaseRecord[]> {
    return this.purchases
  }

  async replaceSettlementSnapshot(snapshot: SettlementSnapshotRecord): Promise<void> {
    this.replacedSnapshot = snapshot
  }
}

describe('createFinanceCommandService', () => {
  test('setRent falls back to the open cycle period when one is active', async () => {
    const repository = new FinanceRepositoryStub()
    repository.openCycleRecord = {
      id: 'cycle-1',
      period: '2026-03',
      currency: 'USD'
    }

    const service = createFinanceCommandService(repository)
    const result = await service.setRent('700', undefined, undefined)

    expect(result).not.toBeNull()
    expect(result?.period).toBe('2026-03')
    expect(result?.currency).toBe('USD')
    expect(result?.amount.amountMinor).toBe(70000n)
    expect(repository.lastSavedRentRule).toEqual({
      period: '2026-03',
      amountMinor: 70000n,
      currency: 'USD'
    })
  })

  test('getAdminCycleState prefers the open cycle and returns rent plus utility bills', async () => {
    const repository = new FinanceRepositoryStub()
    repository.openCycleRecord = {
      id: 'cycle-1',
      period: '2026-03',
      currency: 'USD'
    }
    repository.latestCycleRecord = {
      id: 'cycle-0',
      period: '2026-02',
      currency: 'USD'
    }
    repository.rentRule = {
      amountMinor: 70000n,
      currency: 'USD'
    }
    repository.utilityBills = [
      {
        id: 'utility-1',
        billName: 'Electricity',
        amountMinor: 12000n,
        currency: 'USD',
        createdByMemberId: 'alice',
        createdAt: instantFromIso('2026-03-12T12:00:00.000Z')
      }
    ]

    const service = createFinanceCommandService(repository)
    const result = await service.getAdminCycleState()

    expect(result).toEqual({
      cycle: {
        id: 'cycle-1',
        period: '2026-03',
        currency: 'USD'
      },
      rentRule: {
        amountMinor: 70000n,
        currency: 'USD'
      },
      utilityBills: [
        {
          id: 'utility-1',
          billName: 'Electricity',
          amount: expect.objectContaining({
            amountMinor: 12000n,
            currency: 'USD'
          }),
          currency: 'USD',
          createdByMemberId: 'alice',
          createdAt: instantFromIso('2026-03-12T12:00:00.000Z')
        }
      ]
    })
  })

  test('addUtilityBill returns null when no open cycle exists', async () => {
    const repository = new FinanceRepositoryStub()
    const service = createFinanceCommandService(repository)

    const result = await service.addUtilityBill('Electricity', '55.20', 'member-1')

    expect(result).toBeNull()
    expect(repository.lastUtilityBill).toBeNull()
  })

  test('generateStatement persists settlement snapshot and returns member lines', async () => {
    const repository = new FinanceRepositoryStub()
    repository.latestCycleRecord = {
      id: 'cycle-2026-03',
      period: '2026-03',
      currency: 'USD'
    }
    repository.members = [
      {
        id: 'alice',
        telegramUserId: '100',
        displayName: 'Alice',
        isAdmin: true
      },
      {
        id: 'bob',
        telegramUserId: '200',
        displayName: 'Bob',
        isAdmin: false
      }
    ]
    repository.rentRule = {
      amountMinor: 70000n,
      currency: 'USD'
    }
    repository.utilityTotal = 12000n
    repository.utilityBills = [
      {
        id: 'utility-1',
        billName: 'Electricity',
        amountMinor: 12000n,
        currency: 'USD',
        createdByMemberId: 'alice',
        createdAt: instantFromIso('2026-03-12T12:00:00.000Z')
      }
    ]
    repository.purchases = [
      {
        id: 'purchase-1',
        payerMemberId: 'alice',
        amountMinor: 3000n,
        description: 'Soap',
        occurredAt: instantFromIso('2026-03-12T11:00:00.000Z')
      }
    ]

    const service = createFinanceCommandService(repository)
    const dashboard = await service.generateDashboard()
    const statement = await service.generateStatement()

    expect(dashboard).not.toBeNull()
    expect(dashboard?.members.map((line) => line.netDue.amountMinor)).toEqual([39500n, 42500n])
    expect(dashboard?.ledger.map((entry) => entry.title)).toEqual(['Soap', 'Electricity'])
    expect(statement).toBe(
      [
        'Statement for 2026-03',
        '- Alice: 395.00 USD',
        '- Bob: 425.00 USD',
        'Total: 820.00 USD'
      ].join('\n')
    )
    expect(repository.replacedSnapshot).not.toBeNull()
    expect(repository.replacedSnapshot?.cycleId).toBe('cycle-2026-03')
    expect(repository.replacedSnapshot?.currency).toBe('USD')
    expect(repository.replacedSnapshot?.totalDueMinor).toBe(82000n)
    expect(repository.replacedSnapshot?.lines.map((line) => line.netDueMinor)).toEqual([
      39500n,
      42500n
    ])
  })
})
