export const HOUSEHOLD_TOPIC_ROLES = ['purchase', 'feedback', 'reminders'] as const

export type HouseholdTopicRole = (typeof HOUSEHOLD_TOPIC_ROLES)[number]

export interface HouseholdTelegramChatRecord {
  householdId: string
  householdName: string
  telegramChatId: string
  telegramChatType: string
  title: string | null
}

export interface HouseholdTopicBindingRecord {
  householdId: string
  role: HouseholdTopicRole
  telegramThreadId: string
  topicName: string | null
}

export interface RegisterTelegramHouseholdChatInput {
  householdName: string
  telegramChatId: string
  telegramChatType: string
  title?: string
}

export interface RegisterTelegramHouseholdChatResult {
  status: 'created' | 'existing'
  household: HouseholdTelegramChatRecord
}

export interface HouseholdConfigurationRepository {
  registerTelegramHouseholdChat(
    input: RegisterTelegramHouseholdChatInput
  ): Promise<RegisterTelegramHouseholdChatResult>
  getTelegramHouseholdChat(telegramChatId: string): Promise<HouseholdTelegramChatRecord | null>
  bindHouseholdTopic(input: {
    householdId: string
    role: HouseholdTopicRole
    telegramThreadId: string
    topicName?: string
  }): Promise<HouseholdTopicBindingRecord>
  getHouseholdTopicBinding(
    householdId: string,
    role: HouseholdTopicRole
  ): Promise<HouseholdTopicBindingRecord | null>
  findHouseholdTopicByTelegramContext(input: {
    telegramChatId: string
    telegramThreadId: string
  }): Promise<HouseholdTopicBindingRecord | null>
  listHouseholdTopicBindings(householdId: string): Promise<readonly HouseholdTopicBindingRecord[]>
}
