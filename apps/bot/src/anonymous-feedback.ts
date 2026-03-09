import type { AnonymousFeedbackService } from '@household/application'
import { Temporal, nowInstant, type Instant } from '@household/domain'
import type { Logger } from '@household/observability'
import type {
  HouseholdConfigurationRepository,
  TelegramPendingActionRepository
} from '@household/ports'
import type { Bot, Context } from 'grammy'

import { getBotTranslations, type BotLocale } from './i18n'
import { resolveReplyLocale } from './bot-locale'

const ANONYMOUS_FEEDBACK_ACTION = 'anonymous_feedback' as const
const CANCEL_ANONYMOUS_FEEDBACK_CALLBACK = 'cancel_prompt:anonymous_feedback'
const PENDING_ACTION_TTL_MS = 24 * 60 * 60 * 1000

function isPrivateChat(ctx: Context): boolean {
  return ctx.chat?.type === 'private'
}

function commandArgText(ctx: Context): string {
  return typeof ctx.match === 'string' ? ctx.match.trim() : ''
}

function feedbackText(locale: BotLocale, sanitizedText: string): string {
  return [getBotTranslations(locale).anonymousFeedback.title, '', sanitizedText].join('\n')
}

function cancelReplyMarkup(locale: BotLocale) {
  return {
    inline_keyboard: [
      [
        {
          text: getBotTranslations(locale).anonymousFeedback.cancelButton,
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

function formatRetryDelay(locale: BotLocale, now: Instant, nextAllowedAt: Instant): string {
  const t = getBotTranslations(locale).anonymousFeedback
  if (Temporal.Instant.compare(nextAllowedAt, now) <= 0) {
    return t.retryNow
  }

  const duration = now.until(nextAllowedAt, {
    largestUnit: 'hour',
    smallestUnit: 'minute',
    roundingMode: 'ceil'
  })

  const days = Math.floor(duration.hours / 24)
  const hours = duration.hours % 24

  const parts = [
    days > 0 ? t.day(days) : null,
    hours > 0 ? t.hour(hours) : null,
    duration.minutes > 0 ? t.minute(duration.minutes) : null
  ].filter(Boolean)

  return parts.length > 0 ? t.retryIn(parts.join(' ')) : t.retryInLessThanMinute
}

function rejectionMessage(
  locale: BotLocale,
  reason: string,
  nextAllowedAt?: Instant,
  now = nowInstant()
): string {
  const t = getBotTranslations(locale).anonymousFeedback
  switch (reason) {
    case 'not_member':
      return t.notMember
    case 'too_short':
      return t.tooShort
    case 'too_long':
      return t.tooLong
    case 'cooldown':
      return nextAllowedAt
        ? t.cooldown(formatRetryDelay(locale, now, nextAllowedAt))
        : t.cooldown(t.retryInLessThanMinute)
    case 'daily_cap':
      return nextAllowedAt
        ? t.dailyCap(formatRetryDelay(locale, now, nextAllowedAt))
        : t.dailyCap(t.retryInLessThanMinute)
    case 'blocklisted':
      return t.blocklisted
    default:
      return t.submitFailed
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
  householdConfigurationRepository: HouseholdConfigurationRepository,
  ctx: Context
): Promise<void> {
  const locale = await resolveReplyLocale({
    ctx,
    repository: householdConfigurationRepository
  })
  const t = getBotTranslations(locale).anonymousFeedback
  const telegramUserId = ctx.from?.id?.toString()
  const telegramChatId = ctx.chat?.id?.toString()
  if (!telegramUserId || !telegramChatId) {
    await ctx.reply(t.unableToStart)
    return
  }

  await repository.upsertPendingAction({
    telegramUserId,
    telegramChatId,
    action: ANONYMOUS_FEEDBACK_ACTION,
    payload: {},
    expiresAt: nowInstant().add({ milliseconds: PENDING_ACTION_TTL_MS })
  })

  await ctx.reply(t.prompt, {
    reply_markup: cancelReplyMarkup(locale)
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
  const fallbackLocale = await resolveReplyLocale({
    ctx: options.ctx,
    repository: options.householdConfigurationRepository
  })

  if (!telegramUserId || !telegramChatId || !telegramMessageId || !telegramUpdateId) {
    await options.ctx.reply(
      getBotTranslations(fallbackLocale).anonymousFeedback.unableToIdentifyMessage
    )
    return
  }

  const memberships =
    await options.householdConfigurationRepository.listHouseholdMembersByTelegramUserId(
      telegramUserId
    )

  if (memberships.length === 0) {
    await options.promptRepository.clearPendingAction(telegramChatId, telegramUserId)
    await options.ctx.reply(getBotTranslations(fallbackLocale).anonymousFeedback.notMember)
    return
  }

  if (memberships.length > 1) {
    await options.promptRepository.clearPendingAction(telegramChatId, telegramUserId)
    await options.ctx.reply(getBotTranslations(fallbackLocale).anonymousFeedback.multipleHouseholds)
    return
  }

  const member = memberships[0]!
  const locale = member.preferredLocale ?? member.householdDefaultLocale
  const t = getBotTranslations(locale).anonymousFeedback
  const householdChat =
    await options.householdConfigurationRepository.getHouseholdChatByHouseholdId(member.householdId)
  const feedbackTopic = await options.householdConfigurationRepository.getHouseholdTopicBinding(
    member.householdId,
    'feedback'
  )

  if (!householdChat || !feedbackTopic) {
    await options.promptRepository.clearPendingAction(telegramChatId, telegramUserId)
    await options.ctx.reply(t.feedbackTopicMissing)
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
    await options.ctx.reply(t.duplicate)
    return
  }

  if (result.status === 'rejected') {
    if (!options.keepPromptOnValidationFailure || !shouldKeepPrompt(result.reason)) {
      await options.promptRepository.clearPendingAction(telegramChatId, telegramUserId)
    }

    const rejectionText = rejectionMessage(
      locale,
      result.reason,
      result.nextAllowedAt,
      nowInstant()
    )

    await options.ctx.reply(
      shouldKeepPrompt(result.reason) ? `${rejectionText} ${t.keepPromptSuffix}` : rejectionText,
      shouldKeepPrompt(result.reason)
        ? {
            reply_markup: cancelReplyMarkup(locale)
          }
        : {}
    )
    return
  }

  try {
    const posted = await options.ctx.api.sendMessage(
      householdChat.telegramChatId,
      feedbackText(locale, result.sanitizedText),
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
    await options.ctx.reply(t.delivered)
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
    await options.ctx.reply(t.savedButPostFailed)
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
    const locale = await resolveReplyLocale({
      ctx,
      repository: options.householdConfigurationRepository
    })
    const t = getBotTranslations(locale).anonymousFeedback
    if (!isPrivateChat(ctx)) {
      return
    }

    const telegramUserId = ctx.from?.id?.toString()
    const telegramChatId = ctx.chat?.id?.toString()
    if (!telegramUserId || !telegramChatId) {
      await ctx.reply(t.nothingToCancel)
      return
    }

    const pending = await options.promptRepository.getPendingAction(telegramChatId, telegramUserId)
    if (!pending) {
      await ctx.reply(t.nothingToCancel)
      return
    }

    await options.promptRepository.clearPendingAction(telegramChatId, telegramUserId)
    await ctx.reply(t.cancelled)
  })

  options.bot.command('anon', async (ctx) => {
    const locale = await resolveReplyLocale({
      ctx,
      repository: options.householdConfigurationRepository
    })
    const t = getBotTranslations(locale).anonymousFeedback
    if (!isPrivateChat(ctx)) {
      await ctx.reply(t.useInPrivateChat)
      return
    }

    const rawText = commandArgText(ctx)
    if (rawText.length === 0) {
      await startPendingAnonymousFeedbackPrompt(
        options.promptRepository,
        options.householdConfigurationRepository,
        ctx
      )
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
    const locale = await resolveReplyLocale({
      ctx,
      repository: options.householdConfigurationRepository
    })
    const t = getBotTranslations(locale).anonymousFeedback
    if (!isPrivateChat(ctx)) {
      await ctx.answerCallbackQuery({
        text: t.useThisInPrivateChat,
        show_alert: true
      })
      return
    }

    await clearPendingAnonymousFeedbackPrompt(options.promptRepository, ctx)
    await ctx.answerCallbackQuery({
      text: t.cancelled
    })

    if (ctx.msg) {
      await ctx.editMessageText(t.cancelledMessage)
    }
  })
}
