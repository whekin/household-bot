import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, ChevronRight, Circle, Link2, Plus, RefreshCw } from 'lucide-react'
import type { RoutineDefinition } from '@household/domain'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useReadySession, useSession } from '@/app/session-context'
import { useI18n } from '@/i18n/context'
import { miniAppApiError, postMiniApp } from '@/api/client'
import { RoutineEditor } from './routine-editor'
import type { RoutineView, RoutinesResponse } from './types'

function demoData(): RoutinesResponse {
  const date = new Date().toISOString().slice(0, 10)
  const definition: RoutineDefinition = {
    title: 'Забота о доме',
    tasks: [
      {
        id: 'plants',
        title: 'Проверить растения',
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        times: ['09:00'],
        reminderEnabled: true,
        claimEnabled: true
      },
      {
        id: 'water',
        title: 'Заменить питьевую воду',
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        times: [],
        reminderEnabled: false,
        claimEnabled: false
      }
    ]
  }
  return {
    routines: [
      {
        id: 'aabbccddeeff0011',
        revision: 1,
        definition,
        effectiveDate: null,
        publishTime: '08:00',
        timezone: 'Asia/Tbilisi',
        paused: false,
        destination: { chatId: '-1001', threadId: 136, name: 'Домашние дела' },
        groupStatus: 'ready',
        subscribed: false,
        dmBlocked: false,
        privateCardUnknown: false,
        errors: [],
        day: {
          date,
          title: definition.title,
          rows: definition.tasks.map((task, i) => ({
            ...task,
            id: `${date.replaceAll('-', '')}${i}`,
            taskId: task.id,
            localTime: task.times[0] ?? null,
            dueAt: null,
            version: 0,
            status: i === 0 ? 'completed' : 'pending',
            actorId: i === 0 ? 'demo' : null,
            actorName: i === 0 ? 'Саша' : null,
            actedAt: null,
            expiresAt: null
          }))
        }
      }
    ],
    topics: [{ threadId: 136, name: 'Домашние дела' }],
    botUrl: ''
  }
}

