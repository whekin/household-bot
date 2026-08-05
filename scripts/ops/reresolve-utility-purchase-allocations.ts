/**
 * Re-runs the planned-utility resolution for one member so their purchase
 * allocations are recomputed with the current code.
 *
 * Why this exists: before `fix(application): fund purchase allocation with real
 * payments`, closing a planned utility payment allocated the member's *plan
 * target* against their purchase debt instead of the money they actually paid.
 * Where a cycle's bills were smaller than that target, the difference cleared
 * debt owed to other members for free. The bad allocations are persisted rows,
 * so deploying the fix does not repair them by itself.
 *
 * Re-resolving is enough to repair them. `replacePaymentPurchaseAllocations`
 * swaps the payment's whole allocation set, and the resolver passes the payment
 * id as `reresolvePaymentRecordId`, which adds its own prior allocations back
 * into the outstanding view so the recompute sees the true gross debt.
 *
 * It deliberately does NOT delete and re-record the payment: the plan stays
 * locked, so every other member's published assignment is left untouched.
 *
 * Usage (dry run prints the diff and exits):
 *   DATABASE_URL=... bun run scripts/ops/reresolve-utility-purchase-allocations.ts \
 *     --household <uuid> --member <uuid> --period 2026-08
 *
 * Add --apply to write.
 */
import {
  createDbFinanceRepository,
  createDbHouseholdConfigurationRepository
} from '@household/adapters-db'
import { createFinanceCommandService } from '@household/application'

import { createNbgExchangeRateProvider } from '../../apps/bot/src/nbg-exchange-rates'

interface Options {
  householdId: string
  memberId: string
  period: string
  apply: boolean
}

function parseOptions(argv: readonly string[]): Options {
  const read = (flag: string): string | undefined => {
    const index = argv.indexOf(flag)
    return index >= 0 ? argv[index + 1] : undefined
  }

  const householdId = read('--household')
  const memberId = read('--member')
  const period = read('--period')

  if (!householdId || !memberId || !period) {
    throw new Error('--household, --member and --period are required')
  }

  return { householdId, memberId, period, apply: argv.includes('--apply') }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`${name} is required`)
  }

  return value
}

function formatMinor(amountMinor: bigint): string {
  const negative = amountMinor < 0n
  const absolute = negative ? -amountMinor : amountMinor
  return `${negative ? '-' : ''}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2))
  const databaseUrl = requireEnv('DATABASE_URL')

  const financeClient = createDbFinanceRepository(databaseUrl, options.householdId)
  const configClient = createDbHouseholdConfigurationRepository(databaseUrl)

  try {
    const service = createFinanceCommandService({
      householdId: options.householdId,
      repository: financeClient.repository,
      householdConfigurationRepository: configClient.repository,
      exchangeRateProvider: createNbgExchangeRateProvider()
    })

    // Re-resolution rewrites the allocations of exactly one payment record — the
    // member's latest utilities payment in this cycle, which is the one the
    // resolver passes as `reresolvePaymentRecordId`. Report that set only.
    // Their allocations from earlier cycles hang off other payments and are left
    // alone, so counting every allocation the member ever received would hide
    // the change behind unrelated history.
    const cycle = await financeClient.repository.getCycleByPeriod(options.period)
    if (!cycle) {
      throw new Error(`No billing cycle for period ${options.period}`)
    }

    const targetPayment = (await financeClient.repository.listPaymentRecordsForCycle(cycle.id))
      .filter((payment) => payment.memberId === options.memberId && payment.kind === 'utilities')
      .sort((left, right) =>
        right.recordedAt.toString().localeCompare(left.recordedAt.toString())
      )[0]
    if (!targetPayment) {
      throw new Error(`No utilities payment for that member in ${options.period}`)
    }

    console.log(`target payment ${targetPayment.id} (${formatMinor(targetPayment.amountMinor)})\n`)

    const allocationsFor = async (): Promise<
      readonly { purchaseId: string; amountMinor: bigint }[]
    > =>
      (await financeClient.repository.listPaymentPurchaseAllocations())
        .filter((allocation) => allocation.paymentRecordId === targetPayment.id)
        .map((allocation) => ({
          purchaseId: allocation.purchaseId,
          amountMinor: allocation.amountMinor
        }))

    const before = await allocationsFor()
    const beforeTotal = before.reduce((sum, allocation) => sum + allocation.amountMinor, 0n)
    console.log(`before: ${before.length} allocation(s), total ${formatMinor(beforeTotal)}`)
    for (const allocation of before) {
      console.log(`  ${allocation.purchaseId} ${formatMinor(allocation.amountMinor)}`)
    }

    if (!options.apply) {
      console.log('\ndry run — re-run with --apply to rewrite the allocations')
      return
    }

    await service.resolveUtilityBillAsPlanned({
      memberId: options.memberId,
      periodArg: options.period
    })

    const after = await allocationsFor()
    const afterTotal = after.reduce((sum, allocation) => sum + allocation.amountMinor, 0n)
    console.log(`\nafter: ${after.length} allocation(s), total ${formatMinor(afterTotal)}`)
    for (const allocation of after) {
      console.log(`  ${allocation.purchaseId} ${formatMinor(allocation.amountMinor)}`)
    }

    const dashboard = await service.generateDashboard(options.period)
    console.log('\nresulting purchase offsets:')
    for (const member of dashboard?.members ?? []) {
      console.log(
        `  ${member.displayName.padEnd(12)} ${formatMinor(member.purchaseOffset.amountMinor)}`
      )
    }
    const offsetSum = (dashboard?.members ?? []).reduce(
      (sum, member) => sum + member.purchaseOffset.amountMinor,
      0n
    )
    console.log(`  ${'sum'.padEnd(12)} ${formatMinor(offsetSum)} (must be 0.00)`)
  } finally {
    await financeClient.close()
    await configClient.close()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
