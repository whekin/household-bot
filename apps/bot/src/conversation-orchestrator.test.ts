import { describe, expect, test } from 'bun:test'

import { instantFromIso } from '@household/domain'
import type { TopicMessageHistoryRecord, TopicMessageHistoryRepository } from '@household/ports'

import { createInMemoryAssistantConversationMemoryStore } from './assistant-state'
import { buildConversationContext } from './conversation-orchestrator'

function createTopicMessageHistoryRepository(
  rows: readonly TopicMessageHistoryRecord[]
): TopicMessageHistoryRepository {
  return {
    async saveMessage() {},
    async listRecentThreadMessages(input) {
      return rows
        .filter(
          (row) =>
            row.householdId === input.householdId &&
            row.telegramChatId === input.telegramChatId &&
            row.telegramThreadId === input.telegramThreadId
        )
        .slice(-input.limit)
    },
    async listRecentChatMessages(input) {
      return rows
        .filter(
          (row) =>
            row.householdId === input.householdId &&
            row.telegramChatId === input.telegramChatId &&
            row.messageSentAt !== null &&
            row.messageSentAt.epochMilliseconds >= input.sentAtOrAfter.epochMilliseconds
        )
        .slice(-input.limit)
    }
  }
}

function historyRecord(
  rawText: string,
  overrides: Partial<TopicMessageHistoryRecord> = {}
): TopicMessageHistoryRecord {
  return {
    householdId: 'household-1',
    telegramChatId: '-100123',
    telegramThreadId: '777',
    telegramMessageId: '1',
    telegramUpdateId: '1',
    senderTelegramUserId: overrides.isBot ? '999000' : '123456',
    senderDisplayName: overrides.isBot ? 'Kojori Bot' : 'Stas',
    isBot: false,
    rawText,
    messageSentAt: instantFromIso('2026-03-12T12:00:00.000Z'),
    ...overrides
  }
}

async function buildTestContext(input: {
  repositoryRows: readonly TopicMessageHistoryRecord[]
  messageText: string
  explicitMention?: boolean
  replyToBot?: boolean
  directBotAddress?: boolean
  referenceInstant?: ReturnType<typeof instantFromIso>
}) {
  const contextInput: Parameters<typeof buildConversationContext>[0] = {
    repository: createTopicMessageHistoryRepository(input.repositoryRows),
    householdId: 'household-1',
    telegramChatId: '-100123',
    telegramThreadId: '777',
    telegramUserId: '123456',
    topicRole: 'generic',
    activeWorkflow: null,
    messageText: input.messageText,
    explicitMention: input.explicitMention ?? false,
    replyToBot: input.replyToBot ?? false,
    directBotAddress: input.directBotAddress ?? false,
    memoryStore: createInMemoryAssistantConversationMemoryStore(12)
  }

  if (input.referenceInstant) {
    contextInput.referenceInstant = input.referenceInstant
  }

  return buildConversationContext(contextInput)
}

