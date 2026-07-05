import { instantFromEpochSeconds, Money, type Instant } from '@household/domain'
import type { Bot, Context } from 'grammy'
import type { Logger } from '@household/observability'
import type { HouseholdAuditNotificationService } from '@household/application'
import type {
  HouseholdConfigurationRepository,
  HouseholdTopicBindingRecord,
  TopicMessageHistoryRepository
} from '@household/ports'

import { getBotTranslations, type BotLocale } from './i18n'
import type {
  PurchaseInterpretationAmountSource,
  PurchaseInterpretation,
  PurchaseMessageInterpreter
} from './openai-purchase-interpreter'
import {
  hasTelegramMessageAttachment,
  readTelegramMessageTextWithoutBotMention
} from './topic-ingestion/topic-message-primitives'
import {
  persistTopicHistoryMessage,
  telegramMessageIdFromMessage,
  telegramMessageSentAtFromMessage
} from './topic-history'
import type { PurchaseTopicNoticeService } from './purchase-topic-notices'

const PURCHASE_CONFIRM_CALLBACK_PREFIX = 'purchase:confirm:'
const PURCHASE_CANCEL_CALLBACK_PREFIX = 'purchase:cancel:'
const PURCHASE_PARTICIPANT_CALLBACK_PREFIX = 'purchase:participant:'
const PURCHASE_PAYER_CALLBACK_PREFIX = 'purchase:payer:'
const PURCHASE_FIX_AMOUNT_CALLBACK_PREFIX = 'purchase:fix_amount:'
const PHOTO_ONLY_PURCHASE_PLACEHOLDER = '[photo]'
const EXPLICIT_PARTICIPANT_SUBSET_PATTERN =
  /\b(?:split\s+(?:with|between)|share\s+with|for\s+(?:me|us|myself)\s+and|for\s+me\s+only|only\s+for|just\s+for)\b|(?:^|[^\p{L}])(?:на\s+нас|для\s+(?:меня|нас|себя)\s+и|только\s+(?:для|на)|лишь\s+(?:для|на)|между\s+нами|делим\s+(?:с|между)|раздели(?:ть|м)?\s+(?:с|между))(?=$|[^\p{L}])/iu

interface PurchaseProposalFields {
  parsedAmountMinor: bigint | null
  parsedCurrency: 'GEL' | 'USD' | null
  parsedItemDescription: string | null
  payerMemberId?: string | null
  payerDisplayName?: string | null
  amountSource?: PurchaseInterpretationAmountSource | null
  calculationExplanation?: string | null
  parserConfidence: number | null
  parserMode: 'llm' | null
}

interface PurchaseProposalPayerCandidate {
  memberId: string
  displayName: string
}

interface PurchaseClarificationResult extends PurchaseProposalFields {
  status: 'clarification_needed'
  purchaseMessageId: string
  clarificationQuestion: string | null
  payerCandidates?: readonly PurchaseProposalPayerCandidate[]
}

interface PurchasePendingConfirmationResult extends PurchaseProposalFields {
  status: 'pending_confirmation'
  purchaseMessageId: string
  parsedAmountMinor: bigint
  parsedCurrency: 'GEL' | 'USD'
  parsedItemDescription: string
  parserConfidence: number
  parserMode: 'llm'
  participants: readonly PurchaseProposalParticipant[]
}

interface PurchaseProposalParticipant {
  id: string
  memberId: string
  displayName: string
  included: boolean
  memberStatus?: 'active' | 'away' | 'left'
}

export type PurchaseProposalPayerSelectionResult =
  | ({
      status: 'selected'
      purchaseMessageId: string
      householdId: string
      participants: readonly PurchaseProposalParticipant[]
    } & PurchaseProposalFields)
  | {
      status: 'forbidden'
      householdId: string
    }
  | {
      status: 'not_pending'
      householdId: string
    }
  | {
      status: 'not_found'
    }

export interface PurchaseTopicCandidate {
  updateId: number
  chatId: string
  messageId: string
  threadId: string
  senderTelegramUserId: string
  senderDisplayName?: string
  rawText: string
  messageSentAt: Instant
}

export interface PurchaseTopicRecord extends PurchaseTopicCandidate {
  householdId: string
}

export type PurchaseMessageIngestionResult =
  | {
      status: 'duplicate'
    }
  | {
      status: 'ignored_not_purchase'
      purchaseMessageId: string
    }
  | PurchaseClarificationResult
  | PurchasePendingConfirmationResult
  | {
      status: 'parse_failed'
      purchaseMessageId: string
    }

export type PurchaseProposalActionResult =
  | ({
      status: 'confirmed' | 'already_confirmed' | 'cancelled' | 'already_cancelled'
      purchaseMessageId: string
      householdId: string
      participants: readonly PurchaseProposalParticipant[]
    } & PurchaseProposalFields)
  | {
      status: 'forbidden'
      householdId: string
    }
  | {
      status: 'not_pending'
      householdId: string
    }
  | {
      status: 'not_found'
    }

export type PurchaseProposalParticipantToggleResult =
  | ({
      status: 'updated'
      purchaseMessageId: string
      householdId: string
      participants: readonly PurchaseProposalParticipant[]
    } & PurchaseProposalFields)
  | {
      status: 'at_least_one_required'
      householdId: string
    }
  | {
      status: 'forbidden'
      householdId: string
    }
  | {
      status: 'not_pending'
      householdId: string
    }
  | {
      status: 'not_editable'
      householdId: string
    }
  | {
      status: 'not_found'
    }

