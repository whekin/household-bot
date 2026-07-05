import type { FinanceCommandService } from '@household/application'
import { BillingPeriod, nowInstant } from '@household/domain'
import type { Logger } from '@household/observability'
import type {
  HouseholdConfigurationRepository,
  TelegramPendingActionRepository
} from '@household/ports'
import type { Bot, Context } from 'grammy'
import type { InlineKeyboardMarkup } from 'grammy/types'

import { getBotTranslations, type BotLocale } from './i18n'
import { resolveReplyLocale } from './bot-locale'
import { buildBotStartDeepLink } from './telegram-deep-links'
import { resolveReminderTopicActorContext } from './reminder-topic-context'
import { readTelegramMessageText } from './topic-ingestion/topic-message-primitives'

export const REMINDER_UTILITY_GUIDED_CALLBACK = 'reminder_util:guided'
export const REMINDER_UTILITY_TEMPLATE_CALLBACK = 'reminder_util:template'
const REMINDER_UTILITY_CONFIRM_CALLBACK_PREFIX = 'reminder_util:confirm:'
const REMINDER_UTILITY_CANCEL_CALLBACK_PREFIX = 'reminder_util:cancel:'
export const REMINDER_UTILITY_ACTION = 'reminder_utility_entry' as const
export const REMINDER_UTILITY_ACTION_TTL_MS = 30 * 60_000
const REMINDER_UTILITY_GUIDED_CALLBACK_PATTERN = /^reminder_util:guided(?::(\d{4}-\d{2}))?$/
const REMINDER_UTILITY_TEMPLATE_CALLBACK_PATTERN = /^reminder_util:template(?::(\d{4}-\d{2}))?$/

type ReminderUtilityEntryPayload =
  | {
      stage: 'guided'
      householdId: string
      threadId: string
      period: string
      currency: 'GEL' | 'USD'
      memberId: string
      categories: readonly string[]
      currentIndex: number
      entries: readonly UtilityDraftEntry[]
    }
  | {
      stage: 'template'
      householdId: string
      threadId: string
      period: string
      currency: 'GEL' | 'USD'
      memberId: string
      categories: readonly string[]
    }
  | {
      stage: 'confirm'
      proposalId: string
      householdId: string
      threadId: string
      period: string
      currency: 'GEL' | 'USD'
      memberId: string
      entries: readonly UtilityDraftEntry[]
    }

type ReminderUtilityConfirmPayload = Extract<ReminderUtilityEntryPayload, { stage: 'confirm' }>

interface UtilityDraftEntry {
  billName: string
  amountMajor: string
}

interface ReminderTopicCandidate {
  chatId: string
  threadId: string
  senderTelegramUserId: string
  messageId: number
  rawText: string
}

function toReminderTopicCandidate(ctx: Context): ReminderTopicCandidate | null {
  const message = ctx.message
  const rawText = readTelegramMessageText(ctx)?.trim()
  if (!message || !rawText) {
    return null
  }

  if (!('is_topic_message' in message) || message.is_topic_message !== true) {
    return null
  }

  if (!('message_thread_id' in message) || message.message_thread_id === undefined) {
    return null
  }

  const senderTelegramUserId = ctx.from?.id?.toString()
  if (!senderTelegramUserId) {
    return null
  }

  return {
    chatId: message.chat.id.toString(),
    threadId: message.message_thread_id.toString(),
    senderTelegramUserId,
    messageId: message.message_id,
    rawText
  }
}

function normalizeDraftAmount(raw: string): string | null {
  const match = raw.match(/-?\d+(?:[,.]\d{1,2})?/)
  if (!match) {
    return null
  }

  const normalized = match[0].replace(',', '.')
  if (normalized.startsWith('-')) {
    return null
  }

  const [integerPart = '0', fractionalPart = ''] = normalized.split('.')
  const integerMinor = BigInt(integerPart) * 100n
  const fractionMinor = BigInt(fractionalPart.padEnd(2, '0'))
  const amountMinor = integerMinor + fractionMinor

  return `${amountMinor / 100n}.${(amountMinor % 100n).toString().padStart(2, '0')}`
}

