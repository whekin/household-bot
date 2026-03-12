import { Show } from 'solid-js'

import { Button } from '../components/ui'
import {
  compareTodayToPeriodDay,
  daysUntilPeriodDay,
  formatCyclePeriod,
  formatPeriodDay
} from '../lib/dates'
import { majorStringToMinor, minorToMajorString, sumMajorStrings } from '../lib/money'
import type { MiniAppDashboard } from '../miniapp-api'

type Props = {
  copy: Record<string, string | undefined>
  locale: 'en' | 'ru'
  dashboard: MiniAppDashboard | null
  currentMemberLine: MiniAppDashboard['members'][number] | null
  onExplainBalance: () => void
}

type HomeMode = 'upcoming' | 'due' | 'settled'

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

  const predictedUtilitiesMajor = () => {
    if (!props.currentMemberLine) {
      return null
    }

    return props.currentMemberLine.predictedUtilityShareMajor
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

  const homeMode = (): HomeMode => {
    if (!props.dashboard || !props.currentMemberLine) {
      return 'upcoming'
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
      return 'settled'
    }

    return hasDueNow ? 'due' : 'upcoming'
  }

  const heroState = () => {
    if (!props.dashboard || !props.currentMemberLine) {
      return {
        title: props.copy.payNowTitle ?? props.copy.yourBalanceTitle ?? '',
        label: props.copy.remainingLabel ?? '',
        amountMajor: '—'
      }
    }

    switch (homeMode()) {
      case 'settled':
        return {
          title: props.copy.homeSettledTitle ?? '',
          label: props.copy.paidThisCycleLabel ?? props.copy.paidLabel ?? '',
          amountMajor: props.currentMemberLine.paidMajor
        }
      case 'due':
        return {
          title: props.copy.homeDueTitle ?? props.copy.payNowTitle ?? '',
          label: props.copy.remainingLabel ?? '',
          amountMajor: props.currentMemberLine.remainingMajor
        }
      default:
        return {
          title: props.copy.payNowTitle ?? props.copy.yourBalanceTitle ?? '',
          label: props.copy.cycleTotalLabel ?? props.copy.totalDue ?? '',
          amountMajor: props.currentMemberLine.netDueMajor
        }
    }
  }

  const dayCountLabel = (daysLeft: number | null) => {
    if (daysLeft === null) {
      return null
    }

    if (daysLeft < 0) {
      return props.copy.overdueLabel ?? ''
    }

    if (daysLeft === 0) {
      return props.copy.dueTodayLabel ?? ''
    }

    return (props.copy.daysLeftLabel ?? '').replace('{count}', String(daysLeft))
  }

  const scheduleLabel = (kind: 'rent' | 'utilities') => {
    if (!props.dashboard) {
      return null
    }

    const day = kind === 'rent' ? props.dashboard.rentDueDay : props.dashboard.utilitiesDueDay
    const date = formatPeriodDay(props.dashboard.period, day, props.locale)
    const daysLeft = daysUntilPeriodDay(props.dashboard.period, day, props.dashboard.timezone)
    const dayLabel = dayCountLabel(daysLeft)
    const dueLabel = (props.copy.dueOnLabel ?? '').replace('{date}', date)

    return dayLabel ? `${dueLabel} · ${dayLabel}` : dueLabel
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
                  <div class="home-pay-card__actions">
                    <Button variant="ghost" onClick={props.onExplainBalance}>
                      {props.copy.whyAction ?? ''}
                    </Button>
                  </div>
                  <div class="balance-spotlight__hero">
                    <span>{heroState().label}</span>
                    <strong>
                      {heroState().amountMajor} {dashboard().currency}
                    </strong>
                  </div>
                </header>

                <Show
                  when={homeMode() === 'upcoming'}
                  fallback={
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
                  }
                >
                  <div class="balance-spotlight__stats">
                    <article class="stat-card balance-spotlight__stat">
                      <span>{props.copy.shareRent ?? ''}</span>
                      <strong>{scheduleLabel('rent')}</strong>
                    </article>
                    <article class="stat-card balance-spotlight__stat">
                      <span>{props.copy.shareUtilities ?? ''}</span>
                      <strong>{scheduleLabel('utilities')}</strong>
                    </article>
                  </div>
                </Show>

                <div class="balance-spotlight__rows">
                  <article class="balance-detail-row">
                    <div class="balance-detail-row__main">
                      <span>{props.copy.shareRent ?? ''}</span>
                      <strong>
                        {member().rentShareMajor} {dashboard().currency}
                      </strong>
                      <small>{scheduleLabel('rent')}</small>
                    </div>
                    <Show when={homeMode() !== 'upcoming'}>
                      <span class="mini-chip mini-chip--muted">
                        {props.copy.rentPaidLabel ?? props.copy.paidLabel}: {rentPaidMajor()}{' '}
                        {dashboard().currency}
                      </span>
                    </Show>
                  </article>

                  <article class="balance-detail-row">
                    <div class="balance-detail-row__main">
                      <span>
                        {homeMode() === 'upcoming'
                          ? (props.copy.expectedUtilitiesLabel ?? props.copy.shareUtilities)
                          : (props.copy.pureUtilitiesLabel ?? props.copy.shareUtilities)}
                      </span>
                      <strong>
                        {homeMode() === 'upcoming'
                          ? predictedUtilitiesMajor()
                            ? `${predictedUtilitiesMajor()} ${dashboard().currency}`
                            : (props.copy.notBilledYetLabel ?? '')
                          : utilitiesDueMajor()
                            ? `${member().utilityShareMajor} ${dashboard().currency}`
                            : (props.copy.notBilledYetLabel ?? '')}
                      </strong>
                      <small>{scheduleLabel('utilities')}</small>
                    </div>
                    <Show
                      when={
                        homeMode() !== 'upcoming' || majorStringToMinor(utilitiesPaidMajor()) > 0n
                      }
                    >
                      <span class="mini-chip mini-chip--muted">
                        {props.copy.utilitiesPaidLabel ?? props.copy.paidLabel}:{' '}
                        {utilitiesPaidMajor()} {dashboard().currency}
                      </span>
                    </Show>
                  </article>

                  <article class="balance-detail-row">
                    <div class="balance-detail-row__main">
                      <span>{props.copy.balanceAdjustmentLabel ?? props.copy.shareOffset}</span>
                      <strong>
                        {member().purchaseOffsetMajor} {dashboard().currency}
                      </strong>
                      <small>{props.copy.currentCycleLabel ?? ''}</small>
                    </div>
                  </article>

                  <Show when={dashboard().paymentBalanceAdjustmentPolicy === 'rent'}>
                    <article class="balance-detail-row balance-detail-row--accent">
                      <div class="balance-detail-row__main">
                        <span>{props.copy.rentAdjustedTotalLabel ?? ''}</span>
                        <strong>
                          {adjustedRentMajor()} {dashboard().currency}
                        </strong>
                      </div>
                    </article>
                  </Show>

                  <Show when={dashboard().paymentBalanceAdjustmentPolicy === 'utilities'}>
                    <article class="balance-detail-row balance-detail-row--accent">
                      <div class="balance-detail-row__main">
                        <span>{props.copy.utilitiesAdjustedTotalLabel ?? ''}</span>
                        <strong>
                          {homeMode() === 'upcoming'
                            ? predictedUtilitiesMajor()
                              ? `${sumMajorStrings(
                                  predictedUtilitiesMajor() ?? '0.00',
                                  member().purchaseOffsetMajor
                                )} ${dashboard().currency}`
                              : (props.copy.notBilledYetLabel ?? '')
                            : `${adjustedUtilitiesMajor()} ${dashboard().currency}`}
                        </strong>
                      </div>
                    </article>
                  </Show>

                  <Show when={dashboard().paymentBalanceAdjustmentPolicy === 'separate'}>
                    <article class="balance-detail-row balance-detail-row--accent">
                      <div class="balance-detail-row__main">
                        <span>{props.copy.finalDue ?? props.copy.remainingLabel}</span>
                        <strong>
                          {member().remainingMajor} {dashboard().currency}
                        </strong>
                      </div>
                    </article>
                  </Show>
                </div>
              </article>
            )}
          </Show>
        </div>
      )}
    </Show>
  )
}
