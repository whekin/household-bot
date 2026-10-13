import { Check, Copy, ExternalLink } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { closeMiniAppPaymentPeriod, type MiniAppDashboard } from '@/api'
import { useDashboard } from '@/app/dashboard-context'
import { useSession } from '@/app/session-context'
import { KindIcon, kindLabel } from '@/components/kind'
import { formatMoney } from '@/components/money'
import { useToast } from '@/components/toast'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/dialog'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/cn'
import { majorStringToMinor, minorToMajorString } from '@/lib/money'
import { getTelegramWebApp, haptics } from '@/telegram/webapp'
import { dueText } from './hero-card'
import type { HomeModel, MyUtilityBill, Obligation } from './home-model'

type Currency = MiniAppDashboard['currency']

function useCopyToClipboard() {
  const { showToast } = useToast()
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  return {
    copiedKey,
    async copyText(key: string, text: string) {
      try {
        await navigator.clipboard.writeText(text)
        haptics.selection()
        setCopiedKey(key)
        clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopiedKey(null), 1600)
      } catch {
        // No clipboard access (older webviews): show the text so it can be copied by hand.
        showToast(text, 'info')
      }
    }
  }
}

function openExternal(url: string) {
  const webApp = getTelegramWebApp()
  if (webApp?.openLink) webApp.openLink(url)
  else window.open(url, '_blank', 'noopener')
}

function rateMicrosToString(value: string | null): string | null {
  if (!value) return null
  const normalized = value.padStart(7, '0')
  const whole = normalized.slice(0, -6) || '0'
  const fraction = normalized.slice(-6).replace(/0+$/, '')
  return fraction.length > 0 ? `${whole}.${fraction}` : whole
}

/**
 * "Pay" opens this: for every amount the reader owes, exactly where the money goes
 * and one button to say it went. Utilities list the provider bills the plan gave
 * them; rent lists the landlord's accounts.
 */
export function PaySheet({
  open,
  onOpenChange,
  model
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  model: HomeModel
}) {
  const { copy } = useI18n()
  const { dashboard } = useDashboard()
  if (!dashboard) return null

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={copy.paySheetTitle}
      description={
        model.obligations.length > 1
          ? `${copy.payWhyTotal}: ${formatMoney(model.totalDueMajor, dashboard.currency)}`
          : undefined
      }
    >
      <div className="space-y-4">
        {model.obligations.map((obligation) => (
          <ObligationBlock
            key={obligation.key}
            obligation={obligation}
            model={model}
            dashboard={dashboard}
            onDone={() => {
              if (model.obligations.length <= 1) onOpenChange(false)
            }}
          />
        ))}
      </div>
    </Sheet>
  )
}

