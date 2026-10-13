import { ArrowRight, Check } from 'lucide-react'

import type { MiniAppDashboard } from '@/api'
import { KIND_STYLE, KindDot, kindLabel } from '@/components/kind'
import { Amount, formatMoney } from '@/components/money'
import type { Copy } from '@/i18n'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/cn'
import { formatCyclePeriod, formatFriendlyDate } from '@/lib/dates'
import { haptics } from '@/telegram/webapp'
import { dateValue, type HomeModel, type Obligation } from './home-model'

export function dueText(obligation: Obligation, copy: Copy, locale: 'en' | 'ru'): string {
  if (!obligation.isCurrentPeriod) {
    return copy.homeFromMonth.replace('{month}', formatCyclePeriod(obligation.period, locale))
  }
  if (obligation.daysLeft < -1) {
    return copy.homeLateDays.replace('{count}', String(-obligation.daysLeft))
  }
  if (obligation.daysLeft === -1) return copy.homeLateOneDay
  if (obligation.daysLeft === 0) return copy.homeDueToday
  if (obligation.daysLeft === 1) return copy.homeDueTomorrow
  return copy.homeDueInDays.replace('{count}', String(obligation.daysLeft))
}

/**
 * The one answer Home exists for: what do I pay now? Owing, overdue, or all clear,
 * with a single action and the month's two payment windows underneath.
 */
export function HeroCard({
  model,
  currency,
  onPay
}: {
  model: HomeModel
  currency: MiniAppDashboard['currency']
  onPay: () => void
}) {
  const { copy, locale } = useI18n()
  const lead = model.obligations[0] ?? null
  const ctaClass =
    model.status === 'overdue'
      ? 'bg-danger text-white'
      : lead?.kind === 'rent'
        ? 'bg-rent text-[#10173a]'
        : 'bg-util text-[#2b1a00]'

  return (
    <section
      aria-label={model.status === 'clear' ? copy.homeClearTitle : copy.homeToPay}
      className="animate-rise overflow-hidden rounded-[28px] bg-hero p-5 text-hero-foreground"
    >
      {model.status === 'clear' ? (
        <ClearState model={model} currency={currency} />
      ) : (
        <>
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
              model.status === 'overdue'
                ? 'bg-danger text-white'
                : 'bg-hero-line text-hero-foreground'
            )}
          >
            {model.status === 'overdue' ? copy.homeOverdue : copy.homeToPay}
          </span>

          <p className="mt-3 text-[44px] font-bold leading-none tracking-tight">
            <Amount value={model.totalDueMajor} currency={currency} />
          </p>

          <ul className="mt-4 space-y-2">
            {model.obligations.map((obligation) => (
              <li key={obligation.key} className="flex items-center gap-2.5 text-sm">
                <KindDot kind={obligation.kind} className="size-2.5" />
                <span className="font-medium">{kindLabel(obligation.kind, copy)}</span>
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate',
                    obligation.overdue ? 'text-danger' : 'text-hero-muted'
                  )}
                >
                  {dueText(obligation, copy, locale)}
                </span>
                <span className="shrink-0 font-semibold tabular-nums">
                  {formatMoney(obligation.amountMajor, currency)}
                </span>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={() => {
              haptics.impact('medium')
              onPay()
            }}
            className={cn(
              'mt-5 flex h-13 w-full items-center justify-center gap-2 rounded-2xl text-[15px] font-semibold transition-transform active:scale-[0.98]',
              ctaClass
            )}
          >
            {copy.homePayAction}
            <ArrowRight className="size-4" strokeWidth={2.5} />
          </button>
        </>
      )}

      <MonthStrip model={model} />
    </section>
  )
}

