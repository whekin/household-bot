import type { AdHocNotificationService } from '@household/application'
import { Temporal, nowInstant } from '@household/domain'
import type { Logger } from '@household/observability'
import type {
  AdHocNotificationDeliveryMode,
  HouseholdConfigurationRepository,
  HouseholdMemberRecord,
  TelegramPendingActionRepository
} from '@household/ports'
import type { Bot, Context } from 'grammy'
import type { InlineKeyboardMarkup } from 'grammy/types'

import {
  parseAdHocNotificationRequest,
  parseAdHocNotificationSchedule
} from './ad-hoc-notification-parser'
import { resolveReplyLocale } from './bot-locale'
import type { BotLocale } from './i18n'

const AD_HOC_NOTIFICATION_ACTION = 'ad_hoc_notification' as const
const AD_HOC_NOTIFICATION_ACTION_TTL_MS = 30 * 60_000
const AD_HOC_NOTIFICATION_CONFIRM_PREFIX = 'adhocnotif:confirm:'
const AD_HOC_NOTIFICATION_CANCEL_DRAFT_PREFIX = 'adhocnotif:canceldraft:'
const AD_HOC_NOTIFICATION_CANCEL_SAVED_PREFIX = 'adhocnotif:cancel:'
const AD_HOC_NOTIFICATION_MODE_PREFIX = 'adhocnotif:mode:'
const AD_HOC_NOTIFICATION_FRIENDLY_PREFIX = 'adhocnotif:friendly:'
const AD_HOC_NOTIFICATION_MEMBER_PREFIX = 'adhocnotif:member:'

type NotificationDraftPayload =
  | {
      stage: 'await_schedule'
      proposalId: string
      householdId: string
      threadId: string
      creatorMemberId: string
      timezone: string
      originalRequestText: string
      notificationText: string
      assigneeMemberId: string | null
      deliveryMode: AdHocNotificationDeliveryMode
      dmRecipientMemberIds: readonly string[]
      friendlyTagAssignee: boolean
    }
  | {
      stage: 'confirm'
      proposalId: string
      householdId: string
      threadId: string
      creatorMemberId: string
      timezone: string
      originalRequestText: string
      notificationText: string
      assigneeMemberId: string | null
      scheduledForIso: string
      timePrecision: 'exact' | 'date_only_defaulted'
      deliveryMode: AdHocNotificationDeliveryMode
      dmRecipientMemberIds: readonly string[]
      friendlyTagAssignee: boolean
    }

interface ReminderTopicContext {
  locale: BotLocale
  householdId: string
  threadId: string
  member: HouseholdMemberRecord
  members: readonly HouseholdMemberRecord[]
  timezone: string
}

function createProposalId(): string {
  return crypto.randomUUID().slice(0, 8)
}

function getMessageThreadId(ctx: Context): string | null {
  const message =
    ctx.msg ??
    (ctx.callbackQuery && 'message' in ctx.callbackQuery ? ctx.callbackQuery.message : null)
  if (!message || !('message_thread_id' in message) || message.message_thread_id === undefined) {
    return null
  }

  return message.message_thread_id.toString()
}

function readMessageText(ctx: Context): string | null {
  const message = ctx.message
  if (!message) {
    return null
  }

  if ('text' in message && typeof message.text === 'string') {
    return message.text.trim()
  }

  if ('caption' in message && typeof message.caption === 'string') {
    return message.caption.trim()
  }

  return null
}

