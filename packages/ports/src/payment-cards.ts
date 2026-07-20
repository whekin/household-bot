import type { Instant, SupportedLocale } from '@household/domain'

export type TelegramPaymentCardKind = 'rent' | 'utilities'
export type TelegramPaymentCardSurface = 'bill' | 'reminder' | 'instruction'

export interface TelegramPaymentCardRecord {
  householdId: string
  kind: TelegramPaymentCardKind
  period: string
  surface: TelegramPaymentCardSurface
  locale: SupportedLocale
  telegramChatId: string
  telegramThreadId: string | null
  telegramMessageId: string
  createdAt: Instant
  updatedAt: Instant
}

export interface TelegramPaymentCardRepository {
  upsertPaymentCard(
    input: Omit<TelegramPaymentCardRecord, 'createdAt' | 'updatedAt'> & {
      updatedAt: Instant
    }
  ): Promise<void>
  listPaymentCards(input: {
    householdId: string
    kind: TelegramPaymentCardKind
    period: string
  }): Promise<readonly TelegramPaymentCardRecord[]>
  deletePaymentCard(input: { telegramChatId: string; telegramMessageId: string }): Promise<void>
}
