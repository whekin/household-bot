/**
 * Redraws a cycle's utility plan from what members owe right now.
 *
 * A published plan is frozen once somebody pays against it: it is an instruction,
 * not a live forecast, and rewriting it under people who already acted on it
 * would be worse than leaving it stale. But when the inputs move afterwards — a
 * shared purchase edited or deleted — the standing split can stop matching what
 * members actually owe, and only an explicit redraw fixes that.
 *
 * Payments already made are kept and counted as coverage, so a bill somebody has
 * settled is not handed to a housemate. Members who have paid therefore keep
 * their bills; only the open ones move.
 *
 * Usage (dry run prints the before/after split and exits):
 *   DATABASE_URL=... bun run scripts/ops/refresh-utility-plan.ts \
 *     --household <uuid> --period 2026-08
 *
 * Add --apply to write. Announce the new split afterwards: members who were
 * already told what to pay may now owe a different bill.
 */
import {
  createDbFinanceRepository,
  createDbHouseholdConfigurationRepository
} from '@household/adapters-db'
import { createFinanceCommandService } from '@household/application'

import { createNbgExchangeRateProvider } from '../../apps/bot/src/nbg-exchange-rates'

interface Options {
  householdId: string
  period: string
  apply: boolean
}

function parseOptions(argv: readonly string[]): Options {
  const read = (flag: string): string | undefined => {
    const index = argv.indexOf(flag)
    return index >= 0 ? argv[index + 1] : undefined
  }

  const householdId = read('--household')
  const period = read('--period')
  if (!householdId || !period) {
    throw new Error('--household and --period are required')
  }

  return { householdId, period, apply: argv.includes('--apply') }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`${name} is required`)
  }

  return value
}

type Dashboard = Awaited<
  ReturnType<ReturnType<typeof createFinanceCommandService>['generateDashboard']>
>

function describePlan(label: string, dashboard: Dashboard): void {
  const plan = dashboard?.utilityBillingPlan
  if (!plan) {
    console.log(`${label}: no plan`)
    return
  }

  console.log(`${label}: version ${plan.version} (${plan.status})`)
  for (const category of plan.categories) {
    const paid =
      category.paidAmount.amountMinor >= category.assignedAmount.amountMinor ? ' [paid]' : ''
    console.log(
      `  ${category.billName.padEnd(16)} -> ${category.assignedDisplayName.padEnd(10)} ${category.assignedAmount.toMajorString()}${paid}`
    )
  }
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

    describePlan('before', await service.generateDashboard(options.period))

    if (!options.apply) {
      console.log('\ndry run — re-run with --apply to redraw the plan')
      return
    }

    const refreshed = await service.refreshUtilityBillingPlan(options.period)
    console.log('')
    describePlan('after', refreshed)

    console.log('\nper member:')
    for (const summary of refreshed?.utilityBillingPlan?.memberSummaries ?? []) {
      console.log(
        `  ${summary.displayName.padEnd(10)} target ${summary.fairShare.toMajorString().padStart(7)}  to pay now ${summary.assignedThisCycle.toMajorString().padStart(7)}`
      )
    }
  } finally {
    await financeClient.close()
    await configClient.close()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
