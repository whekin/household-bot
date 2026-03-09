import { Bot } from 'grammy'
import type { Logger } from '@household/observability'

import { botLocaleFromContext, getBotTranslations } from './i18n'
import { formatTelegramHelpText } from './telegram-commands'

export function createTelegramBot(token: string, logger?: Logger): Bot {
  const bot = new Bot(token)

  bot.command('help', async (ctx) => {
    const locale = botLocaleFromContext(ctx)
    await ctx.reply(formatTelegramHelpText(locale))
  })

  bot.command('household_status', async (ctx) => {
    const locale = botLocaleFromContext(ctx)
    await ctx.reply(getBotTranslations(locale).bot.householdStatusPending)
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
