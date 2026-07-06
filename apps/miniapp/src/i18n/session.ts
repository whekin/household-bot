export const en = {
  loadingTitle: 'Checking your household access',
  loadingBody: 'Validating Telegram session and membership…',
  loadingBadge: 'Secure session',
  joinTitle: 'Welcome to your household',
  joinBody:
    'You are not a member of {household} yet. Send a join request and wait for admin approval.',
  pendingTitle: 'Join request sent',
  pendingBody: 'Your request for {household} is pending admin approval.',
  openFromGroupTitle: 'Open this from your household group',
  openFromGroupBody:
    'Use the join button from the household group setup message so the app knows which household you want to join.',
  unexpectedErrorTitle: 'Unable to load the household app',
  unexpectedErrorBody:
    'Retry in Telegram. If this keeps failing, ask the household admin to resend the join button.',
  householdFallback: 'this household',
  joinAction: 'Join household',
  joining: 'Sending request…',
  botLinkAction: 'Open bot chat',
  telegramOnlyTitle: 'Open this app from Telegram',
  telegramOnlyBody:
    'The real session gate needs Telegram mini app data. Local development falls back to a preview shell.',
  sessionExpiredTitle: 'Session expired',
  sessionExpiredBody:
    'Reload the mini app from Telegram to get a fresh secure session, then try again.'
}

export const ru: Record<keyof typeof en, string> = {
  loadingTitle: 'Проверяем доступ к дому',
  loadingBody: 'Сверяем Telegram-сессию и участие в доме…',
  loadingBadge: 'Защищённая сессия',
  joinTitle: 'Добро пожаловать домой',
  joinBody: 'Ты пока не в {household}. Отправь заявку и подожди, пока админ её одобрит.',
  pendingTitle: 'Заявка отправлена',
  pendingBody: 'Твоя заявка в {household} ждёт подтверждения админа.',
  openFromGroupTitle: 'Открой приложение из чата дома',
  openFromGroupBody:
    'Нажми кнопку вступления в сообщении бота в группе дома — так приложение поймёт, куда ты вступаешь.',
  unexpectedErrorTitle: 'Не удалось загрузить приложение',
  unexpectedErrorBody:
    'Попробуй ещё раз из Telegram. Если не помогает, попроси админа заново прислать кнопку вступления.',
  householdFallback: 'этот дом',
  joinAction: 'Вступить в дом',
  joining: 'Отправляем заявку…',
  botLinkAction: 'Открыть чат с ботом',
  telegramOnlyTitle: 'Открой приложение из Telegram',
  telegramOnlyBody:
    'Для настоящей проверки нужны данные Telegram Mini App, поэтому локально показываем демо-оболочку.',
  sessionExpiredTitle: 'Сессия истекла',
  sessionExpiredBody:
    'Перезапусти мини-приложение из Telegram, чтобы обновить сессию, и попробуй ещё раз.'
}
