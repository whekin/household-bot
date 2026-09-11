import { pickRoutineFocus, Temporal } from '@household/domain'
import type { RoutineDay, RoutineDocument, RoutineRow } from '@household/ports'
import type { InlineKeyboardMarkup } from 'grammy/types'

const labels = {
  complete: 'Готово',
  reopen: 'Отменить',
  claim: 'Возьму на себя',
  release: 'Освободить'
}
export function routineCallback(
  doc: RoutineDocument,
  row: RoutineRow,
  action: keyof typeof labels
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
function lastCompletion(doc: RoutineDocument, date: string) {
  return doc.days
    .filter((day) => day.date <= date)
    .flatMap((day) => day.rows)
    .filter((row) => row.status === 'completed' && row.actedAt)
    .sort((a, b) => Date.parse(a.actedAt!) - Date.parse(b.actedAt!))
    .at(-1)
}
export function renderRoutineCard(
  doc: RoutineDocument,
  day: RoutineDay,
  now: string,
  reminderRow?: RoutineRow,
  expanded = false
) {
  const active =
    !doc.paused &&
    day.date ===
      Temporal.Instant.from(now).toZonedDateTimeISO(doc.timezone).toPlainDate().toString()
  const rowLabel = (row: RoutineRow) => `${row.localTime ? `${row.localTime} · ` : ''}${row.title}`
  const rows = reminderRow ? [reminderRow] : day.rows
  const open = day.rows.filter((row) => row.status !== 'completed')
  const focus = active && !reminderRow ? pickRoutineFocus(day.rows, now) : null
  const previous = !reminderRow ? lastCompletion(doc, day.date) : undefined
  // Absolute times only: a relative "N minutes ago" would rewrite the card every minute.
  const nextLine = () => {
    if (!active || !day.rows.length) return null
    if (!focus) return 'Все дела на сегодня выполнены'
    if (focus.state === 'untimed') return `Осталось дел: ${open.length}`
    return `${focus.state === 'upcoming' ? 'Дальше' : 'Пора'}: ${focus.row.localTime} · ${focus.row.title}`
  }
  const summary = reminderRow
    ? []
    : [
        previous
          ? `Последнее: ${localTime(previous.actedAt!, doc.timezone)}, ${(previous.actorName ?? 'участник').slice(0, 40).replace(/[\r\n]/g, ' ')}`
          : null,
        nextLine()
      ].filter((line): line is string => line !== null)
  const text = [
    `${reminderRow ? '🔔' : '☑️'} ${day.title} · ${day.date.slice(8)}.${day.date.slice(5, 7)}`,
    ...(doc.paused ? ['На паузе'] : []),
    ...summary,
    '',
    ...rows.map((row) => {
      const claimed = routineRowClaimed(row, now)
      const actor = (row.actorName ?? '').slice(0, 40).replace(/[\r\n]/g, ' ')
      const time = row.actedAt ? localTime(row.actedAt, doc.timezone) : ''
      return `${row.status === 'completed' ? '✓' : claimed ? '◷' : '☐'} ${rowLabel(row)}${row.status === 'completed' ? ` — ${actor}, ${time}` : claimed ? ` — ${actor} занимается` : ''}`
    }),
    ...(!rows.length ? ['На сегодня дел нет'] : [])
  ].join('\n')
  const rowButton = (row: RoutineRow) => ({
    text: `${row.status === 'completed' ? '✓' : routineRowClaimed(row, now) ? '◷' : '☐'} ${rowLabel(row)}`,
    callback_data: routineCallback(doc, row, row.status === 'completed' ? 'reopen' : 'complete')
  })
  // A single slot needs no second layer: the plain checklist is already one button.
  const compact = !expanded && day.rows.length > 1
  const keyboard: InlineKeyboardMarkup = {
    inline_keyboard: !active
      ? []
      : reminderRow
        ? [
            [
              ...(reminderRow.claimEnabled
                ? [
                    {
                      text: routineRowClaimed(reminderRow, now) ? labels.release : labels.claim,
                      callback_data: routineCallback(
                        doc,
                        reminderRow,
                        routineRowClaimed(reminderRow, now) ? 'release' : 'claim'
                      )
                    }
                  ]
                : []),
              {
                text: labels.complete,
                callback_data: routineCallback(doc, reminderRow, 'complete')
              }
            ]
          ]
        : compact
          ? [
              ...(focus
                ? [
                    [
                      {
                        ...rowButton(focus.row),
                        text: `${focus.state === 'overdue' || focus.state === 'due' ? '⏰' : '☐'} ${rowLabel(focus.row)}`
                      }
                    ]
                  ]
                : []),
              [
                {
                  text: `⋯ Все дела · ${day.rows.length - open.length} из ${day.rows.length}`,
                  callback_data: routineExpandCallback(doc)
                }
              ]
            ]
          : [
              ...rows.map((row) => [rowButton(row)]),
              ...(day.rows.length > 1
                ? [[{ text: '⌃ Свернуть', callback_data: routineExpandCallback(doc) }]]
                : [])
            ]
  }
  return { text, reply_markup: keyboard, notify: Boolean(reminderRow) }
}
