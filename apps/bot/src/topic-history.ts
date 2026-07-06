import { instantFromEpochSeconds, type Instant } from '@household/domain'
import type { TopicMessageHistoryRepository } from '@household/ports'

export function telegramMessageIdFromMessage(
  message: { message_id?: number } | null | undefined
): string | null {
  return typeof message?.message_id === 'number' ? message.message_id.toString() : null
}

export function telegramMessageSentAtFromMessage(
  message: { date?: number } | null | undefined
): Instant | null {
  return typeof message?.date === 'number' ? instantFromEpochSeconds(message.date) : null
}

export async function persistTopicHistoryMessage(input: {
  repository: TopicMessageHistoryRepository | undefined
  householdId: string
  telegramChatId: string
  telegramThreadId: string | null
  telegramMessageId: string | null
  telegramUpdateId: string | null
  senderTelegramUserId: string | null
  senderDisplayName: string | null
  isBot: boolean
  rawText: string
  messageSentAt: Instant | null
}) {
  const normalizedText = input.rawText.trim()
  if (!input.repository || normalizedText.length === 0) {
    return
  }

  await input.repository.saveMessage({
    householdId: input.householdId,
    telegramChatId: input.telegramChatId,
    telegramThreadId: input.telegramThreadId,
    telegramMessageId: input.telegramMessageId,
    telegramUpdateId: input.telegramUpdateId,
    senderTelegramUserId: input.senderTelegramUserId,
    senderDisplayName: input.senderDisplayName,
    isBot: input.isBot,
    rawText: normalizedText,
    messageSentAt: input.messageSentAt
  })
}
