import type { Context } from 'grammy'

import type { BotLocale } from '../i18n'
import {
  cacheTopicMessageRoute,
  fallbackTopicMessageRoute,
  type TopicWorkflowState
} from '../topic-message-router'

export type ConfiguredTopicFallbackRole = 'purchase' | 'payments'

export function cacheConfiguredTopicFallbackRoute(input: {
  ctx: Context
  locale: BotLocale
  topicRole: ConfiguredTopicFallbackRole
  messageText: string
  isExplicitMention: boolean
  isReplyToBot: boolean
  activeWorkflow: TopicWorkflowState
}): void {
  cacheTopicMessageRoute(
    input.ctx,
    input.topicRole,
    fallbackTopicMessageRoute({
      locale: input.locale,
      topicRole: input.topicRole,
      messageText: input.messageText,
      isExplicitMention: input.isExplicitMention,
      isReplyToBot: input.isReplyToBot,
      activeWorkflow: input.activeWorkflow
    })
  )
}
