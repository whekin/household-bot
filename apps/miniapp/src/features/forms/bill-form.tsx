import { Check, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { UTILITY_CATEGORIES } from '@household/domain'

import {
  addMiniAppUtilityBill,
  deleteMiniAppUtilityBill,
  submitMiniAppUtilityBill,
  updateMiniAppUtilityBill,
  type MiniAppDashboard
} from '@/api'
import { useDashboard } from '@/app/dashboard-context'
import { useSession } from '@/app/session-context'
import { useToast } from '@/components/toast'
import { AmountInput } from '@/components/ui/amount-input'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/dialog'
import { CurrencyToggle } from '@/components/ui/segmented'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/cn'
import { parseMoneyInput } from '@/lib/money'
import { confirmDialog, haptics } from '@/telegram/webapp'

type LedgerEntry = MiniAppDashboard['ledger'][number]

type BillDraft = { billName: string; amountMajor: string; currency: 'USD' | 'GEL' }

/**
 * Add or correct a utility bill: pick which bill, type the total. Anyone can add
 * one; admins can also change or remove it until utilities are settled.
 */
export function UtilityEditor({
  open,
  entry,
  initialName = null,
  onOpenChange
}: {
  open: boolean
  entry: LedgerEntry | null
  /** For a new bill: which bill type to start on, e.g. the row the reader tapped. */
  initialName?: string | null
  onOpenChange: (open: boolean) => void
}) {
  const { initData, handleMiniAppRequestError } = useSession()
  const { copy } = useI18n()
  const { dashboard, effectiveIsAdmin, refresh } = useDashboard()
  const { showToast } = useToast()
  const [draft, setDraft] = useState<BillDraft>({ billName: '', amountMajor: '', currency: 'GEL' })
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const entryId = entry?.id ?? null
  useEffect(() => {
    if (!open) return
    const billed = new Set(
      (dashboard?.ledger ?? [])
        .filter((item) => item.kind === 'utility')
        .map((item) => item.title.trim().toLowerCase())
    )
    // A new bill starts on the first type that has no bill yet this month.
    const firstMissing = (dashboard?.utilityCategories ?? []).find(
      (category) => !billed.has(category.name.trim().toLowerCase())
    )
    setDraft(
      entry
        ? { billName: entry.title, amountMajor: entry.amountMajor, currency: entry.currency }
        : {
            billName: initialName ?? firstMissing?.name ?? '',
            amountMajor: '',
            currency: dashboard?.currency ?? 'GEL'
          }
    )
    // Build the draft when the form opens, never on background refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entryId])

  const names = useMemo(() => {
    const fromHouse = (dashboard?.utilityCategories ?? []).map((category) => category.name)
    const list = fromHouse.length > 0 ? fromHouse : [...UTILITY_CATEGORIES]
    if (
      entry &&
      !list.some((name) => name.trim().toLowerCase() === entry.title.trim().toLowerCase())
    ) {
      list.unshift(entry.title)
    }
    return list
  }, [dashboard, entry])

  const canSave =
    draft.billName.trim().length > 0 && parseMoneyInput(draft.amountMajor) > 0n && !saving

  async function save() {
    if (!initData || !canSave) return
    setSaving(true)
    try {
      if (entry) {
        // A bill keeps the currency it was entered in.
        await updateMiniAppUtilityBill(initData, {
          billId: entry.id,
          billName: draft.billName,
          amountMajor: draft.amountMajor,
          currency: entry.currency
        })
      } else {
        const add = effectiveIsAdmin ? addMiniAppUtilityBill : submitMiniAppUtilityBill
        await add(initData, draft)
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
    if (!(await confirmDialog(copy.formDeleteBill))) return
    setDeleting(true)
    try {
      await deleteMiniAppUtilityBill(initData, entry.id)
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
      title={entry ? copy.formBillEdit : copy.formBillNew}
      description={copy.formBillHint}
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
          {copy.formSaveBill}
        </Button>
      }
    >
      <div className="space-y-3">
        <section className="rounded-[24px] bg-card p-4">
          <h3 className="mb-3 text-[13px] font-semibold text-muted-foreground">
            {copy.formBillWhich}
          </h3>
          <div className="flex flex-wrap gap-2">
            {names.map((name) => {
              const active = name === draft.billName
              return (
                <button
                  key={name}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    haptics.selection()
                    setDraft((current) => ({ ...current, billName: name }))
                  }}
                  className={cn(
                    'h-10 rounded-full px-4 text-sm font-medium transition-colors',
                    active ? 'bg-util text-[#2b1a00]' : 'bg-elevated text-muted-foreground'
                  )}
                >
                  {name}
                </button>
              )
            })}
          </div>
        </section>

        <AmountInput
          label={copy.formAmount}
          value={draft.amountMajor}
          currency={draft.currency}
          autoFocus={!entry}
          onChange={(amountMajor) => setDraft((current) => ({ ...current, amountMajor }))}
          footer={
            entry ? null : (
              <CurrencyToggle
                value={draft.currency}
                onChange={(currency) => setDraft((current) => ({ ...current, currency }))}
              />
            )
          }
        />

        {entry && effectiveIsAdmin ? (
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
