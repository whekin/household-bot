import {
  Check,
  ChevronRight,
  CircleCheck,
  HandCoins,
  KeyRound,
  Plus,
  RefreshCw,
  type LucideIcon
} from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'

import { closeMiniAppPaymentPeriod } from '@/api'
import { useDashboard } from '@/app/dashboard-context'
import { useReadySession, useSession } from '@/app/session-context'
import { Avatar } from '@/components/avatar'
import { KIND_STYLE, KindIcon, kindLabel } from '@/components/kind'
import { formatMoney } from '@/components/money'
import { useToast } from '@/components/toast'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { PaymentEditor, type PaymentPrefill } from '@/features/forms/payment-form'
import { RentEditor } from '@/features/forms/rent-form'
import { UtilityEditor } from '@/features/forms/bill-form'
import type { MoneyKind } from '@/features/home/home-model'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/cn'
import { fxRateFromMicros } from '@/lib/fx'
import { formatCyclePeriod, formatFriendlyDate, formatTodayParts } from '@/lib/dates'
import { majorStringToMinor } from '@/lib/money'
import { BillSheet } from './bill-sheet'
import { MemberSheet, type MemberTarget } from './member-sheet'
import { buildMonthModel, type KindStatus, type MemberPayment, type MonthBill } from './month-model'
import { RefreshPlanSheet } from './refresh-plan-sheet'

/**
 * The house's month: each kind of payment as one card with the people who owe it,
 * the bills behind utilities, debts left from earlier months, and — for admins — the
 * tools that change the month.
 */
