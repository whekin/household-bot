import { Bot } from 'grammy'
import type { Logger } from '@household/observability'

import { formatTelegramHelpText } from './telegram-commands'

export function createTelegramBot(token: string, logger?: Logger): Bot {
  const bot = new Bot(token)

  bot.command('help', async (ctx) => {
    await ctx.reply(formatTelegramHelpText())
  })

  bot.command('household_status', async (ctx) => {
    await ctx.reply('Household status is not connected yet. Data integration is next.')
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
