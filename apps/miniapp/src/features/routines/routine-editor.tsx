import { useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import {
  normalizeRoutine,
  type RoutineDefinition,
  type RoutineTask,
  type RoutineQuickAction
} from '@household/domain'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n/context'
import { presetDefinition, routinePresets } from './presets'
import type { RoutineView } from './types'

export function RoutineEditor({
  routine,
  busy,
  error,
  onSave,
  onCancel
}: {
  routine: RoutineView | null
  busy: boolean
  error: string | null
  onSave: (definition: RoutineDefinition, publishTime: string) => Promise<void>
  onCancel: () => void
}) {
  const { locale } = useI18n()
  const t = (ru: string, en: string) => (locale === 'ru' ? ru : en)
  const freshTask = (): RoutineTask => ({
    id: crypto.randomUUID().slice(0, 8),
    title: '',
    weekdays: [1, 2, 3, 4, 5, 6, 7],
    times: [],
    reminderEnabled: false,
    claimEnabled: false
  })
  const [title, setTitle] = useState(routine?.definition.title ?? '')
  const [tasks, setTasks] = useState<readonly RoutineTask[]>(
    routine?.definition.tasks ?? [freshTask()]
  )
  const [dayStart, setDayStart] = useState(routine?.definition.dayStart ?? '00:00')
  const [quickActions, setQuickActions] = useState<readonly RoutineQuickAction[]>(
    routine?.definition.quickActions ?? []
  )
  const [publishTime, setPublishTime] = useState(routine?.publishTime ?? '08:00')
  const [validation, setValidation] = useState<string | null>(null)
  const [presetsVisible, setPresetsVisible] = useState(!routine)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const update = (id: string, patch: Partial<RoutineTask>) =>
    setTasks((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  const move = (index: number, offset: number) =>
    setTasks((items) => {
      const next = [...items]
      ;[next[index], next[index + offset]] = [next[index + offset]!, next[index]!]
      return next
    })
  const weekdays =
    locale === 'ru'
      ? ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
      : ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
  async function submit() {
    const errors: Record<string, string> = {}
    if (!title.trim()) errors.title = t('Укажите название списка', 'Enter a list name')
    for (const task of tasks) {
      if (!task.title.trim()) errors[task.id] = t('Укажите название дела', 'Enter a task name')
      else if (
        task.recurrence &&
        (!Number.isInteger(task.recurrence.intervalDays) ||
          task.recurrence.intervalDays < 1 ||
          task.recurrence.intervalDays > 365 ||
          !task.recurrence.firstDueDate)
      )
        errors[task.id] = t(
          'Укажите интервал 1–365 дней и первую дату',
          'Enter 1–365 days and the first due date'
        )
      else if (!task.recurrence && !task.weekdays.length)
        errors[task.id] = t('Выберите хотя бы один день', 'Choose at least one day')
      else if (new Set(task.times).size !== task.times.length)
        errors[task.id] = t('Время не должно повторяться', 'Times must be unique')
    }
    setFieldErrors(errors)
    if (Object.keys(errors).length) return
    let definition: RoutineDefinition
    try {
      definition = normalizeRoutine({ title, tasks, dayStart, quickActions })
    } catch {
      setValidation(
        t(
          'Проверьте расписание: окна не должны пересекаться между собой или с границей дня. У каждой быстрой кнопки должны быть название, подпись и хотя бы одно дело.',
          'Check the schedule: up to 20 daily items, with distinct times.'
        )
      )
      return
    }
    setValidation(null)
    await onSave(definition, publishTime)
  }
  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      {!presetsVisible && (
        <Button
          className="min-h-11"
          variant="ghost"
          disabled={busy}
          onClick={() => setPresetsVisible(true)}
        >
          {t('Выбрать шаблон для черновика', 'Choose a preset for this draft')}
        </Button>
      )}
      {presetsVisible && (
        <div className="space-y-2 rounded-2xl bg-elevated p-4">
          <p className="text-sm font-medium">{t('Быстрый старт', 'Quick start')}</p>
          {routinePresets.map((preset) => (
            <div key={preset.id} className="space-y-2">
              <Button
                variant="soft"
                className="min-h-11 w-full"
                disabled={busy}
                onClick={() => {
                  const definition = presetDefinition(preset, locale)
                  setTitle(definition.title)
                  setTasks(definition.tasks)
                  setPublishTime(preset.publishTime)
                  setDayStart(preset.dayStart)
                  setQuickActions(definition.quickActions ?? [])
                  setFieldErrors({})
                  setValidation(null)
                  setPresetsVisible(false)
                }}
              >
                {preset.name[locale === 'ru' ? 'ru' : 'en']}
              </Button>
              <p className="text-xs text-faint">{preset.hint[locale === 'ru' ? 'ru' : 'en']}</p>
            </div>
          ))}
          <p className="text-xs text-faint">
            {t(
              'Заготовка заполняет форму — меняйте дела и время как удобно.',
              'A preset only fills the form — change tasks and times as you like.'
            )}
          </p>
        </div>
      )}
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="routine-title">
          {t('Название списка', 'List name')}
        </label>
        <Input
          disabled={busy}
          id="routine-title"
          autoFocus
          value={title}
          maxLength={80}
          placeholder={t('Например, забота о доме', 'For example, home care')}
          onChange={(e) => setTitle(e.target.value)}
          aria-invalid={Boolean(fieldErrors.title)}
        />
        {fieldErrors.title && (
          <p className="text-sm text-destructive" role="alert">
            {fieldErrors.title}
          </p>
        )}
      </div>
      <fieldset disabled={busy} className="space-y-3">
        <legend className="mb-3 font-display text-xl">
          {t('Что нужно делать', 'What needs doing')}
        </legend>
        {tasks.map((task, index) => (
          <div key={task.id} className="space-y-3 rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-center gap-2">
              <span className="text-xs tabular-nums text-faint">
                {String(index + 1).padStart(2, '0')}
              </span>
              <label className="sr-only" htmlFor={`task-${task.id}`}>
                {t('Название дела', 'Task name')} {index + 1}
              </label>
              <Input
                id={`task-${task.id}`}
                value={task.title}
                maxLength={60}
                placeholder={t('Название дела', 'Task name')}
                onChange={(e) => update(task.id, { title: e.target.value })}
                aria-invalid={Boolean(fieldErrors[task.id])}
              />
              <Button
                className="min-h-11 min-w-11"
                variant="ghost"
                size="icon"
                disabled={tasks.length === 1}
                aria-label={t('Удалить дело', 'Remove task')}
                onClick={() => setTasks((items) => items.filter((item) => item.id !== task.id))}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
            {fieldErrors[task.id] && (
              <p className="text-sm text-destructive" role="alert">
                {fieldErrors[task.id]}
              </p>
            )}
            <details>
              <summary className="cursor-pointer py-2 text-sm text-muted-foreground">
                {t('Расписание', 'Schedule')} ·{' '}
                {task.recurrence
                  ? t(
                      `каждые ${task.recurrence.intervalDays} дн. после выполнения`,
                      `every ${task.recurrence.intervalDays} days after completion`
                    )
                  : task.weekdays.length === 7
                    ? t('ежедневно', 'every day')
                    : task.weekdays.map((d) => weekdays[d - 1]).join(', ')}{' '}
                · {task.times.length ? task.times.join(', ') : t('в течение дня', 'any time')}
              </summary>
              <div className="space-y-4 pt-3">
                <label className="block space-y-1 text-sm" htmlFor={`note-${task.id}`}>
                  <span>{t('Условие или заметка', 'Condition or note')}</span>
                  <Input
                    id={`note-${task.id}`}
                    value={task.note ?? ''}
                    maxLength={120}
                    placeholder={t('Например, если просит', 'For example, if needed')}
                    onChange={(e) => update(task.id, { note: e.target.value })}
                  />
                </label>
                {!task.recurrence && quickActions.length > 0 && (
                  <label className="block space-y-1 text-sm" htmlFor={`activity-${task.id}`}>
                    <span>{t('Быстрое действие', 'Quick action')}</span>
                    <select
                      id={`activity-${task.id}`}
                      className="min-h-11 w-full rounded-lg border border-border bg-field px-3"
                      value={task.activityId ?? ''}
                      onChange={(e) => update(task.id, { activityId: e.target.value })}
                    >
                      <option value="">{t('Без быстрого действия', 'None')}</option>
                      {quickActions.map((action) => (
                        <option key={action.id} value={action.id}>
                          {action.label || t('Новая кнопка', 'New button')}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                <label className="block space-y-1 text-sm" htmlFor={`repeat-${task.id}`}>
                  <span>{t('Повторять', 'Repeat')}</span>
                  <select
                    id={`repeat-${task.id}`}
                    className="min-h-11 w-full rounded-lg border border-border bg-field px-3"
                    value={task.recurrence ? 'completion' : 'weekdays'}
                    onChange={(e) => {
                      if (e.target.value === 'completion')
                        update(task.id, {
                          recurrence: { intervalDays: 14, firstDueDate: '' },
                          weekdays: [],
                          times: [],
                          reminderEnabled: false,
                          activityId: ''
                        })
                      else
                        setTasks((items) =>
                          items.map((item) => {
                            if (item.id !== task.id) return item
                            const next = { ...item, weekdays: [1, 2, 3, 4, 5, 6, 7] }
                            delete next.recurrence
                            return next
                          })
                        )
                    }}
                  >
                    <option value="weekdays">{t('По дням недели', 'On weekdays')}</option>
                    <option value="completion">{t('После выполнения', 'After completion')}</option>
                  </select>
                </label>
                {task.recurrence ? (
                  <div className="space-y-3 rounded-xl bg-elevated p-3">
                    <div className="flex gap-2">
                      {[7, 14].map((days) => (
                        <Button
                          key={days}
                          variant={task.recurrence!.intervalDays === days ? 'primary' : 'soft'}
                          className="min-h-11"
                          aria-pressed={task.recurrence!.intervalDays === days}
                          onClick={() =>
                            update(task.id, {
                              recurrence: { ...task.recurrence!, intervalDays: days }
                            })
                          }
                        >
                          {days === 7
                            ? t('Раз в неделю', 'Weekly')
                            : t('Раз в 2 недели', 'Every 2 weeks')}
                        </Button>
                      ))}
                    </div>
                    <label className="block space-y-1 text-sm" htmlFor={`interval-${task.id}`}>
                      <span>
                        {t('Через сколько дней после выполнения', 'Days after completion')}
                      </span>
                      <Input
                        id={`interval-${task.id}`}
                        type="number"
                        min={1}
                        max={365}
                        step={1}
                        required
                        value={task.recurrence.intervalDays || ''}
                        onChange={(e) =>
                          update(task.id, {
                            recurrence: {
                              ...task.recurrence!,
                              intervalDays: Number(e.target.value)
                            }
                          })
                        }
                      />
                    </label>
                    <label className="block space-y-1 text-sm" htmlFor={`first-date-${task.id}`}>
                      <span>{t('Первая дата', 'First due date')}</span>
                      <Input
                        id={`first-date-${task.id}`}
                        type="date"
                        required
                        value={task.recurrence.firstDueDate}
                        onChange={(e) =>
                          update(task.id, {
                            recurrence: { ...task.recurrence!, firstDueDate: e.target.value }
                          })
                        }
                      />
                    </label>
                    <p className="text-xs text-muted-foreground">
                      {t(
                        'Появится в карточке дня и останется до выполнения. Нажмите «Готово» — отсчёт начнётся заново. Первая дата используется до первого выполнения.',
                        'Appears on the daily card and stays until done. Completion restarts the interval. The first date applies until the first completion.'
                      )}
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-7 gap-1">
                      {weekdays.map((name, i) => (
                        <button
                          key={name}
                          type="button"
                          aria-pressed={task.weekdays.includes(i + 1)}
                          className={`min-h-11 rounded-lg text-sm ${task.weekdays.includes(i + 1) ? 'bg-primary text-primary-foreground' : 'bg-elevated text-muted-foreground'}`}
                          onClick={() =>
                            update(task.id, {
                              weekdays: task.weekdays.includes(i + 1)
                                ? task.weekdays.filter((d) => d !== i + 1)
                                : [...task.weekdays, i + 1].sort()
                            })
                          }
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-faint">
                      {t(
                        'Без времени — одна отметка на день. Каждое время добавляет отдельную отметку.',
                        'No time means one daily checkbox. Each time adds a separate checkbox.'
                      )}
                    </p>
                    {task.times.map((time, i) => (
                      <div className="flex items-center gap-2" key={i}>
                        <label
                          className="min-w-0 flex-1 text-xs text-faint"
                          htmlFor={`time-${task.id}-${i}`}
                        >
                          {t('С', 'From')}
                          <Input
                            type="time"
                            required
                            id={`time-${task.id}-${i}`}
                            value={time.split(/[-–]/)[0] ?? ''}
                            onChange={(e) => {
                              const end = time.split(/[-–]/)[1]
                              update(task.id, {
                                times: task.times.map((v, j) =>
                                  i === j ? `${e.target.value}${end ? `-${end}` : ''}` : v
                                )
                              })
                            }}
                          />
                        </label>
                        <label
                          className="min-w-0 flex-1 text-xs text-faint"
                          htmlFor={`end-${task.id}-${i}`}
                        >
                          {t('До (необязательно)', 'Until (optional)')}
                          <Input
                            type="time"
                            id={`end-${task.id}-${i}`}
                            value={time.split(/[-–]/)[1] ?? ''}
                            onChange={(e) =>
                              update(task.id, {
                                times: task.times.map((v, j) =>
                                  i === j
                                    ? `${time.split(/[-–]/)[0]}${e.target.value ? `-${e.target.value}` : ''}`
                                    : v
                                )
                              })
                            }
                          />
                        </label>
                        <Button
                          variant="ghost"
                          className="min-h-11"
                          aria-label={t('Убрать время', 'Remove time')}
                          onClick={() => {
                            const times = task.times.filter((_, j) => j !== i)
                            update(task.id, {
                              times,
                              reminderEnabled: times.length > 0 && task.reminderEnabled
                            })
                          }}
                        >
                          ×
                        </Button>
                      </div>
                    ))}
                    <Button
                      variant="soft"
                      className="min-h-11"
                      disabled={task.times.length >= 20}
                      onClick={() => update(task.id, { times: [...task.times, '09:00'] })}
                    >
                      <Plus className="size-4" />
                      {t('Добавить время', 'Add time')}
                    </Button>
                    {task.times.length > 0 && (
                      <label className="flex min-h-11 items-center gap-3 text-sm">
                        <input
                          type="checkbox"
                          checked={task.reminderEnabled}
                          onChange={(e) => update(task.id, { reminderEnabled: e.target.checked })}
                        />
                        {t('Напоминать в это время', 'Remind at these times')}
                      </label>
                    )}
                  </>
                )}
                <label className="flex min-h-11 items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={task.claimEnabled}
                    onChange={(e) => update(task.id, { claimEnabled: e.target.checked })}
                  />
                  {t('Можно взять на себя на 30 минут', 'Allow claiming for 30 minutes')}
                </label>
                <div className="flex gap-2">
                  <Button
                    className="min-h-11"
                    size="sm"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp className="size-4" />
                    {t('Выше', 'Up')}
                  </Button>
                  <Button
                    className="min-h-11"
                    size="sm"
                    disabled={index === tasks.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown className="size-4" />
                    {t('Ниже', 'Down')}
                  </Button>
                </div>
              </div>
            </details>
          </div>
        ))}
        <Button
          variant="outline"
          className="min-h-11 w-full"
          disabled={tasks.length >= 20}
          onClick={() => setTasks((items) => [...items, freshTask()])}
        >
          <Plus className="size-4" />
          {t('Добавить дело', 'Add task')}
        </Button>
      </fieldset>
      <section className="space-y-3 rounded-2xl border border-border p-4">
        <h2 className="font-semibold">{t('Быстрые действия', 'Quick actions')}</h2>
        <p className="text-xs text-faint">
          {t(
            'Кнопка отмечает ближайшее дело из выбранной группы. Привяжите дела к кнопке в их расписании. Повтор не закроет следующее дело.',
            'A button completes the nearest task in its group. Assign tasks in their schedule. Repeated taps do not complete another task.'
          )}
        </p>
        {quickActions.map((action) => (
          <div className="space-y-2 border-t border-border pt-3" key={action.id}>
            <label className="block text-sm" htmlFor={`quick-label-${action.id}`}>
              {t('Текст кнопки', 'Button label')}
              <Input
                id={`quick-label-${action.id}`}
                maxLength={40}
                value={action.label}
                onChange={(e) =>
                  setQuickActions((actions) =>
                    actions.map((item) =>
                      item.id === action.id ? { ...item, label: e.target.value } : item
                    )
                  )
                }
              />
            </label>
            <label className="block text-sm" htmlFor={`quick-summary-${action.id}`}>
              {t('Подпись последней отметки', 'Last completion label')}
              <Input
                id={`quick-summary-${action.id}`}
                maxLength={40}
                placeholder={t('Последнее кормление', 'Last feeding')}
                value={action.summaryLabel}
                onChange={(e) =>
                  setQuickActions((actions) =>
                    actions.map((item) =>
                      item.id === action.id ? { ...item, summaryLabel: e.target.value } : item
                    )
                  )
                }
              />
            </label>
            <Button
              className="min-h-11"
              variant="ghost"
              onClick={() => {
                setQuickActions((actions) => actions.filter((item) => item.id !== action.id))
                setTasks((items) =>
                  items.map((item) =>
                    item.activityId === action.id ? { ...item, activityId: '' } : item
                  )
                )
              }}
            >
              {t('Удалить кнопку', 'Remove button')}
            </Button>
          </div>
        ))}
        <Button
          className="min-h-11"
          disabled={quickActions.length >= 3 || busy}
          onClick={() =>
            setQuickActions((actions) => [
              ...actions,
              { id: crypto.randomUUID().slice(0, 8), label: '', summaryLabel: '' }
            ])
          }
        >
          {t('Добавить кнопку', 'Add button')}
        </Button>
      </section>
      <label className="block space-y-2 text-sm" htmlFor="routine-day-start">
        <span>{t('Новый день начинается в', 'New day starts at')}</span>
        <Input
          id="routine-day-start"
          type="time"
          required
          disabled={busy}
          value={dayStart}
          onChange={(e) => setDayStart(e.target.value)}
        />
        <span className="block text-xs text-faint">
          {t(
            'Дела до этого времени относятся к предыдущему вечеру. Например, при 04:00 кормление в 01:00 остаётся во вчерашней карточке.',
            'Tasks before this time belong to the previous evening. With 04:00, a 01:00 task stays on the previous day’s card.'
          )}
        </span>
      </label>
      <div className="space-y-2">
        <label htmlFor="publish-time" className="text-sm font-medium">
          {t('Публиковать карточку дня', 'Publish daily card')}
        </label>
        <Input
          disabled={busy}
          id="publish-time"
          type="time"
          required
          value={publishTime}
          onChange={(e) => setPublishTime(e.target.value)}
        />
        <p className="text-xs text-faint">
          {t(
            'По времени дома. Топик подключается после сохранения списка.',
            'In household time. Connect a topic after saving the list.'
          )}
        </p>
      </div>
      <details className="rounded-2xl bg-elevated p-4">
        <summary className="cursor-pointer text-sm font-medium">
          {t('Предпросмотр карточки', 'Card preview')}
        </summary>
        <div className="mt-4 space-y-2">
          <p className="font-display text-lg">{title || t('Новый список', 'New list')}</p>
          {tasks.flatMap((task) =>
            (task.times.length ? task.times : ['']).map((time, index) => (
              <p className="break-words text-sm" key={`${task.id}-${index}`}>
                ☐ {time && `${time} · `}
                {task.title || t('Новое дело', 'New task')}
              </p>
            ))
          )}
        </div>
      </details>
      {routine && (
        <p className="text-sm text-muted-foreground">
          {t(
            'Изменения дел вступят в силу завтра. Сегодняшние отметки сохранятся.',
            'Task changes take effect tomorrow. Today’s checkboxes stay unchanged.'
          )}
        </p>
      )}
      {(error || validation) && (
        <p role="alert" className="text-sm text-destructive">
          {error || validation}
        </p>
      )}
      <div className="sticky bottom-20 flex gap-2 rounded-2xl border border-border bg-surface p-3 shadow-lg">
        <Button className="min-h-11" onClick={onCancel} disabled={busy}>
          {t('Отмена', 'Cancel')}
        </Button>
        <Button className="min-h-11 flex-1" variant="primary" type="submit" loading={busy}>
          {routine ? t('Сохранить', 'Save') : t('Создать список', 'Create list')}
        </Button>
      </div>
    </form>
  )
}
