import type { BotTranslationCatalog } from '../types'

export const ruBotTranslations: BotTranslationCatalog = {
  localeName: 'Русский',
  commands: {
    help: 'Показать список команд',
    household_status: 'Показать текущий статус дома',
    anon: 'Отправить анонимное сообщение по дому',
    cancel: 'Отменить текущий ввод',
    setup: 'Подключить эту группу как дом',
    bind_purchase_topic: 'Назначить текущий топик для покупок',
    bind_feedback_topic: 'Назначить текущий топик для анонимных сообщений',
    bind_reminders_topic: 'Назначить текущий топик для напоминаний',
    bind_payments_topic: 'Назначить текущий топик для оплат',
    payment_add: 'Подтвердить оплату аренды или коммуналки',
    pending_members: 'Показать ожидающие заявки на вступление',
    approve_member: 'Подтвердить участника дома'
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
    joinHouseholdButton: 'Вступить в дом',
    approveMemberButton: (displayName) => `Подтвердить ${displayName}`,
    telegramIdentityRequired: 'Чтобы вступить в дом, нужна Telegram-учётка пользователя.',
    invalidJoinLink: 'Некорректная ссылка-приглашение в дом.',
    joinLinkInvalidOrExpired: 'Эта ссылка-приглашение в дом недействительна или устарела.',
    alreadyActiveMember: (displayName) =>
      `Вы уже активный участник. Откройте мини-приложение, чтобы увидеть профиль ${displayName}.`,
    joinRequestSent: (householdName) =>
      `Заявка на вступление в ${householdName} отправлена. Дождитесь подтверждения от админа дома.`,
    setupSummary: ({ householdName, telegramChatId, created }) =>
      [
        `${created ? 'Дом создан' : 'Дом уже подключён'}: ${householdName}`,
        `ID чата: ${telegramChatId}`,
        'Дальше: откройте топик покупок и выполните /bind_purchase_topic, затем откройте топик обратной связи и выполните /bind_feedback_topic. Если хотите отдельные топики для напоминаний или оплат, откройте их и выполните /bind_reminders_topic или /bind_payments_topic.',
        'Участники должны открыть чат с ботом по кнопке ниже и подтвердить заявку на вступление.'
      ].join('\n'),
    useBindPurchaseTopicInGroup: 'Используйте /bind_purchase_topic внутри топика группы дома.',
    purchaseTopicSaved: (householdName, threadId) =>
      `Топик покупок сохранён для ${householdName} (тред ${threadId}).`,
    useBindFeedbackTopicInGroup: 'Используйте /bind_feedback_topic внутри топика группы дома.',
    feedbackTopicSaved: (householdName, threadId) =>
      `Топик обратной связи сохранён для ${householdName} (тред ${threadId}).`,
    useBindRemindersTopicInGroup: 'Используйте /bind_reminders_topic внутри топика группы дома.',
    remindersTopicSaved: (householdName, threadId) =>
      `Топик напоминаний сохранён для ${householdName} (тред ${threadId}).`,
    useBindPaymentsTopicInGroup: 'Используйте /bind_payments_topic внутри топика группы дома.',
    paymentsTopicSaved: (householdName, threadId) =>
      `Топик оплат сохранён для ${householdName} (тред ${threadId}).`,
    usePendingMembersInGroup: 'Используйте /pending_members внутри группы дома.',
    useApproveMemberInGroup: 'Используйте /approve_member внутри группы дома.',
    approveMemberUsage: 'Использование: /approve_member <telegram_user_id>',
    approvedMember: (displayName, householdName) =>
      `Участник ${displayName} подтверждён как активный участник ${householdName}.`,
    useButtonInGroup: 'Используйте эту кнопку в группе дома.',
    unableToIdentifySelectedMember: 'Не удалось определить выбранного участника.',
    approvedMemberToast: (displayName) => `${displayName} подтверждён.`
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
      'Для вашего дома ещё не настроен анонимный топик. Попросите админа выполнить /bind_feedback_topic.',
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
    householdStatusRentDirect: (amount, currency) => `Аренда: ${amount} ${currency}`,
    householdStatusRentConverted: (sourceAmount, sourceCurrency, displayAmount, displayCurrency) =>
      `Аренда: ${sourceAmount} ${sourceCurrency} (~${displayAmount} ${displayCurrency})`,
    householdStatusUtilities: (amount, currency) => `Коммуналка: ${amount} ${currency}`,
    householdStatusPurchases: (amount, currency) => `Общие покупки: ${amount} ${currency}`,
    householdStatusMember: (displayName, balance, paid, remaining, currency) =>
      `- ${displayName}: баланс ${balance} ${currency}, оплачено ${paid} ${currency}, остаток ${remaining} ${currency}`,
    householdStatusTotals: (balance, paid, remaining, currency) =>
      `Итого по дому: баланс ${balance} ${currency}, оплачено ${paid} ${currency}, остаток ${remaining} ${currency}`,
    statementTitle: (period) => `Выписка за ${period}`,
    statementLine: (displayName, amount, currency) => `- ${displayName}: ${amount} ${currency}`,
    statementTotal: (amount, currency) => `Итого: ${amount} ${currency}`,
    statementFailed: (message) => `Не удалось построить выписку: ${message}`
  },
  reminders: {
    utilities: (period) => `Напоминание по коммунальным платежам за ${period}`,
    rentWarning: (period) => `Напоминание по аренде за ${period}: срок оплаты скоро наступит.`,
    rentDue: (period) => `Напоминание по аренде за ${period}: пожалуйста, оплатите сегодня.`
  },
  purchase: {
    sharedPurchaseFallback: 'общая покупка',
    recorded: (summary) => `Покупка сохранена: ${summary}`,
    savedForReview: (summary) => `Сохранено на проверку: ${summary}`,
    parseFailed: 'Сохранено на проверку: пока не удалось распознать эту покупку.'
  },
  payments: {
    topicMissing:
      'Для этого дома ещё не настроен топик оплат. Попросите админа выполнить /bind_payments_topic.',
    recorded: (kind, amount, currency) =>
      `Оплата ${kind === 'rent' ? 'аренды' : 'коммуналки'} сохранена: ${amount} ${currency}`,
    savedForReview: 'Это подтверждение оплаты сохранено на проверку.',
    duplicate: 'Это подтверждение оплаты уже было обработано.'
  }
}
