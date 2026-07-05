import {
  buildMemberPaymentGuidance,
  type FinanceCommandService,
  type FinanceDashboard
} from '@household/application'
import { Money, type Instant } from '@household/domain'
import type { Context } from 'grammy'
import type { Logger } from '@household/observability'
import type {
  FinanceMemberRecord,
  FinancePaymentKind,
  HouseholdConfigurationRepository,
  TelegramPendingActionRepository,
  TopicMessageHistoryRepository
} from '@household/ports'

import {
  agentActionReplyMarkup,
  shortAgentActionId,
  upsertAgentActionPendingAction,
  type AgentActionPayload,
  type AgentActionType
} from './agent-confirmations'
import type { AssistantConversationMemoryStore } from './assistant-state'
import { getBotTranslations, type BotLocale } from './i18n'
import { createAgentPaymentProposal } from './payment-proposals'
import {
  parseCurrentMessageAmounts,
  publishAgentPaymentProposal,
  type PaymentTopicRecord
} from './payment-topic-ingestion'
import type { PurchaseInterpretation } from './openai-purchase-interpreter'
import {
  handlePurchaseMessageResult,
  type PurchaseMessageIngestionRepository,
  type PurchaseTopicRecord
} from './purchase-topic-ingestion'
import type { ToolSessionToolDefinition, ToolSessionToolResult } from './openai-tool-session'

export interface AgentMessageRecord {
  updateId: number
  chatId: string
  messageId: string
  threadId: string | null
  senderTelegramUserId: string
  senderDisplayName: string | null
  rawText: string
  attachmentCount: number
  messageSentAt: Instant
}

export interface AgentToolContext {
  householdId: string
  locale: BotLocale
  topicRole: 'payments' | 'purchase' | 'reminders' | 'feedback' | 'generic'
  senderMember: FinanceMemberRecord
  record: AgentMessageRecord
  ctx: Context
  financeService: FinanceCommandService
  householdConfigurationRepository: HouseholdConfigurationRepository
  promptRepository: TelegramPendingActionRepository
  purchaseRepository?: PurchaseMessageIngestionRepository
  historyRepository?: TopicMessageHistoryRepository
  memoryStore?: AssistantConversationMemoryStore
  commandCatalog: string | null
  postCard: (
    text: string,
    replyMarkup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }
  ) => Promise<void>
  logger?: Logger
}

