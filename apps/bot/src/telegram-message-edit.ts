import type { Context } from 'grammy'

export async function tryEditMessageText(
  ctx: Context,
  text: string,
  options?: Parameters<Context['editMessageText']>[1]
): Promise<boolean> {
  try {
    await ctx.editMessageText(text, options)
    return true
  } catch {
    return false
  }
}
