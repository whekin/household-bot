import { formatMonthDisplay } from '@household/domain'

import type { BotLocale } from './types'

// Copy for the live rent and utilities cards in the reminders and payments topics.

const ru = {
  rentTitle: (period: string, dueDate: string) =>
    `🏠 <b>Аренда за ${formatMonthDisplay(period, 'ru')} · до ${dueDate}</b>`,
  rentPaidTitle: (period: string) =>
    `🏠 <b>Аренда за ${formatMonthDisplay(period, 'ru')} · оплачена</b>`,
  utilitiesTitle: (period: string, dueDate: string | null) =>
    `💡 <b>Коммуналка за ${formatMonthDisplay(period, 'ru')}${dueDate ? ` · до ${dueDate}` : ''}</b>`,
  utilitiesPaidTitle: (period: string) =>
    `💡 <b>Коммуналка за ${formatMonthDisplay(period, 'ru')} · оплачена</b>`,
  rentProgress: (paid: number, total: number, remaining: string) =>
    `Оплатили ${paid} из ${total} · осталось ${remaining}`,
  everyonePaid: (total: number | null, amount: string) =>
    `${total ? `Все ${total} оплатили` : 'Все оплатили'} · ${amount}`,
  remaining: (amount: string) => `Осталось ${amount}`,
  paid: 'оплачено',
  nothingToPayNow: 'сейчас ничего',
  alreadyPaid: (amount: string) => `${amount} уже оплачено`,
  left: 'осталось',
  purchasesExplained: 'Суммы уже учитывают общие покупки: кто покупал больше, тот платит меньше.',
  shareWithPurchases: (share: string, sign: '+' | '−', amount: string) =>
    `🛒 Доля ${share} ${sign} ${amount} за покупки`,
  restNextMonth: (target: string, now: string) =>
    `= ${target}. Сейчас ${now}, остальное — в следующем месяце`,
  extraReturnsNextMonth: (target: string, now: string) =>
    `= ${target}. Сейчас ${now}, лишнее вернётся в следующем месяце`,
  shareCoveredByPurchases: (share: string) => `🛒 Долю ${share} покрыли покупки`,
  restReturns: (amount: string) => `остальные ${amount} вернутся в следующем месяце`,
  restReturnsUnknown: 'остальное вернётся в следующем месяце',
  purchasesDueNextMonth: (amount: string) => `🛒 Ещё ${amount} за покупки — в следующем месяце`,
  purchasesCreditNextMonth: (amount: string) =>
    `🛒 ${amount} за покупки вернётся в следующем месяце`,
  purchasesDueViaRent: (amount: string) => `🛒 ${amount} за покупки — добавится к аренде`,
  purchasesCreditViaRent: (amount: string) => `🛒 ${amount} за покупки — вычтется из аренды`,
  recipient: (name: string) => `Получатель: ${name}`,
  copyAccount: (bank: string) => `📋 ${bank}`,
  screenshotHint: 'Счета можно внести ответом на это сообщение — скриншотом из Credo или TBC.'
}

const en: typeof ru = {
  rentTitle: (period, dueDate) =>
    `🏠 <b>${formatMonthDisplay(period, 'en')} rent · due ${dueDate}</b>`,
  rentPaidTitle: (period) => `🏠 <b>${formatMonthDisplay(period, 'en')} rent · paid</b>`,
  utilitiesTitle: (period, dueDate) =>
    `💡 <b>${formatMonthDisplay(period, 'en')} utilities${dueDate ? ` · due ${dueDate}` : ''}</b>`,
  utilitiesPaidTitle: (period) => `💡 <b>${formatMonthDisplay(period, 'en')} utilities · paid</b>`,
  rentProgress: (paid, total, remaining) => `${paid} of ${total} paid · ${remaining} left`,
  everyonePaid: (total, amount) => `${total ? `All ${total} paid` : 'Everyone paid'} · ${amount}`,
  remaining: (amount) => `${amount} left`,
  paid: 'paid',
  nothingToPayNow: 'nothing now',
  alreadyPaid: (amount) => `${amount} already paid`,
  left: 'left',
  purchasesExplained: 'Amounts already include shared purchases: whoever bought more pays less.',
  shareWithPurchases: (share, sign, amount) => `🛒 Share ${share} ${sign} ${amount} for purchases`,
  restNextMonth: (target, now) => `= ${target}. ${now} now, the rest next month`,
  extraReturnsNextMonth: (target, now) =>
    `= ${target}. ${now} now, the extra comes back next month`,
  shareCoveredByPurchases: (share) => `🛒 Purchases covered the ${share} share`,
  restReturns: (amount) => `the other ${amount} comes back next month`,
  restReturnsUnknown: 'the rest comes back next month',
  purchasesDueNextMonth: (amount) => `🛒 ${amount} more for purchases — next month`,
  purchasesCreditNextMonth: (amount) => `🛒 ${amount} for purchases comes back next month`,
  purchasesDueViaRent: (amount) => `🛒 ${amount} for purchases — added to rent`,
  purchasesCreditViaRent: (amount) => `🛒 ${amount} for purchases — taken off rent`,
  recipient: (name) => `Recipient: ${name}`,
  copyAccount: (bank) => `📋 ${bank}`,
  screenshotHint: 'Reply to this message with a Credo or TBC screenshot to enter bills.'
}

export const paymentCardCopy: Record<BotLocale, typeof ru> = { ru, en }
