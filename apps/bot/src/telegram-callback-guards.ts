import type { Bot, Context, NextFunction } from 'grammy'
import { currentQueryMetrics, withQueryMetrics, type Logger } from '@household/observability'

/**
 * Answer a callback query without letting a failure abort the handler.
 *
 * Telegram keeps a pressed inline button in its loading state until the query is
 * answered, so handlers that only re-render a message should call this before doing
 * any work rather than after.
 */
export async function ackCallbackQuery(
  ctx: Context,
  options?: Parameters<Context['answerCallbackQuery']>[0],
  logger?: Logger
): Promise<void> {
  try {
    await ctx.answerCallbackQuery(options)
  } catch (error) {
    // Expired or already-answered queries are normal, not worth failing a handler over.
    logger?.debug(
      {
        event: 'telegram.callback_answer_failed',
        error: error instanceof Error ? error.message : String(error)
      },
      'Failed to answer callback query'
    )
  }
}

function callbackDedupeKey(ctx: Context): string | null {
  const query = ctx.callbackQuery
  if (!query) {
    return null
  }

  const message = 'message' in query ? query.message : undefined
  const chatId = message?.chat.id ?? ctx.chat?.id
  const messageId = message?.message_id
  if (chatId === undefined || messageId === undefined) {
    return null
  }

  return `${chatId}:${messageId}:${ctx.from?.id ?? 'anon'}:${query.data ?? ''}`
}

/**
 * Install the guards every callback handler benefits from:
 *
 * - **Serialization.** A button whose handler takes a while invites impatient re-taps,
 *   and each tap used to start another concurrent recompute of the same state. Repeat
 *   presses of the same button by the same user now queue behind the first one, so the
 *   expensive work never overlaps with itself. They are queued rather than dropped
 *   because handlers rely on running after the first press has settled — that is how a
 *   consumed proposal reports itself as no longer available.
 * - **Timing.** Without this there is no way to tell a slow query from a slow handler,
 *   so callback latency stayed invisible in production.
 *
 * Must be registered before any `bot.callbackQuery(...)` handler.
 */
export function registerCallbackQueryGuards(options: { bot: Bot; logger?: Logger }): void {
  const chains = new Map<string, Promise<void>>()

  options.bot.on('callback_query', async (ctx: Context, next: NextFunction) => {
    const key = callbackDedupeKey(ctx)
    const run = async (): Promise<void> => {
      const startedAt = performance.now()
      // Collect database timings for this update so a slow button can be attributed to
      // query count, query latency, or handler work instead of guessed at.
      await withQueryMetrics(async () => {
        try {
          await next()
        } finally {
          options.logger?.info(
            {
              event: 'telegram.callback_handled',
              data: ctx.callbackQuery?.data ?? null,
              durationMs: Math.round(performance.now() - startedAt),
              ...currentQueryMetrics()
            },
            'Handled callback query'
          )
        }
      })
    }

    if (!key) {
      await run()
      return
    }

    // The stored link already swallows rejections, so a failing press never cancels
    // the one queued behind it.
    const current = (chains.get(key) ?? Promise.resolve()).then(run)
    const tail = current.catch(() => {})
    chains.set(key, tail)
    try {
      await current
    } finally {
      // Only the last press in the chain clears it, so entries never leak.
      if (chains.get(key) === tail) {
        chains.delete(key)
      }
    }
  })
}
