import { nextPaymentFundingPhase } from './payment-funding-phase'
import { createHash } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'

import { schema, type createDbClient } from '@household/db'
import { Money } from '@household/domain'
import type { UtilityBillImportRepository, UtilityBillImportSnapshot } from '@household/ports'

export function createUtilityBillImportRepository(
  db: ReturnType<typeof createDbClient>['db'],
  householdId: string
): UtilityBillImportRepository {
  async function snapshot(
    reader: Pick<ReturnType<typeof createDbClient>['db'], 'select'>,
    period: string
  ): Promise<UtilityBillImportSnapshot> {
    const [cycle] = await reader
      .select()
      .from(schema.billingCycles)
      .where(
        and(
          eq(schema.billingCycles.householdId, householdId),
          eq(schema.billingCycles.period, period)
        )
      )
    const categories = await reader
      .select()
      .from(schema.householdUtilityCategories)
      .where(eq(schema.householdUtilityCategories.householdId, householdId))
    const members = await reader
      .select()
      .from(schema.members)
      .where(eq(schema.members.householdId, householdId))
    const bills = cycle
      ? await reader
          .select()
          .from(schema.utilityBills)
          .where(
            and(
              eq(schema.utilityBills.householdId, householdId),
              eq(schema.utilityBills.cycleId, cycle.id)
            )
          )
      : []
    const payments = cycle
      ? await reader
          .select()
          .from(schema.paymentRecords)
          .where(
            and(
              eq(schema.paymentRecords.householdId, householdId),
              eq(schema.paymentRecords.cycleId, cycle.id),
              eq(schema.paymentRecords.kind, 'utilities')
            )
          )
      : []
    const facts = cycle
      ? await reader
          .select()
          .from(schema.utilityVendorPaymentFacts)
          .where(
            and(
              eq(schema.utilityVendorPaymentFacts.householdId, householdId),
              eq(schema.utilityVendorPaymentFacts.cycleId, cycle.id)
            )
          )
      : []
    const plans = cycle
      ? await reader
          .select({ id: schema.utilityBillingPlans.id, status: schema.utilityBillingPlans.status })
          .from(schema.utilityBillingPlans)
          .where(
            and(
              eq(schema.utilityBillingPlans.householdId, householdId),
              eq(schema.utilityBillingPlans.cycleId, cycle.id),
              inArray(schema.utilityBillingPlans.status, ['active', 'settled'])
            )
          )
      : []
    const closed = Boolean(cycle?.closedAt)
    const paidByBillId: Record<string, string> = {}
    const paidByBillAndMember = new Map<string, Map<string, bigint>>()
    for (const fact of facts) {
      const billId =
        fact.utilityBillId ??
        bills.find(
          (bill) => bill.billName.trim().toLowerCase() === fact.billName.trim().toLowerCase()
        )?.id
      if (billId && fact.currency === 'GEL')
        paidByBillId[billId] = (BigInt(paidByBillId[billId] ?? '0') + fact.amountMinor).toString()
      const payer = members.find(
        (member) => member.id === fact.payerMemberId && member.lifecycleStatus !== 'left'
      )
      if (billId && fact.currency === 'GEL' && payer) {
        const totals = paidByBillAndMember.get(billId) ?? new Map<string, bigint>()
        totals.set(payer.id, (totals.get(payer.id) ?? 0n) + fact.amountMinor)
        paidByBillAndMember.set(billId, totals)
      }
    }
    const sorted = <T extends { id: string }>(rows: T[]) =>
      rows.toSorted((a, b) => a.id.localeCompare(b.id))
    const revision = createHash('sha256')
      .update(
        JSON.stringify({
          closed,
          members: sorted(members).map((row) => [
            row.id,
            row.displayName,
            row.lifecycleStatus,
            row.isAdmin
          ]),
          bills: sorted(bills).map((row) => [
            row.id,
            row.billName,
            row.amountMinor.toString(),
            row.currency
          ]),
          payments: sorted(payments).map((row) => [
            row.id,
            row.memberId,
            row.amountMinor.toString(),
            row.currency
          ]),
          facts: sorted(facts).map((row) => [
            row.id,
            row.payerMemberId,
            row.utilityBillId,
            row.billName,
            row.amountMinor.toString(),
            row.currency
          ]),
          plans: sorted(plans),
          categories: sorted(categories).map((row) => [
            row.id,
            row.name,
            row.slug,
            row.isActive,
            row.providerName,
            row.customerNumber
          ])
        })
      )
      .digest('hex')
    return {
      revision,
      closed,
      paidByBillId,
      contributorsByBillId: Object.fromEntries(
        [...paidByBillAndMember].map(([billId, totals]) => [
          billId,
          [...totals]
            .filter(([, amount]) => amount > 0n)
            .map(([memberId, amount]) => ({
              memberId,
              displayName: members.find((member) => member.id === memberId)!.displayName,
              paidMinor: amount.toString()
            }))
        ])
      ),
      categories: categories.map((row) => ({ ...row, isActive: row.isActive === 1 })),
      hasPayments:
        payments.some((row) => row.amountMinor !== 0n) ||
        facts.some((row) => row.amountMinor !== 0n),
      bills: bills.map((row) => {
        if (row.currency !== 'GEL' && row.currency !== 'USD')
          throw new Error('Invalid bill currency')
        return {
          id: row.id,
          billName: row.billName,
          amountMinor: row.amountMinor.toString(),
          currency: row.currency
        }
      })
    }
  }

  return {
    getSnapshot: (period) =>
      db.transaction((tx) => snapshot(tx, period), { isolationLevel: 'repeatable read' }),
    async apply(input) {
      try {
        return await db.transaction(
          async (tx) => {
            const reviewed = await snapshot(tx, input.period)
            if (reviewed.revision !== input.expectedRevision || reviewed.closed)
              return 'stale' as const
            const [settings] = await tx
              .select()
              .from(schema.householdBillingSettings)
              .where(eq(schema.householdBillingSettings.householdId, householdId))
            await tx
              .insert(schema.billingCycles)
              .values({
                householdId,
                period: input.period,
                currency: settings?.settlementCurrency ?? 'GEL'
              })
              .onConflictDoNothing()
            const [cycle] = await tx
              .select()
              .from(schema.billingCycles)
              .where(
                and(
                  eq(schema.billingCycles.householdId, householdId),
                  eq(schema.billingCycles.period, input.period)
                )
              )
              .for('update')
            if (!cycle) throw new Error('Missing import cycle')
            const current = await snapshot(tx, input.period)
            if (current.revision !== input.expectedRevision || current.closed)
              return 'stale' as const
            if (
              current.hasPayments &&
              input.changes.some(
                (change) =>
                  change.billId &&
                  BigInt(
                    current.bills.find((bill) => bill.id === change.billId)?.amountMinor ?? '0'
                  ) > 0n
              )
            )
              return 'stale' as const
            if (input.additionalPayment && input.automaticRoundingBalances?.length)
              throw new Error('Cannot mix manual and automatic reconciliation')
            const paymentsToWrite: {
              payment: NonNullable<typeof input.additionalPayment>
              automatic: boolean
            }[] = []
            if (input.additionalPayment)
              paymentsToWrite.push({ payment: input.additionalPayment, automatic: false })
            let automaticTotal = 0n
            const automaticBills = new Set<string>()
            for (const balance of input.automaticRoundingBalances ?? []) {
              if (automaticBills.has(balance.utilityBillId))
                throw new Error('Duplicate automatic reconciliation bill')
              automaticBills.add(balance.utilityBillId)
              const bill = current.bills.find((row) => row.id === balance.utilityBillId)
              const observed = BigInt(balance.observedMinor)
              const expected = bill
                ? BigInt(bill.amountMinor) - BigInt(current.paidByBillId[bill.id] ?? '0')
                : 0n
              const delta = expected - observed
              const contributors = (current.contributorsByBillId?.[balance.utilityBillId] ?? [])
                .filter((row) => BigInt(row.paidMinor) > 0n)
                .toSorted((a, b) => a.memberId.localeCompare(b.memberId))
              if (!bill || observed < 0n || delta <= 0n || delta > 50n)
                throw new Error('Invalid automatic rounding reconciliation')
              automaticTotal += delta
              if (automaticTotal > 50n)
                throw new Error('Automatic reconciliation exceeds its total limit')
              if (!contributors.length) continue
              const shares = Money.fromMinor(delta, 'GEL').splitByWeights(
                contributors.map((row) => BigInt(row.paidMinor))
              )
              contributors.forEach((row, index) => {
                if (shares[index]!.amountMinor > 0n)
                  paymentsToWrite.push({
                    automatic: true,
                    payment: {
                      utilityBillId: bill.id,
                      payerMemberId: row.memberId,
                      amountMinor: shares[index]!.amountMinor.toString()
                    }
                  })
              })
            }
            for (const { payment, automatic } of paymentsToWrite) {
              const bill = current.bills.find((row) => row.id === payment.utilityBillId)
              const amountMinor = BigInt(payment.amountMinor)
              if (
                !bill ||
                amountMinor <= 0n ||
                amountMinor > 200n ||
                BigInt(bill.amountMinor) <= 0n ||
                cycle.currency !== 'GEL' ||
                bill.currency !== 'GEL'
              )
                throw new Error('Invalid rounding payment')
              const members = await tx
                .select()
                .from(schema.members)
                .where(
                  and(
                    eq(schema.members.householdId, householdId),
                    inArray(schema.members.id, [input.createdByMemberId, payment.payerMemberId])
                  )
                )
              const actor = members.find((row) => row.id === input.createdByMemberId)
              const payer = members.find((row) => row.id === payment.payerMemberId)
              if (
                !actor ||
                !payer ||
                actor.lifecycleStatus === 'left' ||
                payer.lifecycleStatus === 'left' ||
                (!automatic && actor.id !== payer.id && actor.isAdmin !== 1)
              )
                throw new Error('Payment attribution requires the payer or an administrator')
              const recordedAt = new Date()
              const idempotencyKey = `utility-rounding:${householdId}:${cycle.id}:${current.revision}:${bill.id}:${automatic ? 'auto' : 'manual'}:${payer.id}`
              const [record] = await tx
                .insert(schema.paymentRecords)
                .values({
                  householdId,
                  cycleId: cycle.id,
                  memberId: payer.id,
                  kind: 'utilities',
                  amountMinor,
                  currency: 'GEL',
                  recordedAt,
                  fundingPhase: await nextPaymentFundingPhase(tx, householdId, cycle.id),
                  purchaseReconciliationPending: 1,
                  idempotencyKey
                })
                .returning({ id: schema.paymentRecords.id })
              await tx.insert(schema.utilityVendorPaymentFacts).values({
                householdId,
                cycleId: cycle.id,
                utilityBillId: bill.id,
                billName: bill.billName,
                payerMemberId: payer.id,
                amountMinor,
                currency: 'GEL',
                matchedPlan: 0,
                recordedByMemberId: actor.id,
                recordedAt,
                paymentRecordId: record!.id,
                idempotencyKey
              })
              // A newly attributed contribution changes who funds the remainder.
              // Mark the old assignments stale in the same transaction, so even
              // ordinary dashboard reads rebuild instead of returning frozen dues.
              await tx
                .update(schema.utilityBillingPlans)
                .set({ status: 'diverged' })
                .where(
                  and(
                    eq(schema.utilityBillingPlans.householdId, householdId),
                    eq(schema.utilityBillingPlans.cycleId, cycle.id),
                    inArray(schema.utilityBillingPlans.status, ['active', 'settled'])
                  )
                )
            }
            for (const change of input.changes) {
              if (change.billId) {
                await tx
                  .update(schema.utilityBills)
                  .set({
                    amountMinor: BigInt(change.amountMinor),
                    currency: 'GEL',
                    source: 'bank_screenshot'
                  })
                  .where(
                    and(
                      eq(schema.utilityBills.householdId, householdId),
                      eq(schema.utilityBills.cycleId, cycle.id),
                      eq(schema.utilityBills.id, change.billId)
                    )
                  )
              } else {
                await tx.insert(schema.utilityBills).values({
                  householdId,
                  cycleId: cycle.id,
                  billName: change.billName,
                  amountMinor: BigInt(change.amountMinor),
                  currency: 'GEL',
                  source: 'bank_screenshot',
                  createdByMemberId: input.createdByMemberId
                })
              }
            }
            if (!current.hasPayments)
              await tx
                .update(schema.utilityBillingPlans)
                .set({ status: 'superseded' })
                .where(
                  and(
                    eq(schema.utilityBillingPlans.householdId, householdId),
                    eq(schema.utilityBillingPlans.cycleId, cycle.id),
                    inArray(schema.utilityBillingPlans.status, ['active', 'settled'])
                  )
                )
            return 'applied' as const
          },
          { isolationLevel: 'serializable' }
        )
      } catch (error) {
        const cause = error && typeof error === 'object' && 'cause' in error ? error.cause : error
        if (cause && typeof cause === 'object' && 'code' in cause && cause.code === '40001')
          return 'stale'
        throw error
      }
    }
  }
}
