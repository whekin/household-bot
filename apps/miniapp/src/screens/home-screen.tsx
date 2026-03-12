import { Show } from 'solid-js'

import { FinanceSummaryCards } from '../components/finance/finance-summary-cards'
import { compareTodayToPeriodDay, formatCyclePeriod, formatPeriodDay } from '../lib/dates'
import { majorStringToMinor, minorToMajorString, sumMajorStrings } from '../lib/money'
import type { MiniAppDashboard } from '../miniapp-api'

type Props = {
  copy: Record<string, string | undefined>
  locale: 'en' | 'ru'
  dashboard: MiniAppDashboard | null
  currentMemberLine: MiniAppDashboard['members'][number] | null
  utilityTotalMajor: string
  purchaseTotalMajor: string
}

export function HomeScreen(props: Props) {
  const rentPaidMajor = () => {
    if (!props.dashboard || !props.currentMemberLine) {
      return '0.00'
    }

    const totalMinor = props.dashboard.ledger
      .filter(
        (entry) =>
          entry.kind === 'payment' &&
          entry.memberId === props.currentMemberLine?.memberId &&
          entry.paymentKind === 'rent'
      )
      .reduce((sum, entry) => sum + majorStringToMinor(entry.displayAmountMajor), 0n)

    return minorToMajorString(totalMinor)
  }

  const utilitiesPaidMajor = () => {
    if (!props.dashboard || !props.currentMemberLine) {
      return '0.00'
    }

    const totalMinor = props.dashboard.ledger
      .filter(
        (entry) =>
          entry.kind === 'payment' &&
          entry.memberId === props.currentMemberLine?.memberId &&
          entry.paymentKind === 'utilities'
      )
      .reduce((sum, entry) => sum + majorStringToMinor(entry.displayAmountMajor), 0n)

    return minorToMajorString(totalMinor)
  }

  const hasUtilityBills = () =>
    Boolean(props.dashboard?.ledger.some((entry) => entry.kind === 'utility'))

  const adjustedRentMajor = () => {
    if (!props.currentMemberLine) {
      return null
    }

    return sumMajorStrings(
      props.currentMemberLine.rentShareMajor,
      props.currentMemberLine.purchaseOffsetMajor
    )
  }

  const adjustedUtilitiesMajor = () => {
    if (!props.currentMemberLine) {
      return null
    }

    return sumMajorStrings(
      props.currentMemberLine.utilityShareMajor,
      props.currentMemberLine.purchaseOffsetMajor
    )
  }

  const rentDueMajor = () => {
    if (!props.currentMemberLine || !props.dashboard) {
      return null
    }

    return props.dashboard.paymentBalanceAdjustmentPolicy === 'rent'
      ? adjustedRentMajor()
      : props.currentMemberLine.rentShareMajor
  }

  const utilitiesDueMajor = () => {
    if (!props.currentMemberLine || !props.dashboard || !hasUtilityBills()) {
      return null
    }

    return props.dashboard.paymentBalanceAdjustmentPolicy === 'utilities'
      ? adjustedUtilitiesMajor()
      : props.currentMemberLine.utilityShareMajor
  }

  const separateBalanceMajor = () => {
    if (
      !props.currentMemberLine ||
      props.dashboard?.paymentBalanceAdjustmentPolicy !== 'separate'
    ) {
      return null
    }

    return props.currentMemberLine.purchaseOffsetMajor
  }

  const heroState = () => {
    if (!props.dashboard || !props.currentMemberLine) {
      return {
        title: props.copy.payNowTitle ?? props.copy.yourBalanceTitle ?? '',
        label: props.copy.remainingLabel ?? '',
        amountMajor: '—'
      }
    }

    const remainingMinor = majorStringToMinor(props.currentMemberLine.remainingMajor)
    const paidMinor = majorStringToMinor(props.currentMemberLine.paidMajor)
    const rentStatus = compareTodayToPeriodDay(
      props.dashboard.period,
      props.dashboard.rentDueDay,
      props.dashboard.timezone
    )
    const utilitiesStatus = compareTodayToPeriodDay(
      props.dashboard.period,
      props.dashboard.utilitiesDueDay,
      props.dashboard.timezone
    )
    const hasDueNow =
      (rentStatus !== null &&
        rentStatus >= 0 &&
        majorStringToMinor(rentDueMajor() ?? '0.00') > 0n) ||
      (utilitiesStatus !== null &&
        utilitiesStatus >= 0 &&
        majorStringToMinor(utilitiesDueMajor() ?? '0.00') > 0n) ||
      (props.dashboard.paymentBalanceAdjustmentPolicy === 'separate' &&
        majorStringToMinor(separateBalanceMajor() ?? '0.00') > 0n)

    if (remainingMinor === 0n && paidMinor > 0n) {
      return {
        title: props.copy.homeSettledTitle ?? '',
        label: props.copy.paidThisCycleLabel ?? props.copy.paidLabel ?? '',
        amountMajor: props.currentMemberLine.paidMajor
      }
    }

    if (hasDueNow) {
      return {
        title: props.copy.homeDueTitle ?? props.copy.payNowTitle ?? '',
        label: props.copy.remainingLabel ?? '',
        amountMajor: props.currentMemberLine.remainingMajor
      }
    }

    return {
      title: props.copy.payNowTitle ?? props.copy.yourBalanceTitle ?? '',
      label: props.copy.cycleTotalLabel ?? props.copy.totalDue ?? '',
      amountMajor: props.currentMemberLine.netDueMajor
    }
  }

  const dueLabel = (kind: 'rent' | 'utilities') => {
    if (!props.dashboard) {
      return null
    }

    const day = kind === 'rent' ? props.dashboard.rentDueDay : props.dashboard.utilitiesDueDay
    const comparison = compareTodayToPeriodDay(
      props.dashboard.period,
      day,
      props.dashboard.timezone
    )
    const date = formatPeriodDay(props.dashboard.period, day, props.locale)
    const template =
      comparison !== null && comparison < 0
        ? (props.copy.upcomingLabel ?? '')
        : (props.copy.dueOnLabel ?? '').replace('{date}', date)

    if (comparison !== null && comparison < 0) {
      return `${template}${template.length > 0 ? ' ' : ''}${date}`.trim()
    }

    return template
  }

  return (
    <Show
      when={props.dashboard}
      fallback={
        <div class="home-grid">
          <article class="balance-item balance-item--accent balance-spotlight">
            <header class="balance-spotlight__header">
              <div class="balance-spotlight__copy">
                <strong>{props.copy.yourBalanceTitle ?? ''}</strong>
                <p>{props.copy.yourBalanceBody ?? ''}</p>
              </div>
              <div class="balance-spotlight__hero">
                <span>{props.copy.remainingLabel ?? ''}</span>
                <strong>—</strong>
              </div>
            </header>
          </article>
        </div>
      }
    >
      {(dashboard) => (
        <div class="home-grid">
          <Show when={props.currentMemberLine}>
            {(member) => (
              <article class="balance-item balance-item--accent home-pay-card">
                <header class="home-pay-card__header">
                  <div class="home-pay-card__copy">
                    <strong>{heroState().title}</strong>
                    <small>{formatCyclePeriod(dashboard().period, props.locale)}</small>
                  </div>
                  <div class="balance-spotlight__hero">
                    <span>{heroState().label}</span>
                    <strong>
                      {heroState().amountMajor} {dashboard().currency}
                    </strong>
                  </div>
                </header>

                <div class="balance-spotlight__stats">
                  <article class="stat-card balance-spotlight__stat">
                    <span>{props.copy.paidLabel ?? ''}</span>
                    <strong>
                      {member().paidMajor} {dashboard().currency}
                    </strong>
                  </article>
                  <article class="stat-card balance-spotlight__stat">
                    <span>{props.copy.remainingLabel ?? ''}</span>
                    <strong>
                      {member().remainingMajor} {dashboard().currency}
                    </strong>
                  </article>
                </div>

                <div class="balance-spotlight__rows">
                  <article class="balance-detail-row">
                    <div class="balance-detail-row__main">
                      <span>
                        {dashboard().paymentBalanceAdjustmentPolicy === 'rent'
                          ? props.copy.rentAdjustedTotalLabel
                          : props.copy.shareRent}
                      </span>
                      <strong>
                        {rentDueMajor()} {dashboard().currency}
                      </strong>
                      <small>{dueLabel('rent')}</small>
                    </div>
                    <span class="mini-chip mini-chip--muted">
                      {props.copy.rentPaidLabel ?? props.copy.paidLabel}: {rentPaidMajor()}{' '}
                      {dashboard().currency}
                    </span>
                  </article>

                  <article class="balance-detail-row">
                    <div class="balance-detail-row__main">
                      <span>
                        {dashboard().paymentBalanceAdjustmentPolicy === 'utilities'
                          ? props.copy.utilitiesAdjustedTotalLabel
                          : (props.copy.utilitiesBalanceLabel ?? props.copy.shareUtilities)}
                      </span>
                      <strong>
                        {utilitiesDueMajor() !== null
                          ? `${utilitiesDueMajor()} ${dashboard().currency}`
                          : (props.copy.notBilledYetLabel ?? '')}
                      </strong>
                      <small>
                        {utilitiesDueMajor() !== null
                          ? dueLabel('utilities')
                          : dueLabel('utilities')}
                      </small>
                    </div>
                    <span class="mini-chip mini-chip--muted">
                      {props.copy.utilitiesPaidLabel ?? props.copy.paidLabel}:{' '}
                      {utilitiesPaidMajor()} {dashboard().currency}
                    </span>
                  </article>

                  <Show when={dashboard().paymentBalanceAdjustmentPolicy === 'separate'}>
                    <article class="balance-detail-row">
                      <div class="balance-detail-row__main">
                        <span>{props.copy.balanceAdjustmentLabel ?? props.copy.shareOffset}</span>
                        <strong>
                          {separateBalanceMajor()} {dashboard().currency}
                        </strong>
                      </div>
                    </article>
                  </Show>
                </div>
              </article>
            )}
          </Show>

          <article class="balance-item balance-item--wide balance-item--muted">
            <header>
              <strong>{props.copy.houseSnapshotTitle ?? ''}</strong>
              <span>{formatCyclePeriod(dashboard().period, props.locale)}</span>
            </header>
            <p>{props.copy.houseSnapshotBody ?? ''}</p>
            <div class="summary-card-grid summary-card-grid--secondary">
              <FinanceSummaryCards
                dashboard={dashboard()}
                utilityTotalMajor={props.utilityTotalMajor}
                purchaseTotalMajor={props.purchaseTotalMajor}
                labels={{
                  remaining: props.copy.remainingLabel ?? '',
                  rent: props.copy.shareRent ?? '',
                  utilities: props.copy.shareUtilities ?? '',
                  purchases: props.copy.purchasesTitle ?? ''
                }}
              />
            </div>
          </article>
        </div>
      )}
    </Show>
  )
}
