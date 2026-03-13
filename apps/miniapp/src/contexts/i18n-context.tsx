import { createContext, createSignal, useContext, type ParentProps } from 'solid-js'

import { dictionary, type Locale } from '../i18n'
import { getTelegramWebApp } from '../telegram-webapp'

type I18nContextValue = {
  locale: () => Locale
  setLocale: (locale: Locale) => void
  copy: () => (typeof dictionary)['en']
}

const I18nContext = createContext<I18nContextValue>()

function detectLocale(): Locale {
  const telegramLocale = getTelegramWebApp()?.initDataUnsafe?.user?.language_code
  const browserLocale = navigator.language.toLowerCase()

  return (telegramLocale ?? browserLocale).startsWith('ru') ? 'ru' : 'en'
}

export function I18nProvider(props: ParentProps) {
  const [locale, setLocale] = createSignal<Locale>(detectLocale())
  const copy = () => dictionary[locale()]

  return (
    <I18nContext.Provider value={{ locale, setLocale, copy }}>
      {props.children}
    </I18nContext.Provider>
  )
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext)
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider')
  }
  return context
}
