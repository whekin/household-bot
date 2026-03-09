import type { SupportedLocale } from '@household/domain'
import type { ReminderTarget } from './reminders'

export const HOUSEHOLD_TOPIC_ROLES = ['purchase', 'feedback', 'reminders'] as const

export type HouseholdTopicRole = (typeof HOUSEHOLD_TOPIC_ROLES)[number]

export interface HouseholdTelegramChatRecord {
  householdId: string
  householdName: string
  telegramChatId: string
  telegramChatType: string
  title: string | null
  defaultLocale: SupportedLocale
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
  householdDefaultLocale: SupportedLocale
}

export interface HouseholdMemberRecord {
  id: string
  householdId: string
  telegramUserId: string
  displayName: string
  preferredLocale: SupportedLocale | null
  householdDefaultLocale: SupportedLocale
  isAdmin: boolean
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
  getHouseholdChatByHouseholdId(householdId: string): Promise<HouseholdTelegramChatRecord | null>
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
  listReminderTargets(): Promise<readonly ReminderTarget[]>
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
  ensureHouseholdMember(input: {
    householdId: string
    telegramUserId: string
    displayName: string
    preferredLocale?: SupportedLocale | null
    isAdmin?: boolean
  }): Promise<HouseholdMemberRecord>
  getHouseholdMember(
    householdId: string,
    telegramUserId: string
  ): Promise<HouseholdMemberRecord | null>
  listHouseholdMembers(householdId: string): Promise<readonly HouseholdMemberRecord[]>
  listHouseholdMembersByTelegramUserId(
    telegramUserId: string
  ): Promise<readonly HouseholdMemberRecord[]>
  listPendingHouseholdMembers(householdId: string): Promise<readonly HouseholdPendingMemberRecord[]>
  approvePendingHouseholdMember(input: {
    householdId: string
    telegramUserId: string
    isAdmin?: boolean
  }): Promise<HouseholdMemberRecord | null>
  updateHouseholdDefaultLocale(
    householdId: string,
    locale: SupportedLocale
  ): Promise<HouseholdTelegramChatRecord>
  updateMemberPreferredLocale(
    householdId: string,
    telegramUserId: string,
    locale: SupportedLocale
  ): Promise<HouseholdMemberRecord | null>
}
