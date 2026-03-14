import { describe, expect, test } from 'bun:test'

import { fallbackTopicMessageRoute } from './topic-message-router'

describe('fallbackTopicMessageRoute', () => {
  test('returns silent for empty messages', () => {
    const route = fallbackTopicMessageRoute({
      locale: 'en',
      topicRole: 'purchase',
      messageText: '',
      isExplicitMention: false,
      isReplyToBot: false,
      activeWorkflow: null
    })
    expect(route.route).toBe('silent')
    expect(route.reason).toBe('empty')
  })

  test('returns purchase_followup for active purchase clarification workflow', () => {
    const route = fallbackTopicMessageRoute({
      locale: 'en',
      topicRole: 'purchase',
      messageText: 'some message',
      isExplicitMention: false,
      isReplyToBot: false,
      activeWorkflow: 'purchase_clarification'
    })
    expect(route.route).toBe('purchase_followup')
    expect(route.helperKind).toBe('purchase')
  })

  test('returns payment_followup for active payment clarification workflow', () => {
    const route = fallbackTopicMessageRoute({
      locale: 'en',
      topicRole: 'payments',
      messageText: 'some message',
      isExplicitMention: false,
      isReplyToBot: false,
      activeWorkflow: 'payment_clarification'
    })
    expect(route.route).toBe('payment_followup')
    expect(route.helperKind).toBe('payment')
  })

  test('returns payment_followup for active payment confirmation workflow', () => {
    const route = fallbackTopicMessageRoute({
      locale: 'en',
      topicRole: 'payments',
      messageText: 'some message',
      isExplicitMention: false,
      isReplyToBot: false,
      activeWorkflow: 'payment_confirmation'
    })
    expect(route.route).toBe('payment_followup')
    expect(route.helperKind).toBe('payment')
  })

  test('returns topic_helper for strong reference', () => {
    const route = fallbackTopicMessageRoute({
      locale: 'en',
      topicRole: 'generic',
      messageText: 'some message',
      isExplicitMention: false,
      isReplyToBot: false,
      activeWorkflow: null,
      engagementAssessment: {
        engaged: true,
        reason: 'strong_reference',
        strongReference: true,
        weakSessionActive: false,
        hasOpenBotQuestion: false
      }
    })
    expect(route.route).toBe('topic_helper')
    expect(route.helperKind).toBe('assistant')
  })

  test('returns topic_helper for weak session', () => {
    const route = fallbackTopicMessageRoute({
      locale: 'en',
      topicRole: 'generic',
      messageText: 'some message',
      isExplicitMention: false,
      isReplyToBot: false,
      activeWorkflow: null,
      engagementAssessment: {
        engaged: true,
        reason: 'weak_session',
        strongReference: false,
        weakSessionActive: true,
        hasOpenBotQuestion: false
      }
    })
    expect(route.route).toBe('topic_helper')
    expect(route.helperKind).toBe('assistant')
  })

  test('returns topic_helper for explicit mention', () => {
    const route = fallbackTopicMessageRoute({
      locale: 'en',
      topicRole: 'generic',
      messageText: 'some message',
      isExplicitMention: true,
      isReplyToBot: false,
      activeWorkflow: null
    })
    expect(route.route).toBe('topic_helper')
    expect(route.helperKind).toBe('assistant')
  })

  test('returns topic_helper for reply to bot', () => {
    const route = fallbackTopicMessageRoute({
      locale: 'en',
      topicRole: 'generic',
      messageText: 'some message',
      isExplicitMention: false,
      isReplyToBot: true,
      activeWorkflow: null
    })
    expect(route.route).toBe('topic_helper')
    expect(route.helperKind).toBe('assistant')
  })

  test('returns silent by default', () => {
    const route = fallbackTopicMessageRoute({
      locale: 'en',
      topicRole: 'generic',
      messageText: 'some message',
      isExplicitMention: false,
      isReplyToBot: false,
      activeWorkflow: null
    })
    expect(route.route).toBe('silent')
    expect(route.reason).toBe('quiet_default')
  })
})
