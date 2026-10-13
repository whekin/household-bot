import * as activity from './activity'
import * as common from './common'
import * as home from './home'
import * as session from './session'
import * as settings from './settings'
import * as shell from './shell'

export type Locale = 'en' | 'ru'

const en = {
  ...common.en,
  ...session.en,
  ...home.en,
  ...activity.en,
  ...settings.en,
  ...shell.en
}

const ru: typeof en = {
  ...common.ru,
  ...session.ru,
  ...home.ru,
  ...activity.ru,
  ...settings.ru,
  ...shell.ru
}

export const dictionary: Record<Locale, typeof en> = { en, ru }

export type Copy = typeof en
