import { parsePaymentConfirmationMessage, type FinanceCommandService } from '@household/application'
import { Money } from '@household/domain'
import type { HouseholdConfigurationRepository } from '@household/ports'

export interface PaymentProposalPayload {
  proposalId: string
  householdId: string
  memberId: string
  kind: 'rent' | 'utilities'
  amountMinor: string
  currency: 'GEL' | 'USD'
}

export function parsePaymentProposalPayload(
  payload: Record<string, unknown>
): PaymentProposalPayload | null {
  if (
    typeof payload.proposalId !== 'string' ||
    typeof payload.householdId !== 'string' ||
    typeof payload.memberId !== 'string' ||
    (payload.kind !== 'rent' && payload.kind !== 'utilities') ||
    typeof payload.amountMinor !== 'string' ||
    (payload.currency !== 'USD' && payload.currency !== 'GEL')
  ) {
    return null
  }

  if (!/^[0-9]+$/.test(payload.amountMinor)) {
    return null
  }

  return {
    proposalId: payload.proposalId,
    householdId: payload.householdId,
    memberId: payload.memberId,
    kind: payload.kind,
    amountMinor: payload.amountMinor,
    currency: payload.currency
  }
}

export async function maybeCreatePaymentProposal(input: {
  rawText: string
  householdId: string
  memberId: string
  financeService: FinanceCommandService
  householdConfigurationRepository: HouseholdConfigurationRepository
}): Promise<
  | {
      status: 'no_intent'
    }
  | {
      status: 'clarification'
    }
  | {
      status: 'unsupported_currency'
    }
  | {
      status: 'no_balance'
    }
  | {
      status: 'proposal'
      payload: PaymentProposalPayload
    }
> {
  const settings = await input.householdConfigurationRepository.getHouseholdBillingSettings(
    input.householdId
  )
  const parsed = parsePaymentConfirmationMessage(input.rawText, settings.settlementCurrency)

  if (!parsed.kind && parsed.reviewReason === 'intent_missing') {
    return {
      status: 'no_intent'
    }
  }

  if (!parsed.kind || parsed.reviewReason) {
    return {
      status: 'clarification'
    }
  }

  const dashboard = await input.financeService.generateDashboard()
  if (!dashboard) {
    return {
      status: 'clarification'
    }
  }

  const memberLine = dashboard.members.find((line) => line.memberId === input.memberId)
  if (!memberLine) {
    return {
      status: 'clarification'
    }
  }

  if (parsed.explicitAmount && parsed.explicitAmount.currency !== dashboard.currency) {
    return {
      status: 'unsupported_currency'
    }
  }

  const amount =
    parsed.explicitAmount ??
    (parsed.kind === 'rent'
      ? memberLine.rentShare
      : memberLine.utilityShare.add(memberLine.purchaseOffset))

  if (amount.amountMinor <= 0n) {
    return {
      status: 'no_balance'
    }
  }

  return {
    status: 'proposal',
    payload: {
      proposalId: crypto.randomUUID(),
      householdId: input.householdId,
      memberId: input.memberId,
      kind: parsed.kind,
      amountMinor: amount.amountMinor.toString(),
      currency: amount.currency
    }
  }
}

export function synthesizePaymentConfirmationText(payload: PaymentProposalPayload): string {
  const amount = Money.fromMinor(BigInt(payload.amountMinor), payload.currency)
  const kindText = payload.kind === 'rent' ? 'rent' : 'utilities'

  return `paid ${kindText} ${amount.toMajorString()} ${amount.currency}`
}