function formatMoney(money: Money): string {
  return `${money.toMajorString()} ${money.currency}`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * An LLM-provided amount is only trusted when the sender actually typed it:
 * either as amount+currency, or as a bare number in the message text.
 */
export function explicitAmountFromMessage(input: {
  rawText: string
  amountMajor: string
  currency: 'GEL' | 'USD'
}): Money | null {
  let amount: Money
  try {
    amount = Money.fromMajor(input.amountMajor.replace(',', '.'), input.currency)
  } catch {
    return null
  }

  if (amount.amountMinor <= 0n) {
    return null
  }

  const withCurrency = parseCurrentMessageAmounts(input.rawText).some(
    (candidate) =>
      candidate.currency === input.currency && candidate.amountMinor === amount.amountMinor
  )
  if (withCurrency) {
    return amount
  }

  const major = amount.toMajorString()
  const numberVariants = [major, major.replace('.', ','), major.replace(/\.00$/, '')]
  const bareNumber = numberVariants.some((variant) =>
    new RegExp(`(?:^|[^\\d.,])${escapeRegExp(variant)}(?:[^\\d.,]|$)`).test(input.rawText)
  )

  return bareNumber ? amount : null
}

function toPaymentTopicRecord(record: AgentMessageRecord, householdId: string): PaymentTopicRecord {
  return {
    updateId: record.updateId,
    chatId: record.chatId,
    messageId: record.messageId,
    threadId: record.threadId ?? '',
    senderTelegramUserId: record.senderTelegramUserId,
    rawText: record.rawText,
    attachmentCount: record.attachmentCount,
    messageSentAt: record.messageSentAt,
    householdId
  }
}

function toPurchaseTopicRecord(
  record: AgentMessageRecord,
  householdId: string
): PurchaseTopicRecord {
  return {
    updateId: record.updateId,
    chatId: record.chatId,
    messageId: record.messageId,
    threadId: record.threadId ?? '',
    senderTelegramUserId: record.senderTelegramUserId,
    ...(record.senderDisplayName ? { senderDisplayName: record.senderDisplayName } : {}),
    rawText: record.rawText,
    messageSentAt: record.messageSentAt,
    householdId
  }
}

function readStringArgument(args: Record<string, unknown>, key: string): string | null {
  const value = args[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readStringArrayArgument(
  args: Record<string, unknown>,
  key: string
): readonly string[] | null {
  const value = args[key]
  if (!Array.isArray(value)) {
    return null
  }

  const entries = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
  return entries.length > 0 ? entries : null
}

function readPaymentKindArgument(
  args: Record<string, unknown>,
  key: string
): FinancePaymentKind | null {
  const value = args[key]
  return value === 'rent' || value === 'utilities' ? value : null
}

function readCurrencyArgument(args: Record<string, unknown>, key: string): 'GEL' | 'USD' | null {
  const value = args[key]
  return value === 'GEL' || value === 'USD' ? value : null
}

function currentPeriodSummary(dashboard: FinanceDashboard) {
  return dashboard.paymentPeriods?.find(
    (period) => period.isCurrentPeriod || period.period === dashboard.period
  )
}

function memberSummaries(dashboard: FinanceDashboard) {
  return dashboard.members.map((member) => ({
    memberId: member.memberId,
    name: member.displayName,
    status: member.status ?? 'active',
    totalDue: formatMoney(member.netDue),
    paid: formatMoney(member.paid),
    remaining: formatMoney(member.remaining)
  }))
}

async function getBillStatus(context: AgentToolContext): Promise<unknown> {
  const dashboard = await context.financeService.generateDashboard()
  if (!dashboard) {
    return { error: 'no_open_billing_cycle' }
  }

  const period = currentPeriodSummary(dashboard)
  return {
    period: dashboard.period,
    billingStage: dashboard.billingStage,
    settlementCurrency: dashboard.currency,
    totals: {
      due: formatMoney(dashboard.totalDue),
      paid: formatMoney(dashboard.totalPaid),
      remaining: formatMoney(dashboard.totalRemaining)
    },
    rent: {
      amount: formatMoney(dashboard.rentDisplayAmount),
      dueDate: dashboard.rentBillingState.dueDate,
      perMember: dashboard.rentBillingState.memberSummaries.map((summary) => ({
        memberId: summary.memberId,
        name: summary.displayName,
        due: formatMoney(summary.due),
        paid: formatMoney(summary.paid),
        remaining: formatMoney(summary.remaining)
      }))
    },
    utilities: dashboard.utilityBillingPlan
      ? {
          dueDate: dashboard.utilityBillingPlan.dueDate,
          planStatus: dashboard.utilityBillingPlan.status
        }
      : { planStatus: 'not_ready' },
    paymentKinds:
      period?.kinds.map((kind) => ({
        kind: kind.kind,
        due: formatMoney(kind.totalDue),
        paid: formatMoney(kind.totalPaid),
        remaining: formatMoney(kind.totalRemaining),
        unresolvedMembers: kind.unresolvedMembers.map((member) => ({
          memberId: member.memberId,
          name: member.displayName,
          suggestedAmount: formatMoney(member.suggestedAmount),
          remaining: formatMoney(member.remaining)
        }))
      })) ?? [],
    members: memberSummaries(dashboard)
  }
}

async function getPaymentInstructions(context: AgentToolContext): Promise<unknown> {
  const [dashboard, settings, categories] = await Promise.all([
    context.financeService.generateDashboard(),
    context.householdConfigurationRepository.getHouseholdBillingSettings(context.householdId),
    context.householdConfigurationRepository.listHouseholdUtilityCategories(context.householdId)
  ])
  if (!dashboard) {
    return { error: 'no_open_billing_cycle' }
  }

  const destinations =
    dashboard.rentBillingState.paymentDestinations ?? dashboard.rentPaymentDestinations ?? []
  const guidanceForMember = (memberId: string, kind: FinancePaymentKind) => {
    const line = dashboard.members.find((member) => member.memberId === memberId)
    if (!line) {
      return null
    }

    const guidance = buildMemberPaymentGuidance({
      kind,
      period: dashboard.period,
      memberLine: line,
      settings,
      paymentKindSummary:
        currentPeriodSummary(dashboard)?.kinds.find((candidate) => candidate.kind === kind) ?? null
    })
    return {
      payNow: formatMoney(guidance.proposalAmount),
      remaining: formatMoney(guidance.totalRemaining),
      dueDate: guidance.dueDate,
      windowOpen: guidance.paymentWindowOpen
    }
  }

  return {
    period: dashboard.period,
    rent: {
      destinations: destinations.map((destination) => ({
        label: destination.label,
        recipient: destination.recipientName,
        bank: destination.bankName,
        account: destination.account,
        note: destination.note,
        link: destination.link
      })),
      perMember: dashboard.members.map((member) => ({
        memberId: member.memberId,
        name: member.displayName,
        ...guidanceForMember(member.memberId, 'rent')
      }))
    },
    utilities: {
      providers: categories
        .filter((category) => category.isActive)
        .map((category) => ({
          name: category.name,
          provider: category.providerName,
          paymentLink: category.paymentLink,
          note: category.note
        })),
      assignedBills:
        dashboard.utilityBillingPlan?.categories.map((category) => ({
          bill: category.billName,
          assignedTo: category.assignedMemberId,
          amount: formatMoney(category.assignedAmount)
        })) ?? [],
      perMember: dashboard.members.map((member) => ({
        memberId: member.memberId,
        name: member.displayName,
        ...guidanceForMember(member.memberId, 'utilities')
      }))
    }
  }
}

const AGENT_CAPABILITIES = [
  'Answer questions about the household bill, balances, due dates, and payment instructions.',
  'Record rent/utilities payments as confirmation cards (including payments made for several members or reported for another member).',
  'Record shared purchases as confirmation cards.',
  'Edit or delete saved payments and purchases and change purchase participants — always via a confirmation card.',
  'Cancel a pending proposal.',
  'Cannot: change household settings, schedule arbitrary reminders, send money, or confirm cards on behalf of members.'
].join('\n')

async function getHouseholdInfo(context: AgentToolContext): Promise<unknown> {
  const [settings, members, dashboard] = await Promise.all([
    context.householdConfigurationRepository.getHouseholdBillingSettings(context.householdId),
    context.financeService.listMembers(),
    context.financeService.generateDashboard()
  ])

  return {
    settings: {
      settlementCurrency: settings.settlementCurrency,
      rentAmount: settings.rentAmountMinor
        ? formatMoney(Money.fromMinor(settings.rentAmountMinor, settings.rentCurrency))
        : null,
      rentDueDay: settings.rentDueDay,
      rentWarningDay: settings.rentWarningDay,
      utilitiesDueDay: settings.utilitiesDueDay,
      utilitiesReminderDay: settings.utilitiesReminderDay,
      paymentBalanceAdjustmentPolicy: settings.paymentBalanceAdjustmentPolicy ?? 'utilities',
      timezone: settings.timezone
    },
    currentPeriod: dashboard?.period ?? null,
    billingStage: dashboard?.billingStage ?? null,
    members: members.map((member) => ({
      memberId: member.id,
      name: member.displayName,
      isAdmin: member.isAdmin,
      status: dashboard?.members.find((line) => line.memberId === member.id)?.status ?? 'active',
      isSender: member.id === context.senderMember.id
    })),
    botCapabilities: AGENT_CAPABILITIES,
    availableCommands: context.commandCatalog
  }
}

async function listLedger(
  context: AgentToolContext,
  args: Record<string, unknown>
): Promise<unknown> {
  const dashboard = await context.financeService.generateDashboard()
  if (!dashboard) {
    return { error: 'no_open_billing_cycle' }
  }

  const kindFilter = args.kind
  const limitRaw = typeof args.limit === 'number' ? Math.floor(args.limit) : 10
  const limit = Math.max(1, Math.min(20, limitRaw))
  const entries = dashboard.ledger
    .filter((entry) =>
      kindFilter === 'payment' || kindFilter === 'purchase' || kindFilter === 'utility'
        ? entry.kind === kindFilter
        : true
    )
    .slice(-limit)

  return {
    period: dashboard.period,
    entries: entries.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      title: entry.title,
      amount: formatMoney(entry.displayAmount),
      memberId: entry.memberId,
      actor: entry.actorDisplayName,
      occurredAt: String(entry.occurredAt),
      ...(entry.paymentKind ? { paymentKind: entry.paymentKind } : {}),
      ...(entry.payerMemberId ? { payerMemberId: entry.payerMemberId } : {})
    }))
  }
}

