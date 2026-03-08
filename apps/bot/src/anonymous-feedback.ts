import type { AnonymousFeedbackService } from '@household/application'
import type { Bot, Context } from 'grammy'

function isPrivateChat(ctx: Context): boolean {
  return ctx.chat?.type === 'private'
}

function feedbackText(sanitizedText: string): string {
  return ['Anonymous household note', '', sanitizedText].join('\n')
}

function rejectionMessage(reason: string): string {
  switch (reason) {
    case 'not_member':
      return 'You are not a member of this household.'
    case 'too_short':
      return 'Anonymous feedback is too short. Add a little more detail.'
    case 'too_long':
      return 'Anonymous feedback is too long. Keep it under 500 characters.'
    case 'cooldown':
      return 'Anonymous feedback cooldown is active. Try again later.'
    case 'daily_cap':
      return 'Daily anonymous feedback limit reached. Try again tomorrow.'
    case 'blocklisted':
      return 'Message rejected by moderation. Rewrite it in calmer, non-abusive language.'
    default:
      return 'Anonymous feedback could not be submitted.'
  }
}

export function registerAnonymousFeedback(options: {
  bot: Bot
  anonymousFeedbackService: AnonymousFeedbackService
  householdChatId: string
  feedbackTopicId: number
}): void {
  options.bot.command('anon', async (ctx) => {
    if (!isPrivateChat(ctx)) {
      await ctx.reply('Use /anon in a private chat with the bot.')
      return
    }

    const rawText = typeof ctx.match === 'string' ? ctx.match.trim() : ''
    if (rawText.length === 0) {
      await ctx.reply('Usage: /anon <message>')
      return
    }

    const telegramUserId = ctx.from?.id?.toString()
    const telegramChatId = ctx.chat?.id?.toString()
    const telegramMessageId = ctx.msg?.message_id?.toString()
    const telegramUpdateId =
      'update_id' in ctx.update ? ctx.update.update_id?.toString() : undefined

    if (!telegramUserId || !telegramChatId || !telegramMessageId || !telegramUpdateId) {
      await ctx.reply('Unable to identify this message for anonymous feedback.')
      return
    }

    const result = await options.anonymousFeedbackService.submit({
      telegramUserId,
      rawText,
      telegramChatId,
      telegramMessageId,
      telegramUpdateId
    })

    if (result.status === 'duplicate') {
      await ctx.reply('This anonymous feedback message was already processed.')
      return
    }

    if (result.status === 'rejected') {
      await ctx.reply(rejectionMessage(result.reason))
      return
    }

    try {
      const posted = await ctx.api.sendMessage(
        options.householdChatId,
        feedbackText(result.sanitizedText),
        {
          message_thread_id: options.feedbackTopicId
        }
      )

      await options.anonymousFeedbackService.markPosted({
        submissionId: result.submissionId,
        postedChatId: options.householdChatId,
        postedThreadId: options.feedbackTopicId.toString(),
        postedMessageId: posted.message_id.toString()
      })

      await ctx.reply('Anonymous feedback delivered.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Telegram send failure'
      await options.anonymousFeedbackService.markFailed(result.submissionId, message)
      await ctx.reply('Anonymous feedback was saved, but posting failed. Try again later.')
    }
  })
}
