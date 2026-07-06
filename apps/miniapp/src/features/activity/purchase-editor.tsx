import { Check, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { addMiniAppPurchase, deleteMiniAppPurchase, updateMiniAppPurchase } from '@/api'
import { useDashboard } from '@/app/dashboard-context'
import { useSession } from '@/app/session-context'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Sheet } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useI18n } from '@/i18n/context'
import {
  percentageStringToBasisPoints,
  purchaseDraftForEntry,
  rebalancePurchaseSplit,
  validatePurchaseDraft,
  type PurchaseDraft
} from '@/lib/ledger-helpers'
import { majorStringToMinor, minorToMajorString } from '@/lib/money'
import {
  buildEmptyPurchaseDraft,
  buildPurchaseSplitPayload,
  purchaseDraftWithSelectedPayer
} from '@/lib/purchase-draft'
import { confirmDialog } from '@/telegram/webapp'
import { CurrencyToggle } from './currency-toggle'
import type { LedgerEntry } from './types'

function initialsForName(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

type DraftUpdater = (fn: (draft: PurchaseDraft) => PurchaseDraft) => void

function ParticipantSplitInputs({
  draft,
  updateDraft
}: {
  draft: PurchaseDraft
  updateDraft: DraftUpdater
}) {
  const { dashboard } = useDashboard()
  const validation = validatePurchaseDraft(draft)
  const memberNames = useMemo(
    () =>
      new Map((dashboard?.members ?? []).map((member) => [member.memberId, member.displayName])),
    [dashboard]
  )

  function excludeParticipant(current: PurchaseDraft, idx: number): PurchaseDraft {
    const participants = current.participants.map((entry, entryIndex) =>
      entryIndex === idx
        ? { ...entry, included: false, shareAmountMajor: '0.00', sharePercentage: '' }
        : entry
    )
    return rebalancePurchaseSplit({ ...current, participants }, null, null)
  }

  return (
    <div className="mt-2 space-y-2">
      {draft.participants.map((participant, idx) => {
        const name = memberNames.get(participant.memberId) ?? participant.memberId

        return (
          <div key={participant.memberId} className="flex items-center gap-2.5">
            <Checkbox
              checked={participant.included}
              aria-label={name}
              onCheckedChange={(checked) => {
                updateDraft((current) => {
                  const participants = current.participants.map((entry, entryIndex) =>
                    entryIndex === idx
                      ? {
                          ...entry,
                          included: checked,
                          lastUpdatedAt: Date.now(),
                          isAutoCalculated: false
                        }
                      : entry
                  )
                  return rebalancePurchaseSplit({ ...current, participants }, null, null)
                })
              }}
            />
            <span className="flex min-w-0 flex-1 items-center gap-2 text-sm text-foreground">
              <span
                className="flex size-6 shrink-0 items-center justify-center rounded-full bg-field text-[10px] font-semibold text-muted-foreground"
                aria-hidden
              >
                {initialsForName(name)}
              </span>
              <span className="truncate">{name}</span>
            </span>

            {participant.included && draft.splitInputMode === 'exact' ? (
              <Input
                type="number"
                className="w-24 text-right font-mono"
                placeholder="0.00"
                value={participant.shareAmountMajor}
                onChange={(event) => {
                  const value = event.target.value
                  updateDraft((current) => ({
                    ...current,
                    participants: current.participants.map((entry, entryIndex) =>
                      entryIndex === idx
                        ? {
                            ...entry,
                            shareAmountMajor: value,
                            isAutoCalculated: false,
                            lastUpdatedAt: Date.now()
                          }
                        : entry
                    )
                  }))
                }}
                onBlur={(event) => {
                  const value = event.target.value
                  const minor = majorStringToMinor(value)
                  updateDraft((current) => {
                    if (minor <= 0n) {
                      return excludeParticipant(current, idx)
                    }
                    return rebalancePurchaseSplit(current, participant.memberId, value)
                  })
                }}
              />
            ) : null}

            {participant.included && draft.splitInputMode === 'percentage' ? (
              <Input
                type="number"
                className="w-20 text-right font-mono"
                placeholder="%"
                value={participant.sharePercentage}
                onChange={(event) => {
                  const value = event.target.value
                  updateDraft((current) => ({
                    ...current,
                    participants: current.participants.map((entry, entryIndex) =>
                      entryIndex === idx
                        ? {
                            ...entry,
                            sharePercentage: value,
                            isAutoCalculated: false,
                            lastUpdatedAt: Date.now()
                          }
                        : entry
                    )
                  }))
                }}
                onBlur={(event) => {
                  const value = event.target.value
                  const percentageBasisPoints = percentageStringToBasisPoints(value)
                  updateDraft((current) => {
                    if (percentageBasisPoints <= 0n) {
                      return excludeParticipant(current, idx)
                    }
                    const totalMinor = majorStringToMinor(current.amountMajor)
                    const shareMinor = (totalMinor * percentageBasisPoints) / 10000n
                    const amountMajor = minorToMajorString(shareMinor)
                    const updated = rebalancePurchaseSplit(
                      current,
                      participant.memberId,
                      amountMajor
                    )
                    const participants = updated.participants.map((entry, entryIndex) =>
                      entryIndex === idx ? { ...entry, sharePercentage: value } : entry
                    )
                    return { ...updated, participants }
                  })
                }}
              />
            ) : null}
          </div>
        )
      })}

      {draft.splitInputMode !== 'equal' &&
      draft.participants.some((participant) => participant.included) &&
      !validation.valid ? (
        <p className="text-xs text-destructive" role="alert">
          {validation.error}
        </p>
      ) : null}
    </div>
  )
}

function PurchaseDraftFields({
  draft,
  updateDraft
}: {
  draft: PurchaseDraft
  updateDraft: DraftUpdater
}) {
  const { dashboard } = useDashboard()
  const { copy } = useI18n()

  const memberOptions = useMemo(
    () =>
      (dashboard?.members ?? [])
        .filter((member) => member.status === undefined || member.status === 'active')
        .map((member) => ({ value: member.memberId, label: member.displayName })),
    [dashboard]
  )

  const splitModeOptions = [
    { value: 'equal', label: copy.purchaseSplitEqual },
    { value: 'exact', label: copy.purchaseSplitExact },
    { value: 'percentage', label: copy.purchaseSplitPercentage }
  ]

  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label={copy.purchaseDescriptionLabel} className="col-span-2">
        <Input
          value={draft.description}
          onChange={(event) =>
            updateDraft((current) => ({ ...current, description: event.target.value }))
          }
        />
      </Field>
      <Field label={copy.purchaseAmountLabel}>
        <Input
          type="number"
          inputMode="decimal"
          value={draft.amountMajor}
          onChange={(event) => {
            const amountMajor = event.target.value
            updateDraft((current) =>
              rebalancePurchaseSplit({ ...current, amountMajor }, null, null)
            )
          }}
        />
      </Field>
      <Field label={copy.currencyLabel}>
        <CurrencyToggle
          value={draft.currency}
          onChange={(value) => updateDraft((current) => ({ ...current, currency: value }))}
        />
      </Field>
      <Field label={copy.purchaseDateLabel}>
        <Input
          type="date"
          value={draft.occurredOn ?? ''}
          onChange={(event) =>
            updateDraft((current) => ({ ...current, occurredOn: event.target.value || null }))
          }
        />
      </Field>
      <Field label={copy.purchasePayerLabel}>
        <Select
          value={draft.payerMemberId ?? ''}
          aria-label={copy.purchasePayerLabel}
          onChange={(event) => {
            const value = event.target.value
            updateDraft((current) => purchaseDraftWithSelectedPayer(current, value || null))
          }}
        >
          <option value="">—</option>
          {memberOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>
      <div className="col-span-2">
        <Field label={copy.purchaseSplitTitle}>
          <Select
            value={draft.splitInputMode}
            aria-label={copy.purchaseSplitTitle}
            onChange={(event) => {
              const splitInputMode = event.target.value as 'equal' | 'exact' | 'percentage'
              const splitMode = splitInputMode === 'equal' ? 'equal' : 'custom_amounts'
              updateDraft((current) =>
                rebalancePurchaseSplit({ ...current, splitInputMode, splitMode }, null, null)
              )
            }}
          >
            {splitModeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
        <ParticipantSplitInputs draft={draft} updateDraft={updateDraft} />
      </div>
    </div>
  )
}

export function PurchaseEditor({
  open,
  entry,
  onOpenChange
}: {
  open: boolean
  entry: LedgerEntry | null
  onOpenChange: (open: boolean) => void
}) {
  const { initData, handleMiniAppRequestError } = useSession()
  const { copy, locale } = useI18n()
  const { dashboard, currentMemberLine, refresh } = useDashboard()

  const [draft, setDraft] = useState<PurchaseDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [mutationError, setMutationError] = useState<string | null>(null)

  const entryId = entry?.id ?? null
  useEffect(() => {
    if (!open) return
    setDraft(
      entry
        ? purchaseDraftForEntry(entry)
        : buildEmptyPurchaseDraft(dashboard, currentMemberLine?.memberId)
    )
    setMutationError(null)
    // Rebuild the draft only when the editor opens for a target, like legacy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entryId])

  const updateDraft: DraftUpdater = (fn) => {
    setMutationError(null)
    setDraft((current) => (current ? fn(current) : current))
  }

  const needsBalance = Boolean(
    draft && draft.splitInputMode !== 'equal' && !validatePurchaseDraft(draft).valid
  )
  const saveLabel = saving
    ? copy.savingPurchase
    : needsBalance
      ? copy.purchaseBalanceAction
      : copy.purchaseSaveAction

  async function handleSave() {
    if (!initData || saving || !draft) return
    if (!draft.description.trim() || !draft.amountMajor.trim()) return
    if (draft.splitInputMode !== 'equal' && !validatePurchaseDraft(draft).valid) {
      setDraft(rebalancePurchaseSplit(draft, null, null))
      return
    }

    setSaving(true)
    setMutationError(null)
    try {
      if (entry) {
        await updateMiniAppPurchase(initData, {
          purchaseId: entry.id,
          description: draft.description,
          amountMajor: draft.amountMajor,
          currency: draft.currency,
          ...(draft.occurredOn ? { occurredOn: draft.occurredOn } : {}),
          ...(draft.payerMemberId ? { payerMemberId: draft.payerMemberId } : {}),
          split: buildPurchaseSplitPayload(draft)
        })
      } else {
        await addMiniAppPurchase(initData, {
          description: draft.description,
          amountMajor: draft.amountMajor,
          currency: draft.currency,
          ...(draft.occurredOn ? { occurredOn: draft.occurredOn } : {}),
          ...(draft.payerMemberId ? { payerMemberId: draft.payerMemberId } : {}),
          ...(draft.participants.length > 0 ? { split: buildPurchaseSplitPayload(draft) } : {})
        })
      }
      await refresh()
      onOpenChange(false)
    } catch (error) {
      if (!handleMiniAppRequestError(error)) {
        setMutationError(error instanceof Error ? error.message : copy.purchaseMutationFailed)
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!initData || deleting || !entry) return
    const ok = await confirmDialog(
      locale === 'ru' ? 'Удалить эту покупку?' : 'Delete this purchase?'
    )
    if (!ok) return

    setDeleting(true)
    setMutationError(null)
    try {
      await deleteMiniAppPurchase(initData, entry.id)
      await refresh()
      onOpenChange(false)
    } catch (error) {
      if (!handleMiniAppRequestError(error)) {
        setMutationError(error instanceof Error ? error.message : copy.purchaseMutationFailed)
      }
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={entry ? copy.editEntryAction : copy.purchaseAddAction}
      footer={
        <div className="flex items-center gap-2">
          {entry ? (
            <Button variant="destructive" loading={deleting} onClick={() => void handleDelete()}>
              <Trash2 className="size-4" aria-hidden />
              {deleting ? copy.deletingPurchase : copy.purchaseDeleteAction}
            </Button>
          ) : null}
          <div className="flex-1" />
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            <X className="size-4" aria-hidden />
            {copy.closeEditorAction}
          </Button>
          <Button
            variant="primary"
            loading={saving}
            disabled={!draft || !draft.description.trim() || !draft.amountMajor.trim()}
            onClick={() => void handleSave()}
          >
            <Check className="size-4" aria-hidden />
            {saveLabel}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-faint">
          {entry ? copy.purchaseInlineEditorBody : copy.purchaseComposerBody}
        </p>
        {draft ? <PurchaseDraftFields draft={draft} updateDraft={updateDraft} /> : null}
        {mutationError ? (
          <p className="text-xs text-destructive" role="alert">
            {mutationError}
          </p>
        ) : null}
      </div>
    </Sheet>
  )
}
