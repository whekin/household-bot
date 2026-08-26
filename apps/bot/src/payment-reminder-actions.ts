import type {
  FinanceCommandService,
  FinanceDashboard,
  HouseholdAuditNotificationService
} from '@household/application'
import type { Logger } from '@household/observability'
import type { HouseholdConfigurationRepository } from '@household/ports'
import type { Bot, Context } from 'grammy'

import { resolveReminderTopicActorContext } from './reminder-topic-context'
import { getBotTranslations } from './i18n'
import {
  buildScheduledPaymentReminderContent,
  formatBillingMonth,
  PAYMENT_REMINDER_CLOSE_CALLBACK_PREFIX,
  PAYMENT_REMINDER_CONFIRM_CLOSE_CALLBACK_PREFIX,
  PAYMENT_REMINDER_DETAILS_CALLBACK_PREFIX,
  PAYMENT_REMINDER_PAID_CALLBACK_PREFIX,
  type PaymentReminderMessageContent,
  type PaymentReminderKind,
  type PaymentReminderViewMode
} from './payment-reminder-content'
import { buildPaymentInstructionContent } from './payment-instruction-content'
import type { LivePaymentCardService } from './live-payment-cards'

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
  content: PaymentReminderMessageContent,
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
  livePaymentCardService?: LivePaymentCardService
  botUsername?: string
  miniAppUrl?: string
  logger?: Logger
}): void {
  // Resolving the actor is a handful of indexed lookups; building the dashboard is
  // the expensive part. Keep them separate so the mutating handlers, which get a
  // fresh dashboard back from the mutation anyway, never pay for it twice.
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

    const period = match[2]
    const service = options.financeServiceForHousehold(actorContext.householdId)

    return {
      actorContext,
      dashboard: null as FinanceDashboard | null,
      kind: match[1],
      period,
      service,
      t: getBotTranslations(actorContext.locale).reminders,
      topicRole: actorContext.topicRole,
      async loadDashboard(): Promise<FinanceDashboard | null> {
        const dashboard = await service.generateDashboard(period)
        const paymentPeriod = dashboard?.paymentPeriods?.find(
          (summary) => summary.period === period
        )
        return dashboard && paymentPeriod ? dashboard : null
      }
    }
  }

  async function resolveActionWithDashboard(ctx: Context, match: CallbackMatch) {
    const action = await resolveAction(ctx, match)
    if (!action) {
      return null
    }

    const dashboard = await action.loadDashboard()
    if (!dashboard) {
      await safeAnswerCallback(
        ctx,
        { text: action.t.reminderUnavailable, show_alert: true },
        options.logger
      )
      return null
    }

    action.dashboard = dashboard
    return action
  }

  async function refresh(
    ctx: Context,
    action: NonNullable<Awaited<ReturnType<typeof resolveActionWithDashboard>>>,
    viewMode: PaymentReminderViewMode
  ) {
    if (!action.dashboard) {
      return
    }

    const buildContent =
      action.topicRole === 'payments'
        ? buildPaymentInstructionContent
        : buildScheduledPaymentReminderContent
    const content = buildContent({
      locale: action.actorContext.locale,
      kind: action.kind,
      dispatchKind: action.kind === 'utilities' ? 'utilities' : 'rent_due',
      period: action.period,
      dashboard: action.dashboard,
      viewMode,
      ...(options.botUsername ? { botUsername: options.botUsername } : {}),
      ...(options.miniAppUrl ? { miniAppUrl: options.miniAppUrl } : {})
    })
    await safeEditCallbackMessage(ctx, content, options.logger)
  }

  options.bot.callbackQuery(PAYMENT_REMINDER_DETAILS_PATTERN, async (ctx) => {
    // Purely a view switch, so clear the button's spinner before doing any work.
    await safeAnswerCallback(ctx, undefined, options.logger)
    const action = await resolveActionWithDashboard(ctx, ctx.match as CallbackMatch)
    if (!action) {
      return
    }

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

    // Answer on the cheap admin check rather than after the dashboard build.
    await safeAnswerCallback(ctx, { text: action.t.confirmPrompt }, options.logger)
    const dashboard = await action.loadDashboard()
    if (!dashboard) {
      return
    }
    action.dashboard = dashboard
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
    // closePaymentPeriod already computed a post-mutation dashboard; only fall back to
    // building one when it bailed out without producing anything.
    action.dashboard = result?.dashboard ?? (await action.loadDashboard())
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

    if (closed > 0 && options.livePaymentCardService) {
      await options.livePaymentCardService.refresh({
        householdId: action.actorContext.householdId,
        kind: action.kind,
        period: action.period,
        ...(action.dashboard ? { dashboard: action.dashboard } : {})
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
    action.dashboard = result?.dashboard ?? (await action.loadDashboard())
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
    if (result && result.closedMembers.length > 0 && options.livePaymentCardService) {
      await options.livePaymentCardService.refresh({
        householdId: action.actorContext.householdId,
        kind: action.kind,
        period: action.period,
        ...(action.dashboard ? { dashboard: action.dashboard } : {})
      })
    }
    await refresh(ctx, action, 'compact')
  })
}