export function RoutinesView({ onBack }: { onBack: () => void }) {
  const session = useReadySession()
  const { initData, handleMiniAppRequestError } = useSession()
  const { locale } = useI18n()
  const t = (ru: string, en: string) => (locale === 'ru' ? ru : en)
  const [data, setData] = useState<RoutinesResponse | null>(null)
  const dataRef = useRef<RoutinesResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<RoutineView | 'new' | null>(null)
  const [binding, setBinding] = useState<RoutineView | null>(null)
  const [link, setLink] = useState('')
  const [topicName, setTopicName] = useState('')
  const editorOpen = useRef(false)
  editorOpen.current = editing !== null || binding !== null
  const [notice, setNotice] = useState<string | null>(null)
  const createId = useRef(crypto.randomUUID().replaceAll('-', '').slice(0, 16))
  const mounted = useRef(true)
  function store(value: RoutinesResponse) {
    dataRef.current = value
    if (mounted.current) setData(value)
  }
  async function request(
    body: Record<string, unknown> = { operation: 'list' },
    background = false
  ): Promise<boolean> {
    if (busyRef.current) return false
    busyRef.current = true
    setBusy(true)
    if (!background) {
      setError(null)
      setNotice(null)
    }
    try {
      if (session.mode === 'demo') {
        const { createDemoDay, refreshDemoActions } = await import('./routine-demo')
        const next = structuredClone(dataRef.current ?? demoData())
        const doc = next.routines.find((r) => r.id === body.id)
        if (body.operation === 'save') {
          const definition = body.definition as RoutineDefinition
          if (doc) {
            doc.definition = definition
            doc.revision++
            doc.effectiveDate = t('завтра', 'tomorrow')
          } else
            next.routines.push({
              ...demoData().routines[0]!,
              id: String(body.id),
              definition,
              destination: null,
              groupStatus: 'none',
              day: createDemoDay(definition)
            })
        }
        if (doc && body.operation === 'pause') {
          doc.paused = Boolean(body.paused)
          doc.revision++
        }
        if (doc && body.operation === 'subscribe') doc.subscribed = Boolean(body.enabled)
        if (doc && (body.operation === 'act' || body.operation === 'quick_complete')) {
          const row = doc.day?.rows.find((r) => r.id === body.rowId)
          if (row && !(body.operation === 'quick_complete' && row.status === 'completed')) {
            row.status =
              body.operation === 'quick_complete' || body.action === 'complete'
                ? 'completed'
                : body.action === 'claim'
                  ? 'claimed'
                  : 'pending'
            row.actorName = session.member.displayName
            row.actorId = session.member.id
            row.actedAt = new Date().toISOString()
            row.version++
          }
        }
        if (doc && body.operation === 'bind') {
          doc.destination =
            body.mode === 'none'
              ? null
              : { chatId: '-1001', threadId: 136, name: String(body.name || 'Топик по ссылке') }
          doc.revision++
        }
        next.routines.forEach(refreshDemoActions)
        store(next)
      } else {
        const { response, payload } = await postMiniApp<RoutinesResponse>('/api/miniapp/routines', {
          initData,
          joinToken: new URLSearchParams(window.location.search).get('join') ?? undefined,
          ...body
        })
        if (!response.ok)
          throw miniAppApiError(
            response,
            payload,
            t('Не удалось загрузить дела', 'Could not load routines')
          )
        store(payload)
      }
      return true
    } catch (e) {
      if (!handleMiniAppRequestError(e) && mounted.current)
        setError(
          e instanceof Error
            ? e.message
            : t('Ошибка соединения. Попробуйте ещё раз.', 'Connection failed. Try again.')
        )
      return false
    } finally {
      busyRef.current = false
      if (mounted.current) setBusy(false)
    }
  }
  useEffect(() => {
    mounted.current = true
    void request()
    const timer = setInterval(() => {
      if (!document.hidden && !editorOpen.current) void request({ operation: 'list' }, true)
    }, 15_000)
    return () => {
      mounted.current = false
      clearInterval(timer)
    }
  }, [initData, session.mode])
  const back = () => {
    if (editing || binding) {
      setEditing(null)
      setBinding(null)
      setError(null)
    } else onBack()
  }
  const header = (
    <div className="space-y-4">
      <Button variant="ghost" className="min-h-11 -ml-3" onClick={back} disabled={busy}>
        <ArrowLeft className="size-4" />
        {t('Назад', 'Back')}
      </Button>
      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-widest text-primary">
          {t('Общее, без суеты', 'Shared, without the fuss')}
        </p>
        <h1 className="font-display text-3xl font-semibold">
          {editing
            ? editing === 'new'
              ? t('Новый список', 'New list')
              : t('Настроить список', 'Edit list')
            : binding
              ? t('Карточка в группе', 'Group card')
              : t('Дела на сегодня', 'Today’s routines')}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {binding
            ? binding.definition.title
            : editing
              ? t(
                  'Только нужные дела, в удобное время.',
                  'Just the tasks you need, at the right time.'
                )
              : t(
                  'Одна отметка — и все знают, что уже сделано.',
                  'One checkmark keeps everyone up to date.'
                )}
        </p>
      </div>
    </div>
  )
  if (editing)
    return (
      <div className="space-y-6">
        {header}
        <RoutineEditor
          key={editing === 'new' ? 'new' : editing.id}
          routine={editing === 'new' ? null : editing}
          busy={busy}
          error={error}
          onCancel={back}
          onSave={async (definition, publishTime) => {
            const body = {
              operation: 'save',
              id: editing === 'new' ? createId.current : editing.id,
              expectedRevision: editing === 'new' ? 0 : editing.revision,
              definition,
              publishTime
            }
            if (await request(body)) {
              setEditing(null)
              setNotice(
                t(
                  'Список сохранён. Теперь можно подключить топик.',
                  'List saved. You can now connect a topic.'
                )
              )
            }
          }}
        />
        {error && editing !== 'new' && (
          <Button
            className="min-h-11"
            onClick={async () => {
              if (await request()) {
                const fresh = dataRef.current?.routines.find((r) => r.id === editing.id)
                if (fresh) setEditing({ ...editing, revision: fresh.revision })
                setNotice(
                  t(
                    'Версия обновлена; проверьте черновик перед сохранением.',
                    'Version refreshed; review your draft before saving.'
                  )
                )
              }
            }}
          >
            {t('Обновить версию, сохранить черновик', 'Refresh version, keep draft')}
          </Button>
        )}
      </div>
    )
  if (binding) {
    const bindNow = async (values: Record<string, unknown>) => {
      if (
        await request({
          operation: 'bind',
          id: binding.id,
          expectedRevision: binding.revision,
          ...values
        })
      ) {
        setBinding(null)
        setNotice(
          t(
            'Назначение сохранено. Статус доставки появится в списке.',
            'Destination saved. Delivery status appears in the list.'
          )
        )
      }
    }
    const topics = new Map((data?.topics ?? []).map((topic) => [topic.threadId, topic.name]))
    for (const routine of data?.routines ?? [])
      if (routine.destination) topics.set(routine.destination.threadId, routine.destination.name)
    return (
      <div className="space-y-6">
        {header}
        {binding.destination && (
          <p className="rounded-xl bg-elevated p-3 text-sm">
            {t('Сейчас:', 'Current:')} {binding.destination.name}
          </p>
        )}
        <section className="space-y-3 rounded-2xl border border-border p-4">
          <h2 className="font-semibold">{t('Вставить ссылку', 'Paste a link')}</h2>
          <label htmlFor="topic-link" className="block text-sm text-muted-foreground">
            {t(
              'Скопируйте ссылку на любое сообщение внутри топика',
              'Copy a link to a message inside the topic'
            )}
          </label>
          <Input
            id="topic-link"
            type="url"
            placeholder="https://t.me/c/…/…/…"
            value={link}
            onChange={(e) => setLink(e.target.value)}
          />
          <Button
            className="min-h-11 w-full"
            variant="primary"
            disabled={busy || !link.trim()}
            onClick={() => void bindNow({ mode: 'link', link })}
          >
            <Link2 className="size-4" />
            {t('Подключить по ссылке', 'Connect with link')}
          </Button>
        </section>
        <section className="space-y-3 rounded-2xl border border-border p-4">
          <h2 className="font-semibold">{t('Создать новый топик', 'Create a topic')}</h2>
          <label className="sr-only" htmlFor="topic-name">
            {t('Название топика', 'Topic name')}
          </label>
          <Input
            id="topic-name"
            maxLength={80}
            value={topicName}
            onChange={(e) => setTopicName(e.target.value)}
          />
          <Button
            className="min-h-11 w-full"
            disabled={busy || !topicName.trim()}
            onClick={() => void bindNow({ mode: 'create', name: topicName })}
          >
            {t('Создать и подключить', 'Create and connect')}
          </Button>
        </section>
        {topics.size > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-medium">{t('Известные топики', 'Known topics')}</h2>
            {[...topics].map(([threadId, name]) => (
              <Button
                key={threadId}
                className="min-h-11 w-full justify-between"
                disabled={busy}
                onClick={() => void bindNow({ mode: 'known', threadId })}
              >
                {name}
                <ChevronRight className="size-4" />
              </Button>
            ))}
          </section>
        )}
        <p className="text-xs text-faint">
          {t(
            'Не получается со ссылкой? Отправьте /bind внутри нужного топика и выберите список.',
            'Link not working? Send /bind inside the topic and choose this list.'
          )}
        </p>
        <Button
          className="min-h-11 w-full"
          variant="ghost"
          disabled={busy}
          onClick={() => void bindNow({ mode: 'none' })}
        >
          {t('Не публиковать в группе', 'Do not post in the group')}
        </Button>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    )
  }
  return (
    <div className="space-y-6">
      {header}
      {session.member.isAdmin && (
        <Button
          className="min-h-11 w-full"
          variant="primary"
          disabled={busy}
          onClick={() => {
            createId.current = crypto.randomUUID().replaceAll('-', '').slice(0, 16)
            setError(null)
            setEditing('new')
          }}
        >
          <Plus className="size-4" />
          {t('Создать список', 'Create a list')}
        </Button>
      )}
      {!data && !error && (
        <p role="status" className="py-8 text-center text-sm text-muted-foreground">
          {t('Загружаем дела…', 'Loading routines…')}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-xl bg-primary-soft p-3 text-sm text-primary">
          {notice}
        </p>
      )}
      {error && (
        <div role="alert" className="space-y-2 rounded-xl bg-destructive-soft p-3 text-sm">
          <p>{error}</p>
          <Button onClick={() => void request()} disabled={busy}>
            <RefreshCw className="size-4" />
            {t('Обновить', 'Refresh')}
          </Button>
        </div>
      )}
      {data?.routines.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border px-6 py-10 text-center">
          <Circle className="mx-auto mb-4 size-8 text-primary" />
          <p className="font-display text-xl">
            {t('Пока можно выдохнуть', 'Nothing on the list yet')}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {session.member.isAdmin
              ? t(
                  'Начните с пары дел. Расписание можно менять по мере необходимости.',
                  'Start with a couple of tasks. Adjust the schedule as needed.'
                )
              : t(
                  'Администратор дома может создать первый список.',
                  'A household admin can create the first list.'
                )}
          </p>
        </div>
      )}
      {data?.routines.map((routine) => {
        const done = routine.day?.rows.filter((r) => r.status === 'completed').length ?? 0
        const total = routine.day?.rows.length ?? 0
        return (
          <section
            key={routine.id}
            className="overflow-hidden rounded-2xl border border-border bg-surface"
          >
            <div className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-3">
                <h2 className="break-words font-display text-xl font-semibold">
                  {routine.day?.title ?? routine.definition.title}
                </h2>
                <span className="shrink-0 rounded-full bg-elevated px-2.5 py-1 text-xs tabular-nums text-muted-foreground">
                  {routine.paused ? t('Пауза', 'Paused') : `${done} / ${total}`}
                </span>
              </div>
              <p className="text-xs text-faint">
                {routine.destination?.name ?? t('Без публикации в группе', 'No group posting')} ·{' '}
                {routine.timezone}
              </p>
              {routine.groupStatus === 'pending' && (
                <p className="text-xs text-faint">
                  {t('Карточка ожидает публикации', 'Card awaiting publication')}
                </p>
              )}
              {routine.groupStatus === 'error' && (
                <p className="text-xs text-destructive">
                  {t('Проверьте подключение топика', 'Check the topic connection')}
                </p>
              )}
              {routine.groupStatus === 'unknown' && (
                <p className="text-xs text-destructive">
                  {t(
                    'Telegram не подтвердил публикацию — проверьте топик',
                    'Telegram did not confirm publication — check the topic'
                  )}
                </p>
              )}
            </div>
            {routine.lastActions?.length || routine.quickTargets?.length ? (
              <div className="space-y-3 px-4 pb-4">
                {routine.lastActions?.map((last) => (
                  <p className="text-sm text-muted-foreground" key={last.label}>
                    {last.label}:{' '}
                    {last.at
                      ? `${new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-GB', { timeZone: routine.timezone, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(last.at))}, ${last.actorName ?? ''}`
                      : t('пока нет отметок', 'nothing recorded yet')}
                  </p>
                ))}
                {routine.quickTargets?.map((target) => (
                  <Button
                    key={target.id}
                    className="min-h-11 w-full"
                    variant="primary"
                    disabled={busy || routine.paused}
                    onClick={async () => {
                      if (
                        await request({
                          operation: 'quick_complete',
                          id: routine.id,
                          activityId: target.id,
                          rowId: target.rowId,
                          version: target.version,
                          requestId: crypto.randomUUID()
                        })
                      )
                        setNotice(
                          target.completed
                            ? t(
                                'Уже отмечено — повтор не добавлен',
                                'Already recorded — no duplicate added'
                              )
                            : t('Выполнение записано', 'Completion recorded')
                        )
                    }}
                  >
                    {target.completed ? '✓ ' : ''}
                    {target.label}
                  </Button>
                ))}
              </div>
            ) : null}
            <div className="divide-y divide-border border-y border-border">
              {routine.day?.rows.map((row) => (
                <div key={row.id} className="px-4 py-1">
                  <button
                    type="button"
                    disabled={busy || routine.paused}
                    aria-pressed={row.status === 'completed'}
                    onClick={() =>
                      void request({
                        operation: 'act',
                        id: routine.id,
                        rowId: row.id,
                        version: row.version,
                        action: row.status === 'completed' ? 'reopen' : 'complete',
                        requestId: crypto.randomUUID()
                      })
                    }
                    className="flex min-h-16 w-full items-center gap-3 text-left disabled:opacity-60"
                  >
                    <span
                      className={`flex size-6 shrink-0 items-center justify-center rounded-full border ${row.status === 'completed' ? 'border-primary bg-primary text-primary-foreground' : 'border-border-hover'}`}
                    >
                      {row.status === 'completed' && <Check className="size-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block break-words text-sm font-medium ${row.status === 'completed' ? 'text-muted-foreground' : 'text-foreground'}`}
                      >
                        {row.title}
                      </span>
                      {row.note && (
                        <span className="mt-1 block text-xs text-muted-foreground">{row.note}</span>
                      )}
                      <span className="mt-0.5 block text-xs text-faint">
                        {row.recurrenceDueDate
                          ? row.nextDueDate
                            ? `${t('Следующий раз', 'Next due')}: ${row.nextDueDate}`
                            : `${t('Сделать с', 'Due since')}: ${row.recurrenceDueDate}`
                          : (row.localTime?.replace('-', '–') ?? t('В течение дня', 'Any time'))}
                        {row.actorName && row.status !== 'pending'
                          ? ` · ${row.actorName}${row.status === 'claimed' ? t(' занимается', ' is handling it') : ''}`
                          : ''}
                      </span>
                    </span>
                  </button>
                  {row.claimEnabled && row.status !== 'completed' && !routine.paused && (
                    <Button
                      size="sm"
                      className="mb-2 ml-9 min-h-11"
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        void request({
                          operation: 'act',
                          id: routine.id,
                          rowId: row.id,
                          version: row.version,
                          action:
                            row.status === 'claimed' && row.actorId === session.member.id
                              ? 'release'
                              : 'claim',
                          requestId: crypto.randomUUID()
                        })
                      }
                    >
                      {row.status === 'claimed' && row.actorId === session.member.id
                        ? t('Освободить', 'Release')
                        : t('Возьму на себя', 'I’ll handle it')}
                    </Button>
                  )}
                </div>
              ))}
              {!total && (
                <p className="p-4 text-sm text-muted-foreground">
                  {t('На сегодня дел нет', 'No tasks today')}
                </p>
              )}
            </div>
            {Boolean(routine.recurringTasks?.length) && (
              <details className="border-b border-border px-4 py-3">
                <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">
                  {t('Следующие повторения', 'Upcoming repeats')}
                </summary>
                <div className="space-y-3 pb-2">
                  {routine.recurringTasks?.map((task) => (
                    <div key={task.taskId} className="rounded-xl bg-elevated p-3 text-sm">
                      <p className="font-medium">{task.title}</p>
                      <p className="mt-1 text-muted-foreground">
                        {task.nextDueDate} ·{' '}
                        {t(
                          `каждые ${task.intervalDays} дн. после выполнения`,
                          `every ${task.intervalDays} days after completion`
                        )}
                      </p>
                      {task.lastCompletedAt && (
                        <p className="mt-1 text-xs text-faint">
                          {t('Последний раз', 'Last done')}:{' '}
                          {new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-GB', {
                            timeZone: routine.timezone,
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric'
                          }).format(new Date(task.lastCompletedAt))}{' '}
                          · {task.lastCompletedByName}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            )}
            <div className="space-y-3 p-4">
              <label className="flex min-h-11 items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={routine.subscribed}
                  onChange={(e) =>
                    void request({
                      operation: 'subscribe',
                      id: routine.id,
                      enabled: e.target.checked
                    })
                  }
                />
                {t('Напоминать мне в личке', 'Remind me privately')}
              </label>
              {data.botUrl && (
                <a
                  className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline"
                  href={data.botUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('Открыть дела в боте', 'Open routines in the bot')}
                </a>
              )}
              {routine.effectiveDate && (
                <p className="text-xs text-faint">
                  {t('Новое расписание с', 'New schedule from')} {routine.effectiveDate}
                </p>
              )}
              {routine.errors.map((message) => (
                <p key={message} className="text-xs text-destructive" role="status">
                  {message}
                </p>
              ))}
              {((session.member.isAdmin && routine.groupStatus === 'unknown') ||
                routine.privateCardUnknown) && (
                <div className="space-y-2 rounded-xl bg-elevated p-3 text-sm">
                  <p>
                    {t(
                      'Сначала проверьте чат. Повторяйте отправку только если карточки там нет.',
                      'Check the chat first. Retry only if the card is missing.'
                    )}
                  </p>
                  {session.member.isAdmin && routine.groupStatus === 'unknown' && (
                    <Button
                      className="min-h-11 w-full"
                      disabled={busy}
                      onClick={() =>
                        void request({ operation: 'retry_group_card', id: routine.id })
                      }
                    >
                      {t('В топике карточки нет — отправить', 'No card in topic — send again')}
                    </Button>
                  )}
                  {routine.privateCardUnknown && (
                    <Button
                      className="min-h-11 w-full"
                      disabled={busy}
                      onClick={() =>
                        void request({ operation: 'retry_private_card', id: routine.id })
                      }
                    >
                      {t('В личке карточки нет — отправить', 'No private card — send again')}
                    </Button>
                  )}
                </div>
              )}
              {session.member.isAdmin && (
                <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                  <Button
                    className="min-h-11"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setError(null)
                      setEditing(routine)
                    }}
                  >
                    {t('Настроить', 'Edit')}
                  </Button>
                  <Button
                    className="min-h-11"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setError(null)
                      setBinding(routine)
                      setTopicName(routine.definition.title)
                      setLink('')
                    }}
                  >
                    {t('Топик', 'Topic')}
                  </Button>
                  <Button
                    className="min-h-11"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void request({
                        operation: 'pause',
                        id: routine.id,
                        paused: !routine.paused,
                        expectedRevision: routine.revision
                      })
                    }
                  >
                    {routine.paused ? t('Продолжить', 'Resume') : t('Приостановить', 'Pause')}
                  </Button>
                </div>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}