function escapeHtml(raw: string): string {
  return raw.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function formatScheduledFor(locale: BotLocale, scheduledForIso: string, timezone: string): string {
  const zdt = Temporal.Instant.from(scheduledForIso).toZonedDateTimeISO(timezone)
  const date =
    locale === 'ru'
      ? `${String(zdt.day).padStart(2, '0')}.${String(zdt.month).padStart(2, '0')}.${zdt.year}`
      : `${zdt.year}-${String(zdt.month).padStart(2, '0')}-${String(zdt.day).padStart(2, '0')}`
  const time = `${String(zdt.hour).padStart(2, '0')}:${String(zdt.minute).padStart(2, '0')}`
  return `${date} ${time} (${timezone})`
}

function deliveryModeLabel(locale: BotLocale, mode: AdHocNotificationDeliveryMode): string {
  if (locale === 'ru') {
    switch (mode) {
      case 'topic':
        return 'в этот топик'
      case 'dm_all':
        return 'всем в личку'
      case 'dm_selected':
        return 'выбранным в личку'
    }
  }

  switch (mode) {
    case 'topic':
      return 'this topic'
    case 'dm_all':
      return 'DM all members'
    case 'dm_selected':
      return 'DM selected members'
  }
}

function notificationSummaryText(input: {
  locale: BotLocale
  payload: Extract<NotificationDraftPayload, { stage: 'confirm' }>
  members: readonly HouseholdMemberRecord[]
}): string {
  const assignee = input.payload.assigneeMemberId
    ? input.members.find((member) => member.id === input.payload.assigneeMemberId)
    : null
  const selectedRecipients =
    input.payload.deliveryMode === 'dm_selected'
      ? input.members.filter((member) => input.payload.dmRecipientMemberIds.includes(member.id))
      : []

  if (input.locale === 'ru') {
    return [
      'Запланировать напоминание?',
      '',
      `Текст: ${input.payload.notificationText}`,
      `Когда: ${formatScheduledFor(input.locale, input.payload.scheduledForIso, input.payload.timezone)}`,
      `Точность: ${input.payload.timePrecision === 'date_only_defaulted' ? 'время по умолчанию 12:00' : 'точное время'}`,
      `Куда: ${deliveryModeLabel(input.locale, input.payload.deliveryMode)}`,
      assignee ? `Ответственный: ${assignee.displayName}` : null,
      input.payload.deliveryMode === 'dm_selected' && selectedRecipients.length > 0
        ? `Получатели: ${selectedRecipients.map((member) => member.displayName).join(', ')}`
        : null,
      assignee ? `Дружелюбный тег: ${input.payload.friendlyTagAssignee ? 'вкл' : 'выкл'}` : null,
      '',
      'Подтвердите или измените настройки ниже.'
    ]
      .filter(Boolean)
      .join('\n')
  }

  return [
    'Schedule this notification?',
    '',
    `Text: ${input.payload.notificationText}`,
    `When: ${formatScheduledFor(input.locale, input.payload.scheduledForIso, input.payload.timezone)}`,
    `Precision: ${input.payload.timePrecision === 'date_only_defaulted' ? 'defaulted to 12:00' : 'exact time'}`,
    `Delivery: ${deliveryModeLabel(input.locale, input.payload.deliveryMode)}`,
    assignee ? `Assignee: ${assignee.displayName}` : null,
    input.payload.deliveryMode === 'dm_selected' && selectedRecipients.length > 0
      ? `Recipients: ${selectedRecipients.map((member) => member.displayName).join(', ')}`
      : null,
    assignee ? `Friendly tag: ${input.payload.friendlyTagAssignee ? 'on' : 'off'}` : null,
    '',
    'Confirm or adjust below.'
  ]
    .filter(Boolean)
    .join('\n')
}

function notificationDraftReplyMarkup(
  locale: BotLocale,
  payload: Extract<NotificationDraftPayload, { stage: 'confirm' }>,
  members: readonly HouseholdMemberRecord[]
): InlineKeyboardMarkup {
  const deliveryButtons = [
    {
      text: `${payload.deliveryMode === 'topic' ? '• ' : ''}${locale === 'ru' ? 'В топик' : 'Topic'}`,
      callback_data: `${AD_HOC_NOTIFICATION_MODE_PREFIX}${payload.proposalId}:topic`
    },
    {
      text: `${payload.deliveryMode === 'dm_all' ? '• ' : ''}${locale === 'ru' ? 'Всем ЛС' : 'DM all'}`,
      callback_data: `${AD_HOC_NOTIFICATION_MODE_PREFIX}${payload.proposalId}:dm_all`
    }
  ]

  const rows: InlineKeyboardMarkup['inline_keyboard'] = [
    [
      {
        text: locale === 'ru' ? 'Подтвердить' : 'Confirm',
        callback_data: `${AD_HOC_NOTIFICATION_CONFIRM_PREFIX}${payload.proposalId}`
      },
      {
        text: locale === 'ru' ? 'Отменить' : 'Cancel',
        callback_data: `${AD_HOC_NOTIFICATION_CANCEL_DRAFT_PREFIX}${payload.proposalId}`
      }
    ],
    deliveryButtons,
    [
      {
        text: `${payload.deliveryMode === 'dm_selected' ? '• ' : ''}${locale === 'ru' ? 'Выбрать ЛС' : 'DM selected'}`,
        callback_data: `${AD_HOC_NOTIFICATION_MODE_PREFIX}${payload.proposalId}:dm_selected`
      }
    ]
  ]

  if (payload.assigneeMemberId) {
    rows.push([
      {
        text: `${payload.friendlyTagAssignee ? '✅ ' : ''}${locale === 'ru' ? 'Тегнуть ответственного' : 'Friendly tag assignee'}`,
        callback_data: `${AD_HOC_NOTIFICATION_FRIENDLY_PREFIX}${payload.proposalId}`
      }
    ])
  }

  if (payload.deliveryMode === 'dm_selected') {
    const eligibleMembers = members.filter((member) => member.status === 'active')
    for (const member of eligibleMembers) {
      rows.push([
        {
          text: `${payload.dmRecipientMemberIds.includes(member.id) ? '✅ ' : ''}${member.displayName}`,
          callback_data: `${AD_HOC_NOTIFICATION_MEMBER_PREFIX}${payload.proposalId}:${member.id}`
        }
      ])
    }
  }

  return {
    inline_keyboard: rows
  }
}

function buildSavedNotificationReplyMarkup(
  locale: BotLocale,
  notificationId: string
): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        {
          text: locale === 'ru' ? 'Отменить напоминание' : 'Cancel notification',
          callback_data: `${AD_HOC_NOTIFICATION_CANCEL_SAVED_PREFIX}${notificationId}`
        }
      ]
    ]
  }
}

