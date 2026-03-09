import type { Context } from 'grammy'

import { enBotTranslations } from './locales/en'
import { ruBotTranslations } from './locales/ru'
import type { BotLocale, BotTranslationCatalog } from './types'

const catalogs: Record<BotLocale, BotTranslationCatalog> = {
  en: enBotTranslations,
  ru: ruBotTranslations
}

export function resolveBotLocale(languageCode?: string | null): BotLocale {
  const normalized = languageCode?.trim().toLowerCase()
  if (normalized?.startsWith('ru')) {
    return 'ru'
  }

  return 'en'
}

export function botLocaleFromContext(ctx: Pick<Context, 'from'>): BotLocale {
  return resolveBotLocale(ctx.from?.language_code)
}

export function getBotTranslations(locale: BotLocale): BotTranslationCatalog {
  return catalogs[locale]
}

export type { BotLocale } from './types'
