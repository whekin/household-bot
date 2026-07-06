import { getTelegramWebApp } from './webapp'

export type ThemeMode = 'light' | 'dark'
export type ThemePreference = 'auto' | ThemeMode

const STORAGE_KEY = 'household:theme'

let currentPreference: ThemePreference = 'auto'
const subscribers = new Set<(mode: ThemeMode) => void>()

function readStoredPreference(): ThemePreference {
  if (typeof localStorage === 'undefined') return 'auto'
  const value = localStorage.getItem(STORAGE_KEY)
  return value === 'light' || value === 'dark' ? value : 'auto'
}

function autoMode(): ThemeMode {
  const webApp = getTelegramWebApp()
  if (webApp?.initData && (webApp.colorScheme === 'dark' || webApp.colorScheme === 'light')) {
    return webApp.colorScheme
  }
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return 'light'
}

function resolveMode(): ThemeMode {
  return currentPreference === 'auto' ? autoMode() : currentPreference
}

function apply() {
  if (typeof document === 'undefined') return
  const mode = resolveMode()
  document.documentElement.setAttribute('data-theme', mode)
  subscribers.forEach((cb) => cb(mode))
}

/**
 * Apply theme mode from user preference (auto/light/dark) to <html data-theme>.
 * When preference is 'auto', follows Telegram colorScheme (inside Telegram) or
 * prefers-color-scheme (browser). Listens to both so mid-session flips work.
 *
 * Call once at app boot; returns a cleanup that detaches listeners.
 */
export function bindThemeToTelegram(): () => void {
  currentPreference = readStoredPreference()
  apply()

  const webApp = getTelegramWebApp()
  webApp?.onEvent?.('themeChanged', apply)

  const mql =
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null
  mql?.addEventListener?.('change', apply)

  return () => {
    webApp?.offEvent?.('themeChanged', apply)
    mql?.removeEventListener?.('change', apply)
  }
}

export function getThemePreference(): ThemePreference {
  return currentPreference
}

export function setThemePreference(preference: ThemePreference) {
  currentPreference = preference
  if (typeof localStorage !== 'undefined') {
    if (preference === 'auto') {
      localStorage.removeItem(STORAGE_KEY)
    } else {
      localStorage.setItem(STORAGE_KEY, preference)
    }
  }
  apply()
}

/** Subscribe to resolved theme mode changes (auto flips + explicit picks). */
export function subscribeThemeMode(callback: (mode: ThemeMode) => void): () => void {
  subscribers.add(callback)
  return () => {
    subscribers.delete(callback)
  }
}

export function getResolvedThemeMode(): ThemeMode {
  return resolveMode()
}
