import { Check } from 'lucide-react'
import { useEffect, useState } from 'react'

import { updateMiniAppCycleRent } from '@/api'
import { useDashboard } from '@/app/dashboard-context'
import { useSession } from '@/app/session-context'
import { formatMoney } from '@/components/money'
import { useToast } from '@/components/toast'
import { AmountInput } from '@/components/ui/amount-input'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { CurrencyToggle } from '@/components/ui/segmented'
import { useI18n } from '@/i18n/context'
import { formatCyclePeriod } from '@/lib/dates'
import { fxRateFromMicros, fxRateToMicros } from '@/lib/fx'
import { majorStringToMinor, minorToMajorString } from '@/lib/money'

type RentDraft = { amountMajor: string; currency: 'USD' | 'GEL'; fxRate: string }

/** Admin form: rent for the current month only, optionally at a fixed exchange rate. */
export function RentEditor({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { initData, handleMiniAppRequestError } = useSession()
  const { copy, locale } = useI18n()
  const { adminSettings, cycleState, dashboard, refresh } = useDashboard()
  const { showToast } = useToast()
  const [draft, setDraft] = useState<RentDraft>({ amountMajor: '', currency: 'USD', fxRate: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open || !dashboard) return
    const rule = cycleState?.rentRule
    const fallback = adminSettings?.settings
    setDraft({
      amountMajor: rule
        ? minorToMajorString(BigInt(rule.amountMinor))
        : fallback?.rentAmountMinor
          ? minorToMajorString(BigInt(fallback.rentAmountMinor))
          : '',
      currency: rule?.currency ?? fallback?.rentCurrency ?? 'USD',
      fxRate: fxRateFromMicros(dashboard.rentFxRateMicros) ?? ''
    })
    // Build the draft when the form opens, never on background refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!dashboard) return null
  const settings = adminSettings?.settings
  let amountValid = false
  try {
    amountValid = majorStringToMinor(draft.amountMajor || '0') > 0n
  } catch {
    amountValid = false
  }
  const rateValid = draft.fxRate.trim() === '' || fxRateToMicros(draft.fxRate) !== null

  async function save() {
    if (!initData || saving || !dashboard || !amountValid || !rateValid) return
    setSaving(true)
    try {
      const fxRateMicros = fxRateToMicros(draft.fxRate)
      await updateMiniAppCycleRent(initData, {
        amountMajor: draft.amountMajor,
        currency: draft.currency,
        period: dashboard.period,
        ...(fxRateMicros ? { fxRateMicros } : {})
      })
      await refresh()
      showToast(copy.formSaved, 'success')
      onOpenChange(false)
    } catch (error) {
      if (!handleMiniAppRequestError(error)) showToast(copy.formSaveFailed, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={copy.formRentTitle.replace('{month}', formatCyclePeriod(dashboard.period, locale))}
      description={copy.formRentHint}
      footer={
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          loading={saving}
          disabled={!amountValid || !rateValid}
          onClick={() => void save()}
        >
          {!saving ? <Check className="size-4" strokeWidth={2.5} /> : null}
          {copy.formSaveRent}
        </Button>
      }
    >
      <div className="space-y-3">
        <section className="divide-y divide-border rounded-[24px] bg-card px-4 py-1 text-sm">
          {settings?.rentAmountMinor ? (
            <div className="flex justify-between gap-3 py-2.5">
              <span className="text-muted-foreground">{copy.formRentDefault}</span>
              <span className="font-medium tabular-nums">
                {formatMoney(
                  minorToMajorString(BigInt(settings.rentAmountMinor)),
                  settings.rentCurrency
                )}
              </span>
            </div>
          ) : null}
          <div className="flex justify-between gap-3 py-2.5">
            <span className="text-muted-foreground">{copy.formRentNow}</span>
            <span className="font-medium tabular-nums">
              {formatMoney(dashboard.rentDisplayAmountMajor, dashboard.currency)}
            </span>
          </div>
        </section>

        <AmountInput
          label={copy.formAmount}
          value={draft.amountMajor}
          currency={draft.currency}
          onChange={(amountMajor) => setDraft((current) => ({ ...current, amountMajor }))}
          footer={
            <CurrencyToggle
              value={draft.currency}
              onChange={(currency) => setDraft((current) => ({ ...current, currency }))}
            />
          }
        />

        {draft.currency !== dashboard.currency ? (
          <Field
            label={copy.formRentRate}
            hint={copy.formRentRateHint}
            {...(rateValid ? {} : { error: copy.formRentRateHint })}
          >
            <Input
              inputMode="decimal"
              placeholder="2.76"
              value={draft.fxRate}
              onChange={(event) =>
                setDraft((current) => ({ ...current, fxRate: event.target.value }))
              }
            />
          </Field>
        ) : null}
      </div>
    </Sheet>
  )
}