async function replyInTopic(
  ctx: Context,
  text: string,
  replyMarkup?: InlineKeyboardMarkup,
  options?: {
    parseMode?: 'HTML'
  }
): Promise<void> {
  const message = ctx.msg
  if (!ctx.chat || !message) {
    return
  }

  const threadId =
    'message_thread_id' in message && message.message_thread_id !== undefined
      ? message.message_thread_id
      : undefined

  await ctx.api.sendMessage(ctx.chat.id, text, {
    ...(threadId !== undefined
      ? {
          message_thread_id: threadId
        }
      : {}),
    reply_parameters: {
      message_id: message.message_id
    },
    ...(replyMarkup
      ? {
          reply_markup: replyMarkup as InlineKeyboardMarkup
        }
      : {}),
    ...(options?.parseMode
      ? {
          parse_mode: options.parseMode
        }
      : {})
  })
}

async function resolveReminderTopicContext(
  ctx: Context,
  repository: HouseholdConfigurationRepository
): Promise<ReminderTopicContext | null> {
  if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') {
    return null
  }

  const threadId = getMessageThreadId(ctx)
  if (!ctx.chat || !threadId) {
    return null
  }

  const binding = await repository.findHouseholdTopicByTelegramContext({
    telegramChatId: ctx.chat.id.toString(),
    telegramThreadId: threadId
  })
  if (!binding || binding.role !== 'reminders') {
    return null
  }

  const telegramUserId = ctx.from?.id?.toString()
  if (!telegramUserId) {
    return null
  }

  const [locale, member, members, settings] = await Promise.all([
    resolveReplyLocale({
      ctx,
      repository,
      householdId: binding.householdId
    }),
    repository.getHouseholdMember(binding.householdId, telegramUserId),
    repository.listHouseholdMembers(binding.householdId),
    repository.getHouseholdBillingSettings(binding.householdId)
  ])

  if (!member) {
    return null
  }

  return {
    locale,
    householdId: binding.householdId,
    threadId,
    member,
    members,
    timezone: settings.timezone
  }
}