function ClearState({
  model,
  currency
}: {
  model: HomeModel
  currency: MiniAppDashboard['currency']
}) {
  const { copy, locale } = useI18n()

  return (
    <div>
      <span className="flex size-10 items-center justify-center rounded-full bg-buys text-[#0b2a16]">
        <Check className="size-5" strokeWidth={3} />
      </span>
      <h2 className="mt-4 font-display text-[28px] font-bold leading-tight tracking-tight">
        {copy.homeClearTitle}
      </h2>
      <p className="mt-1 text-sm text-hero-muted">{copy.homeClearBody}</p>

      {model.paidThisPeriod.length > 0 || model.next ? (
        <ul className="mt-4 space-y-2 text-sm">
          {model.paidThisPeriod.map((paid) => (
            <li key={paid.kind} className="flex items-center gap-2.5">
              <KindDot kind={paid.kind} className="size-2.5" />
              <span className="flex-1">
                {copy.homePaidLine.replace('{kind}', kindLabel(paid.kind, copy))}
              </span>
              <span className="font-semibold tabular-nums text-hero-muted">
                {formatMoney(paid.amountMajor, currency)}
              </span>
            </li>
          ))}
          {model.next ? (
            <li className="flex items-center gap-2.5">
              <KindDot kind={model.next.kind} className="size-2.5 opacity-50" />
              <span className="flex-1">
                {copy.homeNextWindow
                  .replace('{kind}', kindLabel(model.next.kind, copy))
                  .replace('{date}', formatFriendlyDate(model.next.startDate, locale))}
              </span>
              {model.next.estimateMajor ? (
                <span className="tabular-nums text-hero-muted">
                  {copy.homeNextEstimate.replace(
                    '{amount}',
                    formatMoney(model.next.estimateMajor, currency)
                  )}
                </span>
              ) : null}
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
}

/**
 * The period month as one bar: each payment window in its kind's color, and a
 * marker for today. Windows that began last month are clipped to day one.
 */
function MonthStrip({ model }: { model: HomeModel }) {
  const { copy, locale } = useI18n()
  const monthStart = dateValue(`${model.period}-01`)
  const [year, month] = model.period.split('-').map((part) => Number.parseInt(part, 10))
  const days = new Date(Date.UTC(year ?? 1970, month ?? 1, 0)).getUTCDate()
  const monthEnd = monthStart + (days - 1) * 86_400_000
  const position = (date: string) =>
    Math.min(1, Math.max(0, (dateValue(date) - monthStart) / (monthEnd - monthStart)))

  const todayValue = dateValue(model.today)
  const todayInMonth = todayValue >= monthStart && todayValue <= monthEnd

  return (
    <div className="mt-6" aria-hidden>
      <div className="mb-2 flex items-center justify-between text-[11px] font-medium text-hero-muted">
        <span className="inline-block first-letter:uppercase">
          {formatCyclePeriod(model.period, locale)}
        </span>
        {todayInMonth ? <span>{formatFriendlyDate(model.today, locale)}</span> : null}
      </div>
      <div className="relative h-2 rounded-full bg-hero-line">
        {model.windows.map((window) => {
          const start = position(window.startDate)
          const end = position(window.endDate)
          return (
            <span
              key={window.kind}
              className={cn('absolute inset-y-0 rounded-full', KIND_STYLE[window.kind].solid)}
              style={{ left: `${start * 100}%`, width: `${Math.max(2, (end - start) * 100)}%` }}
            />
          )
        })}
        {todayInMonth ? (
          <span
            className="absolute -top-1 h-4 w-1 -translate-x-1/2 rounded-full bg-hero-foreground ring-2 ring-hero"
            style={{ left: `${position(model.today) * 100}%` }}
            title={copy.monthStripToday}
          />
        ) : null}
      </div>
      <div className="relative mt-2 h-4 text-[11px] font-medium">
        {model.windows.map((window) => (
          <span
            key={window.kind}
            className={cn('absolute whitespace-nowrap', KIND_STYLE[window.kind].text)}
            style={{ left: `${position(window.startDate) * 100}%` }}
          >
            {kindLabel(window.kind, copy)} {Number(window.startDate.slice(8))}–
            {Number(window.endDate.slice(8))}
          </span>
        ))}
      </div>
    </div>
  )
}
