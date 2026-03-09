import type { FinanceCommandService } from '@household/application'
import type { HouseholdConfigurationRepository } from '@household/ports'
import type { Bot, Context } from 'grammy'

function commandArgs(ctx: Context): string[] {
  const raw = typeof ctx.match === 'string' ? ctx.match.trim() : ''
  if (raw.length === 0) {
    return []
  }

  return raw.split(/\s+/).filter(Boolean)
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
  async function resolveGroupFinanceService(ctx: Context): Promise<{
    service: FinanceCommandService
    householdId: string
  } | null> {
    if (!isGroupChat(ctx)) {
      await ctx.reply('Use this command inside a household group.')
      return null
    }

    const household = await options.householdConfigurationRepository.getTelegramHouseholdChat(
      ctx.chat!.id.toString()
    )
    if (!household) {
      await ctx.reply('Household is not configured for this chat yet. Run /setup first.')
      return null
    }

    return {
      service: options.financeServiceForHousehold(household.householdId),
      householdId: household.householdId
    }
  }

  async function requireMember(ctx: Context) {
    const telegramUserId = ctx.from?.id?.toString()
    if (!telegramUserId) {
      await ctx.reply('Unable to identify sender for this command.')
      return null
    }

    const scoped = await resolveGroupFinanceService(ctx)
    if (!scoped) {
      return null
    }

    const member = await scoped.service.getMemberByTelegramUserId(telegramUserId)
    if (!member) {
      await ctx.reply('You are not a member of this household.')
      return null
    }

    return {
      member,
      service: scoped.service,
      householdId: scoped.householdId
    }
  }

  async function requireAdmin(ctx: Context) {
    const resolved = await requireMember(ctx)
    if (!resolved) {
      return null
    }

    if (!resolved.member.isAdmin) {
      await ctx.reply('Only household admins can use this command.')
      return null
    }

    return resolved
  }

  function register(bot: Bot): void {
    bot.command('cycle_open', async (ctx) => {
      const resolved = await requireAdmin(ctx)
      if (!resolved) {
        return
      }

      const args = commandArgs(ctx)
      if (args.length === 0) {
        await ctx.reply('Usage: /cycle_open <YYYY-MM> [USD|GEL]')
        return
      }

      try {
        const cycle = await resolved.service.openCycle(args[0]!, args[1])
        await ctx.reply(`Cycle opened: ${cycle.period} (${cycle.currency})`)
      } catch (error) {
        await ctx.reply(`Failed to open cycle: ${(error as Error).message}`)
      }
    })

    bot.command('cycle_close', async (ctx) => {
      const resolved = await requireAdmin(ctx)
      if (!resolved) {
        return
      }

      try {
        const cycle = await resolved.service.closeCycle(commandArgs(ctx)[0])
        if (!cycle) {
          await ctx.reply('No cycle found to close.')
          return
        }

        await ctx.reply(`Cycle closed: ${cycle.period}`)
      } catch (error) {
        await ctx.reply(`Failed to close cycle: ${(error as Error).message}`)
      }
    })

    bot.command('rent_set', async (ctx) => {
      const resolved = await requireAdmin(ctx)
      if (!resolved) {
        return
      }

      const args = commandArgs(ctx)
      if (args.length === 0) {
        await ctx.reply('Usage: /rent_set <amount> [USD|GEL] [YYYY-MM]')
        return
      }

      try {
        const result = await resolved.service.setRent(args[0]!, args[1], args[2])
        if (!result) {
          await ctx.reply('No period provided and no open cycle found.')
          return
        }

        await ctx.reply(
          `Rent rule saved: ${result.amount.toMajorString()} ${result.currency} starting ${result.period}`
        )
      } catch (error) {
        await ctx.reply(`Failed to save rent rule: ${(error as Error).message}`)
      }
    })

    bot.command('utility_add', async (ctx) => {
      const resolved = await requireAdmin(ctx)
      if (!resolved) {
        return
      }

      const args = commandArgs(ctx)
      if (args.length < 2) {
        await ctx.reply('Usage: /utility_add <name> <amount> [USD|GEL]')
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
          await ctx.reply('No open cycle found. Use /cycle_open first.')
          return
        }

        await ctx.reply(
          `Utility bill added: ${args[0]} ${result.amount.toMajorString()} ${result.currency} for ${result.period}`
        )
      } catch (error) {
        await ctx.reply(`Failed to add utility bill: ${(error as Error).message}`)
      }
    })

    bot.command('statement', async (ctx) => {
      const resolved = await requireMember(ctx)
      if (!resolved) {
        return
      }

      try {
        const statement = await resolved.service.generateStatement(commandArgs(ctx)[0])
        if (!statement) {
          await ctx.reply('No cycle found for statement.')
          return
        }

        await ctx.reply(statement)
      } catch (error) {
        await ctx.reply(`Failed to generate statement: ${(error as Error).message}`)
      }
    })
  }

  return {
    register
  }
}
