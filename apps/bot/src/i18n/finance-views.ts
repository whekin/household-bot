import type { BotLocale } from './types'

// Copy for the /bill card, "Мой счёт", the household overview and the purchases view.
// Strings that end up inside an HTML message say so; everything else is plain text.

const ru = {
  // Errors and prompts
  useInGroup: 'Эта команда работает только в группе дома.',
  householdNotConfigured: '⚠️ Этот чат ещё не подключён к дому — запустите /setup.',
  unableToIdentifySender: '⚠️ Не получилось понять, кто отправил команду. Попробуйте ещё раз.',
  notMember: '🔒 Вы не участник этого дома.',
  noMonth: '📅 За этот месяц пока нет данных.',
  billUsage: 'Такого варианта нет. Попробуйте /bill, /bill rent или /bill utilities.',
  chooseHousehold: 'Какой дом показать?',

  // Buttons
  householdBillButton: 'Общий счёт',
  myBillButton: 'Мой счёт',
  detailsButton: 'Подробнее',
  purchasesButton: 'Покупки',
  overviewButton: 'Сводка',
  appButton: '📱 Приложение',
  markPlannedPaidButton: '✅ Оплачено',
  copyAccountButton: (bank: string) => `📋 ${bank}`,

  // Toasts (plain text)
  alreadyPaidToast: 'Уже оплачено',
  plannedPaidToast: 'Коммуналка оплачена — спасибо!',

  // Shared phrases
  rent: 'Аренда',
  utilities: 'Коммуналка',
  purchases: 'Покупки',
  household: 'Дом',
  of: 'из',
  more: (count: number) => `ещё ${count}`,
  dueBy: (day: string) => `до ${day}`,
  left: (amount: string) => `осталось ${amount}`,
  rentDue: (day: string) => `аренда до ${day}`,
  utilitiesDue: (day: string) => `коммуналка до ${day}`,

  // Purchase balance
  purchaseCredit: (amount: string) => `в плюсе ${amount}`,
  purchaseDue: (amount: string) => `долг ${amount}`,
  creditComesBack: 'вернётся следующими коммуналками',
  dueGoesIn: 'войдёт в следующую коммуналку',
  afterUtilitiesCredit: (amount: string) => `после коммуналки в плюсе ${amount}`,
  afterUtilitiesDue: (amount: string) => `после коммуналки к доплате ${amount}`,
  purchaseBreakdown: 'По покупкам',

  // Household overview
  overviewTitle: (household: string, month: string) => `🏠 ${household} · ${month}`,
  totalLeft: (amount: string) => `Осталось ${amount}`,
  allPaid: 'Всё оплачено',
  purchasesGoToUtilities: 'Покупки идут в счёт коммуналки',
  purchasesGoToRent: 'Покупки идут в счёт аренды',
  purchasesSeparate: 'Покупки считаются отдельно',
  recentTitle: 'Последнее:',
  rentPayment: 'оплата аренды',
  utilitiesPayment: 'оплата коммуналки',
  membersTitle: 'Участники:',
  memberAway: 'в отъезде',
  memberLeft: 'не живёт',
  memberSettled: 'закрыто',
  memberCoveredByPurchases: 'закрыто покупками',

  // Purchases view (HTML)
  purchasesTitle: (month: string) => `🛒 <b>Покупки за ${month}</b>`,
  splitEveryone: 'на всех',
  splitOnly: (names: string) => `только ${names}`,
  noOpenPurchases: 'Все покупки уже учтены.',

  // My bill
  myBillTitle: (month: string) => `Мой счёт за ${month}`,
  myBillTitleWithHousehold: (household: string, month: string) =>
    `${household} · мой счёт за ${month}`,
  myBillLeft: (amount: string) => `Осталось оплатить: ${amount}`,
  myBillSettled: 'Всё закрыто',
  monthTotal: (total: string, paid: string) => `За месяц: ${total} · оплачено ${paid}`,
  memberMissing: 'Вас нет в расчёте за этот месяц.',

  // Utilities card
  utilitiesTitle: (month: string, day: string) => `💡 Коммуналка за ${month} · до ${day}`,
  utilitiesDetailsTitle: (month: string, day: string) =>
    `💡 Коммуналка за ${month}, подробно · до ${day}`,
  billsTotal: (total: string, share: string) => `Счета: ${total} · по ${share} на человека`,
  utilitiesUnassigned: 'Счета за коммуналку пока не распределены.',
  utilitiesNothingThisMonth: 'По коммуналке в этом месяце платить не нужно.',
  share: (amount: string) => `Доля: ${amount}`,
  memberPaid: 'оплачено',
  memberCovered: 'закрыто покупками',
  memberNothingToPay: 'платить не нужно',
  viewerLeft: (amount: string) => `Осталось оплатить: ${amount}`,
  viewerPaid: 'Уже оплачено.',
  viewerCovered: 'Закрыто покупками.',
  viewerNothingToPay: 'В этом месяце платить не нужно.',
  billAlreadyPaid: (amount: string) => `уже оплачено: ${amount}`,
  billProvider: (value: string) => `провайдер: ${value}`,
  billCustomerNumber: (value: string) => `лицевой счёт: ${value}`,
  billLink: (value: string) => `ссылка: ${value}`,
  billNote: (value: string) => `примечание: ${value}`,

  // Rent card (HTML)
  rentTitle: (month: string, day: string) => `🏠 <b>Аренда за ${month}</b> · до ${day}`,
  rentRate: (from: string, rate: string, to: string) => `Курс: 1 ${from} = ${rate} ${to}`,
  rentRateAsOf: (day: string) => `на ${day}`,
  rentViewerDue: (amount: string) => `К оплате: <b>${amount}</b>`,
  rentViewerPaid: 'Уже оплачено',
  rentMemberPaid: 'оплачено',
  whereToPay: '<b>Куда переводить</b>',
  recipient: (value: string) => `Получатель: ${value}`,
  account: (value: string) => `Счёт: <code>${value}</code>`,
  link: (value: string) => `Ссылка: ${value}`,
  note: (value: string) => `Примечание: ${value}`,

  // Nothing due right now
  idleTitle: '✅ Сейчас платить нечего',
  idleUtilitiesDue: (day: string) => `Коммуналка — до ${day}`,
  idleRentDue: (day: string) => `Аренда — до ${day}`
}

