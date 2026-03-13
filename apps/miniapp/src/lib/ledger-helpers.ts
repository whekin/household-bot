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

export type PurchaseDraft = {
  description: string
  amountMajor: string
  currency: 'USD' | 'GEL'
  splitMode: 'equal' | 'custom_amounts'
  splitInputMode: 'equal' | 'exact' | 'percentage'
  participants: {
    memberId: string
    included: boolean
    shareAmountMajor: string
    sharePercentage: string
  }[]
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
