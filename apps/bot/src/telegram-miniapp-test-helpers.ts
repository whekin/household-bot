import { createHmac } from 'node:crypto'

export function buildMiniAppInitData(botToken: string, authDate: number, user: object): string {
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
