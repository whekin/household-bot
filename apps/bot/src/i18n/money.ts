import { formatMajorMoneyDisplay } from '@household/domain'

import type { BotLocale } from './types'

export function formatUserFacingMoney(
  amount: string,
  currency: string,
  locale: BotLocale = 'ru'
): string {
  return formatMajorMoneyDisplay(amount, currency, locale)
}
