import { Check, ChevronDown, ChevronUp, Pencil } from 'lucide-react'
import { useMemo, useState } from 'react'

import { addMiniAppPayment, resolveMiniAppUtilityPlan } from '@/api'
import { useDashboard } from '@/app/dashboard-context'
import { useSession } from '@/app/session-context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { useToast } from '@/components/toast'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/cn'
import { paymentQueueGroups } from '@/lib/billing-ui-helpers'
import { formatCyclePeriod } from '@/lib/dates'
import {
  formatAbsoluteMoneyLabel,
  formatMoneyLabel,
  formatSemanticMoneyLabel,
  memberEffectivePurchaseBalanceMajor,
  semanticMoneyTone
} from '@/lib/ledger-helpers'
import { majorStringToMinor } from '@/lib/money'
import { haptics } from '@/telegram/webapp'
import type { PaymentPrefill } from './types'

const segmentColors: Record<string, string> = {
  rent: 'var(--color-chart-1)',
  utilities: 'var(--color-chart-4)',
  'purchase-credit': 'var(--color-status-credit)',
  'purchase-debit': 'var(--color-chart-3)'
}

function normalizedRailWidth(valueMinor: bigint, maxMinor: bigint): string {
  if (maxMinor <= 0n) return '0%'
  return `${Math.max((Number(valueMinor) / Number(maxMinor)) * 100, 6)}%`
}

function toneClass(tone: 'is-credit' | 'is-debit' | 'is-neutral'): string {
  if (tone === 'is-credit') return 'text-status-credit'
  if (tone === 'is-debit') return 'text-status-due'
  return 'text-muted-foreground'
}

