import { HandCoins, Lightbulb, ShoppingBag } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'

import { useDashboard } from '@/app/dashboard-context'
import { Badge } from '@/components/ui/badge'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/cn'
import { formatCyclePeriod, formatFriendlyDate } from '@/lib/dates'
import { formatMoneyLabel, ledgerSecondaryAmount } from '@/lib/ledger-helpers'
import { majorStringToMinor } from '@/lib/money'
import type { LedgerEntry } from './types'

function joinMetaParts(parts: readonly (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(' · ')
}

function kindIcon(kind: LedgerEntry['kind']): ReactNode {
  if (kind === 'purchase') return <ShoppingBag className="size-4" />
  if (kind === 'utility') return <Lightbulb className="size-4" />
  return <HandCoins className="size-4" />
}

export function LedgerList({
  entries,
  emptyText,
  canEdit,
  onSelect
}: {
  entries: readonly LedgerEntry[]
  emptyText: string
  canEdit: (entry: LedgerEntry) => boolean
  onSelect: (entry: LedgerEntry) => void
}) {
  const { copy, locale } = useI18n()
  const { dashboard } = useDashboard()

  const memberNames = useMemo(
    () =>
      new Map((dashboard?.members ?? []).map((member) => [member.memberId, member.displayName])),
    [dashboard]
  )

  function entryTitle(entry: LedgerEntry): string {
    if (entry.kind === 'payment') {
      return entry.paymentKind === 'rent' ? copy.paymentLedgerRent : copy.paymentLedgerUtilities
    }
    return entry.title
  }

  function metaSummary(entry: LedgerEntry): string {
    return joinMetaParts([
      entry.actorDisplayName ?? copy.ledgerActorFallback,
      entry.occurredAt ? formatFriendlyDate(entry.occurredAt, locale) : null,
      entry.kind === 'purchase' && entry.originPeriod
        ? formatCyclePeriod(entry.originPeriod, locale)
        : null
    ])
  }

  function splitSummary(entry: LedgerEntry): string {
    const participantCount = (entry.purchaseParticipants ?? []).filter(
      (participant) => participant.included
    ).length
    const splitLabel =
      entry.purchaseSplitMode === 'custom_amounts'
        ? copy.purchaseSplitSummaryCustom
        : copy.purchaseSplitSummaryEqual

    return `${splitLabel} · ${participantCount} ${copy.participantsLabel}`
  }

  function outstandingSummary(entry: LedgerEntry): string | null {
    const open = (entry.outstandingByMember ?? []).filter(
      (item) => majorStringToMinor(item.amountMajor) > 0n
    )
    const items = open.slice(0, 2).map((item) => {
      const name = memberNames.get(item.memberId) ?? item.memberId
      return `${name} ${formatMoneyLabel(item.amountMajor, entry.displayCurrency, locale)}`
    })

    if (items.length === 0) return null

    const extraCount = open.length - items.length
    const extraSuffix =
      extraCount > 0
        ? ` · ${copy.purchaseMoreParticipantsLabel.replace('{count}', String(extraCount))}`
        : ''

    return `${copy.purchaseOutstandingLabel}: ${items.join(' · ')}${extraSuffix}`
  }

  if (entries.length === 0) {
    return <p className="py-6 text-center text-sm text-faint">{emptyText}</p>
  }

  return (
    <div className="divide-y divide-border">
      {entries.map((entry) => {
        const editable = canEdit(entry)
        const secondary = ledgerSecondaryAmount(entry)
        const outstanding = entry.kind === 'purchase' ? outstandingSummary(entry) : null
        const participantCount = (entry.purchaseParticipants ?? []).filter(
          (participant) => participant.included
        ).length

        const content = (
          <>
            <span
              className={cn(
                'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full',
                entry.kind === 'purchase' && 'bg-primary-soft text-primary',
                entry.kind === 'utility' && 'bg-field text-status-overdue',
                entry.kind === 'payment' && 'bg-field text-status-credit'
              )}
              aria-hidden
            >
              {kindIcon(entry.kind)}
            </span>

            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="truncate text-sm font-medium text-foreground">
                  {entryTitle(entry)}
                </span>
                {entry.kind === 'purchase' && entry.resolutionStatus ? (
                  <Badge tone={entry.resolutionStatus === 'resolved' ? 'success' : 'warning'}>
                    {entry.resolutionStatus === 'resolved'
                      ? copy.purchaseStatusSettled
                      : copy.purchaseStatusOpen}
                  </Badge>
                ) : null}
                {entry.kind === 'purchase' && entry.isCurrentCyclePurchase ? (
                  <Badge tone="outline">{copy.todayCurrentPeriod}</Badge>
                ) : null}
              </span>
              <span className="mt-0.5 block truncate text-xs text-faint">{metaSummary(entry)}</span>
              {entry.kind === 'purchase' ? (
                <span className="mt-0.5 block text-[11px] text-faint">
                  {participantCount > 0 ? splitSummary(entry) : copy.purchaseNoParticipantsLabel}
                </span>
              ) : null}
              {outstanding ? (
                <span className="mt-0.5 block text-[11px] text-status-due">{outstanding}</span>
              ) : null}
              {entry.kind === 'purchase' &&
              entry.resolutionStatus === 'resolved' &&
              entry.resolvedAt ? (
                <span className="mt-0.5 block text-[11px] text-faint">
                  {copy.purchaseSettledOnLabel} {formatFriendlyDate(entry.resolvedAt, locale)}
                </span>
              ) : null}
            </span>

            <span className="shrink-0 text-right">
              <span className="block font-mono text-sm text-foreground">
                {formatMoneyLabel(entry.displayAmountMajor, entry.displayCurrency, locale)}
              </span>
              {secondary ? (
                <span className="block font-mono text-[11px] text-faint">{secondary}</span>
              ) : null}
            </span>
          </>
        )

        const rowClass = 'flex w-full items-start gap-3 py-3 text-left'

        return editable ? (
          <button
            key={entry.id}
            type="button"
            className={cn(rowClass, 'transition-colors active:bg-field-hover')}
            onClick={() => onSelect(entry)}
          >
            {content}
          </button>
        ) : (
          <div key={entry.id} className={rowClass}>
            {content}
          </div>
        )
      })}
    </div>
  )
}
