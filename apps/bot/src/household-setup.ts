import type {
  HouseholdAdminService,
  HouseholdOnboardingService,
  HouseholdSetupService,
  HouseholdMiniAppAccess
} from '@household/application'

import type { Logger } from '@household/observability'
import type {
  HouseholdConfigurationRepository,
  HouseholdTelegramChatRecord,
  HouseholdTopicBindingRecord,
  HouseholdTopicRole,
  TelegramPendingActionRepository
} from '@household/ports'
import type { Bot, Context } from 'grammy'

import { getBotTranslations, type BotLocale } from './i18n'
import { resolveReplyLocale } from './bot-locale'

const APPROVE_MEMBER_CALLBACK_PREFIX = 'approve_member:'
const SETUP_CREATE_TOPIC_CALLBACK_PREFIX = 'setup_topic:create:'

const HOUSEHOLD_TOPIC_ROLE_ORDER: readonly HouseholdTopicRole[] = [
  'purchase',
  'feedback',
  'reminders',
  'payments'
]

function commandArgText(ctx: Context): string {
  return typeof ctx.match === 'string' ? ctx.match.trim() : ''
}

function isGroupChat(ctx: Context): ctx is Context & {
  chat: NonNullable<Context['chat']> & { type: 'group' | 'supergroup'; title?: string }
} {
  return ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup'
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

function unsetupRejectionMessage(
  locale: BotLocale,
  reason: 'not_admin' | 'invalid_chat_type'
): string {
  const t = getBotTranslations(locale).setup
  switch (reason) {
    case 'not_admin':
      return t.onlyTelegramAdminsUnsetup
    case 'invalid_chat_type':
      return t.useUnsetupInGroup
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

function setupTopicRoleLabel(locale: BotLocale, role: HouseholdTopicRole): string {
  return getBotTranslations(locale).setup.setupTopicBindRoleName(role)
}

function setupSuggestedTopicName(locale: BotLocale, role: HouseholdTopicRole): string {
  return getBotTranslations(locale).setup.setupTopicSuggestedName(role)
}

function setupKeyboard(input: {
  locale: BotLocale
  joinDeepLink: string | null
  bindings: readonly HouseholdTopicBindingRecord[]
  miniAppUrl: string | undefined
  botUsername: string | undefined
  isPrivate: boolean
}) {
  const t = getBotTranslations(input.locale).setup
  const kt = getBotTranslations(input.locale).keyboard
  const configuredRoles = new Set(input.bindings.map((binding) => binding.role))
  const rows: Array<
    Array<
      | {
          text: string
          url: string
        }
      | {
          text: string
          callback_data: string
        }
      | {
          text: string
          web_app: { url: string }
        }
    >
  > = []

  // Create buttons for unconfigured roles (3 per row)
  const createButtons: Array<{ text: string; callback_data: string }> = []
  for (const role of HOUSEHOLD_TOPIC_ROLE_ORDER) {
    if (!configuredRoles.has(role)) {
      createButtons.push({
        text: t.setupTopicCreateButton(setupTopicRoleLabel(input.locale, role)),
        callback_data: `${SETUP_CREATE_TOPIC_CALLBACK_PREFIX}${role}`
      })
    }
  }

  // Chunk create buttons into rows of 3
  for (let i = 0; i < createButtons.length; i += 3) {
    rows.push(createButtons.slice(i, i + 3))
  }

  // Add join link button
  if (input.joinDeepLink) {
    rows.push([
      {
        text: t.joinHouseholdButton,
        url: input.joinDeepLink
      }
    ])
  }

  // Add dashboard button
  const webAppUrl = buildOpenMiniAppUrl(input.miniAppUrl, input.botUsername)
  if (webAppUrl) {
    if (input.isPrivate) {
      rows.push([
        {
          text: kt.dashboardButton,
          web_app: {
            url: webAppUrl
          }
        }
      ])
    } else if (input.botUsername) {
      rows.push([
        {
          text: kt.dashboardButton,
          url: `https://t.me/${input.botUsername}/app`
        }
      ])
    }
  }

  return rows.length > 0
    ? {
        reply_markup: {
          inline_keyboard: rows
        }
      }
    : {}
}

function setupTopicChecklist(input: {
  locale: BotLocale
  bindings: readonly HouseholdTopicBindingRecord[]
}): string {
  const t = getBotTranslations(input.locale).setup
  const bindingByRole = new Map(input.bindings.map((binding) => [binding.role, binding]))
  const configuredCount = input.bindings.length
  const totalCount = HOUSEHOLD_TOPIC_ROLE_ORDER.length

  const lines = [t.setupTopicsHeading(configuredCount, totalCount)]

  // Group roles in pairs for compact display
  for (let i = 0; i < HOUSEHOLD_TOPIC_ROLE_ORDER.length; i += 2) {
    const role1 = HOUSEHOLD_TOPIC_ROLE_ORDER[i]!
    const role2 = HOUSEHOLD_TOPIC_ROLE_ORDER[i + 1]
    const binding1 = bindingByRole.get(role1)
    const binding2 = role2 ? bindingByRole.get(role2) : null
    const label1 = setupTopicRoleLabel(input.locale, role1)
    const label2 = role2 ? setupTopicRoleLabel(input.locale, role2) : null

    const status1 = binding1 ? t.setupTopicBound(label1) : t.setupTopicMissing(label1)
    const status2 =
      label2 && role2 ? (binding2 ? t.setupTopicBound(label2) : t.setupTopicMissing(label2)) : ''

    lines.push(status2 ? `${status1}  ${status2}` : status1)
  }

  return lines.join('\n')
}

function setupReply(input: {
  locale: BotLocale
  household: HouseholdTelegramChatRecord
  created: boolean
  joinDeepLink: string | null
  bindings: readonly HouseholdTopicBindingRecord[]
  miniAppUrl: string | undefined
  botUsername: string | undefined
  isPrivate: boolean
}) {
  const t = getBotTranslations(input.locale).setup
  return {
    text: [
      t.setupSummary({
        householdName: input.household.householdName,
        created: input.created
      }),
      setupTopicChecklist({
        locale: input.locale,
        bindings: input.bindings
      })
    ].join('\n\n'),
    ...setupKeyboard({
      locale: input.locale,
      joinDeepLink: input.joinDeepLink,
      bindings: input.bindings,
      miniAppUrl: input.miniAppUrl,
      botUsername: input.botUsername,
      isPrivate: input.isPrivate
    })
  }
}

function buildMiniAppBaseUrl(
  miniAppUrl: string | undefined,
  botUsername?: string | undefined
): string | null {
  const normalizedMiniAppUrl = miniAppUrl?.trim()
  if (!normalizedMiniAppUrl) {
    return null
  }

  const url = new URL(normalizedMiniAppUrl)

  if (botUsername && botUsername.trim().length > 0) {
    url.searchParams.set('bot', botUsername.trim())
  }

  return url.toString()
}

export function buildJoinMiniAppUrl(
  miniAppUrl: string | undefined,
  botUsername: string | undefined,
  joinToken: string
): string | null {
  const baseUrl = buildMiniAppBaseUrl(miniAppUrl, botUsername)
  if (!baseUrl) {
    return null
  }

  const url = new URL(baseUrl)
  url.searchParams.set('join', joinToken)

  return url.toString()
}

function buildOpenMiniAppUrl(
  miniAppUrl: string | undefined,
  botUsername: string | undefined
): string | null {
  return buildMiniAppBaseUrl(miniAppUrl, botUsername)
}

function miniAppReplyMarkup(
  locale: BotLocale,
  miniAppUrl: string | undefined,
  botUsername: string | undefined,
  joinToken: string,
  isPrivate: boolean
) {
  const webAppUrl = buildJoinMiniAppUrl(miniAppUrl, botUsername, joinToken)
  if (!webAppUrl) {
    return {}
  }

  if (isPrivate) {
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

  return botUsername
    ? {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: getBotTranslations(locale).setup.openMiniAppButton,
                url: `https://t.me/${botUsername}/app?startapp=join_${joinToken}`
              }
            ]
          ]
        }
      }
    : {}
}

