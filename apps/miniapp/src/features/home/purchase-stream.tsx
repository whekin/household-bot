import { Plus, ReceiptText } from 'lucide-react'
import { useMemo } from 'react'

import { useDashboard } from '@/app/dashboard-context'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { navigateToTab } from '@/components/layout'
import { useI18n } from '@/i18n/context'
import type { Copy } from '@/i18n'
import {
  formatAbsoluteMoneyLabel,
  formatMoneyLabel,
  semanticMoneyTone,
  type SemanticMoneyTone
} from '@/lib/ledger-helpers'
import { majorStringToMinor } from '@/lib/money'
import { formatFriendlyDate } from '@/lib/dates'
import { cn } from '@/lib/cn'
import { purchaseShareForMember, type TodayViewModel } from './today-view-model'

function purchasePositionLabel(amountMajor: string, copy: Copy): string {
  const tone = semanticMoneyTone(amountMajor)

  if (tone === 'is-credit') return copy.todayPurchasePositionCredit
  if (tone === 'is-debit') return copy.todayPurchasePositionDebit
  return copy.todayPurchasePositionEven
}

function toneClass(tone: SemanticMoneyTone): string {
  if (tone === 'is-credit') return 'text-status-credit'
  if (tone === 'is-debit') return 'text-status-due'
  return 'text-foreground'
}

/**
 * Compact recent-purchases feed: your purchase balance, quick stats, the
 * latest unresolved buys, and the per-member positions chart. No CRUD here —
 * that lives in the Activity tab. Ported from the legacy PurchaseStream.
 */
export function PurchaseStream({
  model,
  currentMemberId,
  onAddPurchase
}: {
  model: TodayViewModel
  currentMemberId: string | null
  onAddPurchase: () => void
}) {
  const { copy, locale } = useI18n()
  const { dashboard } = useDashboard()

  const positions = useMemo(() => {
    const items = (dashboard?.members ?? [])
      .filter((member) => member.status !== 'left')
      .map((member) => {
        const amountMajor = member.effectivePurchaseBalanceMajor ?? member.purchaseOffsetMajor
        const amountMinor = majorStringToMinor(amountMajor)
        return {
          memberId: member.memberId,
          displayName: member.displayName,
          amountMajor,
          absoluteMinor: amountMinor < 0n ? -amountMinor : amountMinor
        }
      })
      .sort((left, right) =>
        right.absoluteMinor === left.absoluteMinor
          ? 0
          : right.absoluteMinor > left.absoluteMinor
            ? 1
            : -1
      )
    const maxMinor = items.reduce(
      (max, entry) => (entry.absoluteMinor > max ? entry.absoluteMinor : max),
      0n
    )
    return { items, maxMinor: maxMinor === 0n ? 1n : maxMinor }
  }, [dashboard])

  if (!dashboard) return null

  const balanceTone = semanticMoneyTone(model.purchaseBalanceMajor)

  return (
    <Card className="space-y-3">
      <div>
        <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-faint">
          <ReceiptText className="size-3.5" />
          {copy.purchasesTitle}
        </p>
        <CardHeader
          className="mb-0 mt-0.5"
          title={copy.todayPurchaseCommandTitle}
          hint={copy.todayPurchaseCommandBody}
          action={
            <Button variant="primary" size="sm" onClick={onAddPurchase}>
              <Plus className="size-3.5" />
              {copy.todayAddPurchase}
            </Button>
          }
        />
      </div>

      <div className="rounded-xl bg-elevated p-3">
        <p className="text-xs text-muted-foreground">{copy.todayPurchaseBalance}</p>
        <p className={cn('font-mono text-xl font-semibold', toneClass(balanceTone))}>
          {formatMoneyLabel(model.purchaseBalanceMajor, dashboard.currency, locale)}
        </p>
        <p className="mt-0.5 text-xs text-faint">
          {balanceTone === 'is-credit'
            ? copy.todayPurchaseCredit
            : balanceTone === 'is-debit'
              ? copy.todayPurchaseDebit
              : copy.todayPurchaseEven}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-elevated p-3">
          <p className="text-xs text-muted-foreground">{copy.todayOpenPurchasesLabel}</p>
          <p className="mt-0.5 font-mono text-lg font-semibold text-foreground">
            {model.unresolvedPurchaseCount}
          </p>
        </div>
        <div className="rounded-xl bg-elevated p-3">
          <p className="text-xs text-muted-foreground">{copy.todayPurchaseVolumeLabel}</p>
          <p className="mt-0.5 font-mono text-lg font-semibold text-foreground">
            {formatMoneyLabel(model.purchaseTotalMajor, dashboard.currency, locale)}
          </p>
        </div>
      </div>

      {model.purchaseEntries.length === 0 ? (
        <p className="text-xs text-muted-foreground">{copy.todayPurchasesEmpty}</p>
      ) : (
        <div
          className="divide-y divide-border/60"
          role="button"
          tabIndex={0}
          onClick={() => navigateToTab('activity')}
          onKeyDown={(event) => {
            if (event.key === 'Enter') navigateToTab('activity')
          }}
        >
          {model.purchaseEntries.slice(0, 4).map((entry) => {
            const share = currentMemberId ? purchaseShareForMember(entry, currentMemberId) : null
            return (
              <article
                key={entry.id}
                data-status={entry.resolutionStatus ?? 'resolved'}
                className="flex items-start justify-between gap-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{entry.title}</p>
                  <p className="text-xs text-faint">
                    {[
                      entry.actorDisplayName,
                      entry.occurredAt ? formatFriendlyDate(entry.occurredAt, locale) : null
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-sm font-semibold text-foreground">
                    {formatMoneyLabel(entry.displayAmountMajor, entry.displayCurrency, locale)}
                  </p>
                  {share ? (
                    <p className="text-xs text-faint">
                      {copy.todayMyShare} {formatMoneyLabel(share, entry.displayCurrency, locale)}
                    </p>
                  ) : null}
                </div>
              </article>
            )
          })}
        </div>
      )}

      <div className="rounded-xl bg-elevated p-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">{copy.todayPurchaseChartLabel}</p>
          <p className="text-[11px] font-medium uppercase text-faint">
            {copy.todayPurchaseChartValueLabel}
          </p>
        </div>

        <div className="space-y-2">
          {positions.items.map((entry) => {
            const tone = semanticMoneyTone(entry.amountMajor)
            const ratio = Number(entry.absoluteMinor * 100n) / Number(positions.maxMinor)

            return (
              <div key={entry.memberId} className="flex items-center gap-2.5">
                <div className="w-24 min-w-0 shrink-0">
                  <p className="truncate text-xs font-semibold text-foreground">
                    {entry.displayName}
                  </p>
                  <p className="truncate text-[10px] text-faint">
                    {purchasePositionLabel(entry.amountMajor, copy)}
                  </p>
                </div>
                <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-field">
                  <span
                    className={cn(
                      'block h-full rounded-full',
                      tone === 'is-credit'
                        ? 'bg-status-credit'
                        : tone === 'is-debit'
                          ? 'bg-status-due'
                          : 'bg-border-hover'
                    )}
                    style={{ width: `${Math.max(8, ratio)}%` }}
                  />
                </div>
                <span className={cn('w-20 shrink-0 text-right font-mono text-xs', toneClass(tone))}>
                  {formatAbsoluteMoneyLabel(entry.amountMajor, dashboard.currency, locale)}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </Card>
  )
}
