import type {
  HouseholdAdminService,
  HouseholdOnboardingService,
  HouseholdSetupService,
  HouseholdMiniAppAccess
} from '@household/application'
import type { Logger } from '@household/observability'
import type { HouseholdConfigurationRepository } from '@household/ports'
import type { Bot, Context } from 'grammy'

import { getBotTranslations, type BotLocale } from './i18n'
import { resolveReplyLocale } from './bot-locale'

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

function setupRejectionMessage(
  locale: BotLocale,
  reason: 'not_admin' | 'invalid_chat_type'
): string {
  const t = getBotTranslations(locale).setup
  switch (reason) {
    case 'not_admin':
      return t.onlyTelegramAdmins
    case 'invalid_chat_type':
      return t.useSetupInGroup
  }
}

function bindRejectionMessage(
  locale: BotLocale,
  reason: 'not_admin' | 'household_not_found' | 'not_topic_message'
): string {
  const t = getBotTranslations(locale).setup
  switch (reason) {
    case 'not_admin':
      return t.onlyTelegramAdminsBindTopics
    case 'household_not_found':
      return t.householdNotConfigured
    case 'not_topic_message':
      return t.useCommandInTopic
  }
}

function bindTopicUsageMessage(
  locale: BotLocale,
  role: 'purchase' | 'feedback' | 'reminders'
): string {
  const t = getBotTranslations(locale).setup

  switch (role) {
    case 'purchase':
      return t.useBindPurchaseTopicInGroup
    case 'feedback':
      return t.useBindFeedbackTopicInGroup
    case 'reminders':
      return t.useBindRemindersTopicInGroup
  }
}

function bindTopicSuccessMessage(
  locale: BotLocale,
  role: 'purchase' | 'feedback' | 'reminders',
  householdName: string,
  threadId: string
): string {
  const t = getBotTranslations(locale).setup

  switch (role) {
    case 'purchase':
      return t.purchaseTopicSaved(householdName, threadId)
    case 'feedback':
      return t.feedbackTopicSaved(householdName, threadId)
    case 'reminders':
      return t.remindersTopicSaved(householdName, threadId)
  }
}

function adminRejectionMessage(
  locale: BotLocale,
  reason: 'not_admin' | 'household_not_found' | 'pending_not_found'
): string {
  const t = getBotTranslations(locale).setup
  switch (reason) {
    case 'not_admin':
      return t.onlyHouseholdAdmins
    case 'household_not_found':
      return t.householdNotConfigured
    case 'pending_not_found':
      return t.pendingNotFound
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

function pendingMembersReply(
  locale: BotLocale,
  result: {
    householdName: string
    members: readonly {
      telegramUserId: string
      displayName: string
      username?: string | null
    }[]
  }
) {
  const t = getBotTranslations(locale).setup
  return {
    text: [
      t.pendingMembersHeading(result.householdName),
      ...result.members.map((member, index) => t.pendingMemberLine(member, index)),
      t.pendingMembersHint
    ].join('\n'),
    reply_markup: {
      inline_keyboard: result.members.map((member) => [
        {
          text: t.approveMemberButton(buildPendingMemberLabel(member.displayName)),
          callback_data: `${APPROVE_MEMBER_CALLBACK_PREFIX}${member.telegramUserId}`
        }
      ])
    }
  } as const
}

export function buildJoinMiniAppUrl(
  miniAppUrl: string | undefined,
  botUsername: string | undefined,
  joinToken: string
): string | null {
  const normalizedMiniAppUrl = miniAppUrl?.trim()
  if (!normalizedMiniAppUrl) {
    return null
  }

  const url = new URL(normalizedMiniAppUrl)
  url.searchParams.set('join', joinToken)

  if (botUsername && botUsername.trim().length > 0) {
    url.searchParams.set('bot', botUsername.trim())
  }

  return url.toString()
}

function miniAppReplyMarkup(
  locale: BotLocale,
  miniAppUrl: string | undefined,
  botUsername: string | undefined,
  joinToken: string
) {
  const webAppUrl = buildJoinMiniAppUrl(miniAppUrl, botUsername, joinToken)
  if (!webAppUrl) {
    return {}
  }

  return {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: getBotTranslations(locale).setup.openMiniAppButton,
            web_app: {
              url: webAppUrl
            }
          }
        ]
      ]
    }
  }
}

