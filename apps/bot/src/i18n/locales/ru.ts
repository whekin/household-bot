import type { BotTranslationCatalog } from '../types'
import { formatUserFacingMoney } from '../money'

export const ruBotTranslations: BotTranslationCatalog = {
  localeName: 'Русский',
  commands: {
    start: 'Открыть стартовое меню дома',
    help: 'Показать подсказки по задачам',
    settings: 'Открыть настройки и быстрые действия дома',
    home: 'Открыть центр управления домом',
    bill: 'Показать общий счёт по дому',
    bill_full: 'Показать общий счёт со всеми покупками',
    my_bill: 'Показать вашу финансовую сводку',
    my_bill_full: 'Показать ваш счёт подробно',
    bill_json: 'Выгрузить расчёты по платежам в JSON',
    household_status: 'Показать текущий статус дома',
    balance: 'Показать балансы по покупкам для всех участников',
    utilities: 'Показать шаблон для ввода коммуналки в этом топике',
    anon: 'Отправить анонимное сообщение по дому',
    cancel: 'Отменить текущий ввод',
    setup: 'Подключить эту группу как дом',
    unsetup: 'Сбросить настройку топиков для этой группы',
    bind: 'Привязать текущий топик к конкретной роли',
    join_link: 'Получить ссылку для приглашения новых участников',
    payment_add: 'Подтвердить оплату аренды или коммуналки',
    pending_members: 'Показать ожидающие заявки на вступление',
    approve_member: 'Подтвердить участника дома',
    app: 'Открыть мини-приложение Kojori',
    dashboard: 'Открыть дашборд дома',
    keyboard: 'Показать постоянную кнопку дашборда'
  },
  help: {
    intro:
      '🏡 /home открывает главное меню. Начинайте с него; список команд ниже — только быстрый доступ.',
    introWithoutHome:
      '🏡 Я помогу с финансовыми задачами дома. Ниже — команды, доступные прямо сейчас.',
    tasksHeading: 'Частые задачи:',
    checkMyBill: '• 💸 Проверить, сколько вы должны: /home → Мой счёт',
    checkHouseholdStatus: '• 🏠 Посмотреть статус дома: /home → Статус',
    checkBalances: '• 🛒 Проверить балансы по покупкам: /home → Балансы',
    recordPurchase: '• 🧾 Записать общую покупку: отправьте текст чека в топик покупок',
    recordPayment: '• ✅ Подтвердить оплату: отправьте сообщение об оплате в топик оплат',
    openDashboard: '• 📱 Открыть дашборд: /home → Мини-приложение',
    setupHousehold: '• 🧰 Настроить или обслуживать дом: /home → Настройка/админ',
    manageMembers: '• 👥 Пригласить и подтвердить участников: /home → Настройка/админ',
    advancedHeading: 'Быстрые команды:',
    privateChatHeading: 'Личный чат:',
    groupHeading: 'Группа дома:',
    groupAdminsHeading: 'Админы группы:'
  },
  home: {
    title: '🏡 <b>Центр управления домом</b>',
    introPrivate: 'Выберите задачу. Список команд не будет мешать.',
    introGroup: 'Управляйте финансами дома прямо в Telegram.',
    myBillButton: '💸 Мой счёт',
    householdStatusButton: '🏠 Статус',
    balancesButton: '🛒 Балансы',
    fullBillButton: '🔎 Весь счёт',
    menuButton: '🏡 Меню',
    miniAppButton: '📱 Мини-приложение',
    setupButton: '🧰 Настройка/админ',
    feedbackButton: '🕶 Анонимно',
    helpButton: '❔ Помощь',
    setupMenuTitle: '🧰 <b>Настройка/админ</b>',
    setupMenuBody:
      'Используйте /setup в группе дома, чтобы подключить её, /bind внутри топика, чтобы привязать его, /join_link для приглашения участников и /pending_members для подтверждения заявок.',
    feedbackMenuTitle: '🕶 <b>Анонимное сообщение</b>',
    feedbackMenuBody:
      'Используйте /anon в этом личном чате, чтобы отправить сообщение по дому анонимно.'
  },
  common: {
    unableToIdentifySender: '⚠️ Не удалось определить отправителя для этой команды.',
    useHelp: 'ℹ️ Отправьте /help, чтобы увидеть доступные команды.'
  },
  setup: {
    onlyTelegramAdmins: '🔒 Только админы Telegram-группы могут запускать /setup.',
    useSetupInGroup: 'ℹ️ Используйте /setup внутри группы дома.',
    onlyTelegramAdminsBindTopics: '🔒 Только админы Telegram-группы могут привязывать топики дома.',
    householdNotConfigured: '⚠️ Для этого чата дом ещё не настроен. Сначала выполните /setup.',
    useCommandInTopic: 'ℹ️ Запустите эту команду внутри нужного топика.',
    onlyHouseholdAdmins: '🔒 Только админы дома могут управлять ожидающими участниками.',
    pendingNotFound:
      '🤷 Ожидающий участник не найден. Используйте /pending_members, чтобы посмотреть очередь.',
    pendingMembersHeading: (householdName) => `👥 <b>Заявки на вступление · ${householdName}</b>`,
    pendingMembersHint:
      '<i>Нажмите кнопку ниже, чтобы подтвердить участника, или используйте /approve_member &lt;telegram_user_id&gt;.</i>',
    pendingMembersEmpty: (householdName) =>
      `🤷 Для <b>${householdName}</b> нет ожидающих участников.`,
    pendingMemberLine: (member, index) =>
      `${index + 1}. <b>${member.displayName}</b> · <code>${member.telegramUserId}</code>${member.username ? ` · @${member.username}` : ''}`,
    openMiniAppButton: '📱 Открыть мини-приложение',
    openMiniAppFromPrivateChat: '📱 Откройте мини-приложение по кнопке ниже.',
    openMiniAppUnavailable: '⚠️ Мини-приложение сейчас не настроено.',
    joinHouseholdButton: '🤝 Вступить в дом',
    approveMemberButton: (displayName) => `✅ ${displayName}`,
    telegramIdentityRequired: '⚠️ Чтобы вступить в дом, нужна Telegram-учётка пользователя.',
    invalidJoinLink: '🚫 Некорректная ссылка-приглашение в дом.',
    joinLinkInvalidOrExpired: '⌛ Эта ссылка-приглашение в дом недействительна или устарела.',
    alreadyActiveMember: (displayName) =>
      `✅ Вы уже в составе дома. Откройте мини-приложение, чтобы увидеть профиль <b>${displayName}</b>.`,
    joinRequestSent: (householdName) =>
      `📨 Заявка на вступление в <b>${householdName}</b> отправлена. Дождитесь подтверждения от админа дома.`,
    setupSummary: ({ householdName, created }) =>
      `🏡 <b>${created ? 'Новый дом' : 'Дом активен'}: ${householdName}</b>\n\n` +
      `Базовая настройка выполнена. Теперь давайте распределим общение, привязав топики к конкретным ролям.`,
    setupTopicsHeading: (configured, total) =>
      `🧩 <b>Прогресс настройки: ${configured}/${total}</b>\n\n` +
      `Нажмите кнопки ниже, чтобы создать топики автоматически, или перейдите в любой существующий топик и используйте /bind, чтобы привязать его вручную.`,
    setupTopicBound: (role) => `✅ ${role}`,
    setupTopicMissing: (role) => `⚪ ${role}`,
    setupTopicCreateButton: (role) => `➕ ${role}`,
    setupTopicBindButton: (role) => `🔗 ${role}`,
    useBindInTopic: 'ℹ️ Используйте /bind внутри топика, чтобы привязать его к роли.',
    topicAlreadyBound: (role) => `ℹ️ Этот топик уже привязан к роли «${role}».`,
    bindSelectRole: '🔗 Привязать этот топик к:',
    topicBoundSuccess: (role, householdName) =>
      `✅ Топик привязан как «${role}» для ${householdName}.`,
    allRolesConfigured: '✅ Все роли топиков уже настроены.',
    setupTopicCreateFailed:
      '⚠️ Не удалось создать этот топик. Проверьте права бота и включённые форум-топики в группе.',
    setupTopicCreateForbidden:
      '🔒 Мне нужны права на управление топиками в этой группе, чтобы создать его автоматически.',
    setupTopicCreated: (role, topicName) => `✅ Топик ${role} создан и привязан: ${topicName}.`,
    setupTopicBindPending: '',
    setupTopicBindCancelled: 'Режим привязки топика очищен.',
    setupTopicBindNotAvailable: 'Это действие привязки топика уже недоступно.',
    setupTopicBindRoleName: (role) => {
      switch (role) {
        case 'chat':
          return 'Общение'
        case 'purchase':
          return 'Покупки'
        case 'feedback':
          return 'Фидбек'
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
          return 'Анонимная обратная связь'
        case 'reminders':
          return 'Напоминания'
        case 'payments':
          return 'Оплаты'
        case 'notifications':
          return 'Уведомления'
      }
    },
    onlyTelegramAdminsUnsetup: '🔒 Только админы Telegram-группы могут запускать /unsetup.',
    useUnsetupInGroup: 'ℹ️ Используйте /unsetup внутри группы дома.',
    unsetupComplete: (householdName) =>
      `🧹 Состояние настройки для <b>${householdName}</b> сброшено. Запустите /setup ещё раз, чтобы заново настроить топики.`,
    unsetupNoop:
      'ℹ️ Для этой группы пока нечего сбрасывать. Когда будете готовы, запустите /setup.',
    usePendingMembersInGroup: 'ℹ️ Используйте /pending_members внутри группы дома.',
    useApproveMemberInGroup: 'ℹ️ Используйте /approve_member внутри группы дома.',
    approveMemberUsage: 'ℹ️ Использование: /approve_member <telegram_user_id>',
    onlyInviteAdmins:
      '🔒 Приглашать участников могут только админы Telegram-группы или админы дома.',
    approvedMember: (displayName, householdName) =>
      `✅ Для <b>${displayName}</b> открыт доступ к дому <b>${householdName}</b>.`,
    useButtonInGroup: 'ℹ️ Используйте эту кнопку в группе дома.',
    unableToIdentifySelectedMember: '⚠️ Не удалось определить выбранного участника.',
    approvedMemberToast: (displayName) => `✅ Доступ открыт: ${displayName}.`,
    useJoinLinkInGroup: 'ℹ️ Используйте /join_link внутри группы дома.',
    joinLinkUnavailable: '⚠️ Не удалось сгенерировать ссылку для вступления.',
    joinLinkReady: (link, householdName) =>
      `🔗 <b>Ссылка-приглашение · ${householdName}</b>\n\n<code>${link}</code>\n\n<i>Любой, у кого есть эта ссылка, может подать заявку на вступление.</i>`
  },
  keyboard: {
    dashboardButton: '🏡 Дашборд',
    enabled: 'Кнопка дашборда включена.',
    disabled: 'Кнопка дашборда выключена.'
  },
  anonymousFeedback: {
    title: '🕶 <b>Анонимное сообщение по дому</b>',
    cancelButton: '🚫 Отменить',
    unableToStart: '⚠️ Сейчас не удалось начать анонимное сообщение.',
    prompt: '🕶 Отправьте анонимное сообщение следующим сообщением или нажмите «Отменить».',
    unableToIdentifyMessage: '⚠️ Не удалось определить это сообщение для анонимной отправки.',
    notMember: '🔒 Вы не являетесь участником этого дома.',
    multipleHouseholds:
      'ℹ️ Вы состоите в нескольких домах. Откройте нужный дом из его группы, пока выбор дома ещё не добавлен.',
    feedbackTopicMissing:
      '⚠️ Для вашего дома ещё не настроен анонимный топик. Попросите админа выполнить /setup и создать топик для обратной связи.',
    duplicate: '♻️ Это анонимное сообщение уже было обработано.',
    delivered: '✅ Анонимное сообщение отправлено.',
    savedButPostFailed:
      '⚠️ Анонимное сообщение сохранено, но публикация не удалась. Попробуйте позже.',
    nothingToCancel: 'ℹ️ Сейчас нечего отменять.',
    cancelled: '🚫 Отменено.',
    cancelledMessage: '🚫 Анонимное сообщение отменено.',
    useInPrivateChat: 'ℹ️ Используйте /anon в личном чате с ботом.',
    useThisInPrivateChat: 'ℹ️ Используйте это в личном чате с ботом.',
    tooShort: '✂️ Анонимное сообщение слишком короткое. Добавьте немного деталей.',
    tooLong: '✂️ Анонимное сообщение слишком длинное. Ограничьтесь 500 символами.',
    cooldown: (retryDelay) =>
      `⏳ Сейчас действует пауза на анонимные сообщения. Следующее сообщение можно отправить ${retryDelay}.`,
    dailyCap: (retryDelay) =>
      `⏳ Достигнут дневной лимит анонимных сообщений. Следующее сообщение можно отправить ${retryDelay}.`,
    blocklisted: '🚫 Сообщение отклонено модерацией. Перепишите его спокойнее и без агрессии.',
    submitFailed: '⚠️ Не удалось отправить анонимное сообщение.',
    keepPromptSuffix: 'Отправьте исправленный текст или нажмите «Отменить».',
    retryNow: 'сейчас',
    retryInLessThanMinute: 'меньше чем через минуту',
    retryIn: (parts) => `через ${parts}`,
    day: (count) => `${count} ${count === 1 ? 'день' : count < 5 ? 'дня' : 'дней'}`,
    hour: (count) => `${count} ${count === 1 ? 'час' : count < 5 ? 'часа' : 'часов'}`,
    minute: (count) => `${count} ${count === 1 ? 'минуту' : count < 5 ? 'минуты' : 'минут'}`
  },
  assistant: {
    noHousehold:
      'ℹ️ Я смогу помочь после того, как ваш Telegram-профиль будет привязан к дому. Сначала откройте группу дома и завершите вступление.',
    multipleHouseholds:
      'ℹ️ Вы состоите в нескольких домах. Откройте нужный дом из его группы, пока прямой выбор дома ещё не добавлен.',
    temporarilyUnavailable: '⚠️ Сейчас не могу ответить. Попробуйте ещё раз через минуту.',
    rateLimited: (retryDelay) =>
      `⏳ Лимит сообщений ассистенту исчерпан. Попробуйте ${retryDelay}.`,
    retryInLessThanMinute: 'меньше чем через минуту',
    retryIn: (parts) => `через ${parts}`,
    hour: (count) => `${count} ${count === 1 ? 'час' : count < 5 ? 'часа' : 'часов'}`,
    minute: (count) => `${count} ${count === 1 ? 'минуту' : count < 5 ? 'минуты' : 'минут'}`,
    paymentProposal: (kind, amount, currency) =>
      `Я могу записать эту оплату ${kind === 'rent' ? 'аренды' : 'коммуналки'}: ${formatUserFacingMoney(amount, currency)}. Подтвердите или отмените ниже.`
  },
  finance: {
    useInGroup: 'ℹ️ Используйте эту команду внутри группы дома.',
    householdNotConfigured: '⚠️ Для этого чата дом ещё не настроен. Сначала выполните /setup.',
    unableToIdentifySender: '⚠️ Не удалось определить отправителя для этой команды.',
    notMember: 'Вы не являетесь участником этого дома.',
    adminOnly: '🔒 Эту команду могут использовать только админы дома.',
    cycleOpenUsage: 'ℹ️ Использование: /cycle_open <YYYY-MM> [USD|GEL]',
    cycleOpened: (period, currency) => `✅ Период открыт: ${period} (${currency})`,
    cycleOpenFailed: (message) => `⚠️ Не удалось открыть период: ${message}`,
    noCycleToClose: '🤷 Не найден период для закрытия.',
    cycleClosed: (period) => `✅ Период закрыт: ${period}`,
    cycleCloseFailed: (message) => `⚠️ Не удалось закрыть период: ${message}`,
    rentSetUsage: 'ℹ️ Использование: /rent_set <amount> [USD|GEL] [YYYY-MM]',
    rentNoPeriod: '🤷 Период не указан и открытый цикл не найден.',
    rentSaved: (amount, currency, period) =>
      `✅ Правило аренды сохранено: ${formatUserFacingMoney(amount, currency)}, начиная с ${period}`,
    rentSaveFailed: (message) => `⚠️ Не удалось сохранить правило аренды: ${message}`,
    utilityAddUsage: 'ℹ️ Использование: /utility_add <name> <amount> [USD|GEL]',
    utilityNoOpenCycle: '🤷 Открытый период не найден. Сначала выполните /cycle_open.',
    utilityAdded: (name, amount, currency, period) =>
      `✅ Коммунальный счёт добавлен: ${name} ${formatUserFacingMoney(amount, currency)} за ${period}`,
    utilityAddFailed: (message) => `⚠️ Не удалось добавить коммунальный счёт: ${message}`,
    paymentAddUsage: 'ℹ️ Использование: /payment_add <rent|utilities> [amount] [USD|GEL]',
    paymentNoCycle: '🤷 Биллинг-цикл пока не готов.',
    paymentNoBalance: 'ℹ️ Сейчас для этого типа оплаты нет суммы к подтверждению.',
    paymentAdded: (kind, amount, currency, period) =>
      `✅ Оплата сохранена: ${kind === 'rent' ? 'аренда' : 'коммуналка'} ${formatUserFacingMoney(amount, currency)} за ${period}`,
    paymentAddFailed: (message) => `⚠️ Не удалось сохранить оплату: ${message}`,
    noStatementCycle: '🤷 Для выписки период не найден.',
    statementTitle: (period) => `🧾 <b>Выписка · ${period}</b>`,
    statementLine: (displayName, amount, currency) =>
      `👤 ${displayName} — <b>${formatUserFacingMoney(amount, currency)}</b>`,
    statementTotal: (amount, currency) =>
      `💰 <b>Итого: ${formatUserFacingMoney(amount, currency)}</b>`,
    statementFailed: (message) => `⚠️ Не удалось построить выписку: ${message}`,
    utilitiesTopicRequired: 'ℹ️ Эта команда должна использоваться внутри топика.',
    utilitiesNotLinked: '⚠️ Этот топик не привязан к домохозяйству.',
    chooseHouseholdForBalances: '🏠 Выберите дом для балансов:'
  },
  reminders: {
    utilities: (period) => `Напоминание по коммунальным платежам за ${period}`,
    rentWarning: (period) => `Напоминание по аренде за ${period}: срок оплаты скоро наступит.`,
    rentDue: (period) => `Напоминание по аренде за ${period}: пожалуйста, оплатите сегодня.`,
    guidedEntryButton: 'Ввести по шагам',
    copyTemplateButton: 'Шаблон',
    openDashboardButton: 'Открыть дашборд',
    dashboardDetailsHint: 'Подробности и история платежей — в дашборде.',
    noActiveCategories:
      'Для этого дома пока нет активных категорий коммуналки. Сначала добавьте их в дашборде.',
    startToast: 'Пошаговый ввод коммуналки запущен.',
    templateToast: 'Шаблон коммуналки отправлен.',
    promptAmount: (categoryName, currency, remainingCount) =>
      `Ответьте суммой для «${categoryName}» в ${currency}. Отправьте 0 или «пропуск», если эту категорию не нужно добавлять.${remainingCount > 0 ? ` После этого останется ещё ${remainingCount}.` : ''}`,
    invalidAmount: (categoryName, currency) =>
      `Не удалось распознать сумму для «${categoryName}». Отправьте число в ${currency} или 0 / «пропуск».`,
    templateIntro: (currency) =>
      `Заполните суммы по коммуналке ниже в ${currency}, затем отправьте заполненное сообщение обратно в этот топик.`,
    templateInstruction:
      'Для любой категории, которую не нужно добавлять, оставьте поле пустым, удалите строку целиком или укажите 0 / «пропуск».',
    templateInvalid:
      'Не удалось распознать ни одной суммы в этом шаблоне. Отправьте заполненный шаблон хотя бы с одной суммой.',
    summaryTitle: (period) => `Коммунальные начисления за ${period}`,
    summaryLine: (categoryName, amount, currency) =>
      `- ${categoryName}: ${formatUserFacingMoney(amount, currency)}`,
    confirmPrompt: 'Подтвердите или отмените ниже.',
    confirmButton: 'Сохранить коммуналку',
    cancelButton: 'Отменить',
    cancelled: 'Ввод коммуналки отменён.',
    saved: (count, period) =>
      `Сохранено ${count} ${count === 1 ? 'начисление коммуналки' : 'начислений коммуналки'} за ${period}.`,
    paymentInstructionSent: 'Инструкция по оплате отправлена в топик оплат.',
    proposalUnavailable: 'Это предложение по коммуналке уже недоступно.',
    onlyOriginalSender: 'Подтвердить это добавление коммуналки может только тот, кто его начал.',
    paidButton: 'Отметить оплату',
    paidUtilitiesButton: 'Я оплатил свои счета',
    closeUnpaidButton: 'Закрыть неоплаченных',
    confirmCloseButton: 'Подтвердить закрытие',
    fullyPaid: (kind, month) =>
      `${kind === 'rent' ? 'Аренда' : 'Коммуналка'} за ${month} полностью оплачена.`,
    alreadyPaid: 'Уже отмечено как оплачено.',
    notMember: 'Не удалось сопоставить вас с участником дома.',
    adminOnly: 'Это действие доступно только админам дома.',
    paymentRecordedToast: 'Оплата отмечена.',
    reminderUnavailable: 'Это напоминание уже недоступно.',
    noRentDestinations: 'Реквизиты для аренды пока не настроены.',
    everyonePaid: 'Все оплаты закрыты',
    noUtilityPlan: 'План коммуналки пока не готов.'
  },
  purchase: {
    sharedPurchaseFallback: 'общая покупка',
    clarificationPhotoOnly:
      'Фото вижу, но мне всё ещё нужны предмет и итоговая сумма. Что именно купили и на сколько?',
    proposal: (
      summary: string,
      payer: string | null,
      calculationNote: string | null,
      participants: string | null
    ) =>
      [
        '🛒 <b>Похоже, это общая покупка</b>',
        '',
        `🧾 ${summary}`,
        ...(payer ? [payer] : []),
        ...(calculationNote ? ['', `🤔 ${calculationNote}`] : []),
        ...(participants ? ['', participants] : []),
        '',
        '<i>Подтвердите или отмените ниже 👇</i>'
      ].join('\n'),
    calculatedAmountNote: (explanation: string | null) =>
      explanation
        ? `Я посчитал итог как ${explanation}. Всё верно?`
        : 'Я посчитал итоговую сумму для этой покупки. Всё верно?',
    clarification: (question) => question,
    clarificationMissingAmountAndCurrency:
      'Какую сумму и валюту нужно записать для этой общей покупки?',
    clarificationMissingAmount: 'Какую сумму нужно записать для этой общей покупки?',
    clarificationMissingCurrency: 'В какой валюте была эта покупка?',
    clarificationMissingItem: 'Что именно было куплено?',
    clarificationLowConfidence:
      'Я не уверен, что правильно понял сообщение. Переформулируйте покупку с предметом, суммой и валютой.',
    summary: (description, amount) => `<b>${description}</b> — <b>${amount}</b>`,
    savedCardHeadline: (summary) => `🧾 ${summary}`,
    participantsHeading: '👥 <b>Участники</b>',
    participantIncluded: (displayName) => `• ${displayName}`,
    participantIncludedWithShare: (displayName, amount) => `• ${displayName} — <b>${amount}</b>`,
    participantExcluded: (displayName) => `• <s>${displayName}</s> · не участвует`,
    participantToggleIncluded: (displayName) => `✅ ${displayName}`,
    participantToggleExcluded: (displayName) => `⬜ ${displayName}`,
    splitEqualLine: (perHead) => (perHead ? `➗ Поровну · по ${perHead}` : '➗ Поровну'),
    splitCustomLine: '🧮 Индивидуальные суммы',
    payerLine: (displayName) => `💳 Плательщик: <b>${displayName}</b>`,
    payerQuestion: 'Кто именно это купил?',
    payerFallbackQuestion: 'Не понял, кто именно это купил. Выберите человека ниже.',
    payerButton: (displayName) => `Плательщик: ${displayName}`,
    payerSelectedToast: (displayName) => `Плательщик: ${displayName}.`,
    confirmButton: 'Подтвердить',
    calculatedConfirmButton: 'Верно',
    calculatedFixAmountButton: 'Исправить сумму',
    cancelButton: 'Отменить',
    calculatedFixAmountPrompt:
      '✏️ Ответьте в этот топик исправленной итоговой суммой и валютой, и я заново проверю покупку.',
    calculatedFixAmountRequestedToast: 'Ответьте исправленной суммой.',
    calculatedFixAmountAlreadyRequested: 'Жду исправленную сумму.',
    confirmed: (summary) => `✅ <b>Покупка записана</b>\n\n🧾 ${summary}`,
    cancelled: (summary) => `🚫 <b>Предложение отменено</b>\n\n🧾 ${summary}`,
    removed: '🗑 <b>Покупка удалена</b>',
    confirmedToast: 'Покупка подтверждена.',
    cancelledToast: 'Покупка отменена.',
    alreadyConfirmed: 'Эта покупка уже подтверждена.',
    alreadyCancelled: 'Это предложение покупки уже отменено.',
    atLeastOneParticipant: 'В распределении покупки должен остаться хотя бы один участник.',
    notYourProposal:
      'Подтвердить или отменить эту покупку может только отправитель сообщения или указанный покупатель.',
    proposalUnavailable: 'Это предложение покупки уже недоступно.',
    parseFailed:
      'Пока не удалось распознать это как общую покупку. Напишите предмет, сумму и валюту явно.'
  },
  agent: {
    confirmButton: '✅ Подтвердить',
    cancelButton: '🚫 Отмена',
    actionPrompt: (summary) => `🤖 ${summary}\n\nПодтвердите или отмените ниже 👇`,
    actionConfirmed: (summary) => `✅ Готово: ${summary}`,
    actionCancelled: '🚫 Действие отменено.',
    actionUnavailable: '⏳ Это действие уже недоступно.',
    notYourAction: '🔒 Подтвердить или отменить может только автор запроса или админ.',
    actionFailed: '⚠️ Не удалось выполнить действие. Ничего не изменено.',
    pendingProposalCancelled: '🚫 Ожидающее предложение оплаты отменено.',
    nothingToCancel: 'ℹ️ Сейчас нечего отменять.',
    summarizeUpdatePayment: (displayName, kind, amount, currency) =>
      `изменить оплату (${kind === 'rent' ? 'аренда' : 'коммуналка'}) участника ${displayName} на ${formatUserFacingMoney(amount, currency)}`,
    summarizeDeletePayment: (displayName, kind, amount, currency) =>
      `удалить оплату (${kind === 'rent' ? 'аренда' : 'коммуналка'}) участника ${displayName} на ${formatUserFacingMoney(amount, currency)}`,
    summarizeUpdatePurchase: (description, amount, currency) =>
      `изменить покупку «${description}» на ${formatUserFacingMoney(amount, currency)}`,
    summarizeDeletePurchase: (description, amount, currency) =>
      `удалить покупку «${description}» (${formatUserFacingMoney(amount, currency)})`,
    summarizeSetPurchaseParticipants: (description, names) =>
      `изменить участников покупки «${description}»: ${names}`,
    summarizeSetPeriodRent: (amount, currency, periods) =>
      `установить аренду ${formatUserFacingMoney(amount, currency)} для ${periods.join(', ')}`,
    summarizeSetHouseholdFact: (title, body, previousBody) =>
      previousBody === null
        ? `запомнить «${title}»: ${body}`
        : `заменить «${title}» (было: ${previousBody}) на: ${body}`,
    summarizeDeleteHouseholdFact: (title) => `забыть «${title}»`
  },
  payments: {
    topicMissing:
      '⚠️ Для этого дома ещё не настроен топик оплат. Попросите админа выполнить /setup и создать топик для оплат.',
    balanceReply: (kind) =>
      kind === 'rent' ? '📊 <b>Сводка по аренде</b>' : '📊 <b>Сводка по коммуналке</b>',
    proposal: (kind, amount, currency) =>
      `${kind === 'rent' ? '🏠' : '💡'} <b>Оплата ${kind === 'rent' ? 'аренды' : 'коммуналки'}</b>\n💰 Сумма: <b>${formatUserFacingMoney(amount, currency)}</b>`,
    proposalReported: (displayName, kind, amount, currency) =>
      `${kind === 'rent' ? '🏠' : '💡'} <b>Оплата ${kind === 'rent' ? 'аренды' : 'коммуналки'}</b>\n👤 Плательщик: <b>${displayName}</b>\n💰 Сумма: <b>${formatUserFacingMoney(amount, currency)}</b>`,
    confirmHint: '<i>Подтвердите или отмените ниже 👇</i>',
    clarification:
      '❓ Пока не могу подтвердить эту оплату. Уточните, это аренда или коммуналка, и при необходимости напишите сумму и валюту.',
    unsupportedCurrency:
      '🚫 Сейчас я могу записывать оплаты в этом топике только в валюте расчётов по дому.',
    noBalance: 'ℹ️ Сейчас для этого типа оплаты нет суммы к подтверждению.',
    alreadySettled: (kind, displayName) =>
      displayName
        ? `✅ ${kind === 'rent' ? 'Аренда' : 'Коммуналка'} уже закрыта для ${displayName}.`
        : `✅ ${kind === 'rent' ? 'Аренда' : 'Коммуналка'} уже закрыта.`,
    settledPeriod: (kind, period, askPeriod, displayName) =>
      `${kind === 'rent' ? 'Аренда' : 'Коммуналка'} за ${period}${displayName ? ` у ${displayName}` : ''} уже оплачена.${askPeriod ? ' За какой период этот новый платёж?' : ''}`,
    purchaseRedirect:
      '🛒 Похоже на общую покупку, но этот топик у меня про оплаты. Закиньте это в топик покупок, и я там всё красиво подтвержу.',
    breakdownHeading: '📊 <b>Как посчитано</b>',
    breakdownBase: (kind, amount, currency) =>
      `${kind === 'rent' ? '🏠 Аренда к оплате' : '💡 Коммуналка к оплате'}: <b>${formatUserFacingMoney(amount, currency)}</b>`,
    breakdownPlannedBase: (kind, amount, currency) =>
      `${kind === 'rent' ? '🏠 Аренда к оплате' : '💡 Сумма по плану коммуналки'}: <b>${formatUserFacingMoney(amount, currency)}</b>`,
    breakdownPurchaseBalance: (amount, currency) =>
      `🛒 Баланс по общим покупкам: <b>${formatUserFacingMoney(amount, currency)}</b>`,
    breakdownSuggestedTotal: (amount, currency, policy) =>
      `🧮 Рекомендуемая сумма (${policy}): <b>${formatUserFacingMoney(amount, currency)}</b>`,
    breakdownRecordingAmount: (amount, currency) =>
      `✍️ Сумма из вашего сообщения: <b>${formatUserFacingMoney(amount, currency)}</b>`,
    breakdownRemaining: (amount, currency) =>
      `📉 Общий остаток: <b>${formatUserFacingMoney(amount, currency)}</b>`,
    adjustmentPolicy: (policy) =>
      policy === 'utilities'
        ? 'зачёт через коммуналку'
        : policy === 'rent'
          ? 'зачёт через аренду'
          : 'отдельный расчёт по покупкам',
    timingBeforeWindow: (kind, reminderDate, dueDate) =>
      `⏳ ${kind === 'rent' ? 'Аренду' : 'Коммуналку'} пока рано оплачивать. Следующее напоминание: ${reminderDate}. Срок оплаты: ${dueDate}.`,
    timingDueNow: (kind, dueDate) =>
      `⚠️ ${kind === 'rent' ? 'Аренду' : 'Коммуналку'} уже пора оплачивать. Срок оплаты: ${dueDate}.`,
    confirmButton: '✅ Подтвердить оплату',
    confirmSelectedButton: '✅ Подтвердить выбранных',
    cancelButton: '🚫 Отменить',
    multiProposal: (kind, period) =>
      `${kind === 'rent' ? '🏠' : '💡'} <b>Оплата ${kind === 'rent' ? 'аренды' : 'коммуналки'} · ${period}</b>`,
    multiMemberLine: (displayName, paymentStatus, selected) =>
      paymentStatus === 'paid'
        ? `✅ <s>${displayName}</s> · уже оплачено`
        : `${selected ? '☑️' : '⬜'} <b>${displayName}</b> · не оплачено`,
    multiRecorded: (kind, names) =>
      `✅ <b>Оплата ${kind === 'rent' ? 'аренды' : 'коммуналки'} записана</b>\n👥 ${names}`,
    multiAlreadyPaid: (kind, names) =>
      `☑️ ${kind === 'rent' ? 'Аренда' : 'Коммуналка'} уже оплачена: ${names}`,
    multiPartiallyRecorded: (kind, recordedNames, failedNames) =>
      `⚠️ <b>Оплата ${kind === 'rent' ? 'аренды' : 'коммуналки'} записана частично</b>\n✅ Записал: ${recordedNames}\n❌ Не удалось: ${failedNames}`,
    fullyPaid: (kind, period) =>
      `${kind === 'rent' ? 'Аренда' : 'Коммуналка'} за ${period} полностью закрыта.`,
    noMembersSelected: '⚠️ Сначала выберите хотя бы одного человека.',
    recorded: (kind, amount, currency) =>
      `✅ <b>Оплата ${kind === 'rent' ? 'аренды' : 'коммуналки'} записана</b>\n💰 <b>${formatUserFacingMoney(amount, currency)}</b>`,
    recordedReported: (displayName, kind, amount, currency) =>
      `✅ <b>Оплата ${kind === 'rent' ? 'аренды' : 'коммуналки'} записана</b>\n👤 <b>${displayName}</b> · <b>${formatUserFacingMoney(amount, currency)}</b>`,
    cancelled: '🚫 Предложение оплаты отменено.',
    proposalUnavailable: '⏳ Это предложение оплаты уже недоступно.',
    notYourProposal:
      '🔒 Подтвердить или отменить эту оплату может только отправитель сообщения или указанный плательщик.',
    multiNotYourProposal:
      '🔒 Управлять этим предложением оплаты может только отправитель сообщения.',
    savedForReview: '📝 Это подтверждение оплаты сохранено на проверку.',
    duplicate: '♻️ Это подтверждение оплаты уже было обработано.'
  }
}
