import {
  matchUtilityImageBills,
  parseUtilityBillImportCorrection,
  type FinanceCommandService,
  type UtilityBillImportPreview,
  type UtilityBillImportService
} from '@household/application'
import { BillingPeriod, nowInstant } from '@household/domain'
import type { Logger } from '@household/observability'
import type {
  HouseholdConfigurationRepository,
  TelegramPaymentCardRepository,
  TelegramPendingActionRepository,
  UtilityBillImportEntry,
  UtilityImageRecognizer
} from '@household/ports'
import type { Bot, Context } from 'grammy'
import type { InlineKeyboardMarkup } from 'grammy/types'

import { resolveReplyLocale } from './bot-locale'
import { escapeHtml } from './html'
import { formatUserFacingMoney } from './i18n/money'
import type { BotLocale } from './i18n'
import type { LivePaymentCardService } from './live-payment-cards'
import { formatBillingMonth } from './payment-reminder-content'
import { downloadTelegramUtilityImage, utilityImageFile } from './telegram-utility-image'
import { readTelegramMessageText } from './topic-ingestion/topic-message-primitives'
import { buildBotStartDeepLink } from './telegram-deep-links'

export const UTILITY_SCREENSHOT_ACTION = 'utility_screenshot'
const TTL_MS = 30 * 60_000
const prefix = 'us:'

interface Draft {
  proposalId: string
  householdId: string
  memberId: string
  threadId: string | null
  period: string
  entries: readonly UtilityBillImportEntry[]
  issues: readonly string[]
  preview: UtilityBillImportPreview | null
  stage: 'review' | 'edit' | 'month'
  inputMessageId?: number
}

function threadId(ctx: Context): string | null {
  const message = ctx.msg
  return message && 'message_thread_id' in message
    ? (message.message_thread_id?.toString() ?? null)
    : null
}

/** Only bot-owned keyboards are evidence of billing context; never inspect arbitrary image text. */
export function utilityReminderReplyPeriod(ctx: Context): string | null {
  const reply = ctx.message?.reply_to_message
  if (reply?.from?.id !== ctx.me.id) return null
  const callbacks =
    reply.reply_markup?.inline_keyboard
      .flat()
      .flatMap((button) => ('callback_data' in button ? [button.callback_data] : [])) ?? []
  for (const data of callbacks) {
    const match =
      /^(?:pr:(?:p|d|c|cc):utilities:|reminder_util:(?:guided|template):)(\d{4}-\d{2})(?::|$)/.exec(
        data
      )
    if (match) {
      try {
        return BillingPeriod.fromString(match[1]!).toString()
      } catch {
        return null
      }
    }
  }
  return null
}

function addressed(ctx: Context): boolean {
  if (ctx.chat?.type === 'private' || ctx.message?.reply_to_message?.from?.id === ctx.me.id)
    return true
  const username = ctx.me.username
  const text = readTelegramMessageText(ctx) ?? ''
  return Boolean(username && new RegExp(`(^|\\s)@${username}\\b`, 'i').test(text))
}

function keyboard(draft: Draft, locale: BotLocale, botUsername?: string): InlineKeyboardMarkup {
  const ru = locale === 'ru'
  const button = (action: string, text: string) => ({
    text,
    callback_data: `${prefix}${action}:${draft.proposalId}`
  })
  const rows: InlineKeyboardMarkup['inline_keyboard'] = []
  if (
    !draft.issues.length &&
    draft.preview &&
    !draft.preview.blocked &&
    draft.preview.changes.length
  ) {
    rows.push([button('save', ru ? 'Сохранить и распределить' : 'Save and distribute')])
  }
  rows.push([
    button('edit', ru ? 'Исправить' : 'Edit'),
    button('month', ru ? 'Другой месяц' : 'Change month')
  ])
  rows.push([button('cancel', ru ? 'Отмена' : 'Cancel')])
  const dashboard = buildBotStartDeepLink(botUsername, 'dashboard')
  if (draft.preview?.blocked && dashboard)
    rows.push([{ text: ru ? 'Открыть дашборд' : 'Open dashboard', url: dashboard }])
  return { inline_keyboard: rows }
}

