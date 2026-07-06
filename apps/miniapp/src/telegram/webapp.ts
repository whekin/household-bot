/*
 * Thin typed bridge over the Telegram WebApp API injected by
 * https://telegram.org/js/telegram-web-app.js (loaded in index.html).
 * Every accessor is optional-safe so the app also runs in a plain browser.
 */

export type TelegramUser = {
  first_name?: string
  username?: string
  language_code?: string
}

export type TelegramMainButton = {
  isVisible: boolean
  setText(text: string): void
  show(): void
  hide(): void
  enable(): void
  disable(): void
  showProgress(leaveActive?: boolean): void
  hideProgress(): void
  onClick(callback: () => void): void
  offClick(callback: () => void): void
}

export type TelegramBackButton = {
  isVisible: boolean
  show(): void
  hide(): void
  onClick(callback: () => void): void
  offClick(callback: () => void): void
}

export type TelegramHapticFeedback = {
  impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void
  notificationOccurred(type: 'error' | 'success' | 'warning'): void
  selectionChanged(): void
}

export type TelegramWebApp = {
  initData: string
  initDataUnsafe: { user?: TelegramUser }
  version: string
  colorScheme: 'light' | 'dark'
  themeParams: Record<string, string | undefined>
  ready(): void
  expand(): void
  onEvent(eventType: string, handler: () => void): void
  offEvent(eventType: string, handler: () => void): void
  openTelegramLink(url: string): void
  showConfirm(message: string, callback: (confirmed: boolean) => void): void
  MainButton: TelegramMainButton
  BackButton: TelegramBackButton
  HapticFeedback: TelegramHapticFeedback
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp }
  }
}

export function getTelegramWebApp(): TelegramWebApp | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }
  return window.Telegram?.WebApp
}

export const haptics = {
  impact(style: Parameters<TelegramHapticFeedback['impactOccurred']>[0] = 'light') {
    getTelegramWebApp()?.HapticFeedback?.impactOccurred?.(style)
  },
  success() {
    getTelegramWebApp()?.HapticFeedback?.notificationOccurred?.('success')
  },
  error() {
    getTelegramWebApp()?.HapticFeedback?.notificationOccurred?.('error')
  },
  selection() {
    getTelegramWebApp()?.HapticFeedback?.selectionChanged?.()
  }
}

/**
 * Native confirm dialog; falls back to window.confirm outside Telegram
 * (and inside Telegram clients too old to support showConfirm).
 */
export function confirmDialog(message: string): Promise<boolean> {
  const webApp = getTelegramWebApp()
  if (webApp?.showConfirm) {
    return new Promise((resolve) => {
      try {
        webApp.showConfirm(message, resolve)
      } catch {
        resolve(window.confirm(message))
      }
    })
  }
  return Promise.resolve(window.confirm(message))
}
