import { describe, expect, test } from 'bun:test'

import {
  extractPurchaseTopicCandidate,
  type PurchaseTopicCandidate
} from './purchase-topic-ingestion'

const config = {
  householdId: '11111111-1111-4111-8111-111111111111',
  householdChatId: '-10012345',
  purchaseTopicId: 777
}

function candidate(overrides: Partial<PurchaseTopicCandidate> = {}): PurchaseTopicCandidate {
  return {
    updateId: 1,
    chatId: '-10012345',
    messageId: '10',
    threadId: '777',
    senderTelegramUserId: '10002',
    rawText: 'Bought toilet paper 30 gel',
    messageSentAt: new Date('2026-03-05T00:00:00.000Z'),
    ...overrides
  }
}

describe('extractPurchaseTopicCandidate', () => {
  test('returns record when message belongs to configured topic', () => {
    const record = extractPurchaseTopicCandidate(candidate(), config)

    expect(record).not.toBeNull()
    expect(record?.householdId).toBe(config.householdId)
    expect(record?.rawText).toBe('Bought toilet paper 30 gel')
  })

  test('skips message from other chat', () => {
    const record = extractPurchaseTopicCandidate(candidate({ chatId: '-10099999' }), config)

    expect(record).toBeNull()
  })

  test('skips message from other topic', () => {
    const record = extractPurchaseTopicCandidate(candidate({ threadId: '778' }), config)

    expect(record).toBeNull()
  })

  test('skips blank text after trim', () => {
    const record = extractPurchaseTopicCandidate(candidate({ rawText: '   ' }), config)

    expect(record).toBeNull()
  })
})