export function MonthView() {
  const session = useReadySession()
  const { initData, handleMiniAppRequestError } = useSession()
  const { dashboard, loading, effectiveIsAdmin, effectiveTodayOverride, applyDashboard, refresh } =
    useDashboard()
  const { copy, locale } = useI18n()
  const { showToast } = useToast()

  const [member, setMember] = useState<MemberTarget | null>(null)
  // Only the id is kept, so an open bill sheet always shows the latest dashboard.
  const [billId, setBillId] = useState<string | null>(null)
  const [editingBill, setEditingBill] = useState<MonthBill | { newName: string | null } | null>(
    null
  )
  const [closeAll, setCloseAll] = useState<KindStatus | null>(null)
  const [closing, setClosing] = useState(false)
  const [redrawOpen, setRedrawOpen] = useState(false)
  const [rentOpen, setRentOpen] = useState(false)
  const [payment, setPayment] = useState<PaymentPrefill | 'blank' | null>(null)

  const model = useMemo(() => {
    if (!dashboard) return null
    const today = effectiveTodayOverride ?? formatTodayParts(dashboard.timezone)
    return today ? buildMonthModel({ dashboard, memberId: session.member.id, today }) : null
  }, [dashboard, effectiveTodayOverride, session.member.id])

  if (loading || !dashboard || !model) {
    return (
      <div className="space-y-3" role="status">
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="h-80 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }

  const currency = dashboard.currency
  const plan = dashboard.utilityBillingPlan
  const openBill = billId ? (model.bills.find((entry) => entry.id === billId) ?? null) : null

  function openMember(kind: MoneyKind, status: KindStatus, row: MemberPayment) {
    setMember({
      kind,
      period: model!.period,
      memberId: row.memberId,
      displayName: row.displayName,
      isMe: row.isMe,
      dueMajor: row.dueMajor,
      paidMajor: row.paidMajor,
      remainingMajor: row.remainingMajor,
      opensOn: status.opened ? null : status.window.startDate
    })
  }

  async function confirmCloseAll(status: KindStatus) {
    if (!initData || closing) return
    setClosing(true)
    try {
      const result = await closeMiniAppPaymentPeriod(initData, {
        period: model!.period,
        kind: status.kind,
        allMembers: true
      })
      if (!applyDashboard(result.dashboard)) await refresh()
      showToast(
        result.closeSummary.closedMembers.length > 0 ? copy.monthClosedAll : copy.payAlreadyDone,
        'success'
      )
      setCloseAll(null)
    } catch (error) {
      if (!handleMiniAppRequestError(error)) showToast(copy.monthActionFailed, 'error')
    } finally {
      setClosing(false)
    }
  }

  const utilities = model.utilities
  const rent = model.rent
  const activeCount = utilities.members.length
  const rate = fxRateFromMicros(dashboard.rentFxRateMicros)

  return (
    <div className="space-y-3">
      <header className="animate-rise px-1 pb-1">
        <h2 className="inline-block font-display text-[28px] font-bold tracking-tight first-letter:uppercase">
          {formatCyclePeriod(model.period, locale)}
        </h2>
        <p className="text-sm text-muted-foreground">
          {copy.monthUtilitiesProgress
            .replace('{paid}', String(utilities.paidCount))
            .replace('{count}', String(activeCount))}
          {' · '}
          {rent.opened
            ? copy.monthRentProgress
                .replace('{paid}', String(rent.paidCount))
                .replace('{count}', String(activeCount))
            : copy.monthRentOpens.replace(
                '{date}',
                formatFriendlyDate(rent.window.startDate, locale)
              )}
        </p>
      </header>

      <KindCard status={utilities} currency={currency}>
        <div className="mt-4">
          <SubHeading>{copy.monthBills}</SubHeading>
          {model.bills.length === 0 && model.missingBills.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">{copy.monthBillsEmpty}</p>
          ) : (
            <ul>
              {model.bills.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => setBillId(entry.id)}
                    className="flex min-h-12 w-full items-center gap-3 py-1.5 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium">{entry.name}</span>
                      {entry.providerName ? (
                        <span className="block truncate text-xs text-faint">
                          {entry.providerName}
                        </span>
                      ) : null}
                    </span>
                    <span className="flex -space-x-1.5">
                      {entry.assignees.map((assignee) => (
                        <span
                          key={`${assignee.memberId}:${assignee.amountMajor}`}
                          className="relative"
                        >
                          <Avatar
                            name={assignee.displayName}
                            me={assignee.memberId === session.member.id}
                            className="size-6 text-[10px] ring-2 ring-card"
                          />
                          {majorStringToMinor(assignee.remainingMajor) === 0n ? (
                            <span className="absolute -bottom-0.5 -right-0.5 flex size-3 items-center justify-center rounded-full bg-buys text-white ring-2 ring-card">
                              <Check className="size-2" strokeWidth={4} />
                            </span>
                          ) : null}
                        </span>
                      ))}
                    </span>
                    <span className="w-20 shrink-0 text-right text-[15px] font-semibold tabular-nums">
                      {formatMoney(entry.amountMajor, currency)}
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-faint" />
                  </button>
                </li>
              ))}
              {model.missingBills.map((name) => (
                <li key={name} className="flex min-h-12 items-center gap-3 py-1.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium text-faint">
                      {name}
                    </span>
                    <span className="block text-xs text-util-ink">{copy.monthNotBilled}</span>
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setEditingBill({ newName: name })}
                  >
                    <Plus className="size-3.5" />
                    {copy.monthAddBill}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {model.missingBills.length === 0 ? (
            <button
              type="button"
              onClick={() => setEditingBill({ newName: null })}
              className="mt-1 flex h-10 items-center gap-1.5 text-[13px] font-semibold text-muted-foreground"
            >
              <Plus className="size-4" />
              {copy.monthAddBill}
            </button>
          ) : null}
        </div>

        <PeopleList
          status={utilities}
          currency={currency}
          onSelect={(row) => openMember('utilities', utilities, row)}
        />
      </KindCard>

      <KindCard
        status={rent}
        currency={currency}
        extra={
          dashboard.rentSourceCurrency !== currency && rate
            ? copy.payRentFx
                .replace(
                  '{source}',
                  formatMoney(dashboard.rentSourceAmountMajor, dashboard.rentSourceCurrency)
                )
                .replace('{rate}', rate)
            : null
        }
      >
        <PeopleList
          status={rent}
          currency={currency}
          onSelect={(row) => openMember('rent', rent, row)}
        />
      </KindCard>

      {model.earlier.length > 0 ? (
        <section className="animate-rise rounded-[24px] bg-danger-soft p-4 text-danger-ink">
          <h3 className="mb-1 text-[15px] font-semibold">{copy.monthEarlierTitle}</h3>
          <ul>
            {model.earlier.map((debt) => (
              <li key={debt.key}>
                <button
                  type="button"
                  onClick={() =>
                    setMember({
                      kind: debt.kind,
                      period: debt.period,
                      memberId: debt.memberId,
                      displayName: debt.displayName,
                      isMe: debt.isMe,
                      dueMajor: debt.dueMajor,
                      paidMajor: debt.paidMajor,
                      remainingMajor: debt.amountMajor,
                      opensOn: null
                    })
                  }
                  className="flex min-h-12 w-full items-center gap-3 text-left"
                >
                  <Avatar name={debt.displayName} me={debt.isMe} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium">
                      {debt.displayName}
                    </span>
                    <span className="block truncate text-xs opacity-75">
                      {kindLabel(debt.kind, copy)} · {formatCyclePeriod(debt.period, locale)}
                    </span>
                  </span>
                  <span className="text-[15px] font-semibold tabular-nums">
                    {formatMoney(debt.amountMajor, currency)}
                  </span>
                  <ChevronRight className="size-4 opacity-60" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {effectiveIsAdmin ? (
        <section className="animate-rise rounded-[24px] border border-dashed border-border-hover p-2">
          <div className="px-2 pb-1 pt-2">
            <h3 className="text-[15px] font-semibold">{copy.monthAdminTitle}</h3>
            <p className="text-xs text-faint">{copy.monthAdminHint}</p>
          </div>
          {utilities.opened && majorStringToMinor(utilities.totalRemainingMajor) > 0n ? (
            <AdminRow
              icon={CircleCheck}
              label={copy.monthAdminCloseUtilities}
              value={formatMoney(utilities.totalRemainingMajor, currency)}
              onClick={() => setCloseAll(utilities)}
            />
          ) : null}
          {rent.opened && majorStringToMinor(rent.totalRemainingMajor) > 0n ? (
            <AdminRow
              icon={CircleCheck}
              label={copy.monthAdminCloseRent}
              value={formatMoney(rent.totalRemainingMajor, currency)}
              onClick={() => setCloseAll(rent)}
            />
          ) : null}
          {plan ? (
            <AdminRow
              icon={RefreshCw}
              label={copy.monthAdminRedraw}
              hint={copy.monthAdminRedrawHint}
              onClick={() => setRedrawOpen(true)}
            />
          ) : null}
          <AdminRow icon={KeyRound} label={copy.monthAdminRent} onClick={() => setRentOpen(true)} />
          <AdminRow
            icon={HandCoins}
            label={copy.monthAdminPayment}
            onClick={() => setPayment('blank')}
          />
        </section>
      ) : null}

      {member ? (
        <MemberSheet
          target={member}
          onOpenChange={(open) => !open && setMember(null)}
          onRecordOther={(target) => {
            setMember(null)
            setPayment({ memberId: target.memberId, kind: target.kind, period: target.period })
          }}
        />
      ) : null}
      {openBill ? (
        <BillSheet
          bill={openBill}
          planOpen={model.planOpen}
          editable={effectiveIsAdmin && plan?.status !== 'settled'}
          onOpenChange={(open) => !open && setBillId(null)}
          onEdit={() => {
            setEditingBill(openBill)
            setBillId(null)
          }}
        />
      ) : null}
      {editingBill ? (
        <UtilityEditor
          open
          entry={'entry' in editingBill ? editingBill.entry : null}
          initialName={'newName' in editingBill ? editingBill.newName : null}
          onOpenChange={(open) => !open && setEditingBill(null)}
        />
      ) : null}
      {closeAll ? (
        <CloseAllSheet
          status={closeAll}
          currency={currency}
          loading={closing}
          onOpenChange={(open) => !open && setCloseAll(null)}
          onConfirm={() => void confirmCloseAll(closeAll)}
        />
      ) : null}
      <RefreshPlanSheet
        open={redrawOpen}
        period={model.period}
        currency={currency}
        onOpenChange={setRedrawOpen}
        onApplied={() => void refresh()}
      />
      <RentEditor open={rentOpen} onOpenChange={setRentOpen} />
      {payment ? (
        <PaymentEditor
          open
          entry={null}
          prefill={payment === 'blank' ? null : payment}
          onOpenChange={(open) => !open && setPayment(null)}
        />
      ) : null}
    </div>
  )
}

function SubHeading({ children }: { children: ReactNode }) {
  return <h4 className="mb-1 text-[13px] font-semibold text-muted-foreground">{children}</h4>
}

/** One kind of payment for the whole house: dates, progress, and its contents. */
function KindCard({
  status,
  currency,
  extra,
  children
}: {
  status: KindStatus
  currency: 'USD' | 'GEL'
  extra?: string | null
  children: ReactNode
}) {
  const { copy, locale } = useI18n()
  const due = majorStringToMinor(status.totalDueMajor)
  const paid = majorStringToMinor(status.totalPaidMajor)
  const percent = due > 0n ? Number((paid * 100n) / due) : 0
  const dateLine = !status.opened
    ? copy.monthOpensOn.replace('{date}', formatFriendlyDate(status.window.startDate, locale))
    : status.late
      ? copy.monthLate.replace('{date}', formatFriendlyDate(status.window.endDate, locale))
      : copy.monthDueOn.replace('{date}', formatFriendlyDate(status.window.endDate, locale))

  return (
    <section className="animate-rise rounded-[24px] bg-card p-4">
      <div className="flex items-center gap-3">
        <KindIcon kind={status.kind} />
        <div className="min-w-0 flex-1">
          <h3 className="text-[17px] font-semibold">{kindLabel(status.kind, copy)}</h3>
          <p className={cn('text-[13px]', status.late ? 'text-danger' : 'text-faint')}>
            {dateLine}
          </p>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-display text-[22px] font-bold tabular-nums">
            {formatMoney(status.totalDueMajor, currency)}
          </span>
          <span className="text-[13px] text-muted-foreground">
            {copy.monthPaidSoFar.replace('{amount}', formatMoney(status.totalPaidMajor, currency))}
          </span>
        </div>
        {extra ? <p className="text-xs text-faint">{extra}</p> : null}
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-elevated">
          <span
            className={cn(
              'block h-full rounded-full transition-[width]',
              KIND_STYLE[status.kind].solid
            )}
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      {children}
    </section>
  )
}

function PeopleList({
  status,
  currency,
  onSelect
}: {
  status: KindStatus
  currency: 'USD' | 'GEL'
  onSelect: (row: MemberPayment) => void
}) {
  const { copy } = useI18n()
  return (
    <div className="mt-4">
      <SubHeading>{copy.monthWhoPays}</SubHeading>
      <ul>
        {status.members.map((row) => {
          const due = majorStringToMinor(row.dueMajor)
          return (
            <li key={row.memberId}>
              <button
                type="button"
                onClick={() => onSelect(row)}
                className="flex min-h-14 w-full items-center gap-3 text-left"
              >
                <Avatar name={row.displayName} me={row.isMe} />
                <span className="min-w-0 flex-1 truncate text-[15px] font-medium">
                  {row.displayName}
                  {row.isMe ? (
                    <span className="font-normal text-faint"> · {copy.youSuffix}</span>
                  ) : null}
                </span>
                {row.settled ? (
                  due > 0n ? (
                    <span className="flex items-center gap-1 rounded-full bg-buys-soft px-2.5 py-1 text-xs font-semibold text-buys-ink">
                      <Check className="size-3.5" strokeWidth={3} />
                      {copy.monthPaid}
                    </span>
                  ) : (
                    <span className="text-[13px] text-faint">{copy.monthNothingToPay}</span>
                  )
                ) : (
                  <span className="text-right">
                    <span className="block text-[15px] font-semibold tabular-nums">
                      {formatMoney(row.remainingMajor, currency)}
                    </span>
                    {!status.opened ? (
                      <span className="block text-xs text-faint">{copy.monthUpcoming}</span>
                    ) : null}
                  </span>
                )}
                <ChevronRight className="size-4 shrink-0 text-faint" />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function AdminRow({
  icon: Icon,
  label,
  hint,
  value,
  onClick
}: {
  icon: LucideIcon
  label: string
  hint?: string
  value?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left transition-colors active:bg-elevated"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-elevated">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        {hint ? <span className="block text-xs text-faint">{hint}</span> : null}
      </span>
      {value ? <span className="text-sm font-semibold tabular-nums">{value}</span> : null}
      <ChevronRight className="size-4 shrink-0 text-faint" />
    </button>
  )
}

function CloseAllSheet({
  status,
  currency,
  loading,
  onOpenChange,
  onConfirm
}: {
  status: KindStatus
  currency: 'USD' | 'GEL'
  loading: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const { copy } = useI18n()
  const open = status.members.filter((row) => !row.settled)
  return (
    <Sheet
      open
      onOpenChange={onOpenChange}
      title={copy.monthCloseAllTitle}
      description={kindLabel(status.kind, copy)}
    >
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">{copy.monthCloseAllBody}</p>
        <ul className="rounded-[24px] bg-card px-4 py-1">
          {open.map((row) => (
            <li key={row.memberId} className="flex items-center gap-3 py-2.5">
              <Avatar name={row.displayName} me={row.isMe} />
              <span className="flex-1 text-[15px] font-medium">{row.displayName}</span>
              <span className="text-[15px] font-semibold tabular-nums">
                {formatMoney(row.remainingMajor, currency)}
              </span>
            </li>
          ))}
        </ul>
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          loading={loading}
          onClick={onConfirm}
        >
          {copy.monthCloseAllConfirm.replace(
            '{amount}',
            formatMoney(status.totalRemainingMajor, currency)
          )}
        </Button>
      </div>
    </Sheet>
  )
}
