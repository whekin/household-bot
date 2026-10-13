import { useDashboard } from '@/app/dashboard-context'
import { useReadySession } from '@/app/session-context'
import { Avatar } from '@/components/avatar'
import { formatMoney } from '@/components/money'
import { Sheet } from '@/components/ui/dialog'
import { RepaymentsSection } from '@/features/activity/repayments-section'
import { purchaseShareForMember } from '@/features/history/entries'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/cn'
import { formatFriendlyDate } from '@/lib/dates'
import { majorStringToMinor, minorToMajorString } from '@/lib/money'
import { buysSummary } from './home-model'

function absolute(amountMajor: string): string {
  const minor = majorStringToMinor(amountMajor)
  return minorToMajorString(minor < 0n ? -minor : minor)
}

/**
 * Shared buys in one place: where the reader stands, where everyone stands, the
 * purchases nobody has paid back yet, and the way to settle up directly.
 */
export function BuysSheet({
  open,
  onOpenChange,
  startWithTransfer = false
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  startWithTransfer?: boolean
}) {
  const { copy, locale } = useI18n()
  const session = useReadySession()
  const { dashboard, activePurchaseLedger } = useDashboard()
  if (!dashboard) return null
  const currency = dashboard.currency
  const meId = session.member.id
  const model = buysSummary(dashboard, meId)

  const headline =
    model.buysDirection === 'owed'
      ? copy.buysSheetOwed.replace(
          '{amount}',
          formatMoney(absolute(model.buysBalanceMajor), currency)
        )
      : model.buysDirection === 'owe'
        ? copy.buysSheetOwe.replace('{amount}', formatMoney(model.buysBalanceMajor, currency))
        : copy.buysSheetEven
  const explanation =
    model.buysDirection === 'even'
      ? null
      : model.buysSettleThrough === 'utilities'
        ? copy.buysSheetUtilities
        : model.buysSettleThrough === 'rent'
          ? copy.buysSheetRent
          : copy.buysSheetDirect

  const members = dashboard.members
    .filter((member) => member.status !== 'left')
    .map((member) => ({ member, minor: majorStringToMinor(member.purchaseOffsetMajor) }))
    .sort((left, right) => (left.minor < right.minor ? -1 : left.minor > right.minor ? 1 : 0))
  const largest = members.reduce(
    (max, { minor }) => ((minor < 0n ? -minor : minor) > max ? (minor < 0n ? -minor : minor) : max),
    1n
  )

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={copy.buysSheetTitle}>
      <div className="space-y-4">
        <section className="rounded-[24px] bg-buys-soft p-4 text-buys-ink">
          <p className="font-display text-lg font-bold leading-snug">{headline}</p>
          {explanation ? <p className="mt-1 text-[13px] opacity-80">{explanation}</p> : null}
        </section>

        <section className="rounded-[24px] bg-card p-4">
          <h3 className="mb-3 text-[13px] font-semibold text-muted-foreground">
            {copy.buysEveryone}
          </h3>
          <ul className="space-y-3">
            {members.map(({ member, minor }) => {
              const width = Number(((minor < 0n ? -minor : minor) * 100n) / largest)
              return (
                <li key={member.memberId} className="flex items-center gap-3">
                  <Avatar name={member.displayName} me={member.memberId === meId} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="truncate font-medium">
                        {member.displayName}
                        {member.memberId === meId ? (
                          <span className="text-faint"> · {copy.youSuffix}</span>
                        ) : null}
                      </span>
                      <span
                        className={cn(
                          'shrink-0 text-[13px] font-semibold tabular-nums',
                          minor > 0n ? 'text-util-ink' : minor < 0n ? 'text-buys-ink' : 'text-faint'
                        )}
                      >
                        {minor > 0n
                          ? copy.buysMemberOwes.replace(
                              '{amount}',
                              formatMoney(member.purchaseOffsetMajor, currency)
                            )
                          : minor < 0n
                            ? copy.buysMemberOwed.replace(
                                '{amount}',
                                formatMoney(absolute(member.purchaseOffsetMajor), currency)
                              )
                            : copy.buysMemberEven}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-elevated">
                      <span
                        className={cn(
                          'block h-full rounded-full',
                          minor > 0n ? 'bg-util' : 'bg-buys'
                        )}
                        style={{ width: `${minor === 0n ? 0 : Math.max(4, width)}%` }}
                      />
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>

        {activePurchaseLedger.length > 0 ? (
          <section className="rounded-[24px] bg-card p-4">
            <h3 className="mb-1 text-[13px] font-semibold text-muted-foreground">
              {copy.buysOpenTitle}
            </h3>
            <ul className="divide-y divide-border">
              {activePurchaseLedger.map((entry) => {
                const mine = entry.payerMemberId === meId
                const share = mine ? null : purchaseShareForMember(entry, meId)
                return (
                  <li key={entry.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{entry.title}</p>
                      <p className="truncate text-xs text-faint">
                        {[
                          entry.actorDisplayName,
                          entry.occurredAt ? formatFriendlyDate(entry.occurredAt, locale) : null
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold tabular-nums">
                        {formatMoney(entry.displayAmountMajor, entry.displayCurrency)}
                      </p>
                      <p className="text-xs text-faint">
                        {mine
                          ? copy.buysYouBought
                          : share
                            ? copy.buysYourShare.replace('{amount}', formatMoney(share, currency))
                            : null}
                      </p>
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        ) : null}

        <RepaymentsSection autoOpenTransfer={startWithTransfer} />
      </div>
    </Sheet>
  )
}
