import {
  buildMemberPaymentGuidance,
  type FinanceCommandService,
  type HouseholdAuditNotificationService,
  type PaymentConfirmationService,
  type PaymentConfirmationSubmitResult
} from '@household/application'
import { instantFromEpochSeconds, Money, nowInstant, type Instant } from '@household/domain'
import type { Bot, Context } from 'grammy'
import type { Logger } from '@household/observability'
import type {
  HouseholdConfigurationRepository,
  HouseholdTopicBindingRecord,
  TelegramPendingActionRepository,
  TopicMessageHistoryRepository
} from '@household/ports'

import { getBotTranslations, type BotLocale } from './i18n'
import type { AssistantConversationMemoryStore } from './assistant-state'
import { conversationMemoryKey } from './assistant-state'

import {
  formatPaymentBalanceReplyText,
  formatPaymentProposalText,
  type MultiMemberPaymentProposal,
  type SemanticPaymentCandidate,
  maybeCreatePaymentBalanceReply,
  maybeCreatePaymentProposalFromCandidate,
  parsePaymentProposalPayload,
  synthesizePaymentConfirmationText
} from './payment-proposals'
import {
  cacheTopicMessageRoute,
  fallbackTopicMessageRoute,
  type TopicMessageRouter
} from './topic-message-router'
import {
  persistTopicHistoryMessage,
  telegramMessageIdFromMessage,
  telegramMessageSentAtFromMessage
} from './topic-history'
import { stripExplicitBotMention } from './telegram-mentions'

const PAYMENT_TOPIC_CONFIRM_CALLBACK_PREFIX = 'payment_topic:confirm:'
const PAYMENT_TOPIC_CANCEL_CALLBACK_PREFIX = 'payment_topic:cancel:'
const PAYMENT_TOPIC_MULTI_CONFIRM_CALLBACK_PREFIX = 'pt:mc:'
const PAYMENT_TOPIC_MULTI_TOGGLE_CALLBACK_PREFIX = 'pt:mt:'
const PAYMENT_TOPIC_MULTI_CANCEL_CALLBACK_PREFIX = 'pt:cancel:'
const PAYMENT_TOPIC_CLARIFICATION_CANCEL_CALLBACK_PREFIX = 'pt:cc:'
const PAYMENT_TOPIC_CLARIFICATION_ACTION = 'payment_topic_clarification' as const
const PAYMENT_TOPIC_CONFIRMATION_ACTION = 'payment_topic_confirmation' as const
const PAYMENT_TOPIC_ACTION_TTL_MS = 30 * 60_000
const PAYMENT_TOPIC_MIN_PAYMENT_CONFIDENCE = 80

export interface PaymentTopicCandidate {
  updateId: number
  chatId: string
  messageId: string
  threadId: string
  senderTelegramUserId: string
  rawText: string
  attachmentCount: number
  messageSentAt: Instant
}

export interface PaymentTopicRecord extends PaymentTopicCandidate {
  householdId: string
}

interface PaymentTopicClarificationPayload {
  householdId?: string
  threadId: string
  rawText: string
}

interface PaymentTopicConfirmationPayload {
  proposalId: string
  householdId: string
  memberId: string
  kind: 'rent' | 'utilities'
  period?: string
  amountMinor: string
  currency: 'GEL' | 'USD'
  rawText: string
  senderTelegramUserId: string
  reportedTelegramUserId: string | null
  reportedDisplayName: string | null
  isThirdParty: boolean
  telegramChatId: string
  telegramMessageId: string
  telegramThreadId: string
  telegramUpdateId: string
  attachmentCount: number
  messageSentAt: Instant | null
}

interface PaymentTopicMultiConfirmationPayload {
  proposalId: string
  householdId: string
  kind: 'rent' | 'utilities'
  period: string
  ownerTelegramUserId: string
  rawText: string
  telegramChatId: string
  telegramMessageId: string
  telegramThreadId: string
  telegramUpdateId: string
  attachmentCount: number
  members: Array<{
    memberId: string
    telegramUserId: string
    displayName: string
    paymentStatus: 'paid' | 'unpaid'
    amountMinor: string
    currency: 'GEL' | 'USD'
    selected: boolean
  }>
}

function readMessageText(ctx: Context): string | null {
  const message = ctx.message
  if (!message) {
    return null
  }

  if ('text' in message && typeof message.text === 'string') {
    return message.text
  }

  if ('caption' in message && typeof message.caption === 'string') {
    return message.caption
  }

  return null
}

function attachmentCount(ctx: Context): number {
  const message = ctx.message
  if (!message) {
    return 0
  }

  if ('photo' in message && Array.isArray(message.photo)) {
    return message.photo.length
  }

  if ('document' in message && message.document) {
    return 1
  }

  return 0
}

function isReplyToBotMessage(ctx: Context): boolean {
  const replyAuthor = ctx.msg?.reply_to_message?.from
  if (!replyAuthor) {
    return false
  }

  return replyAuthor.id === ctx.me.id
}

function cacheFallbackPaymentRoute(input: {
  ctx: Context
  locale: BotLocale
  messageText: string
  isExplicitMention: boolean
  isReplyToBot: boolean
  activeWorkflow: 'payment_clarification' | 'payment_confirmation' | null
}): void {
  cacheTopicMessageRoute(
    input.ctx,
    'payments',
    fallbackTopicMessageRoute({
      locale: input.locale,
      topicRole: 'payments',
      messageText: input.messageText,
      isExplicitMention: input.isExplicitMention,
      isReplyToBot: input.isReplyToBot,
      activeWorkflow: input.activeWorkflow
    })
  )
}

function toCandidateFromContext(ctx: Context): PaymentTopicCandidate | null {
  const message = ctx.message
  const rawText = stripExplicitBotMention(ctx)?.strippedText ?? readMessageText(ctx)
  if (!message || !rawText) {
    return null
  }

  if (!('is_topic_message' in message) || message.is_topic_message !== true) {
    return null
  }

  if (!('message_thread_id' in message) || message.message_thread_id === undefined) {
    return null
  }

  const senderTelegramUserId = ctx.from?.id?.toString()
  if (!senderTelegramUserId) {
    return null
  }

  return {
    updateId: ctx.update.update_id,
    chatId: message.chat.id.toString(),
    messageId: message.message_id.toString(),
    threadId: message.message_thread_id.toString(),
    senderTelegramUserId,
    rawText,
    attachmentCount: attachmentCount(ctx),
    messageSentAt: instantFromEpochSeconds(message.date)
  }
}

export function resolveConfiguredPaymentTopicRecord(
  value: PaymentTopicCandidate,
  binding: HouseholdTopicBindingRecord
): PaymentTopicRecord | null {
  const normalizedText = value.rawText.trim()
  if (normalizedText.length === 0) {
    return null
  }

  if (normalizedText.startsWith('/')) {
    return null
  }

  if (binding.role !== 'payments') {
    return null
  }

  return {
    ...value,
    rawText: normalizedText,
    householdId: binding.householdId
  }
}

async function resolveAssistantConfig(
  householdConfigurationRepository: HouseholdConfigurationRepository,
  householdId: string
): Promise<{
  assistantContext: string | null
  assistantTone: string | null
}> {
  const config = householdConfigurationRepository.getHouseholdAssistantConfig
    ? await householdConfigurationRepository.getHouseholdAssistantConfig(householdId)
    : null

  return {
    assistantContext: config?.assistantContext ?? null,
    assistantTone: config?.assistantTone ?? null
  }
}

function memoryKeyForRecord(record: PaymentTopicRecord): string {
  return conversationMemoryKey({
    telegramUserId: record.senderTelegramUserId,
    telegramChatId: record.chatId,
    isPrivateChat: false
  })
}

function appendConversation(
  memoryStore: AssistantConversationMemoryStore | undefined,
  record: PaymentTopicRecord,
  userText: string,
  assistantText: string
): void {
  if (!memoryStore) {
    return
  }

  const key = memoryKeyForRecord(record)
  memoryStore.appendTurn(key, {
    role: 'user',
    text: userText
  })
  memoryStore.appendTurn(key, {
    role: 'assistant',
    text: assistantText
  })
}