function isSkipValue(raw: string): boolean {
  const normalized = raw.trim().toLowerCase()
  return (
    normalized === '0' ||
    normalized === 'skip' ||
    normalized === 'пропуск' ||
    normalized === 'нет' ||
    normalized === '-'
  )
}

function parseTemplateEntries(
  rawText: string,
  categories: readonly string[]
): readonly UtilityDraftEntry[] | null {
  const categoryByKey = new Map(
    categories.map((category) => [category.trim().toLowerCase(), category])
  )
  const entries: UtilityDraftEntry[] = []

  for (const line of rawText.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) {
      continue
    }

    const separatorIndex = trimmed.indexOf(':')
    if (separatorIndex <= 0) {
      continue
    }

    const rawCategory = trimmed.slice(0, separatorIndex).trim().toLowerCase()
    const category = categoryByKey.get(rawCategory)
    if (!category) {
      continue
    }

    const rawValue = trimmed.slice(separatorIndex + 1).trim()
    if (rawValue.length === 0 || isSkipValue(rawValue)) {
      continue
    }

    const amountMajor = normalizeDraftAmount(rawValue)
    if (!amountMajor || amountMajor === '0.00') {
      continue
    }

    entries.push({
      billName: category,
      amountMajor
    })
  }

  return entries.length > 0 ? entries : null
}

