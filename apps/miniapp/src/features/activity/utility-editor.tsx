import { UTILITY_CATEGORIES } from '@household/domain'
import { Check, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import {
  addMiniAppUtilityBill,
  deleteMiniAppUtilityBill,
  submitMiniAppUtilityBill,
  updateMiniAppUtilityBill
} from '@/api'
import { useDashboard } from '@/app/dashboard-context'
import { useSession } from '@/app/session-context'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useToast } from '@/components/toast'
import { useI18n } from '@/i18n/context'
import { confirmDialog } from '@/telegram/webapp'
import { CurrencyToggle } from './currency-toggle'
import type { LedgerEntry } from './types'

type UtilityDraft = {
  billName: string
  amountMajor: string
  currency: 'USD' | 'GEL'
}

export function UtilityEditor({
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
  const { dashboard, effectiveIsAdmin, refresh } = useDashboard()
  const { showToast } = useToast()

  const [draft, setDraft] = useState<UtilityDraft>({
    billName: '',
    amountMajor: '',
    currency: 'GEL'
  })
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const entryId = entry?.id ?? null
  useEffect(() => {
    if (!open) return
    setDraft(
      entry
        ? { billName: entry.title, amountMajor: entry.amountMajor, currency: entry.currency }
        : { billName: '', amountMajor: '', currency: dashboard?.currency ?? 'GEL' }
    )
    // Rebuild the draft only when the editor opens for a target, like legacy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entryId])

  const categoryOptions = useMemo(() => {
    const fromDashboard = (dashboard?.utilityCategories ?? []).map((category) => category.name)
    const names = fromDashboard.length > 0 ? fromDashboard : [...UTILITY_CATEGORIES]
    if (
      entry &&
      !names.some((name) => name.trim().toLowerCase() === entry.title.trim().toLowerCase())
    ) {
      names.unshift(entry.title)
    }
    return names
  }, [dashboard, entry])

  async function handleSave() {
    if (!initData || saving) return
    if (!draft.billName.trim() || !draft.amountMajor.trim()) return

    setSaving(true)
    try {
      if (entry) {
        // Legacy update kept the bill's original currency.
        await updateMiniAppUtilityBill(initData, {
          billId: entry.id,
          billName: draft.billName,
          amountMajor: draft.amountMajor,
          currency: entry.currency
        })
      } else if (effectiveIsAdmin) {
        await addMiniAppUtilityBill(initData, {
          billName: draft.billName,
          amountMajor: draft.amountMajor,
          currency: draft.currency
        })
      } else {
        await submitMiniAppUtilityBill(initData, {
          billName: draft.billName,
          amountMajor: draft.amountMajor,
          currency: draft.currency
        })
      }
      await refresh()
      onOpenChange(false)
    } catch (error) {
      if (!handleMiniAppRequestError(error)) {
        showToast(
          error instanceof Error
            ? error.message
            : locale === 'ru'
              ? 'Не удалось сохранить счёт'
              : 'Failed to save utility bill',
          'error'
        )
      }
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!initData || deleting || !entry) return
    const ok = await confirmDialog(
      locale === 'ru' ? 'Удалить этот счёт?' : 'Delete this utility bill?'
    )
    if (!ok) return

    setDeleting(true)
    try {
      await deleteMiniAppUtilityBill(initData, entry.id)
      await refresh()
      onOpenChange(false)
    } catch (error) {
      if (!handleMiniAppRequestError(error)) {
        showToast(
          error instanceof Error
            ? error.message
            : locale === 'ru'
              ? 'Не удалось удалить счёт'
              : 'Failed to delete utility bill',
          'error'
        )
      }
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={entry ? copy.editEntryAction : copy.addUtilityBillAction}
      footer={
        <div className="flex items-center gap-2">
          {entry && effectiveIsAdmin ? (
            <Button variant="destructive" loading={deleting} onClick={() => void handleDelete()}>
              <Trash2 className="size-4" aria-hidden />
              {deleting ? copy.deletingUtilityBill : copy.deleteUtilityBillAction}
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
            disabled={!draft.billName.trim() || !draft.amountMajor.trim()}
            onClick={() => void handleSave()}
          >
            <Check className="size-4" aria-hidden />
            {saving
              ? copy.savingUtilityBill
              : entry
                ? copy.saveUtilityBillAction
                : copy.addUtilityBillAction}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-xs text-faint">{copy.utilityBillsEditorBody}</p>
        <Field label={copy.utilityCategoryLabel}>
          <Select
            value={draft.billName}
            aria-label={copy.utilityCategoryLabel}
            onChange={(event) =>
              setDraft((current) => ({ ...current, billName: event.target.value }))
            }
          >
            <option value="">—</option>
            {categoryOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={copy.utilityAmount}>
          <Input
            type="text"
            inputMode="decimal"
            value={draft.amountMajor}
            onChange={(event) =>
              setDraft((current) => ({ ...current, amountMajor: event.target.value }))
            }
          />
        </Field>
        {entry ? null : (
          <Field label={copy.currencyLabel}>
            <CurrencyToggle
              value={draft.currency}
              onChange={(value) => setDraft((current) => ({ ...current, currency: value }))}
            />
          </Field>
        )}
      </div>
    </Sheet>
  )
}
