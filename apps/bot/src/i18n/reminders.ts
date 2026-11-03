import type { BotLocale } from './types'

// One-off reminders: the draft card, its buttons, /notifications and the delivered DM.
// Every string here is plain text; none of these messages is sent with parse_mode.

const ru = {
  today: 'сегодня',
  tomorrow: 'завтра',
  dayAfterTomorrow: 'послезавтра',
  at: (day: string, time: string) => `${day} в ${time}`,

  draft: (when: string, text: string) => `⏰ ${when} · ${text}`,
  deliveryHere: 'Напомню здесь',
  deliveryDmAll: 'Всем в личку',
  deliveryDmSelected: (names: string) => `В личку: ${names}`,
  deliveryDmNobody: 'В личку — выберите, кому',

  saveButton: '✅ Сохранить',
  cancelButton: 'Отмена',
  expandButton: 'Кому и куда…',
  backButton: 'Назад',
  modeHereButton: 'Сюда',
  modeDmAllButton: 'Всем в личку',
  modeDmSelectedButton: 'Выбрать, кому',
  cancelSavedButton: 'Отменить напоминание',

  savedToast: 'Готово, напомню',
  saveFailed: 'Не получилось сохранить напоминание. Попробуйте ещё раз',
  saveFailedPast: 'Это время уже прошло. Попросите напомнить позже',
  saveFailedNoRecipients: 'Выберите, кому отправить в личку',
  draftCancelledToast: 'Отменено',
  draftCancelled: 'Хорошо, напоминать не буду',
  savedCancelledToast: 'Напоминание отменено',
  savedCancelled: (text: string) => `🗑 Напоминание отменено: ${text}`,
  cancelForbidden: '🔒 Отменить может только автор или админ',
  cancelStale: 'Это напоминание уже неактуально',

  listTitle: '⏰ Ближайшие напоминания',
  listEmpty: '⏰ Ближайших напоминаний нет',
  listCancelButton: (position: number) => `Отменить ${position}`,
  listFor: (name: string) => `кому: ${name}`,
  listDmAll: 'всем в личку',
  listDmSelected: (names: string) => `в личку: ${names}`,
  listDmSelectedUnnamed: 'в личку выбранным',
  listAuthor: (name: string) => `автор: ${name}`,

  directMessage: (text: string) => `⏰ Напоминание: ${text}`
}

const en: typeof ru = {
  today: 'today',
  tomorrow: 'tomorrow',
  dayAfterTomorrow: 'the day after tomorrow',
  at: (day, time) => `${day} at ${time}`,

  draft: (when, text) => `⏰ ${when} · ${text}`,
  deliveryHere: "I'll remind here",
  deliveryDmAll: 'DM to everyone',
  deliveryDmSelected: (names) => `DM to ${names}`,
  deliveryDmNobody: 'DM — pick who gets it',

  saveButton: '✅ Save',
  cancelButton: 'Cancel',
  expandButton: 'Send to…',
  backButton: 'Back',
  modeHereButton: 'Here',
  modeDmAllButton: 'DM everyone',
  modeDmSelectedButton: 'Pick people',
  cancelSavedButton: 'Cancel reminder',

  savedToast: "Done, I'll remind",
  saveFailed: "Couldn't save the reminder. Try again",
  saveFailedPast: 'That time has passed. Ask for a later one',
  saveFailedNoRecipients: 'Pick who gets the DM',
  draftCancelledToast: 'Cancelled',
  draftCancelled: "Okay, I won't remind",
  savedCancelledToast: 'Reminder cancelled',
  savedCancelled: (text) => `🗑 Reminder cancelled: ${text}`,
  cancelForbidden: '🔒 Only the author or an admin can cancel it',
  cancelStale: 'This reminder is no longer active',

  listTitle: '⏰ Upcoming reminders',
  listEmpty: '⏰ No upcoming reminders',
  listCancelButton: (position) => `Cancel ${position}`,
  listFor: (name) => `for ${name}`,
  listDmAll: 'DM to everyone',
  listDmSelected: (names) => `DM to ${names}`,
  listDmSelectedUnnamed: 'DM to selected people',
  listAuthor: (name) => `by ${name}`,

  directMessage: (text) => `⏰ Reminder: ${text}`
}

export const reminderCopy: Record<BotLocale, typeof ru> = { ru, en }
