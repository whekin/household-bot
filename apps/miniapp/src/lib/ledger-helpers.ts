/**
 * Pure helper functions extracted from App.tsx for ledger, member, and draft operations.
 * No side-effects, no framework imports — just data transformations.
 */

import { majorStringToMinor, minorToMajorString } from './money'
import type {
  MiniAppAdminCycleState,
  MiniAppDashboard,
  MiniAppMemberAbsencePolicy,
  MiniAppMemberAbsencePolicyRecord,
  MiniAppAdminSettingsPayload
} from '../miniapp-api'

/* ── Draft types ────────────────────────────────────── */

export type UtilityBillDraft = {
  billName: string
  amountMajor: string
  currency: 'USD' | 'GEL'
}

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
}

/* ── Pure helpers ───────────────────────────────────── */

export function absoluteMinor(value: bigint): bigint {
  return value < 0n ? -value : value
}

export function memberBaseDueMajor(member: MiniAppDashboard['members'][number]): string {
  return minorToMajorString(
    majorStringToMinor(member.rentShareMajor) + majorStringToMinor(member.utilityShareMajor)
  )
}

export function memberRemainingClass(member: MiniAppDashboard['members'][number]): string {
  const remainingMinor = majorStringToMinor(member.remainingMajor)

  if (remainingMinor < 0n) {
    return 'is-credit'
  }

  if (remainingMinor === 0n) {
    return 'is-settled'
  }

  return 'is-due'
}

export function memberCreditClass(member: MiniAppDashboard['members'][number]): string {
  const purchaseOffsetMinor = majorStringToMinor(member.purchaseOffsetMajor)

  if (purchaseOffsetMinor < 0n) {
    return 'is-credit'
  }

  if (purchaseOffsetMinor === 0n) {
    return 'is-settled'
  }

  return 'is-due'
}

export function ledgerPrimaryAmount(entry: MiniAppDashboard['ledger'][number]): string {
  return `${entry.displayAmountMajor} ${entry.displayCurrency}`
}

export function ledgerSecondaryAmount(entry: MiniAppDashboard['ledger'][number]): string | null {
  if (entry.currency === entry.displayCurrency && entry.amountMajor === entry.displayAmountMajor) {
    return null
  }

  return `${entry.amountMajor} ${entry.currency}`
}

export function cycleUtilityBillDrafts(
  bills: MiniAppAdminCycleState['utilityBills']
): Record<string, UtilityBillDraft> {
  return Object.fromEntries(
    bills.map((bill) => [
      bill.id,
      {
        billName: bill.billName,
        amountMajor: minorToMajorString(BigInt(bill.amountMinor)),
        currency: bill.currency
      }
    ])
  )
}

