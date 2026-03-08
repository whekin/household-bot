import type { HouseholdSetupService } from '@household/application'
import type { Logger } from '@household/observability'
import type { Bot, Context } from 'grammy'

function commandArgText(ctx: Context): string {
  return typeof ctx.match === 'string' ? ctx.match.trim() : ''
}

function isGroupChat(ctx: Context): ctx is Context & {
  chat: NonNullable<Context['chat']> & { type: 'group' | 'supergroup'; title?: string }
} {
  return ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup'
}

function isTopicMessage(ctx: Context): boolean {
  const message = ctx.msg
  return !!message && 'is_topic_message' in message && message.is_topic_message === true
}

async function isGroupAdmin(ctx: Context): Promise<boolean> {
  if (!ctx.chat || !ctx.from) {
    return false
  }

  const member = await ctx.api.getChatMember(ctx.chat.id, ctx.from.id)
  return member.status === 'creator' || member.status === 'administrator'
}

function setupRejectionMessage(reason: 'not_admin' | 'invalid_chat_type'): string {
  switch (reason) {
    case 'not_admin':
      return 'Only Telegram group admins can run /setup.'
    case 'invalid_chat_type':
      return 'Use /setup inside a group or supergroup.'
  }
}

function bindRejectionMessage(
  reason: 'not_admin' | 'household_not_found' | 'not_topic_message'
): string {
  switch (reason) {
    case 'not_admin':
      return 'Only Telegram group admins can bind household topics.'
    case 'household_not_found':
      return 'Household is not configured for this chat yet. Run /setup first.'
    case 'not_topic_message':
      return 'Run this command inside the target topic thread.'
  }
}

export function registerHouseholdSetupCommands(options: {
  bot: Bot
  householdSetupService: HouseholdSetupService
  logger?: Logger
}): void {
  options.bot.command('setup', async (ctx) => {
    if (!isGroupChat(ctx)) {
      await ctx.reply('Use /setup inside the household group.')
      return
    }

    const actorIsAdmin = await isGroupAdmin(ctx)
    const result = await options.householdSetupService.setupGroupChat({
      actorIsAdmin,
      telegramChatId: ctx.chat.id.toString(),
      telegramChatType: ctx.chat.type,
      title: ctx.chat.title,
      householdName: commandArgText(ctx)
    })

    if (result.status === 'rejected') {
      await ctx.reply(setupRejectionMessage(result.reason))
      return
    }

    options.logger?.info(
      {
        event: 'household_setup.chat_registered',
        telegramChatId: result.household.telegramChatId,
        householdId: result.household.householdId,
        actorTelegramUserId: ctx.from?.id?.toString(),
        status: result.status
      },
      'Household group registered'
    )

    const action = result.status === 'created' ? 'created' : 'already registered'
    await ctx.reply(
      [
        `Household ${action}: ${result.household.householdName}`,
        `Chat ID: ${result.household.telegramChatId}`,
        'Next: open the purchase topic and run /bind_purchase_topic, then open the feedback topic and run /bind_feedback_topic.'
      ].join('\n')
    )
  })

  options.bot.command('bind_purchase_topic', async (ctx) => {
    if (!isGroupChat(ctx)) {
      await ctx.reply('Use /bind_purchase_topic inside the household group topic.')
      return
    }

    const actorIsAdmin = await isGroupAdmin(ctx)
    const telegramThreadId =
      isTopicMessage(ctx) && ctx.msg && 'message_thread_id' in ctx.msg
        ? ctx.msg.message_thread_id?.toString()
        : undefined
    const result = await options.householdSetupService.bindTopic({
      actorIsAdmin,
      telegramChatId: ctx.chat.id.toString(),
      role: 'purchase',
      ...(telegramThreadId
        ? {
            telegramThreadId
          }
        : {})
    })

    if (result.status === 'rejected') {
      await ctx.reply(bindRejectionMessage(result.reason))
      return
    }

    options.logger?.info(
      {
        event: 'household_setup.topic_bound',
        role: result.binding.role,
        telegramChatId: result.household.telegramChatId,
        telegramThreadId: result.binding.telegramThreadId,
        householdId: result.household.householdId,
        actorTelegramUserId: ctx.from?.id?.toString()
      },
      'Household topic bound'
    )

    await ctx.reply(
      `Purchase topic saved for ${result.household.householdName} (thread ${result.binding.telegramThreadId}).`
    )
  })

  options.bot.command('bind_feedback_topic', async (ctx) => {
    if (!isGroupChat(ctx)) {
      await ctx.reply('Use /bind_feedback_topic inside the household group topic.')
      return
    }

    const actorIsAdmin = await isGroupAdmin(ctx)
    const telegramThreadId =
      isTopicMessage(ctx) && ctx.msg && 'message_thread_id' in ctx.msg
        ? ctx.msg.message_thread_id?.toString()
        : undefined
    const result = await options.householdSetupService.bindTopic({
      actorIsAdmin,
      telegramChatId: ctx.chat.id.toString(),
      role: 'feedback',
      ...(telegramThreadId
        ? {
            telegramThreadId
          }
        : {})
    })

    if (result.status === 'rejected') {
      await ctx.reply(bindRejectionMessage(result.reason))
      return
    }

    options.logger?.info(
      {
        event: 'household_setup.topic_bound',
        role: result.binding.role,
        telegramChatId: result.household.telegramChatId,
        telegramThreadId: result.binding.telegramThreadId,
        householdId: result.household.householdId,
        actorTelegramUserId: ctx.from?.id?.toString()
      },
      'Household topic bound'
    )

    await ctx.reply(
      `Feedback topic saved for ${result.household.householdName} (thread ${result.binding.telegramThreadId}).`
    )
  })
}
