import { Show, For, createSignal, createMemo, Switch, Match } from 'solid-js'
import { Plus } from 'lucide-solid'

import { useSession } from '../contexts/session-context'
import { useI18n } from '../contexts/i18n-context'
import { useDashboard } from '../contexts/dashboard-context'
import { Card } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Skeleton } from '../components/ui/skeleton'
import { UtilityForm, type UtilityFormData } from '../components/utility-form'
import { formatMoneyLabel, localizedCurrencyLabel } from '../lib/ledger-helpers'
import { formatCyclePeriod } from '../lib/dates'
import {
  addMiniAppUtilityBill,
  updateMiniAppUtilityBill,
  deleteMiniAppUtilityBill,
  type MiniAppDashboard
} from '../miniapp-api'

const EMPTY_UTILITY: UtilityFormData = { billName: '', amountMajor: '', currency: 'GEL' }

export default function BillsRoute() {
  const { copy, locale } = useI18n()
  const { initData, refreshHouseholdData } = useSession()
  const { dashboard, loading, effectiveIsAdmin, utilityLedger, paymentLedger } = useDashboard()

  const [newUtility, setNewUtility] = createSignal<UtilityFormData>(EMPTY_UTILITY)
  const [editingUtilityId, setEditingUtilityId] = createSignal<string | null>(null)
  const [utilityDraft, setUtilityDraft] = createSignal<UtilityFormData | null>(null)

  const [addingUtility, setAddingUtility] = createSignal(false)
  const [savingUtility, setSavingUtility] = createSignal(false)
  const [deletingUtility, setDeletingUtility] = createSignal(false)

  const currencyOptions = () => [
    { value: 'GEL', label: localizedCurrencyLabel(locale(), 'GEL') },
    { value: 'USD', label: 'USD' }
  ]

  const rentPayments = createMemo(() =>
    paymentLedger().filter((entry) => entry.paymentKind === 'rent')
  )

  const utilityPayments = createMemo(() =>
    paymentLedger().filter((entry) => entry.paymentKind === 'utilities')
  )

  const utilityFormLabels = () => ({
    category: copy().utilityCategoryLabel,
    amount: copy().utilityAmount,
    currency: copy().currencyLabel
  })

  const handleAddUtility = async () => {
    const data = initData()
    const draft = newUtility()
    if (!data || !draft.billName.trim() || !draft.amountMajor.trim()) return

    setAddingUtility(true)
    try {
      await addMiniAppUtilityBill(data, draft)
      setNewUtility({
        ...EMPTY_UTILITY,
        currency: (dashboard()?.currency as 'USD' | 'GEL') ?? 'GEL'
      })
      await refreshHouseholdData(true, true)
    } finally {
      setAddingUtility(false)
    }
  }

  const openUtilityEditor = (entry: MiniAppDashboard['ledger'][number]) => {
    setEditingUtilityId(entry.id)
    setUtilityDraft({
      billName: entry.title,
      amountMajor: entry.amountMajor,
      currency: entry.currency as 'USD' | 'GEL'
    })
  }

  const closeUtilityEditor = () => {
    setEditingUtilityId(null)
    setUtilityDraft(null)
  }

  const handleSaveUtility = async () => {
    const data = initData()
    const utilityId = editingUtilityId()
    const draft = utilityDraft()
    if (!data || !utilityId || !draft) return

    setSavingUtility(true)
    try {
      await updateMiniAppUtilityBill(data, { billId: utilityId, ...draft })
      closeUtilityEditor()
      await refreshHouseholdData(true, true)
    } finally {
      setSavingUtility(false)
    }
  }

  const handleDeleteUtility = async () => {
    const data = initData()
    const utilityId = editingUtilityId()
    if (!data || !utilityId) return

    setDeletingUtility(true)
    try {
      await deleteMiniAppUtilityBill(data, utilityId)
      closeUtilityEditor()
      await refreshHouseholdData(true, true)
    } finally {
      setDeletingUtility(false)
    }
  }

  return (
    <div class="route route--bills">
      <div class="bills-section">
        <Switch>
          <Match when={loading()}>
            <Card>
              <Skeleton style={{ width: '100%', height: '24px', 'margin-bottom': '12px' }} />
              <Skeleton style={{ width: '80%', height: '48px' }} />
            </Card>
          </Match>

          <Match when={!dashboard()}>
            <Card>
              <p class="empty-state">{copy().emptyDashboard}</p>
            </Card>
          </Match>

          <Match when={dashboard()}>
            {(data) => (
              <>
                {/* Utilities Section */}
                <Card>
                  <div class="card-header">
                    <div>
                      <h2 class="card-title">{copy().utilityLedgerTitle}</h2>
                      <p class="card-subtitle">
                        {copy().currentCycleLabel} · {formatCyclePeriod(data().period, locale())}
                      </p>
                    </div>
                  </div>

                  {/* Add Utility Form — admin only */}
                  <Show when={effectiveIsAdmin()}>
                    <div class="bills-add-form">
                      <UtilityForm
                        value={newUtility()}
                        onChange={setNewUtility}
                        currencyOptions={currencyOptions()}
                        labels={utilityFormLabels()}
                        disabled={addingUtility()}
                      />
                      <div class="bills-add-form__actions">
                        <Button
                          variant="primary"
                          loading={addingUtility()}
                          disabled={
                            !newUtility().billName.trim() || !newUtility().amountMajor.trim()
                          }
                          onClick={() => void handleAddUtility()}
                        >
                          <Plus size={16} />
                          {addingUtility() ? copy().savingUtilityBill : copy().addUtilityBillAction}
                        </Button>
                      </div>
                    </div>
                  </Show>

                  {/* Current Cycle Utilities List */}
                  <Show
                    when={utilityLedger().length > 0}
                    fallback={<p class="empty-state">{copy().utilityLedgerEmpty}</p>}
                  >
                    <div class="bills-list">
                      <p class="bills-list__title">{copy().currentCycleLabel}</p>
                      <div class="editable-list">
                        <For each={utilityLedger()}>
                          {(entry) => (
                            <Show
                              when={effectiveIsAdmin()}
                              fallback={
                                <div class="editable-list-row editable-list-row--static">
                                  <div class="editable-list-row__main">
                                    <span class="editable-list-row__title">{entry.title}</span>
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
                                </div>
                              }
                            >
                              <button
                                class="editable-list-row"
                                onClick={() => openUtilityEditor(entry)}
                              >
                                <div class="editable-list-row__main">
                                  <span class="editable-list-row__title">{entry.title}</span>
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
                            </Show>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>
                </Card>

                {/* Rent Payments Section */}
                <Card>
                  <div class="card-header">
                    <div>
                      <h2 class="card-title">{copy().shareRent}</h2>
                      <p class="card-subtitle">
                        {copy().currentCycleLabel} · {formatCyclePeriod(data().period, locale())}
                      </p>
                    </div>
                  </div>
                  <Show
                    when={rentPayments().length > 0}
                    fallback={<p class="empty-state">{copy().paymentsEmpty}</p>}
                  >
                    <div class="editable-list" style={{ 'margin-top': 'var(--spacing-md)' }}>
                      <For each={rentPayments()}>
                        {(entry) => (
                          <div class="editable-list-row editable-list-row--static">
                            <div class="editable-list-row__main">
                              <span class="editable-list-row__title">{entry.title}</span>
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
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </Card>

                {/* Utility Payments Section */}
                <Show when={utilityPayments().length > 0}>
                  <Card>
                    <div class="card-header">
                      <div>
                        <h2 class="card-title">{copy().paymentsTitle}</h2>
                        <p class="card-subtitle">
                          {copy().shareUtilities} · {formatCyclePeriod(data().period, locale())}
                        </p>
                      </div>
                    </div>
                    <div class="editable-list" style={{ 'margin-top': 'var(--spacing-md)' }}>
                      <For each={utilityPayments()}>
                        {(entry) => (
                          <div class="editable-list-row editable-list-row--static">
                            <div class="editable-list-row__main">
                              <span class="editable-list-row__title">{entry.title}</span>
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
                          </div>
                        )}
                      </For>
                    </div>
                  </Card>
                </Show>

                {/* Edit Utility Inline Form — admin only */}
                <Show when={utilityDraft()}>
                  {(draft) => (
                    <Card>
                      <div class="card-header">
                        <h2 class="card-title">{copy().editEntryAction}</h2>
                      </div>
                      <UtilityForm
                        value={draft()}
                        onChange={setUtilityDraft}
                        currencyOptions={currencyOptions()}
                        labels={utilityFormLabels()}
                        disabled={savingUtility() || deletingUtility()}
                      />
                      <div class="bills-editor-actions">
                        <Button
                          variant="danger"
                          loading={deletingUtility()}
                          onClick={() => void handleDeleteUtility()}
                        >
                          {deletingUtility()
                            ? copy().deletingUtilityBill
                            : copy().deleteUtilityBillAction}
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={closeUtilityEditor}
                          disabled={savingUtility() || deletingUtility()}
                        >
                          {copy().closeEditorAction}
                        </Button>
                        <div class="bills-editor-actions__save">
                          <Button
                            variant="primary"
                            loading={savingUtility()}
                            onClick={() => void handleSaveUtility()}
                          >
                            {savingUtility()
                              ? copy().savingUtilityBill
                              : copy().saveUtilityBillAction}
                          </Button>
                        </div>
                      </div>
                    </Card>
                  )}
                </Show>
              </>
            )}
          </Match>
        </Switch>
      </div>
    </div>
  )
}
