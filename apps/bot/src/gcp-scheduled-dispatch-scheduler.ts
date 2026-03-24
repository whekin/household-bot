import { GoogleAuth } from 'google-auth-library'

import type {
  ScheduleOneShotDispatchInput,
  ScheduleOneShotDispatchResult,
  ScheduledDispatchScheduler
} from '@household/ports'

function scheduleTimestamp(input: ScheduleOneShotDispatchInput): {
  seconds: string
  nanos: number
} {
  const milliseconds = input.dueAt.epochMilliseconds
  const seconds = Math.floor(milliseconds / 1000)
  return {
    seconds: String(seconds),
    nanos: (milliseconds - seconds * 1000) * 1_000_000
  }
}

function callbackUrl(baseUrl: string, dispatchId: string): string {
  return `${baseUrl.replace(/\/$/, '')}/jobs/dispatch/${dispatchId}`
}

export function createGcpScheduledDispatchScheduler(input: {
  projectId: string
  location: string
  queue: string
  publicBaseUrl: string
  sharedSecret: string
  auth?: Pick<GoogleAuth, 'getAccessToken'>
  fetchImpl?: typeof fetch
}): ScheduledDispatchScheduler {
  const auth =
    input.auth ??
    new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform']
    })
  const fetchImpl = input.fetchImpl ?? fetch

  async function authorizedHeaders() {
    const accessToken = await auth.getAccessToken()
    if (!accessToken) {
      throw new Error('Failed to acquire Google Cloud access token for scheduled dispatch')
    }
    const token =
      typeof accessToken === 'string'
        ? accessToken
        : ((accessToken as { token?: string }).token ?? null)
    if (!token) {
      throw new Error('Failed to read Google Cloud access token for scheduled dispatch')
    }

    return {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    }
  }

  return {
    provider: 'gcp-cloud-tasks',

    async scheduleOneShotDispatch(dispatchInput): Promise<ScheduleOneShotDispatchResult> {
      const response = await fetchImpl(
        `https://cloudtasks.googleapis.com/v2/projects/${input.projectId}/locations/${input.location}/queues/${input.queue}/tasks`,
        {
          method: 'POST',
          headers: await authorizedHeaders(),
          body: JSON.stringify({
            task: {
              scheduleTime: scheduleTimestamp(dispatchInput),
              httpRequest: {
                httpMethod: 'POST',
                url: callbackUrl(input.publicBaseUrl, dispatchInput.dispatchId),
                headers: {
                  'content-type': 'application/json',
                  'x-household-scheduler-secret': input.sharedSecret
                },
                body: Buffer.from(
                  JSON.stringify({
                    dispatchId: dispatchInput.dispatchId
                  })
                ).toString('base64')
              }
            }
          })
        }
      )

      if (!response.ok) {
        throw new Error(`Cloud Tasks create task failed with status ${response.status}`)
      }

      const payload = (await response.json()) as { name?: string }
      if (!payload.name) {
        throw new Error('Cloud Tasks create task response did not include a task name')
      }

      return {
        providerDispatchId: payload.name
      }
    },

    async cancelDispatch(providerDispatchId) {
      const response = await fetchImpl(
        `https://cloudtasks.googleapis.com/v2/${providerDispatchId}`,
        {
          method: 'DELETE',
          headers: await authorizedHeaders()
        }
      )

      if (response.status === 404) {
        return
      }

      if (!response.ok) {
        throw new Error(`Cloud Tasks delete task failed with status ${response.status}`)
      }
    }
  }
}
