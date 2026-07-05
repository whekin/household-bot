import { instantToDate, nowInstant, type Instant } from '@household/domain'
import { createDbClient, schema } from '@household/db'
import { and, desc, eq, inArray } from 'drizzle-orm'

import type { PurchaseInterpretation } from '../openai-purchase-interpreter'
import {
  canConfirmActivePurchaseProposal,
  explicitPurchaseParticipantMemberIds,
  finalizePayerDecision,
  resolveProposalParticipantSelection,
  type PurchaseMessageIngestionRepository,
  type PurchasePersistenceDecision,
  type PurchaseProposalActionResult,
  type PurchaseTopicRecord
} from '../purchase-topic-ingestion'

const MIN_PROPOSAL_CONFIDENCE = 70
const CLARIFICATION_CONTEXT_MAX_AGE_MS = 30 * 60_000
const MAX_CLARIFICATION_CONTEXT_MESSAGES = 3

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
  senderMemberId: string | null
  payerMemberId: string | null
  senderTelegramUserId: string
  parsedAmountMinor: bigint | null
  parsedCurrency: 'GEL' | 'USD' | null
  parsedItemDescription: string | null
  parserConfidence: number | null
  parserMode: 'llm' | null
  processingStatus: StoredPurchaseProcessingStatus
}

