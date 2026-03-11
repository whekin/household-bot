import type { Context } from 'grammy'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getMessageText(ctx: Pick<Context, 'msg'>): string | null {
  const message = ctx.msg
  if (!message || !('text' in message) || typeof message.text !== 'string') {
    return null
  }

  return message.text
}

export function stripExplicitBotMention(ctx: Pick<Context, 'msg' | 'me'>): {
  originalText: string
  strippedText: string
} | null {
  const text = getMessageText(ctx)
  const username = ctx.me.username

  if (!text || !username) {
    return null
  }

  const mentionPattern = new RegExp(`(^|\\s)@${escapeRegExp(username)}\\b`, 'giu')
  if (!mentionPattern.test(text)) {
    return null
  }

  mentionPattern.lastIndex = 0

  return {
    originalText: text,
    strippedText: text.replace(mentionPattern, '$1').replace(/\s+/gu, ' ').trim()
  }
}

export function hasExplicitBotMention(ctx: Pick<Context, 'msg' | 'me'>): boolean {
  return stripExplicitBotMention(ctx) !== null
}
