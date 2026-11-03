import {
  formatMajorMoneyDisplay,
  formatMoneyDisplay,
  formatMonthDisplay,
  pluralRu
} from '@household/domain'

import { escapeHtml } from '../html'
import type { BotLocale } from './types'

// Copy for entering utility bills: the reminder buttons, guided entry, the template and
// screenshot import. Functions marked HTML go out with parse_mode HTML and escape every name
// they embed; the rest is plain text. Toasts never carry tags.

type Currency = 'GEL' | 'USD'
type BlockedReason = 'closed' | 'ambiguous' | 'category'
type IssueReason = 'category' | 'account' | 'amount' | 'duplicate'

const gelRu = (amountMajor: string) => formatMajorMoneyDisplay(amountMajor, 'GEL', 'ru')
const gelMinorRu = (amountMinor: string) => formatMoneyDisplay(BigInt(amountMinor), 'GEL', 'ru')
const gelEn = (amountMajor: string) => formatMajorMoneyDisplay(amountMajor, 'GEL', 'en')
const gelMinorEn = (amountMinor: string) => formatMoneyDisplay(BigInt(amountMinor), 'GEL', 'en')

const ru = {
  // Buttons
  stepsButton: 'По шагам',
  templateButton: 'Шаблон',
  appButton: '📱 Приложение',
  saveButton: '✅ Сохранить',
  confirmButton: '✅ Подтвердить',
  cancelButton: 'Отмена',
  backButton: 'Назад',
  editButton: 'Исправить',
  monthButton: 'Другой месяц',
  extraPaymentButton: (billName: string) => `Доплата · ${billName}`,

  // Toasts
  noBills: 'Счетов коммуналки пока нет — добавьте их в приложении.',
  stepsStarted: 'Вводим по шагам.',
  templateSent: 'Шаблон отправлен.',
  unavailable: 'Это уже неактуально.',
  pickPayerFirst: 'Сначала выберите, кто доплатил.',
  fixListFirst: 'Сначала исправьте список.',

  // Guided entry and template (plain text)
  askAmount: (billName: string, position: number, total: number, currency: Currency) =>
    `${billName} (${position} из ${total}): сумма ${ru.inCurrency[currency]}? Нет счёта — отправьте 0.`,
  invalidAmount: (billName: string) =>
    `${billName}: нужна сумма числом, например 44,50. Нет счёта — отправьте 0.`,
  templateInvalid: 'В шаблоне не нашлось ни одной суммы — впишите хотя бы одну.',
  inCurrency: { GEL: 'в лари', USD: 'в долларах' } satisfies Record<Currency, string>,
  title: (period?: string) =>
    period ? `Коммуналка за ${formatMonthDisplay(period, 'ru')}` : 'Коммуналка',
  templateIntro: (currency: Currency) =>
    `Впишите суммы ${ru.inCurrency[currency]} и отправьте сюда:`,
  templateSkip: 'Пусто или 0 — счёт пропустим.',
  templateScreenshotHint: 'Или ответьте на напоминание скриншотом из Credo или TBC.',
  summaryLine: (billName: string, amountMajor: string, currency: Currency) =>
    `${billName}: ${formatMajorMoneyDisplay(amountMajor, currency, 'ru')}`,
  summaryTotal: (totalMinor: bigint, currency: Currency) =>
    `Всего: ${formatMoneyDisplay(totalMinor, currency, 'ru')}`,
  saved: (count: number, period: string) =>
    `✅ Коммуналка за ${formatMonthDisplay(period, 'ru')} сохранена — ${count} ${pluralRu(count, ['счёт', 'счёта', 'счетов'])}.`,
  paymentInstructionSent: 'Как оплатить — уже в топике оплат.',
  cancelled: 'Отменено, ничего не сохранено.',
  allSkipped: 'Все счета пропущены — сохранять нечего.',

  // Screenshot preview (HTML)
  previewLead: 'Со скриншота: текущий долг поставщикам. Проверьте месяц и суммы.',
  entryLine: (billName: string, amountMajor: string) =>
    `${escapeHtml(billName)}: <b>${gelRu(amountMajor)}</b>`,
  entryAlreadySaved: ' · уже сохранено',
  entryWas: (amountMajor: string) => ` · было ${gelRu(amountMajor)}`,
  providerLine: (provider: string, accountTail: string | null) =>
    escapeHtml(accountTail ? `${provider} · л/с …${accountTail}` : provider),
  total: (amountMajor: string) => `Всего: <b>${gelRu(amountMajor)}</b>`,
  issuesIntro: 'Не всё удалось разобрать — исправьте список перед сохранением:',
  issueReason: {
    category: 'нет такого счёта',
    account: 'другой лицевой счёт',
    amount: 'сумма не читается',
    duplicate: 'повтор'
  } satisfies Record<IssueReason, string>,
  blocked: {
    closed: 'Этот месяц уже закрыт — выберите другой.',
    category: 'Настройки счетов изменились — исправьте список.',
    ambiguous: 'Есть повторяющиеся счета или другая валюта — проверьте их в приложении.'
  } satisfies Record<BlockedReason, string>,
  alreadySaved: 'Эти суммы уже сохранены — дублей не будет.',
  keepsPayments: 'Записанные оплаты останутся, остаток к оплате пересчитаем.',
  preservedBills: (billNames: readonly string[]) =>
    `Счета с оплатами не меняем: ${escapeHtml(billNames.join(', '))}.`,
  difference: (billName: string, expectedMajor: string, observedMajor: string) =>
    `${escapeHtml(billName)}: по учёту осталось ${gelRu(expectedMajor)}, на скриншоте ${gelRu(observedMajor)}.`,
  autoRounding: (payments: readonly { displayName: string; amountMinor: string }[]) =>
    `Округление учтём при сохранении: ${payments
      .map((payment) => `${escapeHtml(payment.displayName)} +${gelMinorRu(payment.amountMinor)}`)
      .join(', ')}.`,
  smallDifference: 'Разница мелкая, подтверждать не нужно.',
  extraPaymentHint: 'Если разницу кто-то доплатил — отметьте доплату.',
  reconcileInApp: 'Сверьте оплаты в приложении — сохранить новые счета это не мешает.',
  askPayer: (amountMinor: string) =>
    `Кто доплатил ${gelMinorRu(amountMinor)}? По скриншоту этого не видно.`,
  confirmPayer: (payerName: string, amountMinor: string) =>
    `${escapeHtml(payerName)}: доплата ${gelMinorRu(amountMinor)} — засчитать в баланс?`,

  // Screenshot replies (HTML)
  extraPaymentFailed: '⚠️ Доплата не записана — проверьте плательщика и попробуйте ещё раз.',
  extraPaymentStale: '⚠️ Данные изменились, доплата не записана — проверьте остаток выше.',
  extraPaymentRecorded: (payerName: string, amountMinor: string) =>
    `✅ ${escapeHtml(payerName)}: доплата ${gelMinorRu(amountMinor)} записана. Осталось сохранить счета со скриншота.`,
  extraPaymentRefreshFailed:
    '⚠️ Доплата записана, но список не обновился — пришлите скриншот ещё раз.',
  saveFailed: '⚠️ Счета не сохранились — проверьте список выше и попробуйте ещё раз.',
  saveStale: '⚠️ Данные за месяц изменились — проверьте список выше.',
  billsSaved: (period: string) => `✅ Коммуналка за ${formatMonthDisplay(period, 'ru')} сохранена.`,
  billsAlreadySaved: (period: string) =>
    `Коммуналка за ${formatMonthDisplay(period, 'ru')} уже сохранена.`,
  planTitle: (period: string) => `💡 <b>К оплате за ${formatMonthDisplay(period, 'ru')}</b>`,
  planLine: (displayName: string, amountMajor: string, currency: string) =>
    `${escapeHtml(displayName)}: ${formatMajorMoneyDisplay(amountMajor, currency, 'ru')}`,
  planFootnote: 'Уже внесённые оплаты учтены.',
  planFailed:
    '⚠️ Счета сохранены, но расчёт не загрузился — проверьте суммы в приложении перед оплатой.',
  deliveryFailed:
    '⚠️ Счета сохранены, но не все сообщения обновились — актуальные суммы в приложении.',
  editPrompt: (template: string) =>
    `Ответьте исправленным списком. Пусто — счёт не меняем, 0 — обнуляем.\n\n<pre>${escapeHtml(template)}</pre>`,
  monthPrompt: (example: string) => `Ответьте месяцем в виде ГГГГ-ММ, например ${example}.`,
  monthInvalid: (example: string) => `Месяц не распознан — нужен вид ГГГГ-ММ, например ${example}.`,
  listInvalid: 'Список не читается — нужна строка «Счёт: 12,34» на каждый счёт и ничего лишнего.',
  notMember: '🔒 Не нашли вас среди участников дома.',
  howToSend:
    'Чтобы внести коммуналку, пришлите скриншот в ответ на напоминание или с подписью «коммуналка».',
  sendAsImage: 'Пришлите скриншот фото или файлом PNG/JPEG.',
  recognitionOff:
    '⚠️ Скриншоты сейчас не распознаются — внесите суммы по шаблону или в приложении.',
  receiptNotBills: 'Это чек об оплате, а нужен экран со счетами к оплате. Оплата не записана.',
  noBillsFound:
    'На скриншоте не нашлось счетов — пришлите список из Credo или TBC либо заполните шаблон. Ничего не сохранено.',
  recognitionFailed:
    '⚠️ Скриншот не прочитался. Ничего не сохранено — попробуйте ещё раз или заполните шаблон.'
}

