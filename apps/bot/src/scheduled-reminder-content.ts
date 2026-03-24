import type { ReminderType } from '@household/ports'
import type { InlineKeyboardMarkup } from 'grammy/types'

import { getBotTranslations } from './i18n'
import type { BotLocale } from './i18n'
import { buildUtilitiesReminderReplyMarkup } from './reminder-topic-utilities'

export interface ScheduledReminderMessageContent {
  text: string
  replyMarkup?: InlineKeyboardMarkup
}

export function buildScheduledReminderMessageContent(input: {
  locale: BotLocale
  reminderType: ReminderType
  period: string
  miniAppUrl?: string
  botUsername?: string
}): ScheduledReminderMessageContent {
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
            : {})
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
