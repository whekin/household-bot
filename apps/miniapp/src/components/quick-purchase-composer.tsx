import { ChevronDown, ChevronUp } from 'lucide-solid'
import { For, Show, createEffect, createMemo, createSignal, type Accessor } from 'solid-js'

import { dictionary } from '../i18n'
import {
  applyQuickPurchasePreset,
  buildQuickPurchasePreview,
  type QuickPurchasePreviewMember,
  type QuickPurchasePreset
} from '../lib/purchase-draft'
import { formatMoneyLabel, semanticMoneyTone, type PurchaseDraft } from '../lib/ledger-helpers'
import { todayCalendarInputValue, formatFriendlyDate } from '../lib/dates'
import type { MiniAppDashboard } from '../miniapp-api'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { DatePickerField } from './ui/date-picker'
import { Field } from './ui/field'
import { Input } from './ui/input'
import { Select } from './ui/select'

type QuickPurchaseComposerProps = {
  draft: Accessor<PurchaseDraft>
  setDraft: (updater: (draft: PurchaseDraft) => PurchaseDraft) => void
  activeMembers: Accessor<readonly QuickPurchasePreviewMember[]>
  currentMemberId: Accessor<string | null>
  currency: Accessor<MiniAppDashboard['currency']>
  copy: Accessor<(typeof dictionary)['en']>
  locale: Accessor<'en' | 'ru'>
  error: Accessor<string | null>
  submitting: Accessor<boolean>
  submitLabel: Accessor<string>
  onSubmit: () => void
  onCancel?: () => void
  cancelLabel?: string
  onSecondaryAction?: () => void
  secondaryActionLabel?: string
  resetKey: Accessor<string | number>
  datePickerPortal?: boolean
}

