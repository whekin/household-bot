import type { Bot } from 'grammy'

export interface TelegramTopicMessageInput {
  chatId: string
  threadId: string | null
  text: string
  parseMode?: 'HTML'
  replyMarkup?: unknown
}

export interface TelegramTopicMessageResult {
  telegramMessageId: string
}

export interface TelegramDirectMessageInput {
  telegramUserId: string
  text: string
}

export interface TelegramTransport {
  sendTopicMessage(input: TelegramTopicMessageInput): Promise<TelegramTopicMessageResult>
  sendDirectMessage(input: TelegramDirectMessageInput): Promise<void>
}

export function createTelegramTransport(bot: Bot): TelegramTransport {
  return {
    async sendTopicMessage(input) {
      const threadId = input.threadId ? Number(input.threadId) : undefined
      const message = await bot.api.sendMessage(input.chatId, input.text, {
        ...(threadId && Number.isInteger(threadId)
          ? {
              message_thread_id: threadId
            }
          : {}),
        ...(input.parseMode
          ? {
              parse_mode: input.parseMode
            }
          : {}),
        ...(input.replyMarkup
          ? {
              reply_markup: input.replyMarkup as never
            }
          : {})
      })

      return {
        telegramMessageId: String(message.message_id)
      }
    },

    async sendDirectMessage(input) {
      await bot.api.sendMessage(input.telegramUserId, input.text)
    }
  }
}
