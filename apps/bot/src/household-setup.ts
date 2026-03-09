import type { HouseholdOnboardingService, HouseholdSetupService } from '@household/application'
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
  householdOnboardingService: HouseholdOnboardingService
  miniAppBaseUrl?: string
  logger?: Logger
}): void {
  options.bot.command('start', async (ctx) => {
    if (ctx.chat?.type !== 'private') {
      return
    }

    if (!ctx.from) {
      await ctx.reply('Telegram user identity is required to join a household.')
      return
    }

    const startPayload = commandArgText(ctx)
    if (!startPayload.startsWith('join_')) {
      await ctx.reply('Send /help to see available commands.')
      return
    }

    const joinToken = startPayload.slice('join_'.length).trim()
    if (!joinToken) {
      await ctx.reply('Invalid household invite link.')
      return
    }

    const identity = {
      telegramUserId: ctx.from.id.toString(),
      displayName:
        [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ').trim() ||
        ctx.from.username ||
        `Telegram ${ctx.from.id}`,
      ...(ctx.from.username
        ? {
            username: ctx.from.username
          }
        : {}),
      ...(ctx.from.language_code
        ? {
            languageCode: ctx.from.language_code
          }
        : {})
    }

    const result = await options.householdOnboardingService.joinHousehold({
      identity,
      joinToken
    })

    if (result.status === 'invalid_token') {
      await ctx.reply('This household invite link is invalid or expired.')
      return
    }

    if (result.status === 'active') {
      await ctx.reply(
        `You are already an active member. Open the mini app to view ${result.member.displayName}.`
      )
      return
    }

    await ctx.reply(
      `Join request sent for ${result.household.name}. Wait for a household admin to confirm you.`
    )
  })

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
    const joinToken = await options.householdOnboardingService.ensureHouseholdJoinToken({
      householdId: result.household.householdId,
      ...(ctx.from?.id
        ? {
            actorTelegramUserId: ctx.from.id.toString()
          }
        : {})
    })

    const joinDeepLink = ctx.me.username
      ? `https://t.me/${ctx.me.username}?start=join_${encodeURIComponent(joinToken.token)}`
      : null
    const joinMiniAppUrl = options.miniAppBaseUrl
      ? (() => {
          const url = new URL(options.miniAppBaseUrl)
          url.searchParams.set('join', joinToken.token)
          if (ctx.me.username) {
            url.searchParams.set('bot', ctx.me.username)
          }
          return url.toString()
        })()
      : null

    await ctx.reply(
      [
        `Household ${action}: ${result.household.householdName}`,
        `Chat ID: ${result.household.telegramChatId}`,
        'Next: open the purchase topic and run /bind_purchase_topic, then open the feedback topic and run /bind_feedback_topic.',
        'Members can join from the button below or from the bot link.'
      ].join('\n'),
      joinMiniAppUrl || joinDeepLink
        ? {
            reply_markup: {
              inline_keyboard: [
                [
                  ...(joinMiniAppUrl
                    ? [
                        {
                          text: 'Join household',
                          web_app: {
                            url: joinMiniAppUrl
                          }
                        }
                      ]
                    : []),
                  ...(joinDeepLink
                    ? [
                        {
                          text: 'Open bot chat',
                          url: joinDeepLink
                        }
                      ]
                    : [])
                ]
              ]
            }
          }
        : {}
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
