import { Settings2 } from 'lucide-react'
import { useMemo, useState } from 'react'

import { closeMiniAppPaymentPeriod } from '@/api'
import { useDashboard } from '@/app/dashboard-context'
import { useReadySession, useSession } from '@/app/session-context'
import { useToast } from '@/components/toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { BalancesSection } from '@/features/activity/balances-section'
import { PaymentEditor } from '@/features/activity/payment-editor'
import { RentEditor } from '@/features/activity/rent-editor'
import type { PaymentPrefill } from '@/features/activity/types'
import { UtilityPlanSection } from '@/features/activity/utility-plan-section'
import {
  AdminCloseConfirmSheet,
  MemberCloseConfirmSheet,
  MemberCloseList
} from '@/features/home/member-close-list'
import { RefreshPlanSheet } from '@/features/home/refresh-plan-sheet'
import { AdminClosePanel } from '@/features/home/stage-panels'
import {
  buildTodayViewModel,
  type TodayMemberCloseLine,
  type TodayPaymentKind
} from '@/features/home/today-view-model'
import { useI18n } from '@/i18n/context'
import { formatMoneyLabel } from '@/lib/ledger-helpers'

/**
 * The house's month: who still owes what, the utility plan, and rent. Admin tools
 * for closing payments and redrawing the split live here, not on Home.
 */
export function MonthView() {
  const session = useReadySession()
  const { initData, handleMiniAppRequestError } = useSession()
  const {
    dashboard,
    loading,
    adminLoading,
    cycleState,
    effectiveIsAdmin,
    effectiveBillingStage,
    effectivePeriod,
    effectiveTodayOverride,
    refresh,
    applyDashboard
  } = useDashboard()
  const { copy, locale } = useI18n()
  const { showToast } = useToast()

  const [adminConfirmOpen, setAdminConfirmOpen] = useState(false)
  const [refreshPlanOpen, setRefreshPlanOpen] = useState(false)
  const [pendingCloseLine, setPendingCloseLine] = useState<TodayMemberCloseLine | null>(null)
  const [processing, setProcessing] = useState(false)
  const [rentOpen, setRentOpen] = useState(false)
  const [payment, setPayment] = useState<{ open: boolean; prefill: PaymentPrefill | null }>({
    open: false,
    prefill: null
  })

  const model = useMemo(
    () =>
      dashboard
        ? buildTodayViewModel({
            dashboard,
            currentMemberId: session.member.id,
            effectivePeriod,
            effectiveStage: effectiveBillingStage,
            todayOverride: effectiveTodayOverride
          })
        : null,
    [dashboard, session.member.id, effectivePeriod, effectiveBillingStage, effectiveTodayOverride]
  )

  async function closeMembers(input: {
    kind: TodayPaymentKind
    period: string
    memberIds?: readonly string[]
    allMembers?: boolean
    successMessage: string
  }) {
    if (!initData || processing) return
    setProcessing(true)
    try {
      const result = await closeMiniAppPaymentPeriod(initData, {
        period: input.period,
        kind: input.kind,
        ...(input.memberIds ? { memberIds: input.memberIds } : {}),
        ...(input.allMembers ? { allMembers: true } : {})
      })
      if (!applyDashboard(result.dashboard)) await refresh()
      setAdminConfirmOpen(false)
      showToast(input.successMessage, 'success')
    } catch (error) {
      if (handleMiniAppRequestError(error)) return
      showToast(error instanceof Error ? error.message : copy.todayCloseFailed, 'error')
    } finally {
      setProcessing(false)
    }
  }

  if (loading || adminLoading || !dashboard || !model) {
    return (
      <div className="space-y-3" role="status">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <BalancesSection onCustomPayment={(prefill) => setPayment({ open: true, prefill })} />

      <MemberCloseList
        model={model}
        isAdmin={effectiveIsAdmin}
        currentMemberId={session.member.id}
        onSelectMember={(line) => setPendingCloseLine(line)}
      />

      <UtilityPlanSection />

      {effectiveIsAdmin ? (
        <>
          <Card>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-[15px] font-semibold">
                  {copy.shareRent}
                  <Badge tone={cycleState?.rentRule ? 'rent' : 'neutral'}>
                    {cycleState?.rentRule
                      ? copy.currentCycleOverrideRent
                      : copy.currentCycleUsesDefaultRent}
                  </Badge>
                </p>
                <p className="mt-0.5 text-[13px] tabular-nums text-faint">
                  {formatMoneyLabel(dashboard.rentDisplayAmountMajor, dashboard.currency, locale)}
                </p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => setRentOpen(true)}>
                <Settings2 className="size-3.5" aria-hidden />
                {copy.manageCycleAction}
              </Button>
            </div>
          </Card>

          <AdminClosePanel
            model={model}
            loading={processing}
            onOpenAdminClose={() => setAdminConfirmOpen(true)}
            onOpenRefreshPlan={() => setRefreshPlanOpen(true)}
          />
        </>
      ) : null}

      <MemberCloseConfirmSheet
        line={pendingCloseLine}
        loading={processing}
        onOpenChange={(open) => {
          if (!open) setPendingCloseLine(null)
        }}
        onConfirm={() => {
          const line = pendingCloseLine
          setPendingCloseLine(null)
          if (!line || model.stage === 'idle' || line.settled) return
          if (!effectiveIsAdmin && line.memberId !== session.member.id) return
          void closeMembers({
            kind: model.stage,
            period: model.period,
            memberIds: [line.memberId],
            successMessage: copy.todayCloseSuccess
          })
        }}
      />
      <AdminCloseConfirmSheet
        open={adminConfirmOpen}
        onOpenChange={setAdminConfirmOpen}
        model={model}
        loading={processing}
        onConfirm={() => {
          if (model.stage === 'idle') return
          void closeMembers({
            kind: model.stage,
            period: model.period,
            allMembers: true,
            successMessage: copy.todayAdminCloseSuccess
          })
        }}
      />
      <RefreshPlanSheet
        open={refreshPlanOpen}
        period={model.period}
        currency={dashboard.currency}
        onOpenChange={setRefreshPlanOpen}
        onApplied={() => void refresh()}
      />
      <RentEditor open={rentOpen} onOpenChange={setRentOpen} />
      <PaymentEditor
        open={payment.open}
        entry={null}
        prefill={payment.prefill}
        onOpenChange={(open) => setPayment((current) => ({ ...current, open }))}
      />
    </div>
  )
}