async function proposePayment(
  context: AgentToolContext,
  args: Record<string, unknown>
): Promise<ToolSessionToolResult> {
  const settings = await context.householdConfigurationRepository.getHouseholdBillingSettings(
    context.householdId
  )
  const members = await context.financeService.listMembers()
  const payerMemberId = readStringArgument(args, 'payer_member_id') ?? context.senderMember.id
  const payer = members.find((member) => member.id === payerMemberId)
  if (!payer) {
    return { result: { error: 'unknown_payer_member_id' } }
  }

  const coveredMemberIds = (readStringArrayArgument(args, 'covered_member_ids') ?? []).filter(
    (memberId) => memberId !== payerMemberId
  )
  if (coveredMemberIds.some((memberId) => !members.some((member) => member.id === memberId))) {
    return { result: { error: 'unknown_covered_member_id' } }
  }

  const currency = readCurrencyArgument(args, 'currency') ?? settings.settlementCurrency
  const amountMajor = readStringArgument(args, 'amount_major')
  const perMemberAmountMajor = readStringArgument(args, 'per_member_amount_major')
  const explicitAmount = amountMajor
    ? explicitAmountFromMessage({ rawText: context.record.rawText, amountMajor, currency })
    : null
  const perMemberAmount = perMemberAmountMajor
    ? explicitAmountFromMessage({
        rawText: context.record.rawText,
        amountMajor: perMemberAmountMajor,
        currency
      })
    : null

  const proposal = await createAgentPaymentProposal({
    householdId: context.householdId,
    payerMemberId,
    additionalMemberIds: coveredMemberIds,
    kind: readPaymentKindArgument(args, 'kind'),
    explicitAmount,
    perMemberAmount,
    financeService: context.financeService,
    householdConfigurationRepository: context.householdConfigurationRepository
  })

  const isThirdParty = payerMemberId !== context.senderMember.id
  const published = await publishAgentPaymentProposal({
    ctx: context.ctx,
    locale: context.locale,
    record: toPaymentTopicRecord(context.record, context.householdId),
    proposal,
    payerTelegramUserId: payer.telegramUserId ?? null,
    payerDisplayName: payer.displayName,
    isThirdParty,
    promptRepository: context.promptRepository,
    ...(context.historyRepository ? { historyRepository: context.historyRepository } : {}),
    ...(context.memoryStore ? { memoryStore: context.memoryStore } : {})
  })

  const amountIgnored = Boolean(amountMajor) && !explicitAmount && coveredMemberIds.length === 0
  return {
    result: {
      status: published.status,
      ...(published.reason ? { reason: published.reason } : {}),
      ...(amountIgnored ? { note: 'amount_not_found_in_message_used_billing_guidance' } : {}),
      nothingRecordedYet: published.status === 'card_posted'
    },
    cardPosted: published.status !== 'no_action'
  }
}

