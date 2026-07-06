import { Check, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { addMiniAppPayment, deleteMiniAppPayment, updateMiniAppPayment } from '@/api'
import { useDashboard } from '@/app/dashboard-context'
import { useSession } from '@/app/session-context'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useToast } from '@/components/toast'
import { useI18n } from '@/i18n/context'
import { formatCyclePeriod } from '@/lib/dates'
import {
  computePaymentPrefill,
  paymentDraftForEntry,
  type PaymentDraft
} from '@/lib/ledger-helpers'
import { confirmDialog } from '@/telegram/webapp'
import { CurrencyToggle } from './currency-toggle'
import type { LedgerEntry, PaymentPrefill } from './types'

export function PaymentEditor({
  open,
  entry,
  prefill,
  onOpenChange
}: {
  open: boolean
  entry: LedgerEntry | null
  prefill: PaymentPrefill | null
  onOpenChange: (open: boolean) => void
}) {
  const { initData, handleMiniAppRequestError } = useSession()
  const { copy, locale } = useI18n()
  const { dashboard, refresh } = useDashboard()
  const { showToast } = useToast()

  const [draft, setDraft] = useState<PaymentDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const entryId = entry?.id ?? null
  useEffect(() => {
    if (!open) return
    if (entry) {
      setDraft(paymentDraftForEntry(entry))
      return
    }
    const period = prefill?.period ?? dashboard?.period ?? ''
    const memberId = prefill?.memberId ?? ''
    const kind = prefill?.kind ?? 'rent'
    setDraft({
      memberId,
      kind,
      amountMajor: memberId ? computePaymentPrefill(dashboard, memberId, kind, period) : '',
      currency: dashboard?.currency ?? 'GEL',
      period
    })
    // Rebuild the draft only when the editor opens for a target, like legacy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entryId, prefill])

  const memberOptions = useMemo(
    () =>
      (dashboard?.members ?? []).map((member) => ({
        value: member.memberId,
        label: member.displayName
      })),
    [dashboard]
  )
  const periodOptions = useMemo(() => {
    const periods = new Set<string>()
    for (const summary of dashboard?.paymentPeriods ?? []) {
      periods.add(summary.period)
    }
    return [...periods]
      .sort()
      .map((period) => ({ value: period, label: formatCyclePeriod(period, locale) }))
  }, [dashboard, locale])

  const kindOptions = [
    { value: 'rent', label: copy.shareRent },
    { value: 'utilities', label: copy.shareUtilities }
  ]

  async function handleSave() {
    if (!initData || saving || !draft) return
    if (!draft.memberId || !draft.amountMajor.trim()) return

    setSaving(true)
    try {
      if (entry) {
        await updateMiniAppPayment(initData, {
          paymentId: entry.id,
          memberId: draft.memberId,
          kind: draft.kind,
          amountMajor: draft.amountMajor,
          currency: draft.currency
        })
      } else {
        await addMiniAppPayment(initData, {
          memberId: draft.memberId,
          kind: draft.kind,
          amountMajor: draft.amountMajor,
          currency: draft.currency,
          ...(draft.period ? { period: draft.period } : {})
        })
      }
      await refresh()
      showToast(copy.quickPaymentSuccess, 'success')
      onOpenChange(false)
    } catch (error) {
      if (!handleMiniAppRequestError(error)) {
        showToast(error instanceof Error ? error.message : copy.quickPaymentFailed, 'error')
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!initData || deleting || !entry) return
    const ok = await confirmDialog(locale === 'ru' ? 'Удалить эту оплату?' : 'Delete this payment?')
    if (!ok) return

    setDeleting(true)
    try {
      await deleteMiniAppPayment(initData, entry.id)
      await refresh()
      onOpenChange(false)
    } catch (error) {
      if (!handleMiniAppRequestError(error)) {
        showToast(error instanceof Error ? error.message : copy.quickPaymentFailed, 'error')
      }
    } finally {
      setDeleting(false)
    }
  }

  function updateWithPrefill(next: PaymentDraft): PaymentDraft {
    if (!next.memberId) return next
    return {
      ...next,
      amountMajor: computePaymentPrefill(
        dashboard,
        next.memberId,
        next.kind,
        next.period || dashboard?.period || ''
      )
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={entry ? copy.editEntryAction : copy.paymentsAddAction}
      footer={
        <div className="flex items-center gap-2">
          {entry ? (
            <Button variant="destructive" loading={deleting} onClick={() => void handleDelete()}>
              <Trash2 className="size-4" aria-hidden />
              {deleting ? copy.deletingPayment : copy.paymentDeleteAction}
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
            disabled={!draft || !draft.memberId || !draft.amountMajor.trim()}
            onClick={() => void handleSave()}
          >
            <Check className="size-4" aria-hidden />
            {saving && !entry ? copy.addingPayment : copy.paymentSaveAction}
          </Button>
        </div>
      }
    >
      {draft ? (
        <div className="space-y-3">
          <p className="text-xs text-faint">
            {entry ? copy.paymentEditorBody : copy.paymentCreateBody}
          </p>
          <Field label={copy.paymentMember}>
            <Select
              value={draft.memberId}
              aria-label={copy.paymentMember}
              onChange={(event) => {
                const memberId = event.target.value
                setDraft((current) =>
                  current
                    ? entry
                      ? { ...current, memberId }
                      : updateWithPrefill({ ...current, memberId })
                    : current
                )
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
          <Field label={copy.paymentKind}>
            <Select
              value={draft.kind}
              aria-label={copy.paymentKind}
              onChange={(event) => {
                const kind = event.target.value as 'rent' | 'utilities'
                setDraft((current) =>
                  current
                    ? entry
                      ? { ...current, kind }
                      : updateWithPrefill({ ...current, kind })
                    : current
                )
              }}
            >
              {kindOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          {entry ? null : (
            <Field label={copy.billingCyclePeriod}>
              <Select
                value={draft.period}
                aria-label={copy.billingCyclePeriod}
                onChange={(event) => {
                  const period = event.target.value
                  setDraft((current) =>
                    current ? updateWithPrefill({ ...current, period }) : current
                  )
                }}
              >
                <option value="">—</option>
                {periodOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label={copy.paymentAmount}>
            <Input
              type="number"
              inputMode="decimal"
              value={draft.amountMajor}
              onChange={(event) =>
                setDraft((current) =>
                  current ? { ...current, amountMajor: event.target.value } : current
                )
              }
            />
          </Field>
          <Field label={copy.currencyLabel}>
            <CurrencyToggle
              value={draft.currency}
              onChange={(value) =>
                setDraft((current) => (current ? { ...current, currency: value } : current))
              }
            />
          </Field>
        </div>
      ) : null}
    </Sheet>
  )
}
