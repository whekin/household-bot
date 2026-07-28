import {
  Archive,
  ChevronRight,
  CircleDollarSign,
  House,
  Lightbulb,
  ReceiptText,
  ShoppingBag
} from 'lucide-react'
import { useState } from 'react'

import type { MiniAppDashboard } from '@/api'
import { Badge } from '@/components/ui/badge'
import { Sheet } from '@/components/ui/dialog'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/cn'
import { formatMoneyLabel } from '@/lib/ledger-helpers'
import { haptics } from '@/telegram/webapp'
import {
  cycleHistoryStatus,
  cyclePaymentProgressPercent,
  formatHistoryPeriod,
  type CycleHistoryEntry
} from './cycle-history-helpers'

type CycleHistory = NonNullable<MiniAppDashboard['cycleHistory']>

function Stat({ icon, label, amount }: { icon: React.ReactNode; label: string; amount: string }) {
  return (
    <div className="rounded-xl border border-white/12 bg-white/6 p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.13em] text-white/58">
        {icon}
        {label}
      </div>
      <p className="mt-1.5 font-mono text-sm font-semibold text-white">{amount}</p>
    </div>
  )
}

function MemberArchiveRow({
  cycle,
  member
}: {
  cycle: CycleHistoryEntry
  member: CycleHistoryEntry['members'][number]
}) {
  const { copy, locale } = useI18n()

  return (
    <div className="rounded-xl border border-border bg-background/55 p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium text-foreground">{member.displayName}</p>
        <p className="font-mono text-sm font-semibold text-foreground">
          {formatMoneyLabel(member.netDueMajor, cycle.currency, locale)}
        </p>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <p className="text-faint">{copy.historyMemberDue}</p>
          <p className="mt-0.5 font-mono text-muted-foreground">
            {formatMoneyLabel(member.netDueMajor, cycle.currency, locale)}
          </p>
        </div>
        <div>
          <p className="text-faint">{copy.historyMemberPaid}</p>
          <p className="mt-0.5 font-mono text-muted-foreground">
            {formatMoneyLabel(member.paidMajor, cycle.currency, locale)}
          </p>
        </div>
        <div>
          <p className="text-faint">{copy.historyMemberRemaining}</p>
          <p className="mt-0.5 font-mono text-muted-foreground">
            {formatMoneyLabel(member.remainingMajor, cycle.currency, locale)}
          </p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-2 text-[10px] text-faint">
        <span>
          {copy.shareRent} {formatMoneyLabel(member.rentShareMajor, cycle.currency, locale)}
        </span>
        <span>
          {copy.shareUtilities} {formatMoneyLabel(member.utilityShareMajor, cycle.currency, locale)}
        </span>
        <span>
          {copy.shareOffset} {formatMoneyLabel(member.purchaseOffsetMajor, cycle.currency, locale)}
        </span>
      </div>
    </div>
  )
}

