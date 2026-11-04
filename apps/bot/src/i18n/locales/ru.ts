import { formatMonthDisplay, pluralRu } from '@household/domain'

import type { BotTranslationCatalog } from '../types'
import { formatUserFacingMoney } from '../money'

const money = (amount: string, currency: string) => formatUserFacingMoney(amount, currency, 'ru')
const month = (period: string) => formatMonthDisplay(period, 'ru')
const months = (periods: readonly string[]) =>
  new Intl.ListFormat('ru', { type: 'conjunction' }).format(periods.map(month))
const kindNoun = (kind: 'rent' | 'utilities') => (kind === 'rent' ? 'аренда' : 'коммуналка')
const kindTitle = (kind: 'rent' | 'utilities') => (kind === 'rent' ? 'Аренда' : 'Коммуналка')
const kindAccusative = (kind: 'rent' | 'utilities') => (kind === 'rent' ? 'аренду' : 'коммуналку')
const kindGenitive = (kind: 'rent' | 'utilities') => (kind === 'rent' ? 'аренды' : 'коммуналки')
const kindEmoji = (kind: 'rent' | 'utilities') => (kind === 'rent' ? '🏠' : '💡')
const forMonth = (period: string | null) => (period ? ` за ${month(period)}` : '')
const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)

export const ruBotTranslations: BotTranslationCatalog = {
  localeName: 'Русский',
  commands: {
    start: 'Начать',
    help: 'Что умеет бот',
    home: 'Меню дома',
    bill: 'Сколько платить в этом месяце',
    app: 'Открыть приложение',
    anon: 'Анонимное сообщение',
    cancel: 'Отменить ввод',
    setup: 'Подключить группу',
    bind: 'Привязать топик',
    invite: 'Пригласить в дом'
  },
  help: {
    intro: '🏠 Что умеет бот',
    purchases: '🛒 Покупка — напишите в топик покупок, что купили и за сколько.',
    payments: '✅ Оплата — напишите в топик оплат, например «аренда оплачена».',
    bill: '💸 Сколько платить — /bill',
    app: '📱 Всё подробно — в приложении: /app',
    setup: '⚙️ Настройка дома — /setup, /bind, /invite',
    commandsHeading: 'Команды:'
  },
  home: {
    title: '🏠 <b>Меню дома</b>',
    introPrivate: 'Что посмотрим?',
    introGroup: 'Счета, оплаты и покупки — всё под рукой.',
    myBillButton: '💸 Мой счёт',
    householdStatusButton: '🏠 Весь дом',
    balancesButton: '🛒 Покупки',
    fullBillButton: '🔎 Подробно',
    routinesButton: '🧹 Дела',
    menuButton: '‹ Меню',
    miniAppButton: '📱 Приложение',
    setupButton: '⚙️ Настройка',
    feedbackButton: '🕶 Анонимно',
    helpButton: '❔ Помощь',
    setupMenuTitle: '⚙️ <b>Настройка дома</b>',
    setupMenuBody: [
      'В группе дома:',
      '/setup — подключить группу и создать топики',
      '/bind — привязать текущий топик',
      '/invite — ссылка-приглашение и заявки'
    ].join('\n'),
    feedbackMenuTitle: '🕶 <b>Анонимное сообщение</b>',
    feedbackMenuBody: 'Отправьте /anon здесь, в личке, — сообщение уйдёт в общий топик без имени.'
  },
  setup: {
    onlyTelegramAdmins: '🔒 /setup доступен только админам группы.',
    useSetupInGroup: 'Эта команда работает в группе дома.',
    onlyTelegramAdminsBindTopics: '🔒 Привязывать топики могут только админы группы.',
    householdNotConfigured: '⚠️ Эта группа ещё не подключена. Начните с /setup.',
    useCommandInTopic: 'Запустите команду внутри нужного топика.',
    onlyHouseholdAdmins: '🔒 Это могут только админы дома.',
    pendingNotFound: 'Заявка не найдена — возможно, её уже приняли.',
    inviteHeading: (householdName) => `🔗 <b>Приглашение в ${householdName}</b>`,
    pendingMembersHeading: 'Ждут подтверждения:',
    pendingMembersEmpty: 'Новых заявок нет.',
    pendingMemberLine: (member) =>
      `• <b>${member.displayName}</b>${member.username ? ` · @${member.username}` : ''}`,
    openMiniAppButton: '📱 Открыть приложение',
    openMiniAppFromPrivateChat: '📱 Приложение — по кнопке ниже.',
    openMiniAppUnavailable: '⚠️ Приложение пока не подключено.',
    joinHouseholdButton: 'Вступить в дом',
    approveMemberButton: (displayName) => `✅ ${displayName}`,
    telegramIdentityRequired: '⚠️ Не получилось определить ваш Telegram-аккаунт.',
    invalidJoinLink: '⚠️ Ссылка-приглашение не работает.',
    joinLinkInvalidOrExpired: '⚠️ Ссылка устарела — попросите у админа новую.',
    alreadyActiveMember: (displayName) =>
      `✅ Вы уже в доме как <b>${displayName}</b>. Всё остальное — в приложении.`,
    joinRequestSent: (householdName) =>
      `⏳ Заявка в <b>${householdName}</b> отправлена — осталось дождаться админа.`,
    setupSummary: ({ householdName, created }) =>
      `${created ? `🎉 <b>${householdName}</b> — новый дом готов!` : `🏠 <b>${householdName}</b> уже подключён.`}\n\n` +
      'Осталось разложить разговоры по топикам.',
    setupTopicsHeading: (configured, total) =>
      `<b>Топики: ${configured} из ${total}</b>\n` +
      'Создайте недостающие кнопками ниже или привяжите свои: /bind внутри топика.',
    setupTopicBound: (role) => `✅ ${role}`,
    setupTopicMissing: (role) => `⬜ ${role}`,
    setupTopicCreateButton: (role) => `+ ${role}`,
    bindSelectRole: 'Для чего этот топик?',
    topicBoundSuccess: (role) => `✅ Топик привязан: «${role}».`,
    allRolesConfigured: '✅ Все топики уже на месте.',
    setupTopicCreateFailed:
      '⚠️ Не получилось создать топик. Проверьте права бота и что в группе включены топики.',
    setupTopicCreateForbidden: '🔒 Чтобы создать топик, боту нужны права на управление топиками.',
    setupTopicCreated: (role, topicName) => `✅ Топик «${topicName}» создан: ${role}.`,
    setupTopicBindRoleName: (role) => {
      switch (role) {
        case 'chat':
          return 'Разговоры'
        case 'purchase':
          return 'Покупки'
        case 'feedback':
          return 'Анонимно'
        case 'reminders':
          return 'Напоминания'
        case 'payments':
          return 'Оплаты'
        case 'notifications':
          return 'Уведомления'
      }
    },
    setupTopicSuggestedName: (role) => {
      switch (role) {
        case 'chat':
          return 'Разговоры'
        case 'purchase':
          return 'Общие покупки'
        case 'feedback':
          return 'Анонимно'
        case 'reminders':
          return 'Напоминания'
        case 'payments':
          return 'Оплаты'
        case 'notifications':
          return 'Уведомления'
      }
    },
    onlyInviteAdmins: '🔒 Приглашать могут только админы.',
    useInviteInGroup: 'Отправьте /invite в группе дома.',
    approvedMember: (displayName, householdName) =>
      `🎉 <b>${displayName}</b> теперь в доме <b>${householdName}</b>!`,
    useButtonInGroup: 'Эта кнопка работает в группе дома.',
    unableToIdentifySelectedMember: 'Не получилось найти этого участника.',
    approvedMemberToast: (displayName) => `✅ ${displayName} в доме`,
    joinLinkUnavailable: '⚠️ Не получилось сделать ссылку-приглашение.'
  },
  anonymousFeedback: {
    title: '🕶 <b>Анонимное сообщение</b>',
    cancelButton: 'Отмена',
    unableToStart: '⚠️ Сейчас не получается начать. Попробуйте чуть позже.',
    prompt: '🕶 Напишите сообщение — оно уйдёт в общий топик без имени.',
    unableToIdentifyMessage: '⚠️ Не получилось прочитать это сообщение.',
    notMember: '🔒 Вы не участник этого дома.',
    multipleHouseholds: 'Вы состоите в нескольких домах. Начните из группы нужного дома.',
    feedbackTopicMissing:
      '⚠️ Анонимный топик ещё не настроен — админ может создать его через /setup.',
    duplicate: 'Это сообщение уже отправлено.',
    delivered: '✅ Отправлено анонимно.',
    savedButPostFailed: '⚠️ Сообщение сохранено, но опубликовать не вышло. Попробуйте позже.',
    nothingToCancel: 'Отменять нечего.',
    cancelled: 'Отменено',
    cancelledMessage: 'Анонимное сообщение отменено.',
    useInPrivateChat: '/anon работает в личке с ботом.',
    useThisInPrivateChat: 'Это работает в личке с ботом.',
    tooShort: 'Слишком коротко — добавьте пару деталей.',
    tooLong: 'Слишком длинно — уложитесь в 500 символов.',
    cooldown: (retryDelay) => `⏳ Небольшая пауза. Следующее сообщение — ${retryDelay}.`,
    dailyCap: (retryDelay) => `⏳ На сегодня лимит исчерпан. Следующее — ${retryDelay}.`,
    blocklisted: '⚠️ Сообщение не прошло модерацию. Попробуйте сформулировать спокойнее.',
    submitFailed: '⚠️ Не получилось отправить.',
    keepPromptSuffix: 'Пришлите исправленный текст или нажмите «Отмена».',
    retryNow: 'сейчас',
    retryInLessThanMinute: 'меньше чем через минуту',
    retryIn: (parts) => `через ${parts}`,
    day: (count) => `${count} ${pluralRu(count, ['день', 'дня', 'дней'])}`,
    hour: (count) => `${count} ${pluralRu(count, ['час', 'часа', 'часов'])}`,
    minute: (count) => `${count} ${pluralRu(count, ['минуту', 'минуты', 'минут'])}`
  },
  assistant: {
    noHousehold: 'Помогу, как только вы вступите в дом — начните из группы дома.',
    multipleHouseholds: 'Вы состоите в нескольких домах. Начните из группы нужного дома.',
    temporarilyUnavailable: '⚠️ Не могу ответить прямо сейчас. Попробуйте через минуту.',
    rateLimited: (retryDelay) => `⏳ Слишком много вопросов подряд. Продолжим ${retryDelay}.`,
    retryInLessThanMinute: 'меньше чем через минуту',
    retryIn: (parts) => `через ${parts}`,
    hour: (count) => `${count} ${pluralRu(count, ['час', 'часа', 'часов'])}`,
    minute: (count) => `${count} ${pluralRu(count, ['минуту', 'минуты', 'минут'])}`
  },
  finance: {
    useInGroup: 'ℹ️ Используйте эту команду внутри группы дома.',
    householdNotConfigured: '⚠️ Для этого чата дом ещё не настроен. Сначала выполните /setup.',
    unableToIdentifySender: '⚠️ Не удалось определить отправителя для этой команды.',
    notMember: 'Вы не являетесь участником этого дома.'
  },
  reminders: {
    utilities: (period) => `💡 Пора внести коммуналку за ${month(period)}`,
    rentWarning: (period) => `🏠 Скоро платить аренду за ${month(period)}`,
    rentDue: (period) => `🏠 Сегодня день аренды за ${month(period)}`,
    openDashboardButton: '📱 Приложение',
    invalidAmount: (categoryName, currency) =>
      `Не получилось разобрать сумму за «${categoryName}». Пришлите число в ${currency} или 0 / «пропуск».`,
    templateIntro: (currency) => `Впишите суммы в ${currency} и отправьте сообщение обратно сюда.`,
    templateInvalid: 'В шаблоне не нашлось ни одной суммы. Впишите хотя бы одну.',
    summaryLine: (categoryName, amount, currency) =>
      `• ${categoryName}: ${money(amount, currency)}`,
    confirmButton: '✅ Сохранить',
    cancelButton: 'Отмена',
    cancelled: 'Отменено.',
    saved: (count, period) =>
      `✅ ${count} ${pluralRu(count, ['счёт', 'счёта', 'счетов'])} за ${month(period)} сохранено.`,
    paymentInstructionSent: 'Реквизиты отправлены в топик оплат.',
    proposalUnavailable: 'Это уже неактуально',
    paidButton: '✅ Отметить оплату',
    paidUtilitiesButton: '✅ Отметить оплату',
    fullyPaid: (kind, monthLabel) => `${kindTitle(kind)} за ${monthLabel} оплачена`,
    alreadyPaid: 'Уже оплачено',
    notMember: 'Не получилось найти вас среди участников дома',
    paymentRecordedToast: 'Оплата отмечена',
    reminderUnavailable: 'Это напоминание уже неактуально',
    noRentDestinations: 'Реквизиты для аренды пока не добавлены.',
    everyonePaid: 'Все оплатили',
    noUtilityPlan: 'План коммуналки ещё не готов.'
  },
  purchase: {
    sharedPurchaseFallback: 'общая покупка',
    clarificationPhotoOnly: 'Фото есть, но нужны детали: что купили и за сколько?',
    proposal: (summary, payer, calculationNote, footer) =>
      [
        `🛒 ${summary}`,
        ...(payer ? [payer] : []),
        ...(calculationNote ? ['', calculationNote] : []),
        ...(footer ? ['', footer] : [])
      ].join('\n'),
    autoConfirmNote: 'Без ответа подтвердится через сутки',
    calculatedAmountNote: (explanation) =>
      explanation
        ? `Итог посчитан так: ${explanation}. Верно?`
        : 'Итог посчитан автоматически. Верно?',
    clarification: (question) => question,
    clarificationMissingAmountAndCurrency: 'Сколько стоило и в какой валюте?',
    clarificationMissingAmount: 'Сколько стоило?',
    clarificationMissingCurrency: 'В какой валюте?',
    clarificationMissingItem: 'Что купили?',
    clarificationLowConfidence: 'Не получилось разобрать. Напишите, что купили, сумму и валюту.',
    summary: (description, amount) => `<b>${description} · ${amount}</b>`,
    savedCardHeadline: (summary) => `🛒 ${summary}`,
    participantBalanceChange: (displayName, change) => `${displayName} ${change}`,
    participantPayerWithoutShare: (displayName, change) => `${displayName} ${change} (без доли)`,
    participantExcluded: (displayName) => `<s>${displayName}</s>`,
    participantToggleIncluded: (displayName) => `✅ ${displayName}`,
    participantToggleExcluded: (displayName) => `⬜ ${displayName}`,
    splitEqualLine: (participantCount, perHead) =>
      participantCount === 1
        ? 'на одного'
        : `поровну на ${participantCount}${perHead ? `, по ${perHead}` : ''}`,
    splitCustomLine: 'свои суммы',
    payerLine: (displayName) => `💳 ${displayName}`,
    payerSplitLine: (displayName, split) => `💳 ${displayName} · ${split}`,
    payerFallbackQuestion: 'Не ясно, кто платил. Выберите ниже.',
    payerButton: (displayName) => displayName,
    payerSelectedToast: (displayName) => `Платит ${displayName}`,
    confirmButton: '✅ Записать',
    calculatedConfirmButton: '✅ Верно',
    calculatedFixAmountButton: 'Исправить сумму',
    cancelButton: 'Отмена',
    calculatedFixAmountPrompt: '✏️ Напишите в ответ правильную сумму с валютой — пересчитаю.',
    calculatedFixAmountRequestedToast: 'Жду сумму',
    calculatedFixAmountAlreadyRequested: 'Уже жду сумму',
    confirmed: (summary) => `✅ ${summary}`,
    cancelled: (summary) => `Отменено: ${summary}`,
    removed: '🗑 Покупка удалена',
    confirmedToast: 'Записано',
    cancelledToast: 'Отменено',
    alreadyConfirmed: 'Уже записано',
    alreadyCancelled: 'Уже отменено',
    atLeastOneParticipant: 'Кто-то должен остаться в доле',
    notYourProposal: 'Подтвердить может только автор сообщения или тот, кто платил',
    participantChangeForbidden: 'Менять это могут только участники дома',
    proposalUnavailable: 'Это предложение уже неактуально',
    parseFailed: 'Не получилось понять покупку. Напишите, что купили, сумму и валюту.'
  },
  agent: {
    confirmButton: '✅ Подтвердить',
    cancelButton: 'Отмена',
    actionPrompt: (summary) => `🤖 ${capitalize(summary)}?`,
    actionConfirmed: (summary) => `✅ Готово: ${summary}`,
    actionCancelled: 'Отменено',
    actionUnavailable: 'Это действие уже неактуально',
    notYourAction: '🔒 Подтвердить может только автор запроса или админ',
    actionFailed: '⚠️ Не получилось — ничего не изменилось.',
    pendingProposalCancelled: 'Предложение оплаты отменено.',
    nothingToCancel: 'Отменять нечего.',
    summarizeUpdatePayment: (displayName, kind, amount, currency) =>
      `изменить оплату ${kindGenitive(kind)} (${displayName}) на ${money(amount, currency)}`,
    summarizeDeletePayment: (displayName, kind, amount, currency) =>
      `удалить оплату ${kindGenitive(kind)} (${displayName}, ${money(amount, currency)})`,
    summarizeUpdatePurchase: (description, amount, currency) =>
      `изменить покупку «${description}» на ${money(amount, currency)}`,
    summarizeDeletePurchase: (description, amount, currency) =>
      `удалить покупку «${description}» (${money(amount, currency)})`,
    summarizeSetPurchaseParticipants: (description, names) =>
      `поменять участников «${description}»: ${names}`,
    summarizeSetPeriodRent: (amount, currency, periods) =>
      `поставить аренду ${money(amount, currency)} на ${months(periods)}`,
    summarizeSetHouseholdFact: (title, body, previousBody) =>
      body === null
        ? `запомнить «${title}»`
        : previousBody === null
          ? `запомнить «${title}»: ${body}`
          : `обновить «${title}»: ${body} (было: ${previousBody})`,
    summarizeDeleteHouseholdFact: (title) => `забыть «${title}»`
  },
  payments: {
    recorded: (kind, amount, currency, period) =>
      `✅ ${kindTitle(kind)}${forMonth(period)} записана · ${money(amount, currency)}`,
    recordedReported: (displayName, kind, amount, currency, period) =>
      `✅ ${kindTitle(kind)}${forMonth(period)} записана · ${displayName} · ${money(amount, currency)}`,
    proposal: ({ kind, amount, currency, period, displayName, billName }) =>
      `${kindEmoji(kind)} Записать ${kindAccusative(kind)}${forMonth(period)}?\n<b>${[
        displayName,
        billName,
        money(amount, currency)
      ]
        .filter(Boolean)
        .join(' · ')}</b>`,
    clarification: 'Это аренда или коммуналка? Если можно, добавьте сумму.',
    unsupportedCurrency: '⚠️ Оплаты здесь записываются только в валюте дома.',
    alreadySettled: (kind, displayName) =>
      displayName
        ? `✅ ${displayName}: ${kindNoun(kind)} уже оплачена`
        : `✅ ${kindTitle(kind)} уже оплачена`,
    settledPeriod: (kind, period, askPeriod, displayName) =>
      `${kindTitle(kind)} за ${month(period)}${displayName ? ` (${displayName})` : ''} уже оплачена.${askPeriod ? ' За какой месяц эта оплата?' : ''}`,
    breakdownHeading: '<b>Как посчитано</b>',
    breakdownBase: (kind, amount, currency) =>
      `• ${kindTitle(kind)}: <b>${money(amount, currency)}</b>`,
    breakdownPlannedBase: (kind, amount, currency) =>
      `• ${kind === 'rent' ? 'Аренда' : 'По плану коммуналки'}: <b>${money(amount, currency)}</b>`,
    breakdownPurchaseBalance: (amount, currency) =>
      `• Баланс по покупкам: <b>${money(amount, currency)}</b>`,
    breakdownSuggestedTotal: (amount, currency, policy) =>
      `• Предлагаю записать (${policy}): <b>${money(amount, currency)}</b>`,
    breakdownRecordingAmount: (amount, currency) =>
      `• В сообщении: <b>${money(amount, currency)}</b>`,
    breakdownRemaining: (amount, currency) =>
      `• Осталось у всех: <b>${money(amount, currency)}</b>`,
    adjustmentPolicy: (policy) =>
      policy === 'utilities'
        ? 'зачёт через коммуналку'
        : policy === 'rent'
          ? 'зачёт через аренду'
          : 'покупки отдельно',
    timingBeforeWindow: (kind, reminderDate, dueDate) =>
      `⏳ За ${kindAccusative(kind)} пока рано: напомню ${reminderDate}, оплатить до ${dueDate}.`,
    timingDueNow: (kind, dueDate) =>
      `⏰ ${capitalize(kindAccusative(kind))} пора оплатить — до ${dueDate}.`,
    confirmButton: '✅ Записать',
    balanceUpdatePendingReminder:
      '⚠️ Баланс ещё пересчитывается — проверьте приложение перед следующей оплатой.',
    balanceUpdatePending:
      '⚠️ Оплата сохранена, но баланс ещё не пересчитан. Нажмите «Повторить» — второй раз оплата не запишется.',
    retryBalanceButton: 'Повторить',
    confirmSelectedButton: '✅ Записать',
    cancelButton: 'Отмена',
    multiProposal: (kind, period) =>
      `${kindEmoji(kind)} <b>${kindTitle(kind)} за ${month(period)}</b> — за кого?`,
    multiMemberLine: (displayName, paymentStatus, selected) =>
      paymentStatus === 'paid'
        ? `✅ <s>${displayName}</s> · уже оплачено`
        : `${selected ? '☑️' : '⬜'} ${selected ? `<b>${displayName}</b>` : displayName}`,
    multiMemberButton: (displayName, selected) => `${selected ? '☑️' : '⬜'} ${displayName}`,
    multiRecorded: (kind, period, names) =>
      `✅ <b>${kindTitle(kind)} за ${month(period)} записана</b>: ${names}`,
    multiAlreadyPaid: (names) => `Уже было оплачено: ${names}`,
    multiPartiallyRecorded: (recordedNames, failedNames) =>
      [
        '⚠️ <b>Записано не всё</b>',
        ...(recordedNames ? [`Готово: ${recordedNames}`] : []),
        ...(failedNames ? [`Не вышло: ${failedNames}`] : [])
      ].join('\n'),
    noMembersSelected: 'Выберите хотя бы одного',
    cancelled: 'Отменено',
    proposalUnavailable: 'Это предложение уже неактуально',
    notYourProposal: '🔒 Подтвердить может только автор сообщения или тот, за кого платят',
    multiNotYourProposal: '🔒 Менять список может только автор сообщения',
    duplicate: 'Эта оплата уже записана'
  }
}
