import { describe, expect, test } from 'bun:test'

import { shouldLoadExpandedChatHistory } from './topic-history'

describe('shouldLoadExpandedChatHistory', () => {
  test('recognizes broader russian dialogue-memory prompts', () => {
    expect(shouldLoadExpandedChatHistory('У тебя есть контекст диалога?')).toBe(true)
    expect(
      shouldLoadExpandedChatHistory('Это вопрос, что я последнее купил, основываясь на диалоге?')
    ).toBe(true)
    expect(shouldLoadExpandedChatHistory('Вопрос выше уже есть')).toBe(true)
  })

  test('stays false for ordinary purchase chatter', () => {
    expect(shouldLoadExpandedChatHistory('Купил молоко за 6 лари')).toBe(false)
  })
})
