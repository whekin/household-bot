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

export interface HouseholdJoinTokenRecord {
  householdId: string
  householdName: string
  token: string
  createdByTelegramUserId: string | null
}

export interface HouseholdPendingMemberRecord {
  householdId: string
  householdName: string
  telegramUserId: string
  displayName: string
  username: string | null
  languageCode: string | null
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
  upsertHouseholdJoinToken(input: {
    householdId: string
    token: string
    createdByTelegramUserId?: string
  }): Promise<HouseholdJoinTokenRecord>
  getHouseholdJoinToken(householdId: string): Promise<HouseholdJoinTokenRecord | null>
  getHouseholdByJoinToken(token: string): Promise<HouseholdTelegramChatRecord | null>
  upsertPendingHouseholdMember(input: {
    householdId: string
    telegramUserId: string
    displayName: string
    username?: string
    languageCode?: string
  }): Promise<HouseholdPendingMemberRecord>
  getPendingHouseholdMember(
    householdId: string,
    telegramUserId: string
  ): Promise<HouseholdPendingMemberRecord | null>
  findPendingHouseholdMemberByTelegramUserId(
    telegramUserId: string
  ): Promise<HouseholdPendingMemberRecord | null>
}
