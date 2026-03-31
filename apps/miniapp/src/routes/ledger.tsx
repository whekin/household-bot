import { Show, For, Index, createSignal, createMemo, Switch, Match } from 'solid-js'
import { produce } from 'solid-js/store'
import { Plus } from 'lucide-solid'

import { useSession } from '../contexts/session-context'
import { useI18n } from '../contexts/i18n-context'
import { useDashboard } from '../contexts/dashboard-context'
import { Card } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Modal } from '../components/ui/dialog'
import { Input } from '../components/ui/input'
import { Select } from '../components/ui/select'
import { Field } from '../components/ui/field'
import { Collapsible } from '../components/ui/collapsible'
import { Toggle } from '../components/ui/toggle'
import { Skeleton } from '../components/ui/skeleton'
import {
  formatMoneyLabel,
  ledgerSecondaryAmount,
  purchaseDraftForEntry,
  paymentDraftForEntry,
  computePaymentPrefill,
  localizedCurrencyLabel,
  rebalancePurchaseSplit,
  validatePurchaseDraft,
  type PurchaseDraft,
  type PaymentDraft
} from '../lib/ledger-helpers'
import { minorToMajorString, majorStringToMinor } from '../lib/money'
import { formatCyclePeriod, formatFriendlyDate } from '../lib/dates'
import {
  addMiniAppPurchase,
  updateMiniAppPurchase,
  deleteMiniAppPurchase,
  addMiniAppPayment,
  updateMiniAppPayment,
  deleteMiniAppPayment,
  type MiniAppDashboard
} from '../miniapp-api'

