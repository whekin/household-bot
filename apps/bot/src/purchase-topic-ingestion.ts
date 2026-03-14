import {
  instantFromEpochSeconds,
  instantToDate,
  Money,
  nowInstant,
  type Instant
} from '@household/domain'
import { and, desc, eq } from 'drizzle-orm'
import type { Bot, Context } from 'grammy'
import type { Logger } from '@household/observability'
import type {
  HouseholdConfigurationRepository,
  HouseholdTopicBindingRecord,
  TopicMessageHistoryRepository
} from '@household/ports'

import { createDbClient, schema } from '@household/db'
import { getBotTranslations, type BotLocale } from './i18n'
import type { AssistantConversationMemoryStore } from './assistant-state'
import { buildConversationContext } from './conversation-orchestrator'
import type {
  PurchaseInterpretationAmountSource,
  PurchaseInterpretation,
  PurchaseMessageInterpreter
} from './openai-purchase-interpreter'
import {
  cacheTopicMessageRoute,
  getCachedTopicMessageRoute,
  type TopicMessageRouter,
  type TopicMessageRoutingResult
} from './topic-message-router'
import { asOptionalBigInt } from './topic-processor'
import {
  persistTopicHistoryMessage,
  telegramMessageIdFromMessage,
  telegramMessageSentAtFromMessage
} from './topic-history'
import { startTypingIndicator } from './telegram-chat-action'
import { stripExplicitBotMention } from './telegram-mentions'

const PURCHASE_CONFIRM_CALLBACK_PREFIX = 'purchase:confirm:'
const PURCHASE_CANCEL_CALLBACK_PREFIX = 'purchase:cancel:'
const PURCHASE_PARTICIPANT_CALLBACK_PREFIX = 'purchase:participant:'
const PURCHASE_FIX_AMOUNT_CALLBACK_PREFIX = 'purchase:fix_amount:'
const MIN_PROPOSAL_CONFIDENCE = 70
const LIKELY_PURCHASE_VERB_PATTERN =
  /\b(?:bought|purchased|paid|spent|ordered|picked up|grabbed|got)\b|(?:^|[^\p{L}])(?:купил(?:а|и)?|куплено|заказал(?:а|и)?|оплатил(?:а|и)?|потратил(?:а|и)?|взял(?:а|и)?)(?=$|[^\p{L}])/iu
const PLANNING_PURCHASE_PATTERN =
  /\b(?:should buy|should get|need to buy|need to get|want to buy|want to get|let'?s buy|let'?s get|going to buy|gonna buy|plan to buy|planning to buy|thinking about buying|thinking of buying|should we buy|should we get|can buy)\b|(?:^|[^\p{L}])(?:надо|нужно|хочу|хотим|давай(?:те)?|будем|планирую|планируем|может|стоит)\s+(?:купить|взять|заказать|оплатить)(?=$|[^\p{L}])|(?:^|[^\p{L}])(?:купим|возьмем|возьмём|закажем|оплатим)(?=$|[^\p{L}])/iu
const MONEY_SIGNAL_PATTERN =
  /\b\d+(?:[.,]\d{1,2})?\s*(?:₾|gel|lari|usd|\$)\b|\d+(?:[.,]\d{1,2})?\s*(?:лари|лри|tetri|тетри|доллар(?:а|ов)?)(?=$|[^\p{L}])|\b(?:for|за|на|до)\s+\d+(?:[.,]\d{1,2})?\b|\b(?:paid|spent)\s+\d+(?:[.,]\d{1,2})?\b|(?:^|[^\p{L}])(?:заплатил(?:а|и)?|потратил(?:а|и)?|отдал(?:а|и)?|выложил(?:а|и)?|сторговался(?:\s+до)?)(?:\s+\d+(?:[.,]\d{1,2})?|\s+до\s+\d+(?:[.,]\d{1,2})?)(?=$|[^\p{L}])/iu
const STANDALONE_NUMBER_PATTERN = /\b\d+(?:[.,]\d{1,2})?\b/gu

type StoredPurchaseProcessingStatus =
  | 'pending_confirmation'
  | 'clarification_needed'
  | 'ignored_not_purchase'
  | 'parse_failed'
  | 'confirmed'
  | 'cancelled'
  | 'parsed'
  | 'needs_review'

interface StoredPurchaseMessageRow {
  id: string
  householdId: string
  senderTelegramUserId: string
  parsedAmountMinor: bigint | null
  parsedCurrency: 'GEL' | 'USD' | null
  parsedItemDescription: string | null
  parserConfidence: number | null
  parserMode: 'llm' | null
  processingStatus: StoredPurchaseProcessingStatus
}

interface PurchaseProposalFields {
  parsedAmountMinor: bigint | null
  parsedCurrency: 'GEL' | 'USD' | null
  parsedItemDescription: string | null
  amountSource?: PurchaseInterpretationAmountSource | null
  calculationExplanation?: string | null
  parserConfidence: number | null
  parserMode: 'llm' | null
}

interface PurchaseClarificationResult extends PurchaseProposalFields {
  status: 'clarification_needed'
  purchaseMessageId: string
  clarificationQuestion: string | null
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
}

export interface PurchaseTopicIngestionConfig {
  householdId: string
  householdChatId: string
  purchaseTopicId: number
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
  requestAmountCorrection?(
    purchaseMessageId: string,
    actorTelegramUserId: string
  ): Promise<PurchaseProposalAmountCorrectionResult>
}

interface PurchasePersistenceDecision {
  status: 'pending_confirmation' | 'clarification_needed' | 'ignored_not_purchase' | 'parse_failed'
  parsedAmountMinor: bigint | null
  parsedCurrency: 'GEL' | 'USD' | null
  parsedItemDescription: string | null
  amountSource: PurchaseInterpretationAmountSource | null
  calculationExplanation: string | null
  participantMemberIds: readonly string[] | null
  parserConfidence: number | null
  parserMode: 'llm' | null
  clarificationQuestion: string | null
  parserError: string | null
  needsReview: boolean
}

interface StoredPurchaseParticipantRow {
  id: string
  purchaseMessageId: string
  memberId: string
  displayName: string
  telegramUserId: string
  included: boolean
}

const CLARIFICATION_CONTEXT_MAX_AGE_MS = 30 * 60_000
const MAX_CLARIFICATION_CONTEXT_MESSAGES = 3

function periodFromInstant(instant: Instant, timezone: string): string {
  const localDate = instant.toZonedDateTimeISO(timezone).toPlainDate()
  return `${localDate.year}-${String(localDate.month).padStart(2, '0')}`
}

function isReplyToCurrentBot(ctx: Pick<Context, 'msg' | 'me'>): boolean {
  const replyAuthor = ctx.msg?.reply_to_message?.from
  if (!replyAuthor?.is_bot) {
    return false
  }

  return replyAuthor.id === ctx.me.id
}

function looksLikeLikelyCompletedPurchase(rawText: string): boolean {
  if (PLANNING_PURCHASE_PATTERN.test(rawText)) {
    return false
  }

  if (!LIKELY_PURCHASE_VERB_PATTERN.test(rawText)) {
    return false
  }

  if (MONEY_SIGNAL_PATTERN.test(rawText)) {
    return true
  }

  return Array.from(rawText.matchAll(STANDALONE_NUMBER_PATTERN)).length === 1
}

