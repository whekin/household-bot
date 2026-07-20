import {
  buildMemberPaymentGuidance,
  type FinanceCommandService,
  type HouseholdAuditNotificationService,
  type PaymentConfirmationService,
  type PaymentConfirmationSubmitResult
} from '@household/application'
import { Money, nowInstant, type Instant } from '@household/domain'
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
  formatPaymentProposalText,
  type AgentPaymentProposalResult,
  type MultiMemberPaymentProposal,
  parsePaymentProposalPayload,
  synthesizePaymentConfirmationText
} from './payment-proposals'
import {
  persistTopicHistoryMessage,
  telegramMessageIdFromMessage,
  telegramMessageSentAtFromMessage
} from './topic-history'
import type { LivePaymentCardService } from './live-payment-cards'

const PAYMENT_TOPIC_CONFIRM_CALLBACK_PREFIX = 'payment_topic:confirm:'
const PAYMENT_TOPIC_CANCEL_CALLBACK_PREFIX = 'payment_topic:cancel:'
const PAYMENT_TOPIC_MULTI_CONFIRM_CALLBACK_PREFIX = 'pt:mc:'
const PAYMENT_TOPIC_MULTI_TOGGLE_CALLBACK_PREFIX = 'pt:mt:'
const PAYMENT_TOPIC_MULTI_CANCEL_CALLBACK_PREFIX = 'pt:cancel:'
const PAYMENT_TOPIC_CLARIFICATION_CANCEL_CALLBACK_PREFIX = 'pt:cc:'
const PAYMENT_TOPIC_CLARIFICATION_ACTION = 'payment_topic_clarification' as const
const PAYMENT_TOPIC_CONFIRMATION_ACTION = 'payment_topic_confirmation' as const
const PAYMENT_TOPIC_ACTION_TTL_MS = 30 * 60_000

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
  await promptRepository.clearPendingAction(
    payload.telegramChatId,
    payload.senderTelegramUserId,
    PAYMENT_TOPIC_CONFIRMATION_ACTION
  )
  if (
    payload.reportedTelegramUserId &&
    payload.reportedTelegramUserId !== payload.senderTelegramUserId
  ) {
    await promptRepository.clearPendingAction(
      payload.telegramChatId,
      payload.reportedTelegramUserId,
      PAYMENT_TOPIC_CONFIRMATION_ACTION
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
  handledMemberIds?: ReadonlySet<string>,
  alreadyPaidMemberIds?: ReadonlySet<string>
): string {
  const t = getBotTranslations(locale).payments
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

async function safeAnswerPaymentCallback(
  ctx: Context,
  options?: Parameters<Context['answerCallbackQuery']>[0],
  logger?: Logger
): Promise<void> {
  try {
    await ctx.answerCallbackQuery(options)
  } catch (error) {
    logger?.warn(
      { event: 'payment_topic.callback_answer_failed', error },
      'Failed to answer payment topic callback'
    )
  }
}

async function safeEditPaymentCallbackMessage(
  ctx: Context,
  text: string,
  options?: Parameters<Context['editMessageText']>[1],
  logger?: Logger
): Promise<void> {
  if (!ctx.msg) {
    return
  }

  try {
    await ctx.editMessageText(text, options)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/message is not modified/i.test(message)) {
      return
    }
    logger?.warn(
      { event: 'payment_topic.callback_edit_failed', error },
      'Failed to edit payment topic callback message'
    )
  }
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
    input.actorTelegramUserId,
    PAYMENT_TOPIC_CONFIRMATION_ACTION
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

export function parseCurrentMessageAmounts(
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

export type AgentPaymentProposalPublishStatus =
  | 'card_posted'
  | 'already_settled'
  | 'unsupported_currency'
  | 'no_action'

export async function publishAgentPaymentProposal(input: {
  ctx: Context
  locale: BotLocale
  record: PaymentTopicRecord
  proposal: AgentPaymentProposalResult
  payerTelegramUserId: string | null
  payerDisplayName: string | null
  isThirdParty: boolean
  promptRepository: TelegramPendingActionRepository
  historyRepository?: TopicMessageHistoryRepository
  memoryStore?: AssistantConversationMemoryStore
}): Promise<{ status: AgentPaymentProposalPublishStatus; reason?: string }> {
  const t = getBotTranslations(input.locale).payments
  const proposal = input.proposal

  if (proposal.status === 'no_action') {
    return { status: 'no_action', reason: proposal.reason }
  }

  if (proposal.status === 'unsupported_currency') {
    await replyToPaymentMessage(input.ctx, t.unsupportedCurrency, undefined, {
      repository: input.historyRepository,
      record: input.record
    })
    appendConversation(input.memoryStore, input.record, input.record.rawText, t.unsupportedCurrency)
    return { status: 'unsupported_currency' }
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
    return { status: 'already_settled' }
  }

  await input.promptRepository.clearPendingAction(
    input.record.chatId,
    input.record.senderTelegramUserId,
    PAYMENT_TOPIC_CLARIFICATION_ACTION
  )
  await input.promptRepository.clearPendingAction(
    input.record.chatId,
    input.record.senderTelegramUserId,
    PAYMENT_TOPIC_CONFIRMATION_ACTION
  )

  if (proposal.status === 'multi_member_proposal') {
    const payload = buildMultiConfirmationPayload(
      input.record,
      input.record.rawText,
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
    return { status: 'card_posted' }
  }

  const confirmationPayload: PaymentTopicConfirmationPayload = {
    ...proposal.payload,
    senderTelegramUserId: input.record.senderTelegramUserId,
    reportedTelegramUserId: input.payerTelegramUserId,
    reportedDisplayName: input.isThirdParty ? input.payerDisplayName : null,
    isThirdParty: input.isThirdParty,
    rawText: input.record.rawText,
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
  return { status: 'card_posted' }
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

// Recorded utilities payments only create payment records; the utility billing
// plan settles through vendor payment facts. Reconcile the two here so the
// miniapp and /bill stop showing the plan as open after everyone has paid.
async function resolvePlannedUtilitiesForRecordedPayments(input: {
  financeService: FinanceCommandService
  period: string | undefined
  memberIds: Iterable<string>
  actorTelegramUserId: string
  logger?: Logger | undefined
}): Promise<{ settledJustNow: boolean; period: string | null }> {
  let settledJustNow = false
  let period: string | null = null

  const actorMemberId = await input.financeService
    .getMemberByTelegramUserId(input.actorTelegramUserId)
    .then((member) => member?.id)
    .catch(() => undefined)

  // A partial payment (explicit amount below the planned share) must not mark
  // the member's planned bills as covered, so only settled members qualify.
  const dashboard = await input.financeService.generateDashboard(input.period)
  if (!dashboard) {
    return { settledJustNow, period }
  }
  const unresolvedMemberIds = new Set(
    dashboard.paymentPeriods
      ?.find((candidate) => candidate.period === dashboard.period)
      ?.kinds.find((candidate) => candidate.kind === 'utilities')
      ?.unresolvedMembers.map((member) => member.memberId) ?? []
  )

  for (const memberId of input.memberIds) {
    if (unresolvedMemberIds.has(memberId)) {
      continue
    }
    try {
      const result = await input.financeService.resolveUtilityBillAsPlanned({
        memberId,
        ...(input.period ? { periodArg: input.period } : {}),
        ...(actorMemberId ? { actorMemberId } : {})
      })
      if (result) {
        period = result.period
        settledJustNow = settledJustNow || result.settledJustNow
      }
    } catch (error) {
      input.logger?.warn(
        { memberId, error: String(error) },
        'payment topic: failed to resolve planned utilities after recorded payment'
      )
    }
  }

  return { settledJustNow, period }
}

export function registerPaymentTopicCallbacks(
  bot: Bot,
  householdConfigurationRepository: HouseholdConfigurationRepository,
  promptRepository: TelegramPendingActionRepository,
  financeServiceForHousehold: (householdId: string) => FinanceCommandService,
  paymentServiceForHousehold: (householdId: string) => PaymentConfirmationService,
  options: {
    memoryStore?: AssistantConversationMemoryStore
    historyRepository?: TopicMessageHistoryRepository
    logger?: Logger
    auditNotificationService?: HouseholdAuditNotificationService
    livePaymentCardService?: LivePaymentCardService
  } = {}
): void {
  bot.callbackQuery(
    new RegExp(`^${PAYMENT_TOPIC_CLARIFICATION_CANCEL_CALLBACK_PREFIX}([^:]+)$`),
    async (ctx) => {
      if (
        ctx.chat?.type !== 'group' &&
        ctx.chat?.type !== 'supergroup' &&
        ctx.chat?.type !== 'private'
      ) {
        return
      }

      const actorTelegramUserId = ctx.from?.id?.toString()
      const ownerTelegramUserId = ctx.match[1]
      if (!actorTelegramUserId || !ownerTelegramUserId) {
        return
      }

      const pending = await promptRepository.getPendingAction(
        ctx.chat.id.toString(),
        ownerTelegramUserId,
        PAYMENT_TOPIC_CLARIFICATION_ACTION
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
        await safeAnswerPaymentCallback(
          ctx,
          {
            text: t.multiNotYourProposal,
            show_alert: true
          },
          options.logger
        )
        return
      }

      await promptRepository.clearPendingAction(
        ctx.chat.id.toString(),
        ownerTelegramUserId,
        PAYMENT_TOPIC_CLARIFICATION_ACTION
      )
      await safeAnswerPaymentCallback(
        ctx,
        {
          text: t.cancelled
        },
        options.logger
      )
      await safeEditPaymentCallbackMessage(
        ctx,
        t.cancelled,
        {
          reply_markup: {
            inline_keyboard: []
          }
        },
        options.logger
      )
    }
  )

  bot.callbackQuery(
    new RegExp(`^${PAYMENT_TOPIC_MULTI_TOGGLE_CALLBACK_PREFIX}([^:]+):([^:]+)$`),
    async (ctx) => {
      if (
        ctx.chat?.type !== 'group' &&
        ctx.chat?.type !== 'supergroup' &&
        ctx.chat?.type !== 'private'
      ) {
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
        await safeAnswerPaymentCallback(
          ctx,
          {
            text: t.multiNotYourProposal,
            show_alert: true
          },
          options.logger
        )
        return
      }

      const memberIndex = payload?.members.findIndex((member) => member.memberId === memberId) ?? -1
      if (!payload || payload.proposalId !== proposalId || memberIndex < 0) {
        await safeAnswerPaymentCallback(
          ctx,
          {
            text: t.proposalUnavailable,
            show_alert: true
          },
          options.logger
        )
        return
      }
      if (payload.members[memberIndex]?.paymentStatus === 'paid') {
        await safeAnswerPaymentCallback(
          ctx,
          {
            text: t.alreadySettled(payload.kind, payload.members[memberIndex]?.displayName),
            show_alert: true
          },
          options.logger
        )
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

      await safeAnswerPaymentCallback(ctx, undefined, options.logger)
      await safeEditPaymentCallbackMessage(
        ctx,
        formatMultiPaymentProposalText(locale, nextPayload),
        {
          reply_markup: multiPaymentProposalReplyMarkup(locale, nextPayload)
        },
        options.logger
      )
    }
  )

  bot.callbackQuery(
    new RegExp(`^${PAYMENT_TOPIC_MULTI_CONFIRM_CALLBACK_PREFIX}([^:]+)$`),
    async (ctx) => {
      if (
        ctx.chat?.type !== 'group' &&
        ctx.chat?.type !== 'supergroup' &&
        ctx.chat?.type !== 'private'
      ) {
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
        await safeAnswerPaymentCallback(
          ctx,
          {
            text: t.multiNotYourProposal,
            show_alert: true
          },
          options.logger
        )
        return
      }

      if (!payload || payload.proposalId !== proposalId) {
        await safeAnswerPaymentCallback(
          ctx,
          {
            text: t.proposalUnavailable,
            show_alert: true
          },
          options.logger
        )
        return
      }

      const selectedMembers = payload.members.filter(
        (member) => member.selected && member.paymentStatus === 'unpaid'
      )
      if (selectedMembers.length === 0) {
        await safeAnswerPaymentCallback(
          ctx,
          {
            text: t.noMembersSelected,
            show_alert: true
          },
          options.logger
        )
        return
      }

      await safeAnswerPaymentCallback(ctx, undefined, options.logger)

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
      const recordedAmountByMemberId = new Map<string, Money>()
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
          recordedAmountByMemberId.set(member.memberId, currentAmount)
        }
      }

      const planResolution =
        payload.kind === 'utilities' && handledMemberIds.size > 0
          ? await resolvePlannedUtilitiesForRecordedPayments({
              financeService,
              period: payload.period,
              memberIds: handledMemberIds,
              actorTelegramUserId,
              logger: options.logger
            })
          : null

      await promptRepository.clearPendingAction(
        payload.telegramChatId,
        payload.ownerTelegramUserId,
        PAYMENT_TOPIC_CONFIRMATION_ACTION
      )
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
        ? formatMultiRecordedText(locale, payload, handledMemberIds, alreadyPaidMemberIds)
        : formatMultiPartialRecordedText(locale, payload, handledMemberIds, alreadyPaidMemberIds)

      await safeEditPaymentCallbackMessage(
        ctx,
        recordedText,
        {
          reply_markup: {
            inline_keyboard: []
          }
        },
        options.logger
      )

      if (options.auditNotificationService && handledMemberIds.size > 0) {
        const actorDisplayName = ctx.from?.first_name ?? 'Someone'
        const recordedMembers = payload.members.filter((member) =>
          handledMemberIds.has(member.memberId)
        )
        const recordedNames = recordedMembers.map((member) => member.displayName).join(', ')
        await options.auditNotificationService.recordEvent({
          householdId: payload.householdId,
          actorMemberId: null,
          actorDisplayName,
          eventType: 'payment.recorded',
          category: 'payment_events',
          summaryText: `${actorDisplayName} recorded ${payload.kind} payments for ${recordedNames}`,
          metadata: {
            proposalId: payload.proposalId,
            kind: payload.kind,
            period: payload.period,
            description: recordedNames,
            closedMembers: recordedMembers.map((member) => {
              const amount = recordedAmountByMemberId.get(member.memberId)
              return {
                memberId: member.memberId,
                displayName: member.displayName,
                ...(amount
                  ? {
                      amountMinor: amount.amountMinor.toString(),
                      currency: amount.currency
                    }
                  : {})
              }
            }),
            skippedMembers: payload.members
              .filter((member) => alreadyPaidSelectedMemberIds.has(member.memberId))
              .map((member) => ({
                memberId: member.memberId,
                displayName: member.displayName,
                reason: 'already_settled'
              }))
          }
        })
      }

      if (options.auditNotificationService && planResolution?.settledJustNow) {
        const settledPeriod = planResolution.period ?? payload.period
        await options.auditNotificationService.recordEvent({
          householdId: payload.householdId,
          actorMemberId: null,
          actorDisplayName: ctx.from?.first_name ?? 'Someone',
          eventType: 'utility_plan.fully_paid',
          category: 'plan_events',
          summaryText: `Utilities for ${settledPeriod} are fully settled`,
          metadata: { period: settledPeriod }
        })
      }

      if (fullyHandled && options.livePaymentCardService) {
        await options.livePaymentCardService.refresh({
          householdId: payload.householdId,
          kind: payload.kind,
          period: payload.period
        })
      }

      if (fullyPaid) {
        await ctx.reply(
          getBotTranslations(locale).payments.fullyPaid(
            payload.kind,
            formatPeriodLabel(locale, payload.period)
          )
        )
      }
    }
  )

  bot.callbackQuery(
    new RegExp(`^${PAYMENT_TOPIC_MULTI_CANCEL_CALLBACK_PREFIX}([^:]+)$`),
    async (ctx) => {
      if (
        ctx.chat?.type !== 'group' &&
        ctx.chat?.type !== 'supergroup' &&
        ctx.chat?.type !== 'private'
      ) {
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
        await safeAnswerPaymentCallback(
          ctx,
          {
            text: t.multiNotYourProposal,
            show_alert: true
          },
          options.logger
        )
        return
      }

      if (!payload || payload.proposalId !== proposalId) {
        await safeAnswerPaymentCallback(
          ctx,
          {
            text: t.proposalUnavailable,
            show_alert: true
          },
          options.logger
        )
        return
      }

      await promptRepository.clearPendingAction(
        payload.telegramChatId,
        payload.ownerTelegramUserId,
        PAYMENT_TOPIC_CONFIRMATION_ACTION
      )
      await safeAnswerPaymentCallback(
        ctx,
        {
          text: t.cancelled
        },
        options.logger
      )
      await safeEditPaymentCallbackMessage(
        ctx,
        t.cancelled,
        {
          reply_markup: {
            inline_keyboard: []
          }
        },
        options.logger
      )
    }
  )

  bot.callbackQuery(
    new RegExp(`^${PAYMENT_TOPIC_CONFIRM_CALLBACK_PREFIX}([^:]+)$`),
    async (ctx) => {
      if (
        ctx.chat?.type !== 'group' &&
        ctx.chat?.type !== 'supergroup' &&
        ctx.chat?.type !== 'private'
      ) {
        return
      }

      const actorTelegramUserId = ctx.from?.id?.toString()
      const proposalId = ctx.match[1]
      if (!actorTelegramUserId || !proposalId) {
        return
      }

      const pending = await promptRepository.getPendingAction(
        ctx.chat.id.toString(),
        actorTelegramUserId,
        PAYMENT_TOPIC_CONFIRMATION_ACTION
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
        await safeAnswerPaymentCallback(
          ctx,
          {
            text: t.proposalUnavailable,
            show_alert: true
          },
          options.logger
        )
        return
      }

      if (!actorCanManagePaymentProposal(actorTelegramUserId, payload)) {
        await safeAnswerPaymentCallback(
          ctx,
          {
            text: t.notYourProposal,
            show_alert: true
          },
          options.logger
        )
        return
      }

      await safeAnswerPaymentCallback(ctx, undefined, options.logger)

      const paymentService = paymentServiceForHousehold(payload.householdId)
      const result = await paymentService.submit({
        ...payload,
        rawText: payload.rawText,
        parseText: synthesizePaymentConfirmationText(payload)
      })

      await clearPaymentProposalPendingActions(promptRepository, payload)

      if (result.status === 'already_settled') {
        await safeEditPaymentCallbackMessage(
          ctx,
          t.alreadySettled(result.kind, payload.reportedDisplayName),
          {
            reply_markup: {
              inline_keyboard: []
            }
          },
          options.logger
        )
        return
      }

      if (result.status !== 'recorded') {
        await safeEditPaymentCallbackMessage(
          ctx,
          t.proposalUnavailable,
          {
            reply_markup: {
              inline_keyboard: []
            }
          },
          options.logger
        )
        return
      }

      const planResolution =
        result.kind === 'utilities'
          ? await resolvePlannedUtilitiesForRecordedPayments({
              financeService: financeServiceForHousehold(payload.householdId),
              period: payload.period,
              memberIds: [payload.memberId],
              actorTelegramUserId,
              logger: options.logger
            })
          : null

      const fullyPaid =
        payload.period === undefined
          ? false
          : await isPaymentKindFullyPaid({
              financeService: financeServiceForHousehold(payload.householdId),
              kind: payload.kind,
              period: payload.period
            })
      const recordedText = formatRecordedPaymentText(locale, payload, result.amount)
      await safeEditPaymentCallbackMessage(
        ctx,
        recordedText,
        {
          reply_markup: {
            inline_keyboard: []
          }
        },
        options.logger
      )

      if (options.auditNotificationService) {
        const memberDisplayName = payload.reportedDisplayName ?? ctx.from?.first_name ?? 'Someone'
        await options.auditNotificationService.recordEvent({
          householdId: payload.householdId,
          actorMemberId: payload.memberId,
          actorDisplayName: memberDisplayName,
          eventType: 'payment.recorded',
          category: 'payment_events',
          summaryText: `${memberDisplayName} recorded ${result.kind} payment: ${result.amount.toMajorString()} ${result.amount.currency}`,
          metadata: {
            memberId: payload.memberId,
            memberDisplayName,
            kind: result.kind,
            amountMinor: result.amount.amountMinor.toString(),
            currency: result.amount.currency,
            ...(payload.period ? { period: payload.period } : {})
          }
        })

        if (planResolution?.settledJustNow) {
          const settledPeriod = planResolution.period ?? payload.period ?? null
          await options.auditNotificationService.recordEvent({
            householdId: payload.householdId,
            actorMemberId: payload.memberId,
            actorDisplayName: memberDisplayName,
            eventType: 'utility_plan.fully_paid',
            category: 'plan_events',
            summaryText: `Utilities${settledPeriod ? ` for ${settledPeriod}` : ''} are fully settled`,
            metadata: settledPeriod ? { period: settledPeriod } : {}
          })
        }
      }

      if (payload.period && options.livePaymentCardService) {
        await options.livePaymentCardService.refresh({
          householdId: payload.householdId,
          kind: payload.kind,
          period: payload.period
        })
      }

      if (fullyPaid) {
        await ctx.reply(
          getBotTranslations(locale).payments.fullyPaid(
            payload.kind,
            formatPeriodLabel(locale, payload.period!)
          )
        )
      }
    }
  )

  bot.callbackQuery(new RegExp(`^${PAYMENT_TOPIC_CANCEL_CALLBACK_PREFIX}([^:]+)$`), async (ctx) => {
    if (
      ctx.chat?.type !== 'group' &&
      ctx.chat?.type !== 'supergroup' &&
      ctx.chat?.type !== 'private'
    ) {
      return
    }

    const actorTelegramUserId = ctx.from?.id?.toString()
    const proposalId = ctx.match[1]
    if (!actorTelegramUserId || !proposalId) {
      return
    }

    const pending = await promptRepository.getPendingAction(
      ctx.chat.id.toString(),
      actorTelegramUserId,
      PAYMENT_TOPIC_CONFIRMATION_ACTION
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
      await safeAnswerPaymentCallback(
        ctx,
        {
          text: t.proposalUnavailable,
          show_alert: true
        },
        options.logger
      )
      return
    }

    const actorIsAdmin = await isActorHouseholdAdmin({
      financeServiceForHousehold,
      householdId: payload.householdId,
      actorTelegramUserId
    })

    if (!actorCanManagePaymentProposal(actorTelegramUserId, payload) && !actorIsAdmin) {
      await safeAnswerPaymentCallback(
        ctx,
        {
          text: t.notYourProposal,
          show_alert: true
        },
        options.logger
      )
      return
    }

    await clearPaymentProposalPendingActions(promptRepository, payload)
    await safeAnswerPaymentCallback(
      ctx,
      {
        text: t.cancelled
      },
      options.logger
    )
    await safeEditPaymentCallbackMessage(
      ctx,
      t.cancelled,
      {
        reply_markup: {
          inline_keyboard: []
        }
      },
      options.logger
    )
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
