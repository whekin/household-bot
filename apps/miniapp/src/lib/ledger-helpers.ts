/**
 * Pure helpers for ledger entries and purchase/payment drafts.
 */

import { majorStringToMinor, minorToMajorString, parseMoneyInput } from './money'
import { calendarDateInputValue } from './dates'
import type { MiniAppDashboard } from '../api'

/* ── Draft types ────────────────────────────────────── */

export type ParticipantShare = {
  memberId: string
  included: boolean
  shareAmountMajor: string
  sharePercentage: string
  lastUpdatedAt?: number
  isAutoCalculated?: boolean
}

export type PurchaseDraft = {
  description: string
  amountMajor: string
  currency: 'USD' | 'GEL'
  occurredOn: string | null
  payerMemberId?: string
  splitMode: 'equal' | 'custom_amounts'
  splitInputMode: 'equal' | 'exact' | 'percentage'
  participants: ParticipantShare[]
}

export type PaymentDraft = {
  memberId: string
  kind: 'rent' | 'utilities'
  amountMajor: string
  currency: 'USD' | 'GEL'
  period: string
}

/* ── Pure helpers ───────────────────────────────────── */

export function canEditLedgerEntry(input: {
  entry: MiniAppDashboard['ledger'][number]
  currentMemberId: string
  isAdmin: boolean
}): boolean {
  if (input.isAdmin) {
    return true
  }

  return (
    input.entry.kind === 'purchase' &&
    input.entry.createdByMemberId === input.currentMemberId &&
    input.entry.isCurrentCyclePurchase === true &&
    input.entry.hasRecordedAllocations !== true
  )
}

export function purchaseDraftForEntry(entry: MiniAppDashboard['ledger'][number]): PurchaseDraft {
  return {
    description: entry.title,
    amountMajor: entry.amountMajor,
    currency: entry.currency,
    occurredOn: calendarDateInputValue(entry.occurredAt),
    ...(entry.payerMemberId !== undefined ? { payerMemberId: entry.payerMemberId } : {}),
    splitMode: entry.purchaseSplitMode ?? 'equal',
    splitInputMode: (entry.purchaseSplitMode ?? 'equal') === 'equal' ? 'equal' : 'exact',
    participants:
      entry.purchaseParticipants?.map((participant) => ({
        memberId: participant.memberId,
        included: participant.included ?? true,
        shareAmountMajor: participant.shareAmountMajor ?? '',
        sharePercentage: ''
      })) ?? []
  }
}

export function paymentDraftForEntry(entry: MiniAppDashboard['ledger'][number]): PaymentDraft {
  return {
    memberId: entry.memberId ?? '',
    kind: entry.paymentKind ?? 'rent',
    amountMajor: entry.amountMajor,
    currency: entry.currency,
    period: ''
  }
}

/**
 * Rebalance purchase split with "least updated" logic.
 * When a participant's share changes, the difference is absorbed by:
 * 1. Auto-calculated participants first (not manually entered)
 * 2. Then the manually entered participant with oldest lastUpdatedAt
 * If adjusted participant would go negative, cascade to next eligible.
 * Participants at 0 are automatically excluded.
 */
export function rebalancePurchaseSplit(
  draft: PurchaseDraft,
  changedMemberId: string | null,
  newAmountMajor: string | null
): PurchaseDraft {
  const totalMinor = parseMoneyInput(draft.amountMajor)
  let participants = draft.participants.map((p) => ({ ...p }))

  // 1. Update the changed participant if any
  if (changedMemberId !== null && newAmountMajor !== null) {
    const idx = participants.findIndex((p) => p.memberId === changedMemberId)
    if (idx !== -1) {
      participants[idx] = {
        ...participants[idx]!,
        shareAmountMajor: newAmountMajor,
        lastUpdatedAt: Date.now(),
        isAutoCalculated: false
      }
    }
  }

  // 2. Identify included participants to balance against
  const included = participants
    .map((p, idx) => ({ ...p, idx }))
    .filter((p) => p.included && p.memberId !== changedMemberId)

  // 3. Calculate current allocation and delta
  const currentAllocated = participants
    .filter((p) => p.included)
    .reduce((sum, p) => sum + parseMoneyInput(p.shareAmountMajor || '0'), 0n)

  let delta = currentAllocated - totalMinor

  if (delta !== 0n && included.length > 0) {
    // 4. Distribute delta among others (preferring auto-calculated)
    const sorted = [...included].sort((a, b) => {
      // Prefer auto-calculated for absorbing changes
      if (a.isAutoCalculated !== b.isAutoCalculated) {
        return a.isAutoCalculated === false ? 1 : -1
      }
      // Then oldest updated
      const aTime = a.lastUpdatedAt ?? 0
      const bTime = b.lastUpdatedAt ?? 0
      return aTime - bTime
    })

    for (const p of sorted) {
      if (delta === 0n) break
      const currentMinor = parseMoneyInput(participants[p.idx]!.shareAmountMajor || '0')
      let newValue = currentMinor - delta

      if (newValue < 0n) {
        delta = -newValue
        newValue = 0n
      } else {
        delta = 0n
      }

      participants[p.idx] = {
        ...participants[p.idx]!,
        shareAmountMajor: minorToMajorString(newValue),
        isAutoCalculated: true
      }
    }
  }

  // Special case: if it's 'equal' mode and we aren't handling a specific change, force equal
  // Also initialize equal split for exact/percentage modes when no specific change provided
  if (draft.splitInputMode !== 'equal' && changedMemberId === null) {
    const active = participants
      .map((p, idx) => ({ ...p, idx }))
      .filter((p) => p.included)
      .sort((a, b) => (a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0))
    if (active.length > 0) {
      const count = BigInt(active.length)
      const baseShare = totalMinor / count
      const remainder = totalMinor % count
      active.forEach((p, i) => {
        const share = baseShare + (BigInt(i) < remainder ? 1n : 0n)
        participants[p.idx] = {
          ...participants[p.idx]!,
          shareAmountMajor: minorToMajorString(share),
          isAutoCalculated: true
        }
      })
    }
  } else if (draft.splitInputMode === 'equal' && changedMemberId === null) {
    const active = participants
      .map((p, idx) => ({ ...p, idx }))
      .filter((p) => p.included)
      .sort((a, b) => (a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0))
    if (active.length > 0) {
      const count = BigInt(active.length)
      const baseShare = totalMinor / count
      const remainder = totalMinor % count
      active.forEach((p, i) => {
        const share = baseShare + (BigInt(i) < remainder ? 1n : 0n)
        participants[p.idx] = {
          ...participants[p.idx]!,
          shareAmountMajor: minorToMajorString(share),
          isAutoCalculated: true
        }
      })
    }
  }

  return recalculatePercentages({
    ...draft,
    participants: excludeZeroShareCustomParticipants(draft, participants)
  })
}

