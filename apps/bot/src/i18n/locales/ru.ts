import type { BotTranslationCatalog } from '../types'

export const ruBotTranslations: BotTranslationCatalog = {
  localeName: 'Русский',
  commands: {
    help: 'Показать список команд',
    household_status: 'Показать текущий статус дома',
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
    keyboard: 'Вкл/выкл кнопку дашборда'
  },
  help: {
    intro: 'Бот для дома подключен.',
    privateChatHeading: 'Личный чат:',
    groupHeading: 'Группа дома:',
    groupAdminsHeading: 'Админы группы:'
  },
  common: {
    unableToIdentifySender: 'Не удалось определить отправителя для этой команды.',
    useHelp: 'Отправьте /help, чтобы увидеть доступные команды.'
  },
  setup: {
    onlyTelegramAdmins: 'Только админы Telegram-группы могут запускать /setup.',
    useSetupInGroup: 'Используйте /setup внутри группы дома.',
    onlyTelegramAdminsBindTopics: 'Только админы Telegram-группы могут привязывать топики дома.',
    householdNotConfigured: 'Для этого чата дом ещё не настроен. Сначала выполните /setup.',
    useCommandInTopic: 'Запустите эту команду внутри нужного топика.',
    onlyHouseholdAdmins: 'Только админы дома могут управлять ожидающими участниками.',
    pendingNotFound:
      'Ожидающий участник не найден. Используйте /pending_members, чтобы посмотреть очередь.',
    pendingMembersHeading: (householdName) => `Ожидающие участники для ${householdName}:`,
    pendingMembersHint:
      'Нажмите кнопку ниже, чтобы подтвердить участника, или используйте /approve_member <telegram_user_id>.',
    pendingMembersEmpty: (householdName) => `Для ${householdName} нет ожидающих участников.`,
    pendingMemberLine: (member, index) =>
      `${index + 1}. ${member.displayName} (${member.telegramUserId})${member.username ? ` @${member.username}` : ''}`,
    openMiniAppButton: 'Открыть мини-приложение',
    openMiniAppFromPrivateChat: 'Откройте мини-приложение по кнопке ниже.',
    openMiniAppUnavailable: 'Мини-приложение сейчас не настроено.',
    joinHouseholdButton: 'Вступить в дом',
    approveMemberButton: (displayName) => `Подтвердить ${displayName}`,
    telegramIdentityRequired: 'Чтобы вступить в дом, нужна Telegram-учётка пользователя.',
    invalidJoinLink: 'Некорректная ссылка-приглашение в дом.',
    joinLinkInvalidOrExpired: 'Эта ссылка-приглашение в дом недействительна или устарела.',
    alreadyActiveMember: (displayName) =>
      `Вы уже активный участник. Откройте мини-приложение, чтобы увидеть профиль ${displayName}.`,
    joinRequestSent: (householdName) =>
      `Заявка на вступление в ${householdName} отправлена. Дождитесь подтверждения от админа дома.`,
    setupSummary: ({ householdName, created }) =>
      `🏡 ${created ? 'Новый дом!' : 'Дом активен!'} **${householdName}** готов.\n\n` +
      `Базовая настройка выполнена. Теперь давайте распределим общение, привязав топики к конкретным ролям.`,
    setupTopicsHeading: (configured, total) =>
      `Текущий прогресс настройки: ${configured}/${total}\n\n` +
      `Нажмите кнопки ниже, чтобы создать топики автоматически, или перейдите в любой существующий топик и используйте /bind, чтобы привязать его вручную.`,
    setupTopicBound: (role) => `✅ ${role}`,
    setupTopicMissing: (role) => `⚪ ${role}`,
    setupTopicCreateButton: (role) => `Создать ${role}`,
    setupTopicBindButton: (role) => `Привязать ${role}`,
    useBindInTopic: 'Используйте /bind внутри топика, чтобы привязать его к роли.',
    topicAlreadyBound: (role) => `Этот топик уже привязан к роли «${role}».`,
    bindSelectRole: 'Привязать этот топик к:',
    topicBoundSuccess: (role, householdName) =>
      `Топик успешно привязан как «${role}» для ${householdName}.`,
    allRolesConfigured: 'Все роли топиков уже настроены.',
    setupTopicCreateFailed:
      'Не удалось создать этот топик. Проверьте права бота и включённые форум-топики в группе.',
    setupTopicCreateForbidden:
      'Мне нужны права на управление топиками в этой группе, чтобы создать его автоматически.',
    setupTopicCreated: (role, topicName) => `Топик ${role} создан и привязан: ${topicName}.`,
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
      }
    },
    onlyTelegramAdminsUnsetup: 'Только админы Telegram-группы могут запускать /unsetup.',
    useUnsetupInGroup: 'Используйте /unsetup внутри группы дома.',
    unsetupComplete: (householdName) =>
      `Состояние настройки для ${householdName} сброшено. Запустите /setup ещё раз, чтобы заново настроить топики.`,
    unsetupNoop: 'Для этой группы пока нечего сбрасывать. Когда будете готовы, запустите /setup.',
    usePendingMembersInGroup: 'Используйте /pending_members внутри группы дома.',
    useApproveMemberInGroup: 'Используйте /approve_member внутри группы дома.',
    approveMemberUsage: 'Использование: /approve_member <telegram_user_id>',
    onlyInviteAdmins: 'Приглашать участников могут только админы Telegram-группы или админы дома.',
    approvedMember: (displayName, householdName) =>
      `Участник ${displayName} подтверждён как активный участник ${householdName}.`,
    useButtonInGroup: 'Используйте эту кнопку в группе дома.',
    unableToIdentifySelectedMember: 'Не удалось определить выбранного участника.',
    approvedMemberToast: (displayName) => `${displayName} подтверждён.`,
    useJoinLinkInGroup: 'Используйте /join_link внутри группы дома.',
    joinLinkUnavailable: 'Не удалось сгенерировать ссылку для вступления.',
    joinLinkReady: (link, householdName) =>
      `Поделитесь этой ссылкой, чтобы пригласить участников в ${householdName}:\n\n${link}\n\nЛюбой, у кого есть эта ссылка, может подать заявку на вступление.`
  },
  keyboard: {
    dashboardButton: '🏡 Дашборд',
    enabled: 'Кнопка дашборда включена.',
    disabled: 'Кнопка дашборда выключена.'
  },
  anonymousFeedback: {
    title: 'Анонимное сообщение по дому',
    cancelButton: 'Отменить',
    unableToStart: 'Сейчас не удалось начать анонимное сообщение.',
    prompt: 'Отправьте анонимное сообщение следующим сообщением или нажмите «Отменить».',
    unableToIdentifyMessage: 'Не удалось определить это сообщение для анонимной отправки.',
    notMember: 'Вы не являетесь участником этого дома.',
    multipleHouseholds:
      'Вы состоите в нескольких домах. Откройте нужный дом из его группы, пока выбор дома ещё не добавлен.',
    feedbackTopicMissing:
      'Для вашего дома ещё не настроен анонимный топик. Попросите админа выполнить /setup и создать топик для обратной связи.',
    duplicate: 'Это анонимное сообщение уже было обработано.',
    delivered: 'Анонимное сообщение отправлено.',
    savedButPostFailed:
      'Анонимное сообщение сохранено, но публикация не удалась. Попробуйте позже.',
    nothingToCancel: 'Сейчас нечего отменять.',
    cancelled: 'Отменено.',
    cancelledMessage: 'Анонимное сообщение отменено.',
    useInPrivateChat: 'Используйте /anon в личном чате с ботом.',
    useThisInPrivateChat: 'Используйте это в личном чате с ботом.',
    tooShort: 'Анонимное сообщение слишком короткое. Добавьте немного деталей.',
    tooLong: 'Анонимное сообщение слишком длинное. Ограничьтесь 500 символами.',
    cooldown: (retryDelay) =>
      `Сейчас действует пауза на анонимные сообщения. Следующее сообщение можно отправить ${retryDelay}.`,
    dailyCap: (retryDelay) =>
      `Достигнут дневной лимит анонимных сообщений. Следующее сообщение можно отправить ${retryDelay}.`,
    blocklisted: 'Сообщение отклонено модерацией. Перепишите его спокойнее и без агрессии.',
    submitFailed: 'Не удалось отправить анонимное сообщение.',
    keepPromptSuffix: 'Отправьте исправленный текст или нажмите «Отменить».',
    retryNow: 'сейчас',
    retryInLessThanMinute: 'меньше чем через минуту',
    retryIn: (parts) => `через ${parts}`,
    day: (count) => `${count} ${count === 1 ? 'день' : count < 5 ? 'дня' : 'дней'}`,
    hour: (count) => `${count} ${count === 1 ? 'час' : count < 5 ? 'часа' : 'часов'}`,
    minute: (count) => `${count} ${count === 1 ? 'минуту' : count < 5 ? 'минуты' : 'минут'}`
  },
  assistant: {
    unavailable: 'Ассистент сейчас недоступен. Попробуйте ещё раз чуть позже.',
    noHousehold:
      'Я смогу помочь после того, как ваш Telegram-профиль будет привязан к дому. Сначала откройте группу дома и завершите вступление.',
    multipleHouseholds:
      'Вы состоите в нескольких домах. Откройте нужный дом из его группы, пока прямой выбор дома ещё не добавлен.',
    rateLimited: (retryDelay) => `Лимит сообщений ассистенту исчерпан. Попробуйте ${retryDelay}.`,
    retryInLessThanMinute: 'меньше чем через минуту',
    retryIn: (parts) => `через ${parts}`,
    hour: (count) => `${count} ${count === 1 ? 'час' : count < 5 ? 'часа' : 'часов'}`,
    minute: (count) => `${count} ${count === 1 ? 'минуту' : count < 5 ? 'минуты' : 'минут'}`,
    paymentProposal: (kind, amount, currency) =>
      `Я могу записать эту оплату ${kind === 'rent' ? 'аренды' : 'коммуналки'}: ${amount} ${currency}. Подтвердите или отмените ниже.`,
    paymentClarification:
      'Я могу помочь записать эту оплату, но сообщение нужно уточнить. Укажите, это аренда или коммуналка, и добавьте сумму, если вы оплатили не весь текущий остаток.',
    paymentUnsupportedCurrency:
      'Пока я могу автоматически подтверждать оплаты только в текущей валюте дома. Для другой валюты используйте /payment_add.',
    paymentNoBalance: 'Сейчас для этого типа оплаты нет суммы к подтверждению.',
    paymentConfirmButton: 'Подтвердить оплату',
    paymentCancelButton: 'Отменить',
    paymentConfirmed: (kind, amount, currency) =>
      `Оплата ${kind === 'rent' ? 'аренды' : 'коммуналки'} сохранена: ${amount} ${currency}`,
    paymentCancelled: 'Предложение оплаты отменено.',
    paymentAlreadyHandled: 'Это предложение оплаты уже было обработано.',
    paymentUnavailable: 'Это предложение оплаты уже недоступно.'
  },
  finance: {
    useInGroup: 'Используйте эту команду внутри группы дома.',
    householdNotConfigured: 'Для этого чата дом ещё не настроен. Сначала выполните /setup.',
    unableToIdentifySender: 'Не удалось определить отправителя для этой команды.',
    notMember: 'Вы не являетесь участником этого дома.',
    adminOnly: 'Эту команду могут использовать только админы дома.',
    cycleOpenUsage: 'Использование: /cycle_open <YYYY-MM> [USD|GEL]',
    cycleOpened: (period, currency) => `Период открыт: ${period} (${currency})`,
    cycleOpenFailed: (message) => `Не удалось открыть период: ${message}`,
    noCycleToClose: 'Не найден период для закрытия.',
    cycleClosed: (period) => `Период закрыт: ${period}`,
    cycleCloseFailed: (message) => `Не удалось закрыть период: ${message}`,
    rentSetUsage: 'Использование: /rent_set <amount> [USD|GEL] [YYYY-MM]',
    rentNoPeriod: 'Период не указан и открытый цикл не найден.',
    rentSaved: (amount, currency, period) =>
      `Правило аренды сохранено: ${amount} ${currency}, начиная с ${period}`,
    rentSaveFailed: (message) => `Не удалось сохранить правило аренды: ${message}`,
    utilityAddUsage: 'Использование: /utility_add <name> <amount> [USD|GEL]',
    utilityNoOpenCycle: 'Открытый период не найден. Сначала выполните /cycle_open.',
    utilityAdded: (name, amount, currency, period) =>
      `Коммунальный счёт добавлен: ${name} ${amount} ${currency} за ${period}`,
    utilityAddFailed: (message) => `Не удалось добавить коммунальный счёт: ${message}`,
    paymentAddUsage: 'Использование: /payment_add <rent|utilities> [amount] [USD|GEL]',
    paymentNoCycle: 'Биллинг-цикл пока не готов.',
    paymentNoBalance: 'Сейчас для этого типа оплаты нет суммы к подтверждению.',
    paymentAdded: (kind, amount, currency, period) =>
      `Оплата сохранена: ${kind === 'rent' ? 'аренда' : 'коммуналка'} ${amount} ${currency} за ${period}`,
    paymentAddFailed: (message) => `Не удалось сохранить оплату: ${message}`,
    noStatementCycle: 'Для выписки период не найден.',
    householdStatusTitle: (period) => `Статус на ${period}`,
    householdStatusDueDate: (dueDate) => `Срок оплаты аренды: до ${dueDate}`,
    householdStatusChargesHeading: 'Начисления',
    householdStatusRentDirect: (amount, currency) => `Аренда: ${amount} ${currency}`,
    householdStatusRentConverted: (sourceAmount, sourceCurrency, displayAmount, displayCurrency) =>
      `Аренда: ${sourceAmount} ${sourceCurrency} (~${displayAmount} ${displayCurrency})`,
    householdStatusUtilities: (amount, currency) => `Коммуналка: ${amount} ${currency}`,
    householdStatusPurchases: (amount, currency) => `Общие покупки: ${amount} ${currency}`,
    householdStatusSettlementHeading: 'Расчёты',
    householdStatusSettlementBalance: (amount, currency) => `Общий баланс: ${amount} ${currency}`,
    householdStatusSettlementPaid: (amount, currency) => `Уже оплачено: ${amount} ${currency}`,
    householdStatusSettlementRemaining: (amount, currency) =>
      `Осталось оплатить: ${amount} ${currency}`,
    householdStatusMembersHeading: 'Участники',
    householdStatusMemberCompact: (displayName, remaining, currency) =>
      `- ${displayName}: остаток ${remaining} ${currency}`,
    householdStatusMemberDetailed: (displayName, remaining, balance, paid, currency) =>
      `- ${displayName}: остаток ${remaining} ${currency} (${balance} баланс, ${paid} оплачено)`,
    statementTitle: (period) => `Выписка за ${period}`,
    statementLine: (displayName, amount, currency) => `- ${displayName}: ${amount} ${currency}`,
    statementTotal: (amount, currency) => `Итого: ${amount} ${currency}`,
    statementFailed: (message) => `Не удалось построить выписку: ${message}`,
    utilitiesTopicRequired: 'Эта команда должна использоваться внутри топика.',
    utilitiesNotLinked: 'Этот топик не привязан к домохозяйству.'
  },
  reminders: {
    utilities: (period) => `Напоминание по коммунальным платежам за ${period}`,
    rentWarning: (period) => `Напоминание по аренде за ${period}: срок оплаты скоро наступит.`,
    rentDue: (period) => `Напоминание по аренде за ${period}: пожалуйста, оплатите сегодня.`,
    guidedEntryButton: 'Ввести по шагам',
    copyTemplateButton: 'Шаблон',
    openDashboardButton: 'Открыть дашборд',
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
    summaryLine: (categoryName, amount, currency) => `- ${categoryName}: ${amount} ${currency}`,
    confirmPrompt: 'Подтвердите или отмените ниже.',
    confirmButton: 'Сохранить коммуналку',
    cancelButton: 'Отменить',
    cancelled: 'Ввод коммуналки отменён.',
    saved: (count, period) =>
      `Сохранено ${count} ${count === 1 ? 'начисление коммуналки' : 'начислений коммуналки'} за ${period}.`,
    proposalUnavailable: 'Это предложение по коммуналке уже недоступно.',
    onlyOriginalSender: 'Подтвердить это добавление коммуналки может только тот, кто его начал.'
  },
  purchase: {
    sharedPurchaseFallback: 'общая покупка',
    processing: 'Проверяю покупку...',
    proposal: (
      summary: string,
      payer: string | null,
      calculationNote: string | null,
      participants: string | null
    ) =>
      `Похоже, это общая покупка: ${summary}.${payer ? `\n${payer}` : ''}${calculationNote ? `\n${calculationNote}` : ''}${participants ? `\n\n${participants}` : ''}\nПодтвердите или отмените ниже.`,
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
    participantsHeading: 'Участники:',
    participantIncluded: (displayName) => `- ${displayName}`,
    participantExcluded: (displayName) => `- ${displayName} (не участвует)`,
    participantToggleIncluded: (displayName) => `✅ ${displayName}`,
    participantToggleExcluded: (displayName) => `⬜ ${displayName}`,
    payerHeading: 'Кто оплатил:',
    payerSelected: (displayName) => `Оплатил: ${displayName}`,
    payerQuestion: 'Кто именно это купил?',
    payerFallbackQuestion: 'Не понял, кто именно это купил. Выберите человека ниже.',
    payerButton: (displayName) => `Оплатил ${displayName}`,
    payerSelectedToast: (displayName) => `Записал покупателя: ${displayName}.`,
    confirmButton: 'Подтвердить',
    calculatedConfirmButton: 'Верно',
    calculatedFixAmountButton: 'Исправить сумму',
    cancelButton: 'Отменить',
    calculatedFixAmountPrompt:
      'Ответьте в этот топик исправленной итоговой суммой и валютой, и я заново проверю покупку.',
    calculatedFixAmountRequestedToast: 'Ответьте исправленной суммой.',
    calculatedFixAmountAlreadyRequested: 'Жду исправленную сумму.',
    confirmed: (summary) => `Покупка подтверждена: ${summary}`,
    cancelled: (summary) => `Предложение покупки отменено: ${summary}`,
    confirmedToast: 'Покупка подтверждена.',
    cancelledToast: 'Покупка отменена.',
    alreadyConfirmed: 'Эта покупка уже подтверждена.',
    alreadyCancelled: 'Это предложение покупки уже отменено.',
    atLeastOneParticipant: 'В распределении покупки должен остаться хотя бы один участник.',
    notYourProposal: 'Подтвердить или отменить эту покупку может только отправитель сообщения.',
    proposalUnavailable: 'Это предложение покупки уже недоступно.',
    parseFailed:
      'Пока не удалось распознать это как общую покупку. Напишите предмет, сумму и валюту явно.'
  },
  payments: {
    topicMissing:
      'Для этого дома ещё не настроен топик оплат. Попросите админа выполнить /setup и создать топик для оплат.',
    balanceReply: (kind) =>
      kind === 'rent' ? 'Текущая сводка по аренде:' : 'Текущая сводка по коммуналке:',
    proposal: (kind, amount, currency) =>
      `Я могу записать эту оплату ${kind === 'rent' ? 'аренды' : 'коммуналки'}: ${amount} ${currency}. Подтвердите или отмените ниже.`,
    clarification:
      'Пока не могу подтвердить эту оплату. Уточните, это аренда или коммуналка, и при необходимости напишите сумму и валюту.',
    unsupportedCurrency:
      'Сейчас я могу записывать оплаты в этом топике только в валюте расчётов по дому.',
    noBalance: 'Сейчас для этого типа оплаты нет суммы к подтверждению.',
    breakdownBase: (kind, amount, currency) =>
      `${kind === 'rent' ? 'Аренда к оплате' : 'Коммуналка к оплате'}: ${amount} ${currency}`,
    breakdownPurchaseBalance: (amount, currency) =>
      `Баланс по общим покупкам: ${amount} ${currency}`,
    breakdownSuggestedTotal: (amount, currency, policy) =>
      `Рекомендуемая сумма по политике «${policy}»: ${amount} ${currency}`,
    breakdownRecordingAmount: (amount, currency) =>
      `Сумма из вашего сообщения: ${amount} ${currency}`,
    breakdownRemaining: (amount, currency) => `Общий остаток: ${amount} ${currency}`,
    adjustmentPolicy: (policy) =>
      policy === 'utilities'
        ? 'зачёт через коммуналку'
        : policy === 'rent'
          ? 'зачёт через аренду'
          : 'отдельный расчёт по покупкам',
    timingBeforeWindow: (kind, reminderDate, dueDate) =>
      `${kind === 'rent' ? 'Аренду' : 'Коммуналку'} пока рано оплачивать. Следующее напоминание: ${reminderDate}. Срок оплаты: ${dueDate}.`,
    timingDueNow: (kind, dueDate) =>
      `${kind === 'rent' ? 'Аренду' : 'Коммуналку'} уже пора оплачивать. Срок оплаты: ${dueDate}.`,
    confirmButton: 'Подтвердить оплату',
    cancelButton: 'Отменить',
    recorded: (kind, amount, currency) =>
      `Оплата ${kind === 'rent' ? 'аренды' : 'коммуналки'} сохранена: ${amount} ${currency}`,
    cancelled: 'Предложение оплаты отменено.',
    proposalUnavailable: 'Это предложение оплаты уже недоступно.',
    notYourProposal: 'Подтвердить или отменить эту оплату может только отправитель сообщения.',
    savedForReview: 'Это подтверждение оплаты сохранено на проверку.',
    duplicate: 'Это подтверждение оплаты уже было обработано.'
  }
}