async function persistIncomingTopicMessage(
  repository: TopicMessageHistoryRepository | undefined,
  record: PaymentTopicRecord
) {
  await persistTopicHistoryMessage({
    repository,
    householdId: record.householdId,
    telegramChatId: record.chatId,
    telegramThreadId: record.threadId,
    telegramMessageId: record.messageId,
    telegramUpdateId: String(record.updateId),
    senderTelegramUserId: record.senderTelegramUserId,
    senderDisplayName: null,
    isBot: false,
    rawText: record.rawText,
    messageSentAt: record.messageSentAt
  })
}

export function buildPaymentAcknowledgement(
  locale: BotLocale,
  result:
    | { status: 'duplicate' }
    | {
        status: 'already_settled'
        kind: 'rent' | 'utilities'
      }
    | {
        status: 'recorded'
        kind: 'rent' | 'utilities'
        amountMajor: string
        currency: 'USD' | 'GEL'
      }
    | { status: 'needs_review' }
): string | null {
  const t = getBotTranslations(locale).payments

  switch (result.status) {
    case 'duplicate':
      return null
    case 'already_settled':
      return t.alreadySettled(result.kind)
    case 'recorded':
      return t.recorded(result.kind, result.amountMajor, result.currency)
    case 'needs_review':
      return null
  }
}

function formatPeriodLabel(locale: BotLocale, period: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period)
  if (!match) {
    return period
  }

  const year = Number(match[1])
  const month = Number(match[2])
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return period
  }

  return new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(Date.UTC(year, month - 1, 1)))
}

function parsePaymentClarificationPayload(
  payload: Record<string, unknown>
): PaymentTopicClarificationPayload | null {
  if (typeof payload.threadId !== 'string' || typeof payload.rawText !== 'string') {
    return null
  }

  return {
    threadId: payload.threadId,
    rawText: payload.rawText
  }
}

function parsePaymentTopicConfirmationPayload(
  payload: Record<string, unknown>
): PaymentTopicConfirmationPayload | null {
  const proposal = parsePaymentProposalPayload(payload)
  if (
    !proposal ||
    typeof payload.rawText !== 'string' ||
    typeof payload.senderTelegramUserId !== 'string' ||
    !(
      typeof payload.reportedTelegramUserId === 'string' ||
      payload.reportedTelegramUserId === null ||
      payload.reportedTelegramUserId === undefined
    ) ||
    !(
      typeof payload.reportedDisplayName === 'string' ||
      payload.reportedDisplayName === null ||
      payload.reportedDisplayName === undefined
    ) ||
    !(typeof payload.isThirdParty === 'boolean' || payload.isThirdParty === undefined) ||
    typeof payload.telegramChatId !== 'string' ||
    typeof payload.telegramMessageId !== 'string' ||
    typeof payload.telegramThreadId !== 'string' ||
    typeof payload.telegramUpdateId !== 'string' ||
    typeof payload.attachmentCount !== 'number'
  ) {
    return null
  }

  return {
    ...proposal,
    rawText: payload.rawText,
    senderTelegramUserId: payload.senderTelegramUserId,
    reportedTelegramUserId:
      typeof payload.reportedTelegramUserId === 'string' ? payload.reportedTelegramUserId : null,
    reportedDisplayName:
      typeof payload.reportedDisplayName === 'string' ? payload.reportedDisplayName : null,
    isThirdParty: payload.isThirdParty === true,
    telegramChatId: payload.telegramChatId,
    telegramMessageId: payload.telegramMessageId,
    telegramThreadId: payload.telegramThreadId,
    telegramUpdateId: payload.telegramUpdateId,
    attachmentCount: payload.attachmentCount,
    messageSentAt: null
  }
}

function parsePaymentTopicMultiConfirmationPayload(
  payload: Record<string, unknown>
): PaymentTopicMultiConfirmationPayload | null {
  if (
    typeof payload.proposalId !== 'string' ||
    typeof payload.householdId !== 'string' ||
    (payload.kind !== 'rent' && payload.kind !== 'utilities') ||
    typeof payload.period !== 'string' ||
    typeof payload.ownerTelegramUserId !== 'string' ||
    typeof payload.rawText !== 'string' ||
    typeof payload.telegramChatId !== 'string' ||
    typeof payload.telegramMessageId !== 'string' ||
    typeof payload.telegramThreadId !== 'string' ||
    typeof payload.telegramUpdateId !== 'string' ||
    typeof payload.attachmentCount !== 'number' ||
    !Array.isArray(payload.members)
  ) {
    return null
  }

  const members = payload.members
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return null
      }
      const record = entry as Record<string, unknown>
      if (
        typeof record.memberId !== 'string' ||
        typeof record.telegramUserId !== 'string' ||
        typeof record.displayName !== 'string' ||
        (record.paymentStatus !== 'paid' && record.paymentStatus !== 'unpaid') ||
        typeof record.amountMinor !== 'string' ||
        (record.currency !== 'GEL' && record.currency !== 'USD') ||
        typeof record.selected !== 'boolean'
      ) {
        return null
      }
      return {
        memberId: record.memberId,
        telegramUserId: record.telegramUserId,
        displayName: record.displayName,
        paymentStatus: record.paymentStatus,
        amountMinor: record.amountMinor,
        currency: record.currency,
        selected: record.selected
      }
    })
    .filter(
      (entry): entry is PaymentTopicMultiConfirmationPayload['members'][number] => entry !== null
    )

  if (members.length === 0) {
    return null
  }

  return {
    proposalId: payload.proposalId,
    householdId: payload.householdId,
    kind: payload.kind,
    period: payload.period,
    ownerTelegramUserId: payload.ownerTelegramUserId,
    rawText: payload.rawText,
    telegramChatId: payload.telegramChatId,
    telegramMessageId: payload.telegramMessageId,
    telegramThreadId: payload.telegramThreadId,
    telegramUpdateId: payload.telegramUpdateId,
    attachmentCount: payload.attachmentCount,
    members
  }
}

function buildMultiConfirmationPayload(
  record: PaymentTopicRecord,
  rawText: string,
  proposal: MultiMemberPaymentProposal
): PaymentTopicMultiConfirmationPayload {
  return {
    proposalId: proposal.proposalId,
    householdId: proposal.householdId,
    kind: proposal.kind,
    period: proposal.period,
    ownerTelegramUserId: record.senderTelegramUserId,
    rawText,
    telegramChatId: record.chatId,
    telegramMessageId: record.messageId,
    telegramThreadId: record.threadId,
    telegramUpdateId: String(record.updateId),
    attachmentCount: record.attachmentCount,
    members: proposal.members.map((member) => ({ ...member }))
  }
}

function actorCanManagePaymentProposal(
  actorTelegramUserId: string,
  payload: PaymentTopicConfirmationPayload
): boolean {
  return (
    actorTelegramUserId === payload.senderTelegramUserId ||
    actorTelegramUserId === payload.reportedTelegramUserId
  )
}

async function clearPaymentProposalPendingActions(
  promptRepository: TelegramPendingActionRepository,
  payload: PaymentTopicConfirmationPayload
) {
  await promptRepository.clearPendingAction(payload.telegramChatId, payload.senderTelegramUserId)
  if (
    payload.reportedTelegramUserId &&
    payload.reportedTelegramUserId !== payload.senderTelegramUserId
  ) {
    await promptRepository.clearPendingAction(
      payload.telegramChatId,
      payload.reportedTelegramUserId
    )
  }
}

async function upsertPaymentProposalPendingActions(
  promptRepository: TelegramPendingActionRepository,
  payload: PaymentTopicConfirmationPayload,
  expiresAt: Instant
) {
  await promptRepository.upsertPendingAction({
    telegramUserId: payload.senderTelegramUserId,
    telegramChatId: payload.telegramChatId,
    action: PAYMENT_TOPIC_CONFIRMATION_ACTION,
    payload: { ...payload },
    expiresAt
  })

  if (
    payload.reportedTelegramUserId &&
    payload.reportedTelegramUserId !== payload.senderTelegramUserId
  ) {
    await promptRepository.upsertPendingAction({
      telegramUserId: payload.reportedTelegramUserId,
      telegramChatId: payload.telegramChatId,
      action: PAYMENT_TOPIC_CONFIRMATION_ACTION,
      payload: { ...payload },
      expiresAt
    })
  }
}

