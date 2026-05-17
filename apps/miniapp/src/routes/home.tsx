import { Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup } from 'solid-js'
import { useNavigate } from '@solidjs/router'

import { useSession } from '../contexts/session-context'
import { useI18n } from '../contexts/i18n-context'
import { useDashboard } from '../contexts/dashboard-context'
import { Modal } from '../components/ui/dialog'
import { Skeleton } from '../components/ui/skeleton'
import { Toast } from '../components/ui/toast'
import { QuickPurchaseComposer } from '../components/quick-purchase-composer'
import { memberEffectivePurchaseBalanceMajor, type PurchaseDraft } from '../lib/ledger-helpers'
import { buildEmptyPurchaseDraft, buildPurchaseSplitPayload } from '../lib/purchase-draft'
import { majorStringToMinor } from '../lib/money'
import {
  addMiniAppPurchase,
  closeMiniAppPaymentPeriod,
  type MiniAppDashboard
} from '../miniapp-api'
import {
  AdminCloseConfirmDialog,
  AdminClosePanel,
  CurrentPeriodPanel,
  HouseholdSummaryPanel,
  MemberCloseList,
  PurchaseStream
} from '../features/today/today-sections'
import {
  buildTodayViewModel,
  type TodayMemberCloseLine,
  type TodayPaymentKind
} from '../features/today/today-view-model'

type Currency = MiniAppDashboard['currency']