function ObligationBlock({
  obligation,
  model,
  dashboard,
  onDone
}: {
  obligation: Obligation
  model: HomeModel
  dashboard: MiniAppDashboard
  onDone: () => void
}) {
  const { copy, locale } = useI18n()
  const { initData, readySession, handleMiniAppRequestError } = useSession()
  const { applyDashboard, refresh } = useDashboard()
  const { showToast } = useToast()
  const [saving, setSaving] = useState(false)
  const currency = dashboard.currency
  const showBills =
    obligation.kind === 'utilities' && obligation.isCurrentPeriod && model.myBills.length > 0
  const showRent = obligation.kind === 'rent' && model.rentDestinations.length > 0

  async function markPaid() {
    if (!initData || !readySession || saving) return
    setSaving(true)
    try {
      const result = await closeMiniAppPaymentPeriod(initData, {
        period: obligation.period,
        kind: obligation.kind,
        memberIds: [readySession.member.id]
      })
      if (!applyDashboard(result.dashboard)) await refresh()
      showToast(copy.payMarked, 'success')
      onDone()
    } catch (error) {
      if (!handleMiniAppRequestError(error)) showToast(copy.payFailed, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-[24px] bg-card p-4">
      <div className="flex items-center gap-3">
        <KindIcon kind={obligation.kind} />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold">{kindLabel(obligation.kind, copy)}</p>
          <p className={cn('text-[13px]', obligation.overdue ? 'text-danger' : 'text-faint')}>
            {dueText(obligation, copy, locale)}
          </p>
        </div>
        <p className="font-display text-lg font-bold tabular-nums">
          {formatMoney(obligation.amountMajor, currency)}
        </p>
      </div>

      {showBills ? (
        <div className="mt-4">
          <p className="mb-2 text-[13px] font-medium text-muted-foreground">
            {copy.payBillsDirectly}
          </p>
          <div className="space-y-2">
            {model.myBills.map((bill) => (
              <BillRow key={bill.billId} bill={bill} currency={currency} />
            ))}
          </div>
        </div>
      ) : null}

      {obligation.kind === 'utilities' && obligation.isCurrentPeriod && model.utilityBreakdown ? (
        <WhyThisAmount breakdown={model.utilityBreakdown} currency={currency} />
      ) : null}

      {obligation.kind === 'rent' ? <RentDetails dashboard={dashboard} /> : null}

      {showRent ? (
        <div className="mt-4">
          <p className="mb-2 text-[13px] font-medium text-muted-foreground">{copy.payRentTo}</p>
          <div className="space-y-2">
            {model.rentDestinations.map((destination, index) => (
              <DestinationRow key={`${destination.account}-${index}`} destination={destination} />
            ))}
          </div>
        </div>
      ) : null}

      <Button
        variant="primary"
        size="lg"
        className="mt-4 w-full"
        loading={saving}
        onClick={() => void markPaid()}
      >
        {!saving ? <Check className="size-4" strokeWidth={2.5} /> : null}
        {copy.payMarkPaid.replace('{amount}', formatMoney(obligation.amountMajor, currency))}
      </Button>
      <p className="mt-2 text-center text-xs text-faint">{copy.payMarkPaidHint}</p>
    </section>
  )
}

function BillRow({ bill, currency }: { bill: MyUtilityBill; currency: Currency }) {
  const { copy } = useI18n()
  const { copiedKey, copyText } = useCopyToClipboard()
  const copied = copiedKey === bill.billId

  return (
    <div className="rounded-2xl bg-elevated p-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate text-sm font-semibold">
          {bill.name}
          {bill.providerName ? (
            <span className="font-normal text-faint"> · {bill.providerName}</span>
          ) : null}
        </p>
        <p className="shrink-0 text-sm font-semibold tabular-nums">
          {formatMoney(bill.amountMajor, currency)}
        </p>
      </div>
      {bill.isSplit ? (
        <p className="mt-0.5 text-xs text-faint">
          {copy.payBillShare.replace('{total}', formatMoney(bill.billTotalMajor, currency))}
        </p>
      ) : null}
      {bill.note ? <p className="mt-0.5 text-xs text-faint">{bill.note}</p> : null}
      {bill.customerNumber || bill.paymentLink ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {bill.customerNumber ? (
            <button
              type="button"
              onClick={() => void copyText(bill.billId, bill.customerNumber ?? '')}
              className="flex h-9 items-center gap-2 rounded-xl bg-card px-3 text-[13px] font-medium active:scale-[0.98]"
            >
              <span className="text-faint">{copy.payAccount}</span>
              <span className="tabular-nums">{bill.customerNumber}</span>
              {copied ? (
                <Check className="size-3.5 text-buys" strokeWidth={3} />
              ) : (
                <Copy className="size-3.5 text-faint" />
              )}
            </button>
          ) : null}
          {bill.paymentLink ? (
            <button
              type="button"
              onClick={() => openExternal(bill.paymentLink ?? '')}
              className="flex h-9 items-center gap-1.5 rounded-xl bg-card px-3 text-[13px] font-medium active:scale-[0.98]"
            >
              {copy.payOpenLink}
              <ExternalLink className="size-3.5 text-faint" />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function WhyThisAmount({
  breakdown,
  currency
}: {
  breakdown: NonNullable<HomeModel['utilityBreakdown']>
  currency: Currency
}) {
  const { copy } = useI18n()
  const buysMinor = majorStringToMinor(breakdown.buysMajor)
  const absoluteBuys = minorToMajorString(buysMinor < 0n ? -buysMinor : buysMinor)

  return (
    <details className="group mt-3 rounded-2xl bg-elevated px-3 py-2.5">
      <summary className="cursor-pointer list-none text-[13px] font-medium text-muted-foreground">
        {copy.payWhy}
      </summary>
      <dl className="mt-2 space-y-1.5 text-[13px]">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{copy.payWhyShare}</dt>
          <dd className="tabular-nums">{formatMoney(breakdown.shareMajor, currency)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">
            {buysMinor > 0n ? copy.payWhyBuysOwe : copy.payWhyBuysOwed}
          </dt>
          <dd className={cn('tabular-nums', buysMinor < 0n && 'text-buys-ink')}>
            {buysMinor > 0n ? '+' : '−'}
            {formatMoney(absoluteBuys, currency)}
          </dd>
        </div>
        <div className="flex justify-between gap-3 border-t border-border pt-1.5 font-semibold">
          <dt>{copy.payWhyTotal}</dt>
          <dd className="tabular-nums">{formatMoney(breakdown.targetMajor, currency)}</dd>
        </div>
      </dl>
    </details>
  )
}

function RentDetails({ dashboard }: { dashboard: MiniAppDashboard }) {
  const { copy } = useI18n()
  const rate = rateMicrosToString(dashboard.rentFxRateMicros)
  if (dashboard.rentSourceCurrency === dashboard.currency || !rate) return null

  return (
    <p className="mt-3 rounded-2xl bg-elevated px-3 py-2.5 text-[13px] text-muted-foreground">
      {copy.payRentFx
        .replace(
          '{source}',
          formatMoney(dashboard.rentSourceAmountMajor, dashboard.rentSourceCurrency)
        )
        .replace('{rate}', rate)}
    </p>
  )
}

function DestinationRow({ destination }: { destination: HomeModel['rentDestinations'][number] }) {
  const { copy } = useI18n()
  const { copiedKey, copyText } = useCopyToClipboard()
  const copied = copiedKey === destination.account
  const meta = [destination.recipientName, destination.bankName].filter(Boolean).join(' · ')

  return (
    <div className="rounded-2xl bg-elevated p-3">
      <p className="text-sm font-semibold">{destination.label}</p>
      {meta ? <p className="text-xs text-faint">{meta}</p> : null}
      <button
        type="button"
        onClick={() => void copyText(destination.account, destination.account)}
        className="mt-2 flex w-full items-center justify-between gap-2 rounded-xl bg-card px-3 py-2.5 text-left active:scale-[0.99]"
      >
        <span className="min-w-0 truncate text-sm font-medium tabular-nums">
          {destination.account}
        </span>
        <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-muted-foreground">
          {copied ? (
            <>
              <Check className="size-3.5 text-buys" strokeWidth={3} />
              {copy.payCopied}
            </>
          ) : (
            <>
              <Copy className="size-3.5" />
              {copy.payCopy}
            </>
          )}
        </span>
      </button>
      {destination.note ? <p className="mt-1.5 text-xs text-faint">{destination.note}</p> : null}
      {destination.link ? (
        <button
          type="button"
          onClick={() => openExternal(destination.link ?? '')}
          className="mt-2 flex items-center gap-1.5 text-[13px] font-semibold"
        >
          {copy.payOpenLink}
          <ExternalLink className="size-3.5 text-faint" />
        </button>
      ) : null}
    </div>
  )
}
