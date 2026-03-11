import WebApp from '@twa-dev/sdk'

export type TelegramWebApp = typeof WebApp
export type TelegramWebAppUser = NonNullable<NonNullable<TelegramWebApp['initDataUnsafe']>['user']>

export function getTelegramWebApp(): TelegramWebApp | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }

  return WebApp
}
