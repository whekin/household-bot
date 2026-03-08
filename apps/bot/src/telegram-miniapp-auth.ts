import { createHmac, timingSafeEqual } from 'node:crypto'

interface TelegramUserPayload {
  id: number
  first_name?: string
  last_name?: string
  username?: string
  language_code?: string
}

export interface VerifiedMiniAppUser {
  id: string
  firstName: string | null
  lastName: string | null
  username: string | null
  languageCode: string | null
}

export function verifyTelegramMiniAppInitData(
  initData: string,
  botToken: string,
  now = new Date(),
  maxAgeSeconds = 3600
): VerifiedMiniAppUser | null {
  const params = new URLSearchParams(initData)
  const hash = params.get('hash')

  if (!hash) {
    return null
  }

  const authDateRaw = params.get('auth_date')
  if (!authDateRaw || !/^\d+$/.test(authDateRaw)) {
    return null
  }

  const authDateSeconds = Number(authDateRaw)
  const nowSeconds = Math.floor(now.getTime() / 1000)
  if (Math.abs(nowSeconds - authDateSeconds) > maxAgeSeconds) {
    return null
  }

  const userRaw = params.get('user')
  if (!userRaw) {
    return null
  }

  const payloadEntries = [...params.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([left], [right]) => left.localeCompare(right))

  const dataCheckString = payloadEntries.map(([key, value]) => `${key}=${value}`).join('\n')
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest()
  const expectedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex')

  const expectedBuffer = Buffer.from(expectedHash, 'hex')
  const actualBuffer = Buffer.from(hash, 'hex')

  if (expectedBuffer.length !== actualBuffer.length) {
    return null
  }

  if (!timingSafeEqual(expectedBuffer, actualBuffer)) {
    return null
  }

  let parsedUser: TelegramUserPayload
  try {
    parsedUser = JSON.parse(userRaw) as TelegramUserPayload
  } catch {
    return null
  }

  if (!Number.isInteger(parsedUser.id) || parsedUser.id <= 0) {
    return null
  }

  return {
    id: parsedUser.id.toString(),
    firstName: parsedUser.first_name?.trim() || null,
    lastName: parsedUser.last_name?.trim() || null,
    username: parsedUser.username?.trim() || null,
    languageCode: parsedUser.language_code?.trim() || null
  }
}
