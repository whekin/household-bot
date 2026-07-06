import { CircleDollarSign } from 'lucide-react'

import { useDashboard } from '@/app/dashboard-context'
import { Badge } from '@/components/ui/badge'
import { Card, CardHeader } from '@/components/ui/card'
import { useI18n } from '@/i18n/context'
import { formatMoneyLabel } from '@/lib/ledger-helpers'
import type { TodayViewModel } from './today-view-model'
import { RentPaymentDock } from './rent-payment-dock'

function rateMicrosToString(value: string | null): string {
  if (!value) return ''
  const normalized = value.padStart(7, '0')
  const whole = normalized.slice(0, -6) || '0'
  const fraction = normalized.slice(-6).replace(/0+$/, '')
  return fraction.length > 0 ? `${whole}.${fraction}` : whole
}

function sameCategory(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}

/**
 * Utilities stage panel — which bills are already entered for the current
 * period, which configured categories are still missing, and the bills total.
 */
export function UtilitiesBillsPanel() {
  const { copy, locale } = useI18n()
  const { dashboard, utilityLedger, utilityTotalMajor } = useDashboard()
  if (!dashboard) return null

  const categories = dashboard.utilityCategories ?? []
  const extraEntries = utilityLedger.filter(
    (entry) => !categories.some((category) => sameCategory(entry.title, category.name))
  )

  return (
    <Card>
      <CardHeader title={copy.homeUtilitiesBillsTitle} hint={copy.homeUtilitiesTitle} />

      {categories.length === 0 && utilityLedger.length === 0 ? (
        <p className="text-xs text-muted-foreground">{copy.homeFillUtilitiesBody}</p>
      ) : (
        <div className="divide-y divide-border/60">
          {categories.map((category) => {
            const entry = utilityLedger.find((item) => sameCategory(item.title, category.name))
            return (
              <div key={category.slug} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 truncate text-sm text-foreground">{category.name}</span>
                {entry ? (
                  <span className="font-mono text-sm font-semibold text-foreground">
                    {formatMoneyLabel(entry.displayAmountMajor, entry.displayCurrency, locale)}
                  </span>
                ) : (
                  <Badge tone="warning">{copy.notBilledYetLabel}</Badge>
                )}
              </div>
            )
          })}
          {extraEntries.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 truncate text-sm text-foreground">{entry.title}</span>
              <span className="font-mono text-sm font-semibold text-foreground">
                {formatMoneyLabel(entry.displayAmountMajor, entry.displayCurrency, locale)}
              </span>
            </div>
          ))}
          <div className="flex items-center justify-between gap-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">
              {copy.cycleTotalLabel}
            </span>
            <span className="font-mono text-sm font-semibold text-foreground">
              {formatMoneyLabel(utilityTotalMajor, dashboard.currency, locale)}
            </span>
          </div>
        </div>
      )}
    </Card>
  )
}

/**
 * Rent stage panel — settlement amount with FX context plus the rent payment
 * destinations dock.
 */
export function RentDetailsPanel({ model }: { model: TodayViewModel }) {
  const { copy, locale } = useI18n()
  const { dashboard } = useDashboard()
  if (!dashboard) return null

  const hasConversion =
    dashboard.rentSourceCurrency !== dashboard.currency || dashboard.rentFxRateMicros !== null
  const fxLabel = dashboard.rentFxRateMicros
    ? rateMicrosToString(dashboard.rentFxRateMicros)
    : dashboard.rentSourceCurrency === dashboard.currency
      ? copy.rentPanelNoConversion
      : copy.rentPanelAutoRate

  return (
    <Card className="space-y-3">
      <CardHeader className="mb-0" title={copy.homeRentTitle} hint={copy.todayRentBody} />

      <div className="divide-y divide-border/60 rounded-xl bg-elevated px-3">
        <div className="flex items-center justify-between gap-3 py-2">
          <span className="text-xs text-muted-foreground">{copy.rentPanelSettlementLabel}</span>
          <span className="font-mono text-sm font-semibold text-foreground">
            {formatMoneyLabel(dashboard.rentDisplayAmountMajor, dashboard.currency, locale)}
          </span>
        </div>
        {hasConversion ? (
          <>
            <div className="flex items-center justify-between gap-3 py-2">
              <span className="text-xs text-muted-foreground">
                {copy.rentPanelCycleSourceLabel}
              </span>
              <span className="font-mono text-sm text-foreground">
                {formatMoneyLabel(
                  dashboard.rentSourceAmountMajor,
                  dashboard.rentSourceCurrency,
                  locale
                )}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 py-2">
              <span className="text-xs text-muted-foreground">{copy.rentPanelFxLabel}</span>
              <span className="font-mono text-sm text-foreground">{fxLabel}</span>
            </div>
          </>
        ) : null}
      </div>

      {model.rentPaymentDestinations.length > 0 ? (
        <RentPaymentDock destinations={model.rentPaymentDestinations} />
      ) : null}
    </Card>
  )
}

