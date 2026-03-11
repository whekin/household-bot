import { instantFromEpochSeconds, instantToDate, Money, type Instant } from '@household/domain'
import { and, desc, eq } from 'drizzle-orm'
import type { Bot, Context } from 'grammy'
import type { Logger } from '@household/observability'
import type {
  HouseholdConfigurationRepository,
  HouseholdTopicBindingRecord
} from '@household/ports'

import { createDbClient, schema } from '@household/db'
import { getBotTranslations, type BotLocale } from './i18n'
import type {
  PurchaseInterpretation,
  PurchaseMessageInterpreter
} from './openai-purchase-interpreter'
import { startTypingIndicator } from './telegram-chat-action'

const PURCHASE_CONFIRM_CALLBACK_PREFIX = 'purchase:confirm:'
const PURCHASE_CANCEL_CALLBACK_PREFIX = 'purchase:cancel:'
const MIN_PROPOSAL_CONFIDENCE = 70

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

export interface PurchaseMessageIngestionRepository {
  hasClarificationContext(record: PurchaseTopicRecord): Promise<boolean>
  save(
    record: PurchaseTopicRecord,
    interpreter?: PurchaseMessageInterpreter,
    defaultCurrency?: 'GEL' | 'USD'
  ): Promise<PurchaseMessageIngestionResult>
  confirm(
    purchaseMessageId: string,
    actorTelegramUserId: string
  ): Promise<PurchaseProposalActionResult>
  cancel(
    purchaseMessageId: string,
    actorTelegramUserId: string
  ): Promise<PurchaseProposalActionResult>
}

interface PurchasePersistenceDecision {
  status: 'pending_confirmation' | 'clarification_needed' | 'ignored_not_purchase' | 'parse_failed'
  parsedAmountMinor: bigint | null
  parsedCurrency: 'GEL' | 'USD' | null
  parsedItemDescription: string | null
  parserConfidence: number | null
  parserMode: 'llm' | null
  clarificationQuestion: string | null
  parserError: string | null
  needsReview: boolean
}

const CLARIFICATION_CONTEXT_MAX_AGE_MS = 30 * 60_000
const MAX_CLARIFICATION_CONTEXT_MESSAGES = 3

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
    parserConfidence: interpretation.confidence,
    parserMode: interpretation.parserMode,
    clarificationQuestion: null,
    parserError: null,
    needsReview: false
  }
}

function needsReviewAsInt(value: boolean): number {
  return value ? 1 : 0
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
    parserConfidence: row.parserConfidence,
    parserMode: row.parserMode
  }
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
  }
): Promise<void> {
  const message = ctx.msg
  if (!message) {
    return
  }

  await ctx.reply(text, {
    reply_parameters: {
      message_id: message.message_id
    },
    ...(replyMarkup
      ? {
          reply_markup: replyMarkup
        }
      : {})
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
    await replyToPurchaseMessage(ctx, text, replyMarkup)
    return
  }

  try {
    await ctx.api.editMessageText(
      pendingReply.chatId,
      pendingReply.messageId,
      text,
      replyMarkup ? { reply_markup: replyMarkup } : {}
    )
  } catch {
    await replyToPurchaseMessage(ctx, text, replyMarkup)
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
    rawText: message.text,
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
      ...toProposalFields(stored)
    }
  }

  const repository: PurchaseMessageIngestionRepository = {
    async hasClarificationContext(record) {
      const clarificationContext = await getClarificationContext(record)
      return Boolean(clarificationContext && clarificationContext.length > 0)
    },

    async save(record, interpreter, defaultCurrency) {
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
      let parserError: string | null = null
      const clarificationContext = interpreter ? await getClarificationContext(record) : undefined

      const interpretation = interpreter
        ? await interpreter(record.rawText, {
            defaultCurrency: defaultCurrency ?? 'GEL',
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
            parserConfidence: decision.parserConfidence,
            parserMode: decision.parserMode
          }
        case 'pending_confirmation':
          return {
            status: 'pending_confirmation',
            purchaseMessageId: insertedRow.id,
            parsedAmountMinor: decision.parsedAmountMinor!,
            parsedCurrency: decision.parsedCurrency!,
            parsedItemDescription: decision.parsedItemDescription!,
            parserConfidence: decision.parserConfidence ?? MIN_PROPOSAL_CONFIDENCE,
            parserMode: decision.parserMode ?? 'llm'
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
      return t.proposal(formatPurchaseSummary(locale, result))
    case 'clarification_needed':
      return t.clarification(result.clarificationQuestion ?? clarificationFallback(locale, result))
    case 'parse_failed':
      return t.parseFailed
  }
}

function purchaseProposalReplyMarkup(locale: BotLocale, purchaseMessageId: string) {
  const t = getBotTranslations(locale).purchase

  return {
    inline_keyboard: [
      [
        {
          text: t.confirmButton,
          callback_data: `${PURCHASE_CONFIRM_CALLBACK_PREFIX}${purchaseMessageId}`
        },
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

async function handlePurchaseMessageResult(
  ctx: Context,
  record: PurchaseTopicRecord,
  result: PurchaseMessageIngestionResult,
  locale: BotLocale,
  logger: Logger | undefined,
  pendingReply: PendingPurchaseReply | null = null
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
      ? purchaseProposalReplyMarkup(locale, result.purchaseMessageId)
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

  if (result.status === 'confirmed' || result.status === 'already_confirmed') {
    return t.confirmed(summary)
  }

  return t.cancelled(summary)
}

function registerPurchaseProposalCallbacks(
  bot: Bot,
  repository: PurchaseMessageIngestionRepository,
  resolveLocale: (householdId: string) => Promise<BotLocale>,
  logger?: Logger
): void {
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

    const typingIndicator = options.interpreter ? startTypingIndicator(ctx) : null

    try {
      const pendingReply = options.interpreter
        ? await sendPurchaseProcessingReply(ctx, getBotTranslations('en').purchase.processing)
        : null
      const result = await repository.save(record, options.interpreter, 'GEL')
      await handlePurchaseMessageResult(ctx, record, result, 'en', options.logger, pendingReply)
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

    const typingIndicator = options.interpreter ? startTypingIndicator(ctx) : null

    try {
      const billingSettings = await householdConfigurationRepository.getHouseholdBillingSettings(
        record.householdId
      )
      const locale = await resolveHouseholdLocale(
        householdConfigurationRepository,
        record.householdId
      )
      const pendingReply = options.interpreter
        ? await sendPurchaseProcessingReply(ctx, getBotTranslations(locale).purchase.processing)
        : null
      const result = await repository.save(
        record,
        options.interpreter,
        billingSettings.settlementCurrency
      )

      await handlePurchaseMessageResult(ctx, record, result, locale, options.logger, pendingReply)
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
      typingIndicator?.stop()
    }
  })
}
