import type { AnonymousFeedbackService } from '@household/application'
import type { Logger } from '@household/observability'
import type {
  HouseholdConfigurationRepository,
  TelegramPendingActionRepository
} from '@household/ports'
import type { Bot, Context } from 'grammy'

const ANONYMOUS_FEEDBACK_ACTION = 'anonymous_feedback' as const
const CANCEL_ANONYMOUS_FEEDBACK_CALLBACK = 'cancel_prompt:anonymous_feedback'
const PENDING_ACTION_TTL_MS = 24 * 60 * 60 * 1000

function isPrivateChat(ctx: Context): boolean {
  return ctx.chat?.type === 'private'
}

function commandArgText(ctx: Context): string {
  return typeof ctx.match === 'string' ? ctx.match.trim() : ''
}

function feedbackText(sanitizedText: string): string {
  return ['Anonymous household note', '', sanitizedText].join('\n')
}

function cancelReplyMarkup() {
  return {
    inline_keyboard: [
      [
        {
          text: 'Cancel',
          callback_data: CANCEL_ANONYMOUS_FEEDBACK_CALLBACK
        }
      ]
    ]
  }
}

function isCommandMessage(ctx: Context): boolean {
  return typeof ctx.msg?.text === 'string' && ctx.msg.text.trim().startsWith('/')
}