const en: typeof ru = {
  stepsButton: 'Step by step',
  templateButton: 'Template',
  appButton: '📱 App',
  saveButton: '✅ Save',
  confirmButton: '✅ Confirm',
  cancelButton: 'Cancel',
  backButton: 'Back',
  editButton: 'Edit',
  monthButton: 'Other month',
  extraPaymentButton: (billName) => `Extra paid · ${billName}`,

  noBills: 'No utility bills set up yet — add them in the app.',
  stepsStarted: 'Step-by-step entry started.',
  templateSent: 'Template sent.',
  unavailable: 'This is no longer available.',
  pickPayerFirst: 'Pick who paid first.',
  fixListFirst: 'Fix the list first.',

  askAmount: (billName, position, total, currency) =>
    `${billName} (${position} of ${total}): amount ${en.inCurrency[currency]}? No bill — send 0.`,
  invalidAmount: (billName) =>
    `${billName}: send the amount as a number, like 44.50. No bill — send 0.`,
  templateInvalid: 'No amounts in the template — fill in at least one.',
  inCurrency: { GEL: 'in lari', USD: 'in dollars' },
  title: (period) => (period ? `${formatMonthDisplay(period, 'en')} utilities` : 'Utilities'),
  templateIntro: (currency) => `Fill in the amounts ${en.inCurrency[currency]} and send them here:`,
  templateSkip: 'Blank or 0 skips the bill.',
  templateScreenshotHint: 'Or reply to a reminder with a Credo or TBC screenshot.',
  summaryLine: (billName, amountMajor, currency) =>
    `${billName}: ${formatMajorMoneyDisplay(amountMajor, currency, 'en')}`,
  summaryTotal: (totalMinor, currency) =>
    `Total: ${formatMoneyDisplay(totalMinor, currency, 'en')}`,
  saved: (count, period) =>
    `✅ ${formatMonthDisplay(period, 'en')} utilities saved — ${count} ${count === 1 ? 'bill' : 'bills'}.`,
  paymentInstructionSent: 'How to pay is in the payments topic.',
  cancelled: 'Cancelled, nothing saved.',
  allSkipped: 'All bills skipped — nothing to save.',

  previewLead:
    'From a screenshot: current balances owed to suppliers. Check the month and amounts.',
  entryLine: (billName, amountMajor) => `${escapeHtml(billName)}: <b>${gelEn(amountMajor)}</b>`,
  entryAlreadySaved: ' · already saved',
  entryWas: (amountMajor) => ` · was ${gelEn(amountMajor)}`,
  providerLine: (provider, accountTail) =>
    escapeHtml(accountTail ? `${provider} · acct …${accountTail}` : provider),
  total: (amountMajor) => `Total: <b>${gelEn(amountMajor)}</b>`,
  issuesIntro: "Some rows couldn't be read — fix the list before saving:",
  issueReason: {
    category: 'no matching bill',
    account: 'different account number',
    amount: 'unreadable amount',
    duplicate: 'duplicate'
  },
  blocked: {
    closed: 'This month is closed — pick another one.',
    category: 'Bill settings changed — fix the list.',
    ambiguous: 'Some bills repeat or use another currency — check them in the app.'
  },
  alreadySaved: 'These amounts are already saved — nothing will be duplicated.',
  keepsPayments: 'Recorded payments stay; what is left to pay gets recalculated.',
  preservedBills: (billNames) =>
    `Bills with payments stay as they are: ${escapeHtml(billNames.join(', '))}.`,
  difference: (billName, expectedMajor, observedMajor) =>
    `${escapeHtml(billName)}: ${gelEn(expectedMajor)} left on record, ${gelEn(observedMajor)} on the screenshot.`,
  autoRounding: (payments) =>
    `Saving also covers the rounding: ${payments
      .map((payment) => `${escapeHtml(payment.displayName)} +${gelMinorEn(payment.amountMinor)}`)
      .join(', ')}.`,
  smallDifference: 'Tiny difference, nothing to confirm.',
  extraPaymentHint: 'If someone paid the difference, record the extra payment.',
  reconcileInApp: 'Reconcile payments in the app — new bills can still be saved.',
  askPayer: (amountMinor) =>
    `Who paid the extra ${gelMinorEn(amountMinor)}? The screenshot doesn't show it.`,
  confirmPayer: (payerName, amountMinor) =>
    `${escapeHtml(payerName)}: extra payment of ${gelMinorEn(amountMinor)} — count it toward their balance?`,

  extraPaymentFailed: "⚠️ The extra payment wasn't recorded — check the payer and try again.",
  extraPaymentStale:
    "⚠️ Data changed, so the extra payment wasn't recorded — check the balance above.",
  extraPaymentRecorded: (payerName, amountMinor) =>
    `✅ ${escapeHtml(payerName)}: extra payment of ${gelMinorEn(amountMinor)} recorded. The screenshot bills still need saving.`,
  extraPaymentRefreshFailed:
    "⚠️ Extra payment recorded, but the list didn't refresh — send the screenshot again.",
  saveFailed: "⚠️ Bills weren't saved — check the list above and try again.",
  saveStale: '⚠️ This month changed meanwhile — check the list above.',
  billsSaved: (period) => `✅ ${formatMonthDisplay(period, 'en')} utilities saved.`,
  billsAlreadySaved: (period) =>
    `${formatMonthDisplay(period, 'en')} utilities were already saved.`,
  planTitle: (period) => `💡 <b>Due for ${formatMonthDisplay(period, 'en')}</b>`,
  planLine: (displayName, amountMajor, currency) =>
    `${escapeHtml(displayName)}: ${formatMajorMoneyDisplay(amountMajor, currency, 'en')}`,
  planFootnote: 'Payments already made are counted.',
  planFailed:
    "⚠️ Bills saved, but the split didn't load — check the amounts in the app before paying.",
  deliveryFailed:
    "⚠️ Bills saved, but some messages didn't update — current amounts are in the app.",
  editPrompt: (template) =>
    `Reply with the corrected list. Blank keeps a bill as is, 0 sets it to zero.\n\n<pre>${escapeHtml(template)}</pre>`,
  monthPrompt: (example) => `Reply with the month as YYYY-MM, e.g. ${example}.`,
  monthInvalid: (example) => `Couldn't read the month — use YYYY-MM, e.g. ${example}.`,
  listInvalid: 'Couldn\'t read the list — use one "Bill: 12.34" line per bill and nothing else.',
  notMember: "🔒 You're not a member of this household.",
  howToSend:
    'To add utilities, send the screenshot as a reply to a reminder or with the caption "utilities".',
  sendAsImage: 'Send the screenshot as a photo or a PNG/JPEG file.',
  recognitionOff: "⚠️ Screenshots can't be read right now — use the template or the app.",
  receiptNotBills:
    'This is a payment receipt; send the screen with bills due instead. No payment was recorded.',
  noBillsFound:
    'No bills found — send the bill list from Credo or TBC, or use the template. Nothing was saved.',
  recognitionFailed:
    "⚠️ Couldn't read the screenshot. Nothing was saved — try again or use the template."
}

export const utilityEntryCopy: Record<BotLocale, typeof ru> = { ru, en }
