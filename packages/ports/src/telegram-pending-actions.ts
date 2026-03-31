import type { Instant } from '@household/domain'

export const TELEGRAM_PENDING_ACTION_TYPES = [
  'ad_hoc_notification',
  'anonymous_feedback',
  'assistant_payment_confirmation',
  'household_group_invite',
  'payment_topic_clarification',
  'payment_topic_confirmation',
  'reminder_utility_entry',
  'payment_utility_entry',
  'setup_topic_binding',
  'setup_tracking'
] as const

export type TelegramPendingActionType = (typeof TELEGRAM_PENDING_ACTION_TYPES)[number]

export interface TelegramPendingActionRecord {
  telegramUserId: string
  telegramChatId: string
  action: TelegramPendingActionType
  payload: Record<string, unknown>
  expiresAt: Instant | null
}

export interface TelegramPendingActionRepository {
  upsertPendingAction(input: TelegramPendingActionRecord): Promise<TelegramPendingActionRecord>
  getPendingAction(
    telegramChatId: string,
    telegramUserId: string
  ): Promise<TelegramPendingActionRecord | null>
  clearPendingAction(telegramChatId: string, telegramUserId: string): Promise<void>
  clearPendingActionsForChat(
    telegramChatId: string,
    action?: TelegramPendingActionType
  ): Promise<void>
}
