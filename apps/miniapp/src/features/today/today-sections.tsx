import { For, Show, createMemo, createSignal, createUniqueId } from 'solid-js'
import {
  Check,
  ChevronDown,
  CircleDollarSign,
  Copy,
  ExternalLink,
  Plus,
  ReceiptText,
  Sparkles
} from 'lucide-solid'

import { Button } from '../../components/ui/button'
import { Modal } from '../../components/ui/dialog'
import { formatCyclePeriod, formatFriendlyDate } from '../../lib/dates'
import {
  formatAbsoluteMoneyLabel,
  formatMoneyLabel,
  semanticMoneyTone
} from '../../lib/ledger-helpers'
import { majorStringToMinor, minorToMajorString } from '../../lib/money'
import type { Locale } from '../../i18n'
import type { useI18n } from '../../contexts/i18n-context'
import type { MiniAppDashboard } from '../../miniapp-api'
import {
  initialsForName,
  purchaseShareForMember,
  type TodayMemberCloseLine,
  type TodayViewModel
} from './today-view-model'
import {
  rentPaymentAccountTail,
  rentPaymentDestinationCopyText,
  rentPaymentDestinationMeta,
  type RentPaymentDestination
} from './rent-payment-destination'

type Copy = ReturnType<typeof useI18n>['copy']

function stageRailState(
  model: TodayViewModel,
  segment: TodayViewModel['timelineSegments'][number]
): 'active' | 'carried' | 'inactive' {
  if (model.currentTimelineSegmentKey === segment.key) {
    return 'active'
  }

  if (model.stage !== 'idle' && model.stage === segment.kind) {
    return 'carried'
  }

  return 'inactive'
}

function stageLabel(
  kind: TodayViewModel['timelineSegments'][number]['kind'],
  copy: ReturnType<Copy>
): string {
  if (kind === 'utilities') return copy.todayUtilitiesStage
  if (kind === 'rent') return copy.todayRentStage
  return copy.todayIdleStage
}

function purchasePositionLabel(amountMajor: string, copy: ReturnType<Copy>): string {
  const tone = semanticMoneyTone(amountMajor)

  if (tone === 'is-credit') return copy.todayPurchasePositionCredit
  if (tone === 'is-debit') return copy.todayPurchasePositionDebit
  return copy.todayPurchasePositionEven
}

function CopyIconButton(props: {
  label: string
  copied: boolean
  compact?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      class="rent-payment-dock__copy"
      classList={{
        'rent-payment-dock__copy--compact': props.compact === true,
        'is-copied': props.copied
      }}
      aria-label={props.label}
      onClick={props.onClick}
    >
      <Show when={props.copied} fallback={<Copy size={15} />}>
        <Check size={15} />
      </Show>
    </button>
  )
}

