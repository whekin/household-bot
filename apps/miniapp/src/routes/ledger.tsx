import { Show, For, Index, createSignal, createMemo } from 'solid-js'
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
import {
  ledgerPrimaryAmount,
  ledgerSecondaryAmount,
  purchaseDraftForEntry,
  paymentDraftForEntry,
  computePaymentPrefill,
  rebalancePurchaseSplit,
  validatePurchaseDraft,
  type PurchaseDraft,
  type PaymentDraft
} from '../lib/ledger-helpers'
import { minorToMajorString, majorStringToMinor } from '../lib/money'
import {
  addMiniAppPurchase,
  updateMiniAppPurchase,
  deleteMiniAppPurchase,
  addMiniAppPayment,
  updateMiniAppPayment,
  deleteMiniAppPayment,
  addMiniAppUtilityBill,
  updateMiniAppUtilityBill,
  deleteMiniAppUtilityBill,
  type MiniAppDashboard
} from '../miniapp-api'

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
  const { initData, refreshHouseholdData } = useSession()
  const { copy } = useI18n()
  const { dashboard, effectiveIsAdmin, purchaseLedger, utilityLedger, paymentLedger } =
    useDashboard()

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

  // ── Utility bill editor ──────────────────────────
  const [editingUtility, setEditingUtility] = createSignal<
    MiniAppDashboard['ledger'][number] | null
  >(null)
  const [utilityDraft, setUtilityDraft] = createSignal<{
    billName: string
    amountMajor: string
    currency: 'USD' | 'GEL'
  } | null>(null)
  const [savingUtility, setSavingUtility] = createSignal(false)
  const [deletingUtility, setDeletingUtility] = createSignal(false)

  // ── New utility bill form ────────────────────────
  const [addUtilityOpen, setAddUtilityOpen] = createSignal(false)
  const [newUtility, setNewUtility] = createSignal({
    billName: '',
    amountMajor: '',
    currency: (dashboard()?.currency as 'USD' | 'GEL') ?? 'GEL'
  })
  const [addingUtility, setAddingUtility] = createSignal(false)

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
    currency: (dashboard()?.currency as 'USD' | 'GEL') ?? 'GEL'
  })
  const [addingPayment, setAddingPayment] = createSignal(false)

  const addPurchaseButtonText = createMemo(() => {
    if (addingPurchase()) return copy().purchaseSaveAction // or maybe adding...
    if (newPurchase().splitInputMode === 'equal') return copy().purchaseSaveAction
    if (!validatePurchaseDraft(newPurchase()).valid) return copy().purchaseBalanceAction
    return copy().purchaseSaveAction
  })

  const editPurchaseButtonText = createMemo(() => {
    const draft = purchaseDraft()
    if (savingPurchase()) return copy().savingPurchase
    if (!draft) return copy().purchaseSaveAction
    if (draft.splitInputMode === 'equal') return copy().purchaseSaveAction
    if (!validatePurchaseDraft(draft).valid) return copy().purchaseBalanceAction
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

  function openUtilityEditor(entry: MiniAppDashboard['ledger'][number]) {
    setEditingUtility(entry)
    setUtilityDraft({
      billName: entry.title,
      amountMajor: entry.amountMajor,
      currency: entry.currency as 'USD' | 'GEL'
    })
  }

  function closeUtilityEditor() {
    setEditingUtility(null)
    setUtilityDraft(null)
  }

  async function handleAddUtility() {
    const data = initData()
    const draft = newUtility()
    if (!data || !draft.billName.trim() || !draft.amountMajor.trim()) return

    setAddingUtility(true)
    try {
      await addMiniAppUtilityBill(data, draft)
      setAddUtilityOpen(false)
      setNewUtility({
        billName: '',
        amountMajor: '',
        currency: (dashboard()?.currency as 'USD' | 'GEL') ?? 'GEL'
      })
      await refreshHouseholdData(true, true)
    } finally {
      setAddingUtility(false)
    }
  }

  async function handleSaveUtility() {
    const data = initData()
    const entry = editingUtility()
    const draft = utilityDraft()
    if (!data || !entry || !draft) return

    setSavingUtility(true)
    try {
      await updateMiniAppUtilityBill(data, {
        billId: entry.id,
        ...draft
      })
      closeUtilityEditor()
      await refreshHouseholdData(true, true)
    } finally {
      setSavingUtility(false)
    }
  }

  async function handleDeleteUtility() {
    const data = initData()
    const entry = editingUtility()
    if (!data || !entry) return

    setDeletingUtility(true)
    try {
      await deleteMiniAppUtilityBill(data, entry.id)
      closeUtilityEditor()
      await refreshHouseholdData(true, true)
    } finally {
      setDeletingUtility(false)
    }
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
        split: {
          mode: draft.splitMode,
          participants: draft.participants.map((p) => ({
            memberId: p.memberId,
            included: p.included,
            ...(p.shareAmountMajor && draft.splitMode === 'custom_amounts'
              ? { shareAmountMajor: p.shareAmountMajor }
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
        ...(draft.participants.length > 0
          ? {
              split: {
                mode: draft.splitMode,
                participants: draft.participants.map((p) => ({
                  memberId: p.memberId,
                  included: p.included,
                  ...(p.shareAmountMajor && draft.splitMode === 'custom_amounts'
                    ? { shareAmountMajor: p.shareAmountMajor }
                    : {})
                }))
              }
            }
          : {})
      })
      setAddPurchaseOpen(false)
      setNewPurchase({
        description: '',
        amountMajor: '',
        currency: (dashboard()?.currency as 'USD' | 'GEL') ?? 'GEL',
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
      await addMiniAppPayment(data, {
        memberId: draft.memberId,
        kind: draft.kind,
        amountMajor: draft.amountMajor,
        currency: draft.currency
      })
      setAddPaymentOpen(false)
      setNewPayment({
        memberId: '',
        kind: 'rent',
        amountMajor: '',
        currency: (dashboard()?.currency as 'USD' | 'GEL') ?? 'GEL'
      })
      await refreshHouseholdData(true, true)
    } finally {
      setAddingPayment(false)
    }
  }

  const currencyOptions = () => [
    { value: 'GEL', label: 'GEL' },
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
    { value: 'exact', label: 'Exact amounts' },
    { value: 'percentage', label: 'Percentages' }
  ]

  return (
    <div class="route route--ledger">
      <Show
        when={dashboard()}
        fallback={
          <Card>
            <p class="empty-state">{copy().ledgerEmpty}</p>
          </Card>
        }
      >
        {(_data) => (
          <>
            {/* ── Purchases ──────────────────────────── */}
            <Collapsible title={copy().purchasesTitle} body={copy().purchaseReviewBody} defaultOpen>
              <Show when={effectiveIsAdmin()}>
                <div class="ledger-actions">
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
                <div class="ledger-list">
                  <For each={purchaseLedger()}>
                    {(entry) => (
                      <button
                        class="ledger-entry"
                        onClick={() => effectiveIsAdmin() && openPurchaseEditor(entry)}
                        disabled={!effectiveIsAdmin()}
                      >
                        <div class="ledger-entry__main">
                          <span class="ledger-entry__title">{entry.title}</span>
                          <span class="ledger-entry__actor">{entry.actorDisplayName}</span>
                        </div>
                        <div class="ledger-entry__amounts">
                          <strong>{ledgerPrimaryAmount(entry)}</strong>
                          <Show when={ledgerSecondaryAmount(entry)}>
                            {(secondary) => (
                              <span class="ledger-entry__secondary">{secondary()}</span>
                            )}
                          </Show>
                        </div>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </Collapsible>

            {/* ── Utility bills ──────────────────────── */}
            <Collapsible title={copy().utilityLedgerTitle}>
              <Show when={effectiveIsAdmin()}>
                <div class="ledger-actions">
                  <Button variant="primary" size="sm" onClick={() => setAddUtilityOpen(true)}>
                    <Plus size={14} />
                    {copy().addUtilityBillAction}
                  </Button>
                </div>
              </Show>
              <Show
                when={utilityLedger().length > 0}
                fallback={<p class="empty-state">{copy().utilityLedgerEmpty}</p>}
              >
                <div class="ledger-list">
                  <For each={utilityLedger()}>
                    {(entry) => (
                      <button
                        class="ledger-entry"
                        onClick={() => effectiveIsAdmin() && openUtilityEditor(entry)}
                        disabled={!effectiveIsAdmin()}
                      >
                        <div class="ledger-entry__main">
                          <span class="ledger-entry__title">{entry.title}</span>
                          <span class="ledger-entry__actor">{entry.actorDisplayName}</span>
                        </div>
                        <div class="ledger-entry__amounts">
                          <strong>{ledgerPrimaryAmount(entry)}</strong>
                        </div>
                      </button>
                    )}
                  </For>
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
                <div class="ledger-actions">
                  <Button variant="primary" size="sm" onClick={() => setAddPaymentOpen(true)}>
                    <Plus size={14} />
                    {copy().paymentsAddAction}
                  </Button>
                </div>
              </Show>
              <Show
                when={paymentLedger().length > 0}
                fallback={<p class="empty-state">{copy().paymentsEmpty}</p>}
              >
                <div class="ledger-list">
                  <For each={paymentLedger()}>
                    {(entry) => (
                      <button
                        class="ledger-entry"
                        onClick={() => effectiveIsAdmin() && openPaymentEditor(entry)}
                        disabled={!effectiveIsAdmin()}
                      >
                        <div class="ledger-entry__main">
                          <span class="ledger-entry__title">
                            {entry.paymentKind === 'rent'
                              ? copy().paymentLedgerRent
                              : copy().paymentLedgerUtilities}
                          </span>
                          <span class="ledger-entry__actor">{entry.actorDisplayName}</span>
                        </div>
                        <div class="ledger-entry__amounts">
                          <strong>{ledgerPrimaryAmount(entry)}</strong>
                        </div>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </Collapsible>
          </>
        )}
      </Show>

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
                if (
                  newPurchase().splitInputMode !== 'equal' &&
                  !validatePurchaseDraft(newPurchase()).valid
                ) {
                  setNewPurchase((p) => rebalancePurchaseSplit(p, null, null))
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
          <div style={{ 'grid-column': '1 / -1' }}>
            <Field label="Split By">
              <Select
                value={newPurchase().splitInputMode}
                ariaLabel="Split By"
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
                  setPurchaseDraft((d) => (d ? rebalancePurchaseSplit(d, null, null) : d))
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
              <div style={{ 'grid-column': '1 / -1' }}>
                <Field label="Split By">
                  <Select
                    value={draft().splitInputMode}
                    ariaLabel="Split By"
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
        <div class="editor-grid">
          <Field label={copy().paymentMember}>
            <Select
              value={newPayment().memberId}
              ariaLabel={copy().paymentMember}
              placeholder="—"
              options={[{ value: '', label: '—' }, ...memberOptions()]}
              onChange={(memberId) => {
                const member = dashboard()?.members.find((m) => m.memberId === memberId)
                const prefill = computePaymentPrefill(member, newPayment().kind)
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
                setNewPayment((p) => ({ ...p, kind: value as 'rent' | 'utilities' }))
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

      {/* ──────── Add Utility Modal ─────────────────── */}
      <Modal
        open={addUtilityOpen()}
        title={copy().addUtilityBillAction}
        description={copy().utilityBillCreateBody}
        closeLabel={copy().closeEditorAction}
        onClose={() => setAddUtilityOpen(false)}
        footer={
          <div class="modal-action-row">
            <Button variant="ghost" onClick={() => setAddUtilityOpen(false)}>
              {copy().closeEditorAction}
            </Button>
            <Button
              variant="primary"
              loading={addingUtility()}
              disabled={!newUtility().billName.trim() || !newUtility().amountMajor.trim()}
              onClick={() => void handleAddUtility()}
            >
              {addingUtility() ? copy().savingUtilityBill : copy().addUtilityBillAction}
            </Button>
          </div>
        }
      >
        <div class="editor-grid">
          <Field label={copy().utilityCategoryLabel}>
            <Input
              value={newUtility().billName}
              onInput={(e) => setNewUtility((p) => ({ ...p, billName: e.currentTarget.value }))}
            />
          </Field>
          <Field label={copy().utilityAmount}>
            <Input
              type="number"
              value={newUtility().amountMajor}
              onInput={(e) => setNewUtility((p) => ({ ...p, amountMajor: e.currentTarget.value }))}
            />
          </Field>
          <Field label={copy().currencyLabel}>
            <Select
              value={newUtility().currency}
              ariaLabel={copy().currencyLabel}
              options={currencyOptions()}
              onChange={(value) =>
                setNewUtility((p) => ({ ...p, currency: value as 'USD' | 'GEL' }))
              }
            />
          </Field>
        </div>
      </Modal>

      {/* ──────── Edit Utility Modal ────────────────── */}
      <Modal
        open={!!editingUtility()}
        title={copy().editUtilityBillAction}
        description={copy().utilityBillEditorBody}
        closeLabel={copy().closeEditorAction}
        onClose={closeUtilityEditor}
        footer={
          <div class="modal-action-row">
            <Button
              variant="danger"
              loading={deletingUtility()}
              onClick={() => void handleDeleteUtility()}
            >
              {deletingUtility() ? copy().deletingUtilityBill : copy().deleteUtilityBillAction}
            </Button>
            <Button
              variant="primary"
              loading={savingUtility()}
              onClick={() => void handleSaveUtility()}
            >
              {savingUtility() ? copy().savingUtilityBill : copy().saveUtilityBillAction}
            </Button>
          </div>
        }
      >
        <Show when={utilityDraft()}>
          {(draft) => (
            <div class="editor-grid">
              <Field label={copy().utilityCategoryLabel}>
                <Input
                  value={draft().billName}
                  onInput={(e) =>
                    setUtilityDraft((d) => (d ? { ...d, billName: e.currentTarget.value } : d))
                  }
                />
              </Field>
              <Field label={copy().utilityAmount}>
                <Input
                  type="number"
                  value={draft().amountMajor}
                  onInput={(e) =>
                    setUtilityDraft((d) => (d ? { ...d, amountMajor: e.currentTarget.value } : d))
                  }
                />
              </Field>
              <Field label={copy().currencyLabel}>
                <Select
                  value={draft().currency}
                  ariaLabel={copy().currencyLabel}
                  options={currencyOptions()}
                  onChange={(value) =>
                    setUtilityDraft((d) => (d ? { ...d, currency: value as 'USD' | 'GEL' } : d))
                  }
                />
              </Field>
            </div>
          )}
        </Show>
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