function formatRecordedPaymentText(
  locale: BotLocale,
  payload: PaymentTopicConfirmationPayload,
  amount: Money
): string {
  const t = getBotTranslations(locale).payments

  return payload.isThirdParty && payload.reportedDisplayName
    ? t.recordedReported(
        payload.reportedDisplayName,
        payload.kind,
        amount.toMajorString(),
        amount.currency
      )
    : t.recorded(payload.kind, amount.toMajorString(), amount.currency)
}

function formatMultiPaymentProposalText(
  locale: BotLocale,
  payload: PaymentTopicMultiConfirmationPayload
): string {
  const t = getBotTranslations(locale).payments
  const lines = [
    t.multiProposal(payload.kind, formatPeriodLabel(locale, payload.period)),
    ...payload.members.map((member) =>
      t.multiMemberLine(member.displayName, member.paymentStatus, member.selected)
    )
  ]

  return lines.join('\n')
}

function formatMultiRecordedText(
  locale: BotLocale,
  payload: PaymentTopicMultiConfirmationPayload,
  fullyPaid: boolean,
  handledMemberIds?: ReadonlySet<string>,
  alreadyPaidMemberIds?: ReadonlySet<string>
): string {
  const t = getBotTranslations(locale).payments
  if (fullyPaid) {
    return t.fullyPaid(payload.kind, formatPeriodLabel(locale, payload.period))
  }

  const recordedNames = payload.members
    .filter((member) => member.selected && handledMemberIds?.has(member.memberId) !== false)
    .map((member) => member.displayName)
    .join(', ')
  const alreadyPaidNames =
    alreadyPaidMemberIds && alreadyPaidMemberIds.size > 0
      ? payload.members
          .filter((member) => alreadyPaidMemberIds.has(member.memberId))
          .map((member) => member.displayName)
          .join(', ')
      : ''
  const lines = [
    recordedNames ? t.multiRecorded(payload.kind, recordedNames) : null,
    alreadyPaidNames ? t.multiAlreadyPaid(payload.kind, alreadyPaidNames) : null
  ].filter((line): line is string => Boolean(line))

  return lines.length > 0
    ? lines.join('\n')
    : t.multiAlreadyPaid(
        payload.kind,
        payload.members
          .filter((member) => member.selected || member.paymentStatus === 'paid')
          .map((member) => member.displayName)
          .join(', ')
      )
}

function formatMultiPartialRecordedText(
  locale: BotLocale,
  payload: PaymentTopicMultiConfirmationPayload,
  recordedMemberIds: ReadonlySet<string>,
  alreadyPaidMemberIds: ReadonlySet<string> = new Set()
): string {
  const t = getBotTranslations(locale).payments
  const selectedMembers = payload.members.filter((member) => member.selected)
  const recordedNames = selectedMembers
    .filter((member) => recordedMemberIds.has(member.memberId))
    .map((member) => member.displayName)
    .join(', ')
  const alreadyPaidNames = selectedMembers
    .filter((member) => alreadyPaidMemberIds.has(member.memberId))
    .map((member) => member.displayName)
    .join(', ')
  const failedNames = selectedMembers
    .filter(
      (member) =>
        !recordedMemberIds.has(member.memberId) && !alreadyPaidMemberIds.has(member.memberId)
    )
    .map((member) => member.displayName)
    .join(', ')

  const lines = [
    t.multiPartiallyRecorded(payload.kind, recordedNames || 'none', failedNames || 'none'),
    alreadyPaidNames ? t.multiAlreadyPaid(payload.kind, alreadyPaidNames) : null
  ].filter((line): line is string => Boolean(line))

  return lines.join('\n')
}

function isHandledPaymentSubmitResult(result: PaymentConfirmationSubmitResult): boolean {
  return (
    result.status === 'recorded' ||
    result.status === 'duplicate' ||
    result.status === 'already_settled'
  )
}

function isLikelyUtilityTemplate(rawText: string): boolean {
  const lines = rawText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (lines.length < 2) {
    return false
  }

  const templateLineCount = lines.filter((line) =>
    /^[^:\n]{2,}:\s*(?:\d+(?:[.,]\d{1,2})?|0|skip|пропуск|нет|-)?(?:\s+(?:USD|GEL))?$/i.test(line)
  ).length

  return templateLineCount >= 2
}

function paymentProposalReplyMarkup(locale: BotLocale, proposalId: string) {
  const t = getBotTranslations(locale).payments

  return {
    inline_keyboard: [
      [
        {
          text: t.confirmButton,
          callback_data: `${PAYMENT_TOPIC_CONFIRM_CALLBACK_PREFIX}${proposalId}`
        },
        {
          text: t.cancelButton,
          callback_data: `${PAYMENT_TOPIC_CANCEL_CALLBACK_PREFIX}${proposalId}`
        }
      ]
    ]
  }
}

function multiPaymentProposalReplyMarkup(
  locale: BotLocale,
  payload: PaymentTopicMultiConfirmationPayload
) {
  const t = getBotTranslations(locale).payments

  return {
    inline_keyboard: [
      ...payload.members
        .filter((member) => member.paymentStatus === 'unpaid')
        .map((member) => [
          {
            text: member.selected ? `✅ ${member.displayName}` : `⬜ ${member.displayName}`,
            callback_data: `${PAYMENT_TOPIC_MULTI_TOGGLE_CALLBACK_PREFIX}${payload.proposalId}:${member.memberId}`
          }
        ]),
      [
        {
          text: t.confirmSelectedButton,
          callback_data: `${PAYMENT_TOPIC_MULTI_CONFIRM_CALLBACK_PREFIX}${payload.proposalId}`
        },
        {
          text: t.cancelButton,
          callback_data: `${PAYMENT_TOPIC_MULTI_CANCEL_CALLBACK_PREFIX}${payload.proposalId}`
        }
      ]
    ]
  }
}

async function getMultiPaymentPendingAction(input: {
  promptRepository: TelegramPendingActionRepository
  telegramChatId: string
  actorTelegramUserId: string
  proposalId: string
}): Promise<PaymentTopicMultiConfirmationPayload | null> {
  const actorPending = await input.promptRepository.getPendingAction(
    input.telegramChatId,
    input.actorTelegramUserId
  )
  const actorPayload =
    actorPending?.action === PAYMENT_TOPIC_CONFIRMATION_ACTION
      ? parsePaymentTopicMultiConfirmationPayload(actorPending.payload)
      : null
  if (actorPayload?.proposalId === input.proposalId) {
    return actorPayload
  }

  const proposalPending = await input.promptRepository.findPendingActionByPayloadValue?.(
    input.telegramChatId,
    PAYMENT_TOPIC_CONFIRMATION_ACTION,
    'proposalId',
    input.proposalId
  )

  return proposalPending?.action === PAYMENT_TOPIC_CONFIRMATION_ACTION
    ? parsePaymentTopicMultiConfirmationPayload(proposalPending.payload)
    : null
}

async function isPaymentKindFullyPaid(input: {
  financeService: FinanceCommandService
  kind: 'rent' | 'utilities'
  period: string
}): Promise<boolean> {
  const dashboard = await input.financeService.generateDashboard(input.period)
  const period = dashboard?.paymentPeriods?.find((candidate) => candidate.period === input.period)
  const kindSummary = period?.kinds.find((candidate) => candidate.kind === input.kind)
  return Boolean(kindSummary && kindSummary.totalRemaining.amountMinor <= 0n)
}

async function resolveCurrentPayableMultiMemberAmounts(input: {
  financeService: FinanceCommandService
  householdConfigurationRepository: HouseholdConfigurationRepository
  householdId: string
  kind: 'rent' | 'utilities'
  period: string
  members: readonly PaymentTopicMultiConfirmationPayload['members'][number][]
}): Promise<Map<string, Money>> {
  const [dashboard, settings] = await Promise.all([
    input.financeService.generateDashboard(input.period),
    input.householdConfigurationRepository.getHouseholdBillingSettings(input.householdId)
  ])
  const amounts = new Map<string, Money>()
  if (!dashboard) {
    return amounts
  }
  const kindSummary =
    dashboard.paymentPeriods
      ?.find((period) => period.period === input.period)
      ?.kinds.find((candidate) => candidate.kind === input.kind) ?? null
  const unresolvedMemberIds = new Set(
    kindSummary?.unresolvedMembers.map((member) => member.memberId) ?? []
  )

  for (const member of input.members) {
    if (kindSummary && !unresolvedMemberIds.has(member.memberId)) {
      continue
    }
    const memberLine = dashboard.members.find((line) => line.memberId === member.memberId)
    if (!memberLine) {
      continue
    }
    const guidance = buildMemberPaymentGuidance({
      kind: input.kind,
      period: input.period,
      memberLine,
      settings,
      paymentKindSummary: kindSummary
    })
    if (guidance.proposalAmount.amountMinor > 0n) {
      amounts.set(member.memberId, guidance.proposalAmount)
    }
  }

  return amounts
}