function previewText(draft: Draft, locale: BotLocale): string {
  const ru = locale === 'ru'
  const lines = [
    `💡 <b>${ru ? 'Счета со скриншота' : 'Screenshot bills'}</b>`,
    `${ru ? 'Период' : 'Period'}: ${escapeHtml(formatBillingMonth(locale, draft.period))}`,
    ''
  ]
  for (const entry of draft.entries) {
    const previous = draft.preview?.previousAmounts[entry.billName]
    const suffix =
      previous === entry.amountMajor
        ? ru
          ? ' · уже сохранено'
          : ' · already saved'
        : previous
          ? ` · ${ru ? 'было' : 'was'} ${previous} ₾`
          : ''
    lines.push(
      `${escapeHtml(entry.billName)}: <b>${escapeHtml(entry.amountMajor)} ₾</b>${escapeHtml(suffix)}`
    )
    if (entry.provider)
      lines.push(
        escapeHtml(
          [
            entry.provider,
            ...(entry.customerNumber
              ? [`${ru ? 'лицевой счёт' : 'account'} …${entry.customerNumber.slice(-4)}`]
              : [])
          ].join(' · ')
        )
      )
  }
  if (draft.preview)
    lines.push(
      '',
      `<b>${ru ? 'Всего на скриншоте' : 'Screenshot total'}: ${draft.preview.totalMajor} ₾</b>`
    )
  if (draft.issues.length)
    lines.push(
      '',
      ru
        ? 'Не все строки удалось сопоставить или прочитать. Исправьте список перед сохранением:'
        : 'Some rows could not be matched or read. Edit the list before saving:',
      ...draft.issues.map((issue) => `• ${escapeHtml(issue.split(':')[0]!)}`)
    )
  if (draft.preview?.blocked)
    lines.push(
      '',
      ru
        ? draft.preview.blocked === 'paid'
          ? 'За этот месяц уже записаны оплаты. Изменения счетов нужно проверить в дашборде.'
          : draft.preview.blocked === 'closed'
            ? 'Этот месяц закрыт. Выберите другой месяц или откройте дашборд.'
            : draft.preview.blocked === 'category'
              ? 'Настройки категорий или лицевые счета изменились. Проверьте счета и исправьте список.'
              : 'В учёте несколько счетов одной категории или другая валюта. Проверьте их в дашборде.'
        : 'This period is closed, has recorded payments, or contains ambiguous bills. Review it in the dashboard.'
    )
  else if (draft.preview && !draft.preview.changes.length && !draft.issues.length)
    lines.push(
      '',
      ru
        ? 'Эти суммы уже сохранены. Повторных начислений не будет.'
        : 'These amounts are already saved. No duplicate charges.'
    )
  if (draft.preview?.existingPayments && draft.preview.changes.length && !draft.preview.blocked)
    lines.push(
      '',
      ru
        ? 'Уже записанные оплаты сохранятся. Добавим новые счета и пересчитаем оставшиеся суммы к оплате.'
        : 'Recorded payments will be preserved. New bills will update the remaining amounts due.'
    )
  if (draft.preview?.preservedPaidBills.length)
    lines.push(
      '',
      ru
        ? `Сохраняем исходные начисления по оплаченным счетам: ${escapeHtml(draft.preview.preservedPaidBills.join(', '))}.`
        : `Original paid bills are preserved: ${escapeHtml(draft.preview.preservedPaidBills.join(', '))}.`
    )
  lines.push(
    '',
    ru
      ? 'Проверьте месяц и суммы. На этих экранах показана текущая задолженность поставщикам.'
      : 'Check the month and amounts. These screens show current supplier balances.'
  )
  return lines.join('\n')
}