export type PurchaseProposalAmountCorrectionResult =
  | {
      status: 'requested'
      purchaseMessageId: string
      householdId: string
    }
  | {
      status: 'already_requested'
      purchaseMessageId: string
      householdId: string
    }
  | {
      status: 'forbidden'
      householdId: string
    }
  | {
      status: 'not_pending'
      householdId: string
    }
  | {
      status: 'not_found'
    }

export interface PurchaseMessageIngestionRepository {
  hasClarificationContext(record: PurchaseTopicRecord): Promise<boolean>
  clearClarificationContext?(record: PurchaseTopicRecord): Promise<void>
  /**
   * @deprecated Use saveWithInterpretation instead. This method will be removed.
   */
  save(
    record: PurchaseTopicRecord,
    interpreter?: PurchaseMessageInterpreter,
    defaultCurrency?: 'GEL' | 'USD',
    options?: {
      householdContext?: string | null
      assistantTone?: string | null
    }
  ): Promise<PurchaseMessageIngestionResult>
  saveWithInterpretation(
    record: PurchaseTopicRecord,
    interpretation: PurchaseInterpretation
  ): Promise<PurchaseMessageIngestionResult>
  confirm(
    purchaseMessageId: string,
    actorTelegramUserId: string
  ): Promise<PurchaseProposalActionResult>
  cancel(
    purchaseMessageId: string,
    actorTelegramUserId: string
  ): Promise<PurchaseProposalActionResult>
  toggleParticipant(
    participantId: string,
    actorTelegramUserId: string
  ): Promise<PurchaseProposalParticipantToggleResult>
  selectPayer?(
    purchaseMessageId: string,
    memberId: string,
    actorTelegramUserId: string
  ): Promise<PurchaseProposalPayerSelectionResult>
  requestAmountCorrection?(
    purchaseMessageId: string,
    actorTelegramUserId: string
  ): Promise<PurchaseProposalAmountCorrectionResult>
}

export interface PurchasePersistenceDecision {
  status: 'pending_confirmation' | 'clarification_needed' | 'ignored_not_purchase' | 'parse_failed'
  parsedAmountMinor: bigint | null
  parsedCurrency: 'GEL' | 'USD' | null
  parsedItemDescription: string | null
  payerMemberId: string | null
  payerCandidateMemberIds: readonly string[] | null
  amountSource: PurchaseInterpretationAmountSource | null
  calculationExplanation: string | null
  participantMemberIds: readonly string[] | null
  parserConfidence: number | null
  parserMode: 'llm' | null
  clarificationQuestion: string | null
  parserError: string | null
  needsReview: boolean
}

export function explicitPurchaseParticipantMemberIds(input: {
  rawText: string
  participantMemberIds: readonly string[] | null
}): readonly string[] | null {
  if (!input.participantMemberIds || input.participantMemberIds.length === 0) {
    return null
  }

  return EXPLICIT_PARTICIPANT_SUBSET_PATTERN.test(input.rawText) ? input.participantMemberIds : null
}

export function resolveProposalParticipantSelection(input: {
  members: readonly {
    memberId: string
    telegramUserId: string | null
    displayName?: string
    lifecycleStatus: 'active' | 'away' | 'left'
  }[]
  senderTelegramUserId: string
  senderMemberId: string | null
  payerMemberId?: string | null
  explicitParticipantMemberIds: readonly string[] | null
}): readonly { memberId: string; included: boolean }[] {
  const eligibleMembers = input.members.filter((member) => member.lifecycleStatus !== 'left')
  const activeMembers = eligibleMembers.filter((member) => member.lifecycleStatus === 'active')
  if (input.explicitParticipantMemberIds && input.explicitParticipantMemberIds.length > 0) {
    const explicitMemberIds = new Set(input.explicitParticipantMemberIds)
    const explicitParticipants = eligibleMembers.map((member) => ({
      memberId: member.memberId,
      included: member.lifecycleStatus === 'active' && explicitMemberIds.has(member.memberId)
    }))

    if (explicitParticipants.some((participant) => participant.included)) {
      return explicitParticipants
    }

    const fallbackParticipant =
      activeMembers.find((member) => member.memberId === input.payerMemberId) ??
      activeMembers.find((member) => member.memberId === input.senderMemberId) ??
      activeMembers.find((member) => member.telegramUserId === input.senderTelegramUserId) ??
      activeMembers[0]

    return explicitParticipants.map(({ memberId }) => ({
      memberId,
      included: memberId === fallbackParticipant?.memberId
    }))
  }

  const participants = eligibleMembers.map((member) => {
    return {
      memberId: member.memberId,
      telegramUserId: member.telegramUserId,
      included: member.lifecycleStatus === 'active'
    }
  })

  if (participants.length === 0) {
    return []
  }

  if (participants.some((participant) => participant.included)) {
    return participants.map(({ memberId, included }) => ({
      memberId,
      included
    }))
  }

  return participants.map(({ memberId }) => ({
    memberId,
    included: false
  }))
}