export function registerHouseholdSetupCommands(options: {
  bot: Bot
  householdSetupService: HouseholdSetupService
  householdOnboardingService: HouseholdOnboardingService
  householdAdminService: HouseholdAdminService
  householdConfigurationRepository?: HouseholdConfigurationRepository
  miniAppUrl?: string
  logger?: Logger
}): void {
  async function handleBindTopicCommand(
    ctx: Context,
    role: 'purchase' | 'feedback' | 'reminders'
  ): Promise<void> {
    const locale = await resolveReplyLocale({
      ctx,
      repository: options.householdConfigurationRepository
    })

    if (!isGroupChat(ctx)) {
      await ctx.reply(bindTopicUsageMessage(locale, role))
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
      role,
      ...(telegramThreadId
        ? {
            telegramThreadId
          }
        : {})
    })

    if (result.status === 'rejected') {
      await ctx.reply(bindRejectionMessage(locale, result.reason))
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
      bindTopicSuccessMessage(
        locale,
        role,
        result.household.householdName,
        result.binding.telegramThreadId
      )
    )
  }

  options.bot.command('start', async (ctx) => {
    const fallbackLocale = await resolveReplyLocale({
      ctx,
      repository: options.householdConfigurationRepository
    })
    let locale = fallbackLocale
    let t = getBotTranslations(locale)

    if (ctx.chat?.type !== 'private') {
      return
    }

    if (!ctx.from) {
      await ctx.reply(t.setup.telegramIdentityRequired)
      return
    }

    const startPayload = commandArgText(ctx)
    if (!startPayload.startsWith('join_')) {
      await ctx.reply(t.common.useHelp)
      return
    }

    const joinToken = startPayload.slice('join_'.length).trim()
    if (!joinToken) {
      await ctx.reply(t.setup.invalidJoinLink)
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
      await ctx.reply(t.setup.joinLinkInvalidOrExpired)
      return
    }

    if (result.status === 'active') {
      locale = result.member.preferredLocale ?? result.member.householdDefaultLocale
      t = getBotTranslations(locale)
    } else {
      const access = await options.householdOnboardingService.getMiniAppAccess({
        identity,
        joinToken
      })
      locale = localeFromAccess(access, fallbackLocale)
      t = getBotTranslations(locale)
    }

    if (result.status === 'active') {
      await ctx.reply(
        t.setup.alreadyActiveMember(result.member.displayName),
        miniAppReplyMarkup(locale, options.miniAppUrl, ctx.me.username, joinToken)
      )
      return
    }

    await ctx.reply(
      t.setup.joinRequestSent(result.household.name),
      miniAppReplyMarkup(locale, options.miniAppUrl, ctx.me.username, joinToken)
    )
  })

  options.bot.command('setup', async (ctx) => {
    const fallbackLocale = await resolveReplyLocale({
      ctx,
      repository: options.householdConfigurationRepository
    })
    let locale = fallbackLocale
    let t = getBotTranslations(locale)

    if (!isGroupChat(ctx)) {
      await ctx.reply(t.setup.useSetupInGroup)
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
      await ctx.reply(setupRejectionMessage(locale, result.reason))
      return
    }

    locale = result.household.defaultLocale
    t = getBotTranslations(locale)

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
      t.setup.setupSummary({
        householdName: result.household.householdName,
        telegramChatId: result.household.telegramChatId,
        created: action === 'created'
      }),
      joinDeepLink
        ? {
            reply_markup: {
              inline_keyboard: [
                [
                  {
                    text: t.setup.joinHouseholdButton,
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
    await handleBindTopicCommand(ctx, 'purchase')
  })

  options.bot.command('bind_feedback_topic', async (ctx) => {
    await handleBindTopicCommand(ctx, 'feedback')
  })

  options.bot.command('bind_reminders_topic', async (ctx) => {
    await handleBindTopicCommand(ctx, 'reminders')
  })

  options.bot.command('pending_members', async (ctx) => {
    const locale = await resolveReplyLocale({
      ctx,
      repository: options.householdConfigurationRepository
    })
    const t = getBotTranslations(locale)

    if (!isGroupChat(ctx)) {
      await ctx.reply(t.setup.usePendingMembersInGroup)
      return
    }

    const actorTelegramUserId = ctx.from?.id?.toString()
    if (!actorTelegramUserId) {
      await ctx.reply(t.common.unableToIdentifySender)
      return
    }

    const result = await options.householdAdminService.listPendingMembers({
      actorTelegramUserId,
      telegramChatId: ctx.chat.id.toString()
    })

    if (result.status === 'rejected') {
      await ctx.reply(adminRejectionMessage(locale, result.reason))
      return
    }

    if (result.members.length === 0) {
      await ctx.reply(t.setup.pendingMembersEmpty(result.householdName))
      return
    }

    const reply = pendingMembersReply(locale, result)
    await ctx.reply(reply.text, {
      reply_markup: reply.reply_markup
    })
  })

  options.bot.command('approve_member', async (ctx) => {
    const locale = await resolveReplyLocale({
      ctx,
      repository: options.householdConfigurationRepository
    })
    const t = getBotTranslations(locale)

    if (!isGroupChat(ctx)) {
      await ctx.reply(t.setup.useApproveMemberInGroup)
      return
    }

    const actorTelegramUserId = ctx.from?.id?.toString()
    if (!actorTelegramUserId) {
      await ctx.reply(t.common.unableToIdentifySender)
      return
    }

    const pendingTelegramUserId = commandArgText(ctx)
    if (!pendingTelegramUserId) {
      await ctx.reply(t.setup.approveMemberUsage)
      return
    }

    const result = await options.householdAdminService.approvePendingMember({
      actorTelegramUserId,
      telegramChatId: ctx.chat.id.toString(),
      pendingTelegramUserId
    })

    if (result.status === 'rejected') {
      await ctx.reply(adminRejectionMessage(locale, result.reason))
      return
    }

    await ctx.reply(t.setup.approvedMember(result.member.displayName, result.householdName))
  })

  options.bot.callbackQuery(
    new RegExp(`^${APPROVE_MEMBER_CALLBACK_PREFIX}(\\d+)$`),
    async (ctx) => {
      const locale = await resolveReplyLocale({
        ctx,
        repository: options.householdConfigurationRepository
      })
      const t = getBotTranslations(locale)

      if (!isGroupChat(ctx)) {
        await ctx.answerCallbackQuery({
          text: t.setup.useButtonInGroup,
          show_alert: true
        })
        return
      }

      const actorTelegramUserId = ctx.from?.id?.toString()
      const pendingTelegramUserId = ctx.match[1]
      if (!actorTelegramUserId || !pendingTelegramUserId) {
        await ctx.answerCallbackQuery({
          text: t.setup.unableToIdentifySelectedMember,
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
          text: adminRejectionMessage(locale, result.reason),
          show_alert: true
        })
        return
      }

      await ctx.answerCallbackQuery({
        text: t.setup.approvedMemberToast(result.member.displayName)
      })

      if (ctx.msg) {
        const refreshed = await options.householdAdminService.listPendingMembers({
          actorTelegramUserId,
          telegramChatId: ctx.chat.id.toString()
        })

        if (refreshed.status === 'ok') {
          if (refreshed.members.length === 0) {
            await ctx.editMessageText(t.setup.pendingMembersEmpty(refreshed.householdName))
          } else {
            const reply = pendingMembersReply(locale, refreshed)
            await ctx.editMessageText(reply.text, {
              reply_markup: reply.reply_markup
            })
          }
        }
      }

      await ctx.reply(t.setup.approvedMember(result.member.displayName, result.householdName))
    }
  )
}

function localeFromAccess(access: HouseholdMiniAppAccess, fallback: BotLocale): BotLocale {
  switch (access.status) {
    case 'active':
      return access.member.preferredLocale ?? access.member.householdDefaultLocale
    case 'pending':
    case 'join_required':
      return access.household.defaultLocale
    case 'open_from_group':
      return fallback
  }
}
