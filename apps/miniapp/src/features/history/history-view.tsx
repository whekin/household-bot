import { useState } from 'react'

import { useDashboard } from '@/app/dashboard-context'
import { useReadySession } from '@/app/session-context'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { CycleHistoryArchive } from '@/features/activity/cycle-history'
import { LedgerList } from '@/features/activity/ledger-list'
import { PaymentEditor } from '@/features/activity/payment-editor'
import { PurchaseEditor } from '@/features/activity/purchase-editor'
import type { ActivityFilter, LedgerEntry, PurchaseScope } from '@/features/activity/types'
import { UtilityEditor } from '@/features/activity/utility-editor'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/cn'
import { canEditLedgerEntry } from '@/lib/ledger-helpers'
import { haptics } from '@/telegram/webapp'

function FilterChip({
  active,
  label,
  count,
  onClick
}: {
  active: boolean
  label: string
  count?: number
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={() => {
        if (!active) haptics.selection()
        onClick()
      }}
      className={cn(
        'flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold transition-colors',
        active ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground'
      )}
    >
      {label}
      {count !== undefined ? <span className="tabular-nums opacity-60">{count}</span> : null}
    </button>
  )
}

/** Everything that happened, filterable, plus closed months below. */
export function HistoryView() {
  const session = useReadySession()
  const { copy } = useI18n()
  const {
    dashboard,
    loading,
    effectiveIsAdmin,
    activePurchaseLedger,
    resolvedPurchaseLedger,
    utilityLedger,
    paymentLedger
  } = useDashboard()

  const [filter, setFilter] = useState<ActivityFilter>('all')
  const [purchaseScope, setPurchaseScope] = useState<PurchaseScope>('active')
  const [editing, setEditing] = useState<LedgerEntry | null>(null)

  if (loading || !dashboard) {
    return (
      <div className="space-y-3" role="status">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  const filters: { id: ActivityFilter; label: string }[] = [
    { id: 'all', label: copy.ledgerFilterAll },
    { id: 'purchases', label: copy.kindBuys },
    { id: 'utilities', label: copy.kindUtilities },
    { id: 'payments', label: copy.paymentsTitle }
  ]

  const entries: readonly LedgerEntry[] =
    filter === 'all'
      ? dashboard.ledger
      : filter === 'purchases'
        ? purchaseScope === 'active'
          ? activePurchaseLedger
          : resolvedPurchaseLedger
        : filter === 'utilities'
          ? utilityLedger
          : paymentLedger

  const emptyText =
    filter === 'all'
      ? copy.latestActivityEmpty
      : filter === 'purchases'
        ? purchaseScope === 'active'
          ? copy.unresolvedPurchasesEmpty
          : copy.resolvedPurchasesEmpty
        : filter === 'utilities'
          ? copy.utilityLedgerEmpty
          : copy.paymentsEmpty

  return (
    <div className="space-y-3">
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {filters.map((item) => (
          <FilterChip
            key={item.id}
            active={filter === item.id}
            label={item.label}
            onClick={() => setFilter(item.id)}
          />
        ))}
      </div>

      {filter === 'purchases' ? (
        <div className="flex gap-2">
          <FilterChip
            active={purchaseScope === 'active'}
            label={copy.unresolvedPurchasesTitle}
            count={activePurchaseLedger.length}
            onClick={() => setPurchaseScope('active')}
          />
          <FilterChip
            active={purchaseScope === 'resolved'}
            label={copy.resolvedPurchasesTitle}
            count={resolvedPurchaseLedger.length}
            onClick={() => setPurchaseScope('resolved')}
          />
        </div>
      ) : null}

      <Card>
        <LedgerList
          entries={entries}
          emptyText={emptyText}
          canEdit={(entry) =>
            canEditLedgerEntry({
              entry,
              currentMemberId: session.member.id,
              isAdmin: effectiveIsAdmin
            })
          }
          onSelect={setEditing}
        />
      </Card>

      <CycleHistoryArchive cycles={dashboard.cycleHistory ?? []} />

      <PurchaseEditor
        open={editing?.kind === 'purchase'}
        entry={editing?.kind === 'purchase' ? editing : null}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
      />
      <UtilityEditor
        open={editing?.kind === 'utility'}
        entry={editing?.kind === 'utility' ? editing : null}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
      />
      <PaymentEditor
        open={editing?.kind === 'payment'}
        entry={editing?.kind === 'payment' ? editing : null}
        prefill={null}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
      />
    </div>
  )
}
