import { describe, expect, test } from 'bun:test'

import { instantFromIso, instantToEpochSeconds } from '@household/domain'

import { verifyTelegramMiniAppInitData } from './telegram-miniapp-auth'
import { buildMiniAppInitData } from './telegram-miniapp-test-helpers'

describe('verifyTelegramMiniAppInitData', () => {
  test('verifies valid init data and extracts user payload', () => {
    const now = instantFromIso('2026-03-08T12:00:00.000Z')
    const initData = buildMiniAppInitData('test-bot-token', instantToEpochSeconds(now), {
      id: 123456,
      first_name: 'Stan',
      username: 'stanislav'
    })

    const result = verifyTelegramMiniAppInitData(initData, 'test-bot-token', now)

    expect(result).toEqual({
      id: '123456',
      firstName: 'Stan',
      lastName: null,
      username: 'stanislav',
      languageCode: null
    })
  })

  test('rejects invalid hash', () => {
    const now = instantFromIso('2026-03-08T12:00:00.000Z')
    const params = new URLSearchParams(
      buildMiniAppInitData('test-bot-token', instantToEpochSeconds(now), {
        id: 123456,
        first_name: 'Stan'
      })
    )
    params.set('hash', '0'.repeat(64))

    const result = verifyTelegramMiniAppInitData(params.toString(), 'test-bot-token', now)

    expect(result).toBeNull()
  })

  test('rejects expired init data', () => {
    const now = instantFromIso('2026-03-08T12:00:00.000Z')
    const initData = buildMiniAppInitData('test-bot-token', instantToEpochSeconds(now) - 7200, {
      id: 123456,
      first_name: 'Stan'
    })

    const result = verifyTelegramMiniAppInitData(initData, 'test-bot-token', now, 3600)

    expect(result).toBeNull()
  })

  test('rejects init data timestamps from the future', () => {
    const now = instantFromIso('2026-03-08T12:00:00.000Z')
    const initData = buildMiniAppInitData('test-bot-token', instantToEpochSeconds(now) + 5, {
      id: 123456,
      first_name: 'Stan'
    })

    const result = verifyTelegramMiniAppInitData(initData, 'test-bot-token', now, 3600)

    expect(result).toBeNull()
  })
})
