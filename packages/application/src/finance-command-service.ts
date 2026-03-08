import { createHash } from 'node:crypto'

import type { FinanceCycleRecord, FinanceMemberRecord, FinanceRepository } from '@household/ports'
import {
  BillingCycleId,
  BillingPeriod,
  MemberId,
  Money,
  PurchaseEntryId,
  type CurrencyCode
} from '@household/domain'

import { calculateMonthlySettlement } from './settlement-engine'

function parseCurrency(raw: string | undefined, fallback: CurrencyCode): CurrencyCode {
  if (!raw || raw.trim().length === 0) {
    return fallback
  }

  const normalized = raw.trim().toUpperCase()
  if (normalized !== 'USD' && normalized !== 'GEL') {
    throw new Error(`Unsupported currency: ${raw}`)
  }

  return normalized
}

function monthRange(period: BillingPeriod): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(period.year, period.month - 1, 1, 0, 0, 0)),
    end: new Date(Date.UTC(period.year, period.month, 0, 23, 59, 59))
  }
}

function computeInputHash(payload: object): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

async function getCycleByPeriodOrLatest(
  repository: FinanceRepository,
  periodArg?: string
): Promise<FinanceCycleRecord | null> {
  if (periodArg) {
    return repository.getCycleByPeriod(BillingPeriod.fromString(periodArg).toString())
  }

  return repository.getLatestCycle()
}

export interface FinanceDashboardMemberLine {
  memberId: string
  displayName: string
  rentShare: Money
  utilityShare: Money
  purchaseOffset: Money
  netDue: Money
  explanations: readonly string[]
}

export interface FinanceDashboardLedgerEntry {
  id: string
  kind: 'purchase' | 'utility'
  title: string
  amount: Money
  actorDisplayName: string | null
  occurredAt: string | null
}

export interface FinanceDashboard {
  period: string
  currency: CurrencyCode
  totalDue: Money
  members: readonly FinanceDashboardMemberLine[]
  ledger: readonly FinanceDashboardLedgerEntry[]
}

async function buildFinanceDashboard(
  repository: FinanceRepository,
  periodArg?: string
): Promise<FinanceDashboard | null> {
  const cycle = await getCycleByPeriodOrLatest(repository, periodArg)
  if (!cycle) {
    return null
  }

  const members = await repository.listMembers()
  if (members.length === 0) {
    throw new Error('No household members configured')
  }

  const rentRule = await repository.getRentRuleForPeriod(cycle.period)
  if (!rentRule) {
    throw new Error('No rent rule configured for this cycle period')
  }

  const period = BillingPeriod.fromString(cycle.period)
  const { start, end } = monthRange(period)
  const purchases = await repository.listParsedPurchasesForRange(start, end)
  const utilityBills = await repository.listUtilityBillsForCycle(cycle.id)
  const utilitiesMinor = await repository.getUtilityTotalForCycle(cycle.id)

  const settlement = calculateMonthlySettlement({
    cycleId: BillingCycleId.from(cycle.id),
    period,
    rent: Money.fromMinor(rentRule.amountMinor, rentRule.currency),
    utilities: Money.fromMinor(utilitiesMinor, rentRule.currency),
    utilitySplitMode: 'equal',
    members: members.map((member) => ({
      memberId: MemberId.from(member.id),
      active: true
    })),
    purchases: purchases.map((purchase) => ({
      purchaseId: PurchaseEntryId.from(purchase.id),
      payerId: MemberId.from(purchase.payerMemberId),
      amount: Money.fromMinor(purchase.amountMinor, rentRule.currency)
    }))
  })

  await repository.replaceSettlementSnapshot({
    cycleId: cycle.id,
    inputHash: computeInputHash({
      cycleId: cycle.id,
      rentMinor: rentRule.amountMinor.toString(),
      utilitiesMinor: utilitiesMinor.toString(),
      purchaseCount: purchases.length,
      memberCount: members.length
    }),
    totalDueMinor: settlement.totalDue.amountMinor,
    currency: rentRule.currency,
    metadata: {
      generatedBy: 'bot-command',
      source: 'finance-service'
    },
    lines: settlement.lines.map((line) => ({
      memberId: line.memberId.toString(),
      rentShareMinor: line.rentShare.amountMinor,
      utilityShareMinor: line.utilityShare.amountMinor,
      purchaseOffsetMinor: line.purchaseOffset.amountMinor,
      netDueMinor: line.netDue.amountMinor,
      explanations: line.explanations
    }))
  })

  const memberNameById = new Map(members.map((member) => [member.id, member.displayName]))
  const dashboardMembers = settlement.lines.map((line) => ({
    memberId: line.memberId.toString(),
    displayName: memberNameById.get(line.memberId.toString()) ?? line.memberId.toString(),
    rentShare: line.rentShare,
    utilityShare: line.utilityShare,
    purchaseOffset: line.purchaseOffset,
    netDue: line.netDue,
    explanations: line.explanations
  }))

  const ledger: FinanceDashboardLedgerEntry[] = [
    ...utilityBills.map((bill) => ({
      id: bill.id,
      kind: 'utility' as const,
      title: bill.billName,
      amount: Money.fromMinor(bill.amountMinor, bill.currency),
      actorDisplayName: bill.createdByMemberId
        ? (memberNameById.get(bill.createdByMemberId) ?? null)
        : null,
      occurredAt: bill.createdAt.toISOString()
    })),
    ...purchases.map((purchase) => ({
      id: purchase.id,
      kind: 'purchase' as const,
      title: purchase.description ?? 'Shared purchase',
      amount: Money.fromMinor(purchase.amountMinor, rentRule.currency),
      actorDisplayName: memberNameById.get(purchase.payerMemberId) ?? null,
      occurredAt: purchase.occurredAt?.toISOString() ?? null
    }))
  ].sort((left, right) => {
    if (left.occurredAt === right.occurredAt) {
      return left.title.localeCompare(right.title)
    }

    return (left.occurredAt ?? '').localeCompare(right.occurredAt ?? '')
  })

  return {
    period: cycle.period,
    currency: rentRule.currency,
    totalDue: settlement.totalDue,
    members: dashboardMembers,
    ledger
  }
}

