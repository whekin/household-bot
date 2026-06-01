import type {
  FinanceCommandService,
  HouseholdAuditNotificationService
} from '@household/application'
import type { Logger } from '@household/observability'
import type { HouseholdConfigurationRepository } from '@household/ports'
import type { Bot, Context } from 'grammy'

import { resolveReminderTopicActorContext } from './reminder-topic-context'
import { getBotTranslations } from './i18n'
import {
  buildPaymentReminderMessageContent,
  formatBillingMonth,
  PAYMENT_REMINDER_CLOSE_CALLBACK_PREFIX,
  PAYMENT_REMINDER_CONFIRM_CLOSE_CALLBACK_PREFIX,
  PAYMENT_REMINDER_DETAILS_CALLBACK_PREFIX,
  PAYMENT_REMINDER_PAID_CALLBACK_PREFIX,
  type PaymentReminderKind,
  type PaymentReminderViewMode
} from './payment-reminder-content'

const PAYMENT_REMINDER_PAID_PATTERN = new RegExp(
  `^${PAYMENT_REMINDER_PAID_CALLBACK_PREFIX}(rent|utilities):(\\d{4}-\\d{2})$`
)
const PAYMENT_REMINDER_DETAILS_PATTERN = new RegExp(
  `^${PAYMENT_REMINDER_DETAILS_CALLBACK_PREFIX}(rent|utilities):(\\d{4}-\\d{2}):(compact|details)$`
)
const PAYMENT_REMINDER_CLOSE_PATTERN = new RegExp(
  `^${PAYMENT_REMINDER_CLOSE_CALLBACK_PREFIX}(rent|utilities):(\\d{4}-\\d{2})$`
)
const PAYMENT_REMINDER_CONFIRM_CLOSE_PATTERN = new RegExp(
  `^${PAYMENT_REMINDER_CONFIRM_CLOSE_CALLBACK_PREFIX}(rent|utilities):(\\d{4}-\\d{2})$`
)

type CallbackMatch = RegExpMatchArray & {
  1: PaymentReminderKind
  2: string
  3?: PaymentReminderViewMode
}

async function safeAnswerCallback(
  ctx: Context,
  options?: Parameters<Context['answerCallbackQuery']>[0],
  logger?: Logger
): Promise<void> {
  try {
    await ctx.answerCallbackQuery(options)
  } catch (error) {
    logger?.warn(
      { event: 'payment_reminder.callback_answer_failed', error },
      'Failed to answer callback'
    )
  }
}

