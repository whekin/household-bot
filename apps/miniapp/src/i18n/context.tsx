import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

import { dictionary, type Copy, type Locale } from './index'
import { getTelegramWebApp } from '@/telegram/webapp'

type I18nContextValue = {
  locale: Locale
  setLocale: (locale: Locale) => void
  copy: Copy
}

const I18nContext = createContext<I18nContextValue | null>(null)

function detectLocale(): Locale {
  const telegramLocale = getTelegramWebApp()?.initDataUnsafe?.user?.language_code
  const browserLocale = typeof navigator === 'undefined' ? 'en' : navigator.language.toLowerCase()

  return (telegramLocale ?? browserLocale).startsWith('ru') ? 'ru' : 'en'
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(detectLocale)

  const value = useMemo<I18nContextValue>(
    () => ({ locale, setLocale, copy: dictionary[locale] }),
    [locale]
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext)
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider')
  }
  return context
}
