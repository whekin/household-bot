import { and, eq, inArray, sql } from 'drizzle-orm'

import { createDbClient, schema } from '@household/db'
import type {
  AnonymousFeedbackModerationStatus,
  AnonymousFeedbackRepository
} from '@household/ports'

const ACCEPTED_STATUSES = ['accepted', 'posted', 'failed'] as const

function parseModerationStatus(raw: string): AnonymousFeedbackModerationStatus {
  if (raw === 'accepted' || raw === 'posted' || raw === 'rejected' || raw === 'failed') {
    return raw
  }

  throw new Error(`Unexpected anonymous feedback moderation status: ${raw}`)
}

export function createDbAnonymousFeedbackRepository(
  databaseUrl: string,
  householdId: string
): {
  repository: AnonymousFeedbackRepository
  close: () => Promise<void>
} {
  const { db, queryClient } = createDbClient(databaseUrl, {
    max: 5,
    prepare: false
  })

  const repository: AnonymousFeedbackRepository = {
    async getMemberByTelegramUserId(telegramUserId) {
      const rows = await db
        .select({
          id: schema.members.id,
          telegramUserId: schema.members.telegramUserId,
          displayName: schema.members.displayName
        })
        .from(schema.members)
        .where(
          and(
            eq(schema.members.householdId, householdId),
            eq(schema.members.telegramUserId, telegramUserId)
          )
        )
        .limit(1)

      return rows[0] ?? null
    },

    async getRateLimitSnapshot(memberId, acceptedSince) {
      const acceptedSinceIso = acceptedSince.toISOString()

      const rows = await db
        .select({
          acceptedCountSince: sql<string>`count(*) filter (where ${schema.anonymousMessages.createdAt} >= ${acceptedSinceIso}::timestamptz)`,
          lastAcceptedAt: sql<Date | null>`max(${schema.anonymousMessages.createdAt})`
        })
        .from(schema.anonymousMessages)
        .where(
          and(
            eq(schema.anonymousMessages.householdId, householdId),
            eq(schema.anonymousMessages.submittedByMemberId, memberId),
            inArray(schema.anonymousMessages.moderationStatus, ACCEPTED_STATUSES)
          )
        )

      return {
        acceptedCountSince: Number(rows[0]?.acceptedCountSince ?? '0'),
        lastAcceptedAt: rows[0]?.lastAcceptedAt ?? null
      }
    },

    async createSubmission(input) {
      const inserted = await db
        .insert(schema.anonymousMessages)
        .values({
          householdId,
          submittedByMemberId: input.submittedByMemberId,
          rawText: input.rawText,
          sanitizedText: input.sanitizedText,
          moderationStatus: input.moderationStatus,
          moderationReason: input.moderationReason,
          telegramChatId: input.telegramChatId,
          telegramMessageId: input.telegramMessageId,
          telegramUpdateId: input.telegramUpdateId
        })
        .onConflictDoNothing({
          target: [schema.anonymousMessages.householdId, schema.anonymousMessages.telegramUpdateId]
        })
        .returning({
          id: schema.anonymousMessages.id,
          moderationStatus: schema.anonymousMessages.moderationStatus
        })

      if (inserted[0]) {
        return {
          submission: {
            id: inserted[0].id,
            moderationStatus: parseModerationStatus(inserted[0].moderationStatus)
          },
          duplicate: false
        }
      }

      const existing = await db
        .select({
          id: schema.anonymousMessages.id,
          moderationStatus: schema.anonymousMessages.moderationStatus
        })
        .from(schema.anonymousMessages)
        .where(
          and(
            eq(schema.anonymousMessages.householdId, householdId),
            eq(schema.anonymousMessages.telegramUpdateId, input.telegramUpdateId)
          )
        )
        .limit(1)

      const row = existing[0]
      if (!row) {
        throw new Error('Anonymous feedback insert conflict without stored row')
      }

      return {
        submission: {
          id: row.id,
          moderationStatus: parseModerationStatus(row.moderationStatus)
        },
        duplicate: true
      }
    },

    async markPosted(input) {
      await db
        .update(schema.anonymousMessages)
        .set({
          moderationStatus: 'posted',
          postedChatId: input.postedChatId,
          postedThreadId: input.postedThreadId,
          postedMessageId: input.postedMessageId,
          postedAt: input.postedAt,
          failureReason: null
        })
        .where(eq(schema.anonymousMessages.id, input.submissionId))
    },

    async markFailed(submissionId, failureReason) {
      await db
        .update(schema.anonymousMessages)
        .set({
          moderationStatus: 'failed',
          failureReason
        })
        .where(eq(schema.anonymousMessages.id, submissionId))
    }
  }

  return {
    repository,
    close: async () => {
      await queryClient.end({ timeout: 5 })
    }
  }
}
