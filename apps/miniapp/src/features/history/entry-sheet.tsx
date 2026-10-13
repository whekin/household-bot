import { Check, PenLine } from 'lucide-react'
import type { ReactNode } from 'react'

import { useDashboard } from '@/app/dashboard-context'
import { useReadySession } from '@/app/session-context'
import { Avatar } from '@/components/avatar'
import { KindIcon } from '@/components/kind'
import { formatMoney } from '@/components/money'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/dialog'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/cn'
import { formatCyclePeriod, formatFriendlyDate } from '@/lib/dates'
import { canEditLedgerEntry } from '@/lib/ledger-helpers'
import { majorStringToMinor } from '@/lib/money'
import {
  entryIcon,
  entryKind,
  entryTitle,
  purchaseShareForMember,
  type LedgerEntry
} from './entries'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right font-medium">{children}</span>
    </div>
  )
}

/**
 * Everything about one entry, for everyone. For a shared buy that means who owes
 * what and who has paid back; editing is one tap away for whoever may edit it.
 */
export function EntrySheet({
  entry,
  onOpenChange,
  onEdit
}: {
  entry: LedgerEntry
  onOpenChange: (open: boolean) => void
  onEdit: (entry: LedgerEntry) => void
}) {
  const { copy, locale } = useI18n()
  const session = useReadySession()
  const { dashboard, effectiveIsAdmin } = useDashboard()
  if (!dashboard) return null

  const meId = session.member.id
  const editable = canEditLedgerEntry({ entry, currentMemberId: meId, isAdmin: effectiveIsAdmin })
  const names = new Map(dashboard.members.map((member) => [member.memberId, member.displayName]))
  const showOriginal =
    entry.currency !== entry.displayCurrency || entry.amountMajor !== entry.displayAmountMajor

  const participants =
    entry.kind === 'purchase'
      ? (entry.purchaseParticipants ?? [])
          .filter((participant) => participant.included)
          .map((participant) => {
            const outstanding = entry.outstandingByMember?.find(
              (item) => item.memberId === participant.memberId
            )
            return {
              memberId: participant.memberId,
              name: names.get(participant.memberId) ?? participant.memberId,
              shareMajor: purchaseShareForMember(entry, participant.memberId) ?? '0.00',
              isPayer: participant.memberId === entry.payerMemberId,
              owesMajor: outstanding?.amountMajor ?? '0.00'
            }
          })
          .sort((left, right) => Number(right.isPayer) - Number(left.isPayer))
      : []

  return (
    <Sheet open onOpenChange={onOpenChange} title={entryTitle(entry, copy)}>
      <div className="space-y-3">
        <section className="flex items-center gap-4 rounded-[24px] bg-card p-4">
          <KindIcon
            kind={entryKind(entry)}
            icon={entryIcon(entry)}
            className="size-12 rounded-[18px]"
          />
          <div className="min-w-0">
            <p className="font-display text-[28px] font-bold leading-tight tabular-nums">
              {formatMoney(entry.displayAmountMajor, entry.displayCurrency)}
            </p>
            {showOriginal ? (
              <p className="text-xs text-faint">
                {copy.entryOriginal.replace(
                  '{amount}',
                  formatMoney(entry.amountMajor, entry.currency)
                )}
              </p>
            ) : null}
          </div>
        </section>

        <section className="divide-y divide-border rounded-[24px] bg-card px-4 py-1">
          <Row
            label={
              entry.kind === 'purchase' || entry.kind === 'payment'
                ? copy.entryPaidBy
                : copy.entryEnteredBy
            }
          >
            {entry.kind === 'payment'
              ? (names.get(entry.memberId ?? '') ??
                entry.actorDisplayName ??
                copy.ledgerActorFallback)
              : (entry.actorDisplayName ?? copy.ledgerActorFallback)}
          </Row>
          {entry.occurredAt ? (
            <Row label={copy.entryDate}>{formatFriendlyDate(entry.occurredAt, locale)}</Row>
          ) : null}
          {entry.kind === 'purchase' && entry.originPeriod ? (
            <Row label={copy.entryForMonth}>
              <span className="inline-block first-letter:uppercase">
                {formatCyclePeriod(entry.originPeriod, locale)}
              </span>
            </Row>
          ) : null}
          {entry.kind === 'purchase' ? (
            <Row label={copy.entrySplit}>
              {entry.purchaseSplitMode === 'custom_amounts'
                ? copy.entrySplitCustom
                : copy.entrySplitEqual}
            </Row>
          ) : null}
        </section>

        {participants.length > 0 ? (
          <section className="rounded-[24px] bg-card p-4">
            <h3 className="mb-1 text-[13px] font-semibold text-muted-foreground">
              {copy.entryShares}
            </h3>
            <ul className="divide-y divide-border">
              {participants.map((participant) => {
                const owes = majorStringToMinor(participant.owesMajor) > 0n
                return (
                  <li key={participant.memberId} className="flex items-center gap-3 py-2.5">
                    <Avatar name={participant.name} me={participant.memberId === meId} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium">
                        {participant.name}
                      </span>
                      <span
                        className={cn(
                          'flex items-center gap-1 text-xs',
                          participant.isPayer
                            ? 'text-faint'
                            : owes
                              ? 'text-util-ink'
                              : 'text-buys-ink'
                        )}
                      >
                        {participant.isPayer ? (
                          copy.entryBought
                        ) : owes ? (
                          copy.entryOwes.replace(
                            '{amount}',
                            formatMoney(participant.owesMajor, entry.displayCurrency)
                          )
                        ) : (
                          <>
                            <Check className="size-3" strokeWidth={3} />
                            {copy.entryPaidBack}
                          </>
                        )}
                      </span>
                    </span>
                    <span className="text-[15px] font-semibold tabular-nums">
                      {formatMoney(participant.shareMajor, entry.displayCurrency)}
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>
        ) : null}

        {editable ? (
          <Button variant="secondary" size="lg" className="w-full" onClick={() => onEdit(entry)}>
            <PenLine className="size-4" />
            {copy.entryEdit}
          </Button>
        ) : (
          <p className="px-2 text-center text-xs text-faint">
            {entry.kind === 'purchase' ? copy.entryPurchaseLocked : copy.entryReadOnly}
          </p>
        )}
      </div>
    </Sheet>
  )
}
