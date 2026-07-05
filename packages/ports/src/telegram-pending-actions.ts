import type { Instant } from '@household/domain'

export const TELEGRAM_PENDING_ACTION_TYPES = [
  'ad_hoc_notification',
  'agent_action',
  'assistant_command_suggestion',
  'anonymous_feedback',
  'assistant_payment_confirmation',
  'bill_command',
  'household_group_invite',
  'payment_topic_clarification',
  'payment_topic_confirmation',
  'reminder_utility_entry',
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
  /** One pending action per (chat, user, action type); same-type upserts replace. */
  upsertPendingAction(input: TelegramPendingActionRecord): Promise<TelegramPendingActionRecord>
  /** Without `action`, returns the most recently updated pending action. */
  getPendingAction(
    telegramChatId: string,
    telegramUserId: string,
    action?: TelegramPendingActionType
  ): Promise<TelegramPendingActionRecord | null>
  consumePendingActionByPayloadValue?(
    telegramChatId: string,
    telegramUserId: string,
    action: TelegramPendingActionType,
    key: string,
    value: string
  ): Promise<TelegramPendingActionRecord | null>
  findPendingActionByPayloadValue?(
    telegramChatId: string,
    action: TelegramPendingActionType,
    key: string,
    value: string
  ): Promise<TelegramPendingActionRecord | null>
  /** Without `action`, clears every pending action for the user in the chat. */
  clearPendingAction(
    telegramChatId: string,
    telegramUserId: string,
    action?: TelegramPendingActionType
  ): Promise<void>
  clearPendingActionsForChat(
    telegramChatId: string,
    action?: TelegramPendingActionType
  ): Promise<void>
}
