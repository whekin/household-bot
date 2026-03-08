import { describe, expect, test } from 'bun:test'

import { createSchedulerRequestAuthorizer, type IdTokenVerifier } from './scheduler-auth'

describe('createSchedulerRequestAuthorizer', () => {
  test('accepts matching shared secret header', async () => {
    const authorizer = createSchedulerRequestAuthorizer({
      sharedSecret: 'secret'
    })

    const authorized = await authorizer.authorize(
      new Request('http://localhost/jobs/reminder/utilities', {
        headers: {
          'x-household-scheduler-secret': 'secret'
        }
      })
    )

    expect(authorized).toBe(true)
  })

  test('accepts verified oidc token from an allowed service account', async () => {
    const verifier: IdTokenVerifier = {
      verifyIdToken: async () => ({
        getPayload: () => ({
          email: 'dev-scheduler@example.iam.gserviceaccount.com',
          email_verified: true
        })
      })
    }

    const authorizer = createSchedulerRequestAuthorizer({
      oidcAudience: 'https://household-dev-bot-api.run.app',
      oidcAllowedEmails: ['dev-scheduler@example.iam.gserviceaccount.com'],
      verifier
    })

    const authorized = await authorizer.authorize(
      new Request('http://localhost/jobs/reminder/utilities', {
        headers: {
          authorization: 'Bearer signed-id-token'
        }
      })
    )

    expect(authorized).toBe(true)
  })

  test('rejects oidc token from an unexpected service account', async () => {
    const verifier: IdTokenVerifier = {
      verifyIdToken: async () => ({
        getPayload: () => ({
          email: 'someone-else@example.iam.gserviceaccount.com',
          email_verified: true
        })
      })
    }

    const authorizer = createSchedulerRequestAuthorizer({
      oidcAudience: 'https://household-dev-bot-api.run.app',
      oidcAllowedEmails: ['dev-scheduler@example.iam.gserviceaccount.com'],
      verifier
    })

    const authorized = await authorizer.authorize(
      new Request('http://localhost/jobs/reminder/utilities', {
        headers: {
          authorization: 'Bearer signed-id-token'
        }
      })
    )

    expect(authorized).toBe(false)
  })
})
