import { CircleCheck, ChevronRight } from 'lucide-react'

import type { MiniAppDashboard } from '@/api'
import { KindIcon, type Kind } from '@/components/kind'
import { formatMoney } from '@/components/money'
import type { Copy } from '@/i18n'
import { useI18n } from '@/i18n/context'
import { formatFriendlyDate } from '@/lib/dates'

type LedgerEntry = MiniAppDashboard['ledger'][number]

export function entryKind(entry: LedgerEntry): Kind {
  if (entry.kind === 'purchase') return 'buys'
  if (entry.kind === 'utility') return 'utilities'
  return entry.paymentKind === 'rent' ? 'rent' : 'utilities'
}

export function entryTitle(entry: LedgerEntry, copy: Copy): string {
  if (entry.kind === 'purchase') return entry.title
  if (entry.kind === 'utility') return copy.entryBill.replace('{name}', entry.title)
  return entry.paymentKind === 'rent' ? copy.entryRentPaid : copy.entryUtilitiesPaid
}

/** The last few things that happened in the house, newest first. */
export function RecentCard({
  ledger,
  onSeeAll
}: {
  ledger: readonly LedgerEntry[]
  onSeeAll: () => void
}) {
  const { copy, locale } = useI18n()
  const entries = [...ledger]
    .filter((entry) => !entry.isRoundingAdjustment)
    .sort((left, right) => (right.occurredAt ?? '').localeCompare(left.occurredAt ?? ''))
    .slice(0, 4)

  return (
    <section className="animate-rise rounded-[24px] bg-card p-4 [animation-delay:180ms]">
      <button
        type="button"
        onClick={onSeeAll}
        className="mb-1 flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="text-[15px] font-semibold">{copy.recentTitle}</span>
        <span className="flex items-center gap-0.5 text-[13px] font-medium text-faint">
          {copy.recentSeeAll}
          <ChevronRight className="size-4" />
        </span>
      </button>

      {entries.length === 0 ? (
        <p className="py-3 text-sm text-muted-foreground">{copy.recentEmpty}</p>
      ) : (
        <ul>
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-center gap-3 py-2">
              <KindIcon
                kind={entryKind(entry)}
                {...(entry.kind === 'payment' ? { icon: CircleCheck } : {})}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-medium">{entryTitle(entry, copy)}</p>
                <p className="truncate text-xs text-faint">
                  {[
                    entry.actorDisplayName,
                    entry.occurredAt ? formatFriendlyDate(entry.occurredAt, locale) : null
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              <p className="shrink-0 text-[15px] font-semibold tabular-nums">
                {formatMoney(entry.displayAmountMajor, entry.displayCurrency)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
