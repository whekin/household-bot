import type { Instant } from '@household/domain'

export interface TopicMessageHistoryRecord {
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
}

export interface ListRecentThreadTopicMessagesInput {
  householdId: string
  telegramChatId: string
  telegramThreadId: string
  limit: number
}

export interface ListRecentChatTopicMessagesInput {
  householdId: string
  telegramChatId: string
  sentAtOrAfter: Instant
  limit: number
}

export interface TopicMessageHistoryRepository {
  saveMessage(input: TopicMessageHistoryRecord): Promise<void>
  listRecentThreadMessages(
    input: ListRecentThreadTopicMessagesInput
  ): Promise<readonly TopicMessageHistoryRecord[]>
  listRecentChatMessages(
    input: ListRecentChatTopicMessagesInput
  ): Promise<readonly TopicMessageHistoryRecord[]>
}
