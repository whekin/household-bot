import { OAuth2Client } from 'google-auth-library'

interface IdTokenPayload {
  email?: string
  email_verified?: boolean
}

interface IdTokenTicket {
  getPayload(): IdTokenPayload | undefined
}

export interface IdTokenVerifier {
  verifyIdToken(input: { idToken: string; audience: string }): Promise<IdTokenTicket>
}

const DEFAULT_VERIFIER: IdTokenVerifier = new OAuth2Client()

function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')

  if (!header?.startsWith('Bearer ')) {
    return null
  }

  const token = header.slice('Bearer '.length).trim()
  return token.length > 0 ? token : null
}

export function createSchedulerRequestAuthorizer(options: {
  sharedSecret?: string
  oidcAudience?: string
  oidcAllowedEmails?: readonly string[]
  verifier?: IdTokenVerifier
}): {
  authorize: (request: Request) => Promise<boolean>
} {
  const sharedSecret = options.sharedSecret?.trim()
  const oidcAudience = options.oidcAudience?.trim()
  const allowedEmails = new Set(
    (options.oidcAllowedEmails ?? []).map((email) => email.trim()).filter(Boolean)
  )
  const verifier = options.verifier ?? DEFAULT_VERIFIER

  return {
    authorize: async (request) => {
      const customHeader = request.headers.get('x-household-scheduler-secret')
      if (sharedSecret && customHeader === sharedSecret) {
        return true
      }

      const token = bearerToken(request)
      if (!token) {
        return false
      }

      if (sharedSecret && token === sharedSecret) {
        return true
      }

      if (allowedEmails.size === 0) {
        return false
      }

      try {
        const audience = oidcAudience ?? new URL(request.url).origin
        const ticket = await verifier.verifyIdToken({
          idToken: token,
          audience
        })
        const payload = ticket.getPayload()
        const email = payload?.email?.trim()

        return payload?.email_verified === true && email !== undefined && allowedEmails.has(email)
      } catch {
        return false
      }
    }
  }
}