async function safeEditCallbackMessage(
  ctx: Context,
  content: ReturnType<typeof buildPaymentReminderMessageContent>,
  logger?: Logger
): Promise<void> {
  try {
    await ctx.editMessageText(content.text, {
      parse_mode: content.parseMode,
      ...(content.replyMarkup ? { reply_markup: content.replyMarkup } : {})
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/message is not modified/i.test(message)) {
      return
    }
    logger?.warn(
      { event: 'payment_reminder.callback_edit_failed', error },
      'Failed to edit reminder message'
    )
  }
}

export function registerPaymentReminderActions(options: {
  bot: Bot
  householdConfigurationRepository: Pick<
    HouseholdConfigurationRepository,
    | 'findHouseholdTopicByTelegramContext'
    | 'getTelegramHouseholdChat'
    | 'getHouseholdMember'
    | 'getHouseholdChatByHouseholdId'
    | 'getHouseholdTopicBinding'
    | 'listHouseholdMembersByTelegramUserId'
  >
  financeServiceForHousehold: (householdId: string) => FinanceCommandService
  auditNotificationService?: HouseholdAuditNotificationService
  botUsername?: string
  miniAppUrl?: string
  logger?: Logger
}): void {
  async function resolveAction(ctx: Context, match: CallbackMatch) {
    const actorContext = await resolveReminderTopicActorContext({
      ctx,
      householdConfigurationRepository: options.householdConfigurationRepository,
      financeServiceForHousehold: options.financeServiceForHousehold,
      allowedTopicRoles: ['reminders', 'payments']
    })
    if (!actorContext) {
      await safeAnswerCallback(
        ctx,
        { text: 'Reminder unavailable.', show_alert: true },
        options.logger
      )
      return null
    }

    const t = getBotTranslations(actorContext.locale).reminders
    const kind = match[1]
    const period = match[2]
    const service = options.financeServiceForHousehold(actorContext.householdId)
    const dashboard = await service.generateDashboard(period)
    const paymentPeriod = dashboard?.paymentPeriods?.find((summary) => summary.period === period)
    if (!dashboard || !paymentPeriod) {
      await safeAnswerCallback(
        ctx,
        { text: t.reminderUnavailable, show_alert: true },
        options.logger
      )
      return null
    }

    const message =
      ctx.callbackQuery && 'message' in ctx.callbackQuery ? ctx.callbackQuery.message : undefined
    const telegramThreadId =
      message && 'message_thread_id' in message && message.message_thread_id !== undefined
        ? message.message_thread_id.toString()
        : null
    const topicBinding = telegramThreadId
      ? await options.householdConfigurationRepository.findHouseholdTopicByTelegramContext({
          telegramChatId: actorContext.telegramChatId,
          telegramThreadId
        })
      : null

    return {
      actorContext,
      dashboard,
      kind,
      period,
      service,
      t,
      topicRole: topicBinding?.role ?? null
    }
  }

  async function refresh(
    ctx: Context,
    action: NonNullable<Awaited<ReturnType<typeof resolveAction>>>,
    viewMode: PaymentReminderViewMode
  ) {
    const content = buildPaymentReminderMessageContent({
      locale: action.actorContext.locale,
      kind: action.kind,
      dispatchKind: action.kind === 'utilities' ? 'utilities' : 'rent_due',
      period: action.period,
      dashboard: action.dashboard,
      viewMode,
      includeUtilityEntryButtons: action.topicRole !== 'payments',
      ...(action.topicRole === 'payments' ? { utilityAssignmentLimit: null } : {}),
      ...(options.botUsername ? { botUsername: options.botUsername } : {}),
      ...(options.miniAppUrl ? { miniAppUrl: options.miniAppUrl } : {})
    })
    await safeEditCallbackMessage(ctx, content, options.logger)
  }

  options.bot.callbackQuery(PAYMENT_REMINDER_DETAILS_PATTERN, async (ctx) => {
    const action = await resolveAction(ctx, ctx.match as CallbackMatch)
    if (!action) {
      return
    }

    await safeAnswerCallback(ctx, undefined, options.logger)
    await refresh(ctx, action, (ctx.match as CallbackMatch)[3] ?? 'compact')
  })

  options.bot.callbackQuery(PAYMENT_REMINDER_CLOSE_PATTERN, async (ctx) => {
    const action = await resolveAction(ctx, ctx.match as CallbackMatch)
    if (!action) {
      return
    }
    if (!action.actorContext.member.isAdmin) {
      await safeAnswerCallback(ctx, { text: action.t.adminOnly, show_alert: true }, options.logger)
      return
    }

    await safeAnswerCallback(ctx, { text: action.t.confirmPrompt }, options.logger)
    await refresh(ctx, action, 'confirm-close')
  })

  options.bot.callbackQuery(PAYMENT_REMINDER_PAID_PATTERN, async (ctx) => {
    const action = await resolveAction(ctx, ctx.match as CallbackMatch)
    if (!action) {
      return
    }

    const result = await action.service.closePaymentPeriod({
      kind: action.kind,
      memberIds: [action.actorContext.member.id],
      actorMemberId: action.actorContext.member.id,
      periodArg: action.period
    })
    const nextDashboard = result?.dashboard ?? action.dashboard
    action.dashboard = nextDashboard
    const closed = result?.closedMembers.length ?? 0
    await safeAnswerCallback(
      ctx,
      { text: closed > 0 ? action.t.paymentRecordedToast : action.t.alreadyPaid },
      options.logger
    )

    if (closed > 0 && options.auditNotificationService) {
      await options.auditNotificationService.recordEvent({
        householdId: action.actorContext.householdId,
        actorMemberId: action.actorContext.member.id,
        actorDisplayName: action.actorContext.member.displayName,
        eventType: 'payment.recorded',
        category: 'payment_events',
        summaryText: `${action.actorContext.member.displayName} marked ${action.kind} paid for ${formatBillingMonth(action.actorContext.locale, action.period)}`,
        metadata: {
          memberId: action.actorContext.member.id,
          kind: action.kind,
          period: action.period
        }
      })
    }

    await refresh(ctx, action, 'compact')
  })

  options.bot.callbackQuery(PAYMENT_REMINDER_CONFIRM_CLOSE_PATTERN, async (ctx) => {
    const action = await resolveAction(ctx, ctx.match as CallbackMatch)
    if (!action) {
      return
    }
    if (!action.actorContext.member.isAdmin) {
      await safeAnswerCallback(ctx, { text: action.t.adminOnly, show_alert: true }, options.logger)
      return
    }

    const result = await action.service.closePaymentPeriod({
      kind: action.kind,
      allMembers: true,
      actorMemberId: action.actorContext.member.id,
      periodArg: action.period
    })
    action.dashboard = result?.dashboard ?? action.dashboard
    await safeAnswerCallback(
      ctx,
      {
        text:
          result && result.closedMembers.length > 0
            ? action.t.paymentRecordedToast
            : action.t.alreadyPaid
      },
      options.logger
    )
    await refresh(ctx, action, 'compact')
  })
}
