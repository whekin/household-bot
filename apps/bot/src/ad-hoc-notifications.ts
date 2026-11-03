import type { AdHocNotificationService } from '@household/application'
import { formatDayDisplay, Temporal, nowInstant } from '@household/domain'
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
import { reminderCopy } from './i18n/reminders'

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
      threadId: string | null
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
      threadId: string | null
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

interface NotificationActorContext {
  locale: BotLocale
  householdId: string
  threadId: string | null
  member: HouseholdMemberRecord
  members: readonly HouseholdMemberRecord[]
  timezone: string
  assistantContext: string | null
  assistantTone: string | null
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

function escapeRegExp(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function formatTimeOfDay(hour: number, minute: number): string {
  return `${hour}:${String(minute).padStart(2, '0')}`
}

function relativeDayLabel(input: {
  locale: BotLocale
  now: Temporal.ZonedDateTime
  target: Temporal.ZonedDateTime
}): string | null {
  const copy = reminderCopy[input.locale]
  const targetDate = input.target.toPlainDate()
  const nowDate = input.now.toPlainDate()
  const tomorrow = nowDate.add({ days: 1 })
  const dayAfterTomorrow = nowDate.add({ days: 2 })

  // Before 5am "tomorrow morning" still means the morning after the night's sleep.
  if (input.now.hour <= 4 && targetDate.equals(nowDate) && input.target.hour <= 12) {
    return copy.tomorrow
  }
  if (targetDate.equals(nowDate)) {
    return copy.today
  }
  if (targetDate.equals(tomorrow)) {
    return copy.tomorrow
  }
  if (targetDate.equals(dayAfterTomorrow)) {
    return copy.dayAfterTomorrow
  }

  return null
}

/** "завтра в 9:00" / "25 октября в 18:30" in the household timezone. */
export function formatReminderWhen(input: {
  locale: BotLocale
  scheduledForIso: string
  timezone: string
  now?: Temporal.Instant
}): string {
  const now = (input.now ?? nowInstant()).toZonedDateTimeISO(input.timezone)
  const target = Temporal.Instant.from(input.scheduledForIso).toZonedDateTimeISO(input.timezone)
  const day =
    relativeDayLabel({
      locale: input.locale,
      now,
      target
    }) ?? formatDayDisplay(target.toPlainDate().toString(), input.locale)

  return reminderCopy[input.locale].at(day, formatTimeOfDay(target.hour, target.minute))
}

function listedNotificationLine(input: {
  locale: BotLocale
  timezone: string
  item: Awaited<ReturnType<AdHocNotificationService['listUpcomingNotifications']>>[number]
}): string {
  const copy = reminderCopy[input.locale]
  const when = formatReminderWhen({
    locale: input.locale,
    scheduledForIso: input.item.scheduledFor.toString(),
    timezone: input.timezone
  })
  const details: string[] = []

  if (input.item.assigneeDisplayName) {
    details.push(copy.listFor(input.item.assigneeDisplayName))
  }

  if (input.item.deliveryMode === 'dm_all') {
    details.push(copy.listDmAll)
  } else if (input.item.deliveryMode === 'dm_selected') {
    const names = input.item.dmRecipientDisplayNames.join(', ')
    details.push(names.length > 0 ? copy.listDmSelected(names) : copy.listDmSelectedUnnamed)
  }

  if (input.item.creatorDisplayName !== input.item.assigneeDisplayName) {
    details.push(copy.listAuthor(input.item.creatorDisplayName))
  }

  const suffix = details.length > 0 ? `\n${details.join(' · ')}` : ''
  return `${when} · ${input.item.notificationText}${suffix}`
}

function notificationSummaryText(input: {
  locale: BotLocale
  payload: Extract<NotificationDraftPayload, { stage: 'confirm' }>
  members: readonly HouseholdMemberRecord[]
}): string {
  const copy = reminderCopy[input.locale]
  const when = formatReminderWhen({
    locale: input.locale,
    scheduledForIso: input.payload.scheduledForIso,
    timezone: input.payload.timezone
  })
  const recipients = input.members
    .filter((member) => input.payload.dmRecipientMemberIds.includes(member.id))
    .map((member) => member.displayName)
  const delivery =
    input.payload.deliveryMode === 'topic'
      ? copy.deliveryHere
      : input.payload.deliveryMode === 'dm_all'
        ? copy.deliveryDmAll
        : recipients.length > 0
          ? copy.deliveryDmSelected(recipients.join(', '))
          : copy.deliveryDmNobody

  return `${copy.draft(when, input.payload.renderedNotificationText)}\n${delivery}`
}

function toggleLabel(selected: boolean, label: string): string {
  return `${selected ? '✅' : '⬜'} ${label}`
}

function notificationDraftReplyMarkup(
  locale: BotLocale,
  payload: Extract<NotificationDraftPayload, { stage: 'confirm' }>,
  members: readonly HouseholdMemberRecord[]
): InlineKeyboardMarkup {
  const copy = reminderCopy[locale]
  const decisionRow = [
    {
      text: copy.saveButton,
      callback_data: `${AD_HOC_NOTIFICATION_CONFIRM_PREFIX}${payload.proposalId}`
    },
    {
      text: copy.cancelButton,
      callback_data: `${AD_HOC_NOTIFICATION_CANCEL_DRAFT_PREFIX}${payload.proposalId}`
    }
  ]

  if (payload.viewMode === 'compact') {
    return {
      inline_keyboard: [
        decisionRow,
        [
          {
            text: copy.expandButton,
            callback_data: `${AD_HOC_NOTIFICATION_VIEW_PREFIX}${payload.proposalId}:expanded`
          }
        ]
      ]
    }
  }

  const rows: InlineKeyboardMarkup['inline_keyboard'] = [
    decisionRow,
    [
      {
        text: toggleLabel(payload.deliveryMode === 'topic', copy.modeHereButton),
        callback_data: `${AD_HOC_NOTIFICATION_MODE_PREFIX}${payload.proposalId}:topic`
      },
      {
        text: toggleLabel(payload.deliveryMode === 'dm_all', copy.modeDmAllButton),
        callback_data: `${AD_HOC_NOTIFICATION_MODE_PREFIX}${payload.proposalId}:dm_all`
      }
    ],
    [
      {
        text: toggleLabel(payload.deliveryMode === 'dm_selected', copy.modeDmSelectedButton),
        callback_data: `${AD_HOC_NOTIFICATION_MODE_PREFIX}${payload.proposalId}:dm_selected`
      }
    ]
  ]

  if (payload.deliveryMode === 'dm_selected') {
    const memberButtons = members
      .filter((member) => member.status === 'active')
      .map((member) => ({
        text: toggleLabel(payload.dmRecipientMemberIds.includes(member.id), member.displayName),
        callback_data: `${AD_HOC_NOTIFICATION_MEMBER_PREFIX}${payload.proposalId}:${member.id}`
      }))
    for (let index = 0; index < memberButtons.length; index += 2) {
      rows.push(memberButtons.slice(index, index + 2))
    }
  }

  rows.push([
    {
      text: copy.backButton,
      callback_data: `${AD_HOC_NOTIFICATION_VIEW_PREFIX}${payload.proposalId}:compact`
    }
  ])

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
          text: reminderCopy[locale].cancelSavedButton,
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

async function resolveHouseholdId(
  ctx: Context,
  repository: HouseholdConfigurationRepository,
  telegramUserId: string
): Promise<string | null> {
  if (ctx.chat?.type === 'private') {
    const memberships = await repository.listHouseholdMembersByTelegramUserId(telegramUserId)
    const active = memberships.filter((membership) => membership.status !== 'left')
    return active.length === 1 ? active[0]!.householdId : null
  }

  if (!ctx.chat || (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup')) {
    return null
  }

  const telegramChatId = ctx.chat.id.toString()
  const threadId = getMessageThreadId(ctx)
  const binding = threadId
    ? await repository.findHouseholdTopicByTelegramContext({
        telegramChatId,
        telegramThreadId: threadId
      })
    : null
  if (binding) {
    return binding.householdId
  }

  const chat = await repository.getTelegramHouseholdChat(telegramChatId)
  return chat?.householdId ?? null
}

// Reminders can be asked for anywhere the household talks to the bot: any topic
// of the household chat, or a private chat with a single household. Delivery
// falls back to the reminders topic only when the source thread is unknown.
async function resolveNotificationContext(
  ctx: Context,
  repository: HouseholdConfigurationRepository
): Promise<NotificationActorContext | null> {
  const telegramUserId = ctx.from?.id?.toString()
  if (!telegramUserId) {
    return null
  }

  const householdId = await resolveHouseholdId(ctx, repository, telegramUserId)
  if (!householdId) {
    return null
  }

  const [locale, member, members, settings, assistantConfig] = await Promise.all([
    resolveReplyLocale({
      ctx,
      repository,
      householdId
    }),
    repository.getHouseholdMember(householdId, telegramUserId),
    repository.listHouseholdMembers(householdId),
    repository.getHouseholdBillingSettings(householdId),
    repository.getHouseholdAssistantConfig
      ? repository.getHouseholdAssistantConfig(householdId)
      : Promise.resolve<HouseholdAssistantConfigRecord>({
          householdId,
          assistantContext: null,
          assistantTone: null
        })
  ])

  if (!member) {
    return null
  }

  return {
    locale,
    householdId,
    threadId: getMessageThreadId(ctx),
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
  const notificationContext = await resolveNotificationContext(
    ctx,
    deps.householdConfigurationRepository
  )
  if (!notificationContext) {
    return
  }

  const confirmationMessageId = await replyInTopic(
    ctx,
    notificationSummaryText({
      locale: notificationContext.locale,
      payload: draft,
      members: notificationContext.members
    }),
    notificationDraftReplyMarkup(notificationContext.locale, draft, notificationContext.members)
  )

  if (
    previousConfirmationMessageId &&
    ctx.chat &&
    previousConfirmationMessageId !== confirmationMessageId
  ) {
    // The previous card may be gone or too old to edit; that must not fail the
    // new proposal, otherwise the stale draft blocks every retry.
    try {
      await ctx.api.editMessageReplyMarkup(ctx.chat.id, previousConfirmationMessageId, {
        reply_markup: {
          inline_keyboard: []
        }
      })
    } catch {}
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
  | 'household_not_resolved'
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
      const notificationContext = await resolveNotificationContext(
        input.ctx,
        deps.householdConfigurationRepository
      )
      if (!notificationContext) {
        return { status: 'household_not_resolved' }
      }

      if (
        input.assigneeMemberId &&
        !notificationContext.members.some((member) => member.id === input.assigneeMemberId)
      ) {
        return { status: 'unknown_assignee' }
      }

      const schedule = parseAdHocNotificationSchedule({
        timezone: notificationContext.timezone,
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
        householdId: notificationContext.householdId,
        threadId: notificationContext.threadId,
        creatorMemberId: notificationContext.member.id,
        timezone: notificationContext.timezone,
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
    const notificationContext = await resolveNotificationContext(
      ctx,
      options.householdConfigurationRepository
    )
    if (!notificationContext || !ctx.callbackQuery || !('message' in ctx.callbackQuery)) {
      return
    }

    await saveDraft(options.promptRepository, ctx, payload)
    await ctx.editMessageText(
      notificationSummaryText({
        locale: notificationContext.locale,
        payload,
        members: notificationContext.members
      }),
      {
        reply_markup: notificationDraftReplyMarkup(
          notificationContext.locale,
          payload,
          notificationContext.members
        )
      }
    )
  }

  options.bot.command('notifications', async (ctx, next) => {
    const notificationContext = await resolveNotificationContext(
      ctx,
      options.householdConfigurationRepository
    )
    if (!notificationContext) {
      await next()
      return
    }

    const items = await options.notificationService.listUpcomingNotifications({
      householdId: notificationContext.householdId,
      viewerMemberId: notificationContext.member.id
    })
    const locale = notificationContext.locale
    const copy = reminderCopy[locale]

    if (items.length === 0) {
      await replyInTopic(ctx, copy.listEmpty)
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
          timezone: notificationContext.timezone,
          item
        })}`
    )

    const cancelButtons = listedItems
      .filter(({ item }) => item.canCancel)
      .map(({ item, index }) => ({
        text: copy.listCancelButton(index + 1),
        callback_data: `${AD_HOC_NOTIFICATION_CANCEL_SAVED_PREFIX}${item.id}`
      }))
    const keyboard: InlineKeyboardMarkup = { inline_keyboard: [] }
    for (let index = 0; index < cancelButtons.length; index += 2) {
      keyboard.inline_keyboard.push(cancelButtons.slice(index, index + 2))
    }

    await replyInTopic(
      ctx,
      [copy.listTitle, ...lines].join('\n\n'),
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
      const notificationContext = await resolveNotificationContext(
        ctx,
        options.householdConfigurationRepository
      )
      const payload = await loadDraft(options.promptRepository, ctx)
      if (
        !notificationContext ||
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
        sourceTelegramChatId: ctx.chat?.id?.toString() ?? null,
        sourceTelegramThreadId: payload.threadId
      })

      const copy = reminderCopy[notificationContext.locale]
      if (result.status !== 'scheduled') {
        await ctx.answerCallbackQuery({
          text:
            result.reason === 'scheduled_for_past'
              ? copy.saveFailedPast
              : result.reason === 'dm_recipients_missing'
                ? copy.saveFailedNoRecipients
                : copy.saveFailed,
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
        text: copy.savedToast
      })
      await ctx.editMessageText(
        notificationSummaryText({
          locale: notificationContext.locale,
          payload,
          members: notificationContext.members
        }),
        {
          reply_markup: buildSavedNotificationReplyMarkup(
            notificationContext.locale,
            result.notification.id
          )
        }
      )
      return
    }

    if (data.startsWith(AD_HOC_NOTIFICATION_CANCEL_DRAFT_PREFIX)) {
      const proposalId = data.slice(AD_HOC_NOTIFICATION_CANCEL_DRAFT_PREFIX.length)
      const notificationContext = await resolveNotificationContext(
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
        !notificationContext
      ) {
        await next()
        return
      }

      await options.promptRepository.clearPendingAction(
        ctx.chat.id.toString(),
        ctx.from.id.toString(),
        AD_HOC_NOTIFICATION_ACTION
      )
      const copy = reminderCopy[notificationContext.locale]
      await ctx.answerCallbackQuery({
        text: copy.draftCancelledToast
      })
      await ctx.editMessageText(copy.draftCancelled, {
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
      const notificationContext = await resolveNotificationContext(
        ctx,
        options.householdConfigurationRepository
      )
      if (!notificationContext) {
        await next()
        return
      }

      const result = await options.notificationService.cancelNotification({
        notificationId,
        viewerMemberId: notificationContext.member.id
      })

      const copy = reminderCopy[notificationContext.locale]
      if (result.status !== 'cancelled') {
        await ctx.answerCallbackQuery({
          text: result.status === 'forbidden' ? copy.cancelForbidden : copy.cancelStale,
          show_alert: true
        })
        return
      }

      await ctx.answerCallbackQuery({
        text: copy.savedCancelledToast
      })
      await ctx.editMessageText(copy.savedCancelled(result.notification.notificationText), {
        reply_markup: {
          inline_keyboard: []
        }
      })
      return
    }

    await next()
  })
}

/** The DM a recipient gets when the reminder fires: plain text, framed so it reads on its own. */
export function buildDirectNotificationText(input: {
  notificationText: string
  locale: BotLocale
}): string {
  return reminderCopy[input.locale].directMessage(input.notificationText)
}

export function buildTopicNotificationText(input: {
  notificationText: string
  mention?: { telegramUserId: string; displayName: string } | null
}): {
  text: string
  parseMode: 'HTML'
} {
  const text = escapeHtml(input.notificationText)
  if (!input.mention) {
    return {
      text,
      parseMode: 'HTML'
    }
  }

  const displayName = escapeHtml(input.mention.displayName)
  const link = `<a href="tg://user?id=${input.mention.telegramUserId}">${displayName}</a>`
  // Reminder texts usually already open with the person's name ("Дима, позвони…"),
  // so turn that name into the mention instead of repeating it.
  const leadingName = new RegExp(`^${escapeRegExp(displayName)}(?=[\\s,:!?])`, 'i')

  return {
    text: leadingName.test(text) ? text.replace(leadingName, link) : `${link}: ${text}`,
    parseMode: 'HTML'
  }
}
