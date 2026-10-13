import { Check, Copy, ExternalLink, PenLine, Undo2 } from 'lucide-react'
import { useState } from 'react'

import { deleteMiniAppUtilityVendorPayment, recordMiniAppUtilityVendorPayment } from '@/api'
import { useDashboard } from '@/app/dashboard-context'
import { useReadySession, useSession } from '@/app/session-context'
import { Avatar } from '@/components/avatar'
import { formatMoney } from '@/components/money'
import { useToast } from '@/components/toast'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/dialog'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/cn'
import { formatFriendlyDate } from '@/lib/dates'
import { majorStringToMinor } from '@/lib/money'
import { getTelegramWebApp, haptics } from '@/telegram/webapp'
import type { MonthBill } from './month-model'

/**
 * One utility bill: who pays which part, what is already marked paid, and the
 * small corrections — "I paid this part instead", undo a mark, edit the bill.
 */
export function BillSheet({
  bill,
  planOpen,
  editable,
  onOpenChange,
  onEdit
}: {
  bill: MonthBill
  planOpen: boolean
  /** Admins can fix a bill until utilities are settled. */
  editable: boolean
  onOpenChange: (open: boolean) => void
  onEdit: () => void
}) {
  const { copy, locale } = useI18n()
  const session = useReadySession()
  const { initData, handleMiniAppRequestError } = useSession()
  const { dashboard, effectiveIsAdmin, refresh } = useDashboard()
  const { showToast } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  if (!dashboard) return null
  const currency = dashboard.currency
  const meId = session.member.id

  async function run(key: string, action: () => Promise<void>) {
    if (!initData || busy) return
    setBusy(key)
    try {
      await action()
      await refresh()
      showToast(copy.billSheetSaved, 'success')
    } catch (error) {
      if (!handleMiniAppRequestError(error)) showToast(copy.monthActionFailed, 'error')
    } finally {
      setBusy(null)
    }
  }

  async function copyAccount() {
    try {
      await navigator.clipboard.writeText(bill.customerNumber ?? '')
      haptics.selection()
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      showToast(bill.customerNumber ?? '', 'info')
    }
  }

  return (
    <Sheet
      open
      onOpenChange={onOpenChange}
      title={bill.name}
      description={bill.providerName ?? undefined}
    >
      <div className="space-y-3">
        <section className="rounded-[24px] bg-card p-4">
          <p className="text-[13px] text-faint">{copy.billSheetTotal}</p>
          <p className="font-display text-[28px] font-bold tabular-nums">
            {formatMoney(bill.amountMajor, currency)}
          </p>
          {bill.customerNumber || bill.paymentLink ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {bill.customerNumber ? (
                <button
                  type="button"
                  onClick={() => void copyAccount()}
                  className="flex h-9 items-center gap-2 rounded-xl bg-elevated px-3 text-[13px] font-medium"
                >
                  <span className="text-faint">{copy.payAccount}</span>
                  <span className="tabular-nums">{bill.customerNumber}</span>
                  {copied ? (
                    <Check className="size-3.5 text-buys" strokeWidth={3} />
                  ) : (
                    <Copy className="size-3.5 text-faint" />
                  )}
                </button>
              ) : null}
              {bill.paymentLink ? (
                <button
                  type="button"
                  onClick={() => {
                    const url = bill.paymentLink ?? ''
                    const webApp = getTelegramWebApp()
                    if (webApp?.openLink) webApp.openLink(url)
                    else window.open(url, '_blank', 'noopener')
                  }}
                  className="flex h-9 items-center gap-1.5 rounded-xl bg-elevated px-3 text-[13px] font-medium"
                >
                  {copy.payOpenLink}
                  <ExternalLink className="size-3.5 text-faint" />
                </button>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="rounded-[24px] bg-card p-4">
          <h3 className="mb-1 text-[13px] font-semibold text-muted-foreground">
            {copy.billSheetWhoPays}
          </h3>
          {bill.assignees.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">{copy.billSheetUnassigned}</p>
          ) : (
            <ul className="divide-y divide-border">
              {bill.assignees.map((assignee) => {
                const left = majorStringToMinor(assignee.remainingMajor)
                const canTakeOver = planOpen && left > 0n && assignee.memberId !== meId
                const key = `take:${assignee.memberId}`
                return (
                  <li key={`${assignee.memberId}:${assignee.amountMajor}`} className="py-2.5">
                    <div className="flex items-center gap-3">
                      <Avatar name={assignee.displayName} me={assignee.memberId === meId} />
                      <span className="min-w-0 flex-1 truncate text-[15px] font-medium">
                        {assignee.displayName}
                      </span>
                      <span className="text-right">
                        <span
                          className={cn(
                            'block text-[15px] font-semibold tabular-nums',
                            left === 0n && 'text-buys-ink'
                          )}
                        >
                          {formatMoney(assignee.amountMajor, currency)}
                        </span>
                        {left === 0n ? (
                          <span className="block text-xs text-faint">{copy.monthPaid}</span>
                        ) : left < majorStringToMinor(assignee.amountMajor) ? (
                          <span className="block text-xs text-faint">
                            {copy.billSheetLeft.replace(
                              '{amount}',
                              formatMoney(assignee.remainingMajor, currency)
                            )}
                          </span>
                        ) : null}
                      </span>
                    </div>
                    {canTakeOver ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="ml-12 mt-2"
                        loading={busy === key}
                        onClick={() =>
                          void run(key, () =>
                            recordMiniAppUtilityVendorPayment(initData ?? '', {
                              utilityBillId: bill.id,
                              payerMemberId: meId,
                              amountMajor: assignee.remainingMajor,
                              period: dashboard.period
                            })
                          )
                        }
                      >
                        {copy.billSheetIPaid}
                      </Button>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {effectiveIsAdmin && bill.vendorPayments.length > 0 ? (
          <section className="rounded-[24px] bg-card p-4">
            <h3 className="mb-1 text-[13px] font-semibold text-muted-foreground">
              {copy.billSheetMarks}
            </h3>
            <ul className="divide-y divide-border">
              {bill.vendorPayments.map((payment) => {
                const key = `undo:${payment.id}`
                return (
                  <li key={payment.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <span className="block text-sm font-medium tabular-nums">
                        {formatMoney(payment.amountMajor, currency)}
                      </span>
                      <span className="block truncate text-xs text-faint">
                        {copy.billSheetMarkBy
                          .replace('{name}', payment.payerDisplayName)
                          .replace('{date}', formatFriendlyDate(payment.recordedAt, locale))}
                      </span>
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={busy === key}
                      onClick={() =>
                        void run(key, () =>
                          deleteMiniAppUtilityVendorPayment(initData ?? '', payment.id)
                        )
                      }
                    >
                      <Undo2 className="size-3.5" />
                      {copy.billSheetUndo}
                    </Button>
                  </li>
                )
              })}
            </ul>
          </section>
        ) : null}

        {editable ? (
          <Button variant="secondary" className="w-full" onClick={onEdit}>
            <PenLine className="size-4" />
            {copy.billSheetEdit}
          </Button>
        ) : null}
      </div>
    </Sheet>
  )
}
