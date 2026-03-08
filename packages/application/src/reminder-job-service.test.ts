import { describe, expect, test } from 'bun:test'

import type {
  ClaimReminderDispatchInput,
  ClaimReminderDispatchResult,
  ReminderDispatchRepository
} from '@household/ports'

import { createReminderJobService } from './reminder-job-service'

class ReminderDispatchRepositoryStub implements ReminderDispatchRepository {
  nextResult: ClaimReminderDispatchResult = {
    dedupeKey: '2026-03:utilities',
    claimed: true
  }

  lastClaim: ClaimReminderDispatchInput | null = null

  async claimReminderDispatch(
    input: ClaimReminderDispatchInput
  ): Promise<ClaimReminderDispatchResult> {
    this.lastClaim = input
    return this.nextResult
  }
}

describe('createReminderJobService', () => {
  test('returns dry-run result without touching the repository', async () => {
    const repository = new ReminderDispatchRepositoryStub()
    const service = createReminderJobService(repository)

    const result = await service.handleJob({
      householdId: 'household-1',
      period: '2026-03',
      reminderType: 'utilities',
      dryRun: true
    })

    expect(result.status).toBe('dry-run')
    expect(result.dedupeKey).toBe('2026-03:utilities')
    expect(result.messageText).toBe('Utilities reminder for 2026-03')
    expect(repository.lastClaim).toBeNull()
  })

  test('claims a dispatch once and returns the dedupe key', async () => {
    const repository = new ReminderDispatchRepositoryStub()
    const service = createReminderJobService(repository)

    const result = await service.handleJob({
      householdId: 'household-1',
      period: '2026-03',
      reminderType: 'rent-due'
    })

    expect(result.status).toBe('claimed')
    expect(repository.lastClaim).toMatchObject({
      householdId: 'household-1',
      period: '2026-03',
      reminderType: 'rent-due'
    })
  })

  test('returns duplicate when the repository rejects a replay', async () => {
    const repository = new ReminderDispatchRepositoryStub()
    repository.nextResult = {
      dedupeKey: '2026-03:rent-warning',
      claimed: false
    }

    const service = createReminderJobService(repository)
    const result = await service.handleJob({
      householdId: 'household-1',
      period: '2026-03',
      reminderType: 'rent-warning'
    })

    expect(result.status).toBe('duplicate')
    expect(result.dedupeKey).toBe('2026-03:rent-warning')
  })
})
