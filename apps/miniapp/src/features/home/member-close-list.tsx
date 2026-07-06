import { CheckCircle2, Sparkles, X } from 'lucide-react'
import { useMemo } from 'react'

import { useDashboard } from '@/app/dashboard-context'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { Sheet } from '@/components/ui/dialog'
import { useI18n } from '@/i18n/context'
import { formatMoneyLabel } from '@/lib/ledger-helpers'
import { majorStringToMinor, minorToMajorString } from '@/lib/money'
import { cn } from '@/lib/cn'
import { initialsForName, type TodayMemberCloseLine, type TodayViewModel } from './today-view-model'

/**
 * Who is still open this stage — tap a line to close your own check (admins
 * can close anyone). Ported from the legacy MemberCloseList.
 */
export function MemberCloseList({
  model,
  isAdmin,
  currentMemberId,
  onSelectMember
}: {
  model: TodayViewModel
  isAdmin: boolean
  currentMemberId: string | null
  onSelectMember: (line: TodayMemberCloseLine) => void
}) {
  const { copy, locale } = useI18n()
  const { dashboard } = useDashboard()

  const orderedLines = useMemo(
    () =>
      [...model.memberLines].sort((left, right) => {
        if (left.isCurrent !== right.isCurrent) return left.isCurrent ? -1 : 1
        if (left.settled !== right.settled) return left.settled ? 1 : -1
        return left.displayName.localeCompare(right.displayName)
      }),
    [model.memberLines]
  )

  if (!dashboard) return null

  return (
    <Card>
      <p className="text-[11px] font-medium uppercase tracking-wide text-faint">
        {copy.todayCurrentPeriod}
      </p>
      <CardHeader
        className="mb-3 mt-0.5"
        title={copy.todayOpenChecksTitle}
        hint={copy.todayOpenChecksBody}
        action={
          <div className="text-right">
            <p className="text-[11px] text-faint">{copy.todayOpenChecks}</p>
            <p className="font-mono text-lg font-semibold text-foreground">
              {model.openMemberCount}
            </p>
          </div>
        }
      />

      {model.stage === 'idle' ? (
        <div className="flex items-center gap-3 rounded-xl bg-elevated p-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
            <Sparkles className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{copy.todayIdleStage}</p>
            <p className="text-xs text-muted-foreground">{copy.todayQuietPanel}</p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {orderedLines.map((line) => {
            const canClose = isAdmin || line.memberId === currentMemberId
            return (
              <button
                key={line.memberId}
                type="button"
                disabled={!canClose || line.settled}
                onClick={() => onSelectMember(line)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl bg-elevated px-3 py-2.5 text-left transition-colors active:bg-field-hover disabled:pointer-events-none',
                  line.settled && 'opacity-60',
                  line.isCurrent && 'ring-1 ring-inset ring-primary/40'
                )}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
                  {initialsForName(line.displayName)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold text-foreground">
                      {line.displayName}
                    </span>
                    {line.isCurrent ? (
                      <span className="shrink-0 text-[11px] text-primary">
                        {copy.todayYouLabel}
                      </span>
                    ) : null}
                  </span>
                  <span className="block text-xs text-faint">
                    {line.settled
                      ? copy.todayDone
                      : canClose
                        ? copy.todayTapToClose
                        : copy.todayWaitingForMember}
                  </span>
                </span>
                <span
                  className={cn(
                    'shrink-0 font-mono text-sm font-semibold',
                    line.settled ? 'text-status-credit' : 'text-foreground'
                  )}
                >
                  {line.settled
                    ? copy.todayDone
                    : formatMoneyLabel(line.amountMajor, dashboard.currency, locale)}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </Card>
  )
}

/**
 * Confirmation step for closing the whole period — summary of every member
 * still open plus the combined amount. Ported from AdminCloseConfirmDialog.
 */
export function AdminCloseConfirmSheet({
  open,
  onOpenChange,
  model,
  loading,
  onConfirm
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  model: TodayViewModel
  loading: boolean
  onConfirm: () => void
}) {
  const { copy, locale } = useI18n()
  const { dashboard } = useDashboard()

  const candidates = model.memberLines.filter((line) => !line.settled)
  const totalAmountMajor = minorToMajorString(
    candidates.reduce((sum, line) => sum + majorStringToMinor(line.amountMajor), 0n)
  )
  const currency = dashboard?.currency ?? 'GEL'

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={copy.todayAdminConfirmTitle}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            <X className="size-4" aria-hidden />
            {copy.closeEditorAction}
          </Button>
          <Button
            variant="primary"
            loading={loading}
            disabled={candidates.length === 0}
            onClick={onConfirm}
          >
            <CheckCircle2 className="size-4" aria-hidden />
            {copy.todayAdminConfirmAction}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">{copy.todayAdminConfirmBody}</p>

        <div className="flex items-center justify-between gap-3 rounded-xl bg-elevated px-3 py-2.5">
          <span className="text-xs text-muted-foreground">{copy.todayAdminCloseAll}</span>
          <span className="font-mono text-sm font-semibold text-foreground">
            {`${candidates.length} · ${formatMoneyLabel(totalAmountMajor, currency, locale)}`}
          </span>
        </div>

        <div className="divide-y divide-border/60">
          {candidates.map((line) => (
            <div key={line.memberId} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 truncate text-sm text-foreground">{line.displayName}</span>
              <span className="font-mono text-sm font-semibold text-foreground">
                {formatMoneyLabel(line.amountMajor, currency, locale)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Sheet>
  )
}
