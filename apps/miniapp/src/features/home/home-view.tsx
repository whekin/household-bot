import { useMemo, useState } from 'react'

import { closeMiniAppPaymentPeriod } from '@/api'
import { useDashboard } from '@/app/dashboard-context'
import { useReadySession, useSession } from '@/app/session-context'
import { useToast } from '@/components/toast'
import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/i18n/context'
import { majorStringToMinor } from '@/lib/money'
import {
  buildTodayViewModel,
  type TodayMemberCloseLine,
  type TodayPaymentKind
} from './today-view-model'
import { StageBanner } from './stage-banner'
import {
  AdminClosePanel,
  HouseholdSummaryPanel,
  IdleHouseholdPanel,
  RentDetailsPanel,
  UtilitiesBillsPanel
} from './stage-panels'
import { MemberCloseList, AdminCloseConfirmSheet } from './member-close-list'
import { PurchaseStream } from './purchase-stream'
import { QUICK_PURCHASE_COMPOSER_ID, QuickPurchaseComposer } from './quick-purchase-composer'

export function HomeView() {
  const session = useReadySession()
  const { initData, handleMiniAppRequestError } = useSession()
  const {
    dashboard,
    loading,
    effectiveIsAdmin,
    effectiveBillingStage,
    effectivePeriod,
    effectiveTodayOverride,
    refresh
  } = useDashboard()
  const { copy } = useI18n()
  const { showToast } = useToast()

  const [adminConfirmOpen, setAdminConfirmOpen] = useState(false)
  const [processing, setProcessing] = useState(false)

  const currentMemberId = session.member.id
  const model = useMemo(() => {
    if (!dashboard) return null

    return buildTodayViewModel({
      dashboard,
      currentMemberId,
      effectivePeriod,
      effectiveStage: effectiveBillingStage,
      todayOverride: effectiveTodayOverride
    })
  }, [dashboard, currentMemberId, effectivePeriod, effectiveBillingStage, effectiveTodayOverride])

  const currentMemberCloseLine =
    model?.memberLines.find((line) => line.memberId === currentMemberId) ?? null

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
      await closeMiniAppPaymentPeriod(initData, {
        period: input.period,
        kind: input.kind,
        ...(input.memberIds ? { memberIds: input.memberIds } : {}),
        ...(input.allMembers ? { allMembers: true } : {})
      })
      await refresh()
      setAdminConfirmOpen(false)
      showToast(input.successMessage, 'success')
    } catch (error) {
      if (handleMiniAppRequestError(error)) return
      showToast(error instanceof Error ? error.message : copy.todayCloseFailed, 'error')
    } finally {
      setProcessing(false)
    }
  }

  async function closeCurrentMember() {
    if (
      !model ||
      model.stage === 'idle' ||
      !currentMemberCloseLine ||
      majorStringToMinor(currentMemberCloseLine.amountMajor) <= 0n
    ) {
      return
    }

    await closeMembers({
      kind: model.stage,
      period: model.period,
      memberIds: [currentMemberCloseLine.memberId],
      successMessage: copy.todayCloseSuccess
    })
  }

  async function closeSelectedMember(line: TodayMemberCloseLine) {
    if (!model || model.stage === 'idle' || line.settled) return
    if (!effectiveIsAdmin && line.memberId !== currentMemberId) return

    await closeMembers({
      kind: model.stage,
      period: model.period,
      memberIds: [line.memberId],
      successMessage: copy.todayCloseSuccess
    })
  }

  async function closeAllMembers() {
    if (!model || model.stage === 'idle') return

    await closeMembers({
      kind: model.stage,
      period: model.period,
      allMembers: true,
      successMessage: copy.todayAdminCloseSuccess
    })
  }

  function scrollToComposer() {
    document
      .getElementById(QUICK_PURCHASE_COMPOSER_ID)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  if (loading || !dashboard || !model) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <StageBanner
        model={model}
        currentMemberLine={currentMemberCloseLine}
        closing={processing}
        onCloseMine={() => void closeCurrentMember()}
      />

      {effectiveIsAdmin ? <QuickPurchaseComposer currentMemberId={currentMemberId} /> : null}

      {model.stage === 'utilities' ? <UtilitiesBillsPanel /> : null}
      {model.stage === 'rent' ? <RentDetailsPanel model={model} /> : null}
      {model.stage === 'idle' ? <IdleHouseholdPanel /> : null}

      {model.stage !== 'idle' ? <HouseholdSummaryPanel model={model} /> : null}

      {effectiveIsAdmin && model.stage !== 'idle' ? (
        <AdminClosePanel
          model={model}
          loading={processing}
          onOpenAdminClose={() => setAdminConfirmOpen(true)}
        />
      ) : null}

      <MemberCloseList
        model={model}
        isAdmin={effectiveIsAdmin}
        currentMemberId={currentMemberId}
        onSelectMember={(line) => void closeSelectedMember(line)}
      />

      <PurchaseStream
        model={model}
        currentMemberId={currentMemberId}
        canAddPurchase={effectiveIsAdmin}
        onAddPurchase={scrollToComposer}
      />

      <AdminCloseConfirmSheet
        open={adminConfirmOpen}
        onOpenChange={setAdminConfirmOpen}
        model={model}
        loading={processing}
        onConfirm={() => void closeAllMembers()}
      />
    </div>
  )
}
