import type { Context } from 'grammy'

const TYPING_REFRESH_INTERVAL_MS = 4_000

export interface ActiveChatAction {
  stop(): void
}

export function startTypingIndicator(ctx: Context): ActiveChatAction {
  const chatId = ctx.chat?.id
  if (!chatId) {
    return {
      stop() {}
    }
  }

  const messageThreadId =
    ctx.msg && 'message_thread_id' in ctx.msg ? ctx.msg.message_thread_id : undefined

  let active = true

  const sendTypingAction = async () => {
    if (!active) {
      return
    }

    const options =
      messageThreadId !== undefined
        ? {
            message_thread_id: messageThreadId
          }
        : undefined

    try {
      await ctx.api.sendChatAction(chatId, 'typing', options)
    } catch {}
  }

  void sendTypingAction()

  const interval = setInterval(() => {
    void sendTypingAction()
  }, TYPING_REFRESH_INTERVAL_MS)

  if (typeof interval.unref === 'function') {
    interval.unref()
  }

  return {
    stop() {
      active = false
      clearInterval(interval)
    }
  }
}
