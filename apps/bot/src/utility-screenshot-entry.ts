import {
  hasCompletedPaymentCaption,
  UTILITY_ROUNDING_SHORTCUT_MAX_MINOR,
  UTILITY_ROUNDING_AUTOMATIC_MAX_MINOR,
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
import type { BotLocale } from './i18n'
import { utilityEntryCopy } from './i18n/utility-entry'
import type { LivePaymentCardService } from './live-payment-cards'
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
  stage: 'review' | 'edit' | 'month' | 'payer' | 'payment-confirm'
  inputMessageId?: number
  rounding?: {
    utilityBillId: string
    amountMinor: string
    payerMemberId?: string
    payerName?: string
  }
  payers?: readonly { id: string; displayName: string }[]
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
      ?.flat()
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
  const copy = utilityEntryCopy[locale]
  const button = (action: string, text: string) => ({
    text,
    callback_data: `${prefix}${action}:${draft.proposalId}`
  })
  const rows: InlineKeyboardMarkup['inline_keyboard'] = []
  if (draft.stage === 'payer' || draft.stage === 'payment-confirm') {
    if (draft.stage === 'payer') {
      const payers = draft.payers?.map((payer, index) =>
        button(`payer_${index}`, payer.displayName)
      )
      for (let index = 0; index < (payers?.length ?? 0); index += 2)
        rows.push(payers!.slice(index, index + 2))
    } else rows.push([button('record', copy.confirmButton)])
    rows.push([button('back', copy.backButton)])
    return { inline_keyboard: rows }
  }
  if (
    !draft.issues.length &&
    draft.preview &&
    !draft.preview.blocked &&
    (draft.preview.changes.length || draft.preview.automaticPayments.length)
  ) {
    rows.push([button('save', copy.saveButton)])
  }
  if (!draft.issues.length && draft.preview && !draft.preview.blocked)
    draft.preview.balanceDifferences.forEach((difference, index) => {
      const amount = BigInt(difference.additionalPaidMinor)
      if (
        amount > 0n &&
        amount <= UTILITY_ROUNDING_SHORTCUT_MAX_MINOR &&
        (amount > UTILITY_ROUNDING_AUTOMATIC_MAX_MINOR || draft.preview!.automaticBudgetExceeded)
      )
        rows.push([button(`round_${index}`, copy.extraPaymentButton(difference.billName))])
    })
  rows.push([button('edit', copy.editButton), button('month', copy.monthButton)])
  const dashboard = buildBotStartDeepLink(botUsername, 'dashboard')
  rows.push([
    button('cancel', copy.cancelButton),
    ...((draft.preview?.blocked || draft.preview?.balanceDifferences.length) && dashboard
      ? [{ text: copy.appButton, url: dashboard }]
      : [])
  ])
  return { inline_keyboard: rows }
}

function issueLine(issue: string, locale: BotLocale): string {
  const copy = utilityEntryCopy[locale]
  const separator = issue.lastIndexOf(': ')
  const provider = separator > 0 ? issue.slice(0, separator) : issue
  const reason = separator > 0 ? issue.slice(separator + 2) : ''
  const explanation = Object.hasOwn(copy.issueReason, reason)
    ? copy.issueReason[reason as keyof typeof copy.issueReason]
    : null
  return `• ${escapeHtml(provider)}${explanation ? ` — ${explanation}` : ''}`
}

