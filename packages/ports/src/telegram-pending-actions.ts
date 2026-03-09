import type { Instant } from '@household/domain'

export const TELEGRAM_PENDING_ACTION_TYPES = ['anonymous_feedback'] as const

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
}