async function proposePurchase(
  context: AgentToolContext,
  args: Record<string, unknown>
): Promise<ToolSessionToolResult> {
  if (!context.purchaseRepository) {
    return { result: { error: 'purchase_recording_unavailable' } }
  }

  const description = readStringArgument(args, 'description')
  const amountMajor = readStringArgument(args, 'amount_major')
  if (!description || !amountMajor) {
    return { result: { error: 'description_and_amount_required' } }
  }

  const settings = await context.householdConfigurationRepository.getHouseholdBillingSettings(
    context.householdId
  )
  const currency = readCurrencyArgument(args, 'currency') ?? settings.settlementCurrency
  const explicitAmount = explicitAmountFromMessage({
    rawText: context.record.rawText,
    amountMajor,
    currency
  })

  let amount = explicitAmount
  if (!amount) {
    try {
      amount = Money.fromMajor(amountMajor.replace(',', '.'), currency)
    } catch {
      return { result: { error: 'invalid_amount' } }
    }
  }

  if (amount.amountMinor <= 0n) {
    return { result: { error: 'invalid_amount' } }
  }

  const members = await context.financeService.listMembers()
  const payerMemberId = readStringArgument(args, 'payer_member_id') ?? context.senderMember.id
  if (!members.some((member) => member.id === payerMemberId)) {
    return { result: { error: 'unknown_payer_member_id' } }
  }

  const participantMemberIds = readStringArrayArgument(args, 'participant_member_ids')
  if (
    participantMemberIds &&
    participantMemberIds.some((memberId) => !members.some((member) => member.id === memberId))
  ) {
    return { result: { error: 'unknown_participant_member_id' } }
  }

  const calculationExplanation = readStringArgument(args, 'calculation_explanation')
  const interpretation: PurchaseInterpretation = {
    decision: 'purchase',
    amountMinor: amount.amountMinor,
    currency: amount.currency,
    itemDescription: description,
    payerMemberId,
    amountSource: explicitAmount ? 'explicit' : 'calculated',
    calculationExplanation: explicitAmount ? null : calculationExplanation,
    participantMemberIds: participantMemberIds ?? null,
    confidence: 95,
    parserMode: 'llm',
    clarificationQuestion: null
  }

  const record = toPurchaseTopicRecord(context.record, context.householdId)
  const result = await context.purchaseRepository.saveWithInterpretation(record, interpretation)
  await handlePurchaseMessageResult(
    context.ctx,
    record,
    result,
    context.locale,
    context.logger,
    context.historyRepository
  )

  return {
    result: {
      status: result.status,
      nothingRecordedYet: result.status === 'pending_confirmation'
    },
    cardPosted: result.status !== 'duplicate'
  }
}

