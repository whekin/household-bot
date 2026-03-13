import type {
  AnonymousFeedbackRejectionReason,
  AnonymousFeedbackRepository
} from '@household/ports'
import {
  nowInstant,
  instantFromDate,
  instantFromIso,
  type Instant,
  Temporal
} from '@household/domain'

const MIN_MESSAGE_LENGTH = 12
const MAX_MESSAGE_LENGTH = 500
const COOLDOWN_HOURS = 6
const DAILY_CAP = 3
const BLOCKLIST = ['kill yourself', 'сука', 'тварь', 'идиот', 'idiot', 'hate you'] as const

function normalizeInstant(value: unknown): Instant | null {
  if (!value) {
    return null
  }

  if (value instanceof Temporal.Instant) {
    return value
  }

  if (value instanceof Date) {
    return instantFromDate(value)
  }

  if (typeof value === 'string') {
    return instantFromIso(value)
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    'epochMilliseconds' in value &&
    typeof (value as { epochMilliseconds?: unknown }).epochMilliseconds === 'number'
  ) {
    return Temporal.Instant.fromEpochMilliseconds(
      (value as { epochMilliseconds: number }).epochMilliseconds
    )
  }

  return null
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function sanitizeAnonymousText(rawText: string): string {
  return collapseWhitespace(rawText)
    .replace(/https?:\/\/\S+/gi, '[link removed]')
    .replace(/@\w+/g, '[mention removed]')
    .replace(/\+?\d[\d\s\-()]{8,}\d/g, '[contact removed]')
}

function findBlocklistedPhrase(value: string): string | null {
  const normalized = value.toLowerCase()

  for (const phrase of BLOCKLIST) {
    if (normalized.includes(phrase)) {
      return phrase
    }
  }

  return null
}

export type AnonymousFeedbackSubmitResult =
  | {
      status: 'accepted'
      submissionId: string
      sanitizedText: string
    }
  | {
      status: 'duplicate'
      submissionId: string
    }
  | {
      status: 'rejected'
      reason: AnonymousFeedbackRejectionReason
      detail?: string
      nextAllowedAt?: Instant
    }

export interface AnonymousFeedbackService {
  submit(input: {
    telegramUserId: string
    rawText: string
    telegramChatId: string
    telegramMessageId: string
    telegramUpdateId: string
    now?: Instant
  }): Promise<AnonymousFeedbackSubmitResult>
  markPosted(input: {
    submissionId: string
    postedChatId: string
    postedThreadId: string
    postedMessageId: string
    postedAt?: Instant
  }): Promise<void>
  markFailed(submissionId: string, failureReason: string): Promise<void>
}

async function rejectSubmission(
  repository: AnonymousFeedbackRepository,
  input: {
    memberId: string
    rawText: string
    reason: AnonymousFeedbackRejectionReason
    detail?: string
    nextAllowedAt?: Instant
    telegramChatId: string
    telegramMessageId: string
    telegramUpdateId: string
  }
): Promise<AnonymousFeedbackSubmitResult> {
  const created = await repository.createSubmission({
    submittedByMemberId: input.memberId,
    rawText: input.rawText,
    sanitizedText: null,
    moderationStatus: 'rejected',
    moderationReason: input.detail ? `${input.reason}:${input.detail}` : input.reason,
    telegramChatId: input.telegramChatId,
    telegramMessageId: input.telegramMessageId,
    telegramUpdateId: input.telegramUpdateId
  })

  if (created.duplicate) {
    return {
      status: 'duplicate',
      submissionId: created.submission.id
    }
  }

  return {
    status: 'rejected',
    reason: input.reason,
    ...(input.nextAllowedAt ? { nextAllowedAt: input.nextAllowedAt } : {}),
    ...(input.detail ? { detail: input.detail } : {})
  }
}

export function createAnonymousFeedbackService(
  repository: AnonymousFeedbackRepository
): AnonymousFeedbackService {
  return {
    async submit(input) {
      const member = await repository.getMemberByTelegramUserId(input.telegramUserId)
      if (!member) {
        return {
          status: 'rejected',
          reason: 'not_member'
        }
      }

      const sanitizedText = sanitizeAnonymousText(input.rawText)
      if (sanitizedText.length < MIN_MESSAGE_LENGTH) {
        return rejectSubmission(repository, {
          memberId: member.id,
          rawText: input.rawText,
          reason: 'too_short',
          telegramChatId: input.telegramChatId,
          telegramMessageId: input.telegramMessageId,
          telegramUpdateId: input.telegramUpdateId
        })
      }

      if (sanitizedText.length > MAX_MESSAGE_LENGTH) {
        return rejectSubmission(repository, {
          memberId: member.id,
          rawText: input.rawText,
          reason: 'too_long',
          telegramChatId: input.telegramChatId,
          telegramMessageId: input.telegramMessageId,
          telegramUpdateId: input.telegramUpdateId
        })
      }

      const blockedPhrase = findBlocklistedPhrase(sanitizedText)
      if (blockedPhrase) {
        return rejectSubmission(repository, {
          memberId: member.id,
          rawText: input.rawText,
          reason: 'blocklisted',
          detail: blockedPhrase,
          telegramChatId: input.telegramChatId,
          telegramMessageId: input.telegramMessageId,
          telegramUpdateId: input.telegramUpdateId
        })
      }

      const now = input.now ?? nowInstant()
      const acceptedSince = now.subtract({ hours: 24 })
      const rateLimit = await repository.getRateLimitSnapshot(member.id, acceptedSince)
      const earliestAcceptedAtSince = normalizeInstant(rateLimit.earliestAcceptedAtSince)
      const lastAcceptedAt = normalizeInstant(rateLimit.lastAcceptedAt)

      if (rateLimit.acceptedCountSince >= DAILY_CAP) {
        const nextAllowedAt = earliestAcceptedAtSince?.add({ hours: 24 }) ?? now.add({ hours: 24 })

        return rejectSubmission(repository, {
          memberId: member.id,
          rawText: input.rawText,
          reason: 'daily_cap',
          nextAllowedAt,
          telegramChatId: input.telegramChatId,
          telegramMessageId: input.telegramMessageId,
          telegramUpdateId: input.telegramUpdateId
        })
      }

      if (lastAcceptedAt) {
        const cooldownBoundary = now.subtract({ hours: COOLDOWN_HOURS })
        if (Temporal.Instant.compare(lastAcceptedAt, cooldownBoundary) > 0) {
          return rejectSubmission(repository, {
            memberId: member.id,
            rawText: input.rawText,
            reason: 'cooldown',
            nextAllowedAt: lastAcceptedAt.add({ hours: COOLDOWN_HOURS }),
            telegramChatId: input.telegramChatId,
            telegramMessageId: input.telegramMessageId,
            telegramUpdateId: input.telegramUpdateId
          })
        }
      }

      const created = await repository.createSubmission({
        submittedByMemberId: member.id,
        rawText: input.rawText,
        sanitizedText,
        moderationStatus: 'accepted',
        moderationReason: null,
        telegramChatId: input.telegramChatId,
        telegramMessageId: input.telegramMessageId,
        telegramUpdateId: input.telegramUpdateId
      })

      if (created.duplicate) {
        return {
          status: 'duplicate',
          submissionId: created.submission.id
        }
      }

      return {
        status: 'accepted',
        submissionId: created.submission.id,
        sanitizedText
      }
    },

    markPosted(input) {
      return repository.markPosted({
        submissionId: input.submissionId,
        postedChatId: input.postedChatId,
        postedThreadId: input.postedThreadId,
        postedMessageId: input.postedMessageId,
        postedAt: input.postedAt ?? nowInstant()
      })
    },

    markFailed(submissionId, failureReason) {
      return repository.markFailed(submissionId, failureReason)
    }
  }
}
