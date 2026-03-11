import { For, Show } from 'solid-js'

import { cn } from '../../lib/cn'
import type { MiniAppDashboard } from '../../miniapp-api'
import { MiniChip, StatCard } from '../ui'

type Props = {
  copy: Record<string, string | undefined>
  dashboard: MiniAppDashboard
  member: MiniAppDashboard['members'][number]
  detail?: boolean
}

function majorStringToMinor(value: string): bigint {
  const trimmed = value.trim()
  const negative = trimmed.startsWith('-')
  const normalized = negative ? trimmed.slice(1) : trimmed
  const [whole = '0', fraction = ''] = normalized.split('.')
  const major = BigInt(whole || '0')
  const cents = BigInt((fraction.padEnd(2, '0').slice(0, 2) || '00').replace(/\D/g, '') || '0')
  const minor = major * 100n + cents

  return negative ? -minor : minor
}

function minorToMajorString(value: bigint): string {
  const negative = value < 0n
  const absolute = negative ? -value : value
  const whole = absolute / 100n
  const fraction = String(absolute % 100n).padStart(2, '0')

  return `${negative ? '-' : ''}${whole.toString()}.${fraction}`
}

function sumMajorStrings(left: string, right: string): string {
  return minorToMajorString(majorStringToMinor(left) + majorStringToMinor(right))
}

export function MemberBalanceCard(props: Props) {
  const utilitiesAdjustedMajor = () =>
    sumMajorStrings(props.member.utilityShareMajor, props.member.purchaseOffsetMajor)

  const adjustmentClass = () => {
    const value = majorStringToMinor(props.member.purchaseOffsetMajor)

    if (value < 0n) {
      return 'is-credit'
    }

    if (value > 0n) {
      return 'is-due'
    }

    return 'is-settled'
  }

  return (
    <article
      class={cn(
        'balance-item',
        'balance-item--accent',
        'balance-spotlight',
        props.detail && 'balance-spotlight--detail'
      )}
    >
      <header class="balance-spotlight__header">
        <div class="balance-spotlight__copy">
          <strong>{props.copy.yourBalanceTitle ?? ''}</strong>
          <p>{props.copy.yourBalanceBody ?? ''}</p>
        </div>
        <div class="balance-spotlight__hero">
          <span>{props.copy.remainingLabel ?? ''}</span>
          <strong>
            {props.member.remainingMajor} {props.dashboard.currency}
          </strong>
          <small>
            {props.copy.totalDue ?? ''}: {props.member.netDueMajor} {props.dashboard.currency}
          </small>
        </div>
      </header>

      <div class="balance-spotlight__stats">
        <StatCard class="balance-spotlight__stat">
          <span>{props.copy.totalDue ?? ''}</span>
          <strong>
            {props.member.netDueMajor} {props.dashboard.currency}
          </strong>
        </StatCard>
        <StatCard class="balance-spotlight__stat">
          <span>{props.copy.paidLabel ?? ''}</span>
          <strong>
            {props.member.paidMajor} {props.dashboard.currency}
          </strong>
        </StatCard>
        <StatCard class="balance-spotlight__stat">
          <span>{props.copy.remainingLabel ?? ''}</span>
          <strong>
            {props.member.remainingMajor} {props.dashboard.currency}
          </strong>
        </StatCard>
      </div>

      <div class="balance-spotlight__rows">
        <article class="balance-detail-row">
          <div class="balance-detail-row__main">
            <span>{props.copy.shareRent ?? ''}</span>
            <strong>
              {props.member.rentShareMajor} {props.dashboard.currency}
            </strong>
          </div>
        </article>

        <article class="balance-detail-row">
          <div class="balance-detail-row__main">
            <span>{props.copy.pureUtilitiesLabel ?? props.copy.shareUtilities ?? ''}</span>
            <strong>
              {props.member.utilityShareMajor} {props.dashboard.currency}
            </strong>
          </div>
        </article>

        <article class="balance-detail-row">
          <div class="balance-detail-row__main">
            <span>{props.copy.balanceAdjustmentLabel ?? props.copy.shareOffset ?? ''}</span>
            <strong class={`balance-status ${adjustmentClass()}`}>
              {props.member.purchaseOffsetMajor} {props.dashboard.currency}
            </strong>
          </div>
        </article>

        <Show when={props.dashboard.paymentBalanceAdjustmentPolicy === 'utilities'}>
          <article class="balance-detail-row balance-detail-row--accent">
            <div class="balance-detail-row__main">
              <span>{props.copy.utilitiesAdjustedTotalLabel ?? ''}</span>
              <strong>
                {utilitiesAdjustedMajor()} {props.dashboard.currency}
              </strong>
            </div>
          </article>
        </Show>
      </div>

      <Show when={props.dashboard.rentSourceCurrency !== props.dashboard.currency}>
        <section class="fx-panel">
          <header class="fx-panel__header">
            <strong>{props.copy.rentFxTitle ?? ''}</strong>
            <Show when={props.dashboard.rentFxEffectiveDate}>
              {(date) => (
                <MiniChip muted>
                  {props.copy.fxEffectiveDateLabel ?? ''}: {date()}
                </MiniChip>
              )}
            </Show>
          </header>

          <div class="fx-panel__grid">
            <article class="fx-panel__cell">
              <span>{props.copy.sourceAmountLabel ?? ''}</span>
              <strong>
                {props.dashboard.rentSourceAmountMajor} {props.dashboard.rentSourceCurrency}
              </strong>
            </article>
            <article class="fx-panel__cell">
              <span>{props.copy.settlementAmountLabel ?? ''}</span>
              <strong>
                {props.dashboard.rentDisplayAmountMajor} {props.dashboard.currency}
              </strong>
            </article>
          </div>
        </section>
      </Show>

      <Show when={props.detail && props.member.explanations.length > 0}>
        <div class="balance-spotlight__meta">
          <For each={props.member.explanations}>
            {(explanation) => <MiniChip muted>{explanation}</MiniChip>}
          </For>
        </div>
      </Show>
    </article>
  )
}
