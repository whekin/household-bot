import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { addMiniAppPurchase } from '@/api'
import { useDashboard } from '@/app/dashboard-context'
import { useSession } from '@/app/session-context'
import { useToast } from '@/components/toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useI18n } from '@/i18n/context'
import { formatFriendlyDate, todayCalendarInputValue } from '@/lib/dates'
import {
  formatMoneyLabel,
  semanticMoneyTone,
  memberEffectivePurchaseBalanceMajor,
  type PurchaseDraft,
  type SemanticMoneyTone
} from '@/lib/ledger-helpers'
import {
  applyQuickPurchasePreset,
  buildEmptyPurchaseDraft,
  buildPurchaseSplitPayload,
  buildQuickPurchasePreview,
  purchaseDraftWithSelectedPayer,
  type QuickPurchasePreset
} from '@/lib/purchase-draft'
import { haptics } from '@/telegram/webapp'
import { cn } from '@/lib/cn'

export const QUICK_PURCHASE_COMPOSER_ID = 'quick-purchase-composer'

function toneClass(tone: SemanticMoneyTone): string {
  if (tone === 'is-credit') return 'text-status-credit'
  if (tone === 'is-debit') return 'text-status-due'
  return 'text-muted-foreground'
}

/**
 * Always-visible inline purchase composer: one line for the usual case
 * (description + amount, everyone included), presets and advanced payer/date
 * behind toggles, live split preview. Ported from the legacy
 * QuickPurchaseComposer + the quick-purchase flow in the legacy Home route.
 */