function joinSubtitleParts(parts: readonly (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(' · ')
}

interface ParticipantSplitInputsProps {
  draft: PurchaseDraft
  updateDraft: (fn: (d: PurchaseDraft) => PurchaseDraft) => void
}

function ParticipantSplitInputs(props: ParticipantSplitInputsProps) {
  const { dashboard } = useDashboard()

  const validation = () => validatePurchaseDraft(props.draft)

  return (
    <div
      class="split-configuration"
      style={{ display: 'flex', 'flex-direction': 'column', gap: '8px', 'margin-top': '8px' }}
    >
      <Index each={props.draft.participants}>
        {(participant, idx) => {
          const member = () =>
            dashboard()?.members.find((m) => m.memberId === participant().memberId)
          return (
            <div
              class="split-participant"
              style={{ display: 'flex', 'align-items': 'center', gap: '12px' }}
            >
              <Toggle
                checked={participant().included}
                onChange={(checked) => {
                  props.updateDraft((prev) => {
                    const participants = prev.participants.map((p, i) =>
                      i === idx
                        ? {
                            ...p,
                            included: checked,
                            lastUpdatedAt: Date.now(),
                            isAutoCalculated: false
                          }
                        : p
                    )
                    return rebalancePurchaseSplit({ ...prev, participants }, null, null)
                  })
                }}
              />
              <span style={{ flex: 1 }}>{member()?.displayName ?? 'Unknown'}</span>
              <Show when={participant().included && props.draft.splitInputMode === 'exact'}>
                <Input
                  type="number"
                  style={{ width: '100px' }}
                  placeholder="0.00"
                  value={participant().shareAmountMajor}
                  onInput={(e) => {
                    const value = e.currentTarget.value
                    props.updateDraft(
                      produce((d: PurchaseDraft) => {
                        if (d.participants[idx]) {
                          d.participants[idx].shareAmountMajor = value
                          d.participants[idx].isAutoCalculated = false
                          d.participants[idx].lastUpdatedAt = Date.now()
                        }
                      })
                    )
                  }}
                  onBlur={(e) => {
                    const value = e.currentTarget.value
                    const minor = majorStringToMinor(value)
                    props.updateDraft((prev) => {
                      if (minor <= 0n) {
                        const participants = prev.participants.map((p, i) =>
                          i === idx
                            ? {
                                ...p,
                                included: false,
                                shareAmountMajor: '0.00',
                                sharePercentage: ''
                              }
                            : p
                        )
                        return rebalancePurchaseSplit({ ...prev, participants }, null, null)
                      }
                      return rebalancePurchaseSplit(prev, participant().memberId, value)
                    })
                  }}
                />
              </Show>
              <Show when={participant().included && props.draft.splitInputMode === 'percentage'}>
                <Input
                  type="number"
                  style={{ width: '80px' }}
                  placeholder="%"
                  value={participant().sharePercentage}
                  onInput={(e) => {
                    const value = e.currentTarget.value
                    props.updateDraft(
                      produce((d: PurchaseDraft) => {
                        if (d.participants[idx]) {
                          d.participants[idx].sharePercentage = value
                          d.participants[idx].isAutoCalculated = false
                          d.participants[idx].lastUpdatedAt = Date.now()
                        }
                      })
                    )
                  }}
                  onBlur={(e) => {
                    const value = e.currentTarget.value
                    const percentage = parseFloat(value) || 0
                    props.updateDraft((prev) => {
                      if (percentage <= 0) {
                        const participants = prev.participants.map((p, i) =>
                          i === idx
                            ? {
                                ...p,
                                included: false,
                                shareAmountMajor: '0.00',
                                sharePercentage: ''
                              }
                            : p
                        )
                        return rebalancePurchaseSplit({ ...prev, participants }, null, null)
                      }
                      const totalMinor = majorStringToMinor(prev.amountMajor)
                      const shareMinor =
                        (totalMinor * BigInt(Math.round(percentage * 100))) / 10000n
                      const amountMajor = minorToMajorString(shareMinor)
                      const updated = rebalancePurchaseSplit(
                        prev,
                        participant().memberId,
                        amountMajor
                      )
                      // Preserve the typed percentage string
                      const participants = updated.participants.map((p, i) =>
                        i === idx ? { ...p, sharePercentage: value } : p
                      )
                      return { ...updated, participants }
                    })
                  }}
                />
              </Show>
            </div>
          )
        }}
      </Index>
      <Show
        when={
          props.draft.splitInputMode !== 'equal' &&
          props.draft.participants.some((p) => p.included) &&
          !validation().valid
        }
      >
        <div style={{ display: 'flex', gap: '8px', 'align-items': 'center' }}>
          <div
            style={{
              'font-size': '12px',
              color: '#ef4444'
            }}
          >
            {validation().error}
          </div>
        </div>
      </Show>
    </div>
  )
}

export default function LedgerRoute() {
  const { initData, refreshHouseholdData, session } = useSession()
  const { copy, locale } = useI18n()
  const { dashboard, loading, effectiveIsAdmin, purchaseLedger, paymentLedger } = useDashboard()
  const unresolvedPurchaseLedger = createMemo(() =>
    purchaseLedger().filter((entry) => entry.resolutionStatus !== 'resolved')
  )
  const resolvedPurchaseLedger = createMemo(() =>
    purchaseLedger().filter((entry) => entry.resolutionStatus === 'resolved')
  )
  const paymentPeriodOptions = createMemo(() => {
    const periods = new Set<string>()
    for (const summary of dashboard()?.paymentPeriods ?? []) {
      periods.add(summary.period)
    }

    return [...periods]
      .sort()
      .map((period) => ({ value: period, label: formatCyclePeriod(period, locale()) }))
  })
  const paymentPeriodSummaries = createMemo(() => dashboard()?.paymentPeriods ?? [])

  // ── Purchase editor ──────────────────────────────
  const [editingPurchase, setEditingPurchase] = createSignal<
    MiniAppDashboard['ledger'][number] | null
  >(null)
  const [purchaseDraft, setPurchaseDraft] = createSignal<PurchaseDraft | null>(null)
  const [savingPurchase, setSavingPurchase] = createSignal(false)
  const [deletingPurchase, setDeletingPurchase] = createSignal(false)

  // ── New purchase form (Bug #4 fix) ───────────────
  const [addPurchaseOpen, setAddPurchaseOpen] = createSignal(false)
  const [newPurchase, setNewPurchase] = createSignal<PurchaseDraft>({
    description: '',
    amountMajor: '',
    currency: (dashboard()?.currency as 'USD' | 'GEL') ?? 'GEL',
    splitMode: 'equal',
    splitInputMode: 'equal',
    participants: []
  })
  const [addingPurchase, setAddingPurchase] = createSignal(false)

  // ── Payment editor ───────────────────────────────
  const [editingPayment, setEditingPayment] = createSignal<
    MiniAppDashboard['ledger'][number] | null
  >(null)
  const [paymentDraftState, setPaymentDraft] = createSignal<PaymentDraft | null>(null)
  const [savingPayment, setSavingPayment] = createSignal(false)
  const [deletingPayment, setDeletingPayment] = createSignal(false)

  // ── New payment form ─────────────────────────────
  const [addPaymentOpen, setAddPaymentOpen] = createSignal(false)
  const [newPayment, setNewPayment] = createSignal<PaymentDraft>({
    memberId: '',
    kind: 'rent',
    amountMajor: '',
    currency: (dashboard()?.currency as 'USD' | 'GEL') ?? 'GEL',
    period: dashboard()?.period ?? ''
  })
  const [addingPayment, setAddingPayment] = createSignal(false)
  const [paymentActionError, setPaymentActionError] = createSignal<string | null>(null)

  const addPurchaseButtonText = createMemo(() => {
    if (addingPurchase()) return copy().savingPurchase
    if (newPurchase().splitInputMode !== 'equal' && !validatePurchaseDraft(newPurchase()).valid) {
      return copy().purchaseBalanceAction
    }
    return copy().purchaseSaveAction
  })

  const editPurchaseButtonText = createMemo(() => {
    if (savingPurchase()) return copy().savingPurchase
    const draft = purchaseDraft()
    if (draft && draft.splitInputMode !== 'equal' && !validatePurchaseDraft(draft).valid) {
      return copy().purchaseBalanceAction
    }
    return copy().purchaseSaveAction
  })

  function openPurchaseEditor(entry: MiniAppDashboard['ledger'][number]) {
    setEditingPurchase(entry)
    setPurchaseDraft(purchaseDraftForEntry(entry))
  }

  function closePurchaseEditor() {
    setEditingPurchase(null)
    setPurchaseDraft(null)
  }

  function openPaymentEditor(entry: MiniAppDashboard['ledger'][number]) {
    setEditingPayment(entry)
    setPaymentDraft(paymentDraftForEntry(entry))
  }

  function closePaymentEditor() {
    setEditingPayment(null)
    setPaymentDraft(null)
  }

  async function handleSavePurchase() {
    const data = initData()
    const entry = editingPurchase()
    const draft = purchaseDraft()
    if (!data || !entry || !draft) return

    setSavingPurchase(true)
    try {
      await updateMiniAppPurchase(data, {
        purchaseId: entry.id,
        description: draft.description,
        amountMajor: draft.amountMajor,
        currency: draft.currency,
        ...(draft.payerMemberId
          ? {
              payerMemberId: draft.payerMemberId
            }
          : {}),
        split: {
          mode: draft.splitMode,
          participants: draft.participants.map((p) => ({
            memberId: p.memberId,
            included: p.included,
            ...(draft.splitMode === 'custom_amounts'
              ? { shareAmountMajor: p.shareAmountMajor || '0.00' }
              : {})
          }))
        }
      })
      closePurchaseEditor()
      await refreshHouseholdData(true, true)
    } finally {
      setSavingPurchase(false)
    }
  }

  async function handleDeletePurchase() {
    const data = initData()
    const entry = editingPurchase()
    if (!data || !entry) return

    setDeletingPurchase(true)
    try {
      await deleteMiniAppPurchase(data, entry.id)
      closePurchaseEditor()
      await refreshHouseholdData(true, true)
    } finally {
      setDeletingPurchase(false)
    }
  }

  async function handleAddPurchase() {
    const data = initData()
    const draft = newPurchase()
    if (!data || !draft.description.trim() || !draft.amountMajor.trim()) return

    setAddingPurchase(true)
    try {
      await addMiniAppPurchase(data, {
        description: draft.description,
        amountMajor: draft.amountMajor,
        currency: draft.currency,
        ...(draft.payerMemberId
          ? {
              payerMemberId: draft.payerMemberId
            }
          : {}),
        ...(draft.participants.length > 0
          ? {
              split: {
                mode: draft.splitMode,
                participants: draft.participants.map((p) => ({
                  memberId: p.memberId,
                  included: p.included,
                  ...(draft.splitMode === 'custom_amounts'
                    ? { shareAmountMajor: p.shareAmountMajor || '0.00' }
                    : {})
                }))
              }
            }
          : {})
      })
      setAddPurchaseOpen(false)
      const currentSession = session()
      setNewPurchase({
        description: '',
        amountMajor: '',
        currency: (dashboard()?.currency as 'USD' | 'GEL') ?? 'GEL',
        ...(currentSession.status === 'ready' ? { payerMemberId: currentSession.member.id } : {}),
        splitMode: 'equal',
        splitInputMode: 'equal',
        participants: []
      })
      await refreshHouseholdData(true, true)
    } finally {
      setAddingPurchase(false)
    }
  }

  async function handleSavePayment() {
    const data = initData()
    const entry = editingPayment()
    const draft = paymentDraftState()
    if (!data || !entry || !draft) return

    setSavingPayment(true)
    try {
      await updateMiniAppPayment(data, {
        paymentId: entry.id,
        memberId: draft.memberId,
        kind: draft.kind,
        amountMajor: draft.amountMajor,
        currency: draft.currency
      })
      closePaymentEditor()
      await refreshHouseholdData(true, true)
    } finally {
      setSavingPayment(false)
    }
  }

  async function handleDeletePayment() {
    const data = initData()
    const entry = editingPayment()
    if (!data || !entry) return

    setDeletingPayment(true)
    try {
      await deleteMiniAppPayment(data, entry.id)
      closePaymentEditor()
      await refreshHouseholdData(true, true)
    } finally {
      setDeletingPayment(false)
    }
  }

  async function handleAddPayment() {
    const data = initData()
    const draft = newPayment()
    if (!data || !draft.memberId || !draft.amountMajor.trim()) return

    setAddingPayment(true)
    try {
      setPaymentActionError(null)
      await addMiniAppPayment(data, {
        memberId: draft.memberId,
        kind: draft.kind,
        amountMajor: draft.amountMajor,
        currency: draft.currency,
        ...(draft.period ? { period: draft.period } : {})
      })
      setAddPaymentOpen(false)
      setNewPayment({
        memberId: '',
        kind: 'rent',
        amountMajor: '',
        currency: (dashboard()?.currency as 'USD' | 'GEL') ?? 'GEL',
        period: dashboard()?.period ?? ''
      })
      await refreshHouseholdData(true, true)
    } catch (error) {
      setPaymentActionError(error instanceof Error ? error.message : copy().quickPaymentFailed)
    } finally {
      setAddingPayment(false)
    }
  }

  async function handleResolveSuggestedPayment(input: {
    memberId: string
    kind: 'rent' | 'utilities'
    period: string
    amountMajor: string
  }) {
    const data = initData()
    if (!data) return

    setAddingPayment(true)
    try {
      setPaymentActionError(null)
      await addMiniAppPayment(data, {
        memberId: input.memberId,
        kind: input.kind,
        period: input.period,
        amountMajor: input.amountMajor,
        currency: (dashboard()?.currency as 'USD' | 'GEL') ?? 'GEL'
      })
      await refreshHouseholdData(true, true)
    } catch (error) {
      setPaymentActionError(error instanceof Error ? error.message : copy().quickPaymentFailed)
    } finally {
      setAddingPayment(false)
    }
  }

  function openCustomPayment(input: {
    memberId: string
    kind: 'rent' | 'utilities'
    period: string
  }) {
    setPaymentActionError(null)
    setNewPayment({
      memberId: input.memberId,
      kind: input.kind,
      amountMajor: computePaymentPrefill(dashboard(), input.memberId, input.kind, input.period),
      currency: (dashboard()?.currency as 'USD' | 'GEL') ?? 'GEL',
      period: input.period
    })
    setAddPaymentOpen(true)
  }

  const currencyOptions = () => [
    { value: 'GEL', label: localizedCurrencyLabel(locale(), 'GEL') },
    { value: 'USD', label: 'USD' }
  ]

  const kindOptions = () => [
    { value: 'rent', label: copy().shareRent },
    { value: 'utilities', label: copy().shareUtilities }
  ]

  const memberOptions = createMemo(() =>
    (dashboard()?.members ?? []).map((m) => ({ value: m.memberId, label: m.displayName }))
  )

  const splitModeOptions = () => [
    { value: 'equal', label: copy().purchaseSplitEqual },
    { value: 'exact', label: copy().purchaseSplitExact },
    { value: 'percentage', label: copy().purchaseSplitPercentage }
  ]

  return (
    <div class="route route--ledger">
      <Switch>
        <Match when={loading()}>
          <Card>
            <Skeleton style={{ width: '100%', height: '24px', 'margin-bottom': '12px' }} />
            <Skeleton style={{ width: '80%', height: '48px' }} />
          </Card>
          <Card>
            <Skeleton style={{ width: '100%', height: '24px', 'margin-bottom': '12px' }} />
            <Skeleton style={{ width: '80%', height: '48px' }} />
          </Card>
        </Match>

        <Match when={!dashboard()}>
          <Card>
            <p class="empty-state">{copy().ledgerEmpty}</p>
          </Card>
        </Match>

        <Match when={dashboard()}>
          {(_data) => (
            <>
              {/* ── Purchases ──────────────────────────── */}
              <Collapsible
                title={copy().purchasesTitle}
                body={copy().purchaseReviewBody}
                defaultOpen
              >
                <Show when={effectiveIsAdmin()}>
                  <div class="editable-list-actions">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => {
                        const members = dashboard()?.members ?? []
                        const currency = (dashboard()?.currency as 'USD' | 'GEL') ?? 'GEL'
                        setNewPurchase({
                          description: '',
                          amountMajor: '',
                          currency,
                          splitMode: 'equal',
                          splitInputMode: 'equal',
                          participants: members.map((m) => ({
                            memberId: m.memberId,
                            included: true,
                            shareAmountMajor: '',
                            sharePercentage: ''
                          }))
                        })
                        setAddPurchaseOpen(true)
                      }}
                    >
                      <Plus size={14} />
                      {copy().purchaseSaveAction}
                    </Button>
                  </div>
                </Show>
                <Show
                  when={purchaseLedger().length > 0}
                  fallback={<p class="empty-state">{copy().purchasesEmpty}</p>}
                >
                  <div style={{ display: 'flex', 'flex-direction': 'column', gap: '12px' }}>
                    <div>
                      <div class="editable-list-section-title">
                        {copy().unresolvedPurchasesTitle}
                      </div>
                      <Show
                        when={unresolvedPurchaseLedger().length > 0}
                        fallback={<p class="empty-state">{copy().unresolvedPurchasesEmpty}</p>}
                      >
                        <div class="editable-list">
                          <For each={unresolvedPurchaseLedger()}>
                            {(entry) => (
                              <button
                                class="editable-list-row"
                                onClick={() => effectiveIsAdmin() && openPurchaseEditor(entry)}
                                disabled={!effectiveIsAdmin()}
                              >
                                <div class="editable-list-row__main">
                                  <span class="editable-list-row__title">{entry.title}</span>
                                  <span class="editable-list-row__subtitle">
                                    {joinSubtitleParts([
                                      entry.actorDisplayName,
                                      entry.originPeriod
                                        ? formatCyclePeriod(entry.originPeriod, locale())
                                        : null,
                                      'Unresolved'
                                    ])}
                                  </span>
                                </div>
                                <div class="editable-list-row__meta">
                                  <strong>
                                    {formatMoneyLabel(
                                      entry.displayAmountMajor,
                                      entry.displayCurrency,
                                      locale()
                                    )}
                                  </strong>
                                  <Show when={ledgerSecondaryAmount(entry)}>
                                    {(secondary) => (
                                      <span class="editable-list-row__secondary">
                                        {secondary()}
                                      </span>
                                    )}
                                  </Show>
                                </div>
                              </button>
                            )}
                          </For>
                        </div>
                      </Show>
                    </div>

                    <Collapsible title={copy().resolvedPurchasesTitle} defaultOpen={false}>
                      <Show
                        when={resolvedPurchaseLedger().length > 0}
                        fallback={<p class="empty-state">{copy().resolvedPurchasesEmpty}</p>}
                      >
                        <div class="editable-list">
                          <For each={resolvedPurchaseLedger()}>
                            {(entry) => (
                              <button
                                class="editable-list-row"
                                onClick={() => effectiveIsAdmin() && openPurchaseEditor(entry)}
                                disabled={!effectiveIsAdmin()}
                              >
                                <div class="editable-list-row__main">
                                  <span class="editable-list-row__title">{entry.title}</span>
                                  <span class="editable-list-row__subtitle">
                                    {joinSubtitleParts([
                                      entry.actorDisplayName,
                                      entry.originPeriod
                                        ? formatCyclePeriod(entry.originPeriod, locale())
                                        : null,
                                      entry.resolvedAt
                                        ? formatFriendlyDate(entry.resolvedAt, locale())
                                        : null
                                    ])}
                                  </span>
                                </div>
                                <div class="editable-list-row__meta">
                                  <strong>
                                    {formatMoneyLabel(
                                      entry.displayAmountMajor,
                                      entry.displayCurrency,
                                      locale()
                                    )}
                                  </strong>
                                  <Show when={ledgerSecondaryAmount(entry)}>
                                    {(secondary) => (
                                      <span class="editable-list-row__secondary">
                                        {secondary()}
                                      </span>
                                    )}
                                  </Show>
                                </div>
                              </button>
                            )}
                          </For>
                        </div>
                      </Show>
                    </Collapsible>
                  </div>
                </Show>
              </Collapsible>

              {/* ── Payments ───────────────────────────── */}
              <Collapsible
                title={copy().paymentsTitle}
                {...(effectiveIsAdmin() && copy().paymentsAdminBody
                  ? { body: copy().paymentsAdminBody }
                  : {})}
              >
                <Show when={effectiveIsAdmin()}>
                  <div class="editable-list-actions">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setNewPayment((payment) => ({
                          ...payment,
                          period: dashboard()?.period ?? ''
                        }))
                        setAddPaymentOpen(true)
                      }}
                    >
                      <Plus size={14} />
                      {copy().paymentsAddAction}
                    </Button>
                  </div>
                </Show>
                <Show when={paymentActionError()}>
                  {(error) => <p class="empty-state">{error()}</p>}
                </Show>
                <Show
                  when={paymentPeriodSummaries().length > 0}
                  fallback={<p class="empty-state">{copy().paymentsEmpty}</p>}
                >
                  <div style={{ display: 'flex', 'flex-direction': 'column', gap: '12px' }}>
                    <For each={paymentPeriodSummaries()}>
                      {(summary) => (
                        <Collapsible
                          title={copy().paymentsPeriodTitle.replace(
                            '{period}',
                            formatCyclePeriod(summary.period, locale())
                          )}
                          body={
                            summary.hasOverdueBalance
                              ? copy().paymentsPeriodOverdueBody
                              : summary.isCurrentPeriod
                                ? copy().paymentsPeriodCurrentBody
                                : copy().paymentsPeriodHistoryBody
                          }
                          defaultOpen={summary.isCurrentPeriod || summary.hasOverdueBalance}
                        >
                          <div style={{ display: 'flex', 'flex-direction': 'column', gap: '12px' }}>
                            <For each={summary.kinds}>
                              {(kindSummary) => (
                                <Show
                                  when={kindSummary.unresolvedMembers.length > 0}
                                  fallback={
                                    <div class="editable-list-row editable-list-row--static">
                                      <div class="editable-list-row__main">
                                        <span class="editable-list-row__title">
                                          {kindSummary.kind === 'rent'
                                            ? copy().shareRent
                                            : copy().shareUtilities}
                                        </span>
                                        <span class="editable-list-row__subtitle">
                                          {copy().homeSettledTitle}
                                        </span>
                                      </div>
                                      <div class="editable-list-row__meta">
                                        <strong>
                                          {formatMoneyLabel(
                                            kindSummary.totalPaidMajor,
                                            (dashboard()?.currency as 'USD' | 'GEL') ?? 'GEL',
                                            locale()
                                          )}
                                        </strong>
                                      </div>
                                    </div>
                                  }
                                >
                                  <div>
                                    <div class="editable-list-section-title">
                                      {kindSummary.kind === 'rent'
                                        ? copy().shareRent
                                        : copy().shareUtilities}
                                    </div>
                                    <div class="editable-list">
                                      <For each={kindSummary.unresolvedMembers}>
                                        {(memberSummary) => (
                                          <div class="editable-list-row editable-list-row--stacked">
                                            <div class="editable-list-row__main">
                                              <span class="editable-list-row__title">
                                                {memberSummary.displayName}
                                              </span>
                                              <span class="editable-list-row__subtitle">
                                                {copy()
                                                  .paymentsBaseDueLabel.replace(
                                                    '{amount}',
                                                    formatMoneyLabel(
                                                      memberSummary.baseDueMajor,
                                                      (dashboard()?.currency as 'USD' | 'GEL') ??
                                                        'GEL',
                                                      locale()
                                                    )
                                                  )
                                                  .replace(
                                                    '{remaining}',
                                                    formatMoneyLabel(
                                                      memberSummary.remainingMajor,
                                                      (dashboard()?.currency as 'USD' | 'GEL') ??
                                                        'GEL',
                                                      locale()
                                                    )
                                                  )}
                                              </span>
                                            </div>
                                            <div class="editable-list-row__meta">
                                              <strong>
                                                {formatMoneyLabel(
                                                  memberSummary.suggestedAmountMajor,
                                                  (dashboard()?.currency as 'USD' | 'GEL') ?? 'GEL',
                                                  locale()
                                                )}
                                              </strong>
                                              <div class="editable-list-inline-actions">
                                                <Button
                                                  variant="primary"
                                                  size="sm"
                                                  loading={addingPayment()}
                                                  onClick={() =>
                                                    void handleResolveSuggestedPayment({
                                                      memberId: memberSummary.memberId,
                                                      kind: kindSummary.kind,
                                                      period: summary.period,
                                                      amountMajor:
                                                        memberSummary.suggestedAmountMajor
                                                    })
                                                  }
                                                >
                                                  {copy().paymentsResolveAction}
                                                </Button>
                                                <Button
                                                  variant="ghost"
                                                  size="sm"
                                                  onClick={() =>
                                                    openCustomPayment({
                                                      memberId: memberSummary.memberId,
                                                      kind: kindSummary.kind,
                                                      period: summary.period
                                                    })
                                                  }
                                                >
                                                  {copy().paymentsCustomAmountAction}
                                                </Button>
                                              </div>
                                            </div>
                                          </div>
                                        )}
                                      </For>
                                    </div>
                                  </div>
                                </Show>
                              )}
                            </For>
                          </div>
                        </Collapsible>
                      )}
                    </For>

                    <Collapsible title={copy().paymentsHistoryTitle} defaultOpen={false}>
                      <Show
                        when={paymentLedger().length > 0}
                        fallback={<p class="empty-state">{copy().paymentsEmpty}</p>}
                      >
                        <div class="editable-list">
                          <For each={paymentLedger()}>
                            {(entry) => (
                              <button
                                class="editable-list-row"
                                onClick={() => effectiveIsAdmin() && openPaymentEditor(entry)}
                                disabled={!effectiveIsAdmin()}
                              >
                                <div class="editable-list-row__main">
                                  <span class="editable-list-row__title">
                                    {entry.paymentKind === 'rent'
                                      ? copy().paymentLedgerRent
                                      : copy().paymentLedgerUtilities}
                                  </span>
                                  <span class="editable-list-row__subtitle">
                                    {entry.actorDisplayName}
                                  </span>
                                </div>
                                <div class="editable-list-row__meta">
                                  <strong>
                                    {formatMoneyLabel(
                                      entry.displayAmountMajor,
                                      entry.displayCurrency,
                                      locale()
                                    )}
                                  </strong>
                                </div>
                              </button>
                            )}
                          </For>
                        </div>
                      </Show>
                    </Collapsible>
                  </div>
                </Show>
              </Collapsible>
            </>
          )}
        </Match>
      </Switch>

      {/* ──────── Add Purchase Modal (Bug #4 fix) ──── */}
      <Modal
        open={addPurchaseOpen()}
        title={copy().purchaseSaveAction}
        description={copy().purchaseEditorBody}
        closeLabel={copy().closeEditorAction}
        onClose={() => setAddPurchaseOpen(false)}
        footer={
          <div class="modal-action-row">
            <Button variant="ghost" onClick={() => setAddPurchaseOpen(false)}>
              {copy().closeEditorAction}
            </Button>
            <Button
              variant="primary"
              loading={addingPurchase()}
              disabled={!newPurchase().description.trim() || !newPurchase().amountMajor.trim()}
              onClick={() => {
                const draft = newPurchase()
                if (draft.splitInputMode !== 'equal' && !validatePurchaseDraft(draft).valid) {
                  const rebalanced = rebalancePurchaseSplit(draft, null, null)
                  setNewPurchase(rebalanced)
                  if (validatePurchaseDraft(rebalanced).valid) {
                    void handleAddPurchase()
                  }
                } else {
                  void handleAddPurchase()
                }
              }}
            >
              {addPurchaseButtonText()}
            </Button>
          </div>
        }
      >
        <div class="editor-grid">
          <Field label={copy().purchaseReviewTitle}>
            <Input
              value={newPurchase().description}
              onInput={(e) => setNewPurchase((p) => ({ ...p, description: e.currentTarget.value }))}
            />
          </Field>
          <Field label={copy().paymentAmount}>
            <Input
              type="number"
              value={newPurchase().amountMajor}
              onInput={(e) => {
                const amountMajor = e.currentTarget.value
                setNewPurchase((p) => {
                  const updated = { ...p, amountMajor }
                  return rebalancePurchaseSplit(updated, null, null)
                })
              }}
            />
          </Field>
          <Field label={copy().currencyLabel}>
            <Select
              value={newPurchase().currency}
              ariaLabel={copy().currencyLabel}
              options={currencyOptions()}
              onChange={(value) =>
                setNewPurchase((p) => ({ ...p, currency: value as 'USD' | 'GEL' }))
              }
            />
          </Field>
          <Field label={copy().purchasePayerLabel}>
            <Select
              value={newPurchase().payerMemberId ?? ''}
              ariaLabel={copy().purchasePayerLabel}
              placeholder="—"
              options={[{ value: '', label: '—' }, ...memberOptions()]}
              onChange={(value) =>
                setNewPurchase((p) => {
                  const base = { ...p }
                  if (value) {
                    return { ...base, payerMemberId: value }
                  }
                  // eslint-disable-next-line @typescript-eslint/no-unused-vars
                  const { payerMemberId, ...rest } = base
                  return rest as PurchaseDraft
                })
              }
            />
          </Field>
          <div style={{ 'grid-column': '1 / -1' }}>
            <Field label={copy().purchaseSplitTitle}>
              <Select
                value={newPurchase().splitInputMode}
                ariaLabel={copy().purchaseSplitTitle}
                options={splitModeOptions()}
                onChange={(value) =>
                  setNewPurchase((p) => {
                    const splitInputMode = value as 'equal' | 'exact' | 'percentage'
                    const splitMode = splitInputMode === 'equal' ? 'equal' : 'custom_amounts'
                    const updated = {
                      ...p,
                      splitInputMode,
                      splitMode: splitMode as 'equal' | 'custom_amounts'
                    }
                    return rebalancePurchaseSplit(updated, null, null)
                  })
                }
              />
            </Field>
            <ParticipantSplitInputs
              draft={newPurchase()}
              updateDraft={(updater) => setNewPurchase((prev) => updater(prev))}
            />
          </div>
        </div>
      </Modal>

      {/* ──────── Edit Purchase Modal ───────────────── */}
      <Modal
        open={!!editingPurchase()}
        title={copy().editEntryAction}
        description={copy().purchaseEditorBody}
        closeLabel={copy().closeEditorAction}
        onClose={closePurchaseEditor}
        footer={
          <div class="modal-action-row">
            <Button
              variant="danger"
              loading={deletingPurchase()}
              onClick={() => void handleDeletePurchase()}
            >
              {deletingPurchase() ? copy().deletingPurchase : copy().purchaseDeleteAction}
            </Button>
            <Button
              variant="primary"
              loading={savingPurchase()}
              disabled={
                !purchaseDraft()?.description.trim() || !purchaseDraft()?.amountMajor.trim()
              }
              onClick={() => {
                const draft = purchaseDraft()
                if (
                  draft &&
                  draft.splitInputMode !== 'equal' &&
                  !validatePurchaseDraft(draft).valid
                ) {
                  const rebalanced = rebalancePurchaseSplit(draft, null, null)
                  setPurchaseDraft(rebalanced)
                  if (validatePurchaseDraft(rebalanced).valid) {
                    void handleSavePurchase()
                  }
                } else {
                  void handleSavePurchase()
                }
              }}
            >
              {editPurchaseButtonText()}
            </Button>
          </div>
        }
      >
        <Show when={purchaseDraft()}>
          {(draft) => (
            <div class="editor-grid">
              <Field label={copy().purchaseReviewTitle}>
                <Input
                  value={draft().description}
                  onInput={(e) =>
                    setPurchaseDraft((d) => (d ? { ...d, description: e.currentTarget.value } : d))
                  }
                />
              </Field>
              <Field label={copy().paymentAmount}>
                <Input
                  type="number"
                  value={draft().amountMajor}
                  onInput={(e) => {
                    const amountMajor = e.currentTarget.value
                    setPurchaseDraft((d) => {
                      if (!d) return d
                      const updated = { ...d, amountMajor }
                      return rebalancePurchaseSplit(updated, null, null)
                    })
                  }}
                />
              </Field>
              <Field label={copy().currencyLabel}>
                <Select
                  value={draft().currency}
                  ariaLabel={copy().currencyLabel}
                  options={currencyOptions()}
                  onChange={(value) =>
                    setPurchaseDraft((d) => (d ? { ...d, currency: value as 'USD' | 'GEL' } : d))
                  }
                />
              </Field>
              <Field label={copy().purchasePayerLabel}>
                <Select
                  value={draft().payerMemberId ?? ''}
                  ariaLabel={copy().purchasePayerLabel}
                  placeholder="—"
                  options={[{ value: '', label: '—' }, ...memberOptions()]}
                  onChange={(value) =>
                    setPurchaseDraft((d) => {
                      if (!d) return d
                      const base = { ...d }
                      if (value) {
                        return { ...base, payerMemberId: value }
                      }
                      // eslint-disable-next-line @typescript-eslint/no-unused-vars
                      const { payerMemberId, ...rest } = base
                      return rest as PurchaseDraft
                    })
                  }
                />
              </Field>
              <div style={{ 'grid-column': '1 / -1' }}>
                <Field label={copy().purchaseSplitTitle}>
                  <Select
                    value={draft().splitInputMode}
                    ariaLabel={copy().purchaseSplitTitle}
                    options={splitModeOptions()}
                    onChange={(value) =>
                      setPurchaseDraft((d) => {
                        if (!d) return d
                        const splitInputMode = value as 'equal' | 'exact' | 'percentage'
                        const splitMode = splitInputMode === 'equal' ? 'equal' : 'custom_amounts'
                        const updated = {
                          ...d,
                          splitInputMode,
                          splitMode: splitMode as 'equal' | 'custom_amounts'
                        }
                        return rebalancePurchaseSplit(updated, null, null)
                      })
                    }
                  />
                </Field>
                <ParticipantSplitInputs
                  draft={draft()}
                  updateDraft={(updater) =>
                    setPurchaseDraft((prev) => (prev ? updater(prev) : prev))
                  }
                />
              </div>
            </div>
          )}
        </Show>
      </Modal>

      {/* ──────── Add Payment Modal ─────────────────── */}
      <Modal
        open={addPaymentOpen()}
        title={copy().paymentsAddAction}
        description={copy().paymentCreateBody}
        closeLabel={copy().closeEditorAction}
        onClose={() => setAddPaymentOpen(false)}
        footer={
          <div class="modal-action-row">
            <Button variant="ghost" onClick={() => setAddPaymentOpen(false)}>
              {copy().closeEditorAction}
            </Button>
            <Button
              variant="primary"
              loading={addingPayment()}
              disabled={!newPayment().memberId || !newPayment().amountMajor.trim()}
              onClick={() => void handleAddPayment()}
            >
              {addingPayment() ? copy().addingPayment : copy().paymentSaveAction}
            </Button>
          </div>
        }
      >
        <Show when={paymentActionError()}>{(error) => <p class="empty-state">{error()}</p>}</Show>
        <div class="editor-grid">
          <Field label={copy().paymentMember}>
            <Select
              value={newPayment().memberId}
              ariaLabel={copy().paymentMember}
              placeholder="—"
              options={[{ value: '', label: '—' }, ...memberOptions()]}
              onChange={(memberId) => {
                const prefill = computePaymentPrefill(
                  dashboard(),
                  memberId,
                  newPayment().kind,
                  newPayment().period || dashboard()?.period || ''
                )
                setNewPayment((p) => ({ ...p, memberId, amountMajor: prefill }))
              }}
            />
          </Field>
          <Field label={copy().paymentKind}>
            <Select
              value={newPayment().kind}
              ariaLabel={copy().paymentKind}
              options={kindOptions()}
              onChange={(value) =>
                setNewPayment((p) => ({
                  ...p,
                  kind: value as 'rent' | 'utilities',
                  amountMajor: p.memberId
                    ? computePaymentPrefill(
                        dashboard(),
                        p.memberId,
                        value as 'rent' | 'utilities',
                        p.period || dashboard()?.period || ''
                      )
                    : p.amountMajor
                }))
              }
            />
          </Field>
          <Field label="Billing period">
            <Select
              value={newPayment().period ?? ''}
              placeholder="—"
              ariaLabel="Billing period"
              options={[{ value: '', label: '—' }, ...paymentPeriodOptions()]}
              onChange={(value) =>
                setNewPayment((p) => ({
                  ...p,
                  period: value,
                  amountMajor: p.memberId
                    ? computePaymentPrefill(
                        dashboard(),
                        p.memberId,
                        p.kind,
                        value || dashboard()?.period || ''
                      )
                    : p.amountMajor
                }))
              }
            />
          </Field>
          <Field label={copy().paymentAmount}>
            <Input
              type="number"
              value={newPayment().amountMajor}
              onInput={(e) => setNewPayment((p) => ({ ...p, amountMajor: e.currentTarget.value }))}
            />
          </Field>
          <Field label={copy().currencyLabel}>
            <Select
              value={newPayment().currency}
              ariaLabel={copy().currencyLabel}
              options={currencyOptions()}
              onChange={(value) =>
                setNewPayment((p) => ({ ...p, currency: value as 'USD' | 'GEL' }))
              }
            />
          </Field>
        </div>
      </Modal>

      {/* ──────── Edit Payment Modal ────────────────── */}
      <Modal
        open={!!editingPayment()}
        title={copy().editEntryAction}
        description={copy().paymentEditorBody}
        closeLabel={copy().closeEditorAction}
        onClose={closePaymentEditor}
        footer={
          <div class="modal-action-row">
            <Button
              variant="danger"
              loading={deletingPayment()}
              onClick={() => void handleDeletePayment()}
            >
              {deletingPayment() ? copy().deletingPayment : copy().paymentDeleteAction}
            </Button>
            <Button
              variant="primary"
              loading={savingPayment()}
              onClick={() => void handleSavePayment()}
            >
              {savingPayment() ? copy().savingPurchase : copy().paymentSaveAction}
            </Button>
          </div>
        }
      >
        <Show when={paymentDraftState()}>
          {(draft) => (
            <div class="editor-grid">
              <Field label={copy().paymentMember}>
                <Select
                  value={draft().memberId}
                  ariaLabel={copy().paymentMember}
                  placeholder="—"
                  options={[{ value: '', label: '—' }, ...memberOptions()]}
                  onChange={(value) => setPaymentDraft((d) => (d ? { ...d, memberId: value } : d))}
                />
              </Field>
              <Field label={copy().paymentKind}>
                <Select
                  value={draft().kind}
                  ariaLabel={copy().paymentKind}
                  options={kindOptions()}
                  onChange={(value) =>
                    setPaymentDraft((d) => (d ? { ...d, kind: value as 'rent' | 'utilities' } : d))
                  }
                />
              </Field>
              <Field label={copy().paymentAmount}>
                <Input
                  type="number"
                  value={draft().amountMajor}
                  onInput={(e) =>
                    setPaymentDraft((d) => (d ? { ...d, amountMajor: e.currentTarget.value } : d))
                  }
                />
              </Field>
            </div>
          )}
        </Show>
      </Modal>
    </div>
  )
}