function CycleHistoryDetail({ cycle }: { cycle: CycleHistoryEntry }) {
  const { copy, locale } = useI18n()
  const status = cycleHistoryStatus(cycle)

  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-2xl bg-foreground p-4 text-background">
        <div className="absolute -right-8 -top-10 size-28 rounded-full border border-white/10" />
        <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/55">
          {copy.historyArchiveEyebrow}
        </p>
        <div className="mt-1 flex items-end justify-between gap-3">
          <h3 className="font-display text-2xl font-semibold capitalize text-white">
            {formatHistoryPeriod(cycle.period, locale)}
          </h3>
          <Badge className="bg-white/10 text-white/72">
            {status === 'settled'
              ? copy.historySettled
              : status === 'credit'
                ? copy.historyCredit
                : copy.historyOutstanding}
          </Badge>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Stat
            icon={<CircleDollarSign className="size-3" />}
            label={copy.historyTotalDue}
            amount={formatMoneyLabel(cycle.totalDueMajor, cycle.currency, locale)}
          />
          <Stat
            icon={<ReceiptText className="size-3" />}
            label={copy.historyPaid}
            amount={formatMoneyLabel(cycle.totalPaidMajor, cycle.currency, locale)}
          />
          <Stat
            icon={<CircleDollarSign className="size-3" />}
            label={copy.historyRemaining}
            amount={formatMoneyLabel(cycle.totalRemainingMajor, cycle.currency, locale)}
          />
          <Stat
            icon={<House className="size-3" />}
            label={copy.historyRent}
            amount={formatMoneyLabel(cycle.rentTotalMajor, cycle.currency, locale)}
          />
          <Stat
            icon={<Lightbulb className="size-3" />}
            label={copy.historyUtilities}
            amount={formatMoneyLabel(cycle.utilityTotalMajor, cycle.currency, locale)}
          />
          <Stat
            icon={<ShoppingBag className="size-3" />}
            label={copy.historyPurchases}
            amount={formatMoneyLabel(cycle.purchaseVolumeMajor, cycle.currency, locale)}
          />
        </div>
      </div>

      <section>
        <div className="mb-2 flex items-end justify-between gap-3">
          <div>
            <h4 className="font-display font-semibold text-foreground">
              {copy.historyMembersTitle}
            </h4>
            <p className="text-xs text-faint">{copy.historyMembersBody}</p>
          </div>
          {cycle.source === 'legacy' ? (
            <Badge tone="outline">{copy.historyLegacyBadge}</Badge>
          ) : null}
        </div>
        <div className="space-y-2">
          {cycle.members.map((member) => (
            <MemberArchiveRow key={member.memberId} cycle={cycle} member={member} />
          ))}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <h4 className="font-display font-semibold text-foreground">
              {copy.historyContributorsTitle}
            </h4>
            <p className="text-xs text-faint">
              {copy.historyPurchaseCount.replace('{count}', String(cycle.purchaseCount))}
            </p>
          </div>
          <p className="font-mono text-sm font-semibold text-foreground">
            {formatMoneyLabel(cycle.purchaseVolumeMajor, cycle.currency, locale)}
          </p>
        </div>
        {cycle.purchaseContributors.length > 0 ? (
          <div className="space-y-2">
            {cycle.purchaseContributors.map((contributor, index) => (
              <div
                key={contributor.memberId}
                className="flex items-center gap-3 rounded-xl border border-border p-3"
              >
                <span className="flex size-7 items-center justify-center rounded-full bg-primary-soft font-mono text-xs font-semibold text-primary">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {contributor.displayName}
                  </p>
                  <p className="text-[11px] text-faint">
                    {copy.historyPurchaseCount.replace(
                      '{count}',
                      String(contributor.purchaseCount)
                    )}
                  </p>
                </div>
                <p className="font-mono text-sm font-semibold text-foreground">
                  {formatMoneyLabel(contributor.amountMajor, cycle.currency, locale)}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-faint">
            {copy.historyNoPurchases}
          </p>
        )}
      </section>
    </div>
  )
}

export function CycleHistoryArchive({ cycles }: { cycles: CycleHistory }) {
  const { copy, locale } = useI18n()
  const [selected, setSelected] = useState<CycleHistoryEntry | null>(null)

  return (
    <>
      <section className="relative overflow-hidden rounded-3xl border border-border bg-foreground p-5 text-background">
        <div className="pointer-events-none absolute -right-12 -top-16 size-44 rounded-full border border-white/8" />
        <div className="pointer-events-none absolute -right-3 -top-8 size-28 rounded-full border border-white/8" />
        <div className="relative">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-white/12 bg-white/8 text-white">
              <Archive className="size-4" />
            </span>
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/52">
                {copy.historyArchiveEyebrow}
              </p>
              <h2 className="mt-0.5 font-display text-xl font-semibold text-white">
                {copy.historyArchiveTitle}
              </h2>
              <p className="mt-1 max-w-sm text-xs leading-relaxed text-white/62">
                {copy.historyArchiveBody}
              </p>
            </div>
          </div>

          {cycles.length === 0 ? (
            <p className="mt-5 rounded-2xl border border-dashed border-white/15 px-4 py-5 text-center text-xs text-white/52">
              {copy.historyEmpty}
            </p>
          ) : (
            <div className="mt-5 space-y-2">
              {cycles.map((cycle) => {
                const status = cycleHistoryStatus(cycle)
                const progress = cyclePaymentProgressPercent(cycle)

                return (
                  <button
                    key={cycle.period}
                    type="button"
                    onClick={() => {
                      haptics.selection()
                      setSelected(cycle)
                    }}
                    className="group w-full rounded-2xl border border-white/10 bg-white/6 p-3.5 text-left transition-colors active:bg-white/10"
                  >
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate font-display text-base font-semibold capitalize text-white">
                            {formatHistoryPeriod(cycle.period, locale)}
                          </p>
                          <span
                            className={cn(
                              'size-1.5 rounded-full',
                              status === 'settled'
                                ? 'bg-primary'
                                : status === 'credit'
                                  ? 'bg-status-credit'
                                  : 'bg-status-due'
                            )}
                          />
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-[11px] text-white/52">
                          <span>
                            {copy.historyPurchaseCount.replace(
                              '{count}',
                              String(cycle.purchaseCount)
                            )}
                          </span>
                          <span aria-hidden>·</span>
                          <span>{Math.round(progress)}%</span>
                        </div>
                        <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
                          <div
                            className="h-full rounded-full bg-primary transition-[width]"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-mono text-sm font-semibold text-white">
                          {formatMoneyLabel(cycle.totalDueMajor, cycle.currency, locale)}
                        </p>
                        <p className="mt-0.5 text-[10px] text-white/48">
                          {status === 'settled'
                            ? copy.historySettled
                            : status === 'credit'
                              ? copy.historyCredit
                              : copy.historyOutstanding}
                        </p>
                      </div>
                      <ChevronRight className="size-4 shrink-0 text-white/35" />
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </section>

      <Sheet
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
        title={selected ? formatHistoryPeriod(selected.period, locale) : copy.historyArchiveTitle}
      >
        {selected ? <CycleHistoryDetail cycle={selected} /> : null}
      </Sheet>
    </>
  )
}
