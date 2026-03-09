import type {
  HouseholdAdminService,
  HouseholdOnboardingService,
  HouseholdSetupService
} from '@household/application'
import type { Logger } from '@household/observability'
import type { Bot, Context } from 'grammy'

const APPROVE_MEMBER_CALLBACK_PREFIX = 'approve_member:'

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

function adminRejectionMessage(
  reason: 'not_admin' | 'household_not_found' | 'pending_not_found'
): string {
  switch (reason) {
    case 'not_admin':
      return 'Only household admins can manage pending members.'
    case 'household_not_found':
      return 'Household is not configured for this chat yet. Run /setup first.'
    case 'pending_not_found':
      return 'Pending member not found. Use /pending_members to inspect the queue.'
  }
}

function actorDisplayName(ctx: Context): string | undefined {
  const firstName = ctx.from?.first_name?.trim()
  const lastName = ctx.from?.last_name?.trim()
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim()

  return fullName || ctx.from?.username?.trim() || undefined
}

function buildPendingMemberLabel(displayName: string): string {
  const normalized = displayName.trim().replaceAll(/\s+/g, ' ')
  if (normalized.length <= 32) {
    return normalized
  }

  return `${normalized.slice(0, 29)}...`
}

function pendingMembersReply(result: {
  householdName: string
  members: readonly {
    telegramUserId: string
    displayName: string
    username?: string | null
  }[]
}) {
  return {
    text: [
      `Pending members for ${result.householdName}:`,
      ...result.members.map(
        (member, index) =>
          `${index + 1}. ${member.displayName} (${member.telegramUserId})${member.username ? ` @${member.username}` : ''}`
      ),
      'Tap a button below to approve, or use /approve_member <telegram_user_id>.'
    ].join('\n'),
    reply_markup: {
      inline_keyboard: result.members.map((member) => [
        {
          text: `Approve ${buildPendingMemberLabel(member.displayName)}`,
          callback_data: `${APPROVE_MEMBER_CALLBACK_PREFIX}${member.telegramUserId}`
        }
      ])
    }
  } as const
}

export function registerHouseholdSetupCommands(options: {
  bot: Bot
  householdSetupService: HouseholdSetupService
  householdOnboardingService: HouseholdOnboardingService
  householdAdminService: HouseholdAdminService
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
      householdName: commandArgText(ctx),
      ...(ctx.from?.id
        ? {
            actorTelegramUserId: ctx.from.id.toString()
          }
        : {}),
      ...(actorDisplayName(ctx)
        ? {
            actorDisplayName: actorDisplayName(ctx)!
          }
        : {})
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
    await ctx.reply(
      [
        `Household ${action}: ${result.household.householdName}`,
        `Chat ID: ${result.household.telegramChatId}`,
        'Next: open the purchase topic and run /bind_purchase_topic, then open the feedback topic and run /bind_feedback_topic.',
        'Members should open the bot chat from the button below and confirm the join request there.'
      ].join('\n'),
      joinDeepLink
        ? {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: 'Join household',
                    url: joinDeepLink
                  }
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

  options.bot.command('pending_members', async (ctx) => {
    if (!isGroupChat(ctx)) {
      await ctx.reply('Use /pending_members inside the household group.')
      return
    }

    const actorTelegramUserId = ctx.from?.id?.toString()
    if (!actorTelegramUserId) {
      await ctx.reply('Unable to identify sender for this command.')
      return
    }

    const result = await options.householdAdminService.listPendingMembers({
      actorTelegramUserId,
      telegramChatId: ctx.chat.id.toString()
    })

    if (result.status === 'rejected') {
      await ctx.reply(adminRejectionMessage(result.reason))
      return
    }

    if (result.members.length === 0) {
      await ctx.reply(`No pending members for ${result.householdName}.`)
      return
    }

    const reply = pendingMembersReply(result)
    await ctx.reply(reply.text, {
      reply_markup: reply.reply_markup
    })
  })

  options.bot.command('approve_member', async (ctx) => {
    if (!isGroupChat(ctx)) {
      await ctx.reply('Use /approve_member inside the household group.')
      return
    }

    const actorTelegramUserId = ctx.from?.id?.toString()
    if (!actorTelegramUserId) {
      await ctx.reply('Unable to identify sender for this command.')
      return
    }

    const pendingTelegramUserId = commandArgText(ctx)
    if (!pendingTelegramUserId) {
      await ctx.reply('Usage: /approve_member <telegram_user_id>')
      return
    }

    const result = await options.householdAdminService.approvePendingMember({
      actorTelegramUserId,
      telegramChatId: ctx.chat.id.toString(),
      pendingTelegramUserId
    })

    if (result.status === 'rejected') {
      await ctx.reply(adminRejectionMessage(result.reason))
      return
    }

    await ctx.reply(
      `Approved ${result.member.displayName} as an active member of ${result.householdName}.`
    )
  })

  options.bot.callbackQuery(
    new RegExp(`^${APPROVE_MEMBER_CALLBACK_PREFIX}(\\d+)$`),
    async (ctx) => {
      if (!isGroupChat(ctx)) {
        await ctx.answerCallbackQuery({
          text: 'Use this button in the household group.',
          show_alert: true
        })
        return
      }

      const actorTelegramUserId = ctx.from?.id?.toString()
      const pendingTelegramUserId = ctx.match[1]
      if (!actorTelegramUserId || !pendingTelegramUserId) {
        await ctx.answerCallbackQuery({
          text: 'Unable to identify the selected member.',
          show_alert: true
        })
        return
      }

      const result = await options.householdAdminService.approvePendingMember({
        actorTelegramUserId,
        telegramChatId: ctx.chat.id.toString(),
        pendingTelegramUserId
      })

      if (result.status === 'rejected') {
        await ctx.answerCallbackQuery({
          text: adminRejectionMessage(result.reason),
          show_alert: true
        })
        return
      }

      await ctx.answerCallbackQuery({
        text: `Approved ${result.member.displayName}.`
      })

      if (ctx.msg) {
        const refreshed = await options.householdAdminService.listPendingMembers({
          actorTelegramUserId,
          telegramChatId: ctx.chat.id.toString()
        })

        if (refreshed.status === 'ok') {
          if (refreshed.members.length === 0) {
            await ctx.editMessageText(`No pending members for ${refreshed.householdName}.`)
          } else {
            const reply = pendingMembersReply(refreshed)
            await ctx.editMessageText(reply.text, {
              reply_markup: reply.reply_markup
            })
          }
        }
      }

      await ctx.reply(
        `Approved ${result.member.displayName} as an active member of ${result.householdName}.`
      )
    }
  )
}