function openMiniAppReplyMarkup(
  locale: BotLocale,
  miniAppUrl: string | undefined,
  botUsername: string | undefined,
  isPrivate: boolean
) {
  const webAppUrl = buildOpenMiniAppUrl(miniAppUrl, botUsername)
  if (!webAppUrl) {
    return {}
  }

  if (isPrivate) {
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

  return botUsername
    ? {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: getBotTranslations(locale).setup.openMiniAppButton,
                url: `https://t.me/${botUsername}/app`
              }
            ]
          ]
        }
      }
    : {}
}

export function registerHouseholdSetupCommands(options: {
  bot: Bot
  householdSetupService: HouseholdSetupService
  householdOnboardingService: HouseholdOnboardingService
  householdAdminService: HouseholdAdminService
  promptRepository?: TelegramPendingActionRepository
  householdConfigurationRepository?: HouseholdConfigurationRepository
  miniAppUrl?: string
  logger?: Logger
}): void {
  async function isInviteAuthorized(ctx: Context, householdId: string): Promise<boolean> {
    if (await isGroupAdmin(ctx)) {
      return true
    }

    const actorTelegramUserId = ctx.from?.id?.toString()
    if (!actorTelegramUserId || !options.householdConfigurationRepository) {
      return false
    }

    const member = await options.householdConfigurationRepository.getHouseholdMember(
      householdId,
      actorTelegramUserId
    )

    return member?.isAdmin === true
  }

  async function buildSetupReplyForHousehold(input: {
    ctx: Context
    locale: BotLocale
    household: HouseholdTelegramChatRecord
    created: boolean
    miniAppUrl: string | undefined
    botUsername: string | undefined
  }) {
    const joinToken = await options.householdOnboardingService.ensureHouseholdJoinToken({
      householdId: input.household.householdId,
      ...(input.ctx.from?.id
        ? {
            actorTelegramUserId: input.ctx.from.id.toString()
          }
        : {})
    })

    const joinDeepLink = input.ctx.me.username
      ? `https://t.me/${input.ctx.me.username}?start=join_${encodeURIComponent(joinToken.token)}`
      : null

    const bindings = options.householdConfigurationRepository
      ? await options.householdConfigurationRepository.listHouseholdTopicBindings(
          input.household.householdId
        )
      : []

    return setupReply({
      locale: input.locale,
      household: input.household,
      created: input.created,
      joinDeepLink,
      bindings,
      miniAppUrl: input.miniAppUrl,
      botUsername: input.botUsername,
      isPrivate: input.ctx.chat?.type === 'private'
    })
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
      if (startPayload === 'dashboard') {
        if (!options.miniAppUrl) {
          await ctx.reply(t.setup.openMiniAppUnavailable)
          return
        }

        await ctx.reply(
          t.setup.openMiniAppFromPrivateChat,
          openMiniAppReplyMarkup(locale, options.miniAppUrl, ctx.me.username, true)
        )
        return
      }

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
        miniAppReplyMarkup(locale, options.miniAppUrl, ctx.me.username, joinToken, true)
      )
      return
    }

    await ctx.reply(
      t.setup.joinRequestSent(result.household.name),
      miniAppReplyMarkup(locale, options.miniAppUrl, ctx.me.username, joinToken, true)
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

    const reply = await buildSetupReplyForHousehold({
      ctx,
      locale,
      household: result.household,
      created: result.status === 'created',
      miniAppUrl: options.miniAppUrl,
      botUsername: ctx.me.username
    })
    const sent = await ctx.reply(
      reply.text,
      'reply_markup' in reply ? { reply_markup: reply.reply_markup } : {}
    )

    if (options.promptRepository) {
      await options.promptRepository.upsertPendingAction({
        telegramUserId: `setup_tracking:${result.household.householdId}`,
        telegramChatId: ctx.chat.id.toString(),
        action: 'setup_topic_binding',
        payload: { setupMessageId: sent.message_id },
        expiresAt: null
      })
    }
  })

  options.bot.command('unsetup', async (ctx) => {
    const locale = await resolveReplyLocale({
      ctx,
      repository: options.householdConfigurationRepository
    })
    const t = getBotTranslations(locale)

    if (!isGroupChat(ctx)) {
      await ctx.reply(t.setup.useUnsetupInGroup)
      return
    }

    const telegramChatId = ctx.chat.id.toString()
    const result = await options.householdSetupService.unsetupGroupChat({
      actorIsAdmin: await isGroupAdmin(ctx),
      telegramChatId,
      telegramChatType: ctx.chat.type
    })

    if (result.status === 'rejected') {
      await ctx.reply(unsetupRejectionMessage(locale, result.reason))
      return
    }

    if (result.status === 'noop') {
      await options.promptRepository?.clearPendingActionsForChat(
        telegramChatId,
        'setup_topic_binding'
      )
      await ctx.reply(t.setup.unsetupNoop)
      return
    }

    await options.promptRepository?.clearPendingActionsForChat(
      telegramChatId,
      'setup_topic_binding'
    )

    options.logger?.info(
      {
        event: 'household_setup.chat_reset',
        telegramChatId,
        householdId: result.household.householdId,
        actorTelegramUserId: ctx.from?.id?.toString()
      },
      'Household setup state reset'
    )

    await ctx.reply(t.setup.unsetupComplete(result.household.householdName))
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

  options.bot.command('join_link', async (ctx) => {
    const locale = await resolveReplyLocale({
      ctx,
      repository: options.householdConfigurationRepository
    })
    const t = getBotTranslations(locale)

    if (!isGroupChat(ctx)) {
      await ctx.reply(t.setup.useJoinLinkInGroup)
      return
    }

    if (!options.householdConfigurationRepository) {
      await ctx.reply(t.setup.householdNotConfigured)
      return
    }

    const household = await options.householdConfigurationRepository.getTelegramHouseholdChat(
      ctx.chat.id.toString()
    )
    if (!household) {
      await ctx.reply(t.setup.householdNotConfigured)
      return
    }

    if (!(await isInviteAuthorized(ctx, household.householdId))) {
      await ctx.reply(t.setup.onlyInviteAdmins)
      return
    }

    const joinToken = await options.householdOnboardingService.ensureHouseholdJoinToken({
      householdId: household.householdId,
      ...(ctx.from?.id
        ? {
            actorTelegramUserId: ctx.from.id.toString()
          }
        : {})
    })

    const joinDeepLink = ctx.me.username
      ? `https://t.me/${ctx.me.username}?start=join_${encodeURIComponent(joinToken.token)}`
      : null

    if (!joinDeepLink) {
      await ctx.reply(t.setup.joinLinkUnavailable)
      return
    }

    await ctx.reply(t.setup.joinLinkReady(joinDeepLink, household.householdName), {
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
    })
  })

  options.bot.command('bind', async (ctx) => {
    const locale = await resolveReplyLocale({
      ctx,
      repository: options.householdConfigurationRepository
    })
    const t = getBotTranslations(locale)

    if (!isGroupChat(ctx)) {
      await ctx.reply(t.setup.useSetupInGroup)
      return
    }

    if (!ctx.message?.message_thread_id) {
      await ctx.reply(t.setup.useCommandInTopic)
      return
    }

    const actorIsAdmin = await isGroupAdmin(ctx)
    if (!actorIsAdmin) {
      await ctx.reply(t.setup.onlyTelegramAdminsBindTopics)
      return
    }

    const telegramChatId = ctx.chat.id.toString()
    const household = options.householdConfigurationRepository
      ? await options.householdConfigurationRepository.getTelegramHouseholdChat(telegramChatId)
      : null

    if (!household) {
      await ctx.reply(t.setup.householdNotConfigured)
      return
    }

    const bindings = options.householdConfigurationRepository
      ? await options.householdConfigurationRepository.listHouseholdTopicBindings(
          household.householdId
        )
      : []

    const configuredRoles = new Set(bindings.map((b) => b.role))
    const availableRoles = HOUSEHOLD_TOPIC_ROLE_ORDER.filter((role) => !configuredRoles.has(role))

    if (availableRoles.length === 0) {
      await ctx.reply(t.setup.allRolesConfigured)
      return
    }

    const rows = availableRoles.map((role) => [
      {
        text: setupTopicRoleLabel(locale, role),
        callback_data: `bind_topic:${role}:${ctx.message!.message_thread_id}`
      }
    ])

    await ctx.reply(t.setup.bindSelectRole, {
      reply_markup: {
        inline_keyboard: rows
      }
    })
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
        await ctx
          .answerCallbackQuery({
            text: adminRejectionMessage(locale, result.reason),
            show_alert: true
          })
          .catch(() => {})
        return
      }

      try {
        await ctx.answerCallbackQuery({
          text: t.setup.approvedMemberToast(result.member.displayName)
        })
      } catch {
        // Ignore stale query
      }

      if (ctx.msg) {
        const refreshed = await options.householdAdminService.listPendingMembers({
          actorTelegramUserId,
          telegramChatId: ctx.chat.id.toString()
        })

        if (refreshed.status === 'ok') {
          try {
            if (refreshed.members.length === 0) {
              await ctx.editMessageText(t.setup.pendingMembersEmpty(refreshed.householdName))
            } else {
              const reply = pendingMembersReply(locale, refreshed)
              await ctx.editMessageText(reply.text, {
                reply_markup: reply.reply_markup
              })
            }
          } catch {
            // Ignore message edit errors
          }
        }
      }

      await ctx.reply(t.setup.approvedMember(result.member.displayName, result.householdName))
    }
  )

  if (options.promptRepository) {
    options.bot.callbackQuery(
      new RegExp(`^${SETUP_CREATE_TOPIC_CALLBACK_PREFIX}(purchase|feedback|reminders|payments)$`),
      async (ctx) => {
        const locale = await resolveReplyLocale({
          ctx,
          repository: options.householdConfigurationRepository
        })
        const t = getBotTranslations(locale).setup

        if (!isGroupChat(ctx)) {
          await ctx
            .answerCallbackQuery({
              text: t.useButtonInGroup,
              show_alert: true
            })
            .catch(() => {})
          return
        }

        const role = ctx.match[1] as HouseholdTopicRole
        const telegramChatId = ctx.chat.id.toString()
        const actorIsAdmin = await isGroupAdmin(ctx)
        const household = options.householdConfigurationRepository
          ? await options.householdConfigurationRepository.getTelegramHouseholdChat(telegramChatId)
          : null

        if (!actorIsAdmin) {
          await ctx
            .answerCallbackQuery({
              text: t.onlyTelegramAdminsBindTopics,
              show_alert: true
            })
            .catch(() => {})
          return
        }

        if (!household) {
          await ctx
            .answerCallbackQuery({
              text: t.householdNotConfigured,
              show_alert: true
            })
            .catch(() => {})
          return
        }

        try {
          const topicName = setupSuggestedTopicName(locale, role)
          const createdTopic = await ctx.api.createForumTopic(ctx.chat.id, topicName)
          const result = await options.householdSetupService.bindTopic({
            actorIsAdmin,
            telegramChatId,
            telegramThreadId: createdTopic.message_thread_id.toString(),
            role,
            topicName
          })

          if (result.status === 'rejected') {
            await ctx
              .answerCallbackQuery({
                text:
                  result.reason === 'not_admin'
                    ? t.onlyTelegramAdminsBindTopics
                    : t.householdNotConfigured,
                show_alert: true
              })
              .catch(() => {})
            return
          }

          const reply = await buildSetupReplyForHousehold({
            ctx,
            locale,
            household: result.household,
            created: false,
            miniAppUrl: options.miniAppUrl,
            botUsername: ctx.me.username
          })

          try {
            await ctx.answerCallbackQuery({
              text: t.setupTopicCreated(setupTopicRoleLabel(locale, role), topicName)
            })
          } catch {
            // Ignore stale query
          }

          if (ctx.msg) {
            try {
              await ctx.editMessageText(
                reply.text,
                'reply_markup' in reply ? { reply_markup: reply.reply_markup } : {}
              )
            } catch {
              // Ignore message edit errors
            }
          }
        } catch (error) {
          const message =
            error instanceof Error &&
            /not enough rights|forbidden|admin|permission/i.test(error.message)
              ? t.setupTopicCreateForbidden
              : t.setupTopicCreateFailed

          await ctx
            .answerCallbackQuery({
              text: message,
              show_alert: true
            })
            .catch(() => {})
        }
      }
    )

    options.bot.callbackQuery(
      /^bind_topic:(purchase|feedback|reminders|payments):(\d+)$/,
      async (ctx) => {
        const locale = await resolveReplyLocale({
          ctx,
          repository: options.householdConfigurationRepository
        })
        const t = getBotTranslations(locale).setup

        if (!isGroupChat(ctx)) {
          await ctx
            .answerCallbackQuery({
              text: t.useButtonInGroup,
              show_alert: true
            })
            .catch(() => {})
          return
        }

        const role = ctx.match[1] as HouseholdTopicRole
        const telegramThreadId = ctx.match[2]!
        const telegramChatId = ctx.chat.id.toString()
        const actorIsAdmin = await isGroupAdmin(ctx)

        if (!actorIsAdmin) {
          await ctx
            .answerCallbackQuery({
              text: t.onlyTelegramAdminsBindTopics,
              show_alert: true
            })
            .catch(() => {})
          return
        }

        const result = await options.householdSetupService.bindTopic({
          actorIsAdmin,
          telegramChatId,
          telegramThreadId,
          role
        })

        if (result.status === 'rejected') {
          await ctx
            .answerCallbackQuery({
              text:
                result.reason === 'not_admin'
                  ? t.onlyTelegramAdminsBindTopics
                  : t.householdNotConfigured,
              show_alert: true
            })
            .catch(() => {})
          return
        }

        try {
          await ctx.answerCallbackQuery({
            text: t.topicBoundSuccess(
              setupTopicRoleLabel(locale, role),
              result.household.householdName
            )
          })
        } catch {
          // Ignore stale query
        }

        if (ctx.msg) {
          try {
            await ctx.editMessageText(
              t.topicBoundSuccess(setupTopicRoleLabel(locale, role), result.household.householdName)
            )
          } catch {
            // Ignore message edit errors
          }
        }

        // Try to update the main /setup checklist if it exists
        if (options.promptRepository) {
          const setupTracking = await options.promptRepository.getPendingAction(
            telegramChatId,
            `setup_tracking:${result.household.householdId}`
          )

          if (setupTracking?.payload.setupMessageId) {
            const setupMessageId = setupTracking.payload.setupMessageId as number
            const refreshed = await buildSetupReplyForHousehold({
              ctx,
              locale,
              household: result.household,
              created: false,
              miniAppUrl: options.miniAppUrl,
              botUsername: ctx.me.username
            })

            try {
              await ctx.api.editMessageText(telegramChatId, setupMessageId, refreshed.text, {
                reply_markup: refreshed.reply_markup
              } as any)
            } catch (error) {
              // Message might be deleted or too old, ignore
              options.logger?.debug(
                {
                  event: 'household_setup.update_checklist_failed',
                  error,
                  setupMessageId
                },
                'Failed to update setup checklist message'
              )
            }
          }
        }
      }
    )
  }
  options.bot.command(['app', 'dashboard'], async (ctx) => {
    const locale = await resolveReplyLocale({
      ctx,
      repository: options.householdConfigurationRepository
    })
    const t = getBotTranslations(locale)

    if (!options.miniAppUrl) {
      await ctx.reply(t.setup.openMiniAppUnavailable)
      return
    }

    await ctx.reply(
      t.setup.openMiniAppFromPrivateChat,
      openMiniAppReplyMarkup(
        locale,
        options.miniAppUrl,
        ctx.me.username,
        ctx.chat?.type === 'private'
      )
    )
  })

  options.bot.command('keyboard', async (ctx) => {
    const locale = await resolveReplyLocale({
      ctx,
      repository: options.householdConfigurationRepository
    })
    const t = getBotTranslations(locale)

    if (!options.miniAppUrl) {
      await ctx.reply(t.setup.openMiniAppUnavailable)
      return
    }

    const webAppUrl = buildOpenMiniAppUrl(options.miniAppUrl, ctx.me.username)
    if (!webAppUrl) {
      await ctx.reply(t.setup.openMiniAppUnavailable)
      return
    }

    await ctx.reply(t.keyboard.enabled, {
      reply_markup: {
        keyboard: [[{ text: t.keyboard.dashboardButton, web_app: { url: webAppUrl } }]],
        resize_keyboard: true,
        is_persistent: true
      }
    })
  })
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
