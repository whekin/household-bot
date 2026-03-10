import type { FinanceCommandService } from '@household/application'
import { Money } from '@household/domain'
import type { HouseholdConfigurationRepository } from '@household/ports'
import type { Bot, Context } from 'grammy'

import { getBotTranslations } from './i18n'
import { resolveReplyLocale } from './bot-locale'

function commandArgs(ctx: Context): string[] {
  const raw = typeof ctx.match === 'string' ? ctx.match.trim() : ''
  if (raw.length === 0) {
    return []
  }

  return raw.split(/\s+/).filter(Boolean)
}

function formatBillingPeriodLabel(
  locale: Parameters<typeof getBotTranslations>[0],
  period: string
): string {
  const [yearRaw, monthRaw] = period.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return period
  }

  const formatter = new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  })

  return formatter.format(new Date(Date.UTC(year, month - 1, 1)))
}

function formatCycleDueDate(
  locale: Parameters<typeof getBotTranslations>[0],
  period: string,
  dueDay: number
): string {
  const [yearRaw, monthRaw] = period.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return period
  }

  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const day = Math.min(Math.max(dueDay, 1), maxDay)
  const formatter = new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-US', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC'
  })

  return formatter.format(new Date(Date.UTC(year, month - 1, day)))
}

function isGroupChat(ctx: Context): boolean {
  return ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup'
}

