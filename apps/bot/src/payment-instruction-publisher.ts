import type { FinanceCommandService } from '@household/application'
import type { Logger } from '@household/observability'
import type {
  HouseholdConfigurationRepository,
  ProcessedBotMessageRepository
} from '@household/ports'
import type { InlineKeyboardMarkup } from 'grammy/types'

import { buildPaymentInstructionContent } from './payment-instruction-content'
import type { LivePaymentCardService } from './live-payment-cards'

export type PaymentInstructionKind = 'utilities' | 'rent'

export type PaymentInstructionPublishStatus =
  | 'sent'
  | 'skipped_duplicate'
  | 'skipped_missing_topic'
  | 'skipped_no_plan'

export interface PaymentInstructionPublishResult {
  status: PaymentInstructionPublishStatus
}

export interface PaymentInstructionPublisher {
  sendPaymentInstruction(input: {
    householdId: string
    kind: PaymentInstructionKind
    period: string
  }): Promise<PaymentInstructionPublishResult>
}

export function createPaymentInstructionPublisher(options: {
  householdConfigurationRepository: Pick<
    HouseholdConfigurationRepository,
    'getHouseholdChatByHouseholdId' | 'getHouseholdTopicBinding'
  >
  financeServiceForHousehold: (householdId: string) => FinanceCommandService
  processedBotMessageRepository?: ProcessedBotMessageRepository
  sendTopicMessage: (input: {
    householdId: string
    chatId: string
    threadId: string | null
    text: string
    parseMode?: 'HTML'
    replyMarkup?: InlineKeyboardMarkup
  }) => Promise<{ telegramMessageId: string } | void>
  livePaymentCardService?: LivePaymentCardService
  botUsername?: string
  miniAppUrl?: string
  logger?: Logger
}): PaymentInstructionPublisher {
  function sourceKey(input: {
    kind: PaymentInstructionKind
    period: string
    planId?: string
    planVersion?: number
    rentDueDate?: string
  }): string {
    return input.kind === 'utilities'
      ? `utilities:${input.period}:${input.planId ?? 'no-plan'}:v${input.planVersion ?? 0}`
      : `rent:${input.period}:${input.rentDueDate ?? 'no-due-date'}`
  }

  return {
    async sendPaymentInstruction(input) {
      const [chat, paymentsTopic] = await Promise.all([
        options.householdConfigurationRepository.getHouseholdChatByHouseholdId(input.householdId),
        options.householdConfigurationRepository.getHouseholdTopicBinding(
          input.householdId,
          'payments'
        )
      ])
      if (!chat || !paymentsTopic) {
        return { status: 'skipped_missing_topic' }
      }

      const dashboard = await options
        .financeServiceForHousehold(input.householdId)
        .generateDashboard(input.period)
      if (!dashboard) {
        return { status: 'skipped_no_plan' }
      }

      if (
        input.kind === 'utilities' &&
        (!dashboard.utilityBillingPlan || dashboard.utilityBillingPlan.categories.length === 0)
      ) {
        return { status: 'skipped_no_plan' }
      }

      const key =
        input.kind === 'utilities'
          ? sourceKey({
              kind: input.kind,
              period: input.period,
              planId: dashboard.utilityBillingPlan!.id,
              planVersion: dashboard.utilityBillingPlan!.version
            })
          : sourceKey({
              kind: input.kind,
              period: input.period,
              rentDueDate: dashboard.rentBillingState.dueDate
            })
      const claim = await options.processedBotMessageRepository?.claimMessage({
        householdId: input.householdId,
        source: 'payment-instruction',
        sourceMessageKey: key
      })
      if (claim && !claim.claimed) {
        return { status: 'skipped_duplicate' }
      }

      try {
        const content = buildPaymentInstructionContent({
          locale: chat.defaultLocale,
          kind: input.kind,
          dispatchKind: input.kind === 'utilities' ? 'utilities' : 'rent_due',
          period: input.period,
          dashboard,
          viewMode: 'compact',
          ...(options.botUsername ? { botUsername: options.botUsername } : {}),
          ...(options.miniAppUrl ? { miniAppUrl: options.miniAppUrl } : {})
        })

        const sent = await options.sendTopicMessage({
          householdId: input.householdId,
          chatId: chat.telegramChatId,
          threadId: paymentsTopic.telegramThreadId,
          text: content.text,
          parseMode: content.parseMode,
          ...(content.replyMarkup ? { replyMarkup: content.replyMarkup } : {})
        })
        if (sent?.telegramMessageId && options.livePaymentCardService) {
          await options.livePaymentCardService.register({
            householdId: input.householdId,
            kind: input.kind,
            period: input.period,
            surface: 'instruction',
            locale: chat.defaultLocale,
            telegramChatId: chat.telegramChatId,
            telegramThreadId: paymentsTopic.telegramThreadId,
            telegramMessageId: sent.telegramMessageId
          })
        }

        return { status: 'sent' }
      } catch (error) {
        if (claim?.claimed) {
          await options.processedBotMessageRepository?.releaseMessage({
            householdId: input.householdId,
            source: 'payment-instruction',
            sourceMessageKey: key
          })
        }
        options.logger?.warn(
          {
            event: 'payment_instruction.send_failed',
            householdId: input.householdId,
            kind: input.kind,
            period: input.period,
            error
          },
          'Failed to send payment instruction'
        )
        throw error
      }
    }
  }
}
