import { routineDate } from '@household/application'
import {
  formatDayDisplay,
  pickRoutineQuickTarget,
  pickRoutineFocus,
  Temporal
} from '@household/domain'
import type { RoutineDay, RoutineDocument, RoutineRow } from '@household/ports'
import type { InlineKeyboardMarkup } from 'grammy/types'

import type { BotLocale } from './i18n'
import { routineCopy } from './i18n/routines'

type RoutineCallbackAction = 'complete' | 'reopen' | 'claim' | 'release'

export function routineCallback(
  doc: RoutineDocument,
  row: RoutineRow,
  action: RoutineCallbackAction
): string {
  return `rt:${doc.id}:${row.id}:${row.version.toString(36)}:${{ complete: 'd', reopen: 'u', claim: 'c', release: 'r' }[action]}`
}
export function routineExpandCallback(doc: RoutineDocument): string {
  return `rtx:${doc.id}`
}
export function routineRowClaimed(row: RoutineRow, now: string): boolean {
  return (
    row.status === 'claimed' &&
    Boolean(
      row.expiresAt &&
      Temporal.Instant.compare(Temporal.Instant.from(row.expiresAt), Temporal.Instant.from(now)) > 0
    )
  )
}
function localTime(instant: string, timezone: string): string {
  return Temporal.Instant.from(instant)
    .toZonedDateTimeISO(timezone)
    .toPlainTime()
    .toString({ smallestUnit: 'minute' })
}
function lastCompletion(doc: RoutineDocument, date: string, activityId?: string) {
  return doc.days
    .filter((day) => day.date <= date)
    .flatMap((day) => day.rows)
    .filter(
      (row) =>
        row.status === 'completed' && row.actedAt && (!activityId || row.activityId === activityId)
    )
    .sort((a, b) => Date.parse(a.actedAt!) - Date.parse(b.actedAt!))
    .at(-1)
}
// One state marker for the card text and its toggle buttons: done, taken, open.
function rowMarker(row: RoutineRow, now: string): string {
  return row.status === 'completed' ? '✅' : routineRowClaimed(row, now) ? '⏳' : '⬜'
}
function actorLabel(name: string | null, fallback: string): string {
  return (name ?? fallback).slice(0, 40).replace(/[\r\n]/g, ' ')
}
export function renderRoutineCard(
  doc: RoutineDocument,
  day: RoutineDay,
  now: string,
  options: { locale: BotLocale; reminderRow?: RoutineRow; expanded?: boolean }
) {
  const copy = routineCopy[options.locale]
  const reminderRow = options.reminderRow
  const dayLabel = (date: string) => formatDayDisplay(date, options.locale)
  const active = !doc.paused && day.date === routineDate(doc, now)
  const rowLabel = (row: RoutineRow) =>
    `${row.localTime ? `${row.localTime.replace('-', '–')} · ` : ''}${row.title}${row.recurrenceDueDate ? ` · ${copy.dueSince(dayLabel(row.recurrenceDueDate))}` : ''}`
  const rows = reminderRow ? [reminderRow] : day.rows
  const open = day.rows.filter((row) => row.status !== 'completed')
  const focus = active && !reminderRow ? pickRoutineFocus(day.rows, now) : null
  const previous = !reminderRow ? lastCompletion(doc, day.date) : undefined
  const quickActions = day.quickActions ?? []
  const lastLine = (activityId: string, label: string) => {
    const last = lastCompletion(doc, day.date, activityId)
    if (!last) return copy.quickNever(label)
    const date = Temporal.Instant.from(last.actedAt!)
      .toZonedDateTimeISO(doc.timezone)
      .toPlainDate()
      .toString()
    const currentDate = Temporal.Instant.from(now)
      .toZonedDateTimeISO(doc.timezone)
      .toPlainDate()
      .toString()
    const time = localTime(last.actedAt!, doc.timezone)
    return copy.quickLast(
      label,
      date !== currentDate ? copy.dayAndTime(dayLabel(date), time) : time,
      actorLabel(last.actorName, copy.someone)
    )
  }
  // Absolute times only: a relative "N minutes ago" would rewrite the card every minute.
  const nextLine = () => {
    if (!active || !day.rows.length) return null
    if (!focus) return copy.allDone
    if (focus.state === 'untimed') return copy.left(open.length)
    return (focus.state === 'upcoming' ? copy.upcoming : copy.dueNow)(
      focus.row.localTime ?? '',
      focus.row.title
    )
  }
  const summary = reminderRow
    ? []
    : [
        ...quickActions.map((action) => lastLine(action.id, action.summaryLabel)),
        previous && !quickActions.length
          ? copy.lastDone(
              localTime(previous.actedAt!, doc.timezone),
              actorLabel(previous.actorName, copy.someone)
            )
          : null,
        nextLine()
      ].filter((line): line is string => line !== null)
  const text = [
    (reminderRow ? copy.reminderCard : copy.dayCard)(day.title, dayLabel(day.date)),
    ...(doc.paused ? [copy.paused] : []),
    ...summary,
    '',
    ...rows.map((row) => {
      const claimed = routineRowClaimed(row, now)
      const actor = actorLabel(row.actorName, '')
      const time = row.actedAt ? localTime(row.actedAt, doc.timezone) : ''
      // The reminder card is about one task, so its note is shown in full.
      const note = reminderRow
        ? row.note
        : row.note && `${row.note.slice(0, 40)}${row.note.length > 40 ? '…' : ''}`
      return `${rowMarker(row, now)} ${rowLabel(row)}${row.status === 'completed' ? copy.doneBy(actor, time) : claimed ? copy.takenBy(actor) : ''}${row.nextDueDate ? `\n  ↳ ${copy.nextTime(dayLabel(row.nextDueDate))}` : ''}${note ? `\n  ↳ ${note}` : ''}`
    }),
    ...(!rows.length ? [copy.nothingToday] : [])
  ].join('\n')
  const rowButton = (row: RoutineRow) => ({
    text: `${rowMarker(row, now)} ${rowLabel(row)}`,
    callback_data: routineCallback(doc, row, row.status === 'completed' ? 'reopen' : 'complete')
  })
  // A single slot needs no second layer: the plain checklist is already one button.
  const compact = !options.expanded && day.rows.length > 1
  const keyboard: InlineKeyboardMarkup = {
    inline_keyboard: !active
      ? []
      : reminderRow
        ? [
            [
              ...(reminderRow.claimEnabled
                ? [
                    {
                      text: routineRowClaimed(reminderRow, now)
                        ? copy.releaseButton
                        : copy.claimButton,
                      callback_data: routineCallback(
                        doc,
                        reminderRow,
                        routineRowClaimed(reminderRow, now) ? 'release' : 'claim'
                      )
                    }
                  ]
                : []),
              {
                text: copy.completeButton,
                callback_data: routineCallback(doc, reminderRow, 'complete')
              }
            ]
          ]
        : compact
          ? [
              ...(focus ? [[rowButton(focus.row)]] : []),
              [
                {
                  text: copy.showAllButton(day.rows.length - open.length, day.rows.length),
                  callback_data: routineExpandCallback(doc)
                }
              ]
            ]
          : [
              ...rows.map((row) => [rowButton(row)]),
              ...(day.rows.length > 1
                ? [[{ text: copy.collapseButton, callback_data: routineExpandCallback(doc) }]]
                : [])
            ]
  }
  if (active && !reminderRow) {
    const quickButtons = quickActions.flatMap((action) => {
      const target = pickRoutineQuickTarget(day.rows, action.id, now)
      return target
        ? [
            [
              {
                text: action.label,
                callback_data: `rtq:${doc.id}:${target.id}:${target.version.toString(36)}:${action.id}`
              }
            ]
          ]
        : []
    })
    keyboard.inline_keyboard.unshift(...quickButtons)
  }
  return { text, reply_markup: keyboard, notify: Boolean(reminderRow) }
}
