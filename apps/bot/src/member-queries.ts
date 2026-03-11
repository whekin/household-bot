import type { FinanceCommandService } from '@household/application'
import type {
  HouseholdConfigurationRepository,
  HouseholdMemberLifecycleStatus,
  HouseholdMemberRecord
} from '@household/ports'

import type { BotLocale } from './i18n'

type MemberBalanceMetric = 'purchase' | 'utilities' | 'rent'

const ROSTER_PATTERNS = [
  /\b(who do we have|who is in|members|member list|roster)\b/i,
  /кто у нас/i,
  /кто.*(в доме|в household|в домохозяйстве)/i,
  /участник/i,
  /состав/i
] as const

const PURCHASE_PATTERNS = [
  /\b(purchase|purchases|shared purchase|shared purchases|common purchases?)\b/i,
  /покупк/i
] as const

const UTILITIES_PATTERNS = [
  /\b(utilities|utility|gas|water|electricity|internet)\b/i,
  /коммун/i,
  /газ/i,
  /вод/i,
  /свет/i,
  /элект/i,
  /интернет/i
] as const

const RENT_PATTERNS = [/\b(rent|landlord|apartment)\b/i, /аренд/i, /жиль[её]/i] as const
const SELF_PATTERNS = [/\b(i|my|me)\b/i, /\bя\b/i, /\bмне\b/i, /\bмой\b/i, /\bмоя\b/i] as const
const QUESTION_PATTERNS = [
  /\?/,
  /\b(how much|what|who|which|and)\b/i,
  /сколько/i,
  /кто/i,
  /како/i,
  /\bу\b/i
] as const

function hasMatch(patterns: readonly RegExp[], value: string): boolean {
  return patterns.some((pattern) => pattern.test(value))
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’]s\b/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function aliasVariants(token: string): string[] {
  const aliases = new Set<string>([token])

  if (token.endsWith('а') && token.length > 2) {
    aliases.add(`${token.slice(0, -1)}ы`)
    aliases.add(`${token.slice(0, -1)}е`)
    aliases.add(`${token.slice(0, -1)}у`)
  }

  if (token.endsWith('я') && token.length > 2) {
    aliases.add(`${token.slice(0, -1)}и`)
    aliases.add(`${token.slice(0, -1)}ю`)
  }

  return [...aliases]
}

function memberAliases(member: HouseholdMemberRecord): string[] {
  const normalized = normalizeText(member.displayName)
  const tokens = normalized.split(' ').filter((token) => token.length >= 2)
  const aliases = new Set<string>([normalized, ...tokens])

  for (const token of tokens) {
    for (const alias of aliasVariants(token)) {
      aliases.add(alias)
    }
  }

  return [...aliases]
}

function inferMetric(
  rawText: string,
  recentTurns: readonly { role: 'user' | 'assistant'; text: string }[]
) {
  if (hasMatch(PURCHASE_PATTERNS, rawText)) {
    return 'purchase'
  }

  if (hasMatch(UTILITIES_PATTERNS, rawText)) {
    return 'utilities'
  }

  if (hasMatch(RENT_PATTERNS, rawText)) {
    return 'rent'
  }

  const lastUserTurn = [...recentTurns].reverse().find((turn) => turn.role === 'user')
  if (!lastUserTurn) {
    return null
  }

  return inferMetric(lastUserTurn.text, [])
}

