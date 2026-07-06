import { Check, X } from 'lucide-react'
import { useEffect, useState } from 'react'

import { updateMiniAppCycleRent } from '@/api'
import { useDashboard } from '@/app/dashboard-context'
import { useSession } from '@/app/session-context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/toast'
import { useI18n } from '@/i18n/context'
import { formatMoneyLabel } from '@/lib/ledger-helpers'
import { minorToMajorString } from '@/lib/money'
import { CurrencyToggle } from './currency-toggle'

export function rateMicrosToString(value: string | null): string {
  if (!value) return ''
  const normalized = value.padStart(7, '0')
  const whole = normalized.slice(0, -6) || '0'
  const fraction = normalized.slice(-6).replace(/0+$/, '')
  return fraction.length > 0 ? `${whole}.${fraction}` : whole
}

export function rateStringToMicros(value: string): string | null {
  const trimmed = value.trim().replace(',', '.')
  if (trimmed.length === 0) return null
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(trimmed)
  if (!match) return null
  const whole = match[1] ?? '0'
  const fraction = (match[2] ?? '').padEnd(6, '0')
  return `${whole}${fraction}`.replace(/^0+(?=\d)/, '')
}

type RentDraft = {
  amountMajor: string
  currency: 'USD' | 'GEL'
  fxRate: string
}

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
    setDraft({
      amountMajor:
        rule?.amountMinor !== undefined ? minorToMajorString(BigInt(rule.amountMinor)) : '',
      currency: rule?.currency ?? adminSettings?.settings.rentCurrency ?? 'USD',
      fxRate: rateMicrosToString(dashboard.rentFxRateMicros)
    })
    // Rebuild the draft only when the editor opens, like legacy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const hasRentOverride = Boolean(cycleState?.rentRule)
  const settings = adminSettings?.settings
  const defaultRentLabel = settings?.rentAmountMinor
    ? formatMoneyLabel(
        minorToMajorString(BigInt(settings.rentAmountMinor)),
        settings.rentCurrency,
        locale
      )
    : '—'

  async function handleSave() {
    if (!initData || saving || !dashboard || !draft.amountMajor.trim()) return

    setSaving(true)
    try {
      const fxRateMicros = rateStringToMicros(draft.fxRate)
      await updateMiniAppCycleRent(initData, {
        amountMajor: draft.amountMajor,
        currency: draft.currency,
        period: dashboard.period,
        ...(fxRateMicros ? { fxRateMicros } : {})
      })
      await refresh()
      onOpenChange(false)
    } catch (error) {
      if (!handleMiniAppRequestError(error)) {
        showToast(
          error instanceof Error
            ? error.message
            : locale === 'ru'
              ? 'Не удалось сохранить аренду'
              : 'Failed to update rent',
          'error'
        )
      }
    } finally {
      setSaving(false)
    }
  }

  const overviewRows = dashboard
    ? [
        { label: copy.rentPanelHouseholdDefaultLabel, value: defaultRentLabel },
        {
          label: copy.rentPanelCycleSourceLabel,
          value: formatMoneyLabel(
            dashboard.rentSourceAmountMajor,
            dashboard.rentSourceCurrency,
            locale
          )
        },
        {
          label: copy.rentPanelSettlementLabel,
          value: formatMoneyLabel(dashboard.rentDisplayAmountMajor, dashboard.currency, locale)
        },
        {
          label: copy.rentPanelFxLabel,
          value: dashboard.rentFxRateMicros
            ? rateMicrosToString(dashboard.rentFxRateMicros)
            : dashboard.rentSourceCurrency === dashboard.currency
              ? copy.rentPanelNoConversion
              : copy.rentPanelAutoRate
        }
      ]
    : []

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={copy.shareRent}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            <X className="size-4" aria-hidden />
            {copy.closeEditorAction}
          </Button>
          <Button
            variant="primary"
            loading={saving}
            disabled={!draft.amountMajor.trim()}
            onClick={() => void handleSave()}
          >
            <Check className="size-4" aria-hidden />
            {saving ? copy.savingSettings : copy.saveSettingsAction}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs text-faint">{copy.rentPanelBody}</p>
          <Badge tone={hasRentOverride ? 'primary' : 'neutral'}>
            {hasRentOverride ? copy.currentCycleOverrideRent : copy.currentCycleUsesDefaultRent}
          </Badge>
        </div>

        <div className="divide-y divide-border rounded-xl bg-elevated px-3">
          {overviewRows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="text-muted-foreground">{row.label}</span>
              <span className="font-mono text-foreground">{row.value}</span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={copy.defaultRentAmount}>
            <Input
              type="number"
              inputMode="decimal"
              value={draft.amountMajor}
              onChange={(event) =>
                setDraft((current) => ({ ...current, amountMajor: event.target.value }))
              }
            />
          </Field>
          <Field label={copy.rentCurrencyLabel}>
            <CurrencyToggle
              value={draft.currency}
              onChange={(value) => setDraft((current) => ({ ...current, currency: value }))}
            />
          </Field>
          <Field label={copy.rentPanelFxLabel} hint={copy.rentPanelFxHint} className="col-span-2">
            <Input
              type="text"
              placeholder="2.76"
              value={draft.fxRate}
              onChange={(event) =>
                setDraft((current) => ({ ...current, fxRate: event.target.value }))
              }
            />
          </Field>
        </div>
      </div>
    </Sheet>
  )
}
