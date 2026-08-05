import { Check, CheckCircle2, Pencil, Wallet } from 'lucide-react'
import { useMemo, useState } from 'react'

import {
  deleteMiniAppUtilityVendorPayment,
  recordMiniAppUtilityVendorPayment,
  resolveMiniAppUtilityPlan
} from '@/api'
import { useDashboard } from '@/app/dashboard-context'
import { useSession } from '@/app/session-context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { useToast } from '@/components/toast'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/cn'
import {
  formatUtilityPlanShareDeltaLabel,
  hasUtilityPlanAssignments,
  isSettledQuietPlan,
  isUtilityPlanActionable,
  utilityPlanMemberRows,
  utilityPlanTotals
} from '@/lib/billing-ui-helpers'
import { formatMoneyLabel } from '@/lib/ledger-helpers'
import { majorStringToMinor } from '@/lib/money'
import type { LedgerEntry } from './types'
import { UtilityEditor } from './utility-editor'

export function UtilityPlanSection() {
  const { initData, handleMiniAppRequestError } = useSession()
  const { copy, locale } = useI18n()
  const { dashboard, effectiveIsAdmin, currentMemberLine, refresh, utilityLedger } = useDashboard()
  const { showToast } = useToast()

  const [actionKey, setActionKey] = useState<string | null>(null)
  const [billEditor, setBillEditor] = useState<{ open: boolean; entry: LedgerEntry | null }>({
    open: false,
    entry: null
  })

  const plan = dashboard?.utilityBillingPlan ?? null
  const currentMemberId = currentMemberLine?.memberId ?? null

  const planIsSnapshot = dashboard ? isSettledQuietPlan(dashboard) : false
  const planIsActionMode = Boolean(
    dashboard &&
    plan &&
    !planIsSnapshot &&
    (dashboard.billingStage === 'utilities' || isUtilityPlanActionable(plan))
  )
  const canResolvePlan = Boolean(
    plan && effectiveIsAdmin && plan.status !== 'settled' && hasUtilityPlanAssignments(plan)
  )

  const memberRows = useMemo(() => {
    if (!dashboard || !plan) return []
    return utilityPlanMemberRows({
      plan,
      members: dashboard.members,
      currentMemberId,
      mode: planIsActionMode ? 'action' : 'snapshot'
    })
  }, [dashboard, plan, currentMemberId, planIsActionMode])

  const planTotals = useMemo(
    () => (dashboard && plan ? utilityPlanTotals(plan) : null),
    [dashboard, plan]
  )
  const utilityCategoryByName = useMemo(
    () =>
      new Map(
        (dashboard?.utilityCategories ?? []).map((category) => [
          category.name.trim().toLowerCase(),
          category
        ])
      ),
    [dashboard]
  )

  if (!dashboard || !plan) return null

  const currency = dashboard.currency

  async function runUtilityAction(key: string, action: () => Promise<void>) {
    if (!initData || actionKey) return
    setActionKey(key)
    try {
      await action()
      await refresh()
      showToast(copy.quickPaymentSuccess, 'success')
    } catch (error) {
      if (!handleMiniAppRequestError(error)) {
        showToast(error instanceof Error ? error.message : copy.quickPaymentFailed, 'error')
      }
    } finally {
      setActionKey(null)
    }
  }

  function handleResolvePlanned(memberId: string) {
    if (!initData) return
    void runUtilityAction(`resolve:${memberId}`, () =>
      resolveMiniAppUtilityPlan(initData, {
        memberId,
        ...(dashboard?.period ? { period: dashboard.period } : {})
      })
    )
  }

  function handleResolveFullPlan() {
    if (!initData) return
    void runUtilityAction('resolve:all', () =>
      resolveMiniAppUtilityPlan(initData, {
        allMembers: true,
        ...(dashboard?.period ? { period: dashboard.period } : {})
      })
    )
  }

  function handleRecordVendorPayment(utilityBillId: string, payerMemberId: string) {
    if (!initData) return
    void runUtilityAction(`vendor:${utilityBillId}:${payerMemberId}`, () =>
      recordMiniAppUtilityVendorPayment(initData, {
        utilityBillId,
        payerMemberId,
        ...(dashboard?.period ? { period: dashboard.period } : {})
      })
    )
  }

  function handleDeleteVendorPayment(vendorPaymentId: string) {
    if (!initData) return
    void runUtilityAction(`vendor-undo:${vendorPaymentId}`, () =>
      deleteMiniAppUtilityVendorPayment(initData, vendorPaymentId)
    )
  }

  const vendorPayments = plan.vendorPayments ?? []
  // Bills stay editable until the utilities are actually settled — that is the
  // whole window where a wrong amount still matters.
  const billsEditable = effectiveIsAdmin && plan.status !== 'settled'

  const statusLabel =
    plan.status === 'active'
      ? locale === 'ru'
        ? 'По плану'
        : 'On track'
      : plan.status === 'settled'
        ? locale === 'ru'
          ? 'Закрыто'
          : 'Settled'
        : locale === 'ru'
          ? 'Пересчитано'
          : 'Rebalanced'

  return (
    <Card>
      <CardHeader
        title={
          planIsSnapshot
            ? locale === 'ru'
              ? 'План закрыт'
              : 'Plan settled'
            : locale === 'ru'
              ? 'План по дому'
              : 'Household plan'
        }
        hint={`${locale === 'ru' ? 'Версия' : 'Version'} ${plan.version} · ${locale === 'ru' ? 'Срок' : 'Due'} ${plan.dueDate}`}
        action={
          <Badge
            tone={plan.status === 'settled' || plan.status === 'active' ? 'primary' : 'neutral'}
          >
            {statusLabel}
          </Badge>
        }
      />

      {canResolvePlan ? (
        <div className="mb-3">
          <Button
            variant="primary"
            size="sm"
            loading={actionKey === 'resolve:all'}
            onClick={handleResolveFullPlan}
          >
            <CheckCircle2 className="size-3.5" aria-hidden />
            {locale === 'ru' ? 'Закрыть весь план' : 'Resolve full plan'}
          </Button>
        </div>
      ) : null}

      {utilityLedger.length > 0 ? (
        <div className="mb-3 rounded-xl bg-elevated px-3">
          <p className="pt-2 text-[11px] text-faint">
            {locale === 'ru' ? 'Счета за период' : 'Bills this period'}
          </p>
          <div className="divide-y divide-border">
            {utilityLedger.map((bill) => (
              <div key={bill.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate text-foreground">{bill.title}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">
                    {formatMoneyLabel(bill.displayAmountMajor, currency, locale)}
                  </span>
                  {billsEditable ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={locale === 'ru' ? 'Изменить счёт' : 'Edit bill'}
                      onClick={() => setBillEditor({ open: true, entry: bill })}
                    >
                      <Pencil className="size-3.5" aria-hidden />
                      {locale === 'ru' ? 'Изменить' : 'Edit'}
                    </Button>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {planIsSnapshot ? (
        <div className="space-y-3">
          {planTotals ? (
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-elevated p-2.5">
                <p className="text-[11px] text-faint">{copy.balancesAssignedNowLabel}</p>
                <p className="mt-0.5 font-mono text-sm text-foreground">
                  {formatMoneyLabel(planTotals.assignedTotalMajor, currency, locale)}
                </p>
              </div>
              <div className="rounded-xl bg-elevated p-2.5">
                <p className="text-[11px] text-faint">{copy.balancesPaidLabel}</p>
                <p className="mt-0.5 font-mono text-sm text-foreground">
                  {formatMoneyLabel(planTotals.paidTotalMajor, currency, locale)}
                </p>
              </div>
              <div className="rounded-xl bg-elevated p-2.5">
                <p className="text-[11px] text-faint">
                  {locale === 'ru' ? 'Осталось' : 'Remaining'}
                </p>
                <p className="mt-0.5 font-mono text-sm text-foreground">
                  {formatMoneyLabel(planTotals.remainingTotalMajor, currency, locale)}
                </p>
              </div>
            </div>
          ) : null}

          <details>
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
              {locale === 'ru' ? 'Детали закрытого плана' : 'Settled plan audit'}
            </summary>
            <div className="mt-2 space-y-3">
              {memberRows.map((summary) => (
                <div key={summary.memberId} className="rounded-xl bg-elevated p-3">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate text-foreground">{summary.displayName}</span>
                    <span className="shrink-0 font-mono text-xs text-foreground">
                      {formatMoneyLabel(summary.vendorPaidMajor, currency, locale)}
                    </span>
                  </div>
                  {summary.categories.map((category) => (
                    <div
                      key={category.utilityBillId}
                      className="mt-1.5 flex items-center justify-between gap-3 text-[11px] text-faint"
                    >
                      <span className="truncate">
                        {`${category.isFullAssignment ? copy.balancesAssignmentFullLabel : copy.balancesAssignmentSplitLabel} · ${category.billName}`}
                      </span>
                      <span className="shrink-0 font-mono">
                        {formatMoneyLabel(category.assignedAmountMajor, currency, locale)}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </details>
        </div>
      ) : (
        <div className="space-y-3">
          {memberRows.map((summary) => (
            <div
              key={summary.memberId}
              className={cn(
                'rounded-xl bg-elevated p-3',
                !summary.hasPendingAssignment && 'opacity-70'
              )}
            >
              <div className="flex items-center gap-1.5 text-sm">
                <span className="truncate font-medium text-foreground">{summary.displayName}</span>
                {summary.isCurrent && summary.hasPendingAssignment ? (
                  <Badge tone="primary">{locale === 'ru' ? 'Ты' : 'You'}</Badge>
                ) : null}
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-faint">
                <span>
                  {copy.balancesAssignedNowLabel}:{' '}
                  <span className="font-mono text-muted-foreground">
                    {formatMoneyLabel(summary.assignedThisCycleMajor, currency, locale)}
                  </span>
                </span>
                <span>
                  {copy.balancesPaidLabel}:{' '}
                  <span className="font-mono text-muted-foreground">
                    {formatMoneyLabel(summary.vendorPaidMajor, currency, locale)}
                  </span>
                </span>
                <span>
                  {copy.balancesAfterPlanLabel}:{' '}
                  <span className="font-mono text-muted-foreground">
                    {formatUtilityPlanShareDeltaLabel(
                      summary.projectedDeltaAfterPlanMajor,
                      currency,
                      locale
                    )}
                  </span>
                </span>
              </div>

              {summary.hasPendingAssignment &&
              plan.status !== 'settled' &&
              (canResolvePlan || summary.isCurrent) ? (
                <div className="mt-2">
                  <Button
                    variant={summary.isCurrent ? 'primary' : 'ghost'}
                    size="sm"
                    loading={actionKey === `resolve:${summary.memberId}`}
                    onClick={() => handleResolvePlanned(summary.memberId)}
                  >
                    <Wallet className="size-3.5" aria-hidden />
                    {summary.isCurrent
                      ? locale === 'ru'
                        ? 'Записать мою оплату'
                        : 'Record my payment'
                      : locale === 'ru'
                        ? 'Записать оплату'
                        : 'Record payment'}
                  </Button>
                </div>
              ) : null}

              {summary.categories.length > 0 ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                    {locale === 'ru' ? 'Назначенные счета' : 'Assigned bills'}
                  </summary>
                  <div className="mt-1.5 space-y-2">
                    {summary.categories.map((category) => {
                      const details = utilityCategoryByName.get(
                        category.billName.trim().toLowerCase()
                      )
                      const providerLine = details
                        ? [details.providerName, details.customerNumber, details.note]
                            .filter(Boolean)
                            .join(' · ')
                        : ''

                      return (
                        <div key={category.utilityBillId} className="text-[11px] text-faint">
                          <div className="flex items-center justify-between gap-3">
                            <span className="truncate">
                              {`${category.isFullAssignment ? copy.balancesAssignmentFullLabel : copy.balancesAssignmentSplitLabel} · ${category.billName}`}
                            </span>
                            <span className="shrink-0 font-mono">
                              {formatMoneyLabel(category.assignedAmountMajor, currency, locale)}
                            </span>
                          </div>
                          {!category.isFullAssignment ? (
                            <p>
                              {locale === 'ru'
                                ? `Счёт целиком: ${formatMoneyLabel(category.billTotalMajor, currency, locale)}`
                                : `Bill total: ${formatMoneyLabel(category.billTotalMajor, currency, locale)}`}
                            </p>
                          ) : null}
                          {providerLine ? <p>{providerLine}</p> : null}
                          {plan.status === 'active' &&
                          currentMemberId &&
                          currentMemberId !== category.assignedMemberId &&
                          majorStringToMinor(category.paidAmountMajor) <
                            majorStringToMinor(category.assignedAmountMajor) ? (
                            <div className="mt-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                loading={
                                  actionKey ===
                                  `vendor:${category.utilityBillId}:${currentMemberId}`
                                }
                                onClick={() =>
                                  handleRecordVendorPayment(category.utilityBillId, currentMemberId)
                                }
                              >
                                <Check className="size-3.5" aria-hidden />
                                {locale === 'ru'
                                  ? 'Оплатить вместо назначенного'
                                  : 'I paid this instead'}
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                </details>
              ) : null}
            </div>
          ))}
        </div>
      )}
      {effectiveIsAdmin && vendorPayments.length > 0 ? (
        <div className="mt-4 border-t border-border pt-3">
          <p className="text-xs text-muted-foreground">
            {locale === 'ru' ? 'Отмечено как оплаченное' : 'Marked as paid'}
          </p>
          <div className="mt-2 flex flex-col gap-2">
            {vendorPayments.map((payment) => (
              <div key={payment.id} className="flex items-center justify-between gap-2 text-sm">
                <span>
                  {payment.payerDisplayName} — {payment.billName},{' '}
                  {formatMoneyLabel(payment.amountMajor, dashboard.currency, locale)}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={actionKey !== null}
                  onClick={() => handleDeleteVendorPayment(payment.id)}
                >
                  {actionKey === `vendor-undo:${payment.id}`
                    ? locale === 'ru'
                      ? 'Убираем…'
                      : 'Removing…'
                    : locale === 'ru'
                      ? 'Убрать отметку'
                      : 'Undo'}
                </Button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <UtilityEditor
        open={billEditor.open}
        entry={billEditor.entry}
        onOpenChange={(open) => setBillEditor((current) => ({ ...current, open }))}
      />
    </Card>
  )
}
