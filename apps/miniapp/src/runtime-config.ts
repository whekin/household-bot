declare global {
  interface Window {
    __HOUSEHOLD_CONFIG__?: {
      botApiUrl?: string
    }
  }
}

export function runtimeBotApiUrl(): string | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }

  const configured = window.__HOUSEHOLD_CONFIG__?.botApiUrl?.trim()

  return configured && configured.length > 0 ? configured : undefined
}
