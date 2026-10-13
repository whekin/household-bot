import { Avatar } from '@/components/avatar'
import { KindDot } from '@/components/kind'
import { formatMoney } from '@/components/money'
import { Sheet } from '@/components/ui/dialog'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/cn'
import { majorStringToMinor } from '@/lib/money'
import { cycleHistoryStatus, formatHistoryPeriod, type CycleHistoryEntry } from './past-months'

/** A closed month as it was settled: totals, each person, and who bought for the house. */
export function PastMonthSheet({
  cycle,
  onOpenChange
}: {
  cycle: CycleHistoryEntry
  onOpenChange: (open: boolean) => void
}) {
  const { copy, locale } = useI18n()
  const status = cycleHistoryStatus(cycle)
  const money = (value: string) => formatMoney(value, cycle.currency)

  return (
    <Sheet
      open
      onOpenChange={onOpenChange}
      title={
        <span className="inline-block first-letter:uppercase">
          {formatHistoryPeriod(cycle.period, locale)}
        </span>
      }
      description={
        status === 'settled'
          ? copy.historyMonthAllPaid
          : status === 'outstanding'
            ? copy.historyMonthLeft.replace('{amount}', money(cycle.totalRemainingMajor))
            : // formatMoney prints the absolute value; the words carry the direction.
              copy.historyMonthOverpaid.replace('{amount}', money(cycle.totalRemainingMajor))
      }
    >
      <div className="space-y-3">
        <section className="grid grid-cols-3 gap-2">
          {[
            [copy.pastMonthTotal, cycle.totalDueMajor],
            [copy.pastMonthPaid, cycle.totalPaidMajor],
            [copy.pastMonthLeft, cycle.totalRemainingMajor]
          ].map(([label, value]) => (
            <div key={label} className="rounded-[20px] bg-card p-3">
              <p className="text-xs text-faint">{label}</p>
              <p className="mt-0.5 text-[15px] font-bold tabular-nums">{money(value ?? '0.00')}</p>
            </div>
          ))}
        </section>

        <section className="divide-y divide-border rounded-[24px] bg-card px-4 py-1">
          {(
            [
              ['rent', copy.pastMonthRent, cycle.rentTotalMajor],
              ['utilities', copy.pastMonthUtilities, cycle.utilityTotalMajor],
              ['buys', copy.pastMonthBuys, cycle.purchaseVolumeMajor]
            ] as const
          ).map(([kind, label, value]) => (
            <div key={kind} className="flex items-center gap-2.5 py-2.5 text-sm">
              <KindDot kind={kind} className="size-2.5" />
              <span className="flex-1 text-muted-foreground">{label}</span>
              <span className="font-semibold tabular-nums">{money(value)}</span>
            </div>
          ))}
        </section>

        <section className="rounded-[24px] bg-card p-4">
          <h3 className="mb-1 text-[13px] font-semibold text-muted-foreground">
            {copy.pastMonthPeople}
          </h3>
          <ul className="divide-y divide-border">
            {cycle.members.map((member) => {
              const left = majorStringToMinor(member.remainingMajor)
              return (
                <li key={member.memberId} className="flex items-center gap-3 py-2.5">
                  <Avatar name={member.displayName} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium">
                      {member.displayName}
                    </span>
                    <span className="block truncate text-xs text-faint">
                      {copy.pastMonthPersonLine
                        .replace('{rent}', money(member.rentShareMajor))
                        .replace('{utilities}', money(member.utilityShareMajor))}
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block text-[15px] font-semibold tabular-nums">
                      {money(member.netDueMajor)}
                    </span>
                    <span
                      className={cn('block text-xs', left > 0n ? 'text-danger' : 'text-buys-ink')}
                    >
                      {left > 0n
                        ? copy.historyMonthLeft.replace('{amount}', money(member.remainingMajor))
                        : copy.historyMonthAllPaid}
                    </span>
                  </span>
                </li>
              )
            })}
          </ul>
        </section>

        {cycle.purchaseContributors.length > 0 ? (
          <section className="rounded-[24px] bg-card p-4">
            <h3 className="mb-1 text-[13px] font-semibold text-muted-foreground">
              {copy.pastMonthBuyers}
            </h3>
            <ul className="divide-y divide-border">
              {cycle.purchaseContributors.map((contributor) => (
                <li key={contributor.memberId} className="flex items-center gap-3 py-2.5">
                  <Avatar name={contributor.displayName} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium">
                      {contributor.displayName}
                    </span>
                    <span className="block text-xs text-faint">
                      {copy.historyMonthBuys.replace('{count}', String(contributor.purchaseCount))}
                    </span>
                  </span>
                  <span className="text-[15px] font-semibold tabular-nums">
                    {money(contributor.amountMajor)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {cycle.source === 'legacy' ? (
          <p className="px-2 text-center text-xs text-faint">{copy.pastMonthEarlier}</p>
        ) : null}
      </div>
    </Sheet>
  )
}
