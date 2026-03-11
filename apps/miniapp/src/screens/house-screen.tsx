import { For, Show } from 'solid-js'

import {
  Button,
  CalendarIcon,
  Field,
  IconButton,
  Modal,
  PencilIcon,
  PlusIcon,
  SettingsIcon
} from '../components/ui'
import { NavigationTabs } from '../components/layout/navigation-tabs'
import type {
  MiniAppAdminCycleState,
  MiniAppAdminSettingsPayload,
  MiniAppDashboard,
  MiniAppMemberAbsencePolicy,
  MiniAppPendingMember
} from '../miniapp-api'

type HouseSectionKey = 'billing' | 'utilities' | 'members' | 'topics'

type UtilityBillDraft = {
  billName: string
  amountMajor: string
  currency: 'USD' | 'GEL'
}

type BillingForm = {
  settlementCurrency: 'USD' | 'GEL'
  paymentBalanceAdjustmentPolicy: 'utilities' | 'rent' | 'separate'
  rentAmountMajor: string
  rentCurrency: 'USD' | 'GEL'
  rentDueDay: number
  rentWarningDay: number
  utilitiesDueDay: number
  utilitiesReminderDay: number
  timezone: string
}

type CycleForm = {
  period: string
  rentCurrency: 'USD' | 'GEL'
  utilityCurrency: 'USD' | 'GEL'
  rentAmountMajor: string
  utilityCategorySlug: string
  utilityAmountMajor: string
}

type Props = {
  copy: Record<string, string | undefined>
  readyIsAdmin: boolean
  householdDefaultLocale: 'en' | 'ru'
  dashboard: MiniAppDashboard | null
  adminSettings: MiniAppAdminSettingsPayload | null
  cycleState: MiniAppAdminCycleState | null
  pendingMembers: readonly MiniAppPendingMember[]
  activeHouseSection: HouseSectionKey
  onChangeHouseSection: (section: HouseSectionKey) => void
  billingForm: BillingForm
  cycleForm: CycleForm
  newCategoryName: string
  cycleRentOpen: boolean
  billingSettingsOpen: boolean
  addingUtilityBillOpen: boolean
  editingUtilityBill: MiniAppAdminCycleState['utilityBills'][number] | null
  editingUtilityBillId: string | null
  utilityBillDrafts: Record<string, UtilityBillDraft>
  editingCategorySlug: string | null
  editingCategory: MiniAppAdminSettingsPayload['categories'][number] | null
  editingCategoryDraft: {
    name: string
    isActive: boolean
  } | null
  editingMember: MiniAppAdminSettingsPayload['members'][number] | null
  memberDisplayNameDrafts: Record<string, string>
  memberStatusDrafts: Record<string, 'active' | 'away' | 'left'>
  memberAbsencePolicyDrafts: Record<string, MiniAppMemberAbsencePolicy>
  rentWeightDrafts: Record<string, string>
  openingCycle: boolean
  closingCycle: boolean
  savingCycleRent: boolean
  savingBillingSettings: boolean
  savingUtilityBill: boolean
  savingUtilityBillId: string | null
  deletingUtilityBillId: string | null
  savingCategorySlug: string | null
  approvingTelegramUserId: string | null
  savingMemberEditorId: string | null
  promotingMemberId: string | null
  savingHouseholdLocale: boolean
  minorToMajorString: (value: bigint) => string
  memberStatusLabel: (status: 'active' | 'away' | 'left') => string
  topicRoleLabel: (role: 'purchase' | 'feedback' | 'reminders' | 'payments') => string
  resolvedMemberAbsencePolicy: (
    memberId: string,
    status: 'active' | 'away' | 'left'
  ) => {
    policy: MiniAppMemberAbsencePolicy
    effectiveFromPeriod: string | null
  }
  onChangeHouseholdLocale: (locale: 'en' | 'ru') => Promise<void>
  onOpenCycleModal: () => void
  onCloseCycleModal: () => void
  onSaveCycleRent: () => Promise<void>
  onOpenCycle: () => Promise<void>
  onCloseCycle: () => Promise<void>
  onCycleRentAmountChange: (value: string) => void
  onCycleRentCurrencyChange: (value: 'USD' | 'GEL') => void
  onCyclePeriodChange: (value: string) => void
  onOpenBillingSettingsModal: () => void
  onCloseBillingSettingsModal: () => void
  onSaveBillingSettings: () => Promise<void>
  onBillingSettlementCurrencyChange: (value: 'USD' | 'GEL') => void
  onBillingAdjustmentPolicyChange: (value: 'utilities' | 'rent' | 'separate') => void
  onBillingRentAmountChange: (value: string) => void
  onBillingRentCurrencyChange: (value: 'USD' | 'GEL') => void
  onBillingRentDueDayChange: (value: number) => void
  onBillingRentWarningDayChange: (value: number) => void
  onBillingUtilitiesDueDayChange: (value: number) => void
  onBillingUtilitiesReminderDayChange: (value: number) => void
  onBillingTimezoneChange: (value: string) => void
  onOpenAddUtilityBill: () => void
  onCloseAddUtilityBill: () => void
  onAddUtilityBill: () => Promise<void>
  onCycleUtilityCategoryChange: (value: string) => void
  onCycleUtilityAmountChange: (value: string) => void
  onCycleUtilityCurrencyChange: (value: 'USD' | 'GEL') => void
  onOpenUtilityBillEditor: (billId: string) => void
  onCloseUtilityBillEditor: () => void
  onDeleteUtilityBill: (billId: string) => Promise<void>
  onSaveUtilityBill: (billId: string) => Promise<void>
  onUtilityBillNameChange: (
    billId: string,
    bill: MiniAppAdminCycleState['utilityBills'][number],
    value: string
  ) => void
  onUtilityBillAmountChange: (
    billId: string,
    bill: MiniAppAdminCycleState['utilityBills'][number],
    value: string
  ) => void
  onUtilityBillCurrencyChange: (
    billId: string,
    bill: MiniAppAdminCycleState['utilityBills'][number],
    value: 'USD' | 'GEL'
  ) => void
  onOpenCategoryEditor: (slug: string) => void
  onCloseCategoryEditor: () => void
  onNewCategoryNameChange: (value: string) => void
  onSaveNewCategory: () => Promise<void>
  onSaveExistingCategory: () => Promise<void>
  onEditingCategoryNameChange: (value: string) => void
  onEditingCategoryActiveChange: (value: boolean) => void
  onOpenMemberEditor: (memberId: string) => void
  onCloseMemberEditor: () => void
  onApprovePendingMember: (telegramUserId: string) => Promise<void>
  onMemberDisplayNameDraftChange: (memberId: string, value: string) => void
  onMemberStatusDraftChange: (memberId: string, value: 'active' | 'away' | 'left') => void
  onMemberAbsencePolicyDraftChange: (memberId: string, value: MiniAppMemberAbsencePolicy) => void
  onRentWeightDraftChange: (memberId: string, value: string) => void
  onSaveMemberChanges: (memberId: string) => Promise<void>
  onPromoteMember: (memberId: string) => Promise<void>
}