async function requestConfirmedAction(
  context: AgentToolContext,
  actionType: AgentActionType,
  summaryText: string,
  params: Record<string, unknown>
): Promise<ToolSessionToolResult> {
  const t = getBotTranslations(context.locale).agent
  const payload: AgentActionPayload = {
    actionId: shortAgentActionId(),
    actionType,
    householdId: context.householdId,
    requesterTelegramUserId: context.record.senderTelegramUserId,
    locale: context.locale,
    summaryText,
    params
  }

  await upsertAgentActionPendingAction({
    promptRepository: context.promptRepository,
    telegramChatId: context.record.chatId,
    payload
  })
  await context.postCard(
    t.actionPrompt(summaryText),
    agentActionReplyMarkup(context.locale, payload.actionId)
  )

  return {
    result: { status: 'confirmation_card_posted', nothingChangedYet: true },
    cardPosted: true
  }
}

async function updatePaymentTool(
  context: AgentToolContext,
  args: Record<string, unknown>
): Promise<ToolSessionToolResult> {
  const paymentId = readStringArgument(args, 'payment_id')
  const amountMajor = readStringArgument(args, 'amount_major')
  if (!paymentId || !amountMajor) {
    return { result: { error: 'payment_id_and_amount_required' } }
  }

  const payment = await context.financeService.getPayment(paymentId)
  if (!payment) {
    return { result: { error: 'payment_not_found' } }
  }

  if (payment.memberId !== context.senderMember.id && !context.senderMember.isAdmin) {
    return { result: { error: 'not_allowed_only_own_payments_or_admin' } }
  }

  const members = await context.financeService.listMembers()
  const memberId = readStringArgument(args, 'member_id') ?? payment.memberId
  const member = members.find((candidate) => candidate.id === memberId)
  if (!member) {
    return { result: { error: 'unknown_member_id' } }
  }

  const kind = readPaymentKindArgument(args, 'kind') ?? payment.kind
  const currency = readCurrencyArgument(args, 'currency') ?? payment.currency
  const t = getBotTranslations(context.locale).agent
  return requestConfirmedAction(
    context,
    'update_payment',
    t.summarizeUpdatePayment(member.displayName, kind, amountMajor, currency),
    { paymentId, memberId, kind, amountMajor, currency }
  )
}