export function BalancesSection({
  onCustomPayment
}: {
  onCustomPayment: (input: PaymentPrefill) => void
}) {
  const { initData, handleMiniAppRequestError } = useSession()
  const { copy, locale } = useI18n()
  const { dashboard, effectiveIsAdmin, memberBalanceVisuals, currentMemberLine, refresh } =
    useDashboard()
  const { showToast } = useToast()

  const [expanded, setExpanded] = useState(false)
  const [processingMember, setProcessingMember] = useState<string | null>(null)

  const currency = dashboard?.currency ?? 'GEL'
  const settledLabel = locale === 'ru' ? 'Закрыто' : 'Settled'

  const paymentQueue = useMemo(() => paymentQueueGroups(dashboard?.paymentPeriods), [dashboard])
  const actionableUtilityPlanMembers = useMemo(() => {
    const plan = dashboard?.utilityBillingPlan
    if (!plan) return new Set<string>()
    return new Set(
      plan.memberSummaries
        .filter((summary) => majorStringToMinor(summary.assignedThisCycleMajor) > 0n)
        .map((summary) => summary.memberId)
    )
  }, [dashboard])

  const purchaseRailRows = useMemo(() => {
    if (!dashboard) return []

    const rows = dashboard.members.map((member) => {
      const balanceMajor = memberEffectivePurchaseBalanceMajor(member)
      const balanceMinor = majorStringToMinor(balanceMajor)
      return {
        memberId: member.memberId,
        displayName: member.displayName,
        balanceMajor,
        balanceMinor,
        absoluteMinor: balanceMinor < 0n ? -balanceMinor : balanceMinor,
        isCurrent: currentMemberLine?.memberId === member.memberId
      }
    })

    const maxMinor = rows.reduce(
      (max, row) => (row.absoluteMinor > max ? row.absoluteMinor : max),
      0n
    )

    return rows
      .sort((left, right) => {
        if (left.isCurrent) return -1
        if (right.isCurrent) return 1
        return right.absoluteMinor === left.absoluteMinor
          ? left.displayName.localeCompare(right.displayName)
          : right.absoluteMinor > left.absoluteMinor
            ? 1
            : -1
      })
      .map((row) => ({
        ...row,
        width: normalizedRailWidth(row.absoluteMinor, maxMinor),
        side:
          row.balanceMinor < 0n
            ? ('left' as const)
            : row.balanceMinor > 0n
              ? ('right' as const)
              : ('none' as const)
      }))
  }, [dashboard, currentMemberLine])

  async function handleQuickPayment(input: {
    memberId: string
    kind: 'rent' | 'utilities'
    period: string
    amountMajor: string
  }) {
    if (!initData || processingMember) return

    setProcessingMember(input.memberId)
    try {
      const usePlannedUtilityResolution =
        input.kind === 'utilities' &&
        input.period === dashboard?.period &&
        actionableUtilityPlanMembers.has(input.memberId)

      if (usePlannedUtilityResolution) {
        await resolveMiniAppUtilityPlan(initData, {
          memberId: input.memberId,
          period: input.period
        })
      } else {
        await addMiniAppPayment(initData, {
          memberId: input.memberId,
          kind: input.kind,
          period: input.period,
          amountMajor: input.amountMajor,
          currency
        })
      }
      await refresh()
      showToast(copy.quickPaymentSuccess, 'success')
    } catch (error) {
      if (!handleMiniAppRequestError(error)) {
        showToast(error instanceof Error ? error.message : copy.quickPaymentFailed, 'error')
      }
    } finally {
      setProcessingMember(null)
    }
  }

  if (!dashboard) return null

  return (
    <Card>
      <CardHeader
        title={copy.balancesTitle}
        hint={copy.balancesSubtitle}
        action={
          <button
            type="button"
            className="flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-muted-foreground transition-colors active:bg-field-hover"
            onClick={() => {
              haptics.selection()
              setExpanded((current) => !current)
            }}
          >
            {expanded ? copy.showLessAction : copy.showMoreAction}
            {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </button>
        }
      />

      {/* Collapsed summary: each member's remaining amount */}
      <div className="divide-y divide-border">
        {memberBalanceVisuals.map((item) => {
          const remainingLabel =
            formatSemanticMoneyLabel(item.member.remainingMajor, currency, locale) ?? settledLabel
          const tone = semanticMoneyTone(item.member.remainingMajor)
          const isCurrent = currentMemberLine?.memberId === item.member.memberId

          return (
            <div key={item.member.memberId} className="space-y-1.5 py-2">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-foreground">{item.member.displayName}</span>
                  {isCurrent ? (
                    <Badge tone="primary">{copy.purchaseBalanceCurrentLabel}</Badge>
                  ) : null}
                </span>
                <span className={cn('shrink-0 font-mono text-xs', toneClass(tone))}>
                  {remainingLabel}
                </span>
              </div>

              {expanded ? (
                <>
                  <div className="h-2 overflow-hidden rounded-full bg-field">
                    <div className="flex h-full" style={{ width: `${item.barWidthPercent}%` }}>
                      {item.segments
                        .filter((segment) => segment.widthPercent > 0)
                        .map((segment) => (
                          <div
                            key={segment.key}
                            style={{
                              width: `${segment.widthPercent}%`,
                              backgroundColor: segmentColors[segment.key]
                            }}
                          />
                        ))}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-faint">
                    {item.segments
                      .filter((segment) => segment.amountMinor > 0n)
                      .map((segment) => (
                        <span key={segment.key} className="inline-flex items-center gap-1">
                          <span
                            className="size-2 rounded-full"
                            style={{ backgroundColor: segmentColors[segment.key] }}
                            aria-hidden
                          />
                          {segment.label}{' '}
                          <span className="font-mono">
                            {formatAbsoluteMoneyLabel(segment.amountMajor, currency, locale)}
                          </span>
                        </span>
                      ))}
                  </div>
                </>
              ) : null}
            </div>
          )
        })}
      </div>

      {expanded ? (
        <div className="mt-4 space-y-5">
          {/* Purchase balance rail */}
          <div>
            <p className="text-sm font-medium text-foreground">{copy.balancesComparisonTitle}</p>
            <p className="mt-0.5 text-xs text-faint">{copy.balancesComparisonBody}</p>
            <div className="mt-3 space-y-3">
              {purchaseRailRows.map((row) => (
                <div key={row.memberId} className="space-y-1">
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-muted-foreground">{row.displayName}</span>
                      {row.isCurrent ? (
                        <Badge tone="primary">{copy.purchaseBalanceCurrentLabel}</Badge>
                      ) : null}
                    </span>
                    <span className="shrink-0 font-mono text-faint">
                      {formatSemanticMoneyLabel(row.balanceMajor, currency, locale) ?? settledLabel}
                    </span>
                  </div>
                  <div className="relative h-1.5 rounded-full bg-field">
                    <div className="absolute inset-y-0 left-1/2 w-px bg-border-hover" aria-hidden />
                    {row.side !== 'none' ? (
                      <div
                        className={cn(
                          'absolute inset-y-0 rounded-full',
                          row.side === 'left' ? 'bg-status-credit' : 'bg-status-due'
                        )}
                        style={{
                          width: row.width,
                          left: row.side === 'left' ? `calc(50% - ${row.width})` : '50%'
                        }}
                      />
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-faint">{copy.purchaseBalanceRailHint}</p>
          </div>

          {/* Overdue / open payments context */}
          {paymentQueue.length > 0 ? (
            <div>
              <p className="text-sm font-medium text-foreground">{copy.paymentsTitle}</p>
              <p className="mt-0.5 text-xs text-faint">{copy.paymentsAdminBody}</p>
              <div className="mt-3 space-y-3">
                {paymentQueue.map((group) => (
                  <div key={`${group.period}:${group.kind}`} className="rounded-xl bg-elevated p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">
                          {(group.kind === 'rent' ? copy.shareRent : copy.shareUtilities) +
                            ' · ' +
                            formatCyclePeriod(group.period, locale)}
                        </p>
                        <p className="mt-0.5 text-xs text-faint">
                          {copy.remainingLabel}{' '}
                          <span className="font-mono">
                            {formatMoneyLabel(group.totalRemainingMajor, currency, locale)}
                          </span>
                        </p>
                      </div>
                      <Badge tone={group.hasOverdueBalance ? 'warning' : 'primary'}>
                        {group.hasOverdueBalance
                          ? copy.paymentsPeriodOverdueStatus
                          : copy.paymentsPeriodCurrentStatus}
                      </Badge>
                    </div>

                    <div className="mt-2 divide-y divide-border">
                      {group.unresolvedMembers.map((row) => (
                        <div key={row.memberId} className="space-y-1.5 py-2">
                          <div className="flex items-center justify-between gap-3 text-sm">
                            <span className="truncate text-foreground">{row.displayName}</span>
                            <span className="shrink-0 font-mono text-xs text-status-due">
                              {formatMoneyLabel(row.remainingMajor, currency, locale)}
                            </span>
                          </div>
                          <p className="text-[11px] text-faint">
                            {copy.paymentsBaseDueLabel
                              .replace(
                                '{amount}',
                                formatMoneyLabel(row.baseDueMajor, currency, locale)
                              )
                              .replace(
                                '{remaining}',
                                formatMoneyLabel(row.remainingMajor, currency, locale)
                              )}
                            {' · '}
                            {copy.paidLabel} {formatMoneyLabel(row.paidMajor, currency, locale)}
                          </p>
                          {effectiveIsAdmin ? (
                            <div className="flex flex-wrap gap-2 pt-0.5">
                              <Button
                                variant="primary"
                                size="sm"
                                loading={processingMember === row.memberId}
                                onClick={() =>
                                  void handleQuickPayment({
                                    memberId: row.memberId,
                                    kind: group.kind,
                                    period: group.period,
                                    amountMajor: row.suggestedAmountMajor
                                  })
                                }
                              >
                                <Check className="size-3.5" aria-hidden />
                                {group.kind === 'rent'
                                  ? locale === 'ru'
                                    ? 'Закрыть аренду'
                                    : 'Paid rent'
                                  : locale === 'ru'
                                    ? 'Закрыть коммуналку'
                                    : 'Paid utilities'}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  onCustomPayment({
                                    memberId: row.memberId,
                                    kind: group.kind,
                                    period: group.period
                                  })
                                }
                              >
                                <Pencil className="size-3.5" aria-hidden />
                                {copy.paymentsCustomAmountAction}
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  )
}