function normalizeInterpretation(
  interpretation: PurchaseInterpretation | null,
  parserError: string | null
): PurchasePersistenceDecision {
  if (parserError !== null || interpretation === null) {
    return {
      status: 'parse_failed',
      parsedAmountMinor: null,
      parsedCurrency: null,
      parsedItemDescription: null,
      amountSource: null,
      calculationExplanation: null,
      participantMemberIds: null,
      parserConfidence: null,
      parserMode: null,
      clarificationQuestion: null,
      parserError: parserError ?? 'Purchase interpreter returned no result',
      needsReview: true
    }
  }

  if (interpretation.decision === 'not_purchase') {
    return {
      status: 'ignored_not_purchase',
      parsedAmountMinor: interpretation.amountMinor,
      parsedCurrency: interpretation.currency,
      parsedItemDescription: interpretation.itemDescription,
      amountSource: interpretation.amountSource ?? null,
      calculationExplanation: interpretation.calculationExplanation ?? null,
      participantMemberIds: interpretation.participantMemberIds ?? null,
      parserConfidence: interpretation.confidence,
      parserMode: interpretation.parserMode,
      clarificationQuestion: null,
      parserError: null,
      needsReview: false
    }
  }

  const missingRequiredFields =
    interpretation.amountMinor === null ||
    interpretation.currency === null ||
    interpretation.itemDescription === null

  if (
    interpretation.decision === 'clarification' ||
    missingRequiredFields ||
    interpretation.confidence < MIN_PROPOSAL_CONFIDENCE
  ) {
    return {
      status: 'clarification_needed',
      parsedAmountMinor: interpretation.amountMinor,
      parsedCurrency: interpretation.currency,
      parsedItemDescription: interpretation.itemDescription,
      amountSource: interpretation.amountSource ?? null,
      calculationExplanation: interpretation.calculationExplanation ?? null,
      participantMemberIds: interpretation.participantMemberIds ?? null,
      parserConfidence: interpretation.confidence,
      parserMode: interpretation.parserMode,
      clarificationQuestion: interpretation.clarificationQuestion,
      parserError: null,
      needsReview: true
    }
  }

  return {
    status: 'pending_confirmation',
    parsedAmountMinor: interpretation.amountMinor,
    parsedCurrency: interpretation.currency,
    parsedItemDescription: interpretation.itemDescription,
    amountSource: interpretation.amountSource ?? null,
    calculationExplanation: interpretation.calculationExplanation ?? null,
    participantMemberIds: interpretation.participantMemberIds ?? null,
    parserConfidence: interpretation.confidence,
    parserMode: interpretation.parserMode,
    clarificationQuestion: null,
    parserError: null,
    needsReview: false
  }
}

export function toPurchaseInterpretation(
  result: import('./topic-processor').TopicProcessorPurchaseResult
): PurchaseInterpretation {
  return {
    decision: 'purchase',
    amountMinor: asOptionalBigInt(result.amountMinor),
    currency: result.currency,
    itemDescription: result.itemDescription,
    amountSource: result.amountSource,
    calculationExplanation: result.calculationExplanation,
    participantMemberIds: result.participantMemberIds,
    confidence: result.confidence,
    parserMode: 'llm',
    clarificationQuestion: null
  }
}

export function toPurchaseClarificationInterpretation(
  result: import('./topic-processor').TopicProcessorClarificationResult
): PurchaseInterpretation {
  return {
    decision: 'clarification',
    amountMinor: null,
    currency: null,
    itemDescription: null,
    confidence: 0,
    parserMode: 'llm',
    clarificationQuestion: result.clarificationQuestion
  }
}

function needsReviewAsInt(value: boolean): number {
  return value ? 1 : 0
}

function participantIncludedAsInt(value: boolean): number {
  return value ? 1 : 0
}

function normalizeLifecycleStatus(value: string): 'active' | 'away' | 'left' {
  return value === 'away' || value === 'left' ? value : 'active'
}