export default function HomeRoute() {
  const navigate = useNavigate()
  const { readySession, initData, handleMiniAppRequestError } = useSession()
  const {
    dashboard,
    loading,
    setDashboard,
    effectiveIsAdmin,
    effectiveBillingStage,
    effectivePeriod,
    effectiveTodayOverride,
    testingOverridesActive
  } = useDashboard()
  const { copy, locale } = useI18n()

  const [purchaseOpen, setPurchaseOpen] = createSignal(false)
  const [purchaseDraft, setPurchaseDraft] = createSignal<PurchaseDraft>(
    buildEmptyPurchaseDraft(dashboard(), readySession()?.member.id)
  )
  const [addingPurchase, setAddingPurchase] = createSignal(false)
  const [purchaseError, setPurchaseError] = createSignal<string | null>(null)
  const [adminConfirmOpen, setAdminConfirmOpen] = createSignal(false)
  const [processingKey, setProcessingKey] = createSignal<string | null>(null)
  const [copiedRentPaymentKey, setCopiedRentPaymentKey] = createSignal<string | null>(null)
  const [toast, setToast] = createSignal({
    visible: false,
    message: '',
    type: 'info' as 'success' | 'info' | 'error'
  })
  let copiedRentPaymentTimer: ReturnType<typeof setTimeout> | undefined

  const currentMemberId = createMemo(() => readySession()?.member.id ?? null)
  const model = createMemo(() => {
    const data = dashboard()
    if (!data) return null

    return buildTodayViewModel({
      dashboard: data,
      currentMemberId: currentMemberId(),
      effectivePeriod: effectivePeriod(),
      effectiveStage: effectiveBillingStage(),
      todayOverride: effectiveTodayOverride()
    })
  })
  const activeMembers = createMemo(() =>
    (dashboard()?.members ?? [])
      .filter((member) => member.status !== 'left')
      .map((member) => ({
        memberId: member.memberId,
        displayName: member.displayName,
        remainingMajor: member.remainingMajor,
        purchaseBalanceMajor: memberEffectivePurchaseBalanceMajor(member)
      }))
  )
  const currentMemberCloseLine = createMemo(
    () => model()?.memberLines.find((line) => line.memberId === currentMemberId()) ?? null
  )

  createEffect(() => {
    dashboard()
    setPurchaseDraft(buildEmptyPurchaseDraft(dashboard(), currentMemberId() ?? undefined))
  })

  onCleanup(() => {
    if (copiedRentPaymentTimer) clearTimeout(copiedRentPaymentTimer)
  })

  function resetPurchase() {
    setPurchaseError(null)
    setPurchaseDraft(buildEmptyPurchaseDraft(dashboard(), currentMemberId() ?? undefined))
  }

  function openPurchase() {
    resetPurchase()
    setPurchaseOpen(true)
  }

  function closePurchase() {
    setPurchaseOpen(false)
    resetPurchase()
  }

  async function handlePurchaseSubmit() {
    const init = initData()
    const draft = purchaseDraft()
    if (!init || !draft.description.trim() || !draft.amountMajor.trim()) return

    setAddingPurchase(true)
    setPurchaseError(null)
    try {
      const refreshed = await addMiniAppPurchase(init, {
        description: draft.description.trim(),
        amountMajor: draft.amountMajor.trim(),
        currency: draft.currency,
        ...(draft.occurredOn ? { occurredOn: draft.occurredOn } : {}),
        ...(draft.payerMemberId ? { payerMemberId: draft.payerMemberId } : {}),
        split: buildPurchaseSplitPayload(draft)
      })
      setDashboard(refreshed)
      closePurchase()
      setToast({ visible: true, message: copy().quickPurchaseSuccess, type: 'success' })
    } catch (error) {
      if (handleMiniAppRequestError(error)) return
      setPurchaseError(error instanceof Error ? error.message : copy().purchaseMutationFailed)
    } finally {
      setAddingPurchase(false)
    }
  }

  async function closeMembers(input: {
    kind: TodayPaymentKind
    period: string
    memberIds?: readonly string[]
    allMembers?: boolean
    successMessage: string
  }) {
    const init = initData()
    if (!init) return

    const key = input.allMembers
      ? `${input.kind}:all`
      : `${input.kind}:${input.memberIds?.join(',')}`
    setProcessingKey(key)
    try {
      const result = await closeMiniAppPaymentPeriod(init, {
        period: input.period,
        kind: input.kind,
        ...(input.memberIds ? { memberIds: input.memberIds } : {}),
        ...(input.allMembers ? { allMembers: true } : {})
      })
      setDashboard(result.dashboard)
      setAdminConfirmOpen(false)
      setToast({ visible: true, message: input.successMessage, type: 'success' })
    } catch (error) {
      if (handleMiniAppRequestError(error)) return
      setToast({
        visible: true,
        message: error instanceof Error ? error.message : copy().todayCloseFailed,
        type: 'error'
      })
    } finally {
      setProcessingKey(null)
    }
  }

  async function closeCurrentMember() {
    const current = model()
    const member = currentMemberCloseLine()
    if (
      !current ||
      current.stage === 'idle' ||
      !member ||
      majorStringToMinor(member.amountMajor) <= 0n
    ) {
      return
    }

    await closeMembers({
      kind: current.stage,
      period: current.period,
      memberIds: [member.memberId],
      successMessage: copy().todayCloseSuccess
    })
  }

  async function closeSelectedMember(line: TodayMemberCloseLine) {
    const current = model()
    if (!current || current.stage === 'idle' || line.settled) return
    if (!effectiveIsAdmin() && line.memberId !== currentMemberId()) return

    await closeMembers({
      kind: current.stage,
      period: current.period,
      memberIds: [line.memberId],
      successMessage: copy().todayCloseSuccess
    })
  }

  async function closeAllMembers() {
    const current = model()
    if (!current || current.stage === 'idle') return

    await closeMembers({
      kind: current.stage,
      period: current.period,
      allMembers: true,
      successMessage: copy().todayAdminCloseSuccess
    })
  }

  async function copyRentPaymentText(input: { key: string; text: string; successMessage: string }) {
    try {
      const writeText = globalThis.navigator?.clipboard?.writeText
      if (!writeText) throw new Error('Clipboard unavailable')

      await writeText.call(globalThis.navigator.clipboard, input.text)
      setCopiedRentPaymentKey(input.key)
      setToast({ visible: true, message: input.successMessage, type: 'success' })

      if (copiedRentPaymentTimer) clearTimeout(copiedRentPaymentTimer)
      copiedRentPaymentTimer = setTimeout(() => setCopiedRentPaymentKey(null), 1600)
    } catch {
      setToast({ visible: true, message: copy().rentPaymentCopyFailed, type: 'error' })
    }
  }

  return (
    <div class="route route--home today-route">
      <Switch>
        <Match when={loading()}>
          <section class="today-command is-loading">
            <Skeleton style={{ width: '44%', height: '18px' }} />
            <Skeleton style={{ width: '72%', height: '76px' }} />
            <Skeleton style={{ width: '100%', height: '150px' }} />
          </section>
        </Match>

        <Match when={dashboard() && model()}>
          <>
            <Show when={testingOverridesActive()}>
              <p class="today-test-note">{copy().testingViewBadge}</p>
            </Show>

            <CurrentPeriodPanel
              model={model()!}
              currentMemberLine={currentMemberCloseLine()}
              currency={dashboard()!.currency}
              locale={locale()}
              copy={copy}
              canCloseMine={
                majorStringToMinor(currentMemberCloseLine()?.amountMajor ?? '0.00') > 0n
              }
              closing={processingKey() !== null}
              copiedRentPaymentKey={copiedRentPaymentKey()}
              onCloseMine={() => void closeCurrentMember()}
              onOpenPurchases={() => navigate('/purchases')}
              onCopyRentPaymentText={(input) => void copyRentPaymentText(input)}
            />

            <Show when={model()!.stage !== 'idle'}>
              <HouseholdSummaryPanel
                model={model()!}
                currency={dashboard()!.currency}
                locale={locale()}
                copy={copy}
              />
            </Show>

            <Show when={effectiveIsAdmin() && model()!.stage !== 'idle'}>
              <AdminClosePanel
                model={model()!}
                currency={dashboard()!.currency}
                locale={locale()}
                copy={copy}
                loading={processingKey() !== null}
                onOpenAdminClose={() => setAdminConfirmOpen(true)}
              />
            </Show>

            <PurchaseStream
              entries={model()!.purchaseEntries}
              members={dashboard()!.members}
              currentMemberId={currentMemberId()}
              currency={dashboard()!.currency}
              balanceMajor={model()!.purchaseBalanceMajor}
              totalMajor={model()!.purchaseTotalMajor}
              unresolvedCount={model()!.unresolvedPurchaseCount}
              locale={locale()}
              copy={copy}
              onAddPurchase={openPurchase}
            />

            <MemberCloseList
              model={model()!}
              currency={dashboard()!.currency}
              locale={locale()}
              copy={copy}
              isAdmin={effectiveIsAdmin()}
              currentMemberId={currentMemberId()}
              onSelectMember={(line) => void closeSelectedMember(line)}
            />
          </>
        </Match>
      </Switch>

      <Modal
        open={purchaseOpen()}
        title={copy().quickPurchaseSheetTitle}
        description={copy().todayPurchaseSheetBody}
        closeLabel={copy().closeEditorAction}
        onClose={closePurchase}
      >
        <QuickPurchaseComposer
          draft={purchaseDraft}
          setDraft={(updater) => setPurchaseDraft((draft) => updater(draft))}
          activeMembers={activeMembers}
          currentMemberId={currentMemberId}
          currency={() => dashboard()?.currency ?? ('GEL' as Currency)}
          copy={copy}
          locale={locale}
          error={purchaseError}
          submitting={addingPurchase}
          submitLabel={() => copy().purchaseSaveAction}
          onSubmit={() => void handlePurchaseSubmit()}
          onCancel={closePurchase}
          cancelLabel={copy().closeEditorAction}
          resetKey={() => `${purchaseOpen()}:${dashboard()?.ledger.length ?? 0}`}
          datePickerPortal
        />
      </Modal>

      <Show when={model() && dashboard()}>
        <AdminCloseConfirmDialog
          open={adminConfirmOpen()}
          model={model()!}
          currency={dashboard()!.currency}
          locale={locale()}
          copy={copy}
          loading={processingKey() !== null}
          onClose={() => setAdminConfirmOpen(false)}
          onConfirm={() => void closeAllMembers()}
        />
      </Show>

      <Toast state={toast()} onClose={() => setToast((state) => ({ ...state, visible: false }))} />
    </div>
  )
}