async function deletePaymentTool(
  context: AgentToolContext,
  args: Record<string, unknown>
): Promise<ToolSessionToolResult> {
  const paymentId = readStringArgument(args, 'payment_id')
  if (!paymentId) {
    return { result: { error: 'payment_id_required' } }
  }

  const payment = await context.financeService.getPayment(paymentId)
  if (!payment) {
    return { result: { error: 'payment_not_found' } }
  }

  if (payment.memberId !== context.senderMember.id && !context.senderMember.isAdmin) {
    return { result: { error: 'not_allowed_only_own_payments_or_admin' } }
  }

  const members = await context.financeService.listMembers()
  const member = members.find((candidate) => candidate.id === payment.memberId)
  const amount = Money.fromMinor(payment.amountMinor, payment.currency)
  const t = getBotTranslations(context.locale).agent
  return requestConfirmedAction(
    context,
    'delete_payment',
    t.summarizeDeletePayment(
      member?.displayName ?? payment.memberId,
      payment.kind,
      amount.toMajorString(),
      amount.currency
    ),
    { paymentId }
  )
}

async function loadEditablePurchase(context: AgentToolContext, purchaseId: string) {
  const purchase = await context.financeService.getPurchase(purchaseId)
  if (!purchase) {
    return null
  }

  if (purchase.payerMemberId !== context.senderMember.id && !context.senderMember.isAdmin) {
    return 'forbidden' as const
  }

  return purchase
}

async function updatePurchaseTool(
  context: AgentToolContext,
  args: Record<string, unknown>
): Promise<ToolSessionToolResult> {
  const purchaseId = readStringArgument(args, 'purchase_id')
  if (!purchaseId) {
    return { result: { error: 'purchase_id_required' } }
  }

  const purchase = await loadEditablePurchase(context, purchaseId)
  if (!purchase) {
    return { result: { error: 'purchase_not_found' } }
  }
  if (purchase === 'forbidden') {
    return { result: { error: 'not_allowed_only_own_purchases_or_admin' } }
  }

  const existingAmount = Money.fromMinor(purchase.amountMinor, purchase.currency)
  const description =
    readStringArgument(args, 'description') ?? purchase.description ?? 'shared purchase'
  const amountMajor = readStringArgument(args, 'amount_major') ?? existingAmount.toMajorString()
  const currency = readCurrencyArgument(args, 'currency') ?? purchase.currency
  const payerMemberId = readStringArgument(args, 'payer_member_id')
  if (
    payerMemberId &&
    !(await context.financeService.listMembers()).some((member) => member.id === payerMemberId)
  ) {
    return { result: { error: 'unknown_payer_member_id' } }
  }

  const t = getBotTranslations(context.locale).agent
  return requestConfirmedAction(
    context,
    'update_purchase',
    t.summarizeUpdatePurchase(description, amountMajor, currency),
    { purchaseId, description, amountMajor, currency, payerMemberId }
  )
}

async function deletePurchaseTool(
  context: AgentToolContext,
  args: Record<string, unknown>
): Promise<ToolSessionToolResult> {
  const purchaseId = readStringArgument(args, 'purchase_id')
  if (!purchaseId) {
    return { result: { error: 'purchase_id_required' } }
  }

  const purchase = await loadEditablePurchase(context, purchaseId)
  if (!purchase) {
    return { result: { error: 'purchase_not_found' } }
  }
  if (purchase === 'forbidden') {
    return { result: { error: 'not_allowed_only_own_purchases_or_admin' } }
  }

  const amount = Money.fromMinor(purchase.amountMinor, purchase.currency)
  const t = getBotTranslations(context.locale).agent
  return requestConfirmedAction(
    context,
    'delete_purchase',
    t.summarizeDeletePurchase(
      purchase.description ?? 'shared purchase',
      amount.toMajorString(),
      amount.currency
    ),
    { purchaseId }
  )
}

async function setPurchaseParticipantsTool(
  context: AgentToolContext,
  args: Record<string, unknown>
): Promise<ToolSessionToolResult> {
  const purchaseId = readStringArgument(args, 'purchase_id')
  const participantMemberIds = readStringArrayArgument(args, 'participant_member_ids')
  if (!purchaseId || !participantMemberIds) {
    return { result: { error: 'purchase_id_and_participants_required' } }
  }

  const purchase = await loadEditablePurchase(context, purchaseId)
  if (!purchase) {
    return { result: { error: 'purchase_not_found' } }
  }
  if (purchase === 'forbidden') {
    return { result: { error: 'not_allowed_only_own_purchases_or_admin' } }
  }

  const members = await context.financeService.listMembers()
  const participants = participantMemberIds.map((memberId) =>
    members.find((member) => member.id === memberId)
  )
  if (participants.some((member) => member === undefined)) {
    return { result: { error: 'unknown_participant_member_id' } }
  }

  const amount = Money.fromMinor(purchase.amountMinor, purchase.currency)
  const t = getBotTranslations(context.locale).agent
  return requestConfirmedAction(
    context,
    'set_purchase_participants',
    t.summarizeSetPurchaseParticipants(
      purchase.description ?? 'shared purchase',
      (participants as FinanceMemberRecord[]).map((member) => member.displayName).join(', ')
    ),
    {
      purchaseId,
      description: purchase.description ?? 'shared purchase',
      amountMajor: amount.toMajorString(),
      currency: amount.currency,
      participantMemberIds: [...participantMemberIds]
    }
  )
}

