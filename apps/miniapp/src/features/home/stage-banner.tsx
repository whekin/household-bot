import { Check } from 'lucide-react'

import { useDashboard } from '@/app/dashboard-context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useI18n } from '@/i18n/context'
import type { Copy } from '@/i18n'
import { formatCyclePeriod } from '@/lib/dates'
import { formatMoneyLabel } from '@/lib/ledger-helpers'
import { majorStringToMinor } from '@/lib/money'
import { cn } from '@/lib/cn'
import { PersonalGroup, PersonalLine } from './personal-details'
import { railSegmentState } from './today-view-model'
import type { TodayMemberCloseLine, TodayViewModel } from './today-view-model'

function stageLabel(kind: TodayViewModel['timelineSegments'][number]['kind'], copy: Copy): string {
  if (kind === 'utilities') return copy.todayUtilitiesStage
  if (kind === 'rent') return copy.todayRentStage
  return copy.todayIdleStage
}

/**
 * Stage banner — current billing stage, period, timeline of key dates, the
 * member's own numbers, and the primary "I paid" action. Ported from the
 * legacy CurrentPeriodPanel.
 */
export function StageBanner({
  model,
  currentMemberLine,
  closing,
  onCloseMine
}: {
  model: TodayViewModel
  currentMemberLine: TodayMemberCloseLine | null
  closing: boolean
  onCloseMine: () => void
}) {
  const { copy, locale } = useI18n()
  const { dashboard } = useDashboard()
  const currency = dashboard?.currency ?? 'GEL'

  // The headline is always about the reader: what they owe now, or their standing
  // balance when they owe nothing. It used to swap in the household figure under a
  // household label while still printing the reader's own balance, so the label and
  // the number disagreed. The household total now has its own line underneath.
  const myRemainingMinor = majorStringToMinor(currentMemberLine?.amountMajor ?? '0.00')
  const owesNow = model.stage !== 'idle' && myRemainingMinor > 0n
  const focusAmountMajor = owesNow
    ? (currentMemberLine?.amountMajor ?? '0.00')
    : model.purchaseBalanceMajor
  const focusLabel = owesNow ? copy.todayYourCheck : copy.todayPurchaseBalance
  const stageTitle =
    model.stage === 'utilities'
      ? copy.todayUtilitiesStage
      : model.stage === 'rent'
        ? copy.todayRentStage
        : copy.todayIdleStage
  const nextWindowTitle =
    model.nextWindow?.kind === 'utilities'
      ? copy.todayNextWindowUtilities
      : model.nextWindow?.kind === 'rent'
        ? copy.todayNextWindowRent
        : null

  return (
    <Card data-stage={model.stage} className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-primary">
          {formatCyclePeriod(model.period, locale)}
        </p>
        {model.isExtendedPeriod ? <Badge tone="warning">{copy.todayExtendedPeriod}</Badge> : null}
      </div>

      <div aria-label={copy.todayProgressLabel} className="flex gap-1">
        {model.timelineSegments.map((segment) => {
          const state = railSegmentState(model, segment)
          return (
            <div
              key={segment.key}
              data-state={state}
              className="min-w-0"
              style={{ flexGrow: segment.renderSpanDays, flexBasis: 0 }}
            >
              <span
                className={cn(
                  'block h-1 rounded-full',
                  state === 'active' ? 'bg-primary' : 'bg-field'
                )}
              />
              <p
                className={cn(
                  'mt-1 truncate text-[10px] font-medium',
                  state === 'active' ? 'text-primary' : 'text-faint'
                )}
              >
                {stageLabel(segment.kind, copy)}
              </p>
            </div>
          )
        })}
      </div>

      <div>
        <p className="text-xs text-muted-foreground">{focusLabel}</p>
        <p className="font-mono text-3xl font-semibold text-foreground">
          {formatMoneyLabel(focusAmountMajor, currency, locale)}
        </p>
        {model.stage !== 'idle' ? (
          <p className="text-xs text-muted-foreground">
            {copy.todayHouseStillOpen}: {formatMoneyLabel(model.remainingMajor, currency, locale)}
          </p>
        ) : null}
        <h2 className="mt-1 font-display text-lg font-semibold text-foreground">{stageTitle}</h2>
        {/* Only the quiet stage needs a sentence: with no window open and nothing
            to act on, it is the one state the rest of the screen cannot explain. */}
        {model.stage === 'idle' ? (
          <p className="text-xs text-muted-foreground">{copy.todayIdleBody}</p>
        ) : null}
      </div>

      <div className="space-y-2 empty:hidden">
        {model.stage === 'idle' && model.nextWindow && nextWindowTitle ? (
          <PersonalGroup title={copy.todayNextWindowLabel}>
            <PersonalLine label={nextWindowTitle} value={model.nextWindow.rangeLabel} />
          </PersonalGroup>
        ) : null}
      </div>

      {model.stage !== 'idle' ? (
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          loading={closing}
          disabled={myRemainingMinor <= 0n}
          onClick={onCloseMine}
        >
          <Check className="size-4" />
          {model.stage === 'utilities' ? copy.todayCloseMyUtilities : copy.todayCloseMyRent}
        </Button>
      ) : null}
    </Card>
  )
}
