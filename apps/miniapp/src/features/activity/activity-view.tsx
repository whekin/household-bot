import { HandCoins, Lightbulb, Plus, Settings2, ShoppingBag } from 'lucide-react'
import { useState } from 'react'

import { useDashboard } from '@/app/dashboard-context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { Sheet } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/cn'
import { formatMoneyLabel } from '@/lib/ledger-helpers'
import { haptics } from '@/telegram/webapp'
import { BalancesSection } from './balances-section'
import { LedgerList } from './ledger-list'
import { PaymentEditor } from './payment-editor'
import { PurchaseEditor } from './purchase-editor'
import { RentEditor } from './rent-editor'
import { UtilityEditor } from './utility-editor'
import { UtilityPlanSection } from './utility-plan-section'
import type { ActivityFilter, LedgerEntry, PaymentPrefill, PurchaseScope } from './types'

function FilterChip({
  active,
  label,
  count,
  onClick
}: {
  active: boolean
  label: string
  count?: number | undefined
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
        'flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
        active
          ? 'border-transparent bg-primary-soft text-primary'
          : 'border-border text-muted-foreground'
      )}
    >
      {label}
      {count !== undefined ? <span className="font-mono text-[10px]">{count}</span> : null}
    </button>
  )
}

export function ActivityView() {
  const { copy, locale } = useI18n()
  const {
    dashboard,
    loading,
    effectiveIsAdmin,
    activePurchaseLedger,
    resolvedPurchaseLedger,
    utilityLedger,
    paymentLedger,
    purchaseTotalMajor,
    cycleState
  } = useDashboard()

  const [filter, setFilter] = useState<ActivityFilter>('all')
  const [purchaseScope, setPurchaseScope] = useState<PurchaseScope>('active')

  const [chooserOpen, setChooserOpen] = useState(false)
  const [purchaseEditor, setPurchaseEditor] = useState<{
    open: boolean
    entry: LedgerEntry | null
  }>({ open: false, entry: null })
  const [utilityEditor, setUtilityEditor] = useState<{ open: boolean; entry: LedgerEntry | null }>({
    open: false,
    entry: null
  })
  const [paymentEditor, setPaymentEditor] = useState<{
    open: boolean
    entry: LedgerEntry | null
    prefill: PaymentPrefill | null
  }>({ open: false, entry: null, prefill: null })
  const [rentOpen, setRentOpen] = useState(false)

  if (loading) {
    return (
      <>
        <Card>
          <Skeleton className="mb-3 h-6 w-full" />
          <Skeleton className="h-24 w-4/5" />
        </Card>
        <Card>
          <Skeleton className="mb-3 h-6 w-full" />
          <Skeleton className="h-24 w-4/5" />
        </Card>
      </>
    )
  }

  if (!dashboard) {
    return (
      <Card>
        <p className="py-6 text-center text-sm text-faint">{copy.emptyDashboard}</p>
      </Card>
    )
  }

  const filters: { id: ActivityFilter; label: string }[] = [
    { id: 'all', label: locale === 'ru' ? 'Все' : 'All' },
    { id: 'purchases', label: copy.purchasesTitle },
    { id: 'utilities', label: copy.shareUtilities },
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

  function handleSelectEntry(entry: LedgerEntry) {
    if (entry.kind === 'purchase') {
      setPurchaseEditor({ open: true, entry })
    } else if (entry.kind === 'utility') {
      setUtilityEditor({ open: true, entry })
    } else {
      setPaymentEditor({ open: true, entry, prefill: null })
    }
  }

  function openCustomPayment(prefill: PaymentPrefill) {
    setPaymentEditor({ open: true, entry: null, prefill })
  }

  const chooserItems = [
    {
      id: 'purchase',
      label: copy.purchaseAddAction,
      icon: <ShoppingBag className="size-4" />,
      onSelect: () => setPurchaseEditor({ open: true, entry: null })
    },
    {
      id: 'utility',
      label: copy.addUtilityBillAction,
      icon: <Lightbulb className="size-4" />,
      onSelect: () => setUtilityEditor({ open: true, entry: null })
    },
    ...(effectiveIsAdmin
      ? [
          {
            id: 'payment',
            label: copy.paymentsAddAction,
            icon: <HandCoins className="size-4" />,
            onSelect: () => setPaymentEditor({ open: true, entry: null, prefill: null })
          }
        ]
      : [])
  ]

  return (
    <>
      <BalancesSection onCustomPayment={openCustomPayment} />
      <UtilityPlanSection />

      {effectiveIsAdmin ? (
        <Card>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                {copy.shareRent}
                <Badge tone={cycleState?.rentRule ? 'primary' : 'neutral'}>
                  {cycleState?.rentRule
                    ? copy.currentCycleOverrideRent
                    : copy.currentCycleUsesDefaultRent}
                </Badge>
              </p>
              <p className="mt-0.5 font-mono text-xs text-faint">
                {formatMoneyLabel(dashboard.rentDisplayAmountMajor, dashboard.currency, locale)}
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => setRentOpen(true)}>
              <Settings2 className="size-3.5" aria-hidden />
              {copy.manageCycleAction}
            </Button>
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title={copy.ledgerEntries}
          {...(filter === 'purchases'
            ? {
                hint: `${copy.todayPurchaseVolumeLabel}: ${formatMoneyLabel(purchaseTotalMajor, dashboard.currency, locale)}`
              }
            : {})}
          action={
            <Button
              variant="soft"
              size="icon"
              aria-label={locale === 'ru' ? 'Добавить запись' : 'Add entry'}
              onClick={() => setChooserOpen(true)}
            >
              <Plus className="size-4" />
            </Button>
          }
        />

        <div className="flex gap-2 overflow-x-auto pb-1">
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
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
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

        <div className="mt-1">
          <LedgerList
            entries={entries}
            emptyText={emptyText}
            canEdit={() => effectiveIsAdmin}
            onSelect={handleSelectEntry}
          />
        </div>
      </Card>

      <Sheet
        open={chooserOpen}
        onOpenChange={setChooserOpen}
        title={locale === 'ru' ? 'Добавить запись' : 'Add entry'}
      >
        <div className="space-y-2">
          {chooserItems.map((item) => (
            <Button
              key={item.id}
              variant="secondary"
              className="w-full justify-start"
              onClick={() => {
                setChooserOpen(false)
                item.onSelect()
              }}
            >
              {item.icon}
              {item.label}
            </Button>
          ))}
        </div>
      </Sheet>

      <PurchaseEditor
        open={purchaseEditor.open}
        entry={purchaseEditor.entry}
        onOpenChange={(open) => setPurchaseEditor((current) => ({ ...current, open }))}
      />
      <UtilityEditor
        open={utilityEditor.open}
        entry={utilityEditor.entry}
        onOpenChange={(open) => setUtilityEditor((current) => ({ ...current, open }))}
      />
      <PaymentEditor
        open={paymentEditor.open}
        entry={paymentEditor.entry}
        prefill={paymentEditor.prefill}
        onOpenChange={(open) => setPaymentEditor((current) => ({ ...current, open }))}
      />
      <RentEditor open={rentOpen} onOpenChange={setRentOpen} />
    </>
  )
}
