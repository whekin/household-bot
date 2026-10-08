import { useDashboard } from '@/app/dashboard-context'
import { useI18n } from '@/i18n/context'
import { formatFriendlyDate } from '@/lib/dates'
import { formatMoneyLabel } from '@/lib/ledger-helpers'
import { majorStringToMinor, minorToMajorString } from '@/lib/money'
import { cn } from '@/lib/cn'
import type { MiniAppDashboard } from '@/api'
import type { Locale } from '@/i18n'
import type { TodayMemberCloseLine, TodayViewModel } from './today-view-model'

function formatAdjustmentMoneyLabel(
  amountMajor: string,
  currency: MiniAppDashboard['currency'],
  locale: Locale
): string {
  const amountMinor = majorStringToMinor(amountMajor)
  const label = formatMoneyLabel(minorToMajorString(amountMinor), currency, locale)

  return amountMinor > 0n ? `+${label}` : label
}

export function PersonalLine({
  label,
  value,
  tone = 'default'
}: {
  label: string
  value: string
  tone?: 'default' | 'muted' | 'credit'
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className={cn('text-xs', tone === 'muted' ? 'text-faint' : 'text-muted-foreground')}>
        {label}
      </span>
      <span
        className={cn(
          'shrink-0 font-mono text-xs',
          tone === 'muted' && 'text-muted-foreground',
          tone === 'default' && 'font-semibold text-foreground',
          tone === 'credit' && 'font-semibold text-status-credit'
        )}
      >
        {value}
      </span>
    </div>
  )
}

export function PersonalGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-elevated px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-faint">{title}</p>
      <div className="mt-1 divide-y divide-border/60">{children}</div>
    </div>
  )
}

/**
 * How a member's number came out the way it did: their raw share, the
 * shared-purchase adjustment on top of it, and the bills it was routed into.
 *
 * Recorded payments and provider remainders are separate from the purchase/share
 * calculation: the fair share is not necessarily the amount routed to bills.
 */
export function PersonalDetails({
  model,
  line
}: {
  model: TodayViewModel
  line: TodayMemberCloseLine
}) {
  const { copy, locale } = useI18n()
  const { dashboard } = useDashboard()
  const currency = dashboard?.currency ?? 'GEL'

  const breakdown =
    model.stage === 'utilities' && line.utilityBreakdown?.hasAdjustment
      ? line.utilityBreakdown
      : null
  const utilityLines = model.stage === 'utilities' ? line.utilityLines : []
  const showRent = model.stage === 'rent'

  return (
    <div className="space-y-2 pt-1">
      <PersonalGroup title={copy.todayPaymentSummaryTitle}>
        <PersonalLine
          tone="credit"
          label={copy.todayAccountedLabel}
          value={formatMoneyLabel(line.paidMajor, currency, locale)}
        />
        <PersonalLine
          label={copy.todayRemainingLabel}
          value={formatMoneyLabel(line.amountMajor, currency, locale)}
        />
      </PersonalGroup>

      {line.unallocatedPaidMajor ? (
        <div className="rounded-xl bg-elevated px-3 py-2 text-xs text-muted-foreground">
          <PersonalLine
            label={copy.todayUnallocatedPaymentLabel}
            value={formatMoneyLabel(line.unallocatedPaidMajor, currency, locale)}
          />
          <p className="mt-1">{copy.todayUnallocatedPaymentBody}</p>
        </div>
      ) : null}

      {utilityLines.length > 0 ? (
        <PersonalGroup title={copy.todayUtilityPaymentsTitle}>
          {utilityLines.map((utilityLine) => (
            <div key={utilityLine.billId} className="py-2">
              <p className="text-sm font-medium text-foreground">{utilityLine.billName}</p>
              <PersonalLine
                tone={majorStringToMinor(utilityLine.paidMajor) > 0n ? 'credit' : 'muted'}
                label={copy.todayAccountedLabel}
                value={formatMoneyLabel(utilityLine.paidMajor, currency, locale)}
              />
              <PersonalLine
                label={copy.todayRemainingLabel}
                value={formatMoneyLabel(utilityLine.amountMajor, currency, locale)}
              />
            </div>
          ))}
        </PersonalGroup>
      ) : null}

      {breakdown ? (
        <PersonalGroup title={copy.todayUtilityBreakdownTitle}>
          <PersonalLine
            label={copy.todayUtilityShareLabel}
            value={formatMoneyLabel(breakdown.shareMajor, currency, locale)}
          />
          {majorStringToMinor(breakdown.purchaseOffsetMajor) !== 0n ? (
            <PersonalLine
              tone="muted"
              label={copy.todayUtilityPurchasesAdjustmentLabel}
              value={formatAdjustmentMoneyLabel(breakdown.purchaseOffsetMajor, currency, locale)}
            />
          ) : null}
          <PersonalLine
            label={copy.todayUtilityPlanTargetLabel}
            value={formatMoneyLabel(breakdown.targetMajor, currency, locale)}
          />
        </PersonalGroup>
      ) : null}

      {showRent ? (
        <PersonalGroup title={copy.todayPersonalLinesTitle}>
          <PersonalLine
            label={copy.todayRentDueLabel}
            value={formatMoneyLabel(line.amountMajor, currency, locale)}
          />
          {model.currentMemberRentDueDate ? (
            <PersonalLine
              tone="muted"
              label={copy.dueOnLabel.replace('{date}', '').trim()}
              value={formatFriendlyDate(model.currentMemberRentDueDate, locale)}
            />
          ) : null}
        </PersonalGroup>
      ) : null}
    </div>
  )
}
