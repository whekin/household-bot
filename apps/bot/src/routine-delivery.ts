import { materializeRoutineDay, routineDate, RoutineError } from '@household/application'
import { routineTimeInstant, Temporal } from '@household/domain'
import type {
  HouseholdConfigurationRepository,
  RoutineDestination,
  RoutineDocument,
  RoutineRepository
} from '@household/ports'
import type { InlineKeyboardMarkup } from 'grammy/types'
import { renderRoutineCard } from './routine-cards'

export interface RoutineTransport {
  send(
    chatId: string,
    threadId: number | null,
    content: { text: string; reply_markup: InlineKeyboardMarkup; notify?: boolean }
  ): Promise<number>
  edit(
    chatId: string,
    messageId: number,
    content: { text: string; reply_markup: InlineKeyboardMarkup; notify?: boolean }
  ): Promise<void>
  remove(chatId: string, messageId: number): Promise<void>
}
function telegramError(error: unknown) {
  const e = error as {
    error_code?: number
    description?: string
    parameters?: { retry_after?: number }
  }
  return {
    code: e.error_code ?? 0,
    description: e.description ?? String(error),
    delay: e.parameters?.retry_after ?? 30
  }
}
export function createRoutineDelivery(options: {
  repository: RoutineRepository
  households: HouseholdConfigurationRepository
  transport: RoutineTransport
  clock?: () => string
  report?: (event: string, error: unknown) => void
}) {
  const { repository, transport } = options
  const clock = options.clock ?? (() => Temporal.Now.instant().toString())
  async function requestCard(id: string, householdId: string, chatId: string) {
    await repository.change(id, householdId, (doc) => {
      for (const sub of Object.values(doc.subscriptions))
        if (sub.telegramUserId === chatId) sub.blocked = false
      materializeRoutineDay(doc, clock())
      const date = routineDate(doc, clock())
      const key = `day:${date}:${chatId}:dm`
      const existing = doc.messages.find((m) => m.key === key)
      if (existing?.status === 'blocked' || existing?.status === 'removed') {
        existing.status = existing.messageId === null ? 'sending' : 'sent'
        existing.error = null
        existing.fingerprint = ''
      }
      if (!existing)
        doc.messages.push({
          key,
          date,
          chatId,
          threadId: null,
          rowId: null,
          messageId: null,
          status: 'sending',
          fingerprint: '',
          error: null,
          retryAt: null
        })
    })
    await reconcile(id)
  }
  async function reconcile(id: string) {
    const initial = await repository.get(id)
    if (!initial) return
    const token = crypto.randomUUID()
    let acquired = false
    await repository.change(id, initial.householdId, (doc) => {
      if (doc.lease && Date.parse(doc.lease.until) > Date.parse(clock())) return
      doc.lease = { token, until: Temporal.Instant.from(clock()).add({ seconds: 120 }).toString() }
      materializeRoutineDay(doc, clock())
      acquired = true
    })
    if (!acquired) return
    const change = (fn: (doc: RoutineDocument) => void) =>
      repository.change(id, initial.householdId, (doc) => {
        if (doc.lease?.token !== token) throw new Error('Routine delivery lease lost')
        doc.lease.until = Temporal.Instant.from(clock()).add({ seconds: 120 }).toString()
        fn(doc)
      })
    try {
      const members = await options.households.listHouseholdMembers(initial.householdId)
      const activeIds = new Set(
        members.filter((m) => m.status === 'active').map((m) => m.telegramUserId)
      )
      await change((doc) => {
        const now = clock()
        const date = routineDate(doc, now)
        const targets: Array<{ chatId: string; threadId: number | null }> = []
        if (!doc.paused && doc.destination) targets.push(doc.destination)
        for (const sub of Object.values(doc.subscriptions))
          if (!doc.paused && sub.enabled && !sub.blocked && activeIds.has(sub.telegramUserId))
            targets.push({ chatId: sub.telegramUserId, threadId: null })
        const day = doc.days.find((d) => d.date === date)!
        const add = (target: { chatId: string; threadId: number | null }, rowId: string | null) => {
          const key = `${rowId ?? 'day'}:${date}:${target.chatId}:${target.threadId ?? 'dm'}`
          if (!doc.messages.some((m) => m.key === key))
            doc.messages.push({
              ...target,
              key,
              date,
              rowId,
              messageId: null,
              status: 'sending',
              fingerprint: '',
              error: null,
              retryAt: null
            })
        }
        for (const target of targets) {
          if (
            day.rows.length > 0 &&
            Temporal.Instant.compare(
              Temporal.Instant.from(now),
              routineTimeInstant(date, doc.publishTime, doc.timezone, day.dayStart ?? '00:00')
            ) >= 0
          )
            add(target, null)
          for (const row of day.rows)
            if (
              !row.reminderSuppressed &&
              row.reminderEnabled &&
              row.dueAt &&
              row.status !== 'completed' &&
              Date.parse(row.windowEndsAt ?? row.dueAt) >= Date.parse(doc.resumedAt) &&
              Date.parse(row.dueAt) <= Date.parse(now) &&
              Temporal.Instant.from(now).epochMilliseconds -
                Temporal.Instant.from(row.windowEndsAt ?? row.dueAt).epochMilliseconds <=
                15 * 60_000
            ) {
              add(target, null)
              add(target, row.id)
            }
        }
      })
      const snapshot = await repository.get(id)
      for (const candidate of snapshot?.messages ?? []) {
        // Reload for each message: callbacks may have changed the desired card while IO was pending.
        const doc = await change(() => {})
        const message = doc.messages.find((m) => m.key === candidate.key)!
        if (['removed', 'blocked', 'unknown'].includes(message.status)) continue
        if (message.retryAt && Date.parse(message.retryAt) > Date.parse(clock())) continue
        const day = doc.days.find((d) => d.date === message.date)
        if (!day) continue
        const row = message.rowId ? day.rows.find((r) => r.id === message.rowId) : undefined
        const today = routineDate(doc, clock())
        const group = message.threadId !== null
        const currentDestination =
          doc.destination?.chatId === message.chatId &&
          doc.destination?.threadId === message.threadId
        const privateActive = activeIds.has(message.chatId)
        const subscribed = Object.values(doc.subscriptions).some(
          (s) => s.telegramUserId === message.chatId && s.enabled && !s.blocked
        )
        const retired = group ? !currentDestination : !privateActive
        const clean = Boolean(
          message.rowId &&
          (doc.paused ||
            row?.status === 'completed' ||
            message.date !== today ||
            retired ||
            (!group && !subscribed) ||
            (message.messageId === null &&
              row?.dueAt &&
              Date.parse(clock()) - Date.parse(row.windowEndsAt ?? row.dueAt) > 15 * 60_000))
        )
        const content = renderRoutineCard(doc, day, clock(), row, message.expanded ?? false)
        if (retired || clean) content.reply_markup = { inline_keyboard: [] }
        if (retired) content.text = 'Список перенесён или доступ закрыт. Откройте актуальные дела.'
        const fingerprint = JSON.stringify(content)
        if (
          message.messageId === null &&
          (clean || retired || message.date !== today || doc.paused)
        ) {
          await change((d) => {
            d.messages.find((m) => m.key === message.key)!.status = 'removed'
          })
          continue
        }
        if (!clean && message.messageId !== null && fingerprint === message.fingerprint) continue
        try {
          if (clean && message.messageId !== null) {
            try {
              await transport.remove(message.chatId, message.messageId)
            } catch (error) {
              const e = telegramError(error)
              if (e.code !== 400) throw error
              if (/message to delete not found/i.test(e.description)) {
                await change((d) => {
                  d.messages.find((m) => m.key === message.key)!.status = 'removed'
                })
                continue
              }
              await transport.edit(message.chatId, message.messageId, {
                text: 'Напоминание закрыто. Актуальные отметки — в карточке дня.',
                reply_markup: { inline_keyboard: [] }
              })
            }
            await change((d) => {
              d.messages.find((m) => m.key === message.key)!.status = 'removed'
            })
          } else if (message.messageId === null) {
            // Persist unknown before IO: a crash after Telegram accepts cannot cause another send.
            await change((d) => {
              d.messages.find((m) => m.key === message.key)!.status = 'unknown'
            })
            const messageId = await transport.send(message.chatId, message.threadId, content)
            await change((d) => {
              Object.assign(
                d.messages.find((m) => m.key === message.key)!,
                { messageId, status: 'sent', fingerprint, error: null, retryAt: null }
              )
            })
          } else {
            await transport.edit(message.chatId, message.messageId, content)
            await change((d) => {
              Object.assign(
                d.messages.find((m) => m.key === message.key)!,
                { fingerprint, status: retired ? 'removed' : 'sent', error: null, retryAt: null }
              )
            })
          }
        } catch (error) {
          const e = telegramError(error)
          options.report?.('routine.delivery_failed', error)
          await change((d) => {
            const m = d.messages.find((item) => item.key === message.key)!
            if (e.code === 400 && /message is not modified/i.test(e.description)) {
              m.fingerprint = fingerprint
              return
            }
            m.error =
              e.code === 403
                ? 'Бот не может писать в этот чат. Откройте бота и нажмите /start.'
                : e.code === 400
                  ? 'Не удалось найти сообщение или топик. Проверьте подключение.'
                  : 'Не удалось обновить Telegram. Повторяем безопасные операции.'
            if (e.code === 403) {
              m.status = 'blocked'
              for (const sub of Object.values(d.subscriptions))
                if (sub.telegramUserId === m.chatId) sub.blocked = true
            } else if (e.code === 400) {
              m.status = m.messageId === null ? 'blocked' : 'removed'
              if (/message to edit not found|message can't be edited/i.test(e.description))
                m.messageId = null
            } else if (e.code === 429) {
              m.status = m.messageId === null ? 'sending' : 'sent'
              m.retryAt = Temporal.Instant.from(clock()).add({ seconds: e.delay }).toString()
            } else if (m.messageId === null) {
              m.status = 'unknown'
              m.error =
                'Telegram не подтвердил отправку. Проверьте чат; автоматического повтора не будет.'
            } else m.retryAt = Temporal.Instant.from(clock()).add({ seconds: e.delay }).toString()
          })
        }
      }
    } finally {
      await repository.change(id, initial.householdId, (doc) => {
        if (doc.lease?.token === token) doc.lease = null
      })
    }
  }
  return {
    requestCard,
    reconcile,
    async tick() {
      for (const doc of await repository.list()) {
        try {
          await reconcile(doc.id)
        } catch (error) {
          options.report?.('routine.tick_failed', error)
        }
      }
    },
    async bind(
      id: string,
      householdId: string,
      destination: RoutineDestination | null,
      expectedRevision?: number
    ) {
      const result = await repository.change(id, householdId, (doc) => {
        if (expectedRevision !== undefined && doc.revision !== expectedRevision)
          throw new RoutineError('Список изменён. Обновите данные.', 409)
        doc.destination = destination
        doc.topicCreation = null
        doc.revision += 1
        materializeRoutineDay(doc, clock())
        if (destination && !doc.paused) {
          const date = routineDate(doc, clock())
          const key = `day:${date}:${destination.chatId}:${destination.threadId}`
          const existing = doc.messages.find((m) => m.key === key)
          if (existing?.status === 'blocked' || existing?.status === 'removed') {
            existing.status = existing.messageId === null ? 'sending' : 'sent'
            existing.error = null
            existing.fingerprint = ''
          }
          if (!existing)
            doc.messages.push({
              ...destination,
              key,
              date,
              rowId: null,
              messageId: null,
              status: 'sending',
              fingerprint: '',
              error: null,
              retryAt: null
            })
        }
      })
      await reconcile(id)
      return result
    }
  }
}
export type RoutineDelivery = ReturnType<typeof createRoutineDelivery>
