import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'

const server = {
  DATABASE_URL: z.string().url(),
  E2E_SMOKE_ALLOW_WRITE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true')
}

export const e2eEnv = createEnv({
  server,
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
  onValidationError: (issues) => {
    console.error('Invalid e2e environment variables:')
    console.error(JSON.stringify(issues, null, 2))
    throw new Error('E2E environment validation failed')
  }
})
