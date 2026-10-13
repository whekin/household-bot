import { CircleDollarSign, RefreshCw } from 'lucide-react'

import { useDashboard } from '@/app/dashboard-context'
import { Card, CardHeader } from '@/components/ui/card'
import { useI18n } from '@/i18n/context'
import { formatMoneyLabel } from '@/lib/ledger-helpers'
import type { TodayViewModel } from './today-view-model'

/** Admin ribbon that opens the close-whole-period confirmation. */
export function AdminClosePanel({
  model,
  loading,
  onOpenAdminClose,
  onOpenRefreshPlan
}: {
  model: TodayViewModel
  loading: boolean
  onOpenAdminClose: () => void
  onOpenRefreshPlan: () => void
}) {
  const { copy, locale } = useI18n()
  const { dashboard } = useDashboard()
  if (!dashboard) return null

  return (
    <Card>
      <p className="text-[11px] font-medium uppercase tracking-wide text-faint">{copy.adminTag}</p>
      <CardHeader
        className="mb-3 mt-0.5"
        title={copy.todayAdminToolsTitle}
        hint={model.stage === 'idle' ? copy.todayRefreshPlanBody : copy.todayAdminToolsBody}
      />

      {model.stage !== 'idle' ? (
        <button
          type="button"
          disabled={loading}
          onClick={onOpenAdminClose}
          className="flex w-full items-center justify-between gap-3 rounded-xl bg-elevated px-3 py-3 transition-colors active:bg-field-hover disabled:opacity-50"
        >
          <span className="flex items-center gap-2 text-sm font-medium text-primary">
            <CircleDollarSign className="size-4" />
            {copy.todayAdminCloseAll}
          </span>
          <span className="font-mono text-sm font-semibold text-foreground">
            {formatMoneyLabel(model.remainingMajor, dashboard.currency, locale)}
          </span>
        </button>
      ) : null}

      <button
        type="button"
        disabled={loading}
        onClick={onOpenRefreshPlan}
        className="flex w-full items-center justify-between gap-3 rounded-xl bg-elevated px-3 py-3 transition-colors active:bg-field-hover disabled:opacity-50"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-primary">
          <RefreshCw className="size-4" />
          {copy.todayAdminRefreshPlan}
        </span>
      </button>
    </Card>
  )
}
