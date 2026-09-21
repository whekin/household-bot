import {
  applyRoutineAction,
  routineDayDate,
  routineTimeInstant,
  pickRoutineQuickTarget,
  normalizeRoutine,
  routineOccurrencesForDate,
  Temporal,
  type RoutineAction,
  type RoutineDefinition,
  type RoutineProgress
} from '@household/domain'
import type {
  HouseholdMemberRecord,
  RoutineDocument,
  RoutineRepository,
  RoutineRow
} from '@household/ports'

export class RoutineError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message)
  }
}
export type RoutineActor = Pick<
  HouseholdMemberRecord,
  'id' | 'householdId' | 'displayName' | 'status' | 'isAdmin' | 'telegramUserId'
>
export function routineDate(
  doc: Pick<RoutineDocument, 'timezone'> &
    Partial<Pick<RoutineDocument, 'definition' | 'nextDefinition' | 'activeDayExtension'>>,
  now: string
): string {
  if (doc.activeDayExtension && Date.parse(now) < Date.parse(doc.activeDayExtension.until))
    return doc.activeDayExtension.date
  const current = routineDayDate(doc.timezone, doc.definition?.dayStart ?? '00:00', now)
  const pending = doc.nextDefinition
  if (!pending) return current
  const nextDate = routineDayDate(doc.timezone, pending.definition.dayStart ?? '00:00', now)
  if (nextDate >= pending.effectiveDate) return nextDate
  // When moving midnight later, keep the previous card open until the new boundary.
  return current >= pending.effectiveDate
    ? Temporal.PlainDate.from(pending.effectiveDate).subtract({ days: 1 }).toString()
    : current
}
function materializeRecurringTasks(doc: RoutineDocument, date: string): void {
  const tasks = doc.definition.tasks.filter((task) => task.recurrence)
  if (!tasks.length && !doc.recurringTasks) return
  const states = (doc.recurringTasks ??= {})
  for (const id of Object.keys(states)) {
    if (!tasks.some((task) => task.id === id)) delete states[id]
  }
  const day = doc.days.find((day) => day.date === date)!
  day.rows = day.rows.filter((row) => !row.recurrenceDueDate)
  for (const [index, task] of tasks.entries()) {
    const recurrence = task.recurrence!
    const state = (states[task.id] ??= {
      nextDueDate: recurrence.firstDueDate,
      lastCompletedAt: null,
      lastCompletedBy: null,
      lastCompletedByName: null,
      row: null
    })
    state.nextDueDate = state.lastCompletedAt
      ? Temporal.Instant.from(state.lastCompletedAt)
          .toZonedDateTimeISO(doc.timezone)
          .toPlainDate()
          .add({ days: recurrence.intervalDays })
          .toString()
      : recurrence.firstDueDate
    const completedToday =
      state.row?.status === 'completed' &&
      state.row.actedAt &&
      routineDate(doc, state.row.actedAt) === date
    if (state.nextDueDate > date && !completedToday) continue
    if (!state.row || (state.row.status === 'completed' && !completedToday)) {
      state.row = {
        id: `${date.replaceAll('-', '')}r${index.toString(36)}`,
        taskId: task.id,
        title: task.title,
        localTime: null,
        dueAt: null,
        recurrenceDueDate: state.nextDueDate,
        reminderEnabled: false,
        claimEnabled: task.claimEnabled,
        reminderSuppressed: false,
        version: 0,
        status: 'pending',
        actorId: null,
        actorName: null,
        actedAt: null,
        expiresAt: null
      }
    }
    state.row.title = task.title
    if (task.note) state.row.note = task.note
    else delete state.row.note
    state.row.claimEnabled = task.claimEnabled
    if (state.row.status !== 'completed') state.row.recurrenceDueDate = state.nextDueDate
    if (state.row.status === 'completed') state.row.nextDueDate = state.nextDueDate
    else delete state.row.nextDueDate
    day.rows.push(structuredClone(state.row))
  }
}

