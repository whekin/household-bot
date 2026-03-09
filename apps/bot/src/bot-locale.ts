import { normalizeSupportedLocale } from '@household/domain'
import type { HouseholdConfigurationRepository, HouseholdMemberRecord } from '@household/ports'
import type { Context } from 'grammy'

import { resolveBotLocale, type BotLocale } from './i18n'

function localeFromMember(member: HouseholdMemberRecord, fallback: BotLocale): BotLocale {
  return member.preferredLocale ?? member.householdDefaultLocale ?? fallback
}

export async function resolveReplyLocale(options: {
  ctx: Pick<Context, 'chat' | 'from'>
  repository: HouseholdConfigurationRepository | undefined
  householdId?: string
}): Promise<BotLocale> {
  const fallback = resolveBotLocale(options.ctx.from?.language_code)
  const telegramUserId = options.ctx.from?.id?.toString()
  const telegramChatId = options.ctx.chat?.id?.toString()

  if (!options.repository) {
    return fallback
  }

  if (options.ctx.chat && options.ctx.chat.type !== 'private' && telegramChatId) {
    const household = await options.repository.getTelegramHouseholdChat(telegramChatId)
    return household?.defaultLocale ?? fallback
  }

  if (!telegramUserId) {
    return fallback
  }

  if (options.householdId) {
    const member = await options.repository.getHouseholdMember(options.householdId, telegramUserId)
    return member ? localeFromMember(member, fallback) : fallback
  }

  const members = await options.repository.listHouseholdMembersByTelegramUserId(telegramUserId)
  if (members.length === 1) {
    return localeFromMember(members[0]!, fallback)
  }

  const normalized = normalizeSupportedLocale(options.ctx.from?.language_code)
  return normalized ?? fallback
}
