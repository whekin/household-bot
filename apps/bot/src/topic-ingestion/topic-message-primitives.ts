import type { Context } from 'grammy'

import { stripExplicitBotMention } from '../telegram-mentions'

type TelegramMessageContext = Pick<Context, 'message'>
type BotReplyContext = Pick<Context, 'msg' | 'me'>
type BotMentionContext = TelegramMessageContext & BotReplyContext

export function readTelegramMessageText(ctx: TelegramMessageContext): string | null {
  const message = ctx.message
  if (!message) {
    return null
  }

  if ('text' in message && typeof message.text === 'string') {
    return message.text
  }

  if ('caption' in message && typeof message.caption === 'string') {
    return message.caption
  }

  return null
}

export function readTelegramMessageTextWithoutBotMention(ctx: BotMentionContext): string | null {
  return stripExplicitBotMention(ctx)?.strippedText ?? readTelegramMessageText(ctx)
}

export function hasExplicitBotMention(ctx: BotReplyContext): boolean {
  return stripExplicitBotMention(ctx) !== null
}

export function telegramMessageAttachmentCount(ctx: TelegramMessageContext): number {
  const message = ctx.message
  if (!message) {
    return 0
  }

  if ('photo' in message && Array.isArray(message.photo)) {
    return message.photo.length
  }

  if ('document' in message && message.document) {
    return 1
  }

  return 0
}

export function hasTelegramMessageAttachment(ctx: TelegramMessageContext): boolean {
  return telegramMessageAttachmentCount(ctx) > 0
}

export function isReplyToCurrentBotMessage(ctx: BotReplyContext): boolean {
  return ctx.msg?.reply_to_message?.from?.id === ctx.me.id
}