function normalizeMemberText(value: string): string {
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

function memberAliases(displayName: string): string[] {
  const normalized = normalizeMemberText(displayName)
  const tokens = normalized.split(' ').filter((token) => token.length >= 2)
  const aliases = new Set<string>([normalized, ...tokens])

  for (const token of tokens) {
    for (const alias of aliasVariants(token)) {
      aliases.add(alias)
    }
  }

  return [...aliases]
}

export function resolvePurchasePayer(input: {
  rawText: string
  members: readonly {
    memberId: string
    displayName: string
    status: 'active' | 'away' | 'left'
  }[]
  senderMemberId: string | null
}):
  | {
      status: 'resolved'
      payerMemberId: string | null
      payerCandidateMemberIds: null
    }
  | {
      status: 'ambiguous'
      payerMemberId: null
      payerCandidateMemberIds: readonly string[]
    } {
  const nonLeftMembers = input.members.filter((member) => member.status !== 'left')
  const eligibleMembers = nonLeftMembers.filter((member) => member.status === 'active')
  const senderIsEligible = eligibleMembers.some(
    (member) => member.memberId === input.senderMemberId
  )
  const normalizedText = normalizeMemberText(input.rawText)

  if (normalizedText.length === 0) {
    if (senderIsEligible) {
      return {
        status: 'resolved',
        payerMemberId: input.senderMemberId,
        payerCandidateMemberIds: null
      }
    }

    return {
      status: 'ambiguous',
      payerMemberId: null,
      payerCandidateMemberIds: eligibleMembers.map((member) => member.memberId)
    }
  }

  if (eligibleMembers.length === 0) {
    return {
      status: 'ambiguous',
      payerMemberId: null,
      payerCandidateMemberIds: []
    }
  }

  const mentionsMember = (member: { displayName: string }) =>
    memberAliases(member.displayName).some((alias) => {
      const pattern = new RegExp(
        `(^|\\s)${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`,
        'u'
      )
      return pattern.test(normalizedText)
    })
  const mentionedMembers = eligibleMembers.filter(mentionsMember)
  const mentionedInactiveMembers = nonLeftMembers.filter(
    (member) => member.status !== 'active' && mentionsMember(member)
  )

  if (mentionedMembers.length === 0) {
    if (mentionedInactiveMembers.length > 0) {
      return {
        status: 'ambiguous',
        payerMemberId: null,
        payerCandidateMemberIds: eligibleMembers.map((member) => member.memberId)
      }
    }

    if (senderIsEligible) {
      return {
        status: 'resolved',
        payerMemberId: input.senderMemberId,
        payerCandidateMemberIds: null
      }
    }

    return {
      status: 'ambiguous',
      payerMemberId: null,
      payerCandidateMemberIds: eligibleMembers.map((member) => member.memberId)
    }
  }

  if (mentionedMembers.length === 1) {
    return {
      status: 'resolved',
      payerMemberId: mentionedMembers[0]!.memberId,
      payerCandidateMemberIds: null
    }
  }

  return {
    status: 'ambiguous',
    payerMemberId: null,
    payerCandidateMemberIds: mentionedMembers.map((member) => member.memberId)
  }
}

export function finalizePayerDecision(input: {
  decision: PurchasePersistenceDecision
  rawText: string
  householdMembers: readonly {
    memberId: string
    displayName: string
    status: 'active' | 'away' | 'left'
  }[]
  senderMemberId: string | null
}): PurchasePersistenceDecision {
  if (
    input.decision.status === 'ignored_not_purchase' ||
    input.decision.status === 'parse_failed'
  ) {
    return input.decision
  }

  const activePayerMemberIds = new Set(
    input.householdMembers
      .filter((member) => member.status === 'active')
      .map((member) => member.memberId)
  )

  if (input.decision.payerMemberId && activePayerMemberIds.has(input.decision.payerMemberId)) {
    return input.decision
  }

  const hasInactiveInterpreterPayer = Boolean(input.decision.payerMemberId)
  const decision = hasInactiveInterpreterPayer
    ? {
        ...input.decision,
        payerMemberId: null,
        needsReview: true
      }
    : input.decision
  const payerResolution = hasInactiveInterpreterPayer
    ? {
        status: 'ambiguous' as const,
        payerMemberId: null,
        payerCandidateMemberIds: [...activePayerMemberIds]
      }
    : resolvePurchasePayer({
        rawText: input.rawText,
        members: input.householdMembers,
        senderMemberId: input.senderMemberId
      })

  if (payerResolution.status === 'resolved' && payerResolution.payerMemberId) {
    return {
      ...decision,
      payerMemberId: payerResolution.payerMemberId,
      payerCandidateMemberIds: null
    }
  }

  const canAskWithButtons =
    decision.parsedAmountMinor !== null &&
    decision.parsedCurrency !== null &&
    decision.parsedItemDescription !== null

  return {
    ...decision,
    status: canAskWithButtons ? 'clarification_needed' : decision.status,
    payerMemberId: null,
    payerCandidateMemberIds:
      canAskWithButtons && payerResolution.status === 'ambiguous'
        ? payerResolution.payerCandidateMemberIds
        : null,
    clarificationQuestion:
      canAskWithButtons && decision.clarificationQuestion === null
        ? null
        : decision.clarificationQuestion,
    needsReview: true
  }
}

function canToggleProposalParticipant(participant: PurchaseProposalParticipant): boolean {
  return (
    participant.included ||
    participant.memberStatus === undefined ||
    participant.memberStatus === 'active'
  )
}

export function canConfirmActivePurchaseProposal(input: {
  payerMemberId: string | null
  participants: readonly {
    memberId: string
    included: boolean
  }[]
  members: readonly {
    memberId: string
    status: 'active' | 'away' | 'left'
  }[]
}): boolean {
  const activeMemberIds = new Set(
    input.members.filter((member) => member.status === 'active').map((member) => member.memberId)
  )
  const includedParticipants = input.participants.filter((participant) => participant.included)

  return (
    input.payerMemberId !== null &&
    activeMemberIds.has(input.payerMemberId) &&
    includedParticipants.length > 0 &&
    includedParticipants.every((participant) => activeMemberIds.has(participant.memberId))
  )
}

async function replyToPurchaseMessage(
  ctx: Context,
  text: string,
  replyMarkup?: {
    inline_keyboard: Array<
      Array<{
        text: string
        callback_data: string
      }>
    >
  },
  history?: {
    repository: TopicMessageHistoryRepository | undefined
    record: PurchaseTopicRecord
  }
): Promise<void> {
  const message = ctx.msg
  if (!message) {
    return
  }

  const reply = await ctx.reply(text, {
    reply_parameters: {
      message_id: message.message_id
    },
    ...(replyMarkup
      ? {
          reply_markup: replyMarkup
        }
      : {})
  })

  await persistTopicHistoryMessage({
    repository: history?.repository,
    householdId: history?.record.householdId ?? '',
    telegramChatId: history?.record.chatId ?? '',
    telegramThreadId: history?.record.threadId ?? null,
    telegramMessageId: telegramMessageIdFromMessage(reply),
    telegramUpdateId: null,
    senderTelegramUserId: ctx.me?.id?.toString() ?? null,
    senderDisplayName: null,
    isBot: true,
    rawText: text,
    messageSentAt: telegramMessageSentAtFromMessage(reply)
  })
}

function isPhotoOnlyPurchaseMessage(record: PurchaseTopicRecord): boolean {
  return record.rawText === PHOTO_ONLY_PURCHASE_PLACEHOLDER
}

function photoOnlyPurchaseInterpretation(locale: BotLocale): PurchaseInterpretation {
  return {
    decision: 'clarification',
    amountMinor: null,
    currency: null,
    itemDescription: null,
    payerMemberId: null,
    confidence: 0,
    parserMode: 'llm',
    clarificationQuestion: getBotTranslations(locale).purchase.clarificationPhotoOnly
  }
}

async function finalizePurchaseReply(
  ctx: Context,
  text: string | null,
  replyMarkup?: {
    inline_keyboard: Array<
      Array<{
        text: string
        callback_data: string
      }>
    >
  },
  history?: {
    repository: TopicMessageHistoryRepository | undefined
    record: PurchaseTopicRecord
  }
): Promise<void> {
  if (!text) {
    return
  }

  await replyToPurchaseMessage(ctx, text, replyMarkup, history)
}

function toCandidateFromContext(ctx: Context): PurchaseTopicCandidate | null {
  const message = ctx.message
  const rawText =
    readTelegramMessageTextWithoutBotMention(ctx) ??
    (hasTelegramMessageAttachment(ctx) ? PHOTO_ONLY_PURCHASE_PLACEHOLDER : null)
  if (!message || !rawText) {
    return null
  }

  if (!message.is_topic_message || message.message_thread_id === undefined) {
    return null
  }

  const senderTelegramUserId = ctx.from?.id?.toString()
  if (!senderTelegramUserId) {
    return null
  }

  const senderDisplayName = [ctx.from?.first_name, ctx.from?.last_name]
    .filter((part) => !!part && part.trim().length > 0)
    .join(' ')

  const candidate: PurchaseTopicCandidate = {
    updateId: ctx.update.update_id,
    chatId: message.chat.id.toString(),
    messageId: message.message_id.toString(),
    threadId: message.message_thread_id.toString(),
    senderTelegramUserId,
    rawText,
    messageSentAt: instantFromEpochSeconds(message.date)
  }

  if (senderDisplayName.length > 0) {
    candidate.senderDisplayName = senderDisplayName
  }

  return candidate
}

export function resolveConfiguredPurchaseTopicRecord(
  value: PurchaseTopicCandidate,
  binding: HouseholdTopicBindingRecord
): PurchaseTopicRecord | null {
  if (value.rawText.trim().startsWith('/')) {
    return null
  }

  if (binding.role !== 'purchase') {
    return null
  }

  const normalizedText = value.rawText.trim()
  if (normalizedText.length === 0) {
    return null
  }

  return {
    ...value,
    rawText: normalizedText,
    householdId: binding.householdId
  }
}

function formatPurchaseSummary(
  locale: BotLocale,
  result: {
    parsedAmountMinor: bigint | null
    parsedCurrency: 'GEL' | 'USD' | null
    parsedItemDescription: string | null
  }
): string {
  if (
    result.parsedAmountMinor === null ||
    result.parsedCurrency === null ||
    result.parsedItemDescription === null
  ) {
    return getBotTranslations(locale).purchase.sharedPurchaseFallback
  }

  const amount = Money.fromMinor(result.parsedAmountMinor, result.parsedCurrency)
  return `${result.parsedItemDescription} - ${amount.toMajorString()} ${result.parsedCurrency}`
}

function clarificationFallback(locale: BotLocale, result: PurchaseClarificationResult): string {
  const t = getBotTranslations(locale).purchase

  if (result.parsedAmountMinor === null && result.parsedCurrency === null) {
    return t.clarificationMissingAmountAndCurrency
  }

  if (result.parsedAmountMinor === null) {
    return t.clarificationMissingAmount
  }

  if (result.parsedCurrency === null) {
    return t.clarificationMissingCurrency
  }

  if (result.parsedItemDescription === null) {
    return t.clarificationMissingItem
  }

  return t.clarificationLowConfidence
}

function formatPurchaseParticipants(
  locale: BotLocale,
  participants: readonly PurchaseProposalParticipant[]
): string | null {
  if (participants.length === 0) {
    return null
  }

  const t = getBotTranslations(locale).purchase
  const lines = participants.map((participant) =>
    participant.included
      ? t.participantIncluded(participant.displayName)
      : t.participantExcluded(participant.displayName)
  )

  return `${t.participantsHeading}\n${lines.join('\n')}`
}

function formatPurchaseCalculationNote(
  locale: BotLocale,
  result: {
    amountSource?: PurchaseInterpretationAmountSource | null
    calculationExplanation?: string | null
  }
): string | null {
  if (result.amountSource !== 'calculated') {
    return null
  }

  const t = getBotTranslations(locale).purchase
  return t.calculatedAmountNote(result.calculationExplanation ?? null)
}

function formatPurchasePayer(
  locale: BotLocale,
  result: {
    payerDisplayName?: string | null
  }
): string | null {
  if (!result.payerDisplayName) {
    return null
  }

  return getBotTranslations(locale).purchase.payerSelected(result.payerDisplayName)
}

export function buildPurchaseAcknowledgement(
  result: PurchaseMessageIngestionResult,
  locale: BotLocale = 'en'
): string | null {
  const t = getBotTranslations(locale).purchase

  switch (result.status) {
    case 'duplicate':
    case 'ignored_not_purchase':
      return null
    case 'pending_confirmation':
      return t.proposal(
        formatPurchaseSummary(locale, result),
        formatPurchasePayer(locale, result),
        formatPurchaseCalculationNote(locale, result),
        formatPurchaseParticipants(locale, result.participants)
      )
    case 'clarification_needed':
      return t.clarification(
        result.clarificationQuestion ??
          (result.payerCandidates && result.payerCandidates.length > 0
            ? t.payerFallbackQuestion
            : clarificationFallback(locale, result))
      )
    case 'parse_failed':
      return t.parseFailed
  }
}

function purchaseProposalReplyMarkup(
  locale: BotLocale,
  options: {
    amountSource?: PurchaseInterpretationAmountSource | null
  },
  purchaseMessageId: string,
  participants: readonly PurchaseProposalParticipant[]
) {
  const t = getBotTranslations(locale).purchase

  return {
    inline_keyboard: [
      ...participants.filter(canToggleProposalParticipant).map((participant) => [
        {
          text: participant.included
            ? t.participantToggleIncluded(participant.displayName)
            : t.participantToggleExcluded(participant.displayName),
          callback_data: `${PURCHASE_PARTICIPANT_CALLBACK_PREFIX}${participant.id}`
        }
      ]),
      [
        {
          text: options.amountSource === 'calculated' ? t.calculatedConfirmButton : t.confirmButton,
          callback_data: `${PURCHASE_CONFIRM_CALLBACK_PREFIX}${purchaseMessageId}`
        },
        ...(options.amountSource === 'calculated'
          ? [
              {
                text: t.calculatedFixAmountButton,
                callback_data: `${PURCHASE_FIX_AMOUNT_CALLBACK_PREFIX}${purchaseMessageId}`
              }
            ]
          : []),
        {
          text: t.cancelButton,
          callback_data: `${PURCHASE_CANCEL_CALLBACK_PREFIX}${purchaseMessageId}`
        }
      ]
    ]
  }
}

async function resolveHouseholdLocale(
  householdConfigurationRepository: HouseholdConfigurationRepository | undefined,
  householdId: string
): Promise<BotLocale> {
  if (!householdConfigurationRepository) {
    return 'en'
  }

  const householdChat =
    await householdConfigurationRepository.getHouseholdChatByHouseholdId(householdId)
  return householdChat?.defaultLocale ?? 'en'
}

export async function handlePurchaseMessageResult(
  ctx: Context,
  record: PurchaseTopicRecord,
  result: PurchaseMessageIngestionResult,
  locale: BotLocale,
  logger: Logger | undefined,
  historyRepository?: TopicMessageHistoryRepository
): Promise<void> {
  if (result.status !== 'duplicate') {
    logger?.info(
      {
        event: 'purchase.ingested',
        householdId: record.householdId,
        status: result.status,
        chatId: record.chatId,
        threadId: record.threadId,
        messageId: record.messageId,
        updateId: record.updateId,
        senderTelegramUserId: record.senderTelegramUserId
      },
      'Purchase topic message processed'
    )
  }

  const acknowledgement = buildPurchaseAcknowledgement(result, locale)
  await finalizePurchaseReply(
    ctx,
    acknowledgement,
    result.status === 'pending_confirmation'
      ? purchaseProposalReplyMarkup(
          locale,
          {
            amountSource: result.amountSource ?? null
          },
          result.purchaseMessageId,
          result.participants
        )
      : result.status === 'clarification_needed' &&
          result.payerCandidates &&
          result.payerCandidates.length > 0
        ? purchaseClarificationReplyMarkup(locale, result.purchaseMessageId, result.payerCandidates)
        : result.status === 'clarification_needed'
          ? purchaseCancelOnlyReplyMarkup(locale, result.purchaseMessageId)
          : undefined,
    historyRepository
      ? {
          repository: historyRepository,
          record
        }
      : undefined
  )
}

function emptyInlineKeyboard() {
  return {
    inline_keyboard: []
  }
}

function purchaseCancelOnlyReplyMarkup(locale: BotLocale, purchaseMessageId: string) {
  const t = getBotTranslations(locale).purchase

  return {
    inline_keyboard: [
      [
        {
          text: t.cancelButton,
          callback_data: `${PURCHASE_CANCEL_CALLBACK_PREFIX}${purchaseMessageId}`
        }
      ]
    ]
  }
}

function buildPurchaseActionMessage(
  locale: BotLocale,
  result: Extract<
    PurchaseProposalActionResult,
    { status: 'confirmed' | 'already_confirmed' | 'cancelled' | 'already_cancelled' }
  >
): string {
  const t = getBotTranslations(locale).purchase
  const summary = formatPurchaseSummary(locale, result)
  const participants =
    'participants' in result ? formatPurchaseParticipants(locale, result.participants) : null

  if (result.status === 'confirmed' || result.status === 'already_confirmed') {
    return participants ? `${t.confirmed(summary)}\n\n${participants}` : t.confirmed(summary)
  }

  return t.cancelled(summary)
}

function buildPurchaseToggleMessage(
  locale: BotLocale,
  result: Extract<PurchaseProposalParticipantToggleResult, { status: 'updated' }>
): string {
  return getBotTranslations(locale).purchase.proposal(
    formatPurchaseSummary(locale, result),
    formatPurchasePayer(locale, result),
    null,
    formatPurchaseParticipants(locale, result.participants)
  )
}

function buildPurchasePayerSelectionMessage(
  locale: BotLocale,
  result: Extract<PurchaseProposalPayerSelectionResult, { status: 'selected' }>
): string {
  return getBotTranslations(locale).purchase.proposal(
    formatPurchaseSummary(locale, result),
    formatPurchasePayer(locale, result),
    null,
    formatPurchaseParticipants(locale, result.participants)
  )
}

function purchaseClarificationReplyMarkup(
  locale: BotLocale,
  purchaseMessageId: string,
  payerCandidates: readonly PurchaseProposalPayerCandidate[]
) {
  const t = getBotTranslations(locale).purchase

  return {
    inline_keyboard: [
      ...payerCandidates.map((candidate) => [
        {
          text: t.payerButton(candidate.displayName),
          callback_data: `${PURCHASE_PAYER_CALLBACK_PREFIX}${purchaseMessageId}:${candidate.memberId}`
        }
      ]),
      [
        {
          text: t.cancelButton,
          callback_data: `${PURCHASE_CANCEL_CALLBACK_PREFIX}${purchaseMessageId}`
        }
      ]
    ]
  }
}

function registerPurchaseProposalCallbacks(
  bot: Bot,
  repository: PurchaseMessageIngestionRepository,
  resolveLocale: (householdId: string) => Promise<BotLocale>,
  logger?: Logger,
  auditNotificationService?: HouseholdAuditNotificationService,
  purchaseTopicNoticeService?: PurchaseTopicNoticeService
): void {
  bot.callbackQuery(
    new RegExp(`^${PURCHASE_PAYER_CALLBACK_PREFIX}([^:]+):([^:]+)$`),
    async (ctx) => {
      const purchaseMessageId = ctx.match[1]
      const memberId = ctx.match[2]
      const actorTelegramUserId = ctx.from?.id?.toString()

      if (!repository.selectPayer || !actorTelegramUserId || !purchaseMessageId || !memberId) {
        await ctx.answerCallbackQuery({
          text: getBotTranslations('en').purchase.proposalUnavailable,
          show_alert: true
        })
        return
      }

      const result = await repository.selectPayer(purchaseMessageId, memberId, actorTelegramUserId)
      const locale = 'householdId' in result ? await resolveLocale(result.householdId) : 'en'
      const t = getBotTranslations(locale).purchase

      if (result.status === 'not_found' || result.status === 'not_pending') {
        await ctx.answerCallbackQuery({
          text: t.proposalUnavailable,
          show_alert: true
        })
        return
      }

      if (result.status === 'forbidden') {
        await ctx.answerCallbackQuery({
          text: t.notYourProposal,
          show_alert: true
        })
        return
      }

      await ctx.answerCallbackQuery({
        text: t.payerSelectedToast(result.payerDisplayName ?? memberId)
      })

      if (ctx.msg) {
        await ctx.editMessageText(buildPurchasePayerSelectionMessage(locale, result), {
          reply_markup: purchaseProposalReplyMarkup(
            locale,
            {
              amountSource: result.amountSource ?? null
            },
            result.purchaseMessageId,
            result.participants
          )
        })
      }

      logger?.info(
        {
          event: 'purchase.payer_selected',
          purchaseMessageId,
          memberId,
          actorTelegramUserId
        },
        'Purchase proposal payer selected'
      )
    }
  )

  bot.callbackQuery(new RegExp(`^${PURCHASE_PARTICIPANT_CALLBACK_PREFIX}([^:]+)$`), async (ctx) => {
    const participantId = ctx.match[1]
    const actorTelegramUserId = ctx.from?.id?.toString()

    if (!actorTelegramUserId || !participantId) {
      await ctx.answerCallbackQuery({
        text: getBotTranslations('en').purchase.proposalUnavailable,
        show_alert: true
      })
      return
    }

    const result = await repository.toggleParticipant(participantId, actorTelegramUserId)
    const locale = 'householdId' in result ? await resolveLocale(result.householdId) : 'en'
    const t = getBotTranslations(locale).purchase

    if (
      result.status === 'not_found' ||
      result.status === 'not_pending' ||
      result.status === 'not_editable'
    ) {
      await ctx.answerCallbackQuery({
        text: t.proposalUnavailable,
        show_alert: true
      })
      return
    }

    if (result.status === 'forbidden') {
      await ctx.answerCallbackQuery({
        text: t.notYourProposal,
        show_alert: true
      })
      return
    }

    if (result.status === 'at_least_one_required') {
      await ctx.answerCallbackQuery({
        text: t.atLeastOneParticipant,
        show_alert: true
      })
      return
    }

    await ctx.answerCallbackQuery()

    if (ctx.msg) {
      await ctx.editMessageText(buildPurchaseToggleMessage(locale, result), {
        reply_markup: purchaseProposalReplyMarkup(
          locale,
          {
            amountSource: result.amountSource ?? null
          },
          result.purchaseMessageId,
          result.participants
        )
      })
    }

    logger?.info(
      {
        event: 'purchase.participant_toggled',
        participantId,
        purchaseMessageId: result.purchaseMessageId,
        actorTelegramUserId
      },
      'Purchase proposal participant toggled'
    )
  })

  bot.callbackQuery(new RegExp(`^${PURCHASE_CONFIRM_CALLBACK_PREFIX}([^:]+)$`), async (ctx) => {
    const purchaseMessageId = ctx.match[1]
    const actorTelegramUserId = ctx.from?.id?.toString()

    if (!actorTelegramUserId || !purchaseMessageId) {
      await ctx.answerCallbackQuery({
        text: getBotTranslations('en').purchase.proposalUnavailable,
        show_alert: true
      })
      return
    }

    const result = await repository.confirm(purchaseMessageId, actorTelegramUserId)
    const locale = 'householdId' in result ? await resolveLocale(result.householdId) : 'en'
    const t = getBotTranslations(locale).purchase

    if (result.status === 'not_found' || result.status === 'not_pending') {
      await ctx.answerCallbackQuery({
        text: t.proposalUnavailable,
        show_alert: true
      })
      return
    }

    if (result.status === 'forbidden') {
      await ctx.answerCallbackQuery({
        text: t.notYourProposal,
        show_alert: true
      })
      return
    }

    await ctx.answerCallbackQuery({
      text: result.status === 'confirmed' ? t.confirmedToast : t.alreadyConfirmed
    })

    if (ctx.msg) {
      const message = ctx.callbackQuery.message
      const replaced =
        result.status === 'confirmed' && message && purchaseTopicNoticeService
          ? await purchaseTopicNoticeService.replaceExistingPurchaseMessage({
              householdId: result.householdId,
              purchaseId: result.purchaseMessageId,
              telegramChatId: String(message.chat.id),
              telegramThreadId:
                message.message_thread_id !== undefined ? String(message.message_thread_id) : '',
              telegramMessageId: String(message.message_id)
            })
          : false

      if (!replaced) {
        await ctx.editMessageText(buildPurchaseActionMessage(locale, result), {
          reply_markup: emptyInlineKeyboard()
        })
      }
    }

    if (result.status === 'confirmed' && auditNotificationService) {
      const amountText =
        result.parsedAmountMinor !== null && result.parsedCurrency
          ? `${Money.fromMinor(result.parsedAmountMinor, result.parsedCurrency).toMajorString()} ${
              result.parsedCurrency
            }`
          : ''
      await auditNotificationService.recordEvent({
        householdId: result.householdId,
        actorMemberId: null,
        actorDisplayName: ctx.from?.first_name ?? 'Someone',
        eventType: 'purchase.confirmed',
        category: 'purchase_events',
        summaryText: `${ctx.from?.first_name ?? 'Someone'} confirmed purchase: ${
          result.parsedItemDescription ?? 'shared purchase'
        } ${amountText}`.trim(),
        metadata: {
          purchaseMessageId: result.purchaseMessageId,
          actorTelegramUserId,
          amountMinor: result.parsedAmountMinor?.toString() ?? null,
          currency: result.parsedCurrency,
          description: result.parsedItemDescription
        }
      })
    }

    logger?.info(
      {
        event: 'purchase.confirmation',
        purchaseMessageId,
        actorTelegramUserId,
        status: result.status
      },
      'Purchase proposal confirmation handled'
    )
  })

  bot.callbackQuery(new RegExp(`^${PURCHASE_FIX_AMOUNT_CALLBACK_PREFIX}([^:]+)$`), async (ctx) => {
    const purchaseMessageId = ctx.match[1]
    const actorTelegramUserId = ctx.from?.id?.toString()

    if (!actorTelegramUserId || !purchaseMessageId) {
      await ctx.answerCallbackQuery({
        text: getBotTranslations('en').purchase.proposalUnavailable,
        show_alert: true
      })
      return
    }

    if (!repository.requestAmountCorrection) {
      await ctx.answerCallbackQuery({
        text: getBotTranslations('en').purchase.proposalUnavailable,
        show_alert: true
      })
      return
    }

    const result = await repository.requestAmountCorrection(purchaseMessageId, actorTelegramUserId)
    const locale = 'householdId' in result ? await resolveLocale(result.householdId) : 'en'
    const t = getBotTranslations(locale).purchase

    if (result.status === 'not_found' || result.status === 'not_pending') {
      await ctx.answerCallbackQuery({
        text: t.proposalUnavailable,
        show_alert: true
      })
      return
    }

    if (result.status === 'forbidden') {
      await ctx.answerCallbackQuery({
        text: t.notYourProposal,
        show_alert: true
      })
      return
    }

    await ctx.answerCallbackQuery({
      text:
        result.status === 'requested'
          ? t.calculatedFixAmountRequestedToast
          : t.calculatedFixAmountAlreadyRequested
    })

    if (ctx.msg) {
      await ctx.editMessageText(t.calculatedFixAmountPrompt, {
        reply_markup: purchaseCancelOnlyReplyMarkup(locale, purchaseMessageId)
      })
    }

    logger?.info(
      {
        event: 'purchase.amount_correction_requested',
        purchaseMessageId,
        actorTelegramUserId,
        status: result.status
      },
      'Purchase amount correction requested'
    )
  })

  bot.callbackQuery(new RegExp(`^${PURCHASE_CANCEL_CALLBACK_PREFIX}([^:]+)$`), async (ctx) => {
    const purchaseMessageId = ctx.match[1]
    const actorTelegramUserId = ctx.from?.id?.toString()

    if (!actorTelegramUserId || !purchaseMessageId) {
      await ctx.answerCallbackQuery({
        text: getBotTranslations('en').purchase.proposalUnavailable,
        show_alert: true
      })
      return
    }

    const result = await repository.cancel(purchaseMessageId, actorTelegramUserId)
    const locale = 'householdId' in result ? await resolveLocale(result.householdId) : 'en'
    const t = getBotTranslations(locale).purchase

    if (result.status === 'not_found' || result.status === 'not_pending') {
      await ctx.answerCallbackQuery({
        text: t.proposalUnavailable,
        show_alert: true
      })
      return
    }

    if (result.status === 'forbidden') {
      await ctx.answerCallbackQuery({
        text: t.notYourProposal,
        show_alert: true
      })
      return
    }

    await ctx.answerCallbackQuery({
      text: result.status === 'cancelled' ? t.cancelledToast : t.alreadyCancelled
    })

    if (ctx.msg) {
      await ctx.editMessageText(buildPurchaseActionMessage(locale, result), {
        reply_markup: emptyInlineKeyboard()
      })
    }

    logger?.info(
      {
        event: 'purchase.cancellation',
        purchaseMessageId,
        actorTelegramUserId,
        status: result.status
      },
      'Purchase proposal cancellation handled'
    )
  })
}

export function registerPurchaseTopicCallbacks(
  bot: Bot,
  householdConfigurationRepository: HouseholdConfigurationRepository,
  repository: PurchaseMessageIngestionRepository,
  options: {
    historyRepository?: TopicMessageHistoryRepository
    logger?: Logger
    auditNotificationService?: HouseholdAuditNotificationService
    purchaseTopicNoticeService?: PurchaseTopicNoticeService
  } = {}
): void {
  void registerPurchaseProposalCallbacks(
    bot,
    repository,
    async (householdId) => resolveHouseholdLocale(householdConfigurationRepository, householdId),
    options.logger,
    options.auditNotificationService,
    options.purchaseTopicNoticeService
  )

  // Photo-only receipts cannot be routed by the text agent; ask for details directly.
  bot.on('message', async (ctx, next) => {
    const candidate = toCandidateFromContext(ctx)
    if (!candidate) {
      await next()
      return
    }

    const binding = await householdConfigurationRepository.findHouseholdTopicByTelegramContext({
      telegramChatId: candidate.chatId,
      telegramThreadId: candidate.threadId
    })
    if (!binding) {
      await next()
      return
    }

    const record = resolveConfiguredPurchaseTopicRecord(candidate, binding)
    if (!record || !isPhotoOnlyPurchaseMessage(record)) {
      await next()
      return
    }

    try {
      if (await repository.hasClarificationContext(record)) {
        await next()
        return
      }

      const locale = await resolveHouseholdLocale(
        householdConfigurationRepository,
        record.householdId
      )
      const result = await repository.saveWithInterpretation(
        record,
        photoOnlyPurchaseInterpretation(locale)
      )
      await handlePurchaseMessageResult(
        ctx,
        record,
        result,
        locale,
        options.logger,
        options.historyRepository
      )
    } catch (error) {
      options.logger?.error(
        {
          event: 'purchase.photo_intake_failed',
          householdId: record.householdId,
          chatId: record.chatId,
          messageId: record.messageId,
          error
        },
        'Failed to ingest photo-only purchase message'
      )
    }
  })
}