function recalculatePercentages(draft: PurchaseDraft): PurchaseDraft {
  const totalMinor = parseMoneyInput(draft.amountMajor)
  if (totalMinor <= 0n) return draft

  const participants = draft.participants.map((p) => {
    if (!p.included) {
      return { ...p, sharePercentage: '' }
    }
    const shareMinor = parseMoneyInput(p.shareAmountMajor || '0')
    const percentage = Number((shareMinor * 10000n) / totalMinor) / 100
    return {
      ...p,
      sharePercentage: percentage > 0 ? percentage.toFixed(2) : ''
    }
  })

  return { ...draft, participants }
}

function excludeZeroShareCustomParticipants(
  draft: PurchaseDraft,
  participants: ParticipantShare[]
): ParticipantShare[] {
  if (draft.splitInputMode === 'equal') {
    return participants
  }

  return participants.map((participant) => {
    if (!participant.included) {
      return participant
    }

    const shareMinor = parseMoneyInput(participant.shareAmountMajor || '0')
    if (shareMinor > 0n) {
      return participant
    }

    return {
      ...participant,
      included: false,
      shareAmountMajor: '0.00',
      sharePercentage: '',
      isAutoCalculated: true
    }
  })
}

export function calculateRemainingToAllocate(draft: PurchaseDraft): bigint {
  const totalMinor = parseMoneyInput(draft.amountMajor)
  const allocated = draft.participants
    .filter((p) => p.included)
    .reduce((sum, p) => sum + parseMoneyInput(p.shareAmountMajor || '0'), 0n)
  return totalMinor - allocated
}

export function percentageStringToBasisPoints(value: string): bigint {
  const normalized = value.trim().replace(',', '.')
  const match = /^(?:(\d+)(?:\.(\d*))?|\.(\d+))$/.exec(normalized)
  if (!match) {
    return 0n
  }

  const [, wholePart = '0', fractionalPart = '', leadingFractionalPart = ''] = match
  const roundedFractionalBasisPoints = (fractionalPart || leadingFractionalPart).padEnd(3, '0')
  const basisPoints =
    BigInt(wholePart) * 100n +
    BigInt(roundedFractionalBasisPoints.slice(0, 2) || '0') +
    (Number(roundedFractionalBasisPoints[2] ?? '0') >= 5 ? 1n : 0n)
  return basisPoints
}

export type PurchaseDraftValidation = {
  valid: boolean
  error?: string
  remainingMinor: bigint
}

export function validatePurchaseDraft(draft: PurchaseDraft): PurchaseDraftValidation {
  if (draft.splitInputMode === 'equal') {
    return { valid: true, remainingMinor: 0n }
  }

  const totalMinor = parseMoneyInput(draft.amountMajor)
  const remaining = calculateRemainingToAllocate(draft)

  const hasNonPositiveShare = draft.participants.some((p) => {
    if (!p.included) return false
    const shareMinor = parseMoneyInput(p.shareAmountMajor || '0')
    return shareMinor <= 0n
  })

  if (hasNonPositiveShare) {
    return {
      valid: false,
      error: 'Included shares must be positive',
      remainingMinor: remaining
    }
  }

  const hasInvalidShare = draft.participants.some((p) => {
    if (!p.included) return false
    const shareMinor = parseMoneyInput(p.shareAmountMajor || '0')
    return shareMinor > totalMinor
  })

  if (hasInvalidShare) {
    return {
      valid: false,
      error: 'Share cannot exceed total amount',
      remainingMinor: remaining
    }
  }

  if (remaining !== 0n) {
    return {
      valid: false,
      error: remaining > 0n ? 'Total shares must equal total amount' : 'Total shares exceed amount',
      remainingMinor: remaining
    }
  }

  return { valid: true, remainingMinor: remaining }
}

/**
 * Compute the prefill amount for a payment based on member dues.
 * Bug #5 fix: Prefill with the remaining amount for the selected payment kind.
 */
export function computePaymentPrefill(
  dashboard: MiniAppDashboard | null | undefined,
  memberId: string,
  kind: 'rent' | 'utilities',
  period: string
): string {
  if (!dashboard) {
    return ''
  }

  const periodSummary = (dashboard.paymentPeriods ?? []).find((entry) => entry.period === period)
  const kindSummary = periodSummary?.kinds.find((entry) => entry.kind === kind)
  const memberSummary = kindSummary?.unresolvedMembers.find((entry) => entry.memberId === memberId)
  if (!memberSummary) {
    return '0.00'
  }

  return minorToMajorString(majorStringToMinor(memberSummary.suggestedAmountMajor))
}
