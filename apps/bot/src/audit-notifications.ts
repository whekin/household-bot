import type { Bot } from 'grammy'

import {
  AUDIT_NOTIFICATION_VIEW_CALLBACK_PREFIX,
  buildAuditNotificationViewReplyMarkup,
  getAuditNotificationDetails
} from '@household/application'
import type { Logger } from '@household/observability'
import type { HouseholdAuditNotificationRepository } from '@household/ports'

export function registerAuditNotificationCallbacks(options: {
  bot: Bot
  repository: Pick<HouseholdAuditNotificationRepository, 'getAuditEventById'>
  logger?: Logger
}): void {
  options.bot.callbackQuery(
    new RegExp(`^${AUDIT_NOTIFICATION_VIEW_CALLBACK_PREFIX}([^:]+):(expanded|compact)$`),
    async (ctx) => {
      const eventId = ctx.match[1]
      const viewMode = ctx.match[2] as 'expanded' | 'compact'
      if (!eventId) {
        await ctx.answerCallbackQuery()
        return
      }

      const event = await options.repository.getAuditEventById(eventId)
      const details = event ? getAuditNotificationDetails(event) : null
      if (!event || !details || event.deliveryStatus !== 'sent') {
        await ctx.answerCallbackQuery()
        return
      }

      const message = ctx.callbackQuery.message
      const chatId = message?.chat.id !== undefined ? String(message.chat.id) : null
      const threadId =
        message?.message_thread_id !== undefined ? String(message.message_thread_id) : null
      const messageId = message?.message_id !== undefined ? String(message.message_id) : null
      const expectedThreadId = event.deliveredTelegramThreadId ?? null

      if (
        chatId !== event.deliveredTelegramChatId ||
        threadId !== expectedThreadId ||
        messageId !== event.deliveredTelegramMessageId
      ) {
        options.logger?.warn(
          {
            event: 'audit_notification.callback_mismatch',
            auditEventId: event.id,
            callbackChatId: chatId,
            callbackThreadId: threadId,
            callbackMessageId: messageId,
            deliveredTelegramChatId: event.deliveredTelegramChatId,
            deliveredTelegramThreadId: event.deliveredTelegramThreadId,
            deliveredTelegramMessageId: event.deliveredTelegramMessageId
          },
          'Rejected audit notification callback for a mismatched message'
        )
        await ctx.answerCallbackQuery()
        return
      }

      await ctx.editMessageText(
        viewMode === 'expanded' ? details.expandedText : details.compactText,
        {
          reply_markup: buildAuditNotificationViewReplyMarkup({
            eventId: event.id,
            locale: details.locale,
            viewMode
          })
        }
      )
      await ctx.answerCallbackQuery()
    }
  )
}
