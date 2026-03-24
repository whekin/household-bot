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
import type {
  AdHocNotificationInterpreter,
  AdHocNotificationInterpreterMember
} from './openai-ad-hoc-notification-interpreter'

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

function unavailableReply(locale: BotLocale): string {
  return locale === 'ru'
    ? 'Сейчас не могу создать напоминание: модуль ИИ временно недоступен.'
    : 'I cannot create reminders right now because the AI module is temporarily unavailable.'
}

function cancelledDraftReply(locale: BotLocale): string {
  return locale === 'ru' ? 'Окей, тогда не напоминаю.' : 'Okay, I will drop this reminder.'
}

function cancelledSavedReply(locale: BotLocale): string {
  return locale === 'ru' ? 'Окей, это напоминание убираю.' : 'Okay, I will drop this reminder.'
}

function localNowText(timezone: string, now = nowInstant()): string {
  const local = now.toZonedDateTimeISO(timezone)
  return [
    local.toPlainDate().toString(),
    `${String(local.hour).padStart(2, '0')}:${String(local.minute).padStart(2, '0')}`
  ].join(' ')
}

function interpreterMembers(
  members: readonly HouseholdMemberRecord[]
): readonly AdHocNotificationInterpreterMember[] {
  return members.map((member) => ({
    memberId: member.id,
    displayName: member.displayName,
    status: member.status
  }))
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

  const pending = await repository.getPendingAction(chatId, telegramUserId)
  return pending?.action === AD_HOC_NOTIFICATION_ACTION
    ? (pending.payload as NotificationDraftPayload)
    : null
}

function draftLocalSchedule(payload: Extract<NotificationDraftPayload, { stage: 'confirm' }>): {
  date: string
  hour: number
  minute: number
} {
  const zdt = Temporal.Instant.from(payload.scheduledForIso).toZonedDateTimeISO(payload.timezone)
  return {
    date: zdt.toPlainDate().toString(),
    hour: zdt.hour,
    minute: zdt.minute
  }
}

