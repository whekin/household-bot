import { describe, expect, test } from 'bun:test'

import { Temporal } from '@household/domain'

import { createGcpScheduledDispatchScheduler } from './gcp-scheduled-dispatch-scheduler'

describe('createGcpScheduledDispatchScheduler', () => {
  test('creates Cloud Tasks HTTP tasks for one-shot dispatches', async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = []
    const scheduler = createGcpScheduledDispatchScheduler({
      projectId: 'project-1',
      location: 'europe-west1',
      queue: 'dispatches',
      publicBaseUrl: 'https://bot.example.com',
      sharedSecret: 'secret-1',
      auth: {
        getAccessToken: async () => 'access-token'
      },
      fetchImpl: (async (url, init) => {
        requests.push({
          url: String(url),
          init
        })
        return new Response(JSON.stringify({ name: 'tasks/dispatch-1' }), {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        })
      }) as typeof fetch
    })

    const result = await scheduler.scheduleOneShotDispatch({
      dispatchId: 'dispatch-1',
      dueAt: Temporal.Instant.from('2026-03-24T12:00:00Z')
    })

    expect(result.providerDispatchId).toBe('tasks/dispatch-1')
    expect(requests[0]?.url).toBe(
      'https://cloudtasks.googleapis.com/v2/projects/project-1/locations/europe-west1/queues/dispatches/tasks'
    )
    const payload = JSON.parse(String(requests[0]?.init?.body)) as {
      task: {
        httpRequest: { url: string; headers: Record<string, string> }
        scheduleTime: { seconds: string }
      }
    }
    expect(payload.task.httpRequest.url).toBe('https://bot.example.com/jobs/dispatch/dispatch-1')
    expect(payload.task.httpRequest.headers['x-household-scheduler-secret']).toBe('secret-1')
    expect(payload.task.scheduleTime.seconds).toBe('1774353600')
  })
})
