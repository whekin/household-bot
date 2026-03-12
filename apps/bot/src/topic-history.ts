import { instantFromEpochSeconds, nowInstant, Temporal, type Instant } from '@household/domain'
import type { TopicMessageHistoryRecord, TopicMessageHistoryRepository } from '@household/ports'

export interface TopicHistoryTurn {
  role: 'user' | 'assistant'
  speaker: string
  text: string
  threadId: string | null
}

const MEMORY_LOOKUP_PATTERN =
  /\b(?:do you remember|remember|what were we talking about|what did we say today)\b|(?:^|[^\p{L}])(?:помнишь|ты\s+помнишь|что\s+мы\s+сегодня\s+обсуждали|о\s+чем\s+мы\s+говорили)(?=$|[^\p{L}])/iu

export function shouldLoadExpandedChatHistory(text: string): boolean {
  return MEMORY_LOOKUP_PATTERN.test(text.trim())
}

export function startOfCurrentDayInTimezone(
  timezone: string,
  referenceInstant = nowInstant()
): Instant {
  const zoned = referenceInstant.toZonedDateTimeISO(timezone)
  const startOfDay = Temporal.ZonedDateTime.from({
    timeZone: timezone,
    year: zoned.year,
    month: zoned.month,
    day: zoned.day,
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0,
    microsecond: 0,
    nanosecond: 0
  })

  return startOfDay.toInstant()
}

export function historyRecordToTurn(record: TopicMessageHistoryRecord): TopicHistoryTurn {
  return {
    role: record.isBot ? 'assistant' : 'user',
    speaker: record.senderDisplayName ?? (record.isBot ? 'Kojori Bot' : 'Unknown'),
    text: record.rawText.trim(),
    threadId: record.telegramThreadId
  }
}

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

export function formatThreadHistory(turns: readonly TopicHistoryTurn[]): string | null {
  const lines = turns
    .map((turn) => `${turn.speaker} (${turn.role}): ${turn.text}`)
    .filter((line) => line.trim().length > 0)

  return lines.length > 0 ? lines.join('\n') : null
}

export function formatSameDayChatHistory(turns: readonly TopicHistoryTurn[]): string | null {
  const lines = turns
    .map((turn) =>
      turn.threadId
        ? `[thread ${turn.threadId}] ${turn.speaker} (${turn.role}): ${turn.text}`
        : `${turn.speaker} (${turn.role}): ${turn.text}`
    )
    .filter((line) => line.trim().length > 0)

  return lines.length > 0 ? lines.join('\n') : null
}
