import { Bot } from 'grammy'

export function createTelegramBot(token: string): Bot {
  const bot = new Bot(token)

  bot.command('help', async (ctx) => {
    await ctx.reply(
      [
        'Household bot scaffold is live.',
        'Available commands:',
        '/help - Show command list',
        '/household_status - Show placeholder household status'
      ].join('\n')
    )
  })

  bot.command('household_status', async (ctx) => {
    await ctx.reply('Household status is not connected yet. Data integration is next.')
  })

  bot.catch((error) => {
    console.error('Telegram bot error', error.error)
  })

  return bot
}