/**
 * Idle stage panel — who invested how much into shared purchases this cycle,
 * built from the dashboard purchase investment chart.
 */
export function IdleHouseholdPanel() {
  const { copy, locale } = useI18n()
  const { dashboard, purchaseInvestmentChart } = useDashboard()
  if (!dashboard) return null

  const totalLabel = copy.homeIdlePurchaseTotalLabel.replace(
    '{amount}',
    formatMoneyLabel(purchaseInvestmentChart.totalMajor, dashboard.currency, locale)
  )

  return (
    <Card>
      <CardHeader title={copy.homePurchasePositionTitle} hint={totalLabel} />

      {purchaseInvestmentChart.slices.length === 0 ? (
        <p className="text-xs text-muted-foreground">{copy.homeIdlePurchasesEmpty}</p>
      ) : (
        <div className="space-y-2">
          {purchaseInvestmentChart.slices.map((slice) => (
            <div key={slice.key} className="flex items-center gap-2.5">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: slice.color }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">{slice.label}</span>
              <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-field">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${Math.max(4, slice.percentage)}%`,
                    backgroundColor: slice.color
                  }}
                />
              </span>
              <span className="w-20 shrink-0 text-right font-mono text-xs font-semibold text-foreground">
                {formatMoneyLabel(slice.amountMajor, dashboard.currency, locale)}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

/** House-wide snapshot for the active stage. Ported from HouseholdSummaryPanel. */
export function HouseholdSummaryPanel({ model }: { model: TodayViewModel }) {
  const { copy, locale } = useI18n()
  const { dashboard } = useDashboard()
  if (!dashboard) return null

  return (
    <Card>
      <p className="text-[11px] font-medium uppercase tracking-wide text-faint">
        {copy.todayCurrentPeriod}
      </p>
      <CardHeader
        className="mb-3 mt-0.5"
        title={copy.todayHouseSummaryTitle}
        hint={copy.todayHouseSummaryBody}
      />

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-elevated p-3">
          <p className="text-xs text-muted-foreground">{copy.todayHouseRemainingLabel}</p>
          <p className="mt-0.5 font-mono text-lg font-semibold text-foreground">
            {formatMoneyLabel(model.remainingMajor, dashboard.currency, locale)}
          </p>
        </div>
        <div className="rounded-xl bg-elevated p-3">
          <p className="text-xs text-muted-foreground">{copy.todayHouseOpenLabel}</p>
          <p className="mt-0.5 font-mono text-lg font-semibold text-foreground">
            {model.openMemberCount}
          </p>
        </div>
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-field" aria-hidden>
        <span
          className="block h-full rounded-full bg-primary"
          style={{ width: `${model.progressPercent}%` }}
        />
      </div>
    </Card>
  )
}

/** Admin ribbon that opens the close-whole-period confirmation. */
export function AdminClosePanel({
  model,
  loading,
  onOpenAdminClose
}: {
  model: TodayViewModel
  loading: boolean
  onOpenAdminClose: () => void
}) {
  const { copy, locale } = useI18n()
  const { dashboard } = useDashboard()
  if (!dashboard) return null

  return (
    <Card>
      <p className="text-[11px] font-medium uppercase tracking-wide text-faint">{copy.adminTag}</p>
      <CardHeader
        className="mb-3 mt-0.5"
        title={copy.todayAdminToolsTitle}
        hint={copy.todayAdminToolsBody}
      />

      <button
        type="button"
        disabled={loading}
        onClick={onOpenAdminClose}
        className="flex w-full items-center justify-between gap-3 rounded-xl bg-elevated px-3 py-3 transition-colors active:bg-field-hover disabled:opacity-50"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-primary">
          <CircleDollarSign className="size-4" />
          {copy.todayAdminCloseAll}
        </span>
        <span className="font-mono text-sm font-semibold text-foreground">
          {formatMoneyLabel(model.remainingMajor, dashboard.currency, locale)}
        </span>
      </button>
    </Card>
  )
}