async function saveDraft(
  repository: TelegramPendingActionRepository,
  ctx: Context,
  payload: NotificationDraftPayload
): Promise<void> {
  const telegramUserId = ctx.from?.id?.toString()
  const chatId = ctx.chat?.id?.toString()
  if (!telegramUserId || !chatId) {
    return
  }

  await repository.upsertPendingAction({
    telegramUserId,
    telegramChatId: chatId,
    action: AD_HOC_NOTIFICATION_ACTION,
    payload,
    expiresAt: nowInstant().add({ milliseconds: AD_HOC_NOTIFICATION_ACTION_TTL_MS })
  })
}

async function loadDraft(
  repository: TelegramPendingActionRepository,
  ctx: Context
): Promise<NotificationDraftPayload | null> {
  const telegramUserId = ctx.from?.id?.toString()
  const chatId = ctx.chat?.id?.toString()
  if (!telegramUserId || !chatId) {
    return null
  }

  const pending = await repository.getPendingAction(chatId, telegramUserId)
  return pending?.action === AD_HOC_NOTIFICATION_ACTION
    ? (pending.payload as NotificationDraftPayload)
    : null
}

export function registerAdHocNotifications(options: {
  bot: Bot
  householdConfigurationRepository: HouseholdConfigurationRepository
  promptRepository: TelegramPendingActionRepository
  notificationService: AdHocNotificationService
  logger?: Logger
}): void {
  async function showDraftConfirmation(
    ctx: Context,
    draft: Extract<NotificationDraftPayload, { stage: 'confirm' }>
  ) {
    const reminderContext = await resolveReminderTopicContext(
      ctx,
      options.householdConfigurationRepository
    )
    if (!reminderContext) {
      return
    }

    await replyInTopic(
      ctx,
      notificationSummaryText({
        locale: reminderContext.locale,
        payload: draft,
        members: reminderContext.members
      }),
      notificationDraftReplyMarkup(reminderContext.locale, draft, reminderContext.members)
    )
  }

  async function refreshConfirmationMessage(
    ctx: Context,
    payload: Extract<NotificationDraftPayload, { stage: 'confirm' }>
  ) {
    const reminderContext = await resolveReminderTopicContext(
      ctx,
      options.householdConfigurationRepository
    )
    if (!reminderContext || !ctx.callbackQuery || !('message' in ctx.callbackQuery)) {
      return
    }

    await saveDraft(options.promptRepository, ctx, payload)
    await ctx.editMessageText(
      notificationSummaryText({
        locale: reminderContext.locale,
        payload,
        members: reminderContext.members
      }),
      {
        reply_markup: notificationDraftReplyMarkup(
          reminderContext.locale,
          payload,
          reminderContext.members
        )
      }
    )
  }

  options.bot.command('notifications', async (ctx, next) => {
    const reminderContext = await resolveReminderTopicContext(
      ctx,
      options.householdConfigurationRepository
    )
    if (!reminderContext) {
      await next()
      return
    }

    const items = await options.notificationService.listUpcomingNotifications({
      householdId: reminderContext.householdId,
      viewerMemberId: reminderContext.member.id
    })
    const locale = reminderContext.locale

    if (items.length === 0) {
      await replyInTopic(
        ctx,
        locale === 'ru'
          ? 'Пока нет будущих напоминаний, которые вы можете отменить.'
          : 'There are no upcoming notifications you can cancel yet.'
      )
      return
    }

    const lines = items.slice(0, 10).map((item, index) => {
      const when = formatScheduledFor(
        locale,
        item.scheduledFor.toString(),
        reminderContext.timezone
      )
      return `${index + 1}. ${item.notificationText}\n${when}\n${deliveryModeLabel(locale, item.deliveryMode)}`
    })

    const keyboard: InlineKeyboardMarkup = {
      inline_keyboard: items.slice(0, 10).map((item, index) => [
        {
          text: locale === 'ru' ? `Отменить ${index + 1}` : `Cancel ${index + 1}`,
          callback_data: `${AD_HOC_NOTIFICATION_CANCEL_SAVED_PREFIX}${item.id}`
        }
      ])
    }

    await replyInTopic(
      ctx,
      [locale === 'ru' ? 'Ближайшие напоминания:' : 'Upcoming notifications:', '', ...lines].join(
        '\n'
      ),
      keyboard
    )
  })

  options.bot.on('message', async (ctx, next) => {
    const messageText = readMessageText(ctx)
    if (!messageText || messageText.startsWith('/')) {
      await next()
      return
    }

    const reminderContext = await resolveReminderTopicContext(
      ctx,
      options.householdConfigurationRepository
    )
    if (!reminderContext) {
      await next()
      return
    }

    const existingDraft = await loadDraft(options.promptRepository, ctx)
    if (existingDraft && existingDraft.threadId === reminderContext.threadId) {
      if (existingDraft.stage === 'await_schedule') {
        const schedule = parseAdHocNotificationSchedule({
          text: messageText,
          timezone: existingDraft.timezone
        })

        if (schedule.kind === 'missing_schedule') {
          await replyInTopic(
            ctx,
            reminderContext.locale === 'ru'
              ? 'Нужны хотя бы день или дата. Например: «завтра», «24.03», «2026-03-24 18:30».'
              : 'I still need at least a day or date. For example: "tomorrow", "2026-03-24", or "2026-03-24 18:30".'
          )
          return
        }

        if (schedule.kind === 'invalid_past') {
          await replyInTopic(
            ctx,
            reminderContext.locale === 'ru'
              ? 'Это время уже в прошлом. Пришлите будущую дату или время.'
              : 'That time is already in the past. Send a future date or time.'
          )
          return
        }

        const confirmPayload: Extract<NotificationDraftPayload, { stage: 'confirm' }> = {
          ...existingDraft,
          stage: 'confirm',
          scheduledForIso: schedule.scheduledFor!.toString(),
          timePrecision: schedule.timePrecision!
        }
        await saveDraft(options.promptRepository, ctx, confirmPayload)
        await showDraftConfirmation(ctx, confirmPayload)
        return
      }

      await next()
      return
    }

    const parsed = parseAdHocNotificationRequest({
      text: messageText,
      timezone: reminderContext.timezone,
      locale: reminderContext.locale,
      members: reminderContext.members,
      senderMemberId: reminderContext.member.id
    })

    if (parsed.kind === 'not_intent') {
      await next()
      return
    }

    if (!parsed.notificationText || parsed.notificationText.length === 0) {
      await replyInTopic(
        ctx,
        reminderContext.locale === 'ru'
          ? 'Не понял текст напоминания. Сформулируйте, что именно нужно напомнить.'
          : 'I could not extract the notification text. Please restate what should be reminded.'
      )
      return
    }

    if (parsed.kind === 'missing_schedule') {
      await saveDraft(options.promptRepository, ctx, {
        stage: 'await_schedule',
        proposalId: createProposalId(),
        householdId: reminderContext.householdId,
        threadId: reminderContext.threadId,
        creatorMemberId: reminderContext.member.id,
        timezone: reminderContext.timezone,
        originalRequestText: parsed.originalRequestText,
        notificationText: parsed.notificationText,
        assigneeMemberId: parsed.assigneeMemberId,
        deliveryMode: 'topic',
        dmRecipientMemberIds: [],
        friendlyTagAssignee: false
      })

      await replyInTopic(
        ctx,
        reminderContext.locale === 'ru'
          ? 'Когда напомнить? Подойдёт свободная форма, например: «завтра», «завтра в 15:00», «24.03 18:30».'
          : 'When should I remind? Free-form is fine, for example: "tomorrow", "tomorrow 15:00", or "2026-03-24 18:30".'
      )
      return
    }

    if (parsed.kind === 'invalid_past') {
      await replyInTopic(
        ctx,
        reminderContext.locale === 'ru'
          ? 'Это время уже в прошлом. Пришлите будущую дату или время.'
          : 'That time is already in the past. Send a future date or time.'
      )
      return
    }

    const draft: Extract<NotificationDraftPayload, { stage: 'confirm' }> = {
      stage: 'confirm',
      proposalId: createProposalId(),
      householdId: reminderContext.householdId,
      threadId: reminderContext.threadId,
      creatorMemberId: reminderContext.member.id,
      timezone: reminderContext.timezone,
      originalRequestText: parsed.originalRequestText,
      notificationText: parsed.notificationText,
      assigneeMemberId: parsed.assigneeMemberId,
      scheduledForIso: parsed.scheduledFor!.toString(),
      timePrecision: parsed.timePrecision!,
      deliveryMode: 'topic',
      dmRecipientMemberIds: [],
      friendlyTagAssignee: false
    }

    await saveDraft(options.promptRepository, ctx, draft)
    await showDraftConfirmation(ctx, draft)
  })

  options.bot.on('callback_query:data', async (ctx, next) => {
    const data = typeof ctx.callbackQuery?.data === 'string' ? ctx.callbackQuery.data : null
    if (!data) {
      await next()
      return
    }

    if (data.startsWith(AD_HOC_NOTIFICATION_CONFIRM_PREFIX)) {
      const proposalId = data.slice(AD_HOC_NOTIFICATION_CONFIRM_PREFIX.length)
      const reminderContext = await resolveReminderTopicContext(
        ctx,
        options.householdConfigurationRepository
      )
      const payload = await loadDraft(options.promptRepository, ctx)
      if (
        !reminderContext ||
        !payload ||
        payload.stage !== 'confirm' ||
        payload.proposalId !== proposalId
      ) {
        await next()
        return
      }

      const result = await options.notificationService.scheduleNotification({
        householdId: payload.householdId,
        creatorMemberId: payload.creatorMemberId,
        originalRequestText: payload.originalRequestText,
        notificationText: payload.notificationText,
        timezone: payload.timezone,
        scheduledFor: Temporal.Instant.from(payload.scheduledForIso),
        timePrecision: payload.timePrecision,
        deliveryMode: payload.deliveryMode,
        assigneeMemberId: payload.assigneeMemberId,
        dmRecipientMemberIds: payload.dmRecipientMemberIds,
        friendlyTagAssignee: payload.friendlyTagAssignee,
        sourceTelegramChatId: ctx.chat?.id?.toString() ?? null,
        sourceTelegramThreadId: payload.threadId
      })

      if (result.status !== 'scheduled') {
        await ctx.answerCallbackQuery({
          text:
            reminderContext.locale === 'ru'
              ? 'Не удалось сохранить напоминание.'
              : 'Failed to save notification.',
          show_alert: true
        })
        return
      }

      await options.promptRepository.clearPendingAction(
        ctx.chat!.id.toString(),
        ctx.from!.id.toString()
      )

      await ctx.answerCallbackQuery({
        text:
          reminderContext.locale === 'ru' ? 'Напоминание запланировано.' : 'Notification scheduled.'
      })
      await ctx.editMessageText(
        [
          reminderContext.locale === 'ru'
            ? `Напоминание запланировано: ${result.notification.notificationText}`
            : `Notification scheduled: ${result.notification.notificationText}`,
          formatScheduledFor(
            reminderContext.locale,
            result.notification.scheduledFor.toString(),
            result.notification.timezone
          )
        ].join('\n'),
        {
          reply_markup: buildSavedNotificationReplyMarkup(
            reminderContext.locale,
            result.notification.id
          )
        }
      )
      return
    }

    if (data.startsWith(AD_HOC_NOTIFICATION_CANCEL_DRAFT_PREFIX)) {
      const proposalId = data.slice(AD_HOC_NOTIFICATION_CANCEL_DRAFT_PREFIX.length)
      const payload = await loadDraft(options.promptRepository, ctx)
      if (!payload || payload.proposalId !== proposalId || !ctx.chat || !ctx.from) {
        await next()
        return
      }

      await options.promptRepository.clearPendingAction(
        ctx.chat.id.toString(),
        ctx.from.id.toString()
      )
      await ctx.answerCallbackQuery({
        text: 'Cancelled'
      })
      await ctx.editMessageText('Cancelled', {
        reply_markup: {
          inline_keyboard: []
        }
      })
      return
    }

    if (data.startsWith(AD_HOC_NOTIFICATION_MODE_PREFIX)) {
      const [proposalId, mode] = data.slice(AD_HOC_NOTIFICATION_MODE_PREFIX.length).split(':')
      const payload = await loadDraft(options.promptRepository, ctx)
      if (
        !payload ||
        payload.stage !== 'confirm' ||
        payload.proposalId !== proposalId ||
        (mode !== 'topic' && mode !== 'dm_all' && mode !== 'dm_selected')
      ) {
        await next()
        return
      }

      const nextPayload: Extract<NotificationDraftPayload, { stage: 'confirm' }> = {
        ...payload,
        deliveryMode: mode,
        dmRecipientMemberIds: mode === 'dm_selected' ? payload.dmRecipientMemberIds : []
      }
      await refreshConfirmationMessage(ctx, nextPayload)
      await ctx.answerCallbackQuery()
      return
    }

    if (data.startsWith(AD_HOC_NOTIFICATION_FRIENDLY_PREFIX)) {
      const proposalId = data.slice(AD_HOC_NOTIFICATION_FRIENDLY_PREFIX.length)
      const payload = await loadDraft(options.promptRepository, ctx)
      if (!payload || payload.stage !== 'confirm' || payload.proposalId !== proposalId) {
        await next()
        return
      }

      await refreshConfirmationMessage(ctx, {
        ...payload,
        friendlyTagAssignee: !payload.friendlyTagAssignee
      })
      await ctx.answerCallbackQuery()
      return
    }

    if (data.startsWith(AD_HOC_NOTIFICATION_MEMBER_PREFIX)) {
      const rest = data.slice(AD_HOC_NOTIFICATION_MEMBER_PREFIX.length)
      const separatorIndex = rest.indexOf(':')
      const proposalId = separatorIndex >= 0 ? rest.slice(0, separatorIndex) : ''
      const memberId = separatorIndex >= 0 ? rest.slice(separatorIndex + 1) : ''
      const payload = await loadDraft(options.promptRepository, ctx)
      if (
        !payload ||
        payload.stage !== 'confirm' ||
        payload.proposalId !== proposalId ||
        payload.deliveryMode !== 'dm_selected'
      ) {
        await next()
        return
      }

      const selected = new Set(payload.dmRecipientMemberIds)
      if (selected.has(memberId)) {
        selected.delete(memberId)
      } else {
        selected.add(memberId)
      }

      await refreshConfirmationMessage(ctx, {
        ...payload,
        dmRecipientMemberIds: [...selected]
      })
      await ctx.answerCallbackQuery()
      return
    }

    if (data.startsWith(AD_HOC_NOTIFICATION_CANCEL_SAVED_PREFIX)) {
      const notificationId = data.slice(AD_HOC_NOTIFICATION_CANCEL_SAVED_PREFIX.length)
      const reminderContext = await resolveReminderTopicContext(
        ctx,
        options.householdConfigurationRepository
      )
      if (!reminderContext) {
        await next()
        return
      }

      const result = await options.notificationService.cancelNotification({
        notificationId,
        viewerMemberId: reminderContext.member.id
      })

      if (result.status !== 'cancelled') {
        await ctx.answerCallbackQuery({
          text:
            reminderContext.locale === 'ru'
              ? 'Не удалось отменить напоминание.'
              : 'Could not cancel this notification.',
          show_alert: true
        })
        return
      }

      await ctx.answerCallbackQuery({
        text: reminderContext.locale === 'ru' ? 'Напоминание отменено.' : 'Notification cancelled.'
      })
      await ctx.editMessageText(
        reminderContext.locale === 'ru'
          ? `Напоминание отменено: ${result.notification.notificationText}`
          : `Notification cancelled: ${result.notification.notificationText}`,
        {
          reply_markup: {
            inline_keyboard: []
          }
        }
      )
      return
    }

    await next()
  })
}

export function buildTopicNotificationText(input: {
  notificationText: string
  assignee?: {
    displayName: string
    telegramUserId: string
  } | null
  friendlyTagAssignee: boolean
}): {
  text: string
  parseMode: 'HTML'
} {
  if (input.friendlyTagAssignee && input.assignee) {
    return {
      text: `<a href="tg://user?id=${escapeHtml(input.assignee.telegramUserId)}">${escapeHtml(input.assignee.displayName)}</a>, ${escapeHtml(input.notificationText)}`,
      parseMode: 'HTML'
    }
  }

  return {
    text: escapeHtml(input.notificationText),
    parseMode: 'HTML'
  }
}
