import type { FinanceCommandService } from '@household/application'
import type { FinanceMemberRecord, HouseholdConfigurationRepository } from '@household/ports'
import type { Context } from 'grammy'

import { resolveReplyLocale } from './bot-locale'
import type { BotLocale } from './i18n'

export interface ReminderTopicActorContext {
  locale: BotLocale
  householdId: string
  telegramChatId: string
  telegramThreadId: string | null
  actorTelegramUserId: string
  member: FinanceMemberRecord
}

function callbackMessage(ctx: Context) {
  return ctx.callbackQuery && 'message' in ctx.callbackQuery ? ctx.callbackQuery.message : undefined
}

function messageThreadId(message: ReturnType<typeof callbackMessage>): string | null {
  return message && 'message_thread_id' in message && message.message_thread_id !== undefined
    ? message.message_thread_id.toString()
    : null
}

export async function resolveReminderTopicActorContext(input: {
  ctx: Context
  householdConfigurationRepository: Pick<
    HouseholdConfigurationRepository,
    | 'findHouseholdTopicByTelegramContext'
    | 'getTelegramHouseholdChat'
    | 'getHouseholdMember'
    | 'getHouseholdChatByHouseholdId'
    | 'getHouseholdTopicBinding'
    | 'listHouseholdMembersByTelegramUserId'
  >
  financeServiceForHousehold: (householdId: string) => FinanceCommandService
}): Promise<ReminderTopicActorContext | null> {
  const message = callbackMessage(input.ctx)
  if (!message || (message.chat.type !== 'group' && message.chat.type !== 'supergroup')) {
    return null
  }

  const actorTelegramUserId = input.ctx.from?.id?.toString()
  if (!actorTelegramUserId) {
    return null
  }

  const telegramChatId = message.chat.id.toString()
  const telegramThreadId = messageThreadId(message)
  const topicBinding = telegramThreadId
    ? await input.householdConfigurationRepository.findHouseholdTopicByTelegramContext({
        telegramChatId,
        telegramThreadId
      })
    : null
  const chatBinding =
    await input.householdConfigurationRepository.getTelegramHouseholdChat(telegramChatId)
  const householdId = topicBinding?.householdId ?? chatBinding?.householdId ?? null
  if (!householdId) {
    return null
  }

  const [householdChat, reminderTopic] = await Promise.all([
    input.householdConfigurationRepository.getHouseholdChatByHouseholdId(householdId),
    input.householdConfigurationRepository.getHouseholdTopicBinding(householdId, 'reminders')
  ])
  if (!householdChat || householdChat.telegramChatId !== telegramChatId) {
    return null
  }

  if (reminderTopic) {
    if (
      topicBinding?.householdId !== householdId ||
      topicBinding.role !== 'reminders' ||
      topicBinding.telegramThreadId !== reminderTopic.telegramThreadId
    ) {
      return null
    }
  } else if (topicBinding && topicBinding.role !== 'reminders') {
    return null
  }

  const service = input.financeServiceForHousehold(householdId)
  const [locale, member] = await Promise.all([
    resolveReplyLocale({
      ctx: input.ctx,
      repository: input.householdConfigurationRepository,
      householdId
    }),
    service.getMemberByTelegramUserId(actorTelegramUserId)
  ])
  if (!member) {
    return null
  }

  return {
    locale,
    householdId,
    telegramChatId,
    telegramThreadId,
    actorTelegramUserId,
    member
  }
}