describe('buildConversationContext', () => {
  test('keeps reply-to-bot engagement even after the weak-session ttl', async () => {
    const context = await buildTestContext({
      repositoryRows: [
        historyRecord('Какую именно рыбу ты хочешь купить?', {
          isBot: true,
          senderTelegramUserId: '999000',
          senderDisplayName: 'Kojori Bot',
          messageSentAt: instantFromIso('2026-03-12T11:20:00.000Z')
        })
      ],
      messageText: 'Лосось',
      replyToBot: true,
      referenceInstant: instantFromIso('2026-03-12T12:00:00.000Z')
    })

    expect(context.engagement).toMatchObject({
      engaged: true,
      reason: 'reply_to_bot'
    })
  })

  test('uses weak-session fallback only while the recent bot turn is still fresh', async () => {
    const recentContext = await buildTestContext({
      repositoryRows: [
        historyRecord('Ты как?', {
          messageSentAt: instantFromIso('2026-03-12T11:49:00.000Z')
        }),
        historyRecord('Я тут.', {
          isBot: true,
          senderTelegramUserId: '999000',
          senderDisplayName: 'Kojori Bot',
          messageSentAt: instantFromIso('2026-03-12T11:50:00.000Z')
        })
      ],
      messageText: 'И что дальше',
      referenceInstant: instantFromIso('2026-03-12T12:00:00.000Z')
    })
    const expiredContext = await buildTestContext({
      repositoryRows: [
        historyRecord('Ты как?', {
          messageSentAt: instantFromIso('2026-03-12T11:19:00.000Z')
        }),
        historyRecord('Я тут.', {
          isBot: true,
          senderTelegramUserId: '999000',
          senderDisplayName: 'Kojori Bot',
          messageSentAt: instantFromIso('2026-03-12T11:20:00.000Z')
        })
      ],
      messageText: 'И что дальше',
      referenceInstant: instantFromIso('2026-03-12T12:00:00.000Z')
    })

    expect(recentContext.engagement).toMatchObject({
      engaged: true,
      reason: 'weak_session',
      weakSessionActive: true
    })
    expect(expiredContext.engagement).toMatchObject({
      engaged: false,
      reason: 'none',
      weakSessionActive: false
    })
  })

  test('treats a recent open bot question as context, not an unconditional engagement trigger', async () => {
    const context = await buildTestContext({
      repositoryRows: [
        historyRecord('Что по рыбе?', {
          messageSentAt: instantFromIso('2026-03-12T11:19:00.000Z')
        }),
        historyRecord('Какую именно рыбу ты хочешь купить?', {
          isBot: true,
          senderTelegramUserId: '999000',
          senderDisplayName: 'Kojori Bot',
          messageSentAt: instantFromIso('2026-03-12T11:20:00.000Z')
        })
      ],
      messageText: 'Сегодня солнце',
      referenceInstant: instantFromIso('2026-03-12T12:00:00.000Z')
    })

    expect(context.engagement).toMatchObject({
      engaged: false,
      reason: 'open_bot_question',
      hasOpenBotQuestion: true,
      lastBotQuestion: 'Какую именно рыбу ты хочешь купить?'
    })
  })

  test('reopens engagement for strong contextual references when bot context exists', async () => {
    const context = await buildTestContext({
      repositoryRows: [
        historyRecord('Что по рыбе?', {
          messageSentAt: instantFromIso('2026-03-12T11:19:00.000Z')
        }),
        historyRecord('Какую именно рыбу ты хочешь купить?', {
          isBot: true,
          senderTelegramUserId: '999000',
          senderDisplayName: 'Kojori Bot',
          messageSentAt: instantFromIso('2026-03-12T11:20:00.000Z')
        })
      ],
      messageText: 'Вопрос выше, я уже ответил',
      referenceInstant: instantFromIso('2026-03-12T12:00:00.000Z')
    })

    expect(context.engagement).toMatchObject({
      engaged: true,
      reason: 'strong_reference',
      strongReference: true
    })
  })

  test('does not inherit weak-session engagement from another topic participant', async () => {
    const context = await buildTestContext({
      repositoryRows: [
        historyRecord('Бот, как жизнь?', {
          senderTelegramUserId: '222222',
          senderDisplayName: 'Dima',
          messageSentAt: instantFromIso('2026-03-12T11:49:00.000Z')
        }),
        historyRecord('Still standing.', {
          isBot: true,
          senderTelegramUserId: '999000',
          senderDisplayName: 'Kojori Bot',
          messageSentAt: instantFromIso('2026-03-12T11:50:00.000Z')
        })
      ],
      messageText: 'Окей',
      referenceInstant: instantFromIso('2026-03-12T12:00:00.000Z')
    })

    expect(context.engagement).toMatchObject({
      engaged: false,
      reason: 'none',
      weakSessionActive: false
    })
  })

  test('keeps rolling history across local midnight boundaries', async () => {
    const context = await buildTestContext({
      repositoryRows: [
        historyRecord('Поздний вечерний контекст', {
          messageSentAt: instantFromIso('2026-03-12T19:50:00.000Z')
        }),
        historyRecord('Уже слишком старое сообщение', {
          messageSentAt: instantFromIso('2026-03-11T19:00:00.000Z')
        })
      ],
      messageText: 'Бот, что происходило в чате?',
      directBotAddress: true,
      referenceInstant: instantFromIso('2026-03-12T20:30:00.000Z')
    })

    expect(context.rollingChatMessages.map((message) => message.text)).toContain(
      'Поздний вечерний контекст'
    )
    expect(context.rollingChatMessages.map((message) => message.text)).not.toContain(
      'Уже слишком старое сообщение'
    )
    expect(context.shouldLoadExpandedContext).toBe(true)
  })
})
