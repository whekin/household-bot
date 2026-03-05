import { calculateMonthlySettlement } from '@household/application'
import { createDbClient, schema } from '@household/db'
import { BillingCycleId, BillingPeriod, MemberId, Money, PurchaseEntryId } from '@household/domain'
import { and, desc, eq, gte, isNotNull, isNull, lte, or, sql } from 'drizzle-orm'
import type { Bot, Context } from 'grammy'

import { createHash } from 'node:crypto'

type SupportedCurrency = 'USD' | 'GEL'

interface FinanceCommandsConfig {
  householdId: string
}

interface SettlementCycleData {
  id: string
  period: string
  currency: string
}

interface HouseholdMemberData {
  id: string
  telegramUserId: string
  displayName: string
  isAdmin: number
}

function parseCurrency(raw: string | undefined, fallback: SupportedCurrency): SupportedCurrency {
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
  const start = new Date(Date.UTC(period.year, period.month - 1, 1, 0, 0, 0))
  const end = new Date(Date.UTC(period.year, period.month, 0, 23, 59, 59))

  return {
    start,
    end
  }
}

function commandArgs(ctx: Context): string[] {
  const raw = typeof ctx.match === 'string' ? ctx.match.trim() : ''
  if (raw.length === 0) {
    return []
  }

  return raw.split(/\s+/).filter(Boolean)
}

function computeInputHash(payload: object): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

