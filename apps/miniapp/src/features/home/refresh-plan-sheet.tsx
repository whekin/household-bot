import { useEffect, useState } from 'react'

import { refreshMiniAppUtilityPlan, type MiniAppUtilityPlanShape } from '@/api/billing'
import { useSession } from '@/app/session-context'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/dialog'
import { useI18n } from '@/i18n/context'
import { formatMoneyLabel } from '@/lib/ledger-helpers'

function planKey(plan: MiniAppUtilityPlanShape | null): string {
  return (plan?.categories ?? [])
    .map((category) => `${category.billName}:${category.assignedMemberId}:${category.amountMajor}`)
    .join('|')
}

function PlanColumn({
  title,
  plan,
  currency
}: {
  title: string
  plan: MiniAppUtilityPlanShape | null
  currency: 'USD' | 'GEL'
}) {
  const { copy, locale } = useI18n()

  return (
    <div className="rounded-xl bg-elevated px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-faint">{title}</p>
      <div className="mt-1 divide-y divide-border/60">
        {(plan?.categories ?? []).map((category) => (
          <div
            key={`${category.billName}:${category.assignedMemberId}`}
            className="flex items-center justify-between gap-3 py-1"
          >
            <span className="min-w-0 text-xs text-muted-foreground">
              <span className="block truncate text-foreground">{category.billName}</span>
              <span className="block truncate">
                {category.displayName}
                {category.isPaid ? ` · ${copy.todayRefreshPlanPaid}` : ''}
              </span>
            </span>
            <span className="shrink-0 font-mono text-xs font-semibold text-foreground">
              {formatMoneyLabel(category.amountMajor, currency, locale)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Shows what a redraw would do before it does it. A published split is something
 * members have already been told, so the diff is the point: applying is only
 * worth pressing once you can see who stops paying what.
 */
export function RefreshPlanSheet({
  open,
  period,
  currency,
  onOpenChange,
  onApplied
}: {
  open: boolean
  period: string
  currency: 'USD' | 'GEL'
  onOpenChange: (open: boolean) => void
  onApplied: () => void
}) {
  const { copy } = useI18n()
  const { initData, handleMiniAppRequestError } = useSession()
  const [preview, setPreview] = useState<{
    current: MiniAppUtilityPlanShape | null
    proposed: MiniAppUtilityPlanShape | null
  } | null>(null)
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    if (!open || !initData) {
      setPreview(null)
      return
    }

    let cancelled = false
    refreshMiniAppUtilityPlan(initData, { period })
      .then((result) => {
        if (!cancelled) setPreview({ current: result.current, proposed: result.proposed })
      })
      .catch(handleMiniAppRequestError)

    return () => {
      cancelled = true
    }
  }, [open, initData, period, handleMiniAppRequestError])

  const unchanged = planKey(preview?.current ?? null) === planKey(preview?.proposed ?? null)

  async function apply() {
    if (!initData || applying) return
    setApplying(true)
    try {
      await refreshMiniAppUtilityPlan(initData, { period, apply: true })
      onApplied()
      onOpenChange(false)
    } catch (error) {
      handleMiniAppRequestError(error)
    } finally {
      setApplying(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={copy.todayRefreshPlanTitle}>
      <p className="text-xs text-muted-foreground">{copy.todayRefreshPlanBody}</p>

      {preview ? (
        <div className="mt-3 space-y-2">
          <PlanColumn
            title={copy.todayRefreshPlanCurrent}
            plan={preview.current}
            currency={currency}
          />
          {unchanged ? (
            <p className="text-xs text-faint">{copy.todayRefreshPlanNoChange}</p>
          ) : (
            <>
              <PlanColumn
                title={copy.todayRefreshPlanProposed}
                plan={preview.proposed}
                currency={currency}
              />
              <p className="text-xs text-status-due">{copy.todayRefreshPlanWarning}</p>
              <Button
                variant="primary"
                size="lg"
                className="w-full"
                loading={applying}
                onClick={apply}
              >
                {copy.todayRefreshPlanApply}
              </Button>
            </>
          )}
        </div>
      ) : null}
    </Sheet>
  )
}
