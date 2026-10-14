import type { MiniAppDashboard } from '../api'
import { todayCalendarInputValue } from './dates'
import { type PurchaseDraft } from './ledger-helpers'

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
