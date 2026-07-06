import type { AdHocNotificationService } from '@household/application'
import { Temporal, nowInstant } from '@household/domain'
import type { Logger } from '@household/observability'
import type {
  AdHocNotificationDeliveryMode,
  HouseholdAssistantConfigRecord,
  HouseholdConfigurationRepository,
  HouseholdMemberRecord,
  TelegramPendingActionRepository
} from '@household/ports'
import type { Bot, Context } from 'grammy'
import type { InlineKeyboardMarkup } from 'grammy/types'

import { parseAdHocNotificationSchedule } from './ad-hoc-notification-parser'
import { resolveReplyLocale } from './bot-locale'
import type { BotLocale } from './i18n'

const AD_HOC_NOTIFICATION_ACTION = 'ad_hoc_notification' as const
const AD_HOC_NOTIFICATION_ACTION_TTL_MS = 30 * 60_000
const AD_HOC_NOTIFICATION_CONFIRM_PREFIX = 'adhocnotif:confirm:'
const AD_HOC_NOTIFICATION_CANCEL_DRAFT_PREFIX = 'adhocnotif:canceldraft:'
const AD_HOC_NOTIFICATION_CANCEL_SAVED_PREFIX = 'adhocnotif:cancel:'
const AD_HOC_NOTIFICATION_MODE_PREFIX = 'adhocnotif:mode:'
const AD_HOC_NOTIFICATION_MEMBER_PREFIX = 'adhocnotif:member:'
const AD_HOC_NOTIFICATION_VIEW_PREFIX = 'adhocnotif:view:'

type NotificationDraftPayload =
  | {
      stage: 'await_schedule'
      proposalId: string
      householdId: string
      threadId: string
      creatorMemberId: string
      timezone: string
      originalRequestText: string
      normalizedNotificationText: string
      assigneeMemberId: string | null
      deliveryMode: AdHocNotificationDeliveryMode
      dmRecipientMemberIds: readonly string[]
    }
  | {
      stage: 'confirm'
      proposalId: string
      confirmationMessageId: number | null
      householdId: string
      threadId: string
      creatorMemberId: string
      timezone: string
      originalRequestText: string
      normalizedNotificationText: string
      renderedNotificationText: string
      assigneeMemberId: string | null
      scheduledForIso: string
      timePrecision: 'exact' | 'date_only_defaulted'
      deliveryMode: AdHocNotificationDeliveryMode
      dmRecipientMemberIds: readonly string[]
      viewMode: 'compact' | 'expanded'
    }

interface ReminderTopicContext {
  locale: BotLocale
  householdId: string
  threadId: string
  member: HouseholdMemberRecord
  members: readonly HouseholdMemberRecord[]
  timezone: string
  assistantContext: string | null
  assistantTone: string | null
}

function cancelledDraftReply(locale: BotLocale): string {
  return locale === 'ru' ? 'Окей, тогда не напоминаю.' : 'Okay, I will drop this reminder.'
}