function isBareCompletionAcknowledgement(rawText: string): boolean {
  return /^(готово|done|ок|ok|✅|✔️?)$/iu.test(rawText.trim())
}

function normalizePaymentEvidence(input: {
  evidence?: 'explicit_text' | 'reply_context' | 'active_workflow' | undefined
  isReplyToBot: boolean
  activeWorkflow: string | null
}): SemanticPaymentCandidate['evidence'] {
  if (input.evidence === 'reply_context' && input.isReplyToBot) {
    return 'reply_context'
  }

  if (
    input.evidence === 'active_workflow' &&
    (input.activeWorkflow === 'payment_confirmation' ||
      input.activeWorkflow === 'payment_clarification')
  ) {
    return 'active_workflow'
  }

  if (
    input.activeWorkflow === 'payment_confirmation' ||
    input.activeWorkflow === 'payment_clarification'
  ) {
    return 'active_workflow'
  }

  return input.isReplyToBot ? 'reply_context' : 'explicit_text'
}

function semanticPaymentCandidateFromProcessor(input: {
  result: Extract<import('./topic-processor').TopicProcessorResult, { route: 'payment' }>
  rawText: string
  isReplyToBot: boolean
  activeWorkflow: string | null
}): SemanticPaymentCandidate | null {
  if (input.result.confidence < PAYMENT_TOPIC_MIN_PAYMENT_CONFIDENCE) {
    return null
  }

  const evidence = normalizePaymentEvidence({
    evidence: input.result.evidence,
    isReplyToBot: input.isReplyToBot,
    activeWorkflow: input.activeWorkflow
  })
  if (isBareCompletionAcknowledgement(input.rawText) && evidence === 'explicit_text') {
    return null
  }

  return {
    assertion: 'completed_payment',
    kind: input.result.kind,
    payerDisplayName: input.result.payerDisplayName,
    amountMinor: input.result.amountMinor,
    currency: input.result.currency,
    confidence: input.result.confidence,
    evidence
  }
}

function validatedCurrentMessageAmount(input: {
  rawText: string
  amountMinor: string | null | undefined
  currency: 'GEL' | 'USD' | null | undefined
}): { amountMinor: string; currency: 'GEL' | 'USD' } | null {
  if (!input.amountMinor || !input.currency || !/^[0-9]+$/.test(input.amountMinor)) {
    return null
  }

  const expectedAmount = BigInt(input.amountMinor)
  const detectedAmounts = parseCurrentMessageAmounts(input.rawText)
  const hasExactCurrentMessageAmount = detectedAmounts.some(
    (amount) => amount.currency === input.currency && amount.amountMinor === expectedAmount
  )

  return hasExactCurrentMessageAmount
    ? {
        amountMinor: input.amountMinor,
        currency: input.currency
      }
    : null
}

function parseCurrentMessageAmounts(
  rawText: string
): readonly { amountMinor: bigint; currency: 'GEL' | 'USD' }[] {
  const results: { amountMinor: bigint; currency: 'GEL' | 'USD' }[] = []
  const pushAmount = (rawAmount: string, rawCurrency: string) => {
    const currency = /^(usd|dollar|dollars|\$)$/iu.test(rawCurrency.toLowerCase()) ? 'USD' : 'GEL'
    results.push({
      amountMinor: Money.fromMajor(rawAmount.replace(',', '.'), currency).amountMinor,
      currency
    })
  }

  const amountThenCurrency =
    /(\d+(?:[.,]\d{1,2})?)\s*(usd|dollars?|gel|lari|лар[и]?|ლარ[ი]?|₾|\$)(?=$|[^\p{L}\p{N}])/giu
  for (const match of rawText.matchAll(amountThenCurrency)) {
    if (match[1] && match[2]) {
      pushAmount(match[1], match[2])
    }
  }

  const currencyThenAmount =
    /(?:^|[^\p{L}\p{N}])(usd|dollars?|gel|lari|лар[и]?|ლარ[ი]?|₾|\$)\s*(\d+(?:[.,]\d{1,2})?)/giu
  for (const match of rawText.matchAll(currencyThenAmount)) {
    if (match[1] && match[2]) {
      pushAmount(match[2], match[1])
    }
  }

  return results
}

function formatPaymentTopicBillingContext(input: {
  dashboard: Awaited<ReturnType<FinanceCommandService['generateDashboard']>> | null
}): string | null {
  const dashboard = input.dashboard
  if (!dashboard) {
    return null
  }

  const currentPeriod = dashboard.paymentPeriods?.find(
    (period) => period.isCurrentPeriod || period.period === dashboard.period
  )
  const kindLines =
    currentPeriod?.kinds.map((kind) => {
      const unresolved = kind.unresolvedMembers
        .map((member) => `${member.displayName}(${member.memberId})`)
        .join(', ')
      return `${kind.kind}: remaining=${kind.totalRemaining.toMajorString()} ${kind.totalRemaining.currency}; unresolved=${unresolved || 'none'}`
    }) ?? []

  return [
    'Payment billing context:',
    `- active period: ${dashboard.period}`,
    `- billing stage: ${dashboard.billingStage}`,
    ...kindLines.map((line) => `- ${line}`)
  ].join('\n')
}

async function isActorHouseholdAdmin(input: {
  financeServiceForHousehold: (householdId: string) => FinanceCommandService
  householdId: string
  actorTelegramUserId: string
}): Promise<boolean> {
  const actor = await input
    .financeServiceForHousehold(input.householdId)
    .getMemberByTelegramUserId(input.actorTelegramUserId)
  return actor?.isAdmin === true
}

async function replyWithPaymentBalanceQuestionIfPossible(input: {
  ctx: Context
  locale: BotLocale
  record: PaymentTopicRecord
  rawText: string
  financeService: FinanceCommandService
  memberId: string
  householdConfigurationRepository: HouseholdConfigurationRepository
  memoryStore?: AssistantConversationMemoryStore
  historyRepository?: TopicMessageHistoryRepository
}): Promise<boolean> {
  const balanceReply = await maybeCreatePaymentBalanceReply({
    rawText: input.rawText,
    householdId: input.record.householdId,
    memberId: input.memberId,
    financeService: input.financeService,
    householdConfigurationRepository: input.householdConfigurationRepository
  })

  if (!balanceReply) {
    return false
  }

  const helperText = formatPaymentBalanceReplyText(input.locale, balanceReply)
  await replyToPaymentMessage(input.ctx, helperText, undefined, {
    repository: input.historyRepository,
    record: input.record
  })
  appendConversation(input.memoryStore, input.record, input.record.rawText, helperText)
  return true
}

