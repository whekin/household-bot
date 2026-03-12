import type { Logger } from '@household/observability'

import type { ConversationalAssistant } from './openai-chat-assistant'
import type { TopicMessageRole } from './topic-message-router'

export async function composeAssistantReplyText(input: {
  assistant: ConversationalAssistant | undefined
  locale: 'en' | 'ru'
  topicRole: TopicMessageRole
  householdContext: string
  userMessage: string
  recentTurns: readonly {
    role: 'user' | 'assistant'
    text: string
  }[]
  recentThreadMessages?: readonly {
    role: 'user' | 'assistant'
    speaker: string
    text: string
    threadId: string | null
  }[]
  recentChatMessages?: readonly {
    role: 'user' | 'assistant'
    speaker: string
    text: string
    threadId: string | null
  }[]
  authoritativeFacts?: readonly string[]
  responseInstructions?: string | null
  fallbackText: string
  logger: Logger | undefined
  logEvent: string
}): Promise<string> {
  if (!input.assistant) {
    return input.fallbackText
  }

  const logger = input.logger

  try {
    const responseInput: Parameters<ConversationalAssistant['respond']>[0] = {
      locale: input.locale,
      topicRole: input.topicRole,
      householdContext: input.householdContext,
      memorySummary: null,
      recentTurns: input.recentTurns,
      userMessage: input.userMessage
    }

    if (input.authoritativeFacts) {
      responseInput.authoritativeFacts = input.authoritativeFacts
    }

    if (input.recentThreadMessages) {
      responseInput.recentThreadMessages = input.recentThreadMessages
    }

    if (input.recentChatMessages) {
      responseInput.sameDayChatMessages = input.recentChatMessages
    }

    if (input.responseInstructions) {
      responseInput.responseInstructions = input.responseInstructions
    }

    const reply = await input.assistant.respond(responseInput)

    return reply.text
  } catch (error) {
    logger?.warn(
      {
        event: input.logEvent,
        error
      },
      'Assistant-composed reply failed, falling back'
    )
    return input.fallbackText
  }
}
