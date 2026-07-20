import type { FinanceCommandService } from '@household/application'
import { nowInstant } from '@household/domain'
import type { Logger } from '@household/observability'
import type {
  TelegramPaymentCardKind,
  TelegramPaymentCardRepository,
  TelegramPaymentCardSurface
} from '@household/ports'
import type { InlineKeyboardMarkup } from 'grammy/types'

import { buildBillingReminderPromptContent } from './billing-reminder-prompt-content'
import { buildPaymentInstructionContent } from './payment-instruction-content'

export interface LivePaymentCardService {
  register(input: {
    householdId: string
    kind: TelegramPaymentCardKind
    period: string
    surface: TelegramPaymentCardSurface
    locale: 'en' | 'ru'
    telegramChatId: string
    telegramThreadId: string | null
    telegramMessageId: string
  }): Promise<void>
  refresh(input: {
    householdId: string
    kind: TelegramPaymentCardKind
    period: string
  }): Promise<void>
}

export function createLivePaymentCardService(options: {
  repository: TelegramPaymentCardRepository
  financeServiceForHousehold: (householdId: string) => FinanceCommandService
  editMessage: (input: {
    chatId: string
    messageId: string
    text: string
    parseMode: 'HTML'
    replyMarkup?: InlineKeyboardMarkup
  }) => Promise<void>
  botUsername?: string
  miniAppUrl?: string
  logger?: Logger
}): LivePaymentCardService {
  return {
    async register(input) {
      await options.repository.upsertPaymentCard({
        ...input,
        updatedAt: nowInstant()
      })
    },

    async refresh(input) {
      const [dashboard, cards] = await Promise.all([
        options.financeServiceForHousehold(input.householdId).generateDashboard(input.period),
        options.repository.listPaymentCards(input)
      ])
      if (!dashboard) {
        return
      }

      await Promise.all(
        cards.map(async (card) => {
          const buildContent =
            card.surface === 'reminder'
              ? buildBillingReminderPromptContent
              : buildPaymentInstructionContent
          const content = buildContent({
            locale: card.locale,
            kind: card.kind,
            dispatchKind: card.kind === 'utilities' ? 'utilities' : 'rent_due',
            period: card.period,
            dashboard,
            viewMode: 'compact',
            ...(options.botUsername ? { botUsername: options.botUsername } : {}),
            ...(options.miniAppUrl ? { miniAppUrl: options.miniAppUrl } : {})
          })

          try {
            await options.editMessage({
              chatId: card.telegramChatId,
              messageId: card.telegramMessageId,
              text: content.text,
              parseMode: content.parseMode,
              ...(content.replyMarkup ? { replyMarkup: content.replyMarkup } : {})
            })
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            if (/message is not modified/i.test(message)) {
              return
            }
            if (/message to edit not found|message can't be edited/i.test(message)) {
              await options.repository.deletePaymentCard({
                telegramChatId: card.telegramChatId,
                telegramMessageId: card.telegramMessageId
              })
              return
            }
            options.logger?.warn(
              {
                event: 'payment_card.refresh_failed',
                householdId: card.householdId,
                kind: card.kind,
                period: card.period,
                telegramChatId: card.telegramChatId,
                telegramMessageId: card.telegramMessageId,
                error
              },
              'Failed to refresh live payment card'
            )
          }
        })
      )
    }
  }
}
