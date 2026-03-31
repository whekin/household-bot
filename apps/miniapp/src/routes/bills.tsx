import { Show, For, createSignal, Switch, Match } from 'solid-js'
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

export default function BillsRoute() {
  const { copy, locale } = useI18n()
  const { initData, refreshHouseholdData } = useSession()
  const { dashboard, loading, utilityLedger } = useDashboard()

  const [newUtility, setNewUtility] = createSignal<UtilityFormData>({
    billName: '',
    amountMajor: '',
    currency: 'GEL'
  })

  const [editingUtility, setEditingUtility] = createSignal<string | null>(null)
  const [utilityDraft, setUtilityDraft] = createSignal<UtilityFormData | null>(null)

  const [addingUtility, setAddingUtility] = createSignal(false)
  const [savingUtility, setSavingUtility] = createSignal(false)
  const [deletingUtility, setDeletingUtility] = createSignal(false)

  const currencyOptions = () => [
    { value: 'GEL', label: localizedCurrencyLabel(locale(), 'GEL') },
    { value: 'USD', label: 'USD' }
  ]

  const handleAddUtility = async () => {
    const data = initData()
    const draft = newUtility()
    if (!data || !draft.billName.trim() || !draft.amountMajor.trim()) return

    setAddingUtility(true)
    try {
      await addMiniAppUtilityBill(data, draft)
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

  const openUtilityEditor = (entry: MiniAppDashboard['ledger'][number]) => {
    setEditingUtility(entry.id)
    setUtilityDraft({
      billName: entry.title,
      amountMajor: entry.amountMajor,
      currency: entry.currency as 'USD' | 'GEL'
    })
  }

  const closeUtilityEditor = () => {
    setEditingUtility(null)
    setUtilityDraft(null)
  }

  const handleSaveUtility = async () => {
    const data = initData()
    const utilityId = editingUtility()
    const draft = utilityDraft()
    if (!data || !utilityId || !draft) return

    setSavingUtility(true)
    try {
      await updateMiniAppUtilityBill(data, {
        billId: utilityId,
        ...draft
      })
      closeUtilityEditor()
      await refreshHouseholdData(true, true)
    } finally {
      setSavingUtility(false)
    }
  }

  const handleDeleteUtility = async () => {
    const data = initData()
    const utilityId = editingUtility()
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

                {/* Add Utility Form */}
                <div class="utility-add-form" style={{ 'margin-top': '16px' }}>
                  <UtilityForm
                    value={newUtility()}
                    onChange={setNewUtility}
                    currencyOptions={currencyOptions()}
                    labels={{
                      category: copy().utilityCategoryLabel,
                      amount: copy().utilityAmount,
                      currency: copy().currencyLabel
                    }}
                    disabled={addingUtility()}
                  />
                  <div style={{ 'margin-top': '12px' }}>
                    <Button
                      variant="primary"
                      loading={addingUtility()}
                      disabled={!newUtility().billName.trim() || !newUtility().amountMajor.trim()}
                      onClick={() => void handleAddUtility()}
                    >
                      <Plus size={16} />
                      {addingUtility() ? copy().savingUtilityBill : copy().addUtilityBillAction}
                    </Button>
                  </div>
                </div>

                {/* Current Cycle Utilities List */}
                <Show
                  when={utilityLedger().length > 0}
                  fallback={
                    <p class="empty-state" style={{ 'margin-top': '16px' }}>
                      {copy().utilityLedgerEmpty}
                    </p>
                  }
                >
                  <div class="utility-list" style={{ 'margin-top': '24px' }}>
                    <h3
                      style={{
                        'font-size': '14px',
                        'font-weight': '600',
                        'margin-bottom': '12px'
                      }}
                    >
                      {copy().currentCycleLabel}
                    </h3>
                    <div class="editable-list">
                      <For each={utilityLedger()}>
                        {(entry) => (
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
                        )}
                      </For>
                    </div>
                  </div>
                </Show>
              </Card>

              {/* Rent Section - Placeholder for now */}
              <Card>
                <div class="card-header">
                  <div>
                    <h2 class="card-title">{copy().shareRent}</h2>
                    <p class="card-subtitle">{copy().currentCycleLabel}</p>
                  </div>
                </div>
                <p class="empty-state">{copy().currentCycleRentLabel}</p>
              </Card>

              {/* Edit Utility Inline Form */}
              <Show when={utilityDraft()}>
                {(draft) => (
                  <Card>
                    <div class="card-header">
                      <h2 class="card-title">{copy().editEntryAction}</h2>
                    </div>
                    <UtilityForm
                      value={draft()}
                      onChange={(value) => setUtilityDraft(value)}
                      currencyOptions={currencyOptions()}
                      labels={{
                        category: copy().utilityCategoryLabel,
                        amount: copy().utilityAmount,
                        currency: copy().currencyLabel
                      }}
                      disabled={savingUtility() || deletingUtility()}
                    />
                    <div style={{ display: 'flex', gap: '12px', 'margin-top': '16px' }}>
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
                      <div style={{ 'margin-left': 'auto' }}>
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
  )
}
