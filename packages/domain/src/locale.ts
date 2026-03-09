export const SUPPORTED_LOCALES = ['en', 'ru'] as const

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

export function normalizeSupportedLocale(value?: string | null): SupportedLocale | null {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) {
    return null
  }

  return (SUPPORTED_LOCALES as readonly string[]).includes(normalized)
    ? (normalized as SupportedLocale)
    : null
}
