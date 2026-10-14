import { Check, PenLine } from 'lucide-react'
import { useState } from 'react'

import { closeMiniAppPaymentPeriod } from '@/api'
import { useDashboard } from '@/app/dashboard-context'
import { useSession } from '@/app/session-context'
import { Avatar } from '@/components/avatar'
import { kindLabel } from '@/components/kind'
import { Amount, formatMoney } from '@/components/money'
import { useToast } from '@/components/toast'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/dialog'
import type { MoneyKind } from '@/features/home/home-model'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/cn'
import { formatCyclePeriod, formatFriendlyDate } from '@/lib/dates'
import { majorStringToMinor, minorToMajorString } from '@/lib/money'

export type MemberTarget = {
  kind: MoneyKind
  period: string
  memberId: string
  displayName: string
  isMe: boolean
  dueMajor: string
  paidMajor: string
  remainingMajor: string
  /** Rent before its window: shown, not payable yet. */
  opensOn: string | null
}

/**
 * One person's share of one payment: what it is made of, what is paid, and — for
 * them or an admin — the button that records the rest.
 */
export function MemberSheet({
  target,
  onOpenChange,
  onRecordOther
}: {
  target: MemberTarget
  onOpenChange: (open: boolean) => void
  onRecordOther: (target: MemberTarget) => void
}) {
  const { copy, locale } = useI18n()
  const { initData, handleMiniAppRequestError } = useSession()
  const { dashboard, effectiveIsAdmin, applyDashboard, refresh } = useDashboard()
  const { showToast } = useToast()
  const [saving, setSaving] = useState(false)

  if (!dashboard) return null

  const currency = dashboard.currency
  const remainingMinor = majorStringToMinor(target.remainingMajor)
  const isCurrent = target.period === dashboard.period
  const line = dashboard.members.find((member) => member.memberId === target.memberId)
  const policy = dashboard.paymentBalanceAdjustmentPolicy
  const buysMinor = majorStringToMinor(line?.purchaseOffsetMajor ?? '0.00')
  const shareMajor =
    target.kind === 'rent' ? (line?.rentShareMajor ?? '0.00') : (line?.utilityShareMajor ?? '0.00')
  const showBreakdown = isCurrent && line && policy === target.kind && buysMinor !== 0n
  const bills =
    isCurrent && target.kind === 'utilities' && dashboard.utilityBillingPlan?.status !== 'settled'
      ? (dashboard.utilityBillingPlan?.categories ?? []).filter(
          (category) => category.assignedMemberId === target.memberId
        )
      : []
  const canMark = remainingMinor > 0n && !target.opensOn && (target.isMe || effectiveIsAdmin)

  async function markPaid() {
    if (!initData || saving) return
    setSaving(true)
    try {
      const result = await closeMiniAppPaymentPeriod(initData, {
        period: target.period,
        kind: target.kind,
        memberIds: [target.memberId]
      })
      if (!applyDashboard(result.dashboard)) await refresh()
      showToast(
        result.closeSummary.closedMembers.length > 0 ? copy.memberSheetMarked : copy.payAlreadyDone,
        'success'
      )
      onOpenChange(false)
    } catch (error) {
      if (!handleMiniAppRequestError(error)) {
        showToast(isCurrent ? copy.monthActionFailed : copy.payFailedPast, 'error')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet
      open
      onOpenChange={onOpenChange}
      title={target.displayName}
      description={`${kindLabel(target.kind, copy)} · ${formatCyclePeriod(target.period, locale)}`}
    >
      <div className="space-y-3">
        <section className="flex items-center gap-4 rounded-[24px] bg-card p-4">
          <Avatar name={target.displayName} me={target.isMe} className="size-12 text-sm" />
          <div className="min-w-0">
            {target.opensOn ? (
              <p className="text-[13px] text-faint">
                {copy.memberSheetUpcoming.replace(
                  '{date}',
                  formatFriendlyDate(target.opensOn, locale)
                )}
              </p>
            ) : (
              <p className="text-[13px] text-faint">
                {remainingMinor > 0n ? copy.memberSheetRemaining : copy.memberSheetAllPaid}
              </p>
            )}
            <p
              className={cn(
                'text-[30px] font-bold leading-tight',
                remainingMinor === 0n && 'text-buys-ink'
              )}
            >
              <Amount
                value={remainingMinor > 0n ? target.remainingMajor : target.paidMajor}
                currency={currency}
              />
            </p>
          </div>
        </section>

        {bills.length > 0 ? (
          <section className="rounded-[24px] bg-card p-4">
            <h3 className="mb-1 text-[13px] font-semibold text-muted-foreground">
              {copy.memberSheetBills}
            </h3>
            <ul className="divide-y divide-border">
              {bills.map((bill) => {
                const left = majorStringToMinor(bill.remainingAmountMajor)
                return (
                  <li
                    key={`${bill.utilityBillId}:${bill.assignedAmountMajor}`}
                    className="flex items-center justify-between gap-3 py-2.5 text-sm"
                  >
                    <span className="min-w-0 truncate font-medium">{bill.billName}</span>
                    <span className="flex shrink-0 items-center gap-2 tabular-nums">
                      {left === 0n ? <Check className="size-4 text-buys" strokeWidth={3} /> : null}
                      <span className={cn(left === 0n && 'text-faint line-through')}>
                        {formatMoney(bill.assignedAmountMajor, currency)}
                      </span>
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>
        ) : null}

        <section className="rounded-[24px] bg-card p-4">
          <h3 className="mb-2 text-[13px] font-semibold text-muted-foreground">
            {copy.memberSheetHow}
          </h3>
          <dl className="space-y-1.5 text-sm">
            {showBreakdown ? (
              <>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">
                    {target.kind === 'rent'
                      ? copy.memberSheetRentShare
                      : copy.memberSheetUtilityShare}
                  </dt>
                  <dd className="tabular-nums">{formatMoney(shareMajor, currency)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">
                    {buysMinor > 0n ? copy.memberSheetBuysOwe : copy.memberSheetBuysOwed}
                  </dt>
                  <dd className={cn('tabular-nums', buysMinor < 0n && 'text-buys-ink')}>
                    {buysMinor > 0n ? '+' : '−'}
                    {formatMoney(
                      minorToMajorString(buysMinor < 0n ? -buysMinor : buysMinor),
                      currency
                    )}
                  </dd>
                </div>
              </>
            ) : null}
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{copy.memberSheetTotal}</dt>
              <dd className="tabular-nums">{formatMoney(target.dueMajor, currency)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{copy.memberSheetPaidSoFar}</dt>
              <dd className="tabular-nums text-buys-ink">
                {formatMoney(target.paidMajor, currency)}
              </dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-border pt-1.5 font-semibold">
              <dt>{copy.memberSheetRemaining}</dt>
              <dd className="tabular-nums">{formatMoney(target.remainingMajor, currency)}</dd>
            </div>
          </dl>
        </section>

        {canMark ? (
          <div>
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              loading={saving}
              onClick={() => void markPaid()}
            >
              {!saving ? <Check className="size-4" strokeWidth={2.5} /> : null}
              {copy.memberSheetMarkPaid.replace(
                '{amount}',
                formatMoney(target.remainingMajor, currency)
              )}
            </Button>
            <p className="mt-2 text-center text-xs text-faint">{copy.memberSheetMarkHint}</p>
          </div>
        ) : null}

        {effectiveIsAdmin && !target.opensOn ? (
          <Button variant="ghost" className="w-full" onClick={() => onRecordOther(target)}>
            <PenLine className="size-4" />
            {copy.memberSheetOtherAmount}
          </Button>
        ) : null}
      </div>
    </Sheet>
  )
}
