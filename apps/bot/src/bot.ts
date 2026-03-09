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
        '/setup [household name] - Register this group as a household',
        '/bind_purchase_topic - Bind the current topic as the purchase topic',
        '/bind_feedback_topic - Bind the current topic as the feedback topic',
        '/pending_members - List pending household join requests',
        '/approve_member <telegram_user_id> - Approve a pending member',
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
