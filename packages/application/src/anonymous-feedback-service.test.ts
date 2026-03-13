import { describe, expect, test } from 'bun:test'

import { instantFromIso, type Instant } from '@household/domain'
import type {
  AnonymousFeedbackMemberRecord,
  AnonymousFeedbackRepository,
  AnonymousFeedbackSubmissionRecord
} from '@household/ports'

import { createAnonymousFeedbackService } from './anonymous-feedback-service'

class AnonymousFeedbackRepositoryStub implements AnonymousFeedbackRepository {
  member: AnonymousFeedbackMemberRecord | null = {
    id: 'member-1',
    telegramUserId: '123',
    displayName: 'Stan'
  }

  acceptedCountSince = 0
  earliestAcceptedAtSince: Instant | null = null
  lastAcceptedAt: Instant | null = null
  duplicate = false
  created: Array<{
    rawText: string
    sanitizedText: string | null
    moderationStatus: string
    moderationReason: string | null
  }> = []
  posted: Array<{ submissionId: string; postedThreadId: string; postedMessageId: string }> = []
  failed: Array<{ submissionId: string; failureReason: string }> = []

  async getMemberByTelegramUserId() {
    return this.member
  }

  async getRateLimitSnapshot() {
    return {
      acceptedCountSince: this.acceptedCountSince,
      earliestAcceptedAtSince: this.earliestAcceptedAtSince,
      lastAcceptedAt: this.lastAcceptedAt
    }
  }

  async createSubmission(input: {
    submittedByMemberId: string
    rawText: string
    sanitizedText: string | null
    moderationStatus: 'accepted' | 'posted' | 'rejected' | 'failed'
    moderationReason: string | null
    telegramChatId: string
    telegramMessageId: string
    telegramUpdateId: string
  }): Promise<{ submission: AnonymousFeedbackSubmissionRecord; duplicate: boolean }> {
    this.created.push({
      rawText: input.rawText,
      sanitizedText: input.sanitizedText,
      moderationStatus: input.moderationStatus,
      moderationReason: input.moderationReason
    })

    return {
      submission: {
        id: 'submission-1',
        moderationStatus: input.moderationStatus
      },
      duplicate: this.duplicate
    }
  }

  async markPosted(input: {
    submissionId: string
    postedChatId: string
    postedThreadId: string
    postedMessageId: string
    postedAt: Instant
  }) {
    this.posted.push({
      submissionId: input.submissionId,
      postedThreadId: input.postedThreadId,
      postedMessageId: input.postedMessageId
    })
  }

  async markFailed(submissionId: string, failureReason: string) {
    this.failed.push({ submissionId, failureReason })
  }
}

