import { describe, expect, mock, test } from 'bun:test'

import type { ReminderJobResult, ReminderJobService } from '@household/application'
import type { ReminderTarget } from '@household/ports'

import { createReminderJobsHandler } from './reminder-jobs'

const target: ReminderTarget = {
  householdId: 'household-1',
  householdName: 'Kojori House',
  telegramChatId: '-1001',
  telegramThreadId: '12',
  locale: 'ru'
}

describe('createReminderJobsHandler', () => {
  test('returns per-household dispatch outcome with Telegram delivery metadata', async () => {
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
    const sendReminderMessage = mock(async () => {})

    const handler = createReminderJobsHandler({
      listReminderTargets: async () => [target],
      releaseReminderDispatch: mock(async () => {}),
      sendReminderMessage,
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

    expect(sendReminderMessage).toHaveBeenCalledTimes(1)
    expect(sendReminderMessage).toHaveBeenCalledWith(
      target,
      'Напоминание по коммунальным платежам за 2026-03'
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      jobId: 'job-1',
      reminderType: 'utilities',
      period: '2026-03',
      dryRun: false,
      totals: {
        targets: 1,
        claimed: 1,
        duplicate: 0,
        'dry-run': 0,
        failed: 0
      },
      dispatches: [
        {
          householdId: 'household-1',
          householdName: 'Kojori House',
          telegramChatId: '-1001',
          telegramThreadId: '12',
          dedupeKey: '2026-03:utilities',
          outcome: 'claimed',
          messageText: 'Напоминание по коммунальным платежам за 2026-03'
        }
      ]
    })
  })

  test('supports forced dry-run mode without posting to Telegram', async () => {
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
    const sendReminderMessage = mock(async () => {})

    const handler = createReminderJobsHandler({
      listReminderTargets: async () => [target],
      releaseReminderDispatch: mock(async () => {}),
      sendReminderMessage,
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

    expect(sendReminderMessage).toHaveBeenCalledTimes(0)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      dryRun: true,
      totals: {
        targets: 1,
        claimed: 0,
        duplicate: 0,
        'dry-run': 1,
        failed: 0
      }
    })
  })

  test('releases a dispatch claim when Telegram delivery fails', async () => {
    const failedResult: ReminderJobResult = {
      status: 'claimed',
      dedupeKey: '2026-03:rent-due',
      payloadHash: 'hash',
      reminderType: 'rent-due',
      period: '2026-03',
      messageText: 'Rent due reminder for 2026-03: please settle payment today.'
    }
    const reminderService: ReminderJobService = {
      handleJob: mock(async () => failedResult)
    }
    const releaseReminderDispatch = mock(async () => {})

    const handler = createReminderJobsHandler({
      listReminderTargets: async () => [target],
      releaseReminderDispatch,
      sendReminderMessage: mock(async () => {
        throw new Error('Telegram unavailable')
      }),
      reminderService
    })

    const response = await handler.handle(
      new Request('http://localhost/jobs/reminder/rent-due', {
        method: 'POST',
        body: JSON.stringify({ period: '2026-03' })
      }),
      'rent-due'
    )

    expect(releaseReminderDispatch).toHaveBeenCalledWith({
      householdId: 'household-1',
      period: '2026-03',
      reminderType: 'rent-due'
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      totals: {
        failed: 1
      },
      dispatches: [
        expect.objectContaining({
          outcome: 'failed',
          error: 'Telegram unavailable'
        })
      ]
    })
  })

  test('rejects unsupported reminder type', async () => {
    const handler = createReminderJobsHandler({
      listReminderTargets: async () => [target],
      releaseReminderDispatch: mock(async () => {}),
      sendReminderMessage: mock(async () => {}),
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
