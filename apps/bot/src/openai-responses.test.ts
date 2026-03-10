import { describe, expect, test } from 'bun:test'

import { extractOpenAiResponseText, parseJsonFromResponseText } from './openai-responses'

describe('extractOpenAiResponseText', () => {
  test('returns top-level output_text when present', () => {
    expect(
      extractOpenAiResponseText({
        output_text: 'hello'
      })
    ).toBe('hello')
  })

  test('falls back to nested output content text', () => {
    expect(
      extractOpenAiResponseText({
        output: [
          {
            content: [
              {
                text: 'first'
              },
              {
                text: {
                  value: 'second'
                }
              }
            ]
          }
        ]
      })
    ).toBe('first\nsecond')
  })
})

describe('parseJsonFromResponseText', () => {
  test('parses plain json', () => {
    expect(parseJsonFromResponseText<{ ok: boolean }>('{"ok":true}')).toEqual({
      ok: true
    })
  })

  test('parses fenced json', () => {
    expect(parseJsonFromResponseText<{ ok: boolean }>('```json\n{"ok":true}\n```')).toEqual({
      ok: true
    })
  })
})