export function createFinanceCommandsService(options: {
  householdConfigurationRepository: HouseholdConfigurationRepository
  financeServiceForHousehold: (householdId: string) => FinanceCommandService
}): {
  register: (bot: Bot) => void
} {
  function formatStatement(
    locale: Parameters<typeof getBotTranslations>[0],
    dashboard: NonNullable<Awaited<ReturnType<FinanceCommandService['generateDashboard']>>>
  ): string {
    const t = getBotTranslations(locale).finance

    return [
      t.statementTitle(dashboard.period),
      ...dashboard.members.map((line) =>
        t.statementLine(line.displayName, line.netDue.toMajorString(), dashboard.currency)
      ),
      t.statementTotal(dashboard.totalDue.toMajorString(), dashboard.currency)
    ].join('\n')
  }

  function formatHouseholdStatus(
    locale: Parameters<typeof getBotTranslations>[0],
    dashboard: NonNullable<Awaited<ReturnType<FinanceCommandService['generateDashboard']>>>,
    dueDay: number
  ): string {
    const t = getBotTranslations(locale).finance
    const utilityTotal = dashboard.ledger
      .filter((entry) => entry.kind === 'utility')
      .reduce((sum, entry) => sum.add(entry.displayAmount), Money.zero(dashboard.currency))
    const purchaseTotal = dashboard.ledger
      .filter((entry) => entry.kind === 'purchase')
      .reduce((sum, entry) => sum.add(entry.displayAmount), Money.zero(dashboard.currency))

    const rentLine =
      dashboard.rentSourceAmount.currency === dashboard.rentDisplayAmount.currency
        ? t.householdStatusRentDirect(
            dashboard.rentDisplayAmount.toMajorString(),
            dashboard.currency
          )
        : t.householdStatusRentConverted(
            dashboard.rentSourceAmount.toMajorString(),
            dashboard.rentSourceAmount.currency,
            dashboard.rentDisplayAmount.toMajorString(),
            dashboard.currency
          )

    return [
      t.householdStatusTitle(formatBillingPeriodLabel(locale, dashboard.period)),
      t.householdStatusDueDate(formatCycleDueDate(locale, dashboard.period, dueDay)),
      rentLine,
      t.householdStatusUtilities(utilityTotal.toMajorString(), dashboard.currency),
      t.householdStatusPurchases(purchaseTotal.toMajorString(), dashboard.currency),
      ...dashboard.members.map((member) =>
        t.householdStatusMember(
          member.displayName,
          member.netDue.toMajorString(),
          member.paid.toMajorString(),
          member.remaining.toMajorString(),
          dashboard.currency
        )
      ),
      t.householdStatusTotals(
        dashboard.totalDue.toMajorString(),
        dashboard.totalPaid.toMajorString(),
        dashboard.totalRemaining.toMajorString(),
        dashboard.currency
      )
    ].join('\n')
  }

  async function resolveGroupFinanceService(ctx: Context): Promise<{
    service: FinanceCommandService
    householdId: string
  } | null> {
    const locale = await resolveReplyLocale({
      ctx,
      repository: options.householdConfigurationRepository
    })
    const t = getBotTranslations(locale).finance
    if (!isGroupChat(ctx)) {
      await ctx.reply(t.useInGroup)
      return null
    }

    const household = await options.householdConfigurationRepository.getTelegramHouseholdChat(
      ctx.chat!.id.toString()
    )
    if (!household) {
      await ctx.reply(t.householdNotConfigured)
      return null
    }

    return {
      service: options.financeServiceForHousehold(household.householdId),
      householdId: household.householdId
    }
  }

  async function requireMember(ctx: Context) {
    const locale = await resolveReplyLocale({
      ctx,
      repository: options.householdConfigurationRepository
    })
    const t = getBotTranslations(locale).finance
    const telegramUserId = ctx.from?.id?.toString()
    if (!telegramUserId) {
      await ctx.reply(t.unableToIdentifySender)
      return null
    }

    const scoped = await resolveGroupFinanceService(ctx)
    if (!scoped) {
      return null
    }

    const member = await scoped.service.getMemberByTelegramUserId(telegramUserId)
    if (!member) {
      await ctx.reply(t.notMember)
      return null
    }

    return {
      member,
      service: scoped.service,
      householdId: scoped.householdId
    }
  }

  async function requireAdmin(ctx: Context) {
    const locale = await resolveReplyLocale({
      ctx,
      repository: options.householdConfigurationRepository
    })
    const t = getBotTranslations(locale).finance
    const resolved = await requireMember(ctx)
    if (!resolved) {
      return null
    }

    if (!resolved.member.isAdmin) {
      await ctx.reply(t.adminOnly)
      return null
    }

    return resolved
  }

  function register(bot: Bot): void {
    bot.command('household_status', async (ctx) => {
      const locale = await resolveReplyLocale({
        ctx,
        repository: options.householdConfigurationRepository
      })
      const t = getBotTranslations(locale).finance
      const resolved = await requireMember(ctx)
      if (!resolved) {
        return
      }

      try {
        const dashboard = await resolved.service.generateDashboard(commandArgs(ctx)[0])
        if (!dashboard) {
          await ctx.reply(t.noStatementCycle)
          return
        }

        const settings = await options.householdConfigurationRepository.getHouseholdBillingSettings(
          resolved.householdId
        )

        await ctx.reply(formatHouseholdStatus(locale, dashboard, settings.rentDueDay))
      } catch (error) {
        await ctx.reply(t.statementFailed((error as Error).message))
      }
    })

    bot.command('cycle_open', async (ctx) => {
      const locale = await resolveReplyLocale({
        ctx,
        repository: options.householdConfigurationRepository
      })
      const t = getBotTranslations(locale).finance
      const resolved = await requireAdmin(ctx)
      if (!resolved) {
        return
      }

      const args = commandArgs(ctx)
      if (args.length === 0) {
        await ctx.reply(t.cycleOpenUsage)
        return
      }

      try {
        const cycle = await resolved.service.openCycle(args[0]!, args[1])
        await ctx.reply(t.cycleOpened(cycle.period, cycle.currency))
      } catch (error) {
        await ctx.reply(t.cycleOpenFailed((error as Error).message))
      }
    })

    bot.command('cycle_close', async (ctx) => {
      const locale = await resolveReplyLocale({
        ctx,
        repository: options.householdConfigurationRepository
      })
      const t = getBotTranslations(locale).finance
      const resolved = await requireAdmin(ctx)
      if (!resolved) {
        return
      }

      try {
        const cycle = await resolved.service.closeCycle(commandArgs(ctx)[0])
        if (!cycle) {
          await ctx.reply(t.noCycleToClose)
          return
        }

        await ctx.reply(t.cycleClosed(cycle.period))
      } catch (error) {
        await ctx.reply(t.cycleCloseFailed((error as Error).message))
      }
    })

    bot.command('rent_set', async (ctx) => {
      const locale = await resolveReplyLocale({
        ctx,
        repository: options.householdConfigurationRepository
      })
      const t = getBotTranslations(locale).finance
      const resolved = await requireAdmin(ctx)
      if (!resolved) {
        return
      }

      const args = commandArgs(ctx)
      if (args.length === 0) {
        await ctx.reply(t.rentSetUsage)
        return
      }

      try {
        const result = await resolved.service.setRent(args[0]!, args[1], args[2])
        if (!result) {
          await ctx.reply(t.rentNoPeriod)
          return
        }

        await ctx.reply(t.rentSaved(result.amount.toMajorString(), result.currency, result.period))
      } catch (error) {
        await ctx.reply(t.rentSaveFailed((error as Error).message))
      }
    })

    bot.command('utility_add', async (ctx) => {
      const locale = await resolveReplyLocale({
        ctx,
        repository: options.householdConfigurationRepository
      })
      const t = getBotTranslations(locale).finance
      const resolved = await requireAdmin(ctx)
      if (!resolved) {
        return
      }

      const args = commandArgs(ctx)
      if (args.length < 2) {
        await ctx.reply(t.utilityAddUsage)
        return
      }

      try {
        const result = await resolved.service.addUtilityBill(
          args[0]!,
          args[1]!,
          resolved.member.id,
          args[2]
        )
        if (!result) {
          await ctx.reply(t.utilityNoOpenCycle)
          return
        }

        await ctx.reply(
          t.utilityAdded(args[0]!, result.amount.toMajorString(), result.currency, result.period)
        )
      } catch (error) {
        await ctx.reply(t.utilityAddFailed((error as Error).message))
      }
    })

    bot.command('payment_add', async (ctx) => {
      const locale = await resolveReplyLocale({
        ctx,
        repository: options.householdConfigurationRepository
      })
      const t = getBotTranslations(locale).finance
      const resolved = await requireMember(ctx)
      if (!resolved) {
        return
      }

      const args = commandArgs(ctx)
      const kind = args[0]
      if (kind !== 'rent' && kind !== 'utilities') {
        await ctx.reply(t.paymentAddUsage)
        return
      }

      try {
        const dashboard = await resolved.service.generateDashboard()
        if (!dashboard) {
          await ctx.reply(t.paymentNoCycle)
          return
        }

        const currentMember = dashboard.members.find(
          (member) => member.memberId === resolved.member.id
        )
        if (!currentMember) {
          await ctx.reply(t.notMember)
          return
        }

        const inferredAmount =
          kind === 'rent'
            ? currentMember.rentShare
            : currentMember.netDue.subtract(currentMember.rentShare)

        if (args[1] === undefined && inferredAmount.amountMinor <= 0n) {
          await ctx.reply(t.paymentNoBalance)
          return
        }

        const amountArg = args[1] ?? inferredAmount.toMajorString()
        const currencyArg = args[2]
        const result = await resolved.service.addPayment(
          resolved.member.id,
          kind,
          amountArg,
          currencyArg
        )

        if (!result) {
          await ctx.reply(t.paymentNoCycle)
          return
        }

        await ctx.reply(
          t.paymentAdded(kind, result.amount.toMajorString(), result.currency, result.period)
        )
      } catch (error) {
        await ctx.reply(t.paymentAddFailed((error as Error).message))
      }
    })

    bot.command('statement', async (ctx) => {
      const locale = await resolveReplyLocale({
        ctx,
        repository: options.householdConfigurationRepository
      })
      const t = getBotTranslations(locale).finance
      const resolved = await requireMember(ctx)
      if (!resolved) {
        return
      }

      try {
        const dashboard = await resolved.service.generateDashboard(commandArgs(ctx)[0])
        if (!dashboard) {
          await ctx.reply(t.noStatementCycle)
          return
        }

        await ctx.reply(formatStatement(locale, dashboard))
      } catch (error) {
        await ctx.reply(t.statementFailed((error as Error).message))
      }
    })
  }

  return {
    register
  }
}