export function QuickPurchaseComposer({ currentMemberId }: { currentMemberId: string | null }) {
  const { copy, locale } = useI18n()
  const { initData, handleMiniAppRequestError } = useSession()
  const { dashboard, refresh } = useDashboard()
  const { showToast } = useToast()

  const [draft, setDraft] = useState<PurchaseDraft>(() =>
    buildEmptyPurchaseDraft(dashboard, currentMemberId ?? undefined)
  )
  const [preset, setPreset] = useState<QuickPurchasePreset>('everyone')
  const [advanced, setAdvanced] = useState(false)
  const [selectedPayerMemberId, setSelectedPayerMemberId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /* Rebuild the draft whenever fresh dashboard data lands, like legacy Home. */
  useEffect(() => {
    const next = buildEmptyPurchaseDraft(dashboard, currentMemberId ?? undefined)
    setDraft(next)
    setPreset('everyone')
    setAdvanced(false)
    setSelectedPayerMemberId(next.payerMemberId ?? null)
    setError(null)
  }, [dashboard, currentMemberId])

  const activeMembers = useMemo(
    () =>
      (dashboard?.members ?? [])
        .filter((member) => member.status === undefined || member.status === 'active')
        .map((member) => ({
          memberId: member.memberId,
          displayName: member.displayName,
          remainingMajor: member.remainingMajor,
          purchaseBalanceMajor: memberEffectivePurchaseBalanceMajor(member)
        })),
    [dashboard]
  )
  const memberNames = useMemo(
    () => new Map(activeMembers.map((member) => [member.memberId, member.displayName])),
    [activeMembers]
  )

  const includedParticipants = draft.participants.filter((participant) => participant.included)
  const audienceLabel =
    preset === 'everyone'
      ? copy.quickPurchaseSplitEveryone
      : locale === 'ru'
        ? includedParticipants.length === 1
          ? '1 участник'
          : `${includedParticipants.length} участников`
        : includedParticipants.length === 1
          ? '1 person'
          : `${includedParticipants.length} participants`
  const payerLabel = selectedPayerMemberId
    ? (memberNames.get(selectedPayerMemberId) ?? '—')
    : (memberNames.get(currentMemberId ?? '') ?? '—')

  const previewRows = useMemo(
    () =>
      buildQuickPurchasePreview(
        purchaseDraftWithSelectedPayer(draft, selectedPayerMemberId),
        activeMembers
      ),
    [draft, selectedPayerMemberId, activeMembers]
  )

  const currency = dashboard?.currency ?? 'GEL'

  function handlePresetChange(nextPreset: QuickPurchasePreset) {
    haptics.selection()
    setPreset(nextPreset)
    setDraft((current) => applyQuickPurchasePreset(current, nextPreset, currentMemberId))
  }

  function toggleParticipant(memberId: string) {
    haptics.selection()
    setPreset('custom')
    setDraft((current) => {
      const isIncluded = current.participants.some(
        (participant) => participant.memberId === memberId && participant.included
      )

      if (
        isIncluded &&
        current.participants.filter((participant) => participant.included).length <= 1
      ) {
        return current
      }

      return {
        ...current,
        participants: current.participants.map((participant) =>
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

  async function handleSubmit() {
    if (!initData || submitting || !draft.description.trim() || !draft.amountMajor.trim()) return

    setSubmitting(true)
    setError(null)
    try {
      await addMiniAppPurchase(initData, {
        description: draft.description.trim(),
        amountMajor: draft.amountMajor.trim(),
        currency: draft.currency,
        ...(draft.occurredOn ? { occurredOn: draft.occurredOn } : {}),
        ...(draft.payerMemberId ? { payerMemberId: draft.payerMemberId } : {}),
        split: buildPurchaseSplitPayload(draft)
      })
      await refresh()
      showToast(copy.quickPurchaseSuccess, 'success')
    } catch (requestError) {
      if (handleMiniAppRequestError(requestError)) return
      setError(requestError instanceof Error ? requestError.message : copy.purchaseMutationFailed)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card id={QUICK_PURCHASE_COMPOSER_ID} className="space-y-3">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wide text-primary">
          {copy.purchaseAddAction}
        </p>
        <CardHeader
          className="mb-0 mt-0.5"
          title={copy.quickPurchaseHeroTitle}
          hint={copy.quickPurchaseHeroBody}
        />
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge tone="neutral">{payerLabel}</Badge>
          <Badge tone="primary">{audienceLabel}</Badge>
          <Badge tone="neutral">
            {formatFriendlyDate(draft.occurredOn ?? todayCalendarInputValue(), locale)}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-2">
        <Input
          value={draft.description}
          placeholder={
            locale === 'ru'
              ? 'Например, стиральный порошок или туалетная бумага'
              : 'For example, laundry detergent or toilet paper'
          }
          aria-label={copy.purchaseDescriptionLabel}
          onChange={(event) =>
            setDraft((current) => ({ ...current, description: event.target.value }))
          }
        />
        <Input
          type="text"
          inputMode="decimal"
          className="w-28"
          value={draft.amountMajor}
          placeholder={locale === 'ru' ? 'Например, 24.50' : 'For example, 24.50'}
          aria-label={copy.purchaseAmountLabel}
          onChange={(event) =>
            setDraft((current) => ({ ...current, amountMajor: event.target.value }))
          }
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            {copy.purchaseSplitTitle}
          </span>
          <Badge tone="neutral">{audienceLabel}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={preset === 'everyone' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => handlePresetChange('everyone')}
          >
            {copy.quickPurchaseSplitEveryone}
          </Button>
          <Button
            variant={preset === 'custom' ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => handlePresetChange('custom')}
          >
            {copy.quickPurchaseSplitCustom}
          </Button>
        </div>

        {preset === 'custom' ? (
          <div className="space-y-1.5">
            <p className="text-xs text-faint">{copy.quickPurchasePeopleLabel}</p>
            <div className="flex flex-wrap gap-2">
              {activeMembers.map((member) => {
                const included = draft.participants.some(
                  (participant) => participant.memberId === member.memberId && participant.included
                )
                return (
                  <Button
                    key={member.memberId}
                    variant={included ? 'primary' : 'secondary'}
                    size="sm"
                    onClick={() => toggleParticipant(member.memberId)}
                  >
                    {member.displayName}
                  </Button>
                )
              })}
            </div>
          </div>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => setAdvanced((value) => !value)}
        className="flex items-center gap-1 text-xs font-medium text-primary"
      >
        <span>{advanced ? copy.quickPurchaseLessOptions : copy.quickPurchaseMoreOptions}</span>
        {advanced ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
      </button>

      {advanced ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label={copy.purchasePayerLabel}>
            <Select
              value={selectedPayerMemberId ?? ''}
              aria-label={copy.purchasePayerLabel}
              onChange={(event) => {
                const value = event.target.value
                setSelectedPayerMemberId(value || null)
                setDraft((current) => {
                  if (value) {
                    return { ...current, payerMemberId: value }
                  }

                  const { payerMemberId: _payerMemberId, ...rest } = current
                  return rest
                })
              }}
            >
              <option value="">—</option>
              {activeMembers.map((member) => (
                <option key={member.memberId} value={member.memberId}>
                  {member.displayName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={copy.purchaseDateLabel}>
            <Input
              type="date"
              value={draft.occurredOn ?? ''}
              onChange={(event) =>
                setDraft((current) => ({ ...current, occurredOn: event.target.value }))
              }
            />
          </Field>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}

      {previewRows.length > 0 ? (
        <div className="rounded-xl bg-elevated p-3">
          <p className="text-sm font-semibold text-foreground">{copy.quickPurchasePreviewTitle}</p>
          <p className="text-xs text-faint">{copy.quickPurchasePreviewBody}</p>
          <div className="mt-2 divide-y divide-border/60">
            {previewRows.map((row) => (
              <div key={row.memberId} className="flex items-center justify-between gap-3 py-1.5">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-foreground">
                    {row.displayName}
                  </p>
                  <p
                    className={cn(
                      'font-mono text-xs',
                      toneClass(semanticMoneyTone(row.deltaMajor))
                    )}
                  >
                    {formatMoneyLabel(row.deltaMajor, currency, locale)}
                  </p>
                </div>
                <p className="shrink-0 font-mono text-xs">
                  <span className="text-faint">
                    {formatMoneyLabel(row.currentPurchaseBalanceMajor, currency, locale)}
                  </span>
                  <span className="mx-1 text-faint" aria-hidden>
                    →
                  </span>
                  <span className={toneClass(semanticMoneyTone(row.projectedPurchaseBalanceMajor))}>
                    {formatMoneyLabel(row.projectedPurchaseBalanceMajor, currency, locale)}
                  </span>
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <Button
        variant="primary"
        className="w-full"
        loading={submitting}
        disabled={
          !draft.description.trim() ||
          !draft.amountMajor.trim() ||
          includedParticipants.length === 0
        }
        onClick={() => void handleSubmit()}
      >
        <Check className="size-4" aria-hidden />
        {copy.purchaseSaveAction}
      </Button>
    </Card>
  )
}