export function createFinanceCommandsService(
  databaseUrl: string,
  config: FinanceCommandsConfig
): {
  register: (bot: Bot) => void
  close: () => Promise<void>
} {
  const { db, queryClient } = createDbClient(databaseUrl, {
    max: 5,
    prepare: false
  })

  async function getMemberByTelegramUserId(
    telegramUserId: string
  ): Promise<HouseholdMemberData | null> {
    const row = await db
      .select({
        id: schema.members.id,
        telegramUserId: schema.members.telegramUserId,
        displayName: schema.members.displayName,
        isAdmin: schema.members.isAdmin
      })
      .from(schema.members)
      .where(
        and(
          eq(schema.members.householdId, config.householdId),
          eq(schema.members.telegramUserId, telegramUserId)
        )
      )
      .limit(1)

    return row[0] ?? null
  }

  async function requireMember(ctx: Context): Promise<HouseholdMemberData | null> {
    const telegramUserId = ctx.from?.id?.toString()
    if (!telegramUserId) {
      await ctx.reply('Unable to identify sender for this command.')
      return null
    }

    const member = await getMemberByTelegramUserId(telegramUserId)
    if (!member) {
      await ctx.reply('You are not a member of this household.')
      return null
    }

    return member
  }

  async function requireAdmin(ctx: Context): Promise<HouseholdMemberData | null> {
    const member = await requireMember(ctx)
    if (!member) {
      return null
    }

    if (member.isAdmin !== 1) {
      await ctx.reply('Only household admins can use this command.')
      return null
    }

    return member
  }

  async function getOpenCycle(): Promise<SettlementCycleData | null> {
    const cycle = await db
      .select({
        id: schema.billingCycles.id,
        period: schema.billingCycles.period,
        currency: schema.billingCycles.currency
      })
      .from(schema.billingCycles)
      .where(
        and(
          eq(schema.billingCycles.householdId, config.householdId),
          isNull(schema.billingCycles.closedAt)
        )
      )
      .orderBy(desc(schema.billingCycles.startedAt))
      .limit(1)

    return cycle[0] ?? null
  }

  async function getCycleByPeriodOrLatest(periodArg?: string): Promise<SettlementCycleData | null> {
    if (periodArg) {
      const period = BillingPeriod.fromString(periodArg).toString()
      const cycle = await db
        .select({
          id: schema.billingCycles.id,
          period: schema.billingCycles.period,
          currency: schema.billingCycles.currency
        })
        .from(schema.billingCycles)
        .where(
          and(
            eq(schema.billingCycles.householdId, config.householdId),
            eq(schema.billingCycles.period, period)
          )
        )
        .limit(1)

      return cycle[0] ?? null
    }

    const latestCycle = await db
      .select({
        id: schema.billingCycles.id,
        period: schema.billingCycles.period,
        currency: schema.billingCycles.currency
      })
      .from(schema.billingCycles)
      .where(eq(schema.billingCycles.householdId, config.householdId))
      .orderBy(desc(schema.billingCycles.period))
      .limit(1)

    return latestCycle[0] ?? null
  }

  async function upsertSettlementSnapshot(cycle: SettlementCycleData): Promise<string> {
    const members = await db
      .select({
        id: schema.members.id,
        displayName: schema.members.displayName
      })
      .from(schema.members)
      .where(eq(schema.members.householdId, config.householdId))
      .orderBy(schema.members.displayName)

    if (members.length === 0) {
      throw new Error('No household members configured')
    }

    const rentRule = await db
      .select({
        amountMinor: schema.rentRules.amountMinor,
        currency: schema.rentRules.currency
      })
      .from(schema.rentRules)
      .where(
        and(
          eq(schema.rentRules.householdId, config.householdId),
          lte(schema.rentRules.effectiveFromPeriod, cycle.period),
          or(
            isNull(schema.rentRules.effectiveToPeriod),
            gte(schema.rentRules.effectiveToPeriod, cycle.period)
          )
        )
      )
      .orderBy(desc(schema.rentRules.effectiveFromPeriod))
      .limit(1)

    if (!rentRule[0]) {
      throw new Error('No rent rule configured for this cycle period')
    }

    const utilityTotalRow = await db
      .select({
        totalMinor: sql<string>`coalesce(sum(${schema.utilityBills.amountMinor}), 0)`
      })
      .from(schema.utilityBills)
      .where(eq(schema.utilityBills.cycleId, cycle.id))

    const period = BillingPeriod.fromString(cycle.period)
    const range = monthRange(period)

    const purchases = await db
      .select({
        id: schema.purchaseMessages.id,
        senderMemberId: schema.purchaseMessages.senderMemberId,
        parsedAmountMinor: schema.purchaseMessages.parsedAmountMinor
      })
      .from(schema.purchaseMessages)
      .where(
        and(
          eq(schema.purchaseMessages.householdId, config.householdId),
          isNotNull(schema.purchaseMessages.senderMemberId),
          isNotNull(schema.purchaseMessages.parsedAmountMinor),
          gte(schema.purchaseMessages.messageSentAt, range.start),
          lte(schema.purchaseMessages.messageSentAt, range.end)
        )
      )

    const currency = parseCurrency(rentRule[0].currency, 'USD')
    const utilitiesMinor = BigInt(utilityTotalRow[0]?.totalMinor ?? '0')

    const settlementInput = {
      cycleId: BillingCycleId.from(cycle.id),
      period,
      rent: Money.fromMinor(rentRule[0].amountMinor, currency),
      utilities: Money.fromMinor(utilitiesMinor, currency),
      utilitySplitMode: 'equal' as const,
      members: members.map((member) => ({
        memberId: MemberId.from(member.id),
        active: true
      })),
      purchases: purchases.map((purchase) => ({
        purchaseId: PurchaseEntryId.from(purchase.id),
        payerId: MemberId.from(purchase.senderMemberId!),
        amount: Money.fromMinor(purchase.parsedAmountMinor!, currency)
      }))
    }

    const settlement = calculateMonthlySettlement(settlementInput)
    const inputHash = computeInputHash({
      cycleId: cycle.id,
      rentMinor: rentRule[0].amountMinor.toString(),
      utilitiesMinor: utilitiesMinor.toString(),
      purchaseCount: purchases.length,
      memberCount: members.length
    })

    const upserted = await db
      .insert(schema.settlements)
      .values({
        householdId: config.householdId,
        cycleId: cycle.id,
        inputHash,
        totalDueMinor: settlement.totalDue.amountMinor,
        currency,
        metadata: {
          generatedBy: 'bot-command',
          source: 'statement'
        }
      })
      .onConflictDoUpdate({
        target: [schema.settlements.cycleId],
        set: {
          inputHash,
          totalDueMinor: settlement.totalDue.amountMinor,
          currency,
          computedAt: new Date(),
          metadata: {
            generatedBy: 'bot-command',
            source: 'statement'
          }
        }
      })
      .returning({ id: schema.settlements.id })

    const settlementId = upserted[0]?.id
    if (!settlementId) {
      throw new Error('Failed to persist settlement snapshot')
    }

    await db
      .delete(schema.settlementLines)
      .where(eq(schema.settlementLines.settlementId, settlementId))

    const memberNameById = new Map(members.map((member) => [member.id, member.displayName]))

    await db.insert(schema.settlementLines).values(
      settlement.lines.map((line) => ({
        settlementId,
        memberId: line.memberId.toString(),
        rentShareMinor: line.rentShare.amountMinor,
        utilityShareMinor: line.utilityShare.amountMinor,
        purchaseOffsetMinor: line.purchaseOffset.amountMinor,
        netDueMinor: line.netDue.amountMinor,
        explanations: line.explanations
      }))
    )

    const statementLines = settlement.lines.map((line) => {
      const name = memberNameById.get(line.memberId.toString()) ?? line.memberId.toString()
      return `- ${name}: ${line.netDue.toMajorString()} ${currency}`
    })

    return [
      `Statement for ${cycle.period}`,
      ...statementLines,
      `Total: ${settlement.totalDue.toMajorString()} ${currency}`
    ].join('\n')
  }

  function register(bot: Bot): void {
    bot.command('cycle_open', async (ctx) => {
      const admin = await requireAdmin(ctx)
      if (!admin) {
        return
      }

      const args = commandArgs(ctx)
      if (args.length === 0) {
        await ctx.reply('Usage: /cycle_open <YYYY-MM> [USD|GEL]')
        return
      }

      try {
        const period = BillingPeriod.fromString(args[0]!).toString()
        const currency = parseCurrency(args[1], 'USD')

        await db
          .insert(schema.billingCycles)
          .values({
            householdId: config.householdId,
            period,
            currency
          })
          .onConflictDoNothing({
            target: [schema.billingCycles.householdId, schema.billingCycles.period]
          })

        await ctx.reply(`Cycle opened: ${period} (${currency})`)
      } catch (error) {
        await ctx.reply(`Failed to open cycle: ${(error as Error).message}`)
      }
    })

    bot.command('cycle_close', async (ctx) => {
      const admin = await requireAdmin(ctx)
      if (!admin) {
        return
      }

      const args = commandArgs(ctx)
      try {
        const cycle = await getCycleByPeriodOrLatest(args[0])
        if (!cycle) {
          await ctx.reply('No cycle found to close.')
          return
        }

        await db
          .update(schema.billingCycles)
          .set({
            closedAt: new Date()
          })
          .where(eq(schema.billingCycles.id, cycle.id))

        await ctx.reply(`Cycle closed: ${cycle.period}`)
      } catch (error) {
        await ctx.reply(`Failed to close cycle: ${(error as Error).message}`)
      }
    })

    bot.command('rent_set', async (ctx) => {
      const admin = await requireAdmin(ctx)
      if (!admin) {
        return
      }

      const args = commandArgs(ctx)
      if (args.length === 0) {
        await ctx.reply('Usage: /rent_set <amount> [USD|GEL] [YYYY-MM]')
        return
      }

      try {
        const openCycle = await getOpenCycle()
        const period = args[2] ?? openCycle?.period
        if (!period) {
          await ctx.reply('No period provided and no open cycle found.')
          return
        }

        const currency = parseCurrency(args[1], (openCycle?.currency as SupportedCurrency) ?? 'USD')
        const amount = Money.fromMajor(args[0]!, currency)

        await db
          .insert(schema.rentRules)
          .values({
            householdId: config.householdId,
            amountMinor: amount.amountMinor,
            currency,
            effectiveFromPeriod: BillingPeriod.fromString(period).toString()
          })
          .onConflictDoUpdate({
            target: [schema.rentRules.householdId, schema.rentRules.effectiveFromPeriod],
            set: {
              amountMinor: amount.amountMinor,
              currency
            }
          })

        await ctx.reply(
          `Rent rule saved: ${amount.toMajorString()} ${currency} starting ${BillingPeriod.fromString(period).toString()}`
        )
      } catch (error) {
        await ctx.reply(`Failed to save rent rule: ${(error as Error).message}`)
      }
    })

    bot.command('utility_add', async (ctx) => {
      const admin = await requireAdmin(ctx)
      if (!admin) {
        return
      }

      const args = commandArgs(ctx)
      if (args.length < 2) {
        await ctx.reply('Usage: /utility_add <name> <amount> [USD|GEL]')
        return
      }

      try {
        const openCycle = await getOpenCycle()
        if (!openCycle) {
          await ctx.reply('No open cycle found. Use /cycle_open first.')
          return
        }

        const name = args[0]!
        const amountRaw = args[1]!
        const currency = parseCurrency(args[2], parseCurrency(openCycle.currency, 'USD'))
        const amount = Money.fromMajor(amountRaw, currency)

        await db.insert(schema.utilityBills).values({
          householdId: config.householdId,
          cycleId: openCycle.id,
          billName: name,
          amountMinor: amount.amountMinor,
          currency,
          source: 'manual',
          createdByMemberId: admin.id
        })

        await ctx.reply(
          `Utility bill added: ${name} ${amount.toMajorString()} ${currency} for ${openCycle.period}`
        )
      } catch (error) {
        await ctx.reply(`Failed to add utility bill: ${(error as Error).message}`)
      }
    })

    bot.command('statement', async (ctx) => {
      const member = await requireMember(ctx)
      if (!member) {
        return
      }

      const args = commandArgs(ctx)
      try {
        const cycle = await getCycleByPeriodOrLatest(args[0])
        if (!cycle) {
          await ctx.reply('No cycle found for statement.')
          return
        }

        const message = await upsertSettlementSnapshot(cycle)
        await ctx.reply(message)
      } catch (error) {
        await ctx.reply(`Failed to generate statement: ${(error as Error).message}`)
      }
    })
  }

  return {
    register,
    close: async () => {
      await queryClient.end({ timeout: 5 })
    }
  }
}