const en: typeof ru = {
  useInGroup: 'This command only works in the household group.',
  householdNotConfigured: '⚠️ This chat is not linked to a household yet — run /setup.',
  unableToIdentifySender: "⚠️ Couldn't tell who sent this command. Please try again.",
  notMember: "🔒 You're not a member of this household.",
  noMonth: '📅 Nothing for this month yet.',
  billUsage: 'No such option. Try /bill, /bill rent or /bill utilities.',
  chooseHousehold: 'Which household?',

  householdBillButton: 'Household bill',
  myBillButton: 'My bill',
  detailsButton: 'Details',
  purchasesButton: 'Purchases',
  overviewButton: 'Overview',
  appButton: '📱 App',
  markPlannedPaidButton: '✅ Mark paid',
  copyAccountButton: (bank: string) => `📋 ${bank}`,

  alreadyPaidToast: 'Already paid',
  plannedPaidToast: 'Utilities paid — thanks!',

  rent: 'Rent',
  utilities: 'Utilities',
  purchases: 'Purchases',
  household: 'Household',
  of: 'of',
  more: (count: number) => `${count} more`,
  dueBy: (day: string) => `due ${day}`,
  left: (amount: string) => `${amount} left`,
  rentDue: (day: string) => `rent due ${day}`,
  utilitiesDue: (day: string) => `utilities due ${day}`,

  purchaseCredit: (amount: string) => `${amount} in credit`,
  purchaseDue: (amount: string) => `${amount} owed`,
  creditComesBack: 'comes back through the next utilities bills',
  dueGoesIn: 'goes into the next utilities bill',
  afterUtilitiesCredit: (amount: string) => `${amount} in credit after utilities`,
  afterUtilitiesDue: (amount: string) => `${amount} due after utilities`,
  purchaseBreakdown: 'By purchase',

  overviewTitle: (household: string, month: string) => `🏠 ${household} · ${month}`,
  totalLeft: (amount: string) => `${amount} left`,
  allPaid: 'All paid',
  purchasesGoToUtilities: 'Purchases go towards utilities',
  purchasesGoToRent: 'Purchases go towards rent',
  purchasesSeparate: 'Purchases are settled separately',
  recentTitle: 'Latest:',
  rentPayment: 'rent payment',
  utilitiesPayment: 'utilities payment',
  membersTitle: 'Members:',
  memberAway: 'away',
  memberLeft: 'moved out',
  memberSettled: 'settled',
  memberCoveredByPurchases: 'covered by purchases',

  purchasesTitle: (month: string) => `🛒 <b>Purchases for ${month}</b>`,
  splitEveryone: 'everyone',
  splitOnly: (names: string) => `only ${names}`,
  noOpenPurchases: 'All purchases are settled.',

  myBillTitle: (month: string) => `My bill for ${month}`,
  myBillTitleWithHousehold: (household: string, month: string) =>
    `${household} · my bill for ${month}`,
  myBillLeft: (amount: string) => `Left to pay: ${amount}`,
  myBillSettled: 'All settled',
  monthTotal: (total: string, paid: string) => `This month: ${total} · paid ${paid}`,
  memberMissing: "You're not in this month's calculation.",

  utilitiesTitle: (month: string, day: string) => `💡 Utilities for ${month} · due ${day}`,
  utilitiesDetailsTitle: (month: string, day: string) =>
    `💡 Utilities for ${month}, in detail · due ${day}`,
  billsTotal: (total: string, share: string) => `Bills: ${total} · ${share} per person`,
  utilitiesUnassigned: "Utility bills aren't assigned yet.",
  utilitiesNothingThisMonth: 'No utilities to pay this month.',
  share: (amount: string) => `Share: ${amount}`,
  memberPaid: 'paid',
  memberCovered: 'covered by purchases',
  memberNothingToPay: 'nothing to pay',
  viewerLeft: (amount: string) => `Left to pay: ${amount}`,
  viewerPaid: 'Already paid.',
  viewerCovered: 'Covered by purchases.',
  viewerNothingToPay: 'Nothing to pay this month.',
  billAlreadyPaid: (amount: string) => `already paid: ${amount}`,
  billProvider: (value: string) => `provider: ${value}`,
  billCustomerNumber: (value: string) => `account: ${value}`,
  billLink: (value: string) => `link: ${value}`,
  billNote: (value: string) => `note: ${value}`,

  rentTitle: (month: string, day: string) => `🏠 <b>Rent for ${month}</b> · due ${day}`,
  rentRate: (from: string, rate: string, to: string) => `Rate: 1 ${from} = ${rate} ${to}`,
  rentRateAsOf: (day: string) => `as of ${day}`,
  rentViewerDue: (amount: string) => `To pay: <b>${amount}</b>`,
  rentViewerPaid: 'Already paid',
  rentMemberPaid: 'paid',
  whereToPay: '<b>Where to pay</b>',
  recipient: (value: string) => `Recipient: ${value}`,
  account: (value: string) => `Account: <code>${value}</code>`,
  link: (value: string) => `Link: ${value}`,
  note: (value: string) => `Note: ${value}`,

  idleTitle: '✅ Nothing to pay right now',
  idleUtilitiesDue: (day: string) => `Utilities — due ${day}`,
  idleRentDue: (day: string) => `Rent — due ${day}`
}

export const financeViewCopy: Record<BotLocale, typeof ru> = { ru, en }
