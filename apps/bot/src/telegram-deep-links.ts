export function buildBotStartDeepLink(
  botUsername: string | undefined,
  payload: string
): string | null {
  const normalizedBotUsername = botUsername?.trim()
  const normalizedPayload = payload.trim()

  if (!normalizedBotUsername || !normalizedPayload) {
    return null
  }

  return `https://t.me/${normalizedBotUsername}?start=${encodeURIComponent(normalizedPayload)}`
}
