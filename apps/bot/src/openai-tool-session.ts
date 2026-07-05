import type { AssistantUsage } from './openai-chat-assistant'

const DEFAULT_MAX_ITERATIONS = 6
const DEFAULT_MAX_OUTPUT_TOKENS = 700

export interface ToolSessionToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ToolSessionToolResult {
  result: unknown
  /** Set when the tool already posted a Telegram card; final agent prose is dropped. */
  cardPosted?: boolean
}

export type ToolSessionExecutor = (call: {
  name: string
  arguments: Record<string, unknown>
}) => Promise<ToolSessionToolResult>

export interface ToolSessionResult {
  text: string | null
  cardPosted: boolean
  toolCallCount: number
  usage: AssistantUsage
}

interface OpenAiOutputItem {
  type?: string
  name?: string
  call_id?: string
  arguments?: string
  content?: readonly { type?: string; text?: string }[]
}

interface OpenAiToolResponsePayload {
  output?: readonly OpenAiOutputItem[]
  output_text?: string | null
  usage?: {
    input_tokens?: number
    output_tokens?: number
    total_tokens?: number
  }
}

function extractOutputText(payload: OpenAiToolResponsePayload): string | null {
  const direct = payload.output_text?.trim()
  if (direct) {
    return direct
  }

  const text = (payload.output ?? [])
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? [])
    .filter((content) => content.type === 'output_text' && typeof content.text === 'string')
    .map((content) => content.text!.trim())
    .filter((value) => value.length > 0)
    .join('\n')

  return text.length > 0 ? text : null
}

function parseToolArguments(raw: string | undefined): Record<string, unknown> | null {
  if (!raw) {
    return {}
  }

  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

export async function runToolSession(input: {
  apiKey: string
  model: string
  timeoutMs: number
  systemPrompt: string
  contextPrompt: string
  userMessage: string
  tools: readonly ToolSessionToolDefinition[]
  executeTool: ToolSessionExecutor
  maxIterations?: number
  maxOutputTokens?: number
  logger?: {
    info: (obj: unknown, msg?: string) => void
    warn: (obj: unknown, msg?: string) => void
    error: (obj: unknown, msg?: string) => void
  }
}): Promise<ToolSessionResult> {
  const maxIterations = input.maxIterations ?? DEFAULT_MAX_ITERATIONS
  const usage: AssistantUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  const conversation: unknown[] = [
    { type: 'message', role: 'system', content: input.systemPrompt },
    { type: 'message', role: 'system', content: input.contextPrompt },
    { type: 'message', role: 'user', content: input.userMessage }
  ]
  const toolDefinitions = input.tools.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: false
  }))

  let cardPosted = false
  let toolCallCount = 0

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const abortController = new AbortController()
    const timeout = setTimeout(() => abortController.abort(), input.timeoutMs)

    let payload: OpenAiToolResponsePayload
    try {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        signal: abortController.signal,
        headers: {
          authorization: `Bearer ${input.apiKey}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: input.model,
          reasoning: { effort: 'low' },
          max_output_tokens: input.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
          input: conversation,
          tools: toolDefinitions
        })
      })

      if (!response.ok) {
        const errorBody = await response.text()
        throw new Error(`Tool session request failed with status ${response.status}: ${errorBody}`)
      }

      payload = (await response.json()) as OpenAiToolResponsePayload
    } finally {
      clearTimeout(timeout)
    }

    usage.inputTokens += payload.usage?.input_tokens ?? 0
    usage.outputTokens += payload.usage?.output_tokens ?? 0
    usage.totalTokens += payload.usage?.total_tokens ?? 0

    const functionCalls = (payload.output ?? []).filter(
      (item) => item.type === 'function_call' && typeof item.name === 'string'
    )

    if (functionCalls.length === 0) {
      return {
        text: extractOutputText(payload),
        cardPosted,
        toolCallCount,
        usage
      }
    }

    for (const item of payload.output ?? []) {
      if (item.type === 'function_call' || item.type === 'reasoning' || item.type === 'message') {
        conversation.push(item)
      }
    }

    for (const call of functionCalls) {
      toolCallCount += 1
      const parsedArguments = parseToolArguments(call.arguments)
      let output: unknown

      if (parsedArguments === null) {
        output = { error: 'invalid_arguments_json' }
      } else {
        try {
          const executed = await input.executeTool({
            name: call.name!,
            arguments: parsedArguments
          })
          output = executed.result
          cardPosted = cardPosted || executed.cardPosted === true
        } catch (error) {
          input.logger?.error(
            { event: 'tool_session.tool_failed', tool: call.name, error },
            'Agent tool execution failed'
          )
          output = { error: 'tool_execution_failed' }
        }
      }

      conversation.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output: JSON.stringify(output)
      })
    }
  }

  input.logger?.warn(
    { event: 'tool_session.max_iterations', toolCallCount },
    'Agent tool session hit iteration limit'
  )

  return {
    text: null,
    cardPosted,
    toolCallCount,
    usage
  }
}