export function HouseScreen(props: Props) {
  return (
    <Show
      when={props.readyIsAdmin}
      fallback={
        <div class="balance-list">
          <article class="balance-item">
            <header>
              <strong>{props.copy.residentHouseTitle ?? ''}</strong>
            </header>
            <p>{props.copy.residentHouseBody ?? ''}</p>
          </article>
        </div>
      }
    >
      <div class="admin-layout">
        <NavigationTabs
          items={
            [
              { key: 'billing', label: props.copy.houseSectionBilling ?? '' },
              { key: 'utilities', label: props.copy.houseSectionUtilities ?? '' },
              { key: 'members', label: props.copy.houseSectionMembers ?? '' },
              { key: 'topics', label: props.copy.houseSectionTopics ?? '' }
            ] as const
          }
          active={props.activeHouseSection}
          onChange={props.onChangeHouseSection}
        />

        <Show when={props.activeHouseSection === 'billing'}>
          <section class="admin-section">
            <div class="admin-grid">
              <article class="balance-item">
                <header>
                  <strong>{props.copy.billingCycleTitle ?? ''}</strong>
                  <span>
                    {props.cycleState?.cycle?.period ?? props.copy.billingCycleEmpty ?? ''}
                  </span>
                </header>
                <p>
                  {props.cycleState?.cycle
                    ? (props.copy.billingCycleStatus ?? '').replace(
                        '{currency}',
                        props.cycleState?.cycle?.currency ?? props.billingForm.settlementCurrency
                      )
                    : props.copy.billingCycleOpenHint}
                </p>
                <Show when={props.dashboard}>
                  {(data) => (
                    <p>
                      {props.copy.shareRent ?? ''}: {data().rentSourceAmountMajor}{' '}
                      {data().rentSourceCurrency}
                      {data().rentSourceCurrency !== data().currency
                        ? ` -> ${data().rentDisplayAmountMajor} ${data().currency}`
                        : ''}
                    </p>
                  )}
                </Show>
                <div class="panel-toolbar">
                  <Button variant="secondary" onClick={props.onOpenCycleModal}>
                    <CalendarIcon />
                    {props.cycleState?.cycle
                      ? (props.copy.manageCycleAction ?? '')
                      : (props.copy.openCycleAction ?? '')}
                  </Button>
                  <Show when={props.cycleState?.cycle}>
                    <Button
                      variant="ghost"
                      disabled={props.closingCycle}
                      onClick={() => void props.onCloseCycle()}
                    >
                      {props.closingCycle ? props.copy.closingCycle : props.copy.closeCycleAction}
                    </Button>
                  </Show>
                </div>
              </article>

              <article class="balance-item">
                <header>
                  <strong>{props.copy.billingSettingsTitle ?? ''}</strong>
                  <span>{props.billingForm.settlementCurrency}</span>
                </header>
                <p>
                  {props.billingForm.paymentBalanceAdjustmentPolicy === 'utilities'
                    ? props.copy.paymentBalanceAdjustmentUtilities
                    : props.billingForm.paymentBalanceAdjustmentPolicy === 'rent'
                      ? props.copy.paymentBalanceAdjustmentRent
                      : props.copy.paymentBalanceAdjustmentSeparate}
                </p>
                <div class="ledger-compact-card__meta">
                  <span class="mini-chip">
                    {props.copy.rentAmount ?? ''}: {props.billingForm.rentAmountMajor || '—'}{' '}
                    {props.billingForm.rentCurrency}
                  </span>
                  <span class="mini-chip mini-chip--muted">
                    {props.copy.timezone ?? ''}: {props.billingForm.timezone}
                  </span>
                </div>
                <div class="panel-toolbar">
                  <Button variant="secondary" onClick={props.onOpenBillingSettingsModal}>
                    <SettingsIcon />
                    {props.copy.manageSettingsAction ?? ''}
                  </Button>
                </div>
              </article>

              <article class="balance-item">
                <header>
                  <strong>{props.copy.householdLanguage ?? ''}</strong>
                  <span>{props.householdDefaultLocale.toUpperCase()}</span>
                </header>
                <div class="locale-switch__buttons locale-switch__buttons--inline">
                  <button
                    classList={{ 'is-active': props.householdDefaultLocale === 'en' }}
                    type="button"
                    disabled={props.savingHouseholdLocale}
                    onClick={() => void props.onChangeHouseholdLocale('en')}
                  >
                    EN
                  </button>
                  <button
                    classList={{ 'is-active': props.householdDefaultLocale === 'ru' }}
                    type="button"
                    disabled={props.savingHouseholdLocale}
                    onClick={() => void props.onChangeHouseholdLocale('ru')}
                  >
                    RU
                  </button>
                </div>
              </article>
            </div>
            <Modal
              open={props.cycleRentOpen}
              title={props.copy.billingCycleTitle ?? ''}
              description={props.copy.cycleEditorBody ?? ''}
              closeLabel={props.copy.closeEditorAction ?? ''}
              onClose={props.onCloseCycleModal}
              footer={
                props.cycleState?.cycle ? (
                  <div class="modal-action-row modal-action-row--single">
                    <Button variant="ghost" onClick={props.onCloseCycleModal}>
                      {props.copy.closeEditorAction ?? ''}
                    </Button>
                    <Button
                      variant="primary"
                      disabled={
                        props.savingCycleRent || props.cycleForm.rentAmountMajor.trim().length === 0
                      }
                      onClick={() => void props.onSaveCycleRent()}
                    >
                      {props.savingCycleRent
                        ? props.copy.savingCycleRent
                        : props.copy.saveCycleRentAction}
                    </Button>
                  </div>
                ) : (
                  <div class="modal-action-row modal-action-row--single">
                    <Button variant="ghost" onClick={props.onCloseCycleModal}>
                      {props.copy.closeEditorAction ?? ''}
                    </Button>
                    <Button
                      variant="primary"
                      disabled={props.openingCycle}
                      onClick={() => void props.onOpenCycle()}
                    >
                      {props.openingCycle ? props.copy.openingCycle : props.copy.openCycleAction}
                    </Button>
                  </div>
                )
              }
            >
              {props.cycleState?.cycle ? (
                <div class="editor-grid">
                  <Field label={props.copy.rentAmount ?? ''}>
                    <input
                      value={props.cycleForm.rentAmountMajor}
                      onInput={(event) => props.onCycleRentAmountChange(event.currentTarget.value)}
                    />
                  </Field>
                  <Field label={props.copy.shareRent ?? ''}>
                    <select
                      value={props.cycleForm.rentCurrency}
                      onChange={(event) =>
                        props.onCycleRentCurrencyChange(event.currentTarget.value as 'USD' | 'GEL')
                      }
                    >
                      <option value="USD">USD</option>
                      <option value="GEL">GEL</option>
                    </select>
                  </Field>
                </div>
              ) : (
                <div class="editor-grid">
                  <Field label={props.copy.billingCyclePeriod ?? ''}>
                    <input
                      value={props.cycleForm.period}
                      onInput={(event) => props.onCyclePeriodChange(event.currentTarget.value)}
                    />
                  </Field>
                  <Field label={props.copy.settlementCurrency ?? ''}>
                    <div class="settings-field__value">{props.billingForm.settlementCurrency}</div>
                  </Field>
                </div>
              )}
            </Modal>
            <Modal
              open={props.billingSettingsOpen}
              title={props.copy.billingSettingsTitle ?? ''}
              description={props.copy.billingSettingsEditorBody ?? ''}
              closeLabel={props.copy.closeEditorAction ?? ''}
              onClose={props.onCloseBillingSettingsModal}
              footer={
                <div class="modal-action-row modal-action-row--single">
                  <Button variant="ghost" onClick={props.onCloseBillingSettingsModal}>
                    {props.copy.closeEditorAction ?? ''}
                  </Button>
                  <Button
                    variant="primary"
                    disabled={props.savingBillingSettings}
                    onClick={() => void props.onSaveBillingSettings()}
                  >
                    {props.savingBillingSettings
                      ? props.copy.savingSettings
                      : props.copy.saveSettingsAction}
                  </Button>
                </div>
              }
            >
              <div class="editor-grid">
                <Field label={props.copy.settlementCurrency ?? ''}>
                  <select
                    value={props.billingForm.settlementCurrency}
                    onChange={(event) =>
                      props.onBillingSettlementCurrencyChange(
                        event.currentTarget.value as 'USD' | 'GEL'
                      )
                    }
                  >
                    <option value="GEL">GEL</option>
                    <option value="USD">USD</option>
                  </select>
                </Field>
                <Field label={props.copy.paymentBalanceAdjustmentPolicy ?? ''} wide>
                  <select
                    value={props.billingForm.paymentBalanceAdjustmentPolicy}
                    onChange={(event) =>
                      props.onBillingAdjustmentPolicyChange(
                        event.currentTarget.value as 'utilities' | 'rent' | 'separate'
                      )
                    }
                  >
                    <option value="utilities">
                      {props.copy.paymentBalanceAdjustmentUtilities}
                    </option>
                    <option value="rent">{props.copy.paymentBalanceAdjustmentRent}</option>
                    <option value="separate">{props.copy.paymentBalanceAdjustmentSeparate}</option>
                  </select>
                </Field>
                <Field label={props.copy.rentAmount ?? ''}>
                  <input
                    value={props.billingForm.rentAmountMajor}
                    onInput={(event) => props.onBillingRentAmountChange(event.currentTarget.value)}
                  />
                </Field>
                <Field label={props.copy.shareRent ?? ''}>
                  <select
                    value={props.billingForm.rentCurrency}
                    onChange={(event) =>
                      props.onBillingRentCurrencyChange(event.currentTarget.value as 'USD' | 'GEL')
                    }
                  >
                    <option value="USD">USD</option>
                    <option value="GEL">GEL</option>
                  </select>
                </Field>
                <Field label={props.copy.rentDueDay ?? ''}>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={String(props.billingForm.rentDueDay)}
                    onInput={(event) =>
                      props.onBillingRentDueDayChange(Number(event.currentTarget.value))
                    }
                  />
                </Field>
                <Field label={props.copy.rentWarningDay ?? ''}>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={String(props.billingForm.rentWarningDay)}
                    onInput={(event) =>
                      props.onBillingRentWarningDayChange(Number(event.currentTarget.value))
                    }
                  />
                </Field>
                <Field label={props.copy.utilitiesDueDay ?? ''}>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={String(props.billingForm.utilitiesDueDay)}
                    onInput={(event) =>
                      props.onBillingUtilitiesDueDayChange(Number(event.currentTarget.value))
                    }
                  />
                </Field>
                <Field label={props.copy.utilitiesReminderDay ?? ''}>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={String(props.billingForm.utilitiesReminderDay)}
                    onInput={(event) =>
                      props.onBillingUtilitiesReminderDayChange(Number(event.currentTarget.value))
                    }
                  />
                </Field>
                <Field label={props.copy.timezone ?? ''} wide>
                  <input
                    value={props.billingForm.timezone}
                    onInput={(event) => props.onBillingTimezoneChange(event.currentTarget.value)}
                  />
                </Field>
              </div>
            </Modal>
          </section>
        </Show>

        <Show when={props.activeHouseSection === 'utilities'}>
          <section class="admin-section">
            <div class="admin-grid">
              <article class="balance-item">
                <header>
                  <strong>{props.copy.utilityLedgerTitle ?? ''}</strong>
                  <span>{props.cycleForm.utilityCurrency}</span>
                </header>
                <p>{props.copy.utilityBillsEditorBody ?? ''}</p>
                <div class="panel-toolbar">
                  <Button variant="secondary" onClick={props.onOpenAddUtilityBill}>
                    <PlusIcon />
                    {props.copy.addUtilityBillAction ?? ''}
                  </Button>
                </div>
                <div class="ledger-list">
                  {props.cycleState?.utilityBills.length ? (
                    <For each={props.cycleState?.utilityBills ?? []}>
                      {(bill) => (
                        <article class="ledger-compact-card">
                          <div class="ledger-compact-card__main">
                            <header>
                              <strong>{bill.billName}</strong>
                              <span>{bill.createdAt.slice(0, 10)}</span>
                            </header>
                            <p>{props.copy.utilityCategoryName ?? ''}</p>
                            <div class="ledger-compact-card__meta">
                              <span class="mini-chip">
                                {props.minorToMajorString(BigInt(bill.amountMinor))} {bill.currency}
                              </span>
                            </div>
                          </div>
                          <div class="ledger-compact-card__actions">
                            <IconButton
                              label={props.copy.editUtilityBillAction ?? ''}
                              onClick={() => props.onOpenUtilityBillEditor(bill.id)}
                            >
                              <PencilIcon />
                            </IconButton>
                          </div>
                        </article>
                      )}
                    </For>
                  ) : (
                    <p>{props.copy.utilityBillsEmpty ?? ''}</p>
                  )}
                </div>
              </article>

              <article class="balance-item">
                <header>
                  <strong>{props.copy.utilityCategoriesTitle ?? ''}</strong>
                  <span>{String(props.adminSettings?.categories.length ?? 0)}</span>
                </header>
                <p>{props.copy.utilityCategoriesBody ?? ''}</p>
                <div class="panel-toolbar">
                  <Button variant="secondary" onClick={() => props.onOpenCategoryEditor('__new__')}>
                    <PlusIcon />
                    {props.copy.addCategoryAction ?? ''}
                  </Button>
                </div>
                <div class="ledger-list">
                  <For each={props.adminSettings?.categories ?? []}>
                    {(category) => (
                      <article class="ledger-compact-card">
                        <div class="ledger-compact-card__main">
                          <header>
                            <strong>{category.name}</strong>
                            <span>{category.isActive ? 'ON' : 'OFF'}</span>
                          </header>
                          <p>{props.copy.utilityCategoryName ?? ''}</p>
                          <div class="ledger-compact-card__meta">
                            <span
                              class={`mini-chip ${category.isActive ? '' : 'mini-chip--muted'}`}
                            >
                              {category.isActive ? 'ON' : 'OFF'}
                            </span>
                          </div>
                        </div>
                        <div class="ledger-compact-card__actions">
                          <IconButton
                            label={props.copy.editCategoryAction ?? ''}
                            onClick={() => props.onOpenCategoryEditor(category.slug)}
                          >
                            <PencilIcon />
                          </IconButton>
                        </div>
                      </article>
                    )}
                  </For>
                </div>
              </article>
            </div>
            <Modal
              open={props.addingUtilityBillOpen}
              title={props.copy.addUtilityBillAction ?? ''}
              description={props.copy.utilityBillCreateBody ?? ''}
              closeLabel={props.copy.closeEditorAction ?? ''}
              onClose={props.onCloseAddUtilityBill}
              footer={
                <div class="modal-action-row modal-action-row--single">
                  <Button variant="ghost" onClick={props.onCloseAddUtilityBill}>
                    {props.copy.closeEditorAction ?? ''}
                  </Button>
                  <Button
                    variant="primary"
                    disabled={
                      props.savingUtilityBill ||
                      props.cycleForm.utilityAmountMajor.trim().length === 0
                    }
                    onClick={() => void props.onAddUtilityBill()}
                  >
                    {props.savingUtilityBill
                      ? props.copy.savingUtilityBill
                      : props.copy.addUtilityBillAction}
                  </Button>
                </div>
              }
            >
              <div class="editor-grid">
                <Field label={props.copy.utilityCategoryLabel ?? ''}>
                  <select
                    value={props.cycleForm.utilityCategorySlug}
                    onChange={(event) =>
                      props.onCycleUtilityCategoryChange(event.currentTarget.value)
                    }
                  >
                    <For
                      each={(props.adminSettings?.categories ?? []).filter(
                        (category) => category.isActive
                      )}
                    >
                      {(category) => <option value={category.slug}>{category.name}</option>}
                    </For>
                  </select>
                </Field>
                <Field label={props.copy.utilityAmount ?? ''}>
                  <input
                    value={props.cycleForm.utilityAmountMajor}
                    onInput={(event) => props.onCycleUtilityAmountChange(event.currentTarget.value)}
                  />
                </Field>
                <Field label={props.copy.settlementCurrency ?? ''}>
                  <select
                    value={props.cycleForm.utilityCurrency}
                    onChange={(event) =>
                      props.onCycleUtilityCurrencyChange(event.currentTarget.value as 'USD' | 'GEL')
                    }
                  >
                    <option value="GEL">GEL</option>
                    <option value="USD">USD</option>
                  </select>
                </Field>
              </div>
            </Modal>
            <Modal
              open={Boolean(props.editingUtilityBill)}
              title={props.copy.utilityLedgerTitle ?? ''}
              description={props.copy.utilityBillEditorBody ?? ''}
              closeLabel={props.copy.closeEditorAction ?? ''}
              onClose={props.onCloseUtilityBillEditor}
              footer={(() => {
                const bill = props.editingUtilityBill
                if (!bill) {
                  return null
                }
                return (
                  <div class="modal-action-row">
                    <Button
                      variant="danger"
                      onClick={() => void props.onDeleteUtilityBill(bill.id)}
                    >
                      {props.deletingUtilityBillId === bill.id
                        ? props.copy.deletingUtilityBill
                        : props.copy.deleteUtilityBillAction}
                    </Button>
                    <div class="modal-action-row__primary">
                      <Button variant="ghost" onClick={props.onCloseUtilityBillEditor}>
                        {props.copy.closeEditorAction ?? ''}
                      </Button>
                      <Button
                        variant="primary"
                        disabled={props.savingUtilityBillId === bill.id}
                        onClick={() => void props.onSaveUtilityBill(bill.id)}
                      >
                        {props.savingUtilityBillId === bill.id
                          ? props.copy.savingUtilityBill
                          : props.copy.saveUtilityBillAction}
                      </Button>
                    </div>
                  </div>
                )
              })()}
            >
              {(() => {
                const bill = props.editingUtilityBill
                if (!bill) {
                  return null
                }
                const draft = props.utilityBillDrafts[bill.id] ?? {
                  billName: bill.billName,
                  amountMajor: props.minorToMajorString(BigInt(bill.amountMinor)),
                  currency: bill.currency
                }

                return (
                  <div class="editor-grid">
                    <Field label={props.copy.utilityCategoryName ?? ''} wide>
                      <input
                        value={draft.billName}
                        onInput={(event) =>
                          props.onUtilityBillNameChange(bill.id, bill, event.currentTarget.value)
                        }
                      />
                    </Field>
                    <Field label={props.copy.utilityAmount ?? ''}>
                      <input
                        value={draft.amountMajor}
                        onInput={(event) =>
                          props.onUtilityBillAmountChange(bill.id, bill, event.currentTarget.value)
                        }
                      />
                    </Field>
                    <Field label={props.copy.settlementCurrency ?? ''}>
                      <select
                        value={draft.currency}
                        onChange={(event) =>
                          props.onUtilityBillCurrencyChange(
                            bill.id,
                            bill,
                            event.currentTarget.value as 'USD' | 'GEL'
                          )
                        }
                      >
                        <option value="GEL">GEL</option>
                        <option value="USD">USD</option>
                      </select>
                    </Field>
                  </div>
                )
              })()}
            </Modal>
            <Modal
              open={Boolean(props.editingCategorySlug)}
              title={
                props.editingCategorySlug === '__new__'
                  ? (props.copy.addCategoryAction ?? '')
                  : (props.copy.utilityCategoriesTitle ?? '')
              }
              description={
                props.editingCategorySlug === '__new__'
                  ? (props.copy.categoryCreateBody ?? '')
                  : (props.copy.categoryEditorBody ?? '')
              }
              closeLabel={props.copy.closeEditorAction ?? ''}
              onClose={props.onCloseCategoryEditor}
              footer={(() => {
                const category = props.editingCategory
                const isNew = props.editingCategorySlug === '__new__'
                return (
                  <div class="modal-action-row modal-action-row--single">
                    <Button variant="ghost" onClick={props.onCloseCategoryEditor}>
                      {props.copy.closeEditorAction ?? ''}
                    </Button>
                    <Button
                      variant="primary"
                      disabled={
                        isNew
                          ? props.newCategoryName.trim().length === 0 ||
                            props.savingCategorySlug === '__new__'
                          : !category || props.savingCategorySlug === category.slug
                      }
                      onClick={() =>
                        void (isNew ? props.onSaveNewCategory() : props.onSaveExistingCategory())
                      }
                    >
                      {props.savingCategorySlug === (isNew ? '__new__' : (category?.slug ?? null))
                        ? props.copy.savingCategory
                        : isNew
                          ? props.copy.addCategoryAction
                          : props.copy.saveCategoryAction}
                    </Button>
                  </div>
                )
              })()}
            >
              {props.editingCategorySlug === '__new__' ? (
                <div class="editor-grid">
                  <Field label={props.copy.utilityCategoryName ?? ''} wide>
                    <input
                      value={props.newCategoryName}
                      onInput={(event) => props.onNewCategoryNameChange(event.currentTarget.value)}
                    />
                  </Field>
                </div>
              ) : (
                (() => {
                  const category = props.editingCategory
                  const draft = props.editingCategoryDraft
                  if (!category || !draft) {
                    return null
                  }
                  return (
                    <div class="editor-grid">
                      <Field label={props.copy.utilityCategoryName ?? ''} wide>
                        <input
                          value={draft.name}
                          onInput={(event) =>
                            props.onEditingCategoryNameChange(event.currentTarget.value)
                          }
                        />
                      </Field>
                      <Field label={props.copy.utilityCategoryActive ?? ''}>
                        <select
                          value={draft.isActive ? 'true' : 'false'}
                          onChange={(event) =>
                            props.onEditingCategoryActiveChange(
                              event.currentTarget.value === 'true'
                            )
                          }
                        >
                          <option value="true">ON</option>
                          <option value="false">OFF</option>
                        </select>
                      </Field>
                    </div>
                  )
                })()
              )}
            </Modal>
          </section>
        </Show>

        <Show when={props.activeHouseSection === 'members'}>
          <section class="admin-section">
            <div class="admin-grid">
              <article class="balance-item admin-card--wide">
                <header>
                  <strong>{props.copy.adminsTitle ?? ''}</strong>
                  <span>{String(props.adminSettings?.members.length ?? 0)}</span>
                </header>
                <div class="ledger-list">
                  <For each={props.adminSettings?.members ?? []}>
                    {(member) => (
                      <article class="ledger-compact-card">
                        <div class="ledger-compact-card__main">
                          <header>
                            <strong>{member.displayName}</strong>
                            <span>
                              {member.isAdmin ? props.copy.adminTag : props.copy.residentTag}
                            </span>
                          </header>
                          <p>{props.memberStatusLabel(member.status)}</p>
                          <div class="ledger-compact-card__meta">
                            <span class="mini-chip">
                              {props.copy.rentWeightLabel}: {member.rentShareWeight}
                            </span>
                            <span class="mini-chip mini-chip--muted">
                              {(() => {
                                const policy = props.resolvedMemberAbsencePolicy(
                                  member.id,
                                  member.status
                                ).policy
                                return policy === 'away_rent_only'
                                  ? props.copy.absencePolicyAwayRentOnly
                                  : policy === 'away_rent_and_utilities'
                                    ? props.copy.absencePolicyAwayRentAndUtilities
                                    : policy === 'inactive'
                                      ? props.copy.absencePolicyInactive
                                      : props.copy.absencePolicyResident
                              })()}
                            </span>
                          </div>
                        </div>
                        <div class="ledger-compact-card__actions">
                          <IconButton
                            label={props.copy.editMemberAction ?? ''}
                            onClick={() => props.onOpenMemberEditor(member.id)}
                          >
                            <PencilIcon />
                          </IconButton>
                        </div>
                      </article>
                    )}
                  </For>
                </div>
              </article>

              <article class="balance-item">
                <header>
                  <strong>{props.copy.pendingMembersTitle ?? ''}</strong>
                  <span>{String(props.pendingMembers.length)}</span>
                </header>
                <p>{props.copy.pendingMembersBody ?? ''}</p>
                {props.pendingMembers.length === 0 ? (
                  <p>{props.copy.pendingMembersEmpty ?? ''}</p>
                ) : (
                  <div class="admin-sublist admin-sublist--plain">
                    <For each={props.pendingMembers}>
                      {(member) => (
                        <article class="ledger-item">
                          <header>
                            <strong>{member.displayName}</strong>
                            <span>{member.telegramUserId}</span>
                          </header>
                          <p>
                            {member.username
                              ? (props.copy.pendingMemberHandle ?? '').replace(
                                  '{username}',
                                  member.username
                                )
                              : (member.languageCode ?? 'Telegram')}
                          </p>
                          <button
                            class="ghost-button"
                            type="button"
                            disabled={props.approvingTelegramUserId === member.telegramUserId}
                            onClick={() => void props.onApprovePendingMember(member.telegramUserId)}
                          >
                            {props.approvingTelegramUserId === member.telegramUserId
                              ? props.copy.approvingMember
                              : props.copy.approveMemberAction}
                          </button>
                        </article>
                      )}
                    </For>
                  </div>
                )}
              </article>
            </div>
            <Modal
              open={Boolean(props.editingMember)}
              title={props.copy.adminsTitle ?? ''}
              description={props.copy.memberEditorBody ?? ''}
              closeLabel={props.copy.closeEditorAction ?? ''}
              onClose={props.onCloseMemberEditor}
              footer={(() => {
                const member = props.editingMember
                if (!member) {
                  return null
                }

                const nextDisplayName =
                  props.memberDisplayNameDrafts[member.id]?.trim() ?? member.displayName
                const nextStatus = props.memberStatusDrafts[member.id] ?? member.status
                const currentPolicy = props.resolvedMemberAbsencePolicy(member.id, member.status)
                const nextPolicy =
                  props.memberAbsencePolicyDrafts[member.id] ?? currentPolicy.policy
                const nextWeight = Number(
                  props.rentWeightDrafts[member.id] ?? String(member.rentShareWeight)
                )
                const hasNameChange =
                  nextDisplayName.length >= 2 && nextDisplayName !== member.displayName
                const hasStatusChange = nextStatus !== member.status
                const hasPolicyChange = nextStatus === 'away' && nextPolicy !== currentPolicy.policy
                const hasWeightChange =
                  Number.isInteger(nextWeight) &&
                  nextWeight > 0 &&
                  nextWeight !== member.rentShareWeight
                const canSave =
                  props.savingMemberEditorId !== member.id &&
                  (hasNameChange || hasStatusChange || hasPolicyChange || hasWeightChange)

                return (
                  <div class="member-editor-actions">
                    <Button
                      variant="ghost"
                      class="member-editor-actions__close"
                      onClick={props.onCloseMemberEditor}
                    >
                      {props.copy.closeEditorAction ?? ''}
                    </Button>
                    <div class="member-editor-actions__grid">
                      <Button
                        variant="primary"
                        class="member-editor-actions__button"
                        disabled={!canSave}
                        onClick={() => void props.onSaveMemberChanges(member.id)}
                      >
                        {props.savingMemberEditorId === member.id
                          ? props.copy.savingSettings
                          : props.copy.saveMemberChangesAction}
                      </Button>
                      <Show when={!member.isAdmin}>
                        <Button
                          variant="secondary"
                          class="member-editor-actions__button"
                          disabled={props.promotingMemberId === member.id}
                          onClick={() => void props.onPromoteMember(member.id)}
                        >
                          {props.promotingMemberId === member.id
                            ? props.copy.promotingAdmin
                            : props.copy.promoteAdminAction}
                        </Button>
                      </Show>
                    </div>
                  </div>
                )
              })()}
            >
              {(() => {
                const member = props.editingMember
                if (!member) {
                  return null
                }

                const resolvedPolicy = props.resolvedMemberAbsencePolicy(member.id, member.status)

                return (
                  <div class="editor-grid">
                    <Field
                      label={props.copy.displayNameLabel ?? ''}
                      hint={props.copy.displayNameHint ?? ''}
                      wide
                    >
                      <input
                        value={props.memberDisplayNameDrafts[member.id] ?? member.displayName}
                        onInput={(event) =>
                          props.onMemberDisplayNameDraftChange(member.id, event.currentTarget.value)
                        }
                      />
                    </Field>
                    <Field label={props.copy.memberStatusLabel ?? ''} wide>
                      <select
                        value={props.memberStatusDrafts[member.id] ?? member.status}
                        onChange={(event) =>
                          props.onMemberStatusDraftChange(
                            member.id,
                            event.currentTarget.value as 'active' | 'away' | 'left'
                          )
                        }
                      >
                        <option value="active">{props.copy.memberStatusActive ?? ''}</option>
                        <option value="away">{props.copy.memberStatusAway ?? ''}</option>
                        <option value="left">{props.copy.memberStatusLeft ?? ''}</option>
                      </select>
                    </Field>
                    <Field
                      label={props.copy.absencePolicyLabel ?? ''}
                      hint={
                        resolvedPolicy.effectiveFromPeriod
                          ? (props.copy.absencePolicyEffectiveFrom ?? '').replace(
                              '{period}',
                              resolvedPolicy.effectiveFromPeriod
                            )
                          : (props.copy.absencePolicyHint ?? '')
                      }
                      wide
                    >
                      <select
                        value={props.memberAbsencePolicyDrafts[member.id] ?? resolvedPolicy.policy}
                        disabled={(props.memberStatusDrafts[member.id] ?? member.status) !== 'away'}
                        onChange={(event) =>
                          props.onMemberAbsencePolicyDraftChange(
                            member.id,
                            event.currentTarget.value as MiniAppMemberAbsencePolicy
                          )
                        }
                      >
                        <option value="away_rent_and_utilities">
                          {props.copy.absencePolicyAwayRentAndUtilities ?? ''}
                        </option>
                        <option value="away_rent_only">
                          {props.copy.absencePolicyAwayRentOnly ?? ''}
                        </option>
                        <option value="inactive">{props.copy.absencePolicyInactive ?? ''}</option>
                        <option value="resident">{props.copy.absencePolicyResident ?? ''}</option>
                      </select>
                    </Field>
                    <Field label={props.copy.rentWeightLabel ?? ''} wide>
                      <input
                        inputMode="numeric"
                        value={props.rentWeightDrafts[member.id] ?? String(member.rentShareWeight)}
                        onInput={(event) =>
                          props.onRentWeightDraftChange(member.id, event.currentTarget.value)
                        }
                      />
                    </Field>
                  </div>
                )
              })()}
            </Modal>
          </section>
        </Show>

        <Show when={props.activeHouseSection === 'topics'}>
          <section class="admin-section">
            <div class="admin-grid">
              <article class="balance-item admin-card--wide">
                <header>
                  <strong>{props.copy.topicBindingsTitle ?? ''}</strong>
                  <span>{String(props.adminSettings?.topics.length ?? 0)}/4</span>
                </header>
                <div class="balance-list admin-sublist">
                  <For each={['purchase', 'feedback', 'reminders', 'payments'] as const}>
                    {(role) => {
                      const binding = props.adminSettings?.topics.find(
                        (topic) => topic.role === role
                      )

                      return (
                        <article class="ledger-item">
                          <header>
                            <strong>{props.topicRoleLabel(role)}</strong>
                            <span>{binding ? props.copy.topicBound : props.copy.topicUnbound}</span>
                          </header>
                          <p>
                            {binding
                              ? `${binding.topicName ?? `Topic #${binding.telegramThreadId}`} · #${binding.telegramThreadId}`
                              : props.copy.topicUnbound}
                          </p>
                        </article>
                      )
                    }}
                  </For>
                </div>
              </article>
            </div>
          </section>
        </Show>
      </div>
    </Show>
  )
}
