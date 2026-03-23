import { getLogger } from '@household/observability'

import { createBotRuntimeApp } from './app'
import {
  handleLambdaFunctionUrlEvent,
  type LambdaFunctionUrlRequest,
  type LambdaFunctionUrlResponse
} from './lambda-adapter'

const appPromise = createBotRuntimeApp()
const logger = getLogger('lambda')

export async function handler(event: LambdaFunctionUrlRequest): Promise<LambdaFunctionUrlResponse> {
  const app = await appPromise
  return handleLambdaFunctionUrlEvent(event, app.fetch)
}

async function postRuntimeResponse(
  requestId: string,
  response: LambdaFunctionUrlResponse
): Promise<void> {
  const runtimeApi = process.env.AWS_LAMBDA_RUNTIME_API
  if (!runtimeApi) {
    throw new Error('AWS_LAMBDA_RUNTIME_API environment variable is required')
  }

  await fetch(`http://${runtimeApi}/2018-06-01/runtime/invocation/${requestId}/response`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(response)
  })
}

async function postRuntimeError(requestId: string, error: unknown): Promise<void> {
  const runtimeApi = process.env.AWS_LAMBDA_RUNTIME_API
  if (!runtimeApi) {
    throw new Error('AWS_LAMBDA_RUNTIME_API environment variable is required')
  }

  const message = error instanceof Error ? error.message : 'Unknown Lambda runtime error'

  await fetch(`http://${runtimeApi}/2018-06-01/runtime/invocation/${requestId}/error`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      errorMessage: message,
      errorType: error instanceof Error ? error.name : 'Error'
    })
  })
}

async function runtimeLoop(): Promise<void> {
  const runtimeApi = process.env.AWS_LAMBDA_RUNTIME_API
  if (!runtimeApi) {
    throw new Error('AWS_LAMBDA_RUNTIME_API environment variable is required')
  }

  logger.info(
    {
      event: 'runtime.started',
      mode: 'lambda'
    },
    'Bot Lambda runtime started'
  )

  while (true) {
    const invocation = await fetch(`http://${runtimeApi}/2018-06-01/runtime/invocation/next`)
    const requestId = invocation.headers.get('lambda-runtime-aws-request-id')

    if (!requestId) {
      throw new Error('Lambda runtime response did not include a request id')
    }

    try {
      const event = (await invocation.json()) as LambdaFunctionUrlRequest
      const response = await handler(event)
      await postRuntimeResponse(requestId, response)
    } catch (error) {
      await postRuntimeError(requestId, error)
    }
  }
}

if (import.meta.main) {
  void runtimeLoop()
}
