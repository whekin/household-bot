import { For, Index, Match, Show, Switch, createMemo, createSignal } from 'solid-js'
import { produce } from 'solid-js/store'
import { Plus } from 'lucide-solid'

import { useSession } from '../contexts/session-context'
import { useI18n } from '../contexts/i18n-context'
import { useDashboard } from '../contexts/dashboard-context'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { CurrencyToggle } from '../components/ui/currency-toggle'
import { Field } from '../components/ui/field'
import { Input } from '../components/ui/input'
import { Select } from '../components/ui/select'
import { Skeleton } from '../components/ui/skeleton'
import { Toggle } from '../components/ui/toggle'
import {
  formatMoneyLabel,
  ledgerSecondaryAmount,
  purchaseDraftForEntry,
  rebalancePurchaseSplit,
  validatePurchaseDraft,
  type PurchaseDraft
} from '../lib/ledger-helpers'
import { formatCyclePeriod, formatFriendlyDate } from '../lib/dates'
import { majorStringToMinor, minorToMajorString } from '../lib/money'
import {
  addMiniAppPurchase,
  deleteMiniAppPurchase,
  updateMiniAppPurchase,
  type MiniAppDashboard
} from '../miniapp-api'

function joinSubtitleParts(parts: readonly (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(' · ')
}

function initialsForName(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

function buildEmptyPurchaseDraft(
  data: MiniAppDashboard | null | undefined,
  currentMemberId: string | undefined
): PurchaseDraft {
  return {
    description: '',
    amountMajor: '',
    currency: (data?.currency as 'USD' | 'GEL') ?? 'GEL',
    ...(currentMemberId ? { payerMemberId: currentMemberId } : {}),
    splitMode: 'equal',
    splitInputMode: 'equal',
    participants: (data?.members ?? []).map((member) => ({
      memberId: member.memberId,
      included: true,
      shareAmountMajor: '',
      sharePercentage: ''
    }))
  }
}

function ParticipantSplitInputs(props: {
  draft: PurchaseDraft
  updateDraft: (fn: (draft: PurchaseDraft) => PurchaseDraft) => void
}) {
  const { dashboard } = useDashboard()

  const validation = () => validatePurchaseDraft(props.draft)

  return (
    <div class="purchase-split-editor">
      <Index each={props.draft.participants}>
        {(participant, idx) => {
          const member = () =>
            dashboard()?.members.find((entry) => entry.memberId === participant().memberId)

          return (
            <div class="purchase-split-editor__row">
              <Toggle
                checked={participant().included}
                onChange={(checked) => {
                  props.updateDraft((draft) => {
                    const participants = draft.participants.map((entry, entryIndex) =>
                      entryIndex === idx
                        ? {
                            ...entry,
                            included: checked,
                            lastUpdatedAt: Date.now(),
                            isAutoCalculated: false
                          }
                        : entry
                    )
                    return rebalancePurchaseSplit({ ...draft, participants }, null, null)
                  })
                }}
              />
              <span class="purchase-split-editor__member">
                {member()?.displayName ?? participant().memberId}
              </span>
              <Show when={participant().included && props.draft.splitInputMode === 'exact'}>
                <Input
                  type="number"
                  class="purchase-split-editor__input"
                  placeholder="0.00"
                  value={participant().shareAmountMajor}
                  onInput={(e) => {
                    const value = e.currentTarget.value
                    props.updateDraft(
                      produce((draft: PurchaseDraft) => {
                        if (draft.participants[idx]) {
                          draft.participants[idx].shareAmountMajor = value
                          draft.participants[idx].isAutoCalculated = false
                          draft.participants[idx].lastUpdatedAt = Date.now()
                        }
                      })
                    )
                  }}
                  onBlur={(e) => {
                    const value = e.currentTarget.value
                    const minor = majorStringToMinor(value)
                    props.updateDraft((draft) => {
                      if (minor <= 0n) {
                        const participants = draft.participants.map((entry, entryIndex) =>
                          entryIndex === idx
                            ? {
                                ...entry,
                                included: false,
                                shareAmountMajor: '0.00',
                                sharePercentage: ''
                              }
                            : entry
                        )
                        return rebalancePurchaseSplit({ ...draft, participants }, null, null)
                      }
                      return rebalancePurchaseSplit(draft, participant().memberId, value)
                    })
                  }}
                />
              </Show>
              <Show when={participant().included && props.draft.splitInputMode === 'percentage'}>
                <Input
                  type="number"
                  class="purchase-split-editor__input purchase-split-editor__input--short"
                  placeholder="%"
                  value={participant().sharePercentage}
                  onInput={(e) => {
                    const value = e.currentTarget.value
                    props.updateDraft(
                      produce((draft: PurchaseDraft) => {
                        if (draft.participants[idx]) {
                          draft.participants[idx].sharePercentage = value
                          draft.participants[idx].isAutoCalculated = false
                          draft.participants[idx].lastUpdatedAt = Date.now()
                        }
                      })
                    )
                  }}
                  onBlur={(e) => {
                    const value = e.currentTarget.value
                    const percentage = parseFloat(value) || 0
                    props.updateDraft((draft) => {
                      if (percentage <= 0) {
                        const participants = draft.participants.map((entry, entryIndex) =>
                          entryIndex === idx
                            ? {
                                ...entry,
                                included: false,
                                shareAmountMajor: '0.00',
                                sharePercentage: ''
                              }
                            : entry
                        )
                        return rebalancePurchaseSplit({ ...draft, participants }, null, null)
                      }
                      const totalMinor = majorStringToMinor(draft.amountMajor)
                      const shareMinor =
                        (totalMinor * BigInt(Math.round(percentage * 100))) / 10000n
                      const amountMajor = minorToMajorString(shareMinor)
                      const updated = rebalancePurchaseSplit(
                        draft,
                        participant().memberId,
                        amountMajor
                      )
                      const participants = updated.participants.map((entry, entryIndex) =>
                        entryIndex === idx ? { ...entry, sharePercentage: value } : entry
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
          props.draft.participants.some((participant) => participant.included) &&
          !validation().valid
        }
      >
        <p class="purchase-split-editor__error">{validation().error}</p>
      </Show>
    </div>
  )
}

function PurchaseDraftFields(props: {
  draft: PurchaseDraft
  setDraft: (updater: (draft: PurchaseDraft) => PurchaseDraft) => void
  splitModeOptions: { value: string; label: string }[]
  memberOptions: { value: string; label: string }[]
  copy: ReturnType<typeof useI18n>['copy']
}) {
  return (
    <div class="editor-grid">
      <Field label={props.copy().purchaseDescriptionLabel}>
        <Input
          value={props.draft.description}
          onInput={(e) =>
            props.setDraft((draft) => ({ ...draft, description: e.currentTarget.value }))
          }
        />
      </Field>
      <Field label={props.copy().purchaseAmountLabel}>
        <Input
          type="number"
          value={props.draft.amountMajor}
          onInput={(e) => {
            const amountMajor = e.currentTarget.value
            props.setDraft((draft) => rebalancePurchaseSplit({ ...draft, amountMajor }, null, null))
          }}
        />
      </Field>
      <Field label={props.copy().currencyLabel}>
        <CurrencyToggle
          value={props.draft.currency}
          ariaLabel={props.copy().currencyLabel}
          onChange={(value) =>
            props.setDraft((draft) => ({ ...draft, currency: value as 'USD' | 'GEL' }))
          }
        />
      </Field>
      <Field label={props.copy().purchasePayerLabel}>
        <Select
          value={props.draft.payerMemberId ?? ''}
          ariaLabel={props.copy().purchasePayerLabel}
          placeholder="—"
          options={[{ value: '', label: '—' }, ...props.memberOptions]}
          onChange={(value) =>
            props.setDraft((draft) => {
              const base = { ...draft }
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
        <Field label={props.copy().purchaseSplitTitle}>
          <Select
            value={props.draft.splitInputMode}
            ariaLabel={props.copy().purchaseSplitTitle}
            options={props.splitModeOptions}
            onChange={(value) =>
              props.setDraft((draft) => {
                const splitInputMode = value as 'equal' | 'exact' | 'percentage'
                const splitMode = splitInputMode === 'equal' ? 'equal' : 'custom_amounts'
                return rebalancePurchaseSplit(
                  {
                    ...draft,
                    splitInputMode,
                    splitMode
                  },
                  null,
                  null
                )
              })
            }
          />
        </Field>
        <ParticipantSplitInputs draft={props.draft} updateDraft={props.setDraft} />
      </div>
    </div>
  )
}

export default function PurchasesRoute() {
  const { initData, refreshHouseholdData, session } = useSession()
  const { copy, locale } = useI18n()
  const { dashboard, effectiveIsAdmin, loading, purchaseLedger } = useDashboard()

  const unresolvedPurchaseLedger = createMemo(() =>
    purchaseLedger().filter((entry) => entry.resolutionStatus !== 'resolved')
  )
  const resolvedPurchaseLedger = createMemo(() =>
    purchaseLedger().filter((entry) => entry.resolutionStatus === 'resolved')
  )
  const memberNames = createMemo(
    () =>
      new Map((dashboard()?.members ?? []).map((member) => [member.memberId, member.displayName]))
  )
  const currentMemberId = () => {
    const current = session()
    return current.status === 'ready' ? current.member.id : undefined
  }

  const [composerOpen, setComposerOpen] = createSignal(false)
  const [newPurchase, setNewPurchase] = createSignal<PurchaseDraft>(
    buildEmptyPurchaseDraft(dashboard(), currentMemberId())
  )
  const [addingPurchase, setAddingPurchase] = createSignal(false)

  const [editingPurchase, setEditingPurchase] = createSignal<
    MiniAppDashboard['ledger'][number] | null
  >(null)
  const [purchaseDraft, setPurchaseDraft] = createSignal<PurchaseDraft | null>(null)
  const [savingPurchase, setSavingPurchase] = createSignal(false)
  const [deletingPurchase, setDeletingPurchase] = createSignal(false)

  const memberOptions = createMemo(() =>
    (dashboard()?.members ?? []).map((member) => ({
      value: member.memberId,
      label: member.displayName
    }))
  )
  const splitModeOptions = () => [
    { value: 'equal', label: copy().purchaseSplitEqual },
    { value: 'exact', label: copy().purchaseSplitExact },
    { value: 'percentage', label: copy().purchaseSplitPercentage }
  ]

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

  function resetComposer() {
    setNewPurchase(buildEmptyPurchaseDraft(dashboard(), currentMemberId()))
  }

  function openComposer() {
    setEditingPurchase(null)
    setPurchaseDraft(null)
    resetComposer()
    setComposerOpen(true)
  }

  function closeComposer() {
    setComposerOpen(false)
    resetComposer()
  }

  function togglePurchaseEditor(entry: MiniAppDashboard['ledger'][number]) {
    if (!effectiveIsAdmin()) return
    setComposerOpen(false)
    if (editingPurchase()?.id === entry.id) {
      setEditingPurchase(null)
      setPurchaseDraft(null)
      return
    }
    setEditingPurchase(entry)
    setPurchaseDraft(purchaseDraftForEntry(entry))
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
        ...(draft.payerMemberId ? { payerMemberId: draft.payerMemberId } : {}),
        ...(draft.participants.length > 0
          ? {
              split: {
                mode: draft.splitMode,
                participants: draft.participants.map((participant) => ({
                  memberId: participant.memberId,
                  included: participant.included,
                  ...(draft.splitMode === 'custom_amounts'
                    ? { shareAmountMajor: participant.shareAmountMajor || '0.00' }
                    : {})
                }))
              }
            }
          : {})
      })
      closeComposer()
      await refreshHouseholdData(true, true)
    } finally {
      setAddingPurchase(false)
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
        ...(draft.payerMemberId ? { payerMemberId: draft.payerMemberId } : {}),
        split: {
          mode: draft.splitMode,
          participants: draft.participants.map((participant) => ({
            memberId: participant.memberId,
            included: participant.included,
            ...(draft.splitMode === 'custom_amounts'
              ? { shareAmountMajor: participant.shareAmountMajor || '0.00' }
              : {})
          }))
        }
      })
      setEditingPurchase(null)
      setPurchaseDraft(null)
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
      setEditingPurchase(null)
      setPurchaseDraft(null)
      await refreshHouseholdData(true, true)
    } finally {
      setDeletingPurchase(false)
    }
  }

  function participantNames(entry: MiniAppDashboard['ledger'][number]) {
    return (entry.purchaseParticipants ?? [])
      .filter((participant) => participant.included)
      .map(
        (participant) =>
          memberNames().get(participant.memberId) ??
          participant.memberId ??
          copy().ledgerActorFallback
      )
  }

  function splitSummary(entry: MiniAppDashboard['ledger'][number]) {
    const participantCount = participantNames(entry).length
    const splitLabel =
      entry.purchaseSplitMode === 'custom_amounts'
        ? copy().purchaseSplitSummaryCustom
        : copy().purchaseSplitSummaryEqual

    return `${splitLabel} · ${participantCount} ${copy().participantsLabel}`
  }

  function metaSummary(entry: MiniAppDashboard['ledger'][number]) {
    return joinSubtitleParts([
      entry.actorDisplayName ?? copy().ledgerActorFallback,
      entry.occurredAt ? formatFriendlyDate(entry.occurredAt, locale()) : null,
      entry.originPeriod ? formatCyclePeriod(entry.originPeriod, locale()) : null
    ])
  }

  function outstandingSummary(entry: MiniAppDashboard['ledger'][number]) {
    const items = (entry.outstandingByMember ?? [])
      .filter((item) => majorStringToMinor(item.amountMajor) > 0n)
      .slice(0, 2)
      .map((item) => {
        const name = memberNames().get(item.memberId) ?? item.memberId
        return `${name} ${formatMoneyLabel(item.amountMajor, entry.displayCurrency, locale())}`
      })

    if (items.length === 0) return null

    const extraCount =
      (entry.outstandingByMember?.filter((item) => majorStringToMinor(item.amountMajor) > 0n)
        .length ?? 0) - items.length
    const extraSuffix =
      extraCount > 0
        ? ` · ${copy().purchaseMoreParticipantsLabel.replace('{count}', String(extraCount))}`
        : ''

    return `${copy().purchaseOutstandingLabel}: ${items.join(' · ')}${extraSuffix}`
  }

  return (
    <div class="route route--purchases">
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
              <Card>
                <div class="statement-section-heading">
                  <div>
                    <strong>{copy().purchasesTitle}</strong>
                    <p>{copy().purchasesPageBody}</p>
                  </div>
                  <Show when={effectiveIsAdmin() && !composerOpen()}>
                    <Button variant="primary" size="sm" onClick={openComposer}>
                      <Plus size={14} />
                      {copy().purchaseAddAction}
                    </Button>
                  </Show>
                </div>

                <Show when={effectiveIsAdmin()}>
                  <div class={`purchase-composer ${composerOpen() ? 'is-open' : ''}`}>
                    <Show
                      when={composerOpen()}
                      fallback={
                        <button
                          class="purchase-composer__trigger"
                          type="button"
                          onClick={openComposer}
                        >
                          <span>{copy().purchaseAddAction}</span>
                          <small>{copy().purchaseComposerBody}</small>
                        </button>
                      }
                    >
                      <div class="purchase-inline-editor">
                        <div class="purchase-inline-editor__copy">
                          <strong>{copy().purchaseAddAction}</strong>
                          <p>{copy().purchaseComposerBody}</p>
                        </div>
                        <PurchaseDraftFields
                          draft={newPurchase()}
                          setDraft={(updater) => setNewPurchase((draft) => updater(draft))}
                          splitModeOptions={splitModeOptions()}
                          memberOptions={memberOptions()}
                          copy={copy}
                        />
                        <div class="purchase-inline-editor__actions">
                          <Button variant="ghost" onClick={closeComposer}>
                            {copy().closeEditorAction}
                          </Button>
                          <Button
                            variant="primary"
                            loading={addingPurchase()}
                            disabled={
                              !newPurchase().description.trim() || !newPurchase().amountMajor.trim()
                            }
                            onClick={() => {
                              const draft = newPurchase()
                              if (
                                draft.splitInputMode !== 'equal' &&
                                !validatePurchaseDraft(draft).valid
                              ) {
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
                      </div>
                    </Show>
                  </div>
                </Show>
              </Card>

              <Card>
                <div class="statement-section-heading">
                  <div>
                    <strong>{copy().unresolvedPurchasesTitle}</strong>
                    <p>{copy().purchaseReviewBody}</p>
                  </div>
                </div>
                <Show
                  when={unresolvedPurchaseLedger().length > 0}
                  fallback={<p class="empty-state">{copy().unresolvedPurchasesEmpty}</p>}
                >
                  <div class="purchase-list">
                    <For each={unresolvedPurchaseLedger()}>
                      {(entry) => (
                        <article class="purchase-entry">
                          <Show
                            when={effectiveIsAdmin()}
                            fallback={
                              <div class="purchase-entry__surface purchase-entry__surface--static">
                                <div class="purchase-entry__copy">
                                  <div class="purchase-entry__title-line">
                                    <strong>{entry.title}</strong>
                                    <span class="purchase-entry__status">
                                      {copy().purchaseStatusOpen}
                                    </span>
                                  </div>
                                  <p class="purchase-entry__meta">{metaSummary(entry)}</p>
                                  <div class="purchase-entry__chips">
                                    <For each={participantNames(entry).slice(0, 4)}>
                                      {(name) => (
                                        <span class="purchase-entry__chip" title={name}>
                                          {initialsForName(name)}
                                        </span>
                                      )}
                                    </For>
                                    <Show when={participantNames(entry).length === 0}>
                                      <span class="purchase-entry__summary">
                                        {copy().purchaseNoParticipantsLabel}
                                      </span>
                                    </Show>
                                  </div>
                                  <div class="purchase-entry__footer">
                                    <span class="purchase-entry__summary">
                                      {splitSummary(entry)}
                                    </span>
                                    <Show when={outstandingSummary(entry)}>
                                      {(summary) => (
                                        <span class="purchase-entry__summary purchase-entry__summary--accent">
                                          {summary()}
                                        </span>
                                      )}
                                    </Show>
                                  </div>
                                </div>
                                <div class="purchase-entry__amounts">
                                  <strong>
                                    {formatMoneyLabel(
                                      entry.displayAmountMajor,
                                      entry.displayCurrency,
                                      locale()
                                    )}
                                  </strong>
                                  <Show when={ledgerSecondaryAmount(entry)}>
                                    {(secondary) => <span>{secondary()}</span>}
                                  </Show>
                                </div>
                              </div>
                            }
                          >
                            <button
                              class="purchase-entry__surface"
                              type="button"
                              onClick={() => togglePurchaseEditor(entry)}
                            >
                              <div class="purchase-entry__copy">
                                <div class="purchase-entry__title-line">
                                  <strong>{entry.title}</strong>
                                  <span class="purchase-entry__status">
                                    {copy().purchaseStatusOpen}
                                  </span>
                                </div>
                                <p class="purchase-entry__meta">{metaSummary(entry)}</p>
                                <div class="purchase-entry__chips">
                                  <For each={participantNames(entry).slice(0, 4)}>
                                    {(name) => (
                                      <span class="purchase-entry__chip" title={name}>
                                        {initialsForName(name)}
                                      </span>
                                    )}
                                  </For>
                                  <Show when={participantNames(entry).length === 0}>
                                    <span class="purchase-entry__summary">
                                      {copy().purchaseNoParticipantsLabel}
                                    </span>
                                  </Show>
                                </div>
                                <div class="purchase-entry__footer">
                                  <span class="purchase-entry__summary">{splitSummary(entry)}</span>
                                  <Show when={outstandingSummary(entry)}>
                                    {(summary) => (
                                      <span class="purchase-entry__summary purchase-entry__summary--accent">
                                        {summary()}
                                      </span>
                                    )}
                                  </Show>
                                </div>
                              </div>
                              <div class="purchase-entry__amounts">
                                <strong>
                                  {formatMoneyLabel(
                                    entry.displayAmountMajor,
                                    entry.displayCurrency,
                                    locale()
                                  )}
                                </strong>
                                <Show when={ledgerSecondaryAmount(entry)}>
                                  {(secondary) => <span>{secondary()}</span>}
                                </Show>
                              </div>
                            </button>
                          </Show>

                          <Show when={editingPurchase()?.id === entry.id && purchaseDraft()}>
                            {(draft) => (
                              <div class="purchase-inline-editor purchase-inline-editor--row">
                                <div class="purchase-inline-editor__copy">
                                  <strong>{copy().editEntryAction}</strong>
                                  <p>{copy().purchaseInlineEditorBody}</p>
                                </div>
                                <PurchaseDraftFields
                                  draft={draft()}
                                  setDraft={(updater) =>
                                    setPurchaseDraft((current) =>
                                      current ? updater(current) : current
                                    )
                                  }
                                  splitModeOptions={splitModeOptions()}
                                  memberOptions={memberOptions()}
                                  copy={copy}
                                />
                                <div class="purchase-inline-editor__actions">
                                  <Button
                                    variant="danger"
                                    loading={deletingPurchase()}
                                    onClick={() => void handleDeletePurchase()}
                                  >
                                    {deletingPurchase()
                                      ? copy().deletingPurchase
                                      : copy().purchaseDeleteAction}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    onClick={() => {
                                      setEditingPurchase(null)
                                      setPurchaseDraft(null)
                                    }}
                                  >
                                    {copy().closeEditorAction}
                                  </Button>
                                  <Button
                                    variant="primary"
                                    loading={savingPurchase()}
                                    disabled={
                                      !draft().description.trim() || !draft().amountMajor.trim()
                                    }
                                    onClick={() => {
                                      const currentDraft = draft()
                                      if (
                                        currentDraft.splitInputMode !== 'equal' &&
                                        !validatePurchaseDraft(currentDraft).valid
                                      ) {
                                        const rebalanced = rebalancePurchaseSplit(
                                          currentDraft,
                                          null,
                                          null
                                        )
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
                              </div>
                            )}
                          </Show>
                        </article>
                      )}
                    </For>
                  </div>
                </Show>
              </Card>

              <Card>
                <div class="statement-section-heading">
                  <div>
                    <strong>{copy().resolvedPurchasesTitle}</strong>
                    <p>{copy().homeSettledTitle}</p>
                  </div>
                </div>
                <Show
                  when={resolvedPurchaseLedger().length > 0}
                  fallback={<p class="empty-state">{copy().resolvedPurchasesEmpty}</p>}
                >
                  <div class="purchase-list purchase-list--settled">
                    <For each={resolvedPurchaseLedger()}>
                      {(entry) => (
                        <article class="purchase-entry purchase-entry--settled">
                          <Show
                            when={effectiveIsAdmin()}
                            fallback={
                              <div class="purchase-entry__surface purchase-entry__surface--static">
                                <div class="purchase-entry__copy">
                                  <div class="purchase-entry__title-line">
                                    <strong>{entry.title}</strong>
                                    <span class="purchase-entry__status purchase-entry__status--settled">
                                      {copy().purchaseStatusSettled}
                                    </span>
                                  </div>
                                  <p class="purchase-entry__meta">{metaSummary(entry)}</p>
                                  <div class="purchase-entry__chips">
                                    <For each={participantNames(entry).slice(0, 4)}>
                                      {(name) => (
                                        <span class="purchase-entry__chip" title={name}>
                                          {initialsForName(name)}
                                        </span>
                                      )}
                                    </For>
                                  </div>
                                  <div class="purchase-entry__footer">
                                    <span class="purchase-entry__summary">
                                      {splitSummary(entry)}
                                    </span>
                                    <Show when={entry.resolvedAt}>
                                      {(resolvedAt) => (
                                        <span class="purchase-entry__summary">
                                          {copy().purchaseSettledOnLabel}{' '}
                                          {formatFriendlyDate(resolvedAt(), locale())}
                                        </span>
                                      )}
                                    </Show>
                                  </div>
                                </div>
                                <div class="purchase-entry__amounts">
                                  <strong>
                                    {formatMoneyLabel(
                                      entry.displayAmountMajor,
                                      entry.displayCurrency,
                                      locale()
                                    )}
                                  </strong>
                                  <Show when={ledgerSecondaryAmount(entry)}>
                                    {(secondary) => <span>{secondary()}</span>}
                                  </Show>
                                </div>
                              </div>
                            }
                          >
                            <button
                              class="purchase-entry__surface"
                              type="button"
                              onClick={() => togglePurchaseEditor(entry)}
                            >
                              <div class="purchase-entry__copy">
                                <div class="purchase-entry__title-line">
                                  <strong>{entry.title}</strong>
                                  <span class="purchase-entry__status purchase-entry__status--settled">
                                    {copy().purchaseStatusSettled}
                                  </span>
                                </div>
                                <p class="purchase-entry__meta">{metaSummary(entry)}</p>
                                <div class="purchase-entry__chips">
                                  <For each={participantNames(entry).slice(0, 4)}>
                                    {(name) => (
                                      <span class="purchase-entry__chip" title={name}>
                                        {initialsForName(name)}
                                      </span>
                                    )}
                                  </For>
                                </div>
                                <div class="purchase-entry__footer">
                                  <span class="purchase-entry__summary">{splitSummary(entry)}</span>
                                  <Show when={entry.resolvedAt}>
                                    {(resolvedAt) => (
                                      <span class="purchase-entry__summary">
                                        {copy().purchaseSettledOnLabel}{' '}
                                        {formatFriendlyDate(resolvedAt(), locale())}
                                      </span>
                                    )}
                                  </Show>
                                </div>
                              </div>
                              <div class="purchase-entry__amounts">
                                <strong>
                                  {formatMoneyLabel(
                                    entry.displayAmountMajor,
                                    entry.displayCurrency,
                                    locale()
                                  )}
                                </strong>
                                <Show when={ledgerSecondaryAmount(entry)}>
                                  {(secondary) => <span>{secondary()}</span>}
                                </Show>
                              </div>
                            </button>
                          </Show>

                          <Show when={editingPurchase()?.id === entry.id && purchaseDraft()}>
                            {(draft) => (
                              <div class="purchase-inline-editor purchase-inline-editor--row">
                                <div class="purchase-inline-editor__copy">
                                  <strong>{copy().editEntryAction}</strong>
                                  <p>{copy().purchaseInlineEditorBody}</p>
                                </div>
                                <PurchaseDraftFields
                                  draft={draft()}
                                  setDraft={(updater) =>
                                    setPurchaseDraft((current) =>
                                      current ? updater(current) : current
                                    )
                                  }
                                  splitModeOptions={splitModeOptions()}
                                  memberOptions={memberOptions()}
                                  copy={copy}
                                />
                                <div class="purchase-inline-editor__actions">
                                  <Button
                                    variant="danger"
                                    loading={deletingPurchase()}
                                    onClick={() => void handleDeletePurchase()}
                                  >
                                    {deletingPurchase()
                                      ? copy().deletingPurchase
                                      : copy().purchaseDeleteAction}
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    onClick={() => {
                                      setEditingPurchase(null)
                                      setPurchaseDraft(null)
                                    }}
                                  >
                                    {copy().closeEditorAction}
                                  </Button>
                                  <Button
                                    variant="primary"
                                    loading={savingPurchase()}
                                    disabled={
                                      !draft().description.trim() || !draft().amountMajor.trim()
                                    }
                                    onClick={() => {
                                      const currentDraft = draft()
                                      if (
                                        currentDraft.splitInputMode !== 'equal' &&
                                        !validatePurchaseDraft(currentDraft).valid
                                      ) {
                                        const rebalanced = rebalancePurchaseSplit(
                                          currentDraft,
                                          null,
                                          null
                                        )
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
                              </div>
                            )}
                          </Show>
                        </article>
                      )}
                    </For>
                  </div>
                </Show>
              </Card>
            </>
          )}
        </Match>
      </Switch>
    </div>
  )
}
