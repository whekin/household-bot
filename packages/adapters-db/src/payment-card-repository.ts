import { and, eq } from 'drizzle-orm'

import { instantFromDatabaseValue, instantToDate, type SupportedLocale } from '@household/domain'
import { createDbClient, schema } from '@household/db'
import type {
  TelegramPaymentCardKind,
  TelegramPaymentCardRepository,
  TelegramPaymentCardSurface
} from '@household/ports'

export function createDbTelegramPaymentCardRepository(databaseUrl: string): {
  repository: TelegramPaymentCardRepository
  close: () => Promise<void>
} {
  const { db, queryClient } = createDbClient(databaseUrl, {
    max: 3,
    prepare: false
  })

  return {
    repository: {
      async upsertPaymentCard(input) {
        await db
          .insert(schema.telegramPaymentCards)
          .values({
            householdId: input.householdId,
            kind: input.kind,
            period: input.period,
            surface: input.surface,
            locale: input.locale,
            telegramChatId: input.telegramChatId,
            telegramThreadId: input.telegramThreadId,
            telegramMessageId: input.telegramMessageId,
            updatedAt: instantToDate(input.updatedAt)
          })
          .onConflictDoUpdate({
            target: [
              schema.telegramPaymentCards.telegramChatId,
              schema.telegramPaymentCards.telegramMessageId
            ],
            set: {
              householdId: input.householdId,
              kind: input.kind,
              period: input.period,
              surface: input.surface,
              locale: input.locale,
              telegramThreadId: input.telegramThreadId,
              updatedAt: instantToDate(input.updatedAt)
            }
          })
      },

      async listPaymentCards(input) {
        const rows = await db
          .select()
          .from(schema.telegramPaymentCards)
          .where(
            and(
              eq(schema.telegramPaymentCards.householdId, input.householdId),
              eq(schema.telegramPaymentCards.kind, input.kind),
              eq(schema.telegramPaymentCards.period, input.period)
            )
          )

        return rows.map((row) => ({
          householdId: row.householdId,
          kind: row.kind as TelegramPaymentCardKind,
          period: row.period,
          surface: row.surface as TelegramPaymentCardSurface,
          locale: row.locale as SupportedLocale,
          telegramChatId: row.telegramChatId,
          telegramThreadId: row.telegramThreadId,
          telegramMessageId: row.telegramMessageId,
          createdAt: instantFromDatabaseValue(row.createdAt)!,
          updatedAt: instantFromDatabaseValue(row.updatedAt)!
        }))
      },

      async deletePaymentCard(input) {
        await db
          .delete(schema.telegramPaymentCards)
          .where(
            and(
              eq(schema.telegramPaymentCards.telegramChatId, input.telegramChatId),
              eq(schema.telegramPaymentCards.telegramMessageId, input.telegramMessageId)
            )
          )
      }
    },
    close: () => queryClient.end()
  }
}
