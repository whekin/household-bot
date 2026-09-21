import {
  createRoutineService,
  RoutineError,
  routineDate,
  type HouseholdOnboardingService,
  type RoutineActor
} from '@household/application'
import {
  pickRoutineQuickTarget,
  type RoutineDefinition,
  type RoutineAction
} from '@household/domain'
import type {
  HouseholdConfigurationRepository,
  RoutineDocument,
  RoutineRepository
} from '@household/ports'
import type { Bot } from 'grammy'
import type { InlineKeyboardButton } from 'grammy/types'
import {
  allowedMiniAppOrigin,
  createMiniAppSessionService,
  miniAppJsonResponse,
  readMiniAppRequestPayload
} from './miniapp-auth'
import { createRoutineDelivery } from './routine-delivery'
import { parseRoutineTopicLink } from './routine-topic-link'

export function routineClientView(doc: RoutineDocument, actor: RoutineActor) {
  const now = new Date().toISOString()
  return {
    id: doc.id,
    revision: doc.revision,
    definition: doc.nextDefinition?.definition ?? doc.definition,
    effectiveDate: doc.nextDefinition?.effectiveDate ?? null,
    paused: doc.paused,
    publishTime: doc.publishTime,
    timezone: doc.timezone,
    destination: doc.destination,
    day: (() => {
      const day = doc.days.find((day) => day.date === routineDate(doc, now))
      return day
        ? {
            ...day,
            rows: day.rows.map((row) =>
              row.status === 'claimed' &&
              row.expiresAt &&
              Date.parse(row.expiresAt) <= Date.parse(now)
                ? {
                    ...row,
                    status: 'pending' as const,
                    actorId: null,
                    actorName: null,
                    actedAt: null,
                    expiresAt: null
                  }
                : row
            )
          }
        : null
    })(),
    groupStatus: (() => {
      if (!doc.destination) return 'none'
      const message = doc.messages.find(
        (m) =>
          m.rowId === null &&
          m.date === routineDate(doc, now) &&
          m.chatId === doc.destination!.chatId &&
          m.threadId === doc.destination!.threadId
      )
      return message?.status === 'sent'
        ? 'ready'
        : message?.status === 'unknown'
          ? doc.lease && Date.parse(doc.lease.until) > Date.parse(now)
            ? 'pending'
            : 'unknown'
          : message?.status === 'blocked' || message?.status === 'removed'
            ? 'error'
            : 'pending'
    })(),
    privateCardUnknown:
      doc.messages.some(
        (m) =>
          m.rowId === null &&
          m.date === routineDate(doc, now) &&
          m.chatId === actor.telegramUserId &&
          m.status === 'unknown'
      ) &&
      (!doc.lease || Date.parse(doc.lease.until) <= Date.parse(now)),
    quickTargets: (
      doc.days.find((day) => day.date === routineDate(doc, now))?.quickActions ?? []
    ).flatMap((action) => {
      const day = doc.days.find((day) => day.date === routineDate(doc, now))!
      const target = pickRoutineQuickTarget(day.rows, action.id, now)
      return target
        ? [
            {
              ...action,
              rowId: target.id,
              version: target.version,
              completed: target.status === 'completed'
            }
          ]
        : []
    }),
    lastActions: (
      doc.days.find((day) => day.date === routineDate(doc, now))?.quickActions ?? []
    ).map((action) => {
      const last = doc.days
        .flatMap((day) => day.rows)
        .filter((row) => row.activityId === action.id && row.status === 'completed' && row.actedAt)
        .sort((a, b) => Date.parse(b.actedAt!) - Date.parse(a.actedAt!))[0]
      return {
        label: action.summaryLabel,
        at: last?.actedAt ?? null,
        actorName: last?.actorName ?? null
      }
    }),
    recurringTasks: doc.definition.tasks
      .filter((task) => task.recurrence)
      .map((task) => {
        const state = doc.recurringTasks?.[task.id]
        return {
          taskId: task.id,
          title: task.title,
          intervalDays: task.recurrence!.intervalDays,
          nextDueDate: state?.nextDueDate ?? task.recurrence!.firstDueDate,
          lastCompletedAt: state?.lastCompletedAt ?? null,
          lastCompletedByName: state?.lastCompletedByName ?? null
        }
      }),
    subscribed: doc.subscriptions[actor.id]?.enabled ?? false,
    dmBlocked: doc.subscriptions[actor.id]?.blocked ?? false,
    errors: [
      ...new Set(
        doc.messages
          .filter(
            (m) =>
              m.error &&
              (actor.isAdmin
                ? m.threadId !== null || m.chatId === actor.telegramUserId
                : m.chatId === actor.telegramUserId)
          )
          .map((m) => m.error!)
      )
    ].slice(-3)
  }
}
export function createRoutineRuntime(options: {
  bot: Bot
  repository: RoutineRepository
  households: HouseholdConfigurationRepository
  onboardingService: HouseholdOnboardingService
  botToken: string
  allowedOrigins: readonly string[]
  report: (event: string, error: unknown) => void
}) {
  const { bot, repository, households } = options
  const service = createRoutineService(repository)
  // Keep every Telegram request below the durable delivery lease duration.
  // grammY types reference the older abort-controller shim; Bun's native signal
  // implements the same abort event contract at runtime.
  const signal = () =>
    AbortSignal.timeout(15_000) as unknown as NonNullable<
      Parameters<typeof bot.api.deleteMessage>[2]
    >
  const delivery = createRoutineDelivery({
    repository,
    households,
    report: options.report,
    transport: {
      async send(chatId, threadId, content) {
        return (
          await bot.api.sendMessage(
            chatId,
            content.text,
            {
              reply_markup: content.reply_markup,
              ...(threadId === null ? {} : { message_thread_id: threadId }),
              disable_notification: !content.notify
            },
            signal()
          )
        ).message_id
      },
      async edit(chatId, messageId, content) {
        await bot.api.editMessageText(
          chatId,
          messageId,
          content.text,
          { reply_markup: content.reply_markup },
          signal()
        )
      },
      async remove(chatId, messageId) {
        await bot.api.deleteMessage(chatId, messageId, signal())
      }
    }
  })
  async function refresh(id: string) {
    try {
      await delivery.reconcile(id)
    } catch (error) {
      options.report('routine.refresh_failed', error)
    }
  }
  async function actorFor(householdId: string, telegramUserId: string): Promise<RoutineActor> {
    const actor = await households.getHouseholdMember(householdId, telegramUserId)
    if (!actor || actor.status !== 'active')
      throw new RoutineError('Доступ только участникам дома', 403)
    return actor
  }
  async function groupAdmin(actor: RoutineActor) {
    if (!actor.isAdmin) throw new RoutineError('Настройки доступны администратору дома', 403)
    const chat = await households.getHouseholdChatByHouseholdId(actor.householdId)
    if (!chat) throw new RoutineError('Группа дома не подключена')
    const member = await bot.api.getChatMember(chat.telegramChatId, Number(actor.telegramUserId))
    if (!['creator', 'administrator'].includes(member.status))
      throw new RoutineError('Подключить топик может администратор Telegram-группы', 403)
    const info = await bot.api.getChat(chat.telegramChatId)
    if (info.type !== 'supergroup' || !info.is_forum)
      throw new RoutineError('Для топиков нужна группа с включёнными темами')
    return chat
  }
  async function bind(
    actor: RoutineActor,
    input: {
      id: string
      mode: string
      link?: string
      threadId?: number
      name?: string
      expectedRevision: number
    }
  ) {
    const chat = await groupAdmin(actor)
    const doc = await repository.get(input.id)
    if (!doc || doc.householdId !== actor.householdId)
      throw new RoutineError('Список недоступен', 404)
    if (doc.revision !== input.expectedRevision)
      throw new RoutineError('Список изменён. Обновите данные.', 409)
    if (input.mode === 'none')
      return delivery.bind(doc.id, actor.householdId, null, input.expectedRevision)
    if (input.mode === 'create') {
      const name = input.name?.trim()
      if (!name || Array.from(name).length > 80)
        throw new RoutineError('Название топика: от 1 до 80 символов')
      const me = await bot.api.getChatMember(chat.telegramChatId, bot.botInfo.id)
      if (me.status !== 'administrator' || !me.can_manage_topics)
        throw new RoutineError(
          'Дайте боту право управлять темами или создайте топик вручную и вставьте ссылку'
        )
      if (doc.topicCreation?.destination)
        return delivery.bind(
          doc.id,
          actor.householdId,
          doc.topicCreation.destination,
          input.expectedRevision
        )
      let reserved = false
      await repository.change(doc.id, actor.householdId, (d) => {
        if (d.revision !== input.expectedRevision)
          throw new RoutineError('Список изменён. Обновите данные.', 409)
        if (d.topicCreation)
          throw new RoutineError(
            'Создание уже запрошено. Проверьте группу и подключите топик ссылкой.',
            409
          )
        d.topicCreation = { requestId: crypto.randomUUID(), status: 'creating', destination: null }
        reserved = true
      })
      if (!reserved) throw new RoutineError('Создание уже выполняется', 409)
      try {
        const result = await bot.api.createForumTopic(chat.telegramChatId, name, {}, signal())
        const destination = {
          chatId: chat.telegramChatId,
          threadId: result.message_thread_id,
          name
        }
        await repository.change(doc.id, actor.householdId, (d) => {
          d.topicCreation = {
            requestId: d.topicCreation!.requestId,
            status: 'created',
            destination
          }
        })
        return delivery.bind(doc.id, actor.householdId, destination, input.expectedRevision)
      } catch (error) {
        await repository.change(doc.id, actor.householdId, (d) => {
          if (d.topicCreation?.status === 'creating') d.topicCreation.status = 'unknown'
        })
        options.report('routine.topic_creation_failed', error)
        throw new RoutineError(
          'Создание не подтверждено. Проверьте группу; существующий топик можно подключить ссылкой.'
        )
      }
    }
    let threadId: number
    let name = 'Топик по ссылке'
    if (input.mode === 'link') {
      let parsed
      try {
        parsed = parseRoutineTopicLink(input.link ?? '')
      } catch (error) {
        throw new RoutineError((error as Error).message)
      }
      const resolved = parsed.chat.startsWith('@')
        ? String((await bot.api.getChat(parsed.chat)).id)
        : parsed.chat
      if (resolved !== chat.telegramChatId)
        throw new RoutineError('Ссылка должна вести в группу этого дома')
      threadId = parsed.threadId
    } else if (input.mode === 'known') {
      const known = (await households.listHouseholdTopicBindings(actor.householdId)).find(
        (t) => Number(t.telegramThreadId) === input.threadId
      )
      const knownRoutine = (await repository.list(actor.householdId)).find(
        (d) => d.destination?.threadId === input.threadId
      )
      if (!known && !knownRoutine?.destination) throw new RoutineError('Выберите известный топик')
      threadId = input.threadId!
      name = known?.topicName ?? knownRoutine?.destination?.name ?? 'Топик'
    } else throw new RoutineError('Выберите способ подключения')
    return delivery.bind(
      doc.id,
      actor.householdId,
      { chatId: chat.telegramChatId, threadId, name },
      input.expectedRevision
    )
  }
  async function showLists(
    telegramUserId: string,
    reply: (text: string, rows: InlineKeyboardButton[][]) => Promise<unknown>
  ) {
    const members = (await households.listHouseholdMembersByTelegramUserId(telegramUserId)).filter(
      (m) => m.status === 'active'
    )
    const rows: InlineKeyboardButton[][] = []
    for (const member of members) {
      const chat = await households.getHouseholdChatByHouseholdId(member.householdId)
      for (const doc of await service.list(member))
        rows.push([
          {
            text: `${members.length > 1 ? `${chat?.householdName ?? 'Дом'} · ` : ''}${doc.definition.title}`,
            callback_data: `rto:${doc.id}`
          }
        ])
    }
    await reply(
      rows.length
        ? 'Дела на сегодня — выберите список'
        : 'Списков пока нет. Создайте первый в мини-приложении: Настройки → Регулярные дела.',
      rows
    )
  }
  bot.callbackQuery('home:routines', async (ctx) => {
    await ctx.answerCallbackQuery()
    if (ctx.chat?.type !== 'private') return
    await showLists(String(ctx.from.id), (text, rows) =>
      ctx.reply(text, { reply_markup: { inline_keyboard: rows } })
    )
  })
  bot.command('routines', async (ctx) => {
    if (ctx.chat.type !== 'private') {
      await ctx.reply('Откройте дела в личке бота', {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Дела в личке', url: `https://t.me/${bot.botInfo.username}?start=routines` }]
          ]
        }
      })
      return
    }
    await showLists(String(ctx.from!.id), (text, rows) =>
      ctx.reply(text, { reply_markup: { inline_keyboard: rows } })
    )
  })
  bot.command('start', async (ctx, next) => {
    if (ctx.match !== 'routines' || ctx.chat.type !== 'private') return next()
    await showLists(String(ctx.from!.id), (text, rows) =>
      ctx.reply(text, { reply_markup: { inline_keyboard: rows } })
    )
  })
  bot.callbackQuery(/^rto:([a-f0-9]{16})$/, async (ctx) => {
    try {
      if (ctx.chat?.type !== 'private') throw new RoutineError('Откройте личку бота')
      const doc = await repository.get(ctx.match[1]!)
      if (!doc) throw new RoutineError('Список не найден')
      await actorFor(doc.householdId, String(ctx.from!.id))
      await ctx.answerCallbackQuery()
      await delivery.requestCard(doc.id, doc.householdId, String(ctx.from!.id))
    } catch (error) {
      await ctx
        .answerCallbackQuery({
          text: error instanceof RoutineError ? error.message : 'Не удалось открыть дела',
          show_alert: true
        })
        .catch(() => {})
    }
  })
  bot.callbackQuery(
    /^rtq?:([a-f0-9]{16}):(\d{8}[a-z0-9]+):([a-z0-9]+):([A-Za-z0-9_-]{1,12})$/,
    async (ctx) => {
      const id = ctx.match[1]!
      try {
        const doc = await repository.get(id)
        if (!doc) throw new RoutineError('Список не найден')
        const actor = await actorFor(doc.householdId, String(ctx.from!.id))
        const source = doc.messages.find(
          (m) =>
            m.chatId === String(ctx.chat?.id) &&
            m.messageId === ctx.msg?.message_id &&
            m.status === 'sent'
        )
        if (
          !source ||
          (source.threadId !== null &&
            (doc.destination?.chatId !== source.chatId ||
              doc.destination.threadId !== source.threadId))
        )
          throw new RoutineError('Эта карточка больше не активна', 409)
        await service.act(actor, {
          id,
          rowId: ctx.match[2]!,
          version: parseInt(ctx.match[3]!, 36),
          ...(ctx.callbackQuery.data.startsWith('rtq:') ? { activityId: ctx.match[4]! } : {}),
          action: ctx.callbackQuery.data.startsWith('rtq:')
            ? 'complete'
            : ({ d: 'complete', u: 'reopen', c: 'claim', r: 'release' } as const)[
                ctx.match[4] as 'd' | 'u' | 'c' | 'r'
              ],
          requestId: ctx.callbackQuery.id
        })
        await ctx.answerCallbackQuery({
          text:
            ctx.callbackQuery.data.startsWith('rtq:') &&
            doc.days
              .flatMap((day) => day.rows)
              .some((row) => row.id === ctx.match[2] && row.status === 'completed')
              ? 'Уже отмечено — повтор не добавлен'
              : 'Сохранено'
        })
      } catch (error) {
        await ctx
          .answerCallbackQuery({
            text:
              error instanceof RoutineError
                ? error.message
                : 'Не удалось сохранить. Попробуйте ещё раз.',
            show_alert: true
          })
          .catch(() => {})
      }
      await refresh(id)
    }
  )
  bot.callbackQuery(/^rtx:([a-f0-9]{16})$/, async (ctx) => {
    const id = ctx.match[1]!
    try {
      const doc = await repository.get(id)
      if (!doc) throw new RoutineError('Список не найден')
      await actorFor(doc.householdId, String(ctx.from!.id))
      let expanded = false
      await repository.change(id, doc.householdId, (d) => {
        const message = d.messages.find(
          (m) =>
            m.chatId === String(ctx.chat?.id) &&
            m.messageId === ctx.msg?.message_id &&
            m.rowId === null &&
            m.status === 'sent'
        )
        if (
          !message ||
          (message.threadId !== null &&
            (d.destination?.chatId !== message.chatId ||
              d.destination.threadId !== message.threadId))
        )
          throw new RoutineError('Эта карточка больше не активна', 409)
        message.expanded = !message.expanded
        expanded = message.expanded
      })
      await ctx.answerCallbackQuery({ text: expanded ? 'Все дела' : 'Свёрнуто' })
    } catch (error) {
      await ctx
        .answerCallbackQuery({
          text: error instanceof RoutineError ? error.message : 'Не удалось открыть список',
          show_alert: true
        })
        .catch(() => {})
    }
    await refresh(id)
  })
  bot.callbackQuery(/^rtb:([a-f0-9]{16}):(\d+):(\d+)$/, async (ctx) => {
    try {
      const doc = await repository.get(ctx.match[1]!)
      if (!doc) throw new RoutineError('Список не найден')
      const actor = await actorFor(doc.householdId, String(ctx.from!.id))
      const chat = await groupAdmin(actor)
      const threadId = Number(ctx.match[2])
      if (String(ctx.chat?.id) !== chat.telegramChatId || ctx.msg?.message_thread_id !== threadId)
        throw new RoutineError('Нажмите кнопку внутри нужного топика')
      await delivery.bind(
        doc.id,
        actor.householdId,
        { chatId: chat.telegramChatId, threadId, name: 'Подключённый топик' },
        Number(ctx.match[3])
      )
      await ctx.answerCallbackQuery({ text: 'Топик подключён' })
    } catch (error) {
      await ctx
        .answerCallbackQuery({
          text: error instanceof Error ? error.message : 'Ошибка подключения',
          show_alert: true
        })
        .catch(() => {})
    }
  })
  const sessionService = createMiniAppSessionService({
    botToken: options.botToken,
    onboardingService: options.onboardingService
  })
  return {
    service,
    delivery,
    async bindButtons(householdId: string, threadId: number): Promise<InlineKeyboardButton[][]> {
      return (await repository.list(householdId)).map((doc) => [
        {
          text: `☑️ ${doc.definition.title}`,
          callback_data: `rtb:${doc.id}:${threadId}:${doc.revision}`
        }
      ])
    },
    handler: {
      path: '/api/miniapp/routines',
      async handler(request: Request): Promise<Response> {
        const origin = allowedMiniAppOrigin(request, options.allowedOrigins)
        if (request.method === 'OPTIONS') return miniAppJsonResponse({}, 200, origin)
        if (request.method !== 'POST')
          return miniAppJsonResponse({ error: 'Method not allowed' }, 405, origin)
        try {
          const session = await sessionService.authenticate(
            await readMiniAppRequestPayload(request.clone())
          )
          if (!session)
            return miniAppJsonResponse({ error: 'Invalid Telegram init data' }, 401, origin)
          if (!session.authorized || !session.member || !session.telegramUser)
            throw new RoutineError('Доступ только участникам дома', 403)
          const actor = await actorFor(session.member.householdId, session.telegramUser.id)
          const body = (await request.json()) as {
            operation?: string
            id?: string
            expectedRevision?: number
            definition?: RoutineDefinition
            publishTime?: string
            enabled?: boolean
            paused?: boolean
            rowId?: string
            version?: number
            action?: RoutineAction
            activityId?: string
            requestId?: string
            mode?: string
            link?: string
            name?: string
            threadId?: number
          }
          let id: string | undefined
          if (body.operation && body.operation !== 'list' && body.operation !== 'save') {
            id = body.id
            const doc = id ? await repository.get(id) : null
            if (!doc || doc.householdId !== actor.householdId)
              throw new RoutineError('Список недоступен', 404)
          }
          switch (body.operation ?? 'list') {
            case 'list':
              break
            case 'save': {
              const settings = await households.getHouseholdBillingSettings(actor.householdId)
              const saved = await service.save(actor, {
                id: body.id!,
                expectedRevision: body.expectedRevision!,
                definition: body.definition!,
                publishTime: body.publishTime!,
                timezone: settings.timezone
              })
              id = saved.id
              break
            }
            case 'pause':
              if (typeof body.paused !== 'boolean')
                throw new RoutineError('Укажите состояние паузы')
              await service.pause(actor, id!, body.paused, body.expectedRevision!)
              break
            case 'subscribe':
              if (typeof body.enabled !== 'boolean')
                throw new RoutineError('Укажите настройку уведомлений')
              await service.subscribe(actor, id!, body.enabled)
              break
            case 'quick_complete':
            case 'act':
              await service.act(actor, {
                id: id!,
                rowId: body.rowId!,
                version: body.version!,
                action: body.operation === 'quick_complete' ? 'complete' : body.action!,
                ...(body.operation === 'quick_complete'
                  ? { activityId: body.activityId ?? 'invalid' }
                  : {}),
                requestId: body.requestId!
              })
              break
            case 'bind':
              await bind(actor, {
                id: id!,
                mode: body.mode!,
                expectedRevision: body.expectedRevision!,
                ...(body.link ? { link: body.link } : {}),
                ...(body.name ? { name: body.name } : {}),
                ...(body.threadId ? { threadId: body.threadId } : {})
              })
              break
            case 'retry_group_card':
            case 'retry_private_card': {
              const group = body.operation === 'retry_group_card'
              if (group) await groupAdmin(actor)
              await repository.change(id!, actor.householdId, (doc) => {
                if (doc.lease && Date.parse(doc.lease.until) > Date.now())
                  throw new RoutineError('Отправка ещё выполняется. Подождите немного.', 409)
                const date = routineDate(doc, new Date().toISOString())
                const message = doc.messages.find(
                  (m) =>
                    m.date === date &&
                    m.rowId === null &&
                    (group
                      ? m.chatId === doc.destination?.chatId &&
                        m.threadId === doc.destination?.threadId
                      : m.chatId === actor.telegramUserId && m.threadId === null)
                )
                if (message?.status === 'unknown' && message.messageId === null) {
                  message.status = 'sending'
                  message.error = null
                  message.retryAt = null
                }
              })
              break
            }
            case 'open':
              await delivery.requestCard(id!, actor.householdId, actor.telegramUserId)
              break
            default:
              throw new RoutineError('Неизвестное действие')
          }
          if (id) await refresh(id)
          const docs = await service.list(actor)
          const topics = actor.isAdmin
            ? await households.listHouseholdTopicBindings(actor.householdId)
            : []
          return miniAppJsonResponse(
            {
              routines: docs.map((d) => routineClientView(d, actor)),
              topics: topics.map((t) => ({
                threadId: Number(t.telegramThreadId),
                name: t.topicName ?? 'Топик'
              })),
              botUrl: `https://t.me/${bot.botInfo.username}?start=routines`
            },
            200,
            origin
          )
        } catch (error) {
          options.report('routine.api_failed', error)
          return miniAppJsonResponse(
            {
              error:
                error instanceof RoutineError
                  ? error.message
                  : 'Не удалось сохранить. Проверьте данные и повторите.'
            },
            error instanceof RoutineError ? error.status : 400,
            origin
          )
        }
      }
    }
  }
}