describe('createAnonymousFeedbackService', () => {
  test('accepts and sanitizes a valid submission', async () => {
    const repository = new AnonymousFeedbackRepositoryStub()
    const service = createAnonymousFeedbackService(repository)

    const result = await service.submit({
      telegramUserId: '123',
      rawText: 'Please clean the kitchen tonight @roommate https://example.com',
      telegramChatId: 'chat-1',
      telegramMessageId: 'message-1',
      telegramUpdateId: 'update-1',
      now: instantFromIso('2026-03-08T12:00:00.000Z')
    })

    expect(result).toEqual({
      status: 'accepted',
      submissionId: 'submission-1',
      sanitizedText: 'Please clean the kitchen tonight [mention removed] [link removed]'
    })
    expect(repository.created[0]).toMatchObject({
      moderationStatus: 'accepted'
    })
  })

  test('rejects non-members before persistence', async () => {
    const repository = new AnonymousFeedbackRepositoryStub()
    repository.member = null
    const service = createAnonymousFeedbackService(repository)

    const result = await service.submit({
      telegramUserId: '404',
      rawText: 'Please wash the dishes tonight',
      telegramChatId: 'chat-1',
      telegramMessageId: 'message-1',
      telegramUpdateId: 'update-1'
    })

    expect(result).toEqual({
      status: 'rejected',
      reason: 'not_member'
    })
    expect(repository.created).toHaveLength(0)
  })

  test('rejects blocklisted content and persists moderation outcome', async () => {
    const repository = new AnonymousFeedbackRepositoryStub()
    const service = createAnonymousFeedbackService(repository)

    const result = await service.submit({
      telegramUserId: '123',
      rawText: 'You are an idiot and this is disgusting',
      telegramChatId: 'chat-1',
      telegramMessageId: 'message-1',
      telegramUpdateId: 'update-1'
    })

    expect(result).toEqual({
      status: 'rejected',
      reason: 'blocklisted',
      detail: 'idiot'
    })
    expect(repository.created[0]).toMatchObject({
      moderationStatus: 'rejected',
      moderationReason: 'blocklisted:idiot'
    })
  })

  test('enforces cooldown and daily cap', async () => {
    const repository = new AnonymousFeedbackRepositoryStub()
    const service = createAnonymousFeedbackService(repository)

    repository.lastAcceptedAt = instantFromIso('2026-03-08T09:00:00.000Z')

    const cooldownResult = await service.submit({
      telegramUserId: '123',
      rawText: 'Please take the trash out tonight',
      telegramChatId: 'chat-1',
      telegramMessageId: 'message-1',
      telegramUpdateId: 'update-1',
      now: instantFromIso('2026-03-08T12:00:00.000Z')
    })

    expect(cooldownResult).toEqual({
      status: 'rejected',
      reason: 'cooldown',
      nextAllowedAt: instantFromIso('2026-03-08T15:00:00.000Z')
    })

    repository.earliestAcceptedAtSince = instantFromIso('2026-03-07T18:00:00.000Z')
    repository.lastAcceptedAt = instantFromIso('2026-03-07T23:00:00.000Z')
    repository.acceptedCountSince = 3

    const dailyCapResult = await service.submit({
      telegramUserId: '123',
      rawText: 'Please ventilate the bathroom after showers',
      telegramChatId: 'chat-1',
      telegramMessageId: 'message-2',
      telegramUpdateId: 'update-2',
      now: instantFromIso('2026-03-08T12:00:00.000Z')
    })

    expect(dailyCapResult).toEqual({
      status: 'rejected',
      reason: 'daily_cap',
      nextAllowedAt: instantFromIso('2026-03-08T18:00:00.000Z')
    })
  })

  test('normalizes legacy date-like rate limit values before cooldown checks', async () => {
    const repository = new AnonymousFeedbackRepositoryStub()
    const service = createAnonymousFeedbackService(repository)

    ;(repository.lastAcceptedAt as Instant | null | string) = '2026-03-08T09:00:00.000Z'
    ;(repository.earliestAcceptedAtSince as Instant | null | Date) = new Date(
      '2026-03-08T09:00:00.000Z'
    )

    const result = await service.submit({
      telegramUserId: '123',
      rawText: 'Please take the trash out tonight',
      telegramChatId: 'chat-1',
      telegramMessageId: 'message-1',
      telegramUpdateId: 'update-1',
      now: instantFromIso('2026-03-08T12:00:00.000Z')
    })

    expect(result).toEqual({
      status: 'rejected',
      reason: 'cooldown',
      nextAllowedAt: instantFromIso('2026-03-08T15:00:00.000Z')
    })
  })

  test('marks posted and failed submissions', async () => {
    const repository = new AnonymousFeedbackRepositoryStub()
    const service = createAnonymousFeedbackService(repository)

    await service.markPosted({
      submissionId: 'submission-1',
      postedChatId: 'group-1',
      postedThreadId: 'thread-1',
      postedMessageId: 'post-1'
    })
    await service.markFailed('submission-2', 'telegram send failed')

    expect(repository.posted).toEqual([
      {
        submissionId: 'submission-1',
        postedThreadId: 'thread-1',
        postedMessageId: 'post-1'
      }
    ])
    expect(repository.failed).toEqual([
      {
        submissionId: 'submission-2',
        failureReason: 'telegram send failed'
      }
    ])
  })
})
