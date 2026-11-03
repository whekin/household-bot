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
  owesOnPurchases: (amount: string, viaUtilities: boolean) =>
    `↩ ${amount} долг по покупкам${viaUtilities ? ' — войдёт в следующую коммуналку' : ''}`,
  creditOnPurchases: (amount: string, viaUtilities: boolean) =>
    `↩ ${amount} в плюсе по покупкам${viaUtilities ? ' — вернётся следующими коммуналками' : ''}`,
  unroutable: (amount: string) =>
    `Покупок сверх счетов: ${amount} — в этом месяце их не закрыть, перейдут дальше`,
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
  owesOnPurchases: (amount, viaUtilities) =>
    `↩ ${amount} owed on purchases${viaUtilities ? ' — goes into the next utilities bill' : ''}`,
  creditOnPurchases: (amount, viaUtilities) =>
    `↩ ${amount} in credit on purchases${viaUtilities ? ' — comes back through the next utilities bills' : ''}`,
  unroutable: (amount) =>
    `Purchases beyond the bills: ${amount} — no bill left to cover them this month`,
  recipient: (name) => `Recipient: ${name}`,
  copyAccount: (bank) => `📋 ${bank}`,
  screenshotHint: 'Reply to this message with a Credo or TBC screenshot to enter bills.'
}

export const paymentCardCopy: Record<BotLocale, typeof ru> = { ru, en }
