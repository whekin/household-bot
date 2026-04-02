import { For, Match, Show, Switch, createMemo } from 'solid-js'

import { useI18n } from '../contexts/i18n-context'
import { useDashboard } from '../contexts/dashboard-context'
import { PurchaseBalanceRail, normalizedRailWidth } from '../components/purchase-balance-rail'
import { Card } from '../components/ui/card'
import { Skeleton } from '../components/ui/skeleton'
import { formatFriendlyDate } from '../lib/dates'
import { formatMoneyLabel } from '../lib/ledger-helpers'
import { majorStringToMinor, minorToMajorString } from '../lib/money'
import type { MiniAppDashboard } from '../miniapp-api'

function splitEvenlyShareMinor(amountMajor: string, includedCount: number, index: number): bigint {
  if (includedCount <= 0) {
    return 0n
  }

  const amountMinor = majorStringToMinor(amountMajor)
  const base = amountMinor / BigInt(includedCount)
  const leftover = amountMinor % BigInt(includedCount)

  return base + (BigInt(index) < leftover ? 1n : 0n)
}

function purchaseShareMinorForMember(
  entry: MiniAppDashboard['ledger'][number],
  memberId: string
): bigint | null {
  const participant = (entry.purchaseParticipants ?? []).find(
    (item) => item.memberId === memberId && item.included
  )
  if (!participant) {
    return null
  }

  if (participant.shareAmountMajor) {
    return majorStringToMinor(participant.shareAmountMajor)
  }

  const includedParticipants = (entry.purchaseParticipants ?? []).filter((item) => item.included)
  const participantIndex = includedParticipants.findIndex((item) => item.memberId === memberId)

  if (participantIndex === -1) {
    return null
  }

  return splitEvenlyShareMinor(
    entry.displayAmountMajor,
    includedParticipants.length,
    participantIndex
  )
}

function occurredAtSortValue(value: string | null | undefined): string {
  return value ?? ''
}

function purchaseResolutionRank(status: MiniAppDashboard['ledger'][number]['resolutionStatus']) {
  return status === 'unresolved' ? 0 : 1
}

