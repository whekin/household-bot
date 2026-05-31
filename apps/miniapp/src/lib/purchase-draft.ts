import type { MiniAppDashboard } from '../miniapp-api'
import { todayCalendarInputValue } from './dates'
import { type PurchaseDraft } from './ledger-helpers'
import { majorStringToMinor, minorToMajorString } from './money'

export type QuickPurchasePreset = 'everyone' | 'custom'

export function buildEmptyPurchaseDraft(
  data: MiniAppDashboard | null | undefined,
  currentMemberId: string | undefined
): PurchaseDraft {
  const activeMembers = (data?.members ?? []).filter(
    (member) => member.status === undefined || member.status === 'active'
  )
  const activeMemberIds = new Set(activeMembers.map((member) => member.memberId))
  const payerMemberId =
    currentMemberId && activeMemberIds.has(currentMemberId) ? currentMemberId : undefined

  return {
    description: '',
    amountMajor: '',
    currency: (data?.currency as 'USD' | 'GEL') ?? 'GEL',
    occurredOn: todayCalendarInputValue(),
    ...(payerMemberId ? { payerMemberId } : {}),
    splitMode: 'equal',
    splitInputMode: 'equal',
    participants: activeMembers.map((member) => ({
      memberId: member.memberId,
      included: true,
      shareAmountMajor: '',
      sharePercentage: ''
    }))
  }
}

export function buildPurchaseSplitPayload(draft: PurchaseDraft) {
  return {
    mode: draft.splitMode,
    participants: draft.participants.map((participant) => ({
      memberId: participant.memberId,
      included: participant.included,
      ...(draft.splitMode === 'custom_amounts' && participant.included
        ? { shareAmountMajor: participant.shareAmountMajor || '0.00' }
        : {})
    }))
  } as const
}

export function applyQuickPurchasePreset(
  draft: PurchaseDraft,
  preset: QuickPurchasePreset,
  currentMemberId: string | null
): PurchaseDraft {
  if (preset === 'everyone' || !currentMemberId) {
    return {
      ...draft,
      splitMode: 'equal',
      splitInputMode: 'equal',
      participants: draft.participants.map((participant) => ({
        ...participant,
        included: true,
        shareAmountMajor: '',
        sharePercentage: ''
      }))
    }
  }

  return {
    ...draft,
    splitMode: 'equal',
    splitInputMode: 'equal'
  }
}

function splitEvenlyShareMinor(amountMinor: bigint, includedCount: number, index: number): bigint {
  if (includedCount <= 0) {
    return 0n
  }

  const base = amountMinor / BigInt(includedCount)
  const leftover = amountMinor % BigInt(includedCount)

  return base + (BigInt(index) < leftover ? 1n : 0n)
}

export type QuickPurchasePreviewRow = {
  memberId: string
  displayName: string
  deltaMajor: string
  currentRemainingMajor: string
  projectedRemainingMajor: string
  currentPurchaseBalanceMajor: string
  projectedPurchaseBalanceMajor: string
}

export type QuickPurchasePreviewMember = {
  memberId: string
  displayName: string
  remainingMajor: string
  purchaseBalanceMajor: string
}

export function purchaseDraftWithSelectedPayer(
  draft: PurchaseDraft,
  selectedPayerMemberId: string | null
): PurchaseDraft {
  return {
    description: draft.description,
    amountMajor: draft.amountMajor,
    currency: draft.currency,
    occurredOn: draft.occurredOn,
    ...(selectedPayerMemberId ? { payerMemberId: selectedPayerMemberId } : {}),
    splitMode: draft.splitMode,
    splitInputMode: draft.splitInputMode,
    participants: draft.participants
  }
}

export function buildQuickPurchasePreview(
  draft: PurchaseDraft,
  members: readonly QuickPurchasePreviewMember[]
): QuickPurchasePreviewRow[] {
  const amountMinor = majorStringToMinor(draft.amountMajor || '0')
  if (amountMinor <= 0n) {
    return []
  }

  const includedParticipants = draft.participants.filter((participant) => participant.included)
  if (includedParticipants.length === 0) {
    return []
  }

  const payerMemberId = draft.payerMemberId ?? null

  const deltaByMemberId = new Map<string, bigint>()
  const customShareMinors =
    draft.splitMode === 'custom_amounts'
      ? includedParticipants.map((participant) =>
          majorStringToMinor(participant.shareAmountMajor || '0')
        )
      : null
  const customShareTotalMinor = customShareMinors?.reduce((sum, current) => sum + current, 0n) ?? 0n
  const useCustomShares =
    customShareMinors !== null &&
    customShareMinors.every((shareMinor) => shareMinor > 0n) &&
    customShareTotalMinor === amountMinor

  if (customShareMinors !== null && !useCustomShares) {
    return []
  }

  includedParticipants.forEach((participant, index) => {
    const shareMinor =
      customShareMinors?.[index] ??
      splitEvenlyShareMinor(amountMinor, includedParticipants.length, index)
    const paidMinor = participant.memberId === payerMemberId ? amountMinor : 0n
    deltaByMemberId.set(participant.memberId, shareMinor - paidMinor)
  })

  if (payerMemberId && !deltaByMemberId.has(payerMemberId)) {
    deltaByMemberId.set(payerMemberId, -amountMinor)
  }

  return members
    .filter((member) => deltaByMemberId.has(member.memberId))
    .map((member) => {
      const deltaMinor = deltaByMemberId.get(member.memberId) ?? 0n
      const currentRemainingMinor = majorStringToMinor(member.remainingMajor)
      const currentPurchaseBalanceMinor = majorStringToMinor(member.purchaseBalanceMajor)

      return {
        memberId: member.memberId,
        displayName: member.displayName,
        deltaMajor: minorToMajorString(deltaMinor),
        currentRemainingMajor: member.remainingMajor,
        projectedRemainingMajor: minorToMajorString(currentRemainingMinor + deltaMinor),
        currentPurchaseBalanceMajor: member.purchaseBalanceMajor,
        projectedPurchaseBalanceMajor: minorToMajorString(currentPurchaseBalanceMinor + deltaMinor)
      }
    })
    .sort((left, right) =>
      majorStringToMinor(right.deltaMajor) === majorStringToMinor(left.deltaMajor)
        ? left.displayName.localeCompare(right.displayName)
        : majorStringToMinor(right.deltaMajor) > majorStringToMinor(left.deltaMajor)
          ? 1
          : -1
    )
}