function shouldKeepPrompt(reason: string): boolean {
  return reason === 'too_short' || reason === 'too_long' || reason === 'blocklisted'
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

async function clearPendingAnonymousFeedbackPrompt(
  repository: TelegramPendingActionRepository,
  ctx: Context
): Promise<void> {
  const telegramUserId = ctx.from?.id?.toString()
  const telegramChatId = ctx.chat?.id?.toString()
  if (!telegramUserId || !telegramChatId) {
    return
  }

  await repository.clearPendingAction(telegramChatId, telegramUserId)
}

async function startPendingAnonymousFeedbackPrompt(
  repository: TelegramPendingActionRepository,
  ctx: Context
): Promise<void> {
  const telegramUserId = ctx.from?.id?.toString()
  const telegramChatId = ctx.chat?.id?.toString()
  if (!telegramUserId || !telegramChatId) {
    await ctx.reply('Unable to start anonymous feedback right now.')
    return
  }

  await repository.upsertPendingAction({
    telegramUserId,
    telegramChatId,
    action: ANONYMOUS_FEEDBACK_ACTION,
    payload: {},
    expiresAt: new Date(Date.now() + PENDING_ACTION_TTL_MS)
  })

  await ctx.reply('Send me the anonymous message in your next reply, or tap Cancel.', {
    reply_markup: cancelReplyMarkup()
  })
}

async function submitAnonymousFeedback(options: {
  ctx: Context
  anonymousFeedbackServiceForHousehold: (householdId: string) => AnonymousFeedbackService
  householdConfigurationRepository: HouseholdConfigurationRepository
  promptRepository: TelegramPendingActionRepository
  logger?: Logger | undefined
  rawText: string
  keepPromptOnValidationFailure?: boolean
}): Promise<void> {
  const telegramUserId = options.ctx.from?.id?.toString()
  const telegramChatId = options.ctx.chat?.id?.toString()
  const telegramMessageId = options.ctx.msg?.message_id?.toString()
  const telegramUpdateId =
    'update_id' in options.ctx.update ? options.ctx.update.update_id?.toString() : undefined

  if (!telegramUserId || !telegramChatId || !telegramMessageId || !telegramUpdateId) {
    await options.ctx.reply('Unable to identify this message for anonymous feedback.')
    return
  }

  const memberships =
    await options.householdConfigurationRepository.listHouseholdMembersByTelegramUserId(
      telegramUserId
    )

  if (memberships.length === 0) {
    await options.promptRepository.clearPendingAction(telegramChatId, telegramUserId)
    await options.ctx.reply('You are not a member of this household.')
    return
  }

  if (memberships.length > 1) {
    await options.promptRepository.clearPendingAction(telegramChatId, telegramUserId)
    await options.ctx.reply(
      'You belong to multiple households. Open the target household from its group until household selection is added.'
    )
    return
  }

  const member = memberships[0]!
  const householdChat =
    await options.householdConfigurationRepository.getHouseholdChatByHouseholdId(member.householdId)
  const feedbackTopic = await options.householdConfigurationRepository.getHouseholdTopicBinding(
    member.householdId,
    'feedback'
  )

  if (!householdChat || !feedbackTopic) {
    await options.promptRepository.clearPendingAction(telegramChatId, telegramUserId)
    await options.ctx.reply(
      'Anonymous feedback is not configured for your household yet. Ask an admin to run /bind_feedback_topic.'
    )
    return
  }

  const anonymousFeedbackService = options.anonymousFeedbackServiceForHousehold(member.householdId)

  const result = await anonymousFeedbackService.submit({
    telegramUserId,
    rawText: options.rawText,
    telegramChatId,
    telegramMessageId,
    telegramUpdateId
  })

  if (result.status === 'duplicate') {
    await options.promptRepository.clearPendingAction(telegramChatId, telegramUserId)
    await options.ctx.reply('This anonymous feedback message was already processed.')
    return
  }

  if (result.status === 'rejected') {
    if (!options.keepPromptOnValidationFailure || !shouldKeepPrompt(result.reason)) {
      await options.promptRepository.clearPendingAction(telegramChatId, telegramUserId)
    }

    await options.ctx.reply(
      shouldKeepPrompt(result.reason)
        ? `${rejectionMessage(result.reason)} Send a revised message, or tap Cancel.`
        : rejectionMessage(result.reason),
      shouldKeepPrompt(result.reason)
        ? {
            reply_markup: cancelReplyMarkup()
          }
        : {}
    )
    return
  }

  try {
    const posted = await options.ctx.api.sendMessage(
      householdChat.telegramChatId,
      feedbackText(result.sanitizedText),
      {
        message_thread_id: Number(feedbackTopic.telegramThreadId)
      }
    )

    await anonymousFeedbackService.markPosted({
      submissionId: result.submissionId,
      postedChatId: householdChat.telegramChatId,
      postedThreadId: feedbackTopic.telegramThreadId,
      postedMessageId: posted.message_id.toString()
    })

    await options.promptRepository.clearPendingAction(telegramChatId, telegramUserId)
    await options.ctx.reply('Anonymous feedback delivered.')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Telegram send failure'
    options.logger?.error(
      {
        event: 'anonymous_feedback.post_failed',
        submissionId: result.submissionId,
        householdChatId: householdChat.telegramChatId,
        feedbackTopicId: feedbackTopic.telegramThreadId,
        error: message
      },
      'Anonymous feedback posting failed'
    )
    await anonymousFeedbackService.markFailed(result.submissionId, message)
    await options.ctx.reply('Anonymous feedback was saved, but posting failed. Try again later.')
  }
}

export function registerAnonymousFeedback(options: {
  bot: Bot
  anonymousFeedbackServiceForHousehold: (householdId: string) => AnonymousFeedbackService
  householdConfigurationRepository: HouseholdConfigurationRepository
  promptRepository: TelegramPendingActionRepository
  logger?: Logger
}): void {
  options.bot.command('cancel', async (ctx) => {
    if (!isPrivateChat(ctx)) {
      return
    }

    const telegramUserId = ctx.from?.id?.toString()
    const telegramChatId = ctx.chat?.id?.toString()
    if (!telegramUserId || !telegramChatId) {
      await ctx.reply('Nothing to cancel right now.')
      return
    }

    const pending = await options.promptRepository.getPendingAction(telegramChatId, telegramUserId)
    if (!pending) {
      await ctx.reply('Nothing to cancel right now.')
      return
    }

    await options.promptRepository.clearPendingAction(telegramChatId, telegramUserId)
    await ctx.reply('Cancelled.')
  })

  options.bot.command('anon', async (ctx) => {
    if (!isPrivateChat(ctx)) {
      await ctx.reply('Use /anon in a private chat with the bot.')
      return
    }

    const rawText = commandArgText(ctx)
    if (rawText.length === 0) {
      await startPendingAnonymousFeedbackPrompt(options.promptRepository, ctx)
      return
    }

    await submitAnonymousFeedback({
      ctx,
      anonymousFeedbackServiceForHousehold: options.anonymousFeedbackServiceForHousehold,
      householdConfigurationRepository: options.householdConfigurationRepository,
      promptRepository: options.promptRepository,
      logger: options.logger,
      rawText
    })
  })

  options.bot.on('message:text', async (ctx, next) => {
    if (!isPrivateChat(ctx) || isCommandMessage(ctx)) {
      await next()
      return
    }

    const telegramUserId = ctx.from?.id?.toString()
    const telegramChatId = ctx.chat?.id?.toString()
    if (!telegramUserId || !telegramChatId) {
      await next()
      return
    }

    const pending = await options.promptRepository.getPendingAction(telegramChatId, telegramUserId)
    if (!pending || pending.action !== ANONYMOUS_FEEDBACK_ACTION) {
      await next()
      return
    }

    await submitAnonymousFeedback({
      ctx,
      anonymousFeedbackServiceForHousehold: options.anonymousFeedbackServiceForHousehold,
      householdConfigurationRepository: options.householdConfigurationRepository,
      promptRepository: options.promptRepository,
      logger: options.logger,
      rawText: ctx.msg.text,
      keepPromptOnValidationFailure: true
    })
  })

  options.bot.callbackQuery(CANCEL_ANONYMOUS_FEEDBACK_CALLBACK, async (ctx) => {
    if (!isPrivateChat(ctx)) {
      await ctx.answerCallbackQuery({
        text: 'Use this in a private chat with the bot.',
        show_alert: true
      })
      return
    }

    await clearPendingAnonymousFeedbackPrompt(options.promptRepository, ctx)
    await ctx.answerCallbackQuery({
      text: 'Cancelled.'
    })

    if (ctx.msg) {
      await ctx.editMessageText('Anonymous feedback cancelled.')
    }
  })
}
