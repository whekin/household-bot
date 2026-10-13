import { ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'

import { useDashboard } from '@/app/dashboard-context'
import { useReadySession } from '@/app/session-context'
import { KindIcon } from '@/components/kind'
import { formatMoney } from '@/components/money'
import { Skeleton } from '@/components/ui/skeleton'
import { PaymentEditor } from '@/features/activity/payment-editor'
import { PurchaseEditor } from '@/features/activity/purchase-editor'
import { UtilityEditor } from '@/features/activity/utility-editor'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/cn'
import { formatFriendlyDate, formatTodayParts } from '@/lib/dates'
import { majorStringToMinor } from '@/lib/money'
import { haptics } from '@/telegram/webapp'
import {
  entryDay,
  entryIcon,
  entryKind,
  entryTitle,
  newestFirst,
  purchaseShareForMember,
  type LedgerEntry
} from './entries'
import { EntrySheet } from './entry-sheet'
import { PastMonthSheet } from './past-month-sheet'
import { cycleHistoryStatus, formatHistoryPeriod, type CycleHistoryEntry } from './past-months'

type Filter = 'all' | 'buys' | 'bills' | 'payments'

function Chip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        if (!active) haptics.selection()
        onClick()
      }}
      className={cn(
        'flex h-9 shrink-0 items-center rounded-full px-4 text-[13px] font-semibold transition-colors',
        active ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground'
      )}
    >
      {label}
    </button>
  )
}

function shiftDay(day: string, delta: number): string {
  const [year, month, date] = day.split('-').map((part) => Number.parseInt(part, 10))
  const value = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (date ?? 1) + delta))
  return value.toISOString().slice(0, 10)
}

