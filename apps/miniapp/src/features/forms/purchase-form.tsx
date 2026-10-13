import { Check, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import {
  addMiniAppPurchase,
  deleteMiniAppPurchase,
  updateMiniAppPurchase,
  type MiniAppDashboard
} from '@/api'
import { useDashboard } from '@/app/dashboard-context'
import { useSession } from '@/app/session-context'
import { Avatar } from '@/components/avatar'
import { formatMoney } from '@/components/money'
import { useToast } from '@/components/toast'
import { AmountInput } from '@/components/ui/amount-input'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { CurrencyToggle, Segmented } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/cn'
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
import { confirmDialog, haptics } from '@/telegram/webapp'

type LedgerEntry = MiniAppDashboard['ledger'][number]
type SplitMode = PurchaseDraft['splitInputMode']

function safeMinor(value: string): bigint {
  try {
    return majorStringToMinor(value || '0')
  } catch {
    return 0n
  }
}

/**
 * Add or edit a shared purchase. The usual case — you paid, everyone splits it
 * equally, today — is one amount and one line of text; custom shares sit one tap
 * further, under "Split between".
 */
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
  const { copy } = useI18n()
  const { dashboard, currentMemberLine, effectiveIsAdmin, refresh } = useDashboard()
  const { showToast } = useToast()

  const [draft, setDraft] = useState<PurchaseDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const entryId = entry?.id ?? null
  useEffect(() => {
    if (!open) return
    setDraft(
      entry
        ? purchaseDraftForEntry(entry)
        : buildEmptyPurchaseDraft(dashboard, currentMemberLine?.memberId)
    )
    // Build the draft when the form opens for a target, never on background refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entryId])

  const names = useMemo(
    () =>
      new Map((dashboard?.members ?? []).map((member) => [member.memberId, member.displayName])),
    [dashboard]
  )
  const payers = useMemo(
    () =>
      (dashboard?.members ?? []).filter(
        (member) => member.status === undefined || member.status === 'active'
      ),
    [dashboard]
  )

  if (!draft) return null

  const update = (fn: (current: PurchaseDraft) => PurchaseDraft) =>
    setDraft((current) => (current ? fn(current) : current))
  const included = draft.participants.filter((participant) => participant.included)
  const totalMinor = safeMinor(draft.amountMajor)
  const validation = validatePurchaseDraft(draft)
  const needsBalance = draft.splitInputMode !== 'equal' && !validation.valid
  const canSave =
    draft.description.trim().length > 0 && totalMinor > 0n && included.length > 0 && !saving
  const eachMajor =
    draft.splitInputMode === 'equal' && included.length > 0 && totalMinor > 0n
      ? minorToMajorString(totalMinor / BigInt(included.length))
      : null

  function toggleParticipant(memberId: string) {
    haptics.selection()
    update((current) =>
      rebalancePurchaseSplit(
        {
          ...current,
          participants: current.participants.map((participant) =>
            participant.memberId === memberId
              ? {
                  ...participant,
                  included: !participant.included,
                  lastUpdatedAt: Date.now(),
                  isAutoCalculated: false
                }
              : participant
          )
        },
        null,
        null
      )
    )
  }

  function setShare(memberId: string, value: string) {
    update((current) => ({
      ...current,
      participants: current.participants.map((participant) =>
        participant.memberId === memberId
          ? draft?.splitInputMode === 'percentage'
            ? {
                ...participant,
                sharePercentage: value,
                isAutoCalculated: false,
                lastUpdatedAt: Date.now()
              }
            : {
                ...participant,
                shareAmountMajor: value,
                isAutoCalculated: false,
                lastUpdatedAt: Date.now()
              }
          : participant
      )
    }))
  }

  function commitShare(memberId: string, value: string) {
    update((current) => {
      if (current.splitInputMode === 'percentage') {
        const basisPoints = percentageStringToBasisPoints(value)
        const shareMajor = minorToMajorString(
          (safeMinor(current.amountMajor) * basisPoints) / 10000n
        )
        const rebalanced = rebalancePurchaseSplit(current, memberId, shareMajor)
        return {
          ...rebalanced,
          participants: rebalanced.participants.map((participant) =>
            participant.memberId === memberId
              ? { ...participant, sharePercentage: value }
              : participant
          )
        }
      }
      return rebalancePurchaseSplit(current, memberId, value)
    })
  }

  async function save() {
    if (!initData || !draft || !canSave) return
    if (needsBalance) {
      update((current) => rebalancePurchaseSplit(current, null, null))
      return
    }
    setSaving(true)
    try {
      const payload = {
        description: draft.description.trim(),
        amountMajor: draft.amountMajor,
        currency: draft.currency,
        ...(draft.occurredOn ? { occurredOn: draft.occurredOn } : {}),
        ...(draft.payerMemberId ? { payerMemberId: draft.payerMemberId } : {}),
        split: buildPurchaseSplitPayload(draft)
      }
      if (entry) {
        await updateMiniAppPurchase(initData, { purchaseId: entry.id, ...payload })
      } else {
        await addMiniAppPurchase(initData, payload)
      }
      await refresh()
      showToast(copy.formSaved, 'success')
      onOpenChange(false)
    } catch (error) {
      if (!handleMiniAppRequestError(error)) showToast(copy.formSaveFailed, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!initData || !entry || deleting) return
    if (!(await confirmDialog(copy.formDeletePurchase))) return
    setDeleting(true)
    try {
      await deleteMiniAppPurchase(initData, entry.id)
      await refresh()
      showToast(copy.formDeleted, 'success')
      onOpenChange(false)
    } catch (error) {
      if (!handleMiniAppRequestError(error)) showToast(copy.formSaveFailed, 'error')
    } finally {
      setDeleting(false)
    }
  }

  const splitError =
    draft.splitInputMode === 'equal' || validation.valid
      ? null
      : validation.remainingMinor > 0n
        ? copy.formSplitLeft.replace(
            '{amount}',
            formatMoney(minorToMajorString(validation.remainingMinor), draft.currency)
          )
        : validation.remainingMinor < 0n
          ? copy.formSplitOver.replace(
              '{amount}',
              formatMoney(minorToMajorString(-validation.remainingMinor), draft.currency)
            )
          : copy.formSplitPositive

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={entry ? copy.formPurchaseEdit : copy.formPurchaseNew}
      footer={
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          loading={saving}
          disabled={!canSave}
          onClick={() => void save()}
        >
          {!saving ? <Check className="size-4" strokeWidth={2.5} /> : null}
          {needsBalance ? copy.formFixSplit : copy.formSavePurchase}
        </Button>
      }
    >
      <div className="space-y-3">
        <AmountInput
          label={copy.formAmount}
          value={draft.amountMajor}
          currency={draft.currency}
          autoFocus={!entry}
          onChange={(amountMajor) =>
            update((current) => rebalancePurchaseSplit({ ...current, amountMajor }, null, null))
          }
          footer={
            <CurrencyToggle
              value={draft.currency}
              onChange={(currency) => update((current) => ({ ...current, currency }))}
            />
          }
        />

        <Field label={copy.formWhat}>
          <Input
            value={draft.description}
            placeholder={copy.formWhatPlaceholder}
            maxLength={120}
            onChange={(event) =>
              update((current) => ({ ...current, description: event.target.value }))
            }
          />
        </Field>

        <section className="rounded-[24px] bg-card p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-[13px] font-semibold text-muted-foreground">
              {copy.formSplitBetween}
            </h3>
            {eachMajor ? (
              <span className="text-[13px] font-semibold tabular-nums">
                {copy.formEach.replace('{amount}', formatMoney(eachMajor, draft.currency))}
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            {draft.participants.map((participant) => {
              const name = names.get(participant.memberId) ?? participant.memberId
              return (
                <button
                  key={participant.memberId}
                  type="button"
                  aria-pressed={participant.included}
                  onClick={() => toggleParticipant(participant.memberId)}
                  className={cn(
                    'flex h-10 items-center gap-2 rounded-full pl-1 pr-3.5 text-sm font-medium transition-colors',
                    participant.included ? 'bg-buys-soft text-buys-ink' : 'bg-elevated text-faint'
                  )}
                >
                  <Avatar
                    name={name}
                    className={cn(
                      'size-8 text-[11px]',
                      participant.included ? 'bg-buys text-white' : ''
                    )}
                  />
                  {name}
                </button>
              )
            })}
          </div>
          {included.length === 0 ? (
            <p className="mt-2 text-xs text-danger" role="alert">
              {copy.formPickSomeone}
            </p>
          ) : null}

          <Segmented
            className="mt-3"
            value={draft.splitInputMode}
            onChange={(mode: SplitMode) =>
              update((current) =>
                rebalancePurchaseSplit(
                  {
                    ...current,
                    splitInputMode: mode,
                    splitMode: mode === 'equal' ? 'equal' : 'custom_amounts'
                  },
                  null,
                  null
                )
              )
            }
            options={[
              { value: 'equal', label: copy.formSplitEqual },
              { value: 'exact', label: copy.formSplitAmounts },
              { value: 'percentage', label: copy.formSplitPercent }
            ]}
          />

          {draft.splitInputMode !== 'equal' ? (
            <ul className="mt-3 space-y-2">
              {included.map((participant) => (
                <li key={participant.memberId} className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {names.get(participant.memberId) ?? participant.memberId}
                  </span>
                  <Input
                    inputMode="decimal"
                    className="h-11 w-28 text-right tabular-nums"
                    placeholder={draft.splitInputMode === 'percentage' ? '%' : '0.00'}
                    value={
                      draft.splitInputMode === 'percentage'
                        ? participant.sharePercentage
                        : participant.shareAmountMajor
                    }
                    onChange={(event) => setShare(participant.memberId, event.target.value)}
                    onBlur={(event) => commitShare(participant.memberId, event.target.value)}
                  />
                </li>
              ))}
            </ul>
          ) : null}
          {splitError ? (
            <p className="mt-2 text-xs text-danger" role="alert">
              {splitError}
            </p>
          ) : null}
        </section>

        <div className="grid grid-cols-2 gap-3">
          <Field label={copy.formPaidBy}>
            <Select
              value={draft.payerMemberId ?? ''}
              disabled={!effectiveIsAdmin}
              onChange={(event) =>
                update((current) =>
                  purchaseDraftWithSelectedPayer(current, event.target.value || null)
                )
              }
            >
              {payers.map((member) => (
                <option key={member.memberId} value={member.memberId}>
                  {member.displayName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={copy.formDate}>
            <Input
              type="date"
              value={draft.occurredOn ?? ''}
              onChange={(event) =>
                update((current) => ({ ...current, occurredOn: event.target.value || null }))
              }
            />
          </Field>
        </div>

        {entry ? (
          <Button
            variant="ghost"
            className="w-full text-danger"
            loading={deleting}
            onClick={() => void remove()}
          >
            <Trash2 className="size-4" />
            {copy.formDelete}
          </Button>
        ) : null}
      </div>
    </Sheet>
  )
}