function escapeHtml(raw: string): string {
  return raw.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

export function buildTemplateText(
  locale: BotLocale,
  currency: 'GEL' | 'USD',
  categories: readonly string[]
): {
  text: string
  parseMode: 'HTML'
} {
  const templateLines = categories.map((category) => `${category}: `).join('\n')

  return {
    text: [
      `💡 <b>${escapeHtml(locale === 'ru' ? 'Коммуналка' : 'Utilities')}</b>`,
      '',
      escapeHtml(
        locale === 'ru'
          ? `Заполните суммы в ${currency} и отправьте обратно:`
          : `Fill in amounts in ${currency} and send back:`
      ),
      '',
      `<pre>${escapeHtml(templateLines)}</pre>`,
      '',
      escapeHtml(
        locale === 'ru'
          ? 'Оставьте пустым или укажите 0 для пропуска.'
          : 'Leave blank or use 0 to skip.'
      )
    ].join('\n'),
    parseMode: 'HTML'
  }
}

function reminderUtilitySummaryText(
  locale: BotLocale,
  period: string,
  currency: 'GEL' | 'USD',
  entries: readonly UtilityDraftEntry[]
): string {
  const t = getBotTranslations(locale).reminders

  return [
    t.summaryTitle(period),
    '',
    ...entries.map((entry) => t.summaryLine(entry.billName, entry.amountMajor, currency)),
    '',
    t.confirmPrompt
  ].join('\n')
}

function reminderUtilityReplyMarkup(locale: BotLocale) {
  const t = getBotTranslations(locale).reminders

  return (proposalId: string): InlineKeyboardMarkup => ({
    inline_keyboard: [
      [
        {
          text: t.confirmButton,
          callback_data: `${REMINDER_UTILITY_CONFIRM_CALLBACK_PREFIX}${proposalId}`
        },
        {
          text: t.cancelButton,
          callback_data: `${REMINDER_UTILITY_CANCEL_CALLBACK_PREFIX}${proposalId}`
        }
      ]
    ]
  })
}

function createReminderUtilityProposalId(): string {
  return crypto.randomUUID().slice(0, 8)
}

function buildReminderConfirmationPayload(input: {
  householdId: string
  threadId: string
  period: string
  currency: 'GEL' | 'USD'
  memberId: string
  entries: readonly UtilityDraftEntry[]
}): ReminderUtilityConfirmPayload {
  return {
    stage: 'confirm',
    proposalId: createReminderUtilityProposalId(),
    householdId: input.householdId,
    threadId: input.threadId,
    period: input.period,
    currency: input.currency,
    memberId: input.memberId,
    entries: input.entries
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

async function resolveReminderContext(
  ctx: Context,
  householdConfigurationRepository: HouseholdConfigurationRepository,
  financeServiceForHousehold: (householdId: string) => FinanceCommandService,
  periodArg?: string
): Promise<{
  locale: BotLocale
  householdId: string
  threadId: string
  memberId: string
  categories: readonly string[]
  currency: 'GEL' | 'USD'
  period: string
} | null> {
  const actorContext = await resolveReminderTopicActorContext({
    ctx,
    householdConfigurationRepository,
    financeServiceForHousehold
  })
  if (!actorContext || !actorContext.telegramThreadId) {
    return null
  }

  const financeService = financeServiceForHousehold(actorContext.householdId)
  const [settings, categories, cycle] = await Promise.all([
    householdConfigurationRepository.getHouseholdBillingSettings(actorContext.householdId),
    householdConfigurationRepository.listHouseholdUtilityCategories(actorContext.householdId),
    periodArg
      ? Promise.resolve({
          period: BillingPeriod.fromString(periodArg).toString()
        })
      : financeService.ensureExpectedCycle()
  ])

  return {
    locale: actorContext.locale,
    householdId: actorContext.householdId,
    threadId: actorContext.telegramThreadId,
    memberId: actorContext.member.id,
    categories: categories
      .filter((category) => category.isActive)
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((category) => category.name),
    currency: settings.settlementCurrency,
    period: cycle.period
  }
}

export function buildUtilitiesReminderReplyMarkup(
  locale: BotLocale,
  options?: {
    miniAppUrl?: string
    botUsername?: string
    period?: string
  }
): InlineKeyboardMarkup {
  const t = getBotTranslations(locale).reminders
  const dashboardUrl = buildBotStartDeepLink(options?.botUsername, 'dashboard')
  const periodSuffix = options?.period
    ? `:${BillingPeriod.fromString(options.period).toString()}`
    : ''

  return {
    inline_keyboard: [
      [
        {
          text: t.guidedEntryButton,
          callback_data: `${REMINDER_UTILITY_GUIDED_CALLBACK}${periodSuffix}`
        },
        {
          text: t.copyTemplateButton,
          callback_data: `${REMINDER_UTILITY_TEMPLATE_CALLBACK}${periodSuffix}`
        }
      ],
      ...(dashboardUrl
        ? [
            [
              {
                text: t.openDashboardButton,
                url: dashboardUrl
              }
            ]
          ]
        : [])
    ]
  }
}

export function registerReminderTopicUtilities(options: {
  bot: Bot
  householdConfigurationRepository: HouseholdConfigurationRepository
  promptRepository: TelegramPendingActionRepository
  financeServiceForHousehold: (householdId: string) => FinanceCommandService
  paymentInstructionPublisher?: {
    sendPaymentInstruction(input: {
      householdId: string
      kind: 'utilities' | 'rent'
      period: string
    }): Promise<{ status: string }>
  }
  logger?: Logger
}): void {
  async function startFlow(ctx: Context, stage: 'guided' | 'template', periodArg?: string) {
    if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') {
      return
    }

    const reminderContext = await resolveReminderContext(
      ctx,
      options.householdConfigurationRepository,
      options.financeServiceForHousehold,
      periodArg
    )

    if (!reminderContext) {
      return
    }

    const t = getBotTranslations(reminderContext.locale).reminders
    const actorTelegramUserId = ctx.from?.id?.toString()
    if (!actorTelegramUserId) {
      return
    }

    if (reminderContext.categories.length === 0) {
      await ctx.answerCallbackQuery({
        text: t.noActiveCategories,
        show_alert: true
      })
      return
    }

    if (stage === 'guided') {
      await options.promptRepository.upsertPendingAction({
        telegramUserId: actorTelegramUserId,
        telegramChatId: ctx.chat.id.toString(),
        action: REMINDER_UTILITY_ACTION,
        payload: {
          stage: 'guided',
          householdId: reminderContext.householdId,
          threadId: reminderContext.threadId,
          period: reminderContext.period,
          currency: reminderContext.currency,
          memberId: reminderContext.memberId,
          categories: reminderContext.categories,
          currentIndex: 0,
          entries: []
        } satisfies ReminderUtilityEntryPayload,
        expiresAt: nowInstant().add({ milliseconds: REMINDER_UTILITY_ACTION_TTL_MS })
      })

      await ctx.answerCallbackQuery({
        text: t.startToast
      })
      await replyInTopic(
        ctx,
        t.promptAmount(
          reminderContext.categories[0]!,
          reminderContext.currency,
          reminderContext.categories.length - 1
        )
      )
      return
    }

    await options.promptRepository.upsertPendingAction({
      telegramUserId: actorTelegramUserId,
      telegramChatId: ctx.chat.id.toString(),
      action: REMINDER_UTILITY_ACTION,
      payload: {
        stage: 'template',
        householdId: reminderContext.householdId,
        threadId: reminderContext.threadId,
        period: reminderContext.period,
        currency: reminderContext.currency,
        memberId: reminderContext.memberId,
        categories: reminderContext.categories
      } satisfies ReminderUtilityEntryPayload,
      expiresAt: nowInstant().add({ milliseconds: REMINDER_UTILITY_ACTION_TTL_MS })
    })

    await ctx.answerCallbackQuery({
      text: t.templateToast
    })
    const template = buildTemplateText(
      reminderContext.locale,
      reminderContext.currency,
      reminderContext.categories
    )
    await replyInTopic(ctx, template.text, undefined, {
      parseMode: template.parseMode
    })
  }

  options.bot.callbackQuery(REMINDER_UTILITY_GUIDED_CALLBACK_PATTERN, async (ctx) => {
    await startFlow(ctx, 'guided', ctx.match?.[1])
  })

  options.bot.callbackQuery(REMINDER_UTILITY_TEMPLATE_CALLBACK_PATTERN, async (ctx) => {
    await startFlow(ctx, 'template', ctx.match?.[1])
  })

  const handleReminderUtilityConfirm = async (ctx: Context, proposalId: string) => {
    const messageChat =
      ctx.callbackQuery && 'message' in ctx.callbackQuery
        ? ctx.callbackQuery.message?.chat
        : undefined
    if (messageChat?.type !== 'group' && messageChat?.type !== 'supergroup') {
      return
    }

    const actorTelegramUserId = ctx.from?.id?.toString()
    if (!actorTelegramUserId || !messageChat || !proposalId) {
      return
    }

    const locale = await resolveReplyLocale({
      ctx,
      repository: options.householdConfigurationRepository
    })
    const t = getBotTranslations(locale).reminders
    if (!options.promptRepository.consumePendingActionByPayloadValue) {
      options.logger?.error(
        {
          event: 'reminder.utility_confirm_claim_unavailable',
          chatId: messageChat.id.toString(),
          proposalId
        },
        'Reminder utility confirmation requires an atomic pending-action claim'
      )
      await ctx.answerCallbackQuery({
        text: t.proposalUnavailable,
        show_alert: true
      })
      return
    }

    const pending = await options.promptRepository.consumePendingActionByPayloadValue(
      messageChat.id.toString(),
      actorTelegramUserId,
      REMINDER_UTILITY_ACTION,
      'proposalId',
      proposalId
    )
    const payload =
      pending?.action === REMINDER_UTILITY_ACTION
        ? (pending.payload as Partial<ReminderUtilityEntryPayload>)
        : null

    if (
      !payload ||
      payload.stage !== 'confirm' ||
      !Array.isArray(payload.entries) ||
      payload.proposalId !== proposalId
    ) {
      await ctx.answerCallbackQuery({
        text: t.proposalUnavailable,
        show_alert: true
      })
      return
    }

    const financeService = options.financeServiceForHousehold(payload.householdId!)
    await financeService.addUtilityBills(
      payload.entries.map((entry) => ({
        billName: entry.billName,
        amountMajor: entry.amountMajor
      })),
      payload.memberId!,
      payload.currency,
      payload.period!
    )

    const publishResult = await options.paymentInstructionPublisher
      ?.sendPaymentInstruction({
        householdId: payload.householdId!,
        kind: 'utilities',
        period: payload.period!
      })
      .catch((error) => {
        options.logger?.warn(
          {
            event: 'reminder.utility_payment_instruction_failed',
            householdId: payload.householdId,
            period: payload.period,
            error
          },
          'Failed to publish utility payment instruction after reminder entry'
        )
        return { status: 'failed' }
      })

    const savedText = t.saved(payload.entries.length, payload.period!)
    await ctx.answerCallbackQuery({
      text: savedText
    })

    if (ctx.msg) {
      await ctx.editMessageText(
        publishResult?.status === 'sent' ? `${savedText}\n${t.paymentInstructionSent}` : savedText,
        {
          reply_markup: {
            inline_keyboard: []
          }
        }
      )
    }
  }

  const handleReminderUtilityCancel = async (ctx: Context, proposalId: string) => {
    const messageChat =
      ctx.callbackQuery && 'message' in ctx.callbackQuery
        ? ctx.callbackQuery.message?.chat
        : undefined
    if (messageChat?.type !== 'group' && messageChat?.type !== 'supergroup') {
      return
    }

    const actorTelegramUserId = ctx.from?.id?.toString()
    if (!actorTelegramUserId || !messageChat || !proposalId) {
      return
    }

    const locale = await resolveReplyLocale({
      ctx,
      repository: options.householdConfigurationRepository
    })
    const t = getBotTranslations(locale).reminders
    const pending = options.promptRepository.consumePendingActionByPayloadValue
      ? await options.promptRepository.consumePendingActionByPayloadValue(
          messageChat.id.toString(),
          actorTelegramUserId,
          REMINDER_UTILITY_ACTION,
          'proposalId',
          proposalId
        )
      : await options.promptRepository.getPendingAction(
          messageChat.id.toString(),
          actorTelegramUserId,
          REMINDER_UTILITY_ACTION
        )
    const payload =
      pending?.action === REMINDER_UTILITY_ACTION
        ? (pending.payload as Partial<ReminderUtilityEntryPayload>)
        : null

    if (!payload || payload.stage !== 'confirm' || payload.proposalId !== proposalId) {
      await ctx.answerCallbackQuery({
        text: t.proposalUnavailable,
        show_alert: true
      })
      return
    }

    if (!options.promptRepository.consumePendingActionByPayloadValue) {
      await options.promptRepository.clearPendingAction(
        messageChat.id.toString(),
        actorTelegramUserId,
        REMINDER_UTILITY_ACTION
      )
    }
    await ctx.answerCallbackQuery({
      text: t.cancelled
    })

    if (ctx.msg) {
      await ctx.editMessageText(t.cancelled, {
        reply_markup: {
          inline_keyboard: []
        }
      })
    }
  }

  options.bot.on('callback_query:data', async (ctx, next) => {
    const data = typeof ctx.callbackQuery?.data === 'string' ? ctx.callbackQuery.data : null
    if (!data) {
      await next()
      return
    }

    if (data.startsWith(REMINDER_UTILITY_CONFIRM_CALLBACK_PREFIX)) {
      await handleReminderUtilityConfirm(
        ctx,
        data.slice(REMINDER_UTILITY_CONFIRM_CALLBACK_PREFIX.length)
      )
      return
    }

    if (data.startsWith(REMINDER_UTILITY_CANCEL_CALLBACK_PREFIX)) {
      await handleReminderUtilityCancel(
        ctx,
        data.slice(REMINDER_UTILITY_CANCEL_CALLBACK_PREFIX.length)
      )
      return
    }

    await next()
  })

  options.bot.on('message', async (ctx, next) => {
    const candidate = toReminderTopicCandidate(ctx)
    if (!candidate || candidate.rawText.startsWith('/')) {
      await next()
      return
    }

    const pending = await options.promptRepository.getPendingAction(
      candidate.chatId,
      candidate.senderTelegramUserId,
      REMINDER_UTILITY_ACTION
    )
    const payload =
      pending?.action === REMINDER_UTILITY_ACTION
        ? (pending.payload as Partial<ReminderUtilityEntryPayload>)
        : null

    if (!payload || payload.threadId !== candidate.threadId) {
      await next()
      return
    }

    const localeOptions = payload.householdId
      ? {
          ctx,
          repository: options.householdConfigurationRepository,
          householdId: payload.householdId
        }
      : {
          ctx,
          repository: options.householdConfigurationRepository
        }
    const locale = await resolveReplyLocale(localeOptions)
    const t = getBotTranslations(locale).reminders

    try {
      if (payload.stage === 'guided' && Array.isArray(payload.categories)) {
        if (isSkipValue(candidate.rawText)) {
          const nextPayload: ReminderUtilityEntryPayload = {
            stage: 'guided',
            householdId: payload.householdId!,
            threadId: payload.threadId!,
            period: payload.period!,
            currency: payload.currency!,
            memberId: payload.memberId!,
            categories: payload.categories,
            currentIndex: (payload.currentIndex ?? 0) + 1,
            entries: payload.entries ?? []
          }
          const nextIndex = (payload.currentIndex ?? 0) + 1
          const nextCategory = payload.categories[nextIndex]
          if (!nextCategory) {
            const confirmationPayload = buildReminderConfirmationPayload({
              householdId: payload.householdId!,
              threadId: payload.threadId!,
              period: payload.period!,
              currency: payload.currency!,
              memberId: payload.memberId!,
              entries: payload.entries ?? []
            })
            await options.promptRepository.upsertPendingAction({
              telegramUserId: candidate.senderTelegramUserId,
              telegramChatId: candidate.chatId,
              action: REMINDER_UTILITY_ACTION,
              payload: confirmationPayload,
              expiresAt: nowInstant().add({ milliseconds: REMINDER_UTILITY_ACTION_TTL_MS })
            })

            if ((payload.entries?.length ?? 0) === 0) {
              await options.promptRepository.clearPendingAction(
                candidate.chatId,
                candidate.senderTelegramUserId,
                REMINDER_UTILITY_ACTION
              )
              await replyInTopic(ctx, t.cancelled)
              return
            }

            await replyInTopic(
              ctx,
              reminderUtilitySummaryText(
                locale,
                payload.period!,
                payload.currency!,
                payload.entries ?? []
              ),
              reminderUtilityReplyMarkup(locale)(confirmationPayload.proposalId)
            )
            return
          }

          await options.promptRepository.upsertPendingAction({
            telegramUserId: candidate.senderTelegramUserId,
            telegramChatId: candidate.chatId,
            action: REMINDER_UTILITY_ACTION,
            payload: nextPayload,
            expiresAt: nowInstant().add({ milliseconds: REMINDER_UTILITY_ACTION_TTL_MS })
          })

          await replyInTopic(
            ctx,
            t.promptAmount(
              nextCategory,
              payload.currency!,
              payload.categories.length - nextIndex - 1
            )
          )
          return
        }

        const amountMajor = normalizeDraftAmount(candidate.rawText)
        const currentIndex = payload.currentIndex ?? 0
        const currentCategory = payload.categories[currentIndex]
        if (!amountMajor || !currentCategory) {
          await replyInTopic(
            ctx,
            t.invalidAmount(
              currentCategory ?? payload.categories[0] ?? 'utility',
              payload.currency ?? 'GEL'
            )
          )
          return
        }

        const nextEntries = [...(payload.entries ?? []), { billName: currentCategory, amountMajor }]
        const nextIndex = currentIndex + 1
        const nextCategory = payload.categories[nextIndex]

        if (!nextCategory) {
          const confirmationPayload = buildReminderConfirmationPayload({
            householdId: payload.householdId!,
            threadId: payload.threadId!,
            period: payload.period!,
            currency: payload.currency!,
            memberId: payload.memberId!,
            entries: nextEntries
          })
          await options.promptRepository.upsertPendingAction({
            telegramUserId: candidate.senderTelegramUserId,
            telegramChatId: candidate.chatId,
            action: REMINDER_UTILITY_ACTION,
            payload: confirmationPayload,
            expiresAt: nowInstant().add({ milliseconds: REMINDER_UTILITY_ACTION_TTL_MS })
          })

          await replyInTopic(
            ctx,
            reminderUtilitySummaryText(locale, payload.period!, payload.currency!, nextEntries),
            reminderUtilityReplyMarkup(locale)(confirmationPayload.proposalId)
          )
          return
        }

        await options.promptRepository.upsertPendingAction({
          telegramUserId: candidate.senderTelegramUserId,
          telegramChatId: candidate.chatId,
          action: REMINDER_UTILITY_ACTION,
          payload: {
            stage: 'guided',
            householdId: payload.householdId!,
            threadId: payload.threadId!,
            period: payload.period!,
            currency: payload.currency!,
            memberId: payload.memberId!,
            categories: payload.categories,
            currentIndex: nextIndex,
            entries: nextEntries
          } as ReminderUtilityEntryPayload,
          expiresAt: nowInstant().add({ milliseconds: REMINDER_UTILITY_ACTION_TTL_MS })
        })

        await replyInTopic(
          ctx,
          t.promptAmount(nextCategory, payload.currency!, payload.categories.length - nextIndex - 1)
        )
        return
      }

      if (payload.stage === 'template' && Array.isArray(payload.categories)) {
        if (isSkipValue(candidate.rawText) || candidate.rawText.trim().toLowerCase() === 'cancel') {
          await options.promptRepository.clearPendingAction(
            candidate.chatId,
            candidate.senderTelegramUserId,
            REMINDER_UTILITY_ACTION
          )
          await replyInTopic(ctx, t.cancelled)
          return
        }

        const entries = parseTemplateEntries(candidate.rawText, payload.categories)
        if (!entries) {
          await replyInTopic(ctx, t.templateInvalid)
          return
        }

        const confirmationPayload = buildReminderConfirmationPayload({
          householdId: payload.householdId!,
          threadId: payload.threadId!,
          period: payload.period!,
          currency: payload.currency!,
          memberId: payload.memberId!,
          entries
        })
        await options.promptRepository.upsertPendingAction({
          telegramUserId: candidate.senderTelegramUserId,
          telegramChatId: candidate.chatId,
          action: REMINDER_UTILITY_ACTION,
          payload: confirmationPayload,
          expiresAt: nowInstant().add({ milliseconds: REMINDER_UTILITY_ACTION_TTL_MS })
        })

        await replyInTopic(
          ctx,
          reminderUtilitySummaryText(locale, payload.period!, payload.currency!, entries),
          reminderUtilityReplyMarkup(locale)(confirmationPayload.proposalId)
        )
        return
      }

      await next()
    } catch (error) {
      options.logger?.error(
        {
          event: 'reminder.utility_entry_failed',
          chatId: candidate.chatId,
          threadId: candidate.threadId,
          messageId: candidate.messageId,
          error
        },
        'Failed to process reminder utility entry'
      )
    }
  })
}
