import type { SupportedLocale } from '@household/domain'

export const REMINDER_TYPES = ['utilities', 'rent-warning', 'rent-due'] as const

export type ReminderType = (typeof REMINDER_TYPES)[number]

export interface ReminderTarget {
  householdId: string
  householdName: string
  telegramChatId: string
  telegramThreadId: string | null
  locale: SupportedLocale
}

export interface ClaimReminderDispatchInput {
  householdId: string
  period: string
  reminderType: ReminderType
  payloadHash: string
}

export interface ClaimReminderDispatchResult {
  dedupeKey: string
  claimed: boolean
}

export interface ReminderDispatchRepository {
  claimReminderDispatch(input: ClaimReminderDispatchInput): Promise<ClaimReminderDispatchResult>
  releaseReminderDispatch(input: {
    householdId: string
    period: string
    reminderType: ReminderType
  }): Promise<void>
}