export interface FinanceCommandService {
  getMemberByTelegramUserId(telegramUserId: string): Promise<FinanceMemberRecord | null>
  getOpenCycle(): Promise<FinanceCycleRecord | null>
  openCycle(periodArg: string, currencyArg?: string): Promise<FinanceCycleRecord>
  closeCycle(periodArg?: string): Promise<FinanceCycleRecord | null>
  setRent(
    amountArg: string,
    currencyArg?: string,
    periodArg?: string
  ): Promise<{
    amount: Money
    currency: CurrencyCode
    period: string
  } | null>
  addUtilityBill(
    billName: string,
    amountArg: string,
    createdByMemberId: string,
    currencyArg?: string
  ): Promise<{
    amount: Money
    currency: CurrencyCode
    period: string
  } | null>
  generateDashboard(periodArg?: string): Promise<FinanceDashboard | null>
  generateStatement(periodArg?: string): Promise<string | null>
}

export function createFinanceCommandService(repository: FinanceRepository): FinanceCommandService {
  return {
    getMemberByTelegramUserId(telegramUserId) {
      return repository.getMemberByTelegramUserId(telegramUserId)
    },

    getOpenCycle() {
      return repository.getOpenCycle()
    },

    async openCycle(periodArg, currencyArg) {
      const period = BillingPeriod.fromString(periodArg).toString()
      const currency = parseCurrency(currencyArg, 'USD')

      await repository.openCycle(period, currency)

      const cycle = await repository.getCycleByPeriod(period)
      if (!cycle) {
        throw new Error(`Failed to load billing cycle for period ${period}`)
      }

      return cycle
    },

    async closeCycle(periodArg) {
      const cycle = await getCycleByPeriodOrLatest(repository, periodArg)
      if (!cycle) {
        return null
      }

      await repository.closeCycle(cycle.id, new Date())
      return cycle
    },

    async setRent(amountArg, currencyArg, periodArg) {
      const openCycle = await repository.getOpenCycle()
      const period = periodArg ?? openCycle?.period
      if (!period) {
        return null
      }

      const currency = parseCurrency(currencyArg, openCycle?.currency ?? 'USD')
      const amount = Money.fromMajor(amountArg, currency)

      await repository.saveRentRule(
        BillingPeriod.fromString(period).toString(),
        amount.amountMinor,
        currency
      )

      return {
        amount,
        currency,
        period: BillingPeriod.fromString(period).toString()
      }
    },

    async addUtilityBill(billName, amountArg, createdByMemberId, currencyArg) {
      const openCycle = await repository.getOpenCycle()
      if (!openCycle) {
        return null
      }

      const currency = parseCurrency(currencyArg, openCycle.currency)
      const amount = Money.fromMajor(amountArg, currency)

      await repository.addUtilityBill({
        cycleId: openCycle.id,
        billName,
        amountMinor: amount.amountMinor,
        currency,
        createdByMemberId
      })

      return {
        amount,
        currency,
        period: openCycle.period
      }
    },

    async generateStatement(periodArg) {
      const dashboard = await buildFinanceDashboard(repository, periodArg)
      if (!dashboard) {
        return null
      }

      const statementLines = dashboard.members.map((line) => {
        return `- ${line.displayName}: ${line.netDue.toMajorString()} ${dashboard.currency}`
      })

      return [
        `Statement for ${dashboard.period}`,
        ...statementLines,
        `Total: ${dashboard.totalDue.toMajorString()} ${dashboard.currency}`
      ].join('\n')
    },

    generateDashboard(periodArg) {
      return buildFinanceDashboard(repository, periodArg)
    }
  }
}
