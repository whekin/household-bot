import { Play, Square } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Sheet } from '@/components/ui/dialog'
import { useToast } from '@/components/toast'
import { useDashboard } from '@/app/dashboard-context'
import { useSession } from '@/app/session-context'
import { useI18n } from '@/i18n/context'
import { formatCyclePeriod } from '@/lib/dates'
import { minorToMajorString } from '@/lib/money'
import { confirmDialog } from '@/telegram/webapp'
import { closeMiniAppBillingCycle, openMiniAppBillingCycle } from '@/api'

import { CurrencyToggle } from './toggles'

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  )
}

export function CycleSheet({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { initData, handleMiniAppRequestError } = useSession()
  const { dashboard, adminSettings, cycleState, effectivePeriod, refresh } = useDashboard()
  const { copy, locale } = useI18n()
  const { showToast } = useToast()

  const cycle = cycleState?.cycle ?? null
  const rentRule = cycleState?.rentRule ?? null
  const defaultPeriod = effectivePeriod ?? dashboard?.period ?? ''
  const defaultCurrency = adminSettings?.settings.settlementCurrency ?? 'GEL'

  const [period, setPeriod] = useState(defaultPeriod)
  const [currency, setCurrency] = useState<'USD' | 'GEL'>(defaultCurrency)
  const [opening, setOpening] = useState(false)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    if (!open) return
    setPeriod(defaultPeriod)
    setCurrency(defaultCurrency)
    // Reset the open-cycle draft each time the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function handleOpenCycle() {
    if (!initData || opening || !period) return
    setOpening(true)
    try {
      await openMiniAppBillingCycle(initData, { period, currency })
      await refresh()
    } catch (error) {
      if (!handleMiniAppRequestError(error)) {
        showToast(
          locale === 'ru' ? 'Не получилось открыть цикл.' : 'Failed to open billing cycle.',
          'error'
        )
      }
    } finally {
      setOpening(false)
    }
  }

  async function handleCloseCycle() {
    if (!initData || closing || !cycle) return
    const ok = await confirmDialog(
      locale === 'ru'
        ? `Закрыть расчётный цикл ${formatCyclePeriod(cycle.period, locale)}?`
        : `Close the ${formatCyclePeriod(cycle.period, locale)} billing cycle?`
    )
    if (!ok) return

    setClosing(true)
    try {
      await closeMiniAppBillingCycle(initData, cycle.period)
      await refresh()
    } catch (error) {
      if (!handleMiniAppRequestError(error)) {
        showToast(
          locale === 'ru' ? 'Не получилось закрыть цикл.' : 'Failed to close billing cycle.',
          'error'
        )
      }
    } finally {
      setClosing(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={copy.billingCycleTitle}>
      {cycle ? (
        <div className="space-y-4">
          <section className="space-y-2 rounded-xl bg-elevated p-3">
            <InfoRow
              label={copy.billingCyclePeriod}
              value={formatCyclePeriod(cycle.period, locale)}
            />
            <InfoRow
              label={copy.currencyLabel}
              value={copy.billingCycleStatus.replace('{currency}', cycle.currency)}
            />
            <InfoRow
              label={copy.currentCycleRentLabel}
              value={
                rentRule
                  ? `${minorToMajorString(BigInt(rentRule.amountMinor))} ${rentRule.currency}`
                  : copy.currentCycleRentEmpty
              }
            />
          </section>

          <Button
            variant="destructive"
            className="w-full"
            loading={closing}
            onClick={() => void handleCloseCycle()}
          >
            <Square className="size-4" aria-hidden />
            {closing ? copy.closingCycle : copy.closeCycleAction}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm font-medium text-foreground">{copy.billingCycleEmpty}</p>
          <p className="text-sm text-muted-foreground">{copy.billingCycleOpenHint}</p>

          <div className="grid grid-cols-2 gap-3">
            <Field label={copy.billingCyclePeriod}>
              <Input
                type="month"
                value={period}
                onChange={(event) => setPeriod(event.target.value)}
              />
            </Field>
            <Field label={copy.currencyLabel}>
              <CurrencyToggle
                value={currency}
                ariaLabel={copy.currencyLabel}
                onChange={setCurrency}
              />
            </Field>
          </div>

          <Button
            variant="primary"
            className="w-full"
            loading={opening}
            disabled={!period}
            onClick={() => void handleOpenCycle()}
          >
            <Play className="size-4" aria-hidden />
            {opening ? copy.openingCycle : copy.openCycleAction}
          </Button>
        </div>
      )}
    </Sheet>
  )
}
