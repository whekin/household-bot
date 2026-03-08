export type AnonymousFeedbackModerationStatus = 'accepted' | 'posted' | 'rejected' | 'failed'

export type AnonymousFeedbackRejectionReason =
  | 'not_member'
  | 'too_short'
  | 'too_long'
  | 'cooldown'
  | 'daily_cap'
  | 'blocklisted'

export interface AnonymousFeedbackMemberRecord {
  id: string
  telegramUserId: string
  displayName: string
}

export interface AnonymousFeedbackRateLimitSnapshot {
  acceptedCountSince: number
  lastAcceptedAt: Date | null
}

export interface AnonymousFeedbackSubmissionRecord {
  id: string
  moderationStatus: AnonymousFeedbackModerationStatus
}

export interface AnonymousFeedbackRepository {
  getMemberByTelegramUserId(telegramUserId: string): Promise<AnonymousFeedbackMemberRecord | null>
  getRateLimitSnapshot(
    memberId: string,
    acceptedSince: Date
  ): Promise<AnonymousFeedbackRateLimitSnapshot>
  createSubmission(input: {
    submittedByMemberId: string
    rawText: string
    sanitizedText: string | null
    moderationStatus: AnonymousFeedbackModerationStatus
    moderationReason: string | null
    telegramChatId: string
    telegramMessageId: string
    telegramUpdateId: string
  }): Promise<{ submission: AnonymousFeedbackSubmissionRecord; duplicate: boolean }>
  markPosted(input: {
    submissionId: string
    postedChatId: string
    postedThreadId: string
    postedMessageId: string
    postedAt: Date
  }): Promise<void>
  markFailed(submissionId: string, failureReason: string): Promise<void>
}
