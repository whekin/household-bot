import { expect, test } from 'bun:test'
import {
  createOpenAiUtilityImageRecognizer,
  validateUtilityImageRecognition
} from './openai-utility-image-recognizer'
import { downloadTelegramUtilityImage } from './telegram-utility-image'

test('vision uses bounded structured base64 input without exposing Telegram credentials', async () => {
  let request: Record<string, unknown> = {}
  const recognize = createOpenAiUtilityImageRecognizer({
    apiKey: 'test-key',
    model: 'configured-model',
    timeoutMs: 1000,
    fetch: async (url, init) => {
      expect(url).toBe('https://api.openai.com/v1/responses')
      request = JSON.parse(String(init!.body))
      return Response.json({
        status: 'completed',
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({
                  kind: 'utility_balances',
                  bills: [
                    {
                      provider: 'SOCAR',
                      customerNumber: '123',
                      category: 'gas',
                      amountMajor: '-20.30',
                      currency: 'GEL',
                      confidence: 0.99
                    }
                  ]
                })
              }
            ]
          }
        ]
      })
    }
  })
  expect(
    (await recognize({ data: new Uint8Array([137, 80]), mimeType: 'image/png' })).bills[0]
      ?.amountMajor
  ).toBe('-20.30')
  expect(request.model).toBe('configured-model')
  expect(request.store).toBe(false)
  expect(JSON.stringify(request)).toContain('data:image/png;base64,')
  expect(JSON.stringify(request)).toContain('"strict":true')
  expect(JSON.stringify(request)).not.toContain('api.telegram.org')
})

test('invalid recognition and incomplete responses fail without a draft', async () => {
  expect(
    validateUtilityImageRecognition({
      kind: 'utility_balances',
      bills: [{ provider: 'SOCAR', confidence: 2 }]
    })
  ).toBeNull()
  for (const payload of [
    { status: 'incomplete', output_text: '{}' },
    { output_text: '{"kind":"utility_balances","bills":[{}]}' }
  ]) {
    const recognize = createOpenAiUtilityImageRecognizer({
      apiKey: 'test',
      model: 'test',
      timeoutMs: 1000,
      fetch: async () => Response.json(payload)
    })
    await expect(recognize({ data: new Uint8Array(), mimeType: 'image/png' })).rejects.toThrow()
  }
})

test('Telegram image download enforces actual PNG/JPEG bytes and size limits', async () => {
  let downloads = 0
  const options = {
    token: 'secret-token',
    getFile: async () => ({
      file_path: 'photos/test.png',
      file_id: 'test',
      file_unique_id: 'unique'
    }),
    file: { fileId: 'test' },
    timeoutMs: 1000,
    fetch: async () => {
      downloads++
      return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))
    }
  }
  expect((await downloadTelegramUtilityImage(options)).mimeType).toBe('image/png')
  await expect(
    downloadTelegramUtilityImage({ ...options, file: { fileId: 'test', size: 11 * 1024 * 1024 } })
  ).rejects.toThrow('too large')
  expect(downloads).toBe(1)
  await expect(
    downloadTelegramUtilityImage({
      ...options,
      fetch: async () => new Response('not an image')
    })
  ).rejects.toThrow('Unsupported')
})
test('Telegram metadata lookup receives the bounded abort signal', async () => {
  await expect(
    downloadTelegramUtilityImage({
      token: 'fake',
      file: { fileId: 'fake' },
      timeoutMs: 10,
      getFile: async (_fileId, signal) =>
        await new Promise((_resolve, reject) =>
          signal!.addEventListener('abort', () => reject(new Error('metadata timed out')), {
            once: true
          })
        )
    })
  ).rejects.toThrow('metadata timed out')
})