export function materializeRoutineDay(doc: RoutineDocument, now: string): void {
  if (doc.activeDayExtension && Date.parse(now) >= Date.parse(doc.activeDayExtension.until))
    delete doc.activeDayExtension
  if (
    doc.nextDefinition &&
    routineDayDate(doc.timezone, doc.nextDefinition.definition.dayStart ?? '00:00', now) >=
      doc.nextDefinition.effectiveDate
  ) {
    doc.definition = doc.nextDefinition.definition
    doc.nextDefinition = null
  }
  const date = routineDate(doc, now)
  // Freeze only an extension already being observed, not a future proposed change.
  if (
    !doc.activeDayExtension &&
    doc.nextDefinition &&
    routineDayDate(doc.timezone, doc.definition.dayStart ?? '00:00', now) > date
  ) {
    doc.activeDayExtension = {
      date,
      until: routineTimeInstant(
        doc.nextDefinition.effectiveDate,
        doc.nextDefinition.definition.dayStart ?? '00:00',
        doc.timezone
      ).toString()
    }
  }
  if (!doc.days.some((day) => day.date === date)) {
    const rows = routineOccurrencesForDate({
      definition: doc.definition,
      localDate: date,
      timezone: doc.timezone
    }).map((seed, index): RoutineRow => ({
      id: `${date.replaceAll('-', '')}${index.toString(36)}`,
      taskId: seed.taskId,
      title: seed.title,
      localTime: seed.localTime,
      dueAt: seed.dueAt?.toString() ?? null,
      windowEndsAt: seed.windowEndsAt?.toString() ?? null,
      ...(seed.note ? { note: seed.note } : {}),
      ...(seed.activityId ? { activityId: seed.activityId } : {}),
      reminderEnabled: seed.reminderEnabled,
      claimEnabled: seed.claimEnabled,
      reminderSuppressed: false,
      version: 0,
      status: 'pending',
      actorId: null,
      actorName: null,
      actedAt: null,
      expiresAt: null
    }))
    doc.days.push({
      date,
      title: doc.definition.title,
      rows,
      dayStart: doc.definition.dayStart ?? '00:00',
      quickActions: doc.definition.quickActions ?? []
    })
  }
  materializeRecurringTasks(doc, date)
  // Keep a month of history; old Telegram buttons are rejected before lookup.
  const cutoff = Temporal.PlainDate.from(date).subtract({ days: 30 }).toString()
  doc.days = doc.days.filter((day) => day.date >= cutoff)
  doc.messages = doc.messages.filter((message) => message.date >= cutoff)
  doc.actionIds = doc.actionIds.slice(-1000)
}
function progress(row: RoutineRow): RoutineProgress {
  if (row.status === 'completed')
    return {
      status: 'completed',
      memberId: row.actorId!,
      completedAt: Temporal.Instant.from(row.actedAt!)
    }
  if (row.status === 'claimed')
    return {
      status: 'claimed',
      memberId: row.actorId!,
      claimedAt: Temporal.Instant.from(row.actedAt!),
      expiresAt: Temporal.Instant.from(row.expiresAt!)
    }
  return { status: 'pending' }
}
export function createRoutineService(
  repository: RoutineRepository,
  clock = () => Temporal.Now.instant().toString()
) {
  function authorize(actor: RoutineActor, admin = false) {
    if (actor.status !== 'active' || (admin && !actor.isAdmin))
      throw new RoutineError('Недостаточно прав', 403)
  }
  return {
    repository,
    async list(actor: RoutineActor) {
      authorize(actor)
      const docs = await repository.list(actor.householdId)
      return Promise.all(
        docs.map((doc) =>
          repository.change(doc.id, actor.householdId, (d) => materializeRoutineDay(d, clock()))
        )
      )
    },
    async save(
      actor: RoutineActor,
      input: {
        id: string
        expectedRevision: number
        definition: RoutineDefinition
        publishTime: string
        timezone: string
      }
    ) {
      authorize(actor, true)
      if (!/^[a-f0-9]{16}$/.test(input.id))
        throw new RoutineError('Некорректный идентификатор списка')
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.publishTime))
        throw new RoutineError('Укажите время публикации')
      let definition: RoutineDefinition
      try {
        definition = normalizeRoutine(input.definition)
      } catch {
        throw new RoutineError(
          'Проверьте названия и расписание: до 20 отметок в день, время ЧЧ:ММ, без повторов'
        )
      }
      const now = clock()
      routineDate({ timezone: input.timezone }, now)
      if (input.expectedRevision === 0) {
        const existing = await repository.get(input.id)
        if (existing) {
          if (existing.householdId !== actor.householdId)
            throw new RoutineError('Список недоступен', 404)
          return existing
        }
        const doc: RoutineDocument = {
          id: input.id,
          householdId: actor.householdId,
          revision: 1,
          definition,
          nextDefinition: null,
          timezone: input.timezone,
          publishTime: input.publishTime,
          paused: false,
          destination: null,
          topicCreation: null,
          subscriptions: {},
          days: [],
          messages: [],
          actionIds: [],
          lease: null,
          createdAt: now,
          resumedAt: now
        }
        materializeRoutineDay(doc, now)
        return repository.create(doc)
      }
      return repository.change(input.id, actor.householdId, (doc) => {
        if (doc.revision !== input.expectedRevision)
          throw new RoutineError('Список уже изменён. Обновите данные; ваш черновик сохранён.', 409)
        materializeRoutineDay(doc, now)
        doc.nextDefinition = {
          effectiveDate: Temporal.PlainDate.from(
            [
              routineDate(doc, now),
              routineDayDate(doc.timezone, definition.dayStart ?? '00:00', now)
            ]
              .sort()
              .at(-1)!
          )
            .add({ days: 1 })
            .toString(),
          definition
        }
        doc.publishTime = input.publishTime
        doc.revision += 1
      })
    },
    async pause(actor: RoutineActor, id: string, paused: boolean, expectedRevision: number) {
      authorize(actor, true)
      return repository.change(id, actor.householdId, (doc) => {
        if (doc.revision !== expectedRevision)
          throw new RoutineError('Список уже изменён. Обновите данные.', 409)
        doc.paused = paused
        doc.resumedAt = clock()
        doc.revision += 1
      })
    },
    async subscribe(actor: RoutineActor, id: string, enabled: boolean) {
      authorize(actor)
      return repository.change(id, actor.householdId, (doc) => {
        for (const message of enabled ? doc.messages : []) {
          if (message.chatId === actor.telegramUserId && message.status === 'blocked') {
            message.status = message.messageId === null ? 'sending' : 'sent'
            message.error = null
            message.retryAt = null
          }
        }
        doc.subscriptions[actor.id] = {
          telegramUserId: actor.telegramUserId,
          enabled,
          blocked: false
        }
      })
    },
    async act(
      actor: RoutineActor,
      input: {
        id: string
        rowId: string
        version: number
        action: RoutineAction
        requestId: string
        activityId?: string
      }
    ) {
      authorize(actor)
      if (
        !['claim', 'release', 'complete', 'reopen'].includes(input.action) ||
        !input.requestId ||
        input.requestId.length > 160
      )
        throw new RoutineError('Некорректное действие')
      return repository.change(input.id, actor.householdId, (doc) => {
        const requestKey = `${actor.id}:${input.requestId}`
        if (doc.actionIds.includes(requestKey)) return
        const now = clock()
        materializeRoutineDay(doc, now)
        const day = doc.days.find((d) => d.date === routineDate(doc, now))!
        const row = day.rows.find((r) => r.id === input.rowId)
        if (!row) throw new RoutineError('Эта карточка устарела. Откройте дела на сегодня.', 409)
        if (doc.paused) throw new RoutineError('Список на паузе', 409)
        if (input.activityId) {
          if (
            input.action !== 'complete' ||
            !day.quickActions?.some((action) => action.id === input.activityId)
          )
            throw new RoutineError('Быстрое действие недоступно', 409)
          const target = pickRoutineQuickTarget(day.rows, input.activityId, now)
          if (target?.id !== row.id)
            throw new RoutineError('Подходящее дело изменилось. Обновите карточку.', 409)
        }
        const result = applyRoutineAction({
          state: { version: row.version, progress: progress(row) },
          expectedVersion: input.version,
          action: input.action,
          memberId: actor.id,
          claimEnabled: row.claimEnabled,
          now: Temporal.Instant.from(now)
        })
        if (result.status === 'conflict')
          throw new RoutineError('Уже отмечено другим участником. Карточка обновляется.', 409)
        if (result.status === 'claimed_by_other')
          throw new RoutineError('Этим уже занимается другой участник', 409)
        if (result.status === 'claim_disabled')
          throw new RoutineError('Для этого дела взятие выключено')
        if (result.status === 'changed') {
          if (input.action === 'reopen' && row.dueAt && Date.parse(row.dueAt) <= Date.parse(now))
            row.reminderSuppressed = true
          row.version = result.state.version
          const next = result.state.progress
          row.status = next.status
          row.actorId = next.status === 'pending' ? null : actor.id
          row.actorName = next.status === 'pending' ? null : actor.displayName
          row.actedAt = next.status === 'pending' ? null : now
          row.expiresAt = next.status === 'claimed' ? next.expiresAt.toString() : null
          if (row.recurrenceDueDate) {
            const state = doc.recurringTasks![row.taskId]!
            const recurrence = doc.definition.tasks.find(
              (task) => task.id === row.taskId
            )!.recurrence!
            if (input.action === 'complete') {
              state.previousCompletion = {
                at: state.lastCompletedAt,
                by: state.lastCompletedBy,
                name: state.lastCompletedByName
              }
              state.lastCompletedAt = now
              state.lastCompletedBy = actor.id
              state.lastCompletedByName = actor.displayName
              state.nextDueDate = Temporal.Instant.from(now)
                .toZonedDateTimeISO(doc.timezone)
                .toPlainDate()
                .add({ days: recurrence.intervalDays })
                .toString()
              row.nextDueDate = state.nextDueDate
            } else if (input.action === 'reopen') {
              state.lastCompletedAt = state.previousCompletion?.at ?? null
              state.lastCompletedBy = state.previousCompletion?.by ?? null
              state.lastCompletedByName = state.previousCompletion?.name ?? null
              state.nextDueDate = row.recurrenceDueDate
              delete state.previousCompletion
              delete row.nextDueDate
            }
            state.row = structuredClone(row)
          }
        }
        doc.actionIds.push(requestKey)
      })
    }
  }
}
export type RoutineService = ReturnType<typeof createRoutineService>
