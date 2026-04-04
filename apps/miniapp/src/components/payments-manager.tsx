import { For, Show, createMemo, createSignal } from 'solid-js'
import { Clock3, Plus } from 'lucide-solid'

import { useSession } from '../contexts/session-context'
import { useI18n } from '../contexts/i18n-context'
import { useDashboard } from '../contexts/dashboard-context'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { CurrencyToggle } from './ui/currency-toggle'
import { Modal } from './ui/dialog'
import { Field } from './ui/field'
import { Input } from './ui/input'
import { Select } from './ui/select'
import { formatCyclePeriod } from '../lib/dates'
import {
  computePaymentPrefill,
  formatMoneyLabel,
  paymentDraftForEntry,
  type PaymentDraft
} from '../lib/ledger-helpers'
import {
  addMiniAppPayment,
  deleteMiniAppPayment,
  updateMiniAppPayment,
  type MiniAppDashboard
} from '../miniapp-api'

function sortPeriodsDesc<T extends { period: string }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => right.period.localeCompare(left.period))
}

export function PaymentsManager() {
  const { initData, refreshHouseholdData } = useSession()
  const { copy, locale } = useI18n()
  const { dashboard, effectiveIsAdmin, paymentLedger } = useDashboard()

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
  const currentPeriodSummary = createMemo(() =>
    paymentPeriodSummaries().find((summary) => summary.isCurrentPeriod)
  )
  const billingStage = createMemo(() => dashboard()?.billingStage ?? 'idle')
  const activePaymentKind = createMemo((): 'rent' | 'utilities' | null => {
    const stage = billingStage()
    if (stage === 'idle') return null
    return stage
  })
  const memberPaymentRows = createMemo(() => {
    const kind = activePaymentKind()
    const current = currentPeriodSummary()
    if (!kind || !current) return []

    const kindSummary = current.kinds.find((k) => k.kind === kind)
    if (!kindSummary) return []

    return kindSummary.unresolvedMembers.map((member) => ({
      memberId: member.memberId,
      displayName: member.displayName,
      kind,
      remainingMajor: member.remainingMajor,
      suggestedAmountMajor: member.suggestedAmountMajor
    }))
  })
  const historyPeriodSummaries = createMemo(() =>
    sortPeriodsDesc(
      paymentPeriodSummaries().filter(
        (summary) => !summary.isCurrentPeriod && !summary.hasOverdueBalance
      )
    )
  )
  const memberOptions = createMemo(() =>
    (dashboard()?.members ?? []).map((member) => ({
      value: member.memberId,
      label: member.displayName
    }))
  )

  const [historyOpen, setHistoryOpen] = createSignal(false)
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
  const [processingMember, setProcessingMember] = createSignal<string | null>(null)

  const [editingPayment, setEditingPayment] = createSignal<
    MiniAppDashboard['ledger'][number] | null
  >(null)
  const [paymentDraftState, setPaymentDraft] = createSignal<PaymentDraft | null>(null)
  const [savingPayment, setSavingPayment] = createSignal(false)
  const [deletingPayment, setDeletingPayment] = createSignal(false)

  const kindOptions = () => [
    { value: 'rent', label: copy().shareRent },
    { value: 'utilities', label: copy().shareUtilities }
  ]

  async function handleQuickPayment(input: {
    memberId: string
    kind: 'rent' | 'utilities'
    amountMajor: string
  }) {
    const data = initData()
    const current = currentPeriodSummary()
    if (!data || !current) return

    setProcessingMember(input.memberId)
    try {
      setPaymentActionError(null)
      await addMiniAppPayment(data, {
        memberId: input.memberId,
        kind: input.kind,
        period: current.period,
        amountMajor: input.amountMajor,
        currency: (dashboard()?.currency as 'USD' | 'GEL') ?? 'GEL'
      })
      await refreshHouseholdData(true, true)
    } catch (error) {
      setPaymentActionError(error instanceof Error ? error.message : copy().quickPaymentFailed)
    } finally {
      setProcessingMember(null)
    }
  }

  function openCustomPayment(input: {
    memberId: string
    kind?: 'rent' | 'utilities'
    period?: string
  }) {
    setPaymentActionError(null)
    const current = currentPeriodSummary()
    setNewPayment({
      memberId: input.memberId,
      kind: input.kind ?? 'rent',
      amountMajor: computePaymentPrefill(
        dashboard(),
        input.memberId,
        input.kind ?? 'rent',
        input.period ?? current?.period ?? dashboard()?.period ?? ''
      ),
      currency: (dashboard()?.currency as 'USD' | 'GEL') ?? 'GEL',
      period: input.period ?? current?.period ?? dashboard()?.period ?? ''
    })
    setAddPaymentOpen(true)
  }

  function closePaymentEditor() {
    setEditingPayment(null)
    setPaymentDraft(null)
  }

  function openPaymentEditor(entry: MiniAppDashboard['ledger'][number]) {
    setEditingPayment(entry)
    setPaymentDraft(paymentDraftForEntry(entry))
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

  function renderKindTitle(kind: 'rent' | 'utilities') {
    return kind === 'rent' ? copy().shareRent : copy().shareUtilities
  }

  return (
    <>
      <Show when={memberPaymentRows().length > 0}>
        <Card>
          <div class="statement-section-heading">
            <div>
              <strong>{copy().paymentsTitle}</strong>
              <p>{copy().paymentsAdminBody}</p>
            </div>
            <div class="payments-manager__toolbar">
              <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
                <Clock3 size={14} />
                {copy().paymentsHistoryAction}
              </Button>
              <Show when={effectiveIsAdmin()}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setPaymentActionError(null)
                    setNewPayment((payment) => ({
                      ...payment,
                      memberId: '',
                      period: dashboard()?.period ?? ''
                    }))
                    setAddPaymentOpen(true)
                  }}
                >
                  <Plus size={14} />
                  {copy().paymentsAddAction}
                </Button>
              </Show>
            </div>
          </div>

          <Show when={paymentActionError()}>{(error) => <p class="empty-state">{error()}</p>}</Show>

          <div class="payments-compact-list">
            <For each={memberPaymentRows()}>
              {(row) => (
                <div class="payment-compact-row">
                  <div class="payment-compact-row__info">
                    <strong>{row.displayName}</strong>
                    <div class="payment-compact-row__details">
                      <span>{row.kind === 'rent' ? copy().shareRent : copy().shareUtilities}</span>
                      <strong>
                        {formatMoneyLabel(
                          row.remainingMajor,
                          (dashboard()?.currency as 'USD' | 'GEL') ?? 'GEL',
                          locale()
                        )}
                      </strong>
                    </div>
                  </div>
                  <Show when={effectiveIsAdmin()}>
                    <div class="payment-compact-row__actions">
                      <Button
                        variant="primary"
                        size="sm"
                        loading={processingMember() === row.memberId}
                        onClick={() =>
                          void handleQuickPayment({
                            memberId: row.memberId,
                            kind: row.kind,
                            amountMajor: row.suggestedAmountMajor
                          })
                        }
                      >
                        {row.kind === 'rent'
                          ? locale() === 'ru'
                            ? 'Оплатил аренду'
                            : 'Paid rent'
                          : locale() === 'ru'
                            ? 'Оплатил коммуналку'
                            : 'Paid utilities'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          openCustomPayment({
                            memberId: row.memberId,
                            kind: row.kind
                          })
                        }
                      >
                        {locale() === 'ru' ? 'Другая сумма' : 'Custom'}
                      </Button>
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Card>
      </Show>

      <Modal
        open={historyOpen()}
        title={copy().paymentsHistoryTitle}
        description={copy().paymentsHistoryBody}
        closeLabel={copy().closeEditorAction}
        onClose={() => setHistoryOpen(false)}
      >
        <div class="payments-history">
          <Show when={historyPeriodSummaries().length > 0}>
            <section class="payments-history__section">
              <header class="payments-history__header">
                <strong>{copy().paymentsHistoryPeriodsTitle}</strong>
                <p>{copy().paymentsPeriodHistoryBody}</p>
              </header>
              <div class="payments-history__periods">
                <For each={historyPeriodSummaries()}>
                  {(summary) => (
                    <article class="payments-history-period">
                      <div class="payments-history-period__title-line">
                        <strong>
                          {copy().paymentsPeriodTitle.replace(
                            '{period}',
                            formatCyclePeriod(summary.period, locale())
                          )}
                        </strong>
                        <span class="payments-period__badge is-settled">
                          {copy().paymentsPeriodSettledStatus}
                        </span>
                      </div>
                      <div class="payments-history-period__totals">
                        <For each={summary.kinds}>
                          {(kindSummary) => (
                            <div class="payments-history-period__total">
                              <span>{renderKindTitle(kindSummary.kind)}</span>
                              <strong>
                                {formatMoneyLabel(
                                  kindSummary.totalPaidMajor,
                                  (dashboard()?.currency as 'USD' | 'GEL') ?? 'GEL',
                                  locale()
                                )}
                              </strong>
                            </div>
                          )}
                        </For>
                      </div>
                    </article>
                  )}
                </For>
              </div>
            </section>
          </Show>

          <section class="payments-history__section">
            <header class="payments-history__header">
              <strong>{copy().paymentsHistoryTitle}</strong>
              <p>{copy().paymentsHistoryRecordsBody}</p>
            </header>
            <Show
              when={paymentLedger().length > 0}
              fallback={<p class="empty-state">{copy().paymentsEmpty}</p>}
            >
              <div class="payments-history__records">
                <For each={paymentLedger()}>
                  {(entry) => (
                    <button
                      class="payments-history-record"
                      onClick={() => effectiveIsAdmin() && openPaymentEditor(entry)}
                      disabled={!effectiveIsAdmin()}
                    >
                      <div class="payments-history-record__copy">
                        <strong>
                          {entry.paymentKind === 'rent'
                            ? copy().paymentLedgerRent
                            : copy().paymentLedgerUtilities}
                        </strong>
                        <span>{entry.actorDisplayName}</span>
                      </div>
                      <strong>
                        {formatMoneyLabel(
                          entry.displayAmountMajor,
                          entry.displayCurrency,
                          locale()
                        )}
                      </strong>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </section>
        </div>
      </Modal>

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
                setNewPayment((payment) => ({ ...payment, memberId, amountMajor: prefill }))
              }}
            />
          </Field>
          <Field label={copy().paymentKind}>
            <Select
              value={newPayment().kind}
              ariaLabel={copy().paymentKind}
              options={kindOptions()}
              onChange={(value) =>
                setNewPayment((payment) => ({
                  ...payment,
                  kind: value as 'rent' | 'utilities',
                  amountMajor: payment.memberId
                    ? computePaymentPrefill(
                        dashboard(),
                        payment.memberId,
                        value as 'rent' | 'utilities',
                        payment.period || dashboard()?.period || ''
                      )
                    : payment.amountMajor
                }))
              }
            />
          </Field>
          <Field label={copy().billingCyclePeriod}>
            <Select
              value={newPayment().period ?? ''}
              placeholder="—"
              ariaLabel={copy().billingCyclePeriod}
              options={[{ value: '', label: '—' }, ...paymentPeriodOptions()]}
              onChange={(value) =>
                setNewPayment((payment) => ({
                  ...payment,
                  period: value,
                  amountMajor: payment.memberId
                    ? computePaymentPrefill(
                        dashboard(),
                        payment.memberId,
                        payment.kind,
                        value || dashboard()?.period || ''
                      )
                    : payment.amountMajor
                }))
              }
            />
          </Field>
          <Field label={copy().paymentAmount}>
            <Input
              type="number"
              value={newPayment().amountMajor}
              onInput={(e) =>
                setNewPayment((payment) => ({ ...payment, amountMajor: e.currentTarget.value }))
              }
            />
          </Field>
          <Field label={copy().currencyLabel}>
            <CurrencyToggle
              value={newPayment().currency}
              ariaLabel={copy().currencyLabel}
              onChange={(value) =>
                setNewPayment((payment) => ({ ...payment, currency: value as 'USD' | 'GEL' }))
              }
            />
          </Field>
        </div>
      </Modal>

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
              {copy().paymentSaveAction}
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
                  onChange={(value) =>
                    setPaymentDraft((current) =>
                      current ? { ...current, memberId: value } : current
                    )
                  }
                />
              </Field>
              <Field label={copy().paymentKind}>
                <Select
                  value={draft().kind}
                  ariaLabel={copy().paymentKind}
                  options={kindOptions()}
                  onChange={(value) =>
                    setPaymentDraft((current) =>
                      current ? { ...current, kind: value as 'rent' | 'utilities' } : current
                    )
                  }
                />
              </Field>
              <Field label={copy().paymentAmount}>
                <Input
                  type="number"
                  value={draft().amountMajor}
                  onInput={(e) =>
                    setPaymentDraft((current) =>
                      current ? { ...current, amountMajor: e.currentTarget.value } : current
                    )
                  }
                />
              </Field>
              <Field label={copy().currencyLabel}>
                <CurrencyToggle
                  value={draft().currency}
                  ariaLabel={copy().currencyLabel}
                  onChange={(value) =>
                    setPaymentDraft((current) =>
                      current ? { ...current, currency: value as 'USD' | 'GEL' } : current
                    )
                  }
                />
              </Field>
            </div>
          )}
        </Show>
      </Modal>
    </>
  )
}
