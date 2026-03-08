import { Bot } from 'grammy'
import type { Logger } from '@household/observability'

export function createTelegramBot(token: string, logger?: Logger): Bot {
  const bot = new Bot(token)

  bot.command('help', async (ctx) => {
    await ctx.reply(
      [
        'Household bot scaffold is live.',
        'Available commands:',
        '/help - Show command list',
        '/household_status - Show placeholder household status',
        '/anon <message> - Send anonymous household feedback in a private chat'
      ].join('\n')
    )
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