export function resolveProposalParticipantSelection(input: {
  members: readonly {
    memberId: string
    telegramUserId: string | null
    lifecycleStatus: 'active' | 'away' | 'left'
  }[]
  policyByMemberId: ReadonlyMap<
    string,
    {
      effectiveFromPeriod: string
      policy: string
    }
  >
  senderTelegramUserId: string
  senderMemberId: string | null
  explicitParticipantMemberIds: readonly string[] | null
}): readonly { memberId: string; included: boolean }[] {
  const eligibleMembers = input.members.filter((member) => member.lifecycleStatus !== 'left')
  if (input.explicitParticipantMemberIds && input.explicitParticipantMemberIds.length > 0) {
    const explicitMemberIds = new Set(input.explicitParticipantMemberIds)
    const explicitParticipants = eligibleMembers.map((member) => ({
      memberId: member.memberId,
      included: explicitMemberIds.has(member.memberId)
    }))

    if (explicitParticipants.some((participant) => participant.included)) {
      return explicitParticipants
    }

    const fallbackParticipant =
      eligibleMembers.find((member) => member.memberId === input.senderMemberId) ??
      eligibleMembers.find((member) => member.telegramUserId === input.senderTelegramUserId) ??
      eligibleMembers[0]

    return explicitParticipants.map(({ memberId }) => ({
      memberId,
      included: memberId === fallbackParticipant?.memberId
    }))
  }

  const participants = eligibleMembers.map((member) => {
    const policy = input.policyByMemberId.get(member.memberId)?.policy ?? 'resident'
    const included =
      member.lifecycleStatus === 'away'
        ? policy === 'resident'
        : member.lifecycleStatus === 'active'

    return {
      memberId: member.memberId,
      telegramUserId: member.telegramUserId,
      included
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

  const fallbackParticipant =
    participants.find((participant) => participant.memberId === input.senderMemberId) ??
    participants.find((participant) => participant.telegramUserId === input.senderTelegramUserId) ??
    participants[0]

  return participants.map(({ memberId }) => ({
    memberId,
    included: memberId === fallbackParticipant?.memberId
  }))
}

function toStoredPurchaseRow(row: {
  id: string
  householdId: string
  senderTelegramUserId: string
  parsedAmountMinor: bigint | null
  parsedCurrency: string | null
  parsedItemDescription: string | null
  parserConfidence: number | null
  parserMode: string | null
  processingStatus: string
}): StoredPurchaseMessageRow {
  return {
    id: row.id,
    householdId: row.householdId,
    senderTelegramUserId: row.senderTelegramUserId,
    parsedAmountMinor: row.parsedAmountMinor,
    parsedCurrency:
      row.parsedCurrency === 'USD' || row.parsedCurrency === 'GEL' ? row.parsedCurrency : null,
    parsedItemDescription: row.parsedItemDescription,
    parserConfidence: row.parserConfidence,
    parserMode: row.parserMode === 'llm' ? 'llm' : null,
    processingStatus:
      row.processingStatus === 'pending_confirmation' ||
      row.processingStatus === 'clarification_needed' ||
      row.processingStatus === 'ignored_not_purchase' ||
      row.processingStatus === 'parse_failed' ||
      row.processingStatus === 'confirmed' ||
      row.processingStatus === 'cancelled' ||
      row.processingStatus === 'parsed' ||
      row.processingStatus === 'needs_review'
        ? row.processingStatus
        : 'parse_failed'
  }
}

function toProposalFields(row: StoredPurchaseMessageRow): PurchaseProposalFields {
  return {
    parsedAmountMinor: row.parsedAmountMinor,
    parsedCurrency: row.parsedCurrency,
    parsedItemDescription: row.parsedItemDescription,
    amountSource: null,
    calculationExplanation: null,
    parserConfidence: row.parserConfidence,
    parserMode: row.parserMode
  }
}

function toProposalParticipants(
  rows: readonly StoredPurchaseParticipantRow[]
): readonly PurchaseProposalParticipant[] {
  return rows.map((row) => ({
    id: row.id,
    memberId: row.memberId,
    displayName: row.displayName,
    included: row.included
  }))
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

interface PendingPurchaseReply {
  chatId: number
  messageId: number
}

async function sendPurchaseProcessingReply(
  ctx: Context,
  text: string
): Promise<PendingPurchaseReply | null> {
  const message = ctx.msg
  if (!message) {
    return null
  }

  const reply = await ctx.reply(text, {
    reply_parameters: {
      message_id: message.message_id
    }
  })

  if (!reply?.chat?.id || typeof reply.message_id !== 'number') {
    return null
  }

  return {
    chatId: reply.chat.id,
    messageId: reply.message_id
  }
}

function shouldShowProcessingReply(
  ctx: Pick<Context, 'msg' | 'me'>,
  record: PurchaseTopicRecord,
  route: TopicMessageRoutingResult
): boolean {
  if (route.route !== 'purchase_candidate' || !route.shouldStartTyping) {
    return false
  }

  if (stripExplicitBotMention(ctx) !== null || isReplyToCurrentBot(ctx)) {
    return looksLikeLikelyCompletedPurchase(record.rawText)
  }

  return true
}

async function finalizePurchaseReply(
  ctx: Context,
  pendingReply: PendingPurchaseReply | null,
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
    if (pendingReply) {
      try {
        await ctx.api.deleteMessage(pendingReply.chatId, pendingReply.messageId)
      } catch {}
    }

    return
  }

  if (!pendingReply) {
    await replyToPurchaseMessage(ctx, text, replyMarkup, history)
    return
  }

  try {
    await ctx.api.editMessageText(
      pendingReply.chatId,
      pendingReply.messageId,
      text,
      replyMarkup ? { reply_markup: replyMarkup } : {}
    )

    await persistTopicHistoryMessage({
      repository: history?.repository,
      householdId: history?.record.householdId ?? '',
      telegramChatId: history?.record.chatId ?? '',
      telegramThreadId: history?.record.threadId ?? null,
      telegramMessageId: pendingReply.messageId.toString(),
      telegramUpdateId: null,
      senderTelegramUserId: ctx.me?.id?.toString() ?? null,
      senderDisplayName: null,
      isBot: true,
      rawText: text,
      messageSentAt: nowInstant()
    })
  } catch {
    await replyToPurchaseMessage(ctx, text, replyMarkup, history)
  }
}

function toCandidateFromContext(ctx: Context): PurchaseTopicCandidate | null {
  const message = ctx.message
  if (!message || !('text' in message)) {
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
    rawText: stripExplicitBotMention(ctx)?.strippedText ?? message.text,
    messageSentAt: instantFromEpochSeconds(message.date)
  }

  if (senderDisplayName.length > 0) {
    candidate.senderDisplayName = senderDisplayName
  }

  return candidate
}

export function extractPurchaseTopicCandidate(
  value: PurchaseTopicCandidate,
  config: PurchaseTopicIngestionConfig
): PurchaseTopicRecord | null {
  if (value.rawText.trim().startsWith('/')) {
    return null
  }

  if (value.chatId !== config.householdChatId) {
    return null
  }

  if (value.threadId !== String(config.purchaseTopicId)) {
    return null
  }

  const normalizedText = value.rawText.trim()
  if (normalizedText.length === 0) {
    return null
  }

  return {
    ...value,
    rawText: normalizedText,
    householdId: config.householdId
  }
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

export function createPurchaseMessageRepository(databaseUrl: string): {
  repository: PurchaseMessageIngestionRepository
  close: () => Promise<void>
} {
  const { db, queryClient } = createDbClient(databaseUrl, {
    max: 5,
    prepare: false
  })

  async function getClarificationContext(
    record: PurchaseTopicRecord
  ): Promise<readonly string[] | undefined> {
    const rows = await db
      .select({
        rawText: schema.purchaseMessages.rawText,
        messageSentAt: schema.purchaseMessages.messageSentAt,
        ingestedAt: schema.purchaseMessages.ingestedAt
      })
      .from(schema.purchaseMessages)
      .where(
        and(
          eq(schema.purchaseMessages.householdId, record.householdId),
          eq(schema.purchaseMessages.senderTelegramUserId, record.senderTelegramUserId),
          eq(schema.purchaseMessages.telegramThreadId, record.threadId),
          eq(schema.purchaseMessages.processingStatus, 'clarification_needed')
        )
      )
      .orderBy(
        desc(schema.purchaseMessages.messageSentAt),
        desc(schema.purchaseMessages.ingestedAt)
      )
      .limit(MAX_CLARIFICATION_CONTEXT_MESSAGES)

    const currentMessageTimestamp = instantToDate(record.messageSentAt).getTime()
    const recentMessages = rows
      .filter((row) => {
        const referenceTimestamp = (row.messageSentAt ?? row.ingestedAt)?.getTime()
        return (
          referenceTimestamp !== undefined &&
          currentMessageTimestamp - referenceTimestamp >= 0 &&
          currentMessageTimestamp - referenceTimestamp <= CLARIFICATION_CONTEXT_MAX_AGE_MS
        )
      })
      .reverse()
      .map((row) => row.rawText.trim())
      .filter((value) => value.length > 0)

    return recentMessages.length > 0 ? recentMessages : undefined
  }

  async function getStoredMessage(
    purchaseMessageId: string
  ): Promise<StoredPurchaseMessageRow | null> {
    const rows = await db
      .select({
        id: schema.purchaseMessages.id,
        householdId: schema.purchaseMessages.householdId,
        senderTelegramUserId: schema.purchaseMessages.senderTelegramUserId,
        parsedAmountMinor: schema.purchaseMessages.parsedAmountMinor,
        parsedCurrency: schema.purchaseMessages.parsedCurrency,
        parsedItemDescription: schema.purchaseMessages.parsedItemDescription,
        parserConfidence: schema.purchaseMessages.parserConfidence,
        parserMode: schema.purchaseMessages.parserMode,
        processingStatus: schema.purchaseMessages.processingStatus
      })
      .from(schema.purchaseMessages)
      .where(eq(schema.purchaseMessages.id, purchaseMessageId))
      .limit(1)

    const row = rows[0]
    return row ? toStoredPurchaseRow(row) : null
  }

  async function getStoredParticipants(
    purchaseMessageId: string
  ): Promise<readonly StoredPurchaseParticipantRow[]> {
    const rows = await db
      .select({
        id: schema.purchaseMessageParticipants.id,
        purchaseMessageId: schema.purchaseMessageParticipants.purchaseMessageId,
        memberId: schema.purchaseMessageParticipants.memberId,
        displayName: schema.members.displayName,
        telegramUserId: schema.members.telegramUserId,
        included: schema.purchaseMessageParticipants.included
      })
      .from(schema.purchaseMessageParticipants)
      .innerJoin(schema.members, eq(schema.purchaseMessageParticipants.memberId, schema.members.id))
      .where(eq(schema.purchaseMessageParticipants.purchaseMessageId, purchaseMessageId))

    return rows.map((row) => ({
      id: row.id,
      purchaseMessageId: row.purchaseMessageId,
      memberId: row.memberId,
      displayName: row.displayName,
      telegramUserId: row.telegramUserId,
      included: row.included === 1
    }))
  }

  async function defaultProposalParticipants(input: {
    householdId: string
    senderTelegramUserId: string
    senderMemberId: string | null
    messageSentAt: Instant
    explicitParticipantMemberIds: readonly string[] | null
  }): Promise<readonly { memberId: string; included: boolean }[]> {
    const [members, settingsRows, policyRows] = await Promise.all([
      db
        .select({
          id: schema.members.id,
          telegramUserId: schema.members.telegramUserId,
          lifecycleStatus: schema.members.lifecycleStatus
        })
        .from(schema.members)
        .where(eq(schema.members.householdId, input.householdId)),
      db
        .select({
          timezone: schema.householdBillingSettings.timezone
        })
        .from(schema.householdBillingSettings)
        .where(eq(schema.householdBillingSettings.householdId, input.householdId))
        .limit(1),
      db
        .select({
          memberId: schema.memberAbsencePolicies.memberId,
          effectiveFromPeriod: schema.memberAbsencePolicies.effectiveFromPeriod,
          policy: schema.memberAbsencePolicies.policy
        })
        .from(schema.memberAbsencePolicies)
        .where(eq(schema.memberAbsencePolicies.householdId, input.householdId))
    ])

    const timezone = settingsRows[0]?.timezone ?? 'Asia/Tbilisi'
    const period = periodFromInstant(input.messageSentAt, timezone)
    const policyByMemberId = new Map<
      string,
      {
        effectiveFromPeriod: string
        policy: string
      }
    >()

    for (const row of policyRows) {
      if (row.effectiveFromPeriod.localeCompare(period) > 0) {
        continue
      }

      const current = policyByMemberId.get(row.memberId)
      if (!current || current.effectiveFromPeriod.localeCompare(row.effectiveFromPeriod) < 0) {
        policyByMemberId.set(row.memberId, {
          effectiveFromPeriod: row.effectiveFromPeriod,
          policy: row.policy
        })
      }
    }

    return resolveProposalParticipantSelection({
      members: members.map((member) => ({
        memberId: member.id,
        telegramUserId: member.telegramUserId,
        lifecycleStatus: normalizeLifecycleStatus(member.lifecycleStatus)
      })),
      policyByMemberId,
      senderTelegramUserId: input.senderTelegramUserId,
      senderMemberId: input.senderMemberId,
      explicitParticipantMemberIds: input.explicitParticipantMemberIds
    })
  }

  async function mutateProposalStatus(
    purchaseMessageId: string,
    actorTelegramUserId: string,
    targetStatus: 'confirmed' | 'cancelled'
  ): Promise<PurchaseProposalActionResult> {
    const existing = await getStoredMessage(purchaseMessageId)
    if (!existing) {
      return {
        status: 'not_found'
      }
    }

    if (existing.senderTelegramUserId !== actorTelegramUserId) {
      return {
        status: 'forbidden',
        householdId: existing.householdId
      }
    }

    if (existing.processingStatus === targetStatus) {
      return {
        status: targetStatus === 'confirmed' ? 'already_confirmed' : 'already_cancelled',
        purchaseMessageId: existing.id,
        householdId: existing.householdId,
        participants: toProposalParticipants(await getStoredParticipants(existing.id)),
        ...toProposalFields(existing)
      }
    }

    if (existing.processingStatus !== 'pending_confirmation') {
      return {
        status: 'not_pending',
        householdId: existing.householdId
      }
    }

    const rows = await db
      .update(schema.purchaseMessages)
      .set({
        processingStatus: targetStatus,
        ...(targetStatus === 'confirmed'
          ? {
              needsReview: 0
            }
          : {})
      })
      .where(
        and(
          eq(schema.purchaseMessages.id, purchaseMessageId),
          eq(schema.purchaseMessages.senderTelegramUserId, actorTelegramUserId),
          eq(schema.purchaseMessages.processingStatus, 'pending_confirmation')
        )
      )
      .returning({
        id: schema.purchaseMessages.id,
        householdId: schema.purchaseMessages.householdId,
        senderTelegramUserId: schema.purchaseMessages.senderTelegramUserId,
        parsedAmountMinor: schema.purchaseMessages.parsedAmountMinor,
        parsedCurrency: schema.purchaseMessages.parsedCurrency,
        parsedItemDescription: schema.purchaseMessages.parsedItemDescription,
        parserConfidence: schema.purchaseMessages.parserConfidence,
        parserMode: schema.purchaseMessages.parserMode,
        processingStatus: schema.purchaseMessages.processingStatus
      })

    const updated = rows[0]
    if (!updated) {
      const reloaded = await getStoredMessage(purchaseMessageId)
      if (!reloaded) {
        return {
          status: 'not_found'
        }
      }

      if (reloaded.processingStatus === 'confirmed' || reloaded.processingStatus === 'cancelled') {
        return {
          status:
            reloaded.processingStatus === 'confirmed' ? 'already_confirmed' : 'already_cancelled',
          purchaseMessageId: reloaded.id,
          householdId: reloaded.householdId,
          participants: toProposalParticipants(await getStoredParticipants(reloaded.id)),
          ...toProposalFields(reloaded)
        }
      }

      return {
        status: 'not_pending',
        householdId: reloaded.householdId
      }
    }

    const stored = toStoredPurchaseRow(updated)
    return {
      status: targetStatus,
      purchaseMessageId: stored.id,
      householdId: stored.householdId,
      participants: toProposalParticipants(await getStoredParticipants(stored.id)),
      ...toProposalFields(stored)
    }
  }

  const repository: PurchaseMessageIngestionRepository = {
    async hasClarificationContext(record) {
      const clarificationContext = await getClarificationContext(record)
      return Boolean(clarificationContext && clarificationContext.length > 0)
    },

    async clearClarificationContext(record) {
      await db
        .update(schema.purchaseMessages)
        .set({
          processingStatus: 'ignored_not_purchase',
          needsReview: 0
        })
        .where(
          and(
            eq(schema.purchaseMessages.householdId, record.householdId),
            eq(schema.purchaseMessages.senderTelegramUserId, record.senderTelegramUserId),
            eq(schema.purchaseMessages.telegramThreadId, record.threadId),
            eq(schema.purchaseMessages.processingStatus, 'clarification_needed')
          )
        )
    },

    async save(record, interpreter, defaultCurrency, options) {
      const matchedMember = await db
        .select({ id: schema.members.id })
        .from(schema.members)
        .where(
          and(
            eq(schema.members.householdId, record.householdId),
            eq(schema.members.telegramUserId, record.senderTelegramUserId)
          )
        )
        .limit(1)

      const senderMemberId = matchedMember[0]?.id ?? null
      const householdMembers = (
        await db
          .select({
            memberId: schema.members.id,
            displayName: schema.members.displayName,
            status: schema.members.lifecycleStatus
          })
          .from(schema.members)
          .where(eq(schema.members.householdId, record.householdId))
      )
        .map((member) => ({
          memberId: member.memberId,
          displayName: member.displayName,
          status: normalizeLifecycleStatus(member.status)
        }))
        .filter((member) => member.status !== 'left')
      let parserError: string | null = null
      const clarificationContext = interpreter ? await getClarificationContext(record) : undefined

      const interpretation = interpreter
        ? await interpreter(record.rawText, {
            defaultCurrency: defaultCurrency ?? 'GEL',
            householdContext: options?.householdContext ?? null,
            assistantTone: options?.assistantTone ?? null,
            householdMembers,
            senderMemberId,
            ...(clarificationContext
              ? {
                  clarificationContext: {
                    recentMessages: clarificationContext
                  }
                }
              : {})
          }).catch((error) => {
            parserError = error instanceof Error ? error.message : 'Unknown interpreter error'
            return null
          })
        : null

      const decision = normalizeInterpretation(
        interpretation,
        parserError ?? (interpreter ? null : 'Purchase interpreter is unavailable')
      )

      const inserted = await db
        .insert(schema.purchaseMessages)
        .values({
          householdId: record.householdId,
          senderMemberId,
          senderTelegramUserId: record.senderTelegramUserId,
          senderDisplayName: record.senderDisplayName,
          rawText: record.rawText,
          telegramChatId: record.chatId,
          telegramMessageId: record.messageId,
          telegramThreadId: record.threadId,
          telegramUpdateId: String(record.updateId),
          messageSentAt: instantToDate(record.messageSentAt),
          parsedAmountMinor: decision.parsedAmountMinor,
          parsedCurrency: decision.parsedCurrency,
          parsedItemDescription: decision.parsedItemDescription,
          parserMode: decision.parserMode,
          parserConfidence: decision.parserConfidence,
          needsReview: needsReviewAsInt(decision.needsReview),
          parserError: decision.parserError,
          processingStatus: decision.status
        })
        .onConflictDoNothing({
          target: [
            schema.purchaseMessages.householdId,
            schema.purchaseMessages.telegramChatId,
            schema.purchaseMessages.telegramMessageId
          ]
        })
        .returning({ id: schema.purchaseMessages.id })

      const insertedRow = inserted[0]
      if (!insertedRow) {
        return {
          status: 'duplicate'
        }
      }

      switch (decision.status) {
        case 'ignored_not_purchase':
          return {
            status: 'ignored_not_purchase',
            purchaseMessageId: insertedRow.id
          }
        case 'clarification_needed':
          return {
            status: 'clarification_needed',
            purchaseMessageId: insertedRow.id,
            clarificationQuestion: decision.clarificationQuestion,
            parsedAmountMinor: decision.parsedAmountMinor,
            parsedCurrency: decision.parsedCurrency,
            parsedItemDescription: decision.parsedItemDescription,
            amountSource: decision.amountSource,
            calculationExplanation: decision.calculationExplanation,
            parserConfidence: decision.parserConfidence,
            parserMode: decision.parserMode
          }
        case 'pending_confirmation': {
          const participants = await defaultProposalParticipants({
            householdId: record.householdId,
            senderTelegramUserId: record.senderTelegramUserId,
            senderMemberId,
            messageSentAt: record.messageSentAt,
            explicitParticipantMemberIds: decision.participantMemberIds
          })

          if (participants.length > 0) {
            await db.insert(schema.purchaseMessageParticipants).values(
              participants.map((participant) => ({
                purchaseMessageId: insertedRow.id,
                memberId: participant.memberId,
                included: participantIncludedAsInt(participant.included)
              }))
            )
          }

          return {
            status: 'pending_confirmation',
            purchaseMessageId: insertedRow.id,
            parsedAmountMinor: decision.parsedAmountMinor!,
            parsedCurrency: decision.parsedCurrency!,
            parsedItemDescription: decision.parsedItemDescription!,
            amountSource: decision.amountSource,
            calculationExplanation: decision.calculationExplanation,
            parserConfidence: decision.parserConfidence ?? MIN_PROPOSAL_CONFIDENCE,
            parserMode: decision.parserMode ?? 'llm',
            participants: toProposalParticipants(await getStoredParticipants(insertedRow.id))
          }
        }
        case 'parse_failed':
          return {
            status: 'parse_failed',
            purchaseMessageId: insertedRow.id
          }
      }
    },

    async saveWithInterpretation(record, interpretation) {
      const matchedMember = await db
        .select({ id: schema.members.id })
        .from(schema.members)
        .where(
          and(
            eq(schema.members.householdId, record.householdId),
            eq(schema.members.telegramUserId, record.senderTelegramUserId)
          )
        )
        .limit(1)

      const senderMemberId = matchedMember[0]?.id ?? null

      const decision = normalizeInterpretation(interpretation, null)

      const inserted = await db
        .insert(schema.purchaseMessages)
        .values({
          householdId: record.householdId,
          senderMemberId,
          senderTelegramUserId: record.senderTelegramUserId,
          senderDisplayName: record.senderDisplayName,
          rawText: record.rawText,
          telegramChatId: record.chatId,
          telegramMessageId: record.messageId,
          telegramThreadId: record.threadId,
          telegramUpdateId: String(record.updateId),
          messageSentAt: instantToDate(record.messageSentAt),
          parsedAmountMinor: decision.parsedAmountMinor,
          parsedCurrency: decision.parsedCurrency,
          parsedItemDescription: decision.parsedItemDescription,
          parserMode: decision.parserMode,
          parserConfidence: decision.parserConfidence,
          needsReview: needsReviewAsInt(decision.needsReview),
          parserError: decision.parserError,
          processingStatus: decision.status
        })
        .onConflictDoNothing({
          target: [
            schema.purchaseMessages.householdId,
            schema.purchaseMessages.telegramChatId,
            schema.purchaseMessages.telegramMessageId
          ]
        })
        .returning({ id: schema.purchaseMessages.id })

      const insertedRow = inserted[0]
      if (!insertedRow) {
        return {
          status: 'duplicate'
        }
      }

      switch (decision.status) {
        case 'ignored_not_purchase':
          return {
            status: 'ignored_not_purchase',
            purchaseMessageId: insertedRow.id
          }
        case 'clarification_needed':
          return {
            status: 'clarification_needed',
            purchaseMessageId: insertedRow.id,
            clarificationQuestion: decision.clarificationQuestion,
            parsedAmountMinor: decision.parsedAmountMinor,
            parsedCurrency: decision.parsedCurrency,
            parsedItemDescription: decision.parsedItemDescription,
            amountSource: decision.amountSource,
            calculationExplanation: decision.calculationExplanation,
            parserConfidence: decision.parserConfidence,
            parserMode: decision.parserMode
          }
        case 'pending_confirmation': {
          const participants = await defaultProposalParticipants({
            householdId: record.householdId,
            senderTelegramUserId: record.senderTelegramUserId,
            senderMemberId,
            messageSentAt: record.messageSentAt,
            explicitParticipantMemberIds: decision.participantMemberIds
          })

          if (participants.length > 0) {
            await db.insert(schema.purchaseMessageParticipants).values(
              participants.map((participant) => ({
                purchaseMessageId: insertedRow.id,
                memberId: participant.memberId,
                included: participantIncludedAsInt(participant.included)
              }))
            )
          }

          return {
            status: 'pending_confirmation',
            purchaseMessageId: insertedRow.id,
            parsedAmountMinor: decision.parsedAmountMinor!,
            parsedCurrency: decision.parsedCurrency!,
            parsedItemDescription: decision.parsedItemDescription!,
            amountSource: decision.amountSource,
            calculationExplanation: decision.calculationExplanation,
            parserConfidence: decision.parserConfidence ?? MIN_PROPOSAL_CONFIDENCE,
            parserMode: decision.parserMode ?? 'llm',
            participants: toProposalParticipants(await getStoredParticipants(insertedRow.id))
          }
        }
        case 'parse_failed':
          return {
            status: 'parse_failed',
            purchaseMessageId: insertedRow.id
          }
      }
    },

    async confirm(purchaseMessageId, actorTelegramUserId) {
      return mutateProposalStatus(purchaseMessageId, actorTelegramUserId, 'confirmed')
    },

    async cancel(purchaseMessageId, actorTelegramUserId) {
      return mutateProposalStatus(purchaseMessageId, actorTelegramUserId, 'cancelled')
    },

    async toggleParticipant(participantId, actorTelegramUserId) {
      const rows = await db
        .select({
          participantId: schema.purchaseMessageParticipants.id,
          purchaseMessageId: schema.purchaseMessageParticipants.purchaseMessageId,
          memberId: schema.purchaseMessageParticipants.memberId,
          included: schema.purchaseMessageParticipants.included,
          householdId: schema.purchaseMessages.householdId,
          senderTelegramUserId: schema.purchaseMessages.senderTelegramUserId,
          parsedAmountMinor: schema.purchaseMessages.parsedAmountMinor,
          parsedCurrency: schema.purchaseMessages.parsedCurrency,
          parsedItemDescription: schema.purchaseMessages.parsedItemDescription,
          parserConfidence: schema.purchaseMessages.parserConfidence,
          parserMode: schema.purchaseMessages.parserMode,
          processingStatus: schema.purchaseMessages.processingStatus
        })
        .from(schema.purchaseMessageParticipants)
        .innerJoin(
          schema.purchaseMessages,
          eq(schema.purchaseMessageParticipants.purchaseMessageId, schema.purchaseMessages.id)
        )
        .where(eq(schema.purchaseMessageParticipants.id, participantId))
        .limit(1)

      const existing = rows[0]
      if (!existing) {
        return {
          status: 'not_found'
        }
      }

      if (existing.processingStatus !== 'pending_confirmation') {
        return {
          status: 'not_pending',
          householdId: existing.householdId
        }
      }

      const actorRows = await db
        .select({
          memberId: schema.members.id,
          isAdmin: schema.members.isAdmin
        })
        .from(schema.members)
        .where(
          and(
            eq(schema.members.householdId, existing.householdId),
            eq(schema.members.telegramUserId, actorTelegramUserId)
          )
        )
        .limit(1)

      const actor = actorRows[0]
      if (existing.senderTelegramUserId !== actorTelegramUserId && actor?.isAdmin !== 1) {
        return {
          status: 'forbidden',
          householdId: existing.householdId
        }
      }

      const currentParticipants = await getStoredParticipants(existing.purchaseMessageId)
      const currentlyIncludedCount = currentParticipants.filter(
        (participant) => participant.included
      ).length

      if (existing.included === 1 && currentlyIncludedCount <= 1) {
        return {
          status: 'at_least_one_required',
          householdId: existing.householdId
        }
      }

      await db
        .update(schema.purchaseMessageParticipants)
        .set({
          included: existing.included === 1 ? 0 : 1,
          updatedAt: new Date()
        })
        .where(eq(schema.purchaseMessageParticipants.id, participantId))

      return {
        status: 'updated',
        purchaseMessageId: existing.purchaseMessageId,
        householdId: existing.householdId,
        parsedAmountMinor: existing.parsedAmountMinor,
        parsedCurrency:
          existing.parsedCurrency === 'GEL' || existing.parsedCurrency === 'USD'
            ? existing.parsedCurrency
            : null,
        parsedItemDescription: existing.parsedItemDescription,
        parserConfidence: existing.parserConfidence,
        parserMode: existing.parserMode === 'llm' ? 'llm' : null,
        participants: toProposalParticipants(
          await getStoredParticipants(existing.purchaseMessageId)
        )
      }
    },

    async requestAmountCorrection(purchaseMessageId, actorTelegramUserId) {
      const existing = await getStoredMessage(purchaseMessageId)
      if (!existing) {
        return {
          status: 'not_found'
        }
      }

      if (existing.senderTelegramUserId !== actorTelegramUserId) {
        return {
          status: 'forbidden',
          householdId: existing.householdId
        }
      }

      if (existing.processingStatus === 'clarification_needed') {
        return {
          status: 'already_requested',
          purchaseMessageId: existing.id,
          householdId: existing.householdId
        }
      }

      if (existing.processingStatus !== 'pending_confirmation') {
        return {
          status: 'not_pending',
          householdId: existing.householdId
        }
      }

      const rows = await db
        .update(schema.purchaseMessages)
        .set({
          processingStatus: 'clarification_needed',
          needsReview: 1
        })
        .where(
          and(
            eq(schema.purchaseMessages.id, purchaseMessageId),
            eq(schema.purchaseMessages.senderTelegramUserId, actorTelegramUserId),
            eq(schema.purchaseMessages.processingStatus, 'pending_confirmation')
          )
        )
        .returning({
          id: schema.purchaseMessages.id,
          householdId: schema.purchaseMessages.householdId
        })

      const updated = rows[0]
      if (!updated) {
        const reloaded = await getStoredMessage(purchaseMessageId)
        if (!reloaded) {
          return {
            status: 'not_found'
          }
        }

        if (reloaded.processingStatus === 'clarification_needed') {
          return {
            status: 'already_requested',
            purchaseMessageId: reloaded.id,
            householdId: reloaded.householdId
          }
        }

        return {
          status: 'not_pending',
          householdId: reloaded.householdId
        }
      }

      return {
        status: 'requested',
        purchaseMessageId: updated.id,
        householdId: updated.householdId
      }
    }
  }

  return {
    repository,
    close: async () => {
      await queryClient.end({ timeout: 5 })
    }
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
        formatPurchaseCalculationNote(locale, result),
        formatPurchaseParticipants(locale, result.participants)
      )
    case 'clarification_needed':
      return t.clarification(result.clarificationQuestion ?? clarificationFallback(locale, result))
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
      ...participants.map((participant) => [
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

async function resolveAssistantConfig(
  householdConfigurationRepository: HouseholdConfigurationRepository,
  householdId: string
): Promise<{
  householdId: string
  assistantContext: string | null
  assistantTone: string | null
}> {
  return householdConfigurationRepository.getHouseholdAssistantConfig
    ? await householdConfigurationRepository.getHouseholdAssistantConfig(householdId)
    : {
        householdId,
        assistantContext: null,
        assistantTone: null
      }
}

function memoryKeyForRecord(record: PurchaseTopicRecord): string {
  return `group:${record.chatId}:${record.senderTelegramUserId}:thread:${record.threadId}`
}

function rememberUserTurn(
  memoryStore: AssistantConversationMemoryStore | undefined,
  record: PurchaseTopicRecord
): void {
  if (!memoryStore) {
    return
  }

  memoryStore.appendTurn(memoryKeyForRecord(record), {
    role: 'user',
    text: record.rawText
  })
}

function rememberAssistantTurn(
  memoryStore: AssistantConversationMemoryStore | undefined,
  record: PurchaseTopicRecord,
  assistantText: string | null
): void {
  if (!memoryStore || !assistantText) {
    return
  }

  memoryStore.appendTurn(memoryKeyForRecord(record), {
    role: 'assistant',
    text: assistantText
  })
}

async function persistIncomingTopicMessage(
  repository: TopicMessageHistoryRepository | undefined,
  record: PurchaseTopicRecord
) {
  await persistTopicHistoryMessage({
    repository,
    householdId: record.householdId,
    telegramChatId: record.chatId,
    telegramThreadId: record.threadId,
    telegramMessageId: record.messageId,
    telegramUpdateId: String(record.updateId),
    senderTelegramUserId: record.senderTelegramUserId,
    senderDisplayName: record.senderDisplayName ?? null,
    isBot: false,
    rawText: record.rawText,
    messageSentAt: record.messageSentAt
  })
}

async function routePurchaseTopicMessage(input: {
  ctx: Pick<Context, 'msg' | 'me'>
  record: PurchaseTopicRecord
  locale: BotLocale
  repository: Pick<
    PurchaseMessageIngestionRepository,
    'hasClarificationContext' | 'clearClarificationContext'
  >
  router: TopicMessageRouter | undefined
  memoryStore: AssistantConversationMemoryStore | undefined
  historyRepository: TopicMessageHistoryRepository | undefined
  assistantContext?: string | null
  assistantTone?: string | null
}): Promise<TopicMessageRoutingResult> {
  if (!input.router) {
    const hasExplicitMention = stripExplicitBotMention(input.ctx) !== null
    const isReply = isReplyToCurrentBot(input.ctx)
    const hasClarificationContext = await input.repository.hasClarificationContext(input.record)

    if (hasExplicitMention || isReply) {
      return {
        route: 'purchase_candidate',
        replyText: null,
        helperKind: 'purchase',
        shouldStartTyping: true,
        shouldClearWorkflow: false,
        confidence: 75,
        reason: 'legacy_direct'
      }
    }

    if (hasClarificationContext) {
      return {
        route: 'purchase_followup',
        replyText: null,
        helperKind: 'purchase',
        shouldStartTyping: true,
        shouldClearWorkflow: false,
        confidence: 75,
        reason: 'legacy_clarification'
      }
    }

    if (looksLikeLikelyCompletedPurchase(input.record.rawText)) {
      return {
        route: 'purchase_candidate',
        replyText: null,
        helperKind: 'purchase',
        shouldStartTyping: true,
        shouldClearWorkflow: false,
        confidence: 75,
        reason: 'legacy_likely_purchase'
      }
    }

    return {
      route: 'silent',
      replyText: null,
      helperKind: null,
      shouldStartTyping: false,
      shouldClearWorkflow: false,
      confidence: 80,
      reason: 'legacy_silent'
    }
  }

  const key = memoryKeyForRecord(input.record)
  const activeWorkflow = (await input.repository.hasClarificationContext(input.record))
    ? 'purchase_clarification'
    : null
  const conversationContext = await buildConversationContext({
    repository: input.historyRepository,
    householdId: input.record.householdId,
    telegramChatId: input.record.chatId,
    telegramThreadId: input.record.threadId,
    telegramUserId: input.record.senderTelegramUserId,
    topicRole: 'purchase',
    activeWorkflow,
    messageText: input.record.rawText,
    explicitMention: stripExplicitBotMention(input.ctx) !== null,
    replyToBot: isReplyToCurrentBot(input.ctx),
    directBotAddress: false,
    memoryStore: input.memoryStore ?? {
      get() {
        return { summary: null, turns: [] }
      },
      appendTurn() {
        return { summary: null, turns: [] }
      }
    }
  })

  return input.router({
    locale: input.locale,
    topicRole: 'purchase',
    messageText: input.record.rawText,
    isExplicitMention: conversationContext.explicitMention,
    isReplyToBot: conversationContext.replyToBot,
    activeWorkflow,
    engagementAssessment: conversationContext.engagement,
    assistantContext: input.assistantContext ?? null,
    assistantTone: input.assistantTone ?? null,
    recentTurns: input.memoryStore?.get(key).turns ?? [],
    recentThreadMessages: conversationContext.recentThreadMessages.map((message) => ({
      role: message.role,
      speaker: message.speaker,
      text: message.text,
      threadId: message.threadId
    })),
    recentChatMessages: conversationContext.recentSessionMessages.map((message) => ({
      role: message.role,
      speaker: message.speaker,
      text: message.text,
      threadId: message.threadId
    }))
  })
}

async function handlePurchaseMessageResult(
  ctx: Context,
  record: PurchaseTopicRecord,
  result: PurchaseMessageIngestionResult,
  locale: BotLocale,
  logger: Logger | undefined,
  pendingReply: PendingPurchaseReply | null = null,
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
    pendingReply,
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
    null,
    formatPurchaseParticipants(locale, result.participants)
  )
}

function registerPurchaseProposalCallbacks(
  bot: Bot,
  repository: PurchaseMessageIngestionRepository,
  resolveLocale: (householdId: string) => Promise<BotLocale>,
  logger?: Logger
): void {
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
      await ctx.editMessageText(buildPurchaseActionMessage(locale, result), {
        reply_markup: emptyInlineKeyboard()
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
        reply_markup: emptyInlineKeyboard()
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

export function registerPurchaseTopicIngestion(
  bot: Bot,
  config: PurchaseTopicIngestionConfig,
  repository: PurchaseMessageIngestionRepository,
  options: {
    interpreter?: PurchaseMessageInterpreter
    router?: TopicMessageRouter
    memoryStore?: AssistantConversationMemoryStore
    historyRepository?: TopicMessageHistoryRepository
    logger?: Logger
  } = {}
): void {
  void registerPurchaseProposalCallbacks(bot, repository, async () => 'en', options.logger)

  bot.on('message:text', async (ctx, next) => {
    const candidate = toCandidateFromContext(ctx)
    if (!candidate) {
      await next()
      return
    }

    const record = extractPurchaseTopicCandidate(candidate, config)
    if (!record) {
      await next()
      return
    }

    let typingIndicator: ReturnType<typeof startTypingIndicator> | null = null

    try {
      const route =
        getCachedTopicMessageRoute(ctx, 'purchase') ??
        (await routePurchaseTopicMessage({
          ctx,
          record,
          locale: 'en',
          repository,
          router: options.router,
          memoryStore: options.memoryStore,
          historyRepository: options.historyRepository
        }))
      cacheTopicMessageRoute(ctx, 'purchase', route)

      if (route.route === 'silent') {
        rememberUserTurn(options.memoryStore, record)
        await next()
        return
      }

      if (route.shouldClearWorkflow) {
        await repository.clearClarificationContext?.(record)
      }

      if (route.route === 'chat_reply' || route.route === 'dismiss_workflow') {
        rememberUserTurn(options.memoryStore, record)
        if (route.replyText) {
          await replyToPurchaseMessage(ctx, route.replyText, undefined, {
            repository: options.historyRepository,
            record
          })
          rememberAssistantTurn(options.memoryStore, record, route.replyText)
        }
        return
      }

      if (route.route === 'topic_helper') {
        await next()
        return
      }

      if (route.route !== 'purchase_candidate' && route.route !== 'purchase_followup') {
        rememberUserTurn(options.memoryStore, record)
        await next()
        return
      }

      rememberUserTurn(options.memoryStore, record)
      typingIndicator =
        options.interpreter && route.shouldStartTyping ? startTypingIndicator(ctx) : null
      const pendingReply =
        options.interpreter && shouldShowProcessingReply(ctx, record, route)
          ? await sendPurchaseProcessingReply(ctx, getBotTranslations('en').purchase.processing)
          : null
      const result = await repository.save(record, options.interpreter, 'GEL')

      if (result.status === 'ignored_not_purchase') {
        if (route.route === 'purchase_followup') {
          await repository.clearClarificationContext?.(record)
        }
        return await next()
      }
      await handlePurchaseMessageResult(
        ctx,
        record,
        result,
        'en',
        options.logger,
        pendingReply,
        options.historyRepository
      )
      rememberAssistantTurn(options.memoryStore, record, buildPurchaseAcknowledgement(result, 'en'))
    } catch (error) {
      options.logger?.error(
        {
          event: 'purchase.ingest_failed',
          chatId: record.chatId,
          threadId: record.threadId,
          messageId: record.messageId,
          updateId: record.updateId,
          error
        },
        'Failed to ingest purchase topic message'
      )
    } finally {
      await persistIncomingTopicMessage(options.historyRepository, record)
      typingIndicator?.stop()
    }
  })
}

export function registerConfiguredPurchaseTopicIngestion(
  bot: Bot,
  householdConfigurationRepository: HouseholdConfigurationRepository,
  repository: PurchaseMessageIngestionRepository,
  options: {
    interpreter?: PurchaseMessageInterpreter
    router?: TopicMessageRouter
    topicProcessor?: import('./topic-processor').TopicProcessor
    contextCache?: import('./household-context-cache').HouseholdContextCache
    memoryStore?: AssistantConversationMemoryStore
    historyRepository?: TopicMessageHistoryRepository
    logger?: Logger
  } = {}
): void {
  void registerPurchaseProposalCallbacks(
    bot,
    repository,
    async (householdId) => resolveHouseholdLocale(householdConfigurationRepository, householdId),
    options.logger
  )

  bot.on('message:text', async (ctx, next) => {
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
    if (!record) {
      await next()
      return
    }

    let typingIndicator: ReturnType<typeof startTypingIndicator> | null = null

    try {
      // Load household context (cached)
      const householdContext = options.contextCache
        ? await options.contextCache.get(record.householdId, async () => {
            const [billingSettings, assistantConfig] = await Promise.all([
              householdConfigurationRepository.getHouseholdBillingSettings(record.householdId),
              resolveAssistantConfig(householdConfigurationRepository, record.householdId)
            ])
            const locale = await resolveHouseholdLocale(
              householdConfigurationRepository,
              record.householdId
            )
            return {
              householdContext: assistantConfig.assistantContext,
              assistantTone: assistantConfig.assistantTone,
              defaultCurrency: billingSettings.settlementCurrency,
              locale,
              cachedAt: Date.now()
            }
          })
        : {
            householdContext: null as string | null,
            assistantTone: null as string | null,
            defaultCurrency: 'GEL' as const,
            locale: 'en' as BotLocale,
            cachedAt: Date.now()
          }

      // Build conversation context
      const activeWorkflow = (await repository.hasClarificationContext(record))
        ? 'purchase_clarification'
        : null

      const conversationContext = await buildConversationContext({
        repository: options.historyRepository,
        householdId: record.householdId,
        telegramChatId: record.chatId,
        telegramThreadId: record.threadId,
        telegramUserId: record.senderTelegramUserId,
        topicRole: 'purchase',
        activeWorkflow,
        messageText: record.rawText,
        explicitMention: stripExplicitBotMention(ctx) !== null,
        replyToBot: isReplyToCurrentBot(ctx),
        directBotAddress: false,
        memoryStore: options.memoryStore ?? {
          get() {
            return { summary: null, turns: [] }
          },
          appendTurn() {
            return { summary: null, turns: [] }
          }
        }
      })

      // Get household members for the processor
      const householdMembers = await (async () => {
        if (!options.topicProcessor) return []
        // This will be loaded from DB in the actual implementation
        // For now, we return empty array - the processor will work without it
        return []
      })()

      // Use topic processor if available, fall back to legacy router
      if (options.topicProcessor) {
        const processorResult = await options.topicProcessor({
          locale: householdContext.locale === 'ru' ? 'ru' : 'en',
          topicRole: 'purchase',
          messageText: record.rawText,
          isExplicitMention: conversationContext.explicitMention,
          isReplyToBot: conversationContext.replyToBot,
          activeWorkflow,
          defaultCurrency: householdContext.defaultCurrency,
          householdContext: householdContext.householdContext,
          assistantTone: householdContext.assistantTone,
          householdMembers,
          senderMemberId: null, // Will be resolved in saveWithInterpretation
          recentThreadMessages: conversationContext.recentThreadMessages.map((m) => ({
            role: m.role,
            speaker: m.speaker,
            text: m.text
          })),
          recentChatMessages: conversationContext.recentSessionMessages.map((m) => ({
            role: m.role,
            speaker: m.speaker,
            text: m.text
          })),
          recentTurns: conversationContext.recentTurns,
          engagementAssessment: conversationContext.engagement
        })

        // Handle processor failure - fun "bot sleeps" message only if explicitly mentioned
        if (!processorResult) {
          if (conversationContext.explicitMention) {
            const { botSleepsMessage } = await import('./topic-processor')
            await replyToPurchaseMessage(
              ctx,
              botSleepsMessage(householdContext.locale === 'ru' ? 'ru' : 'en'),
              undefined,
              {
                repository: options.historyRepository,
                record
              }
            )
          } else {
            await next()
          }
          return
        }

        rememberUserTurn(options.memoryStore, record)

        // Handle different routes
        switch (processorResult.route) {
          case 'silent': {
            await next()
            return
          }

          case 'chat_reply': {
            await replyToPurchaseMessage(ctx, processorResult.replyText, undefined, {
              repository: options.historyRepository,
              record
            })
            rememberAssistantTurn(options.memoryStore, record, processorResult.replyText)
            return
          }

          case 'topic_helper': {
            await next()
            return
          }

          case 'dismiss_workflow': {
            await repository.clearClarificationContext?.(record)
            if (processorResult.replyText) {
              await replyToPurchaseMessage(ctx, processorResult.replyText, undefined, {
                repository: options.historyRepository,
                record
              })
              rememberAssistantTurn(options.memoryStore, record, processorResult.replyText)
            }
            return
          }

          case 'purchase_clarification': {
            typingIndicator = startTypingIndicator(ctx)
            const interpretation = toPurchaseClarificationInterpretation(processorResult)
            const result = await repository.saveWithInterpretation(record, interpretation)
            await handlePurchaseMessageResult(
              ctx,
              record,
              result,
              householdContext.locale,
              options.logger,
              null,
              options.historyRepository
            )
            rememberAssistantTurn(
              options.memoryStore,
              record,
              buildPurchaseAcknowledgement(result, householdContext.locale)
            )
            return
          }

          case 'purchase': {
            typingIndicator = startTypingIndicator(ctx)
            const interpretation = toPurchaseInterpretation(processorResult)
            const pendingReply = await sendPurchaseProcessingReply(
              ctx,
              getBotTranslations(householdContext.locale).purchase.processing
            )
            const result = await repository.saveWithInterpretation(record, interpretation)

            if (result.status === 'ignored_not_purchase') {
              await repository.clearClarificationContext?.(record)
              await next()
              return
            }

            await handlePurchaseMessageResult(
              ctx,
              record,
              result,
              householdContext.locale,
              options.logger,
              pendingReply,
              options.historyRepository
            )
            rememberAssistantTurn(
              options.memoryStore,
              record,
              buildPurchaseAcknowledgement(result, householdContext.locale)
            )
            return
          }

          default: {
            await next()
            return
          }
        }
      }

      // No topic processor available
      if (conversationContext.explicitMention) {
        const { botSleepsMessage } = await import('./topic-processor')
        await replyToPurchaseMessage(
          ctx,
          botSleepsMessage(householdContext.locale === 'ru' ? 'ru' : 'en'),
          undefined,
          {
            repository: options.historyRepository,
            record
          }
        )
      } else {
        await next()
      }
    } catch (error) {
      options.logger?.error(
        {
          event: 'purchase.ingest_failed',
          householdId: record.householdId,
          chatId: record.chatId,
          threadId: record.threadId,
          messageId: record.messageId,
          updateId: record.updateId,
          error
        },
        'Failed to ingest purchase topic message'
      )
    } finally {
      await persistIncomingTopicMessage(options.historyRepository, record)
      typingIndicator?.stop()
    }
  })
}