function cancelledSavedReply(locale: BotLocale): string {
  return locale === 'ru' ? 'Окей, это напоминание убираю.' : 'Okay, I will drop this reminder.'
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

function formatTimeOfDay(locale: BotLocale, hour: number, minute: number): string {
  const exact = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  if (locale !== 'ru' || minute !== 0) {
    return locale === 'ru' ? `в ${exact}` : `at ${exact}`
  }

  if (hour >= 5 && hour <= 11) {
    return `в ${hour} утра`
  }
  if (hour >= 12 && hour <= 16) {
    return hour === 12 ? 'в 12 дня' : `в ${hour} дня`
  }
  if (hour >= 17 && hour <= 23) {
    return hour === 18 ? 'в 6 вечера' : `в ${hour > 12 ? hour - 12 : hour} вечера`
  }

  return `в ${hour} ночи`
}

function relativeDayLabel(input: {
  locale: BotLocale
  now: Temporal.ZonedDateTime
  target: Temporal.ZonedDateTime
}): string | null {
  const targetDate = input.target.toPlainDate()
  const nowDate = input.now.toPlainDate()
  const tomorrow = nowDate.add({ days: 1 })
  const dayAfterTomorrow = nowDate.add({ days: 2 })

  if (input.now.hour <= 4 && targetDate.equals(nowDate) && input.target.hour <= 12) {
    return input.locale === 'ru' ? 'завтра' : 'tomorrow'
  }
  if (targetDate.equals(nowDate)) {
    return input.locale === 'ru' ? 'сегодня' : 'today'
  }
  if (targetDate.equals(tomorrow)) {
    return input.locale === 'ru' ? 'завтра' : 'tomorrow'
  }
  if (targetDate.equals(dayAfterTomorrow)) {
    return input.locale === 'ru' ? 'послезавтра' : 'the day after tomorrow'
  }

  return null
}

export function formatReminderWhen(input: {
  locale: BotLocale
  scheduledForIso: string
  timezone: string
  now?: Temporal.Instant
}): string {
  const now = (input.now ?? nowInstant()).toZonedDateTimeISO(input.timezone)
  const target = Temporal.Instant.from(input.scheduledForIso).toZonedDateTimeISO(input.timezone)
  const relativeDay = relativeDayLabel({
    locale: input.locale,
    now,
    target
  })
  const timeText = formatTimeOfDay(input.locale, target.hour, target.minute)

  if (relativeDay) {
    return input.locale === 'ru' ? `${relativeDay} ${timeText}` : `${relativeDay} ${timeText}`
  }

  return input.locale === 'ru'
    ? `${formatScheduledFor(input.locale, input.scheduledForIso, input.timezone)}`
    : formatScheduledFor(input.locale, input.scheduledForIso, input.timezone)
}

function listedNotificationLine(input: {
  locale: BotLocale
  timezone: string
  item: Awaited<ReturnType<AdHocNotificationService['listUpcomingNotifications']>>[number]
}): string {
  const when = formatReminderWhen({
    locale: input.locale,
    scheduledForIso: input.item.scheduledFor.toString(),
    timezone: input.timezone
  })
  const details: string[] = []

  if (input.item.assigneeDisplayName) {
    details.push(
      input.locale === 'ru'
        ? `для ${input.item.assigneeDisplayName}`
        : `for ${input.item.assigneeDisplayName}`
    )
  }

  if (input.item.deliveryMode !== 'topic') {
    if (input.item.deliveryMode === 'dm_all') {
      details.push(input.locale === 'ru' ? 'всем в личку' : 'DM to everyone')
    } else {
      const names = input.item.dmRecipientDisplayNames.join(', ')
      details.push(
        input.locale === 'ru'
          ? names.length > 0
            ? `в личку: ${names}`
            : 'в выбранные лички'
          : names.length > 0
            ? `DM: ${names}`
            : 'DM selected members'
      )
    }
  }

  if (input.item.creatorDisplayName !== input.item.assigneeDisplayName) {
    details.push(
      input.locale === 'ru'
        ? `создал ${input.item.creatorDisplayName}`
        : `created by ${input.item.creatorDisplayName}`
    )
  }

  const suffix = details.length > 0 ? `\n${details.join(' · ')}` : ''
  return `${when}\n${input.item.notificationText}${suffix}`
}

function notificationSummaryText(input: {
  locale: BotLocale
  payload: Extract<NotificationDraftPayload, { stage: 'confirm' }>
  members: readonly HouseholdMemberRecord[]
}): string {
  if (input.locale === 'ru') {
    const base = `Окей, ${formatReminderWhen({
      locale: input.locale,
      scheduledForIso: input.payload.scheduledForIso,
      timezone: input.payload.timezone
    })} напомню.`
    if (input.payload.deliveryMode === 'topic') {
      return base
    }
    if (input.payload.deliveryMode === 'dm_all') {
      return `${base.slice(0, -1)} И всем в личку отправлю.`
    }

    const selectedRecipients = input.members.filter((member) =>
      input.payload.dmRecipientMemberIds.includes(member.id)
    )
    const suffix =
      selectedRecipients.length > 0
        ? ` И выбранным в личку отправлю: ${selectedRecipients.map((member) => member.displayName).join(', ')}.`
        : ' И выбранным в личку отправлю.'
    return `${base.slice(0, -1)}${suffix}`
  }

  const base = `Okay, I’ll remind ${formatReminderWhen({
    locale: input.locale,
    scheduledForIso: input.payload.scheduledForIso,
    timezone: input.payload.timezone
  })}.`
  if (input.payload.deliveryMode === 'topic') {
    return base
  }
  if (input.payload.deliveryMode === 'dm_all') {
    return `${base.slice(0, -1)} and DM everyone too.`
  }

  const selectedRecipients = input.members.filter((member) =>
    input.payload.dmRecipientMemberIds.includes(member.id)
  )
  const suffix =
    selectedRecipients.length > 0
      ? ` and DM the selected people too: ${selectedRecipients.map((member) => member.displayName).join(', ')}.`
      : ' and DM the selected people too.'
  return `${base.slice(0, -1)}${suffix}`
}

function notificationDraftReplyMarkup(
  locale: BotLocale,
  payload: Extract<NotificationDraftPayload, { stage: 'confirm' }>,
  members: readonly HouseholdMemberRecord[]
): InlineKeyboardMarkup {
  if (payload.viewMode === 'compact') {
    return {
      inline_keyboard: [
        [
          {
            text: locale === 'ru' ? 'Подтвердить' : 'Confirm',
            callback_data: `${AD_HOC_NOTIFICATION_CONFIRM_PREFIX}${payload.proposalId}`
          },
          {
            text: locale === 'ru' ? 'Отменить' : 'Cancel',
            callback_data: `${AD_HOC_NOTIFICATION_CANCEL_DRAFT_PREFIX}${payload.proposalId}`
          },
          {
            text: locale === 'ru' ? 'Еще' : 'More',
            callback_data: `${AD_HOC_NOTIFICATION_VIEW_PREFIX}${payload.proposalId}:expanded`
          }
        ]
      ]
    }
  }

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
      },
      {
        text: locale === 'ru' ? 'Скрыть' : 'Less',
        callback_data: `${AD_HOC_NOTIFICATION_VIEW_PREFIX}${payload.proposalId}:compact`
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
): Promise<number | null> {
  const message = ctx.msg
  if (!ctx.chat || !message) {
    return null
  }

  const threadId =
    'message_thread_id' in message && message.message_thread_id !== undefined
      ? message.message_thread_id
      : undefined

  const sentMessage = await ctx.api.sendMessage(ctx.chat.id, text, {
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

  return sentMessage.message_id
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

  const [locale, member, members, settings, assistantConfig] = await Promise.all([
    resolveReplyLocale({
      ctx,
      repository,
      householdId: binding.householdId
    }),
    repository.getHouseholdMember(binding.householdId, telegramUserId),
    repository.listHouseholdMembers(binding.householdId),
    repository.getHouseholdBillingSettings(binding.householdId),
    repository.getHouseholdAssistantConfig
      ? repository.getHouseholdAssistantConfig(binding.householdId)
      : Promise.resolve<HouseholdAssistantConfigRecord>({
          householdId: binding.householdId,
          assistantContext: null,
          assistantTone: null
        })
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
    timezone: settings.timezone,
    assistantContext: assistantConfig.assistantContext,
    assistantTone: assistantConfig.assistantTone
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

  const pending = await repository.getPendingAction(
    chatId,
    telegramUserId,
    AD_HOC_NOTIFICATION_ACTION
  )
  return pending?.action === AD_HOC_NOTIFICATION_ACTION
    ? (pending.payload as NotificationDraftPayload)
    : null
}

async function showDraftConfirmationCard(
  deps: {
    householdConfigurationRepository: HouseholdConfigurationRepository
    promptRepository: TelegramPendingActionRepository
  },
  ctx: Context,
  draft: Extract<NotificationDraftPayload, { stage: 'confirm' }>,
  previousConfirmationMessageId?: number | null
): Promise<void> {
  const reminderContext = await resolveReminderTopicContext(
    ctx,
    deps.householdConfigurationRepository
  )
  if (!reminderContext) {
    return
  }

  const confirmationMessageId = await replyInTopic(
    ctx,
    notificationSummaryText({
      locale: reminderContext.locale,
      payload: draft,
      members: reminderContext.members
    }),
    notificationDraftReplyMarkup(reminderContext.locale, draft, reminderContext.members)
  )

  if (
    previousConfirmationMessageId &&
    ctx.chat &&
    previousConfirmationMessageId !== confirmationMessageId
  ) {
    await ctx.api.editMessageReplyMarkup(ctx.chat.id, previousConfirmationMessageId, {
      reply_markup: {
        inline_keyboard: []
      }
    })
  }

  await saveDraft(deps.promptRepository, ctx, {
    ...draft,
    confirmationMessageId
  })
}

export type NotificationDraftPublishStatus =
  | 'card_posted'
  | 'missing_schedule'
  | 'invalid_past'
  | 'not_in_reminders_topic'
  | 'unknown_assignee'

export interface NotificationDraftPublisher {
  publish(input: {
    ctx: Context
    text: string
    localDate: string
    hour: number | null
    minute: number | null
    assigneeMemberId: string | null
  }): Promise<{ status: NotificationDraftPublishStatus }>
}

export function createNotificationDraftPublisher(deps: {
  householdConfigurationRepository: HouseholdConfigurationRepository
  promptRepository: TelegramPendingActionRepository
}): NotificationDraftPublisher {
  return {
    async publish(input) {
      const reminderContext = await resolveReminderTopicContext(
        input.ctx,
        deps.householdConfigurationRepository
      )
      if (!reminderContext) {
        return { status: 'not_in_reminders_topic' }
      }

      if (
        input.assigneeMemberId &&
        !reminderContext.members.some((member) => member.id === input.assigneeMemberId)
      ) {
        return { status: 'unknown_assignee' }
      }

      const schedule = parseAdHocNotificationSchedule({
        timezone: reminderContext.timezone,
        resolvedLocalDate: input.localDate,
        resolvedHour: input.hour,
        resolvedMinute: input.hour !== null ? (input.minute ?? 0) : null,
        relativeOffsetMinutes: null,
        dateReferenceMode: 'calendar',
        resolutionMode: input.hour !== null ? 'exact' : 'date_only'
      })

      if (schedule.kind === 'missing_schedule') {
        return { status: 'missing_schedule' }
      }
      if (schedule.kind === 'invalid_past') {
        return { status: 'invalid_past' }
      }

      const existingDraft = await loadDraft(deps.promptRepository, input.ctx)
      const previousConfirmationMessageId =
        existingDraft?.stage === 'confirm' ? existingDraft.confirmationMessageId : null

      // Re-proposing over an existing draft is an edit: keep the fields that are
      // only set through the card buttons (delivery mode, DM recipients) and the
      // assignee unless the new request names one.
      const draft: Extract<NotificationDraftPayload, { stage: 'confirm' }> = {
        stage: 'confirm',
        proposalId: createProposalId(),
        confirmationMessageId: null,
        householdId: reminderContext.householdId,
        threadId: reminderContext.threadId,
        creatorMemberId: reminderContext.member.id,
        timezone: reminderContext.timezone,
        originalRequestText: input.text,
        normalizedNotificationText: input.text,
        renderedNotificationText: input.text,
        assigneeMemberId: input.assigneeMemberId ?? existingDraft?.assigneeMemberId ?? null,
        scheduledForIso: schedule.scheduledFor!.toString(),
        timePrecision: schedule.timePrecision!,
        deliveryMode: existingDraft?.deliveryMode ?? 'topic',
        dmRecipientMemberIds: existingDraft?.dmRecipientMemberIds ?? [],
        viewMode: 'compact'
      }

      await showDraftConfirmationCard(deps, input.ctx, draft, previousConfirmationMessageId)
      return { status: 'card_posted' }
    }
  }
}

export function registerAdHocNotifications(options: {
  bot: Bot
  householdConfigurationRepository: HouseholdConfigurationRepository
  promptRepository: TelegramPendingActionRepository
  notificationService: AdHocNotificationService
  logger?: Logger
}): void {
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
          ? 'Пока будущих напоминаний нет.'
          : 'There are no upcoming notifications yet.'
      )
      return
    }

    const listedItems = items.slice(0, 10).map((item, index) => ({
      item,
      index
    }))
    const lines = listedItems.map(
      ({ item, index }) =>
        `${index + 1}. ${listedNotificationLine({
          locale,
          timezone: reminderContext.timezone,
          item
        })}`
    )

    const keyboard: InlineKeyboardMarkup = {
      inline_keyboard: listedItems
        .filter(({ item }) => item.canCancel)
        .map(({ item, index }) => [
          {
            text: locale === 'ru' ? `Отменить ${index + 1}` : `Cancel ${index + 1}`,
            callback_data: `${AD_HOC_NOTIFICATION_CANCEL_SAVED_PREFIX}${item.id}`
          }
        ])
    }

    await replyInTopic(
      ctx,
      [locale === 'ru' ? 'Ближайшие напоминания:' : 'Upcoming notifications:', '', ...lines].join(
        '\n\n'
      ),
      keyboard.inline_keyboard.length > 0 ? keyboard : undefined
    )
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
        notificationText: payload.renderedNotificationText,
        timezone: payload.timezone,
        scheduledFor: Temporal.Instant.from(payload.scheduledForIso),
        timePrecision: payload.timePrecision,
        deliveryMode: payload.deliveryMode,
        assigneeMemberId: payload.assigneeMemberId,
        dmRecipientMemberIds: payload.dmRecipientMemberIds,
        friendlyTagAssignee: false,
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
        ctx.from!.id.toString(),
        AD_HOC_NOTIFICATION_ACTION
      )

      await ctx.answerCallbackQuery({
        text:
          reminderContext.locale === 'ru' ? 'Напоминание запланировано.' : 'Notification scheduled.'
      })
      await ctx.editMessageText(
        notificationSummaryText({
          locale: reminderContext.locale,
          payload,
          members: reminderContext.members
        }),
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
      const reminderContext = await resolveReminderTopicContext(
        ctx,
        options.householdConfigurationRepository
      )
      const payload = await loadDraft(options.promptRepository, ctx)
      if (
        !payload ||
        payload.stage !== 'confirm' ||
        payload.proposalId !== proposalId ||
        !ctx.chat ||
        !ctx.from ||
        !reminderContext
      ) {
        await next()
        return
      }

      await options.promptRepository.clearPendingAction(
        ctx.chat.id.toString(),
        ctx.from.id.toString(),
        AD_HOC_NOTIFICATION_ACTION
      )
      await ctx.answerCallbackQuery({
        text: cancelledDraftReply(reminderContext.locale)
      })
      await ctx.editMessageText(cancelledDraftReply(reminderContext.locale), {
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
        dmRecipientMemberIds: mode === 'dm_selected' ? payload.dmRecipientMemberIds : [],
        viewMode: 'expanded'
      }
      await refreshConfirmationMessage(ctx, nextPayload)
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
        dmRecipientMemberIds: [...selected],
        viewMode: 'expanded'
      })
      await ctx.answerCallbackQuery()
      return
    }

    if (data.startsWith(AD_HOC_NOTIFICATION_VIEW_PREFIX)) {
      const [proposalId, viewMode] = data.slice(AD_HOC_NOTIFICATION_VIEW_PREFIX.length).split(':')
      const payload = await loadDraft(options.promptRepository, ctx)
      if (
        !payload ||
        payload.stage !== 'confirm' ||
        payload.proposalId !== proposalId ||
        (viewMode !== 'compact' && viewMode !== 'expanded')
      ) {
        await next()
        return
      }

      await refreshConfirmationMessage(ctx, {
        ...payload,
        viewMode
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
        text: cancelledSavedReply(reminderContext.locale)
      })
      await ctx.editMessageText(cancelledSavedReply(reminderContext.locale), {
        reply_markup: {
          inline_keyboard: []
        }
      })
      return
    }

    await next()
  })
}

export function buildTopicNotificationText(input: { notificationText: string }): {
  text: string
  parseMode: 'HTML'
} {
  return {
    text: escapeHtml(input.notificationText),
    parseMode: 'HTML'
  }
}
