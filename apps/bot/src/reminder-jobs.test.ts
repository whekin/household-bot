import { describe, expect, mock, test } from 'bun:test'

import type { ReminderJobResult, ReminderJobService } from '@household/application'

import { createReminderJobsHandler } from './reminder-jobs'

describe('createReminderJobsHandler', () => {
  test('returns job outcome with dedupe metadata', async () => {
    const claimedResult: ReminderJobResult = {
      status: 'claimed',
      dedupeKey: '2026-03:utilities',
      payloadHash: 'hash',
      reminderType: 'utilities',
      period: '2026-03',
      messageText: 'Utilities reminder for 2026-03'
    }

    const reminderService: ReminderJobService = {
      handleJob: mock(async () => claimedResult)
    }

    const handler = createReminderJobsHandler({
      householdId: 'household-1',
      reminderService
    })

    const response = await handler.handle(
      new Request('http://localhost/jobs/reminder/utilities', {
        method: 'POST',
        body: JSON.stringify({
          period: '2026-03',
          jobId: 'job-1'
        })
      }),
      'utilities'
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      jobId: 'job-1',
      reminderType: 'utilities',
      period: '2026-03',
      dedupeKey: '2026-03:utilities',
      outcome: 'claimed',
      dryRun: false,
      messageText: 'Utilities reminder for 2026-03'
    })
  })

  test('supports forced dry-run mode', async () => {
    const dryRunResult: ReminderJobResult = {
      status: 'dry-run',
      dedupeKey: '2026-03:rent-warning',
      payloadHash: 'hash',
      reminderType: 'rent-warning',
      period: '2026-03',
      messageText: 'Rent reminder for 2026-03: payment is coming up soon.'
    }

    const reminderService: ReminderJobService = {
      handleJob: mock(async () => dryRunResult)
    }

    const handler = createReminderJobsHandler({
      householdId: 'household-1',
      reminderService,
      forceDryRun: true
    })

    const response = await handler.handle(
      new Request('http://localhost/jobs/reminder/rent-warning', {
        method: 'POST',
        body: JSON.stringify({ period: '2026-03', jobId: 'job-2' })
      }),
      'rent-warning'
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      outcome: 'dry-run',
      dryRun: true
    })
  })

  test('rejects unsupported reminder type', async () => {
    const handler = createReminderJobsHandler({
      householdId: 'household-1',
      reminderService: {
        handleJob: mock(async () => {
          throw new Error('should not be called')
        })
      }
    })

    const response = await handler.handle(
      new Request('http://localhost/jobs/reminder/unknown', {
        method: 'POST',
        body: JSON.stringify({ period: '2026-03' })
      }),
      'unknown'
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      ok: false,
      error: 'Invalid reminder type'
    })
  })
})
