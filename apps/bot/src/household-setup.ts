import type {
  HouseholdAdminService,
  HouseholdOnboardingService,
  HouseholdSetupService,
  HouseholdMiniAppAccess
} from '@household/application'
import { nowInstant } from '@household/domain'
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
import { buildBotStartDeepLink } from './telegram-deep-links'

const APPROVE_MEMBER_CALLBACK_PREFIX = 'approve_member:'
const SETUP_CREATE_TOPIC_CALLBACK_PREFIX = 'setup_topic:create:'
const SETUP_BIND_TOPIC_CALLBACK_PREFIX = 'setup_topic:bind:'
const GROUP_INVITE_START_PREFIX = 'invite_'
const GROUP_INVITE_ACTION = 'household_group_invite' as const
const GROUP_INVITE_TTL_MS = 3 * 24 * 60 * 60 * 1000
const SETUP_BIND_TOPIC_ACTION = 'setup_topic_binding' as const
const SETUP_BIND_TOPIC_TTL_MS = 10 * 60 * 1000
const HOUSEHOLD_TOPIC_ROLE_ORDER: readonly HouseholdTopicRole[] = [
  'chat',
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

function isTopicMessage(ctx: Context): boolean {
  const message = ctx.msg
  return !!message && 'is_topic_message' in message && message.is_topic_message === true
}

function isCommandMessage(ctx: Context): boolean {
  const text = ctx.msg?.text
  return typeof text === 'string' && text.trimStart().startsWith('/')
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
  role: 'chat' | 'purchase' | 'feedback' | 'reminders' | 'payments'
): string {
  const t = getBotTranslations(locale).setup

  switch (role) {
    case 'chat':
      return t.useBindChatTopicInGroup
    case 'purchase':
      return t.useBindPurchaseTopicInGroup
    case 'feedback':
      return t.useBindFeedbackTopicInGroup
    case 'reminders':
      return t.useBindRemindersTopicInGroup
    case 'payments':
      return t.useBindPaymentsTopicInGroup
  }
}

function bindTopicSuccessMessage(
  locale: BotLocale,
  role: 'chat' | 'purchase' | 'feedback' | 'reminders' | 'payments',
  householdName: string,
  threadId: string
): string {
  const t = getBotTranslations(locale).setup

  switch (role) {
    case 'chat':
      return t.chatTopicSaved(householdName, threadId)
    case 'purchase':
      return t.purchaseTopicSaved(householdName, threadId)
    case 'feedback':
      return t.feedbackTopicSaved(householdName, threadId)
    case 'reminders':
      return t.remindersTopicSaved(householdName, threadId)
    case 'payments':
      return t.paymentsTopicSaved(householdName, threadId)
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

function telegramUserDisplayName(input: {
  firstName: string | undefined
  lastName: string | undefined
  username: string | undefined
  fallback: string
}): string {
  const fullName = [input.firstName?.trim(), input.lastName?.trim()]
    .filter(Boolean)
    .join(' ')
    .trim()
  return fullName || input.username?.trim() || input.fallback
}

function repliedTelegramUser(ctx: Context): {
  telegramUserId: string
  displayName: string
  username?: string
} | null {
  const replied = ctx.msg?.reply_to_message
  if (!replied?.from || replied.from.is_bot) {
    return null
  }

  return {
    telegramUserId: replied.from.id.toString(),
    displayName: telegramUserDisplayName({
      firstName: replied.from.first_name,
      lastName: replied.from.last_name,
      username: replied.from.username,
      fallback: `Telegram ${replied.from.id}`
    }),
    ...(replied.from.username
      ? {
          username: replied.from.username
        }
      : {})
  }
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

function topicBindingDisplay(binding: HouseholdTopicBindingRecord): string {
  return binding.topicName?.trim() || `thread ${binding.telegramThreadId}`
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
}) {
  const t = getBotTranslations(input.locale).setup
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
    >
  > = []

  if (input.joinDeepLink) {
    rows.push([
      {
        text: t.joinHouseholdButton,
        url: input.joinDeepLink
      }
    ])
  }

  for (const role of HOUSEHOLD_TOPIC_ROLE_ORDER) {
    if (configuredRoles.has(role)) {
      continue
    }

    rows.push([
      {
        text: t.setupTopicCreateButton(setupTopicRoleLabel(input.locale, role)),
        callback_data: `${SETUP_CREATE_TOPIC_CALLBACK_PREFIX}${role}`
      },
      {
        text: t.setupTopicBindButton(setupTopicRoleLabel(input.locale, role)),
        callback_data: `${SETUP_BIND_TOPIC_CALLBACK_PREFIX}${role}`
      }
    ])
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

  return [
    t.setupTopicsHeading,
    ...HOUSEHOLD_TOPIC_ROLE_ORDER.map((role) => {
      const binding = bindingByRole.get(role)
      const roleLabel = setupTopicRoleLabel(input.locale, role)
      return binding
        ? t.setupTopicBound(roleLabel, topicBindingDisplay(binding))
        : t.setupTopicMissing(roleLabel)
    })
  ].join('\n')
}

function setupReply(input: {
  locale: BotLocale
  household: HouseholdTelegramChatRecord
  created: boolean
  joinDeepLink: string | null
  bindings: readonly HouseholdTopicBindingRecord[]
}) {
  const t = getBotTranslations(input.locale).setup
  return {
    text: [
      t.setupSummary({
        householdName: input.household.householdName,
        telegramChatId: input.household.telegramChatId,
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
      bindings: input.bindings
    })
  }
}

function isHouseholdTopicRole(value: string): value is HouseholdTopicRole {
  return (
    value === 'chat' ||
    value === 'purchase' ||
    value === 'feedback' ||
    value === 'reminders' ||
    value === 'payments'
  )
}

function parseSetupBindPayload(payload: Record<string, unknown>): {
  role: HouseholdTopicRole
  setupMessageId?: number
} | null {
  if (typeof payload.role !== 'string' || !isHouseholdTopicRole(payload.role)) {
    return null
  }

  return {
    role: payload.role,
    ...(typeof payload.setupMessageId === 'number' && Number.isInteger(payload.setupMessageId)
      ? {
          setupMessageId: payload.setupMessageId
        }
      : {})
  }
}

function invitePendingChatId(telegramChatId: string): string {
  return `invite:${telegramChatId}`
}

function parseGroupInvitePayload(payload: Record<string, unknown>): {
  joinToken: string
  householdId: string
  householdName: string
  targetDisplayName: string
  inviteMessageId?: number
  completed?: boolean
} | null {
  if (
    typeof payload.joinToken !== 'string' ||
    payload.joinToken.trim().length === 0 ||
    typeof payload.householdId !== 'string' ||
    payload.householdId.trim().length === 0 ||
    typeof payload.householdName !== 'string' ||
    payload.householdName.trim().length === 0 ||
    typeof payload.targetDisplayName !== 'string' ||
    payload.targetDisplayName.trim().length === 0
  ) {
    return null
  }

  return {
    joinToken: payload.joinToken,
    householdId: payload.householdId,
    householdName: payload.householdName,
    targetDisplayName: payload.targetDisplayName,
    ...(typeof payload.inviteMessageId === 'number' && Number.isInteger(payload.inviteMessageId)
      ? {
          inviteMessageId: payload.inviteMessageId
        }
      : {}),
    ...(payload.completed === true
      ? {
          completed: true
        }
      : {})
  }
}

function parseInviteStartPayload(payload: string): {
  telegramChatId: string
  targetTelegramUserId: string
} | null {
  const match = /^invite_(-?\d+)_(\d+)$/.exec(payload)
  if (!match) {
    return null
  }

  return {
    telegramChatId: match[1]!,
    targetTelegramUserId: match[2]!
  }
}

function buildGroupInviteDeepLink(
  botUsername: string | undefined,
  telegramChatId: string,
  targetTelegramUserId: string
): string | null {
  return buildBotStartDeepLink(
    botUsername,
    `${GROUP_INVITE_START_PREFIX}${telegramChatId}_${targetTelegramUserId}`
  )
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

function openMiniAppReplyMarkup(
  locale: BotLocale,
  miniAppUrl: string | undefined,
  botUsername: string | undefined
) {
  const webAppUrl = buildOpenMiniAppUrl(miniAppUrl, botUsername)
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
  promptRepository?: TelegramPendingActionRepository
  householdConfigurationRepository?: HouseholdConfigurationRepository
  miniAppUrl?: string
  logger?: Logger
}): void {
  async function editGroupInviteCompletion(input: {
    locale: BotLocale
    telegramChatId: string
    payload: {
      householdName: string
      targetDisplayName: string
      inviteMessageId?: number
    }
    status: 'active' | 'pending'
    ctx: Context
  }) {
    if (!input.payload.inviteMessageId) {
      return
    }

    const t = getBotTranslations(input.locale).setup
    const text =
      input.status === 'active'
        ? t.inviteJoinCompleted(input.payload.targetDisplayName, input.payload.householdName)
        : t.inviteJoinRequestSent(input.payload.targetDisplayName, input.payload.householdName)

    try {
      await input.ctx.api.editMessageText(
        Number(input.telegramChatId),
        input.payload.inviteMessageId,
        text
      )
    } catch (error) {
      options.logger?.warn(
        {
          event: 'household_setup.invite_message_update_failed',
          telegramChatId: input.telegramChatId,
          inviteMessageId: input.payload.inviteMessageId,
          error: error instanceof Error ? error.message : String(error)
        },
        'Failed to update household invite message'
      )
    }
  }

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
      bindings
    })
  }

  async function handleBindTopicCommand(
    ctx: Context,
    role: 'chat' | 'purchase' | 'feedback' | 'reminders' | 'payments'
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

  if (options.promptRepository) {
    const promptRepository = options.promptRepository

    options.bot.on('message', async (ctx, next) => {
      if (!isGroupChat(ctx) || !isTopicMessage(ctx) || isCommandMessage(ctx)) {
        await next()
        return
      }

      const telegramUserId = ctx.from?.id?.toString()
      const telegramChatId = ctx.chat?.id?.toString()
      const telegramThreadId =
        ctx.msg && 'message_thread_id' in ctx.msg ? ctx.msg.message_thread_id?.toString() : null

      if (!telegramUserId || !telegramChatId || !telegramThreadId) {
        await next()
        return
      }

      const pending = await promptRepository.getPendingAction(telegramChatId, telegramUserId)
      if (pending?.action !== SETUP_BIND_TOPIC_ACTION) {
        await next()
        return
      }

      const payload = parseSetupBindPayload(pending.payload)
      if (!payload) {
        await promptRepository.clearPendingAction(telegramChatId, telegramUserId)
        await next()
        return
      }

      const locale = await resolveReplyLocale({
        ctx,
        repository: options.householdConfigurationRepository
      })
      const result = await options.householdSetupService.bindTopic({
        actorIsAdmin: await isGroupAdmin(ctx),
        telegramChatId,
        telegramThreadId,
        role: payload.role
      })

      await promptRepository.clearPendingAction(telegramChatId, telegramUserId)

      if (result.status === 'rejected') {
        await ctx.reply(bindRejectionMessage(locale, result.reason))
        return
      }

      if (payload.setupMessageId && options.householdConfigurationRepository) {
        const reply = await buildSetupReplyForHousehold({
          ctx,
          locale,
          household: result.household,
          created: false
        })

        await ctx.api.editMessageText(
          Number(telegramChatId),
          payload.setupMessageId,
          reply.text,
          'reply_markup' in reply ? { reply_markup: reply.reply_markup } : {}
        )
      }

      await ctx.reply(
        bindTopicSuccessMessage(
          locale,
          payload.role,
          result.household.householdName,
          result.binding.telegramThreadId
        )
      )
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
    const inviteStart = parseInviteStartPayload(startPayload)
    if (inviteStart) {
      if (ctx.from.id.toString() !== inviteStart.targetTelegramUserId) {
        await ctx.reply(t.setup.inviteJoinWrongUser)
        return
      }

      if (!options.promptRepository) {
        await ctx.reply(t.setup.inviteJoinExpired)
        return
      }

      const invitePending = await options.promptRepository.getPendingAction(
        invitePendingChatId(inviteStart.telegramChatId),
        inviteStart.targetTelegramUserId
      )
      const invitePayload =
        invitePending?.action === GROUP_INVITE_ACTION
          ? parseGroupInvitePayload(invitePending.payload)
          : null
      const inviteExpiresAt = invitePending?.expiresAt ?? null

      if (!invitePayload) {
        await ctx.reply(t.setup.inviteJoinExpired)
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

      if (invitePayload.completed) {
        const access = await options.householdOnboardingService.getMiniAppAccess({
          identity,
          joinToken: invitePayload.joinToken
        })
        locale = localeFromAccess(access, fallbackLocale)
        t = getBotTranslations(locale)

        if (access.status === 'active') {
          await editGroupInviteCompletion({
            locale,
            telegramChatId: inviteStart.telegramChatId,
            payload: invitePayload,
            status: 'active',
            ctx
          })
          await ctx.reply(
            t.setup.alreadyActiveMember(access.member.displayName),
            miniAppReplyMarkup(locale, options.miniAppUrl, ctx.me.username, invitePayload.joinToken)
          )
          return
        }

        if (access.status === 'pending') {
          await editGroupInviteCompletion({
            locale,
            telegramChatId: inviteStart.telegramChatId,
            payload: invitePayload,
            status: 'pending',
            ctx
          })
          await ctx.reply(
            t.setup.joinRequestSent(access.household.name),
            miniAppReplyMarkup(locale, options.miniAppUrl, ctx.me.username, invitePayload.joinToken)
          )
          return
        }

        await ctx.reply(t.setup.inviteJoinExpired)
        return
      }

      const result = await options.householdOnboardingService.joinHousehold({
        identity,
        joinToken: invitePayload.joinToken
      })

      if (result.status === 'invalid_token') {
        await ctx.reply(t.setup.inviteJoinExpired)
        return
      }

      if (result.status === 'active') {
        locale = result.member.preferredLocale ?? result.member.householdDefaultLocale
        t = getBotTranslations(locale)
      } else {
        const access = await options.householdOnboardingService.getMiniAppAccess({
          identity,
          joinToken: invitePayload.joinToken
        })
        locale = localeFromAccess(access, fallbackLocale)
        t = getBotTranslations(locale)
      }

      await options.promptRepository.upsertPendingAction({
        telegramUserId: inviteStart.targetTelegramUserId,
        telegramChatId: invitePendingChatId(inviteStart.telegramChatId),
        action: GROUP_INVITE_ACTION,
        payload: {
          ...invitePayload,
          completed: true
        },
        expiresAt: inviteExpiresAt
      })

      await editGroupInviteCompletion({
        locale,
        telegramChatId: inviteStart.telegramChatId,
        payload: invitePayload,
        status: result.status,
        ctx
      })

      if (result.status === 'active') {
        await ctx.reply(
          t.setup.alreadyActiveMember(result.member.displayName),
          miniAppReplyMarkup(locale, options.miniAppUrl, ctx.me.username, invitePayload.joinToken)
        )
        return
      }

      await ctx.reply(
        t.setup.joinRequestSent(result.household.name),
        miniAppReplyMarkup(locale, options.miniAppUrl, ctx.me.username, invitePayload.joinToken)
      )
      return
    }

    if (!startPayload.startsWith('join_')) {
      if (startPayload === 'dashboard') {
        if (!options.miniAppUrl) {
          await ctx.reply(t.setup.openMiniAppUnavailable)
          return
        }

        await ctx.reply(
          t.setup.openMiniAppFromPrivateChat,
          openMiniAppReplyMarkup(locale, options.miniAppUrl, ctx.me.username)
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

    const reply = await buildSetupReplyForHousehold({
      ctx,
      locale,
      household: result.household,
      created: result.status === 'created'
    })
    await ctx.reply(reply.text, 'reply_markup' in reply ? { reply_markup: reply.reply_markup } : {})
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
        SETUP_BIND_TOPIC_ACTION
      )
      await ctx.reply(t.setup.unsetupNoop)
      return
    }

    await options.promptRepository?.clearPendingActionsForChat(
      telegramChatId,
      SETUP_BIND_TOPIC_ACTION
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

  options.bot.command('bind_chat_topic', async (ctx) => {
    await handleBindTopicCommand(ctx, 'chat')
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

  options.bot.command('bind_payments_topic', async (ctx) => {
    await handleBindTopicCommand(ctx, 'payments')
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

  options.bot.command('invite', async (ctx) => {
    const locale = await resolveReplyLocale({
      ctx,
      repository: options.householdConfigurationRepository
    })
    const t = getBotTranslations(locale)

    if (!isGroupChat(ctx)) {
      await ctx.reply(t.setup.useInviteInGroup)
      return
    }

    if (!options.promptRepository || !options.householdConfigurationRepository) {
      await ctx.reply(t.setup.inviteJoinExpired)
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

    const target = repliedTelegramUser(ctx)
    if (!target) {
      await ctx.reply(t.setup.inviteUsage)
      return
    }

    const existingMember = await options.householdConfigurationRepository.getHouseholdMember(
      household.householdId,
      target.telegramUserId
    )
    if (existingMember?.status === 'active') {
      await ctx.reply(
        t.setup.inviteAlreadyMember(existingMember.displayName, household.householdName)
      )
      return
    }

    const existingPending =
      await options.householdConfigurationRepository.getPendingHouseholdMember(
        household.householdId,
        target.telegramUserId
      )
    if (existingPending) {
      await ctx.reply(
        t.setup.inviteAlreadyPending(existingPending.displayName, household.householdName)
      )
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

    await options.promptRepository.upsertPendingAction({
      telegramUserId: target.telegramUserId,
      telegramChatId: invitePendingChatId(ctx.chat.id.toString()),
      action: GROUP_INVITE_ACTION,
      payload: {
        joinToken: joinToken.token,
        householdId: household.householdId,
        householdName: household.householdName,
        targetDisplayName: target.displayName
      },
      expiresAt: nowInstant().add({ milliseconds: GROUP_INVITE_TTL_MS })
    })

    const deepLink = buildGroupInviteDeepLink(
      ctx.me.username,
      ctx.chat.id.toString(),
      target.telegramUserId
    )
    if (!deepLink) {
      await ctx.reply(t.setup.inviteJoinExpired)
      return
    }

    const inviteMessage = await ctx.reply(
      t.setup.invitePrepared(target.displayName, household.householdName),
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: t.setup.joinHouseholdButton,
                url: deepLink
              }
            ]
          ]
        }
      }
    )

    await options.promptRepository.upsertPendingAction({
      telegramUserId: target.telegramUserId,
      telegramChatId: invitePendingChatId(ctx.chat.id.toString()),
      action: GROUP_INVITE_ACTION,
      payload: {
        joinToken: joinToken.token,
        householdId: household.householdId,
        householdName: household.householdName,
        targetDisplayName: target.displayName,
        inviteMessageId: inviteMessage.message_id
      },
      expiresAt: nowInstant().add({ milliseconds: GROUP_INVITE_TTL_MS })
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

  if (options.promptRepository) {
    const promptRepository = options.promptRepository

    options.bot.callbackQuery(
      new RegExp(`^${SETUP_CREATE_TOPIC_CALLBACK_PREFIX}(purchase|feedback|reminders|payments)$`),
      async (ctx) => {
        const locale = await resolveReplyLocale({
          ctx,
          repository: options.householdConfigurationRepository
        })
        const t = getBotTranslations(locale).setup

        if (!isGroupChat(ctx)) {
          await ctx.answerCallbackQuery({
            text: t.useButtonInGroup,
            show_alert: true
          })
          return
        }

        const role = ctx.match[1] as HouseholdTopicRole
        const telegramChatId = ctx.chat.id.toString()
        const actorIsAdmin = await isGroupAdmin(ctx)
        const household = options.householdConfigurationRepository
          ? await options.householdConfigurationRepository.getTelegramHouseholdChat(telegramChatId)
          : null

        if (!actorIsAdmin) {
          await ctx.answerCallbackQuery({
            text: t.onlyTelegramAdminsBindTopics,
            show_alert: true
          })
          return
        }

        if (!household) {
          await ctx.answerCallbackQuery({
            text: t.householdNotConfigured,
            show_alert: true
          })
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
            await ctx.answerCallbackQuery({
              text: bindRejectionMessage(locale, result.reason),
              show_alert: true
            })
            return
          }

          const reply = await buildSetupReplyForHousehold({
            ctx,
            locale,
            household: result.household,
            created: false
          })

          await ctx.answerCallbackQuery({
            text: t.setupTopicCreated(setupTopicRoleLabel(locale, role), topicName)
          })

          if (ctx.msg) {
            await ctx.editMessageText(
              reply.text,
              'reply_markup' in reply ? { reply_markup: reply.reply_markup } : {}
            )
          }
        } catch (error) {
          const message =
            error instanceof Error &&
            /not enough rights|forbidden|admin|permission/i.test(error.message)
              ? t.setupTopicCreateForbidden
              : t.setupTopicCreateFailed

          await ctx.answerCallbackQuery({
            text: message,
            show_alert: true
          })
        }
      }
    )

    options.bot.callbackQuery(
      new RegExp(`^${SETUP_BIND_TOPIC_CALLBACK_PREFIX}(purchase|feedback|reminders|payments)$`),
      async (ctx) => {
        const locale = await resolveReplyLocale({
          ctx,
          repository: options.householdConfigurationRepository
        })
        const t = getBotTranslations(locale).setup

        if (!isGroupChat(ctx)) {
          await ctx.answerCallbackQuery({
            text: t.useButtonInGroup,
            show_alert: true
          })
          return
        }

        const telegramUserId = ctx.from?.id?.toString()
        const telegramChatId = ctx.chat.id.toString()
        const role = ctx.match[1] as HouseholdTopicRole
        if (!telegramUserId) {
          await ctx.answerCallbackQuery({
            text: t.unableToIdentifySelectedMember,
            show_alert: true
          })
          return
        }

        if (!(await isGroupAdmin(ctx))) {
          await ctx.answerCallbackQuery({
            text: t.onlyTelegramAdminsBindTopics,
            show_alert: true
          })
          return
        }

        await promptRepository.upsertPendingAction({
          telegramUserId,
          telegramChatId,
          action: SETUP_BIND_TOPIC_ACTION,
          payload: {
            role,
            ...(ctx.msg
              ? {
                  setupMessageId: ctx.msg.message_id
                }
              : {})
          },
          expiresAt: nowInstant().add({ milliseconds: SETUP_BIND_TOPIC_TTL_MS })
        })

        await ctx.answerCallbackQuery({
          text: t.setupTopicBindPending(setupTopicRoleLabel(locale, role))
        })
      }
    )
  }
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