function resolveTargetMember(input: {
  rawText: string
  currentMemberId: string
  members: readonly HouseholdMemberRecord[]
}): HouseholdMemberRecord | null {
  if (hasMatch(SELF_PATTERNS, input.rawText)) {
    return input.members.find((member) => member.id === input.currentMemberId) ?? null
  }

  const normalizedText = ` ${normalizeText(input.rawText)} `
  const candidates = input.members
    .map((member) => ({
      member,
      score: memberAliases(member).reduce((best, alias) => {
        const normalizedAlias = alias.trim()
        if (normalizedAlias.length < 2) {
          return best
        }

        if (
          normalizedText.includes(` ${normalizedAlias} `) ||
          normalizedText.endsWith(` ${normalizedAlias}`) ||
          normalizedText.startsWith(`${normalizedAlias} `)
        ) {
          return Math.max(best, normalizedAlias.length + 10)
        }

        if (normalizedAlias.length >= 3 && normalizedText.includes(normalizedAlias)) {
          return Math.max(best, normalizedAlias.length)
        }

        return best
      }, 0)
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)

  if (candidates[0]) {
    return candidates[0].member
  }

  return input.members.find((member) => member.id === input.currentMemberId) ?? null
}

function formatStatus(locale: BotLocale, status: HouseholdMemberLifecycleStatus): string {
  if (locale === 'ru') {
    switch (status) {
      case 'away':
        return 'в отъезде'
      case 'left':
        return 'выехал'
      default:
        return 'активен'
    }
  }

  switch (status) {
    case 'away':
      return 'away'
    case 'left':
      return 'left'
    default:
      return 'active'
  }
}

function rosterReply(locale: BotLocale, members: readonly HouseholdMemberRecord[]): string {
  const lines = members.map(
    (member) => `- ${member.displayName} (${formatStatus(locale, member.status)})`
  )

  if (locale === 'ru') {
    return `У нас в household сейчас:\n${lines.join('\n')}`
  }

  return `Current household members:\n${lines.join('\n')}`
}

function memberMetricReply(input: {
  locale: BotLocale
  metric: MemberBalanceMetric
  targetMember: HouseholdMemberRecord
  currentMemberId: string
  currency: 'GEL' | 'USD'
  values: {
    purchase: string
    utilities: string
    rent: string
  }
}): string {
  const isCurrentMember = input.targetMember.id === input.currentMemberId

  if (input.locale === 'ru') {
    switch (input.metric) {
      case 'purchase':
        return isCurrentMember
          ? `Твой баланс по общим покупкам: ${input.values.purchase} ${input.currency}.`
          : `Баланс ${input.targetMember.displayName} по общим покупкам: ${input.values.purchase} ${input.currency}.`
      case 'utilities':
        return isCurrentMember
          ? `Твоя коммуналка к оплате: ${input.values.utilities} ${input.currency}.`
          : `Коммуналка ${input.targetMember.displayName} к оплате: ${input.values.utilities} ${input.currency}.`
      case 'rent':
        return isCurrentMember
          ? `Твоя аренда к оплате: ${input.values.rent} ${input.currency}.`
          : `Аренда ${input.targetMember.displayName} к оплате: ${input.values.rent} ${input.currency}.`
    }
  }

  switch (input.metric) {
    case 'purchase':
      return isCurrentMember
        ? `Your shared purchase balance is ${input.values.purchase} ${input.currency}.`
        : `${input.targetMember.displayName}'s shared purchase balance is ${input.values.purchase} ${input.currency}.`
    case 'utilities':
      return isCurrentMember
        ? `Your utilities due is ${input.values.utilities} ${input.currency}.`
        : `${input.targetMember.displayName}'s utilities due is ${input.values.utilities} ${input.currency}.`
    case 'rent':
      return isCurrentMember
        ? `Your rent due is ${input.values.rent} ${input.currency}.`
        : `${input.targetMember.displayName}'s rent due is ${input.values.rent} ${input.currency}.`
  }
}

export async function maybeCreateMemberInsightReply(input: {
  rawText: string
  locale: BotLocale
  householdId: string
  currentMemberId: string
  householdConfigurationRepository: Pick<HouseholdConfigurationRepository, 'listHouseholdMembers'>
  financeService: FinanceCommandService
  recentTurns: readonly { role: 'user' | 'assistant'; text: string }[]
}): Promise<string | null> {
  const normalizedText = input.rawText.trim()
  if (normalizedText.length === 0) {
    return null
  }

  const members = await input.householdConfigurationRepository.listHouseholdMembers(
    input.householdId
  )
  if (members.length === 0) {
    return null
  }

  if (hasMatch(ROSTER_PATTERNS, normalizedText) && hasMatch(QUESTION_PATTERNS, normalizedText)) {
    return rosterReply(input.locale, members)
  }

  if (!hasMatch(QUESTION_PATTERNS, normalizedText)) {
    return null
  }

  const metric = inferMetric(normalizedText, input.recentTurns)
  if (!metric) {
    return null
  }

  const dashboard = await input.financeService.generateDashboard()
  if (!dashboard) {
    return null
  }

  const targetMember = resolveTargetMember({
    rawText: normalizedText,
    currentMemberId: input.currentMemberId,
    members
  })
  if (!targetMember) {
    return null
  }

  const memberLine = dashboard.members.find((member) => member.memberId === targetMember.id)
  if (!memberLine) {
    return null
  }

  return memberMetricReply({
    locale: input.locale,
    metric,
    targetMember,
    currentMemberId: input.currentMemberId,
    currency: dashboard.currency,
    values: {
      purchase: memberLine.purchaseOffset.toMajorString(),
      utilities: memberLine.utilityShare.toMajorString(),
      rent: memberLine.rentShare.toMajorString()
    }
  })
}