function RentPaymentDock(props: {
  destinations: readonly RentPaymentDestination[]
  copiedKey: string | null
  copy: Copy
  onCopy: (input: { key: string; text: string; successMessage: string }) => void
}) {
  const [expanded, setExpanded] = createSignal(false)
  const detailsId = createUniqueId()
  const primary = () => props.destinations[0] ?? null

  const copyAccount = (destination: RentPaymentDestination, index: number) => {
    props.onCopy({
      key: `rent:${index}:account`,
      text: destination.account,
      successMessage: props.copy().rentPaymentAccountCopied
    })
  }

  const copyDetails = (destination: RentPaymentDestination, index: number) => {
    props.onCopy({
      key: `rent:${index}:details`,
      text: rentPaymentDestinationCopyText(destination),
      successMessage: props.copy().rentPaymentDetailsCopied
    })
  }

  return (
    <aside class="rent-payment-dock" aria-label={props.copy().rentPaymentDetailsTitle}>
      <Show when={primary()}>
        {(destination) => (
          <div class="rent-payment-dock__summary">
            <div class="rent-payment-dock__summary-copy">
              <span>{props.copy().rentPaymentDetailsTitle}</span>
              <strong>{destination().label}</strong>
              <em>{rentPaymentAccountTail(destination().account)}</em>
            </div>

            <div class="rent-payment-dock__summary-actions">
              <CopyIconButton
                compact
                label={props.copy().rentPaymentCopyAccount}
                copied={props.copiedKey === 'rent:0:account'}
                onClick={() => copyAccount(destination(), 0)}
              />
              <button
                type="button"
                class="rent-payment-dock__toggle"
                aria-expanded={expanded()}
                aria-controls={detailsId}
                onClick={() => setExpanded((value) => !value)}
              >
                <span>
                  {expanded()
                    ? props.copy().rentPaymentHideDetails
                    : props.copy().rentPaymentShowDetails}
                </span>
                <ChevronDown size={15} aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
      </Show>

      <Show when={expanded()}>
        <div id={detailsId} class="rent-payment-dock__details">
          <For each={props.destinations}>
            {(destination, index) => {
              const meta = () => rentPaymentDestinationMeta(destination)
              const accountKey = () => `rent:${index()}:account`
              const detailsKey = () => `rent:${index()}:details`

              return (
                <article class="rent-payment-dock__card">
                  <div class="rent-payment-dock__card-head">
                    <div>
                      <strong>{destination.label}</strong>
                      <Show when={meta()}>{(value) => <span>{value()}</span>}</Show>
                    </div>
                    <Show when={destination.link}>
                      {(link) => (
                        <a
                          class="rent-payment-dock__link"
                          href={link()}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={props.copy().rentPaymentOpenLink}
                        >
                          <ExternalLink size={15} />
                        </a>
                      )}
                    </Show>
                  </div>

                  <div class="rent-payment-dock__account">
                    <code>{destination.account}</code>
                    <CopyIconButton
                      label={props.copy().rentPaymentCopyAccount}
                      copied={props.copiedKey === accountKey()}
                      onClick={() => copyAccount(destination, index())}
                    />
                  </div>

                  <Show when={destination.note}>{(note) => <p>{note()}</p>}</Show>

                  <button
                    type="button"
                    class="rent-payment-dock__copy-all"
                    classList={{ 'is-copied': props.copiedKey === detailsKey() }}
                    onClick={() => copyDetails(destination, index())}
                  >
                    <Show when={props.copiedKey === detailsKey()} fallback={<Copy size={14} />}>
                      <Check size={14} />
                    </Show>
                    {props.copy().rentPaymentCopyDetails}
                  </button>
                </article>
              )
            }}
          </For>
        </div>
      </Show>
    </aside>
  )
}

export function CurrentPeriodPanel(props: {
  model: TodayViewModel
  currentMemberLine: TodayMemberCloseLine | null
  currency: MiniAppDashboard['currency']
  locale: Locale
  copy: Copy
  canCloseMine: boolean
  closing: boolean
  copiedRentPaymentKey: string | null
  onCloseMine: () => void
  onOpenPurchases: () => void
  onCopyRentPaymentText: (input: { key: string; text: string; successMessage: string }) => void
}) {
  const copy = () => props.copy()
  const myRemainingMinor = createMemo(() =>
    majorStringToMinor(props.currentMemberLine?.amountMajor ?? '0.00')
  )
  const focusAmountMajor = () =>
    props.model.stage !== 'idle' && myRemainingMinor() > 0n
      ? (props.currentMemberLine?.amountMajor ?? '0.00')
      : props.model.purchaseBalanceMajor
  const focusLabel = () =>
    props.model.stage !== 'idle' && myRemainingMinor() > 0n
      ? copy().todayYourCheck
      : props.model.stage === 'idle'
        ? copy().todayPurchaseBalance
        : copy().todayHouseStillOpen
  const stageTitle = () =>
    props.model.stage === 'utilities'
      ? copy().todayUtilitiesStage
      : props.model.stage === 'rent'
        ? copy().todayRentStage
        : copy().todayIdleStage
  const stageBody = () =>
    props.model.stage === 'utilities'
      ? copy().todayUtilitiesBody
      : props.model.stage === 'rent'
        ? copy().todayRentBody
        : copy().todayIdleBody
  const nextWindowTitle = () =>
    props.model.nextWindow?.kind === 'utilities'
      ? copy().todayNextWindowUtilities
      : props.model.nextWindow?.kind === 'rent'
        ? copy().todayNextWindowRent
        : null

  return (
    <section class="today-command" data-locale={props.locale} data-stage={props.model.stage}>
      <div class="today-command__grain" aria-hidden="true" />

      <header class="today-command__header">
        <div class="today-command__eyebrow-row">
          <p class="today-kicker">{formatCyclePeriod(props.model.period, props.locale)}</p>
          <Show when={props.model.isExtendedPeriod}>
            <span class="today-flag">{copy().todayExtendedPeriod}</span>
          </Show>
        </div>

        <div class="today-stage-rail" aria-label={copy().todayProgressLabel}>
          <For each={props.model.timelineSegments}>
            {(segment) => (
              <div
                data-state={stageRailState(props.model, segment)}
                style={{ '--segment-span': String(segment.renderSpanDays) }}
              >
                <span />
                <strong>{stageLabel(segment.kind, copy())}</strong>
                <em>{segment.label}</em>
              </div>
            )}
          </For>
        </div>
      </header>

      <div class="today-command__statement">
        <span>{focusLabel()}</span>
        <strong>{formatMoneyLabel(focusAmountMajor(), props.currency, props.locale)}</strong>
        <h1>{stageTitle()}</h1>
        <p>{stageBody()}</p>
      </div>

      <div class="today-personal-lines">
        <Show
          when={
            props.model.stage === 'utilities' && props.model.currentMemberUtilityLines.length > 0
          }
        >
          <div class="today-personal-lines__group">
            <span>{copy().todayPersonalLinesTitle}</span>
            <div class="today-personal-lines__list">
              <For each={props.model.currentMemberUtilityLines}>
                {(line) => (
                  <div class="today-personal-line">
                    <strong>{line.billName}</strong>
                    <span>{formatMoneyLabel(line.amountMajor, props.currency, props.locale)}</span>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>

        <Show when={props.model.stage === 'rent' && props.currentMemberLine}>
          <div class="today-personal-lines__group">
            <span>{copy().todayPersonalLinesTitle}</span>
            <div class="today-personal-lines__list">
              <div class="today-personal-line">
                <strong>{copy().todayRentDueLabel}</strong>
                <span>
                  {formatMoneyLabel(
                    props.currentMemberLine!.amountMajor,
                    props.currency,
                    props.locale
                  )}
                </span>
              </div>
              <Show when={props.model.currentMemberRentDueDate}>
                {(dueDate) => (
                  <div class="today-personal-line today-personal-line--muted">
                    <strong>{copy().dueOnLabel.replace('{date}', '').trim()}</strong>
                    <span>{formatFriendlyDate(dueDate(), props.locale)}</span>
                  </div>
                )}
              </Show>
            </div>
          </div>
        </Show>

        <Show when={props.model.stage === 'rent' && props.model.rentPaymentDestinations.length > 0}>
          <RentPaymentDock
            destinations={props.model.rentPaymentDestinations}
            copiedKey={props.copiedRentPaymentKey}
            copy={props.copy}
            onCopy={props.onCopyRentPaymentText}
          />
        </Show>

        <Show when={props.model.stage === 'idle' && props.model.nextWindow && nextWindowTitle()}>
          <div class="today-personal-lines__group">
            <span>{copy().todayNextWindowLabel}</span>
            <div class="today-personal-lines__list">
              <div class="today-personal-line">
                <strong>{nextWindowTitle()!}</strong>
                <span>{props.model.nextWindow!.rangeLabel}</span>
              </div>
            </div>
          </div>
        </Show>
      </div>

      <div class="today-command__actions">
        <Show
          when={props.model.stage !== 'idle'}
          fallback={
            <Button
              variant="secondary"
              size="sm"
              class="today-command__idle-link"
              onClick={props.onOpenPurchases}
            >
              <ExternalLink size={16} />
              {copy().todayOpenPurchases}
            </Button>
          }
        >
          <Button
            variant="primary"
            size="lg"
            onClick={props.onCloseMine}
            loading={props.closing}
            disabled={!props.canCloseMine || myRemainingMinor() <= 0n}
          >
            <Check size={16} />
            {props.model.stage === 'utilities'
              ? copy().todayCloseMyUtilities
              : copy().todayCloseMyRent}
          </Button>
        </Show>

        <Show when={props.model.stage !== 'idle'}>
          <div class="today-command__subactions">
            <Button variant="secondary" onClick={props.onOpenPurchases}>
              <ExternalLink size={15} />
              {copy().todayOpenPurchases}
            </Button>
          </div>
        </Show>
      </div>
    </section>
  )
}

export function HouseholdSummaryPanel(props: {
  model: TodayViewModel
  currency: MiniAppDashboard['currency']
  locale: Locale
  copy: Copy
}) {
  return (
    <section class="today-section today-section--house">
      <div class="today-section__header">
        <div class="today-section__copy">
          <span class="today-line-heading">{props.copy().todayCurrentPeriod}</span>
          <strong>{props.copy().todayHouseSummaryTitle}</strong>
          <p>{props.copy().todayHouseSummaryBody}</p>
        </div>
      </div>

      <div class="today-house-grid">
        <article>
          <span>{props.copy().todayHouseRemainingLabel}</span>
          <strong>
            {formatMoneyLabel(props.model.remainingMajor, props.currency, props.locale)}
          </strong>
        </article>
        <article>
          <span>{props.copy().todayHouseOpenLabel}</span>
          <strong>{props.model.openMemberCount}</strong>
        </article>
      </div>

      <div class="today-meter" aria-hidden="true">
        <span style={{ width: `${props.model.progressPercent}%` }} />
      </div>
    </section>
  )
}

export function AdminClosePanel(props: {
  model: TodayViewModel
  currency: MiniAppDashboard['currency']
  locale: Locale
  copy: Copy
  loading: boolean
  onOpenAdminClose: () => void
}) {
  return (
    <section class="today-section today-section--admin">
      <div class="today-section__header">
        <div class="today-section__copy">
          <span class="today-line-heading">{props.copy().adminTag}</span>
          <strong>{props.copy().todayAdminToolsTitle}</strong>
          <p>{props.copy().todayAdminToolsBody}</p>
        </div>
      </div>

      <button
        class="today-admin-ribbon"
        type="button"
        disabled={props.loading}
        onClick={props.onOpenAdminClose}
      >
        <span>
          <CircleDollarSign size={17} />
          {props.copy().todayAdminCloseAll}
        </span>
        <strong>
          {formatMoneyLabel(props.model.remainingMajor, props.currency, props.locale)}
        </strong>
      </button>
    </section>
  )
}

export function PurchaseStream(props: {
  entries: MiniAppDashboard['ledger']
  members: MiniAppDashboard['members']
  currentMemberId: string | null
  currency: MiniAppDashboard['currency']
  balanceMajor: string
  totalMajor: string
  unresolvedCount: number
  canAddPurchase: boolean
  locale: Locale
  copy: Copy
  onAddPurchase: () => void
}) {
  const positions = createMemo(() =>
    props.members
      .filter((member) => member.status !== 'left')
      .map((member) => ({
        memberId: member.memberId,
        displayName: member.displayName,
        amountMajor: member.effectivePurchaseBalanceMajor ?? member.purchaseOffsetMajor
      }))
      .sort(
        (left, right) =>
          Number(
            majorStringToMinor(right.amountMajor) < 0n
              ? -majorStringToMinor(right.amountMajor)
              : majorStringToMinor(right.amountMajor)
          ) -
          Number(
            majorStringToMinor(left.amountMajor) < 0n
              ? -majorStringToMinor(left.amountMajor)
              : majorStringToMinor(left.amountMajor)
          )
      )
  )
  const maxPositionMinor = createMemo(
    () =>
      positions().reduce((max, entry) => {
        const value = majorStringToMinor(entry.amountMajor)
        const absolute = value < 0n ? -value : value
        return absolute > max ? absolute : max
      }, 0n) || 1n
  )
  const balanceTone = () => semanticMoneyTone(props.balanceMajor)

  return (
    <section class="today-section today-section--purchases">
      <div class="today-section__header">
        <div class="today-section__copy">
          <span class="today-line-heading">
            <ReceiptText size={16} />
            {props.copy().purchasesTitle}
          </span>
          <strong>{props.copy().todayPurchaseCommandTitle}</strong>
          <p>{props.copy().todayPurchaseCommandBody}</p>
        </div>

        <Show when={props.canAddPurchase}>
          <div class="today-section__actions">
            <Button variant="primary" size="sm" onClick={props.onAddPurchase}>
              <Plus size={15} />
              {props.copy().todayAddPurchase}
            </Button>
          </div>
        </Show>
      </div>

      <div class="today-ledger-snapshot">
        <div class="today-ledger-snapshot__balance" data-tone={balanceTone()}>
          <span>{props.copy().todayPurchaseBalance}</span>
          <strong>{formatMoneyLabel(props.balanceMajor, props.currency, props.locale)}</strong>
          <p>
            {balanceTone() === 'is-credit'
              ? props.copy().todayPurchaseCredit
              : balanceTone() === 'is-debit'
                ? props.copy().todayPurchaseDebit
                : props.copy().todayPurchaseEven}
          </p>
        </div>

        <div class="today-ledger-snapshot__stats">
          <article>
            <span>{props.copy().todayOpenPurchasesLabel}</span>
            <strong>{props.unresolvedCount}</strong>
          </article>
          <article>
            <span>{props.copy().todayPurchaseVolumeLabel}</span>
            <strong>{formatMoneyLabel(props.totalMajor, props.currency, props.locale)}</strong>
          </article>
        </div>
      </div>

      <div class="today-line-list">
        <Show
          when={props.entries.length > 0}
          fallback={<p class="empty-state">{props.copy().todayPurchasesEmpty}</p>}
        >
          <For each={props.entries.slice(0, 4)}>
            {(entry) => {
              const share = () =>
                props.currentMemberId ? purchaseShareForMember(entry, props.currentMemberId) : null
              return (
                <article
                  class="today-purchase-line"
                  data-status={entry.resolutionStatus ?? 'resolved'}
                >
                  <div class="today-purchase-line__copy">
                    <strong>{entry.title}</strong>
                    <span>
                      {[
                        entry.actorDisplayName,
                        entry.occurredAt ? formatFriendlyDate(entry.occurredAt, props.locale) : null
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </div>
                  <div class="today-purchase-line__amounts">
                    <strong>
                      {formatMoneyLabel(
                        entry.displayAmountMajor,
                        entry.displayCurrency,
                        props.locale
                      )}
                    </strong>
                    <Show when={share()}>
                      {(value) => (
                        <span>
                          {props.copy().todayMyShare}{' '}
                          {formatMoneyLabel(value(), entry.displayCurrency, props.locale)}
                        </span>
                      )}
                    </Show>
                  </div>
                </article>
              )
            }}
          </For>
        </Show>
      </div>

      <div class="today-balance-chart">
        <div class="today-balance-chart__header">
          <span>{props.copy().todayPurchaseChartLabel}</span>
          <strong>{props.copy().todayPurchaseChartValueLabel}</strong>
        </div>

        <div class="today-balance-chart__list">
          <For each={positions()}>
            {(entry) => {
              const tone = semanticMoneyTone(entry.amountMajor)
              const absolute = majorStringToMinor(entry.amountMajor)
              const ratio =
                Number((absolute < 0n ? -absolute : absolute) * 100n) / Number(maxPositionMinor())

              return (
                <div class="today-balance-chart__row" data-tone={tone}>
                  <div class="today-balance-chart__copy">
                    <strong>{entry.displayName}</strong>
                    <span>{purchasePositionLabel(entry.amountMajor, props.copy())}</span>
                  </div>
                  <div class="today-balance-chart__bar">
                    <i style={{ width: `${Math.max(8, ratio)}%` }} />
                  </div>
                  <strong>
                    {formatAbsoluteMoneyLabel(entry.amountMajor, props.currency, props.locale)}
                  </strong>
                </div>
              )
            }}
          </For>
        </div>
      </div>
    </section>
  )
}

export function MemberCloseList(props: {
  model: TodayViewModel
  currency: MiniAppDashboard['currency']
  locale: Locale
  copy: Copy
  isAdmin: boolean
  currentMemberId: string | null
  onSelectMember: (member: TodayMemberCloseLine) => void
}) {
  const orderedLines = createMemo(() =>
    [...props.model.memberLines].sort((left, right) => {
      if (left.isCurrent !== right.isCurrent) return left.isCurrent ? -1 : 1
      if (left.settled !== right.settled) return left.settled ? 1 : -1
      return left.displayName.localeCompare(right.displayName)
    })
  )

  return (
    <section class="today-section today-section--checks">
      <div class="today-section__header">
        <div class="today-section__copy">
          <span class="today-line-heading">{props.copy().todayCurrentPeriod}</span>
          <strong>{props.copy().todayOpenChecksTitle}</strong>
          <p>{props.copy().todayOpenChecksBody}</p>
        </div>
        <div class="today-section__total">
          <span>{props.copy().todayOpenChecks}</span>
          <strong>{props.model.openMemberCount}</strong>
        </div>
      </div>

      <Show
        when={props.model.stage !== 'idle'}
        fallback={
          <div class="today-quiet-panel">
            <span class="today-quiet-panel__orb">
              <Sparkles size={18} />
            </span>
            <div>
              <strong>{props.copy().todayIdleStage}</strong>
              <p>{props.copy().todayQuietPanel}</p>
            </div>
          </div>
        }
      >
        <div class="today-line-list">
          <For each={orderedLines()}>
            {(line) => {
              const canClose = props.isAdmin || line.memberId === props.currentMemberId
              return (
                <button
                  type="button"
                  class="today-member-line"
                  classList={{ 'is-settled': line.settled, 'is-current': line.isCurrent }}
                  disabled={!canClose || line.settled}
                  onClick={() => props.onSelectMember(line)}
                >
                  <span class="today-member-line__avatar">{initialsForName(line.displayName)}</span>
                  <span class="today-member-line__copy">
                    <span class="today-member-line__title">
                      <strong>{line.displayName}</strong>
                      <Show when={line.isCurrent}>
                        <i>{props.copy().todayYouLabel}</i>
                      </Show>
                    </span>
                    <span>
                      {line.settled
                        ? props.copy().todayDone
                        : canClose
                          ? props.copy().todayTapToClose
                          : props.copy().todayWaitingForMember}
                    </span>
                  </span>
                  <span class="today-member-line__meta">
                    <strong>
                      {line.settled
                        ? props.copy().todayDone
                        : formatMoneyLabel(line.amountMajor, props.currency, props.locale)}
                    </strong>
                  </span>
                </button>
              )
            }}
          </For>
        </div>
      </Show>
    </section>
  )
}

export function AdminCloseConfirmDialog(props: {
  open: boolean
  model: TodayViewModel
  currency: MiniAppDashboard['currency']
  locale: Locale
  copy: Copy
  loading: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  const candidates = () => props.model.memberLines.filter((line) => !line.settled)
  const totalAmountMajor = () =>
    minorToMajorString(
      candidates().reduce((sum, line) => sum + majorStringToMinor(line.amountMajor), 0n)
    )

  return (
    <Modal
      open={props.open}
      title={props.copy().todayAdminConfirmTitle}
      description={props.copy().todayAdminConfirmBody}
      closeLabel={props.copy().closeEditorAction}
      onClose={props.onClose}
      footer={
        <>
          <Button variant="ghost" onClick={props.onClose}>
            {props.copy().closeEditorAction}
          </Button>
          <Button
            variant="primary"
            loading={props.loading}
            disabled={candidates().length === 0}
            onClick={props.onConfirm}
          >
            {props.copy().todayAdminConfirmAction}
          </Button>
        </>
      }
    >
      <div class="today-confirm-summary">
        <span>{props.copy().todayAdminCloseAll}</span>
        <strong>
          {`${candidates().length} · ${formatMoneyLabel(totalAmountMajor(), props.currency, props.locale)}`}
        </strong>
      </div>

      <div class="today-confirm-list">
        <For each={candidates()}>
          {(line) => (
            <div class="today-confirm-line">
              <span>{line.displayName}</span>
              <strong>{formatMoneyLabel(line.amountMajor, props.currency, props.locale)}</strong>
            </div>
          )}
        </For>
      </div>
    </Modal>
  )
}
