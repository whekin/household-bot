import { describe, expect, test } from 'bun:test'
import { createHmac } from 'node:crypto'

import { verifyTelegramMiniAppInitData } from './telegram-miniapp-auth'

function buildInitData(botToken: string, authDate: number, user: object): string {
  const params = new URLSearchParams()
  params.set('auth_date', authDate.toString())
  params.set('query_id', 'AAHdF6IQAAAAAN0XohDhrOrc')
  params.set('user', JSON.stringify(user))

  const dataCheckString = [...params.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest()
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex')
  params.set('hash', hash)

  return params.toString()
}

describe('verifyTelegramMiniAppInitData', () => {
  test('verifies valid init data and extracts user payload', () => {
    const now = new Date('2026-03-08T12:00:00.000Z')
    const initData = buildInitData('test-bot-token', Math.floor(now.getTime() / 1000), {
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
    const now = new Date('2026-03-08T12:00:00.000Z')
    const params = new URLSearchParams(
      buildInitData('test-bot-token', Math.floor(now.getTime() / 1000), {
        id: 123456,
        first_name: 'Stan'
      })
    )
    params.set('hash', '0'.repeat(64))

    const result = verifyTelegramMiniAppInitData(params.toString(), 'test-bot-token', now)

    expect(result).toBeNull()
  })

  test('rejects expired init data', () => {
    const now = new Date('2026-03-08T12:00:00.000Z')
    const initData = buildInitData('test-bot-token', Math.floor(now.getTime() / 1000) - 7200, {
      id: 123456,
      first_name: 'Stan'
    })

    const result = verifyTelegramMiniAppInitData(initData, 'test-bot-token', now, 3600)

    expect(result).toBeNull()
  })
})