export function QuickPurchaseComposer(props: QuickPurchaseComposerProps) {
  const [preset, setPreset] = createSignal<QuickPurchasePreset>('everyone')
  const [advanced, setAdvanced] = createSignal(false)

  createEffect(() => {
    props.resetKey()
    setPreset('everyone')
    setAdvanced(false)
  })

  const memberNames = createMemo(
    () => new Map(props.activeMembers().map((member) => [member.memberId, member.displayName]))
  )
  const includedParticipants = createMemo(() =>
    props.draft().participants.filter((participant) => participant.included)
  )
  const audienceLabel = createMemo(() => {
    if (preset() === 'everyone') {
      return props.copy().quickPurchaseSplitEveryone
    }

    const count = includedParticipants().length
    if (props.locale() === 'ru') {
      return count === 1 ? '1 участник' : `${count} участников`
    }
    return count === 1 ? '1 person' : `${count} participants`
  })
  const payerLabel = createMemo(() => {
    const payerMemberId = props.draft().payerMemberId
    if (!payerMemberId) {
      return memberNames().get(props.currentMemberId() ?? '') ?? '—'
    }

    return memberNames().get(payerMemberId) ?? '—'
  })
  const previewRows = createMemo(() =>
    buildQuickPurchasePreview(props.draft(), props.activeMembers())
  )

  function handlePresetChange(nextPreset: QuickPurchasePreset) {
    setPreset(nextPreset)
    props.setDraft((draft) => applyQuickPurchasePreset(draft, nextPreset, props.currentMemberId()))
  }

  function toggleParticipant(memberId: string) {
    setPreset('custom')
    props.setDraft((draft) => {
      const isIncluded = draft.participants.some(
        (participant) => participant.memberId === memberId && participant.included
      )

      if (
        isIncluded &&
        draft.participants.filter((participant) => participant.included).length <= 1
      ) {
        return draft
      }

      return {
        ...draft,
        participants: draft.participants.map((participant) =>
          participant.memberId === memberId
            ? {
                ...participant,
                included: !participant.included,
                shareAmountMajor: '',
                sharePercentage: ''
              }
            : participant
        )
      }
    })
  }

  return (
    <div class="quick-purchase-sheet">
      <article class="quick-purchase-sheet__hero">
        <div class="quick-purchase-sheet__hero-copy">
          <span class="eyebrow">{props.copy().purchaseAddAction}</span>
          <strong>{props.copy().quickPurchaseHeroTitle}</strong>
          <p>{props.copy().quickPurchaseHeroBody}</p>
        </div>
        <div class="quick-purchase-sheet__hero-meta">
          <Badge variant="muted">{payerLabel()}</Badge>
          <Badge variant="accent">{audienceLabel()}</Badge>
          <Badge variant="muted">
            {formatFriendlyDate(
              props.draft().occurredOn ?? todayCalendarInputValue(),
              props.locale()
            )}
          </Badge>
        </div>
      </article>

      <div class="quick-purchase-sheet__grid">
        <Field label={props.copy().purchaseDescriptionLabel}>
          <Input
            value={props.draft().description}
            placeholder={
              props.locale() === 'ru'
                ? 'Например, стиральный порошок или туалетная бумага'
                : 'For example, laundry detergent or toilet paper'
            }
            onInput={(event) =>
              props.setDraft((draft) => ({
                ...draft,
                description: event.currentTarget.value
              }))
            }
          />
        </Field>
        <Field label={props.copy().purchaseAmountLabel}>
          <Input
            type="text"
            inputMode="decimal"
            value={props.draft().amountMajor}
            placeholder={props.locale() === 'ru' ? 'Например, 24.50' : 'For example, 24.50'}
            onInput={(event) =>
              props.setDraft((draft) => ({
                ...draft,
                amountMajor: event.currentTarget.value
              }))
            }
          />
        </Field>
      </div>

      <div class="quick-purchase-sheet__split">
        <div class="quick-purchase-sheet__split-head">
          <span>{props.copy().purchaseSplitTitle}</span>
          <Badge variant="muted">{audienceLabel()}</Badge>
        </div>
        <div class="quick-purchase-sheet__preset-row">
          <Button
            variant={preset() === 'everyone' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => handlePresetChange('everyone')}
          >
            {props.copy().quickPurchaseSplitEveryone}
          </Button>
          <Button
            variant={preset() === 'custom' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => handlePresetChange('custom')}
          >
            {props.copy().quickPurchaseSplitCustom}
          </Button>
        </div>

        <Show when={preset() === 'custom'}>
          <div class="quick-purchase-sheet__people">
            <span class="quick-purchase-sheet__people-label">
              {props.copy().quickPurchasePeopleLabel}
            </span>
            <div class="quick-purchase-sheet__people-grid">
              <For each={props.activeMembers()}>
                {(member) => {
                  const included = () =>
                    props
                      .draft()
                      .participants.some(
                        (participant) =>
                          participant.memberId === member.memberId && participant.included
                      )

                  return (
                    <Button
                      variant={included() ? 'primary' : 'secondary'}
                      size="sm"
                      onClick={() => toggleParticipant(member.memberId)}
                    >
                      {member.displayName}
                    </Button>
                  )
                }}
              </For>
            </div>
          </div>
        </Show>
      </div>

      <button
        class="quick-purchase-sheet__toggle"
        type="button"
        onClick={() => setAdvanced(!advanced())}
      >
        <span>
          {advanced()
            ? props.copy().quickPurchaseLessOptions
            : props.copy().quickPurchaseMoreOptions}
        </span>
        <Show when={advanced()} fallback={<ChevronDown size={14} />}>
          <ChevronUp size={14} />
        </Show>
      </button>

      <Show when={advanced()}>
        <div class="quick-purchase-sheet__grid quick-purchase-sheet__grid--advanced">
          <Field label={props.copy().purchasePayerLabel}>
            <Select
              value={props.draft().payerMemberId ?? ''}
              ariaLabel={props.copy().purchasePayerLabel}
              placeholder="—"
              options={[
                { value: '', label: '—' },
                ...props.activeMembers().map((member) => ({
                  value: member.memberId,
                  label: member.displayName
                }))
              ]}
              onChange={(value) =>
                props.setDraft((draft) => {
                  if (value) {
                    return {
                      ...draft,
                      payerMemberId: value
                    }
                  }

                  // eslint-disable-next-line @typescript-eslint/no-unused-vars
                  const { payerMemberId, ...rest } = draft
                  return rest
                })
              }
            />
          </Field>
          <Field label={props.copy().purchaseDateLabel}>
            <DatePickerField
              locale={props.locale()}
              value={props.draft().occurredOn ?? ''}
              placeholder={props.copy().purchaseDateLabel}
              {...(props.datePickerPortal === undefined ? {} : { portal: props.datePickerPortal })}
              onChange={(value) =>
                props.setDraft((draft) => ({
                  ...draft,
                  occurredOn: value
                }))
              }
            />
          </Field>
        </div>
      </Show>

      <Show when={props.error()}>
        {(error) => (
          <p class="quick-purchase-sheet__error" role="alert">
            {error()}
          </p>
        )}
      </Show>

      <Show when={previewRows().length > 0}>
        <section class="quick-purchase-preview">
          <div class="quick-purchase-preview__header">
            <div>
              <strong>{props.copy().quickPurchasePreviewTitle}</strong>
              <p>{props.copy().quickPurchasePreviewBody}</p>
            </div>
          </div>
          <div class="quick-purchase-preview__list">
            <For each={previewRows()}>
              {(row) => (
                <article class="quick-purchase-preview__row">
                  <div class="quick-purchase-preview__identity">
                    <strong>{row.displayName}</strong>
                    <span
                      class="quick-purchase-preview__delta"
                      classList={{
                        'is-credit': semanticMoneyTone(row.deltaMajor) === 'is-credit',
                        'is-debit': semanticMoneyTone(row.deltaMajor) === 'is-debit',
                        'is-neutral': semanticMoneyTone(row.deltaMajor) === 'is-neutral'
                      }}
                    >
                      {formatMoneyLabel(row.deltaMajor, props.currency(), props.locale())}
                    </span>
                  </div>
                  <div class="quick-purchase-preview__balances">
                    <span class="quick-purchase-preview__amount quick-purchase-preview__amount--before">
                      {formatMoneyLabel(
                        row.currentPurchaseBalanceMajor,
                        props.currency(),
                        props.locale()
                      )}
                    </span>
                    <span class="quick-purchase-preview__arrow" aria-hidden="true">
                      →
                    </span>
                    <span
                      class="quick-purchase-preview__amount quick-purchase-preview__amount--after"
                      classList={{
                        'is-credit':
                          semanticMoneyTone(row.projectedPurchaseBalanceMajor) === 'is-credit',
                        'is-debit':
                          semanticMoneyTone(row.projectedPurchaseBalanceMajor) === 'is-debit',
                        'is-neutral':
                          semanticMoneyTone(row.projectedPurchaseBalanceMajor) === 'is-neutral'
                      }}
                    >
                      {formatMoneyLabel(
                        row.projectedPurchaseBalanceMajor,
                        props.currency(),
                        props.locale()
                      )}
                    </span>
                  </div>
                </article>
              )}
            </For>
          </div>
        </section>
      </Show>

      <div class="quick-purchase-sheet__actions">
        <Show when={props.onSecondaryAction && props.secondaryActionLabel}>
          <Button variant="ghost" onClick={() => props.onSecondaryAction?.()}>
            {props.secondaryActionLabel}
          </Button>
        </Show>
        <Show when={props.onCancel}>
          <Button variant="ghost" onClick={() => props.onCancel?.()}>
            {props.cancelLabel ?? props.copy().closeEditorAction}
          </Button>
        </Show>
        <Button
          variant="primary"
          loading={props.submitting()}
          disabled={
            !props.draft().description.trim() ||
            !props.draft().amountMajor.trim() ||
            includedParticipants().length === 0
          }
          onClick={props.onSubmit}
        >
          {props.submitLabel()}
        </Button>
      </div>
    </div>
  )
}
