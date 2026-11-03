import { pluralRu } from '@household/domain'

import type { BotLocale } from './types'

// Shared routines ("дела"): the day card, the reminder card and their callbacks.
// Every string here is plain text; toasts and cards are sent without parse_mode.

const ru = {
  dayCard: (title: string, date: string) => `🧹 ${title} · ${date}`,
  reminderCard: (title: string, date: string) => `⏰ ${title} · ${date}`,
  paused: 'На паузе',
  dueSince: (date: string) => `с ${date}`,
  nextTime: (date: string) => `Следующий раз: ${date}`,
  quickNever: (label: string) => `${label}: ещё не было`,
  quickLast: (label: string, when: string, name: string) => `${label}: ${when} · ${name}`,
  dayAndTime: (day: string, time: string) => `${day}, ${time}`,
  lastDone: (time: string, name: string) => `Последнее: ${time} · ${name}`,
  allDone: 'На сегодня всё — можно отдыхать',
  left: (count: number) => `Осталось ${count} ${pluralRu(count, ['дело', 'дела', 'дел'])}`,
  upcoming: (time: string, title: string) => `Дальше: ${time} · ${title}`,
  dueNow: (time: string, title: string) => `Пора: ${time} · ${title}`,
  doneBy: (name: string, time: string) => ` — ${name}, ${time}`,
  takenBy: (name: string) => ` — ${name} занимается`,
  nothingToday: 'На сегодня дел нет',
  someone: 'кто-то',

  completeButton: '✅ Готово',
  claimButton: 'Займусь',
  releaseButton: 'Освободить',
  showAllButton: (done: number, total: number) => `Все дела · ${done} из ${total}`,
  collapseButton: 'Свернуть',
  bindButton: (title: string) => `Дела: ${title}`,

  retiredCard: 'Этот список переехал или закрыт. Актуальные дела — в /routines',
  closedReminder: 'Напоминание закрыто. Отметки — в карточке дня',

  listsTitle: '🧹 Дела на сегодня',
  listsEmpty: '🧹 Списков дел пока нет. Создать первый можно в приложении: Дом → Общие дела',
  householdFallback: 'Дом',
  privateOnly: '🧹 Дела открываются в личке с ботом',
  privateOnlyButton: 'Открыть',

  toastComplete: 'Отмечено',
  toastReopen: 'Отметка снята',
  toastClaim: 'Дело за вами',
  toastRelease: 'Освобождено',
  toastAlreadyDone: 'Уже отмечено',
  toastTopicBound: 'Топик подключён',

  errors: {
    forbidden: '🔒 Нет доступа к этому списку',
    members_only: '🔒 Только для участников дома',
    admin_only: '🔒 Это может только админ дома',
    telegram_admin_only: '🔒 Подключить топик может только админ группы',
    group_missing: 'Группа дома не подключена. Подключите её через /setup',
    forum_required: 'Включите темы в группе, чтобы подключить топик',
    stale_revision: 'Список изменился. Откройте его заново',
    not_found: 'Этого списка больше нет',
    open_private: 'Откройте личку с ботом',
    wrong_topic: 'Нажмите кнопку в том топике, который нужно подключить',
    card_inactive: 'Карточка устарела. Актуальные дела — в /routines',
    stale_card: 'Карточка устарела. Актуальные дела — в /routines',
    invalid_action: 'Это действие недоступно',
    paused: 'Список на паузе',
    quick_unavailable: 'Быстрая отметка сейчас недоступна',
    quick_changed: 'Дело изменилось — карточка обновится',
    conflict: 'Уже отмечено — карточка обновится',
    claimed_by_other: 'Этим уже кто-то занимается',
    claim_disabled: 'Это дело нельзя взять на себя',
    save_failed: 'Не получилось сохранить. Попробуйте ещё раз',
    open_failed: 'Не получилось открыть дела. Попробуйте ещё раз',
    bind_failed: 'Не получилось подключить топик. Попробуйте ещё раз'
  }
}

const en: typeof ru = {
  dayCard: (title, date) => `🧹 ${title} · ${date}`,
  reminderCard: (title, date) => `⏰ ${title} · ${date}`,
  paused: 'Paused',
  dueSince: (date) => `since ${date}`,
  nextTime: (date) => `Next time: ${date}`,
  quickNever: (label) => `${label}: not yet`,
  quickLast: (label, when, name) => `${label}: ${when} · ${name}`,
  dayAndTime: (day, time) => `${day}, ${time}`,
  lastDone: (time, name) => `Last: ${time} · ${name}`,
  allDone: 'All done for today — time to relax',
  left: (count) => `${count} left`,
  upcoming: (time, title) => `Next: ${time} · ${title}`,
  dueNow: (time, title) => `Now: ${time} · ${title}`,
  doneBy: (name, time) => ` — ${name}, ${time}`,
  takenBy: (name) => ` — ${name} is on it`,
  nothingToday: 'Nothing for today',
  someone: 'someone',

  completeButton: '✅ Done',
  claimButton: "I'll do it",
  releaseButton: 'Release',
  showAllButton: (done, total) => `All tasks · ${done} of ${total}`,
  collapseButton: 'Collapse',
  bindButton: (title) => `Routines: ${title}`,

  retiredCard: 'This list moved or was closed. Current routines: /routines',
  closedReminder: 'Reminder closed. Marks are on the day card',

  listsTitle: "🧹 Today's routines",
  listsEmpty: '🧹 No routine lists yet. Create the first one in the app: House → Shared routines',
  householdFallback: 'Household',
  privateOnly: '🧹 Routines open in a private chat with the bot',
  privateOnlyButton: 'Open',

  toastComplete: 'Marked done',
  toastReopen: 'Unmarked',
  toastClaim: "It's yours",
  toastRelease: 'Released',
  toastAlreadyDone: 'Already marked',
  toastTopicBound: 'Topic connected',

  errors: {
    forbidden: "🔒 You don't have access to this list",
    members_only: '🔒 Only for household members',
    admin_only: '🔒 Only a household admin can do this',
    telegram_admin_only: '🔒 Only a group admin can connect a topic',
    group_missing: 'The household group is not connected. Connect it with /setup',
    forum_required: 'Turn on topics in the group to connect one',
    stale_revision: 'The list has changed. Open it again',
    not_found: 'This list no longer exists',
    open_private: 'Open a private chat with the bot',
    wrong_topic: 'Press the button inside the topic you want to connect',
    card_inactive: 'This card is out of date. Current routines: /routines',
    stale_card: 'This card is out of date. Current routines: /routines',
    invalid_action: 'This action is not available',
    paused: 'The list is paused',
    quick_unavailable: 'Quick mark is not available right now',
    quick_changed: 'The task changed — the card will refresh',
    conflict: 'Already marked — the card will refresh',
    claimed_by_other: 'Someone is already on it',
    claim_disabled: 'This task cannot be taken',
    save_failed: "Couldn't save. Try again",
    open_failed: "Couldn't open routines. Try again",
    bind_failed: "Couldn't connect the topic. Try again"
  }
}

export type RoutineErrorKey = keyof typeof ru.errors

export const routineCopy: Record<BotLocale, typeof ru> = { ru, en }

export function isRoutineErrorKey(code: string | null | undefined): code is RoutineErrorKey {
  return typeof code === 'string' && Object.hasOwn(ru.errors, code)
}