export default function BalancesRoute() {
  const { copy, locale } = useI18n()
  const {
    dashboard,
    effectiveBillingStage,
    loading,
    purchaseLedger,
    paymentLedger,
    currentMemberLine
  } = useDashboard()
  const formatAmount = (amountMajor: string, currency: 'USD' | 'GEL') =>
    formatMoneyLabel(amountMajor, currency, locale())
  const currentMember = createMemo(() => currentMemberLine())

  const purchaseRows = createMemo(() => {
    const data = dashboard()
    const currentMemberValue = currentMember()
    if (!data) return []

    const rows = data.members.map((member) => ({
      memberId: member.memberId,
      displayName: member.displayName,
      purchaseBalanceMinor: majorStringToMinor(member.purchaseOffsetMajor),
      purchaseBalanceMajor: member.purchaseOffsetMajor,
      isCurrent: currentMemberValue?.memberId === member.memberId
    }))

    const maxBalanceMinor = rows.reduce((max, row) => {
      const absolute =
        row.purchaseBalanceMinor < 0n ? -row.purchaseBalanceMinor : row.purchaseBalanceMinor
      return absolute > max ? absolute : max
    }, 0n)

    return rows
      .sort((left, right) => {
        if (left.isCurrent) return -1
        if (right.isCurrent) return 1

        const leftAbsolute =
          left.purchaseBalanceMinor < 0n ? -left.purchaseBalanceMinor : left.purchaseBalanceMinor
        const rightAbsolute =
          right.purchaseBalanceMinor < 0n ? -right.purchaseBalanceMinor : right.purchaseBalanceMinor

        return rightAbsolute === leftAbsolute
          ? left.displayName.localeCompare(right.displayName)
          : rightAbsolute > leftAbsolute
            ? 1
            : -1
      })
      .map((row) => ({
        ...row,
        width: normalizedRailWidth(
          row.purchaseBalanceMinor < 0n ? -row.purchaseBalanceMinor : row.purchaseBalanceMinor,
          maxBalanceMinor
        ),
        side:
          row.purchaseBalanceMinor < 0n
            ? ('left' as const)
            : row.purchaseBalanceMinor > 0n
              ? ('right' as const)
              : ('none' as const)
      }))
  })

  const currentUtilityAssignments = createMemo(() => {
    const data = dashboard()
    const member = currentMember()
    if (!data?.utilityBillingPlan || !member) return []

    return data.utilityBillingPlan.categories.filter(
      (category) => category.assignedMemberId === member.memberId
    )
  })

  const currentUtilitySummary = createMemo(() => {
    const data = dashboard()
    const member = currentMember()
    if (!data?.utilityBillingPlan || !member) return null

    return (
      data.utilityBillingPlan.memberSummaries.find(
        (summary) => summary.memberId === member.memberId
      ) ?? null
    )
  })

  const currentRentSummary = createMemo(() => {
    const data = dashboard()
    const member = currentMember()
    if (!data || !member) return null

    return (
      data.rentBillingState.memberSummaries.find(
        (summary) => summary.memberId === member.memberId
      ) ?? null
    )
  })

  const dueNowMajor = createMemo(() => {
    if (effectiveBillingStage() === 'utilities') {
      return currentUtilitySummary()?.assignedThisCycleMajor ?? '0.00'
    }

    if (effectiveBillingStage() === 'rent') {
      return currentRentSummary()?.remainingMajor ?? '0.00'
    }

    return '0.00'
  })

  const memberNamesById = createMemo(() => {
    const data = dashboard()
    return new Map((data?.members ?? []).map((member) => [member.memberId, member.displayName]))
  })

  const purchaseDerivationRows = createMemo(() => {
    const member = currentMember()
    if (!member) return []

    return purchaseLedger()
      .map((entry) => {
        const shareMinor = purchaseShareMinorForMember(entry, member.memberId)
        const payerMemberId = entry.payerMemberId ?? entry.memberId ?? null
        const paidMinor =
          payerMemberId === member.memberId ? majorStringToMinor(entry.displayAmountMajor) : 0n
        const impactMinor = (shareMinor ?? 0n) - paidMinor

        if (shareMinor === null && paidMinor === 0n) {
          return null
        }

        return {
          id: entry.id,
          title: entry.title,
          occurredAt: entry.occurredAt,
          dateLabel: entry.occurredAt ? formatFriendlyDate(entry.occurredAt, locale()) : null,
          totalMajor: entry.displayAmountMajor,
          shareMajor: shareMinor !== null ? minorToMajorString(shareMinor) : null,
          payerLabel:
            (payerMemberId ? memberNamesById().get(payerMemberId) : null) ??
            entry.actorDisplayName ??
            '—',
          resolutionStatus: entry.resolutionStatus ?? 'unresolved',
          impactMinor,
          impactMajor: minorToMajorString(impactMinor < 0n ? -impactMinor : impactMinor),
          impactTone: impactMinor < 0n ? 'is-credit' : impactMinor > 0n ? 'is-debit' : 'is-neutral'
        }
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((left, right) => {
        const resolutionDelta =
          purchaseResolutionRank(left.resolutionStatus) -
          purchaseResolutionRank(right.resolutionStatus)
        if (resolutionDelta !== 0) {
          return resolutionDelta
        }

        return occurredAtSortValue(right.occurredAt).localeCompare(
          occurredAtSortValue(left.occurredAt)
        )
      })
  })

  const paymentDerivationRows = createMemo(() => {
    const member = currentMember()
    if (!member) return []

    return paymentLedger()
      .filter((entry) => entry.memberId === member.memberId)
      .map((entry) => ({
        id: entry.id,
        title: entry.title,
        occurredAt: entry.occurredAt,
        dateLabel: entry.occurredAt ? formatFriendlyDate(entry.occurredAt, locale()) : null,
        amountMajor: entry.displayAmountMajor,
        paymentKind: entry.paymentKind
      }))
      .sort((left, right) =>
        occurredAtSortValue(right.occurredAt).localeCompare(occurredAtSortValue(left.occurredAt))
      )
  })

  return (
    <div class="route route--balances">
      <Switch>
        <Match when={loading()}>
          <Card>
            <Skeleton style={{ width: '180px', height: '20px' }} />
            <Skeleton style={{ width: '100%', height: '120px', 'margin-top': '16px' }} />
          </Card>
        </Match>

        <Match when={!dashboard()}>
          <Card>
            <p class="empty-state">{copy().balancesEmpty}</p>
          </Card>
        </Match>

        <Match when={dashboard()}>
          {(data) => (
            <Show when={currentMember()}>
              {(member) => (
                <div class="balances-sheet">
                  <section class="balances-panel balances-panel--hero">
                    <div class="balances-panel__header balances-panel__header--hero">
                      <div class="balances-panel__copy">
                        <strong>{copy().balancesYourBalanceTitle}</strong>
                        <p>{copy().balancesYourBalanceBody}</p>
                      </div>
                      <div class="balances-panel__amount-stack">
                        <span>{copy().balancesRemainingLabel}</span>
                        <strong>{formatAmount(member().remainingMajor, data().currency)}</strong>
                      </div>
                    </div>

                    <div class="statement-chip-grid">
                      <div class="statement-chip">
                        <span>{copy().balancesDueNowLabel}</span>
                        <strong>{formatAmount(dueNowMajor(), data().currency)}</strong>
                      </div>
                      <div class="statement-chip">
                        <span>{copy().balancesFullDueLabel}</span>
                        <strong>{formatAmount(member().netDueMajor, data().currency)}</strong>
                      </div>
                      <div class="statement-chip">
                        <span>{copy().balancesPaidLabel}</span>
                        <strong>{formatAmount(member().paidMajor, data().currency)}</strong>
                      </div>
                      <div class="statement-chip">
                        <span>{copy().balancesRemainingLabel}</span>
                        <strong>{formatAmount(member().remainingMajor, data().currency)}</strong>
                      </div>
                    </div>

                    <Show when={effectiveBillingStage() !== 'idle'}>
                      <div class="balances-panel__subsection">
                        <div class="statement-section-heading">
                          <div>
                            <strong>
                              {effectiveBillingStage() === 'utilities'
                                ? copy().balancesCurrentUtilitiesTitle
                                : copy().balancesCurrentRentTitle}
                            </strong>
                            <p>
                              {effectiveBillingStage() === 'utilities'
                                ? data().paymentBalanceAdjustmentPolicy === 'rent'
                                  ? copy().balancesCurrentUtilitiesBodyRentMode
                                  : data().paymentBalanceAdjustmentPolicy === 'separate'
                                    ? copy().balancesCurrentUtilitiesBodyManualMode
                                    : copy().balancesCurrentUtilitiesBodyUtilitiesMode
                                : copy().balancesCurrentRentBody.replace(
                                    '{date}',
                                    data().rentBillingState.dueDate
                                  )}
                            </p>
                          </div>
                        </div>

                        <Show when={effectiveBillingStage() === 'utilities'}>
                          <Show
                            when={currentUtilityAssignments().length > 0}
                            fallback={
                              <p class="statement-list__empty">
                                {copy().balancesCurrentUtilitiesEmpty}
                              </p>
                            }
                          >
                            <div class="statement-list">
                              <For each={currentUtilityAssignments()}>
                                {(category) => (
                                  <div class="statement-list__item">
                                    <div>
                                      <strong>{category.billName}</strong>
                                      <span>
                                        {formatAmount(
                                          category.assignedAmountMajor,
                                          data().currency
                                        )}
                                      </span>
                                    </div>
                                    <span class="ui-badge ui-badge--muted">
                                      {category.isFullAssignment
                                        ? copy().balancesAssignmentFullLabel
                                        : copy().balancesAssignmentSplitLabel}
                                    </span>
                                  </div>
                                )}
                              </For>
                            </div>
                            <Show when={currentUtilitySummary()}>
                              {(summary) => (
                                <div class="statement-chip-grid">
                                  <div class="statement-chip">
                                    <span>{copy().balancesTargetLabel}</span>
                                    <strong>
                                      {formatAmount(summary().fairShareMajor, data().currency)}
                                    </strong>
                                  </div>
                                  <div class="statement-chip">
                                    <span>{copy().balancesAssignedNowLabel}</span>
                                    <strong>
                                      {formatAmount(
                                        summary().assignedThisCycleMajor,
                                        data().currency
                                      )}
                                    </strong>
                                  </div>
                                  <div class="statement-chip">
                                    <span>{copy().balancesAfterPlanLabel}</span>
                                    <strong>
                                      {formatAmount(
                                        summary().projectedDeltaAfterPlanMajor,
                                        data().currency
                                      )}
                                    </strong>
                                  </div>
                                </div>
                              )}
                            </Show>
                          </Show>
                        </Show>

                        <Show when={effectiveBillingStage() === 'rent' && currentRentSummary()}>
                          <div class="statement-list">
                            <For each={data().rentBillingState.paymentDestinations ?? []}>
                              {(destination) => (
                                <div class="statement-list__item">
                                  <div>
                                    <strong>{destination.label}</strong>
                                    <span>{destination.account}</span>
                                  </div>
                                  <span>
                                    {destination.recipientName ?? destination.bankName ?? '—'}
                                  </span>
                                </div>
                              )}
                            </For>
                          </div>
                        </Show>
                      </div>
                    </Show>
                  </section>

                  <section class="balances-panel">
                    <div class="statement-section-heading">
                      <div>
                        <strong>{copy().balancesHowFormedTitle}</strong>
                        <p>{copy().balancesHowFormedBody}</p>
                      </div>
                    </div>

                    <div class="balances-breakdown">
                      <div class="balances-breakdown__row">
                        <span>{copy().balancesBreakdownRentLabel}</span>
                        <strong>{formatAmount(member().rentShareMajor, data().currency)}</strong>
                      </div>
                      <div class="balances-breakdown__row">
                        <span>{copy().balancesBreakdownUtilitiesLabel}</span>
                        <strong>{formatAmount(member().utilityShareMajor, data().currency)}</strong>
                      </div>
                      <div class="balances-breakdown__row">
                        <span>{copy().balancesBreakdownPurchaseLabel}</span>
                        <strong>
                          {formatAmount(member().purchaseOffsetMajor, data().currency)}
                        </strong>
                      </div>
                      <div class="balances-breakdown__row">
                        <span>{copy().balancesBreakdownPaidLabel}</span>
                        <strong>{formatAmount(member().paidMajor, data().currency)}</strong>
                      </div>
                      <div class="balances-breakdown__row is-total">
                        <span>{copy().balancesBreakdownRemainingLabel}</span>
                        <strong>{formatAmount(member().remainingMajor, data().currency)}</strong>
                      </div>
                    </div>

                    <Show when={member().explanations.length > 0}>
                      <div class="balances-notes">
                        <strong>{copy().balancesExplanationsTitle}</strong>
                        <div class="balances-note-list">
                          <For each={member().explanations}>
                            {(note) => <p class="balances-note">{note}</p>}
                          </For>
                        </div>
                      </div>
                    </Show>

                    <div class="balances-derivation-grid">
                      <div class="balances-derivation-group">
                        <div class="statement-section-heading">
                          <div>
                            <strong>{copy().balancesPurchaseDriversTitle}</strong>
                            <p>{copy().balancesPurchaseDriversBody}</p>
                          </div>
                        </div>
                        <Show
                          when={purchaseDerivationRows().length > 0}
                          fallback={
                            <p class="statement-list__empty">{copy().balancesNoPurchaseDrivers}</p>
                          }
                        >
                          <div class="balances-derivation-list">
                            <For each={purchaseDerivationRows()}>
                              {(row) => (
                                <div class="balances-derivation-row">
                                  <div class="balances-derivation-row__head">
                                    <div>
                                      <strong>{row.title}</strong>
                                    </div>
                                    <strong>{formatAmount(row.totalMajor, data().currency)}</strong>
                                  </div>
                                  <div class="balances-derivation-row__tags">
                                    <span class="balances-derivation-tag">
                                      {row.dateLabel ?? '—'}
                                    </span>
                                    <span
                                      class="balances-derivation-tag"
                                      classList={{
                                        'is-open': row.resolutionStatus !== 'resolved',
                                        'is-settled': row.resolutionStatus === 'resolved'
                                      }}
                                    >
                                      {row.resolutionStatus === 'resolved'
                                        ? copy().balancesResolvedLabel
                                        : copy().balancesUnresolvedLabel}
                                    </span>
                                  </div>
                                  <div class="balances-derivation-row__meta">
                                    <div class="balances-detail-tile">
                                      <span>{copy().homeIdleYourShareLabel}</span>
                                      <strong>
                                        {row.shareMajor
                                          ? formatAmount(row.shareMajor, data().currency)
                                          : copy().balancesNotIncludedLabel}
                                      </strong>
                                    </div>
                                    <div class="balances-detail-tile">
                                      <span>{copy().purchasePayerLabel}</span>
                                      <strong>{row.payerLabel}</strong>
                                    </div>
                                  </div>
                                  <div class="balances-impact-row">
                                    <span>{copy().balancesImpactLabel}</span>
                                    <strong class={row.impactTone}>
                                      {row.impactTone === 'is-credit'
                                        ? '−'
                                        : row.impactTone === 'is-debit'
                                          ? '+'
                                          : ''}
                                      {formatAmount(row.impactMajor, data().currency)}
                                    </strong>
                                  </div>
                                </div>
                              )}
                            </For>
                          </div>
                        </Show>
                      </div>

                      <div class="balances-derivation-group">
                        <div class="statement-section-heading">
                          <div>
                            <strong>{copy().balancesPaymentDriversTitle}</strong>
                            <p>{copy().balancesPaymentDriversBody}</p>
                          </div>
                        </div>
                        <Show
                          when={paymentDerivationRows().length > 0}
                          fallback={
                            <p class="statement-list__empty">{copy().balancesNoPaymentDrivers}</p>
                          }
                        >
                          <div class="balances-derivation-list">
                            <For each={paymentDerivationRows()}>
                              {(row) => (
                                <div class="balances-derivation-row">
                                  <div class="balances-derivation-row__head">
                                    <div>
                                      <strong>{row.title}</strong>
                                    </div>
                                    <strong>
                                      −{formatAmount(row.amountMajor, data().currency)}
                                    </strong>
                                  </div>
                                  <div class="balances-derivation-row__tags">
                                    <span class="balances-derivation-tag">
                                      {row.dateLabel ?? '—'}
                                    </span>
                                    <span class="balances-derivation-tag is-muted">
                                      {row.paymentKind === 'rent'
                                        ? copy().balancesRentPaymentLabel
                                        : row.paymentKind === 'utilities'
                                          ? copy().balancesUtilitiesPaymentLabel
                                          : copy().balancesPaymentLabel}
                                    </span>
                                  </div>
                                </div>
                              )}
                            </For>
                          </div>
                        </Show>
                      </div>
                    </div>
                  </section>

                  <section class="balances-panel">
                    <div class="statement-section-heading">
                      <div>
                        <strong>{copy().balancesComparisonTitle}</strong>
                        <p>{copy().balancesComparisonBody}</p>
                      </div>
                    </div>
                    <PurchaseBalanceRail
                      variant="compact"
                      surface="flat"
                      rows={purchaseRows().map((row) => ({
                        memberId: row.memberId,
                        displayName: row.displayName,
                        balanceLabel: formatAmount(row.purchaseBalanceMajor, data().currency),
                        width: row.width,
                        side: row.side,
                        isCurrent: row.isCurrent
                      }))}
                      currentLabel={copy().purchaseBalanceCurrentLabel}
                    />
                  </section>
                </div>
              )}
            </Show>
          )}
        </Match>
      </Switch>
    </div>
  )
}
