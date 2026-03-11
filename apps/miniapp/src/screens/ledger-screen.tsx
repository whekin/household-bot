import { For, Show } from 'solid-js'

import { Button, Field, IconButton, Modal } from '../components/ui'
import type { MiniAppAdminSettingsPayload, MiniAppDashboard } from '../miniapp-api'

type PurchaseDraft = {
  description: string
  amountMajor: string
  currency: 'USD' | 'GEL'
  splitMode: 'equal' | 'custom_amounts'
  participants: {
    memberId: string
    shareAmountMajor: string
  }[]
}

type PaymentDraft = {
  memberId: string
  kind: 'rent' | 'utilities'
  amountMajor: string
  currency: 'USD' | 'GEL'
}

type Props = {
  copy: Record<string, string | undefined>
  dashboard: MiniAppDashboard | null
  readyIsAdmin: boolean
  adminMembers: readonly MiniAppAdminSettingsPayload['members'][number][]
  purchaseEntries: readonly MiniAppDashboard['ledger'][number][]
  utilityEntries: readonly MiniAppDashboard['ledger'][number][]
  paymentEntries: readonly MiniAppDashboard['ledger'][number][]
  editingPurchaseEntry: MiniAppDashboard['ledger'][number] | null
  editingPaymentEntry: MiniAppDashboard['ledger'][number] | null
  purchaseDraftMap: Record<string, PurchaseDraft>
  paymentDraftMap: Record<string, PaymentDraft>
  paymentForm: PaymentDraft
  addingPaymentOpen: boolean
  savingPurchaseId: string | null
  deletingPurchaseId: string | null
  savingPaymentId: string | null
  deletingPaymentId: string | null
  addingPayment: boolean
  ledgerTitle: (entry: MiniAppDashboard['ledger'][number]) => string
  ledgerPrimaryAmount: (entry: MiniAppDashboard['ledger'][number]) => string
  ledgerSecondaryAmount: (entry: MiniAppDashboard['ledger'][number]) => string | null
  purchaseParticipantSummary: (entry: MiniAppDashboard['ledger'][number]) => string
  purchaseDraftForEntry: (entry: MiniAppDashboard['ledger'][number]) => PurchaseDraft
  paymentDraftForEntry: (entry: MiniAppDashboard['ledger'][number]) => PaymentDraft
  purchaseSplitPreview: (purchaseId: string) => { memberId: string; amountMajor: string }[]
  paymentMemberName: (entry: MiniAppDashboard['ledger'][number]) => string
  onOpenPurchaseEditor: (purchaseId: string) => void
  onClosePurchaseEditor: () => void
  onDeletePurchase: (purchaseId: string) => Promise<void>
  onSavePurchase: (purchaseId: string) => Promise<void>
  onPurchaseDescriptionChange: (
    purchaseId: string,
    entry: MiniAppDashboard['ledger'][number],
    value: string
  ) => void
  onPurchaseAmountChange: (
    purchaseId: string,
    entry: MiniAppDashboard['ledger'][number],
    value: string
  ) => void
  onPurchaseCurrencyChange: (
    purchaseId: string,
    entry: MiniAppDashboard['ledger'][number],
    value: 'USD' | 'GEL'
  ) => void
  onPurchaseSplitModeChange: (
    purchaseId: string,
    entry: MiniAppDashboard['ledger'][number],
    value: 'equal' | 'custom_amounts'
  ) => void
  onTogglePurchaseParticipant: (
    purchaseId: string,
    entry: MiniAppDashboard['ledger'][number],
    memberId: string,
    included: boolean
  ) => void
  onPurchaseParticipantShareChange: (
    purchaseId: string,
    entry: MiniAppDashboard['ledger'][number],
    memberId: string,
    value: string
  ) => void
  onOpenAddPayment: () => void
  onCloseAddPayment: () => void
  onAddPayment: () => Promise<void>
  onPaymentFormMemberChange: (value: string) => void
  onPaymentFormKindChange: (value: 'rent' | 'utilities') => void
  onPaymentFormAmountChange: (value: string) => void
  onPaymentFormCurrencyChange: (value: 'USD' | 'GEL') => void
  onOpenPaymentEditor: (paymentId: string) => void
  onClosePaymentEditor: () => void
  onDeletePayment: (paymentId: string) => Promise<void>
  onSavePayment: (paymentId: string) => Promise<void>
  onPaymentDraftMemberChange: (
    paymentId: string,
    entry: MiniAppDashboard['ledger'][number],
    value: string
  ) => void
  onPaymentDraftKindChange: (
    paymentId: string,
    entry: MiniAppDashboard['ledger'][number],
    value: 'rent' | 'utilities'
  ) => void
  onPaymentDraftAmountChange: (
    paymentId: string,
    entry: MiniAppDashboard['ledger'][number],
    value: string
  ) => void
  onPaymentDraftCurrencyChange: (
    paymentId: string,
    entry: MiniAppDashboard['ledger'][number],
    value: 'USD' | 'GEL'
  ) => void
}