async function cancelPendingProposal(context: AgentToolContext): Promise<ToolSessionToolResult> {
  const t = getBotTranslations(context.locale).agent
  const cancellableActions = [
    'payment_topic_confirmation',
    'payment_topic_clarification',
    'agent_action'
  ] as const
  let cancelled: (typeof cancellableActions)[number] | null = null
  for (const action of cancellableActions) {
    const pending = await context.promptRepository.getPendingAction(
      context.record.chatId,
      context.record.senderTelegramUserId,
      action
    )
    if (pending) {
      cancelled = action
      break
    }
  }

  if (!cancelled) {
    return { result: { status: 'nothing_to_cancel' } }
  }

  await context.promptRepository.clearPendingAction(
    context.record.chatId,
    context.record.senderTelegramUserId,
    cancelled
  )
  await context.postCard(t.pendingProposalCancelled)
  return { result: { status: 'cancelled' }, cardPosted: true }
}

const MEMBER_ID_NOTE =
  'Member ids come from get_household_info / get_bill_status. Never invent ids.'

export function agentToolDefinitions(input: {
  purchaseToolsAvailable: boolean
}): readonly ToolSessionToolDefinition[] {
  const definitions: ToolSessionToolDefinition[] = [
    {
      name: 'get_bill_status',
      description:
        'Current household bill: period, totals, rent/utilities due dates, per-member remaining amounts. Use for any question about who owes what.',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    },
    {
      name: 'get_payment_instructions',
      description:
        'Where and how to pay: rent payment destinations (bank/account/links), utility providers with payment links, and per-member amounts to pay now. Use when someone asks how or where to pay.',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    },
    {
      name: 'get_household_info',
      description:
        'Household settings (currency, rent amount, due days, timezone), member list with ids and statuses, bot capabilities, and available commands.',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    },
    {
      name: 'list_ledger',
      description:
        'Recent ledger entries (payments, purchases, utility bills) with their ids. Use to find a payment/purchase the user wants to check, edit, or delete.',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['payment', 'purchase', 'utility'] },
          limit: { type: 'number' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'propose_payment',
      description: [
        'Post a confirmation card for a completed rent/utilities payment. Nothing is recorded until a person presses Confirm.',
        'Use when a member reports having paid. payer_member_id: who the payment belongs to (defaults to the sender; set it when the sender reports someone else paid, e.g. "Ion paid the rent").',
        'covered_member_ids: additional members whose shares the payer covered (e.g. "paid for me and Alisa" → sender is payer, Alisa in covered_member_ids). Amounts default to each member\'s billed share.',
        'amount_major: only if the sender explicitly wrote the amount in THIS message.',
        MEMBER_ID_NOTE
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['rent', 'utilities'] },
          payer_member_id: { type: 'string' },
          covered_member_ids: { type: 'array', items: { type: 'string' } },
          amount_major: { type: 'string' },
          per_member_amount_major: { type: 'string' },
          currency: { type: 'string', enum: ['GEL', 'USD'] }
        },
        additionalProperties: false
      }
    },
    {
      name: 'update_payment',
      description:
        'Ask to change a saved payment (amount, kind, or member). Posts a confirmation card; nothing changes until confirmed. Find payment_id via list_ledger. ' +
        MEMBER_ID_NOTE,
      parameters: {
        type: 'object',
        properties: {
          payment_id: { type: 'string' },
          amount_major: { type: 'string' },
          currency: { type: 'string', enum: ['GEL', 'USD'] },
          kind: { type: 'string', enum: ['rent', 'utilities'] },
          member_id: { type: 'string' }
        },
        required: ['payment_id', 'amount_major'],
        additionalProperties: false
      }
    },
    {
      name: 'delete_payment',
      description:
        'Ask to delete a saved payment. Posts a confirmation card; nothing changes until confirmed. Find payment_id via list_ledger.',
      parameters: {
        type: 'object',
        properties: { payment_id: { type: 'string' } },
        required: ['payment_id'],
        additionalProperties: false
      }
    },
    {
      name: 'cancel_pending_proposal',
      description:
        "Cancel the sender's own pending payment proposal or pending confirmation card in this chat.",
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    }
  ]

  if (input.purchaseToolsAvailable) {
    definitions.push(
      {
        name: 'propose_purchase',
        description: [
          'Post a confirmation card for a completed shared purchase. Nothing is recorded until confirmed.',
          'Use when a member reports buying something for the household. amount_major must come from the message; if you computed it (e.g. 2×3.50), explain in calculation_explanation.',
          'participant_member_ids: only when the message explicitly narrows who shares the purchase.',
          MEMBER_ID_NOTE
        ].join(' '),
        parameters: {
          type: 'object',
          properties: {
            description: { type: 'string' },
            amount_major: { type: 'string' },
            currency: { type: 'string', enum: ['GEL', 'USD'] },
            payer_member_id: { type: 'string' },
            participant_member_ids: { type: 'array', items: { type: 'string' } },
            calculation_explanation: { type: 'string' }
          },
          required: ['description', 'amount_major'],
          additionalProperties: false
        }
      },
      {
        name: 'update_purchase',
        description:
          'Ask to change a saved purchase (description, amount, payer). Posts a confirmation card. Find purchase_id via list_ledger.',
        parameters: {
          type: 'object',
          properties: {
            purchase_id: { type: 'string' },
            description: { type: 'string' },
            amount_major: { type: 'string' },
            currency: { type: 'string', enum: ['GEL', 'USD'] },
            payer_member_id: { type: 'string' }
          },
          required: ['purchase_id'],
          additionalProperties: false
        }
      },
      {
        name: 'delete_purchase',
        description:
          'Ask to delete a saved purchase. Posts a confirmation card. Find purchase_id via list_ledger.',
        parameters: {
          type: 'object',
          properties: { purchase_id: { type: 'string' } },
          required: ['purchase_id'],
          additionalProperties: false
        }
      },
      {
        name: 'set_purchase_participants',
        description:
          'Ask to change which members share a saved purchase. Posts a confirmation card. ' +
          MEMBER_ID_NOTE,
        parameters: {
          type: 'object',
          properties: {
            purchase_id: { type: 'string' },
            participant_member_ids: { type: 'array', items: { type: 'string' } }
          },
          required: ['purchase_id', 'participant_member_ids'],
          additionalProperties: false
        }
      }
    )
  }

  return definitions
}