function previewText(draft: Draft, locale: BotLocale): string {
  const copy = utilityEntryCopy[locale]
  const lines = [`💡 <b>${escapeHtml(copy.title(draft.period))}</b>`, copy.previewLead, '']
  for (const entry of draft.entries) {
    const previous = draft.preview?.previousAmounts[entry.billName]
    const suffix =
      previous === entry.amountMajor
        ? copy.entryAlreadySaved
        : previous
          ? copy.entryWas(previous)
          : ''
    lines.push(`${copy.entryLine(entry.billName, entry.amountMajor)}${suffix}`)
    if (entry.provider)
      lines.push(copy.providerLine(entry.provider, entry.customerNumber?.slice(-4) ?? null))
  }
  if (draft.preview) lines.push('', copy.total(draft.preview.totalMajor))
  if (draft.issues.length)
    lines.push('', copy.issuesIntro, ...draft.issues.map((issue) => issueLine(issue, locale)))
  if (draft.preview?.blocked) lines.push('', copy.blocked[draft.preview.blocked])
  else if (
    draft.preview &&
    !draft.preview.changes.length &&
    !draft.preview.balanceDifferences.length &&
    !draft.issues.length
  )
    lines.push('', copy.alreadySaved)
  if (draft.preview?.existingPayments && draft.preview.changes.length && !draft.preview.blocked)
    lines.push('', copy.keepsPayments)
  if (draft.preview?.preservedBills.length)
    lines.push('', copy.preservedBills(draft.preview.preservedBills))
  for (const difference of draft.preview?.balanceDifferences ?? []) {
    lines.push(
      '',
      copy.difference(difference.billName, difference.expectedMajor, difference.observedMajor)
    )
    const amount = BigInt(difference.additionalPaidMinor)
    const automatic =
      draft.preview?.automaticPayments.filter(
        (payment) => payment.utilityBillId === difference.utilityBillId
      ) ?? []
    lines.push(
      automatic.length
        ? copy.autoRounding(automatic)
        : !draft.preview?.automaticBudgetExceeded &&
            amount >= -UTILITY_ROUNDING_AUTOMATIC_MAX_MINOR &&
            amount <= UTILITY_ROUNDING_AUTOMATIC_MAX_MINOR
          ? copy.smallDifference
          : amount > 0n && amount <= UTILITY_ROUNDING_SHORTCUT_MAX_MINOR
            ? copy.extraPaymentHint
            : copy.reconcileInApp
    )
  }
  if (draft.rounding)
    lines.push(
      '',
      draft.stage === 'payer'
        ? copy.askPayer(draft.rounding.amountMinor)
        : copy.confirmPayer(draft.rounding.payerName ?? '', draft.rounding.amountMinor)
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
    delete draft.rounding
    delete draft.payers
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
    const match = /^us:(save|edit|month|cancel|back|round_\d+|payer_\d+|record):([a-f0-9-]+)$/.exec(
      ctx.callbackQuery.data
    )
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
      const locale =
        target?.locale ??
        (await resolveReplyLocale({ ctx, repository: options.householdConfigurationRepository }))
      await ack(ctx, {
        text: utilityEntryCopy[locale].unavailable,
        show_alert: true
      })
      return
    }
    const copy = utilityEntryCopy[target.locale]
    const action = match[1]!
    if (action === 'back') {
      await ack(ctx)
      await review(ctx, draft, target.locale, true)
      return
    }
    if (action.startsWith('round_') || action.startsWith('payer_')) {
      await ack(ctx)
      if (action.startsWith('round_')) {
        const difference = draft.preview?.balanceDifferences[Number(action.slice(6))]
        if (
          draft.stage !== 'review' ||
          draft.issues.length ||
          draft.preview?.blocked ||
          !difference ||
          BigInt(difference.additionalPaidMinor) <= 0n ||
          BigInt(difference.additionalPaidMinor) > UTILITY_ROUNDING_SHORTCUT_MAX_MINOR ||
          (BigInt(difference.additionalPaidMinor) <= UTILITY_ROUNDING_AUTOMATIC_MAX_MINOR &&
            !draft.preview?.automaticBudgetExceeded)
        )
          return
        const members = await options.householdConfigurationRepository.listHouseholdMembers(
          target.householdId
        )
        draft.payers = members
          .filter(
            (member) =>
              member.status !== 'left' && (target.member.isAdmin || member.id === target.member.id)
          )
          .map((member) => ({ id: member.id, displayName: member.displayName }))
        draft.rounding = {
          utilityBillId: difference.utilityBillId,
          amountMinor: difference.additionalPaidMinor
        }
        draft.stage = 'payer'
      } else {
        const payer = draft.payers?.[Number(action.slice(6))]
        if (
          draft.stage !== 'payer' ||
          !draft.rounding ||
          !payer ||
          (!target.member.isAdmin && payer.id !== target.member.id)
        )
          return
        draft.rounding = {
          ...draft.rounding,
          payerMemberId: payer.id,
          payerName: payer.displayName
        }
        draft.stage = 'payment-confirm'
      }
      draft.proposalId = crypto.randomUUID().slice(0, 12)
      await store(ctx, draft)
      try {
        await ctx.editMessageText(previewText(draft, target.locale), {
          parse_mode: 'HTML',
          reply_markup: keyboard(draft, target.locale, options.botUsername)
        })
      } catch {
        await reply(
          ctx,
          previewText(draft, target.locale),
          keyboard(draft, target.locale, options.botUsername)
        )
      }
      return
    }
    if (action === 'record') {
      if (
        draft.stage !== 'payment-confirm' ||
        !draft.rounding?.payerMemberId ||
        !draft.preview ||
        (!target.member.isAdmin && draft.rounding.payerMemberId !== target.member.id)
      ) {
        await ack(ctx, {
          text: copy.pickPayerFirst,
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
      await ack(ctx)
      if (!consumed) return
      let result: Awaited<ReturnType<UtilityBillImportService['confirmRoundingPayment']>>
      try {
        result = await options
          .importServiceForHousehold(target.householdId)
          .confirmRoundingPayment(
            draft.preview,
            draft.rounding.utilityBillId,
            draft.rounding.payerMemberId,
            target.member.id
          )
      } catch {
        await review(ctx, draft, target.locale, true)
        await reply(ctx, copy.extraPaymentFailed)
        return
      }
      if (result !== 'applied') {
        await review(ctx, draft, target.locale, true)
        await reply(ctx, copy.extraPaymentStale)
        return
      }
      try {
        await reply(
          ctx,
          copy.extraPaymentRecorded(draft.rounding.payerName ?? '', draft.rounding.amountMinor)
        )
      } catch {
        options.logger?.warn(
          { event: 'utility_screenshot.rounding_ack_failed' },
          'Payment saved; acknowledgement needs retry'
        )
      }
      try {
        const dashboard = await target.service.generateDashboard(draft.period)
        const outcomes = await Promise.allSettled([
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
        if (outcomes.some((outcome) => outcome.status === 'rejected'))
          throw new Error('Delivery failed')
      } catch {
        options.logger?.warn(
          { event: 'utility_screenshot.rounding_delivery_failed' },
          'Payment saved; dashboard refresh needs retry'
        )
      }
      try {
        await review(ctx, draft, target.locale, true)
      } catch {
        await reply(ctx, copy.extraPaymentRefreshFailed)
      }
      return
    }
    if (action === 'save' || action === 'cancel') {
      if (
        action === 'save' &&
        (draft.stage !== 'review' || !draft.preview || draft.issues.length || draft.preview.blocked)
      ) {
        await ack(ctx, {
          text: copy.fixListFirst,
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
        await ack(ctx, { text: copy.unavailable })
        return
      }
      await ack(ctx)
      if (action === 'cancel') {
        await ctx.editMessageText(copy.cancelled, { reply_markup: { inline_keyboard: [] } })
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
        await reply(ctx, copy.saveFailed)
        return
      }
      if (result !== 'applied' && result !== 'unchanged') {
        await review(ctx, draft, target.locale, true)
        await reply(ctx, copy.saveStale)
        return
      }
      let acknowledgementFailed = false
      const acknowledgement = ctx
        .editMessageText(
          result === 'applied'
            ? copy.billsSaved(draft.period)
            : copy.billsAlreadySaved(draft.period),
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
                copy.planTitle(draft.period),
                ...dashboard.utilityBillingPlan.memberSummaries.map((member) =>
                  copy.planLine(
                    member.displayName,
                    member.assignedThisCycle.toMajorString(),
                    dashboard!.currency
                  )
                ),
                '',
                copy.planFootnote
              ].join('\n')
            )
        } catch {
          options.logger?.warn(
            { event: 'utility_screenshot.plan_refresh_failed' },
            'Bills saved; plan refresh needs retry'
          )
          await reply(ctx, copy.planFailed)
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
          await reply(ctx, copy.deliveryFailed)
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
      action === 'edit' ? copy.editPrompt(template) : copy.monthPrompt(draft.period),
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
        (draft.stage !== 'edit' && draft.stage !== 'month') ||
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
            utilityEntryCopy[target.locale].monthInvalid(draft.period),
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
            utilityEntryCopy[target.locale].listInvalid,
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
    const paymentProposalReply =
      replyIsBot &&
      ctx.message.reply_to_message?.reply_markup?.inline_keyboard?.some((row) =>
        row.some(
          (button) =>
            'callback_data' in button &&
            /^(payment_topic:confirm:|pt:mc:)/.test(button.callback_data)
        )
      )
    const savedPaymentReply =
      replyIsBot &&
      /(?:(?:аренда|коммуналка)(?: за \S+)? записана|(?:rent|utilities)(?: for \S+)? recorded)/iu.test(
        ctx.message.reply_to_message?.text ?? ''
      )
    if (paymentProposalReply || savedPaymentReply) {
      await next()
      return
    }
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
    if (hasCompletedPaymentCaption(text) || /купил|купила|bought|purchase/i.test(text)) {
      await next()
      return
    }
    const target = await actor(ctx)
    if (!target) {
      const locale = await resolveReplyLocale({
        ctx,
        repository: options.householdConfigurationRepository
      })
      await reply(ctx, utilityEntryCopy[locale].notMember)
      return
    }
    const copy = utilityEntryCopy[target.locale]
    if (!period && !utilityIntent) {
      await reply(ctx, copy.howToSend)
      return
    }
    if (!file) {
      await reply(ctx, copy.sendAsImage)
      return
    }
    if (!options.recognize) {
      await reply(ctx, copy.recognitionOff)
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
        getFile: (fileId, signal) => ctx.api.getFile(fileId, signal),
        file,
        timeoutMs: options.timeoutMs
      })
      const recognition = await options.recognize(image)
      if (recognition.kind !== 'utility_balances' || !recognition.bills.length) {
        await reply(
          ctx,
          recognition.kind === 'payment_receipt' ? copy.receiptNotBills : copy.noBillsFound
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
      await reply(ctx, copy.recognitionFailed)
    }
  })
}
