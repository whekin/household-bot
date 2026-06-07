import type { ReminderType } from '@household/ports'
import type { InlineKeyboardMarkup } from 'grammy/types'
import type { FinanceDashboard } from '@household/application'

import { getBotTranslations } from './i18n'
import type { BotLocale } from './i18n'
import {
  buildScheduledPaymentReminderContent,
  type PaymentReminderDispatchKind
} from './payment-reminder-content'
import { buildUtilitiesReminderReplyMarkup } from './reminder-topic-utilities'

export interface ScheduledReminderMessageContent {
  text: string
  parseMode?: 'HTML'
  replyMarkup?: InlineKeyboardMarkup
}

export function buildScheduledReminderMessageContent(input: {
  locale: BotLocale
  reminderType: ReminderType
  period: string
  dashboard?: FinanceDashboard
  miniAppUrl?: string
  botUsername?: string
}): ScheduledReminderMessageContent {
  if (
    input.reminderType === 'utilities' &&
    (!input.dashboard?.utilityBillingPlan ||
      input.dashboard.utilityBillingPlan.categories.length === 0)
  ) {
    const t = getBotTranslations(input.locale).reminders
    return {
      text: t.utilities(input.period),
      replyMarkup: buildUtilitiesReminderReplyMarkup(input.locale, {
        ...(input.miniAppUrl
          ? {
              miniAppUrl: input.miniAppUrl
            }
          : {}),
        ...(input.botUsername
          ? {
              botUsername: input.botUsername
            }
          : {}),
        period: input.period
      })
    }
  }

  if (input.dashboard) {
    const dispatchKind: PaymentReminderDispatchKind =
      input.reminderType === 'utilities'
        ? 'utilities'
        : input.reminderType === 'rent-warning'
          ? 'rent_warning'
          : 'rent_due'
    return buildScheduledPaymentReminderContent({
      locale: input.locale,
      kind: input.reminderType === 'utilities' ? 'utilities' : 'rent',
      dispatchKind,
      period: input.period,
      dashboard: input.dashboard,
      viewMode: 'compact',
      ...(input.miniAppUrl ? { miniAppUrl: input.miniAppUrl } : {}),
      ...(input.botUsername ? { botUsername: input.botUsername } : {})
    })
  }

  const t = getBotTranslations(input.locale).reminders
  const dashboardReplyMarkup = input.botUsername
    ? ({
        inline_keyboard: [
          [
            {
              text: t.openDashboardButton,
              url: `https://t.me/${input.botUsername}?start=dashboard`
            }
          ]
        ]
      } satisfies InlineKeyboardMarkup)
    : null

  switch (input.reminderType) {
    case 'utilities':
      return {
        text: t.utilities(input.period),
        replyMarkup: buildUtilitiesReminderReplyMarkup(input.locale, {
          ...(input.miniAppUrl
            ? {
                miniAppUrl: input.miniAppUrl
              }
            : {}),
          ...(input.botUsername
            ? {
                botUsername: input.botUsername
              }
            : {}),
          period: input.period
        })
      }
    case 'rent-warning':
      return {
        text: t.rentWarning(input.period),
        ...(dashboardReplyMarkup
          ? {
              replyMarkup: dashboardReplyMarkup
            }
          : {})
      }
    case 'rent-due':
      return {
        text: t.rentDue(input.period),
        ...(dashboardReplyMarkup
          ? {
              replyMarkup: dashboardReplyMarkup
            }
          : {})
      }
  }
}