export function purchaseDrafts(
  entries: readonly MiniAppDashboard['ledger'][number][]
): Record<string, PurchaseDraft> {
  return Object.fromEntries(
    entries
      .filter((entry) => entry.kind === 'purchase')
      .map((entry) => [
        entry.id,
        {
          description: entry.title,
          amountMajor: entry.amountMajor,
          currency: entry.currency,
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
      ])
  )
}

export function purchaseDraftForEntry(entry: MiniAppDashboard['ledger'][number]): PurchaseDraft {
  return {
    description: entry.title,
    amountMajor: entry.amountMajor,
    currency: entry.currency,
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

export function paymentDrafts(
  entries: readonly MiniAppDashboard['ledger'][number][]
): Record<string, PaymentDraft> {
  return Object.fromEntries(
    entries
      .filter((entry) => entry.kind === 'payment')
      .map((entry) => [
        entry.id,
        {
          memberId: entry.memberId ?? '',
          kind: entry.paymentKind ?? 'rent',
          amountMajor: entry.amountMajor,
          currency: entry.currency
        }
      ])
  )
}

export function paymentDraftForEntry(entry: MiniAppDashboard['ledger'][number]): PaymentDraft {
  return {
    memberId: entry.memberId ?? '',
    kind: entry.paymentKind ?? 'rent',
    amountMajor: entry.amountMajor,
    currency: entry.currency
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
  const totalMinor = majorStringToMinor(draft.amountMajor)
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
    .reduce((sum, p) => sum + majorStringToMinor(p.shareAmountMajor || '0'), 0n)

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
      const currentMinor = majorStringToMinor(participants[p.idx]!.shareAmountMajor || '0')
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
    const active = participants.map((p, idx) => ({ ...p, idx })).filter((p) => p.included)
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
    const active = participants.map((p, idx) => ({ ...p, idx })).filter((p) => p.included)
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

  return recalculatePercentages({ ...draft, participants })
}

function recalculatePercentages(draft: PurchaseDraft): PurchaseDraft {
  const totalMinor = majorStringToMinor(draft.amountMajor)
  if (totalMinor <= 0n) return draft

  const participants = draft.participants.map((p) => {
    if (!p.included) {
      return { ...p, sharePercentage: '' }
    }
    const shareMinor = majorStringToMinor(p.shareAmountMajor || '0')
    const percentage = Number((shareMinor * 10000n) / totalMinor) / 100
    return {
      ...p,
      sharePercentage: percentage > 0 ? percentage.toFixed(2) : ''
    }
  })

  return { ...draft, participants }
}

export function calculateRemainingToAllocate(draft: PurchaseDraft): bigint {
  const totalMinor = majorStringToMinor(draft.amountMajor)
  const allocated = draft.participants
    .filter((p) => p.included)
    .reduce((sum, p) => sum + majorStringToMinor(p.shareAmountMajor || '0'), 0n)
  return totalMinor - allocated
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

  const totalMinor = majorStringToMinor(draft.amountMajor)
  const remaining = calculateRemainingToAllocate(draft)

  const hasInvalidShare = draft.participants.some((p) => {
    if (!p.included) return false
    const shareMinor = majorStringToMinor(p.shareAmountMajor || '0')
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

export function defaultCyclePeriod(): string {
  return new Date().toISOString().slice(0, 7)
}

export function defaultAbsencePolicyForStatus(
  status: 'active' | 'away' | 'left'
): MiniAppMemberAbsencePolicy {
  if (status === 'away') {
    return 'away_rent_and_utilities'
  }

  if (status === 'left') {
    return 'inactive'
  }

  return 'resident'
}

export function resolvedMemberAbsencePolicy(
  memberId: string,
  status: 'active' | 'away' | 'left',
  settings?: MiniAppAdminSettingsPayload | null
): MiniAppMemberAbsencePolicyRecord {
  const current = settings?.memberAbsencePolicies
    .filter((policy) => policy.memberId === memberId)
    .sort((left, right) => left.effectiveFromPeriod.localeCompare(right.effectiveFromPeriod))
    .at(-1)

  return (
    current ?? {
      memberId,
      effectiveFromPeriod: '',
      policy: defaultAbsencePolicyForStatus(status)
    }
  )
}

/**
 * Compute the prefill amount for a payment based on member dues.
 * Bug #5 fix: Prefill with the remaining amount for the selected payment kind.
 */
export function computePaymentPrefill(
  member: MiniAppDashboard['members'][number] | null | undefined,
  kind: 'rent' | 'utilities'
): string {
  if (!member) {
    return ''
  }

  const rentMinor = majorStringToMinor(member.rentShareMajor)
  const utilityMinor = majorStringToMinor(member.utilityShareMajor)
  const remainingMinor = majorStringToMinor(member.remainingMajor)

  if (remainingMinor <= 0n) {
    return '0.00'
  }

  // Estimate unpaid per kind (simplified: if total due matches,
  // use share for that kind as an approximation)
  const dueMinor = kind === 'rent' ? rentMinor : utilityMinor
  if (dueMinor <= 0n) {
    return '0.00'
  }

  // If remaining is less than due for this kind, use remaining
  const prefillMinor = remainingMinor < dueMinor ? remainingMinor : dueMinor
  return minorToMajorString(prefillMinor)
}
