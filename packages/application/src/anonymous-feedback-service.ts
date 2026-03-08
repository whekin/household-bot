import type {
  AnonymousFeedbackRejectionReason,
  AnonymousFeedbackRepository
} from '@household/ports'

const MIN_MESSAGE_LENGTH = 12
const MAX_MESSAGE_LENGTH = 500
const COOLDOWN_HOURS = 6
const DAILY_CAP = 3
const BLOCKLIST = ['kill yourself', 'сука', 'тварь', 'идиот', 'idiot', 'hate you'] as const

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
    }

export interface AnonymousFeedbackService {
  submit(input: {
    telegramUserId: string
    rawText: string
    telegramChatId: string
    telegramMessageId: string
    telegramUpdateId: string
    now?: Date
  }): Promise<AnonymousFeedbackSubmitResult>
  markPosted(input: {
    submissionId: string
    postedChatId: string
    postedThreadId: string
    postedMessageId: string
    postedAt?: Date
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

      const now = input.now ?? new Date()
      const acceptedSince = new Date(now.getTime() - 24 * 60 * 60 * 1000)
      const rateLimit = await repository.getRateLimitSnapshot(member.id, acceptedSince)
      if (rateLimit.acceptedCountSince >= DAILY_CAP) {
        return rejectSubmission(repository, {
          memberId: member.id,
          rawText: input.rawText,
          reason: 'daily_cap',
          telegramChatId: input.telegramChatId,
          telegramMessageId: input.telegramMessageId,
          telegramUpdateId: input.telegramUpdateId
        })
      }

      if (rateLimit.lastAcceptedAt) {
        const cooldownBoundary = now.getTime() - COOLDOWN_HOURS * 60 * 60 * 1000
        if (rateLimit.lastAcceptedAt.getTime() > cooldownBoundary) {
          return rejectSubmission(repository, {
            memberId: member.id,
            rawText: input.rawText,
            reason: 'cooldown',
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
        postedAt: input.postedAt ?? new Date()
      })
    },

    markFailed(submissionId, failureReason) {
      return repository.markFailed(submissionId, failureReason)
    }
  }
}