interface StoredPurchaseParticipantRow {
  id: string
  purchaseMessageId: string
  memberId: string
  displayName: string
  telegramUserId: string
  memberStatus: 'active' | 'away' | 'left'
  included: boolean
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
      payerMemberId: null,
      payerCandidateMemberIds: null,
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
      payerMemberId: interpretation.payerMemberId ?? null,
      payerCandidateMemberIds: null,
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
      payerMemberId: interpretation.payerMemberId ?? null,
      payerCandidateMemberIds: null,
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
    payerMemberId: interpretation.payerMemberId ?? null,
    payerCandidateMemberIds: null,
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

function needsReviewAsInt(value: boolean): number {
  return value ? 1 : 0
}

function participantIncludedAsInt(value: boolean): number {
  return value ? 1 : 0
}

function normalizeLifecycleStatus(value: string): 'active' | 'away' | 'left' {
  return value === 'away' || value === 'left' ? value : 'active'
}

function toStoredPurchaseRow(row: {
  id: string
  householdId: string
  senderMemberId: string | null
  payerMemberId: string | null
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
    senderMemberId: row.senderMemberId,
    payerMemberId: row.payerMemberId,
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

function toProposalFields(row: StoredPurchaseMessageRow) {
  return {
    parsedAmountMinor: row.parsedAmountMinor,
    parsedCurrency: row.parsedCurrency,
    parsedItemDescription: row.parsedItemDescription,
    payerMemberId: row.payerMemberId,
    payerDisplayName: null,
    amountSource: null,
    calculationExplanation: null,
    parserConfidence: row.parserConfidence,
    parserMode: row.parserMode
  }
}

function toProposalParticipants(rows: readonly StoredPurchaseParticipantRow[]) {
  return rows.map((row) => ({
    id: row.id,
    memberId: row.memberId,
    displayName: row.displayName,
    included: row.included,
    memberStatus: row.memberStatus
  }))
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
        senderMemberId: schema.purchaseMessages.senderMemberId,
        payerMemberId: schema.purchaseMessages.payerMemberId,
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
        memberStatus: schema.members.lifecycleStatus,
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
      memberStatus: normalizeLifecycleStatus(row.memberStatus),
      included: row.included === 1
    }))
  }

  async function loadHouseholdMembers(householdId: string) {
    return (
      await db
        .select({
          memberId: schema.members.id,
          displayName: schema.members.displayName,
          telegramUserId: schema.members.telegramUserId,
          status: schema.members.lifecycleStatus
        })
        .from(schema.members)
        .where(eq(schema.members.householdId, householdId))
    ).map((member) => ({
      memberId: member.memberId,
      displayName: member.displayName,
      telegramUserId: member.telegramUserId,
      status: normalizeLifecycleStatus(member.status)
    }))
  }

  function findMemberDisplayName(
    members: readonly { memberId: string; displayName: string }[],
    memberId: string | null
  ): string | null {
    if (!memberId) {
      return null
    }

    return members.find((member) => member.memberId === memberId)?.displayName ?? null
  }

  function payerCandidatesFromIds(
    members: readonly {
      memberId: string
      displayName: string
      status: 'active' | 'away' | 'left'
    }[],
    candidateIds: readonly string[] | null
  ) {
    if (!candidateIds || candidateIds.length === 0) {
      return []
    }

    const wanted = new Set(candidateIds)
    return members
      .filter((member) => member.status !== 'left')
      .filter((member) => wanted.has(member.memberId))
      .map((member) => ({
        memberId: member.memberId,
        displayName: member.displayName
      }))
  }

  async function defaultProposalParticipants(input: {
    householdId: string
    senderTelegramUserId: string
    senderMemberId: string | null
    payerMemberId: string | null
    messageSentAt: Instant
    explicitParticipantMemberIds: readonly string[] | null
  }): Promise<readonly { memberId: string; included: boolean }[]> {
    const members = await db
      .select({
        id: schema.members.id,
        telegramUserId: schema.members.telegramUserId,
        lifecycleStatus: schema.members.lifecycleStatus
      })
      .from(schema.members)
      .where(eq(schema.members.householdId, input.householdId))

    return resolveProposalParticipantSelection({
      members: members.map((member) => ({
        memberId: member.id,
        telegramUserId: member.telegramUserId,
        lifecycleStatus: normalizeLifecycleStatus(member.lifecycleStatus)
      })),
      senderTelegramUserId: input.senderTelegramUserId,
      senderMemberId: input.senderMemberId,
      payerMemberId: input.payerMemberId,
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

    const actorRows = await db
      .select({
        memberId: schema.members.id,
        isAdmin: schema.members.isAdmin,
        lifecycleStatus: schema.members.lifecycleStatus
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
    const actorIsActiveAdmin =
      actor?.isAdmin === 1 && normalizeLifecycleStatus(actor.lifecycleStatus) === 'active'
    const actorIsAllowed =
      existing.senderTelegramUserId === actorTelegramUserId ||
      actorIsActiveAdmin ||
      (actor?.memberId !== undefined && actor.memberId === existing.payerMemberId)

    if (!actorIsAllowed) {
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

    const canMutateFromStatus =
      existing.processingStatus === 'pending_confirmation' ||
      (targetStatus === 'cancelled' && existing.processingStatus === 'clarification_needed')

    if (!canMutateFromStatus) {
      return {
        status: 'not_pending',
        householdId: existing.householdId
      }
    }

    if (targetStatus === 'confirmed') {
      const [participants, householdMembers] = await Promise.all([
        getStoredParticipants(existing.id),
        loadHouseholdMembers(existing.householdId)
      ])

      if (
        !canConfirmActivePurchaseProposal({
          payerMemberId: existing.payerMemberId,
          participants,
          members: householdMembers
        })
      ) {
        return {
          status: 'not_pending',
          householdId: existing.householdId
        }
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
          targetStatus === 'cancelled'
            ? inArray(schema.purchaseMessages.processingStatus, [
                'pending_confirmation',
                'clarification_needed'
              ])
            : eq(schema.purchaseMessages.processingStatus, 'pending_confirmation')
        )
      )
      .returning({
        id: schema.purchaseMessages.id,
        householdId: schema.purchaseMessages.householdId,
        senderMemberId: schema.purchaseMessages.senderMemberId,
        payerMemberId: schema.purchaseMessages.payerMemberId,
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
      const householdMembers = (await loadHouseholdMembers(record.householdId)).filter(
        (member) => member.status !== 'left'
      )
      const decision = finalizePayerDecision({
        decision: normalizeInterpretation(interpretation, null),
        rawText: record.rawText,
        householdMembers,
        senderMemberId
      })

      const inserted = await db
        .insert(schema.purchaseMessages)
        .values({
          householdId: record.householdId,
          senderMemberId,
          payerMemberId: decision.payerMemberId,
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
            payerMemberId: decision.payerMemberId,
            payerDisplayName: findMemberDisplayName(householdMembers, decision.payerMemberId),
            amountSource: decision.amountSource,
            calculationExplanation: decision.calculationExplanation,
            parserConfidence: decision.parserConfidence,
            parserMode: decision.parserMode,
            ...(decision.payerCandidateMemberIds
              ? {
                  payerCandidates: payerCandidatesFromIds(
                    householdMembers,
                    decision.payerCandidateMemberIds
                  )
                }
              : {})
          }
        case 'pending_confirmation': {
          const participants = await defaultProposalParticipants({
            householdId: record.householdId,
            senderTelegramUserId: record.senderTelegramUserId,
            senderMemberId,
            payerMemberId: decision.payerMemberId,
            messageSentAt: record.messageSentAt,
            explicitParticipantMemberIds: explicitPurchaseParticipantMemberIds({
              rawText: record.rawText,
              participantMemberIds: decision.participantMemberIds
            })
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
            payerMemberId: decision.payerMemberId,
            payerDisplayName: findMemberDisplayName(householdMembers, decision.payerMemberId),
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
          payerMemberId: schema.purchaseMessages.payerMemberId,
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
          isAdmin: schema.members.isAdmin,
          lifecycleStatus: schema.members.lifecycleStatus
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
      const actorIsActiveAdmin =
        actor?.isAdmin === 1 && normalizeLifecycleStatus(actor.lifecycleStatus) === 'active'
      if (existing.senderTelegramUserId !== actorTelegramUserId && !actorIsActiveAdmin) {
        return {
          status: 'forbidden',
          householdId: existing.householdId
        }
      }

      const currentParticipants = await getStoredParticipants(existing.purchaseMessageId)
      const targetParticipant = currentParticipants.find(
        (participant) => participant.id === participantId
      )
      if (!targetParticipant) {
        return {
          status: 'not_found'
        }
      }

      if (existing.included !== 1 && targetParticipant.memberStatus !== 'active') {
        return {
          status: 'not_editable',
          householdId: existing.householdId
        }
      }

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

      const householdMembers = await loadHouseholdMembers(existing.householdId)

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
        payerMemberId: existing.payerMemberId,
        payerDisplayName: findMemberDisplayName(householdMembers, existing.payerMemberId),
        parserConfidence: existing.parserConfidence,
        parserMode: existing.parserMode === 'llm' ? 'llm' : null,
        participants: toProposalParticipants(
          await getStoredParticipants(existing.purchaseMessageId)
        )
      }
    },

    async selectPayer(purchaseMessageId, memberId, actorTelegramUserId) {
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

      if (existing.processingStatus !== 'clarification_needed') {
        return {
          status: 'not_pending',
          householdId: existing.householdId
        }
      }

      if (
        existing.parsedAmountMinor === null ||
        existing.parsedCurrency === null ||
        existing.parsedItemDescription === null
      ) {
        return {
          status: 'not_pending',
          householdId: existing.householdId
        }
      }

      const householdMembers = await loadHouseholdMembers(existing.householdId)
      const payer = householdMembers.find(
        (candidate) => candidate.memberId === memberId && candidate.status === 'active'
      )

      if (!payer) {
        return {
          status: 'not_pending',
          householdId: existing.householdId
        }
      }

      await db
        .update(schema.purchaseMessages)
        .set({
          payerMemberId: payer.memberId,
          processingStatus: 'pending_confirmation',
          needsReview: 1
        })
        .where(
          and(
            eq(schema.purchaseMessages.id, purchaseMessageId),
            eq(schema.purchaseMessages.senderTelegramUserId, actorTelegramUserId),
            eq(schema.purchaseMessages.processingStatus, 'clarification_needed')
          )
        )

      await db
        .delete(schema.purchaseMessageParticipants)
        .where(eq(schema.purchaseMessageParticipants.purchaseMessageId, purchaseMessageId))

      const participants = await defaultProposalParticipants({
        householdId: existing.householdId,
        senderTelegramUserId: existing.senderTelegramUserId,
        senderMemberId: existing.senderMemberId,
        payerMemberId: payer.memberId,
        messageSentAt: nowInstant(),
        explicitParticipantMemberIds: null
      })

      if (participants.length > 0) {
        await db.insert(schema.purchaseMessageParticipants).values(
          participants.map((participant) => ({
            purchaseMessageId,
            memberId: participant.memberId,
            included: participantIncludedAsInt(participant.included)
          }))
        )
      }

      return {
        status: 'selected',
        purchaseMessageId,
        householdId: existing.householdId,
        parsedAmountMinor: existing.parsedAmountMinor,
        parsedCurrency: existing.parsedCurrency,
        parsedItemDescription: existing.parsedItemDescription,
        payerMemberId: payer.memberId,
        payerDisplayName: payer.displayName,
        parserConfidence: existing.parserConfidence,
        parserMode: existing.parserMode,
        participants: toProposalParticipants(await getStoredParticipants(purchaseMessageId))
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
