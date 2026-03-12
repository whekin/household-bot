import { Show } from 'solid-js'

import { FinanceSummaryCards } from '../components/finance/finance-summary-cards'
import { FinanceVisuals } from '../components/finance/finance-visuals'
import { MemberBalanceCard } from '../components/finance/member-balance-card'
import { Field } from '../components/ui'
import { formatCyclePeriod } from '../lib/dates'
import type { MiniAppDashboard } from '../miniapp-api'

type Props = {
  copy: Record<string, string | undefined>
  locale: 'en' | 'ru'
  dashboard: MiniAppDashboard | null
  currentMemberLine: MiniAppDashboard['members'][number] | null
  inspectedMember: MiniAppDashboard['members'][number] | null
  selectedMemberId: string
  utilityTotalMajor: string
  purchaseTotalMajor: string
  memberBalanceVisuals: {
    member: MiniAppDashboard['members'][number]
    totalMinor: bigint
    barWidthPercent: number
    segments: {
      key: string
      label: string
      amountMajor: string
      amountMinor: bigint
      widthPercent: number
    }[]
  }[]
  purchaseChart: {
    totalMajor: string
    slices: {
      key: string
      label: string
      amountMajor: string
      color: string
      percentage: number
      dasharray: string
      dashoffset: string
    }[]
  }
  memberBaseDueMajor: (member: MiniAppDashboard['members'][number]) => string
  memberRemainingClass: (member: MiniAppDashboard['members'][number]) => string
  onSelectedMemberChange: (memberId: string) => void
}

export function BalancesScreen(props: Props) {
  return (
    <Show
      when={props.dashboard}
      fallback={
        <div class="balance-list">
          <p>{props.copy.emptyDashboard ?? ''}</p>
        </div>
      }
    >
      {(dashboard) => (
        <div class="balance-list">
          <Show when={props.currentMemberLine}>
            {(member) => (
              <MemberBalanceCard
                copy={props.copy}
                locale={props.locale}
                dashboard={dashboard()}
                member={member()}
                detail
              />
            )}
          </Show>

          <section class="balance-item balance-item--wide balance-section balance-section--secondary">
            <header class="balance-section__header">
              <div class="balance-section__copy">
                <strong>{props.copy.inspectMemberTitle ?? ''}</strong>
                <p>{props.copy.inspectMemberBody ?? ''}</p>
              </div>
              <Field label={props.copy.inspectMemberLabel ?? ''} class="balance-section__field">
                <select
                  value={props.selectedMemberId}
                  onChange={(event) => props.onSelectedMemberChange(event.currentTarget.value)}
                >
                  {dashboard().members.map((member) => (
                    <option value={member.memberId}>{member.displayName}</option>
                  ))}
                </select>
              </Field>
            </header>

            <Show when={props.inspectedMember}>
              {(member) => (
                <article class="balance-detail-card">
                  <header class="balance-detail-card__header">
                    <div class="balance-detail-card__copy">
                      <strong>{member().displayName}</strong>
                      <small>{formatCyclePeriod(dashboard().period, props.locale)}</small>
                    </div>
                    <span class={`balance-status ${props.memberRemainingClass(member())}`}>
                      {member().remainingMajor} {dashboard().currency}
                    </span>
                  </header>

                  <div class="balance-detail-card__rows">
                    <article class="balance-detail-row">
                      <div class="balance-detail-row__main">
                        <span>{props.copy.baseDue ?? ''}</span>
                        <strong>
                          {props.memberBaseDueMajor(member())} {dashboard().currency}
                        </strong>
                      </div>
                    </article>
                    <article class="balance-detail-row">
                      <div class="balance-detail-row__main">
                        <span>{props.copy.shareRent ?? ''}</span>
                        <strong>
                          {member().rentShareMajor} {dashboard().currency}
                        </strong>
                      </div>
                    </article>
                    <article class="balance-detail-row">
                      <div class="balance-detail-row__main">
                        <span>{props.copy.shareUtilities ?? ''}</span>
                        <strong>
                          {member().utilityShareMajor} {dashboard().currency}
                        </strong>
                      </div>
                    </article>
                    <article class="balance-detail-row">
                      <div class="balance-detail-row__main">
                        <span>{props.copy.shareOffset ?? ''}</span>
                        <strong>
                          {member().purchaseOffsetMajor} {dashboard().currency}
                        </strong>
                      </div>
                    </article>
                    <article class="balance-detail-row">
                      <div class="balance-detail-row__main">
                        <span>{props.copy.paidLabel ?? ''}</span>
                        <strong>
                          {member().paidMajor} {dashboard().currency}
                        </strong>
                      </div>
                    </article>
                    <article class="balance-detail-row balance-detail-row--accent">
                      <div class="balance-detail-row__main">
                        <span>{props.copy.remainingLabel ?? ''}</span>
                        <strong>
                          {member().remainingMajor} {dashboard().currency}
                        </strong>
                      </div>
                    </article>
                  </div>
                </article>
              )}
            </Show>
          </section>

          <FinanceVisuals
            dashboard={dashboard()}
            memberVisuals={props.memberBalanceVisuals}
            purchaseChart={props.purchaseChart}
            remainingClass={props.memberRemainingClass}
            labels={{
              financeVisualsTitle: props.copy.financeVisualsTitle ?? '',
              financeVisualsBody: props.copy.financeVisualsBody ?? '',
              membersCount: props.copy.membersCount ?? '',
              purchaseInvestmentsTitle: props.copy.purchaseInvestmentsTitle ?? '',
              purchaseInvestmentsBody: props.copy.purchaseInvestmentsBody ?? '',
              purchaseInvestmentsEmpty: props.copy.purchaseInvestmentsEmpty ?? '',
              purchaseTotalLabel: props.copy.purchaseTotalLabel ?? '',
              purchaseShareLabel: props.copy.purchaseShareLabel ?? ''
            }}
          />

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