export async function executeAgentTool(
  context: AgentToolContext,
  call: { name: string; arguments: Record<string, unknown> }
): Promise<ToolSessionToolResult> {
  context.logger?.info(
    { event: 'agent.tool', tool: call.name, args: call.arguments },
    'Agent tool call'
  )

  switch (call.name) {
    case 'get_bill_status':
      return { result: await getBillStatus(context) }
    case 'get_payment_instructions':
      return { result: await getPaymentInstructions(context) }
    case 'get_household_info':
      return { result: await getHouseholdInfo(context) }
    case 'list_ledger':
      return { result: await listLedger(context, call.arguments) }
    case 'propose_payment':
      return proposePayment(context, call.arguments)
    case 'propose_purchase':
      return proposePurchase(context, call.arguments)
    case 'update_payment':
      return updatePaymentTool(context, call.arguments)
    case 'delete_payment':
      return deletePaymentTool(context, call.arguments)
    case 'update_purchase':
      return updatePurchaseTool(context, call.arguments)
    case 'delete_purchase':
      return deletePurchaseTool(context, call.arguments)
    case 'set_purchase_participants':
      return setPurchaseParticipantsTool(context, call.arguments)
    case 'cancel_pending_proposal':
      return cancelPendingProposal(context)
    default:
      return { result: { error: 'unknown_tool' } }
  }
}
