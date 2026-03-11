import type {
  HouseholdConfigurationRepository,
  HouseholdTelegramChatRecord,
  HouseholdTopicBindingRecord,
  HouseholdTopicRole
} from '@household/ports'

export interface HouseholdSetupService {
  setupGroupChat(input: {
    actorIsAdmin: boolean
    actorTelegramUserId?: string
    actorDisplayName?: string
    telegramChatId: string
    telegramChatType: string
    title?: string
    householdName?: string
  }): Promise<
    | {
        status: 'created' | 'existing'
        household: HouseholdTelegramChatRecord
      }
    | {
        status: 'rejected'
        reason: 'not_admin' | 'invalid_chat_type'
      }
  >
  bindTopic(input: {
    actorIsAdmin: boolean
    telegramChatId: string
    role: HouseholdTopicRole
    telegramThreadId?: string
    topicName?: string
  }): Promise<
    | {
        status: 'bound'
        household: HouseholdTelegramChatRecord
        binding: HouseholdTopicBindingRecord
      }
    | {
        status: 'rejected'
        reason: 'not_admin' | 'household_not_found' | 'not_topic_message'
      }
  >
  unsetupGroupChat(input: {
    actorIsAdmin: boolean
    telegramChatId: string
    telegramChatType: string
  }): Promise<
    | {
        status: 'reset'
        household: HouseholdTelegramChatRecord
      }
    | {
        status: 'noop'
      }
    | {
        status: 'rejected'
        reason: 'not_admin' | 'invalid_chat_type'
      }
  >
}

function isSupportedGroupChat(chatType: string): boolean {
  return chatType === 'group' || chatType === 'supergroup'
}

function defaultHouseholdName(title: string | undefined, telegramChatId: string): string {
  const normalizedTitle = title?.trim()
  return normalizedTitle && normalizedTitle.length > 0
    ? normalizedTitle
    : `Household ${telegramChatId}`
}

export function createHouseholdSetupService(
  repository: HouseholdConfigurationRepository
): HouseholdSetupService {
  return {
    async setupGroupChat(input) {
      if (!input.actorIsAdmin) {
        return {
          status: 'rejected',
          reason: 'not_admin'
        }
      }

      if (!isSupportedGroupChat(input.telegramChatType)) {
        return {
          status: 'rejected',
          reason: 'invalid_chat_type'
        }
      }

      const registered = await repository.registerTelegramHouseholdChat({
        householdName:
          input.householdName?.trim() || defaultHouseholdName(input.title, input.telegramChatId),
        telegramChatId: input.telegramChatId,
        telegramChatType: input.telegramChatType,
        ...(input.title?.trim()
          ? {
              title: input.title.trim()
            }
          : {})
      })

      if (input.actorTelegramUserId && input.actorDisplayName) {
        const existingMembers = await repository.listHouseholdMembers(
          registered.household.householdId
        )
        const hasAdmin = existingMembers.some((member) => member.isAdmin)

        if (registered.status === 'created' || !hasAdmin) {
          await repository.ensureHouseholdMember({
            householdId: registered.household.householdId,
            telegramUserId: input.actorTelegramUserId,
            displayName: input.actorDisplayName,
            isAdmin: true
          })
        }
      }

      return {
        status: registered.status,
        household: registered.household
      }
    },

    async bindTopic(input) {
      if (!input.actorIsAdmin) {
        return {
          status: 'rejected',
          reason: 'not_admin'
        }
      }

      if (!input.telegramThreadId) {
        return {
          status: 'rejected',
          reason: 'not_topic_message'
        }
      }

      const household = await repository.getTelegramHouseholdChat(input.telegramChatId)
      if (!household) {
        return {
          status: 'rejected',
          reason: 'household_not_found'
        }
      }

      const binding = await repository.bindHouseholdTopic({
        householdId: household.householdId,
        role: input.role,
        telegramThreadId: input.telegramThreadId,
        ...(input.topicName?.trim()
          ? {
              topicName: input.topicName.trim()
            }
          : {})
      })

      return {
        status: 'bound',
        household,
        binding
      }
    },

    async unsetupGroupChat(input) {
      if (!input.actorIsAdmin) {
        return {
          status: 'rejected',
          reason: 'not_admin'
        }
      }

      if (!isSupportedGroupChat(input.telegramChatType)) {
        return {
          status: 'rejected',
          reason: 'invalid_chat_type'
        }
      }

      const household = await repository.getTelegramHouseholdChat(input.telegramChatId)
      if (!household) {
        return {
          status: 'noop'
        }
      }

      await repository.clearHouseholdTopicBindings(household.householdId)

      return {
        status: 'reset',
        household
      }
    }
  }
}