export function LedgerScreen(props: Props) {
  if (!props.dashboard) {
    return (
      <div class="ledger-list">
        <p>{props.copy.emptyDashboard ?? ''}</p>
      </div>
    )
  }

  return (
    <div class="ledger-list">
      <article class="balance-item">
        <header>
          <strong>
            {props.readyIsAdmin ? props.copy.purchaseReviewTitle : props.copy.purchasesTitle}
          </strong>
        </header>
        <Show when={props.readyIsAdmin}>
          <p>{props.copy.purchaseReviewBody ?? ''}</p>
        </Show>
        {props.purchaseEntries.length === 0 ? (
          <p>{props.copy.purchasesEmpty ?? ''}</p>
        ) : (
          <div class="ledger-list">
            <For each={props.purchaseEntries}>
              {(entry) => (
                <article class="ledger-compact-card">
                  <div class="ledger-compact-card__main">
                    <header>
                      <strong>{entry.title}</strong>
                      <span>{entry.occurredAt?.slice(0, 10) ?? '—'}</span>
                    </header>
                    <p>{entry.actorDisplayName ?? props.copy.ledgerActorFallback ?? ''}</p>
                    <div class="ledger-compact-card__meta">
                      <span class="mini-chip">{props.ledgerPrimaryAmount(entry)}</span>
                      <Show when={props.ledgerSecondaryAmount(entry)}>
                        {(secondary) => (
                          <span class="mini-chip mini-chip--muted">{secondary()}</span>
                        )}
                      </Show>
                      <span class="mini-chip mini-chip--muted">
                        {props.purchaseParticipantSummary(entry)}
                      </span>
                    </div>
                  </div>
                  <Show when={props.readyIsAdmin}>
                    <div class="ledger-compact-card__actions">
                      <IconButton
                        label={props.copy.editEntryAction ?? ''}
                        onClick={() => props.onOpenPurchaseEditor(entry.id)}
                      >
                        ...
                      </IconButton>
                    </div>
                  </Show>
                </article>
              )}
            </For>
          </div>
        )}
      </article>
      <Modal
        open={Boolean(props.editingPurchaseEntry)}
        title={props.copy.purchaseReviewTitle ?? ''}
        description={props.copy.purchaseEditorBody ?? ''}
        closeLabel={props.copy.closeEditorAction ?? ''}
        onClose={props.onClosePurchaseEditor}
        footer={(() => {
          const entry = props.editingPurchaseEntry

          if (!entry) {
            return null
          }

          return (
            <div class="modal-action-row">
              <Button variant="danger" onClick={() => void props.onDeletePurchase(entry.id)}>
                {props.deletingPurchaseId === entry.id
                  ? props.copy.deletingPurchase
                  : props.copy.purchaseDeleteAction}
              </Button>
              <div class="modal-action-row__primary">
                <Button variant="ghost" onClick={props.onClosePurchaseEditor}>
                  {props.copy.closeEditorAction ?? ''}
                </Button>
                <Button
                  variant="primary"
                  disabled={props.savingPurchaseId === entry.id}
                  onClick={() => void props.onSavePurchase(entry.id)}
                >
                  {props.savingPurchaseId === entry.id
                    ? props.copy.savingPurchase
                    : props.copy.purchaseSaveAction}
                </Button>
              </div>
            </div>
          )
        })()}
      >
        {(() => {
          const entry = props.editingPurchaseEntry

          if (!entry) {
            return null
          }

          const draft = props.purchaseDraftMap[entry.id] ?? props.purchaseDraftForEntry(entry)
          const splitPreview = props.purchaseSplitPreview(entry.id)

          return (
            <>
              <div class="editor-grid">
                <Field label={props.copy.purchaseReviewTitle ?? ''} wide>
                  <input
                    value={draft.description}
                    onInput={(event) =>
                      props.onPurchaseDescriptionChange(entry.id, entry, event.currentTarget.value)
                    }
                  />
                </Field>
                <Field label={props.copy.paymentAmount ?? ''}>
                  <input
                    value={draft.amountMajor}
                    onInput={(event) =>
                      props.onPurchaseAmountChange(entry.id, entry, event.currentTarget.value)
                    }
                  />
                </Field>
                <Field label={props.copy.settlementCurrency ?? ''}>
                  <select
                    value={draft.currency}
                    onChange={(event) =>
                      props.onPurchaseCurrencyChange(
                        entry.id,
                        entry,
                        event.currentTarget.value as 'USD' | 'GEL'
                      )
                    }
                  >
                    <option value="GEL">GEL</option>
                    <option value="USD">USD</option>
                  </select>
                </Field>
              </div>

              <section class="editor-panel">
                <header class="editor-panel__header">
                  <strong>{props.copy.purchaseSplitTitle ?? ''}</strong>
                  <span>
                    {draft.splitMode === 'custom_amounts'
                      ? props.copy.purchaseSplitCustom
                      : props.copy.purchaseSplitEqual}
                  </span>
                </header>
                <div class="editor-grid">
                  <Field label={props.copy.purchaseSplitModeLabel ?? ''} wide>
                    <select
                      value={draft.splitMode}
                      onChange={(event) =>
                        props.onPurchaseSplitModeChange(
                          entry.id,
                          entry,
                          event.currentTarget.value as 'equal' | 'custom_amounts'
                        )
                      }
                    >
                      <option value="equal">{props.copy.purchaseSplitEqual ?? ''}</option>
                      <option value="custom_amounts">{props.copy.purchaseSplitCustom ?? ''}</option>
                    </select>
                  </Field>
                </div>
                <div class="participant-list">
                  <For each={props.adminMembers}>
                    {(member) => {
                      const included = draft.participants.some(
                        (participant) => participant.memberId === member.id
                      )
                      const previewAmount =
                        splitPreview.find((participant) => participant.memberId === member.id)
                          ?.amountMajor ?? '0.00'

                      return (
                        <article class="participant-card">
                          <header>
                            <strong>{member.displayName}</strong>
                            <span>
                              {previewAmount} {draft.currency}
                            </span>
                          </header>
                          <div class="participant-card__controls">
                            <Button
                              variant={included ? 'primary' : 'secondary'}
                              onClick={() =>
                                props.onTogglePurchaseParticipant(
                                  entry.id,
                                  entry,
                                  member.id,
                                  !included
                                )
                              }
                            >
                              {included
                                ? props.copy.participantIncluded
                                : props.copy.participantExcluded}
                            </Button>
                            <Show when={included && draft.splitMode === 'custom_amounts'}>
                              <Field
                                label={props.copy.purchaseCustomShareLabel ?? ''}
                                class="participant-card__field"
                              >
                                <input
                                  value={
                                    draft.participants.find(
                                      (participant) => participant.memberId === member.id
                                    )?.shareAmountMajor ?? ''
                                  }
                                  onInput={(event) =>
                                    props.onPurchaseParticipantShareChange(
                                      entry.id,
                                      entry,
                                      member.id,
                                      event.currentTarget.value
                                    )
                                  }
                                />
                              </Field>
                            </Show>
                          </div>
                        </article>
                      )
                    }}
                  </For>
                </div>
              </section>
            </>
          )
        })()}
      </Modal>
      <article class="balance-item">
        <header>
          <strong>{props.copy.utilityLedgerTitle ?? ''}</strong>
        </header>
        {props.utilityEntries.length === 0 ? (
          <p>{props.copy.utilityLedgerEmpty ?? ''}</p>
        ) : (
          <div class="ledger-list">
            <For each={props.utilityEntries}>
              {(entry) => (
                <article class="ledger-item">
                  <header>
                    <strong>{props.ledgerTitle(entry)}</strong>
                    <span>{props.ledgerPrimaryAmount(entry)}</span>
                  </header>
                  <Show when={props.ledgerSecondaryAmount(entry)}>
                    {(secondary) => <p>{secondary()}</p>}
                  </Show>
                  <p>{entry.actorDisplayName ?? props.copy.ledgerActorFallback ?? ''}</p>
                </article>
              )}
            </For>
          </div>
        )}
      </article>
      <article class="balance-item">
        <header>
          <strong>{props.copy.paymentsAdminTitle ?? ''}</strong>
        </header>
        <Show when={props.readyIsAdmin}>
          <p>{props.copy.paymentsAdminBody ?? ''}</p>
          <div class="panel-toolbar">
            <Button variant="secondary" onClick={props.onOpenAddPayment}>
              {props.copy.paymentsAddAction ?? ''}
            </Button>
          </div>
        </Show>
        {props.paymentEntries.length === 0 ? (
          <p>{props.copy.paymentsEmpty ?? ''}</p>
        ) : (
          <div class="ledger-list">
            <For each={props.paymentEntries}>
              {(entry) => (
                <article class="ledger-compact-card">
                  <div class="ledger-compact-card__main">
                    <header>
                      <strong>{props.paymentMemberName(entry)}</strong>
                      <span>{entry.occurredAt?.slice(0, 10) ?? '—'}</span>
                    </header>
                    <p>{props.ledgerTitle(entry)}</p>
                    <div class="ledger-compact-card__meta">
                      <span class="mini-chip">{props.ledgerPrimaryAmount(entry)}</span>
                      <Show when={props.ledgerSecondaryAmount(entry)}>
                        {(secondary) => (
                          <span class="mini-chip mini-chip--muted">{secondary()}</span>
                        )}
                      </Show>
                    </div>
                  </div>
                  <Show when={props.readyIsAdmin}>
                    <div class="ledger-compact-card__actions">
                      <IconButton
                        label={props.copy.editEntryAction ?? ''}
                        onClick={() => props.onOpenPaymentEditor(entry.id)}
                      >
                        ...
                      </IconButton>
                    </div>
                  </Show>
                </article>
              )}
            </For>
          </div>
        )}
      </article>
      <Modal
        open={props.addingPaymentOpen}
        title={props.copy.paymentsAddAction ?? ''}
        description={props.copy.paymentCreateBody ?? ''}
        closeLabel={props.copy.closeEditorAction ?? ''}
        onClose={props.onCloseAddPayment}
        footer={
          <div class="modal-action-row modal-action-row--single">
            <Button variant="ghost" onClick={props.onCloseAddPayment}>
              {props.copy.closeEditorAction ?? ''}
            </Button>
            <Button
              variant="primary"
              disabled={props.addingPayment || props.paymentForm.amountMajor.trim().length === 0}
              onClick={() => void props.onAddPayment()}
            >
              {props.addingPayment ? props.copy.addingPayment : props.copy.paymentsAddAction}
            </Button>
          </div>
        }
      >
        <div class="editor-grid">
          <Field label={props.copy.paymentMember ?? ''} wide>
            <select
              value={props.paymentForm.memberId}
              onChange={(event) => props.onPaymentFormMemberChange(event.currentTarget.value)}
            >
              <For each={props.adminMembers}>
                {(member) => <option value={member.id}>{member.displayName}</option>}
              </For>
            </select>
          </Field>
          <Field label={props.copy.paymentKind ?? ''}>
            <select
              value={props.paymentForm.kind}
              onChange={(event) =>
                props.onPaymentFormKindChange(event.currentTarget.value as 'rent' | 'utilities')
              }
            >
              <option value="rent">{props.copy.paymentLedgerRent ?? ''}</option>
              <option value="utilities">{props.copy.paymentLedgerUtilities ?? ''}</option>
            </select>
          </Field>
          <Field label={props.copy.paymentAmount ?? ''}>
            <input
              value={props.paymentForm.amountMajor}
              onInput={(event) => props.onPaymentFormAmountChange(event.currentTarget.value)}
            />
          </Field>
          <Field label={props.copy.settlementCurrency ?? ''}>
            <select
              value={props.paymentForm.currency}
              onChange={(event) =>
                props.onPaymentFormCurrencyChange(event.currentTarget.value as 'USD' | 'GEL')
              }
            >
              <option value="GEL">GEL</option>
              <option value="USD">USD</option>
            </select>
          </Field>
        </div>
      </Modal>
      <Modal
        open={Boolean(props.editingPaymentEntry)}
        title={props.copy.paymentsAdminTitle ?? ''}
        description={props.copy.paymentEditorBody ?? ''}
        closeLabel={props.copy.closeEditorAction ?? ''}
        onClose={props.onClosePaymentEditor}
        footer={(() => {
          const entry = props.editingPaymentEntry

          if (!entry) {
            return null
          }

          return (
            <div class="modal-action-row">
              <Button variant="danger" onClick={() => void props.onDeletePayment(entry.id)}>
                {props.deletingPaymentId === entry.id
                  ? props.copy.deletingPayment
                  : props.copy.paymentDeleteAction}
              </Button>
              <div class="modal-action-row__primary">
                <Button variant="ghost" onClick={props.onClosePaymentEditor}>
                  {props.copy.closeEditorAction ?? ''}
                </Button>
                <Button
                  variant="primary"
                  disabled={props.savingPaymentId === entry.id}
                  onClick={() => void props.onSavePayment(entry.id)}
                >
                  {props.savingPaymentId === entry.id
                    ? props.copy.addingPayment
                    : props.copy.paymentSaveAction}
                </Button>
              </div>
            </div>
          )
        })()}
      >
        {(() => {
          const entry = props.editingPaymentEntry

          if (!entry) {
            return null
          }

          const draft = props.paymentDraftMap[entry.id] ?? props.paymentDraftForEntry(entry)

          return (
            <div class="editor-grid">
              <Field label={props.copy.paymentMember ?? ''} wide>
                <select
                  value={draft.memberId}
                  onChange={(event) =>
                    props.onPaymentDraftMemberChange(entry.id, entry, event.currentTarget.value)
                  }
                >
                  <For each={props.adminMembers}>
                    {(member) => <option value={member.id}>{member.displayName}</option>}
                  </For>
                </select>
              </Field>
              <Field label={props.copy.paymentKind ?? ''}>
                <select
                  value={draft.kind}
                  onChange={(event) =>
                    props.onPaymentDraftKindChange(
                      entry.id,
                      entry,
                      event.currentTarget.value as 'rent' | 'utilities'
                    )
                  }
                >
                  <option value="rent">{props.copy.paymentLedgerRent ?? ''}</option>
                  <option value="utilities">{props.copy.paymentLedgerUtilities ?? ''}</option>
                </select>
              </Field>
              <Field label={props.copy.paymentAmount ?? ''}>
                <input
                  value={draft.amountMajor}
                  onInput={(event) =>
                    props.onPaymentDraftAmountChange(entry.id, entry, event.currentTarget.value)
                  }
                />
              </Field>
              <Field label={props.copy.settlementCurrency ?? ''}>
                <select
                  value={draft.currency}
                  onChange={(event) =>
                    props.onPaymentDraftCurrencyChange(
                      entry.id,
                      entry,
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
    </div>
  )
}
