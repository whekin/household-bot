import { ChevronDown, ChevronUp } from 'lucide-solid'
import { For, Match, Show, Switch, createMemo, createSignal } from 'solid-js'

import { useI18n } from '../contexts/i18n-context'
import { useDashboard } from '../contexts/dashboard-context'
import { PurchaseBalanceRail, normalizedRailWidth } from '../components/purchase-balance-rail'
import { Card } from '../components/ui/card'
import { Skeleton } from '../components/ui/skeleton'
import { formatFriendlyDate } from '../lib/dates'
import {
  formatMoneyLabel,
  formatSemanticMoneyLabel,
  memberEffectivePurchaseBalanceMajor
} from '../lib/ledger-helpers'
import { majorStringToMinor, minorToMajorString } from '../lib/money'
import type { Locale } from '../i18n'
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

function joinMetaParts(parts: readonly (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(' · ')
}

function signedMoneyLabel(amountMinor: bigint, currency: 'USD' | 'GEL', locale: Locale): string {
  const sign = amountMinor > 0n ? '+' : amountMinor < 0n ? '−' : ''
  const absoluteMinor = amountMinor < 0n ? -amountMinor : amountMinor
  return `${sign}${formatMoneyLabel(minorToMajorString(absoluteMinor), currency, locale)}`
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

  const [detailsOpen, setDetailsOpen] = createSignal(false)
  const [driversOpen, setDriversOpen] = createSignal(false)
  const [purchaseDriversOpen, setPurchaseDriversOpen] = createSignal(false)
  const [paymentDriversOpen, setPaymentDriversOpen] = createSignal(false)

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
      purchaseBalanceMinor: majorStringToMinor(memberEffectivePurchaseBalanceMajor(member)),
      purchaseBalanceMajor: memberEffectivePurchaseBalanceMajor(member),
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

  const isUtilitiesFullyPaid = createMemo(() => {
    const summary = currentUtilitySummary()
    if (!summary) return false
    return (
      majorStringToMinor(summary.assignedThisCycleMajor) === 0n &&
      majorStringToMinor(summary.vendorPaidMajor) > 0n
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
  const dueNowMinor = createMemo(() => majorStringToMinor(dueNowMajor()))
  const remainingMinor = createMemo(() =>
    currentMember() ? majorStringToMinor(currentMember()!.remainingMajor) : 0n
  )
  const purchasePositionMinor = createMemo(() =>
    currentMember() ? majorStringToMinor(memberEffectivePurchaseBalanceMajor(currentMember()!)) : 0n
  )

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
          shareMajor: shareMinor !== null ? minorToMajorString(shareMinor) : null,
          payerLabel:
            (payerMemberId ? memberNamesById().get(payerMemberId) : null) ??
            entry.actorDisplayName ??
            '—',
          resolutionStatus: entry.resolutionStatus ?? 'unresolved',
          impactMinor,
          impactSignedMajor: minorToMajorString(impactMinor),
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

  const formulaItems = createMemo(() => {
    const data = dashboard()
    const member = currentMember()
    if (!data || !member) return []

    return [
      {
        key: 'rent',
        label: copy().balancesBreakdownRentLabel,
        value: formatAmount(member.rentShareMajor, data.currency)
      },
      {
        key: 'utilities',
        label: copy().balancesBreakdownUtilitiesLabel,
        value: formatAmount(member.utilityShareMajor, data.currency)
      },
      {
        key: 'purchases',
        label: copy().balancesBreakdownPurchaseLabel,
        value:
          formatSemanticMoneyLabel(
            memberEffectivePurchaseBalanceMajor(member),
            data.currency,
            locale()
          ) ?? null
      },
      {
        key: 'paid',
        label: copy().balancesBreakdownPaidLabel,
        value: `−${formatAmount(member.paidMajor, data.currency)}`
      }
    ].filter((item) => item.value !== null)
  })

  const purchaseImpactTotalMinor = createMemo(() =>
    purchaseDerivationRows().reduce((sum, row) => sum + row.impactMinor, 0n)
  )
  const summaryCards = createMemo(() => {
    const data = dashboard()
    const member = currentMember()
    if (!data || !member) return []

    return [
      remainingMinor() !== 0n
        ? {
            key: 'remaining',
            label: copy().balancesRemainingLabel,
            value:
              formatSemanticMoneyLabel(member.remainingMajor, data.currency, locale(), {
                credit: locale() === 'ru' ? 'В плюсе' : 'In credit',
                debit: copy().balancesRemainingLabel
              }) ?? null
          }
        : null,
      {
        key: 'full',
        label: copy().balancesFullDueLabel,
        value: formatAmount(member.netDueMajor, data.currency)
      },
      purchasePositionMinor() !== 0n
        ? {
            key: 'purchase',
            label: copy().balancesBreakdownPurchaseLabel,
            value:
              formatSemanticMoneyLabel(
                memberEffectivePurchaseBalanceMajor(member),
                data.currency,
                locale()
              ) ?? null
          }
        : null
    ].filter((item): item is { key: string; label: string; value: string } => Boolean(item?.value))
  })

  const driverSummaryItems = createMemo(() => {
    const data = dashboard()
    if (!data) return []

    return [
      {
        key: 'purchases',
        label: copy().balancesDriversPurchasesLabel,
        value: String(purchaseDerivationRows().length)
      },
      {
        key: 'payments',
        label: copy().balancesDriversPaymentsLabel,
        value: String(paymentDerivationRows().length)
      },
      purchaseDerivationRows().length > 0
        ? {
            key: 'net',
            label: copy().balancesDriversNetLabel,
            value: signedMoneyLabel(purchaseImpactTotalMinor(), data.currency, locale()),
            tone:
              purchaseImpactTotalMinor() < 0n
                ? 'is-credit'
                : purchaseImpactTotalMinor() > 0n
                  ? 'is-debit'
                  : 'is-neutral'
          }
        : null
    ].filter(Boolean)
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
                  <section class="balances-panel balances-panel--hero balances-panel--compact">
                    <div class="balances-panel__header balances-panel__header--hero">
                      <div class="balances-panel__copy">
                        <strong>{copy().balancesYourBalanceTitle}</strong>
                        <p>
                          {dueNowMinor() > 0n
                            ? effectiveBillingStage() === 'utilities'
                              ? copy().balancesCurrentUtilitiesTitle
                              : effectiveBillingStage() === 'rent'
                                ? copy().balancesCurrentRentTitle
                                : copy().balancesYourBalanceBody
                            : locale() === 'ru'
                              ? 'Сейчас без активной оплаты.'
                              : 'No active payment right now.'}
                        </p>
                      </div>
                      <Show when={dueNowMinor() > 0n}>
                        <div class="balances-panel__amount-stack">
                          <span>{copy().balancesDueNowLabel}</span>
                          <strong>{formatAmount(dueNowMajor(), data().currency)}</strong>
                        </div>
                      </Show>
                    </div>

                    <Show when={summaryCards().length > 0}>
                      <div class="balances-summary-grid">
                        <For each={summaryCards()}>
                          {(card) => (
                            <div class="balances-summary-card">
                              <span>{card.label}</span>
                              <strong>{card.value}</strong>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>

                    <div class="balances-formula-panel">
                      <div class="statement-section-heading">
                        <div>
                          <strong>{copy().balancesFormulaTitle}</strong>
                        </div>
                      </div>

                      <div class="balances-formula-strip">
                        <For each={formulaItems()}>
                          {(item) => (
                            <div
                              class="balances-formula-cell"
                              classList={{ 'is-result': item.key === 'result' }}
                            >
                              <span>{item.label}</span>
                              <strong>{item.value}</strong>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>

                    <Show
                      when={member().explanations.length > 0 || effectiveBillingStage() !== 'idle'}
                    >
                      <div class="balances-inline-section">
                        <button
                          class="balances-inline-toggle"
                          type="button"
                          onClick={() => setDetailsOpen(!detailsOpen())}
                        >
                          <span>{copy().balancesDetailsTitle}</span>
                          <span class="balances-inline-toggle__action">
                            {detailsOpen() ? copy().showLessAction : copy().showMoreAction}
                            <Show when={detailsOpen()} fallback={<ChevronDown size={16} />}>
                              <ChevronUp size={16} />
                            </Show>
                          </span>
                        </button>

                        <Show when={detailsOpen()}>
                          <div class="balances-inline-details">
                            <Show when={effectiveBillingStage() !== 'idle'}>
                              <div class="balances-inline-block">
                                <div class="statement-section-heading">
                                  <div>
                                    <strong>{copy().balancesCurrentPeriodDetailsTitle}</strong>
                                  </div>
                                </div>

                                <Show when={effectiveBillingStage() === 'utilities'}>
                                  <div class="balances-compact-list">
                                    <Show when={currentUtilityAssignments().length > 0}>
                                      <For each={currentUtilityAssignments()}>
                                        {(category) => (
                                          <div class="balances-compact-row">
                                            <strong>{category.billName}</strong>
                                            <span>
                                              {formatAmount(
                                                category.assignedAmountMajor,
                                                data().currency
                                              )}
                                            </span>
                                          </div>
                                        )}
                                      </For>
                                    </Show>
                                    <Show when={currentUtilitySummary()}>
                                      {(summary) => (
                                        <div class="balances-inline-mini-grid">
                                          <div class="balances-inline-mini-card">
                                            <span>{copy().balancesTargetLabel}</span>
                                            <strong>
                                              {formatAmount(
                                                summary().fairShareMajor,
                                                data().currency
                                              )}
                                            </strong>
                                          </div>
                                          <div class="balances-inline-mini-card">
                                            <span>
                                              {isUtilitiesFullyPaid()
                                                ? copy().balancesPaidLabel
                                                : copy().balancesAssignedNowLabel}
                                            </span>
                                            <strong>
                                              {formatAmount(
                                                isUtilitiesFullyPaid()
                                                  ? summary().vendorPaidMajor
                                                  : summary().assignedThisCycleMajor,
                                                data().currency
                                              )}
                                            </strong>
                                          </div>
                                          <Show when={!isUtilitiesFullyPaid()}>
                                            <div class="balances-inline-mini-card">
                                              <span>{copy().balancesAfterPlanLabel}</span>
                                              <strong>
                                                {formatSemanticMoneyLabel(
                                                  summary().projectedDeltaAfterPlanMajor,
                                                  data().currency,
                                                  locale(),
                                                  {
                                                    credit:
                                                      locale() === 'ru' ? 'В плюсе' : 'In credit',
                                                    debit:
                                                      locale() === 'ru' ? 'К доплате' : 'To pay',
                                                    neutral:
                                                      locale() === 'ru'
                                                        ? 'Без доплаты'
                                                        : 'No extra due'
                                                  }
                                                )}
                                              </strong>
                                            </div>
                                          </Show>
                                        </div>
                                      )}
                                    </Show>
                                  </div>
                                </Show>

                                <Show when={effectiveBillingStage() === 'rent'}>
                                  <div class="balances-compact-list">
                                    <Show when={currentRentSummary()}>
                                      {(summary) => (
                                        <div class="balances-inline-mini-grid">
                                          <div class="balances-inline-mini-card">
                                            <span>{copy().balancesTargetLabel}</span>
                                            <strong>
                                              {formatAmount(summary().dueMajor, data().currency)}
                                            </strong>
                                          </div>
                                          <div class="balances-inline-mini-card">
                                            <span>{copy().balancesRemainingLabel}</span>
                                            <strong>
                                              {formatAmount(
                                                summary().remainingMajor,
                                                data().currency
                                              )}
                                            </strong>
                                          </div>
                                        </div>
                                      )}
                                    </Show>
                                    <For each={data().rentBillingState.paymentDestinations ?? []}>
                                      {(destination) => (
                                        <div class="balances-compact-row">
                                          <strong>{destination.label}</strong>
                                          <span>
                                            {destination.recipientName ??
                                              destination.bankName ??
                                              destination.account}
                                          </span>
                                        </div>
                                      )}
                                    </For>
                                  </div>
                                </Show>
                              </div>
                            </Show>

                            <Show when={member().explanations.length > 0}>
                              <div class="balances-inline-block">
                                <div class="statement-section-heading">
                                  <div>
                                    <strong>{copy().balancesExplanationsTitle}</strong>
                                  </div>
                                </div>
                                <div class="balances-note-list balances-note-list--compact">
                                  <For each={member().explanations}>
                                    {(note) => <p class="balances-note">{note}</p>}
                                  </For>
                                </div>
                              </div>
                            </Show>
                          </div>
                        </Show>
                      </div>
                    </Show>
                  </section>

                  <section class="balances-panel balances-panel--compact">
                    <Show
                      when={
                        purchaseDerivationRows().length > 0 || paymentDerivationRows().length > 0
                      }
                      fallback={
                        <p class="statement-list__empty">{copy().balancesNoDriverActivity}</p>
                      }
                    >
                      <div class="balances-driver-summary">
                        <For each={driverSummaryItems()}>
                          {(item) => (
                            <div class="balances-driver-summary__item">
                              <span>{item!.label}</span>
                              <strong class={item!.key === 'net' ? item!.tone : undefined}>
                                {item!.value}
                              </strong>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>

                    <div class="balances-inline-section">
                      <button
                        class="balances-inline-toggle"
                        type="button"
                        onClick={() => setDriversOpen(!driversOpen())}
                      >
                        <span>{copy().balancesDriversSummaryTitle}</span>
                        <span class="balances-inline-toggle__action">
                          {driversOpen() ? copy().showLessAction : copy().showMoreAction}
                          <Show when={driversOpen()} fallback={<ChevronDown size={16} />}>
                            <ChevronUp size={16} />
                          </Show>
                        </span>
                      </button>

                      <Show when={driversOpen()}>
                        <div class="balances-driver-groups">
                          <div class="balances-driver-group">
                            <button
                              class="balances-driver-group__toggle"
                              type="button"
                              onClick={() => setPurchaseDriversOpen(!purchaseDriversOpen())}
                            >
                              <span>
                                {copy().balancesPurchaseDriversTitle} (
                                {purchaseDerivationRows().length})
                              </span>
                              <span class="balances-inline-toggle__action">
                                {purchaseDriversOpen()
                                  ? copy().showLessAction
                                  : copy().showMoreAction}
                                <Show
                                  when={purchaseDriversOpen()}
                                  fallback={<ChevronDown size={16} />}
                                >
                                  <ChevronUp size={16} />
                                </Show>
                              </span>
                            </button>

                            <Show
                              when={purchaseDriversOpen()}
                              fallback={
                                <Show when={purchaseDerivationRows().length === 0}>
                                  <p class="statement-list__empty">
                                    {copy().balancesNoPurchaseDrivers}
                                  </p>
                                </Show>
                              }
                            >
                              <div class="balances-driver-list">
                                <For each={purchaseDerivationRows()}>
                                  {(row) => (
                                    <div class="balances-driver-row">
                                      <div class="balances-driver-row__main">
                                        <strong>{row.title}</strong>
                                        <span>
                                          {joinMetaParts([
                                            row.dateLabel,
                                            row.resolutionStatus === 'resolved'
                                              ? copy().balancesResolvedLabel
                                              : copy().balancesUnresolvedLabel,
                                            row.shareMajor
                                              ? `${copy().homeIdleYourShareLabel} ${formatAmount(row.shareMajor, data().currency)}`
                                              : copy().balancesNotIncludedLabel,
                                            row.payerLabel
                                              ? `${copy().purchasePayerLabel} ${row.payerLabel}`
                                              : null
                                          ])}
                                        </span>
                                      </div>
                                      <div class="balances-driver-row__value">
                                        <strong class={row.impactTone}>
                                          {signedMoneyLabel(
                                            row.impactMinor,
                                            data().currency,
                                            locale()
                                          )}
                                        </strong>
                                      </div>
                                    </div>
                                  )}
                                </For>
                              </div>
                            </Show>
                          </div>

                          <div class="balances-driver-group">
                            <button
                              class="balances-driver-group__toggle"
                              type="button"
                              onClick={() => setPaymentDriversOpen(!paymentDriversOpen())}
                            >
                              <span>
                                {copy().balancesPaymentDriversTitle} (
                                {paymentDerivationRows().length})
                              </span>
                              <span class="balances-inline-toggle__action">
                                {paymentDriversOpen()
                                  ? copy().showLessAction
                                  : copy().showMoreAction}
                                <Show
                                  when={paymentDriversOpen()}
                                  fallback={<ChevronDown size={16} />}
                                >
                                  <ChevronUp size={16} />
                                </Show>
                              </span>
                            </button>

                            <Show
                              when={paymentDriversOpen()}
                              fallback={
                                <Show when={paymentDerivationRows().length === 0}>
                                  <p class="statement-list__empty">
                                    {copy().balancesNoPaymentDrivers}
                                  </p>
                                </Show>
                              }
                            >
                              <div class="balances-driver-list">
                                <For each={paymentDerivationRows()}>
                                  {(row) => (
                                    <div class="balances-driver-row">
                                      <div class="balances-driver-row__main">
                                        <strong>{row.title}</strong>
                                        <span>
                                          {joinMetaParts([
                                            row.dateLabel,
                                            row.paymentKind === 'rent'
                                              ? copy().balancesRentPaymentLabel
                                              : row.paymentKind === 'utilities'
                                                ? copy().balancesUtilitiesPaymentLabel
                                                : copy().balancesPaymentLabel
                                          ])}
                                        </span>
                                      </div>
                                      <div class="balances-driver-row__value">
                                        <strong class="is-credit">
                                          −{formatAmount(row.amountMajor, data().currency)}
                                        </strong>
                                      </div>
                                    </div>
                                  )}
                                </For>
                              </div>
                            </Show>
                          </div>
                        </div>
                      </Show>
                    </div>
                  </section>

                  <section class="balances-panel balances-panel--compact balances-panel--secondary">
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
                        balanceLabel:
                          formatSemanticMoneyLabel(
                            row.purchaseBalanceMajor,
                            data().currency,
                            locale()
                          ) ?? (locale() === 'ru' ? 'Закрыто' : 'Settled'),
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