async function handleSemanticPaymentCandidate(input: {
  ctx: Context
  locale: BotLocale
  record: PaymentTopicRecord
  combinedText: string
  candidate: SemanticPaymentCandidate
  payerMemberId: string
  payerTelegramUserId: string | null
  payerDisplayName: string | null
  isThirdParty: boolean
  financeService: FinanceCommandService
  householdConfigurationRepository: HouseholdConfigurationRepository
  promptRepository: TelegramPendingActionRepository
  memoryStore?: AssistantConversationMemoryStore
  historyRepository?: TopicMessageHistoryRepository
}): Promise<boolean> {
  const t = getBotTranslations(input.locale).payments
  const proposal = await maybeCreatePaymentProposalFromCandidate({
    rawText: input.combinedText,
    householdId: input.record.householdId,
    memberId: input.payerMemberId,
    candidate: input.candidate,
    financeService: input.financeService,
    householdConfigurationRepository: input.householdConfigurationRepository
  })

  if (proposal.status === 'no_action') {
    return false
  }

  await input.promptRepository.clearPendingAction(
    input.record.chatId,
    input.record.senderTelegramUserId
  )

  if (proposal.status === 'unsupported_currency') {
    await replyToPaymentMessage(input.ctx, t.unsupportedCurrency, undefined, {
      repository: input.historyRepository,
      record: input.record
    })
    appendConversation(input.memoryStore, input.record, input.record.rawText, t.unsupportedCurrency)
    return true
  }

  if (proposal.status === 'already_settled') {
    const alreadySettledText = t.alreadySettled(
      proposal.kind,
      input.isThirdParty ? input.payerDisplayName : null
    )
    await replyToPaymentMessage(input.ctx, alreadySettledText, undefined, {
      repository: input.historyRepository,
      record: input.record
    })
    appendConversation(input.memoryStore, input.record, input.record.rawText, alreadySettledText)
    return true
  }

  if (proposal.status === 'multi_member_proposal') {
    const payload = buildMultiConfirmationPayload(
      input.record,
      input.combinedText,
      proposal.proposal
    )
    await input.promptRepository.upsertPendingAction({
      telegramUserId: input.record.senderTelegramUserId,
      telegramChatId: input.record.chatId,
      action: PAYMENT_TOPIC_CONFIRMATION_ACTION,
      payload: { ...payload },
      expiresAt: nowInstant().add({ milliseconds: PAYMENT_TOPIC_ACTION_TTL_MS })
    })

    const proposalText = formatMultiPaymentProposalText(input.locale, payload)
    await replyToPaymentMessage(
      input.ctx,
      proposalText,
      multiPaymentProposalReplyMarkup(input.locale, payload),
      {
        repository: input.historyRepository,
        record: input.record
      }
    )
    appendConversation(input.memoryStore, input.record, input.record.rawText, proposalText)
    return true
  }

  const confirmationPayload: PaymentTopicConfirmationPayload = {
    ...proposal.payload,
    senderTelegramUserId: input.record.senderTelegramUserId,
    reportedTelegramUserId: input.payerTelegramUserId,
    reportedDisplayName: input.isThirdParty ? input.payerDisplayName : null,
    isThirdParty: input.isThirdParty,
    rawText: input.combinedText,
    telegramChatId: input.record.chatId,
    telegramMessageId: input.record.messageId,
    telegramThreadId: input.record.threadId,
    telegramUpdateId: String(input.record.updateId),
    attachmentCount: input.record.attachmentCount,
    messageSentAt: input.record.messageSentAt
  }

  await upsertPaymentProposalPendingActions(
    input.promptRepository,
    confirmationPayload,
    nowInstant().add({ milliseconds: PAYMENT_TOPIC_ACTION_TTL_MS })
  )

  const proposalText = formatPaymentProposalText({
    locale: input.locale,
    surface: 'topic',
    proposal: {
      payload: confirmationPayload,
      breakdown: proposal.breakdown
    }
  })
  await replyToPaymentMessage(
    input.ctx,
    proposalText,
    paymentProposalReplyMarkup(input.locale, proposal.payload.proposalId),
    {
      repository: input.historyRepository,
      record: input.record
    }
  )
  appendConversation(input.memoryStore, input.record, input.record.rawText, proposalText)
  return true
}

