import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n/context'
import { formatCyclePeriod } from '@/lib/dates'

import { CurrencyToggle } from './toggles'

export type RentPeriodDraft = {
  period: string
  amountMajor: string
  currency: 'USD' | 'GEL'
  hasExplicitRule: boolean
  isOverride: boolean
  dirty: boolean
}

export function RentPeriodSettings({
  drafts,
  loading,
  onChange,
  onUseDefault
}: {
  drafts: readonly RentPeriodDraft[]
  loading: boolean
  onChange: (
    period: string,
    patch: Partial<Pick<RentPeriodDraft, 'amountMajor' | 'currency'>>
  ) => void
  onUseDefault: (period: string) => void
}) {
  const { copy, locale } = useI18n()

  return (
    <div className="space-y-2 pt-1">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{copy.monthlyRentOverridesTitle}</p>
          <p className="text-xs text-muted-foreground">{copy.monthlyRentOverridesHint}</p>
        </div>
        {loading ? (
          <span className="text-xs text-muted-foreground">{copy.loadingRentPeriods}</span>
        ) : null}
      </div>

      {drafts.map((draft, index) => (
        <div
          key={draft.period}
          className="rounded-2xl border border-border bg-field/35 p-3.5 shadow-sm"
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold capitalize">
                {formatCyclePeriod(draft.period, locale)}
              </p>
              <p className="text-xs text-muted-foreground">
                {index === 0 ? copy.currentRentPeriod : copy.nextRentPeriod}
              </p>
            </div>
            <Badge tone={draft.isOverride ? 'warning' : 'neutral'}>
              {draft.isOverride ? copy.currentCycleOverrideRent : copy.currentCycleUsesDefaultRent}
            </Badge>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
            <Field label={copy.rentAmount}>
              <Input
                type="number"
                inputMode="decimal"
                value={draft.amountMajor}
                onChange={(event) => onChange(draft.period, { amountMajor: event.target.value })}
              />
            </Field>
            <Field label={copy.currencyLabel}>
              <CurrencyToggle
                value={draft.currency}
                ariaLabel={`${copy.currencyLabel}: ${formatCyclePeriod(draft.period, locale)}`}
                onChange={(currency) => onChange(draft.period, { currency })}
              />
            </Field>
          </div>
          {draft.isOverride ? (
            <Button
              className="mt-2"
              variant="ghost"
              size="sm"
              onClick={() => onUseDefault(draft.period)}
            >
              {copy.useDefaultRentAction}
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  )
}
