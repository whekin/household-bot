import { Check, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import {
  addMiniAppPayment,
  deleteMiniAppPayment,
  updateMiniAppPayment,
  type MiniAppDashboard
} from '@/api'
import { useDashboard } from '@/app/dashboard-context'
import { useSession } from '@/app/session-context'
import { Avatar } from '@/components/avatar'
import { useToast } from '@/components/toast'
import { AmountInput } from '@/components/ui/amount-input'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { CurrencyToggle, Segmented } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/cn'
import { formatCyclePeriod } from '@/lib/dates'
import {
  computePaymentPrefill,
  paymentDraftForEntry,
  type PaymentDraft
} from '@/lib/ledger-helpers'
import { parseMoneyInput } from '@/lib/money'
import { confirmDialog, haptics } from '@/telegram/webapp'

type LedgerEntry = MiniAppDashboard['ledger'][number]

export type PaymentPrefill = {
  memberId: string
  kind: 'rent' | 'utilities'
  period: string
}

/**
 * Admin form for money paid outside the usual "mark as paid" flow: who paid, for
 * what and which month. The amount starts at what that person still owes.
 */
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
  const { dashboard, refresh, applyDashboard } = useDashboard()
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
    const kind = prefill?.kind ?? 'utilities'
    setDraft({
      memberId,
      kind,
      period,
      currency: dashboard?.currency ?? 'GEL',
      amountMajor: memberId ? computePaymentPrefill(dashboard, memberId, kind, period) : ''
    })
    // Build the draft when the form opens, never on background refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entryId, prefill])

  const periods = useMemo(
    () =>
      [...new Set((dashboard?.paymentPeriods ?? []).map((summary) => summary.period))]
        .sort()
        .reverse(),
    [dashboard]
  )

  if (!draft || !dashboard) return null

  // Changing who, what or when re-suggests what is still owed for that choice.
  const choose = (patch: Partial<PaymentDraft>) =>
    setDraft((current) => {
      if (!current) return current
      const next = { ...current, ...patch }
      if (entry || !next.memberId) return next
      return {
        ...next,
        amountMajor: computePaymentPrefill(
          dashboard,
          next.memberId,
          next.kind,
          next.period || dashboard.period
        )
      }
    })

  const canSave = Boolean(draft.memberId) && parseMoneyInput(draft.amountMajor) > 0n && !saving

  async function save() {
    if (!initData || !draft || !canSave) return
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
        await refresh()
      } else {
        const next = await addMiniAppPayment(initData, {
          memberId: draft.memberId,
          kind: draft.kind,
          amountMajor: draft.amountMajor,
          currency: draft.currency,
          ...(draft.period ? { period: draft.period } : {})
        })
        if (!next || !applyDashboard(next)) await refresh()
      }
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
    if (!(await confirmDialog(copy.formDeletePayment))) return
    setDeleting(true)
    try {
      await deleteMiniAppPayment(initData, entry.id)
      await refresh()
      showToast(copy.formDeleted, 'success')
      onOpenChange(false)
    } catch (error) {
      if (!handleMiniAppRequestError(error)) showToast(copy.formSaveFailed, 'error')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={entry ? copy.formPaymentEdit : copy.formPaymentNew}
      description={entry ? undefined : copy.formPaymentHint}
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
          {copy.formSavePayment}
        </Button>
      }
    >
      <div className="space-y-3">
        <section className="rounded-[24px] bg-card p-4">
          <h3 className="mb-3 text-[13px] font-semibold text-muted-foreground">
            {copy.formPaymentWho}
          </h3>
          <div className="flex flex-wrap gap-2">
            {dashboard.members
              .filter((member) => member.status !== 'left')
              .map((member) => {
                const active = member.memberId === draft.memberId
                return (
                  <button
                    key={member.memberId}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      haptics.selection()
                      choose({ memberId: member.memberId })
                    }}
                    className={cn(
                      'flex h-10 items-center gap-2 rounded-full pl-1 pr-3.5 text-sm font-medium transition-colors',
                      active
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-elevated text-muted-foreground'
                    )}
                  >
                    <Avatar
                      name={member.displayName}
                      className={cn('size-8 text-[11px]', active && 'bg-card text-foreground')}
                    />
                    {member.displayName}
                  </button>
                )
              })}
          </div>
        </section>

        <div className="grid grid-cols-2 gap-3">
          <Field label={copy.formPaymentWhat}>
            <Segmented
              value={draft.kind}
              onChange={(kind) => choose({ kind })}
              options={[
                { value: 'utilities', label: copy.kindUtilities },
                { value: 'rent', label: copy.kindRent }
              ]}
            />
          </Field>
          {entry ? null : (
            <Field label={copy.formPaymentMonth}>
              <Select
                value={draft.period}
                onChange={(event) => choose({ period: event.target.value })}
              >
                {periods.map((period) => (
                  <option key={period} value={period}>
                    {formatCyclePeriod(period, locale)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>

        <AmountInput
          label={copy.formAmount}
          value={draft.amountMajor}
          currency={draft.currency}
          onChange={(amountMajor) =>
            setDraft((current) => (current ? { ...current, amountMajor } : current))
          }
          footer={
            <CurrencyToggle
              value={draft.currency}
              onChange={(currency) =>
                setDraft((current) => (current ? { ...current, currency } : current))
              }
            />
          }
        />

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
