import { Bot, type Context } from 'grammy'
import type { Logger } from '@household/observability'
import type { HouseholdConfigurationRepository } from '@household/ports'

import { resolveReplyLocale } from './bot-locale'
import { formatTelegramHelpText } from './telegram-commands'

async function shouldShowAdminCommands(options: {
  ctx: Context
  householdConfigurationRepository?: HouseholdConfigurationRepository
}): Promise<boolean> {
  const telegramUserId = options.ctx.from?.id?.toString()
  if (!telegramUserId) {
    return false
  }

  if (options.ctx.chat?.type === 'private') {
    if (!options.householdConfigurationRepository) {
      return false
    }

    const memberships =
      await options.householdConfigurationRepository.listHouseholdMembersByTelegramUserId(
        telegramUserId
      )

    return memberships.some((member) => member.isAdmin)
  }

  const chatId = options.ctx.chat?.id
  const userId = options.ctx.from?.id
  if (!chatId || !userId) {
    return false
  }

  const membership = await options.ctx.api.getChatMember(chatId, userId)
  return membership.status === 'administrator' || membership.status === 'creator'
}

export function createTelegramBot(
  token: string,
  logger?: Logger,
  householdConfigurationRepository?: HouseholdConfigurationRepository
): Bot {
  const bot = new Bot(token)

  bot.command('help', async (ctx) => {
    const locale = await resolveReplyLocale({
      ctx,
      repository: householdConfigurationRepository
    })
    const includeAdminCommands = await shouldShowAdminCommands({
      ctx,
      ...(householdConfigurationRepository
        ? {
            householdConfigurationRepository
          }
        : {})
    })
    await ctx.reply(
      formatTelegramHelpText(locale, {
        includePrivateCommands: ctx.chat?.type === 'private',
        includeGroupCommands: ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup',
        includeAdminCommands
      })
    )
  })
  bot.catch((error) => {
    logger?.error(
      {
        event: 'telegram.bot_error',
        updateId: error.ctx?.update.update_id,
        error: error.error
      },
      'Telegram bot error'
    )
  })

  return bot
}
