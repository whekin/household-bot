import { describe, expect, test } from 'bun:test'

import { instantFromIso, type Instant } from '@household/domain'
import type {
  ExchangeRateProvider,
  FinanceCycleExchangeRateRecord,
  FinanceCycleRecord,
  FinanceMemberRecord,
  FinanceParsedPurchaseRecord,
  FinanceRentRuleRecord,
  FinanceRepository,
  HouseholdConfigurationRepository,
  SettlementSnapshotRecord
} from '@household/ports'

import { createFinanceCommandService } from './finance-command-service'

class FinanceRepositoryStub implements FinanceRepository {
  householdId = 'household-1'
  member: FinanceMemberRecord | null = null
  members: readonly FinanceMemberRecord[] = []
  openCycleRecord: FinanceCycleRecord | null = null
  cycleByPeriodRecord: FinanceCycleRecord | null = null
  latestCycleRecord: FinanceCycleRecord | null = null
  rentRule: FinanceRentRuleRecord | null = null
  purchases: readonly FinanceParsedPurchaseRecord[] = []
  utilityBills: readonly {
    id: string
    billName: string
    amountMinor: bigint
    currency: 'USD' | 'GEL'
    createdByMemberId: string | null
    createdAt: Instant
  }[] = []
  paymentRecords: readonly {
    id: string
    memberId: string
    kind: 'rent' | 'utilities'
    amountMinor: bigint
    currency: 'USD' | 'GEL'
    recordedAt: Instant
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
  cycleExchangeRates = new Map<string, FinanceCycleExchangeRateRecord>()

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

  async getCycleExchangeRate(
    cycleId: string,
    sourceCurrency: 'USD' | 'GEL',
    targetCurrency: 'USD' | 'GEL'
  ): Promise<FinanceCycleExchangeRateRecord | null> {
    return this.cycleExchangeRates.get(`${cycleId}:${sourceCurrency}:${targetCurrency}`) ?? null
  }

  async saveCycleExchangeRate(
    input: FinanceCycleExchangeRateRecord
  ): Promise<FinanceCycleExchangeRateRecord> {
    this.cycleExchangeRates.set(
      `${input.cycleId}:${input.sourceCurrency}:${input.targetCurrency}`,
      input
    )
    return input
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

  async updateUtilityBill() {
    return null
  }

  async deleteUtilityBill() {
    return false
  }

  async getRentRuleForPeriod(): Promise<FinanceRentRuleRecord | null> {
    return this.rentRule
  }

  async getUtilityTotalForCycle(): Promise<bigint> {
    return this.utilityBills.reduce((sum, bill) => sum + bill.amountMinor, 0n)
  }

  async listUtilityBillsForCycle() {
    return this.utilityBills
  }

  async listPaymentRecordsForCycle() {
    return this.paymentRecords
  }

  async listParsedPurchasesForRange(): Promise<readonly FinanceParsedPurchaseRecord[]> {
    return this.purchases
  }

  async getSettlementSnapshotLines() {
    return []
  }

  async savePaymentConfirmation() {
    return {
      status: 'needs_review' as const,
      reviewReason: 'settlement_not_ready' as const
    }
  }

  async replaceSettlementSnapshot(snapshot: SettlementSnapshotRecord): Promise<void> {
    this.replacedSnapshot = snapshot
  }
}

const householdConfigurationRepository: Pick<
  HouseholdConfigurationRepository,
  'getHouseholdBillingSettings'
> = {
  async getHouseholdBillingSettings(householdId) {
    return {
      householdId,
      settlementCurrency: 'GEL',
      rentAmountMinor: 70000n,
      rentCurrency: 'USD',
      rentDueDay: 20,
      rentWarningDay: 17,
      utilitiesDueDay: 4,
      utilitiesReminderDay: 3,
      timezone: 'Asia/Tbilisi'
    }
  }
}

const exchangeRateProvider: ExchangeRateProvider = {
  async getRate(input) {
    if (input.baseCurrency === input.quoteCurrency) {
      return {
        baseCurrency: input.baseCurrency,
        quoteCurrency: input.quoteCurrency,
        rateMicros: 1_000_000n,
        effectiveDate: input.effectiveDate,
        source: 'nbg'
      }
    }

    if (input.baseCurrency === 'USD' && input.quoteCurrency === 'GEL') {
      return {
        baseCurrency: 'USD',
        quoteCurrency: 'GEL',
        rateMicros: 2_700_000n,
        effectiveDate: input.effectiveDate,
        source: 'nbg'
      }
    }

    return {
      baseCurrency: input.baseCurrency,
      quoteCurrency: input.quoteCurrency,
      rateMicros: 370_370n,
      effectiveDate: input.effectiveDate,
      source: 'nbg'
    }
  }
}

function createService(repository: FinanceRepositoryStub) {
  return createFinanceCommandService({
    householdId: repository.householdId,
    repository,
    householdConfigurationRepository,
    exchangeRateProvider
  })
}

describe('createFinanceCommandService', () => {
  test('setRent falls back to the open cycle period when one is active', async () => {
    const repository = new FinanceRepositoryStub()
    repository.openCycleRecord = {
      id: 'cycle-1',
      period: '2026-03',
      currency: 'GEL'
    }

    const service = createService(repository)
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
      currency: 'GEL'
    }
    repository.latestCycleRecord = {
      id: 'cycle-0',
      period: '2026-02',
      currency: 'GEL'
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
        currency: 'GEL',
        createdByMemberId: 'alice',
        createdAt: instantFromIso('2026-03-12T12:00:00.000Z')
      }
    ]

    const service = createService(repository)
    const result = await service.getAdminCycleState()

    expect(result).toEqual({
      cycle: {
        id: 'cycle-1',
        period: '2026-03',
        currency: 'GEL'
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
            currency: 'GEL'
          }),
          currency: 'GEL',
          createdByMemberId: 'alice',
          createdAt: instantFromIso('2026-03-12T12:00:00.000Z')
        }
      ]
    })
  })

  test('addUtilityBill returns null when no open cycle exists', async () => {
    const repository = new FinanceRepositoryStub()
    const service = createService(repository)

    const result = await service.addUtilityBill('Electricity', '55.20', 'member-1')

    expect(result).toBeNull()
    expect(repository.lastUtilityBill).toBeNull()
  })

  test('generateStatement settles into cycle currency and persists snapshot', async () => {
    const repository = new FinanceRepositoryStub()
    repository.latestCycleRecord = {
      id: 'cycle-2026-03',
      period: '2026-03',
      currency: 'GEL'
    }
    repository.members = [
      {
        id: 'alice',
        telegramUserId: '100',
        displayName: 'Alice',
        rentShareWeight: 1,
        isAdmin: true
      },
      {
        id: 'bob',
        telegramUserId: '200',
        displayName: 'Bob',
        rentShareWeight: 1,
        isAdmin: false
      }
    ]
    repository.rentRule = {
      amountMinor: 70000n,
      currency: 'USD'
    }
    repository.utilityBills = [
      {
        id: 'utility-1',
        billName: 'Electricity',
        amountMinor: 12000n,
        currency: 'GEL',
        createdByMemberId: 'alice',
        createdAt: instantFromIso('2026-03-12T12:00:00.000Z')
      }
    ]
    repository.purchases = [
      {
        id: 'purchase-1',
        payerMemberId: 'alice',
        amountMinor: 3000n,
        currency: 'GEL',
        description: 'Soap',
        occurredAt: instantFromIso('2026-03-12T11:00:00.000Z')
      }
    ]
    repository.paymentRecords = [
      {
        id: 'payment-1',
        memberId: 'alice',
        kind: 'rent',
        amountMinor: 50000n,
        currency: 'GEL',
        recordedAt: instantFromIso('2026-03-18T12:00:00.000Z')
      }
    ]

    const service = createService(repository)
    const dashboard = await service.generateDashboard()
    const statement = await service.generateStatement()

    expect(dashboard).not.toBeNull()
    expect(dashboard?.currency).toBe('GEL')
    expect(dashboard?.rentSourceAmount.toMajorString()).toBe('700.00')
    expect(dashboard?.rentDisplayAmount.toMajorString()).toBe('1890.00')
    expect(dashboard?.members.map((line) => line.netDue.amountMinor)).toEqual([99000n, 102000n])
    expect(dashboard?.ledger.map((entry) => entry.title)).toEqual(['Soap', 'Electricity', 'rent'])
    expect(dashboard?.ledger.map((entry) => entry.kind)).toEqual(['purchase', 'utility', 'payment'])
    expect(dashboard?.ledger.map((entry) => entry.currency)).toEqual(['GEL', 'GEL', 'GEL'])
    expect(dashboard?.ledger.map((entry) => entry.displayCurrency)).toEqual(['GEL', 'GEL', 'GEL'])
    expect(dashboard?.ledger.map((entry) => entry.paymentKind)).toEqual([null, null, 'rent'])
    expect(statement).toBe(
      [
        'Statement for 2026-03',
        'Rent: 700.00 USD (~1890.00 GEL)',
        '- Alice: due 990.00 GEL, paid 500.00 GEL, remaining 490.00 GEL',
        '- Bob: due 1020.00 GEL, paid 0.00 GEL, remaining 1020.00 GEL',
        'Total due: 2010.00 GEL',
        'Total paid: 500.00 GEL',
        'Total remaining: 1510.00 GEL'
      ].join('\n')
    )
    expect(repository.replacedSnapshot).not.toBeNull()
    expect(repository.replacedSnapshot?.cycleId).toBe('cycle-2026-03')
    expect(repository.replacedSnapshot?.currency).toBe('GEL')
    expect(repository.replacedSnapshot?.totalDueMinor).toBe(201000n)
    expect(repository.replacedSnapshot?.lines.map((line) => line.netDueMinor)).toEqual([
      99000n,
      102000n
    ])
  })
})