/** Everything that happened, newest first and grouped by day, with closed months below. */
export function HistoryView() {
  const session = useReadySession()
  const { copy, locale } = useI18n()
  const { dashboard, loading, effectiveTodayOverride } = useDashboard()

  const [filter, setFilter] = useState<Filter>('all')
  const [openOnly, setOpenOnly] = useState(false)
  const [detail, setDetail] = useState<LedgerEntry | null>(null)
  const [editing, setEditing] = useState<LedgerEntry | null>(null)
  const [pastMonth, setPastMonth] = useState<CycleHistoryEntry | null>(null)

  const groups = useMemo(() => {
    if (!dashboard) return []
    const entries = newestFirst(dashboard.ledger).filter((entry) => {
      if (filter === 'buys') {
        return entry.kind === 'purchase' && (!openOnly || entry.resolutionStatus !== 'resolved')
      }
      if (filter === 'bills') return entry.kind === 'utility'
      if (filter === 'payments') return entry.kind === 'payment'
      return true
    })
    const byDay = new Map<string, LedgerEntry[]>()
    for (const entry of entries) {
      const day = entryDay(entry, dashboard.timezone) ?? ''
      byDay.set(day, [...(byDay.get(day) ?? []), entry])
    }
    return [...byDay.entries()]
  }, [dashboard, filter, openOnly])

  if (loading || !dashboard) {
    return (
      <div className="space-y-3" role="status">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  const todayParts = effectiveTodayOverride ?? formatTodayParts(dashboard.timezone)
  const today = todayParts
    ? `${todayParts.year}-${String(todayParts.month).padStart(2, '0')}-${String(todayParts.day).padStart(2, '0')}`
    : ''
  const dayLabel = (day: string) =>
    day === today
      ? copy.historyToday
      : day === shiftDay(today, -1)
        ? copy.historyYesterday
        : day
          ? formatFriendlyDate(day, locale)
          : '—'

  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: copy.historyFilterAll },
    { id: 'buys', label: copy.historyFilterBuys },
    { id: 'bills', label: copy.historyFilterBills },
    { id: 'payments', label: copy.historyFilterPayments }
  ]
  const cycles = dashboard.cycleHistory ?? []
  const meId = session.member.id

  return (
    <div className="space-y-4">
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]">
        {filters.map((item) => (
          <Chip
            key={item.id}
            active={filter === item.id}
            label={item.label}
            onClick={() => setFilter(item.id)}
          />
        ))}
      </div>

      {filter === 'buys' ? (
        <div className="flex">
          <Chip
            active={openOnly}
            label={copy.historyOpenOnly}
            onClick={() => setOpenOnly((value) => !value)}
          />
        </div>
      ) : null}

      {groups.length === 0 ? (
        <p className="rounded-[24px] bg-card p-6 text-center text-sm text-muted-foreground">
          {copy.historyEmpty}
        </p>
      ) : (
        groups.map(([day, entries]) => (
          <section key={day} className="animate-rise">
            <h3 className="mb-1.5 px-1 text-[13px] font-semibold text-muted-foreground">
              {dayLabel(day)}
            </h3>
            <ul className="rounded-[24px] bg-card px-3 py-1">
              {entries.map((entry) => {
                const isOpenBuy = entry.kind === 'purchase' && entry.resolutionStatus !== 'resolved'
                const myShare =
                  entry.kind === 'purchase' && entry.payerMemberId !== meId
                    ? purchaseShareForMember(entry, meId)
                    : null
                const sub = [
                  entry.kind === 'payment'
                    ? (dashboard.members.find((member) => member.memberId === entry.memberId)
                        ?.displayName ?? entry.actorDisplayName)
                    : entry.actorDisplayName,
                  myShare && majorStringToMinor(myShare) > 0n
                    ? copy.historyYourShare.replace(
                        '{amount}',
                        formatMoney(myShare, entry.displayCurrency)
                      )
                    : null
                ]
                  .filter(Boolean)
                  .join(' · ')
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => setDetail(entry)}
                      className="flex min-h-16 w-full items-center gap-3 py-2 text-left"
                    >
                      <KindIcon kind={entryKind(entry)} icon={entryIcon(entry)} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium">
                          {entryTitle(entry, copy)}
                        </span>
                        <span className="block truncate text-xs text-faint">{sub}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-[15px] font-semibold tabular-nums">
                          {formatMoney(entry.displayAmountMajor, entry.displayCurrency)}
                        </span>
                        {isOpenBuy ? (
                          <span className="block text-xs text-util-ink">
                            {copy.historyNotPaidBack}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        ))
      )}

      <section className="pt-2">
        <h3 className="mb-1.5 px-1 text-[15px] font-semibold">{copy.historyPastMonths}</h3>
        {cycles.length === 0 ? (
          <p className="rounded-[24px] bg-card p-5 text-sm text-muted-foreground">
            {copy.historyPastEmpty}
          </p>
        ) : (
          <ul className="rounded-[24px] bg-card px-3 py-1">
            {cycles.map((cycle) => {
              const status = cycleHistoryStatus(cycle)
              return (
                <li key={cycle.period}>
                  <button
                    type="button"
                    onClick={() => setPastMonth(cycle)}
                    className="flex min-h-14 w-full items-center gap-3 py-2 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-medium first-letter:uppercase">
                        {formatHistoryPeriod(cycle.period, locale)}
                      </span>
                      <span
                        className={cn(
                          'block text-xs',
                          status === 'outstanding' ? 'text-danger' : 'text-faint'
                        )}
                      >
                        {status === 'settled'
                          ? copy.historyMonthAllPaid
                          : status === 'outstanding'
                            ? copy.historyMonthLeft.replace(
                                '{amount}',
                                formatMoney(cycle.totalRemainingMajor, cycle.currency)
                              )
                            : copy.historyMonthOverpaid.replace(
                                '{amount}',
                                formatMoney(cycle.totalRemainingMajor, cycle.currency)
                              )}
                      </span>
                    </span>
                    <span className="text-[15px] font-semibold tabular-nums">
                      {formatMoney(cycle.totalDueMajor, cycle.currency)}
                    </span>
                    <ChevronRight className="size-4 text-faint" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {detail ? (
        <EntrySheet
          entry={detail}
          onOpenChange={(open) => !open && setDetail(null)}
          onEdit={(entry) => {
            setDetail(null)
            setEditing(entry)
          }}
        />
      ) : null}
      {editing?.kind === 'purchase' ? (
        <PurchaseEditor open entry={editing} onOpenChange={(open) => !open && setEditing(null)} />
      ) : null}
      {editing?.kind === 'utility' ? (
        <UtilityEditor open entry={editing} onOpenChange={(open) => !open && setEditing(null)} />
      ) : null}
      {editing?.kind === 'payment' ? (
        <PaymentEditor
          open
          entry={editing}
          prefill={null}
          onOpenChange={(open) => !open && setEditing(null)}
        />
      ) : null}
      {pastMonth ? (
        <PastMonthSheet cycle={pastMonth} onOpenChange={(open) => !open && setPastMonth(null)} />
      ) : null}
    </div>
  )
}
