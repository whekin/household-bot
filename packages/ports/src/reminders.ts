import type { SupportedLocale } from '@household/domain'

export const REMINDER_TYPES = ['utilities', 'rent-warning', 'rent-due'] as const

export type ReminderType = (typeof REMINDER_TYPES)[number]

export interface ReminderTarget {
  householdId: string
  householdName: string
  telegramChatId: string
  telegramThreadId: string | null
  locale: SupportedLocale
  timezone: string
  rentDueDay: number
  rentWarningDay: number
  utilitiesDueDay: number
  utilitiesReminderDay: number
}