export function registerAdHocNotifications(options: {
  bot: Bot
  householdConfigurationRepository: HouseholdConfigurationRepository
  promptRepository: TelegramPendingActionRepository
  notificationService: AdHocNotificationService
  reminderInterpreter: AdHocNotificationInterpreter | undefined
  logger?: Logger
}): void {
  async function renderNotificationText(input: {
    reminderContext: ReminderTopicContext
    originalRequestText: string
    normalizedNotificationText: string
    assigneeMemberId: string | null
  }): Promise<string | null> {
    const assignee = input.assigneeMemberId
      ? input.reminderContext.members.find((member) => member.id === input.assigneeMemberId)
      : null

    return (
      options.reminderInterpreter?.renderDeliveryText({
        locale: input.reminderContext.locale,
        originalRequestText: input.originalRequestText,
        notificationText: input.normalizedNotificationText,
        requesterDisplayName: input.reminderContext.member.displayName,
        assigneeDisplayName: assignee?.displayName ?? null,
        assistantContext: input.reminderContext.assistantContext,
        assistantTone: input.reminderContext.assistantTone
      }) ?? null
    )
  }

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
        if (!options.reminderInterpreter) {
          await replyInTopic(ctx, unavailableReply(reminderContext.locale))
          return
        }

        const interpretedSchedule = await options.reminderInterpreter.interpretSchedule({
          locale: reminderContext.locale,
          timezone: existingDraft.timezone,
          localNow: localNowText(existingDraft.timezone),
          text: messageText
        })

        if (!interpretedSchedule) {
          await replyInTopic(ctx, unavailableReply(reminderContext.locale))
          return
        }

        if (interpretedSchedule.decision === 'clarification') {
          await replyInTopic(
            ctx,
            interpretedSchedule.clarificationQuestion ??
              (reminderContext.locale === 'ru'
                ? 'Когда напомнить? Напишите день, дату или время.'
                : 'When should I remind? Please send a day, date, or time.')
          )
          return
        }

        const schedule = parseAdHocNotificationSchedule({
          timezone: existingDraft.timezone,
          resolvedLocalDate: interpretedSchedule.resolvedLocalDate,
          resolvedHour: interpretedSchedule.resolvedHour,
          resolvedMinute: interpretedSchedule.resolvedMinute,
          resolutionMode: interpretedSchedule.resolutionMode
        })

        if (schedule.kind === 'missing_schedule') {
          await replyInTopic(
            ctx,
            reminderContext.locale === 'ru'
              ? 'Нужны дата или понятное время. Например: «завтра утром», «24.03», «2026-03-24 18:30».'
              : 'I still need a date or a clear time. For example: "tomorrow morning", "2026-03-24", or "2026-03-24 18:30".'
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

        const renderedNotificationText = await renderNotificationText({
          reminderContext,
          originalRequestText: existingDraft.originalRequestText,
          normalizedNotificationText: existingDraft.normalizedNotificationText,
          assigneeMemberId: existingDraft.assigneeMemberId
        })
        if (!renderedNotificationText) {
          await replyInTopic(ctx, unavailableReply(reminderContext.locale))
          return
        }

        const confirmPayload: Extract<NotificationDraftPayload, { stage: 'confirm' }> = {
          ...existingDraft,
          stage: 'confirm',
          renderedNotificationText,
          scheduledForIso: schedule.scheduledFor!.toString(),
          timePrecision: schedule.timePrecision!,
          viewMode: 'compact'
        }
        await saveDraft(options.promptRepository, ctx, confirmPayload)
        await showDraftConfirmation(ctx, confirmPayload)
        return
      }

      if (!options.reminderInterpreter) {
        await replyInTopic(ctx, unavailableReply(reminderContext.locale))
        return
      }

      const currentSchedule = draftLocalSchedule(existingDraft)
      const interpretedEdit = await options.reminderInterpreter.interpretDraftEdit({
        locale: reminderContext.locale,
        timezone: existingDraft.timezone,
        localNow: localNowText(existingDraft.timezone),
        text: messageText,
        members: interpreterMembers(reminderContext.members),
        senderMemberId: reminderContext.member.id,
        currentNotificationText: existingDraft.normalizedNotificationText,
        currentAssigneeMemberId: existingDraft.assigneeMemberId,
        currentScheduledLocalDate: currentSchedule.date,
        currentScheduledHour: currentSchedule.hour,
        currentScheduledMinute: currentSchedule.minute,
        currentDeliveryMode: existingDraft.deliveryMode,
        currentDmRecipientMemberIds: existingDraft.dmRecipientMemberIds,
        assistantContext: reminderContext.assistantContext,
        assistantTone: reminderContext.assistantTone
      })

      if (!interpretedEdit) {
        await replyInTopic(ctx, unavailableReply(reminderContext.locale))
        return
      }

      if (interpretedEdit.decision === 'clarification') {
        await replyInTopic(
          ctx,
          interpretedEdit.clarificationQuestion ??
            (reminderContext.locale === 'ru'
              ? 'Что именно поправить в напоминании?'
              : 'What should I adjust in the reminder?')
        )
        return
      }

      if (interpretedEdit.decision === 'cancel') {
        await options.promptRepository.clearPendingAction(
          ctx.chat!.id.toString(),
          ctx.from!.id.toString()
        )
        await replyInTopic(ctx, cancelledDraftReply(reminderContext.locale))
        return
      }

      const scheduleChanged =
        interpretedEdit.resolvedLocalDate !== null ||
        interpretedEdit.resolvedHour !== null ||
        interpretedEdit.resolvedMinute !== null ||
        interpretedEdit.resolutionMode !== null

      let nextSchedule = {
        scheduledForIso: existingDraft.scheduledForIso,
        timePrecision: existingDraft.timePrecision
      }

      if (scheduleChanged) {
        const parsedSchedule = parseAdHocNotificationSchedule({
          timezone: existingDraft.timezone,
          resolvedLocalDate: interpretedEdit.resolvedLocalDate ?? currentSchedule.date,
          resolvedHour: interpretedEdit.resolvedHour ?? currentSchedule.hour,
          resolvedMinute: interpretedEdit.resolvedMinute ?? currentSchedule.minute,
          resolutionMode: interpretedEdit.resolutionMode ?? 'exact'
        })

        if (parsedSchedule.kind === 'missing_schedule') {
          await replyInTopic(
            ctx,
            reminderContext.locale === 'ru'
              ? 'Нужны понятные дата или время, чтобы обновить напоминание.'
              : 'I need a clear date or time to update the reminder.'
          )
          return
        }

        if (parsedSchedule.kind === 'invalid_past') {
          await replyInTopic(
            ctx,
            reminderContext.locale === 'ru'
              ? 'Это время уже в прошлом. Пришлите будущую дату или время.'
              : 'That time is already in the past. Send a future date or time.'
          )
          return
        }

        nextSchedule = {
          scheduledForIso: parsedSchedule.scheduledFor!.toString(),
          timePrecision: parsedSchedule.timePrecision!
        }
      }

      const nextNormalizedNotificationText =
        interpretedEdit.notificationText ?? existingDraft.normalizedNotificationText
      const nextOriginalRequestText =
        interpretedEdit.notificationText !== null ? messageText : existingDraft.originalRequestText
      const nextAssigneeMemberId = interpretedEdit.assigneeChanged
        ? interpretedEdit.assigneeMemberId
        : existingDraft.assigneeMemberId
      const nextDeliveryMode = interpretedEdit.deliveryMode ?? existingDraft.deliveryMode
      const nextDmRecipientMemberIds =
        interpretedEdit.dmRecipientMemberIds ??
        (nextDeliveryMode === existingDraft.deliveryMode ? existingDraft.dmRecipientMemberIds : [])

      const renderedNotificationText = await renderNotificationText({
        reminderContext,
        originalRequestText: nextOriginalRequestText,
        normalizedNotificationText: nextNormalizedNotificationText,
        assigneeMemberId: nextAssigneeMemberId
      })
      if (!renderedNotificationText) {
        await replyInTopic(ctx, unavailableReply(reminderContext.locale))
        return
      }

      const nextPayload: Extract<NotificationDraftPayload, { stage: 'confirm' }> = {
        ...existingDraft,
        originalRequestText: nextOriginalRequestText,
        normalizedNotificationText: nextNormalizedNotificationText,
        renderedNotificationText,
        assigneeMemberId: nextAssigneeMemberId,
        scheduledForIso: nextSchedule.scheduledForIso,
        timePrecision: nextSchedule.timePrecision,
        deliveryMode: nextDeliveryMode,
        dmRecipientMemberIds: nextDmRecipientMemberIds,
        viewMode: 'compact'
      }

      await saveDraft(options.promptRepository, ctx, nextPayload)
      await showDraftConfirmation(ctx, nextPayload)
      return
    }

    if (!options.reminderInterpreter) {
      await replyInTopic(ctx, unavailableReply(reminderContext.locale))
      return
    }

    const interpretedRequest = await options.reminderInterpreter.interpretRequest({
      text: messageText,
      timezone: reminderContext.timezone,
      locale: reminderContext.locale,
      localNow: localNowText(reminderContext.timezone),
      members: interpreterMembers(reminderContext.members),
      senderMemberId: reminderContext.member.id,
      assistantContext: reminderContext.assistantContext,
      assistantTone: reminderContext.assistantTone
    })

    if (!interpretedRequest) {
      await replyInTopic(ctx, unavailableReply(reminderContext.locale))
      return
    }

    if (interpretedRequest.decision === 'not_notification') {
      await next()
      return
    }

    if (!interpretedRequest.notificationText || interpretedRequest.notificationText.length === 0) {
      await replyInTopic(
        ctx,
        reminderContext.locale === 'ru'
          ? 'Не понял текст напоминания. Сформулируйте, что именно нужно напомнить.'
          : 'I could not extract the notification text. Please restate what should be reminded.'
      )
      return
    }

    if (interpretedRequest.decision === 'clarification') {
      if (interpretedRequest.notificationText) {
        await saveDraft(options.promptRepository, ctx, {
          stage: 'await_schedule',
          proposalId: createProposalId(),
          householdId: reminderContext.householdId,
          threadId: reminderContext.threadId,
          creatorMemberId: reminderContext.member.id,
          timezone: reminderContext.timezone,
          originalRequestText: messageText,
          normalizedNotificationText: interpretedRequest.notificationText,
          assigneeMemberId: interpretedRequest.assigneeMemberId,
          deliveryMode: 'topic',
          dmRecipientMemberIds: []
        })
      }

      await replyInTopic(
        ctx,
        interpretedRequest.clarificationQuestion ??
          (reminderContext.locale === 'ru'
            ? 'Когда напомнить? Подойдёт свободная форма, например: «завтра утром», «завтра в 15:00», «24.03 18:30».'
            : 'When should I remind? Free-form is fine, for example: "tomorrow morning", "tomorrow 15:00", or "2026-03-24 18:30".')
      )
      return
    }

    const parsedSchedule = parseAdHocNotificationSchedule({
      timezone: reminderContext.timezone,
      resolvedLocalDate: interpretedRequest.resolvedLocalDate,
      resolvedHour: interpretedRequest.resolvedHour,
      resolvedMinute: interpretedRequest.resolvedMinute,
      resolutionMode: interpretedRequest.resolutionMode
    })

    if (parsedSchedule.kind === 'invalid_past') {
      await replyInTopic(
        ctx,
        reminderContext.locale === 'ru'
          ? 'Это время уже в прошлом. Пришлите будущую дату или время.'
          : 'That time is already in the past. Send a future date or time.'
      )
      return
    }

    if (parsedSchedule.kind !== 'parsed') {
      await replyInTopic(
        ctx,
        interpretedRequest.clarificationQuestion ??
          (reminderContext.locale === 'ru'
            ? 'Когда напомнить? Подойдёт свободная форма, например: «завтра утром», «завтра в 15:00», «24.03 18:30».'
            : 'When should I remind? Free-form is fine, for example: "tomorrow morning", "tomorrow 15:00", or "2026-03-24 18:30".')
      )
      return
    }

    const renderedNotificationText = await renderNotificationText({
      reminderContext,
      originalRequestText: messageText,
      normalizedNotificationText: interpretedRequest.notificationText,
      assigneeMemberId: interpretedRequest.assigneeMemberId
    })
    if (!renderedNotificationText) {
      await replyInTopic(ctx, unavailableReply(reminderContext.locale))
      return
    }

    const draft: Extract<NotificationDraftPayload, { stage: 'confirm' }> = {
      stage: 'confirm',
      proposalId: createProposalId(),
      householdId: reminderContext.householdId,
      threadId: reminderContext.threadId,
      creatorMemberId: reminderContext.member.id,
      timezone: reminderContext.timezone,
      originalRequestText: messageText,
      normalizedNotificationText: interpretedRequest.notificationText,
      renderedNotificationText,
      assigneeMemberId: interpretedRequest.assigneeMemberId,
      scheduledForIso: parsedSchedule.scheduledFor!.toString(),
      timePrecision: parsedSchedule.timePrecision!,
      deliveryMode: 'topic',
      dmRecipientMemberIds: [],
      viewMode: 'compact'
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
        ctx.from!.id.toString()
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
        ctx.from.id.toString()
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
