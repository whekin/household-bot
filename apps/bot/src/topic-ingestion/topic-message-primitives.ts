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

/**
 * The message the user actually replied to. In forum topics Telegram fills
 * `reply_to_message` with the topic's creation message even when the user did
 * not reply, so that implicit target is ignored.
 */
export function explicitReplyTarget(message: Context['msg']) {
  const reply = message?.reply_to_message
  if (!reply) {
    return undefined
  }

  if (
    'is_topic_message' in message &&
    message.is_topic_message === true &&
    reply.message_id === message.message_thread_id
  ) {
    return undefined
  }

  return reply
}

export function isReplyToCurrentBotMessage(ctx: BotReplyContext): boolean {
  return explicitReplyTarget(ctx.msg)?.from?.id === ctx.me.id
}
