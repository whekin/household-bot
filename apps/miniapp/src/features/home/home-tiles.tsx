import { ChevronRight } from 'lucide-react'

import type { MiniAppDashboard } from '@/api'
import { Amount } from '@/components/money'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/cn'
import { majorStringToMinor, minorToMajorString } from '@/lib/money'
import type { HomeModel } from './home-model'

function Tile({
  className,
  onClick,
  label,
  children,
  footer
}: {
  className: string
  onClick: () => void
  label: string
  children: React.ReactNode
  footer: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex min-h-[132px] flex-col rounded-[24px] p-4 text-left transition-transform active:scale-[0.98]',
        className
      )}
    >
      <span className="flex w-full items-center justify-between text-[13px] font-semibold">
        {label}
        <ChevronRight className="size-4 opacity-50" />
      </span>
      <span className="mt-auto pt-3">{children}</span>
      <span className="mt-1 text-xs font-medium opacity-75">{footer}</span>
    </button>
  )
}

/** My shared-purchase balance, said as a direction rather than a sign. */
export function BuysTile({
  model,
  currency,
  onClick
}: {
  model: HomeModel
  currency: MiniAppDashboard['currency']
  onClick: () => void
}) {
  const { copy } = useI18n()
  const minor = majorStringToMinor(model.buysBalanceMajor)
  const absolute = minorToMajorString(minor < 0n ? -minor : minor)
  const label =
    model.buysDirection === 'owed'
      ? copy.buysOwedTitle
      : model.buysDirection === 'owe'
        ? copy.buysOweTitle
        : copy.buysEvenTitle
  const footer =
    model.buysDirection === 'even'
      ? copy.kindBuys
      : model.buysSettleThrough === 'utilities'
        ? copy.buysSettleUtilities
        : model.buysSettleThrough === 'rent'
          ? copy.buysSettleRent
          : copy.buysSettleDirect

  return (
    <Tile
      onClick={onClick}
      label={label}
      footer={footer}
      className={
        model.buysDirection === 'owe' ? 'bg-util-soft text-util-ink' : 'bg-buys-soft text-buys-ink'
      }
    >
      <Amount value={absolute} currency={currency} className="text-[26px] font-bold leading-none" />
    </Tile>
  )
}

/** How many housemates have paid everything that is open this period. */
export function HouseTile({
  dashboard,
  onClick
}: {
  dashboard: MiniAppDashboard
  onClick: () => void
}) {
  const { copy } = useI18n()
  const active = dashboard.members.filter((member) => member.status !== 'left')
  const current = (dashboard.paymentPeriods ?? []).find((period) => period.isCurrentPeriod)
  const open = new Set(
    (current?.kinds ?? []).flatMap((kind) =>
      kind.unresolvedMembers
        .filter((member) => majorStringToMinor(member.remainingMajor) > 0n)
        .map((member) => member.memberId)
    )
  )
  const paid = active.filter((member) => !open.has(member.memberId)).length

  return (
    <Tile
      onClick={onClick}
      label={copy.houseTileTitle}
      footer={open.size === 0 ? copy.houseTileAllPaid : copy.houseTilePaid}
      className="bg-rent-soft text-rent-ink"
    >
      <span className="font-display text-[26px] font-bold leading-none tabular-nums">
        {paid}
        <span className="text-[0.6em] opacity-60"> / {active.length}</span>
      </span>
    </Tile>
  )
}