export function registerUtilityScreenshotEntry(options: {
  bot: Bot
  householdConfigurationRepository: HouseholdConfigurationRepository
  promptRepository: TelegramPendingActionRepository
  paymentCardRepository: TelegramPaymentCardRepository
  financeServiceForHousehold: (householdId: string) => FinanceCommandService
  importServiceForHousehold: (householdId: string) => UtilityBillImportService
  recognize?: UtilityImageRecognizer
  downloadImage?: typeof downloadTelegramUtilityImage
  token: string
  timeoutMs: number
  botUsername?: string
  livePaymentCardService?: LivePaymentCardService
  paymentInstructionPublisher?: {
    sendPaymentInstruction(input: {
      householdId: string
      kind: 'utilities'
      period: string
    }): Promise<unknown>
  }
  logger?: Logger
}) {
  async function ack(ctx: Context, input?: Parameters<Context['answerCallbackQuery']>[0]) {
    try {
      await ctx.answerCallbackQuery(input)
    } catch {
      options.logger?.warn(
        { event: 'utility_screenshot.callback_ack_failed' },
        'Could not acknowledge screenshot callback'
      )
    }
  }

  async function actor(ctx: Context) {
    if (!ctx.from || !ctx.chat) return null
    const householdId =
      ctx.chat.type === 'private'
        ? await options.householdConfigurationRepository
            .listHouseholdMembersByTelegramUserId(ctx.from.id.toString())
            .then((members) => {
              const active = members.filter((member) => member.status !== 'left')
              return active.length === 1 ? active[0]!.householdId : null
            })
        : await options.householdConfigurationRepository
            .getTelegramHouseholdChat(ctx.chat.id.toString())
            .then((chat) => chat?.householdId ?? null)
    if (!householdId) return null
    const membership = await options.householdConfigurationRepository.getHouseholdMember(
      householdId,
      ctx.from.id.toString()
    )
    if (!membership || membership.status === 'left') return null
    const service = options.financeServiceForHousehold(householdId)
    const member = await service.getMemberByTelegramUserId(ctx.from.id.toString())
    if (!member) return null
    const locale = await resolveReplyLocale({
      ctx,
      repository: options.householdConfigurationRepository,
      householdId
    })
    return { householdId, member, locale, service }
  }

  async function reply(
    ctx: Context,
    text: string,
    markup?: InlineKeyboardMarkup,
    forceReply = false
  ) {
    return ctx.reply(text, {
      parse_mode: 'HTML',
      ...(threadId(ctx) ? { message_thread_id: Number(threadId(ctx)) } : {}),
      ...(ctx.message ? { reply_parameters: { message_id: ctx.message.message_id } } : {}),
      ...(forceReply
        ? { reply_markup: { force_reply: true as const, selective: true } }
        : markup
          ? { reply_markup: markup }
          : {})
    })
  }

  async function store(ctx: Context, draft: Draft) {
    await options.promptRepository.upsertPendingAction({
      telegramChatId: ctx.chat!.id.toString(),
      telegramUserId: ctx.from!.id.toString(),
      action: UTILITY_SCREENSHOT_ACTION,
      payload: { ...draft },
      expiresAt: nowInstant().add({ milliseconds: TTL_MS })
    })
  }

  async function review(ctx: Context, draft: Draft, locale: BotLocale, edit = false) {
    draft.preview = draft.entries.length
      ? await options
          .importServiceForHousehold(draft.householdId)
          .preview(draft.period, draft.entries)
      : null
    draft.stage = 'review'
    draft.proposalId = crypto.randomUUID().slice(0, 12)
    delete draft.inputMessageId
    await store(ctx, draft)
    const content = previewText(draft, locale)
    const markup = keyboard(draft, locale, options.botUsername)
    if (edit) {
      try {
        await ctx.editMessageText(content, { parse_mode: 'HTML', reply_markup: markup })
      } catch {
        await reply(ctx, content, markup)
      }
    } else await reply(ctx, content, markup)
  }

  options.bot.on('callback_query:data', async (ctx, next) => {
    const match = /^us:(save|edit|month|cancel):([a-f0-9-]+)$/.exec(ctx.callbackQuery.data)
    if (!match) {
      await next()
      return
    }
    const target = await actor(ctx)
    const pending =
      ctx.chat && ctx.from
        ? await options.promptRepository.getPendingAction(
            ctx.chat.id.toString(),
            ctx.from.id.toString(),
            UTILITY_SCREENSHOT_ACTION
          )
        : null
    const draft = pending?.payload as unknown as Draft | undefined
    if (
      !target ||
      !draft ||
      draft.proposalId !== match[2] ||
      draft.householdId !== target.householdId ||
      draft.memberId !== target.member.id ||
      draft.threadId !== threadId(ctx)
    ) {
      await ack(ctx, {
        text: 'Предложение недоступно / Proposal unavailable',
        show_alert: true
      })
      return
    }
    const ru = target.locale === 'ru'
    const action = match[1]
    if (action === 'save' || action === 'cancel') {
      if (
        action === 'save' &&
        (draft.stage !== 'review' || !draft.preview || draft.issues.length || draft.preview.blocked)
      ) {
        await ack(ctx, {
          text: ru ? 'Сначала исправьте счета.' : 'Edit the bills first.',
          show_alert: true
        })
        return
      }
      const consumed = await options.promptRepository.consumePendingActionByPayloadValue?.(
        ctx.chat!.id.toString(),
        ctx.from.id.toString(),
        UTILITY_SCREENSHOT_ACTION,
        'proposalId',
        draft.proposalId
      )
      if (!consumed) {
        await ack(ctx, {
          text: ru
            ? 'Предложение уже обработано или устарело.'
            : 'Proposal expired or already handled.'
        })
        return
      }
      await ack(ctx)
      if (action === 'cancel') {
        await ctx.editMessageText(ru ? 'Ввод счетов отменён.' : 'Bill entry cancelled.', {
          reply_markup: { inline_keyboard: [] }
        })
        return
      }
      let result: Awaited<ReturnType<UtilityBillImportService['confirm']>>
      try {
        result = await options
          .importServiceForHousehold(target.householdId)
          .confirm(draft.preview!, target.member.id)
      } catch {
        options.logger?.warn(
          { event: 'utility_screenshot.save_failed' },
          'Utility screenshot save failed'
        )
        await review(ctx, draft, target.locale, true)
        await reply(
          ctx,
          ru
            ? 'Не удалось сохранить счета. Проверьте обновлённое предложение и повторите.'
            : 'Could not save bills. Review the updated proposal and retry.'
        )
        return
      }
      if (result !== 'applied' && result !== 'unchanged') {
        await review(ctx, draft, target.locale, true)
        await reply(
          ctx,
          ru
            ? 'Данные за месяц изменились. Проверьте обновлённое предложение.'
            : 'Period data changed. Review the updated proposal.'
        )
        return
      }
      let acknowledgementFailed = false
      const acknowledgement = ctx
        .editMessageText(
          ru
            ? `${result === 'applied' ? 'Счета сохранены' : 'Эти счета уже сохранены'} за ${formatBillingMonth(target.locale, draft.period)}.`
            : `${result === 'applied' ? 'Bills saved' : 'Bills already saved'} for ${formatBillingMonth(target.locale, draft.period)}.`,
          { reply_markup: { inline_keyboard: [] } }
        )
        .catch(() => {
          acknowledgementFailed = true
        })
      if (result === 'applied') {
        let dashboard: Awaited<ReturnType<FinanceCommandService['generateDashboard']>> = null
        try {
          dashboard = await target.service.generateDashboard(draft.period)
          if (dashboard?.utilityBillingPlan)
            await reply(
              ctx,
              [
                ru ? '<b>Обновлённые суммы к оплате</b>' : '<b>Updated amounts due</b>',
                ...dashboard.utilityBillingPlan.memberSummaries.map(
                  (member) =>
                    `${escapeHtml(member.displayName)} — ${escapeHtml(formatUserFacingMoney(member.assignedThisCycle.toMajorString(), dashboard!.currency))}`
                ),
                '',
                ru
                  ? 'Ранее записанные оплаты учтены.'
                  : 'Previously recorded payments are included.'
              ].join('\n')
            )
        } catch {
          options.logger?.warn(
            { event: 'utility_screenshot.plan_refresh_failed' },
            'Bills saved; plan refresh needs retry'
          )
          await reply(
            ctx,
            ru
              ? 'Счета сохранены. Не удалось показать обновлённую раскладку — проверьте дашборд перед оплатой.'
              : 'Bills saved. Could not show the updated split; check the dashboard before paying.'
          )
        }
        const outcomes = await Promise.allSettled([
          acknowledgement,
          options.livePaymentCardService?.refresh({
            householdId: target.householdId,
            kind: 'utilities',
            period: draft.period,
            ...(dashboard ? { dashboard } : {})
          }),
          options.paymentInstructionPublisher?.sendPaymentInstruction({
            householdId: target.householdId,
            kind: 'utilities',
            period: draft.period
          })
        ])
        if (acknowledgementFailed || outcomes.some((outcome) => outcome.status === 'rejected')) {
          options.logger?.warn(
            { event: 'utility_screenshot.delivery_failed' },
            'Bills saved; card delivery needs retry'
          )
          await reply(
            ctx,
            ru
              ? 'Счета сохранены, но не удалось обновить все сообщения. Актуальные суммы доступны в дашборде.'
              : 'Bills saved, but some messages could not be updated. Current amounts are in the dashboard.'
          )
        }
      } else await acknowledgement
      return
    }
    await ack(ctx)
    draft.stage = action === 'edit' ? 'edit' : 'month'
    const categories =
      await options.householdConfigurationRepository.listHouseholdUtilityCategories(
        target.householdId
      )
    const template = categories
      .filter((category) => category.isActive)
      .map(
        (category) =>
          `${category.name}: ${draft.entries.find((entry) => entry.billName === category.name)?.amountMajor ?? ''}`
      )
      .join('\n')
    const prompt = await reply(
      ctx,
      action === 'edit'
        ? `${ru ? 'Ответьте на это сообщение исправленным списком. Пустая строка категории оставит её без изменений; 0 задаёт нулевую сумму.' : 'Reply with corrected bills. Blank categories stay unchanged; 0 sets an explicit zero.'}\n\n<pre>${escapeHtml(template)}</pre>`
        : ru
          ? 'Ответьте на это сообщение месяцем в формате ГГГГ-ММ, например 2026-10.'
          : 'Reply with a month as YYYY-MM, for example 2026-10.',
      undefined,
      true
    )
    draft.inputMessageId = prompt.message_id
    await store(ctx, draft)
  })

  options.bot.on('message', async (ctx, next) => {
    const text = readTelegramMessageText(ctx)?.trim() ?? ''
    const file = utilityImageFile(ctx)
    const hasAttachment = 'photo' in ctx.message || 'document' in ctx.message
    if (!hasAttachment) {
      if (!text || !ctx.from || !ctx.message.reply_to_message) {
        await next()
        return
      }
      const pending = await options.promptRepository.getPendingAction(
        ctx.chat.id.toString(),
        ctx.from.id.toString(),
        UTILITY_SCREENSHOT_ACTION
      )
      const draft = pending?.payload as unknown as Draft | undefined
      if (
        !draft ||
        draft.stage === 'review' ||
        draft.inputMessageId !== ctx.message.reply_to_message.message_id ||
        draft.threadId !== threadId(ctx)
      ) {
        await next()
        return
      }
      const target = await actor(ctx)
      if (
        !target ||
        target.householdId !== draft.householdId ||
        target.member.id !== draft.memberId
      )
        return
      if (draft.stage === 'month') {
        try {
          draft.period = BillingPeriod.fromString(text).toString()
        } catch {
          const prompt = await reply(
            ctx,
            target.locale === 'ru'
              ? 'Нужен месяц в формате ГГГГ-ММ, например 2026-10.'
              : 'Use YYYY-MM, for example 2026-10.',
            undefined,
            true
          )
          draft.inputMessageId = prompt.message_id
          await store(ctx, draft)
          return
        }
      } else {
        const categories =
          await options.householdConfigurationRepository.listHouseholdUtilityCategories(
            target.householdId
          )
        const entries = parseUtilityBillImportCorrection(text, categories)
        if (!entries) {
          const prompt = await reply(
            ctx,
            target.locale === 'ru'
              ? 'Не удалось прочитать весь список. Каждая сумма должна быть на строке «Категория: 12.34», без отдельных чисел и неизвестных строк.'
              : 'Use one Category: 12.34 line per bill, without detached numbers or unknown lines.',
            undefined,
            true
          )
          draft.inputMessageId = prompt.message_id
          await store(ctx, draft)
          return
        }
        draft.entries = entries
        draft.issues = []
      }
      await review(ctx, draft, target.locale)
      return
    }
    const replyIsBot = ctx.message.reply_to_message?.from?.id === ctx.me.id
    let period = utilityReminderReplyPeriod(ctx)
    if (!period && replyIsBot) {
      const card = await options.paymentCardRepository.findPaymentCard({
        telegramChatId: ctx.chat.id.toString(),
        telegramMessageId: ctx.message.reply_to_message!.message_id.toString()
      })
      if (card?.kind === 'utilities' && card.telegramThreadId === threadId(ctx))
        period = card.period
    }
    if (!period && !addressed(ctx)) {
      await next()
      return
    }
    const utilityIntent =
      /коммун|utilit|\bbills?\b/i.test(text) && !/(?:не|not)\s+(?:коммун|utilit)/i.test(text)
    // Explicit completed-payment captions retain the existing payment flow.
    // A captionless bank receipt is still rejected as utility entry below.
    if (
      /оплатил|оплатила|перев[её]л|перевела|\bpaid\b|\btransferred\b/i.test(text) ||
      (!period && /купил|купила|bought|purchase/i.test(text))
    ) {
      await next()
      return
    }
    const target = await actor(ctx)
    if (!target) {
      await reply(
        ctx,
        'Не удалось определить ваш дом и участника. / Could not identify your household membership.'
      )
      return
    }
    const ru = target.locale === 'ru'
    if (!period && !utilityIntent) {
      await reply(
        ctx,
        ru
          ? 'Чтобы внести коммуналку, отправьте скриншот в ответ на напоминание или обратитесь ко мне с подписью «коммуналка». Изображение не сохранено как счёт.'
          : 'To enter utility bills, reply to a utility reminder with the screenshot, or address me with a utilities caption. No bill was saved.'
      )
      return
    }
    if (!file) {
      await reply(
        ctx,
        ru
          ? 'Пришлите скриншот как фото или файл PNG/JPEG.'
          : 'Send the screenshot as a photo or PNG/JPEG file.'
      )
      return
    }
    if (!options.recognize) {
      await reply(
        ctx,
        ru
          ? 'Распознавание скриншотов сейчас недоступно. Введите счета через шаблон или дашборд.'
          : 'Screenshot recognition is unavailable. Use the template or dashboard.'
      )
      return
    }
    if (!period) {
      const settings = await options.householdConfigurationRepository.getHouseholdBillingSettings(
        target.householdId
      )
      const local = nowInstant().toZonedDateTimeISO(settings.timezone)
      period = `${local.year}-${String(local.month).padStart(2, '0')}`
    }
    try {
      await ctx.replyWithChatAction('typing')
      const image = await (options.downloadImage ?? downloadTelegramUtilityImage)({
        token: options.token,
        getFile: (fileId) => ctx.api.getFile(fileId),
        file,
        timeoutMs: options.timeoutMs
      })
      const recognition = await options.recognize(image)
      if (recognition.kind !== 'utility_balances' || !recognition.bills.length) {
        await reply(
          ctx,
          ru
            ? recognition.kind === 'payment_receipt'
              ? 'Это подтверждение банковской операции. Для ввода коммуналки нужен экран со списком счетов к оплате. Оплата не записана.'
              : 'Не нашёл читаемых коммунальных счетов на изображении. Пришлите список счетов из Credo/TBC или заполните шаблон. Ничего не сохранено.'
            : 'No utility balances found. Send a Credo/TBC bill list or use the template. Nothing was saved.'
        )
        return
      }
      const categories =
        await options.householdConfigurationRepository.listHouseholdUtilityCategories(
          target.householdId
        )
      const matched = matchUtilityImageBills(recognition, categories)
      await review(
        ctx,
        {
          proposalId: '',
          householdId: target.householdId,
          memberId: target.member.id,
          threadId: threadId(ctx),
          period,
          entries: matched.entries,
          issues: matched.issues,
          preview: null,
          stage: 'review'
        },
        target.locale
      )
    } catch {
      options.logger?.warn(
        { event: 'utility_screenshot.recognition_failed' },
        'Utility screenshot recognition failed'
      )
      await reply(
        ctx,
        ru
          ? 'Не удалось обработать скриншот. Ничего не сохранено. Попробуйте ещё раз или введите суммы через шаблон.'
          : 'Could not process screenshot. Nothing was saved. Retry or use the template.'
      )
    }
  })
}