async function replyToPaymentMessage(
  ctx: Context,
  text: string,
  replyMarkup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> },
  history?: {
    repository: TopicMessageHistoryRepository | undefined
    record: PaymentTopicRecord
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

export function registerConfiguredPaymentTopicIngestion(
  bot: Bot,
  householdConfigurationRepository: HouseholdConfigurationRepository,
  promptRepository: TelegramPendingActionRepository,
  financeServiceForHousehold: (householdId: string) => FinanceCommandService,
  paymentServiceForHousehold: (householdId: string) => PaymentConfirmationService,
  options: {
    router?: TopicMessageRouter
    topicProcessor?: import('./topic-processor').TopicProcessor
    contextCache?: import('./household-context-cache').HouseholdContextCache
    memoryStore?: AssistantConversationMemoryStore
    historyRepository?: TopicMessageHistoryRepository
    logger?: Logger
    auditNotificationService?: HouseholdAuditNotificationService
  } = {}
): void {
  bot.callbackQuery(
    new RegExp(`^${PAYMENT_TOPIC_CLARIFICATION_CANCEL_CALLBACK_PREFIX}([^:]+)$`),
    async (ctx) => {
      if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') {
        return
      }

      const actorTelegramUserId = ctx.from?.id?.toString()
      const ownerTelegramUserId = ctx.match[1]
      if (!actorTelegramUserId || !ownerTelegramUserId) {
        return
      }

      const pending = await promptRepository.getPendingAction(
        ctx.chat.id.toString(),
        ownerTelegramUserId
      )
      const payload =
        pending?.action === PAYMENT_TOPIC_CLARIFICATION_ACTION
          ? (pending.payload as unknown as PaymentTopicClarificationPayload)
          : null
      const locale =
        typeof payload?.householdId === 'string'
          ? await resolveHouseholdLocale(householdConfigurationRepository, payload.householdId)
          : await resolveTopicLocale(ctx, householdConfigurationRepository)
      const t = getBotTranslations(locale).payments

      const actorIsAdmin =
        typeof payload?.householdId === 'string'
          ? await isActorHouseholdAdmin({
              financeServiceForHousehold,
              householdId: payload.householdId,
              actorTelegramUserId
            })
          : false

      if (actorTelegramUserId !== ownerTelegramUserId && !actorIsAdmin) {
        await ctx.answerCallbackQuery({
          text: t.multiNotYourProposal,
          show_alert: true
        })
        return
      }

      await promptRepository.clearPendingAction(ctx.chat.id.toString(), ownerTelegramUserId)
      await ctx.answerCallbackQuery({
        text: t.cancelled
      })

      if (ctx.msg) {
        await ctx.editMessageText(t.cancelled, {
          reply_markup: {
            inline_keyboard: []
          }
        })
      }
    }
  )

  bot.callbackQuery(
    new RegExp(`^${PAYMENT_TOPIC_MULTI_TOGGLE_CALLBACK_PREFIX}([^:]+):([^:]+)$`),
    async (ctx) => {
      if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') {
        return
      }

      const actorTelegramUserId = ctx.from?.id?.toString()
      const proposalId = ctx.match[1]
      const memberId = ctx.match[2]

      if (!actorTelegramUserId || !proposalId || !memberId) {
        return
      }

      const payload = await getMultiPaymentPendingAction({
        promptRepository,
        telegramChatId: ctx.chat.id.toString(),
        actorTelegramUserId,
        proposalId
      })
      const locale = payload
        ? await resolveHouseholdLocale(householdConfigurationRepository, payload.householdId)
        : await resolveTopicLocale(ctx, householdConfigurationRepository)
      const t = getBotTranslations(locale).payments

      if (payload && actorTelegramUserId !== payload.ownerTelegramUserId) {
        await ctx.answerCallbackQuery({
          text: t.multiNotYourProposal,
          show_alert: true
        })
        return
      }

      const memberIndex = payload?.members.findIndex((member) => member.memberId === memberId) ?? -1
      if (!payload || payload.proposalId !== proposalId || memberIndex < 0) {
        await ctx.answerCallbackQuery({
          text: t.proposalUnavailable,
          show_alert: true
        })
        return
      }
      if (payload.members[memberIndex]?.paymentStatus === 'paid') {
        await ctx.answerCallbackQuery({
          text: t.alreadySettled(payload.kind, payload.members[memberIndex]?.displayName),
          show_alert: true
        })
        return
      }

      const nextPayload: PaymentTopicMultiConfirmationPayload = {
        ...payload,
        members: payload.members.map((member, index) =>
          index === memberIndex ? { ...member, selected: !member.selected } : member
        )
      }

      await promptRepository.upsertPendingAction({
        telegramUserId: actorTelegramUserId,
        telegramChatId: payload.telegramChatId,
        action: PAYMENT_TOPIC_CONFIRMATION_ACTION,
        payload: { ...nextPayload },
        expiresAt: nowInstant().add({ milliseconds: PAYMENT_TOPIC_ACTION_TTL_MS })
      })

      await ctx.answerCallbackQuery()
      if (ctx.msg) {
        await ctx.editMessageText(formatMultiPaymentProposalText(locale, nextPayload), {
          reply_markup: multiPaymentProposalReplyMarkup(locale, nextPayload)
        })
      }
    }
  )

  bot.callbackQuery(
    new RegExp(`^${PAYMENT_TOPIC_MULTI_CONFIRM_CALLBACK_PREFIX}([^:]+)$`),
    async (ctx) => {
      if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') {
        return
      }

      const actorTelegramUserId = ctx.from?.id?.toString()
      const proposalId = ctx.match[1]

      if (!actorTelegramUserId || !proposalId) {
        return
      }

      const payload = await getMultiPaymentPendingAction({
        promptRepository,
        telegramChatId: ctx.chat.id.toString(),
        actorTelegramUserId,
        proposalId
      })
      const locale = payload
        ? await resolveHouseholdLocale(householdConfigurationRepository, payload.householdId)
        : await resolveTopicLocale(ctx, householdConfigurationRepository)
      const t = getBotTranslations(locale).payments

      if (payload && actorTelegramUserId !== payload.ownerTelegramUserId) {
        await ctx.answerCallbackQuery({
          text: t.multiNotYourProposal,
          show_alert: true
        })
        return
      }

      if (!payload || payload.proposalId !== proposalId) {
        await ctx.answerCallbackQuery({
          text: t.proposalUnavailable,
          show_alert: true
        })
        return
      }

      const selectedMembers = payload.members.filter(
        (member) => member.selected && member.paymentStatus === 'unpaid'
      )
      if (selectedMembers.length === 0) {
        await ctx.answerCallbackQuery({
          text: t.noMembersSelected,
          show_alert: true
        })
        return
      }

      const paymentService = paymentServiceForHousehold(payload.householdId)
      const financeService = financeServiceForHousehold(payload.householdId)
      const payableAmounts = await resolveCurrentPayableMultiMemberAmounts({
        financeService,
        householdConfigurationRepository,
        householdId: payload.householdId,
        kind: payload.kind,
        period: payload.period,
        members: selectedMembers
      })
      const handledMemberIds = new Set<string>()
      const alreadyPaidMemberIds = new Set(
        payload.members
          .filter((member) => member.paymentStatus === 'paid')
          .map((member) => member.memberId)
      )
      const alreadyPaidSelectedMemberIds = new Set<string>()
      for (const member of selectedMembers) {
        const currentAmount = payableAmounts.get(member.memberId)
        if (!currentAmount) {
          alreadyPaidMemberIds.add(member.memberId)
          alreadyPaidSelectedMemberIds.add(member.memberId)
          continue
        }

        const result = await paymentService.submit({
          senderTelegramUserId: payload.ownerTelegramUserId,
          memberId: member.memberId,
          sourceKey: `${payload.telegramMessageId}:${payload.proposalId}:${member.memberId}`,
          rawText: payload.rawText,
          parseText: `paid ${payload.kind} ${currentAmount.toMajorString()} ${currentAmount.currency}`,
          telegramChatId: payload.telegramChatId,
          telegramMessageId: payload.telegramMessageId,
          telegramThreadId: payload.telegramThreadId,
          telegramUpdateId: payload.telegramUpdateId,
          attachmentCount: payload.attachmentCount,
          messageSentAt: null
        })
        if (result.status === 'already_settled') {
          alreadyPaidMemberIds.add(member.memberId)
          alreadyPaidSelectedMemberIds.add(member.memberId)
        } else if (isHandledPaymentSubmitResult(result)) {
          handledMemberIds.add(member.memberId)
        }
      }

      await promptRepository.clearPendingAction(payload.telegramChatId, payload.ownerTelegramUserId)
      const fullyHandled =
        handledMemberIds.size + alreadyPaidSelectedMemberIds.size === selectedMembers.length
      const fullyPaid = fullyHandled
        ? await isPaymentKindFullyPaid({
            financeService,
            kind: payload.kind,
            period: payload.period
          })
        : false
      const recordedText = fullyHandled
        ? formatMultiRecordedText(
            locale,
            payload,
            fullyPaid,
            handledMemberIds,
            alreadyPaidMemberIds
          )
        : formatMultiPartialRecordedText(locale, payload, handledMemberIds, alreadyPaidMemberIds)

      await ctx.answerCallbackQuery({
        text: recordedText
      })
      if (ctx.msg) {
        await ctx.editMessageText(recordedText, {
          reply_markup: {
            inline_keyboard: []
          }
        })
      }
    }
  )

  bot.callbackQuery(
    new RegExp(`^${PAYMENT_TOPIC_MULTI_CANCEL_CALLBACK_PREFIX}([^:]+)$`),
    async (ctx) => {
      if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') {
        return
      }

      const actorTelegramUserId = ctx.from?.id?.toString()
      const proposalId = ctx.match[1]

      if (!actorTelegramUserId || !proposalId) {
        return
      }

      const payload = await getMultiPaymentPendingAction({
        promptRepository,
        telegramChatId: ctx.chat.id.toString(),
        actorTelegramUserId,
        proposalId
      })
      const locale = payload
        ? await resolveHouseholdLocale(householdConfigurationRepository, payload.householdId)
        : await resolveTopicLocale(ctx, householdConfigurationRepository)
      const t = getBotTranslations(locale).payments

      const actorIsAdmin = payload
        ? await isActorHouseholdAdmin({
            financeServiceForHousehold,
            householdId: payload.householdId,
            actorTelegramUserId
          })
        : false

      if (payload && actorTelegramUserId !== payload.ownerTelegramUserId && !actorIsAdmin) {
        await ctx.answerCallbackQuery({
          text: t.multiNotYourProposal,
          show_alert: true
        })
        return
      }

      if (!payload || payload.proposalId !== proposalId) {
        await ctx.answerCallbackQuery({
          text: t.proposalUnavailable,
          show_alert: true
        })
        return
      }

      await promptRepository.clearPendingAction(payload.telegramChatId, payload.ownerTelegramUserId)
      await ctx.answerCallbackQuery({
        text: t.cancelled
      })

      if (ctx.msg) {
        await ctx.editMessageText(t.cancelled, {
          reply_markup: {
            inline_keyboard: []
          }
        })
      }
    }
  )

  bot.callbackQuery(
    new RegExp(`^${PAYMENT_TOPIC_CONFIRM_CALLBACK_PREFIX}([^:]+)$`),
    async (ctx) => {
      if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') {
        return
      }

      const actorTelegramUserId = ctx.from?.id?.toString()
      const proposalId = ctx.match[1]
      if (!actorTelegramUserId || !proposalId) {
        return
      }

      const pending = await promptRepository.getPendingAction(
        ctx.chat.id.toString(),
        actorTelegramUserId
      )
      const payload =
        pending?.action === PAYMENT_TOPIC_CONFIRMATION_ACTION
          ? parsePaymentTopicConfirmationPayload(pending.payload)
          : null
      const locale = payload
        ? await resolveHouseholdLocale(householdConfigurationRepository, payload.householdId)
        : await resolveTopicLocale(ctx, householdConfigurationRepository)
      const t = getBotTranslations(locale).payments

      if (!payload || payload.proposalId !== proposalId) {
        await ctx.answerCallbackQuery({
          text: t.proposalUnavailable,
          show_alert: true
        })
        return
      }

      if (!actorCanManagePaymentProposal(actorTelegramUserId, payload)) {
        await ctx.answerCallbackQuery({
          text: t.notYourProposal,
          show_alert: true
        })
        return
      }

      const paymentService = paymentServiceForHousehold(payload.householdId)
      const result = await paymentService.submit({
        ...payload,
        rawText: payload.rawText,
        parseText: synthesizePaymentConfirmationText(payload)
      })

      await clearPaymentProposalPendingActions(promptRepository, payload)

      if (result.status === 'already_settled') {
        await ctx.answerCallbackQuery({
          text: t.alreadySettled(result.kind, payload.reportedDisplayName),
          show_alert: true
        })
        if (ctx.msg) {
          await ctx.editMessageText(t.alreadySettled(result.kind, payload.reportedDisplayName), {
            reply_markup: {
              inline_keyboard: []
            }
          })
        }
        return
      }

      if (result.status !== 'recorded') {
        await ctx.answerCallbackQuery({
          text: t.proposalUnavailable,
          show_alert: true
        })
        return
      }

      const fullyPaid =
        payload.period === undefined
          ? false
          : await isPaymentKindFullyPaid({
              financeService: financeServiceForHousehold(payload.householdId),
              kind: payload.kind,
              period: payload.period
            })
      const recordedText = fullyPaid
        ? getBotTranslations(locale).payments.fullyPaid(
            payload.kind,
            formatPeriodLabel(locale, payload.period!)
          )
        : formatRecordedPaymentText(locale, payload, result.amount)
      await ctx.answerCallbackQuery({
        text: recordedText
      })

      if (ctx.msg) {
        await ctx.editMessageText(recordedText, {
          reply_markup: {
            inline_keyboard: []
          }
        })
      }

      if (options.auditNotificationService) {
        await options.auditNotificationService.recordEvent({
          householdId: payload.householdId,
          actorMemberId: payload.memberId,
          actorDisplayName: payload.reportedDisplayName ?? ctx.from?.first_name ?? 'Someone',
          eventType: 'payment.recorded',
          category: 'payment_events',
          summaryText: `${payload.reportedDisplayName ?? ctx.from?.first_name ?? 'Someone'} recorded ${result.kind} payment: ${result.amount.toMajorString()} ${result.amount.currency}`,
          metadata: {
            memberId: payload.memberId,
            kind: result.kind,
            amountMinor: result.amount.amountMinor.toString(),
            currency: result.amount.currency
          }
        })
      }
    }
  )

  bot.callbackQuery(new RegExp(`^${PAYMENT_TOPIC_CANCEL_CALLBACK_PREFIX}([^:]+)$`), async (ctx) => {
    if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') {
      return
    }

    const actorTelegramUserId = ctx.from?.id?.toString()
    const proposalId = ctx.match[1]
    if (!actorTelegramUserId || !proposalId) {
      return
    }

    const pending = await promptRepository.getPendingAction(
      ctx.chat.id.toString(),
      actorTelegramUserId
    )
    const actorPayload =
      pending?.action === PAYMENT_TOPIC_CONFIRMATION_ACTION
        ? parsePaymentTopicConfirmationPayload(pending.payload)
        : null
    const proposalPending =
      actorPayload?.proposalId === proposalId
        ? null
        : await promptRepository.findPendingActionByPayloadValue?.(
            ctx.chat.id.toString(),
            PAYMENT_TOPIC_CONFIRMATION_ACTION,
            'proposalId',
            proposalId
          )
    const payload =
      actorPayload?.proposalId === proposalId
        ? actorPayload
        : proposalPending?.action === PAYMENT_TOPIC_CONFIRMATION_ACTION
          ? parsePaymentTopicConfirmationPayload(proposalPending.payload)
          : null
    const locale = payload
      ? await resolveHouseholdLocale(householdConfigurationRepository, payload.householdId)
      : await resolveTopicLocale(ctx, householdConfigurationRepository)
    const t = getBotTranslations(locale).payments

    if (!payload || payload.proposalId !== proposalId) {
      await ctx.answerCallbackQuery({
        text: t.proposalUnavailable,
        show_alert: true
      })
      return
    }

    const actorIsAdmin = await isActorHouseholdAdmin({
      financeServiceForHousehold,
      householdId: payload.householdId,
      actorTelegramUserId
    })

    if (!actorCanManagePaymentProposal(actorTelegramUserId, payload) && !actorIsAdmin) {
      await ctx.answerCallbackQuery({
        text: t.notYourProposal,
        show_alert: true
      })
      return
    }

    await clearPaymentProposalPendingActions(promptRepository, payload)
    await ctx.answerCallbackQuery({
      text: t.cancelled
    })

    if (ctx.msg) {
      await ctx.editMessageText(t.cancelled, {
        reply_markup: {
          inline_keyboard: []
        }
      })
    }
  })

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

    const record = resolveConfiguredPaymentTopicRecord(candidate, binding)
    if (!record) {
      await next()
      return
    }

    try {
      const locale = await resolveTopicLocale(ctx, householdConfigurationRepository)
      if (isLikelyUtilityTemplate(record.rawText)) {
        await next()
        return
      }
      const pending = await promptRepository.getPendingAction(
        record.chatId,
        record.senderTelegramUserId
      )
      const clarificationPayload =
        pending?.action === PAYMENT_TOPIC_CLARIFICATION_ACTION
          ? parsePaymentClarificationPayload(pending.payload)
          : null
      const combinedText =
        clarificationPayload && clarificationPayload.threadId === record.threadId
          ? `${clarificationPayload.rawText}\n${record.rawText}`
          : record.rawText
      const confirmationPayload =
        pending?.action === PAYMENT_TOPIC_CONFIRMATION_ACTION
          ? parsePaymentTopicConfirmationPayload(pending.payload)
          : null

      // Load household context (cached)
      const householdContext = options.contextCache
        ? await options.contextCache.get(record.householdId, async () => {
            const billingSettings =
              await householdConfigurationRepository.getHouseholdBillingSettings(record.householdId)
            const assistantConfig = await resolveAssistantConfig(
              householdConfigurationRepository,
              record.householdId
            )
            return {
              householdContext: assistantConfig.assistantContext,
              assistantTone: assistantConfig.assistantTone,
              defaultCurrency: billingSettings.settlementCurrency,
              locale: (await resolveTopicLocale(ctx, householdConfigurationRepository)) as
                | 'en'
                | 'ru',
              cachedAt: Date.now()
            }
          })
        : {
            householdContext: null as string | null,
            assistantTone: null as string | null,
            defaultCurrency: 'GEL' as const,
            locale: 'en' as const,
            cachedAt: Date.now()
          }

      const activeWorkflow =
        clarificationPayload && clarificationPayload.threadId === record.threadId
          ? 'payment_clarification'
          : confirmationPayload && confirmationPayload.telegramThreadId === record.threadId
            ? 'payment_confirmation'
            : null
      const financeService = financeServiceForHousehold(record.householdId)
      let senderMember: Awaited<ReturnType<FinanceCommandService['getMemberByTelegramUserId']>> =
        null
      let householdMembers: Awaited<ReturnType<FinanceCommandService['listMembers']>> = []
      let dashboard: Awaited<ReturnType<FinanceCommandService['generateDashboard']>> | null = null
      if (options.topicProcessor) {
        const resolved = await Promise.all([
          financeService.getMemberByTelegramUserId(record.senderTelegramUserId),
          financeService.listMembers(),
          financeService.generateDashboard()
        ])
        senderMember = resolved[0]
        householdMembers = resolved[1]
        dashboard = resolved[2]
      }
      const billingContext = formatPaymentTopicBillingContext({ dashboard })
      const topicHouseholdContext = [householdContext.householdContext, billingContext]
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .join('\n\n')

      // Use topic processor if available
      if (options.topicProcessor) {
        const { buildConversationContext } = await import('./conversation-orchestrator')
        const { stripExplicitBotMention } = await import('./telegram-mentions')

        const conversationContext = await buildConversationContext({
          repository: options.historyRepository,
          householdId: record.householdId,
          telegramChatId: record.chatId,
          telegramThreadId: record.threadId,
          telegramUserId: record.senderTelegramUserId,
          topicRole: 'payments',
          activeWorkflow,
          messageText: record.rawText,
          explicitMention: stripExplicitBotMention(ctx) !== null,
          replyToBot: isReplyToBotMessage(ctx),
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

        const processorResult = await options.topicProcessor({
          locale: locale === 'ru' ? 'ru' : 'en',
          topicRole: 'payments',
          messageText: combinedText,
          isExplicitMention: conversationContext.explicitMention,
          isReplyToBot: conversationContext.replyToBot,
          activeWorkflow,
          defaultCurrency: householdContext.defaultCurrency,
          householdContext: topicHouseholdContext || null,
          assistantTone: householdContext.assistantTone,
          householdMembers: householdMembers.map((member) => ({
            memberId: member.id,
            displayName: member.displayName,
            status: 'active'
          })),
          senderMemberId: senderMember?.id ?? null,
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

        options.logger?.info(
          { event: 'payment.topic_processor_result', result: processorResult },
          'Topic processor finished'
        )

        // Handle processor failure through deterministic fallback routing.
        if (!processorResult) {
          cacheFallbackPaymentRoute({
            ctx,
            locale,
            messageText: combinedText,
            isExplicitMention: conversationContext.explicitMention,
            isReplyToBot: conversationContext.replyToBot,
            activeWorkflow
          })
          await next()
          return
        }

        // Handle different routes
        switch (processorResult.route) {
          case 'silent': {
            if (conversationContext.explicitMention) {
              options.logger?.info(
                {
                  event: 'payment.topic_processor_explicit_fallback',
                  reason: processorResult.reason,
                  messageText: record.rawText
                },
                'Using fallback route after topic processor stayed silent on an explicit mention'
              )

              cacheFallbackPaymentRoute({
                ctx,
                locale,
                messageText: combinedText,
                isExplicitMention: conversationContext.explicitMention,
                isReplyToBot: conversationContext.replyToBot,
                activeWorkflow
              })
              await next()
              return
            }

            cacheTopicMessageRoute(ctx, 'payments', {
              route: 'silent',
              replyText: null,
              helperKind: null,
              shouldStartTyping: false,
              shouldClearWorkflow: false,
              confidence: processorResult.reason === 'test' ? 0 : 80,
              reason: processorResult.reason
            })
            await next()
            return
          }

          case 'chat_reply': {
            await replyToPaymentMessage(ctx, processorResult.replyText, undefined, {
              repository: options.historyRepository,
              record
            })
            appendConversation(
              options.memoryStore,
              record,
              record.rawText,
              processorResult.replyText
            )
            return
          }

          case 'dismiss_workflow': {
            if (senderMember) {
              const handledQuestion = await replyWithPaymentBalanceQuestionIfPossible({
                ctx,
                locale,
                record,
                rawText: combinedText,
                financeService,
                memberId: senderMember.id,
                householdConfigurationRepository,
                ...(options.memoryStore ? { memoryStore: options.memoryStore } : {}),
                ...(options.historyRepository
                  ? { historyRepository: options.historyRepository }
                  : {})
              })
              if (handledQuestion) {
                if (activeWorkflow !== null) {
                  await promptRepository.clearPendingAction(
                    record.chatId,
                    record.senderTelegramUserId
                  )
                }
                return
              }
            }

            if (activeWorkflow !== null) {
              await promptRepository.clearPendingAction(record.chatId, record.senderTelegramUserId)
            }
            if (processorResult.replyText) {
              await replyToPaymentMessage(ctx, processorResult.replyText, undefined, {
                repository: options.historyRepository,
                record
              })
              appendConversation(
                options.memoryStore,
                record,
                record.rawText,
                processorResult.replyText
              )
            }
            return
          }

          case 'topic_helper': {
            const financeService = financeServiceForHousehold(record.householdId)
            const member = await financeService.getMemberByTelegramUserId(
              record.senderTelegramUserId
            )
            if (!member) {
              await next()
              return
            }

            const handled = await replyWithPaymentBalanceQuestionIfPossible({
              ctx,
              locale,
              record,
              rawText: combinedText,
              financeService,
              memberId: member.id,
              householdConfigurationRepository,
              ...(options.memoryStore ? { memoryStore: options.memoryStore } : {}),
              ...(options.historyRepository ? { historyRepository: options.historyRepository } : {})
            })

            if (!handled) {
              await next()
            }
            return
          }

          case 'payment_clarification': {
            if (senderMember) {
              const handledQuestion = await replyWithPaymentBalanceQuestionIfPossible({
                ctx,
                locale,
                record,
                rawText: combinedText,
                financeService,
                memberId: senderMember.id,
                householdConfigurationRepository,
                ...(options.memoryStore ? { memoryStore: options.memoryStore } : {}),
                ...(options.historyRepository
                  ? { historyRepository: options.historyRepository }
                  : {})
              })
              if (handledQuestion) {
                return
              }
            }

            options.logger?.info(
              {
                event: 'payment.topic_processor_clarification_silenced',
                reason: processorResult.reason,
                messageText: record.rawText
              },
              'Silencing ambiguous payment-topic clarification'
            )
            cacheTopicMessageRoute(ctx, 'payments', {
              route: 'silent',
              replyText: null,
              helperKind: null,
              shouldStartTyping: false,
              shouldClearWorkflow: false,
              confidence: 80,
              reason: processorResult.reason
            })
            await next()
            return
          }

          case 'payment': {
            if (!senderMember) {
              await next()
              return
            }

            const handledQuestion = await replyWithPaymentBalanceQuestionIfPossible({
              ctx,
              locale,
              record,
              rawText: combinedText,
              financeService,
              memberId: senderMember.id,
              householdConfigurationRepository,
              ...(options.memoryStore ? { memoryStore: options.memoryStore } : {}),
              ...(options.historyRepository ? { historyRepository: options.historyRepository } : {})
            })
            if (handledQuestion) {
              return
            }

            const semanticCandidate = semanticPaymentCandidateFromProcessor({
              result: processorResult,
              rawText: record.rawText,
              isReplyToBot: conversationContext.replyToBot,
              activeWorkflow
            })
            if (!semanticCandidate) {
              cacheTopicMessageRoute(ctx, 'payments', {
                route: 'silent',
                replyText: null,
                helperKind: null,
                shouldStartTyping: false,
                shouldClearWorkflow: false,
                confidence: processorResult.confidence,
                reason: processorResult.reason
              })
              await next()
              return
            }

            let payerMember = senderMember
            let isThirdParty = false
            if (processorResult.payerDisplayName) {
              const matchedMember = householdMembers.find(
                (m) =>
                  m.displayName.toLowerCase() === processorResult.payerDisplayName?.toLowerCase()
              )
              if (!matchedMember) {
                await next()
                return
              }

              payerMember = matchedMember
              isThirdParty = matchedMember.id !== senderMember.id
            }

            // Only trust the AI-extracted amount when the exact amount and currency are present
            // in the current message. The AI may hallucinate amounts from billing context/history.
            const currentMessageAmount = validatedCurrentMessageAmount({
              rawText: record.rawText,
              amountMinor: semanticCandidate.amountMinor,
              currency: semanticCandidate.currency
            })
            const handled = await handleSemanticPaymentCandidate({
              ctx,
              locale,
              record,
              combinedText,
              candidate: {
                ...semanticCandidate,
                payerMemberId: payerMember.id,
                amountMinor: currentMessageAmount?.amountMinor ?? null,
                currency: currentMessageAmount?.currency ?? null
              },
              payerMemberId: payerMember.id,
              payerTelegramUserId: payerMember.telegramUserId ?? null,
              payerDisplayName: payerMember.displayName,
              isThirdParty,
              financeService,
              householdConfigurationRepository,
              promptRepository,
              ...(options.memoryStore
                ? {
                    memoryStore: options.memoryStore
                  }
                : {}),
              ...(options.historyRepository
                ? {
                    historyRepository: options.historyRepository
                  }
                : {})
            })
            if (!handled) {
              await next()
            }
            return
          }

          default: {
            await next()
            return
          }
        }
      }

      // No topic processor available; hand off through deterministic fallback routing.
      cacheFallbackPaymentRoute({
        ctx,
        locale,
        messageText: combinedText,
        isExplicitMention: stripExplicitBotMention(ctx) !== null,
        isReplyToBot: isReplyToBotMessage(ctx),
        activeWorkflow
      })
      await next()
    } catch (error) {
      options.logger?.error(
        {
          event: 'payment.ingest_failed',
          chatId: record.chatId,
          threadId: record.threadId,
          messageId: record.messageId,
          updateId: record.updateId,
          error
        },
        'Failed to ingest payment confirmation'
      )
    } finally {
      await persistIncomingTopicMessage(options.historyRepository, record)
    }
  })
}

async function resolveTopicLocale(
  ctx: Context,
  householdConfigurationRepository: HouseholdConfigurationRepository
): Promise<BotLocale> {
  const binding =
    ctx.chat && ctx.msg && 'message_thread_id' in ctx.msg && ctx.msg.message_thread_id !== undefined
      ? await householdConfigurationRepository.findHouseholdTopicByTelegramContext({
          telegramChatId: ctx.chat.id.toString(),
          telegramThreadId: ctx.msg.message_thread_id.toString()
        })
      : null

  if (!binding) {
    return 'en'
  }

  const householdChat = await householdConfigurationRepository.getHouseholdChatByHouseholdId(
    binding.householdId
  )

  return householdChat?.defaultLocale ?? 'en'
}

async function resolveHouseholdLocale(
  householdConfigurationRepository: HouseholdConfigurationRepository,
  householdId: string
): Promise<BotLocale> {
  const householdChat =
    await householdConfigurationRepository.getHouseholdChatByHouseholdId(householdId)

  return householdChat?.defaultLocale ?? 'en'
}
